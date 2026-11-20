/**
 * The chat agent's rules, decided in one place and enforced by dr itself.
 *
 * The viewer's chat agent may read the model or stage into a changeset. It never lands a
 * changeset, runs no shell command but a single `dr` command, and reaches nothing outside the
 * served project. The launch tells Claude Code that with an allowlist (default-permissions.ts,
 * drbot-mcp.ts), but an allowlist is the launching CLI's to keep: a prefix rule matches more than
 * it means (`dr export` also takes `--output <any path>`), and another client (Copilot) may not
 * enforce one at all. So every process a non-danger chat launch starts carries `DR_CHAT_MODE`,
 * and three things ask this module before anything runs:
 * - `dr` itself (the preAction hook in cli.ts): `assertChatCommandAllowed`;
 * - `dr mcp` (the tool registry): `chatToolRefusal`;
 * - Claude Code's PreToolUse hook, which the launch points at `dr chat-permission-hook`:
 *   `chatPermissionHookDecision`. Its reason is what the agent reads for a refused Bash call.
 *
 * What a mode refuses: a command or tool outside its list (commit, apply, discard, delete;
 * staging in a read-only viewer); an option that writes a file (`--output`, `--save-snapshot`);
 * a model, codebase or `rootPath` outside the served project; and, through Bash, anything that
 * is not one plain `dr` command.
 *
 * Danger mode (`dr visualize --with-danger`) sets no mode, so nothing here applies to it.
 */

import { resolve, sep } from "node:path";
import { CLIError, ErrorCategory } from "../utils/errors.js";
import { CHANGESET_WRITE_COMMANDS, READ_SAFE_DR_COMMANDS, USER_ONLY_DR_COMMANDS } from "./default-permissions.js";

/** Set to a ChatMode in every process a non-danger chat launch starts. */
export const CHAT_MODE_ENV = "DR_CHAT_MODE";

/** What a chat process may do: read only, or also stage into a changeset. */
export type ChatMode = "read-safe" | "changesets";

/** The hidden `dr` command the launch registers as Claude Code's PreToolUse hook. */
export const CHAT_PERMISSION_HOOK_COMMAND = "chat-permission-hook";

/**
 * `dr` commands a chat launch itself runs, which the agent's own lists don't name. The launch
 * runs each with no option at all, so only that form is let through: `dr mcp --regenerate-key`
 * writes a key file, and `dr mcp --transport http --host 0.0.0.0` opens a listener.
 */
const LAUNCHER_COMMANDS: readonly string[] = ["dr mcp", `dr ${CHAT_PERMISSION_HOOK_COMMAND}`];

/** How every refusal starts, so the server can tell one from a command's own failure. */
export const REFUSAL_MARKER = "Blocked by DrBot's permissions";

/** What the person calls each chat mode. */
export const CHAT_MODE_LABELS: Readonly<Record<ChatMode, string>> = Object.freeze({
  "read-safe": "read-only",
  changesets: "changeset staging",
});

/** dr command groups whose subcommand is part of the command's name (`dr changeset create`). */
const DR_COMMAND_GROUPS = new Set([
  "changeset",
  "relationship",
  "element",
  "schema",
  "catalog",
  "docs",
  "reports",
  "analyzer",
  "farm",
  "claude",
  "copilot",
]);

/**
 * The chat mode this process runs under, or null outside a chat. Unset or empty means none. An
 * unrecognised value fails safe to read-only, so a typo never widens what an agent may do.
 */
export function chatMode(env: NodeJS.ProcessEnv = process.env): ChatMode | null {
  const raw = env[CHAT_MODE_ENV]?.trim();
  if (!raw) return null;
  return raw === "changesets" ? "changesets" : "read-safe";
}

/** The `dr` commands a mode allows. */
export function chatCommandsForMode(mode: ChatMode): readonly string[] {
  return mode === "changesets" ? [...READ_SAFE_DR_COMMANDS, ...CHANGESET_WRITE_COMMANDS] : READ_SAFE_DR_COMMANDS;
}

