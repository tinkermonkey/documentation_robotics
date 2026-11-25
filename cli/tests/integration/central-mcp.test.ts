/**
 * MCP on the central process (#1279, slice 3A): `/mcp` behind the one token, each session
 * resolving its own checkout through the registry. Two projects of real git repositories, one
 * with a linked worktree, and MCP clients over streamable HTTP:
 *
 * - sessions in two checkouts of one project and in a second project each see their own model,
 *   at the same time, and a write in one never shows in another;
 * - the X-DR-MCP-Root-Path header (DR_MCP_ROOT_PATH through the bridge) pins a session ahead of
 *   its client's roots;
 * - every result names its project and checkout, a rootPath call the checkout rootPath is in;
 * - an unregistered root gets its repository registered;
 * - `activity().mcpSessions` counts open sessions; no token, no MCP.
 * (`testing.testcasesketch.mcp-root-resolution`)
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { FarmManifest } from "../../src/core/farm-manifest.js";
import { ProjectRegistry, type FarmLocation } from "../../src/core/project-registry.js";
import { MCP_ROOT_PATH_HEADER, MCP_SESSION_ENV_HEADER, encodeSessionEnv } from "../../src/mcp/central-mcp.js";
import { startCentralServerWith } from "../../src/server/central-server.js";
import { bridgeHeaders } from "../../src/mcp/stdio-bridge.js";
import type { CentralServer } from "../../src/server/central-server-contract.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";

const TOKEN = "dr-central-mcp-test-token";

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

/** A golden-model copy at `dir`, committed as a git repository on main. */
async function modelRepo(dir: string): Promise<string> {
  const workdir = await createTestWorkdir();
  execFileSync("cp", ["-R", workdir.path, dir]);
  await workdir.cleanup();
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "model");
  return realpath(dir);
}

interface Session {
  client: Client;
  transport: StreamableHTTPClientTransport;
}

/** The JSON a tool result carries, with its `_meta`. */
function parse(result: any): any {
  const text = result.content?.[0]?.text;
  return { ...JSON.parse(text), _meta: result._meta };
}

