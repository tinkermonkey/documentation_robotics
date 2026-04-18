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
   * @param env Optional environment variables (merged with process.env)
   * @throws Error if spawn fails
   */
  spawn(binaryPath: string, env?: Record<string, string>): void {
    if (this.proc) {
      throw new Error("Process already spawned");
    }

    const envVars = { ...process.env, ...env };
    this.proc = spawn(binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: envVars,
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
            // Ignore invalid JSON in stdout
            console.error(`Failed to parse JSON-RPC message: ${line}`);
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
        if (!this.proc!.stdin!.write(line)) {
          // If write buffer is full, wait for drain
          this.proc!.stdin!.once("drain", () => {
            // Request already written
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
   * Cleans up all pending requests and event listeners.
   */
  close(): void {
    if (!this.proc) {
      return;
    }

    // Send shutdown notification
    try {
      const notification: JsonRpcNotification = {
        jsonrpc: "2.0",
        method: "shutdown",
      };
      const line = JSON.stringify(notification) + "\n";
      this.proc.stdin?.write(line);
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
    if (this.proc.stdout) {
      this.proc.stdout.removeAllListeners();
    }
    if (this.proc.stderr) {
      this.proc.stderr.removeAllListeners();
    }
    this.proc.removeAllListeners();

    // Terminate process
    try {
      this.proc.stdin?.end();
      if (!this.proc.killed) {
        this.proc.kill("SIGTERM");
      }
    } catch (error) {
      // Ignore errors during shutdown
    }

    this.proc = null;
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
      // Ignore responses for unknown requests
      return;
    }

    const { resolve, reject, timeout } = pending;
    clearTimeout(timeout);
    this.pendingRequests.delete(msgId);

    // Check for error response
    if ("error" in msg && msg.error !== null && typeof msg.error === "object") {
      const error = msg.error as Record<string, unknown>;
      const message = (error.message as string) || "Unknown error";
      const code = (error.code as number) ?? -1;
      const data = error.data;

      const errorMessage = data ? `${message}: ${JSON.stringify(data)}` : message;
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
