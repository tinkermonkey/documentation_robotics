/**
 * What DrBot's permissions are, in words and as launch arguments: for the agent at the start of
 * a launch, for Claude Code as deny rules, and for the person when a call is refused.
 *
 * `dr visualize` launches Claude Code with `--print` and an allowlist (`--allowedTools`), so
 * nobody can answer a permission prompt: a call outside the list comes back as "This command
 * requires approval" (or "Permission to use Bash … has been denied") and nothing else (#1241).
 * That text says neither which rule refused the call nor where the rule lives. So the launch
 * tells the agent its mode and its rules (drBotSessionPrompt), a hook answers a refused Bash call
 * with the reason (chat-guard.ts), and the server adds the reason to any other refused call's
 * result in the viewer (explainDeniedToolCall). The rules themselves are in chat-guard.ts.
 */

import { CHANGESET_WRITE_COMMANDS, USER_ONLY_DR_COMMANDS } from "./default-permissions.js";
import {
  CHAT_MODE_LABELS,
  REFUSAL_MARKER,
  USER_ONLY_MCP_TOOLS,
  chatBashRefusal,
  chatCommandsForMode,
  chatToolNotAllowed,
  formatChatRefusal,
  matchDrCommand,
  splitShellLine,
  type ChatMode,
  type ChatRefusal,
} from "./chat-guard.js";
import { CHAT_PERMISSION_HOOK_COMMAND } from "./chat-guard.js";
import {
  DR_MCP_CHANGESET_TOOLS,
  DR_MCP_READ_TOOLS,
  DR_MCP_SERVER_NAME,
  drBotMcpPrompt,
  drMcpToolRule,
  type DrBotMode,
  type DrCommand,
} from "./drbot-mcp.js";

/** The flag that starts the viewer with a read-only chat. */
export const READ_ONLY_FLAG = "--read-only";

/** What the person calls each mode. */
export const DRBOT_MODE_LABELS: Readonly<Record<DrBotMode, string>> = Object.freeze({
  ...CHAT_MODE_LABELS,
  danger: "unrestricted",
});

/** Claude Code's built-in tools a chat under an allowlist gets (`--tools`): no editing, no network. */
export const DRBOT_BUILT_IN_TOOLS: readonly string[] = Object.freeze(["Bash", "Read", "Glob", "Grep"]);

/** Built-in tools denied outright, whatever any settings file allows. */
const DENIED_BUILT_IN_TOOLS: readonly string[] = Object.freeze([
  "Edit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
]);

/** Flags that write a file wherever the path points, on commands that otherwise only read. */
const DENIED_BASH_PATTERNS: readonly string[] = Object.freeze(["Bash(*--output*)", "Bash(*--save-snapshot*)"]);

export interface DrBotSessionOptions {
  /** The dr MCP server is connected for this launch. */
  mcpConnected: boolean;
}

/**
 * Claude Code deny rules (`--disallowedTools`) for a mode: what DrBot must never do, said
 * outright instead of left to "not on the allowlist". A deny rule wins over an allow rule from
 * any source, so these hold even where a settings file is read after all (managed settings).
 * - Editing and network tools.
 * - The commands and dr MCP tools that are the person's step: commit, apply, revert, discard,
 *   delete, init, upgrade, and starting another chat agent.
 * - File-writing flags on read commands.
 * - In a read-only viewer, every staging command and tool.
 * Danger mode has no rules.
 */
export function drBotDisallowedTools(mode: DrBotMode): string[] {
  if (mode === "danger") return [];
  const bash = (command: string) => `Bash(${command}:*)`;
  return [
    ...DENIED_BUILT_IN_TOOLS,
    ...Object.keys(USER_ONLY_DR_COMMANDS).map(bash),
    ...DENIED_BASH_PATTERNS,
    ...Object.keys(USER_ONLY_MCP_TOOLS).map(drMcpToolRule),
    ...(mode === "read-safe"
      ? [...CHANGESET_WRITE_COMMANDS.map(bash), ...DR_MCP_CHANGESET_TOOLS.map(drMcpToolRule)]
      : []),
  ];
}

/**
 * The keys of the user's own Claude Code settings a launch under an allowlist carries over. The
 * launch runs `claude --restricted`, which reads no user, project or local settings file, so a
 * settings file can't widen the allowlist; but a person who signs in through their settings
 * (an API key helper, or provider variables under `env`) would then have no credentials. These
 * keys say how to reach the model and nothing about permissions.
 */
const FORWARDED_USER_SETTINGS: readonly string[] = Object.freeze([
  "apiKeyHelper",
  "awsAuthRefresh",
  "awsCredentialExport",
  "env",
  "model",
]);

