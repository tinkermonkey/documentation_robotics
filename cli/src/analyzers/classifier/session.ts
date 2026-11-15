/**
 * Tier 1 for one run: the opt-in resolved, the model built from it, the cache and the ledger, the
 * month's budget, and what the run says (TIER1_DESIGN.md sections 2.4 and 4.3): the notice naming
 * every party that received card text, and the `tier1` block. Nothing here prints or returns a key.
 */
import path from "node:path";
import { DEFAULT_THRESHOLDS, modeOf, thresholdsFor, type Thresholds, type Tier1Mode } from "./bands.js";
import { Tier1Cache } from "./cache.js";
import { formatUsd, resolveTier1, type ResolvedTier1, type ResolveTier1Options, type Tier1Config, type Tier1Credentials } from "./config.js";
import { createDecisionModel, type FetchLike, type RegisteredModel } from "./decision-model/registry.js";
import { OPENROUTER, OPENROUTER_ALPHA_NOTICE } from "./decision-model/adapters/openrouter.js";
import type { DecisionModel } from "./decision-model/types.js";
import { CURRENT_QSET_ID } from "./qset/index.js";
import { capMessage, isCapped, monthLine, nearCapWarning, SpendLedger } from "./spend.js";
import type { Tier1Block, Tier1Month, Tier1Routing, Tier1RunStats } from "./types.js";

/** What every card sent carries (section 2.4). */
export const CARD_CONTENTS = "symbol, signature, docstring, callers, callees, imports and up to 40 source lines each";

const PROVIDER_NAMES: Record<string, string> = { "cloudflare-workers-ai": "Cloudflare Workers AI", openrouter: "OpenRouter" };

export function providerDisplayName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider;
}

export interface OpenTier1Options extends ResolveTier1Options {
  /** For the adapter; default the global `fetch`. */
  fetch?: FetchLike;
  /** Tests build a fake model here instead of the registry's adapter. */
  createModel?: (resolved: Extract<ResolvedTier1, { state: "ready" }>) => DecisionModel;
  /** Ledger and cache clock, for tests. */
  now?: () => number;
}

export interface ReadyTier1 {
  state: "ready";
  resolved: Extract<ResolvedTier1, { state: "ready" }>;
  config: Tier1Config;
  registered: RegisteredModel;
  model: DecisionModel;
  cache: Tier1Cache;
  ledger: SpendLedger;
  month: Tier1Month;
  qset: string;
  host: string;
  thresholds: Thresholds | null;
  thresholdsSource: NonNullable<Tier1Block["thresholds"]> | null;
  mode: Tier1Mode;
  /** Who receives card text, for the notice: `Cloudflare Workers AI (@cf/cloudflare/clef, account …3f9a)`. */
  party: string;
  /** OpenRouter: the routing every request carries; null for other providers. */
  routing: Tier1Routing | null;
  warnings: string[];
}

/** OpenRouter's routing for a configuration, as every request sends it (section 3.2); null for other providers. */
export function routingOf(config: Pick<Tier1Config, "provider" | "openrouter">): Tier1Routing | null {
  if (config.provider !== OPENROUTER || !config.openrouter) return null;
  return { only: [...config.openrouter.only], allowFallbacks: false, dataCollection: "deny", ...(config.openrouter.zdr ? { zdr: true } : {}) };
}

/** The alpha sentence, for OpenRouter (decision 11); empty for other providers. */
export function alphaNotice(provider: string): string {
  return provider === OPENROUTER ? OPENROUTER_ALPHA_NOTICE : "";
}

export type Tier1Session = ReadyTier1 | { state: "off" | "misconfigured" | "no-credentials"; resolved: Exclude<ResolvedTier1, { state: "ready" }>; block: Tier1Block };

/** The cache's serving host for a configuration (section 4.1). */
export function hostOf(config: Pick<Tier1Config, "provider" | "openrouter">, model: Pick<DecisionModel, "id">): string {
  if (model.id.upstream) return model.id.upstream;
  if (config.provider === "openrouter") return config.openrouter?.only.length === 1 ? config.openrouter.only[0] : "any";
  return config.provider;
}

/**
 * Who receives card text: `Cloudflare Workers AI (@cf/cloudflare/clef, account …3f9a)`, or
 * `OpenRouter (cloudflare/clef), to be forwarded only to cloudflare`. No secret: the account id's
 * last four only.
 */
export function partyOf(provider: string, modelId: string, credentials?: Tier1Credentials, routing?: Tier1Routing | null): string {
  const account = provider === "cloudflare-workers-ai" ? credentials?.tail("accountId") : undefined;
  const party = `${providerDisplayName(provider)} (${modelId}${account ? `, account …${account}` : ""})`;
  return routing ? `${party}, to be forwarded only to ${upstreamList(routing.only)}` : party;
}

