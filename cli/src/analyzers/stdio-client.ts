/**
 * MCP JSON-RPC 2.0 stdio client
 *
 * Minimal implementation for communicating with analyzers via JSON-RPC over stdio.
 * Handles process spawning, request/response correlation, timeouts, and clean shutdown.
 *
 * Protocol: JSON-RPC 2.0 with line-delimited JSON framing.
 * - Each request/response is a complete JSON object on a single line
 * - Request IDs are integers for correlation
 * - Errors are extracted from JSON-RPC error response objects
 */

import { spawn, ChildProcess } from "child_process";
import { CLIError, ErrorCategory } from "../utils/errors.js";

/**
 * JSON-RPC 2.0 request structure
 */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id: number;
}

/**
 * JSON-RPC notification (no id field)
 */
interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

/**
 * Environment variable that overrides the initialize handshake timeout, in milliseconds.
 */
export const INIT_TIMEOUT_ENV = "DR_CBM_INIT_TIMEOUT_MS";

/**
 * What to try when an analyzer binary was found but could not be started (for example its
 * initialize handshake timed out). It is installed, so reinstalling it is not the advice.
 * The CLI's counterpart of notInstalledError's advice in the MCP tools (codebase-shared.ts).
 */
export const START_FAILURE_SUGGESTIONS: readonly string[] = [
  `If it timed out on a slow or busy machine, raise ${INIT_TIMEOUT_ENV} (milliseconds), e.g. ${INIT_TIMEOUT_ENV}=60000`,
  "Otherwise check that the binary runs, e.g. codebase-memory-mcp --version",
];

/**
 * Default initialize handshake timeout. A cold start of codebase-memory-mcp on a busy
 * machine has taken just over 5 s, so this leaves a wide margin.
 */
export const DEFAULT_INIT_TIMEOUT_MS = 30_000;

/** The largest delay setTimeout honours; a larger one fires after 1 ms. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * A DR_CBM_INIT_TIMEOUT_MS (or initTimeoutMs option) that is not a usable timeout.
 * A configuration error, not an analyzer failure: detection lets it propagate
 * rather than reporting the analyzer as not installed.
 */
export class InitTimeoutConfigError extends CLIError {
  constructor(source: string, raw: unknown) {
    super(
      `${source} must be a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}, got '${String(raw)}'`,
      ErrorCategory.USER,
      [`Set ${INIT_TIMEOUT_ENV} to a duration in milliseconds, e.g. ${INIT_TIMEOUT_ENV}=60000, or unset it for the ${DEFAULT_INIT_TIMEOUT_MS} ms default`]
    );
    this.name = "InitTimeoutConfigError";
  }
}

/**
 * Resolve the initialize timeout from the environment.
 *
 * @returns DR_CBM_INIT_TIMEOUT_MS when set, otherwise DEFAULT_INIT_TIMEOUT_MS
 * @throws InitTimeoutConfigError if DR_CBM_INIT_TIMEOUT_MS is set but is not
 *   a whole number from 1 to 2147483647 written in plain digits
 */
export function resolveInitTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[INIT_TIMEOUT_ENV]?.trim();
  if (!raw) {
    return DEFAULT_INIT_TIMEOUT_MS;
  }
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!isValidTimeout(value)) {
    throw new InitTimeoutConfigError(INIT_TIMEOUT_ENV, raw);
  }
  return value;
}

function isValidTimeout(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_TIMEOUT_MS;
}

/**
 * Options for StdioClient
 */
export interface StdioClientOptions {
  /** Initialize handshake timeout in milliseconds; overrides DR_CBM_INIT_TIMEOUT_MS. */
  initTimeoutMs?: number;
}

/**
 * MCP client for communicating with analyzer backends via JSON-RPC 2.0 stdio
 */
