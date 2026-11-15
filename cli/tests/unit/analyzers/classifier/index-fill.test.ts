/**
 * The cache fill in the codebase_index job (TIER1_DESIGN.md section 4.4): `runIndexFill` (the
 * `classifying` phase, the same pass as `dr analyzer classify`), its record in the job
 * (`runIndexJobFill`, `recordIndexJobFill`), how a running fill reads (`fillRunning`,
 * `runningFill`, a dead process), a new run taking over from a running fill, and `warming` in the
 * status views (`tier1Status`, `tier1Brief`).
 *
 * No network: a FakeDecisionModel through `createModel`, an empty environment and fake keys in
 * tier1.json; every record, log line and status is checked for them.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ClassifyReport, ClassifyResult } from "../../../../src/analyzers/cards/classify.js";
import {
  classifyTier1,
  openTier1,
  runIndexFill,
  SpendLedger,
  specCriteriaFromLayers,
  tier1Brief,
  tier1Paths,
  tier1Status,
  type AskOptions,
  type AskResult,
  type LayerInfo,
  type Narrowing,
  type Question,
  type StateCard,
  type Tier1Fill,
} from "../../../../src/analyzers/classifier/index.js";
import {
  finishIndexJob,
  fillRunning,
  indexJobPath,
  readIndexJob,
  runningFill,
  startIndexJob,
  type SpawnFn,
} from "../../../../src/analyzers/index-job.js";
import { runIndexJobFill, tier1FillMarker } from "../../../../src/analyzers/index-job-fill.js";
import { choiceAnswer, FakeDecisionModel } from "../../../helpers/fake-decision-model.js";

const FIXTURES = path.join(import.meta.dir, "../../../fixtures/classifier/dr-qset-1");
const snapshot = JSON.parse(readFileSync(path.join(FIXTURES, "spec-snapshot.json"), "utf8")) as { layers: LayerInfo[] };
const spec = specCriteriaFromLayers(snapshot.layers);
const fixtureCards = readFileSync(path.join(FIXTURES, "cards.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as { card: StateCard & { id: string; corpus?: string }; narrow: Narrowing | null; tier0_rule: string | null });

const FAKE_ACCOUNT = "acct-fill-00009c1e";
const FAKE_TOKEN = "tok-SECRET-index-fill";
const RESULT = { node_count: 120, edge_count: 340, git_head: "abc123", timestamp: "2026-11-15T12:00:00.000Z" };
const DR = { command: "/usr/bin/node", args: ["/opt/dr/dist/cli.js"] };

const stage1 = (layer: string, p = 0.8) => ({
  layer: choiceAnswer(layer, p),
  significance: { score: 2 },
  concern_authentication: { noul: 0.01 },
  concern_authorization: { noul: 0.01 },
  concern_data_persistence: { noul: 0.7 },
  concern_external_integration: { noul: 0.01 },
  concern_observability: { noul: 0.01 },
  concern_user_interface: { noul: 0.01 },
});
const accepting = () =>
  new FakeDecisionModel().answer("*", {
    ...stage1("application"),
    element_type: (q: Question) => {
      const keys = q.type === "choice" ? Object.keys(q.criteria).filter((k) => k !== "none") : [];
      return choiceAnswer(keys[0] ?? "none", 0.6)(q);
    },
  });

/** A model whose every request waits until the run is cancelled. */
class HangingModel extends FakeDecisionModel {
  override async ask(state: string, questions: Record<string, Question>, options: AskOptions = {}): Promise<AskResult> {
    this.calls.push({ state, stateHash: "", questions, options });
    return new Promise<AskResult>((_resolve, reject) => {
      const fail = () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
      if (options.signal?.aborted) return fail();
      options.signal?.addEventListener("abort", fail);
    });
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "dr-tier1-fill-"));
  dirs.push(d);
  return d;
}

/** Opt the checkout in with fake keys in the file (mode 0600). */
function optIn(root: string, extra: Record<string, unknown> = {}): void {
  const file = tier1Paths(root, "cbm").config;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ version: 1, provider: "cloudflare-workers-ai", model: "clef", credentials: { accountId: FAKE_ACCOUNT, apiToken: FAKE_TOKEN }, ...extra }),
    { mode: 0o600 }
  );
}

