/**
 * What DrBot's permissions are, in words: for the agent at the start of a launch, and for the
 * person when a call is refused.
 *
 * `dr visualize` launches Claude Code with `--print` and an allowlist (`--allowedTools`), so
 * nobody can answer a permission prompt: a call outside the list comes back as "This command
 * requires approval" and nothing else (#1241). That text says neither which rule refused the call
 * nor where the rule lives, and the agent can't find out: the list is an argument of its own
 * launch, not a settings file it can read. So the launch tells the agent its mode and its rules
 * (drBotSessionPrompt), and the server adds the reason to a refused call's result in the viewer
 * (explainDeniedToolCall).
 */

import { CHANGESET_WRITE_COMMANDS, READ_SAFE_DR_COMMANDS, USER_ONLY_DR_COMMANDS } from "./default-permissions.js";
import {
  DR_MCP_CHANGESET_TOOLS,
  DR_MCP_READ_TOOLS,
  DR_MCP_SERVER_NAME,
  drBotMcpPrompt,
  type DrBotMode,
} from "./drbot-mcp.js";

/** The flag that starts the viewer with a read-only chat. */
export const READ_ONLY_FLAG = "--read-only";

/** What the person calls each mode. */
export const DRBOT_MODE_LABELS: Readonly<Record<DrBotMode, string>> = Object.freeze({
  "read-safe": "read-only",
  changesets: "changeset staging",
  danger: "unrestricted",
});

