/**
 * DrBot on MCP, end to end through launchClaudeCodeChat: the MCP config is prepared (in scratch
 * dirs), passed to claude, and removed once the agent process exits; a stale installed
 * dr-architect agent gets the dr tools added; a failed preparation launches without MCP. Every
 * launch is told its permission mode. The mock-claude-stream fixture stands in for the claude binary.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Model } from "../../../src/core/model.js";
import { VisualizationServer } from "../../../src/server/server.js";
import { createFakeWs, createServerWithoutChatDetection, waitFor } from "./helpers.js";

const mockClaude = join(import.meta.dir, "../../fixtures/mock-claude-stream.cjs");

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
}

async function createServer(
  options: {
    failPrepare?: boolean;
    agentTools?: string;
    /** Gives the installed agent a description, which Claude Code needs to load it and --agents to pass it. */
    agentDescription?: string;
    bundledPath?: string | null;
    readOnly?: boolean;
  } = {}
): Promise<Fixture> {
  const base = join(scratch, randomUUID());
  const rootPath = join(base, "project");
  // A temp root under a missing directory makes preparing the MCP config fail.
  const tempRoot = options.failPrepare ? join(base, "missing", "tmp") : join(base, "tmp");
  const homeDir = join(base, "home");
  await mkdir(rootPath, { recursive: true });
  if (!options.failPrepare) await mkdir(tempRoot, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  const model = await Model.init(rootPath, { name: "DrBot Launch Test", version: "0.1.0" }, { lazyLoad: false });

  if (options.agentTools !== undefined) {
    await mkdir(join(rootPath, ".claude", "agents"), { recursive: true });
    await writeFile(
      join(rootPath, ".claude", "agents", "dr-architect.md"),
      `---\nname: dr-architect\n${options.agentDescription ? `description: ${options.agentDescription}\n` : ""}` +
        `tools: ${options.agentTools}\n---\n\nInstalled body\n`
    );
  }

  // The tests launch the chat directly; skip probing the real CLIs (see the helper).
  const server = createServerWithoutChatDetection(model, {
    authEnabled: false,
    withChangesets: !options.readOnly,
  });
  (server as any)._testClaudeCmdOverride = ["node", mockClaude];
  (server as any)._testDrMcpOptions = {
    tempRoot,
    homeDir,
    env: {},
    bundledPath: options.bundledPath,
    drCommand: { command: "dr", args: [] },
  };
  return { server, rootPath, tempRoot };
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
  it("hands claude the bundled dr-architect when no project or user copy would outrank the dr plugin's", async () => {
    const { server } = await createServer();
    await chat(server, "req-bundled-agent");

    const args: string[] = (server as any)._testLastClaudeChatArgs;
    expect(args.slice(0, 3)).toEqual(["claude", "--agent", "dr-architect"]);
    const agents = JSON.parse(valueOf(args, "--agents")!);
    expect(agents["dr-architect"].tools).toContain("mcp__dr__changeset_create");
    expect(JSON.stringify(agents)).not.toContain("mcp__plugin_dr_dr__");
    server.stop();
  });

  it("launches without --agents or MCP, and warns, when the bundled agent can't be passed", async () => {
    const broken = join(scratch, `broken-${randomUUID()}.md`);
    await writeFile(broken, "---\nname: dr-architect\ntools: mcp__dr\n---\nno description\n");
    const { server } = await createServer({ bundledPath: broken });
    await chat(server, "req-broken-bundled");

    const args: string[] = (server as any)._testLastClaudeChatArgs;
    expect(args).not.toContain("--agents");
    expect(args).not.toContain("--mcp-config");
    const warnings = [...(server as any).drBotWarnings] as string[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Could not pass the bundled dr-architect agent");
    server.stop();
  });

  it("leaves an installed project copy in charge (no --agents)", async () => {
    const { server } = await createServer({
      agentTools: "Bash, mcp__dr",
    });
    await chat(server, "req-project-agent");

    const args: string[] = (server as any)._testLastClaudeChatArgs;
    expect(args).not.toContain("--agents");
    expect(args).toContain("--mcp-config");
    server.stop();
  });

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
    const { server, tempRoot } = await createServer({ failPrepare: true });
    const completion = await chat(server, "req-noconfig");
    expect(completion.result.status).toBe("complete");

    const args: string[] = (server as any)._testLastClaudeChatArgs;
    expect(args).not.toContain("--mcp-config");
    // Still told its mode and how to work without the MCP tools (#1240).
    const prompt = valueOf(args, "--append-system-prompt")!;
    expect(prompt).toContain("dr MCP server is not connected");
    expect(prompt).toContain("dr changeset create");
    expect(prompt).not.toContain("mcp__dr__");
    expect(existsSync(tempRoot)).toBe(false);
    server.stop();
  });

  it("adds the dr tools to an installed dr-architect that predates them, connects MCP and warns once (#1240)", async () => {
    const { server } = await createServer({
      agentTools: "Bash, Read, Edit, Write",
      agentDescription: "The project's architect",
    });
    await chat(server, "req-stale-added-1");
    await chat(server, "req-stale-added-2");

    const args: string[] = (server as any)._testLastClaudeChatArgs;
    expect(args).toContain("--mcp-config");
    const definition = JSON.parse(valueOf(args, "--agents")!)["dr-architect"];
    // The installed copy's own prompt and tools, plus the mode's dr tools.
    expect(definition.prompt).toBe("Installed body");
    expect(definition.description).toBe("The project's architect");
    expect(definition.tools.slice(0, 4)).toEqual(["Bash", "Read", "Edit", "Write"]);
    expect(definition.tools).toContain("mcp__dr__model_trace");
    expect(definition.tools).toContain("mcp__dr__changeset_create");
    expect(valueOf(args, "--allowedTools")).toContain("mcp__dr__changeset_create");

    const warnings = [...(server as any).drBotWarnings] as string[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("predates the dr MCP tools");
    expect(warnings[0]).toContain("dr claude upgrade");
    server.stop();
  });

  it("adds only the read tools to a stale agent in a read-only viewer", async () => {
    const { server } = await createServer({
      agentTools: "Bash, Read",
      agentDescription: "The project's architect",
      readOnly: true,
    });
    await chat(server, "req-stale-readonly");

    const args: string[] = (server as any)._testLastClaudeChatArgs;
    const definition = JSON.parse(valueOf(args, "--agents")!)["dr-architect"];
    expect(definition.tools).toContain("mcp__dr__model_trace");
    expect(definition.tools).not.toContain("mcp__dr__changeset_create");
    expect(valueOf(args, "--allowedTools")).not.toContain("mcp__dr__changeset_create");
    expect(valueOf(args, "--append-system-prompt")).toContain("mode: read-only");
    server.stop();
  });

  it("loads no MCP server but DrBot's own under an allowlist", async () => {
    const { server } = await createServer();
    await chat(server, "req-strict");
    expect((server as any)._testLastClaudeChatArgs).toContain("--strict-mcp-config");
    server.stop();
  });

  it("skips MCP and warns once when the installed dr-architect agent can't be passed with the dr tools", async () => {
    // No description: --agents can't carry it, so Claude Code runs the file as it is.
    const { server, tempRoot } = await createServer({
      agentTools: "Bash, Read, Edit, Write",
    });
    await chat(server, "req-stale-1");
    await chat(server, "req-stale-2");

    const args: string[] = (server as any)._testLastClaudeChatArgs;
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--agents");
    expect(valueOf(args, "--append-system-prompt")).toContain("dr MCP server is not connected");
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
});
