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
import { createReviewOpenHandler, type StartedViewer } from "../../../src/mcp/tools/review-open.js";
import { followClientRoots, resetProjectRoot } from "../../../src/mcp/project-root.js";
import {
  DR_STATE_DIR_ENV,
  readViewerRecord,
  readViewerStarting,
  viewerRecordPath,
  writeViewerRecord,
} from "../../../src/server/viewer-registry.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

let scratch: string;
let rootPath: string;
let savedStateDir: string | undefined;
const servers: Server[] = [];

/** A stand-in viewer: answers /health on a real port. */
async function fakeViewerServer(): Promise<number> {
  const server = createServer((req, res) => {
    res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
}

/** A spawner that "starts" a viewer: a health server plus the record dr visualize would write. */
function fakeSpawner(token: string | null = "tok-123") {
  const calls: string[] = [];
  const startViewer = async (projectRoot: string): Promise<StartedViewer> => {
    calls.push(projectRoot);
    const port = await fakeViewerServer();
    // dr visualize writes its record a little after it starts.
    setTimeout(() => {
      void writeViewerRecord({
        pid: process.pid,
        port,
        token,
        projectRoot,
        startedAt: new Date().toISOString(),
        withChangesets: true,
      });
    }, 30);
    return { pid: process.pid, exited: new Promise(() => {}) };
  };
  return { calls, startViewer };
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
    expect(spawner.calls).toHaveLength(1);
    expect((await readViewerRecord(rootPath))?.pid).toBe(process.pid);
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
      expect(await readViewerRecord(rootPath)).toBeTruthy();
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
    expect((await stat(viewerRecordPath(rootPath))).mode & 0o777).toBe(0o600);
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
    const handler = createReviewOpenHandler({ startViewer: spawner.startViewer, pollMs: 10 });

    const result = await handler({ rootPath });
    expect(result.isError).toBe(true);
    const error = parse(result);
    expect(error.error).toContain(`pid ${process.pid}`);
    expect(error.error).toContain("does not answer");
    expect(error.suggestions.join(" ")).toContain(`kill ${process.pid}`);
    expect(spawner.calls).toHaveLength(0);
    expect((await readViewerRecord(rootPath))?.port).toBe(closedPort);
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
