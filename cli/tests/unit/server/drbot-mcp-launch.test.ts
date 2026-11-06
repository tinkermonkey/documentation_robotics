/**
 * DrBot on MCP, end to end through launchClaudeCodeChat: the MCP config is prepared (with a fake
 * key and scratch dirs), passed to claude, and removed once the agent process exits; a stale
 * installed dr-architect agent or a failed preparation launches without MCP; concurrent launches
 * share one key resolution. The mock-claude-stream fixture stands in for the claude binary.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Model } from "../../../src/core/model.js";
import { VisualizationServer } from "../../../src/server/server.js";
import { createFakeWs, waitFor } from "./helpers.js";

const mockClaude = join(import.meta.dir, "../../fixtures/mock-claude-stream.cjs");
const KEY = "dr-mcp-launch-test-key";

let scratch: string;

beforeAll(async () => {
  scratch = join(tmpdir(), `dr-drbot-launch-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

interface Fixture {
  server: VisualizationServer;
  rootPath: string;
  tempRoot: string;
  keyCalls: () => number;
}

async function createServer(
  options: { failKey?: boolean; agentTools?: string; slowKeyMs?: number } = {}
): Promise<Fixture> {
  const base = join(scratch, randomUUID());
  const rootPath = join(base, "project");
  const tempRoot = join(base, "tmp");
  const homeDir = join(base, "home");
  await mkdir(rootPath, { recursive: true });
  await mkdir(tempRoot, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  const model = await Model.init(rootPath, { name: "DrBot Launch Test", version: "0.1.0" }, { lazyLoad: false });

  if (options.agentTools !== undefined) {
    await mkdir(join(rootPath, ".claude", "agents"), { recursive: true });
    await writeFile(
      join(rootPath, ".claude", "agents", "dr-architect.md"),
      `---\nname: dr-architect\ntools: ${options.agentTools}\n---\n\nBody\n`
    );
  }

  let calls = 0;
  const keyManager = {
    ensureKey: async () => {
      calls++;
      if (options.slowKeyMs) await new Promise((resolve) => setTimeout(resolve, options.slowKeyMs));
      if (options.failKey) throw new Error("no key for you");
      return { key: KEY, path: "/nowhere/.dr-mcp-key", isNew: false };
    },
  };

  const server = new VisualizationServer(model, {
    authEnabled: false,
    withChangesets: true,
  });
  (server as any)._testClaudeCmdOverride = ["node", mockClaude];
  (server as any)._testDrMcpOptions = {
    keyManager,
    tempRoot,
    homeDir,
    drCommand: { command: "dr", args: [] },
  };
  return { server, rootPath, tempRoot, keyCalls: () => calls };
}

async function chat(server: VisualizationServer, requestId: string): Promise<any> {
  const ws = createFakeWs();
  await (server as any).launchClaudeCodeChat(ws, `conv-${randomUUID()}`, "hello", requestId);
  return waitFor(() => ws.sent.find((m) => m.id === requestId && m.result));
}

function valueOf(cmd: string[], flag: string): string | undefined {
  const index = cmd.indexOf(flag);
  return index === -1 ? undefined : cmd[index + 1];
}

describe("launchClaudeCodeChat with the dr MCP server", () => {
  it("passes the prepared MCP config to claude and removes it after the agent exits", async () => {
    const { server, tempRoot } = await createServer();
    const completion = await chat(server, "req-mcp");
    expect(completion.result.status).toBe("complete");

    const args: string[] = (server as any)._testLastClaudeChatArgs;
    const configPath = valueOf(args, "--mcp-config");
    expect(configPath).toBeDefined();
    expect(configPath!.startsWith(tempRoot)).toBe(true);
    expect(valueOf(args, "--allowedTools")).toContain("mcp__dr__changeset_create");
    expect(valueOf(args, "--append-system-prompt")).toContain("changeset_create");

    // Cleanup runs on the child's exit event; give the async rm a moment.
    await waitFor(() => !existsSync(configPath!) && readdirSync(tempRoot).length === 0);
    server.stop();
  });

  it("launches without MCP (and keeps chatting) when the config can't be prepared", async () => {
    const { server, tempRoot } = await createServer({ failKey: true });
    const completion = await chat(server, "req-nokey");
    expect(completion.result.status).toBe("complete");

    const args: string[] = (server as any)._testLastClaudeChatArgs;
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--append-system-prompt");
    expect(readdirSync(tempRoot)).toEqual([]);
    server.stop();
  });

  it("skips MCP and warns once when the installed dr-architect agent can't see the dr tools", async () => {
    const { server, tempRoot, keyCalls } = await createServer({
      agentTools: "Bash, Read, Edit, Write",
    });
    await chat(server, "req-stale-1");
    await chat(server, "req-stale-2");

    const args: string[] = (server as any)._testLastClaudeChatArgs;
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--append-system-prompt");
    expect(keyCalls()).toBe(0);
    expect(readdirSync(tempRoot)).toEqual([]);

    const warnings = [...(server as any).drBotWarnings] as string[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("dr claude upgrade");
    server.stop();
  });

  it("connects MCP but warns about the tools a partly current agent leaves out", async () => {
    const { server } = await createServer({
      agentTools: "Bash, mcp__dr__model_search, mcp__dr__model_show",
    });
    await chat(server, "req-partial");

    const args: string[] = (server as any)._testLastClaudeChatArgs;
    expect(args).toContain("--mcp-config");
    const warnings = [...(server as any).drBotWarnings] as string[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("mcp__dr__changeset_create");
    expect(warnings[0]).not.toContain("mcp__dr__model_search,");
    server.stop();
  });

  it("shares one key resolution between concurrent launches", async () => {
    const { server, tempRoot, keyCalls } = await createServer({
      slowKeyMs: 50,
    });
    const [a, b] = await Promise.all([chat(server, "req-a"), chat(server, "req-b")]);
    expect(a.result.status).toBe("complete");
    expect(b.result.status).toBe("complete");
    expect(keyCalls()).toBe(1);

    // Once settled, the next launch resolves the key afresh (a rotated key is picked up).
    await chat(server, "req-c");
    expect(keyCalls()).toBe(2);
    await waitFor(() => readdirSync(tempRoot).length === 0);
    server.stop();
  });
});
