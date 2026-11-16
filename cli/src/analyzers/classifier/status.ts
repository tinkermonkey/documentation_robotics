/**
 * Where Tier 1 stands for a checkout (TIER1_DESIGN.md sections 2.4 and 4.3): the opt-in's state,
 * provider and model, where each key comes from (never its value), this month's spend against the
 * cap, the cache and the ledger's spend by source; and the probe (a fixed synthetic card, no
 * project code) with its spend recorded. `dr analyzer tier1 status|test`, the `tier1_status` MCP
 * tool and `project_status` read it from here, so they say the same thing. Nothing here writes
 * `tier1.json`, and no result holds a key.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_MONTHLY_CAP_USD,
  formatUsd,
  gitWithTimeout,
  readTier1File,
  resolveTier1,
  symlinkOnPath,
  type GitRunner,
  type ResolvedTier1,
} from "./config.js";
import { credentialEnv, resolveModel } from "./decision-model/registry.js";
import { probeCostEstimate, probeTier1, type ProbeResult } from "./decision-model/probe.js";
import { loadSpecCriteria, type SpecCriteria } from "./criteria.js";
import { Tier1Cache } from "./cache.js";
import { formatDay, isCapped, monthOf, monthWindow, nearCap, nearCapWarning, SpendLedger, type SpendEntry, type SpendSource } from "./spend.js";
import { alphaNotice, resolveTier1Mode, routingOf, type ReadyTier1 } from "./session.js";
import type { Tier1Month, Tier1Routing, Tier1State, Tier1Warming } from "./types.js";
import type { Tier1Mode } from "./bands.js";
import { runningFill } from "../index-job.js";

/** Where a credential comes from: `tier1.json` or an environment variable's name. Never its value. */
export type CredentialSources = Record<string, { set: boolean; from: string | null }>;

/** Where each credential comes from (never its value). */
export function credentialSources(resolved: ResolvedTier1, env: Record<string, string | undefined>): CredentialSources {
  if (resolved.state === "ready") {
    return Object.fromEntries(Object.entries(resolved.credentials.sources).map(([k, from]) => [k, { set: true, from }]));
  }
  if (resolved.state !== "no-credentials") return {};
  const out: CredentialSources = {};
  for (const [name, variable] of Object.entries(credentialEnv(resolved.config.provider))) {
    if (resolved.config.fileCredentials.includes(name)) out[name] = { set: true, from: "tier1.json" };
    else if (env[variable]) out[name] = { set: true, from: variable };
    else out[name] = { set: false, from: null };
  }
  return out;
}

/** This month's spend per source (`extract`, `index`, `classify`, `probe`), with the last time each spent. */
export type SpendBySource = Partial<Record<SpendSource, { cards: number; costUsd: number; lastAt: string }>>;

/** The month as the status views show it: with the share of the cap used, so clients don't compute it. */
export type Tier1StatusMonth = Tier1Month & {
  /** Spent as a percentage of the cap, 0 to 100 (capped at 100), to one decimal; null when the cap is 0. */
  percentUsed: number | null;
};

/** The share of the cap spent, 0 to 100 to one decimal, or null for a cap of 0 (nothing may be spent). */
export function percentUsed(month: Tier1Month): number | null {
  if (month.capUsd <= 0) return null;
  return Math.min(100, Math.round((1000 * month.spentUsd) / month.capUsd) / 10);
}

/** The `reason` of the `capped` state, for a person. */
export function cappedReason(month: Tier1Month): string {
  if (month.capUsd === 0) return "The monthly cap is $0.00: Tier 1 sends nothing and uses only cached answers. To let it ask: `dr analyzer tier1 set monthly-cap 20`.";
  return (
    `The ${formatUsd(month.capUsd)} monthly cap is reached; cached answers are still used until ${formatDay(month.resetsAt)} (UTC), when it resets. ` +
    `To raise it: \`dr analyzer tier1 set monthly-cap <dollars>\`.`
  );
}

