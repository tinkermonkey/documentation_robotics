/**
 * Unit tests for the codebase MCP tools: codebase_index (start and poll) and codebase_verify.
 *
 * codebase-memory-mcp is not needed: the analyzer, discovery, the child process, process
 * liveness and git are all injected. Verify runs the real VerifyEngine over a faked route graph.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { createCodebaseIndexHandler } from "../../../src/mcp/tools/codebase-index.js";
import { codebaseVerifyTool, createCodebaseVerifyHandler } from "../../../src/mcp/tools/codebase-verify.js";
import { describeIndex, isIndexedSource, judgeIndex, requireFreshIndex, type CodebaseToolDeps } from "../../../src/mcp/tools/codebase-shared.js";
import { finishIndexJob, readIndexJob, type SpawnFn } from "../../../src/analyzers/index-job.js";
import { readSession, writeIndexMeta, writeSession } from "../../../src/analyzers/session-state.js";
import { VerifyEngine, type DiscoveredRoute } from "../../../src/analyzers/verify-engine.js";
import type { AnalyzerBackend } from "../../../src/analyzers/base-analyzer.js";
import { followClientRoots, resetProjectRoot } from "../../../src/mcp/project-root.js";
import { registeredToolNames } from "../../../src/mcp/tool-registry.js";
import { drMcpAllowedTools } from "../../../src/coding-agents/drbot-mcp.js";
import { resetGlobalOptions, setGlobalOptions } from "../../../src/utils/globals.js";

const HEAD = "1111111111111111111111111111111111111111";
const NEW_HEAD = "2222222222222222222222222222222222222222";
const META = { git_head: HEAD, timestamp: "2026-11-09T12:00:00.000Z", node_count: 120, edge_count: 340 };

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

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

interface Harness {
  deps: CodebaseToolDeps;
  spawns: Array<{ args: string[]; cwd: string; child: EventEmitter }>;
  dead: Set<number>;
  /** Ends every child spawned so far (their pids stop answering). */
  killAll(): void;
  head: { value: string | null };
  installed: { value: boolean };
  discoverCalls: number;
  routes: DiscoveredRoute[];
  kills: Array<[number, string]>;
  gitDirs: string[];
  verifyCalls: Array<{ projectRoot: string; codebaseRoot?: string }>;
}

function harness(overrides: Partial<CodebaseToolDeps> = {}): Harness {
  const h: Harness = {
    spawns: [],
    dead: new Set<number>(),
    killAll: () => h.spawns.forEach((s: any) => h.dead.add(s.child.pid)),
    head: { value: HEAD },
    installed: { value: true },
    discoverCalls: 0,
    routes: [],
    kills: [],
    gitDirs: [],
    verifyCalls: [],
    deps: undefined as unknown as CodebaseToolDeps,
  };
  const backend = {
    name: "cbm",
    displayName: "codebase-memory-mcp",
    detect: async () => (h.installed.value ? { installed: true, binary_path: "/bin/cbm" } : { installed: false }),
    // The analyzer graph is faked; the comparison is the real engine's.
    verify: async (projectRoot: string, options: any) => {
      h.verifyCalls.push({ projectRoot, codebaseRoot: options.codebaseRoot });
      return new VerifyEngine().computeReport(projectRoot, h.routes, options, "cbm", META);
    },
  } as unknown as AnalyzerBackend;
  const spawn: SpawnFn = (_command, args, options) => {
    const child = Object.assign(new EventEmitter(), { pid: 50000 + h.spawns.length, unref() {} });
    h.spawns.push({ args, cwd: options.cwd, child });
    return child as any;
  };
  h.deps = {
    getAnalyzer: async (name) => (name === "cbm" ? backend : undefined),
    discover: async () => {
      h.discoverCalls++;
      return {
        found: [{ name: "cbm", display_name: "codebase-memory-mcp", description: "", homepage: "https://example.test/cbm", installed: h.installed.value }],
        selected: h.installed.value ? "cbm" : undefined,
      };
    },
    spawn,
    drCommand: { command: "/usr/bin/node", args: ["/opt/dr/dist/cli.js"] },
    isAlive: (pid) => !h.dead.has(pid),
    kill: (pid, signal) => {
      h.kills.push([pid, signal]);
    },
    gitHead: (dir) => {
      h.gitDirs.push(dir);
      return h.head.value;
    },
    ...overrides,
  };
  return h;
}

