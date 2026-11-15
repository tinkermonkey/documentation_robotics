/**
 * The cache fill in the `codebase_index` job (TIER1_DESIGN.md section 4.4, decision 7): after the
 * index, when the checkout opted in and Tier 1 is ready, the job's `classifying` phase runs
 * `dr analyzer classify`'s Tier-1 pass over every Tier-0-undecided card (`classifyReportWithTier1`,
 * the same code, with ledger source `index`), filling the cache within the month's cap, so a
 * following `codebase_extract` answers from the cache.
 *
 * - Not opted in (no `tier1.json`): returns null at once; nothing is read beyond the opt-in, no
 *   model is built and nothing is sent, so the job's output is as before.
 * - Opted in but not ready (misconfigured, no credentials, the cap already reached): `skipped`,
 *   with the reason; nothing is sent.
 * - Never stages anything, writes a changeset or the model. A provider failure, the cap or the
 *   circuit breaker ends it as `stopped`; a cancelled job as `cancelled`; an error of DR's own as
 *   `failed`. None of them fails the index, which is done before the fill starts.
 * - What it reports (the job record, the log) holds no key, account id or notice naming one: the
 *   provider and the provider's model id only.
 */
import type { ClassifyReport } from "../cards/classify.js";
import { classifyReportWithTier1 } from "./classify-run.js";
import type { SpecCriteria } from "./criteria.js";
import { askSeconds } from "./run.js";
import { openTier1, providerDisplayName, type OpenTier1Options } from "./session.js";
import { formatUsd } from "./config.js";
import { isCapped } from "./spend.js";
import { cappedReason } from "./status.js";
import type { Tier1Fill } from "./types.js";

export interface RunIndexFillOptions {
  projectRoot: string;
  analyzer: string;
  codebaseRoot?: string;
  /** Tier 0 over every card, with the cards (the analyzer's `classify`). */
  classify: () => Promise<ClassifyReport>;
  /** The job's cancellation: nothing more is asked, and what was asked stays cached and recorded. */
  signal?: AbortSignal;
  /** Tests: a fake model and an empty environment. */
  open?: OpenTier1Options;
  spec?: SpecCriteria;
  /** Called with the fill as it goes: at its start, every `updateEveryMs` while it runs, and at its end. */
  onUpdate?: (fill: Tier1Fill) => void | Promise<void>;
  /** Lines for the job log. Never handed a key or an account id. */
  log?: (line: string) => void;
  /** Least time between `onUpdate` calls while cards are asked; default 2 s. */
  updateEveryMs?: number;
  /** Run id of the classify output; default a timestamp. */
  runId?: string;
}

const isoNow = () => new Date().toISOString();

/**
 * Fill the Tier-1 cache for the index job. Null when the checkout hasn't opted in. Never throws:
 * whatever happens, the returned fill says so.
 */
