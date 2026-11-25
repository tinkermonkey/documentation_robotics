/**
 * codebase_extract indexes first (#1347): a missing or stale index (or one that holds no code,
 * #1345), or a run in flight, no longer costs the agent a round trip through codebase_index. The
 * call starts or joins the run, waits within its time budget, says it did and how long it took,
 * and says how to wait when the run outlasts the budget. autoIndex: false keeps the old refusal.
 *
 * codebase-memory-mcp is not needed: the "child" is a fake that records the index the way
 * `dr analyzer index --job` does, after a short delay.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { createCodebaseExtractHandler } from "../../../src/mcp/tools/codebase-extract.js";
import { MAX_WAIT_SECONDS, createCodebaseIndexHandler, indexFirst, indexFirstDeadline } from "../../../src/mcp/tools/codebase-index.js";
import type { CodebaseToolDeps } from "../../../src/mcp/tools/codebase-shared.js";
import { finishIndexJob, type SpawnFn } from "../../../src/analyzers/index-job.js";
import { readIndexMeta, writeIndexMeta, writeSession } from "../../../src/analyzers/session-state.js";
import type { AnalyzerBackend } from "../../../src/analyzers/base-analyzer.js";
import { collectExtraction } from "../../../src/analyzers/cards/extract.js";
import { CONFIG, fakeGraph, springProject } from "../../helpers/fake-cbm-graph.js";

const HEAD = "1111111111111111111111111111111111111111";
const NEW_HEAD = "2222222222222222222222222222222222222222";
const META = { git_head: HEAD, timestamp: "2026-11-09T12:00:00.000Z", node_count: 120, edge_count: 340 };

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}
function ok(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return parse(result);
}
function fail(result: any): any {
  expect(result.isError).toBe(true);
  return parse(result);
}

/** How the fake child ends a run: it records an index (at the harness's HEAD), fails, or never ends. */
type ChildOutcome = "index" | "fail" | "hang";

interface Harness {
  deps: CodebaseToolDeps;
  head: { value: string };
  outcome: { value: ChildOutcome };
  spawns: string[][];
}

let rootPath: string;

function harness(): Harness {
  const h: Harness = { head: { value: HEAD }, outcome: { value: "index" }, spawns: [], deps: undefined as unknown as CodebaseToolDeps };
  const backend = {
    name: "cbm",
    detect: async () => ({ installed: true, binary_path: "/bin/cbm" }),
    extract: async (_projectRoot: string, options: any) => collectExtraction(fakeGraph(springProject()), CONFIG, "cbm", options),
  } as unknown as AnalyzerBackend;
  // The child: after a moment, what `dr analyzer index --job <id>` records when it ends.
  const spawn: SpawnFn = (_command, args) => {
    h.spawns.push(args);
    const jobId = args[args.indexOf("--job") + 1];
    const outcome = h.outcome.value;
    if (outcome !== "hang") {
      setTimeout(async () => {
        if (outcome === "fail") {
          await finishIndexJob(rootPath, jobId, { error: "codebase-memory-mcp indexed no code at the root (0 nodes, 0 edges)" });
          return;
        }
        const meta = { ...META, git_head: h.head.value, timestamp: new Date().toISOString() };
        await writeIndexMeta(meta, rootPath, "cbm");
        await finishIndexJob(rootPath, jobId, { result: meta });
      }, 30);
    }
    return Object.assign(new EventEmitter(), { pid: 61000 + h.spawns.length, unref() {} }) as any;
  };
  h.deps = {
    getAnalyzer: async (name) => (name === "cbm" ? backend : undefined),
    discover: async () => ({ found: [], selected: "cbm" }),
    spawn,
    drCommand: { command: "/usr/bin/node", args: ["/opt/dr/dist/cli.js"] },
    isAlive: () => true,
    gitHead: () => h.head.value,
    pollIntervalMs: 5,
    budgetMs: 4000,
  };
  return h;
}

