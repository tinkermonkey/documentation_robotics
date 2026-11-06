/**
 * DrBot on MCP: the MCP config and launch arguments `dr visualize` gives its Claude Code chat
 * agent. No claude binary is needed: these test the generated config and arguments only.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  parseAgentFrontmatterTools,
  findInstalledAgentFile,
  checkInstalledAgentMcpTools,
} from "../../../src/coding-agents/drbot-mcp.js";

const BUNDLED_AGENT = join(import.meta.dir, "../../../../integrations/claude_code/agents/dr-architect.md");

const KEY = "dr-mcp-test-key";
const fakeKeyManager = {
  ensureKey: async () => ({
    key: KEY,
    path: "/nowhere/.dr-mcp-key",
    isNew: false,
  }),
};

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
  new McpToolRegistry().registerAll({
    registerTool: (name: string) => names.push(name),
  } as any);
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
    const config = buildDrMcpConfig({
      drCommand,
      apiKey: KEY,
      rootPath: "/work/project",
      changesetOnly: false,
    });
    const server = config.mcpServers.dr;
    expect(server.type).toBe("stdio");
    expect(server.command).toBe("/usr/bin/node");
    expect(server.args).toEqual(["/opt/dr/dist/cli.js", "mcp"]);
    expect(server.env.DR_MCP_API_KEY).toBe(KEY);
    expect(server.env[DR_MCP_ROOT_PATH_ENV]).toBe("/work/project");
    expect(server.env[CHANGESET_ONLY_ENV]).toBeUndefined();
  });

  it("puts the MCP server in changeset-only mode when asked", () => {
    const config = buildDrMcpConfig({
      drCommand,
      apiKey: KEY,
      rootPath: "/work/project",
      changesetOnly: true,
    });
    expect(config.mcpServers.dr.env[CHANGESET_ONLY_ENV]).toBe("true");
  });
});

describe("resolveDrCommand", () => {
  it("prefers an existing DR_CLI_ENTRY under the current runtime", () => {
    const command = resolveDrCommand({ [DR_CLI_ENTRY_ENV]: "/opt/dr/cli.js" }, (p) => p === "/opt/dr/cli.js");
    expect(command).toEqual({
      command: process.execPath,
      args: ["/opt/dr/cli.js"],
    });
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
    // Its own directory: other tests in this file write to scratch concurrently.
    const tempRoot = join(scratch, "failed-launch");
    await mkdir(tempRoot, { recursive: true });
    const broken = {
      ensureKey: async () => {
        throw new Error("config corrupted");
      },
    };
    await expect(
      prepareDrMcpLaunch({
        rootPath: "/work",
        changesetOnly: false,
        keyManager: broken,
        tempRoot,
      })
    ).rejects.toThrow("config corrupted");
    expect(readdirSync(tempRoot)).toEqual([]);
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
    model = await Model.init(root, {
      name: "DrBot MCP Test Model",
      version: "0.1.0",
    });
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

describe("the bundled dr-architect agent's tools", () => {
  it("lists exactly the dr MCP tools DrBot uses (kept in sync with DR_MCP_READ_TOOLS / DR_MCP_CHANGESET_TOOLS)", async () => {
    const tools = parseAgentFrontmatterTools(await readFile(BUNDLED_AGENT, "utf8"));
    expect(tools).not.toBeNull();
    const listed = tools!.filter((tool) => tool.startsWith("mcp__dr__")).sort();
    expect(listed).toEqual([...drMcpAllowedTools("changesets")].sort());
  });

  it("satisfies the installed-agent check in every mode", async () => {
    const root = join(scratch, "bundled-agent");
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await writeFile(join(root, ".claude", "agents", "dr-architect.md"), await readFile(BUNDLED_AGENT, "utf8"));
    for (const mode of ["read-safe", "changesets", "danger"] as const) {
      expect(await checkInstalledAgentMcpTools(root, mode, join(scratch, "no-home"))).toBeNull();
    }
  });
});

describe("parseAgentFrontmatterTools", () => {
  it("reads the comma-separated form", () => {
    expect(parseAgentFrontmatterTools("---\nname: x\ntools: Bash, Read,mcp__dr__model_show\n---\nbody")).toEqual([
      "Bash",
      "Read",
      "mcp__dr__model_show",
    ]);
  });

  it("reads flow and block YAML lists", () => {
    expect(parseAgentFrontmatterTools('---\ntools: ["Bash", "Read"]\n---\n')).toEqual(["Bash", "Read"]);
    expect(parseAgentFrontmatterTools("---\ntools:\n  - Bash\n  - mcp__dr__spec_type\ncolor: x\n---\n")).toEqual([
      "Bash",
      "mcp__dr__spec_type",
    ]);
  });

  it("returns null without frontmatter or a tools field (the agent then has every tool)", () => {
    expect(parseAgentFrontmatterTools("no frontmatter")).toBeNull();
    expect(parseAgentFrontmatterTools("---\nname: x\n---\n")).toBeNull();
  });
});

describe("checkInstalledAgentMcpTools", () => {
  const noHome = () => join(scratch, "no-home");

  async function install(dir: string, tools: string | null): Promise<void> {
    await mkdir(join(dir, ".claude", "agents"), { recursive: true });
    const field = tools === null ? "" : `tools: ${tools}\n`;
    await writeFile(join(dir, ".claude", "agents", "dr-architect.md"), `---\nname: dr-architect\n${field}---\nbody\n`);
  }

  it("reports an agent installed before DrBot used MCP as seeing none of the tools", async () => {
    const root = join(scratch, "stale-project");
    await install(root, "Bash, Read, Edit, Write, Glob, Grep, WebSearch, WebFetch");
    const check = await checkInstalledAgentMcpTools(root, "changesets", noHome());
    expect(check?.noneVisible).toBe(true);
    expect(check?.missing).toEqual(drMcpAllowedTools("changesets"));
    expect(check?.path).toBe(join(root, ".claude", "agents", "dr-architect.md"));
  });

  it("reports only the tools a partly current agent leaves out", async () => {
    const root = join(scratch, "partial-project");
    const listed = drMcpAllowedTools("read-safe").filter((rule) => rule !== "mcp__dr__chat_status");
    await install(root, ["Bash", ...listed].join(", "));
    expect(await checkInstalledAgentMcpTools(root, "read-safe", noHome())).toEqual({
      path: join(root, ".claude", "agents", "dr-architect.md"),
      missing: ["mcp__dr__chat_status"],
      noneVisible: false,
    });
    // Changeset mode also needs the staging tools.
    const check = await checkInstalledAgentMcpTools(root, "changesets", noHome());
    expect(check?.missing).toContain("mcp__dr__changeset_create");
  });

  it("accepts a server-wide mcp__dr entry and an agent with no tools field", async () => {
    const wide = join(scratch, "wide-project");
    await install(wide, "Bash, mcp__dr");
    expect(await checkInstalledAgentMcpTools(wide, "changesets", noHome())).toBeNull();
    const open = join(scratch, "open-project");
    await install(open, null);
    expect(await checkInstalledAgentMcpTools(open, "changesets", noHome())).toBeNull();
  });

  it("falls back to the user's ~/.claude/agents copy, and reports nothing when there is none", async () => {
    const home = join(scratch, "home-with-agent");
    await install(home, "Bash");
    const root = join(scratch, "project-without-agent");
    await mkdir(root, { recursive: true });
    expect(findInstalledAgentFile(root, home)).toBe(join(home, ".claude", "agents", "dr-architect.md"));
    expect((await checkInstalledAgentMcpTools(root, "read-safe", home))?.noneVisible).toBe(true);
    expect(await checkInstalledAgentMcpTools(root, "read-safe", noHome())).toBeNull();
  });
});
