/**
 * DrBot's launcher (issue 1279, `docs/design/USER_LEVEL_DR.md` section 9, "DrBot"): starts each
 * DrBot turn (a Claude Code CLI or GitHub Copilot CLI sub-process) in the checkout it belongs to.
 *
 * - The sub-process runs with the checkout's path as its working directory, and with
 *   `DR_MCP_ROOT_PATH` set to that path, so its own dr MCP resolves to the same checkout.
 * - Its dr-architect agent comes from `prepareDrBotAgent` for that checkout.
 * - Conversations are keyed by `DrBotSessionKey` ({project, checkout, conversationId}): the same
 *   conversation id in another checkout is another conversation, with its own agent session.
 * - At most `DR_DRBOT_MAX_TURNS` (default 3) turns run at once per process. A turn over the cap
 *   waits; the chat is told it is queued, and again when it starts.
 * - A checkout that closes as removed ends its running turns (checkout-context.ts) and its queued
 *   ones (here), and its conversations are forgotten.
 *
 * One launcher serves a whole process: the central server's every checkout, or the one checkout
 * of a per-project `dr visualize` server, under the same cap.
 * (`application.applicationcomponent.dr-bot-launcher`)
 */

import { spawn, spawnSync, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, readFileSync, realpathSync } from "fs";
import { homedir } from "os";
import path from "path";
import type { CheckoutContext, CheckoutCloseReason } from "./checkout-context.js";
import {
  DEFAULT_DRBOT_TURN_CAP,
  DRBOT_TURN_CAP_ENV,
  MCP_ROOT_PATH_ENV,
  type DrBotSessionKey,
} from "./central-mcp-contract.js";
import { BaseChatClient } from "../coding-agents/base-chat-client.js";
import { ClaudeCodeClient } from "../coding-agents/claude-code-client.js";
import { CopilotClient } from "../coding-agents/copilot-client.js";
import {
  formatForClaudeCode,
  formatForClaudeCodeWithChangesets,
  applyCopilotPermissions,
  CHANGESET_ONLY_ENV,
} from "../coding-agents/default-permissions.js";
import {
  DR_ARCHITECT_AGENT,
  drMcpAllowedTools,
  resolveDrCommand,
  prepareDrMcpLaunch,
  prepareDrBotAgent,
  type AgentMcpToolCheck,
  type DrBotAgentLaunch,
  type DrBotMode,
  type DrMcpLaunch,
  type PrepareDrMcpLaunchOptions,
} from "../coding-agents/drbot-mcp.js";
import {
  DRBOT_BUILT_IN_TOOLS,
  drBotDisallowedTools,
  drBotLaunchSettings,
  drBotSessionPrompt,
  explainDeniedToolCall,
  isExplainedRefusal,
  isPermissionDenial,
} from "../coding-agents/drbot-permissions.js";
import { CHAT_MODE_ENV, CHAT_PROJECT_ROOT_ENV, REFUSAL_MARKER } from "../coding-agents/chat-guard.js";
import { CHANGESET_ORIGIN_ENV } from "../core/changeset-review.js";
import { getErrorMessage } from "../utils/errors.js";
import { hasExited } from "../utils/stop-child-process.js";

/**
 * JSON-RPC 2.0 error codes the viewer protocol uses. Standard JSON-RPC 2.0 also defines
 * PARSE_ERROR (-32700) and INVALID_REQUEST (-32600) for protocol-level errors not applicable to
 * WebSocket message handling.
 */
export const JSONRPC_ERRORS = {
  // Standard JSON-RPC errors
  INVALID_PARAMS: -32602, // Invalid method parameters
  METHOD_NOT_FOUND: -32601, // Method does not exist
  INTERNAL_ERROR: -32603, // Internal server error

  // Custom application errors
  NO_CLIENT_AVAILABLE: -32001, // No chat client available
} as const;

/** Where a turn's replies go: the websocket of the viewer tab that sent the message. */
export interface DrBotChannel {
  send(source: string | ArrayBuffer | Uint8Array | ArrayBufferView, options?: { compress?: boolean }): void;
}

/** A viewer conversation's agent session (Claude Code's session id, for --session-id and --resume). */
export interface ChatSession {
  sessionId: string;
  /** Claude Code has created the session: later sends pass --resume. */
  started: boolean;
  /** A send has already launched with --session-id for it. */
  attempted?: boolean;
}

/** One `chat.send`: a message to a checkout's conversation. */
export interface DrBotTurnRequest {
  context: CheckoutContext;
  channel: DrBotChannel;
  conversationId: string;
  message: string;
  requestId: string | number | undefined;
  /** The send named its conversation, so the agent's session is kept and resumed. */
  resumable: boolean;
}

/** What `startTurn` did with a send. */
export type DrBotTurnStart =
  | { status: "started" }
  | { status: "queued"; position: number }
  | { status: "refused"; code: number; message: string };

/** How a chat turn is launched. */
interface ChatLaunchOptions {
  /** The send named a conversation, so its Claude Code session is kept and resumed. */
  resumable?: boolean;
  /** The turn's hold on its conversation (see reserveChatConversation). */
  turn?: symbol;
  /** This launch is the one retry after "session id already in use". */
  retried?: boolean;
  /** Called once when the turn is over (its process has exited, or it never started): frees its slot. */
  onEnd?: (attributes?: Record<string, unknown>) => void;
}

/** What the launcher tracks while streaming one Claude Code reply. */
interface ClaudeTurnState {
  accumulatedText: string;
  /** tool_use id -> the call, until its tool_result arrives. */
  pendingTools: Map<string, { name: unknown; input: unknown }>;
  /**
   * tool_use id -> a call that failed with a result that didn't read as a permission refusal.
   * The turn's `result` event lists the refused calls, so one of these may still turn out to be one.
   */
  failedTools: Map<string, { name: unknown; input: unknown; result: unknown }>;

  /** The conversation's Claude Code session, when the send named a conversation. */
  session?: ChatSession;
  /** Claude Code printed at least one stream-json event. */
  sawEvent: boolean;
  /** The checkout the turn runs in. */
  rootPath: string;
}

/** A turn waiting for a slot under the cap. */
interface QueuedTurn {
  request: DrBotTurnRequest;
  turn: symbol;
  queuedAt: number;
  start: () => void;
}

/** A tool_result's content as text: a string, or the text blocks of a content array. */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as any).text === "string" ? (part as any).text : ""
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** The `DrBotSessionKey` of a conversation in a checkout. */
export function drBotSessionKey(context: CheckoutContext, conversationId: string): DrBotSessionKey {
  return { project: context.ref.project, checkout: context.ref.checkout, conversationId };
}

/** One map key per `DrBotSessionKey`. Project names are kebab-case and git worktree names hold no NUL. */
export function drBotSessionKeyString(key: DrBotSessionKey): string {
  return `${key.project}\u0000${key.checkout}\u0000${key.conversationId}`;
}

