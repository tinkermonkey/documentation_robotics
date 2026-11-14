/**
 * `dr analyzer classify` with Tier 1 (TIER1_DESIGN.md section 1.2): Tier 0's report in, every
 * Tier-0-undecided card (no rule, or a narrowing one) classified by Tier 1, the report out with a
 * `tier1` block and each asked result's decision and band. Run output goes under
 * `.dr/analyzers/<analyzer>/classify/<run-id>/` (`decisions.jsonl`, `summary.json`). It never
 * writes a changeset. A run over every card (no filter) compacts the cache at its end.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ClassifyReport, ClassifyResult } from "../cards/classify.js";
import { loadSpecCriteria, type SpecCriteria } from "./criteria.js";
import { classifyTier1, type Tier1Item } from "./run.js";
import { blockOfRun, openTier1, type OpenTier1Options, type ReadyTier1, type Tier1Session } from "./session.js";
import type { Tier1Block, Tier1Decision } from "./types.js";

/** Classify runs kept under `classify/`; older ones are removed. */
export const KEEP_RUNS = 20;

export type Tier1ClassifyResult = ClassifyResult & { tier1?: Tier1Decision };

export type Tier1ClassifyReport = Omit<ClassifyReport, "mode" | "results"> & {
  mode: "tier0" | "tier0+tier1";
  tier1: Tier1Block;
  /** The run's output folder, relative to the project root, when Tier 1 ran. */
  run?: string;
  results: Tier1ClassifyResult[];
};

export interface ClassifyTier1RunOptions {
  projectRoot: string;
  /** Every card was classified (no `--file`, `--label`, `--exclude` or `--limit`): compact the cache after. */
  full: boolean;
  /** Keep each result's card in the report (`--cards`). */
  includeCards: boolean;
  deadlineAt?: number;
  spec?: SpecCriteria;
  onBeforeSend?: (cards: number) => void;
  onProgress?: (done: number, total: number) => void;
  /** Run id; default a UTC timestamp and a random suffix. */
  runId?: string;
}

/**
 * Tier 1 for `dr analyzer classify`: null with `--tier0-only`, which then reads no `tier1.json`,
 * builds no model and touches no network; otherwise the opened session (ready or not).
 */
export async function tier1ForClassify(projectRoot: string, analyzer: string, options: OpenTier1Options & { tier0Only: boolean }): Promise<Tier1Session | null> {
  const { tier0Only, ...open } = options;
  return tier0Only ? null : openTier1(projectRoot, analyzer, open);
}

/** Whether Tier 1 is asked about a Tier-0 result: no rule matched, or a rule only narrowed it. */
export function asksTier1(result: ClassifyResult): boolean {
  return result.tier0 === null || result.tier0.kind === "narrow";
}

export function newRunId(now: number = Date.now()): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${stamp}-${Math.random().toString(16).slice(2, 6)}`;
}

/** Run Tier 1 over a Tier-0 report built with cards. Never throws for a provider's failure. */
export async function classifyReportWithTier1(report: ClassifyReport, session: ReadyTier1, options: ClassifyTier1RunOptions): Promise<Tier1ClassifyReport> {
  const items: Tier1Item[] = [];
  for (const r of report.results) {
    if (!asksTier1(r)) continue;
    if (!r.card) throw new Error("Tier 1 needs the cards: build the Tier-0 report with includeCards");
    items.push({ id: r.card_id, card: r.card, ...(r.tier0?.kind === "narrow" ? { narrow: r.tier0.candidates } : {}) });
  }
  const spec = options.spec ?? (await loadSpecCriteria());
  const result = await classifyTier1(items, {
    model: session.model,
    spec,
    host: session.host,
    qset: session.qset,
    cache: session.cache,
    thresholds: session.thresholds,
    concurrency: session.config.concurrency,
    remainingUsd: session.month.remainingUsd,
    capUsd: session.config.monthlyCapUsd,
    ledger: session.ledger,
    source: "classify",
    ...(spec.specVersion ? { specVersion: spec.specVersion } : {}),
    ...(options.deadlineAt !== undefined ? { deadlineAt: options.deadlineAt } : {}),
    ...(options.onBeforeSend ? { onBeforeSend: options.onBeforeSend } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  const warnings = [...result.warnings];
  if (options.full) {
    const compaction = await session.cache.compact({
      currentQset: session.qset,
      configured: { host: session.host, model: session.model.id.canonicalModel },
      usedKeys: result.usedKeys,
    });
    await session.cache.recordCompaction(compaction);
  }
  const month = await session.ledger.month(session.config.monthlyCapUsd);
  const block = blockOfRun(session, result.stats, month, warnings);

  const results: Tier1ClassifyResult[] = report.results.map((r) => {
    const { card, ...rest } = r;
    const decision = result.decisions.get(r.card_id);
    return { ...(options.includeCards && card ? { ...rest, card } : rest), ...(decision ? { tier1: decision } : {}) };
  });

  const runId = options.runId ?? newRunId();
  const runDir = path.join(session.resolved.paths.runs, runId);
  const out: Tier1ClassifyReport = { ...report, mode: "tier0+tier1", tier1: block, run: path.relative(options.projectRoot, runDir), results };
  try {
    await writeRun(runDir, out);
    await pruneRuns(session.resolved.paths.runs, KEEP_RUNS);
  } catch (e) {
    (block.warnings ??= []).push(`The run's output could not be written to ${out.run}: ${e instanceof Error ? e.message : String(e)}`);
    delete out.run;
  }
  return out;
}

async function writeRun(dir: string, report: Tier1ClassifyReport): Promise<void> {
  await mkdir(dir, { recursive: true });
  const lines = report.results
    .filter((r) => r.tier1)
    .map((r) =>
      JSON.stringify({
        card_id: r.card_id,
        label: r.label,
        qualified_name: r.qualified_name,
        file_path: r.file_path,
        tier0: r.tier0 ? { kind: r.tier0.kind, rule: r.tier0.rule } : null,
        ...r.tier1,
      })
    );
  await writeFile(path.join(dir, "decisions.jsonl"), lines.length ? lines.join("\n") + "\n" : "", "utf8");
  await writeFile(path.join(dir, "summary.json"), JSON.stringify({ ...report, results: undefined }, null, 2) + "\n", "utf8");
}

/** Keep the newest `keep` run folders (run ids sort by time). */
async function pruneRuns(runsDir: string, keep: number): Promise<void> {
  const dirs = (await readdir(runsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const old of dirs.slice(0, Math.max(0, dirs.length - keep))) await rm(path.join(runsDir, old), { recursive: true, force: true });
}
