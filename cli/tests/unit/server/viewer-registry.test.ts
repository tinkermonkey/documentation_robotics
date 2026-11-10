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
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DR_STATE_DIR_ENV,
  findRunningViewer,
  isProcessAlive,
  readViewerRecord,
  removeViewerRecord,
  removeViewerRecordSync,
  stateDir,
  viewerAnswers,
  viewerRecordDir,
  viewerRecordPath,
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
      expect(viewerRecordPath(link, env)).toBe(viewerRecordPath(projectRoot, env));
      expect(viewerRecordPath(join(scratch, "other"), env)).not.toBe(viewerRecordPath(projectRoot, env));
    }));

  it("records a null token for a viewer without auth", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await writeViewerRecord(record({ token: null }), env);
      expect((await readViewerRecord(projectRoot, env))?.token).toBeNull();
    }));
});

describe("removeViewerRecord", () => {
  it("removes only the record of the given pid", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await writeViewerRecord(record({ pid: 12345 }), env);
      await removeViewerRecord(projectRoot, { env, pid: 999 });
      expect(await readViewerRecord(projectRoot, env)).toBeTruthy();
      removeViewerRecordSync(projectRoot, { env, pid: 999 });
      expect(await readViewerRecord(projectRoot, env)).toBeTruthy();
      await removeViewerRecord(projectRoot, { env, pid: 12345 });
      expect(await readViewerRecord(projectRoot, env)).toBeUndefined();
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
      expect(await readViewerRecord(projectRoot, env)).toBeUndefined();
    }));

  it("ignores and removes a record whose server does not answer", () =>
    withFixture(async ({ env, projectRoot, record }) => {
      await writeViewerRecord(record(), env);
      expect(await findRunningViewer(projectRoot, { env, answers: async () => false })).toBeNull();
      expect(await readViewerRecord(projectRoot, env)).toBeUndefined();
    }));

  it("removes an unreadable record", () =>
    withFixture(async ({ env, projectRoot }) => {
      await mkdir(viewerRecordDir(env), { recursive: true });
      await writeFile(viewerRecordPath(projectRoot, env), "not json");
      expect(await findRunningViewer(projectRoot, { env })).toBeNull();
      expect(await readViewerRecord(projectRoot, env)).toBeUndefined();
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