/** Tier 0's report over the fixture cards: one decided, one rejected, the rest for Tier 1. */
function report(n = 8): ClassifyReport {
  const facts = { decorators: [], decorator_names: [], file_importers: 0, methods: 0, usage_files: 0 };
  const results: ClassifyResult[] = fixtureCards.slice(0, n).map((c, i) => {
    const { id, corpus: _corpus, ...card } = c.card;
    void _corpus;
    const tier0 =
      i === 0
        ? { kind: "decide" as const, layer: "application", type: "applicationcomponent", rule: "r-decide", confidence: "high" as const }
        : i === 1
          ? { kind: "reject" as const, rule: "r-reject", confidence: "high" as const }
          : c.narrow
            ? { kind: "narrow" as const, candidates: c.narrow, rule: c.tier0_rule ?? "r-narrow", confidence: "medium" as const }
            : null;
    return { card_id: id, label: card.label, name: card.name, qualified_name: card.qualified_name, file_path: card.file_path, start_line: card.start_line, end_line: card.end_line, tier0, facts, card: { id, ...card } };
  });
  return {
    analyzer: "cbm",
    project: "p",
    mode: "tier0",
    card_version: 2,
    rules: 3,
    summary: { cards: n, decided: 1, rejected: 1, narrowed: 0, undecided: n - 2, no_source: 0, by_rule: {}, by_target: {} },
    results,
  };
}

function expectNoSecret(text: string): void {
  expect(text).not.toContain(FAKE_TOKEN);
  expect(text).not.toContain(FAKE_ACCOUNT);
  expect(text).not.toContain("9c1e"); // not even the account id's last four, in the record or the log
}

function fillOptions(root: string, model: FakeDecisionModel | null, extra: Partial<Parameters<typeof runIndexFill>[0]> = {}) {
  const built = { count: 0 };
  const updates: Tier1Fill[] = [];
  const log: string[] = [];
  return {
    built,
    updates,
    log,
    options: {
      projectRoot: root,
      analyzer: "cbm",
      classify: async () => report(),
      open: {
        env: {},
        fetch: () => Promise.reject(new Error("no network in tests")),
        createModel: () => {
          built.count++;
          if (!model) throw new Error("no model expected");
          return model;
        },
      },
      spec,
      updateEveryMs: 0,
      runId: "20261115T120000Z-fill",
      onUpdate: (f: Tier1Fill) => {
        updates.push(structuredClone(f));
      },
      log: (line: string) => log.push(line),
      ...extra,
    } as Parameters<typeof runIndexFill>[0],
  };
}

