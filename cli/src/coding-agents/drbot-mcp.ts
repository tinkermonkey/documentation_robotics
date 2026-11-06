/**
 * DrBot on MCP: connect the viewer's chat agent to the dr MCP server.
 *
 * `dr visualize` launches Claude Code as DrBot (server/server.ts). Rather than having the
 * agent shell out to `dr` through Bash, the launch hands Claude Code an MCP config that runs
 * this same dr installation's `dr mcp` over stdio, pointed at the served model, so DrBot plans
 * changes with the change-modeling tools (changeset_create, spec_type, model_add,
 * relationship_add, changeset_brief) the way any other agent does.
 *
 * Authentication: `dr mcp` over stdio requires DR_MCP_API_KEY to match the installation's
 * stored key (mcp/api-key-manager.ts). Over stdio the client supplies both the process and its
 * environment, so a key minted per launch would only be checked against itself; the launch
 * instead resolves the installation key (creating it on first use, as `dr mcp` does) and puts
 * it only in a private temp config file (0600, in a 0700 directory under the OS temp dir),
 * never in the repo, the model directory or the process arguments. The file is removed when the
 * agent process exits.
 *
 * Tolerance: if anything here fails (no key, no temp dir), the caller launches DrBot without
 * MCP and it falls back to the read-safe Bash rules; the failure is logged, not swallowed.
 */

import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiKeyManager } from "../mcp/api-key-manager.js";
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
  "spec_type",
  "annotation_list",
  "annotation_get",
  "chat_status",
]);

/**
 * Tools added in changeset-only mode (`dr visualize --with-changesets`): open and work in a
 * changeset and stage element and relationship changes. The MCP server runs with
 * DR_CHANGESET_ONLY set, so any of these that would write the base model (no active changeset)
 * is refused there (mcp/changeset-only.ts). Commit, apply and discard are not MCP tools at all.
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
  apiKey: string;
  /** Project root of the served model. */
  rootPath: string;
  /** Run the server in changeset-only mode (DR_CHANGESET_ONLY=true). */
  changesetOnly: boolean;
}

/** The Claude Code MCP config (the --mcp-config file's content) for DrBot's dr server. */
export function buildDrMcpConfig(options: DrMcpConfigOptions): {
  mcpServers: Record<string, { type: "stdio"; command: string; args: string[]; env: Record<string, string> }>;
} {
  const env: Record<string, string> = {
    DR_MCP_API_KEY: options.apiKey,
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
  keyManager?: Pick<ApiKeyManager, "ensureKey">;
  drCommand?: DrCommand;
  /** Parent directory for the private config directory; defaults to the OS temp dir. */
  tempRoot?: string;
}

/**
 * Writes DrBot's MCP config to a private temp file. Throws on failure; the caller decides to
 * launch without MCP.
 */
export async function prepareDrMcpLaunch(options: PrepareDrMcpLaunchOptions): Promise<DrMcpLaunch> {
  const keyManager = options.keyManager ?? new ApiKeyManager();
  // No prompt: the server is non-interactive, so a first-time key goes to the default path.
  const { key } = await keyManager.ensureKey();
  const config = buildDrMcpConfig({
    drCommand: options.drCommand ?? resolveDrCommand(),
    apiKey: key,
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
    await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
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