/** The longest listed command a command line is, or starts with, or undefined. */
export function matchDrCommand(commandLine: string, commands: readonly string[]): string | undefined {
  return commands
    .filter((command) => commandLine === command || commandLine.startsWith(`${command} `))
    .sort((a, b) => b.length - a.length)[0];
}

/** Whether `path` is `root` or inside it. Both are resolved first; symlinks are not followed. */
export function isInsideProject(path: string, root: string): boolean {
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, path);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + sep);
}

/** Why a chat process may not do something, and what to do about it. */
export interface ChatRefusal {
  reason: string;
  remedy: string;
}

const DANGER_REMEDY =
  "To allow it, restart the viewer with `dr visualize --with-danger`, which removes DrBot's allowlist altogether.";
const READ_ONLY_REMEDY =
  "To allow it, restart the viewer without --read-only (plain `dr visualize`): DrBot can then stage the change " +
  "in a changeset for you to review and apply.";
const USER_STEP_REMEDY = "DrBot can't do this in any mode except --with-danger: do it yourself.";
const OTHER_PROJECT_REMEDY = "DrBot works on the served project only: open a viewer on the other project.";

/**
 * A refusal as one paragraph: the rule, that nobody was asked, the way to allow it, and where
 * the rule lives. The same text reaches the agent (the hook's reason, or dr's own error) and the
 * person (the viewer's failed tool result).
 */
export function formatChatRefusal(mode: ChatMode, refusal: ChatRefusal): string {
  return (
    `${REFUSAL_MARKER} (${CHAT_MODE_LABELS[mode]} mode): ${refusal.reason} ` +
    `Nobody was asked to approve it and no prompt is coming. ${refusal.remedy} ` +
    "The allowlist is set by the flags `dr visualize` was started with, not by a settings file, " +
    "and it can't be changed from inside the viewer."
  );
}

/** A command the mode's lists don't allow: whose step it is, or that it isn't listed. */
function commandNotAllowed(mode: ChatMode, commandLine: string, name: string): ChatRefusal | null {
  const userOnly = matchDrCommand(commandLine, Object.keys(USER_ONLY_DR_COMMANDS));
  if (userOnly) return { reason: `\`${userOnly}\`: ${USER_ONLY_DR_COMMANDS[userOnly]}.`, remedy: USER_STEP_REMEDY };
  if (matchDrCommand(commandLine, chatCommandsForMode(mode))) return null;
  const staging = matchDrCommand(commandLine, CHANGESET_WRITE_COMMANDS);
  return staging && mode === "read-safe"
    ? {
        reason: `\`${staging}\` changes the model, and this viewer was started with --read-only.`,
        remedy: READ_ONLY_REMEDY,
      }
    : {
        reason: `\`${name}\` is not on DrBot's allowlist in ${CHAT_MODE_LABELS[mode]} mode.`,
        remedy: DANGER_REMEDY,
      };
}

/** What a command's options ask for that no chat mode (or not this one) allows. */
interface RiskyOptions {
  /** Flags that write a file wherever the path points (`--output`, `--save-snapshot`). */
  writesFile?: string;
  adoptsSourceReferences?: boolean;
  /** `[flag, value]` of each option that names a model or codebase path. */
  paths?: Array<[string, string]>;
  readsOtherModels?: boolean;
}

function optionsRefusal(mode: ChatMode, risky: RiskyOptions, projectRoot: string): ChatRefusal | null {
  if (risky.writesFile) {
    return {
      reason: `\`${risky.writesFile}\` writes a file, and DrBot may only read the model or stage into a changeset.`,
      remedy: "DrBot can run the command without it and read the output; run it with the flag yourself if you want the file.",
    };
  }
  if (risky.adoptsSourceReferences && mode === "read-safe") {
    return {
      reason: "`--adopt-source-references` writes the plan, and this viewer was started with --read-only.",
      remedy: READ_ONLY_REMEDY,
    };
  }
  for (const [flag, value] of risky.paths ?? []) {
    if (!isInsideProject(value, projectRoot)) {
      return {
        reason: `\`${flag} ${value}\` points outside the project this viewer serves (${resolve(projectRoot)}).`,
        remedy: OTHER_PROJECT_REMEDY,
      };
    }
  }
  if (risky.readsOtherModels) {
    return {
      reason: "`--model-path` reads other projects' models.",
      remedy: OTHER_PROJECT_REMEDY,
    };
  }
  return null;
}

