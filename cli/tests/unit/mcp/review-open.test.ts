/**
 * review_open: a link that opens a changeset in the viewer, reusing the project's running viewer
 * or starting one. The spawner is injected; the registry is real, pointed at a temp state dir.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { changesetCreateHandler, changesetDeactivateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import {
  createReviewOpenHandler,
  viewerIdleHours,
  type StartedViewer,
  type StartViewerOptions,
} from "../../../src/mcp/tools/review-open.js";
import { followClientRoots, resetProjectRoot } from "../../../src/mcp/project-root.js";
import {
  DR_STATE_DIR_ENV,
  probeViewer,
  readViewerRecords,
  readViewerStarting,
  removeViewerRecord,
  viewerRecordPath,
  writeViewerRecord,
  type ViewerRecord,
} from "../../../src/server/viewer-registry.js";
import { getCliVersion } from "../../../src/utils/spec-version.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

let scratch: string;
let rootPath: string;
let savedStateDir: string | undefined;
const servers: Server[] = [];

/** A stand-in viewer: answers /health on a real port, as a viewer on this CLI's version unless told otherwise. */
async function fakeViewerServer(cliVersion: string | null = getCliVersion()): Promise<number> {
  const server = createServer((req, res) => {
    res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: "0.1.0", ...(cliVersion ? { cliVersion } : {}) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
}

/** A spawner that "starts" a viewer: a health server plus the record dr visualize would write. */
function fakeSpawner(token: string | null = "tok-123") {
  const calls: string[] = [];
  /** The options each start was given (the port and token of a viewer it replaces). */
  const options: StartViewerOptions[] = [];
  const startViewer = async (projectRoot: string, startOptions: StartViewerOptions = {}): Promise<StartedViewer> => {
    calls.push(projectRoot);
    options.push(startOptions);
    const port = await fakeViewerServer();
    // dr visualize writes its record a little after it starts.
    setTimeout(() => {
      void writeViewerRecord({
        pid: process.pid,
        port,
        token: startOptions.token ?? token,
        projectRoot,
        startedAt: new Date().toISOString(),
        withChangesets: true,
        cliVersion: getCliVersion(),
        startedBy: "review_open",
      });
    }, 30);
    return { pid: process.pid, exited: new Promise(() => {}) };
  };
  return { calls, options, startViewer };
}

/** A viewer already running for the project: a health server on `cliVersion` and its record. */
async function runningViewer(
  cliVersion: string | null,
  overrides: Partial<ViewerRecord> = {}
): Promise<{ record: ViewerRecord; server: Server }> {
  const port = await fakeViewerServer(cliVersion);
  const server = servers[servers.length - 1];
  const record: ViewerRecord = {
    pid: process.pid,
    port,
    token: "old-token",
    projectRoot: await realpath(rootPath),
    startedAt: new Date().toISOString(),
    withChangesets: true,
    ...overrides,
  };
  await writeViewerRecord(record);
  return { record, server };
}

/** A stopViewer that ends the stand-in viewer: closes its server and removes its record. */
function fakeStopper(server: Server) {
  const stopped: ViewerRecord[] = [];
  const stopViewer = async (record: ViewerRecord): Promise<void> => {
    stopped.push(record);
    await new Promise((resolve) => server.close(resolve));
    await removeViewerRecord(record.projectRoot, { pid: record.pid });
  };
  return { stopped, stopViewer };
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => child.once("exit", resolve));
  return child.pid!;
}

beforeEach(async () => {
  clearModelCache();
  scratch = join(tmpdir(), `dr-review-open-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  rootPath = join(scratch, "project");
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Review Open Test Model", version: "0.1.0" });
  savedStateDir = process.env[DR_STATE_DIR_ENV];
  process.env[DR_STATE_DIR_ENV] = join(scratch, "state");
});

afterEach(async () => {
  for (const server of servers.splice(0)) server.close();
  if (savedStateDir === undefined) delete process.env[DR_STATE_DIR_ENV];
  else process.env[DR_STATE_DIR_ENV] = savedStateDir;
  clearModelCache();
  await rm(scratch, { recursive: true, force: true });
});

describe("review_open", () => {
  it("starts a viewer once and reuses it on the next call", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const spawner = fakeSpawner();
    const handler = createReviewOpenHandler({ startViewer: spawner.startViewer, pollMs: 10 });

    const first = parse(await handler({ rootPath }));
    expect(first.reused).toBe(false);
    expect(first.changesetName).toBe("export-orders");
    expect(first.changesetId).toMatch(/^changeset-/);

    const second = parse(await handler({ rootPath }));
    expect(second.reused).toBe(true);
    expect(second.port).toBe(first.port);
    expect(spawner.calls).toHaveLength(1);
    expect(spawner.calls[0]).toBe(await realpath(rootPath));

    // A fresh handler (another MCP session) finds the same viewer through the registry.
    const other = createReviewOpenHandler({ startViewer: spawner.startViewer, pollMs: 10 });
    expect(parse(await other({ rootPath })).reused).toBe(true);
    expect(spawner.calls).toHaveLength(1);
  });

  it("starts one viewer for two calls made at once", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const spawner = fakeSpawner();
    const handler = createReviewOpenHandler({ startViewer: spawner.startViewer, pollMs: 10 });
    const [a, b] = await Promise.all([handler({ rootPath }), handler({ rootPath })]);
    expect(parse(a).port).toBe(parse(b).port);
    expect(spawner.calls).toHaveLength(1);
  });

  it("ignores and removes a stale record (dead pid) and starts a new viewer", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const port = await fakeViewerServer();
    const stalePid = await deadPid();
    await writeViewerRecord({
      pid: stalePid,
      port,
      token: "old",
      projectRoot: rootPath,
      startedAt: new Date().toISOString(),
      withChangesets: true,
    });

    const spawner = fakeSpawner("new-token");
    const handler = createReviewOpenHandler({ startViewer: spawner.startViewer, pollMs: 10 });
    const result = parse(await handler({ rootPath }));
    expect(result.reused).toBe(false);
    expect(result.url).toContain("token=new-token");
    // The stale record went as the registry was read, and the result says so.
    expect(result.staleRemoved).toEqual({ records: 1, startingMarkers: 0, logs: 0, tempFiles: 0 });
    expect(parse(await handler({ rootPath }))).not.toHaveProperty("staleRemoved");
    expect(spawner.calls).toHaveLength(1);
    expect((await readViewerRecords(rootPath)).map((record) => record.pid)).toEqual([process.pid]);
  });

  it("links to the changeset route with the token before the hash", async () => {
    const created = parse(await changesetCreateHandler({ name: "export-orders", rootPath }));
    const handler = createReviewOpenHandler({ startViewer: fakeSpawner("tok-123").startViewer, pollMs: 10 });
    const result = parse(await handler({ rootPath }));
    expect(result.url).toBe(
      `http://localhost:${result.port}/?token=tok-123#/changesets/list?changeset=${created.id}`
    );
  });

  it("leaves the token out of the link when the viewer runs without auth", async () => {
    const created = parse(await changesetCreateHandler({ name: "export-orders", rootPath }));
    const handler = createReviewOpenHandler({ startViewer: fakeSpawner(null).startViewer, pollMs: 10 });
    const result = parse(await handler({ rootPath }));
    expect(result.url).toBe(`http://localhost:${result.port}/#/changesets/list?changeset=${created.id}`);
  });

  it("opens a named changeset, by id or name, rather than the active one", async () => {
    const first = parse(await changesetCreateHandler({ name: "first-plan", rootPath }));
    await changesetCreateHandler({ name: "second-plan", rootPath });
    const handler = createReviewOpenHandler({ startViewer: fakeSpawner().startViewer, pollMs: 10 });

    const byName = parse(await handler({ changeset: "first-plan", rootPath }));
    expect(byName).toMatchObject({ changesetId: first.id, changesetName: "first-plan" });
    const byId = parse(await handler({ changeset: first.id, rootPath }));
    expect(byId.changesetName).toBe("first-plan");
    const active = parse(await handler({ rootPath }));
    expect(active.changesetName).toBe("second-plan");
  });

  it("errors clearly when no changeset is named and none is active", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    await changesetDeactivateHandler({ rootPath });
    const spawner = fakeSpawner();
    const handler = createReviewOpenHandler({ startViewer: spawner.startViewer, pollMs: 10 });

    const result = await handler({ rootPath });
    expect(result.isError).toBe(true);
    const error = parse(result);
    expect(error.error).toBe("No changeset named and none is active");
    expect(error.suggestions.join(" ")).toContain('"changeset"');
    expect(spawner.calls).toHaveLength(0);

    const missing = parse(await handler({ changeset: "no-such-plan", rootPath }));
    expect(missing.category).toBe("not_found");
  });

  it("serves the project from the client's roots, not the server's cwd", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    clearModelCache();
    const serverCwd = process.cwd();
    const spawner = fakeSpawner();
    const handler = createReviewOpenHandler({ startViewer: spawner.startViewer, pollMs: 10 });
    resetProjectRoot(serverCwd); // forget a root another test file may have pinned
    try {
      await followClientRoots(async () => ({ roots: [{ uri: pathToFileURL(rootPath).href }] }), {
        log: () => {},
      });
      const result = parse(await handler({}));
      expect(result.changesetName).toBe("export-orders");
      expect(spawner.calls).toEqual([await realpath(rootPath)]);
      expect(await readViewerRecords(rootPath)).toHaveLength(1);
    } finally {
      process.chdir(serverCwd);
      resetProjectRoot(serverCwd);
      clearModelCache();
    }
  });

  it("starts the viewer in the named project when the server runs elsewhere", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    expect(process.cwd()).not.toBe(await realpath(rootPath));
    const spawner = fakeSpawner();
    const handler = createReviewOpenHandler({ startViewer: spawner.startViewer, pollMs: 10 });
    parse(await handler({ rootPath }));
    expect(spawner.calls).toEqual([await realpath(rootPath)]);
  });

  it("keeps the record private (0600)", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const handler = createReviewOpenHandler({ startViewer: fakeSpawner().startViewer, pollMs: 10 });
    parse(await handler({ rootPath }));
    expect((await stat(viewerRecordPath(rootPath, process.pid))).mode & 0o777).toBe(0o600);
  });

  it("reports a viewer that exits before it is ready", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const handler = createReviewOpenHandler({
      startViewer: async () => ({ exited: Promise.resolve({ code: 1, signal: null }) }),
      pollMs: 10,
    });
    const result = await handler({ rootPath });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("exited before it was ready (code 1)");
    // The agent is never sent to the CLI.
    expect(JSON.stringify(parse(result))).not.toContain("dr visualize");
  });

  /** A viewer that exits because another process took its port first. */
  async function portClashViewer(port: number): Promise<StartedViewer> {
    const logPath = join(scratch, `viewer-${port}.log`);
    await writeFile(logPath, `Server exited with code 1\nError: Port ${port} is already in use. Try a different port with --port <port>.\n`);
    return { exited: Promise.resolve({ code: 1, signal: null }), logPath };
  }

  it("starts another viewer from the next port when its port is taken at bind time", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const spawner = fakeSpawner();
    const ports: Array<number | undefined> = [];
    const handler = createReviewOpenHandler({
      startViewer: async (projectRoot, options) => {
        ports.push(options?.port);
        return ports.length === 1 ? portClashViewer(8080) : spawner.startViewer(projectRoot);
      },
      pollMs: 10,
    });

    const result = await handler({ rootPath });
    expect(result.isError).toBeUndefined();
    expect(parse(result).reused).toBe(false);
    expect(ports).toEqual([undefined, 8081]);
  });

  it("says what holds the port, not to run the CLI, when every port it tries is taken", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const ports: Array<number | undefined> = [];
    const handler = createReviewOpenHandler({
      startViewer: async (_projectRoot, options) => {
        ports.push(options?.port);
        return portClashViewer(options?.port ?? 8080);
      },
      describePortHolder: async (port) => `the dr viewer for /elsewhere (pid 4242, port ${port})`,
      portAttempts: 3,
      pollMs: 10,
    });

    const result = await handler({ rootPath });
    expect(result.isError).toBe(true);
    const error = parse(result);
    expect(ports).toEqual([undefined, 8081, 8082]);
    expect(error.error).toContain("port 8082 is held by the dr viewer for /elsewhere (pid 4242, port 8082)");
    const text = JSON.stringify(error);
    expect(text).not.toContain("dr visualize");
    expect(text).not.toContain("--port");
  });

  it("leaves a slow viewer running, says to call again, and never starts a second one", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    // A viewer whose process is alive (this one) but which is still loading: no record yet.
    let spawns = 0;
    const slowSpawner = async (): Promise<StartedViewer> => {
      spawns++;
      return { pid: process.pid, exited: new Promise(() => {}), logPath: "/logs/viewer.log" };
    };
    const handler = createReviewOpenHandler({ startViewer: slowSpawner, timeoutMs: 100, pollMs: 10, watchMs: 5000 });

    const first = await handler({ rootPath });
    expect(first.isError).toBe(true);
    const error = parse(first);
    expect(error.error).toContain("still starting");
    expect(error.error).toContain(`pid ${process.pid}`);
    expect(error.suggestions).toContain("Its output is in /logs/viewer.log");

    // Calling again waits on the same start, here and from another session (the .starting marker).
    expect(parse(await handler({ rootPath })).error).toContain("still starting");
    expect(await readViewerStarting(rootPath)).toMatchObject({ pid: process.pid });
    const otherSession = createReviewOpenHandler({ startViewer: slowSpawner, timeoutMs: 100, pollMs: 10, watchMs: 5000 });
    expect(parse(await otherSession({ rootPath })).error).toContain("still starting");
    expect(spawns).toBe(1);

    // Once it has loaded and recorded itself, the next call gets the link.
    const port = await fakeViewerServer();
    await writeViewerRecord({
      pid: process.pid,
      port,
      token: "tok",
      projectRoot: rootPath,
      startedAt: new Date().toISOString(),
      withChangesets: true,
    });
    const ready = parse(await handler({ rootPath }));
    expect(ready).toMatchObject({ reused: true, port });
    expect(spawns).toBe(1);
    // The marker goes once the viewer is ready.
    expect(await waitUntil(async () => (await readViewerStarting(rootPath)) === null)).toBe(true);
  });

  it("reports a live viewer that does not answer, keeps its record, and starts no second one", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const closedPort = await fakeViewerServer();
    servers.pop()!.close(); // nothing answers on this port any more
    await writeViewerRecord({
      pid: process.pid, // alive
      port: closedPort,
      token: "tok",
      projectRoot: rootPath,
      startedAt: new Date().toISOString(),
      withChangesets: true,
    });
    const spawner = fakeSpawner();
    // The recorded pid is this test process; say it is still a viewer (a hung one), not a reused pid.
    const stuckViewer = (root: string) => probeViewer(root, { looksLikeViewer: () => true, retryTimeoutMs: 200 });
    const handler = createReviewOpenHandler({ startViewer: spawner.startViewer, probeViewer: stuckViewer, pollMs: 10 });

    const result = await handler({ rootPath });
    expect(result.isError).toBe(true);
    const error = parse(result);
    expect(error.error).toContain(`pid ${process.pid}`);
    expect(error.error).toContain("does not answer");
    // The way out is a tool call, not a shell command.
    expect(error.suggestions.join(" ")).toContain("restart: true");
    expect(error.suggestions.join(" ")).not.toContain("kill");
    expect(spawner.calls).toHaveLength(0);
    expect((await readViewerRecords(rootPath))[0]?.port).toBe(closedPort);

    // restart: true replaces it.
    const stopped: ViewerRecord[] = [];
    const restarting = createReviewOpenHandler({
      startViewer: spawner.startViewer,
      probeViewer: stuckViewer,
      stopViewer: async (record) => {
        stopped.push(record);
        await removeViewerRecord(record.projectRoot, { pid: record.pid });
      },
      pollMs: 10,
    });
    const replaced = parse(await restarting({ rootPath, restart: true }));
    expect(replaced).toMatchObject({ reused: false, replaced: { pid: process.pid, port: closedPort, reason: "restart" } });
    expect(stopped.map((record) => record.port)).toEqual([closedPort]);
    expect(spawner.options).toEqual([{ port: closedPort, token: "tok" }]);
  });
});

