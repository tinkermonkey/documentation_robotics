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
 * MCP client for communicating with analyzer backends via JSON-RPC 2.0 stdio
 */
export class StdioClient {
  private proc: ChildProcess | null = null;
  private requestId: number = 0;
  private pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timeout: NodeJS.Timeout }> = new Map();

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
   * Sends an initialize request and waits for the response.
   * Times out after 2 seconds if no response is received.
   *
   * @param clientInfo Client information object
   * @throws Error if initialize times out or fails
   */
  async initialize(clientInfo: Record<string, unknown>): Promise<unknown> {
    return this.callTool("initialize", clientInfo, { timeout: 2000 });
  }

  /**
   * Call a tool on the analyzer
   *
   * Sends a JSON-RPC request and waits for the response.
   * Defaults to 30-second timeout for graph queries.
   *
   * @param name Tool name (method)
   * @param params Tool parameters
   * @param options Optional configuration (timeout in milliseconds)
   * @returns Tool result
   * @throws Error if tool call fails or times out
   */
  async callTool(
    name: string,
    params?: unknown,
    options?: { timeout?: number }
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
        reject(new Error(`Tool call '${name}' timed out after ${timeout}ms`));
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
