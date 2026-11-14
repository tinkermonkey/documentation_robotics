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

import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { CHANGESET_ONLY_ENV } from "../core/changeset-only-guard.js";
import { CHANGESET_ORIGIN_ENV } from "../core/changeset-review.js";

/** Name the dr MCP server is registered under; Claude Code exposes its tools as mcp__dr__<tool>. */
export const DR_MCP_SERVER_NAME = "dr";

/** Env var `dr mcp` honours to serve a model from a directory other than its cwd. */
export const DR_MCP_ROOT_PATH_ENV = "DR_MCP_ROOT_PATH";

/** Env var that overrides the dr CLI entry script DrBot's MCP server runs (tests, custom installs). */
export const DR_CLI_ENTRY_ENV = "DR_CLI_ENTRY";

/**
 * Tools that only read: allowed in every DrBot mode. tier1_status is left out: its probe sends a
 * request to the Tier-1 provider and spends from the month's cap, which is the user's call.
 */
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
  "project_status",
]);

/**
 * Tools added in changeset-only mode (`dr visualize --with-changesets`): open and work in a
 * changeset and stage element and relationship changes. The MCP server runs with
 * DR_CHANGESET_ONLY set, so any of these that would write the base model (no active changeset)
 * is refused there (mcp/changeset-only.ts). changeset_update and changeset_unstage revise the
 * plan. Left out on purpose:
 * - changeset_commit: landing needs a person to confirm it, and the server refuses it in
 *   changeset-only mode anyway. Apply is not an MCP tool.
 * - changeset_discard: it deletes the staged changes, and abandoning a changeset is the user's call.
 * - project_init and project_upgrade: they create or migrate the model outside any changeset.
 * - review_open: DrBot already lives in the viewer it would open.
 * - codebase_extract: it writes a changeset from the code, a run the user starts from their own
 *   session. The server still allows it in changeset-only mode, since it only writes a changeset.
 * - chat_launch (an agent launching another agent) and the annotation writers.
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
  // Accepted gaps (#1026): staged into the active changeset only, approved when it lands.
  "gap_accept",
  "gap_reopen",
  // Copies verify's source references into the plan: it writes the plan, so it isn't read-safe.
  "changeset_adopt_source_references",
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
    // Changesets DrBot creates record origin.kind "chat" (changeset-review.ts).
    [CHANGESET_ORIGIN_ENV]: "chat",
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
 * Where Claude Code looks for a session's agents, and what DrBot passes it.
 *
 * Checked against claude 2.1.321 (#1044): a session started in a directory loads every `.md` under
 * `.claude/agents/` (subfolders included) of that directory and each parent, up to the git root
 * (or the filesystem root outside a repo), then the user folder (`$CLAUDE_CONFIG_DIR/agents`, or
 * `~/.claude/agents`), then plugins. An agent's name is its frontmatter `name:`, or the file name
 * without one. For `--agent dr-architect` the nearest folder wins; the dr plugin's own copy,
 * `dr:dr-architect`, comes last and names the plugin's server's tools (mcp__plugin_dr_dr__*),
 * which DrBot's MCP server (named `dr`) doesn't serve.
 */
export interface AgentLookupOptions {
  /** Home directory for `~/.claude/agents`; defaults to the OS home. */
  homeDir?: string;
  /** Environment for CLAUDE_CONFIG_DIR; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** The bundled dr-architect source; defaults to bundledAgentFile(). Null: there is none. */
  bundledPath?: string | null;
}

/** An agents folder Claude Code reads, and whether it counts as the project's or the user's. */
export interface AgentDirectory {
  dir: string;
  source: "project" | "user";
}

/** The agents folders a session started in `rootPath` reads, highest priority first. */
export function agentDirectories(rootPath: string, options: AgentLookupOptions = {}): AgentDirectory[] {
  const env = options.env ?? process.env;
  const configDir = env.CLAUDE_CONFIG_DIR;
  const userDir = configDir
    ? resolve(configDir, "agents")
    : join(options.homeDir ?? homedir(), ".claude", "agents");
  const dirs: AgentDirectory[] = [];
  let dir = resolve(rootPath);
  for (;;) {
    const agents = join(dir, ".claude", "agents");
    if (agents !== userDir) dirs.push({ dir: agents, source: "project" });
    if (existsSync(join(dir, ".git"))) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dirs.push({ dir: userDir, source: "user" });
  return dirs;
}

/** The name Claude Code gives an agent file: frontmatter `name:`, else the file name. */
function agentFileName(path: string): string {
  try {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, "utf8"));
    const frontmatter = match ? (parseYaml(match[1]) as Record<string, unknown> | null) : null;
    if (typeof frontmatter?.name === "string" && frontmatter.name.trim()) return frontmatter.name.trim();
  } catch {
    // Unreadable or malformed frontmatter: Claude Code falls back to the file name too.
  }
  return basename(path, ".md");
}

