/**
 * DrBot on MCP: connect the viewer's chat agent to the dr MCP server.
 *
 * `dr visualize` launches Claude Code as DrBot (server/server.ts). Rather than having the
 * agent shell out to `dr` through Bash, the launch hands Claude Code an MCP config that runs
 * this same dr installation's `dr mcp` over stdio, pointed at the served model, so DrBot plans
 * changes with the change-modeling tools (changeset_create, spec_type, model_add,
 * relationship_add, changeset_brief) the way any other agent does.
 *
 * `dr mcp` over stdio needs no API key (the client spawns it as the same user). The config goes
 * in a private temp file (0600, in a 0700 directory under the OS temp dir), never in the repo or
 * the model directory, and is removed when the agent process exits.
 *
 * Tolerance: if anything here fails (no temp dir), the caller launches DrBot without
 * MCP and it falls back to the read-safe Bash rules; the failure is logged, not swallowed.
 */

import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { CHANGESET_ONLY_ENV } from "../core/changeset-only-guard.js";

/** Name the dr MCP server is registered under; Claude Code exposes its tools as mcp__dr__<tool>. */
export const DR_MCP_SERVER_NAME = "dr";

/** Env var `dr mcp` honours to serve a model from a directory other than its cwd. */
export const DR_MCP_ROOT_PATH_ENV = "DR_MCP_ROOT_PATH";

/** Env var that overrides the dr CLI entry script DrBot's MCP server runs (tests, custom installs). */
export const DR_CLI_ENTRY_ENV = "DR_CLI_ENTRY";

/** Tools that only read: allowed in every DrBot mode. */
export const DR_MCP_READ_TOOLS: readonly string[] = Object.freeze([
  "model_list",
  "model_show",
  "model_search",
  "model_stats",
  "model_info",
  "model_trace",
  "model_validate",
  "model_export",
  "model_reload",
  "changeset_list",
  "changeset_show",
  "changeset_impact",
  "changeset_brief",
  "changeset_verify",
  "spec_type",
  "annotation_list",
  "annotation_get",
  "chat_status",
]);

/**
 * Tools added in changeset-only mode (`dr visualize --with-changesets`): open and work in a
 * changeset and stage element and relationship changes. The MCP server runs with
 * DR_CHANGESET_ONLY set, so any of these that would write the base model (no active changeset)
 * is refused there (mcp/changeset-only.ts). changeset_update and changeset_unstage revise the
 * plan. Commit and apply are not MCP tools at all, and changeset_discard (which deletes the
 * staged changes) stays out: abandoning a changeset is the user's call.
 * chat_launch (an agent launching another agent) and the annotation writers stay out.
 */
export const DR_MCP_CHANGESET_TOOLS: readonly string[] = Object.freeze([
  "changeset_create",
  "changeset_activate",
  "changeset_deactivate",
  "model_add",
  "model_update",
  "model_delete",
  "relationship_add",
  "relationship_delete",
  "changeset_update",
  "changeset_unstage",
]);

export type DrBotMode = "read-safe" | "changesets" | "danger";

/** Claude Code permission rule for one dr MCP tool. */
export function drMcpToolRule(tool: string): string {
  return `mcp__${DR_MCP_SERVER_NAME}__${tool}`;
}

/** The mcp__dr__* rules DrBot may use without prompting in a mode (danger mode skips permissions). */
export function drMcpAllowedTools(mode: DrBotMode): string[] {
  if (mode === "danger") return [];
  const tools = mode === "changesets" ? [...DR_MCP_READ_TOOLS, ...DR_MCP_CHANGESET_TOOLS] : [...DR_MCP_READ_TOOLS];
  return tools.map(drMcpToolRule);
}

/** How to run this dr installation: a runtime plus the CLI entry script, or `dr` from PATH. */
export interface DrCommand {
  command: string;
  args: string[];
}

/**
 * Resolves the command that runs this same dr installation. The built CLI lives next to this
 * module's parent (dist/coding-agents/ → dist/cli.js) and runs under whichever runtime is
 * running now; DR_CLI_ENTRY overrides the script. Falls back to `dr` on PATH.
 */
export function resolveDrCommand(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync
): DrCommand {
  const override = env[DR_CLI_ENTRY_ENV];
  if (override && exists(override)) {
    return { command: process.execPath, args: [override] };
  }
  const bundled = fileURLToPath(new URL("../cli.js", import.meta.url));
  if (exists(bundled)) {
    return { command: process.execPath, args: [bundled] };
  }
  return { command: "dr", args: [] };
}

export interface DrMcpConfigOptions {
  drCommand: DrCommand;
  /** Project root of the served model. */
  rootPath: string;
  /** Run the server in changeset-only mode (DR_CHANGESET_ONLY=true). */
  changesetOnly: boolean;
}