export interface Tier1Status {
  /**
   * `on`, `warming` (on, while the `codebase_index` job fills the cache: `warming` has its
   * progress), `capped` (the month's cap is reached), or why it doesn't run: `off`,
   * `misconfigured`, `no-credentials`.
   */
  state: Exclude<Tier1State, "unavailable">;
  /** Why it isn't `on`: set for every other state, `capped` included. */
  reason?: string;
  analyzer: string;
  /** The opt-in file, relative to the project root. */
  config: string;
  provider?: string;
  model?: string;
  /** The provider's model id (`@cf/cloudflare/clef`). */
  modelId?: string;
  monthlyCapUsd?: number;
  concurrency?: number;
  /**
   * `stage` (codebase_extract stages the accept band and hides the not-element band without the
   * agent: the model's defaults are held-out verified and tier1.json leaves `mode` at auto) or
   * `suggest`; set whenever tier1.json names a known model.
   */
  mode?: Tier1Mode;
  /** Why {@link mode}. */
  modeReason?: string;
  /** OpenRouter: the upstreams allowed to receive card text, and the routing every request carries. */
  routing?: Tier1Routing;
  credentials: CredentialSources;
  month: Tier1StatusMonth;
  /** This month's spend by source, from the ledger (which records cards, not runs). */
  bySource: SpendBySource;
  cache: { entries: number; bytes: number; files: number; lastCompaction: string | null };
  /** Whether git ignores `.dr/` (null outside a git work tree). */
  dotDrIgnored: boolean | null;
  /** State `warming`: the index job's cache fill, as far as it has got. */
  warming?: Tier1Warming;
  warnings: string[];
}

export interface Tier1StatusOptions {
  codebaseRoot?: string;
  env?: Record<string, string | undefined>;
  git?: GitRunner;
  now?: () => number;
  /** Whether the index job's process is alive, for `warming` (tests). */
  isAlive?: (pid: number) => boolean;
}

/** The state a ready configuration shows: `capped` at the cap, `warming` while the index job fills the cache, else `on`. */
async function readyState(projectRoot: string, analyzer: string, month: Tier1Month, options: Tier1StatusOptions): Promise<{ state: "on" | "capped" | "warming"; warming?: Tier1Warming }> {
  if (isCapped(month)) return { state: "capped" };
  const warming = await runningFill(projectRoot, analyzer, options.isAlive ? { isAlive: options.isAlive } : {});
  return warming ? { state: "warming", warming } : { state: "on" };
}

/** The mode a configuration runs in, and why, when tier1.json names a model DR knows; else nothing. */
async function modeFields(resolved: ResolvedTier1): Promise<{ mode?: Tier1Mode; modeReason?: string }> {
  if (resolved.state !== "ready" && resolved.state !== "no-credentials") return {};
  const canonical = resolved.state === "ready" ? resolved.model.canonicalModel : resolveModel(resolved.config.provider, resolved.config.model)?.canonicalModel;
  if (!canonical) return {};
  const m = await resolveTier1Mode(resolved.config, canonical);
  return { mode: m.mode, modeReason: m.reason };
}

/** Git for the status views: a few quick read-only calls, each given up after 3 s. */
const statusGit = gitWithTimeout(3_000);

/**
 * Tier 1's status for a checkout. Reads files and runs git (at most three quick calls); never
 * sends a request and never writes, locks or deletes anything, so a process of another CLI
 * version (the visualization server's `GET /api/tier1`) can call it safely.
 */
