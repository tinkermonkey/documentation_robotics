/**
 * Where Tier 1 stands for a checkout (TIER1_DESIGN.md sections 2.4 and 4.3): the opt-in's state,
 * provider and model, where each key comes from (never its value), this month's spend against the
 * cap, the cache and the ledger's spend by source; and the probe (a fixed synthetic card, no
 * project code) with its spend recorded. `dr analyzer tier1 status|test`, the `tier1_status` MCP
 * tool and `project_status` read it from here, so they say the same thing. Nothing here writes
 * `tier1.json`, and no result holds a key.
 */
import { existsSync } from "node:fs";
import { DEFAULT_MONTHLY_CAP_USD, defaultGit, readTier1File, resolveTier1, type GitRunner, type ResolvedTier1 } from "./config.js";
import { credentialEnv } from "./decision-model/registry.js";
import { probeCostEstimate, probeTier1, type ProbeResult } from "./decision-model/probe.js";
import { loadSpecCriteria, type SpecCriteria } from "./criteria.js";
import { Tier1Cache } from "./cache.js";
import { isCapped, SpendLedger, type SpendSource } from "./spend.js";
import type { ReadyTier1 } from "./session.js";
import type { Tier1Month, Tier1State } from "./types.js";

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

export interface Tier1Status {
  /** `on`, `capped` (the month's cap is reached), or why it doesn't run: `off`, `misconfigured`, `no-credentials`. */
  state: Exclude<Tier1State, "unavailable">;
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
  credentials: CredentialSources;
  month: Tier1Month;
  /** This month's spend by source, from the ledger (which records cards, not runs). */
  bySource: SpendBySource;
  cache: { entries: number; bytes: number; files: number; lastCompaction: string | null };
  /** Whether git ignores `.dr/` (null outside a git work tree). */
  dotDrIgnored: boolean | null;
  warnings: string[];
}

export interface Tier1StatusOptions {
  codebaseRoot?: string;
  env?: Record<string, string | undefined>;
  git?: GitRunner;
  now?: () => number;
}

/** Tier 1's status for a checkout. Reads files and runs git; never sends a request. */
export async function tier1Status(projectRoot: string, analyzer: string, options: Tier1StatusOptions = {}): Promise<Tier1Status> {
  const env = options.env ?? process.env;
  const git = options.git ?? defaultGit;
  const resolved = await resolveTier1(projectRoot, analyzer, { env, git, ...(options.codebaseRoot ? { codebaseRoot: options.codebaseRoot } : {}) });
  const paths = resolved.paths;
  const config = resolved.state === "ready" || resolved.state === "no-credentials" ? resolved.config : null;
  let cap = config?.monthlyCapUsd ?? DEFAULT_MONTHLY_CAP_USD;
  if (!config && existsSync(paths.config)) {
    // A misconfigured file may still name a cap; never anything else from it.
    const raw = await readTier1File(paths).catch(() => null);
    if (raw && typeof raw.monthlyCapUsd === "number") cap = raw.monthlyCapUsd;
  }
  const ledger = new SpendLedger(paths.ledger, options.now ? { now: options.now } : {});
  const month = await ledger.month(cap);
  const bySource = await spendBySource(ledger, options.now?.() ?? Date.now());
  const cache = await new Tier1Cache(paths.cache).status();
  const ignoredCheck = git(projectRoot, ["check-ignore", "-q", "--no-index", "--", paths.configRelative]);
  const dotDrIgnored = ignoredCheck ? ignoredCheck.status === 0 : null;
  const state = resolved.state === "ready" ? (isCapped(month) ? "capped" : "on") : resolved.state;
  return {
    state,
    ...(resolved.state !== "ready" ? { reason: resolved.reason } : {}),
    analyzer,
    config: paths.configRelative,
    ...(config
      ? {
          provider: config.provider,
          model: config.model,
          ...(resolved.state === "ready" ? { modelId: resolved.model.id } : {}),
          monthlyCapUsd: config.monthlyCapUsd,
          concurrency: config.concurrency,
        }
      : {}),
    credentials: credentialSources(resolved, env),
    month,
    bySource,
    cache: { entries: cache.entries, bytes: cache.bytes, files: cache.files.length, lastCompaction: cache.lastCompaction?.at ?? null },
    dotDrIgnored,
    warnings: [
      ...(resolved.state === "off" ? [] : resolved.warnings),
      ...(ledger.skipped ? [`${ledger.skipped} unreadable line(s) in the spend ledger were skipped`] : []),
      ...(dotDrIgnored === false ? [".dr/ is not git-ignored: run `dr init` or add /.dr/ to .gitignore"] : []),
    ],
  };
}

/** The short form `project_status` shows (section 4.3): state, provider, model and the month's spend. */
export interface Tier1Brief {
  state: Tier1Status["state"];
  reason?: string;
  analyzer: string;
  provider?: string;
  model?: string;
  /** Absent while Tier 1 is off and nothing was spent this month. */
  month?: Tier1Month;
}

/** Tier 1 in brief, for `project_status`. Reads files and runs git; never sends a request. */
export async function tier1Brief(projectRoot: string, analyzer: string, options: Tier1StatusOptions = {}): Promise<Tier1Brief> {
  const resolved = await resolveTier1(projectRoot, analyzer, {
    env: options.env ?? process.env,
    ...(options.git ? { git: options.git } : {}),
    ...(options.codebaseRoot ? { codebaseRoot: options.codebaseRoot } : {}),
  });
  const config = resolved.state === "ready" || resolved.state === "no-credentials" ? resolved.config : null;
  const month = await new SpendLedger(resolved.paths.ledger, options.now ? { now: options.now } : {}).month(config?.monthlyCapUsd ?? DEFAULT_MONTHLY_CAP_USD);
  const state = resolved.state === "ready" ? (isCapped(month) ? "capped" : "on") : resolved.state;
  return {
    state,
    ...(resolved.state !== "ready" ? { reason: resolved.reason } : {}),
    analyzer,
    ...(config ? { provider: config.provider, model: config.model } : {}),
    ...(state !== "off" || month.spentUsd > 0 ? { month } : {}),
  };
}

async function spendBySource(ledger: SpendLedger, now: number): Promise<SpendBySource> {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const out: SpendBySource = {};
  for (const e of await ledger.entries()) {
    if (Date.parse(e.at) < start) continue;
    const s = (out[e.source] ??= { cards: 0, costUsd: 0, lastAt: e.at });
    s.cards += e.cards;
    s.costUsd = Math.round((s.costUsd + e.costUsd) * 1e6) / 1e6;
    if (e.at > s.lastAt) s.lastAt = e.at;
  }
  return out;
}

/** Whether the month's remainder covers the probe's estimated cost (not only whether the cap is reached). */
export function probeAffordable(session: ReadyTier1): boolean {
  return !isCapped(session.month) && session.month.remainingUsd >= probeCostEstimate(session.model);
}

/** Send the probe through a ready configuration and record its cost as `probe`. Never throws for the provider's failure. */
export async function runProbe(session: ReadyTier1, spec?: SpecCriteria): Promise<ProbeResult> {
  const probe = await probeTier1(session.model, spec ?? (await loadSpecCriteria()), { qset: session.qset });
  if (probe.costUsd > 0 || probe.inputTokens > 0) {
    await session.ledger.record({
      source: "probe",
      provider: session.model.id.provider,
      model: session.model.id.model,
      ...(probe.upstream ? { upstream: probe.upstream } : {}),
      cards: 1,
      inputTokens: probe.inputTokens,
      costUsd: probe.costUsd,
    });
  }
  return probe;
}
