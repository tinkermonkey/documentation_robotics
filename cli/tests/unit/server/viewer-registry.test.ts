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
  findRunningViewer,
  isProcessAlive,
  legacyViewerRecordPath,
  listViewerRecords,
  readViewerRecords,
  removeStaleTempFiles,
  removeViewerRecord,
  stateDir,
  describeSweep,
  describeUnreadable,
  sweepViewerRegistry,
  viewerHealth,
  viewerLogPath,
  viewerRecordDir,
  viewerRecordPath,
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
 * Puts a record file in place as a per-project viewer from CLI 0.7.x with that pid would have
 * (nothing in the CLI writes one any more).
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

describe("removeViewerRecord", () => {
  it("removes only the record of the given pid", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await putRecord(record({ pid: 12345 }), env);
      await removeViewerRecord(projectRoot, { env, pid: 999 });
      expect(await readViewerRecords(projectRoot, env)).toHaveLength(1);
      await removeViewerRecord(projectRoot, { env, pid: 12345 });
      expect(await readViewerRecords(projectRoot, env)).toHaveLength(0);
    }));

  it("leaves another viewer's record for the same project alone", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await putRecord(record({ pid: 111 }), env);
      await putRecord(record({ pid: 222 }), env);
      await removeViewerRecord(projectRoot, { env, pid: 222 });
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

});

describe("findRunningViewer", () => {
  const farm = { root: "/farm", file: "/farm/farm.yaml", source: "env" as const };
  const record = { farmRoot: "/farm", pid: 4242, port: 8090, cliVersion: "0.7.1", startedAt: "", tokenPath: "/s/x.token" };

  it("is the central process from the server record, while its /health answers", async () => {
    const asked: unknown[] = [];
    const found = await findRunningViewer({
      cwd: "/farm/alpha",
      env: {},
      resolveFarm: async () => farm,
      findRunningServer: async (root) => (asked.push(root), { record, token: "t" }),
      fetchHealth: async (_record, token) => ({ status: "ok", cliVersion: "0.7.1", pid: token === "t" ? 4242 : 0 }),
    });
    expect(asked).toEqual(["/farm"]);
    expect(found).toMatchObject({ record: { pid: 4242, port: 8090 }, token: "t", health: { pid: 4242 } });
  });

  it("is null when no process is recorded, or the recorded one does not answer", async () => {
    const base = { env: {}, resolveFarm: async () => farm };
    expect(await findRunningViewer({ ...base, findRunningServer: async () => null, fetchHealth: async () => null })).toBeNull();
    expect(
      await findRunningViewer({ ...base, findRunningServer: async () => ({ record, token: "t" }), fetchHealth: async () => null })
    ).toBeNull();
  });

  it("never reads a per-project viewer record", () =>
    withFixture(async ({ env, scratch, record: legacy }) => {
      await putRecord(legacy({ pid: process.pid }), env);
      await mkdir(join(scratch, "farm"), { recursive: true });
      await writeFile(
        join(scratch, "farm", "farm.yaml"),
        `schema: dr-farm-v2\nname: t\ncreated: "2026-11-24T00:00:00.000Z"\nmodified: "2026-11-24T00:00:00.000Z"\nprojects: {}\n`
      );
      expect(await findRunningViewer({ env: { ...env, DR_FARM_PATH: join(scratch, "farm") } })).toBeNull();
    }));
});
