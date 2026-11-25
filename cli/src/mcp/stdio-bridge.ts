/**
 * `dr mcp` over stdio as a bridge to the central process (issue 1279, slice 3A;
 * `docs/design/USER_LEVEL_DR.md` section 7, "Getting MCP clients onto it").
 *
 * The MCP client (the Claude Code plugin, Copilot, DrBot's agent) starts `dr mcp` as before. The
 * bridge finds the central process for the farm in use, or starts it (`ensureCentralServer`), and
 * forwards every MCP message both ways between stdio and the process's `/mcp`, with the token
 * read from the process's 0600 token file. Nothing is written into the client's configuration.
 *
 * What the session needs to resolve its checkout travels with it:
 * - the client's roots: the central process asks for them, and the bridge forwards that request
 *   to the client like any other;
 * - DR_MCP_ROOT_PATH, when set, in the `X-DR-MCP-Root-Path` header: it pins the session;
 * - DR_CHAT_MODE, DR_CHAT_PROJECT_ROOT, DR_CHANGESET_ONLY and DR_CHANGESET_ORIGIN (DrBot's
 *   limits) in the `X-DR-MCP-Session-Env` header.
 *
 * When the central process goes away (stopped, replaced by a newer CLI) or forgets the session,
 * the bridge finds or starts the process again, replays the client's initialize, and resends
 * the message. (`application.applicationcomponent.mcp-stdio-bridge`)
 */

import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  isInitializeRequest,
  isJSONRPCRequest,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { pickSessionEnv } from "../core/session-env.js";
import type { EnsureCentralServer, EnsuredCentralServer } from "../server/central-mcp-contract.js";
import { MCP_ROOT_PATH_ENV } from "../server/central-mcp-contract.js";
import { getErrorMessage } from "../utils/errors.js";
import { encodeSessionEnv, MCP_BRIDGE_HEADER, MCP_ROOT_PATH_HEADER, MCP_SESSION_ENV_HEADER } from "./central-mcp.js";

export interface McpStdioBridgeOptions {
  /** Finds or starts the central process. Default: `ensureCentralServer`. */
  ensure?: EnsureCentralServer;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdin?: Readable;
  stdout?: Writable;
  log?: (message: string) => void;
}

/** The headers a bridge session sends with every request to `/mcp`. */
export function bridgeHeaders(token: string, env: NodeJS.ProcessEnv): Record<string, string> {
  // Marked as the bridge's: it replays the session after a restart, so the session doesn't hold the process.
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, [MCP_BRIDGE_HEADER]: "1" };
  const pinned = env[MCP_ROOT_PATH_ENV]?.trim();
  if (pinned) headers[MCP_ROOT_PATH_HEADER] = encodeURIComponent(pinned);
  const sessionEnv = pickSessionEnv(env);
  if (Object.keys(sessionEnv).length > 0) headers[MCP_SESSION_ENV_HEADER] = encodeSessionEnv(sessionEnv);
  return headers;
}

/** The central process forgot the session, or is not there: reconnect and replay. */
function isReconnectable(error: unknown): boolean {
  if (error instanceof StreamableHTTPError) return error.code === 404;
  const text = getErrorMessage(error).toLowerCase();
  return /econnrefused|econnreset|fetch failed|unable to connect|socket|network|connection/.test(text);
}

/**
 * Runs the bridge until the client closes stdin. Resolves then; rejects only when the central
 * process can't be found or started at all.
 */
export async function runMcpStdioBridge(options: McpStdioBridgeOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((message: string) => process.stderr.write(`[mcp] ${message}\n`));
  const ensure = options.ensure ?? (await import("../server/ensure-central-server.js")).ensureCentralServer;
  const connect = async (): Promise<EnsuredCentralServer> => {
    const ensured = await ensure({ cwd: options.cwd, env });
    if (ensured.notice) log(ensured.notice);
    return ensured;
  };

  const bridge = new Bridge(await connect(), env, connect, log);
  const stdin = options.stdin ?? process.stdin;
  const stdio = new StdioServerTransport(stdin, options.stdout);
  // The client ends the session by closing stdin, or (after a grace period) with a signal: either
  // way the bridge ends its session in the central process before it goes, so the process doesn't
  // count a client that is gone.
  const end = () => void stdio.close();
  stdin.once("end", end);
  stdin.once("close", end);
  const signals: NodeJS.Signals[] = options.stdin ? [] : ["SIGTERM", "SIGINT", "SIGHUP"];
  for (const signal of signals) process.once(signal, end);
  try {
    await bridge.run(stdio);
  } finally {
    stdin.off("end", end);
    stdin.off("close", end);
    for (const signal of signals) process.off(signal, end);
  }
}