/**
 * Why this chat mode refuses a `dr` command, or null when it may run. `path` is the command as
 * commander resolved it (`dr changeset commit`), `options` its parsed options (global ones
 * included), `projectRoot` the served project, `given` the options given on the command line or
 * through the environment rather than left at their defaults (as `--regenerate-key`).
 */
export function chatCommandRefusal(
  mode: ChatMode,
  path: string,
  options: Readonly<Record<string, unknown>>,
  projectRoot: string,
  given: readonly string[] = []
): ChatRefusal | null {
  const launcher = matchDrCommand(path, LAUNCHER_COMMANDS);
  if (launcher) {
    return given.length === 0
      ? null
      : {
          reason:
            `\`${launcher}\` runs only as the viewer starts it, with no options, and ` +
            `${given.map((flag) => `\`${flag}\``).join(", ")} was given.`,
          remedy: "DrBot never needs to run it: the viewer has already started it for this chat.",
        };
  }
  const notAllowed = commandNotAllowed(mode, path, path);
  if (notAllowed) return notAllowed;
  const set = (key: string) => options[key] !== undefined && options[key] !== false;
  return optionsRefusal(
    mode,
    {
      writesFile: set("output") ? "--output" : set("saveSnapshot") ? "--save-snapshot" : undefined,
      adoptsSourceReferences: set("adoptSourceReferences"),
      paths: (
        [
          ["--model", options.model],
          ["--codebase-path", options.codebasePath],
        ] as Array<[string, unknown]>
      ).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      readsOtherModels: set("modelPath"),
    },
    projectRoot
  );
}

/** The slice of a commander Command this guard reads. */
export interface CommandLike {
  name(): string;
  parent?: CommandLike | null;
  opts(): Record<string, unknown>;
  /** Where an option's value came from ("default", "cli", "env", ...). */
  getOptionValueSource?(key: string): string | undefined;
}

/** `--regenerate-key` from the option key `regenerateKey`. */
function flagName(key: string): string {
  return "--" + key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** `dr changeset commit`, from the command commander is about to run. */
export function commandPath(command: CommandLike): string {
  const names: string[] = [];
  for (let current: CommandLike | null | undefined = command; current; current = current.parent) {
    names.unshift(current.name());
  }
  return names.join(" ");
}

/**
 * Throws when this process runs under a chat mode that refuses the command about to run. Called
 * from the CLI's preAction hook, so it runs before any command touches the model or the disk.
 * The agent reads the error as the command's own output.
 */
export function assertChatCommandAllowed(
  actionCommand: CommandLike,
  env: NodeJS.ProcessEnv = process.env,
  projectRoot: string = process.cwd()
): void {
  const mode = chatMode(env);
  if (!mode) return;
  const options: Record<string, unknown> = {};
  const given: string[] = [];
  for (let current: CommandLike | null | undefined = actionCommand; current; current = current.parent) {
    for (const [key, value] of Object.entries(current.opts())) {
      if (!(key in options)) options[key] = value;
      const source = current.getOptionValueSource?.(key);
      // An option with no recorded source but a value set counts as given, so nothing slips by.
      if (source !== undefined ? source !== "default" && source !== "implied" : value !== undefined && value !== false) {
        given.push(flagName(key));
      }
    }
  }
  const path = commandPath(actionCommand);
  const refusal = chatCommandRefusal(mode, path, options, projectRoot, given);
  if (refusal) {
    throw new CLIError(formatChatRefusal(mode, refusal), ErrorCategory.USER, ["Don't retry it."], {
      operation: path,
      context: `${CHAT_MODE_ENV}=${mode}`,
    });
  }
}

/** A Bash command line split the way a shell would, as far as this guard needs. */
export interface ShellLine {
  /** The words of the first command, quotes removed. */
  tokens: string[];
  /**
   * True when the line is more than one plain command: a pipe, `&&`, `;`, a redirect, a
   * substitution or expansion (`$(…)`, backticks, `$VAR`), a newline, or an unclosed quote.
   * Characters inside quotes don't count, except what a shell still runs inside double quotes.
   */
  complex: boolean;
}

/** Splits a Bash command line into its first command's words and whether it is a plain command. */
export function splitShellLine(line: string): ShellLine {
  const tokens: string[] = [];
  let current = "";
  let inToken = false;
  let quote: "'" | '"' | null = null;
  let complex = false;
  let ended = false; // The first command is over: an operator was seen.
  const push = () => {
    if (inToken && !ended) tokens.push(current);
    current = "";
    inToken = false;
  };
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }
    if (char === "`" || char === "$") {
      // A substitution or an expansion runs, or changes the words, even inside double quotes.
      complex = true;
      current += char;
      inToken = true;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "\\" && i + 1 < line.length) current += line[++i];
      else current += char;
      continue;
    }
    if (char === "~" && !inToken) complex = true; // The shell expands it to the home directory.
    if (char === "'" || char === '"') {
      quote = char;
      inToken = true;
    } else if (char === "\\" && i + 1 < line.length) {
      current += line[++i];
      inToken = true;
    } else if (/\s/.test(char)) {
      if (char === "\n" || char === "\r") {
        complex = true;
        push();
        ended = true;
      } else {
        push();
      }
    } else if ("|&;<>(){}".includes(char)) {
      complex = true;
      push();
      ended = true;
    } else {
      current += char;
      inToken = true;
    }
  }
  if (quote) complex = true;
  push();
  return { tokens, complex };
}