describe("runIndexFill", () => {
  test("not opted in: null, no model built, nothing read beyond the opt-in, nothing written, no update", async () => {
    const root = tmp();
    const { options, built, updates, log } = fillOptions(root, null, { classify: async () => { throw new Error("classify must not run"); } });
    expect(await runIndexFill(options)).toBeNull();
    expect(built.count).toBe(0);
    expect(updates).toHaveLength(0);
    expect(log).toHaveLength(0);
    expect(existsSync(path.join(root, ".dr"))).toBe(false);
  });

  test("opted in: every Tier-0-undecided card answered and cached, the ledger's source is index, nothing staged", async () => {
    const root = tmp();
    optIn(root);
    const fake = accepting();
    const { options, updates, log } = fillOptions(root, fake);
    const fill = (await runIndexFill(options))!;

    expect(fill).toMatchObject({ state: "done", provider: "cloudflare-workers-ai", model: "fake/clef", cards: { done: 6, total: 6 }, asked: 6, cached: 0, sent: 6, failed: 0, skipped: 0 });
    expect(fill.costUsd).toBeGreaterThan(0);
    expect(fill.finishedAt).not.toBeNull();
    expect(fill.etaSeconds).toBeUndefined();
    expect(fill.estimate).toMatchObject({ misses: 6, cards: 6 });
    expect(fill.estimate!.costUsd).toBeGreaterThan(0);
    expect(fill.month).toMatchObject({ capUsd: 20, cards: 6 });
    expect(fill.run).toBe(".dr/analyzers/cbm/classify/20261115T120000Z-fill");
    expect(fake.calls.length).toBe(12); // two stages a card

    // The first update says it is running; the last is the outcome.
    expect(updates[0].state).toBe("running");
    expect(updates.at(-1)).toEqual(fill);
    expect(updates.some((u) => u.state === "running" && u.cards?.total === 6)).toBe(true);

    // The ledger: every line from the fill, source index.
    const ledger = await new SpendLedger(tier1Paths(root, "cbm").ledger).entries();
    expect(ledger).toHaveLength(6);
    expect(ledger.every((e) => e.source === "index")).toBe(true);

    // The cache answers a following run with no request (what codebase_extract then does).
    const s = await openTier1(root, "cbm", { env: {}, createModel: () => fake });
    if (s.state !== "ready") throw new Error(s.state);
    const items = report()
      .results.slice(2)
      .map((r) => ({ id: r.card_id, card: r.card!, ...(r.tier0?.kind === "narrow" ? { narrow: r.tier0.candidates } : {}) }));
    const before = fake.calls.length;
    const again = await classifyTier1(items, { model: fake, spec, host: s.host, qset: s.qset, cache: s.cache, thresholds: s.thresholds });
    expect(fake.calls.length).toBe(before);
    expect(again.stats).toMatchObject({ cached: 6, sent: 0 });

    // Never a changeset or the model: only .dr/analyzers/cbm.
    expect(readdirSync(root)).toEqual([".dr"]);
    expect(readdirSync(path.join(root, ".dr/analyzers/cbm")).sort()).toEqual(["classify", "tier1-cache", "tier1-spend.jsonl", "tier1.json"]);

    expectNoSecret(JSON.stringify(updates) + log.join("\n"));
    expect(log.join("\n")).toContain("Cloudflare Workers AI (fake/clef)");
  });

  test("a second fill asks nothing: every card comes from the cache", async () => {
    const root = tmp();
    optIn(root);
    const fake = accepting();
    await runIndexFill(fillOptions(root, fake).options);
    const calls = fake.calls.length;
    const fill = (await runIndexFill(fillOptions(root, fake, { runId: "20261115T120500Z-fill" }).options))!;
    expect(fake.calls.length).toBe(calls);
    expect(fill).toMatchObject({ state: "done", cached: 6, sent: 0, costUsd: 0 });
    expect(fill.estimate).toBeUndefined();
  });

  test("misconfigured: skipped with the reason, no model built, nothing sent", async () => {
    const root = tmp();
    optIn(root, { provider: "no-such-provider" });
    const { options, built } = fillOptions(root, null);
    const fill = (await runIndexFill(options))!;
    expect(fill.state).toBe("skipped");
    expect(fill.reason).toContain("misconfigured");
    expect(built.count).toBe(0);
  });

  test("the cap already reached (a cap of 0): skipped, nothing asked", async () => {
    const root = tmp();
    optIn(root, { monthlyCapUsd: 0 });
    const fake = accepting();
    const { options } = fillOptions(root, fake, { classify: async () => { throw new Error("classify must not run"); } });
    const fill = (await runIndexFill(options))!;
    expect(fill).toMatchObject({ state: "skipped", stoppedBy: "cap" });
    expect(fill.reason).toContain("$0.00");
    expect(fake.calls).toHaveLength(0);
  });

  test("the cap reached during the fill: stopped (cap), the index unaffected, what was asked is cached", async () => {
    const root = tmp();
    // A card costs $0.00048 (two stages of 1,000 tokens at $0.24 per million): three fit $0.0015.
    optIn(root, { monthlyCapUsd: 0.0015 });
    const fake = accepting();
    const fill = (await runIndexFill(fillOptions(root, fake).options))!;
    expect(fill).toMatchObject({ state: "stopped", stoppedBy: "cap" });
    expect(fill.sent).toBeGreaterThan(0);
    expect(fill.skipped).toBeGreaterThan(0);
    expect(fill.reason).toContain("cap");
    expect((await new SpendLedger(tier1Paths(root, "cbm").ledger).month(0.0015)).spentUsd).toBeLessThanOrEqual(0.0015);
  });

  test("the provider down: stopped (unavailable), never a throw", async () => {
    const root = tmp();
    optIn(root);
    const fake = accepting().failNext(...Array(12).fill("unavailable"));
    const fill = (await runIndexFill(fillOptions(root, fake).options))!;
    expect(fill).toMatchObject({ state: "stopped", stoppedBy: "unavailable" });
    expect(fill.reason).toContain("provider");
  });

  test("cancelled mid-fill: nothing more is asked, the record says cancelled", async () => {
    const root = tmp();
    optIn(root, { concurrency: 2 });
    const fake = new HangingModel();
    const controller = new AbortController();
    const { options } = fillOptions(root, fake, { signal: controller.signal });
    const running = runIndexFill(options);
    while (fake.calls.length < 2) await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    const fill = (await running)!;
    expect(fill).toMatchObject({ state: "cancelled", stoppedBy: "cancelled", sent: 0 });
    expect(fake.calls).toHaveLength(2);
  });

  test("an error of DR's own (the cards can't be built): failed, with the message, never a throw", async () => {
    const root = tmp();
    optIn(root);
    const { options } = fillOptions(root, accepting(), { classify: async () => { throw new Error("the analyzer went away"); } });
    const fill = (await runIndexFill(options))!;
    expect(fill).toMatchObject({ state: "failed", reason: "the analyzer went away" });
  });
});