export class StdioClient {
  private proc: ChildProcess | null = null;
  private requestId: number = 0;
  private pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timeout: NodeJS.Timeout }> = new Map();
  private readonly initTimeoutMs: number;
  /** Whether initTimeoutMs came from DR_CBM_INIT_TIMEOUT_MS or the default (not the caller). */
  private readonly initTimeoutFromEnv: boolean;

  /**
   * @throws InitTimeoutConfigError if options.initTimeoutMs or DR_CBM_INIT_TIMEOUT_MS is invalid,
   *   so a bad setting fails before any process is spawned
   */
  constructor(options: StdioClientOptions = {}) {
    if (options.initTimeoutMs !== undefined) {
      if (!isValidTimeout(options.initTimeoutMs)) {
        throw new InitTimeoutConfigError("initTimeoutMs", options.initTimeoutMs);
      }
      this.initTimeoutMs = options.initTimeoutMs;
      this.initTimeoutFromEnv = false;
    } else {
      this.initTimeoutMs = resolveInitTimeoutMs();
      this.initTimeoutFromEnv = true;
    }
  }

  /**
   * Spawn an analyzer process
   *
   * @param binaryPath Path to the analyzer binary
   * @param args Optional command-line arguments (or env object for backwards compatibility)
   * @param env Optional environment variables (merged with process.env)
   * @throws Error if spawn fails
   */
  spawn(binaryPath: string, args?: string[] | Record<string, string>, env?: Record<string, string>): void {
    if (this.proc) {
      throw new Error("Process already spawned");
    }

    // Handle backwards compatibility: if args is an object, treat it as env
    let actualArgs: string[] = [];
    let actualEnv = process.env as Record<string, string>;

    if (Array.isArray(args)) {
      actualArgs = args;
      actualEnv = { ...actualEnv, ...env };
    } else if (args && typeof args === "object") {
      actualEnv = { ...actualEnv, ...args };
    }

    this.proc = spawn(binaryPath, actualArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: actualEnv,
    });

    // Set up stdout listener for responses
    if (this.proc.stdout) {
      this.proc.stdout.setEncoding("utf-8");
      let buffer = "";

      this.proc.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const message = JSON.parse(line);
            this.handleMessage(message);
          } catch (error) {
            // If we have pending requests, reject the oldest one since it likely
            // sent the request that produced this invalid response
            const firstKey = this.pendingRequests.keys().next().value;
            if (firstKey !== undefined) {
              const pending = this.pendingRequests.get(firstKey);
              if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(firstKey);
                pending.reject(new Error(`Failed to parse JSON-RPC response from analyzer: ${line}`));
              }
            } else {
              // No pending requests, just log the error
              console.error(`Failed to parse JSON-RPC message from analyzer: ${line}`);
            }
          }
        }
      });
    }

    // Set up stderr listener
    if (this.proc.stderr) {
      this.proc.stderr.setEncoding("utf-8");
      this.proc.stderr.on("data", (chunk: string) => {
        console.error(`[Analyzer stderr] ${chunk}`);
      });
    }

    // Handle process exit
    this.proc.on("exit", (code: number | null, signal: string | null) => {
      this.proc = null;
      // Reject all pending requests
      for (const [, { reject, timeout }] of this.pendingRequests) {
        clearTimeout(timeout);
        reject(new Error(`Process exited with code ${code} (signal: ${signal})`));
      }
      this.pendingRequests.clear();
    });

    this.proc.on("error", (error: Error) => {
      // Reject all pending requests
      for (const [, { reject, timeout }] of this.pendingRequests) {
        clearTimeout(timeout);
        reject(error);
      }
      this.pendingRequests.clear();
    });
  }

  /**
   * Initialize the analyzer with client information
   *
   * Sends an initialize request and waits for the response. The timeout is the
   * constructor's initTimeoutMs, else DR_CBM_INIT_TIMEOUT_MS, else 30 seconds
   * (read when the client is constructed). It was 2 s, then 5 s (#802); both
   * proved too tight for a cold start of codebase-memory-mcp on a loaded machine.
   *
   * @param clientInfo Client information object
   * @throws Error if initialize times out or fails
   */
  async initialize(clientInfo: Record<string, unknown>): Promise<unknown> {
    return this.callTool("initialize", clientInfo, {
      timeout: this.initTimeoutMs,
      timeoutHint: this.initTimeoutFromEnv
        ? `the analyzer did not answer the initialize handshake; set ${INIT_TIMEOUT_ENV} (milliseconds) to allow a slower start`
        : "the analyzer did not answer the initialize handshake",
    });
  }

  /**
   * Call a tool on the analyzer
   *
   * Sends a JSON-RPC request and waits for the response.
   * Defaults to 30-second timeout for graph queries.
   *
   * @param name Tool name (method)
   * @param params Tool parameters
   * @param options Optional configuration (timeout in milliseconds; timeoutHint is
   *   appended to the timeout error)
   * @returns Tool result
   * @throws Error if tool call fails or times out
   */
  async callTool(
    name: string,
    params?: unknown,
    options?: { timeout?: number; timeoutHint?: string }
  ): Promise<unknown> {
    if (!this.proc) {
      throw new Error("Process not spawned");
    }

    const timeout = options?.timeout ?? 30000;
    const id = ++this.requestId;

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      method: name,
      params,
      id,
    };

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        const hint = options?.timeoutHint ? `: ${options.timeoutHint}` : "";
        reject(new Error(`Tool call '${name}' timed out after ${timeout}ms${hint}`));
      }, timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout: timeoutHandle });

      try {
        const line = JSON.stringify(request) + "\n";
        // Explicit null checks to prevent race condition with exit handler
        if (!this.proc || !this.proc.stdin) {
          clearTimeout(timeoutHandle);
          this.pendingRequests.delete(id);
          reject(new Error("Process or stdin closed before write could complete"));
          return;
        }

        if (!this.proc.stdin.write(line)) {
          // Write returned false (backpressure), but data is already in the buffer.
          // No action needed — the data will be flushed automatically.
          this.proc.stdin.once("drain", () => {
            // Drain event listener registered but no action needed
          });
        }
      } catch (error) {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  /**
   * Close the connection and clean up
   *
   * Sends a shutdown notification and terminates the process.
   * Sends SIGTERM first, then escalates to SIGKILL after 1 second if needed.
   * Cleans up all pending requests and event listeners.
   */

  /**
   * Invoke a tool on the analyzer via the MCP tools/call protocol
   *
   * Sends a tools/call request with {name, arguments} and unwraps the
   * MCP content envelope from the response (content[0].text parsed as JSON).
   *
   * Use this for all tool invocations. Use callTool() only for MCP protocol
   * methods (initialize, tools/list).
   *
   * @param name Tool name (e.g., "search_graph", "index_repository")
   * @param args Tool arguments to pass as the arguments field
   * @param options Optional configuration (timeout in milliseconds)
   * @returns Parsed tool result unwrapped from MCP content envelope
   */
  async invokeTool(
    name: string,
    args?: unknown,
    options?: { timeout?: number }
  ): Promise<unknown> {
    const response = await this.callTool(
      "tools/call",
      { name, arguments: args ?? {} },
      options
    ) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    // Unwrap MCP tools/call envelope: result is JSON-encoded in content[0].text
    if (response?.content && Array.isArray(response.content) && response.content.length > 0) {
      const first = response.content[0];
      if (first.type === "text" && typeof first.text === "string") {
        try {
          return JSON.parse(first.text);
        } catch {
          return first.text;
        }
      }
    }
    return response;
  }

  close(): void {
    if (!this.proc) {
      return;
    }

    const procToClose = this.proc;
    this.proc = null;

    // Send shutdown notification
    try {
      const notification: JsonRpcNotification = {
        jsonrpc: "2.0",
        method: "shutdown",
      };
      const line = JSON.stringify(notification) + "\n";
      procToClose.stdin?.write(line);
    } catch (error) {
      // Ignore write errors during shutdown
    }

    // Clean up pending requests
    for (const [, { reject, timeout }] of this.pendingRequests) {
      clearTimeout(timeout);
      reject(new Error("Client closed"));
    }
    this.pendingRequests.clear();

    // Remove listeners
    if (procToClose.stdout) {
      procToClose.stdout.removeAllListeners();
    }
    if (procToClose.stderr) {
      procToClose.stderr.removeAllListeners();
    }
    procToClose.removeAllListeners();

    // Terminate process with SIGKILL fallback
    try {
      procToClose.stdin?.end();
      if (!procToClose.killed) {
        procToClose.kill("SIGTERM");

        // Schedule SIGKILL fallback after 1 second if process doesn't exit
        const killTimer = setTimeout(() => {
          // Check if process has actually exited (exitCode is non-null once exit event fires)
          if (procToClose.exitCode === null) {
            try {
              procToClose.kill("SIGKILL");
            } catch {
              // Process may have already exited
            }
          }
        }, 1000);

        // Unreference the timer so it doesn't keep the event loop alive
        killTimer.unref();
      }
    } catch (error) {
      // Ignore errors during shutdown
    }
  }

  /**
   * Handle a JSON-RPC message from the analyzer
   *
   * Matches responses to pending requests by ID and resolves/rejects accordingly.
   * Extracts error information from JSON-RPC error objects.
   *
   * @param message Parsed JSON-RPC message
   */
  private handleMessage(message: unknown): void {
    if (!message || typeof message !== "object") {
      return;
    }

    const msg = message as Record<string, unknown>;

    // Ignore notifications (no id field)
    if (!("id" in msg) || typeof msg.id !== "number") {
      return;
    }

    const msgId = msg.id as number;
    const pending = this.pendingRequests.get(msgId);

    if (!pending) {
      // Log diagnostic information for unmatched response IDs
      console.warn(
        `Received response with unmatched ID ${msgId} (type: ${typeof msgId}). ` +
        `Pending request IDs: [${Array.from(this.pendingRequests.keys()).join(", ")}]. ` +
        `This may indicate a type mismatch or stale response.`
      );
      return;
    }

    const { resolve, reject, timeout } = pending;
    clearTimeout(timeout);
    this.pendingRequests.delete(msgId);

    // Check for error response
    if ("error" in msg && msg.error !== null && typeof msg.error === "object") {
      const error = msg.error as Record<string, unknown>;
      const errMessage = (error.message as string) || "Unknown error";
      const code = (error.code as number) ?? -1;
      const data = error.data;

      const errorMessage = data ? `${errMessage}: ${JSON.stringify(data)}` : errMessage;
      reject(new Error(`[Error ${code}] ${errorMessage}`));
      return;
    }

    // Success response
    if ("result" in msg) {
      resolve(msg.result);
      return;
    }

    // Invalid response
    reject(new Error("Invalid JSON-RPC response: no result or error field"));
  }
}