export async function tier1Status(projectRoot: string, analyzer: string, options: Tier1StatusOptions = {}): Promise<Tier1Status> {
  const env = options.env ?? process.env;
  const git = options.git ?? statusGit;
  const resolved = await resolveTier1(projectRoot, analyzer, { env, git, ...(options.codebaseRoot ? { codebaseRoot: options.codebaseRoot } : {}) });
  const paths = resolved.paths;
  const config = resolved.state === "ready" || resolved.state === "no-credentials" ? resolved.config : null;
  let cap = config?.monthlyCapUsd ?? DEFAULT_MONTHLY_CAP_USD;
  if (!config && existsSync(paths.config)) {
    // A misconfigured file may still name a cap; never anything else from it.
    const raw = await readTier1File(paths).catch(() => null);
    if (raw && typeof raw.monthlyCapUsd === "number") cap = raw.monthlyCapUsd;
  }
  const now = options.now?.() ?? Date.now();
  // Through a symbolic link on `.dr`, `.dr/analyzers` or the analyzer's folder, the ledger and
  // cache could be anywhere: they aren't read (Tier 1 itself refuses the configuration then).
  const link = await symlinkOnPath(paths);
  const folderLink = link && path.resolve(paths.root, link) !== paths.config ? link : null;
  const ledger = new SpendLedger(paths.ledger, { now: () => now });
  const entries = folderLink ? [] : await ledger.entries();
  const spent = monthOfEntries(entries, cap, now);
  const month: Tier1StatusMonth = { ...spent, percentUsed: percentUsed(spent) };
  const bySource = spendBySource(entries, now);
  // peek, not status: a status view never discards, locks or writes a cache file.
  const cache = folderLink ? { files: 0, entries: 0, bytes: 0, lastCompaction: null } : await new Tier1Cache(paths.cache).peek();
  // git check-ignore: 0 ignored, 1 not ignored, anything else (128 outside a work tree, a timeout) unknown.
  const ignoredCheck = git(projectRoot, ["check-ignore", "-q", "--no-index", "--", paths.configRelative]);
  const dotDrIgnored = ignoredCheck?.status === 0 ? true : ignoredCheck?.status === 1 ? false : null;
  const ready = resolved.state === "ready" ? await readyState(projectRoot, analyzer, month, options) : null;
  const state = ready ? ready.state : (resolved.state as Exclude<typeof resolved.state, "ready">);
  return {
    state,
    ...(resolved.state !== "ready" ? { reason: resolved.reason } : state === "capped" ? { reason: cappedReason(month) } : {}),
    ...(ready?.warming ? { reason: warmingReason(ready.warming) } : {}),
    analyzer,
    config: paths.configRelative,
    ...(config
      ? {
          provider: config.provider,
          model: config.model,
          ...(resolved.state === "ready" ? { modelId: resolved.model.id } : {}),
          monthlyCapUsd: config.monthlyCapUsd,
          concurrency: config.concurrency,
          ...(await modeFields(resolved)),
          ...(routingOf(config) ? { routing: routingOf(config)! } : {}), // OpenRouter only
        }
      : {}),
    credentials: credentialSources(resolved, env),
    month,
    bySource,
    cache,
    dotDrIgnored,
    ...(ready?.warming ? { warming: ready.warming } : {}),
    warnings: [
      ...(resolved.state === "off" ? [] : resolved.warnings),
      ...(folderLink ? [`${folderLink} is a symbolic link, so the spend ledger and the cache were not read: replace it with a regular folder`] : []),
      ...(ledger.skipped ? [`${ledger.skipped} unreadable line(s) in the spend ledger were skipped`] : []),
      ...(dotDrIgnored === false ? [".dr/ is not git-ignored: run `dr init` or add /.dr/ to .gitignore"] : []),
    ],
  };
}

/** The `reason` of the `warming` state. */
export function warmingReason(w: Tier1Warming): string {
  return `the codebase_index job is filling the answer cache (${fillProgress(w)})`;
}

/** A fill's progress in words: `1,388 of 4,071 cards, about 8 min left, $1.94 so far`. */
export function fillProgress(w: Pick<Tier1Warming, "cards" | "etaSeconds" | "costUsd">): string {
  const progress = w.cards ? `${w.cards.done.toLocaleString("en-US")} of ${w.cards.total.toLocaleString("en-US")} cards` : "building the cards";
  const eta = w.etaSeconds !== undefined ? `, about ${w.etaSeconds < 90 ? `${w.etaSeconds} s` : `${Math.round(w.etaSeconds / 60)} min`} left` : "";
  return `${progress}${eta}, ${formatUsd(w.costUsd)} so far`;
}