/** `cloudflare`, `cloudflare or deepinfra/fp8`, `a, b or c`. */
function upstreamList(only: readonly string[]): string {
  return only.length <= 1 ? (only[0] ?? "") : `${only.slice(0, -1).join(", ")} or ${only[only.length - 1]}`;
}

/**
 * The upstreams that served, with counts, for the notice: `Cloudflare (412), DeepInfra (3)`;
 * null when no response named one.
 */
function servedList(servedBy: Record<string, number>): string | null {
  const entries = Object.entries(servedBy).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([u, n]) => `${u} (${n.toLocaleString("en-US")})`).join(", ") : null;
}

/** The block of a run where Tier 1 didn't run: off, misconfigured or without credentials. */
export function blockOfResolved(resolved: Exclude<ResolvedTier1, { state: "ready" }>): Tier1Block {
  const warnings = resolved.state === "off" ? [] : resolved.warnings;
  const notice =
    resolved.state === "off"
      ? `Tier 1 is off: ${resolved.reason}`
      : resolved.state === "misconfigured"
        ? `Tier 1 is misconfigured, so this run is Tier 0 only: ${resolved.reason}`
        : `Tier 1 has no credentials, so this run is Tier 0 only: ${resolved.reason}`;
  return {
    state: resolved.state,
    reason: resolved.reason,
    ...(resolved.state === "no-credentials" ? { provider: resolved.config.provider, model: resolved.config.model } : {}),
    notice,
    ...(warnings.length ? { warnings } : {}),
  };
}

/** Resolve the opt-in and, when it is ready, build what a run needs. Never sends a request. */
export async function openTier1(projectRoot: string, analyzer: string, options: OpenTier1Options = {}): Promise<Tier1Session> {
  const resolved = await resolveTier1(projectRoot, analyzer, options);
  if (resolved.state !== "ready") return { state: resolved.state, resolved, block: blockOfResolved(resolved) };
  const { config, credentials, model: registered } = resolved;
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const model = options.createModel
    ? options.createModel(resolved)
    : createDecisionModel({
        provider: config.provider,
        model: registered.name,
        credentials: credentials.reveal(),
        fetch: fetchImpl,
        ...(config.openrouter ? { openrouter: { only: config.openrouter.only, ...(config.openrouter.zdr ? { zdr: true } : {}) } } : {}),
      });
  const qset = CURRENT_QSET_ID;
  const canonical = model.id.canonicalModel;
  const thresholds = thresholdsFor(qset, canonical, config.thresholds);
  const shipped = DEFAULT_THRESHOLDS[qset]?.[canonical];
  const overridden = !!config.thresholds && Object.keys(config.thresholds).length > 0;
  const thresholdsSource: ReadyTier1["thresholdsSource"] = thresholds
    ? { ...thresholds, source: overridden ? "override" : "default", fit: overridden ? "override" : (shipped?.fit ?? "in-sample") }
    : null;
  const ledger = new SpendLedger(resolved.paths.ledger, options.now ? { now: options.now } : {});
  let month: Tier1Month;
  try {
    month = await ledger.month(config.monthlyCapUsd);
  } catch (e) {
    // Without the month's spend the cap can't be kept: Tier 1 stays off for this run, and says why.
    const code = (e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.message : String(e));
    const misconfigured = {
      state: "misconfigured" as const,
      paths: resolved.paths,
      reason: `the spend ledger ${path.relative(projectRoot, resolved.paths.ledger)} could not be read (${code}), so the monthly cap can't be kept: make it readable and writable by you (chmod 600)`,
      warnings: resolved.warnings,
    };
    return { state: "misconfigured", resolved: misconfigured, block: blockOfResolved(misconfigured) };
  }
  return {
    state: "ready",
    resolved,
    config,
    registered,
    model,
    cache: new Tier1Cache(resolved.paths.cache, options.now ? { now: options.now } : {}),
    ledger,
    month,
    qset,
    host: hostOf(config, model),
    thresholds,
    thresholdsSource,
    mode: modeOf(qset, canonical),
    party: partyOf(config.provider, model.id.model, credentials, routingOf(config)),
    routing: routingOf(config),
    warnings: [...resolved.warnings, ...(ledger.skipped ? [`${ledger.skipped} unreadable line(s) in the spend ledger were skipped`] : [])],
  };
}

/** Said before the first request (`dr analyzer classify` prints it to stderr). */
export function preSendNotice(session: ReadyTier1, cards: number): string {
  return (
    `Tier 1: sending up to ${cards.toLocaleString("en-US")} card${cards === 1 ? "" : "s"} (${CARD_CONTENTS}) to ${session.party}, ` +
    `because ${session.resolved.paths.configRelative} enables Tier 1. ${monthLine(session.month)}` +
    (session.routing ? ` ${OPENROUTER_ALPHA_NOTICE}` : "")
  );
}