/** A word quoted for the shell that runs a hook command. */
function shellQuote(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * The settings JSON a launch under an allowlist passes with `--settings` (the one settings source
 * `--restricted` still reads besides managed policy), or null in danger mode:
 * - a PreToolUse hook on Bash that runs this dr's `chat-permission-hook`, which refuses anything
 *   but one plain `dr` command the mode allows and tells the agent why (chat-guard.ts);
 * - the user's own sign-in settings (FORWARDED_USER_SETTINGS), without any `DR_*` variable, so
 *   a settings file can't switch off the chat's own guards.
 */
export function drBotLaunchSettings(
  mode: DrBotMode,
  drCommand: DrCommand,
  userSettings: Readonly<Record<string, unknown>> | null = null
): string | null {
  if (mode === "danger") return null;
  const settings: Record<string, unknown> = {};
  for (const key of FORWARDED_USER_SETTINGS) {
    const value = userSettings?.[key];
    if (value === undefined) continue;
    if (key === "env") {
      if (typeof value !== "object" || value === null) continue;
      const env = Object.fromEntries(Object.entries(value).filter(([name]) => !name.toUpperCase().startsWith("DR_")));
      if (Object.keys(env).length > 0) settings.env = env;
    } else {
      settings[key] = value;
    }
  }
  settings.hooks = {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            // `|| exit 2`: any failure of the hook (a broken install, a crash before its own
            // handler runs) blocks the call; Claude Code lets a call through on any other exit.
            command:
              [drCommand.command, ...drCommand.args, CHAT_PERMISSION_HOOK_COMMAND].map(shellQuote).join(" ") + " || exit 2",
          },
        ],
      },
    ],
  };
  return JSON.stringify(settings);
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
    "Read, Glob and Grep inside the project",
    "through Bash, one plain `dr` command per call (no other command, no pipes, `&&`, `;`, redirects, " +
      `substitutions or \`$VARIABLES\`) from: ${chatCommandsForMode(mode).join(", ")}`,
  ];
  const blocked =
    mode === "read-safe"
      ? `every change to the model (this viewer was started with ${READ_ONLY_FLAG}); flags that write a file ` +
        "(`--output`, `--save-snapshot`); anything outside this project; editing files; the network; and any other shell command"
      : "writes outside a changeset; committing, applying, discarding or deleting a changeset (the person does " +
        "that with Apply or Discard in the viewer); flags that write a file (`--output`, `--save-snapshot`); " +
        "anything outside this project; editing files; the network; and any other shell command";
  const unblock =
    mode === "read-safe"
      ? `to let you stage changes in a changeset, they restart the viewer without ${READ_ONLY_FLAG} (plain \`dr visualize\`); ` +
        "`dr visualize --with-danger` removes the allowlist altogether"
      : "`dr visualize --with-danger` removes the allowlist altogether; landing a changeset is always theirs to do";
  parts.push(
    [
      `Permissions in this chat (mode: ${DRBOT_MODE_LABELS[mode]}):`,
      '- Nobody can answer a permission prompt here. A call that comes back "This command requires approval", ' +
        `"Permission to use … has been denied", or with "${REFUSAL_MARKER}", was refused by this session's ` +
        "allowlist. The person saw no prompt and none is coming: don't wait for one, don't retry the same call, " +
        "and don't look for another tool or command that does the same thing.",
      "- The allowlist is fixed when the viewer starts, by the flags given to `dr visualize`. This chat reads none " +
        "of the person's or the project's Claude settings files (not .claude/settings.json, not ~/.claude), only " +
        "what the launch passes and any policy their organisation manages: don't look for a settings file and " +
        "don't suggest editing one.",
      `- Allowed: ${allowed.join("; ")}. \`dr help <command>\` shows any command's help.`,
      `- Blocked on purpose: ${blocked}.`,
      "- So don't plan steps this mode can't carry out. When the person asks for one, or a call is refused, tell " +
        `them which call it was, which of these rules covers it, and how they allow it: ${unblock}. It can't be ` +
        "approved from inside the viewer.",
    ].join("\n")
  );
  return parts.join("\n\n");
}

/**
 * Texts Claude Code returns for a call its permission rules refused under --print, and this
 * project's own refusals. Each is anchored to where the refusal text starts, so a command's own
 * output that merely contains such words (a not-found on `security.control.code-obfuscation`) is
 * not taken for a refusal. A refusal in a wording not listed here is still recognised later,
 * from the turn's own list of denied calls.
 */
