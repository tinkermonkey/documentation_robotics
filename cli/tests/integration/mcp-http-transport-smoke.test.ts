/**
 * CI smoke test for `dr mcp --http` (#1279, slice 3A): it finds or starts the central DR process
 * for the farm and prints where that process serves MCP. The endpoint completes the MCP
 * initialize handshake with the process's token and refuses a request without it. Runs on a
 * scratch farm (DR_STATE_DIR, DR_FARM_PATH, XDG_CONFIG_HOME in temp dirs) and stops the process.
 *
 * REQUIRES SERIAL EXECUTION: starts a real process on a live port.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readServerRecord } from "../../src/server/server-record.js";
import { isProcessAlive } from "../../src/utils/process-liveness.js";

const CLI_PATH = join(import.meta.dir, "../../dist/cli.js");
const ready = existsSync(CLI_PATH) && existsSync(join(import.meta.dir, "../../dist/serve-entry.js"));

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1.0.0" } },
};

describe.skipIf(!ready).serial("dr mcp --http (smoke)", () => {
  let scratch: string;
  let farmRoot: string;
  let env: NodeJS.ProcessEnv;
  let url: string;
  let token: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "dr-mcp-http-"));
    farmRoot = join(scratch, "farm");
    await mkdir(farmRoot, { recursive: true });
    await writeFile(
      join(farmRoot, "farm.yaml"),
      `schema: dr-farm-v2\nname: mcp-http-smoke\ncreated: "2026-11-23T00:00:00.000Z"\nmodified: "2026-11-23T00:00:00.000Z"\nprojects: {}\n`
    );
    env = {
      ...process.env,
      DR_STATE_DIR: join(scratch, "state"),
      DR_FARM_PATH: farmRoot,
      XDG_CONFIG_HOME: join(scratch, "config"),
      DR_VIEWER_PROCESS_SCAN: "off",
    };
    delete env.DR_SERVE_TEST_STARTER;
    delete env.DR_MCP_IN_PROCESS;

    const result = spawnSync("node", [CLI_PATH, "mcp", "--http"], { cwd: scratch, env, encoding: "utf8", timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0);
    url = /http:\/\/127\.0\.0\.1:\d+\/mcp/.exec(result.stdout)![0];
    const record = (await readServerRecord(farmRoot, env))!;
    expect(result.stdout).toContain(record.tokenPath);
    token = (await readFile(record.tokenPath, "utf8")).trim();
  }, 90_000);

  afterAll(async () => {
    spawnSync("node", [CLI_PATH, "serve", "--stop"], { cwd: farmRoot, env, encoding: "utf8", timeout: 30_000 });
    const record = await readServerRecord(farmRoot, env);
    if (record && isProcessAlive(record.pid)) process.kill(record.pid, "SIGKILL");
    await rm(scratch, { recursive: true, force: true });
  });

  it("answers an initialize request with the process's token", async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(INITIALIZE),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeTruthy();
    expect(await response.text()).toContain("documentation-robotics");
  });

  it("refuses an initialize request without the token", async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(INITIALIZE),
    });
    expect(response.status).toBe(401);
  });

  it("finds the running process the second time instead of starting another", async () => {
    const before = (await readServerRecord(farmRoot, env))!;
    const again = spawnSync("node", [CLI_PATH, "mcp", "--http"], { cwd: scratch, env, encoding: "utf8", timeout: 60_000 });
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).not.toContain("started now");
    expect((await readServerRecord(farmRoot, env))!.pid).toBe(before.pid);
  }, 60_000);
});
