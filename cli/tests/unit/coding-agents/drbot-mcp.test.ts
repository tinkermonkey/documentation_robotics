/**
 * DrBot on MCP: the MCP config and launch arguments `dr visualize` gives its Claude Code chat
 * agent. No claude binary is needed: these test the generated config and arguments only.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { CHANGESET_ONLY_ENV } from "../../../src/core/changeset-only-guard.js";
import { CHANGESET_ORIGIN_ENV } from "../../../src/core/changeset-review.js";
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
  checkAgentMcpTools,
  prepareDrBotAgent,
  agentDirectories,
  bundledAgentFile,
  resolveDrBotAgent,
  agentDefinitionFromMarkdown,
  drBotAgentArgs,
} from "../../../src/coding-agents/drbot-mcp.js";

const BUNDLED_AGENT = join(import.meta.dir, "../../../../integrations/claude_code/agents/dr-architect.md");
/** Lookup options with a scratch home and no CLAUDE_CONFIG_DIR from the test runner's env. */
const at = (homeDir: string) => ({ homeDir, env: {} });
const PLUGIN_AGENT = join(import.meta.dir, "../../../../integrations/claude_code/plugin-agents/dr-architect.md");

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

  it("gives DrBot neither project_init nor project_upgrade in any mode", () => {
    for (const mode of ["read-safe", "changesets"] as const) {
      const rules = drMcpAllowedTools(mode);
      expect(rules).not.toContain("mcp__dr__project_init");
      expect(rules).not.toContain("mcp__dr__project_upgrade");
    }
  });

  it("never gets changeset_commit, which needs a person to confirm it", () => {
    expect(registeredToolNames()).toContain("changeset_commit");
    expect([...DR_MCP_READ_TOOLS, ...DR_MCP_CHANGESET_TOOLS]).not.toContain("changeset_commit");
  });

  it("leaves out review_open: DrBot already lives in the viewer", () => {
    expect(drMcpAllowedTools("changesets")).not.toContain("mcp__dr__review_open");
    expect(drMcpAllowedTools("read-safe")).not.toContain("mcp__dr__review_open");
  });

  it("needs no rules in danger mode (permissions are skipped)", () => {
    expect(drMcpAllowedTools("danger")).toEqual([]);
  });
});