class Bridge {
  private upstream!: StreamableHTTPClientTransport;
  /** The client's initialize request, replayed to a new session after a reconnect. */
  private initialize?: JSONRPCMessage & { id: string | number };
  /** Ids of replayed initializes, whose responses the client must not see. */
  private readonly replayed = new Map<string | number, (protocolVersion?: string) => void>();
  private queue: Promise<void> = Promise.resolve();
  private stdio?: StdioServerTransport;
  private replaySeq = 0;

  constructor(
    private ensured: EnsuredCentralServer,
    private readonly env: NodeJS.ProcessEnv,
    private readonly reconnect: () => Promise<EnsuredCentralServer>,
    private readonly log: (message: string) => void
  ) {}

  async run(stdio: StdioServerTransport): Promise<void> {
    this.stdio = stdio;
    await this.openUpstream();
    const closed = new Promise<void>((resolve) => {
      stdio.onclose = () => resolve();
    });
    stdio.onerror = (error) => this.log(`stdio: ${getErrorMessage(error)}`);
    stdio.onmessage = (message) => {
      // In order: the initialize must have its session before anything else is sent.
      this.queue = this.queue.then(() => this.forward(message));
    };
    await stdio.start();
    this.log(`bridging to the DR process on port ${this.ensured.record.port} (pid ${this.ensured.record.pid})`);
    await closed;
    await this.queue.catch(() => {});
    await this.closeUpstream(true);
  }

  private async openUpstream(): Promise<void> {
    const url = new URL(`http://127.0.0.1:${this.ensured.record.port}/mcp`);
    const upstream = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: bridgeHeaders(this.ensured.token, this.env) },
    });
    upstream.onmessage = (message) => this.fromUpstream(message);
    upstream.onerror = (error) => {
      if (this.upstream === upstream) this.log(`DR process: ${getErrorMessage(error)}`);
    };
    await upstream.start();
    this.upstream = upstream;
  }

  private async closeUpstream(terminate: boolean): Promise<void> {
    const upstream = this.upstream;
    if (terminate) await upstream.terminateSession().catch(() => {});
    await upstream.close().catch(() => {});
  }

  private fromUpstream(message: JSONRPCMessage): void {
    if ("id" in message && message.id !== undefined && !("method" in message)) {
      const replay = this.replayed.get(message.id);
      if (replay) {
        this.replayed.delete(message.id);
        replay("result" in message ? (message.result as { protocolVersion?: string }).protocolVersion : undefined);
        return;
      }
      if (this.initialize && message.id === this.initialize.id && "result" in message) {
        this.setProtocolVersion((message.result as { protocolVersion?: string }).protocolVersion);
      }
    }
    this.stdio?.send(message).catch((error) => this.log(`to the client: ${getErrorMessage(error)}`));
  }

  private setProtocolVersion(version: string | undefined): void {
    if (version) this.upstream.setProtocolVersion(version);
  }

  private async forward(message: JSONRPCMessage): Promise<void> {
    if (isInitializeRequest(message)) this.initialize = message as JSONRPCMessage & { id: string | number };
    try {
      await this.upstream.send(message);
      return;
    } catch (error) {
      if (!this.initialize || isInitializeRequest(message) || !isReconnectable(error)) {
        this.fail(message, error);
        return;
      }
      this.log(`the DR process went away (${getErrorMessage(error)}); reconnecting`);
    }
    try {
      await this.reopen();
      await this.upstream.send(message);
    } catch (error) {
      this.fail(message, error);
    }
  }

  /** A new upstream session: find or start the process again, then replay the client's initialize. */
  private async reopen(): Promise<void> {
    await this.closeUpstream(false);
    this.ensured = await this.reconnect();
    await this.openUpstream();
    const id = `dr-bridge-replay-${++this.replaySeq}`;
    const answered = new Promise<string | undefined>((resolve) => this.replayed.set(id, resolve));
    await this.upstream.send({ ...this.initialize!, id });
    this.setProtocolVersion(await answered);
    await this.upstream.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** Tells the client a request failed (a notification or response that can't be sent is only logged). */
  private fail(message: JSONRPCMessage, error: unknown): void {
    this.log(`forwarding to the DR process failed: ${getErrorMessage(error)}`);
    if (!isJSONRPCRequest(message)) return;
    void this.stdio
      ?.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: `The DR process could not be reached: ${getErrorMessage(error)}` },
      })
      .catch(() => {});
  }
}
