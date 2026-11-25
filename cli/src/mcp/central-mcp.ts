/**
 * `/mcp` on the central process (issue 1279, slice 3A; `docs/design/USER_LEVEL_DR.md` sections 7
 * and 9): the streamable-HTTP MCP transport, one MCP server per session, every session resolving
 * its own checkout through the farm's project registry.
 *
 * A session's checkout comes from, in order:
 * 1. the `X-DR-MCP-Root-Path` header of its initialize request: DR_MCP_ROOT_PATH as the `dr mcp`
 *    bridge was started with (DrBot's launcher sets it);
 * 2. its client's roots, asked for on the session's first tool call and again after the client
 *    says they changed (the first root inside a registered checkout, else the first root, which
 *    the registry registers);
 * 3. the process's default checkout.
 *
 * The `X-DR-MCP-Session-Env` header carries the bridge's DR_CHAT_MODE, DR_CHAT_PROJECT_ROOT,
 * DR_CHANGESET_ONLY and DR_CHANGESET_ORIGIN (core/session-env.ts), so DrBot's limits hold in the
 * shared process as they did in its own `dr mcp`.
 *
 * The endpoint is framework-free (Web `Request` in, `Response` out); the central server mounts it
 * behind its one token. (`application.applicationcomponent.visualization-server`)
 */

import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest, RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { SESSION_ENV_KEYS, type SessionEnvValues } from "../core/session-env.js";
import { getErrorMessage } from "../utils/errors.js";
import { getCliVersion } from "../utils/spec-version.js";
import { McpSession } from "./mcp-session.js";
import { registryCheckoutResolver, type SessionCheckoutResolver } from "./project-root.js";
import { McpResourceRegistry } from "./resource-registry.js";
import { SERVER_INSTRUCTIONS } from "./server-instructions.js";
import { McpToolRegistry } from "./tool-registry.js";

/** The header the bridge sends DR_MCP_ROOT_PATH in (URI-encoded). */
export const MCP_ROOT_PATH_HEADER = "x-dr-mcp-root-path";
/** The header the bridge sends its session environment in (base64url JSON of SESSION_ENV_KEYS). */
export const MCP_SESSION_ENV_HEADER = "x-dr-mcp-session-env";
/**
 * The header the `dr mcp` bridge marks its sessions with: it replays them on a new process, so they
 * don't hold the central process back from a restart; a session without it (a client connected to
 * `/mcp` directly) does.
 */
export const MCP_BRIDGE_HEADER = "x-dr-mcp-bridge";

/** A session with no open event stream and no request for this long is closed (DR_MCP_SESSION_IDLE_MINUTES). */
const DEFAULT_SESSION_IDLE_MINUTES = 60;

/** Encodes a session environment for MCP_SESSION_ENV_HEADER. */
export function encodeSessionEnv(values: SessionEnvValues): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

/** Decodes MCP_SESSION_ENV_HEADER; only SESSION_ENV_KEYS with string values are kept. */
export function decodeSessionEnv(header: string | null): SessionEnvValues {
  if (!header) return {};
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  } catch {
    return {};
  }
  if (data === null || typeof data !== "object") return {};
  const values: SessionEnvValues = {};
  for (const key of SESSION_ENV_KEYS) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === "string" && value !== "") values[key] = value;
  }
  return values;
}

/**
 * The dr MCP server for one session: every tool and resource, run in the session. Over HTTP the
 * client's roots are asked for on the first tool call, on that call's own stream (a request sent
 * before the client opened its event stream would be dropped); `eagerRoots` asks as soon as the
 * client has initialized, which stdio allows.
 */
export async function createDrMcpServer(session?: McpSession, options: { eagerRoots?: boolean } = {}): Promise<McpServer> {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const server = new McpServer(
    { name: "documentation-robotics", version: getCliVersion() },
    { instructions: SERVER_INSTRUCTIONS }
  );
  new McpToolRegistry().registerAll(server, { session });
  await new McpResourceRegistry().registerAll(server, { session });
  if (session) {
    const inner = server.server;
    inner.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      session.root.markRootsStale();
      if (options.eagerRoots) await session.root.follow(() => inner.listRoots());
    });
    inner.oninitialized = () => {
      if (!inner.getClientCapabilities()?.roots) return;
      session.clientInitialized();
      if (options.eagerRoots) void session.root.follow(() => inner.listRoots());
    };
  }
  return server;
}

export interface CentralMcpEndpointOptions {
  /** The farm's registry: how a session's paths become checkouts. */
  registry?: Parameters<typeof registryCheckoutResolver>[0];
  /** Or a resolver directly (tests). */
  resolver?: SessionCheckoutResolver;
  /** Where a session with no pinned root and no client roots serves (the process's default checkout). */
  fallbackRoot?: () => Promise<string | undefined>;
  /** Called on every MCP request (the process's activity clock). */
  onActivity?: () => void;
  /** Minutes a session with no open event stream may go without a request. Default 60 (DR_MCP_SESSION_IDLE_MINUTES). */
  sessionIdleMinutes?: number;
  now?: () => number;
  log?: (message: string) => void;
}