/** `dr changeset create` from the words of `dr changeset create x --description y`. */
function drCommandName(tokens: readonly string[]): string {
  const [, first, second] = tokens;
  if (!first || first.startsWith("-")) return "dr";
  return DR_COMMAND_GROUPS.has(first) && second && !second.startsWith("-") ? `dr ${first} ${second}` : `dr ${first}`;
}

/** The value of `--flag value` or `--flag=value` among a command's words, or undefined. */
function flagValue(tokens: readonly string[], flag: string): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === flag) return tokens[i + 1] ?? "";
    if (tokens[i].startsWith(`${flag}=`)) return tokens[i].slice(flag.length + 1);
  }
  return undefined;
}

/**
 * Why this chat mode refuses a Bash command line, or null when it is one plain `dr` command the
 * mode allows. A forbidden command is named before the shell syntax around it, so `dr changeset
 * commit x 2>&1` is told that committing is the person's step, not that the redirect is the problem.
 */
export function chatBashRefusal(mode: ChatMode, commandLine: string, projectRoot: string): ChatRefusal | null {
  const { tokens, complex } = splitShellLine(commandLine);
  if (tokens.length === 0) {
    return { reason: "the shell call is not a `dr` command.", remedy: DANGER_REMEDY };
  }
  if (tokens[0] !== "dr") {
    return {
      reason: `\`${tokens[0]}\` is not a dr command, and through the shell DrBot may run only dr commands.`,
      remedy: DANGER_REMEDY,
    };
  }
  const notAllowed = commandNotAllowed(mode, tokens.join(" "), drCommandName(tokens));
  if (notAllowed) return notAllowed;
  const has = (flag: string) => flagValue(tokens, flag) !== undefined;
  const paths = (["--model", "--codebase-path"] as const)
    .map((flag): [string, string | undefined] => [flag, flagValue(tokens, flag)])
    .filter((entry): entry is [string, string] => entry[1] !== undefined);
  const options = optionsRefusal(
    mode,
    {
      writesFile: has("--output") ? "--output" : has("--save-snapshot") ? "--save-snapshot" : undefined,
      adoptsSourceReferences: has("--adopt-source-references"),
      paths,
      readsOtherModels: has("--model-path"),
    },
    projectRoot
  );
  if (options) return options;
  if (complex) {
    return {
      reason:
        "the call chains, redirects, substitutes or expands shell syntax, and DrBot may run only one plain `dr` command per call.",
      remedy: "Nothing needs changing: DrBot can run the dr commands one at a time and read their output itself.",
    };
  }
  return null;
}

