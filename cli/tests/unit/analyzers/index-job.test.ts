/**
 * Background index jobs (analyzers/index-job.ts): the record codebase_index writes, how the child
 * finishes it, and how a dead process is reported. The child is faked, except in the last test,
 * which runs a real detached process that exits with an error.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import {
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
