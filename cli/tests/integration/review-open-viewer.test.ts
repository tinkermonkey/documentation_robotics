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
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { viewerRecordPath } from "../../src/server/viewer-registry.js";

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
      env: { ...process.env, DR_STATE_DIR: stateDir, DR_CONFIG_PATH: join(scratch, ".dr-config.yaml") },
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

    const recordPath = viewerRecordPath(projectDir, { DR_STATE_DIR: stateDir });
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    viewerPids.add(record.pid);
    expect((await stat(recordPath)).mode & 0o777).toBe(0o600);
    expect(record).toMatchObject({ port: opened.port, withChangesets: true });
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