/** How a person changes Tier 1 (never through a tool or the REST API), and what the spend counts. */
export const TIER1_STATUS_NOTE =
  "A person enables, changes and disables Tier 1 with `dr analyzer tier1 enable|set|disable` (no tool writes tier1.json); " +
  "`dr analyzer tier1 set monthly-cap <dollars>` changes the cap, and `dr analyzer tier1 set mode suggest` keeps Tier 1 from staging or hiding anything without the agent. " +
  "The spend counts this checkout only, not other clones or machines on the same account.";

/** What `tier1_status` and `GET /api/tier1` add to {@link Tier1Status}: the 80% flag and two sentences for a person. */
export interface Tier1StatusDescription {
  /** True at 80% of the cap or more, before it is reached (a cap of 0 never warns): the notice's warning state. */
  nearCap: boolean;
  /** One line: the state (and why), then this month's spend against the cap. */
  summary: string;
  /** How to change Tier 1 and what the spend counts. */
  note: string;
}

/** The flag and sentences `tier1_status` and `GET /api/tier1` add to a status. Holds nothing a status doesn't. */
export function describeTier1Status(status: Tier1Status): Tier1StatusDescription {
  const month = status.month;
  const warning = nearCapWarning(month);
  const alpha = status.provider ? alphaNotice(status.provider) : "";
  return {
    nearCap: nearCap(month) && !isCapped(month),
    summary:
      `Tier 1 is ${status.state}${status.reason ? ` (${status.reason})` : ""}. ` +
      (status.routing ? `Through OpenRouter, forwarded only to ${status.routing.only.join(", ")}. ` : "") +
      (status.mode
        ? status.mode === "stage"
          ? "Stage mode: codebase_extract stages the accept band and hides the not-element band without the agent (`dr analyzer tier1 set mode suggest` turns this off). "
          : "Suggest mode: nothing is staged or hidden without the agent. "
        : "") +
      `This month: ${formatUsd(month.spentUsd)} of the ${formatUsd(month.capUsd)} cap, ${formatUsd(month.remainingUsd)} left (${month.cards} card(s)), resets ${month.resetsAt.slice(0, 10)} (UTC).` +
      (warning ? ` ${warning}` : "") +
      (alpha ? ` ${alpha}` : ""),
    note: TIER1_STATUS_NOTE,
  };
}

/** The short form `project_status` shows (section 4.3): state, provider, model and the month's spend. */
export interface Tier1Brief {
  state: Tier1Status["state"];
  reason?: string;
  analyzer: string;
  provider?: string;
  model?: string;
  /** OpenRouter: the upstreams allowed to receive card text. */
  upstreams?: string[];
  /** `stage` or `suggest`, when tier1.json names a model DR knows (see {@link Tier1Status.mode}). */
  mode?: Tier1Mode;
  /** Absent while Tier 1 is off and nothing was spent this month. */
  month?: Tier1Month;
  /** State `warming`: the index job's cache fill, as far as it has got. */
  warming?: Tier1Warming;
}

/** Tier 1 in brief, for `project_status`. Reads files and runs git; never sends a request. */
export async function tier1Brief(projectRoot: string, analyzer: string, options: Tier1StatusOptions = {}): Promise<Tier1Brief> {
  const resolved = await resolveTier1(projectRoot, analyzer, {
    env: options.env ?? process.env,
    git: options.git ?? statusGit,
    ...(options.codebaseRoot ? { codebaseRoot: options.codebaseRoot } : {}),
  });
  const config = resolved.state === "ready" || resolved.state === "no-credentials" ? resolved.config : null;
  const month = await new SpendLedger(resolved.paths.ledger, options.now ? { now: options.now } : {}).month(config?.monthlyCapUsd ?? DEFAULT_MONTHLY_CAP_USD);
  const mode = await modeFields(resolved);
  const ready = resolved.state === "ready" ? await readyState(projectRoot, analyzer, month, options) : null;
  const state = ready ? ready.state : (resolved.state as Exclude<typeof resolved.state, "ready">);
  return {
    state,
    ...(resolved.state !== "ready" ? { reason: resolved.reason } : state === "capped" ? { reason: cappedReason(month) } : {}),
    ...(ready?.warming ? { reason: warmingReason(ready.warming) } : {}),
    analyzer,
    ...(config ? { provider: config.provider, model: config.model, ...(routingOf(config) ? { upstreams: routingOf(config)!.only } : {}) } : {}),
    ...(mode.mode ? { mode: mode.mode } : {}),
    ...(state !== "off" || month.spentUsd > 0 ? { month } : {}),
    ...(ready?.warming ? { warming: ready.warming } : {}),
  };
}