beforeEach(async () => {
  clearModelCache();
  rootPath = await realpath(
    await (async () => {
      const dir = join(tmpdir(), `dr-mcp-index-first-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(dir, { recursive: true });
      return dir;
    })()
  );
  await Model.init(rootPath, { name: "Index First Test Model", version: "0.1.0" });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

async function selectCbm(): Promise<void> {
  await writeSession({ active_analyzer: "cbm", selected_at: new Date().toISOString() }, rootPath);
}

async function changesets(): Promise<number> {
  clearModelCache();
  const model = await Model.load(rootPath);
  return (await new StagingAreaManager(rootPath, model).list()).length;
}

describe("codebase_extract indexes first (#1347)", () => {
  it("indexes code that was never indexed, then extracts, and says so with how long it took", async () => {
    const h = harness();
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(h.spawns).toHaveLength(1);
    expect(result.index).toMatchObject({ indexed: true, fresh: true, state: "fresh" });
    expect(result.index.indexedFirst).toMatchObject({ why: "the code was not indexed", started: true });
    expect(typeof result.index.indexedFirst.seconds).toBe("number");
    expect(result.index.indexedFirst.jobId).toBe(h.spawns[0][h.spawns[0].indexOf("--job") + 1]);
    // It went on to extract in the same call.
    expect(result.staged.adds).toBeGreaterThan(0);
  });

  it("re-indexes a stale index, naming why", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness();
    h.head.value = NEW_HEAD; // git can't compare these commits here, so the index is stale
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(result.index.indexedFirst.why).toContain("the index was stale");
    expect(result.index.gitHead).toBe(NEW_HEAD);
    // Not forced: the run's own check decides, so a run another call just finished is skipped.
    expect(h.spawns[0]).not.toContain("--force");
  });

  it("re-indexes an index that holds no code (#1345) instead of extracting nothing from it", async () => {
    await selectCbm();
    await writeIndexMeta({ ...META, node_count: 0, edge_count: 0 }, rootPath, "cbm");
    const h = harness();
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(result.index.indexedFirst.why).toContain("holds no code");
    expect((await readIndexMeta(rootPath, "cbm"))?.node_count).toBe(120);
  });

  it("waits for a run already in flight instead of starting another", async () => {
    await selectCbm();
    const h = harness();
    ok(await createCodebaseIndexHandler(h.deps)({ rootPath }));
    expect(h.spawns).toHaveLength(1);
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(h.spawns).toHaveLength(1);
    expect(result.index.indexedFirst).toMatchObject({ started: false });
    expect(result.index.indexedFirst.why).toContain("an index run was in flight");
  });

  it("leaves a fresh index alone: no run, and no indexedFirst", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness();
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(h.spawns).toHaveLength(0);
    expect(result.index.indexedFirst).toBeUndefined();
  });

  it("says how to wait when the run outlasts the call's budget, and stages nothing", async () => {
    const h = harness();
    h.outcome.value = "hang";
    h.deps.budgetMs = 200;
    const error = fail(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(error.error).toContain("The code was not indexed, so codebase_extract started an index run");
    expect(error.error).toContain("still running after");
    expect(error.suggestions[0]).toContain("status: true and wait: 30");
    expect(error.suggestions[0]).toContain("then call codebase_extract again");
    expect(error.suggestions[1]).toContain("autoIndex: false");
    expect(await changesets()).toBe(0);

    // The next call joins that run rather than starting another.
    fail(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(h.spawns).toHaveLength(1);
  });

  it("reports a run that fails with its error and log", async () => {
    const h = harness();
    h.outcome.value = "fail";
    const error = fail(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(error.error).toContain("and the run failed: codebase-memory-mcp indexed no code");
    expect(error.suggestions[0]).toContain("index-job.log");
    expect(await changesets()).toBe(0);
  });

  it("autoIndex: false refuses as before and starts nothing", async () => {
    const h = harness();
    const missing = fail(await createCodebaseExtractHandler(h.deps)({ rootPath, autoIndex: false }));
    expect(missing.error).toBe("The code is not indexed");
    expect(missing.suggestions[0]).toContain("codebase_index");
    expect(h.spawns).toHaveLength(0);

    await selectCbm();
    await writeIndexMeta({ ...META, node_count: 0 }, rootPath, "cbm");
    const empty = fail(await createCodebaseExtractHandler(h.deps)({ rootPath, autoIndex: false }));
    expect(empty.error).toContain("The index is stale: it holds no code");
    expect(h.spawns).toHaveLength(0);
  });
});

describe("codebase_extract calls that don't extract never index first (review)", () => {
  it("a page, view, list or reject-only call starts no run and waits for none: it is refused as before", async () => {
    const h = harness();
    const calls = [
      { page: 2 },
      { view: {} },
      { list: "groups" as const },
      { reject: [{ card: "OwnerController", reason: "not code" }] },
      { clearRejected: true as const },
    ];
    for (const call of calls) {
      const error = fail(await createCodebaseExtractHandler(h.deps)({ rootPath, ...call }));
      expect(error.error).toBe("The code is not indexed");
    }
    expect(h.spawns).toHaveLength(0);
  });

  it("uncommitted edits alone start no run: the index is used, with a warning", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness();
    h.deps.sourceEdits = async () => ["src/main/java/OwnerController.java"];
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(h.spawns).toHaveLength(0);
    expect(result.index).toMatchObject({ state: "fresh-with-uncommitted-edits" });
    expect(result.index.indexedFirst).toBeUndefined();
  });

  it("judges the index once per call (one analyzer --version, not two)", async () => {
    await selectCbm();
    await writeIndexMeta({ ...META, analyzer_version: "0.12.1" }, rootPath, "cbm");
    const h = harness();
    let versions = 0;
    h.deps.analyzerVersion = async () => {
      versions++;
      return "0.12.1";
    };
    ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(versions).toBe(1);
  });
});

describe("indexFirst", () => {
  it("waits half the call's time, and never past codebase_index's longest wait", () => {
    expect(indexFirstDeadline(1000, 1300)).toBe(1150);
    // A 100 s budget: capped at 48 s (codebase_index's 50 s less the 2 s kept for the last read).
    expect(indexFirstDeadline(0, 100_000)).toBe(MAX_WAIT_SECONDS * 1000 - 2000);
    expect(indexFirstDeadline(0, 100_000)).toBe(48_000);
  });

  it("stops waiting at its deadline and says the run is still going", async () => {
    const h = harness();
    h.outcome.value = "hang";
    const startedAt = Date.now();
    const error = await indexFirst({ projectRoot: rootPath, codebaseRoot: rootPath }, h.deps, {
      tool: "codebase_extract",
      deadline: indexFirstDeadline(startedAt, startedAt + 300),
    }).catch((e) => e);
    expect(error.message).toContain("still running");
    const waited = Date.now() - startedAt;
    expect(waited).toBeGreaterThanOrEqual(140);
    expect(waited).toBeLessThan(2000);
  });

  it("returns the index as judged at the end, for requireFreshIndex to use", async () => {
    const h = harness();
    const { assessment, indexedFirst } = await indexFirst({ projectRoot: rootPath, codebaseRoot: rootPath }, h.deps, {
      tool: "codebase_extract",
      deadline: Date.now() + 2000,
    });
    expect(indexedFirst?.started).toBe(true);
    expect(assessment).toMatchObject({ analyzer: "cbm", freshness: { indexed: true }, judgement: { state: "fresh" } });

    const again = await indexFirst({ projectRoot: rootPath, codebaseRoot: rootPath }, h.deps, { tool: "codebase_extract", deadline: Date.now() + 2000 });
    expect(again.indexedFirst).toBeNull();
    expect(again.assessment.judgement?.state).toBe("fresh");
    expect(h.spawns).toHaveLength(1);
  });
});