/**
 * The PreToolUse hook's answer for one tool call: the reason to deny it with, or null to leave
 * the decision to Claude Code's own rules. Only Bash is judged here: the file tools are confined
 * to the project by the launch, and the dr MCP server judges its own tools.
 */
export function chatPermissionHookDecision(input: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  const mode = chatMode(env);
  if (!mode || typeof input !== "object" || input === null) return null;
  const call = input as { tool_name?: unknown; tool_input?: { command?: unknown } | null; cwd?: unknown };
  if (call.tool_name !== "Bash") return null;
  const commandLine = typeof call.tool_input?.command === "string" ? call.tool_input.command : "";
  const projectRoot = typeof call.cwd === "string" && call.cwd ? call.cwd : process.cwd();
  const refusal = chatBashRefusal(mode, commandLine, projectRoot);
  return refusal ? formatChatRefusal(mode, refusal) : null;
}

/** What `dr chat-permission-hook` prints for a denied call (Claude Code's PreToolUse hook output). */
export function chatPermissionHookOutput(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

/** dr MCP tools no chat mode allows, with whose step each is. */
export const USER_ONLY_MCP_TOOLS: Readonly<Record<string, string>> = Object.freeze({
  changeset_commit: "landing a changeset is the person's step: Apply in the viewer",
  changeset_commit_preview: "landing a changeset is the person's step: Apply in the viewer",
  changeset_discard: "discarding a changeset is the person's step: Discard in the viewer",
  project_init: "creating a model is the person's step",
  project_upgrade: "migrating the model to a new spec version is the person's step",
});

/** The dr MCP tools each chat mode may call (drbot-mcp.ts has the lists). */
export interface ChatToolLists {
  read: readonly string[];
  staging: readonly string[];
}

/** Why this chat mode refuses a dr MCP tool, whatever its arguments, or null. */
export function chatToolNotAllowed(mode: ChatMode, toolName: string, lists: ChatToolLists): ChatRefusal | null {
  if (USER_ONLY_MCP_TOOLS[toolName]) {
    return { reason: `\`${toolName}\`: ${USER_ONLY_MCP_TOOLS[toolName]}.`, remedy: USER_STEP_REMEDY };
  }
  if (lists.read.includes(toolName)) return null;
  if (lists.staging.includes(toolName)) {
    return mode === "changesets"
      ? null
      : {
          reason: `\`${toolName}\` changes the model, and this viewer was started with --read-only.`,
          remedy: READ_ONLY_REMEDY,
        };
  }
  return {
    reason: `\`${toolName}\` is not on DrBot's allowlist in ${CHAT_MODE_LABELS[mode]} mode.`,
    remedy: DANGER_REMEDY,
  };
}

/**
 * The refusal for a dr MCP tool call in a chat process, or null when it may run (always null
 * outside a chat). `rootPath` is the call's argument; `servedRoot` the project the server serves.
 */
export function chatToolRefusal(
  toolName: string,
  rootPath: string | undefined,
  servedRoot: string,
  lists: ChatToolLists,
  env: NodeJS.ProcessEnv = process.env
): CLIError | null {
  const mode = chatMode(env);
  if (!mode) return null;
  const refusal: ChatRefusal | null =
    rootPath !== undefined && rootPath !== "" && resolve(rootPath) !== resolve(servedRoot)
      ? {
          reason: `rootPath ${rootPath} is not the project this viewer serves (${resolve(servedRoot)}).`,
          remedy: "Omit rootPath. " + OTHER_PROJECT_REMEDY,
        }
      : chatToolNotAllowed(mode, toolName, lists);
  if (!refusal) return null;
  return new CLIError(formatChatRefusal(mode, refusal), ErrorCategory.USER, ["Don't retry it."], {
    operation: toolName,
    context: `${CHAT_MODE_ENV}=${mode}`,
  });
}
