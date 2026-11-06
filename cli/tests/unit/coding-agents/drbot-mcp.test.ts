/**
 * DrBot on MCP: the MCP config and launch arguments `dr visualize` gives its Claude Code chat
 * agent. No claude binary is needed: these test the generated config and arguments only.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { CHANGESET_ONLY_ENV } from "../../../src/core/changeset-only-guard.js";
import { McpToolRegistry } from "../../../src/mcp/tool-registry.js";
import { BASE_MODEL_WRITE_TOOLS } from "../../../src/mcp/changeset-only.js";
import { VisualizationServer } from "../../../src/server/server.js";
import {
  formatForClaudeCode,
  formatForClaudeCodeWithChangesets,
} from "../../../src/coding-agents/default-permissions.js";
import {
  DR_CLI_ENTRY_ENV,
  DR_MCP_CHANGESET_TOOLS,
  DR_MCP_READ_TOOLS,
  DR_MCP_ROOT_PATH_ENV,
  buildDrMcpConfig,
  drBotMcpPrompt,
  drMcpAllowedTools,
  prepareDrMcpLaunch,
  resolveDrCommand,
} from "../../../src/coding-agents/drbot-mcp.js";

const KEY = "dr-mcp-test-key";
const fakeKeyManager = { ensureKey: async () => ({ key: KEY, path: "/nowhere/.dr-mcp-key", isNew: false }) };

let scratch: string;

beforeAll(async () => {
  scratch = join(tmpdir(), `dr-drbot-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(scratch, { recursive: true });
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function registeredToolNames(): string[] {
  const names: string[] = [];
  new McpToolRegistry().registerAll({ registerTool: (name: string) => names.push(name) } as any);
  return names;
}

describe("DrBot's dr MCP tool permissions", () => {
  it("names only tools the dr MCP server actually registers", () => {
    const registered = new Set(registeredToolNames());
    for (const tool of [...DR_MCP_READ_TOOLS, ...DR_MCP_CHANGESET_TOOLS]) {
      expect(registered.has(tool)).toBe(true);
    }
  });

  it("keeps base-model writers out of the read-safe list", () => {
    for (const tool of BASE_MODEL_WRITE_TOOLS) {
      expect(DR_MCP_READ_TOOLS).not.toContain(tool);
    }
    const readSafe = drMcpAllowedTools("read-safe");
    expect(readSafe).toContain("mcp__dr__model_search");
    expect(readSafe).toContain("mcp__dr__changeset_brief");
    expect(readSafe).not.toContain("mcp__dr__model_add");
    expect(readSafe).not.toContain("mcp__dr__changeset_create");
  });

  it("adds changeset planning and staging tools in changeset mode, never commit or chat_launch", () => {
    const rules = drMcpAllowedTools("changesets");
    for (const tool of ["changeset_create", "spec_type", "model_add", "relationship_add", "changeset_brief"]) {
      expect(rules).toContain(`mcp__dr__${tool}`);
    }
    expect(rules.some((rule) => /commit|apply|discard/.test(rule))).toBe(false);
    expect(rules).not.toContain("mcp__dr__chat_launch");
    expect(rules).not.toContain("mcp__dr__annotation_delete");
  });

  it("needs no rules in danger mode (permissions are skipped)", () => {
    expect(drMcpAllowedTools("danger")).toEqual([]);
  });
});

describe("buildDrMcpConfig", () => {
  const drCommand = { command: "/usr/bin/node", args: ["/opt/dr/dist/cli.js"] };

  it("runs this dr installation's `dr mcp` over stdio for the served model, with the API key", () => {
    const config = buildDrMcpConfig({ drCommand, apiKey: KEY, rootPath: "/work/project", changesetOnly: false });
    const server = config.mcpServers.dr;
    expect(server.type).toBe("stdio");
    expect(server.command).toBe("/usr/bin/node");
    expect(server.args).toEqual(["/opt/dr/dist/cli.js", "mcp"]);
    expect(server.env.DR_MCP_API_KEY).toBe(KEY);
    expect(server.env[DR_MCP_ROOT_PATH_ENV]).toBe("/work/project");
    expect(server.env[CHANGESET_ONLY_ENV]).toBeUndefined();
  });

  it("puts the MCP server in changeset-only mode when asked", () => {
    const config = buildDrMcpConfig({ drCommand, apiKey: KEY, rootPath: "/work/project", changesetOnly: true });
    expect(config.mcpServers.dr.env[CHANGESET_ONLY_ENV]).toBe("true");
  });
});

describe("resolveDrCommand", () => {
  it("prefers an existing DR_CLI_ENTRY under the current runtime", () => {
    const command = resolveDrCommand({ [DR_CLI_ENTRY_ENV]: "/opt/dr/cli.js" }, (p) => p === "/opt/dr/cli.js");
    expect(command).toEqual({ command: process.execPath, args: ["/opt/dr/cli.js"] });
  });

  it("uses the bundled cli.js next to this module when it exists", () => {
    const command = resolveDrCommand({}, (p) => p.endsWith("cli.js"));
    expect(command.command).toBe(process.execPath);
    expect(command.args).toHaveLength(1);
    expect(command.args[0]).toMatch(/cli\.js$/);
  });

  it("falls back to dr on PATH", () => {
    expect(resolveDrCommand({ [DR_CLI_ENTRY_ENV]: "/missing" }, () => false)).toEqual({ command: "dr", args: [] });
  });
});

describe("prepareDrMcpLaunch", () => {
  it("writes a private config outside the project and removes it on cleanup", async () => {
    const launch = await prepareDrMcpLaunch({
      rootPath: "/work/project",
      changesetOnly: true,
      keyManager: fakeKeyManager,
      drCommand: { command: "dr", args: [] },
      tempRoot: scratch,
    });

    expect(launch.configPath.startsWith(scratch)).toBe(true);
    expect(statSync(launch.configPath).mode & 0o777).toBe(0o600);
    const config = JSON.parse(await readFile(launch.configPath, "utf8"));
    expect(config.mcpServers.dr.args).toEqual(["mcp"]);
    expect(config.mcpServers.dr.env.DR_MCP_API_KEY).toBe(KEY);
    expect(config.mcpServers.dr.env[CHANGESET_ONLY_ENV]).toBe("true");

    await launch.cleanup();
    expect(existsSync(launch.configPath)).toBe(false);
    await launch.cleanup(); // idempotent
  });

  it("fails without leaving anything behind when the key can't be resolved", async () => {
    const before = (await import("node:fs")).readdirSync(scratch).length;
    const broken = {
      ensureKey: async () => {
        throw new Error("config corrupted");
      },
    };
    await expect(
      prepareDrMcpLaunch({ rootPath: "/work", changesetOnly: false, keyManager: broken, tempRoot: scratch })
    ).rejects.toThrow("config corrupted");
    expect((await import("node:fs")).readdirSync(scratch).length).toBe(before);
  });
});

describe("drBotMcpPrompt", () => {
  it("steers changeset mode to changeset_create and away from committing", () => {
    const prompt = drBotMcpPrompt("changesets");
    expect(prompt).toContain("changeset_create");
    expect(prompt).toContain("changeset_brief");
    expect(prompt).toContain("Never commit");
  });

  it("tells read-safe mode it is read-only", () => {
    expect(drBotMcpPrompt("read-safe")).toContain("read-only");
  });
});

describe("VisualizationServer Claude Code launch args with the dr MCP server", () => {
  let model: Model;

  beforeAll(async () => {
    const root = join(scratch, "model");
    await mkdir(root, { recursive: true });
    model = await Model.init(root, { name: "DrBot MCP Test Model", version: "0.1.0" });
  });

  function args(options: { withDanger?: boolean; withChangesets?: boolean }, mcpConfigPath?: string): string[] {
    return (new VisualizationServer(model, options) as any).buildClaudeChatArgs(mcpConfigPath);
  }

  function valueOf(cmd: string[], flag: string): string | undefined {
    const index = cmd.indexOf(flag);
    return index === -1 ? undefined : cmd[index + 1];
  }

  it("passes the MCP config and allows the read tools alongside the read-safe Bash rules", () => {
    const cmd = args({}, "/tmp/x/mcp.json");
    expect(valueOf(cmd, "--mcp-config")).toBe("/tmp/x/mcp.json");
    const allowed = valueOf(cmd, "--allowedTools")!;
    expect(allowed.startsWith(formatForClaudeCode())).toBe(true);
    expect(allowed).toContain("mcp__dr__model_search");
    expect(allowed).not.toContain("mcp__dr__model_add");
    expect(valueOf(cmd, "--append-system-prompt")).toContain("read-only");
  });

  it("allows the changeset tools in changeset mode, keeping the Bash fallback", () => {
    const cmd = args({ withChangesets: true }, "/tmp/x/mcp.json");
    const allowed = valueOf(cmd, "--allowedTools")!;
    expect(allowed.startsWith(formatForClaudeCodeWithChangesets())).toBe(true);
    expect(allowed).toContain("mcp__dr__changeset_create");
    expect(allowed).toContain("mcp__dr__model_add");
    expect(valueOf(cmd, "--append-system-prompt")).toContain("changeset_create");
  });

  it("gives danger mode the MCP config without an allowlist", () => {
    const cmd = args({ withDanger: true, withChangesets: true }, "/tmp/x/mcp.json");
    expect(cmd).toContain("--dangerously-skip-permissions");
    expect(cmd).not.toContain("--allowedTools");
    expect(valueOf(cmd, "--mcp-config")).toBe("/tmp/x/mcp.json");
  });

  it("launches exactly as before when no MCP config could be prepared", () => {
    const cmd = args({ withChangesets: true });
    expect(cmd).not.toContain("--mcp-config");
    expect(cmd).not.toContain("--append-system-prompt");
    expect(valueOf(cmd, "--allowedTools")).toBe(formatForClaudeCodeWithChangesets());
  });

  it("keeps the stream-json output flags last", () => {
    const cmd = args({}, "/tmp/x/mcp.json");
    expect(cmd.slice(-3)).toEqual(["--verbose", "--output-format", "stream-json"]);
  });
});