/**
 * The running-turn cap from `DR_DRBOT_MAX_TURNS`: a whole number of at least 1, else the default
 * (3), with a warning for a value that is set but not one.
 */
export function drBotTurnCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[DRBOT_TURN_CAP_ENV];
  if (raw === undefined || raw.trim() === "") return DEFAULT_DRBOT_TURN_CAP;
  const value = Number(raw);
  if (Number.isInteger(value) && value >= 1) return value;
  console.warn(
    `[DrBot] ${DRBOT_TURN_CAP_ENV}=${JSON.stringify(raw)} is not a whole number of at least 1; ` +
      `using ${DEFAULT_DRBOT_TURN_CAP}.`
  );
  return DEFAULT_DRBOT_TURN_CAP;
}

export interface DrBotLauncherOptions {
  /** DrBot runs with every permission (danger mode). */
  withDanger?: boolean;
  /** DrBot may stage changes in a changeset (ignored with withDanger). */
  withChangesets?: boolean;
  /** Running turns allowed at once. Default: `DR_DRBOT_MAX_TURNS`, else 3. */
  maxTurns?: number;
  /**
   * Every chat frame about a conversation also names its checkout (`project`, `checkout`): the
   * central server's, where one socket can chat in several checkouts with the same conversation id.
   */
  stampCheckout?: boolean;
}

/**
 * A channel that adds the checkout to every chat frame naming a conversation: a notification's
 * `params` and the `chat.send` result.
 */
export function stampedChannel(channel: DrBotChannel, ref: { project: string; checkout: string }): DrBotChannel {
  return {
    send(source, options) {
      if (typeof source !== "string") return channel.send(source, options);
      let frame: any;
      try {
        frame = JSON.parse(source);
      } catch {
        return channel.send(source, options);
      }
      for (const part of [frame?.params, frame?.result]) {
        if (part && typeof part === "object" && "conversation_id" in part) {
          part.project = ref.project;
          part.checkout = ref.checkout;
        }
      }
      channel.send(JSON.stringify(frame), options);
    },
  };
}

/** The `drbot.turn` span (`apm.span.drbot-turn`), when telemetry is built in; returns its end. */
async function startTurnSpan(
  context: CheckoutContext,
  agent: string
): Promise<(attributes: Record<string, unknown>) => void> {
  // @ts-ignore - TELEMETRY_ENABLED is a global constant defined at build time
  const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;
  if (!isTelemetryEnabled) return () => {};
  try {
    const { startSpan, endSpan } = await import("../telemetry/index.js");
    const span = startSpan("drbot.turn", {
      "dr.project": context.ref.project,
      "dr.checkout": context.ref.checkout,
      "drbot.agent": agent,
    });
    const startedAt = Date.now();
    return (attributes) => {
      try {
        span?.setAttributes({ ...attributes, "drbot.duration_ms": Date.now() - startedAt } as any);
        endSpan(span);
      } catch (error) {
        console.warn(`[Telemetry] Failed to record a DrBot turn: ${getErrorMessage(error)}`);
      }
    };
  } catch (error) {
    console.warn(`[Telemetry] Failed to record a DrBot turn: ${getErrorMessage(error)}`);
    return () => {};
  }
}

export class DrBotLauncher {
  /** The coding agent DrBot runs (detected by the server); none means chat is unavailable. */
  chatClient?: BaseChatClient;
  readonly withDanger: boolean;
  readonly withChangesets: boolean;
  /** Running turns allowed at once in this process. */
  readonly maxTurns: number;
  /** Chat frames name their checkout (the central server). */
  readonly stampCheckout: boolean;
  /** Logged DrBot setup warnings, so each is logged once per process. */
  readonly drBotWarnings = new Set<string>();

  /** DrBotSessionKey (as a string) -> the conversation's agent session. */
  private readonly sessions = new Map<string, ChatSession>();
  /** Turns holding a slot under the cap. */
  private running = 0;
  /** Turns waiting for a slot, oldest first. */
  private readonly queue: QueuedTurn[] = [];
  /** Contexts whose close this launcher listens to. */
  private readonly watched = new WeakSet<CheckoutContext>();

  /** Test hook: Claude Code's config directory (default ~/.claude or CLAUDE_CONFIG_DIR). */
  _testClaudeConfigDir?: string;
  /** Test hook: a fixture command in place of the claude binary. */
  _testClaudeCmdOverride?: string[];
  /** Test hook: a fixture command in place of the copilot binary. */
  _testCopilotCmdOverride?: string[];
  /** Test hook: prepare DrBot's MCP launch with these (scratch dirs) even under _testClaudeCmdOverride. */
  _testDrMcpOptions?: Partial<Pick<PrepareDrMcpLaunchOptions, "drCommand" | "tempRoot">> & {
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    bundledPath?: string | null;
  };
  /** Test hook: the claude arguments the last chat launch built, before any _testClaudeCmdOverride. */
  _testLastClaudeChatArgs?: string[];

  constructor(options: DrBotLauncherOptions = {}) {
    this.withDanger = options.withDanger ?? false;
    this.withChangesets = options.withChangesets ?? false;
    this.maxTurns = options.maxTurns ?? drBotTurnCap();
    this.stampCheckout = options.stampCheckout ?? false;
  }

  /** Turns running now (holding a slot). `CentralActivity.drBotTurns`. */
  get runningTurns(): number {
    return this.running;
  }

  /** Turns waiting for a slot. */
  get queuedTurns(): number {
    return this.queue.length;
  }