describe("MCP on the central process", () => {
  let tmp: string;
  let farm: FarmLocation;
  let registry: ProjectRegistry;
  let alpha: string;
  let feature: string;
  let beta: string;
  let server: CentralServer;
  const open: Session[] = [];

  /** An MCP session; `roots` are what the client answers roots/list with. */
  async function connect(
    options: { roots?: string[]; pin?: string; env?: Record<string, string>; token?: string; bridged?: boolean } = {}
  ): Promise<Session> {
    const headers: Record<string, string> = options.bridged
      ? bridgeHeaders(options.token ?? TOKEN, {})
      : { Authorization: `Bearer ${options.token ?? TOKEN}` };
    if (options.pin) headers[MCP_ROOT_PATH_HEADER] = encodeURIComponent(options.pin);
    if (options.env) headers[MCP_SESSION_ENV_HEADER] = encodeSessionEnv(options.env);
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
      requestInit: { headers },
    });
    const client = new Client({ name: "central-mcp-test", version: "1.0.0" }, { capabilities: options.roots ? { roots: { listChanged: true } } : {} });
    if (options.roots) {
      const roots = options.roots;
      client.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: roots.map((root) => ({ uri: pathToFileURL(root).href })),
      }));
    }
    await client.connect(transport);
    const session = { client, transport };
    open.push(session);
    return session;
  }

  const call = async (session: Session, name: string, args: Record<string, unknown> = {}) =>
    parse(await session.client.callTool({ name, arguments: args }));

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), "dr-central-mcp-")));
    alpha = await modelRepo(path.join(tmp, "alpha"));
    beta = await modelRepo(path.join(tmp, "beta"));
    git(alpha, "worktree", "add", "-q", path.join(tmp, "feature"), "-b", "feature");
    feature = await realpath(path.join(tmp, "feature"));

    const root = path.join(tmp, "farm");
    await mkdir(root);
    const file = path.join(root, "farm.yaml");
    await FarmManifest.create("central-mcp-test").save(file);
    farm = { root, file, source: "folder" };
    registry = ProjectRegistry.fromManifest(farm, await FarmManifest.load(file));
    await registry.registerProject(alpha, { name: "alpha" });
    await registry.registerProject(beta, { name: "beta" });

    server = await startCentralServerWith(
      { farm, registry, port: 0, token: TOKEN, serverId: "central-mcp-test", pool: { maxLoaded: 4, idleMinutes: 30 } },
      { defaultCheckout: { project: "alpha", checkout: "main" }, removalCheckMs: 0 }
    );
  }, 60_000);

  afterEach(async () => {
    for (const session of open.splice(0)) {
      await session.transport.terminateSession().catch(() => {});
      await session.client.close().catch(() => {});
    }
  });

  afterAll(async () => {
    await server?.stop();
    await rm(tmp, { recursive: true, force: true });
  });

  it("serves sessions in two checkouts of one project and a second project, each its own, at once", async () => {
    const main = await connect({ roots: [alpha] });
    const work = await connect({ roots: [path.join(feature, "documentation-robotics")] });
    const other = await connect({ roots: [beta] });

    // A plan staged in the worktree's session only.
    const created = await call(work, "changeset_create", { name: "feature-plan" });
    expect(created.project).toBe("alpha");
    expect(created.checkout).toBe("feature");

    const [inMain, inWork, inOther] = await Promise.all([
      call(main, "changeset_list"),
      call(work, "changeset_list"),
      call(other, "changeset_list"),
    ]);
    expect([inMain, inWork, inOther].map((r) => [r.project, r.checkout])).toEqual([
      ["alpha", "main"],
      ["alpha", "feature"],
      ["beta", "main"],
    ]);
    const names = (r: any) => JSON.stringify(r);
    expect(names(inWork)).toContain("feature-plan");
    expect(names(inMain)).not.toContain("feature-plan");
    expect(names(inOther)).not.toContain("feature-plan");

    // Every result also carries it in _meta, for a client that reads structured fields.
    expect(inOther._meta?.["dr/checkout"]).toEqual({ project: "beta", checkout: "main" });

    // The process never moved its working directory into any of them.
    expect(process.cwd()).not.toBe(feature);
    expect(server.activity().mcpSessions).toBe(3);
  }, 60_000);

  it("pins a session to DR_MCP_ROOT_PATH ahead of its client's roots", async () => {
    const pinned = await connect({ roots: [alpha], pin: beta });
    const stats = await call(pinned, "model_info");
    expect([stats.project, stats.checkout]).toEqual(["beta", "main"]);
  });

  it("names the checkout a rootPath call resolved to, whatever the session serves", async () => {
    const main = await connect({ roots: [alpha] });
    const elsewhere = await call(main, "model_info", { rootPath: feature });
    expect([elsewhere.project, elsewhere.checkout]).toEqual(["alpha", "feature"]);
  });

  it("serves the process's default checkout to a client without roots", async () => {
    const plain = await connect();
    const info = await call(plain, "model_info");
    expect([info.project, info.checkout]).toEqual(["alpha", "main"]);
  });

  it("registers the repository of a root no project owns", async () => {
    const gamma = await modelRepo(path.join(tmp, "gamma"));
    const fresh = await connect({ roots: [gamma] });
    const info = await call(fresh, "model_info");
    expect([info.project, info.checkout]).toEqual(["gamma", "main"]);
    expect((await registry.listProjects()).map((p) => p.name)).toContain("gamma");
  }, 30_000);

  it("runs a session under the limits its bridge sent (DrBot's chat mode)", async () => {
    const chat = await connect({ pin: alpha, env: { DR_CHAT_MODE: "read-safe", DR_CHAT_PROJECT_ROOT: alpha } });
    const refused = await chat.client.callTool({ name: "changeset_create", arguments: { name: "nope" } });
    expect(refused.isError).toBe(true);
    // Another session at the same time is not limited by it.
    const free = await connect({ roots: [beta] });
    const allowed = await call(free, "changeset_create", { name: "beta-plan" });
    expect(allowed.project).toBe("beta");
  });

  it("counts sessions as they open and close, and refuses a request without the token", async () => {
    const before = server.activity().mcpSessions;
    const one = await connect({ roots: [beta] });
    expect(server.activity().mcpSessions).toBe(before + 1);
    await one.transport.terminateSession();
    await one.client.close();
    open.splice(open.indexOf(one), 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.activity().mcpSessions).toBe(before);

    const refused = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(refused.status).toBe(401);
    await expect(connect({ token: "wrong" })).rejects.toThrow();
  });

  it("tells the bridge's sessions from clients connected straight to /mcp, which hold a restart (#1427)", async () => {
    const before = server.activity();
    const bridged = await connect({ roots: [beta], bridged: true });
    expect(server.activity().mcpSessions).toBe(before.mcpSessions + 1);
    expect(server.activity().directMcpSessions).toBe(before.directMcpSessions);
    const direct = await connect({ roots: [beta] });
    expect(server.activity().mcpSessions).toBe(before.mcpSessions + 2);
    expect(server.activity().directMcpSessions).toBe((before.directMcpSessions ?? 0) + 1);
    for (const session of [bridged, direct]) {
      await session.transport.terminateSession();
      await session.client.close();
      open.splice(open.indexOf(session), 1);
    }
  });

  it("answers GET and DELETE only for a session it knows, and a DELETE ends the session", async () => {
    const mcpUrl = `http://127.0.0.1:${server.port}/mcp`;
    const auth = { Authorization: `Bearer ${TOKEN}` };
    expect((await fetch(mcpUrl, { headers: { ...auth, accept: "text/event-stream" } })).status).toBe(400);
    expect((await fetch(mcpUrl, { method: "DELETE", headers: { ...auth, "mcp-session-id": "nope" } })).status).toBe(404);

    const session = await connect({ roots: [beta] });
    const id = session.transport.sessionId!;
    const count = server.activity().mcpSessions;
    const deleted = await fetch(mcpUrl, { method: "DELETE", headers: { ...auth, "mcp-session-id": id } });
    expect(deleted.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.activity().mcpSessions).toBe(count - 1);
    const after = await fetch(mcpUrl, {
      method: "POST",
      headers: { ...auth, "mcp-session-id": id, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(after.status).toBe(404);
  });
});