interface OpenSession {
  id: string;
  session: McpSession;
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  lastSeenAt: number;
  /** GET event streams open now: a live bridge keeps one open. */
  openStreams: number;
  /** Opened by the `dr mcp` bridge (MCP_BRIDGE_HEADER), which replays it after a restart. */
  bridged: boolean;
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The MCP sessions of the central process, served at `/mcp`. */
export class CentralMcpEndpoint {
  private readonly sessions = new Map<string, OpenSession>();
  private readonly resolver?: SessionCheckoutResolver;
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(private readonly options: CentralMcpEndpointOptions = {}) {
    this.resolver = options.resolver ?? (options.registry ? registryCheckoutResolver(options.registry) : undefined);
    const fromEnv = Number(process.env.DR_MCP_SESSION_IDLE_MINUTES);
    const minutes = options.sessionIdleMinutes ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_SESSION_IDLE_MINUTES);
    this.idleMs = minutes * 60_000;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((message) => process.stderr.write(`[mcp] ${message}\n`));
  }

  /** MCP sessions open now. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** MCP sessions open now whose client is connected directly, not through the `dr mcp` bridge. */
  get directSessionCount(): number {
    let direct = 0;
    for (const open of this.sessions.values()) if (!open.bridged) direct++;
    return direct;
  }

  /** Handles one request to `/mcp` (already authenticated). */
  async handle(request: Request): Promise<Response> {
    if (this.closed) return jsonRpcError(503, -32000, "The DR process is stopping.");
    this.options.onActivity?.();
    this.startSweeping();
    const sessionId = request.headers.get("mcp-session-id");
    if (sessionId) {
      const open = this.sessions.get(sessionId);
      if (!open) return jsonRpcError(404, -32001, "Session not found");
      open.lastSeenAt = this.now();
      if (request.method === "GET") return this.openStream(open, request);
      return open.transport.handleRequest(request);
    }
    if (request.method !== "POST") {
      return jsonRpcError(400, -32000, "Bad Request: no valid session ID provided");
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonRpcError(400, -32700, "Parse error: the body is not JSON");
    }
    const initialize = Array.isArray(body) ? body.find((message) => isInitializeRequest(message)) : isInitializeRequest(body) ? body : undefined;
    if (!initialize) {
      return jsonRpcError(400, -32600, "Invalid Request: initialize required for new session");
    }
    return this.startSession(request, body);
  }

  private async startSession(request: Request, body: unknown): Promise<Response> {
    const pinned = request.headers.get(MCP_ROOT_PATH_HEADER);
    let pinnedRoot: string | undefined;
    if (pinned) {
      try {
        pinnedRoot = decodeURIComponent(pinned);
      } catch {
        return jsonRpcError(400, -32600, `Invalid ${MCP_ROOT_PATH_HEADER} header`);
      }
    }
    const fallback = pinnedRoot ? undefined : await this.options.fallbackRoot?.().catch(() => undefined);
    const session = new McpSession({
      resolver: this.resolver,
      pinnedRoot,
      fallback,
      env: decodeSessionEnv(request.headers.get(MCP_SESSION_ENV_HEADER)),
      log: this.log,
    });
    const server = await createDrMcpServer(session);
    const bridged = request.headers.get(MCP_BRIDGE_HEADER) === "1";
    let open: OpenSession | undefined;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        open = { id, session, server, transport, lastSeenAt: this.now(), openStreams: 0, bridged };
        this.sessions.set(id, open);
      },
      onsessionclosed: (id) => {
        void this.drop(id);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) void this.drop(transport.sessionId);
    };
    try {
      await server.connect(transport);
      return await transport.handleRequest(request, { parsedBody: body });
    } catch (error) {
      this.log(`starting an MCP session failed: ${getErrorMessage(error)}`);
      if (open) await this.drop(open.id);
      else await server.close().catch(() => {});
      return jsonRpcError(500, -32603, "Internal error starting the MCP session");
    }
  }

  /** A GET event stream: counted while it is open, so a live bridge's session is never swept. */
  private async openStream(open: OpenSession, request: Request): Promise<Response> {
    const response = await open.transport.handleRequest(request);
    if (response.status !== 200 || !response.body) return response;
    open.openStreams++;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      open.openStreams = Math.max(0, open.openStreams - 1);
      open.lastSeenAt = this.now();
    };
    request.signal.addEventListener("abort", end, { once: true });
    // Also when the stream ends from this side (the session closed).
    const reader = response.body;
    const counted = reader.pipeThrough(
      new TransformStream({
        flush: end,
      })
    );
    return new Response(counted, { status: response.status, headers: response.headers });
  }

  private async drop(id: string): Promise<void> {
    const open = this.sessions.get(id);
    if (!open) return;
    this.sessions.delete(id);
    try {
      await open.server.close();
    } catch (error) {
      this.log(`closing MCP session ${id}: ${getErrorMessage(error)}`);
    }
  }

  /** Closes sessions whose client is gone: no open event stream and no request within the idle time. */
  sweep(): number {
    const cutoff = this.now() - this.idleMs;
    let closed = 0;
    for (const open of [...this.sessions.values()]) {
      if (open.openStreams === 0 && open.lastSeenAt < cutoff) {
        closed++;
        void this.drop(open.id);
      }
    }
    return closed;
  }

  private startSweeping(): void {
    if (this.sweepTimer || this.closed) return;
    this.sweepTimer = setInterval(() => this.sweep(), Math.min(this.idleMs, 5 * 60_000));
    this.sweepTimer.unref?.();
  }

  /** Closes every session (the process is stopping). */
  async close(): Promise<void> {
    this.closed = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    await Promise.all([...this.sessions.keys()].map((id) => this.drop(id)));
  }
}