function fakeSpawn(pid = 4242): { spawn: SpawnFn; calls: Array<{ args: string[] }> } {
  const calls: Array<{ args: string[] }> = [];
  const spawn: SpawnFn = (_command, args) => {
    calls.push({ args });
    return Object.assign(new EventEmitter(), { pid, unref() {} }) as any;
  };
  return { spawn, calls };
}

describe("the fill in the job record", () => {
  async function doneJob(root: string, isAlive = () => true) {
    const { job } = await startIndexJob({ projectRoot: root, analyzer: "cbm", spawn: fakeSpawn().spawn, drCommand: DR, isAlive });
    await finishIndexJob(root, job.jobId, { result: RESULT });
    return job;
  }

  test("without the opt-in the record is as it was: no tier1, phase done", async () => {
    const root = tmp();
    const job = await doneJob(root);
    const before = readFileSync(indexJobPath(root), "utf8");
    expect(await runIndexJobFill({ projectRoot: root, jobId: job.jobId, analyzer: "cbm", classify: async () => report(), fill: { open: { env: {} }, spec } })).toBeNull();
    expect(readFileSync(indexJobPath(root), "utf8")).toBe(before);
    const read = await readIndexJob(root, { isAlive: () => true });
    expect(read).toMatchObject({ state: "done", progress: { phase: "done" } });
    expect(read!.tier1).toBeUndefined();
  });

  test("opted in: phase classifying with progress while it runs, done after; the job stays done throughout", async () => {
    const root = tmp();
    optIn(root);
    const job = await doneJob(root);
    const seen: Array<{ state: string; phase: string | undefined; fill: string | undefined }> = [];
    const fake = accepting();
    // Look at the record as each card is asked.
    const watching = new (class extends FakeDecisionModel {
      override async ask(state: string, questions: Record<string, Question>, options: AskOptions = {}) {
        const r = await readIndexJob(root, { isAlive: () => true });
        seen.push({ state: r!.state, phase: r!.progress?.phase, fill: r!.tier1?.state });
        return fake.ask(state, questions, options);
      }
    })();
    const fill = await runIndexJobFill({
      projectRoot: root,
      jobId: job.jobId,
      analyzer: "cbm",
      classify: async () => report(),
      fill: { open: { env: {}, createModel: () => watching }, spec, updateEveryMs: 0 },
    });
    expect(fill?.state).toBe("done");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.state === "done" && s.phase === "classifying" && s.fill === "running")).toBe(true);
    const read = await readIndexJob(root, { isAlive: () => true });
    expect(read).toMatchObject({ state: "done", result: RESULT, progress: { phase: "done" }, tier1: { state: "done", sent: 6, cards: { done: 6, total: 6 } } });
    expect(fillRunning(read)).toBe(false);
    expectNoSecret(readFileSync(indexJobPath(root), "utf8"));
  });

  test("a running fill reads as warming; its process gone, it reads as failed and the index stays done", async () => {
    const root = tmp();
    const job = await doneJob(root);
    const now = new Date().toISOString();
    const running: Tier1Fill = { state: "running", startedAt: now, updatedAt: now, finishedAt: null, cards: { done: 10, total: 40 }, cached: 4, sent: 6, failed: 0, skipped: 0, costUsd: 0.0066, etaSeconds: 12 };
    const raw = JSON.parse(readFileSync(indexJobPath(root), "utf8"));
    writeFileSync(indexJobPath(root), JSON.stringify({ ...raw, tier1: running, progress: { phase: "classifying", updatedAt: now } }));

    const alive = await readIndexJob(root, { isAlive: () => true });
    expect(fillRunning(alive)).toBe(true);
    expect(await runningFill(root, "cbm", { isAlive: () => true })).toEqual({ jobId: job.jobId, startedAt: now, cards: { done: 10, total: 40 }, costUsd: 0.0066, etaSeconds: 12 });
    expect(await runningFill(root, "other", { isAlive: () => true })).toBeNull();

    const gone = await readIndexJob(root, { isAlive: () => false });
    expect(gone).toMatchObject({ state: "done", progress: { phase: "done" }, tier1: { state: "failed" } });
    expect(gone!.tier1!.reason).toContain("exited during the Tier-1 cache fill");
    expect(await runningFill(root, "cbm", { isAlive: () => false })).toBeNull();
  });

  test("a new run while a fill runs stops the old process, whose fill is reported cancelled; tier1Fill: false passes --no-tier1-fill", async () => {
    const root = tmp();
    await doneJob(root);
    const now = new Date().toISOString();
    const raw = JSON.parse(readFileSync(indexJobPath(root), "utf8"));
    writeFileSync(
      indexJobPath(root),
      JSON.stringify({ ...raw, tier1: { state: "running", startedAt: now, updatedAt: now, finishedAt: null, cards: null, cached: 0, sent: 0, failed: 0, skipped: 0, costUsd: 0 } })
    );
    const killed: Array<[number, string]> = [];
    const { spawn, calls } = fakeSpawn(5151);
    const { started, job, replaced } = await startIndexJob({
      projectRoot: root,
      analyzer: "cbm",
      spawn,
      drCommand: DR,
      isAlive: () => true,
      kill: (pid, signal) => killed.push([pid, signal]),
      tier1Fill: false,
    });
    expect(started).toBe(true);
    expect(killed).toEqual([[-4242, "SIGTERM"]]);
    expect(replaced).toMatchObject({ state: "done", tier1: { state: "cancelled", stoppedBy: "cancelled" } });
    expect(job.tier1).toBeUndefined();
    expect(calls[0].args).toContain("--no-tier1-fill");
    expect(replaced!.tier1!.reason).toContain("without a fill");
  });
});

