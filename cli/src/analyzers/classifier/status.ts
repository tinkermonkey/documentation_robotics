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
import { credentialEnv } from "./decision-model/registry.js";
import { probeCostEstimate, probeTier1, type ProbeResult } from "./decision-model/probe.js";
import { loadSpecCriteria, type SpecCriteria } from "./criteria.js";
import { Tier1Cache } from "./cache.js";
import { formatDay, isCapped, monthOf, monthWindow, nearCap, nearCapWarning, SpendLedger, type SpendEntry, type SpendSource } from "./spend.js";
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
  /** `on`, `capped` (the month's cap is reached), or why it doesn't run: `off`, `misconfigured`, `no-credentials`. */
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
  credentials: CredentialSources;
  month: Tier1StatusMonth;
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
  const state = resolved.state === "ready" ? (isCapped(month) ? "capped" : "on") : resolved.state;
  return {
    state,
    ...(resolved.state !== "ready" ? { reason: resolved.reason } : state === "capped" ? { reason: cappedReason(month) } : {}),
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
    cache,
    dotDrIgnored,
    warnings: [
      ...(resolved.state === "off" ? [] : resolved.warnings),
      ...(folderLink ? [`${folderLink} is a symbolic link, so the spend ledger and the cache were not read: replace it with a regular folder`] : []),
      ...(ledger.skipped ? [`${ledger.skipped} unreadable line(s) in the spend ledger were skipped`] : []),
      ...(dotDrIgnored === false ? [".dr/ is not git-ignored: run `dr init` or add /.dr/ to .gitignore"] : []),
    ],
  };
}

/** How a person changes Tier 1 (never through a tool or the REST API), and what the spend counts. */
export const TIER1_STATUS_NOTE =
  "A person enables, changes and disables Tier 1 with `dr analyzer tier1 enable|set|disable` (no tool writes tier1.json); " +
  "`dr analyzer tier1 set monthly-cap <dollars>` changes the cap. " +
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
  return {
    nearCap: nearCap(month) && !isCapped(month),
    summary:
      `Tier 1 is ${status.state}${status.reason ? ` (${status.reason})` : ""}. ` +
      `This month: ${formatUsd(month.spentUsd)} of the ${formatUsd(month.capUsd)} cap, ${formatUsd(month.remainingUsd)} left (${month.cards} card(s)), resets ${month.resetsAt.slice(0, 10)} (UTC).` +
      (warning ? ` ${warning}` : ""),
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
  /** Absent while Tier 1 is off and nothing was spent this month. */
  month?: Tier1Month;
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
  const state = resolved.state === "ready" ? (isCapped(month) ? "capped" : "on") : resolved.state;
  return {
    state,
    ...(resolved.state !== "ready" ? { reason: resolved.reason } : state === "capped" ? { reason: cappedReason(month) } : {}),
    analyzer,
    ...(config ? { provider: config.provider, model: config.model } : {}),
    ...(state !== "off" || month.spentUsd > 0 ? { month } : {}),
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