const DENIAL_PATTERNS: readonly RegExp[] = [
  /^This command requires approval/,
  /^This Bash command contains multiple operations/,
  /^Claude requested permissions? to /,
  /^Permission to use .+ has been denied/,
  /^PreToolUse:\w+ hook error: /,
  // --restricted confining a file tool to the project.
  /^\S+ is outside .+--restricted confines/s,
  // Claude Code's own check on a read-only command's path.
  /^\w+ in '.+' was blocked\. For security, Claude Code may only /,
  // The server's own text for a refusal the turn listed but never answered.
  /^Permission denied: /,
];

/** Whether a failed tool result reads as a permission refusal rather than the tool's own error. */
export function isPermissionDenial(resultText: string): boolean {
  const text = resultText.trimStart();
  return text.includes(REFUSAL_MARKER) || DENIAL_PATTERNS.some((pattern) => pattern.test(text));
}

/** Whether a refusal's text already says why (this project's own refusal), so nothing is added to it. */
export function isExplainedRefusal(resultText: string): boolean {
  return resultText.includes(REFUSAL_MARKER);
}

/** A tool call as Claude Code's stream reports it. */
export interface DeniedToolCall {
  toolName: unknown;
  toolInput: unknown;
}

const DANGER_REMEDY =
  "To allow it, restart the viewer with `dr visualize --with-danger`, which removes DrBot's allowlist altogether.";

function refusalFor(mode: ChatMode, call: DeniedToolCall, projectRoot: string): ChatRefusal {
  const toolName = typeof call.toolName === "string" ? call.toolName : "";
  const modeLabel = DRBOT_MODE_LABELS[mode];
  const notListed = (what: string): ChatRefusal => ({
    reason: `${what} is not on DrBot's allowlist in ${modeLabel} mode.`,
    remedy: DANGER_REMEDY,
  });

  if (toolName === "Bash") {
    const input = call.toolInput as { command?: unknown } | null | undefined;
    const commandLine = typeof input?.command === "string" ? input.command.trim() : "";
    if (!commandLine) return notListed("this shell command");
    const refusal = chatBashRefusal(mode, commandLine, projectRoot);
    if (refusal) return refusal;
    // The rules allow it, yet Claude Code refused it: its own check on the command's form.
    const listed = matchDrCommand(splitShellLine(commandLine).tokens.join(" "), chatCommandsForMode(mode));
    return {
      reason:
        `\`${listed ?? "this command"}\` is allowed, but Claude Code could not check this form of it ` +
        "(quoting or expansion it does not accept without approval).",
      remedy: "Nothing needs changing: DrBot can retry it as a plain command without the unusual quoting.",
    };
  }

  const drPrefix = `mcp__${DR_MCP_SERVER_NAME}__`;
  if (toolName.startsWith(drPrefix)) {
    const tool = toolName.slice(drPrefix.length);
    const refusal = chatToolNotAllowed(mode, tool, { read: DR_MCP_READ_TOOLS, staging: DR_MCP_CHANGESET_TOOLS });
    if (refusal) return refusal;
    return {
      reason: `\`${tool}\` was not available to DrBot in this launch (the dr MCP server did not offer it).`,
      remedy: "Restart the viewer; if it keeps happening, run `dr claude upgrade` and check the viewer's log.",
    };
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
          remedy:
            `To let it change the model, restart the viewer without ${READ_ONLY_FLAG} (plain \`dr visualize\`): ` +
            "DrBot can then stage the change in a changeset for you to review and apply.",
        }
      : {
          reason: "DrBot may not edit files: it changes the model only by staging into a changeset.",
          remedy: DANGER_REMEDY,
        };
  }
  if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
    return {
      reason: `DrBot may read only inside the project this viewer serves, and this ${toolName} call reaches outside it.`,
      remedy: DANGER_REMEDY,
    };
  }
  if (toolName === "WebFetch" || toolName === "WebSearch") {
    return { reason: "DrBot may not use the network.", remedy: DANGER_REMEDY };
  }
  return notListed(toolName ? `\`${toolName}\`` : "this tool");
}

/**
 * Why DrBot's permissions refused a call, and how the person allows it: the rule, that nobody was
 * asked, the way to allow it, and where the rule lives. One paragraph, for the viewer's failed
 * tool result. Danger mode has no allowlist, so a refusal there is Claude Code's own.
 * `projectRoot` is the served project (to tell a path outside it).
 */
export function explainDeniedToolCall(mode: DrBotMode, call: DeniedToolCall, projectRoot: string = process.cwd()): string {
  if (mode === "danger") {
    return "Claude Code refused this call although the viewer runs with --with-danger; DrBot's allowlist is not the cause.";
  }
  return formatChatRefusal(mode, refusalFor(mode, call, projectRoot));
}
