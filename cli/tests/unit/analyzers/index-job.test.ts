/**
 * Background index jobs (analyzers/index-job.ts): the record codebase_index writes, how the child
 * finishes it, and how a dead process is reported. The child is faked, except in the last test,
 * which runs a real detached process that exits with an error.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { spawn as nodeSpawn } from "node:child_process";
import { writeIndexMeta } from "../../../src/analyzers/session-state.js";
import { CbmTools } from "../../../src/analyzers/cbm-responses.js";
import {
  INDEX_JOB_TIMEOUT_MS,
  isIndexJobProcess,
  stopIndexJobProcess,
  finishIndexJob,
  indexJobLogPath,
  indexJobPath,
  markIndexJobPhase,
  readIndexJob,
  startIndexJob,
  type SpawnFn,
} from "../../../src/analyzers/index-job.js";

const RESULT = { node_count: 120, edge_count: 340, git_head: "abc123", timestamp: "2026-11-09T12:00:00.000Z" };
const DR = { command: "/usr/bin/node", args: ["/opt/dr/dist/cli.js"] };

let projectRoot: string;

beforeEach(async () => {
  projectRoot = join(tmpdir(), `dr-index-job-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(projectRoot, { recursive: true });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

interface FakeSpawn {
  spawn: SpawnFn;
  calls: Array<{ command: string; args: string[]; options: any }>;
  children: Array<EventEmitter & { unrefCalled: boolean }>;
}

function fakeSpawn(pid: number | null = 4242): FakeSpawn {
  const calls: FakeSpawn["calls"] = [];
  const children: FakeSpawn["children"] = [];
  const spawn: SpawnFn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = Object.assign(new EventEmitter(), {
      pid: pid ?? undefined,
      unrefCalled: false,
      unref() {
        child.unrefCalled = true;
      },
    });
    children.push(child);
    return child as any;
  };
  return { spawn, calls, children };
}

const alive = () => true;
const dead = () => false;

describe("readIndexJob", () => {
  it("is null when there has been no run", async () => {
    expect(await readIndexJob(projectRoot)).toBeNull();
  });

  it("returns the finished run when the child wrote its outcome and exited after the record was read", async () => {
    const { job } = await startIndexJob({ projectRoot, analyzer: "cbm", spawn: fakeSpawn().spawn, drCommand: DR, isAlive: alive });
    // The liveness check runs after the read: the child finishes and exits in between.
    const finishedThenExited = () => {
      writeFileSync(indexJobPath(projectRoot), JSON.stringify({ ...job, state: "done", finishedAt: job.startedAt, result: RESULT }));
      return false;
    };

    const read = await readIndexJob(projectRoot, { isAlive: finishedThenExited });
    expect(read?.state).toBe("done");
    expect(read?.error).toBeNull();
    expect(read?.result).toEqual(RESULT);
  });

  it("returns a newer run that replaced the dead one after the record was read, checked on its own", async () => {
    const { job } = await startIndexJob({ projectRoot, analyzer: "cbm", spawn: fakeSpawn().spawn, drCommand: DR, isAlive: alive });
    const newer = { ...job, jobId: "newer-run", pid: 5151 };
    // The first run's pid is gone; a forced run has written its record in between.
    const replacedThenChecked = (pid: number) => {
      if (pid === job.pid) writeFileSync(indexJobPath(projectRoot), JSON.stringify(newer));
      return pid === newer.pid;
    };

    const read = await readIndexJob(projectRoot, { isAlive: replacedThenChecked });
    expect(read?.jobId).toBe("newer-run");
    expect(read?.state).toBe("running");

    // When the newer run's process is gone too, it is the one reported failed.
    const failed = await readIndexJob(projectRoot, { isAlive: dead });
    expect(failed?.jobId).toBe("newer-run");
    expect(failed?.state).toBe("failed");
    expect(failed?.error).toContain("pid 5151");
  });
});

describe("startIndexJob", () => {
  it("runs `dr analyzer index` detached in the project and records a running job", async () => {
    const fake = fakeSpawn();
    const { started, job } = await startIndexJob({
      projectRoot,
      analyzer: "cbm",
      spawn: fake.spawn,
      drCommand: DR,
      isAlive: alive,
    });

    expect(started).toBe(true);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call.command).toBe("/usr/bin/node");
    expect(call.args).toEqual(["/opt/dr/dist/cli.js", "analyzer", "index", "--name", "cbm", "--job", job.jobId]);
    expect(call.options.cwd).toBe(projectRoot);
    expect(call.options.detached).toBe(true);
    expect(call.options.stdio[0]).toBe("ignore");
    expect(fake.children[0].unrefCalled).toBe(true);

    expect(job.state).toBe("running");
    expect(job.pid).toBe(4242);
    expect(job.analyzer).toBe("cbm");
    expect(job.finishedAt).toBeNull();
    expect(job.progress?.phase).toBe("starting");
    expect(job.logPath).toBe(indexJobLogPath(projectRoot));
    expect(existsSync(job.logPath)).toBe(true);

    const onDisk = JSON.parse(await readFile(indexJobPath(projectRoot), "utf-8"));
    expect(onDisk.jobId).toBe(job.jobId);
    expect(await readIndexJob(projectRoot, { isAlive: alive })).toEqual(job);
  });

  it("passes --force through", async () => {
    const fake = fakeSpawn();
    await startIndexJob({ projectRoot, analyzer: "cbm", force: true, spawn: fake.spawn, drCommand: DR, isAlive: alive });
    expect(fake.calls[0].args).toContain("--force");
  });

  it("returns the run in flight instead of starting a second", async () => {
    const fake = fakeSpawn();
    const first = await startIndexJob({ projectRoot, analyzer: "cbm", spawn: fake.spawn, drCommand: DR, isAlive: alive });
    const second = await startIndexJob({ projectRoot, analyzer: "cbm", spawn: fake.spawn, drCommand: DR, isAlive: alive });
    expect(second.started).toBe(false);
    expect(second.job.jobId).toBe(first.job.jobId);
    expect(fake.calls).toHaveLength(1);
  });

  it("starts only one run when two calls race", async () => {
    const fake = fakeSpawn();
    const options = { projectRoot, analyzer: "cbm", spawn: fake.spawn, drCommand: DR, isAlive: alive };
    const [a, b] = await Promise.all([startIndexJob(options), startIndexJob(options)]);
    expect(fake.calls).toHaveLength(1);
    expect([a.started, b.started].sort()).toEqual([false, true]);
    expect(a.job.jobId).toBe(b.job.jobId);
  });

  it("starts a new run once the last one has finished", async () => {
    const fake = fakeSpawn();
    const first = await startIndexJob({ projectRoot, analyzer: "cbm", spawn: fake.spawn, drCommand: DR, isAlive: alive });
    await finishIndexJob(projectRoot, first.job.jobId, { result: RESULT });
    const second = await startIndexJob({ projectRoot, analyzer: "cbm", spawn: fake.spawn, drCommand: DR, isAlive: alive });
    expect(second.started).toBe(true);
    expect(second.job.jobId).not.toBe(first.job.jobId);
    expect(fake.calls).toHaveLength(2);
  });

  it("records a failed job when the process can't be started", async () => {
    const fake = fakeSpawn(null);
    const { started, job } = await startIndexJob({ projectRoot, analyzer: "cbm", spawn: fake.spawn, drCommand: DR });
    expect(started).toBe(false);
    expect(job.state).toBe("failed");
    expect(job.pid).toBeNull();

    fake.children[0].emit("error", new Error("spawn /usr/bin/node ENOENT"));
    await Bun.sleep(20);
    const after = await readIndexJob(projectRoot);
    expect(after?.state).toBe("failed");
    expect(after?.error).toContain("ENOENT");
  });

  it("marks the run failed when the child exits with an error before recording its end", async () => {
    const fake = fakeSpawn();
    const { job } = await startIndexJob({ projectRoot, analyzer: "cbm", spawn: fake.spawn, drCommand: DR, isAlive: alive });
    fake.children[0].emit("exit", 1, null);
    await Bun.sleep(20);
    const after = await readIndexJob(projectRoot, { isAlive: alive });
    expect(after?.jobId).toBe(job.jobId);
    expect(after?.state).toBe("failed");
    expect(after?.error).toContain("exited with code 1");
    expect(after?.finishedAt).not.toBeNull();
  });
});

describe("the child's updates", () => {
  async function running(): Promise<string> {
    const fake = fakeSpawn();
    const { job } = await startIndexJob({ projectRoot, analyzer: "cbm", spawn: fake.spawn, drCommand: DR, isAlive: alive });
    return job.jobId;
  }

  it("records the phase, then the result of a finished run", async () => {
    const jobId = await running();
    expect(await markIndexJobPhase(projectRoot, jobId, "indexing")).toBe(true);
    expect((await readIndexJob(projectRoot, { isAlive: alive }))?.progress?.phase).toBe("indexing");

    expect(await finishIndexJob(projectRoot, jobId, { result: RESULT })).toBe(true);
    const job = await readIndexJob(projectRoot, { isAlive: dead });
    expect(job?.state).toBe("done");
    expect(job?.result).toEqual(RESULT);
    expect(job?.error).toBeNull();
    expect(job?.finishedAt).not.toBeNull();
    expect(job?.progress?.phase).toBe("done");
  });

  it("records the error of a failed run", async () => {
    const jobId = await running();
    await finishIndexJob(projectRoot, jobId, { error: "Analyzer not installed: cbm" });
    const job = await readIndexJob(projectRoot, { isAlive: dead });
    expect(job?.state).toBe("failed");
    expect(job?.error).toBe("Analyzer not installed: cbm");
    expect(job?.result).toBeNull();
  });

  it("leaves a newer run's record alone", async () => {
    const jobId = await running();
    expect(await finishIndexJob(projectRoot, "some-older-job", { error: "late" })).toBe(false);
    expect(await markIndexJobPhase(projectRoot, "some-older-job", "indexing")).toBe(false);
    const job = await readIndexJob(projectRoot, { isAlive: alive });
    expect(job?.jobId).toBe(jobId);
    expect(job?.state).toBe("running");
  });

  it("doesn't overwrite a finished run", async () => {
    const jobId = await running();
    await finishIndexJob(projectRoot, jobId, { result: RESULT });
    expect(await finishIndexJob(projectRoot, jobId, { error: "exited with code 1" })).toBe(false);
    expect((await readIndexJob(projectRoot))?.state).toBe("done");
  });
});

describe("a run whose process died", () => {
  it("is reported as failed, without rewriting the record", async () => {
    const fake = fakeSpawn();
    const { job } = await startIndexJob({ projectRoot, analyzer: "cbm", spawn: fake.spawn, drCommand: DR, isAlive: alive });
    const reported = await readIndexJob(projectRoot, { isAlive: dead });
    expect(reported?.state).toBe("failed");
    expect(reported?.error).toContain(`pid ${job.pid}`);
    expect(reported?.error).toContain(job.logPath);
    const onDisk = JSON.parse(await readFile(indexJobPath(projectRoot), "utf-8"));
    expect(onDisk.state).toBe("running");
  });

  it("is detected with a real process that has exited", async () => {
    // A real detached child that fails at once, standing in for `dr analyzer index`.
    const { job } = await startIndexJob({
      projectRoot,
      analyzer: "cbm",
      drCommand: { command: process.execPath, args: ["-e", "console.error('boom'); process.exit(3)"] },
    });
    expect(job.state).toBe("running");
    const deadline = Date.now() + 10000;
    let current = await readIndexJob(projectRoot);
    while (current?.state === "running" && Date.now() < deadline) {
      await Bun.sleep(50);
      current = await readIndexJob(projectRoot);
    }
    expect(current?.state).toBe("failed");
    expect(await readFile(job.logPath, "utf-8")).toContain("boom");
  });
});

describe("an unreadable record", () => {
  it("reads as no run", async () => {
    await mkdir(join(projectRoot, ".dr", "analyzers"), { recursive: true });
    await Bun.write(indexJobPath(projectRoot), "{ not json");
    expect(await readIndexJob(projectRoot)).toBeNull();
  });
});

describe("review fixes", () => {
  it("passes --codebase-path before the subcommand", async () => {
    const fake = fakeSpawn();
    const { job } = await startIndexJob({
      projectRoot,
      codebaseRoot: "/work/code",
      analyzer: "cbm",
      spawn: fake.spawn,
      drCommand: DR,
      isAlive: alive,
    });
    expect(fake.calls[0].args).toEqual([
      "/opt/dr/dist/cli.js",
      "--codebase-path",
      "/work/code",
      "analyzer",
      "index",
      "--name",
      "cbm",
      "--job",
      job.jobId,
    ]);
  });

  it("gives the analyzer's index call a long timeout instead of the 30s default", async () => {
    expect(INDEX_JOB_TIMEOUT_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
    const calls: any[] = [];
    const tools = new CbmTools({
      invokeTool: async (name: string, args?: unknown, options?: { timeout?: number }) => {
        calls.push({ name, args, options });
        return { nodes: 1, edges: 2 };
      },
    });
    await tools.indexRepository("/work/code", { timeout: INDEX_JOB_TIMEOUT_MS });
    expect(calls[0].name).toBe("index_repository");
    expect(calls[0].options).toEqual({ timeout: INDEX_JOB_TIMEOUT_MS });
    await tools.indexRepository("/work/code");
    expect(calls[1].options).toBeUndefined();
  });

  it("replaceRunning stops the run in flight (its process group) and starts a new one", async () => {
    const fake = fakeSpawn();
    const kills: Array<[number, string]> = [];
    const kill = (pid: number, signal: NodeJS.Signals) => {
      kills.push([pid, signal]);
    };
    const first = await startIndexJob({ projectRoot, analyzer: "cbm", spawn: fake.spawn, drCommand: DR, isAlive: alive });
    const second = await startIndexJob({
      projectRoot,
      analyzer: "cbm",
      force: true,
      replaceRunning: true,
      spawn: fake.spawn,
      kill,
      drCommand: DR,
      isAlive: alive,
    });
    expect(second.started).toBe(true);
    expect(second.replaced?.jobId).toBe(first.job.jobId);
    expect(kills).toEqual([[-4242, "SIGTERM"]]);
    expect((await readIndexJob(projectRoot, { isAlive: alive }))?.jobId).toBe(second.job.jobId);
  });

  it("falls back to the pid when the process group can't be signalled", () => {
    const kills: Array<[number, string]> = [];
    stopIndexJobProcess(77, (pid, signal) => {
      kills.push([pid, signal]);
      if (pid < 0) throw Object.assign(new Error("no group"), { code: "ESRCH" });
    });
    expect(kills).toEqual([
      [-77, "SIGTERM"],
      [77, "SIGTERM"],
    ]);
  });

  it("marks a run done when the child exits 0 without recording its end, with the index metadata", async () => {
    const fake = fakeSpawn();
    const { job } = await startIndexJob({ projectRoot, analyzer: "cbm", spawn: fake.spawn, drCommand: DR, isAlive: alive });
    await writeIndexMeta(RESULT, projectRoot, "cbm");
    fake.children[0].emit("exit", 0, null);
    await Bun.sleep(20);
    const after = await readIndexJob(projectRoot, { isAlive: dead });
    expect(after?.jobId).toBe(job.jobId);
    expect(after?.state).toBe("done");
    expect(after?.result).toEqual(RESULT);
  });

  it("marks a run done (no result) on exit 0 when there is no index metadata", async () => {
    const fake = fakeSpawn();
    await startIndexJob({ projectRoot, analyzer: "cbm", spawn: fake.spawn, drCommand: DR, isAlive: alive });
    fake.children[0].emit("exit", 0, null);
    await Bun.sleep(20);
    const after = await readIndexJob(projectRoot, { isAlive: dead });
    expect(after?.state).toBe("done");
    expect(after?.result).toBeNull();
  });

  it("knows a pid is the job's process only from its command line", async () => {
    if (process.platform === "win32") return;
    const child = nodeSpawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)", "analyzer", "index", "--job", "job-abc"], {
      stdio: "ignore",
    });
    try {
      await Bun.sleep(200);
      expect(isIndexJobProcess(child.pid!, "job-abc")).toBe(true);
      expect(isIndexJobProcess(child.pid!, "job-other")).toBe(false);
      // This test runner is alive but is not an index job.
      expect(isIndexJobProcess(process.pid, "job-abc")).toBe(false);
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("reports a running record whose pid now runs something else as failed", async () => {
    if (process.platform === "win32") return;
    await mkdir(join(projectRoot, ".dr", "analyzers"), { recursive: true });
    // The record names this test runner's pid: alive, but not `dr analyzer index --job <id>`.
    await Bun.write(
      indexJobPath(projectRoot),
      JSON.stringify({
        version: 1,
        jobId: "job-reused-pid",
        pid: process.pid,
        state: "running",
        analyzer: "cbm",
        force: false,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
        progress: null,
        logPath: indexJobLogPath(projectRoot),
        result: null,
      })
    );
    const job = await readIndexJob(projectRoot);
    expect(job?.state).toBe("failed");
    expect(job?.error).toContain("exited without finishing");
  });
});