describe("buildDrMcpConfig", () => {
  const drCommand = { command: "/usr/bin/node", args: ["/opt/dr/dist/cli.js"] };

  it("runs this dr installation's `dr mcp` over stdio for the served model, without an API key", () => {
    const config = buildDrMcpConfig({
      drCommand,
      rootPath: "/work/project",
      changesetOnly: false,
    });
    const server = config.mcpServers.dr;
    expect(server.type).toBe("stdio");
    expect(server.command).toBe("/usr/bin/node");
    expect(server.args).toEqual(["/opt/dr/dist/cli.js", "mcp"]);
    expect(server.env.DR_MCP_API_KEY).toBeUndefined();
    expect(server.env[DR_MCP_ROOT_PATH_ENV]).toBe("/work/project");
    expect(server.env[CHANGESET_ONLY_ENV]).toBeUndefined();
    // Changesets DrBot creates through the MCP server record origin.kind "chat"
    expect(server.env[CHANGESET_ORIGIN_ENV]).toBe("chat");
  });

  it("puts the MCP server in changeset-only mode when asked", () => {
    const config = buildDrMcpConfig({
      drCommand,
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
      drCommand: { command: "dr", args: [] },
      tempRoot: scratch,
    });

    expect(launch.configPath.startsWith(scratch)).toBe(true);
    expect(statSync(launch.configPath).mode & 0o777).toBe(0o600);
    const config = JSON.parse(await readFile(launch.configPath, "utf8"));
    expect(config.mcpServers.dr.args).toEqual(["mcp"]);
    expect(config.mcpServers.dr.env.DR_MCP_API_KEY).toBeUndefined();
    expect(config.mcpServers.dr.env[CHANGESET_ONLY_ENV]).toBe("true");

    await launch.cleanup();
    expect(existsSync(launch.configPath)).toBe(false);
    await launch.cleanup(); // idempotent
  });

  it("gives the server the chat's mode and project root, only for a chat under an allowlist", () => {
    const drCommand = { command: "dr", args: [] };
    const chat = buildDrMcpConfig({ drCommand, rootPath: "/work/project", changesetOnly: true, chatMode: "changesets" });
    expect(chat.mcpServers.dr.env.DR_CHAT_MODE).toBe("changesets");
    expect(chat.mcpServers.dr.env.DR_CHAT_PROJECT_ROOT).toBe("/work/project");
    const danger = buildDrMcpConfig({ drCommand, rootPath: "/work/project", changesetOnly: false });
    expect(danger.mcpServers.dr.env.DR_CHAT_MODE).toBeUndefined();
    expect(danger.mcpServers.dr.env.DR_CHAT_PROJECT_ROOT).toBeUndefined();
  });

  it("writes a private dr that runs this installation, for the front of the chat's PATH", async () => {
    if (process.platform === "win32") return;
    const script = join(scratch, "fake-cli.js");
    await writeFile(script, 'console.log("fake-dr " + process.argv.slice(2).join(" "));\n');
    const launch = await prepareDrMcpLaunch({
      rootPath: "/work/project",
      changesetOnly: true,
      drCommand: { command: process.execPath, args: [script] },
      tempRoot: scratch,
    });
    try {
      expect(launch.binDir).toBe(join(dirname(launch.configPath), "bin"));
      const shim = join(launch.binDir!, "dr");
      expect(statSync(shim).mode & 0o777).toBe(0o700);
      const { stdout } = Bun.spawnSync([shim, "list", "it's"]);
      expect(stdout.toString().trim()).toBe("fake-dr list it's");
    } finally {
      await launch.cleanup();
    }
    expect(existsSync(launch.binDir!)).toBe(false);
    // Nothing to pin when this dr is the one on PATH.
    const plain = await prepareDrMcpLaunch({ rootPath: "/w", changesetOnly: false, drCommand: { command: "dr", args: [] }, tempRoot: scratch });
    expect(plain.binDir).toBeUndefined();
    await plain.cleanup();
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
    return (new VisualizationServer(model, options) as any).drBot.buildClaudeChatArgs(mcpConfigPath);
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

  it("keeps the Bash rules, and still says the mode, when no MCP config could be prepared", () => {
    const cmd = args({ withChangesets: true });
    expect(cmd).not.toContain("--mcp-config");
    expect(valueOf(cmd, "--allowedTools")).toBe(formatForClaudeCodeWithChangesets());
    const prompt = valueOf(cmd, "--append-system-prompt")!;
    expect(prompt).toContain("dr MCP server is not connected");
    expect(prompt).toContain("mode: changeset staging");
    expect(args({})).toContain("--append-system-prompt");
  });

  it("under an allowlist: reads no settings file, has no editing tool, never asks, and denies the person's steps", () => {
    for (const options of [{}, { withChangesets: true }]) {
      const cmd = args(options, "/tmp/x/mcp.json");
      expect(cmd).toContain("--restricted");
      expect(valueOf(cmd, "--tools")).toBe("Bash,Read,Glob,Grep");
      expect(valueOf(cmd, "--permission-mode")).toBe("dontAsk");
      const denied = valueOf(cmd, "--disallowedTools")!.split(",");
      expect(denied).toContain("Bash(dr changeset commit:*)");
      expect(denied).toContain("Write");
      expect(JSON.parse(valueOf(cmd, "--settings")!).hooks.PreToolUse[0].matcher).toBe("Bash");
    }
    const danger = args({ withDanger: true }, "/tmp/x/mcp.json");
    for (const flag of ["--restricted", "--tools", "--permission-mode", "--disallowedTools", "--settings"]) {
      expect(danger).not.toContain(flag);
    }
  });

  it("names the agent only when its definition is passed or claude can load it", () => {
    const server = (new VisualizationServer(model, {}) as any).drBot;
    expect(server.buildClaudeChatArgs(undefined, undefined, [], true)).not.toContain("--agent");
    expect(server.buildClaudeChatArgs(undefined, undefined, ["--agents", "{}"]).slice(0, 5)).toEqual([
      "claude",
      "--agent",
      "dr-architect",
      "--agents",
      "{}",
    ]);
  });

  it("loads only DrBot's own MCP server under an allowlist, and every server in danger mode", () => {
    expect(args({}, "/tmp/x/mcp.json")).toContain("--strict-mcp-config");
    expect(args({ withChangesets: true }, "/tmp/x/mcp.json")).toContain("--strict-mcp-config");
    // Without a config too: the user's own servers would describe tools DrBot can't call.
    expect(args({ withChangesets: true })).toContain("--strict-mcp-config");
    expect(args({ withDanger: true }, "/tmp/x/mcp.json")).not.toContain("--strict-mcp-config");
  });

  it("says nothing extra in danger mode without MCP (there is no allowlist to explain)", () => {
    expect(args({ withDanger: true })).not.toContain("--append-system-prompt");
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
      expect(await checkInstalledAgentMcpTools(root, mode, at(join(scratch, "no-home")))).toBeNull();
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
    const check = await checkInstalledAgentMcpTools(root, "changesets", at(noHome()));
    expect(check?.noneVisible).toBe(true);
    expect(check?.missing).toEqual(drMcpAllowedTools("changesets"));
    expect(check?.path).toBe(join(root, ".claude", "agents", "dr-architect.md"));
  });

  it("reports only the tools a partly current agent leaves out", async () => {
    const root = join(scratch, "partial-project");
    const listed = drMcpAllowedTools("read-safe").filter((rule) => rule !== "mcp__dr__chat_status");
    await install(root, ["Bash", ...listed].join(", "));
    expect(await checkInstalledAgentMcpTools(root, "read-safe", at(noHome()))).toEqual({
      path: join(root, ".claude", "agents", "dr-architect.md"),
      source: "project",
      missing: ["mcp__dr__chat_status"],
      noneVisible: false,
    });
    // Changeset mode also needs the staging tools.
    const check = await checkInstalledAgentMcpTools(root, "changesets", at(noHome()));
    expect(check?.missing).toContain("mcp__dr__changeset_create");
  });

  it("accepts a server-wide mcp__dr entry and an agent with no tools field", async () => {
    const wide = join(scratch, "wide-project");
    await install(wide, "Bash, mcp__dr");
    expect(await checkInstalledAgentMcpTools(wide, "changesets", at(noHome()))).toBeNull();
    const open = join(scratch, "open-project");
    await install(open, null);
    expect(await checkInstalledAgentMcpTools(open, "changesets", at(noHome()))).toBeNull();
  });

  it("falls back to the user's ~/.claude/agents copy, and reports nothing when there is none", async () => {
    const home = join(scratch, "home-with-agent");
    await install(home, "Bash");
    const root = join(scratch, "project-without-agent");
    await mkdir(root, { recursive: true });
    expect(findInstalledAgentFile(root, at(home))).toEqual({
      path: join(home, ".claude", "agents", "dr-architect.md"),
      source: "user",
    });
    expect((await checkInstalledAgentMcpTools(root, "read-safe", at(home)))?.noneVisible).toBe(true);
    expect(await checkInstalledAgentMcpTools(root, "read-safe", at(noHome()))).toBeNull();
  });
});

describe("which dr-architect DrBot runs", () => {
  const noHome = () => join(scratch, "no-home");

  async function install(dir: string, tools: string): Promise<string> {
    await mkdir(join(dir, ".claude", "agents"), { recursive: true });
    const path = join(dir, ".claude", "agents", "dr-architect.md");
    await writeFile(path, `---\nname: dr-architect\ndescription: d\ntools: ${tools}\n---\nbody\n`);
    return path;
  }

  it("finds the bundled source this CLI ships", () => {
    expect(bundledAgentFile()).toBe(BUNDLED_AGENT);
    expect(bundledAgentFile(() => false)).toBeNull();
  });

  it("prefers the project copy, then the user copy, then the bundled source", async () => {
    const home = join(scratch, "resolve-home");
    const userPath = await install(home, "Bash");
    const project = join(scratch, "resolve-project");
    await mkdir(project, { recursive: true });

    expect(resolveDrBotAgent(project, at(noHome()))).toEqual({ path: BUNDLED_AGENT, source: "bundled" });
    expect(resolveDrBotAgent(project, at(home))).toEqual({ path: userPath, source: "user" });
    const projectPath = await install(project, "Read");
    expect(resolveDrBotAgent(project, at(home))).toEqual({ path: projectPath, source: "project" });
    expect(resolveDrBotAgent(join(scratch, "resolve-none"), { ...at(noHome()), bundledPath: null })).toBeNull();
  });

  it("checks the bundled source when nothing is installed, and it sees every tool", async () => {
    const root = join(scratch, "nothing-installed");
    await mkdir(root, { recursive: true });
    for (const mode of ["read-safe", "changesets", "danger"] as const) {
      expect(await checkInstalledAgentMcpTools(root, mode, at(noHome()))).toBeNull();
    }
  });

  it("would report the plugin's copy as seeing none of DrBot's tools (so DrBot never runs it)", async () => {
    const check = await checkAgentMcpTools({ path: PLUGIN_AGENT, source: "user" }, "changesets");
    expect(check?.noneVisible).toBe(true);
  });

  it("passes the bundled copy with --agents, with its mcp__dr__* tools", async () => {
    const args = await drBotAgentArgs({ path: BUNDLED_AGENT, source: "bundled" });
    expect(args[0]).toBe("--agents");
    const agents = JSON.parse(args[1]);
    expect(Object.keys(agents)).toEqual(["dr-architect"]);
    const definition = agents["dr-architect"];
    expect(definition.description).toContain("Documentation Robotics");
    expect(definition.prompt.startsWith("# Documentation Robotics Architect Agent")).toBe(true);
    expect(definition.tools).toEqual(parseAgentFrontmatterTools(await readFile(BUNDLED_AGENT, "utf8")));
    expect(definition.tools.filter((tool: string) => tool.startsWith("mcp__dr__")).sort()).toEqual(
      [...drMcpAllowedTools("changesets")].sort()
    );
    expect(definition.tools.some((tool: string) => tool.startsWith("mcp__plugin_"))).toBe(false);
  });

  it("adds nothing when an installed copy will win", async () => {
    expect(await drBotAgentArgs({ path: "/x", source: "project" })).toEqual([]);
    expect(await drBotAgentArgs({ path: "/x", source: "user" })).toEqual([]);
    expect(await drBotAgentArgs(null)).toEqual([]);
    expect(await drBotAgentArgs(null, ["mcp__dr__model_show"])).toEqual([]);
  });

  it("passes an installed copy with the tools it lacks added, keeping its own prompt and tools", async () => {
    const root = join(scratch, "installed-with-added-tools");
    const path = await install(root, "Bash, mcp__dr__model_show");
    const args = await drBotAgentArgs({ path, source: "project" }, ["mcp__dr__model_show", "mcp__dr__model_trace"]);
    expect(args[0]).toBe("--agents");
    expect(JSON.parse(args[1])).toEqual({
      "dr-architect": { description: "d", prompt: "body", tools: ["Bash", "mcp__dr__model_show", "mcp__dr__model_trace"] },
    });
  });

  it("never adds tools to the bundled copy, which already lists them", async () => {
    const tools = JSON.parse((await drBotAgentArgs({ path: BUNDLED_AGENT, source: "bundled" }, ["mcp__dr__x"]))[1])[
      "dr-architect"
    ].tools;
    expect(tools).not.toContain("mcp__dr__x");
  });

  it("reads an agent file's description, model, tools and body", () => {
    expect(
      agentDefinitionFromMarkdown("---\nname: x\ndescription: Does x\ntools: Read, Bash\nmodel: sonnet\ncolor: red\n---\n\nBody\n")
    ).toEqual({ description: "Does x", prompt: "Body", tools: ["Read", "Bash"], model: "sonnet" });
    expect(agentDefinitionFromMarkdown("---\ndescription: y\n---\nB")).toEqual({ description: "y", prompt: "B" });
    expect(() => agentDefinitionFromMarkdown("no frontmatter")).toThrow();
    expect(() => agentDefinitionFromMarkdown("---\nname: x\n---\nB")).toThrow(/description/);
  });
});

describe("finding every dr-architect Claude Code would load", () => {
  const noHome = () => join(scratch, "no-home");

  async function agentFile(path: string, name: string | null, tools = "Bash"): Promise<string> {
    await mkdir(join(path, ".."), { recursive: true });
    const nameLine = name === null ? "" : `name: ${name}\n`;
    await writeFile(path, `---\n${nameLine}description: d\ntools: ${tools}\n---\nbody\n`);
    return path;
  }

  it("uses $CLAUDE_CONFIG_DIR/agents as the user folder when it is set", async () => {
    const configDir = join(scratch, "config-dir");
    const path = await agentFile(join(configDir, "agents", "dr-architect.md"), "dr-architect");
    const root = join(scratch, "config-dir-project");
    await mkdir(root, { recursive: true });
    const options = { homeDir: noHome(), env: { CLAUDE_CONFIG_DIR: configDir } };
    expect(findInstalledAgentFile(root, options)).toEqual({ path, source: "user" });
    expect(agentDirectories(root, options).at(-1)).toEqual({ dir: join(configDir, "agents"), source: "user" });
    // Without it, ~/.claude/agents.
    expect(findInstalledAgentFile(root, at(noHome()))).toBeNull();
  });

  it("matches the frontmatter name, in subfolders too, and falls back to the file name", async () => {
    const root = join(scratch, "by-name");
    await agentFile(join(root, ".claude", "agents", "dr-architect.md"), "someone-else");
    expect(findInstalledAgentFile(root, at(noHome()))).toBeNull();

    const named = await agentFile(join(root, ".claude", "agents", "team", "architect.md"), "dr-architect");
    expect(findInstalledAgentFile(root, at(noHome()))).toEqual({ path: named, source: "project" });

    const unnamedRoot = join(scratch, "by-file-name");
    const unnamed = await agentFile(join(unnamedRoot, ".claude", "agents", "dr-architect.md"), null);
    expect(findInstalledAgentFile(unnamedRoot, at(noHome()))).toEqual({ path: unnamed, source: "project" });
  });

  it("walks up to the git root, nearest folder first, and no further", async () => {
    const outside = join(scratch, "walk");
    const repo = join(outside, "repo");
    const model = join(repo, "packages", "model");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(model, { recursive: true });
    await agentFile(join(outside, ".claude", "agents", "dr-architect.md"), "dr-architect");
    expect(findInstalledAgentFile(model, at(noHome()))).toBeNull();

    const atRoot = await agentFile(join(repo, ".claude", "agents", "dr-architect.md"), "dr-architect");
    expect(findInstalledAgentFile(model, at(noHome()))).toEqual({ path: atRoot, source: "project" });

    const nearest = await agentFile(join(model, ".claude", "agents", "dr-architect.md"), "dr-architect");
    expect(findInstalledAgentFile(model, at(noHome()))).toEqual({ path: nearest, source: "project" });
    expect(agentDirectories(model, at(noHome())).map((entry) => entry.dir)).toEqual([
      join(model, ".claude", "agents"),
      join(repo, "packages", ".claude", "agents"),
      join(repo, ".claude", "agents"),
      join(noHome(), ".claude", "agents"),
    ]);
  });
});

describe("prepareDrBotAgent", () => {
  const noHome = () => join(scratch, "no-home");

  it("passes the bundled copy with --agents and checks that same copy", async () => {
    const root = join(scratch, "prepare-bundled");
    await mkdir(root, { recursive: true });
    const launch = await prepareDrBotAgent(root, "changesets", at(noHome()));
    expect(launch.agent).toEqual({ path: BUNDLED_AGENT, source: "bundled" });
    expect(launch.args[0]).toBe("--agents");
    expect(launch.check).toBeNull();
  });

  it("reports no visible dr tools when the bundled copy can't be passed", async () => {
    const root = join(scratch, "prepare-broken");
    await mkdir(root, { recursive: true });
    const broken = join(scratch, "broken-agent.md");
    // Lists every tool but has no description, so --agents can't be built from it.
    await writeFile(broken, `---\nname: dr-architect\ntools: ${drMcpAllowedTools("changesets").join(", ")}\n---\nbody\n`);
    const launch = await prepareDrBotAgent(root, "changesets", { ...at(noHome()), bundledPath: broken });
    expect(launch.args).toEqual([]);
    expect(launch.check?.noneVisible).toBe(true);
    expect(launch.check?.error).toContain("description");
    expect(launch.check?.missing).toEqual(drMcpAllowedTools("changesets"));
  });

  it("adds the mode's dr tools to an installed copy that predates them (#1240)", async () => {
    const root = join(scratch, "prepare-stale");
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await writeFile(
      join(root, ".claude", "agents", "dr-architect.md"),
      "---\nname: dr-architect\ndescription: Old copy\ntools: Bash, Read\n---\nOld body\n"
    );
    for (const mode of ["read-safe", "changesets"] as const) {
      const launch = await prepareDrBotAgent(root, mode, at(noHome()));
      expect(launch.agent?.source).toBe("project");
      expect(launch.check).toMatchObject({ noneVisible: true, added: true, missing: drMcpAllowedTools(mode) });
      expect(launch.args[0]).toBe("--agents");
      const definition = JSON.parse(launch.args[1])["dr-architect"];
      expect(definition.prompt).toBe("Old body");
      expect(definition.tools).toEqual(["Bash", "Read", ...drMcpAllowedTools(mode)]);
    }
    // Danger mode has no allowlist, but the agent's tools field still limits it: every dr tool is added.
    const danger = await prepareDrBotAgent(root, "danger", at(noHome()));
    expect(JSON.parse(danger.args[1])["dr-architect"].tools).toContain("mcp__dr__changeset_create");
  });

  it("adds only the tools a partly current copy leaves out", async () => {
    const root = join(scratch, "prepare-partial");
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    const listed = drMcpAllowedTools("read-safe").filter((rule) => rule !== "mcp__dr__model_trace");
    await writeFile(
      join(root, ".claude", "agents", "dr-architect.md"),
      `---\nname: dr-architect\ndescription: Partial\ntools: ${["Bash", ...listed].join(", ")}\n---\nbody\n`
    );
    const launch = await prepareDrBotAgent(root, "read-safe", at(noHome()));
    expect(launch.check).toMatchObject({ noneVisible: false, added: true, missing: ["mcp__dr__model_trace"] });
    expect(JSON.parse(launch.args[1])["dr-architect"].tools).toEqual(["Bash", ...listed, "mcp__dr__model_trace"]);
  });

  it("passes a current installed copy unchanged under an allowlist, and leaves it to claude in danger mode", async () => {
    const root = join(scratch, "prepare-current");
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    const path = join(root, ".claude", "agents", "dr-architect.md");
    await writeFile(path, await readFile(BUNDLED_AGENT, "utf8"));
    // Under an allowlist the launch runs `claude --restricted`, which loads no agent file.
    const launch = await prepareDrBotAgent(root, "changesets", at(noHome()));
    expect(launch.agent).toEqual({ path, source: "project" });
    expect(launch.check).toBeNull();
    expect(launch.args[0]).toBe("--agents");
    expect(JSON.parse(launch.args[1])["dr-architect"].tools).toEqual(
      parseAgentFrontmatterTools(await readFile(BUNDLED_AGENT, "utf8"))
    );
    expect(await prepareDrBotAgent(root, "danger", at(noHome()))).toEqual({
      agent: { path, source: "project" },
      args: [],
      check: null,
    });
  });

  it("replaces an installed copy it can't pass (no description) with the bundled one under an allowlist", async () => {
    const root = join(scratch, "prepare-replaced");
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    const path = join(root, ".claude", "agents", "dr-architect.md");
    await writeFile(path, "---\nname: dr-architect\ntools: Bash\n---\nbody\n");
    const launch = await prepareDrBotAgent(root, "read-safe", at(noHome()));
    expect(launch.agent).toEqual({ path: BUNDLED_AGENT, source: "bundled" });
    expect(launch.args[0]).toBe("--agents");
    expect(launch.check).toMatchObject({
      source: "bundled",
      missing: [],
      noneVisible: false,
      replaced: { path, reason: "agent file has no description" },
    });
    // With no bundled copy either, nothing can be passed and no dr tool is visible.
    const none = await prepareDrBotAgent(root, "read-safe", { ...at(noHome()), bundledPath: null });
    expect(none.args).toEqual([]);
    expect(none.check).toMatchObject({ noneVisible: true, error: "agent file has no description" });
  });

  it("leaves an installed copy it can't pass in charge in danger mode, where claude loads it itself", async () => {
    const root = join(scratch, "prepare-installed");
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await writeFile(join(root, ".claude", "agents", "dr-architect.md"), "---\nname: dr-architect\ntools: Bash\n---\nbody\n");
    const launch = await prepareDrBotAgent(root, "danger", at(noHome()));
    expect(launch.args).toEqual([]);
    expect(launch.agent?.source).toBe("project");
    expect(launch.check?.noneVisible).toBe(true);
    expect(launch.check?.added).toBeUndefined();
    expect(launch.check?.error).toBeUndefined();
  });
});