describe("the fill is never untracked (review fixes)", () => {
  async function runningJob(root: string) {
    const { job } = await startIndexJob({ projectRoot: root, analyzer: "cbm", spawn: fakeSpawn().spawn, drCommand: DR, isAlive: () => true });
    return job;
  }

  test("opted in, the index's done and the running fill are one write: no reader sees a done job without its fill, and a new run stops it", async () => {
    const root = tmp();
    optIn(root);
    const job = await runningJob(root);
    const marker = tier1FillMarker(root, "cbm")!;
    expect(marker).toMatchObject({ state: "running", cards: null });
    await finishIndexJob(root, job.jobId, { result: RESULT, tier1: marker });
    // The first read after the index sees the fill (before the child has even opened Tier 1).
    const read = await readIndexJob(root, { isAlive: () => true });
    expect(read).toMatchObject({ state: "done", result: RESULT, progress: { phase: "classifying" }, tier1: { state: "running" } });
    expect(fillRunning(read)).toBe(true);
    const killed: Array<[number, string]> = [];
    const next = await startIndexJob({ projectRoot: root, analyzer: "cbm", spawn: fakeSpawn(6262).spawn, drCommand: DR, isAlive: () => true, kill: (pid, s) => killed.push([pid, s]) });
    expect(next.started).toBe(true);
    expect(killed).toEqual([[-4242, "SIGTERM"]]);
  });

  test("not opted in: no marker, and the done record has no tier1 and phase done, as before", async () => {
    const root = tmp();
    const job = await runningJob(root);
    expect(tier1FillMarker(root, "cbm")).toBeNull();
    await finishIndexJob(root, job.jobId, { result: RESULT });
    const raw = JSON.parse(readFileSync(indexJobPath(root), "utf8"));
    expect("tier1" in raw).toBe(false);
    expect(raw.progress.phase).toBe("done");
  });

  test("a fill whose record now belongs to another run stops asking at once; the new record is left alone", async () => {
    const root = tmp();
    optIn(root, { concurrency: 1 });
    const job = await runningJob(root);
    await finishIndexJob(root, job.jobId, { result: RESULT, tier1: tier1FillMarker(root, "cbm")! });
    const fake = accepting();
    let replacedAt = -1;
    const replacing = new (class extends FakeDecisionModel {
      override async ask(state: string, questions: Record<string, Question>, options: AskOptions = {}) {
        if (replacedAt < 0) {
          // Another run takes the record (as a second MCP server's codebase_index would).
          replacedAt = fake.calls.length;
          const raw = JSON.parse(readFileSync(indexJobPath(root), "utf8"));
          writeFileSync(indexJobPath(root), JSON.stringify({ ...raw, jobId: "another-run", state: "running", tier1: undefined }));
        }
        return fake.ask(state, questions, options);
      }
    })();
    const log: string[] = [];
    const fill = await runIndexJobFill({
      projectRoot: root,
      jobId: job.jobId,
      analyzer: "cbm",
      classify: async () => report(),
      marked: true,
      log: (l) => log.push(l),
      fill: { open: { env: {}, createModel: () => replacing }, spec, updateEveryMs: 0 },
    });
    expect(fill).toMatchObject({ state: "cancelled", stoppedBy: "cancelled" });
    expect(fill!.reason).toContain("belongs to another index run");
    expect(fake.calls.length).toBeLessThan(12); // not every card's two stages
    expect(log.join("\n")).toContain("the job record now belongs to another index run");
    const raw = JSON.parse(readFileSync(indexJobPath(root), "utf8"));
    expect(raw.jobId).toBe("another-run");
    expect(raw.tier1).toBeUndefined();
  });

  test("a cancelled fill doesn't compact the cache or prune the ledger", async () => {
    const root = tmp();
    optIn(root, { concurrency: 2 });
    const fake = new HangingModel();
    const controller = new AbortController();
    const running = runIndexFill(fillOptions(root, fake, { signal: controller.signal }).options);
    while (fake.calls.length < 2) await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    expect((await running)!.state).toBe("cancelled");
    expect(existsSync(path.join(root, ".dr/analyzers/cbm/tier1-cache/compaction.json"))).toBe(false);
  });

  test("marked, and tier1.json gone before the fill opened it: the marker is closed as skipped", async () => {
    const root = tmp();
    optIn(root);
    const job = await runningJob(root);
    await finishIndexJob(root, job.jobId, { result: RESULT, tier1: tier1FillMarker(root, "cbm")! });
    rmSync(tier1Paths(root, "cbm").config);
    const fill = await runIndexJobFill({ projectRoot: root, jobId: job.jobId, analyzer: "cbm", classify: async () => report(), marked: true, fill: { open: { env: {} }, spec } });
    expect(fill).toMatchObject({ state: "skipped" });
    const read = await readIndexJob(root, { isAlive: () => true });
    expect(read).toMatchObject({ state: "done", progress: { phase: "done" }, tier1: { state: "skipped" } });
  });

  test("SIGTERM to the child process cancels the fill: the record says cancelled and the process exits", async () => {
    const root = tmp();
    optIn(root, { concurrency: 2 });
    const job = await runningJob(root);
    await finishIndexJob(root, job.jobId, { result: RESULT, tier1: tier1FillMarker(root, "cbm")! });
    const reportFile = path.join(root, "report.json");
    writeFileSync(reportFile, JSON.stringify(report()));
    const src = path.resolve(import.meta.dir, "../../../../src/analyzers");
    const child = path.join(root, "fill-child.ts");
    writeFileSync(
      child,
      `import { readFileSync } from "node:fs";
import { fillAfterIndex } from ${JSON.stringify(path.join(src, "index-job-fill.ts"))};
import { DecisionModelError, normaliseJevAnswers, specCriteriaFromLayers } from ${JSON.stringify(path.join(src, "classifier/index.ts"))};
const [root, jobId, reportFile, snapshotFile] = process.argv.slice(2);
const report = JSON.parse(readFileSync(reportFile, "utf8"));
const spec = specCriteriaFromLayers(JSON.parse(readFileSync(snapshotFile, "utf8")).layers);
const model = {
  id: { provider: "fake", model: "fake/clef", canonicalModel: "clef" },
  pricing: { inputPerM: 0.24 },
  normalise: (raw, shapes) => normaliseJevAnswers(raw, shapes),
  ask: (_s, _q, o = {}) => {
    process.stdout.write("asking\\n");
    return new Promise((_, reject) => {
      const stop = () => reject(new DecisionModelError("timeout", "cancelled"));
      if (o.signal?.aborted) return stop();
      o.signal?.addEventListener("abort", stop);
    });
  },
};
const fill = await fillAfterIndex({ projectRoot: root, jobId, analyzer: "cbm", classify: async () => report, marked: true, fill: { open: { env: {}, createModel: () => model }, spec, updateEveryMs: 0, runId: "child" } });
process.stdout.write("ended " + fill?.state + "\\n");
`
    );
    const proc = Bun.spawn([process.execPath, child, root, job.jobId, reportFile, path.join(FIXTURES, "spec-snapshot.json")], { stdout: "pipe", stderr: "pipe", env: {} });
    const reader = proc.stdout.getReader();
    let out = "";
    while (!out.includes("asking")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    expect(out).toContain("asking");
    proc.kill("SIGTERM");
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    expect(await proc.exited).toBe(0);
    expect(out).toContain("ended cancelled");
    const read = await readIndexJob(root, { isAlive: () => false });
    expect(read).toMatchObject({ state: "done", progress: { phase: "done" }, tier1: { state: "cancelled", stoppedBy: "cancelled" } });
    expect(existsSync(path.join(root, ".dr/analyzers/cbm/tier1-cache/compaction.json"))).toBe(false);
  }, 30_000);
});

describe("warming in the status views", () => {
  test("tier1Status and tier1Brief say warming, with the fill's progress, while the index job fills; on otherwise", async () => {
    const root = tmp();
    optIn(root);
    const opts = { env: {}, git: () => null, isAlive: () => true };
    expect((await tier1Status(root, "cbm", opts)).state).toBe("on");

    const { job } = await startIndexJob({ projectRoot: root, analyzer: "cbm", spawn: fakeSpawn().spawn, drCommand: DR, isAlive: () => true });
    await finishIndexJob(root, job.jobId, { result: RESULT });
    const now = new Date().toISOString();
    const raw = JSON.parse(readFileSync(indexJobPath(root), "utf8"));
    writeFileSync(
      indexJobPath(root),
      JSON.stringify({ ...raw, tier1: { state: "running", startedAt: now, updatedAt: now, finishedAt: null, cards: { done: 3, total: 9 }, cached: 0, sent: 3, failed: 0, skipped: 0, costUsd: 0.0033, etaSeconds: 4 } })
    );

    const status = await tier1Status(root, "cbm", opts);
    expect(status).toMatchObject({ state: "warming", warming: { jobId: job.jobId, cards: { done: 3, total: 9 }, costUsd: 0.0033, etaSeconds: 4 } });
    expect(status.reason).toBe("the codebase_index job is filling the answer cache (3 of 9 cards, about 4 s left, $0.00 so far)");
    const brief = await tier1Brief(root, "cbm", opts);
    expect(brief).toMatchObject({ state: "warming", warming: { cards: { done: 3, total: 9 } } });
    expectNoSecret(JSON.stringify(status) + JSON.stringify(brief));

    // Its process gone: on again (the fill failed; the index is done).
    expect((await tier1Status(root, "cbm", { ...opts, isAlive: () => false })).state).toBe("on");
  });
});