/** dr MCP tools no chat mode short of --with-danger allows, with whose step each is. */
const USER_ONLY_MCP_TOOLS: Readonly<Record<string, string>> = Object.freeze({
  changeset_commit: "landing a changeset is the person's step: Apply in the viewer",
  changeset_commit_preview: "landing a changeset is the person's step: Apply in the viewer",
  changeset_discard: "discarding a changeset is the person's step: Discard in the viewer",
  project_init: "creating a model is the person's step",
  project_upgrade: "migrating the model to a new spec version is the person's step",
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

export interface DrBotSessionOptions {
  /** The dr MCP server is connected for this launch. */
  mcpConnected: boolean;
}

/** The Bash dr commands a mode allows. */
function bashCommandsForMode(mode: DrBotMode): readonly string[] {
  return mode === "changesets" ? [...READ_SAFE_DR_COMMANDS, ...CHANGESET_WRITE_COMMANDS] : READ_SAFE_DR_COMMANDS;
}

/**
 * Appended to DrBot's system prompt on every launch, with or without the dr MCP server: how to
 * reach the model, the session's permission mode, and what a refused call means. Danger mode has
 * no allowlist, so it only gets the MCP note.
 */
export function drBotSessionPrompt(mode: DrBotMode, options: DrBotSessionOptions): string {
  const parts: string[] = [];
  if (options.mcpConnected) {
    parts.push(drBotMcpPrompt(mode));
  } else if (mode === "changesets") {
    parts.push(
      "The dr MCP server is not connected in this session, so work through Bash: one `dr` command per call. " +
        "This session may change the model only through a changeset. Run `dr changeset create <name>` first (it " +
        "activates the new changeset), then stage changes with `dr add`, `dr update` and `dr relationship add`. " +
        "Writes with no active changeset are refused. Never commit or apply a changeset: the user reviews and commits it."
    );
  } else if (mode === "read-safe") {
    parts.push(
      "The dr MCP server is not connected in this session, so read the model through Bash: one `dr` command per " +
        "call. This session is read-only: answer from the model, and do not try to change it."
    );
  }
  if (mode === "danger") return parts.join("\n\n");

  const allowed = [
    ...(options.mcpConnected ? [`the mcp__${DR_MCP_SERVER_NAME}__* tools you were given`] : []),
    "Read",
    "through Bash, one `dr` command per call (no pipes, `&&`, `;`, redirects or substitutions) from: " +
      bashCommandsForMode(mode).join(", "),
  ];
  const blocked =
    mode === "read-safe"
      ? "every change to the model (this viewer was started with " +
        `${READ_ONLY_FLAG}), editing files, and any other shell command`
      : "writes outside a changeset; committing, applying, discarding or deleting a changeset (the person does " +
        "that with Apply or Discard in the viewer); editing files; and any other shell command";
  const unblock =
    mode === "read-safe"
      ? `to let you stage changes in a changeset, they restart the viewer without ${READ_ONLY_FLAG} (plain \`dr visualize\`); ` +
        "`dr visualize --with-danger` removes the allowlist altogether"
      : "`dr visualize --with-danger` removes the allowlist altogether; landing a changeset is always theirs to do";
  parts.push(
    [
      `Permissions in this chat (mode: ${DRBOT_MODE_LABELS[mode]}):`,
      '- Nobody can answer a permission prompt here. A call that comes back "This command requires approval", or ' +
        "saying a permission was requested or not granted, was refused by this session's allowlist. The person saw " +
        "no prompt and none is coming: don't wait for one, and don't retry the same call.",
      "- The allowlist is fixed when the viewer starts, by the flags given to `dr visualize`. It is in no settings " +
        "file (not .claude/settings.json, not ~/.claude): don't look for one and don't suggest editing one.",
      `- Allowed: ${allowed.join("; ")}. \`dr help <command>\` shows any command's help.`,
      `- Blocked on purpose: ${blocked}.`,
      "- So don't plan steps this mode can't carry out. When the person asks for one, or a call is refused, tell " +
        `them which call it was, which of these rules covers it, and how they allow it: ${unblock}. It can't be ` +
        "approved from inside the viewer.",
    ].join("\n")
  );
  return parts.join("\n\n");
}

/** Texts Claude Code returns for a call its permission rules refused under --print. */
const DENIAL_PATTERNS: readonly RegExp[] = [
  /requires approval/i,
  /requested permissions? to/i,
  /haven't granted/i,
  // The server's own text for a refusal the turn listed but never answered.
  /^Permission denied: /,
  /contains multiple operations/i,
  /obfuscation/i,
];

/** Whether a failed tool result reads as a permission refusal rather than the tool's own error. */
export function isPermissionDenial(resultText: string): boolean {
  return DENIAL_PATTERNS.some((pattern) => pattern.test(resultText));
}

/** A tool call as Claude Code's stream reports it. */
export interface DeniedToolCall {
  toolName: unknown;
  toolInput: unknown;
}

/** The longest listed command a command line starts with, or undefined. */
function matchDrCommand(commandLine: string, commands: readonly string[]): string | undefined {
  return commands
    .filter((command) => commandLine === command || commandLine.startsWith(`${command} `))
    .sort((a, b) => b.length - a.length)[0];
}

/** `dr changeset create` from `dr changeset create x --description y`; `dr delete` from `dr delete a.b.c`. */
function drCommandName(commandLine: string): string {
  const [, first, second] = commandLine.split(" ");
  if (!first || first.startsWith("-")) return "dr";
  return DR_COMMAND_GROUPS.has(first) && second && !second.startsWith("-") ? `dr ${first} ${second}` : `dr ${first}`;
}

/** Shell syntax that makes a Bash call more than one plain command. */
const SHELL_OPERATORS = /[|&;<>`]|\$\(|\$\{/;

interface Refusal {
  /** Which rule refused the call. */
  reason: string;
  /** How the person allows it, or what to do instead. */
  remedy: string;
}

const DANGER_REMEDY =
  "To allow it, restart the viewer with `dr visualize --with-danger`, which removes DrBot's allowlist altogether.";
const READ_ONLY_REMEDY =
  `To allow it, restart the viewer without ${READ_ONLY_FLAG} (plain \`dr visualize\`): DrBot can then stage the ` +
  "change in a changeset for you to review and apply.";
const USER_STEP_REMEDY = "DrBot can't do this in any mode except --with-danger: do it yourself.";

function refusalFor(mode: DrBotMode, call: DeniedToolCall, options: DrBotSessionOptions): Refusal {
  const toolName = typeof call.toolName === "string" ? call.toolName : "";
  const modeLabel = DRBOT_MODE_LABELS[mode];
  const notListed = (what: string): Refusal => ({
    reason: `${what} is not on DrBot's allowlist in ${modeLabel} mode.`,
    remedy: DANGER_REMEDY,
  });

  if (toolName === "Bash") {
    const input = call.toolInput as { command?: unknown } | null | undefined;
    const commandLine = typeof input?.command === "string" ? input.command.trim().replace(/\s+/g, " ") : "";
    if (!commandLine) return notListed("this shell command");
    if (SHELL_OPERATORS.test(commandLine)) {
      return {
        reason:
          "the call chains, redirects or substitutes shell commands, and DrBot may run only one plain `dr` command per call.",
        remedy: "Nothing needs changing: DrBot can run the dr commands one at a time and read their output itself.",
      };
    }
    if (commandLine !== "dr" && !commandLine.startsWith("dr ")) {
      return {
        reason: `\`${commandLine.split(" ")[0]}\` is not a dr command, and through the shell DrBot may run only dr commands.`,
        remedy: DANGER_REMEDY,
      };
    }
    const userOnly = matchDrCommand(commandLine, Object.keys(USER_ONLY_DR_COMMANDS));
    if (userOnly)
      return {
        reason: `\`${userOnly}\`: ${USER_ONLY_DR_COMMANDS[userOnly]}.`,
        remedy: USER_STEP_REMEDY,
      };
    const listed = matchDrCommand(commandLine, bashCommandsForMode(mode));
    if (listed) {
      return {
        reason:
          `\`${listed}\` is allowed, but Claude Code could not check this form of it ` +
          "(quoting or expansion it does not accept without approval).",
        remedy: "Nothing needs changing: DrBot can retry it as a plain command without the unusual quoting.",
      };
    }
    const staging = matchDrCommand(commandLine, CHANGESET_WRITE_COMMANDS);
    if (staging && mode === "read-safe") {
      return {
        reason: `\`${staging}\` changes the model, and this viewer was started with ${READ_ONLY_FLAG}.`,
        remedy: READ_ONLY_REMEDY,
      };
    }
    return notListed(`\`${drCommandName(commandLine)}\``);
  }

  const drPrefix = `mcp__${DR_MCP_SERVER_NAME}__`;
  if (toolName.startsWith(drPrefix)) {
    const tool = toolName.slice(drPrefix.length);
    if (USER_ONLY_MCP_TOOLS[tool])
      return {
        reason: `\`${tool}\`: ${USER_ONLY_MCP_TOOLS[tool]}.`,
        remedy: USER_STEP_REMEDY,
      };
    if (mode === "read-safe" && DR_MCP_CHANGESET_TOOLS.includes(tool)) {
      return {
        reason: `\`${tool}\` changes the model, and this viewer was started with ${READ_ONLY_FLAG}.`,
        remedy: READ_ONLY_REMEDY,
      };
    }
    if (!options.mcpConnected || DR_MCP_READ_TOOLS.includes(tool) || DR_MCP_CHANGESET_TOOLS.includes(tool)) {
      return {
        reason: `\`${tool}\` was not available to DrBot in this launch (the dr MCP server did not offer it).`,
        remedy: "Restart the viewer; if it keeps happening, run `dr claude upgrade` and check the viewer's log.",
      };
    }
    return notListed(`\`${tool}\``);
  }
  if (toolName.startsWith("mcp__")) {
    return {
      reason: `\`${toolName}\` belongs to another MCP server, and DrBot may use only its own dr server's tools.`,
      remedy: DANGER_REMEDY,
    };
  }
  if (toolName === "Edit" || toolName === "Write" || toolName === "NotebookEdit") {
    return mode === "read-safe"
      ? {
          reason: `DrBot may not edit files, and this viewer was started with ${READ_ONLY_FLAG}, so it can't change the model either.`,
          remedy: READ_ONLY_REMEDY,
        }
      : {
          reason: "DrBot may not edit files: it changes the model only by staging into a changeset.",
          remedy: DANGER_REMEDY,
        };
  }
  return notListed(toolName ? `\`${toolName}\`` : "this tool");
}

/**
 * Why DrBot's permissions refused a call, and how the person allows it: the rule, that nobody was
 * asked, the way to allow it, and where the rule lives. One paragraph, for the viewer's failed
 * tool result. Danger mode has no allowlist, so a refusal there is Claude Code's own.
 */
export function explainDeniedToolCall(mode: DrBotMode, call: DeniedToolCall, options: DrBotSessionOptions): string {
  if (mode === "danger") {
    return "Claude Code refused this call although the viewer runs with --with-danger; DrBot's allowlist is not the cause.";
  }
  const { reason, remedy } = refusalFor(mode, call, options);
  return (
    `Blocked by DrBot's permissions (${DRBOT_MODE_LABELS[mode]} mode): ${reason} ` +
    `Nobody was asked to approve it and no prompt is coming. ${remedy} ` +
    "The allowlist is set by the flags `dr visualize` was started with, not by a settings file, " +
    "and it can't be changed from inside the viewer."
  );
}