let rootPath: string;

beforeEach(async () => {
  clearModelCache();
  rootPath = await realpath(
    await (async () => {
      const dir = join(tmpdir(), `dr-mcp-codebase-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(dir, { recursive: true });
      return dir;
    })()
  );
  await Model.init(rootPath, { name: "Codebase Tools Test Model", version: "0.1.0" });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

/** Every file under `dir` with its content. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    files[file] = await readFile(file, "utf-8");
  }
  return files;
}

async function selectCbm(): Promise<void> {
  await writeSession({ active_analyzer: "cbm", selected_at: new Date().toISOString() }, rootPath);
}

describe("codebase_index", () => {
  it("with status only, reports no run and starts nothing", async () => {
    const h = harness();
    const result = ok(await createCodebaseIndexHandler(h.deps)({ status: true, rootPath }));
    expect(result.projectRoot).toBe(rootPath);
    expect(result.started).toBe(false);
    expect(result.job).toBeNull();
    expect(result.index).toEqual({ indexed: false, fresh: false });
    expect(result.next).toContain("codebase_index");
    expect(h.spawns).toHaveLength(0);
    expect(h.discoverCalls).toBe(0);
  });

  it("starts a background run and returns at once with the running job", async () => {
    await selectCbm();
    const h = harness();
    const result = ok(await createCodebaseIndexHandler(h.deps)({ rootPath }));
    expect(result.started).toBe(true);
    expect(result.analyzer).toBe("cbm");
    expect(result.job.state).toBe("running");
    expect(result.job.pid).toBe(50000);
    expect(result.next).toContain("status: true");
    expect(h.spawns).toHaveLength(1);
    expect(h.spawns[0].cwd).toBe(rootPath);
    expect(h.spawns[0].args).toEqual([
      "/opt/dr/dist/cli.js",
      "--codebase-path",
      rootPath,
      "analyzer",
      "index",
      "--name",
      "cbm",
      "--job",
      result.job.jobId,
    ]);
  });

  it("reports a run in progress when polled, and doesn't start a second one", async () => {
    await selectCbm();
    const h = harness();
    const handler = createCodebaseIndexHandler(h.deps);
    const first = ok(await handler({ rootPath }));

    const polled = ok(await handler({ status: true, rootPath }));
    expect(polled.job.jobId).toBe(first.job.jobId);
    expect(polled.job.state).toBe("running");
    expect(polled.next).toContain("status: true");

    const again = ok(await handler({ rootPath }));
    expect(again.started).toBe(false);
    expect(again.job.jobId).toBe(first.job.jobId);
    expect(h.spawns).toHaveLength(1);
  });

  it("reports a finished run with a fresh index", async () => {
    await selectCbm();
    const h = harness();
    const handler = createCodebaseIndexHandler(h.deps);
    const { job } = ok(await handler({ rootPath }));

    // What the child does when `dr analyzer index` succeeds.
    await writeIndexMeta(META, rootPath, "cbm");
    await finishIndexJob(rootPath, job.jobId, { result: META });
    h.killAll();

    const polled = ok(await handler({ status: true, rootPath }));
    expect(polled.job.state).toBe("done");
    expect(polled.job.result).toEqual(META);
    expect(polled.job.finishedAt).not.toBeNull();
    expect(polled.index).toMatchObject({ indexed: true, fresh: true, gitHead: HEAD, nodeCount: 120, edgeCount: 340 });
    expect(polled.next).toContain("codebase_verify");
  });

  it("reports a run that failed with an error exit", async () => {
    await selectCbm();
    const h = harness();
    const handler = createCodebaseIndexHandler(h.deps);
    const { job } = ok(await handler({ rootPath }));

    await finishIndexJob(rootPath, job.jobId, { error: "Failed to get git HEAD" });
    h.killAll();

    const polled = ok(await handler({ status: true, rootPath }));
    expect(polled.job.state).toBe("failed");
    expect(polled.job.error).toBe("Failed to get git HEAD");
    expect(polled.next).toContain("job.logPath");
  });

  it("reports a run whose child crashed (non-zero exit) as failed", async () => {
    await selectCbm();
    const h = harness();
    const handler = createCodebaseIndexHandler(h.deps);
    ok(await handler({ rootPath }));
    h.spawns[0].child.emit("exit", 134, null);
    await Bun.sleep(20);
    h.killAll();

    const polled = ok(await handler({ status: true, rootPath }));
    expect(polled.job.state).toBe("failed");
    expect(polled.job.error).toContain("exited with code 134");
  });

  it("reports a run whose process died without finishing as failed, and a new call starts another", async () => {
    await selectCbm();
    const h = harness();
    const handler = createCodebaseIndexHandler(h.deps);
    const first = ok(await handler({ rootPath }));
    h.killAll();

    const polled = ok(await handler({ status: true, rootPath }));
    expect(polled.job.state).toBe("failed");
    expect(polled.job.error).toContain("exited without finishing");

    const second = ok(await handler({ rootPath }));
    expect(second.started).toBe(true);
    expect(second.job.jobId).not.toBe(first.job.jobId);
    expect(h.spawns).toHaveLength(2);
  });

  it("skips a fresh index unless forced", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness();
    const handler = createCodebaseIndexHandler(h.deps);

    const skipped = ok(await handler({ rootPath }));
    expect(skipped.started).toBe(false);
    expect(skipped.index.fresh).toBe(true);
    expect(skipped.message).toContain("force: true");
    expect(h.spawns).toHaveLength(0);

    const forced = ok(await handler({ force: true, rootPath }));
    expect(forced.started).toBe(true);
    expect(h.spawns[0].args).toContain("--force");
  });

  it("re-indexes a stale index without force", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness();
    h.head.value = NEW_HEAD;
    const result = ok(await createCodebaseIndexHandler(h.deps)({ rootPath }));
    expect(result.started).toBe(true);
  });

  it("selects an installed analyzer when none is selected", async () => {
    const h = harness();
    const result = ok(await createCodebaseIndexHandler(h.deps)({ rootPath }));
    expect(h.discoverCalls).toBe(1);
    expect(result.discovered).toBe(true);
    expect(result.started).toBe(true);
    expect((await readSession(rootPath))?.active_analyzer).toBe("cbm");
  });

  it("says how to install the analyzer when none is installed", async () => {
    const h = harness();
    h.installed.value = false;
    const error = fail(await createCodebaseIndexHandler(h.deps)({ rootPath }));
    expect(error.error).toContain("No code analyzer is installed");
    expect(error.suggestions.join("\n")).toContain("npm install -g codebase-memory-mcp");
    expect(error.suggestions.join("\n")).toContain("codebase_index");
    expect(h.spawns).toHaveLength(0);
    expect(await readSession(rootPath)).toBeNull();
  });

  it("says how to install the selected analyzer when it has gone missing", async () => {
    await selectCbm();
    const h = harness();
    h.installed.value = false;
    const error = fail(await createCodebaseIndexHandler(h.deps)({ rootPath }));
    expect(error.error).toContain("not installed");
    expect(error.suggestions.join("\n")).toContain("PATH");
    expect(h.spawns).toHaveLength(0);
  });

  it("reports a missing model", async () => {
    const h = harness();
    const elsewhere = join(rootPath, "..", `no-model-${Date.now()}`);
    await mkdir(elsewhere, { recursive: true });
    try {
      const error = fail(await createCodebaseIndexHandler(h.deps)({ rootPath: elsewhere }));
      expect(JSON.stringify(error).toLowerCase()).toContain("model");
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("writes no model files", async () => {
    await selectCbm();
    const h = harness();
    const before = await snapshot(join(rootPath, "documentation-robotics"));
    ok(await createCodebaseIndexHandler(h.deps)({ rootPath }));
    const job = await readIndexJob(rootPath, { isAlive: () => true });
    expect(job?.logPath.startsWith(join(rootPath, ".dr", "analyzers"))).toBe(true);
    expect(await snapshot(join(rootPath, "documentation-robotics"))).toEqual(before);
  });

  it("keeps DR's own folders out of a cbm index through .cbmignore, and says so once (round 2, bug 9)", async () => {
    await selectCbm();
    const h = harness();
    const handler = createCodebaseIndexHandler(h.deps);
    const first = ok(await handler({ rootPath }));
    expect(first.ignoreFile).toMatchObject({
      path: join(rootPath, ".cbmignore"),
      created: true,
      added: ["/documentation-robotics/", "/.dr/"],
    });
    expect(await readFile(join(rootPath, ".cbmignore"), "utf-8")).toContain("/documentation-robotics/\n/.dr/\n");

    const again = ok(await handler({ rootPath, force: true }));
    expect(again.ignoreFile).toBeUndefined();
  });

  it("doesn't report ignoreFile beside a run that didn't start (review)", async () => {
    await selectCbm();
    const noPid: SpawnFn = () => Object.assign(new EventEmitter(), { pid: undefined, unref() {} }) as any;
    const h = harness({ spawn: noPid });
    const result = ok(await createCodebaseIndexHandler(h.deps)({ rootPath }));
    expect(result.started).toBe(false);
    expect(result.job.state).toBe("failed");
    expect(result.ignoreFile).toBeUndefined();
  });
});

describe("codebase_verify", () => {
  async function addOperation(): Promise<void> {
    ok(
      await modelAddHandler({
        layer: "api",
        type: "operation",
        name: "get-users",
        attributes: { operationId: "getUsers", summary: "List users", tags: "users" },
        sourceFile: "src/handlers/users.ts",
        sourceSymbol: "getUsers",
        sourceProvenance: "extracted",
        rootPath,
      })
    );
    clearModelCache();
  }

  it("compares the analyzer's routes with the model's operations", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    await addOperation();
    const h = harness();
    h.routes = [
      { id: "r1", http_method: "GET", http_path: "/users", source_file: "src/handlers/users.ts", source_symbol: "getUsers" },
      { id: "r2", http_method: "POST", http_path: "/orders", source_file: "src/handlers/orders.ts", source_symbol: "createOrder" },
    ];

    const report = ok(await createCodebaseVerifyHandler(h.deps)({ rootPath }));
    expect(report.analyzer).toBe("cbm");
    expect(report.layers_verified).toEqual(["api"]);
    expect(report.buckets.matched.map((m: any) => m.source_symbol)).toEqual(["getUsers"]);
    expect(report.buckets.in_graph_only.map((g: any) => g.http_path)).toEqual(["/orders"]);
    expect(report.summary.matched_count).toBe(1);
    expect(report.summary.gap_count).toBe(1);
    expect(report.layers_not_verified).toBeUndefined();
  });

  it("lists layers it can't verify", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness();
    const report = ok(await createCodebaseVerifyHandler(h.deps)({ layers: ["api", "data-model"], rootPath }));
    expect(report.layers_verified).toEqual(["api"]);
    expect(report.layers_not_verified).toEqual([{ layer: "data-model", reason: "No verification available for this layer" }]);

    const none = ok(await createCodebaseVerifyHandler(h.deps)({ layers: ["ux"], rootPath }));
    expect(none.layers_verified).toEqual([]);
  });

  it("points at codebase_index when the code is not indexed", async () => {
    const h = harness();
    const error = fail(await createCodebaseVerifyHandler(h.deps)({ rootPath }));
    expect(error.error).toBe("The code is not indexed");
    expect(error.suggestions[0]).toContain("codebase_index");

    await selectCbm();
    const stillNone = fail(await createCodebaseVerifyHandler(h.deps)({ rootPath }));
    expect(stillNone.error).toBe("The code is not indexed");
  });

  it("points at codebase_index when the index is stale", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness();
    h.head.value = NEW_HEAD;
    const error = fail(await createCodebaseVerifyHandler(h.deps)({ rootPath }));
    expect(error.error).toContain("stale");
    expect(error.error).toContain(NEW_HEAD);
    expect(error.suggestions[0]).toContain("codebase_index");
  });

  it("asks to wait while an index run is in flight", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness();
    h.head.value = NEW_HEAD;
    ok(await createCodebaseIndexHandler(h.deps)({ rootPath }));
    const error = fail(await createCodebaseVerifyHandler(h.deps)({ rootPath }));
    expect(error.error).toContain("in progress");
    expect(error.suggestions[0]).toContain("status: true");
  });
});

describe("codebase_index wait (D5)", () => {
  it("blocks until the run finishes, then returns the done job and a fresh index", async () => {
    await selectCbm();
    const h = harness({ pollIntervalMs: 10 });
    const handler = createCodebaseIndexHandler(h.deps);
    const finish = async () => {
      const job = await readIndexJob(rootPath, { isAlive: () => true });
      await writeIndexMeta(META, rootPath, "cbm");
      await finishIndexJob(rootPath, job!.jobId, { result: META });
      h.killAll();
    };
    setTimeout(() => void finish(), 60);

    const started = Date.now();
    const result = ok(await handler({ wait: 5, rootPath }));
    expect(Date.now() - started).toBeLessThan(4000);
    expect(result.started).toBe(true);
    expect(result.job.state).toBe("done");
    expect(result.index).toMatchObject({ indexed: true, fresh: true, state: "fresh" });
    expect(typeof result.waitedSeconds).toBe("number");
  });

  it("returns the running job when the wait ends first, and says to wait again", async () => {
    await selectCbm();
    const h = harness({ pollIntervalMs: 10 });
    const handler = createCodebaseIndexHandler(h.deps);
    ok(await handler({ rootPath }));

    const started = Date.now();
    const polled = ok(await handler({ status: true, wait: 0.1, rootPath }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    expect(polled.job.state).toBe("running");
    expect(polled.next).toContain("status: true and wait: 30");
    expect(h.spawns).toHaveLength(1);
  });

  it("stops waiting when the request is cancelled", async () => {
    await selectCbm();
    const h = harness({ pollIntervalMs: 10 });
    const handler = createCodebaseIndexHandler(h.deps);
    ok(await handler({ rootPath }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const started = Date.now();
    const polled = ok(await handler({ status: true, wait: 30, rootPath }, { signal: controller.signal }));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(polled.job.state).toBe("running");
  });

  it("without wait returns at once, as before", async () => {
    await selectCbm();
    const h = harness({ pollIntervalMs: 10 });
    const handler = createCodebaseIndexHandler(h.deps);
    const result = ok(await handler({ rootPath }));
    expect(result.job.state).toBe("running");
    expect(result.waitedSeconds).toBeUndefined();
  });
});

describe("index freshness (bug 11)", () => {
  it("keeps the index fresh when commits since it touched only DR's folders", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness({
      committedChanges: async () => ["documentation-robotics/model/manifest.yaml", ".dr/analyzers/session.json", "README.md"],
    });
    h.head.value = NEW_HEAD;

    const index = ok(await createCodebaseIndexHandler(h.deps)({ rootPath }));
    expect(index.started).toBe(false);
    expect(index.index).toMatchObject({ fresh: true, state: "fresh" });
    expect(index.message).toContain("nothing to do");

    const report = ok(await createCodebaseVerifyHandler(h.deps)({ rootPath }));
    expect(report.layers_verified).toEqual(["api"]);
  });

  it("calls the index stale when commits since it changed source files", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness({ committedChanges: async () => ["documentation-robotics/model/manifest.yaml", "src/app.ts"] });
    h.head.value = NEW_HEAD;

    const error = fail(await createCodebaseVerifyHandler(h.deps)({ rootPath }));
    expect(error.error).toContain("stale");
    expect(error.error).toContain("src/app.ts");
    expect(error.suggestions[0]).toContain("wait: 30");

    const index = ok(await createCodebaseIndexHandler(h.deps)({ rootPath }));
    expect(index.started).toBe(true);
    expect(h.spawns[0].args).not.toContain("--force");
  });

  it("re-indexes uncommitted source edits newer than the index, forcing the child past its HEAD check", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness({ sourceEdits: async () => ["src/app.ts"] });

    const status = ok(await createCodebaseIndexHandler(h.deps)({ status: true, rootPath }));
    expect(status.index).toMatchObject({ fresh: false, state: "fresh-with-uncommitted-edits", uncommittedEdits: ["src/app.ts"] });
    expect(status.next).toContain("codebase_index");

    // verify still runs, with a warning.
    const report = ok(await createCodebaseVerifyHandler(h.deps)({ rootPath }));
    expect(report.warning).toContain("src/app.ts");

    const index = ok(await createCodebaseIndexHandler(h.deps)({ rootPath }));
    expect(index.started).toBe(true);
    expect(h.spawns[0].args).toContain("--force");
  });

  it("keeps requireFreshIndex's signature, adding the judgement", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness({ sourceEdits: async () => ["src/app.ts"] });
    // The old call: edits are not checked, and never block.
    const plain = await requireFreshIndex(rootPath, rootPath, h.deps, "codebase_extract");
    expect(plain.analyzer).toBe("cbm");
    expect(plain.freshness.currentGitHead).toBe(HEAD);
    expect(plain.index.state).toBe("fresh");

    const result = await requireFreshIndex(rootPath, rootPath, h.deps, "codebase_extract", { uncommittedEdits: true });
    expect(result.index.state).toBe("fresh-with-uncommitted-edits");
    expect(result.index.editedSince).toEqual(["src/app.ts"]);
  });

  it("describes the index as project_status does when given requireFreshIndex's judgement (round 2, bug 6)", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness({ sourceEdits: async () => ["src/app.ts"] });
    const { freshness, index } = await requireFreshIndex(rootPath, rootPath, h.deps, "codebase_extract", { uncommittedEdits: true });

    expect(describeIndex(freshness, index)).toMatchObject({
      indexed: true,
      fresh: false,
      state: "fresh-with-uncommitted-edits",
      reason: expect.stringContaining("src/app.ts"),
      uncommittedEdits: ["src/app.ts"],
    });
    // Without the judgement, the freshness alone reads plain fresh: the contradiction bug 6 saw.
    expect(describeIndex(freshness)).toMatchObject({ fresh: true, state: "fresh" });
  });

  it("judges by source files only, outside DR's folders", () => {
    expect(isIndexedSource("src/app.ts")).toBe(true);
    expect(isIndexedSource("README.md")).toBe(false);
    expect(isIndexedSource("documentation-robotics/model/x.ts")).toBe(false);
    expect(isIndexedSource("pkg/.dr/tool.py")).toBe(false);
  });

  it("covers every language the analyzer reads, and leaves out vendored and built code", () => {
    for (const file of ["src/a.cpp", "src/a.h", "src/a.hpp", "src/a.lua", "src/a.mts", "src/a.cts", "build.gradle.kts", "lib/a.dart", "src/A.groovy"]) {
      expect(isIndexedSource(file)).toBe(true);
    }
    expect(isIndexedSource("node_modules/x/index.js")).toBe(false);
    expect(isIndexedSource("dist/app.js")).toBe(false);
  });

  it("gives extract a freshness that follows the rule, so its describeIndex isn't HEAD equality (review: bug 3)", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness({ committedChanges: async () => ["documentation-robotics/model/manifest.yaml"] });
    h.head.value = NEW_HEAD;
    const { freshness } = await requireFreshIndex(rootPath, rootPath, h.deps, "codebase_extract");
    expect(describeIndex(freshness)).toMatchObject({ fresh: true, state: "fresh" });

    // Without a judgement, a HEAD mismatch is not called stale.
    const raw = { indexed: true as const, fresh: false, meta: META, currentGitHead: NEW_HEAD };
    expect(describeIndex(raw)).toMatchObject({ fresh: false, state: "unknown" });
  });

  it("records the working tree as a run starts, for the run that writes the index", async () => {
    git(rootPath, "init", "-q");
    await mkdir(join(rootPath, "src"), { recursive: true });
    await writeFile(join(rootPath, "src", "app.ts"), "export const app = 1;\n");
    await selectCbm();
    const h = harness();
    const { job } = ok(await createCodebaseIndexHandler(h.deps)({ rootPath }));
    const snapshot = JSON.parse(await readFile(join(rootPath, ".dr", "analyzers", "cbm", "index-worktree.json"), "utf-8"));
    expect(snapshot.jobId).toBe(job.jobId);
    expect(Object.keys(snapshot.files)).toContain("src/app.ts");
  });

  it("is stale when git can't compare the indexed commit with HEAD", async () => {
    const judgement = await judgeIndex({ indexedCommit: HEAD, indexedAt: META.timestamp }, NEW_HEAD, {
      changedBetween: async () => null,
      editedSince: async () => [],
    });
    expect(judgement.state).toBe("stale");
    expect(judgement.reason).toContain(NEW_HEAD);
  });
});

describe("codebase_verify wording (D6)", () => {
  it("says it checks only the API layer, and that no routes is not drift", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness();
    h.routes = [];
    const report = ok(await createCodebaseVerifyHandler(h.deps)({ rootPath }));
    expect(report.scope).toContain("only the API layer");
    expect(report.note).toContain("not drift");

    const tool = codebaseVerifyTool;
    expect(tool.description).toContain("API layer only");
    expect(tool.description).toContain("not drift");
  });

  it("leaves out the no-routes note when the code has routes", async () => {
    await selectCbm();
    await writeIndexMeta(META, rootPath, "cbm");
    const h = harness();
    h.routes = [{ id: "r1", http_method: "GET", http_path: "/users", source_file: "src/u.ts", source_symbol: "getUsers" }];
    const report = ok(await createCodebaseVerifyHandler(h.deps)({ rootPath }));
    expect(report.note).toBeUndefined();
    expect(report.scope).toContain("only the API layer");
  });
});

describe("project resolution", () => {
  const startDir = process.cwd();

  afterEach(() => {
    process.chdir(startDir);
    resetProjectRoot(startDir);
    clearModelCache();
  });

  it("serves the project from the client's roots, not the server's start directory", async () => {
    await selectCbm();
    const h = harness();
    // The server starts outside the project; the client's roots name the project.
    process.chdir(tmpdir());
    resetProjectRoot(process.cwd());
    await followClientRoots(async () => ({ roots: [{ uri: pathToFileURL(rootPath).href }] }), { log: () => {} });

    const status = ok(await createCodebaseIndexHandler(h.deps)({ status: true }));
    expect(status.projectRoot).toBe(rootPath);
    const started = ok(await createCodebaseIndexHandler(h.deps)({}));
    expect(h.spawns[0].cwd).toBe(rootPath);
    expect(started.job.logPath.startsWith(rootPath)).toBe(true);

    const verify = fail(await createCodebaseVerifyHandler(h.deps)({}));
    expect(verify.error).toContain("in progress");
  });
});

describe("registration", () => {
  it("registers both tools", () => {
    expect(registeredToolNames()).toEqual(expect.arrayContaining(["codebase_index", "codebase_verify"]));
  });

  it("keeps them away from DrBot", () => {
    for (const mode of ["read-safe", "changesets"] as const) {
      expect(drMcpAllowedTools(mode)).not.toContain("mcp__dr__codebase_index");
      expect(drMcpAllowedTools(mode)).not.toContain("mcp__dr__codebase_verify");
    }
  });
});

describe("review fixes", () => {
  afterEach(() => {
    resetGlobalOptions();
  });

  it("passes the server's codebase root to the child, before the subcommand (--codebase-path on the server)", async () => {
    await selectCbm();
    const code = await realpath(await mkdtempDir("dr-mcp-codebase-code-"));
    try {
      setGlobalOptions({ codebasePath: code });
      clearModelCache();
      // An index from an older HEAD, so the freshness check runs git and the run starts.
      await writeIndexMeta(META, rootPath, "cbm");
      const h = harness();
      h.head.value = NEW_HEAD;
      ok(await createCodebaseIndexHandler(h.deps)({ rootPath }));
      const args = h.spawns[0].args;
      expect(args.slice(1, 3)).toEqual(["--codebase-path", code]);
      expect(args.indexOf("--codebase-path")).toBeLessThan(args.indexOf("analyzer"));
      // Freshness is read from the same root the child indexes.
      expect(h.gitDirs.length).toBeGreaterThan(0);
      expect(h.gitDirs.every((dir) => dir === code)).toBe(true);
    } finally {
      await rm(code, { recursive: true, force: true });
    }
  });

  it("uses one canonical spelling of the roots on both sides of the spawn", async () => {
    await selectCbm();
    const link = join(tmpdir(), `dr-mcp-codebase-link-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await symlink(rootPath, link);
    try {
      const h = harness();
      const result = ok(await createCodebaseIndexHandler(h.deps)({ rootPath: link }));
      expect(result.projectRoot).toBe(rootPath);
      expect(h.spawns[0].cwd).toBe(rootPath);
      expect(h.spawns[0].args.slice(1, 3)).toEqual(["--codebase-path", rootPath]);
      expect(h.gitDirs.every((dir) => dir === rootPath)).toBe(true);

      // verify reaches the analyzer with the same spellings.
      await writeIndexMeta(META, rootPath, "cbm");
      await finishIndexJob(rootPath, result.job.jobId, { result: META });
      clearModelCache();
      ok(await createCodebaseVerifyHandler(h.deps)({ rootPath: link }));
      expect(h.verifyCalls).toEqual([{ projectRoot: rootPath, codebaseRoot: rootPath }]);
    } finally {
      await rm(link, { force: true });
    }
  });

  it("force replaces a stuck running job: stops its process group and starts fresh", async () => {
    await selectCbm();
    const h = harness();
    const handler = createCodebaseIndexHandler(h.deps);
    const stuck = ok(await handler({ rootPath }));

    const forced = ok(await handler({ force: true, rootPath }));
    expect(forced.started).toBe(true);
    expect(forced.job.jobId).not.toBe(stuck.job.jobId);
    expect(forced.replaced.jobId).toBe(stuck.job.jobId);
    expect(forced.replaced.state).toBe("failed");
    expect(h.kills).toEqual([[-stuck.job.pid, "SIGTERM"]]);
    expect(h.spawns).toHaveLength(2);
    expect(h.spawns[1].args).toContain("--force");

    // The stopped child's exit doesn't touch the new run's record.
    h.spawns[0].child.emit("exit", null, "SIGTERM");
    await Bun.sleep(20);
    const polled = ok(await handler({ status: true, rootPath }));
    expect(polled.job.jobId).toBe(forced.job.jobId);
    expect(polled.job.state).toBe("running");
  });
});

async function mkdtempDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("index time (review: bug 2)", () => {
  it("cbm records the index time before it reads the code, so edits made during a run are newer", async () => {
    const source = await readFile(join(import.meta.dir, "../../../src/analyzers/cbm-analyzer.ts"), "utf-8");
    const run = source.indexOf("await tools.indexRepository(");
    const stamp = source.lastIndexOf("const timestamp = new Date().toISOString();", run);
    expect(run).toBeGreaterThan(0);
    expect(stamp).toBeGreaterThan(0);
    expect(source.slice(stamp, run)).not.toContain("indexRepository");
  });
});