export async function runIndexFill(options: RunIndexFillOptions): Promise<Tier1Fill | null> {
  const log = options.log ?? (() => undefined);
  const startedAt = isoNow();
  const t0 = Date.now();
  let fill: Tier1Fill | null = null;
  // Updates are written one after another, so a late progress write can't land after the last one.
  let written: Promise<void> = Promise.resolve();
  const update = (patch: Partial<Tier1Fill>): Promise<void> => {
    fill = { ...(fill as Tier1Fill), ...patch, updatedAt: isoNow() };
    const snapshot = fill;
    written = written.then(async () => {
      try {
        await options.onUpdate?.(snapshot);
      } catch {
        // The record couldn't be written this time: the next update tries again.
      }
    });
    return written;
  };
  const finish = async (patch: Partial<Tier1Fill>) => {
    if (fill) delete fill.etaSeconds;
    await update({ ...patch, finishedAt: isoNow(), durationMs: Date.now() - t0 });
    return fill as Tier1Fill;
  };

  let session;
  try {
    session = await openTier1(options.projectRoot, options.analyzer, { ...(options.codebaseRoot ? { codebaseRoot: options.codebaseRoot } : {}), ...(options.open ?? {}) });
  } catch (e) {
    fill = blank(startedAt);
    log(`Tier 1 cache fill: failed to read the opt-in: ${message(e)}`);
    return finish({ state: "failed", reason: `the opt-in could not be read: ${message(e)}` });
  }
  if (session.state === "off") return null;
  if (session.state !== "ready") {
    fill = blank(startedAt);
    log(`Tier 1 cache fill skipped: Tier 1 is ${session.state} (${session.block.reason ?? ""}).`);
    return finish({ state: "skipped", reason: `Tier 1 is ${session.state}: ${session.block.reason ?? ""}` });
  }

  const provider = session.config.provider;
  const model = session.model.id.model;
  fill = { ...blank(startedAt), provider, model };
  if (isCapped(session.month)) {
    log(`Tier 1 cache fill skipped: the monthly cap is reached (${formatUsd(session.month.spentUsd)} of ${formatUsd(session.month.capUsd)}).`);
    return finish({ state: "skipped", stoppedBy: "cap", reason: cappedReason(session.month), month: session.month });
  }

  await update({ state: "running" });
  log(`Tier 1 cache fill (${providerDisplayName(provider)}, ${model}): building the cards Tier 0 leaves undecided...`);
  try {
    const report = await options.classify();
    if (options.signal?.aborted) {
      log("Tier 1 cache fill cancelled before any card was asked.");
      return finish({ state: "cancelled", stoppedBy: "cancelled", reason: "the index job was stopped" });
    }
    const concurrency = session.config.concurrency;
    let firstSendAt: number | null = null;
    let lastUpdate = 0;
    const every = options.updateEveryMs ?? 2000;
    const out = await classifyReportWithTier1(report, session, {
      projectRoot: options.projectRoot,
      full: true,
      includeCards: false,
      source: "index",
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.spec ? { spec: options.spec } : {}),
      ...(options.runId ? { runId: options.runId } : {}),
      onBeforeSend: (cards, estimate) => {
        firstSendAt = Date.now();
        const est = { misses: estimate.misses, cards, costUsd: round4(cards * estimate.perCardUsd), seconds: askSeconds(cards, concurrency) };
        fill = { ...(fill as Tier1Fill), estimate: est, etaSeconds: est.seconds };
        log(
          `Tier 1 cache fill: ${estimate.misses} card(s) have no cached answer; asking up to ${cards} of ${providerDisplayName(provider)} (${model}), ` +
            `about ${formatUsd(est.costUsd)} and ${est.seconds} s. ${session.resolved.paths.configRelative} enables Tier 1.`
        );
      },
      onProgress: (done, total, sofar) => {
        const now = Date.now();
        const asked = sofar.sent + sofar.failed;
        const est = (fill as Tier1Fill).estimate;
        // Seconds left: from the rate so far once cards have been asked, else the estimate.
        const left = est ? Math.max(0, est.cards - asked) : 0;
        const etaSeconds =
          firstSendAt !== null && asked > 0 ? Math.ceil(((now - firstSendAt) / asked) * left / 1000) : est ? askSeconds(left, concurrency) : undefined;
        fill = {
          ...(fill as Tier1Fill),
          cards: { done, total },
          asked,
          cached: sofar.cached,
          sent: sofar.sent,
          failed: sofar.failed,
          skipped: sofar.skipped,
          costUsd: round6(sofar.costUsd),
          ...(etaSeconds !== undefined ? { etaSeconds } : {}),
        };
        if (now - lastUpdate >= every || done === total) {
          lastUpdate = now;
          void update({});
        }
      },
    });
    const t = out.tier1;
    const done = (t.cached ?? 0) + (t.sent ?? 0) + (t.failed ?? 0) + (t.skipped ?? 0);
    const numbers: Partial<Tier1Fill> = {
      cards: { done, total: t.cards ?? done },
      asked: (t.sent ?? 0) + (t.failed ?? 0),
      cached: t.cached ?? 0,
      sent: t.sent ?? 0,
      failed: t.failed ?? 0,
      skipped: t.skipped ?? 0,
      costUsd: t.costUsd ?? 0,
      ...(t.month ? { month: t.month } : {}),
      ...(out.run ? { run: out.run } : {}),
    };
    const summary = `${numbers.asked} asked (${numbers.sent} answered and cached, ${numbers.failed} failed), ${numbers.cached} already cached, ${numbers.skipped} not asked; ${formatUsd(numbers.costUsd ?? 0)} spent`;
    if (options.signal?.aborted) {
      log(`Tier 1 cache fill cancelled: ${summary}.`);
      return finish({ ...numbers, state: "cancelled", stoppedBy: "cancelled", reason: "the index job was stopped; what was asked is cached" });
    }
    if (t.state === "capped") {
      log(`Tier 1 cache fill stopped at the monthly cap: ${summary}.`);
      return finish({ ...numbers, state: "stopped", stoppedBy: "cap", reason: t.month ? cappedReason(t.month) : "the monthly cap is reached" });
    }
    if (t.state === "unavailable") {
      log(`Tier 1 cache fill stopped, the provider is unavailable (${t.reason ?? ""}): ${summary}.`);
      return finish({ ...numbers, state: "stopped", stoppedBy: "unavailable", reason: `the provider is unavailable: ${t.reason ?? ""}` });
    }
    log(`Tier 1 cache fill done: ${summary}.`);
    return finish({ ...numbers, state: "done" });
  } catch (e) {
    if (options.signal?.aborted) {
      log("Tier 1 cache fill cancelled.");
      return finish({ state: "cancelled", stoppedBy: "cancelled", reason: "the index job was stopped; what was asked is cached" });
    }
    log(`Tier 1 cache fill failed: ${message(e)}`);
    return finish({ state: "failed", reason: message(e) });
  }
}

function blank(startedAt: string): Tier1Fill {
  return { state: "running", startedAt, updatedAt: startedAt, finishedAt: null, cards: null, asked: 0, cached: 0, sent: 0, failed: 0, skipped: 0, costUsd: 0 };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
