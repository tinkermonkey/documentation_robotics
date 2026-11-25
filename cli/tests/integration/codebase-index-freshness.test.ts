/**
 * The index path end to end, with the built `dr analyzer index` running detached against a
 * stand-in for codebase-memory-mcp (tests/fixtures/fake-cbm-index.mjs) on its PATH:
 *
 * - #1345: an index_repository answer without counts (another process indexing the same code)
 *   waits for that run and records its counts; an index of 0 nodes fails the run and leaves no
 *   metadata that reads as fresh.
 * - #1300: the run keeps DR's folders out of the index through a .cbmignore hidden from git, so the
 *   working tree is as git saw it and nothing needs committing.
 * - #1347: indexFirst, which codebase_extract calls, starts the run, waits for the real child and
 *   reports how long it took.
 *
 * HOME and XDG_CONFIG_HOME point at a scratch directory, so nothing touches the real farm.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runDr } from "../helpers/cli-runner.js";
import type { SpawnFn } from "../../src/analyzers/index-job.js";
import { readIndexMeta, writeIndexMeta, writeSession } from "../../src/analyzers/session-state.js";
import type { AnalyzerBackend } from "../../src/analyzers/base-analyzer.js";
import { clearModelCache } from "../../src/mcp/tools/shared.js";
import { createCodebaseIndexHandler, indexFirst, indexFirstDeadline } from "../../src/mcp/tools/codebase-index.js";
import type { CodebaseToolDeps } from "../../src/mcp/tools/codebase-shared.js";
import { currentGitHead } from "../../src/analyzers/active-analyzer.js";

const CLI_PATH = path.join(process.cwd(), "dist", "cli.js");
const FAKE_CBM = path.join(process.cwd(), "tests", "fixtures", "fake-cbm-index.mjs");

let scratch: string;
let project: string;
let env: NodeJS.ProcessEnv;
const mode = { value: "ok" };

function git(...args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: project, encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

beforeEach(async () => {
  clearModelCache();
  scratch = await realpath(await mkdtemp(path.join(tmpdir(), "dr-index-freshness-")));
  project = path.join(scratch, "app");
  const bin = path.join(scratch, "bin");
  const home = path.join(scratch, "home");
  await mkdir(project, { recursive: true });
  await mkdir(bin, { recursive: true });
  await mkdir(home, { recursive: true });
  // codebase-memory-mcp on the child's PATH is the stand-in.
  await writeFile(path.join(bin, "codebase-memory-mcp"), `#!/bin/sh\nexec node "${FAKE_CBM}" "$@"\n`);
  await chmod(path.join(bin, "codebase-memory-mcp"), 0o755);
  env = { PATH: `${bin}:${process.env.PATH}`, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), FAKE_CBM_STATE: scratch };
  mode.value = "ok";

  await runDr(["init", "--name", "Index Freshness Test"], { cwd: project, env, throwOnError: true });
  git("init", "-q");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "app.ts"), "export function app() { return 1; }\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  await writeSession({ active_analyzer: "cbm", selected_at: new Date().toISOString() }, project);
});

afterEach(async () => {
  clearModelCache();
  await rm(scratch, { recursive: true, force: true });
});

/** The MCP side in this process, with the child spawned into the scratch environment. */
function deps(): CodebaseToolDeps {
  const backend = { name: "cbm", detect: async () => ({ installed: true, binary_path: path.join(scratch, "bin", "codebase-memory-mcp") }) };
  const spawn: SpawnFn = (command, args, options) =>
    nodeSpawn(command, args, { ...options, env: { ...options.env, ...env, FAKE_CBM_MODE: mode.value } }) as any;
  return {
    getAnalyzer: async (name) => (name === "cbm" ? (backend as unknown as AnalyzerBackend) : undefined),
    discover: async () => ({ found: [], selected: "cbm" }),
    spawn,
    drCommand: { command: "node", args: [CLI_PATH] },
    gitHead: currentGitHead,
    analyzerVersion: async () => "0.12.1",
    pollIntervalMs: 100,
  };
}

const status = () => git("status", "--porcelain", "--untracked-files=all");

