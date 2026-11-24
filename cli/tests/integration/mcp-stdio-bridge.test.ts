/**
 * `dr mcp` over stdio as the bridge to the central process (#1279, slice 3A), end to end: the
 * built CLI on a scratch farm (DR_STATE_DIR, DR_FARM_PATH and XDG_CONFIG_HOME in temp dirs). Two
 * bridges start at once, one following its client's roots and one pinned with DR_MCP_ROOT_PATH;
 * they share one real `dr serve` process that the first of them started, each resolving its own
 * checkout. Closing them ends their sessions; `dr serve --stop` ends the process.
 * (`application.applicationcomponent.mcp-stdio-bridge`)
 *
 * REQUIRES SERIAL EXECUTION: starts a real process on a live port.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { FarmManifest } from "../../src/core/farm-manifest.js";
import { ProjectRegistry } from "../../src/core/project-registry.js";
import { readServerRecord, readServerToken } from "../../src/server/server-record.js";
import { isProcessAlive } from "../../src/utils/process-liveness.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";

const CLI_PATH = path.join(import.meta.dir, "../../dist/cli.js");
const ready = existsSync(CLI_PATH) && existsSync(path.join(import.meta.dir, "../../dist/serve-entry.js"));

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: GIT_ENV, stdio: "pipe", encoding: "utf-8" });
}

async function modelRepo(dir: string): Promise<string> {
  const workdir = await createTestWorkdir();
  execFileSync("cp", ["-R", workdir.path, dir]);
  await workdir.cleanup();
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "model");
  return realpath(dir);
}

describe.skipIf(!ready).serial("dr mcp: the stdio bridge to the central process", () => {
  let scratch: string;
  let farmRoot: string;
  let alpha: string;
  let beta: string;
  let env: Record<string, string>;
  const clients: Client[] = [];

  async function bridge(options: { roots?: string[]; pin?: string }): Promise<{ client: Client; stderr: () => string }> {
    const transport = new StdioClientTransport({
      command: "node",
      args: [CLI_PATH, "mcp"],
      cwd: scratch,
      env: { ...env, ...(options.pin ? { DR_MCP_ROOT_PATH: options.pin } : {}) },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
    const client = new Client({ name: "bridge-test", version: "1.0.0" }, { capabilities: options.roots ? { roots: {} } : {} });
    if (options.roots) {
      const roots = options.roots;
      client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: roots.map((r) => ({ uri: pathToFileURL(r).href })) }));
    }
    await client.connect(transport);
    clients.push(client);
    return { client, stderr: () => stderr };
  }

  const toolJson = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const result: any = await client.callTool({ name, arguments: args });
    return JSON.parse(result.content[0].text);
  };

  beforeAll(async () => {
    scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), "dr-bridge-")));
    alpha = await modelRepo(path.join(scratch, "alpha"));
    beta = await modelRepo(path.join(scratch, "beta"));
    farmRoot = path.join(scratch, "farm");
    await mkdir(farmRoot);
    const file = path.join(farmRoot, "farm.yaml");
    await FarmManifest.create("bridge-test").save(file);
    const registry = ProjectRegistry.fromManifest({ root: farmRoot, file, source: "env" }, await FarmManifest.load(file));
    await registry.registerProject(alpha, { name: "alpha" });
    await registry.registerProject(beta, { name: "beta" });

    env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
    for (const key of ["DR_MCP_ROOT_PATH", "DR_MCP_IN_PROCESS", "DR_CHAT_MODE", "DR_CHANGESET_ONLY", "DR_SERVE_TEST_STARTER"]) delete env[key];
    Object.assign(env, {
      DR_STATE_DIR: path.join(scratch, "state"),
      DR_FARM_PATH: farmRoot,
      XDG_CONFIG_HOME: path.join(scratch, "config"),
      DR_VIEWER_PROCESS_SCAN: "off",
    });
  }, 60_000);

  afterAll(async () => {
    for (const client of clients.splice(0)) await client.close().catch(() => {});
    spawnSync("node", [CLI_PATH, "serve", "--stop"], { cwd: farmRoot, env, encoding: "utf8", timeout: 30_000 });
    const record = await readServerRecord(farmRoot, env);
    if (record && isProcessAlive(record.pid)) process.kill(record.pid, "SIGKILL");
    await rm(scratch, { recursive: true, force: true });
  });

  it("starts one central process for two bridges, each session in its own checkout", async () => {
    const [byRoots, pinned] = await Promise.all([bridge({ roots: [alpha] }), bridge({ roots: [alpha], pin: beta })]);

    const record = await readServerRecord(farmRoot, env);
    expect(record).not.toBeNull();
    expect(isProcessAlive(record!.pid)).toBe(true);

    const [a, b] = await Promise.all([toolJson(byRoots.client, "model_info"), toolJson(pinned.client, "model_info")]);
    expect([a.project, a.checkout]).toEqual(["alpha", "main"]);
    expect([b.project, b.checkout]).toEqual(["beta", "main"]);

    // A plan made through one bridge is in its checkout only.
    await toolJson(byRoots.client, "changeset_create", { name: "alpha-plan" });
    expect(JSON.stringify(await toolJson(pinned.client, "changeset_list"))).not.toContain("alpha-plan");
    expect(JSON.stringify(await toolJson(byRoots.client, "changeset_list"))).toContain("alpha-plan");

    // Both are sessions of the one process, which /health reports with the token.
    const token = await readServerToken(record!);
    const health: any = await (await fetch(`http://127.0.0.1:${record!.port}/health`, { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(health.pid).toBe(record!.pid);
    expect(health.mcpSessions).toBe(2);
    expect((await readServerRecord(farmRoot, env))!.pid).toBe(record!.pid);

    // Closing a bridge ends its session.
    await byRoots.client.close();
    clients.splice(clients.indexOf(byRoots.client), 1);
    let sessions = 2;
    for (let i = 0; i < 50 && sessions !== 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const h: any = await (await fetch(`http://127.0.0.1:${record!.port}/health`, { headers: { Authorization: `Bearer ${token}` } })).json();
      sessions = h.mcpSessions;
    }
    expect(sessions).toBe(1);
  }, 90_000);

  it("reconnects when the central process is replaced, replaying the client's initialize", async () => {
    const { client } = await bridge({ roots: [beta] });
    expect((await toolJson(client, "model_info")).project).toBe("beta");
    const before = (await readServerRecord(farmRoot, env))!;

    const stop = spawnSync("node", [CLI_PATH, "serve", "--stop"], { cwd: farmRoot, env, encoding: "utf8", timeout: 30_000 });
    expect(stop.status, stop.stderr + stop.stdout).toBe(0);

    const after = await toolJson(client, "model_info");
    expect([after.project, after.checkout]).toEqual(["beta", "main"]);
    const restarted = (await readServerRecord(farmRoot, env))!;
    expect(restarted.pid).not.toBe(before.pid);
  }, 90_000);

  it("dr mcp --http prints the central process's endpoint and token file", async () => {
    const result = spawnSync("node", [CLI_PATH, "mcp", "--http"], { cwd: scratch, env, encoding: "utf8", timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0);
    const record = (await readServerRecord(farmRoot, env))!;
    expect(result.stdout).toContain(`http://127.0.0.1:${record.port}/mcp`);
    expect(result.stdout).toContain(record.tokenPath);
  }, 60_000);
});
