/**
 * review_open end to end: `dr mcp` (run from a directory that is not the project) starts a real
 * detached `dr visualize` for the project, records it in the user state dir, and reuses it on
 * the next call. The viewer is stopped afterwards.
 *
 * Needs the built CLI and the viewer bundle (`npm run build` downloads it); skipped without them.
 * REQUIRES SERIAL EXECUTION: starts a real server on a live port.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { viewerRecordPath } from "../../src/server/viewer-registry.js";
import { portAllocator, stopServerProcess } from "../helpers.ts";

const CLI_ROOT = join(import.meta.dir, "../..");
const CLI_PATH = join(CLI_ROOT, "dist/cli.js");
const VIEWER_INDEX = join(CLI_ROOT, "dist/viewer/index.html");
const PROTOCOL_VERSION = "2025-06-18";
const ready = existsSync(CLI_PATH) && existsSync(VIEWER_INDEX);

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe.skipIf(!ready).serial("review_open with a real dr visualize", () => {
  let scratch: string;
  let projectDir: string;
  let stateDir: string;
  let mcp: ChildProcessWithoutNullStreams;
  let stdout = "";
  let stderr = "";
  let nextId = 1;
  const viewerPids = new Set<number>();

  async function call(name: string, args: Record<string, unknown>, timeoutMs = 30000): Promise<any> {
    const id = ++nextId;
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === id) {
            expect(message.error).toBeUndefined();
            return message.result;
          }
        } catch {
          // Partial line.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`No answer to ${name}. stderr: ${stderr}`);
  }

  beforeAll(async () => {
    scratch = join(tmpdir(), `dr-review-open-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    projectDir = join(scratch, "project");
    stateDir = join(scratch, "state");
    await mkdir(projectDir, { recursive: true });
    const init = spawnSync(process.execPath, [CLI_PATH, "init", "--name", "Review Open E2E"], { cwd: projectDir });
    if (init.status !== 0) throw new Error(`dr init failed: ${init.stderr?.toString()}`);

    // The MCP server runs from the scratch dir, not the project.
    mcp = spawn("node", [CLI_PATH, "mcp"], {
      cwd: scratch,
      // No process scan: review_open's restart must confirm a viewer through its own /health, and
      // nothing this test runs reads or signals the machine's other processes.
      env: {
        ...process.env,
        DR_STATE_DIR: stateDir,
        DR_CONFIG_PATH: join(scratch, ".dr-config.yaml"),
        DR_VIEWER_PROCESS_SCAN: "off",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    mcp.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    mcp.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    mcp.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "e2e", version: "1" } },
      })}\n`
    );
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  }, 30000);

  /** Every viewer pid this test's state dir knows of: records and "starting" markers. */
  async function recordedViewerPids(): Promise<number[]> {
    const dir = join(stateDir, "viewers");
    const pids: number[] = [];
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!name.endsWith(".json") && !name.endsWith(".starting")) continue;
      try {
        const pid = JSON.parse(await readFile(join(dir, name), "utf8")).pid;
        if (Number.isInteger(pid)) pids.push(pid);
      } catch {
        // Half-written or gone.
      }
    }
    return pids;
  }

  /** Kills every viewer the test started (its process group: dr visualize and its server). */
  async function killViewers(): Promise<void> {
    const pids = new Set([...viewerPids, ...(await recordedViewerPids())]);
    for (const pid of pids) {
      for (const target of [-pid, pid]) {
        try {
          process.kill(target, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
    viewerPids.clear();
  }

  afterEach(killViewers);

  afterAll(async () => {
    await killViewers();
    mcp?.kill("SIGKILL");
    await rm(scratch, { recursive: true, force: true });
  });

  it("starts a viewer for the project, links to the changeset, reuses it, and is cleaned up on exit", async () => {
    const created = JSON.parse(
      (await call("changeset_create", { name: "export-orders", rootPath: projectDir })).content[0].text
    );

    const first = await call("review_open", { rootPath: projectDir }, 90000);
    // Learn the viewer's pid before any assertion, so a failure still stops it (afterEach).
    for (const pid of await recordedViewerPids()) viewerPids.add(pid);
    expect(first.isError).toBeUndefined();
    const opened = JSON.parse(first.content[0].text);
    expect(opened).toMatchObject({ reused: false, changesetId: created.id, changesetName: "export-orders" });

    // One record, named for the viewer's own pid.
    const [viewerPid] = await recordedViewerPids();
    const recordPath = viewerRecordPath(projectDir, viewerPid, { DR_STATE_DIR: stateDir });
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    viewerPids.add(record.pid);
    expect((await stat(recordPath)).mode & 0o777).toBe(0o600);
    expect(record).toMatchObject({ pid: viewerPid, port: opened.port, withChangesets: true });
    // It says who started it, which CLI runs it, and that it ends after a day idle (#1237).
    expect(record).toMatchObject({ startedBy: "review_open", idleExitHours: 24 });
    expect(record.cliVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(isAlive(record.serverPid)).toBe(true);
    expect(typeof record.token).toBe("string");
    expect(opened.url).toBe(
      `http://localhost:${opened.port}/?token=${record.token}#/changesets/list?changeset=${created.id}`
    );

    // The viewer serves the project and the changeset the link names.
    expect((await fetch(`http://localhost:${opened.port}/`)).status).toBe(200);
    const changesets = await fetch(`http://localhost:${opened.port}/api/changesets`, {
      headers: { Authorization: `Bearer ${record.token}` },
    });
    expect(changesets.status).toBe(200);
    expect(JSON.stringify(await changesets.json())).toContain(created.id);

    const second = JSON.parse((await call("review_open", { changeset: "export-orders", rootPath: projectDir })).content[0].text);
    expect(second).toMatchObject({ reused: true, port: opened.port, url: opened.url });

    // Stopping the viewer removes its record.
    process.kill(-record.pid, "SIGTERM");
    expect(await waitFor(() => !isAlive(record.pid), 10000)).toBe(true);
    expect(existsSync(recordPath)).toBe(false);
  }, 150000);

  it("keeps track of two viewers for one project when a third dies uncleanly (#1237)", async () => {
    // --list and --stop read this test's registry only, never the machine's process table: every
    // viewer is confirmed by its own /health (its id and pids), as on a machine without ps.
    const env = { ...process.env, DR_STATE_DIR: stateDir, DR_VIEWER_PROCESS_SCAN: "off" };
    const root = await realpath(projectDir);
    const started: ReturnType<typeof spawn>[] = [];
    /** A `dr visualize` run by hand in the project folder; resolves once it has recorded itself. */
    const startByHand = async (): Promise<{ proc: ReturnType<typeof spawn>; port: number; serverPid: number }> => {
      const port = await portAllocator.allocatePort();
      const proc = spawn("node", [CLI_PATH, "visualize", "--no-browser", "--no-auth", "--exit-with-parent", "--port", String(port)], {
        cwd: projectDir,
        env,
        stdio: "ignore",
      });
      started.push(proc);
      const recordPath = viewerRecordPath(projectDir, proc.pid!, { DR_STATE_DIR: stateDir });
      expect(await waitFor(() => existsSync(recordPath), 30000)).toBe(true);
      const record = JSON.parse(await readFile(recordPath, "utf8"));
      expect(record.port).toBe(port);
      return { proc, port, serverPid: record.serverPid };
    };
    const list = (): Array<{ projectRoot: string; port: number; pid: number; inRegistry: boolean; answering: boolean; confirmed: { by: string } | null }> => {
      const result = spawnSync("node", [CLI_PATH, "--json", "visualize", "--list"], { cwd: scratch, env, encoding: "utf8" });
      expect(result.status).toBe(0);
      // The process table was read, so the list is not limited to what the registry records.
      const listed = JSON.parse(result.stdout);
      // It says what it leaves out, and claims nothing more.
      expect(listed).not.toHaveProperty("complete");
      expect(listed.processScan).toEqual({ available: false, why: "disabled" });
      expect(listed.caveats).toHaveLength(1);
      expect(listed.caveats[0]).toContain("The process scan is turned off (DR_VIEWER_PROCESS_SCAN)");
      // Every viewer on the machine is listed; this test looks only at its own project's.
      return JSON.parse(result.stdout).viewers.filter((viewer: { projectRoot: string }) => viewer.projectRoot === root);
    };

    try {
      // Viewer one: review_open's.
      await call("changeset_create", { name: "two-viewers", rootPath: projectDir });
      const opened = JSON.parse((await call("review_open", { rootPath: projectDir }, 90000)).content[0].text);
      for (const pid of await recordedViewerPids()) viewerPids.add(pid);
      expect(opened.reused).toBe(false);

      // Viewer two: someone's `dr visualize` in the same folder. Before 0.7.0 this replaced
      // the first one's record.
      const second = await startByHand();
      // Viewer three: short-lived, and killed before it could clean up.
      const third = await startByHand();
      third.proc.kill("SIGKILL");
      expect(await waitFor(() => third.proc.exitCode !== null || third.proc.signalCode !== null, 5000)).toBe(true);
      // Its server notices the launcher is gone and exits, freeing the port.
      expect(await waitFor(() => !isAlive(third.serverPid), 15000)).toBe(true);

      // The list finds both live viewers, and the dead one's record is gone.
      const listed = list();
      expect(listed.map((viewer) => viewer.port).sort()).toEqual([opened.port, second.port].sort());
      expect(listed.every((viewer) => viewer.inRegistry && viewer.answering)).toBe(true);
      // Each viewer named itself on /health, which is what lets --stop signal it with no process table.
      expect(listed.map((viewer: any) => viewer.confirmed?.by)).toEqual(["health", "health"]);
      expect(existsSync(viewerRecordPath(projectDir, third.proc.pid!, { DR_STATE_DIR: stateDir }))).toBe(false);

      // review_open still reuses its own viewer.
      const again = JSON.parse((await call("review_open", { rootPath: projectDir })).content[0].text);
      expect(again).toMatchObject({ reused: true, port: opened.port, url: opened.url });
      expect(again.outdated).toBeUndefined();

      // --stop <project> stops both and waits for them.
      const stop = spawnSync("node", [CLI_PATH, "--json", "visualize", "--stop", projectDir], { cwd: scratch, env, encoding: "utf8" });
      expect(stop.status).toBe(0);
      const summary = JSON.parse(stop.stdout);
      expect(summary).toMatchObject({ matched: 2, stopped: 2, notStopped: [], unrecordedLeft: [] });
      expect(summary.found).toBeGreaterThanOrEqual(2);
      const stopped = summary.results as Array<{ viewer: { port: number; pid: number }; outcome: string }>;
      expect(stopped.map((entry) => entry.viewer.port).sort()).toEqual([opened.port, second.port].sort());
      expect(stopped.every((entry) => entry.outcome === "stopped")).toBe(true);
      // (The one this test started is collected once the event loop turns: spawnSync held it.)
      expect(await waitFor(() => stopped.every((entry) => !isAlive(entry.viewer.pid)), 5000)).toBe(true);
      expect(list()).toEqual([]);
      expect((await readdir(join(stateDir, "viewers"))).filter((name) => name.endsWith(".json"))).toEqual([]);
    } finally {
      for (const proc of started) await stopServerProcess(proc);
    }
  }, 240000);

  it("restart: true replaces the viewer and keeps its port and token, so the link still opens", async () => {
    const created = JSON.parse((await call("changeset_create", { name: "restart", rootPath: projectDir })).content[0].text);
    const opened = JSON.parse((await call("review_open", { rootPath: projectDir }, 90000)).content[0].text);
    const [firstPid] = await recordedViewerPids();
    viewerPids.add(firstPid);
    const first = JSON.parse(await readFile(viewerRecordPath(projectDir, firstPid, { DR_STATE_DIR: stateDir }), "utf8"));

    const restarted = JSON.parse(
      (await call("review_open", { rootPath: projectDir, restart: true }, 90000)).content[0].text
    );
    for (const pid of await recordedViewerPids()) viewerPids.add(pid);
    expect(restarted).toMatchObject({
      reused: false,
      port: opened.port,
      url: opened.url,
      replaced: { pid: firstPid, port: opened.port, reason: "restart" },
    });

    // The old launcher and its server are gone; one viewer is recorded, a new one.
    expect(isAlive(firstPid)).toBe(false);
    expect(isAlive(first.serverPid)).toBe(false);
    const pids = await recordedViewerPids();
    expect(pids).toHaveLength(1);
    expect(pids[0]).not.toBe(firstPid);
    // The link given before the restart is served by the new viewer.
    const token = new URL(opened.url).searchParams.get("token");
    const changesets = await fetch(`http://localhost:${opened.port}/api/changesets`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(changesets.status).toBe(200);
    expect(JSON.stringify(await changesets.json())).toContain(created.id);
  }, 240000);

  it("starts the viewer on another port when another server holds 8080 on every interface", async () => {
    // What the validators hit: another project's viewer on *:8080. If something on this machine
    // already holds 8080, that does just as well.
    const holder = createServer();
    const holding = await new Promise<boolean>((resolve) => {
      holder.once("error", () => resolve(false));
      holder.listen(8080, "::", () => resolve(true));
    });
    try {
      await call("changeset_create", { name: "port-clash", rootPath: projectDir });
      const result = await call("review_open", { rootPath: projectDir }, 90000);
      for (const pid of await recordedViewerPids()) viewerPids.add(pid);
      expect(result.isError).toBeUndefined();
      const opened = JSON.parse(result.content[0].text);
      expect(opened.port).not.toBe(8080);
      expect((await fetch(`http://localhost:${opened.port}/health`)).status).toBe(200);
    } finally {
      if (holding) await new Promise((resolve) => holder.close(resolve));
    }
  }, 150000);
});