/** Every .md file under a folder, subfolders included, in a stable order. Empty when it doesn't exist. */
function markdownFiles(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(path));
    else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

/** An installed dr-architect Claude Code would load before the plugin's, or null. */
export function findInstalledAgentFile(
  rootPath: string,
  options: AgentLookupOptions = {}
): { path: string; source: "project" | "user" } | null {
  for (const { dir, source } of agentDirectories(rootPath, options)) {
    const path = markdownFiles(dir).find((file) => agentFileName(file) === DR_ARCHITECT_AGENT);
    if (path) return { path, source };
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

/** The dr-architect copy DrBot runs, and where it comes from. */
export interface DrBotAgent {
  path: string;
  source: "project" | "user" | "bundled";
}

/**
 * The dr-architect copy DrBot runs in `rootPath`: an installed project or user copy, else the
 * bundled source (passed with --agents, which outranks the plugin's copy). Null when there is
 * none at all.
 */
export function resolveDrBotAgent(rootPath: string, options: AgentLookupOptions = {}): DrBotAgent | null {
  const installed = findInstalledAgentFile(rootPath, options);
  if (installed) return installed;
  const bundledPath = options.bundledPath === undefined ? bundledAgentFile() : options.bundledPath;
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
 * Extra `claude` arguments that make `--agent dr-architect` run `agent`. Only the bundled copy
 * needs them: `--agents` outranks every installed agent, the plugin's included. Throws when the
 * bundled file can't be read or parsed.
 */
export async function drBotAgentArgs(agent: DrBotAgent | null): Promise<string[]> {
  if (agent?.source !== "bundled") return [];
  const definition = agentDefinitionFromMarkdown(await readFile(agent.path, "utf8"));
  return ["--agents", JSON.stringify({ [DR_ARCHITECT_AGENT]: definition })];
}

/** The dr MCP tools a mode uses that the dr-architect DrBot runs can't see. */
export interface AgentMcpToolCheck {
  /** The agent file that was checked. */
  path: string;
  /** Where that copy comes from. */
  source: DrBotAgent["source"];
  /** The mcp__dr__* rules the mode uses that the agent's `tools:` field leaves out. */
  missing: string[];
  /** True when the agent can see none of them (a copy installed before DrBot used MCP). */
  noneVisible: boolean;
  /**
   * Set when the bundled copy couldn't be passed with --agents. Claude Code then runs whatever it
   * finds (the plugin's copy, say), so DrBot can't count on any dr tool: noneVisible is true.
   */
  error?: string;
}

/** Every dr MCP tool DrBot can use in a mode (danger mode may use them all). */
function drMcpToolsForMode(mode: DrBotMode): string[] {
  return mode === "danger"
    ? [...DR_MCP_READ_TOOLS, ...DR_MCP_CHANGESET_TOOLS].map(drMcpToolRule)
    : drMcpAllowedTools(mode);
}

/**
 * Checks that an agent file lists the dr MCP tools DrBot's mode uses. An agent's `tools:` field
 * limits what it can call, so a copy installed before DrBot moved to MCP can't see the server at
 * all, whatever --allowedTools says. Null when there's nothing to report: no agent, no `tools:`
 * field, a server-wide `mcp__dr` entry, or every tool listed.
 */
export async function checkAgentMcpTools(
  agent: DrBotAgent | null,
  mode: DrBotMode
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

/** checkAgentMcpTools for the copy resolveDrBotAgent picks in `rootPath`. */
export async function checkInstalledAgentMcpTools(
  rootPath: string,
  mode: DrBotMode,
  options: AgentLookupOptions = {}
): Promise<AgentMcpToolCheck | null> {
  return checkAgentMcpTools(resolveDrBotAgent(rootPath, options), mode);
}

/** The dr-architect DrBot runs: the extra claude arguments and the tool check, from one lookup. */
export interface DrBotAgentLaunch {
  agent: DrBotAgent | null;
  /** `--agents <json>` for the bundled copy, else empty. */
  args: string[];
  check: AgentMcpToolCheck | null;
}

/**
 * Resolves DrBot's dr-architect once and derives both the launch arguments and the tool check
 * from it. When the bundled copy can't be passed, the check reports that no dr tool is visible
 * (with `error`) rather than passing against a file claude won't run. Throws if an installed
 * copy can't be read.
 */
export async function prepareDrBotAgent(
  rootPath: string,
  mode: DrBotMode,
  options: AgentLookupOptions = {}
): Promise<DrBotAgentLaunch> {
  const agent = resolveDrBotAgent(rootPath, options);
  let args: string[];
  try {
    args = await drBotAgentArgs(agent);
  } catch (error) {
    const missing = drMcpToolsForMode(mode);
    return {
      agent,
      args: [],
      check: {
        path: agent!.path,
        source: "bundled",
        missing,
        noneVisible: true,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
  return { agent, args, check: await checkAgentMcpTools(agent, mode) };
}