describe("review_open and a viewer older than this CLI (#1237)", () => {
  it("reuses a viewer on this CLI's version without comment", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const { record } = await runningViewer("0.7.0", { startedBy: "review_open" });
    const spawner = fakeSpawner();
    const handler = createReviewOpenHandler({ startViewer: spawner.startViewer, cliVersion: "0.7.0", pollMs: 10 });
    const result = parse(await handler({ rootPath }));
    expect(result).toMatchObject({ reused: true, port: record.port, viewerCliVersion: "0.7.0" });
    expect(result).not.toHaveProperty("outdated");
    expect(result).not.toHaveProperty("notice");
    expect(spawner.calls).toHaveLength(0);
  });

  it("replaces an older viewer that review_open started, on its port and with its token", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const { record, server } = await runningViewer("0.1.0", { startedBy: "review_open", serverPid: 4321 });
    // The stand-in replacement answers as this CLI's version, so the handler is on it too.
    const spawner = fakeSpawner("fresh-token");
    const stopper = fakeStopper(server);
    const handler = createReviewOpenHandler({
      startViewer: spawner.startViewer,
      stopViewer: stopper.stopViewer,
      cliVersion: getCliVersion(),
      pollMs: 10,
    });

    const result = parse(await handler({ rootPath }));
    expect(result.reused).toBe(false);
    expect(result.replaced).toEqual({ pid: record.pid, port: record.port, cliVersion: "0.1.0", reason: "older" });
    // The old one was stopped before the new one started, which was given its port and token.
    expect(stopper.stopped.map((stopped) => stopped.serverPid)).toEqual([4321]);
    expect(spawner.options).toEqual([{ port: record.port, token: "old-token" }]);
    // So a link given earlier still opens.
    expect(result.url).toContain("token=old-token");
    expect(result).not.toHaveProperty("notice");

    // The replacement is current: the next call reuses it.
    expect(parse(await handler({ rootPath }))).toMatchObject({ reused: true, port: result.port });
    expect(spawner.calls).toHaveLength(1);
  });

  it("leaves an older viewer someone else started running, and says it is older", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    // Started in a terminal, or recorded by a CLI that did not say who started it.
    for (const startedBy of ["cli", undefined] as const) {
      const { record, server } = await runningViewer("0.6.0", startedBy ? { startedBy } : {});
      const spawner = fakeSpawner();
      const stopper = fakeStopper(server);
      const handler = createReviewOpenHandler({
        startViewer: spawner.startViewer,
        stopViewer: stopper.stopViewer,
        cliVersion: "0.7.0",
        pollMs: 10,
      });
      const result = parse(await handler({ rootPath }));
      expect(result).toMatchObject({
        reused: true,
        port: record.port,
        outdated: true,
        viewerCliVersion: "0.6.0",
        cliVersion: "0.7.0",
      });
      expect(result.notice).toContain("This viewer runs CLI 0.6.0; this CLI is 0.7.0");
      expect(result.notice).toContain("restart: true");
      expect(result.url).toContain("token=old-token");
      expect(stopper.stopped).toHaveLength(0);
      expect(spawner.calls).toHaveLength(0);
      await removeViewerRecord(rootPath);
    }
  });

  it("counts a viewer that reports no version (before 0.6.0) as older", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    await runningViewer(null);
    const handler = createReviewOpenHandler({ startViewer: fakeSpawner().startViewer, cliVersion: "0.7.0", pollMs: 10 });
    const result = parse(await handler({ rootPath }));
    expect(result.outdated).toBe(true);
    expect(result).not.toHaveProperty("viewerCliVersion");
    expect(result.notice).toContain("a CLI older than 0.6.0");
  });

  it("does not replace a viewer newer than the CLI asking", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const { server } = await runningViewer("0.8.0", { startedBy: "review_open" });
    const spawner = fakeSpawner();
    const stopper = fakeStopper(server);
    const handler = createReviewOpenHandler({
      startViewer: spawner.startViewer,
      stopViewer: stopper.stopViewer,
      cliVersion: "0.7.0",
      pollMs: 10,
    });
    const result = parse(await handler({ rootPath }));
    expect(result.reused).toBe(true);
    expect(result).not.toHaveProperty("outdated");
    expect(stopper.stopped).toHaveLength(0);
  });

  it("restart: true replaces the running viewer, whoever started it and whatever its version", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const { record, server } = await runningViewer("0.7.0", { startedBy: "cli", token: null });
    const spawner = fakeSpawner(null);
    const stopper = fakeStopper(server);
    const handler = createReviewOpenHandler({
      startViewer: spawner.startViewer,
      stopViewer: stopper.stopViewer,
      cliVersion: "0.7.0",
      pollMs: 10,
    });
    const result = parse(await handler({ rootPath, restart: true }));
    expect(result).toMatchObject({ reused: false, replaced: { pid: record.pid, cliVersion: "0.7.0", reason: "restart" } });
    expect(stopper.stopped).toHaveLength(1);
    // No auth on the old one: no token to carry over.
    expect(spawner.options).toEqual([{ port: record.port }]);
  });

  it("replaces an older viewer once for two calls made at once", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    const { server } = await runningViewer("0.1.0", { startedBy: "review_open" });
    const spawner = fakeSpawner();
    const stopper = fakeStopper(server);
    const handler = createReviewOpenHandler({
      startViewer: spawner.startViewer,
      stopViewer: stopper.stopViewer,
      cliVersion: getCliVersion(),
      pollMs: 10,
    });
    const [a, b] = await Promise.all([handler({ rootPath }), handler({ rootPath })]);
    expect(parse(a).port).toBe(parse(b).port);
    expect(stopper.stopped).toHaveLength(1);
    expect(spawner.calls).toHaveLength(1);
  });
});

describe("viewerIdleHours", () => {
  it("is 24 hours unless DR_VIEWER_IDLE_HOURS says otherwise, and 0 means never", () => {
    expect(viewerIdleHours({})).toBe(24);
    expect(viewerIdleHours({ DR_VIEWER_IDLE_HOURS: "72" })).toBe(72);
    expect(viewerIdleHours({ DR_VIEWER_IDLE_HOURS: "0" })).toBe(0);
    expect(viewerIdleHours({ DR_VIEWER_IDLE_HOURS: "" })).toBe(24);
    expect(viewerIdleHours({ DR_VIEWER_IDLE_HOURS: "soon" })).toBe(24);
    expect(viewerIdleHours({ DR_VIEWER_IDLE_HOURS: "-3" })).toBe(24);
  });
});

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}