  /**
   * Takes one `chat.send`. A conversation runs one turn at a time: a send to a conversation whose
   * turn is still running (or queued) is refused. Otherwise the conversation is reserved and the
   * turn starts now, or, at the cap, waits: the chat is told it is queued (`chat.turn.queued`),
   * and again when it starts (`chat.turn.started`). Neither is repeated as reply text: the viewer
   * shows the notifications, and a copy in the reply showed the notice twice.
   */
  async startTurn(request: DrBotTurnRequest): Promise<DrBotTurnStart> {
    if (this.stampCheckout) request = { ...request, channel: stampedChannel(request.channel, request.context.ref) };
    const { context, conversationId } = request;
    if (!this.chatClient) {
      return {
        status: "refused",
        code: JSONRPC_ERRORS.NO_CLIENT_AVAILABLE,
        message: "No chat client available. Install Claude Code or GitHub Copilot to enable chat.",
      };
    }
    // Claude Code can resume a session, but not while it is still answering. The check and the
    // reservation are synchronous, so two quick sends can't both get through.
    if (context.busyChatConversations.has(conversationId)) {
      return {
        status: "refused",
        code: JSONRPC_ERRORS.INVALID_PARAMS,
        message: "A reply is still running in this conversation; wait for it or cancel it first",
      };
    }
    this.watch(context);
    const turn = this.reserveChatConversation(context, conversationId);

    if (this.running < this.maxTurns) {
      this.running++;
      await this.launchChat(request, turn);
      return { status: "started" };
    }

    const queued: QueuedTurn = {
      request,
      turn,
      queuedAt: Date.now(),
      start: () => {
        const waitedMs = Date.now() - queued.queuedAt;
        this.sendChatNotification(request.channel, "chat.turn.started", {
          conversation_id: conversationId,
          waited_ms: waitedMs,
          timestamp: new Date().toISOString(),
        });
        // launchChat has already freed the slot and the conversation when it throws.
        this.launchChat(request, turn).catch((error) => {
          try {
            request.channel.send(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: JSONRPC_ERRORS.INTERNAL_ERROR, message: "Internal error", data: getErrorMessage(error) },
                id: request.requestId,
              })
            );
          } catch {
            // A socket that is already gone needs no answer.
          }
        });
      },
    };
    this.queue.push(queued);
    const position = this.queue.length;
    const text =
      `Queued: ${this.running} DrBot ${this.running === 1 ? "reply is" : "replies are"} running, ` +
      `the most at once (${DRBOT_TURN_CAP_ENV}=${this.maxTurns}). ` +
      `This one is ${ordinal(position)} in line and starts when a running reply ends.`;
    this.sendChatNotification(request.channel, "chat.turn.queued", {
      conversation_id: conversationId,
      position,
      running: this.running,
      max_turns: this.maxTurns,
      message: text,
      timestamp: new Date().toISOString(),
    });
    return { status: "queued", position };
  }

  /**
   * `chat.cancel`: stops the named conversation's reply in this checkout, or else its first
   * running one. A queued turn is dropped before it starts.
   */
  cancel(context: CheckoutContext, conversationId?: unknown): { cancelled: boolean; conversation_id: string | null } {
    const index = this.queue.findIndex(
      (queued) =>
        queued.request.context === context &&
        (typeof conversationId !== "string" || queued.request.conversationId === conversationId)
    );
    const candidates = [...context.chatProcesses].filter(
      ([convId, proc]) =>
        !context.cancelledChatProcesses.has(proc) && (typeof conversationId !== "string" || convId === conversationId)
    );
    // The entry stays until the turn's own cleanup, after the process has exited: the
    // conversation is busy until then, so a resend can't start a second agent on the same session.
    for (const [convId, proc] of candidates) {
      try {
        context.cancelledChatProcesses.add(proc);
        proc.kill();
        return { cancelled: true, conversation_id: convId };
      } catch (error) {
        console.warn(`[Chat] Failed to cancel process for conversation ${convId}: ${getErrorMessage(error)}`);
      }
    }
    if (index !== -1) {
      const [queued] = this.queue.splice(index, 1);
      this.endQueuedTurn(queued, "The reply was cancelled before it started");
      return { cancelled: true, conversation_id: queued.request.conversationId };
    }
    return { cancelled: false, conversation_id: null };
  }

  /** The agent session of a conversation, if it has one. */
  session(key: DrBotSessionKey): ChatSession | undefined {
    return this.sessions.get(drBotSessionKeyString(key));
  }

  /** DrBot's permission mode; danger wins over changeset-only. */
  drBotMode(): DrBotMode {
    if (this.withDanger) return "danger";
    return this.withChangesets ? "changesets" : "read-safe";
  }

  /**
   * The mode the selected chat client really runs in. Copilot has no changeset staging: outside
   * danger mode it gets the read-safe allowlist whatever the viewer was started with.
   */
  chatPermissionMode(): DrBotMode {
    const mode = this.drBotMode();
    return this.chatClient instanceof CopilotClient && mode === "changesets" ? "read-safe" : mode;
  }

  /**
   * Listens for the context's close: a removed checkout's queued turns end (its running ones are
   * ended by the context itself) and its conversations are forgotten; a stopping server's queued
   * turns end.
   */
  private watch(context: CheckoutContext): void {
    if (this.watched.has(context)) return;
    this.watched.add(context);
    context.onClose((reason) => this.checkoutClosed(context, reason));
  }

  private checkoutClosed(context: CheckoutContext, reason: CheckoutCloseReason): void {
    const message =
      reason === "removed"
        ? `The checkout ${context.ref.project}/${context.ref.checkout} was removed before this reply started`
        : "The server stopped before this reply started";
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].request.context !== context) continue;
      const [queued] = this.queue.splice(i, 1);
      this.endQueuedTurn(queued, message);
    }
    if (reason === "removed") {
      const prefix = drBotSessionKeyString({ ...context.ref, conversationId: "" });
      for (const key of [...this.sessions.keys()]) {
        if (key.startsWith(prefix)) this.sessions.delete(key);
      }
    }
  }

  /** Ends a turn that never started: its send gets an error result and its conversation is free. */
  private endQueuedTurn(queued: QueuedTurn, message: string): void {
    const { context, conversationId, channel, requestId } = queued.request;
    this.releaseChatConversation(context, conversationId, queued.turn);
    try {
      channel.send(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: JSONRPC_ERRORS.INTERNAL_ERROR, message },
          id: requestId,
        })
      );
    } catch {
      // A socket that is already gone needs no answer.
    }
  }

  /** A slot is free: the oldest queued turn takes it, or the count goes down. */
  private freeSlot(): void {
    const next = this.queue.shift();
    if (next) {
      next.start();
    } else {
      this.running = Math.max(0, this.running - 1);
    }
  }

  /** Launch chat with the selected client and stream responses to the channel. */
  private async launchChat(request: DrBotTurnRequest, turn: symbol): Promise<void> {
    const { context, channel, conversationId, message, requestId } = request;
    let ended = false;
    const endSpan = await startTurnSpan(context, this.chatClient?.getClientName() ?? "none");
    const onEnd = (attributes: Record<string, unknown> = {}) => {
      if (ended) return;
      ended = true;
      endSpan(attributes);
      this.freeSlot();
    };
    const options: ChatLaunchOptions = { resumable: request.resumable, turn, onEnd };
    try {
      if (this.chatClient instanceof ClaudeCodeClient) {
        await this.launchClaudeCodeChat(context, channel, conversationId, message, requestId, options);
      } else if (this.chatClient instanceof CopilotClient) {
        await this.launchCopilotChat(context, channel, conversationId, message, requestId, options);
      } else {
        this.releaseChatConversation(context, conversationId, turn);
        onEnd();
        channel.send(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: JSONRPC_ERRORS.NO_CLIENT_AVAILABLE,
              message: this.chatClient ? "Unknown chat client type" : "No chat client available",
            },
            id: requestId,
          })
        );
      }
    } catch (error) {
      this.releaseChatConversation(context, conversationId, turn);
      onEnd();
      throw error;
    }
  }

  /**
   * Build command arguments for Claude Code launch
   */
  buildClaudeChatArgs(
    mcpConfigPath?: string,
    session?: ChatSession,
    agentArgs: string[] = [],
    omitAgent: boolean = false
  ): string[] {
    // Under an allowlist claude loads no installed agent, so `--agent` names one only when the
    // launch passes its definition (agentArgs); with none to pass, DrBot runs as plain claude.
    const cmd = ["claude", ...(omitAgent ? [] : ["--agent", DR_ARCHITECT_AGENT]), ...agentArgs, "--print"];
    const mode = this.drBotMode();

    // Apply permissions: full access, changeset-only writes, or the read-safe allowlist.
    // With the dr MCP server connected, the mode's mcp__dr__* tools are allowed too; the
    // Bash rules stay as the fallback.
    const mcpRules = mcpConfigPath ? drMcpAllowedTools(mode) : [];
    if (mode === "danger") {
      cmd.push("--dangerously-skip-permissions");
    } else {
      const bashRules = mode === "changesets" ? formatForClaudeCodeWithChangesets() : formatForClaudeCode();
      // The allowlist is the only thing that allows (each flag checked against claude 2.1.328):
      // - --restricted: no user, project or local settings file is read, so none can add allow
      //   rules or a permissive default mode; the file tools are confined to the project.
      // - --tools: no editing or network tool exists in the session at all.
      // - --permission-mode dontAsk: anything not allowed is denied, never asked about.
      // - --disallowedTools: what DrBot must never do is denied outright, which wins over an
      //   allow rule from any source (managed settings are still read).
      cmd.push(
        "--restricted",
        "--tools",
        DRBOT_BUILT_IN_TOOLS.join(","),
        "--permission-mode",
        "dontAsk",
        "--allowedTools",
        [bashRules, ...mcpRules].join(","),
        "--disallowedTools",
        drBotDisallowedTools(mode).join(",")
      );
      // --settings is still read under --restricted: it carries the hook that refuses, with the
      // reason, any Bash call that is not one plain dr command, and the user's sign-in settings.
      const settings = drBotLaunchSettings(mode, this._testDrMcpOptions?.drCommand ?? resolveDrCommand(), this.userClaudeSettings());
      if (settings) cmd.push("--settings", settings);
    }

    if (mcpConfigPath) {
      cmd.push("--mcp-config", mcpConfigPath);
    }
    // Under an allowlist DrBot can call only its own dr server's tools, so load no other MCP
    // server: the user's plugins and connectors would describe tools it can't call (#1240).
    if (mode !== "danger") {
      cmd.push("--strict-mcp-config");
    }

    // Every launch says how to reach the model, which mode this is and what a refused call
    // means (#1241), whether or not the MCP server connected. Danger mode without MCP has nothing to say.
    const sessionPrompt = drBotSessionPrompt(mode, { mcpConnected: mcpConfigPath !== undefined });
    if (sessionPrompt) {
      cmd.push("--append-system-prompt", sessionPrompt);
    }

    // Same session handling as ClaudeCodeClient: start the session with our id, then resume it.
    if (session) {
      cmd.push(session.started ? "--resume" : "--session-id", session.sessionId);
    }

    cmd.push("--verbose", "--output-format", "stream-json");
    return cmd;
  }

  /**
   * The Claude Code session for a viewer conversation, created on its first send. A send
   * without a conversation id gets none, so it runs in a fresh session as before.
   */
  chatSessionFor(context: CheckoutContext, conversationId: string, resumable: boolean): ChatSession | undefined {
    if (!resumable) return undefined;
    const key = drBotSessionKeyString(drBotSessionKey(context, conversationId));
    let session = this.sessions.get(key);
    if (!session) {
      session = { sessionId: randomUUID(), started: false };
      this.sessions.set(key, session);
    }
    return session;
  }

  /** Marks a conversation busy for one turn; the token releases it. */
  reserveChatConversation(context: CheckoutContext, conversationId: string): symbol {
    const turn = Symbol(conversationId);
    context.busyChatConversations.set(conversationId, turn);
    return turn;
  }

  /** Ends a turn's hold on its conversation. A stale token (an older turn) releases nothing. */
  releaseChatConversation(context: CheckoutContext, conversationId: string, turn: symbol): void {
    if (context.busyChatConversations.get(conversationId) === turn) {
      context.busyChatConversations.delete(conversationId);
    }
  }

  /** Drops a turn's process from activeChatProcesses, unless a newer turn's has replaced it. */
  forgetChatProcess(context: CheckoutContext, conversationId: string, proc: ChildProcess): void {
    if (context.chatProcesses.get(conversationId) === proc) {
      context.chatProcesses.delete(conversationId);
    }
  }

  /**
   * Whether Claude Code already has this session on disk
   * (`<config dir>/projects/<cwd with non-alphanumerics as "-">/<id>.jsonl`). A first send that
   * died before the server saw it start can still have created it, and --session-id would then
   * fail with "already in use".
   */
  claudeSessionExists(context: CheckoutContext, sessionId: string): boolean {
    const configDir =
      this._testClaudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude");
    const roots = new Set([context.rootPath]);
    try {
      roots.add(realpathSync(context.rootPath));
    } catch {
      // Keep the path as given.
    }
    for (const root of roots) {
      const projectDir = root.replace(/[^a-zA-Z0-9]/g, "-");
      if (existsSync(path.join(configDir, "projects", projectDir, `${sessionId}.jsonl`))) return true;
    }
    return false;
  }

  /**
   * Resolves the dr-architect DrBot runs, once: the extra launch arguments (--agents for the
   * bundled copy) and the check of its tools both come from this lookup.
   */
  async resolveDrBotAgentLaunch(context: CheckoutContext): Promise<DrBotAgentLaunch> {
    const overrides = this._testDrMcpOptions ?? {};
    try {
      return await prepareDrBotAgent(context.rootPath, this.drBotMode(), {
        homeDir: overrides.homeDir,
        env: overrides.env,
        bundledPath: overrides.bundledPath,
      });
    } catch (error) {
      this.warnDrBotOnce(
        `[Claude Code] Could not check the installed ${DR_ARCHITECT_AGENT} agent's tools ` +
          `(${getErrorMessage(error)}); connecting the dr MCP server anyway.`
      );
      return { agent: null, args: [], check: null };
    }
  }

  /**
   * Writes the MCP config that connects DrBot to `dr mcp` for this model. Returns null when it
   * can't (logged), or when the agent DrBot runs can't see the dr tools: DrBot then launches
   * without MCP and uses its Bash rules.
   */
  async prepareDrBotMcp(context: CheckoutContext, check: AgentMcpToolCheck | null): Promise<DrMcpLaunch | null> {
    const mode = this.drBotMode();
    const overrides = this._testDrMcpOptions ?? {};

    // The agent's `tools:` field decides which MCP tools DrBot can see. When the launch added the
    // ones an installed copy leaves out (check.added), the chat works and the warning only asks
    // for the upgrade. Otherwise a copy that lists none of them can't use the server: say so, and
    // launch without MCP rather than tell the agent about tools it can't call.
    if (check?.replaced) {
      this.warnDrBotOnce(
        `[Claude Code] The installed ${DR_ARCHITECT_AGENT} agent (${check.replaced.path}) can't be passed to the ` +
          `chat (${check.replaced.reason}), so the chat runs the one bundled with this dr. ` +
          "Run `dr claude upgrade` to update the file."
      );
    }
    if (check?.added) {
      this.warnDrBotOnce(
        `[Claude Code] The installed ${DR_ARCHITECT_AGENT} agent (${check.path}) ` +
          (check.noneVisible ? "predates the dr MCP tools" : `doesn't list ${check.missing.join(", ")}`) +
          "; the chat adds them for its own sessions. Run `dr claude upgrade` to update the file."
      );
    } else if (check && (check.error || check.missing.length > 0)) {
      this.warnDrBotOnce(
        check.error
          ? `[Claude Code] Could not pass the ${check.source === "bundled" ? "bundled " : ""}${DR_ARCHITECT_AGENT} agent (${check.path}: ${check.error}), ` +
              "so the chat may run one that can't see the dr MCP tools; it falls back to Bash dr commands."
          : check.noneVisible
            ? `[Claude Code] The installed ${DR_ARCHITECT_AGENT} agent (${check.path}) predates the dr MCP ` +
              "tools, so the chat can't use them and falls back to Bash dr commands. " +
              "Run `dr claude upgrade` to update it."
            : `[Claude Code] The installed ${DR_ARCHITECT_AGENT} agent (${check.path}) doesn't list ` +
              `${check.missing.join(", ")}, so the chat can't use those dr MCP tools. ` +
              "Run `dr claude upgrade` to update it."
      );
      if (check.noneVisible) return null;
    }

    try {
      return await prepareDrMcpLaunch({
        rootPath: context.rootPath,
        changesetOnly: mode === "changesets",
        chatMode: mode === "danger" ? undefined : mode,
        drCommand: overrides.drCommand,
        tempRoot: overrides.tempRoot,
      });
    } catch (error) {
      console.warn(
        `[Claude Code] dr MCP server unavailable for chat, falling back to Bash dr commands: ${getErrorMessage(error)}`
      );
      return null;
    }
  }

  /** Logs a DrBot setup warning once per server rather than on every chat message. */
  warnDrBotOnce(message: string): void {
    if (this.drBotWarnings.has(message)) return;
    this.drBotWarnings.add(message);
    console.warn(message);
  }

  /**
   * Environment for chat agent processes. In changeset-only mode it sets
   * CHANGESET_ONLY_ENV, so any `dr` command the agent runs refuses to save the base
   * model and can only stage changes in an active changeset (core/changeset-only-guard.ts).
   */
  // It also sets DR_MCP_ROOT_PATH to the checkout, so the agent's dr MCP serves the same checkout.
  buildChatEnv(context: CheckoutContext, binDir?: string): NodeJS.ProcessEnv {
    // A changeset DrBot creates records origin.kind "chat" (core/changeset-review.ts).
    const env: NodeJS.ProcessEnv = { ...process.env, [CHANGESET_ORIGIN_ENV]: "chat" };
    if (this.withChangesets && !this.withDanger) {
      env[CHANGESET_ONLY_ENV] = "true";
    }
    // Every `dr` the agent runs then refuses, itself, what the mode does not allow
    // (coding-agents/chat-guard.ts). Danger mode has no mode to enforce.
    const mode = this.chatPermissionMode();
    if (mode === "danger") {
      delete env[CHAT_MODE_ENV];
      delete env[CHAT_PROJECT_ROOT_ENV];
    } else {
      env[CHAT_MODE_ENV] = mode;
      env[CHAT_PROJECT_ROOT_ENV] = context.rootPath;
    }
    // The agent's own dr MCP (a bridge to the central process, or `dr mcp` for this model) resolves
    // to the checkout this turn runs in, whatever the client's roots say.
    env[MCP_ROOT_PATH_ENV] = context.rootPath;
    // This launch's own dr first, so the agent's `dr` commands carry the guards above even
    // where an older dr is installed globally (drbot-mcp.ts writes it).
    if (binDir) {
      env.PATH = env.PATH ? `${binDir}${path.delimiter}${env.PATH}` : binDir;
    }
    return env;
  }

  /**
   * The user's own Claude Code settings (`<config dir>/settings.json`), or null when there is
   * none or it can't be read. Only its sign-in keys are carried into a launch (drBotLaunchSettings).
   */
  userClaudeSettings(): Record<string, unknown> | null {
    const configDir =
      this._testClaudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude");
    try {
      const parsed = JSON.parse(readFileSync(path.join(configDir, "settings.json"), "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Add permission flags to Copilot command based on withDanger setting
   * Applies read-safe permissions when withDanger is false, with graceful degradation
   * if the installed Copilot CLI doesn't support granular permission flags.
   * @param cmd The command array to modify (will be mutated)
   * @param variant The Copilot variant for error messages (e.g., "gh copilot" or "copilot")
   */
  addCopilotPermissionFlags(cmd: string[], variant: string): void {
    const copilotCommand = cmd[0] === "gh" ? "gh" : "copilot";
    applyCopilotPermissions(cmd, variant, copilotCommand, this.withDanger);
  }

  /**
   * Launch Claude Code CLI with dr-architect agent and stream responses
   */
  async launchClaudeCodeChat(
    context: CheckoutContext,
    ws: DrBotChannel,
    conversationId: string,
    message: string,
    requestId: string | number | undefined,
    options: ChatLaunchOptions = {}
  ): Promise<void> {
    let drMcp: DrMcpLaunch | null = null;
    const session = this.chatSessionFor(context, conversationId, options.resumable === true);
    const turnToken = options.turn ?? this.reserveChatConversation(context, conversationId);
    const release = (attributes: Record<string, unknown> = {}) => {
      this.releaseChatConversation(context, conversationId, turnToken);
      options.onEnd?.(attributes);
    };
    try {
      // Fixture tests skip MCP preparation (it would read the real installed agent and write a temp
      // config) unless they inject fakes.
      const skipMcp =
        this._testClaudeCmdOverride !== undefined && this._testDrMcpOptions === undefined;
      const agent = skipMcp ? null : await this.resolveDrBotAgentLaunch(context);
      drMcp = agent ? await this.prepareDrBotMcp(context, agent.check) : null;

      // An earlier send may have created the session without the server seeing it start.
      if (session && !session.started && session.attempted && this.claudeSessionExists(context, session.sessionId)) {
        session.started = true;
      }
      const usedSessionIdFlag = session !== undefined && !session.started;
      if (session && usedSessionIdFlag) session.attempted = true;
      const cmd = this.buildClaudeChatArgs(
        drMcp?.configPath,
        session,
        agent?.args ?? [],
        // No definition to pass, and under an allowlist claude would not find an installed one.
        agent !== null && agent.args.length === 0 && this.drBotMode() !== "danger"
      );
      this._testLastClaudeChatArgs = [...cmd];

      // Test hook: allow tests to substitute a fixture command for the real claude binary
      if (this._testClaudeCmdOverride) {
        cmd.splice(0, cmd.length, ...this._testClaudeCmdOverride);
      }

      // Launch claude with dr-architect agent for comprehensive DR expertise
      const proc = spawn(cmd[0], cmd.slice(1), {
        cwd: context.rootPath,
        env: this.buildChatEnv(context, drMcp?.binDir),
        stdio: ["pipe", "pipe", "pipe"],
      });

      // The MCP config is private to this launch: remove it once the agent is gone.
      if (drMcp) {
        const cleanup = drMcp.cleanup;
        proc.once("exit", () => void cleanup());
        proc.once("error", () => void cleanup());
      }

      // Node reports spawn failures (e.g. ENOENT if `claude` isn't on PATH) asynchronously
      // via an 'error' event rather than a synchronous throw. Without this handler, an
      // unhandled 'error' event on the ChildProcess EventEmitter throws and crashes the
      // whole server (server-entry.ts's uncaughtException handler tears the process down)
      // instead of just failing this one chat request.
      proc.on("error", (err) => {
        const errorMsg = getErrorMessage(err);
        console.error(
          `[Claude Code] Failed to spawn subprocess for conversation ${conversationId}: ${errorMsg}`
        );
        this.forgetChatProcess(context, conversationId, proc);
        release();
        try {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: JSONRPC_ERRORS.INTERNAL_ERROR,
                message: `Failed to launch Claude Code: ${errorMsg}`,
              },
              id: requestId,
            })
          );
        } catch (sendError) {
          console.error(
            `[Claude Code] Failed to send spawn-error notification: ${getErrorMessage(sendError)}`
          );
        }
      });
      // A failed spawn also destroys the stdio streams Node already created, which can
      // raise a second, separate unhandled 'error' event on `proc.stdin` itself. Swallow
      // it here since the handler above already reports the failure to the client.
      proc.stdin?.on("error", () => {});

      // Keep the end of stderr: Claude Code reports a session id already in use there.
      let stderrTail = "";
      proc.stderr?.on("data", (data: Buffer) => {
        stderrTail = (stderrTail + data.toString()).slice(-4096);
      });

      // Store active process
      context.chatProcesses.set(conversationId, proc);
      const isCancelled = () => context.cancelledChatProcesses.has(proc);

      // Send user message via stdin (like Python prototype)
      proc.stdin?.write(message);
      proc.stdin?.end();

      // Stream stdout (JSON events)
      const decoder = new TextDecoder();

      const streamOutput = async () => {
        const turn: ClaudeTurnState = {
          accumulatedText: "",
          pendingTools: new Map(),
          failedTools: new Map(),
          session,
          sawEvent: false,
          rootPath: context.rootPath,
        };
        let buffer = "";

        // Handles one stdout line: a stream-json event, or else raw text for the reply.
        // After a cancel nothing more is sent: the client may already be streaming its next turn.
        const handleLine = (line: string, isLast: boolean) => {
          if (isCancelled()) return;
          let event: any;
          try {
            event = JSON.parse(line);
          } catch (parseError) {
            if (process.env.DEBUG) {
              console.debug(`[Chat] Failed to parse JSON chunk: ${getErrorMessage(parseError)}`);
            }
            this.sendChatNotification(ws, "chat.response.chunk", {
              conversation_id: conversationId,
              content: isLast ? line : line + "\n",
              is_final: isLast,
              timestamp: new Date().toISOString(),
            });
            return;
          }
          turn.sawEvent = true;
          this.handleClaudeStreamEvent(ws, conversationId, event, turn);
        };

        try {
          for await (const chunkBuf of proc.stdout!) {
            const chunk = decoder.decode(chunkBuf, { stream: true });
            buffer += chunk;

            // Process complete lines (JSON events)
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.trim()) continue;
              handleLine(line, false);
            }
          }

          // Process remaining buffer (a last line with no trailing newline)
          if (buffer.trim()) {
            handleLine(buffer, true);
          }

          // Wait for process to complete
          const exitCode = await this.waitForExit(proc);

          // Clean up
          this.forgetChatProcess(context, conversationId, proc);

          // Claude Code has created the session once it ran to completion; resume it next time.
          if (session && exitCode === 0) session.started = true;

          // The session exists although the server never saw it start (an earlier send died
          // after Claude Code wrote it): resume it instead, once, within this same send.
          if (
            session &&
            usedSessionIdFlag &&
            !options.retried &&
            !isCancelled() &&
            exitCode !== 0 &&
            !turn.sawEvent &&
            /already in use/i.test(stderrTail)
          ) {
            session.started = true;
            await this.launchClaudeCodeChat(context, ws, conversationId, message, requestId, {
              ...options,
              turn: turnToken,
              retried: true,
            });
            return;
          }

          // A tool with no result by the end of the turn never finished (the agent crashed):
          // report it as failed so the viewer doesn't show it running forever. Not after a
          // cancel: the client has moved on, and they would land on its next turn.
          if (!isCancelled()) {
            this.failPendingTools(ws, conversationId, turn, "The tool reported no result before the reply ended");
          }

          // The process has exited: the conversation can take its next send.
          release({ "drbot.exit_code": exitCode, "drbot.cancelled": isCancelled() });

          // Send completion response
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                conversation_id: conversationId,
                status: exitCode === 0 ? "complete" : "error",
                exit_code: exitCode,
                full_response: turn.accumulatedText,
                timestamp: new Date().toISOString(),
              },
              id: requestId,
            })
          );
        } catch (error) {
          // A process that never actually spawned (see the proc.on("error", ...)
          // handler above, which already reported this failure to the client) has no
          // pid - Node assigns one synchronously only once posix_spawn succeeds. Bail
          // out here instead of sending a second, duplicate JSON-RPC response for the
          // same request or trying to kill a process that never started.
          if (!proc.pid) {
            release();
            return;
          }

          const errorMsg = getErrorMessage(error);

          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: JSONRPC_ERRORS.INTERNAL_ERROR,
                message: `Chat failed: ${errorMsg}`,
              },
              id: requestId,
            })
          );

          this.forgetChatProcess(context, conversationId, proc);

          try {
            await this.killProcessWithRetry(proc, conversationId, "Claude Code");
          } catch (error) {
            console.error(`[Claude Code] Failed to kill process for conversation ${conversationId}: ${getErrorMessage(error)}`);
          } finally {
            release();
          }
        }
      };

      // Start streaming in background
      streamOutput().catch((err) => {
        const errorMsg = getErrorMessage(err);
        console.error(`[Claude Code] Stream error: ${errorMsg}`);
        release();

        // Notify client of stream failure via WebSocket
        try {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: JSONRPC_ERRORS.INTERNAL_ERROR,
                message: `Stream error: ${errorMsg}`,
              },
              id: requestId,
            })
          );
        } catch (sendError) {
          console.error(`[Claude Code] Failed to send stream error notification: ${getErrorMessage(sendError)}`);
        }
      });
    } catch (error) {
      void drMcp?.cleanup();
      release();
      const errorMsg = getErrorMessage(error);

      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: JSONRPC_ERRORS.INTERNAL_ERROR,
            message: `Failed to launch Claude Code: ${errorMsg}`,
          },
          id: requestId,
        })
      );
    }
  }

  /** Sends a JSON-RPC notification to one chat client. */
  sendChatNotification(ws: DrBotChannel, method: string, params: Record<string, unknown>): void {
    ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  /**
   * Turns one Claude Code stream-json event into the chat notifications the viewer reads:
   * - assistant text -> `chat.response.chunk`
   * - assistant tool_use -> `chat.tool.invoke` with `status: "executing"`
   * - user tool_result -> `chat.tool.invoke` again, same `tool_use_id`, `completed` or `failed`
   * - result (end of the turn) -> `chat.response.complete`
   */
  handleClaudeStreamEvent(
    ws: DrBotChannel,
    conversationId: string,
    event: any,
    turn: ClaudeTurnState
  ): void {
    // Claude Code reports the session id once it has created the session (the init event).
    if (turn.session && typeof event?.session_id === "string") {
      turn.session.started = true;
    }

    if (event?.type === "assistant") {
      const content = Array.isArray(event.message?.content) ? event.message.content : [];
      for (const block of content) {
        if (block?.type === "text") {
          turn.accumulatedText += block.text;
          this.sendChatNotification(ws, "chat.response.chunk", {
            conversation_id: conversationId,
            content: block.text,
            is_final: false,
            timestamp: new Date().toISOString(),
          });
        } else if (block?.type === "tool_use") {
          if (typeof block.id === "string") {
            turn.pendingTools.set(block.id, { name: block.name, input: block.input });
          }
          this.sendChatNotification(ws, "chat.tool.invoke", {
            conversation_id: conversationId,
            tool_use_id: block.id,
            tool_name: block.name,
            tool_input: block.input,
            status: "executing",
            timestamp: new Date().toISOString(),
          });
        }
      }
    } else if (event?.type === "user") {
      // Tool results come back as a user message. A call denied at the permission prompt
      // (nothing can answer it under --print) comes back as an error result: `failed`.
      const content = Array.isArray(event.message?.content) ? event.message.content : [];
      for (const block of content) {
        if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
        this.sendToolOutcome(ws, conversationId, turn, block.tool_use_id, block.is_error === true, block.content);
      }
    } else if (event?.type === "result") {
      // Denials the turn lists but never answered with a tool_result are failures too. One whose
      // tool_result didn't read as a refusal is reported again, now with the reason.
      const denials = Array.isArray(event.permission_denials) ? event.permission_denials : [];
      for (const denial of denials) {
        const id = denial?.tool_use_id;
        if (typeof id !== "string") continue;
        if (turn.pendingTools.has(id)) {
          this.sendToolOutcome(ws, conversationId, turn, id, true, `Permission denied: ${denial.tool_name ?? "tool"}`);
        } else if (turn.failedTools.has(id)) {
          const failed = turn.failedTools.get(id)!;
          this.sendToolOutcome(ws, conversationId, turn, id, true, failed.result, { denied: true, call: failed });
        }
      }
      this.sendChatNotification(ws, "chat.response.complete", {
        conversation_id: conversationId,
        result: event.result,
        is_error: event.is_error === true,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Sends a tool's final `chat.tool.invoke` (completed or failed) and stops tracking it. A call
   * DrBot's permissions refused also carries `permission_denied` and, after Claude Code's own
   * text, the rule that refused it and how the person allows it (#1241).
   */
  sendToolOutcome(
    ws: DrBotChannel,
    conversationId: string,
    turn: ClaudeTurnState,
    toolUseId: string,
    isError: boolean,
    result: unknown,
    known: { denied?: boolean; call?: { name: unknown; input: unknown } } = {}
  ): void {
    const tool = known.call ?? turn.pendingTools.get(toolUseId);
    turn.pendingTools.delete(toolUseId);
    turn.failedTools.delete(toolUseId);
    const text = toolResultText(result);
    const denied = isError && (known.denied === true || isPermissionDenial(text));
    if (isError && !denied && tool) {
      turn.failedTools.set(toolUseId, { name: tool.name, input: tool.input, result });
    }
    // A refusal from the chat's own hook or from dr itself already says why: nothing is added.
    const explained = denied && isExplainedRefusal(text);
    const explanation = !denied
      ? undefined
      : explained
        ? text.slice(text.indexOf(REFUSAL_MARKER)).trim()
        : explainDeniedToolCall(
            this.drBotMode(),
            { toolName: tool?.name, toolInput: tool?.input },
            turn.rootPath
          );
    this.sendChatNotification(ws, "chat.tool.invoke", {
      conversation_id: conversationId,
      tool_use_id: toolUseId,
      tool_name: tool?.name,
      tool_input: tool?.input,
      status: isError ? "failed" : "completed",
      is_error: isError,
      result,
      ...(isError
        ? { error: [text || "Tool call failed", explained ? undefined : explanation].filter(Boolean).join("\n\n") }
        : {}),
      ...(denied ? { permission_denied: true, permission_explanation: explanation } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  /** Reports every tool still waiting for a result as failed. */
  failPendingTools(ws: DrBotChannel, conversationId: string, turn: ClaudeTurnState, reason: string): void {
    for (const toolUseId of [...turn.pendingTools.keys()]) {
      this.sendToolOutcome(ws, conversationId, turn, toolUseId, true, reason);
    }
  }

  /**
   * Launch GitHub Copilot CLI and stream responses via WebSocket
   */
  async launchCopilotChat(
    context: CheckoutContext,
    ws: DrBotChannel,
    conversationId: string,
    message: string,
    requestId: string | number | undefined,
    options: ChatLaunchOptions = {}
  ): Promise<void> {
    const turnToken = options.turn ?? this.reserveChatConversation(context, conversationId);
    const release = (attributes: Record<string, unknown> = {}) => {
      this.releaseChatConversation(context, conversationId, turnToken);
      options.onEnd?.(attributes);
    };
    try {
      // Determine which command to use (gh copilot or standalone copilot)
      let cmd: string[];

      // Test hook: allow tests to substitute a fixture command for the real copilot binary
      if (this._testCopilotCmdOverride) {
        cmd = [...this._testCopilotCmdOverride];
      } else {
        // Check if gh CLI with copilot extension is available
        const ghResult = spawnSync("gh", ["copilot", "--version"], {
          stdio: ["ignore", "pipe", "pipe"],
        });

        // Log why we're falling back to standalone copilot, for debuggability: `gh`
        // missing (ENOENT), `gh` present but the copilot extension isn't installed
        // (non-zero exit), or another spawn failure are otherwise indistinguishable.
        if (ghResult.error) {
          console.warn(
            `[Copilot] 'gh copilot --version' probe failed to spawn: ${getErrorMessage(ghResult.error)}`
          );
        } else if (ghResult.status !== 0 && process.env.VERBOSE) {
          console.log(
            `[Copilot] 'gh copilot' unavailable (exit ${ghResult.status}), falling back to standalone 'copilot'`
          );
        }

        if (ghResult.status === 0) {
          cmd = ["gh", "copilot", "explain"];
          this.addCopilotPermissionFlags(cmd, "gh copilot");
          cmd.push(message);
        } else {
          // Try standalone copilot
          cmd = ["copilot", "explain"];
          this.addCopilotPermissionFlags(cmd, "copilot");
          cmd.push(message);
        }
      }

      // Launch GitHub Copilot. It gets the chat's mode in its environment too, so any `dr` it
      // runs keeps to the read-only rules whatever Copilot's own permission flags do.
      const proc = spawn(cmd[0], cmd.slice(1), {
        cwd: context.rootPath,
        env: this.buildChatEnv(context),
        stdio: ["pipe", "pipe", "pipe"],
      });

      // See the matching handler in launchClaudeCodeChat: Node reports spawn failures
      // (e.g. ENOENT if `gh`/`copilot` isn't on PATH) asynchronously via an 'error'
      // event, and an unhandled one would crash the whole server instead of just this
      // one chat request.
      proc.on("error", (err) => {
        const errorMsg = getErrorMessage(err);
        console.error(
          `[Copilot] Failed to spawn subprocess for conversation ${conversationId}: ${errorMsg}`
        );
        this.forgetChatProcess(context, conversationId, proc);
        release();
        try {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: JSONRPC_ERRORS.INTERNAL_ERROR,
                message: `Failed to launch GitHub Copilot: ${errorMsg}`,
              },
              id: requestId,
            })
          );
        } catch (sendError) {
          console.error(
            `[Copilot] Failed to send spawn-error notification: ${getErrorMessage(sendError)}`
          );
        }
      });
      // See the matching guard in launchClaudeCodeChat: a failed spawn can also raise a
      // separate unhandled 'error' event on the stdin stream Node already created.
      proc.stdin?.on("error", () => {});

      // Store active process
      context.chatProcesses.set(conversationId, proc);

      // GitHub Copilot outputs plain text/markdown (not JSON)
      const decoder = new TextDecoder();

      const streamOutput = async () => {
        let accumulatedText = "";

        try {
          for await (const chunkBuf of proc.stdout!) {
            const chunk = decoder.decode(chunkBuf, { stream: true });
            accumulatedText += chunk;

            // Nothing more after a cancel: the client may already be streaming its next turn.
            if (context.cancelledChatProcesses.has(proc)) continue;

            // Send text chunk as it arrives
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                method: "chat.response.chunk",
                params: {
                  conversation_id: conversationId,
                  content: chunk,
                  is_final: false,
                  timestamp: new Date().toISOString(),
                },
              })
            );
          }

          // Wait for process to complete
          const exitCode = await this.waitForExit(proc);

          // Clean up
          this.forgetChatProcess(context, conversationId, proc);
          release({ "drbot.exit_code": exitCode });

          // Send completion response
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                conversation_id: conversationId,
                status: exitCode === 0 ? "complete" : "error",
                exit_code: exitCode,
                full_response: accumulatedText,
                timestamp: new Date().toISOString(),
              },
              id: requestId,
            })
          );
        } catch (error) {
          // See the matching guard in launchClaudeCodeChat: a process that never
          // actually spawned has no pid, and its own proc.on("error", ...) handler
          // above already reported the failure - avoid a duplicate response/kill.
          if (!proc.pid) {
            release();
            return;
          }

          const errorMsg = getErrorMessage(error);

          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: JSONRPC_ERRORS.INTERNAL_ERROR,
                message: `Chat failed: ${errorMsg}`,
              },
              id: requestId,
            })
          );

          this.forgetChatProcess(context, conversationId, proc);

          try {
            await this.killProcessWithRetry(proc, conversationId, "Copilot");
          } catch (error) {
            console.error(`[Copilot] Failed to kill process for conversation ${conversationId}: ${getErrorMessage(error)}`);
          } finally {
            release();
          }
        }
      };

      // Start streaming in background
      streamOutput().catch((err) => {
        const errorMsg = getErrorMessage(err);
        console.error(`[Copilot] Stream error: ${errorMsg}`);
        release();

        // Notify client of stream failure via WebSocket
        try {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: JSONRPC_ERRORS.INTERNAL_ERROR,
                message: `Stream error: ${errorMsg}`,
              },
              id: requestId,
            })
          );
        } catch (sendError) {
          console.error(`[Copilot] Failed to send stream error notification: ${getErrorMessage(sendError)}`);
        }
      });
    } catch (error) {
      release();
      const errorMsg = getErrorMessage(error);

      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: JSONRPC_ERRORS.INTERNAL_ERROR,
            message: `Failed to launch GitHub Copilot: ${errorMsg}`,
          },
          id: requestId,
        })
      );
    }
  }


  /**
   * Wait for a spawned child process to exit and resolve with its exit code
   * Node's ChildProcess doesn't expose a Bun-style `.exited` promise, so this
   * wraps the "exit" event (or the already-set exitCode, if it fired before
   * we started listening).
   */
  waitForExit(proc: ChildProcess): Promise<number> {
    return new Promise((resolve) => {
      // A process killed by a signal (chat.cancel) has no exit code: report it as 1, and don't
      // wait for an 'exit' that has already fired.
      if (this.hasExited(proc)) {
        resolve(proc.exitCode ?? 1);
        return;
      }
      proc.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
  }

  /**
   * Whether a child process has actually terminated.
   *
   * NOTE: Node's `ChildProcess.killed` means "kill() was successfully used to send a
   * signal" — it does NOT mean the process has exited (a process can ignore SIGTERM
   * and keep running with `.killed === true`). This differs from Bun's
   * `Subprocess.killed`, which does mean "has the process exited". Use exitCode/
   * signalCode (set only once the process has actually terminated) instead of
   * `.killed` to decide whether retry/escalation is still needed.
   */
  hasExited(proc: ChildProcess): boolean {
    return hasExited(proc);
  }

  /**
   * Kill a process with retry logic and exponential backoff
   * Attempts graceful SIGTERM first, then force SIGKILL if needed
   */
  async killProcessWithRetry(
    proc: ChildProcess,
    conversationId: string,
    label: string
  ): Promise<void> {
    const maxRetries = 3;
    let attempt = 0;
    const baseDelay = 100; // milliseconds

    while (attempt < maxRetries) {
      try {
        if (this.hasExited(proc)) {
          // Process already terminated
          return;
        }

        // Try graceful termination with SIGTERM
        proc.kill("SIGTERM");

        // Wait for process to exit gracefully
        await new Promise((resolve) => setTimeout(resolve, 500));

        if (this.hasExited(proc)) {
          return;
        }
      } catch (error) {
        // Continue to retry
      }

      attempt++;
      if (attempt < maxRetries) {
        // Exponential backoff: 100ms, 200ms, 400ms
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Force kill if graceful shutdown failed
    try {
      if (!this.hasExited(proc)) {
        proc.kill("SIGKILL");
        console.warn(
          `[${label}] Process for conversation ${conversationId} did not respond to SIGTERM, force killed with SIGKILL`
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to kill process: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/** 1st, 2nd, 3rd, 4th, ... */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