/** The Claude Code MCP config (the --mcp-config file's content) for DrBot's dr server. */
export function buildDrMcpConfig(options: DrMcpConfigOptions): {
  mcpServers: Record<
    string,
    {
      type: "stdio";
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  >;
} {
  const env: Record<string, string> = {
    [DR_MCP_ROOT_PATH_ENV]: options.rootPath,
  };
  if (options.changesetOnly) {
    env[CHANGESET_ONLY_ENV] = "true";
  }
  return {
    mcpServers: {
      [DR_MCP_SERVER_NAME]: {
        type: "stdio",
        command: options.drCommand.command,
        args: [...options.drCommand.args, "mcp"],
        env,
      },
    },
  };
}

/** A written MCP config and the function that removes it again (safe to call more than once). */
export interface DrMcpLaunch {
  configPath: string;
  cleanup: () => Promise<void>;
}

export interface PrepareDrMcpLaunchOptions {
  rootPath: string;
  changesetOnly: boolean;
  drCommand?: DrCommand;
  /** Parent directory for the private config directory; defaults to the OS temp dir. */
  tempRoot?: string;
}

/**
 * Writes DrBot's MCP config to a private temp file. Throws on failure; the caller decides to
 * launch without MCP.
 */
export async function prepareDrMcpLaunch(options: PrepareDrMcpLaunchOptions): Promise<DrMcpLaunch> {
  const config = buildDrMcpConfig({
    drCommand: options.drCommand ?? resolveDrCommand(),
    rootPath: options.rootPath,
    changesetOnly: options.changesetOnly,
  });

  const dir = await mkdtemp(join(options.tempRoot ?? tmpdir(), "dr-drbot-mcp-"));
  let removed = false;
  const cleanup = async () => {
    if (removed) return;
    removed = true;
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`[DrBot] Could not remove MCP config directory ${dir}: ${(error as Error).message}`);
    }
  };

  try {
    await chmod(dir, 0o700);
    const configPath = join(dir, "mcp.json");
    await writeFile(configPath, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
    return { configPath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Appended to DrBot's system prompt when the dr MCP server is connected. */
export function drBotMcpPrompt(mode: DrBotMode): string {
  const lines = [
    `The Documentation Robotics MCP server "${DR_MCP_SERVER_NAME}" is connected for the model this session serves ` +
      `(tools named mcp__${DR_MCP_SERVER_NAME}__*). Prefer these tools to running dr through Bash: ` +
      "model_search/model_show/model_list to look things up, spec_type to check what a type takes and which " +
      "relationships the catalog allows, changeset_impact and changeset_brief to pressure-test a change.",
  ];
  if (mode === "changesets") {
    lines.push(
      "This session may change the model only through a changeset. Call changeset_create first (it activates the " +
        "new changeset), then stage changes with model_add, model_update, model_delete, relationship_add and " +
        "relationship_delete, and review them with changeset_brief. Writes with no active changeset are refused. " +
        "Never commit or apply a changeset: the user reviews and commits it."
    );
  } else if (mode === "read-safe") {
    lines.push("This session is read-only: answer from the model, and do not try to change it.");
  }
  return lines.join("\n\n");
}

/** The Claude Code agent DrBot runs as (`claude --agent dr-architect`). */
export const DR_ARCHITECT_AGENT = "dr-architect";

/**
 * The tool names in an agent file's frontmatter `tools:` field, or null when the file has no
 * `tools:` field (Claude Code then gives the agent every tool, MCP tools included). Accepts the
 * comma-separated form, a flow list (`[a, b]`) and a block list.
 */
export function parseAgentFrontmatterTools(markdown: string): string[] | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  const index = lines.findIndex((line) => /^tools\s*:/.test(line));
  if (index === -1) return null;
  const unquote = (value: string) =>
    value
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
  const inline = lines[index].replace(/^tools\s*:/, "").trim();
  if (inline) {
    return inline
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map(unquote)
      .filter(Boolean);
  }
  const tools: string[] = [];
  for (const line of lines.slice(index + 1)) {
    const item = /^\s+-\s*(.+)$/.exec(line);
    if (!item) break;
    tools.push(unquote(item[1]));
  }
  return tools;
}

/**
 * The dr-architect agent file Claude Code loads for a session run in `rootPath`: the project's
 * .claude/agents copy wins over the user's ~/.claude/agents copy. Null when neither exists.
 */
export function findInstalledAgentFile(
  rootPath: string,
  homeDir: string = homedir(),
  exists: (path: string) => boolean = existsSync
): string | null {
  for (const base of [rootPath, homeDir]) {
    const candidate = join(base, ".claude", "agents", `${DR_ARCHITECT_AGENT}.md`);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * The dr-architect source shipped with this CLI (the file `dr claude install` copies), with its
 * mcp__dr__* tool names. Built CLI: dist/coding-agents/ → dist/integrations/; from source:
 * cli/src/coding-agents/ → integrations/. Null when neither exists.
 */
export function bundledAgentFile(exists: (path: string) => boolean = existsSync): string | null {
  const relativePaths = [
    `../integrations/claude_code/agents/${DR_ARCHITECT_AGENT}.md`,
    `../../../integrations/claude_code/agents/${DR_ARCHITECT_AGENT}.md`,
  ];
  for (const relativePath of relativePaths) {
    const candidate = fileURLToPath(new URL(relativePath, import.meta.url));
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Which dr-architect copy DrBot runs. `claude --agent dr-architect` picks the project's
 * .claude/agents copy, then the user's ~/.claude/agents copy, then the dr plugin's
 * `dr:dr-architect`. The plugin copy names the tools mcp__plugin_dr_dr__*, which DrBot's MCP
 * server (named `dr`) doesn't serve, so without a project or user copy DrBot passes the bundled
 * source with --agents instead (drBotAgentArgs).
 */
export interface DrBotAgent {
  path: string;
  source: "project" | "user" | "bundled";
}

/** The dr-architect copy DrBot runs in `rootPath`; null when there is none, not even the bundled one. */
export function resolveDrBotAgent(
  rootPath: string,
  homeDir: string = homedir(),
  exists: (path: string) => boolean = existsSync,
  bundledPath: string | null = bundledAgentFile(exists)
): DrBotAgent | null {
  const installed = findInstalledAgentFile(rootPath, homeDir, exists);
  if (installed) {
    return { path: installed, source: installed.startsWith(join(rootPath, ".claude")) ? "project" : "user" };
  }
  return bundledPath ? { path: bundledPath, source: "bundled" } : null;
}

/** A Claude Code --agents entry: what an agent file's frontmatter and body say. */
export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

/** Turns an agent markdown file into a --agents definition. Throws without frontmatter or a description. */
export function agentDefinitionFromMarkdown(markdown: string): AgentDefinition {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) throw new Error("agent file has no frontmatter");
  const frontmatter = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  if (typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
    throw new Error("agent file has no description");
  }
  const definition: AgentDefinition = {
    description: frontmatter.description,
    prompt: markdown.slice(match[0].length).trim(),
  };
  const tools = parseAgentFrontmatterTools(markdown);
  if (tools !== null) definition.tools = tools;
  if (typeof frontmatter.model === "string") definition.model = frontmatter.model;
  return definition;
}

/**
 * Extra `claude` arguments that make `--agent dr-architect` run the copy DrBot checked. Only the
 * bundled copy needs them: `--agents` outranks every installed agent, including the plugin's.
 */
export async function drBotAgentArgs(agent: DrBotAgent | null): Promise<string[]> {
  if (agent?.source !== "bundled") return [];
  const definition = agentDefinitionFromMarkdown(await readFile(agent.path, "utf8"));
  return ["--agents", JSON.stringify({ [DR_ARCHITECT_AGENT]: definition })];
}

/** The dr MCP tools a mode uses that the installed dr-architect agent can't see. */
export interface AgentMcpToolCheck {
  /** The agent file that was checked. */
  path: string;
  /** Where that copy comes from. */
  source: DrBotAgent["source"];
  /** The mcp__dr__* rules the mode uses that the agent's `tools:` field leaves out. */
  missing: string[];
  /** True when the agent can see none of them (a copy installed before DrBot used MCP). */
  noneVisible: boolean;
}

/** Every dr MCP tool DrBot can use in a mode (danger mode may use them all). */
function drMcpToolsForMode(mode: DrBotMode): string[] {
  return mode === "danger"
    ? [...DR_MCP_READ_TOOLS, ...DR_MCP_CHANGESET_TOOLS].map(drMcpToolRule)
    : drMcpAllowedTools(mode);
}

/**
 * Checks that the dr-architect copy DrBot runs (resolveDrBotAgent) lists the dr MCP tools DrBot's
 * mode uses. An agent's `tools:` field limits what it can call, so a copy installed before DrBot
 * moved to MCP can't see the server at all, whatever --allowedTools says. Null when there's
 * nothing to report: no agent file found, no `tools:` field, a server-wide `mcp__dr` entry, or
 * every tool listed.
 */
export async function checkInstalledAgentMcpTools(
  rootPath: string,
  mode: DrBotMode,
  homeDir: string = homedir(),
  agent: DrBotAgent | null = resolveDrBotAgent(rootPath, homeDir)
): Promise<AgentMcpToolCheck | null> {
  if (!agent) return null;
  const { path, source } = agent;
  const tools = parseAgentFrontmatterTools(await readFile(path, "utf8"));
  if (tools === null) return null;
  const listed = new Set(tools);
  if (listed.has(`mcp__${DR_MCP_SERVER_NAME}`) || listed.has(`mcp__${DR_MCP_SERVER_NAME}__*`)) return null;
  const required = drMcpToolsForMode(mode);
  const missing = required.filter((rule) => !listed.has(rule));
  if (missing.length === 0) return null;
  return { path, source, missing, noneVisible: missing.length === required.length };
}
