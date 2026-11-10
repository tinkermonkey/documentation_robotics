/**
 * Unit tests for the codebase MCP tools: codebase_index (start and poll) and codebase_verify.
 *
 * codebase-memory-mcp is not needed: the analyzer, discovery, the child process, process
 * liveness and git are all injected. Verify runs the real VerifyEngine over a faked route graph.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdir, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { createCodebaseIndexHandler } from "../../../src/mcp/tools/codebase-index.js";
import { createCodebaseVerifyHandler } from "../../../src/mcp/tools/codebase-verify.js";
import type { CodebaseToolDeps } from "../../../src/mcp/tools/codebase-shared.js";
import { finishIndexJob, readIndexJob, type SpawnFn } from "../../../src/analyzers/index-job.js";
import { readSession, writeIndexMeta, writeSession } from "../../../src/analyzers/session-state.js";
import { VerifyEngine, type DiscoveredRoute } from "../../../src/analyzers/verify-engine.js";
import type { AnalyzerBackend } from "../../../src/analyzers/base-analyzer.js";
import { followClientRoots, resetProjectRoot } from "../../../src/mcp/project-root.js";
import { registeredToolNames } from "../../../src/mcp/tool-registry.js";
import { drMcpAllowedTools } from "../../../src/coding-agents/drbot-mcp.js";

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
    deps: undefined as unknown as CodebaseToolDeps,
  };
  const backend = {
    name: "cbm",
    displayName: "codebase-memory-mcp",
    detect: async () => (h.installed.value ? { installed: true, binary_path: "/bin/cbm" } : { installed: false }),
    // The analyzer graph is faked; the comparison is the real engine's.
    verify: async (projectRoot: string, options: any) =>
      new VerifyEngine().computeReport(projectRoot, h.routes, options, "cbm", META),
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
    gitHead: () => h.head.value,
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
    expect(h.spawns[0].args).toEqual(["/opt/dr/dist/cli.js", "analyzer", "index", "--name", "cbm", "--job", result.job.jobId]);
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
