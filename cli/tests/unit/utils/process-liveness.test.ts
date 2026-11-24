/**
 * The shared liveness check (issue 1275): an exited process counts as gone even while it is a
 * zombie its parent has not reaped, which a signal-0 check alone does not see. That is how the
 * release gate's container, where PID 1 never reaps, kept orphaned viewer processes "alive".
 *
 * The zombie tests make a real zombie and run on Linux only (there is no /proc elsewhere); the
 * /proc reading itself is also tested against a fake /proc tree on every platform.
 */
import { describe, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProcessAlive, procShowsExited } from "../../../src/utils/process-liveness.js";
import { watchParent } from "../../../src/utils/parent-watch.js";
import {
  isProcessAlive as registryIsProcessAlive,
  listViewerRecords,
  sweepViewerRegistry,
  viewerRecordPath,
  ensureViewerRecordDir,
} from "../../../src/server/viewer-registry.js";
import { readServerRecord, sweepServerRecords, writeServerRecord } from "../../../src/server/server-record.js";
import { isProcessRunning } from "../../helpers/process-liveness.ts";

const onLinux = process.platform === "linux";

/**
 * A real zombie: `sleep 0` exits at once and its parent then execs `sleep 30`, which never reaps
 * it. Resolves once /proc shows it exited, with the pid and the parent to kill afterwards.
 */
async function makeZombie(): Promise<{ pid: number; parent: ChildProcess }> {
  const parent = spawn("sh", ["-c", "sleep 0 & echo $!; exec sleep 30"], { stdio: ["ignore", "pipe", "ignore"] });
  const pid = await new Promise<number>((resolve) =>
    parent.stdout!.once("data", (data) => resolve(Number(String(data).trim())))
  );
  const deadline = Date.now() + 5000;
  while (procShowsExited(pid) !== true && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  return { pid, parent };
}

async function withStateDir<T>(fn: (env: NodeJS.ProcessEnv, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "dr-liveness-"));
  try {
    return await fn({ ...process.env, DR_STATE_DIR: join(dir, "state") }, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("isProcessAlive", () => {
  it("is true for a running process and false for one that exited and was reaped", async () => {
    const child = spawn("sleep", ["5"], { stdio: "ignore" });
    try {
      expect(isProcessAlive(child.pid!)).toBe(true);
    } finally {
      child.kill("SIGKILL");
    }
    await new Promise((resolve) => child.once("exit", resolve));
    expect(isProcessAlive(child.pid!)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(1.5)).toBe(false);
  });

  it("is the check the viewer registry and the test helper use", () => {
    expect(registryIsProcessAlive).toBe(isProcessAlive);
    expect(isProcessRunning).toBe(isProcessAlive);
    expect(isProcessAlive(process.pid)).toBe(true);
  });
});

describe("procShowsExited", () => {
  async function fakeProc(states: Record<string, string>): Promise<{ root: string; cleanup: () => Promise<void> }> {
    const root = await mkdtemp(join(tmpdir(), "dr-fake-proc-"));
    for (const [tid, state] of Object.entries(states)) {
      await mkdir(join(root, "42", "task", tid), { recursive: true });
      // comm with ") " in it: the state is read after the last ")".
      await writeFile(join(root, "42", "task", tid, "stat"), `${tid} (dr) (x) ${state} 1 2 3\n`);
    }
    return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
  }

  it("is true only when every thread is Z or X", async () => {
    const cases: Array<[Record<string, string>, boolean]> = [
      [{ "42": "Z" }, true],
      [{ "42": "Z", "43": "X" }, true],
      [{ "42": "Z", "43": "R" }, false],
      [{ "42": "S" }, false],
    ];
    for (const [states, expected] of cases) {
      const proc = await fakeProc(states);
      try {
        expect(procShowsExited(42, proc.root)).toBe(expected);
      } finally {
        await proc.cleanup();
      }
    }
  });

  it("is null when /proc has nothing to say", () => {
    expect(procShowsExited(42, join(tmpdir(), "dr-no-such-proc"))).toBeNull();
  });
});

describe.skipIf(!onLinux)("an unreaped zombie (Linux)", () => {
  it("is gone, though it still answers signal 0", async () => {
    const { pid, parent } = await makeZombie();
    try {
      expect(isProcessAlive(pid)).toBe(false);
      // The pid is still there: a signal-0 check alone would call it running.
      expect(() => process.kill(pid, 0)).not.toThrow();
    } finally {
      parent.kill("SIGKILL");
    }
  });

  it("is swept from the viewer registry and not listed (dr visualize --list, --stop)", async () => {
    await withStateDir(async (env, dir) => {
      const { pid, parent } = await makeZombie();
      try {
        const projectRoot = join(dir, "project");
        await mkdir(projectRoot);
        // A live viewer's record (this process), as CLI 0.7.x wrote them, beside the zombie's.
        await ensureViewerRecordDir(env);
        await writeFile(
          viewerRecordPath(projectRoot, process.pid, env),
          JSON.stringify({ pid: process.pid, port: 1, token: null, projectRoot: await realpath(projectRoot), startedAt: new Date().toISOString(), withChangesets: false })
        );
        const zombieRecord = viewerRecordPath(projectRoot, pid, env);
        await writeFile(
          zombieRecord,
          JSON.stringify({ pid, port: 2, token: null, projectRoot, startedAt: new Date().toISOString(), withChangesets: false })
        );
        const listed = await listViewerRecords({ env });
        expect(listed.records.map((r) => r.pid)).toEqual([process.pid]);
        expect(listed.swept.removed).toContain(zombieRecord);
        expect((await sweepViewerRegistry({ env })).records).toBe(0);
      } finally {
        parent.kill("SIGKILL");
      }
    });
  });

  it("is swept from the server records", async () => {
    await withStateDir(async (env, dir) => {
      const { pid, parent } = await makeZombie();
      try {
        await writeServerRecord(
          { farmRoot: dir, pid, port: 8080, cliVersion: "0.0.0", startedAt: new Date().toISOString() },
          "secret",
          env
        );
        const swept = await sweepServerRecords({ env });
        expect(swept.records).toBe(1);
        expect(swept.tokens).toBe(1);
        expect(await readServerRecord(dir, env)).toBeNull();
      } finally {
        parent.kill("SIGKILL");
      }
    });
  });

  it("as a watched parent, counts as gone (--exit-with-parent)", async () => {
    const { pid, parent } = await makeZombie();
    try {
      const gone = await new Promise<boolean>((resolve) => {
        const watch = watchParent(() => resolve(true), { intervalMs: 10, parentPid: () => pid });
        setTimeout(() => {
          watch.stop();
          resolve(false);
        }, 2000);
      });
      expect(gone).toBe(true);
    } finally {
      parent.kill("SIGKILL");
    }
  });
});