/** This month's spend against the cap from the ledger's entries (one read serves this and {@link spendBySource}). */
function monthOfEntries(entries: SpendEntry[], cap: number, now: number): Tier1Month {
  const { start, end } = monthWindow(now);
  let spent = 0;
  let cards = 0;
  for (const e of entries) {
    const at = Date.parse(e.at);
    if (at >= start && at < end) {
      spent += e.costUsd;
      cards += e.cards;
    }
  }
  return monthOf(spent, cap, cards, end);
}

function spendBySource(entries: SpendEntry[], now: number): SpendBySource {
  const { start, end } = monthWindow(now);
  const out: SpendBySource = {};
  for (const e of entries) {
    const at = Date.parse(e.at);
    if (at < start || at >= end) continue;
    const s = (out[e.source] ??= { cards: 0, costUsd: 0, lastAt: e.at });
    s.cards += e.cards;
    s.costUsd = Math.round((s.costUsd + e.costUsd) * 1e6) / 1e6;
    if (e.at > s.lastAt) s.lastAt = e.at;
  }
  return out;
}

/**
 * The upstreams a configuration's probes are pinned to: one probe per upstream in OpenRouter's
 * `only` (section 2.4), else a single unpinned probe (`[undefined]`).
 */
export function probeTargets(session: Pick<ReadyTier1, "routing">): Array<string | undefined> {
  return session.routing ? [...session.routing.only] : [undefined];
}

/** What the configuration's probes are expected to cost together. */
export function probesCostEstimate(session: Pick<ReadyTier1, "routing" | "model">): number {
  return probeCostEstimate(session.model) * probeTargets(session).length;
}

/** Whether the month's remainder covers the probes' estimated cost (not only whether the cap is reached). */
export function probeAffordable(session: ReadyTier1): boolean {
  return !isCapped(session.month) && session.month.remainingUsd >= probesCostEstimate(session);
}

/** Send one probe through a ready configuration, pinned to `upstream` when given, and record its cost as `probe`. Never throws for the provider's failure. */
export async function runProbe(session: ReadyTier1, spec?: SpecCriteria, upstream?: string): Promise<ProbeResult> {
  const probe = await probeTier1(session.model, spec ?? (await loadSpecCriteria()), { qset: session.qset, ...(upstream ? { upstream } : {}) });
  if (probe.costUsd > 0 || probe.inputTokens > 0) {
    await session.ledger.record({
      source: "probe",
      provider: session.model.id.provider,
      model: session.model.id.model,
      // The ledger's upstream is always what the response named (never the pinned slug).
      ...(probe.upstream ? { upstream: probe.upstream } : {}),
      cards: 1,
      inputTokens: probe.inputTokens,
      costUsd: probe.costUsd,
    });
  }
  return probe;
}

/**
 * The configuration test (section 2.4): through OpenRouter one probe per allowed upstream, each
 * pinned to it, one after another so they can be compared; else the single probe.
 */
export async function runProbes(session: ReadyTier1, spec?: SpecCriteria): Promise<ProbeResult[]> {
  const criteria = spec ?? (await loadSpecCriteria());
  const out: ProbeResult[] = [];
  for (const upstream of probeTargets(session)) out.push(await runProbe(session, criteria, upstream));
  return out;
}