describe("the index path end to end", () => {
  it("records the counts, and keeps DR's .cbmignore out of git's view (#1300)", async () => {
    const result = (await createCodebaseIndexHandler(deps())({ rootPath: project, wait: 40 })) as any;
    const body = JSON.parse(result.content[0].text);
    expect(body.job.state).toBe("done");
    expect(body.index).toMatchObject({ indexed: true, fresh: true, state: "fresh", nodeCount: 5, edgeCount: 7 });
    expect(body.ignoreFile).toMatchObject({ created: true, excludedBy: path.join(project, ".git", "info", "exclude") });
    expect(await readFile(path.join(project, ".cbmignore"), "utf-8")).toContain("/documentation-robotics/\n");
    // The tree is as git saw it: nothing to commit, and no tag would have to move.
    expect(status()).toBe("");
  }, 60000);

  it("waits for another process's run, then indexes again itself: its own HEAD, time and counts (#1345)", async () => {
    mode.value = "indexing-once";
    const before = Date.now();
    const result = (await createCodebaseIndexHandler(deps())({ rootPath: project, wait: 40 })) as any;
    const body = JSON.parse(result.content[0].text);
    expect(body.job.state).toBe("done");
    expect(body.index).toMatchObject({ fresh: true, state: "fresh", nodeCount: 5, edgeCount: 7, gitHead: git("rev-parse", "HEAD") });
    expect(body.index.joined).toBeUndefined();
    // The time is this run's own second read, after the joined run ended.
    expect(Date.parse(body.index.lastIndexed)).toBeGreaterThanOrEqual(before);
  }, 60000);

  it("records an index joined twice as joined, so it reads stale until a run of its own (#1345)", async () => {
    mode.value = "indexing";
    const result = (await createCodebaseIndexHandler(deps())({ rootPath: project, wait: 40 })) as any;
    const body = JSON.parse(result.content[0].text);
    expect(body.job.state).toBe("done");
    expect(body.index).toMatchObject({ fresh: false, state: "stale", joined: true, nodeCount: 6, edgeCount: 8 });
    expect(body.index.reason).toContain("another process's index run");
    expect((await readIndexMeta(project, "cbm"))?.joined).toBe(true);
    expect(await readFile(body.job.logPath, "utf-8")).toContain("recorded as joined");

    // The next run doesn't skip it as fresh: it indexes, and this time on its own.
    mode.value = "ok";
    const again = JSON.parse(((await createCodebaseIndexHandler(deps())({ rootPath: project, wait: 40 })) as any).content[0].text);
    expect(again.started).toBe(true);
    expect(again.index).toMatchObject({ fresh: true, nodeCount: 5 });
    expect(again.index.joined).toBeUndefined();
  }, 90000);

  it("fails a run that indexed no code, and leaves no metadata that reads fresh (#1345)", async () => {
    // An earlier index at this very commit, as a forced re-index would find.
    await writeIndexMeta({ git_head: git("rev-parse", "HEAD"), timestamp: new Date().toISOString(), node_count: 9, edge_count: 9 }, project, "cbm");
    mode.value = "empty";
    const result = (await createCodebaseIndexHandler(deps())({ rootPath: project, wait: 40, force: true })) as any;
    const body = JSON.parse(result.content[0].text);
    expect(body.job.state).toBe("failed");
    expect(body.job.error).toContain("indexed no code");
    expect(body.index).toEqual({ indexed: false, fresh: false });
    expect(body.next).toContain("The last run failed");
    expect(await readIndexMeta(project, "cbm")).toBeNull();
  }, 60000);

  it("indexFirst runs the real child and reports what it did (#1347)", async () => {
    const startedAt = Date.now();
    const { assessment, indexedFirst } = await indexFirst({ projectRoot: project, codebaseRoot: project }, deps(), {
      tool: "codebase_extract",
      deadline: indexFirstDeadline(startedAt, startedAt + 100_000),
    });
    expect(indexedFirst).toMatchObject({ why: "the code was not indexed", started: true });
    expect(indexedFirst!.seconds).toBeLessThan(50);
    expect(assessment.judgement?.state).toBe("fresh");
    expect((await readIndexMeta(project, "cbm"))?.node_count).toBe(5);
    expect(status()).toBe("");

    // Fresh now: the next call does nothing.
    const again = await indexFirst({ projectRoot: project, codebaseRoot: project }, deps(), { tool: "codebase_extract", deadline: Date.now() + 48_000 });
    expect(again.indexedFirst).toBeNull();
  }, 60000);
});