/** The notice after a run (section 2.4): who received card text and why, the month's spend, warnings and the cap message. */
export function runNotice(session: ReadyTier1, stats: Tier1RunStats, month: Tier1Month): string {
  const parts: string[] = [];
  const asked = stats.sent + stats.failed;
  if (asked > 0) {
    const cards = `${asked.toLocaleString("en-US")} card${asked === 1 ? "" : "s"} (${CARD_CONTENTS})`;
    const why = `because ${session.resolved.paths.configRelative} enables Tier 1.`;
    if (session.routing) {
      // Every party that received card text: OpenRouter, and each upstream the responses named.
      // `servedBy` counts answered responses; a failed card's upstream may be unknown (a routing
      // failure names its upstream in the stop reason below).
      const served = servedList(stats.servedBy);
      const only = upstreamList(session.routing.only);
      const forwarded = served
        ? `which forwarded them to ${served}${stats.failed ? ` (cards without a usable answer: to ${only})` : ""}`
        : `which forwards only to ${only}`;
      parts.push(`Sent ${cards} to ${providerDisplayName(session.config.provider)} (${session.model.id.model}), ${forwarded}, ${why}`);
    } else {
      parts.push(`Sent ${cards} to ${session.party}, ${why}`);
    }
  } else {
    parts.push(`Nothing was sent to ${providerDisplayName(session.config.provider)}${stats.cached ? `: ${stats.cached.toLocaleString("en-US")} card${stats.cached === 1 ? " was" : "s were"} answered from the cache` : ""}.`);
  }
  if (stats.failed) parts.push(`${stats.failed} card${stats.failed === 1 ? "" : "s"} got no usable answer and went on without one.`);
  if (stats.unavailable) {
    const left = stats.skippedFor.unavailable;
    parts.push(`Tier 1 stopped (${stats.unavailable.kind}): ${stats.unavailable.reason}.${left ? ` ${left} card${left === 1 ? "" : "s"} went on without a Tier-1 answer.` : ""}`);
  }
  if (stats.skippedFor.cacheOnly) {
    const n = stats.skippedFor.cacheOnly;
    parts.push(`${n} card${n === 1 ? " had" : "s had"} no cached answer and ${n === 1 ? "wasn't" : "weren't"} asked: this run used cached answers only.`);
  }
  if (stats.skippedFor.deadline) parts.push(`${stats.skippedFor.deadline} card${stats.skippedFor.deadline === 1 ? "" : "s"} weren't asked before the run's time ran out.`);
  if (stats.skippedFor.cap || isCapped(month)) parts.push(capMessage(month, stats.skippedFor.cap));
  else {
    parts.push(monthLine(month));
    const near = nearCapWarning(month);
    if (near) parts.push(near);
  }
  if (session.mode === "suggest" && session.thresholds) parts.push("Bands are suggestions (in-sample thresholds): nothing is accepted without the agent.");
  if (!session.thresholds) parts.push(`${session.model.id.canonicalModel} has no thresholds for ${session.qset}, so every card escalates with its hint.`);
  if (session.routing) parts.push(OPENROUTER_ALPHA_NOTICE);
  return parts.join(" ");
}

/** The `tier1` block of a run that ran (section 2.4). */
export function blockOfRun(session: ReadyTier1, stats: Tier1RunStats, month: Tier1Month, warnings: string[] = []): Tier1Block {
  return {
    state: stats.state,
    ...(stats.unavailable ? { reason: `${stats.unavailable.kind}: ${stats.unavailable.reason}` } : {}),
    provider: session.config.provider,
    model: session.model.id.model,
    ...(session.routing ? { routing: session.routing } : {}),
    qset: session.qset,
    mode: session.mode,
    thresholds: session.thresholdsSource,
    cards: stats.cards,
    cached: stats.cached,
    sent: stats.sent,
    failed: stats.failed,
    skipped: stats.skipped,
    bands: stats.bands,
    costUsd: stats.costUsd,
    month,
    servedBy: stats.servedBy,
    durationMs: stats.durationMs,
    cache: stats.cache,
    notice: runNotice(session, stats, month),
    ...([...session.warnings, ...warnings].length ? { warnings: [...session.warnings, ...warnings] } : {}),
  };
}

/** One line for status output: `$6.12 of $20.00 this month, $13.88 left, resets 1 Dec 2026`. */
export function spendSummary(month: Tier1Month): string {
  return `${formatUsd(month.spentUsd)} of ${formatUsd(month.capUsd)} this month (${month.cards.toLocaleString("en-US")} cards), ${formatUsd(month.remainingUsd)} left`;
}
