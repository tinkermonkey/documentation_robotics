/**
 * The viewer registry: where `dr visualize` records the viewer serving a project, and how
 * review_open / project_status find a running one.
 *
 * tests/unit/server runs with --concurrent, so each test makes its own scratch dir and state env
 * (withFixture) instead of sharing module-level state through beforeEach.
 */

import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DR_STATE_DIR_ENV,
  describePortHolder,
  findRunningViewer,
  isProcessAlive,
  legacyViewerRecordPath,
  listViewerRecords,
  probeViewer,
  readViewerRecords,
  removeStaleTempFiles,
  removeViewerRecord,
  removeViewerRecordSync,
  stateDir,
  sweepViewerRegistry,
  viewerAnswers,
  viewerHealth,
  viewerLogPath,
  viewerRecordDir,
  viewerRecordPath,
  viewerStartingPath,
  viewersOnPort,
  viewerUrl,
  writeViewerRecord,
  type ViewerRecord,
} from "../../../src/server/viewer-registry.js";

interface Fixture {
  scratch: string;
  projectRoot: string;
  env: NodeJS.ProcessEnv;
  record: (overrides?: Partial<ViewerRecord>) => ViewerRecord;
}

async function withFixture(body: (fx: Fixture) => Promise<void>): Promise<void> {
  const scratch = join(tmpdir(), `dr-viewer-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const projectRoot = join(scratch, "project");
  await mkdir(projectRoot, { recursive: true });
  const env = { [DR_STATE_DIR_ENV]: join(scratch, "state") };
  const record = (overrides: Partial<ViewerRecord> = {}): ViewerRecord => ({
    pid: process.pid,
    port: 8080,
    token: "secret-token",
    projectRoot,
    startedAt: new Date().toISOString(),
    withChangesets: true,
    ...overrides,
  });
  try {
    await body({ scratch, projectRoot, env, record });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Puts a record file in place as a viewer with that pid would have, without the sweep that
 * writeViewerRecord runs first (which removes the records of pids that are not alive, as the
 * made-up pids of these tests are not).
 */
async function putRecord(record: ViewerRecord, env: NodeJS.ProcessEnv): Promise<string> {
  await mkdir(viewerRecordDir(env), { recursive: true });
  const path = viewerRecordPath(record.projectRoot, record.pid, env);
  await writeFile(path, JSON.stringify({ ...record, projectRoot: await realpath(record.projectRoot) }));
  return path;
}

/** A pid that has exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => child.once("exit", resolve));
  return child.pid!;
}

/** A local HTTP server answering /health like a dr viewer (or not). */
async function healthServer(body: unknown, status = 200): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    res.writeHead(req.url === "/health" ? status : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, port: typeof address === "object" && address ? address.port : 0 };
}

describe("stateDir", () => {
  it("prefers DR_STATE_DIR, then XDG_STATE_HOME/dr, then ~/.local/state/dr", () => {
    expect(stateDir({ [DR_STATE_DIR_ENV]: "/x/state", XDG_STATE_HOME: "/xdg" })).toBe("/x/state");
    expect(stateDir({ XDG_STATE_HOME: "/xdg" })).toBe("/xdg/dr");
    expect(stateDir({})).toMatch(/\.local\/state\/dr$/);
  });
});

describe("writeViewerRecord", () => {
  it("writes the record outside the project, mode 0600 in a 0700 directory", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      const path = await writeViewerRecord(record(), env);
      expect(path.startsWith(viewerRecordDir(env))).toBe(true);
      expect(path.startsWith(projectRoot)).toBe(false);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(viewerRecordDir(env))).mode & 0o777).toBe(0o700);

      const stored = JSON.parse(await readFile(path, "utf8"));
      expect(stored).toMatchObject({ pid: process.pid, port: 8080, token: "secret-token", withChangesets: true });
    }));

  it("keys the record by the project root's real path", () =>
    withFixture(async ({ env, scratch, projectRoot }) => {
      const link = join(scratch, "link");
      await symlink(projectRoot, link);
      expect(viewerRecordPath(link, 7, env)).toBe(viewerRecordPath(projectRoot, 7, env));
      expect(viewerRecordPath(join(scratch, "other"), 7, env)).not.toBe(viewerRecordPath(projectRoot, 7, env));
    }));

  it("gives each viewer of a project its own record, so a second one replaces nothing (#1237)", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      const first = await putRecord(record({ pid: 111, port: 8082 }), env);
      // A later `dr visualize` in the same folder, which then dies without cleaning up.
      const second = await putRecord(record({ pid: 222, port: 8099, token: null }), env);
      expect(second).not.toBe(first);
      expect((await readViewerRecords(projectRoot, env)).map((r) => r.port).sort()).toEqual([8082, 8099]);

      // The second viewer is dead, the first alive: the first is still what the registry finds.
      const found = await findRunningViewer(projectRoot, {
        env,
        isAlive: (pid) => pid === 111,
        answers: async (port) => port === 8082,
      });
      expect(found).toMatchObject({ pid: 111, port: 8082 });
      expect((await readViewerRecords(projectRoot, env)).map((r) => r.pid)).toEqual([111]);
    }));

  it("records the CLI version, the server's pid and who started the viewer", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await writeViewerRecord(
        record({ cliVersion: "0.7.0", serverPid: 4321, startedBy: "review_open", idleExitHours: 24 }),
        env
      );
      expect((await readViewerRecords(projectRoot, env))[0]).toMatchObject({
        cliVersion: "0.7.0",
        serverPid: 4321,
        startedBy: "review_open",
        idleExitHours: 24,
      });
    }));

  it("leaves no temp file and clears temp files older than a minute", () =>
    withFixture(async ({ env, record }) => {
      await mkdir(viewerRecordDir(env), { recursive: true });
      const stale = join(viewerRecordDir(env), "abc.json.999.1.tmp");
      const fresh = join(viewerRecordDir(env), "abc.json.999.2.tmp");
      await writeFile(stale, '{"token":"old"}');
      await writeFile(fresh, "{}");
      const old = new Date(Date.now() - 120_000);
      await utimes(stale, old, old);

      await writeViewerRecord(record(), env);
      const names = await readdir(viewerRecordDir(env));
      expect(names).not.toContain("abc.json.999.1.tmp");
      expect(names).toContain("abc.json.999.2.tmp"); // may still be another writer's
      expect(names.filter((name) => name.endsWith(".tmp"))).toEqual(["abc.json.999.2.tmp"]);
      expect(await removeStaleTempFiles(env)).toEqual([]);
    }));

  it("records a null token for a viewer without auth", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await writeViewerRecord(record({ token: null }), env);
      expect((await readViewerRecords(projectRoot, env))[0]?.token).toBeNull();
    }));
});

describe("removeViewerRecord", () => {
  it("removes only the record of the given pid", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await writeViewerRecord(record({ pid: 12345 }), env);
      await removeViewerRecord(projectRoot, { env, pid: 999 });
      expect(await readViewerRecords(projectRoot, env)).toHaveLength(1);
      removeViewerRecordSync(projectRoot, { env, pid: 999 });
      expect(await readViewerRecords(projectRoot, env)).toHaveLength(1);
      await removeViewerRecord(projectRoot, { env, pid: 12345 });
      expect(await readViewerRecords(projectRoot, env)).toHaveLength(0);
    }));

  it("leaves another viewer's record for the same project alone", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await putRecord(record({ pid: 111 }), env);
      await putRecord(record({ pid: 222 }), env);
      removeViewerRecordSync(projectRoot, { env, pid: 222 });
      expect((await readViewerRecords(projectRoot, env)).map((r) => r.pid)).toEqual([111]);
      await removeViewerRecord(projectRoot, { env });
      expect(await readViewerRecords(projectRoot, env)).toEqual([]);
    }));

  it("removes the record an older CLI wrote, when it is that pid's", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await mkdir(viewerRecordDir(env), { recursive: true });
      await writeFile(legacyViewerRecordPath(projectRoot, env), JSON.stringify(record({ pid: 333, projectRoot: await realpath(projectRoot) })));
      expect((await readViewerRecords(projectRoot, env)).map((r) => r.pid)).toEqual([333]);
      await removeViewerRecord(projectRoot, { env, pid: 999 });
      expect(existsSync(legacyViewerRecordPath(projectRoot, env))).toBe(true);
      await removeViewerRecord(projectRoot, { env, pid: 333 });
      expect(existsSync(legacyViewerRecordPath(projectRoot, env))).toBe(false);
    }));

  it("removes the temp files a viewer left mid-write, at exit", () =>
    withFixture(async ({ env, projectRoot }) => {
      await mkdir(viewerRecordDir(env), { recursive: true });
      const mine = `${viewerRecordPath(projectRoot, 4242, env)}.4242.1.tmp`;
      const other = `${viewerRecordPath(projectRoot, 4343, env)}.4343.1.tmp`;
      await writeFile(mine, "{}");
      await writeFile(other, "{}");
      removeViewerRecordSync(projectRoot, { env, pid: 4242 });
      expect(existsSync(mine)).toBe(false);
      expect(existsSync(other)).toBe(true);
    }));

  it("is fine when there is nothing to remove", () =>
    withFixture(async ({ env, projectRoot }) => {
      await removeViewerRecord(projectRoot, { env });
      removeViewerRecordSync(projectRoot, { env });
    }));
});

describe("findRunningViewer", () => {
  it("returns null when no viewer was recorded", () =>
    withFixture(async ({ env, projectRoot }) => {
      expect(await findRunningViewer(projectRoot, { env })).toBeNull();
    }));

  it("ignores and removes a record whose pid is dead", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      const pid = await deadPid();
      expect(isProcessAlive(pid)).toBe(false);
      await writeViewerRecord(record({ pid }), env);
      expect(await findRunningViewer(projectRoot, { env, answers: async () => true })).toBeNull();
      expect(await readViewerRecords(projectRoot, env)).toEqual([]);
    }));

  it("keeps the record of a live viewer that does not answer, and reports it unreachable", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await writeViewerRecord(record(), env);
      const timeouts: number[] = [];
      const answers = async (_port: number, timeoutMs: number) => {
        timeouts.push(timeoutMs);
        return false;
      };
      const looksLikeViewer = () => true;
      expect(await findRunningViewer(projectRoot, { env, answers, looksLikeViewer })).toBeNull();
      expect(await readViewerRecords(projectRoot, env)).toHaveLength(1);
      const probe = await probeViewer(projectRoot, { env, answers, looksLikeViewer });
      expect(probe.state).toBe("unreachable");
      expect(probe.state === "unreachable" && probe.record.pid).toBe(process.pid);
      // One probe, then one retry with a longer timeout, per lookup.
      expect(timeouts).toEqual([1500, 5000, 1500, 5000]);
    }));

  it("counts a viewer that answers the retry as running", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await writeViewerRecord(record(), env);
      let calls = 0;
      const found = await findRunningViewer(projectRoot, { env, answers: async () => ++calls > 1 });
      expect(found?.pid).toBe(process.pid);
      expect(calls).toBe(2);
    }));

  it("removes an unreadable record", () =>
    withFixture(async ({ env, projectRoot }) => {
      await mkdir(viewerRecordDir(env), { recursive: true });
      await writeFile(viewerRecordPath(projectRoot, 4242, env), "not json");
      expect(await findRunningViewer(projectRoot, { env })).toBeNull();
      expect(existsSync(viewerRecordPath(projectRoot, 4242, env))).toBe(false);
    }));

  it("drops the record of a pid that another program now holds (reused after a reboot)", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      // This test process is alive and is no `dr visualize`.
      await writeViewerRecord(record(), env);
      const probe = await probeViewer(projectRoot, { env, answers: async () => false });
      expect(probe.state).toBe("none");
      expect(await readViewerRecords(projectRoot, env)).toEqual([]);
    }));

  it("keeps a silent viewer's record when its command line cannot be read", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await writeViewerRecord(record(), env);
      const probe = await probeViewer(projectRoot, { env, answers: async () => false, looksLikeViewer: () => null });
      expect(probe.state).toBe("unreachable");
    }));

  it("reports the viewer's CLI version from its health check", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      const { server, port } = await healthServer({ status: "ok", version: "0.1.0", cliVersion: "0.6.0" });
      try {
        await writeViewerRecord(record({ port }), env);
        expect(await probeViewer(projectRoot, { env })).toMatchObject({ state: "running", cliVersion: "0.6.0" });
      } finally {
        server.close();
      }
    }));

  it("with several viewers, reuses one on this CLI's version, then one with changeset mode, then the oldest", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      const versions: Record<number, string> = { 9001: "0.6.0", 9002: "0.7.0", 9003: "0.7.0", 9004: "0.7.0" };
      const options = {
        env,
        isAlive: () => true,
        cliVersion: "0.7.0",
        health: async (port: number) => ({ status: "ok" as const, cliVersion: versions[port] }),
      };
      await putRecord(record({ pid: 1, port: 9001, startedAt: "2026-11-17T10:00:00.000Z" }), env);
      await putRecord(record({ pid: 2, port: 9002, withChangesets: false, startedAt: "2026-11-18T10:00:00.000Z" }), env);
      expect(await probeViewer(projectRoot, options)).toMatchObject({ state: "running", record: { port: 9002 } });
      await putRecord(record({ pid: 4, port: 9004, startedAt: "2026-11-20T10:00:00.000Z" }), env);
      await putRecord(record({ pid: 3, port: 9003, startedAt: "2026-11-19T10:00:00.000Z" }), env);
      expect(await probeViewer(projectRoot, options)).toMatchObject({ state: "running", record: { port: 9003 } });
    }));

  it("reuses the viewer that answers when another for the project is alive but silent", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await putRecord(record({ pid: 1, port: 9001 }), env);
      await putRecord(record({ pid: 2, port: 9002 }), env);
      const probe = await probeViewer(projectRoot, { env, isAlive: () => true, answers: async (port) => port === 9002 });
      expect(probe).toMatchObject({ state: "running", record: { pid: 2 } });
      expect(await readViewerRecords(projectRoot, env)).toHaveLength(2);
    }));

  it("returns a live viewer that answers its health check", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      const { server, port } = await healthServer({ status: "ok" });
      try {
        await writeViewerRecord(record({ port }), env);
        const found = await findRunningViewer(projectRoot, { env });
        expect(found).toMatchObject({ pid: process.pid, port, token: "secret-token" });
      } finally {
        server.close();
      }
    }));
});

describe("sweepViewerRegistry", () => {
  it("removes records of dead pids, markers of dead starts and old logs, and keeps what is live", () =>
    withFixture(async ({ env, scratch, projectRoot, record }) => {
      const dead = await deadPid();
      const other = join(scratch, "other");
      await mkdir(other, { recursive: true });
      await writeViewerRecord(record({ pid: process.pid, port: 8085 }), env);
      const stale = await putRecord(record({ pid: dead, port: 8099, token: null }), env);
      // Another project: only a dead viewer's record, an old log and a marker of a start that died.
      const gone = await putRecord(record({ pid: dead, projectRoot: other, port: 8099 }), env);
      const week = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const oldLog = viewerLogPath(other, env);
      await writeFile(oldLog, "old output");
      await utimes(oldLog, week, week);
      const marker = viewerStartingPath(other, env);
      await writeFile(marker, JSON.stringify({ pid: dead, startedAt: "" }));
      // The live project's log is as old, and stays: its viewer is still running.
      const liveLog = viewerLogPath(projectRoot, env);
      await writeFile(liveLog, "output");
      await utimes(liveLog, week, week);
      // A recent log of a dead viewer stays too, for whoever asks why it died.
      const third = join(scratch, "third");
      await mkdir(third, { recursive: true });
      const recentLog = viewerLogPath(third, env);
      await writeFile(recentLog, "it crashed");

      const removed = await sweepViewerRegistry({ env });
      expect(removed.sort()).toEqual([stale, gone, oldLog, marker].sort());
      expect(existsSync(liveLog)).toBe(true);
      expect(existsSync(recentLog)).toBe(true);
      expect((await readViewerRecords(projectRoot, env)).map((r) => r.pid)).toEqual([process.pid]);
    }));

  it("is run when the registry is read", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      const dead = await deadPid();
      await writeViewerRecord(record({ pid: process.pid, port: 8085 }), env);
      const stale = await putRecord(record({ pid: dead, port: 8099 }), env);
      expect((await listViewerRecords({ env })).map((r) => r.port)).toEqual([8085]);
      expect(existsSync(stale)).toBe(false);

      await putRecord(record({ pid: dead, port: 8099 }), env);
      await probeViewer(projectRoot, { env, answers: async () => true });
      expect(existsSync(stale)).toBe(false);

      // A viewer that starts clears what dead ones left, too.
      await putRecord(record({ pid: dead, port: 8099 }), env);
      await writeViewerRecord(record({ pid: process.pid, port: 8086 }), env);
      expect(existsSync(stale)).toBe(false);
    }));

  it("is fine when there is no viewers directory", () =>
    withFixture(async ({ env }) => {
      expect(await sweepViewerRegistry({ env })).toEqual([]);
      expect(await listViewerRecords({ env })).toEqual([]);
    }));
});

describe("viewerHealth", () => {
  it("returns the status and the CLI version, or null when nothing answers as a viewer", async () => {
    const current = await healthServer({ status: "ok", version: "0.1.0", cliVersion: "0.6.0" });
    const old = await healthServer({ status: "ok", version: "0.1.0" });
    const other = await healthServer({ hello: "world" });
    try {
      expect(await viewerHealth(current.port)).toEqual({ status: "ok", cliVersion: "0.6.0" });
      expect(await viewerHealth(old.port)).toEqual({ status: "ok" });
      expect(await viewerHealth(other.port)).toBeNull();
    } finally {
      current.server.close();
      old.server.close();
      other.server.close();
    }
  });
});

describe("viewerAnswers", () => {
  it("accepts a dr viewer's health answer (ok or degraded) and nothing else", async () => {
    const ok = await healthServer({ status: "degraded" });
    const other = await healthServer({ error: "nope" }, 404);
    try {
      expect(await viewerAnswers(ok.port)).toBe(true);
      expect(await viewerAnswers(other.port)).toBe(false);
    } finally {
      ok.server.close();
      other.server.close();
    }
    expect(await viewerAnswers(ok.port, 500)).toBe(false);
  });
});

describe("viewerUrl", () => {
  it("puts the token before the hash and the changeset route in it", () => {
    expect(viewerUrl({ port: 8081, token: "a b" }, { changesetId: "changeset-1-x" })).toBe(
      "http://localhost:8081/?token=a%20b#/changesets/list?changeset=changeset-1-x"
    );
  });

  it("leaves the token out when auth is off", () => {
    expect(viewerUrl({ port: 8081, token: null }, { changesetId: "changeset-1-x" })).toBe(
      "http://localhost:8081/#/changesets/list?changeset=changeset-1-x"
    );
    expect(viewerUrl({ port: 8081, token: null })).toBe("http://localhost:8081/");
  });
});

describe("describePortHolder", () => {
  it("names another project's live viewer on the port", async () => {
    await withFixture(async ({ env, record, projectRoot }) => {
      await writeViewerRecord(record({ port: 8123 }), env);
      expect(await viewersOnPort(8123, env)).toHaveLength(1);
      expect(await describePortHolder(8123, env)).toBe(
        `the dr viewer for ${await realpath(projectRoot)} (pid ${process.pid})`
      );
    });
  });

  it("ignores a viewer record whose process is gone", async () => {
    await withFixture(async ({ env, record }) => {
      await writeViewerRecord(record({ port: 8124 }), env);
      expect(await viewersOnPort(8124, env, () => false)).toEqual([]);
    });
  });
});
