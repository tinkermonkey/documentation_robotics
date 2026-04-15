/**
 * CodePrism Session Manager
 *
 * Manages the lifecycle of CodePrism sessions using an in-memory cache model:
 * - Start: Spawn CodePrism via MCP client, cache client in activeSessions map, write session metadata file
 * - Status: Check if process is alive (cache lookup for pid=-1, or PID liveness check for positive PIDs)
 * - Query: Reuse cached MCP client, forward tool call
 * - Stop: Disconnect cached MCP client (closes stdio transport, terminates CodePrism), remove session file
 *
 * Session file format (.scan-session):
 * ```json
 * {
 *   "pid": -1,
 *   "workspace": "/path/to/workspace",
 *   "status": "ready|indexing",
 *   "indexed_files": 150,
 *   "started_at": "2026-01-01T00:00:00Z",
 *   "endpoint": "codeprism:--mcp"
 * }
 * ```
 *
 * Session invariants:
 * - Only one session per workspace (file-based mutex)
 * - Session file existence + cache entry indicates active session
 * - PID field is -1 (marker for persistent session) when using cache-based model
 * - CodePrism process is spawned once and cached for reuse within the same CLI process
 * - Session is invalidated by disconnecting the client and removing the session file
 *
 * IMPORTANT LIMITATION: The in-memory cache only survives within a single CLI process.
 * Each separate CLI invocation (e.g., `dr scan session start`, then later `dr scan session query`)
 * runs as a new process with its own activeSessions map. For the persistent-process model to work
 * across multiple CLI invocations, a background daemon or TCP/socket transport is required.
 *
 * Process lifecycle:
 * - startSession: Creates MCP client (spawns CodePrism child process), stores client in cache
 * - querySession: Reuses cached client, verifies it's still connected (fails if not in cache)
 * - stopSession: Disconnects client (kills CodePrism process), cleans up cache
 * - getSessionState: Checks if process is alive via cache lookup (pid=-1) or PID liveness check
 */

import { writeFile, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";
import {
  createMcpClient,
  type LoadedScanConfig,
  type MCPClient,
  type ToolResult
} from "./mcp-client.js";
import { getErrorMessage, CLIError, ErrorCategory } from "../utils/errors.js";

/**
 * In-memory cache of active CodePrism MCP clients keyed by workspace path
 * Allows session queries to reuse the same process without spawning fresh each time
 */
const activeSessions: Map<string, MCPClient> = new Map();

/**
 * Session file schema - validated on read and write
 *
 * Note: PID can be -1 for persistent sessions (marker value indicating cache-based management)
 * or a positive integer for traditional PID-based lifecycle management.
 */
export const SessionFileSchema = z.object({
  pid: z.number().int(),
  workspace: z.string(),
  status: z.enum(["ready", "indexing"]),
  indexed_files: z.number().int().nonnegative(),
  started_at: z.string(),
  endpoint: z.string()
});

export type SessionFile = z.infer<typeof SessionFileSchema>;

/**
 * Session state representing the current status of a CodePrism instance
 */
export interface SessionState {
  isActive: boolean;
  status: "ready" | "indexing" | "stopped";
  pid?: number;
  workspace?: string;
  indexedFiles?: number;
  startedAt?: string;
  uptime?: string;
}

/**
 * Get the session file path for a workspace
 * Session files are stored in documentation-robotics/.scan-session
 *
 * @param workspace - Workspace root path
 * @returns Path to .scan-session file
 */
export function getSessionPath(workspace: string): string {
  return `${workspace}/documentation-robotics/.scan-session`;
}

/**
 * Check if a process with the given PID is alive
 *
 * @param pid - Process ID to check
 * @returns true if process is alive, false otherwise
 */
export function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without sending a signal
    // On Windows, this always returns true for processes owned by the same user
    // We'll use try-catch as a fallback mechanism
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Calculate uptime string from start timestamp
 *
 * @param startedAt - ISO timestamp of session start
 * @returns Human-readable uptime string
 */
export function calculateUptime(startedAt: string): string {
  const start = new Date(startedAt);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - start.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/**
 * Load session from file
 *
 * @param workspace - Workspace root path
 * @returns Session file contents, or null if no session exists
 * @throws CLIError if session file is corrupted
 */
export async function loadSessionFile(
  workspace: string
): Promise<SessionFile | null> {
  const sessionPath = getSessionPath(workspace);

  if (!existsSync(sessionPath)) {
    return null;
  }

  try {
    const content = await readFile(sessionPath, "utf-8");
    const parsed = JSON.parse(content);
    const validated = SessionFileSchema.safeParse(parsed);

    if (!validated.success) {
      throw new CLIError(
        `Corrupted session file: ${sessionPath}`,
        ErrorCategory.SYSTEM,
        [
          `Invalid session data: ${validated.error.message}`,
          "You may need to manually remove the session file and start a new session",
          `Run: rm ${sessionPath}`
        ]
      );
    }

    return validated.data;
  } catch (error) {
    if (error instanceof CLIError) throw error;

    throw new CLIError(
      `Failed to read session file: ${sessionPath}`,
      ErrorCategory.SYSTEM,
      [getErrorMessage(error)]
    );
  }
}

/**
 * Write session to file
 *
 * @param workspace - Workspace root path
 * @param session - Session data to write
 * @throws CLIError if write fails
 */
export async function saveSessionFile(
  workspace: string,
  session: SessionFile
): Promise<void> {
  const sessionPath = getSessionPath(workspace);

  try {
    const validated = SessionFileSchema.parse(session);
    await writeFile(sessionPath, JSON.stringify(validated, null, 2), "utf-8");
  } catch (error) {
    const message =
      error instanceof z.ZodError ? error.message : getErrorMessage(error);
    throw new CLIError(
      `Failed to save session file: ${sessionPath}`,
      ErrorCategory.SYSTEM,
      [message]
    );
  }
}

/**
 * Remove session file
 *
 * @param workspace - Workspace root path
 * @throws CLIError if remove fails
 */
export async function removeSessionFile(workspace: string): Promise<void> {
  const sessionPath = getSessionPath(workspace);

  if (!existsSync(sessionPath)) {
    return;
  }

  try {
    await unlink(sessionPath);
  } catch (error) {
    throw new CLIError(
      `Failed to remove session file: ${sessionPath}`,
      ErrorCategory.SYSTEM,
      [getErrorMessage(error)]
    );
  }
}

/**
 * Get current session state
 *
 * Checks if session file exists and verifies the process is still alive.
 * Returns detailed state including status, PID, and uptime.
 *
 * A session is considered active only if:
 * 1. Session file exists
 * 2. The process is still running (checked via cache or PID liveness)
 *
 * @param workspace - Workspace root path
 * @returns Session state with isActive=true if process is alive, isActive=false if process is dead, or null if no session file exists
 */
export async function getSessionState(
  workspace: string
): Promise<SessionState | null> {
  const session = await loadSessionFile(workspace);
  if (!session) {
    return null;
  }

  // Check if process is alive
  // For persistent sessions, PID is stored as -1 (marker value)
  // In that case, check if the client is in the cache
  let processAlive = false;

  if (session.pid === -1) {
    // Persistent session - check if client is in cache
    processAlive = activeSessions.has(workspace);
  } else {
    // Fall back to checking if a process with this PID exists
    // This handles edge cases where PID might be set to an actual value
    processAlive = isProcessAlive(session.pid);
  }

  return {
    isActive: processAlive,
    status: session.status,
    pid: session.pid,
    workspace: session.workspace,
    indexedFiles: session.indexed_files,
    startedAt: session.started_at,
    uptime: calculateUptime(session.started_at)
  };
}

/**
 * Start CodePrism session
 *
 * Spawns a persistent CodePrism process via MCP client and polls for indexing completion.
 * Caches the MCP client for reuse in subsequent queries.
 * Writes session metadata to `.scan-session`.
 *
 * The CodePrism process is started once and kept running across multiple queries,
 * amortizing the 3-second indexing cost over the lifetime of the session.
 *
 * @param workspace - Workspace root path
 * @param config - Scan configuration with CodePrism command and args
 * @param options - Session options
 * @throws CLIError if session cannot be started
 */
export async function startSession(
  workspace: string,
  config: LoadedScanConfig,
  options?: { maxWaitMs?: number; pollIntervalMs?: number }
): Promise<SessionFile> {
  // Check if session already exists
  const existing = await getSessionState(workspace);
  if (existing?.isActive) {
    throw new CLIError("Session already active", ErrorCategory.USER, [
      `PID ${existing.pid} is running in ${workspace}`,
      "Use 'dr scan session stop' to stop the current session",
      "Or use 'dr scan session query' to reuse the existing session"
    ]);
  }

  // Poll for indexing completion
  const maxWait = options?.maxWaitMs ?? 60000; // 60 second default
  const pollInterval = options?.pollIntervalMs ?? 1000; // 1 second polling

  let sessionFile: SessionFile | null = null;
  const startTime = Date.now();
  const startedAt = new Date().toISOString(); // Capture start time immediately

  // Create a persistent client for the session
  let client: MCPClient | null = null;

  try {
    // Wait for process to be ready and respond to queries
    let lastError: string = "";
    while (Date.now() - startTime < maxWait) {
      try {
        // Try to create a client to the running process (done only once)
        if (!client) {
          client = await createMcpClient(config);
        }

        // Poll repository_stats to check indexing status
        const results = await client.callTool("repository_stats", {});

        // Extract indexed files count from response
        let indexedFiles = 0;
        for (const result of results) {
          if (result.type === "text") {
            // Parse JSON from text result
            try {
              const data = JSON.parse(result.text);
              if (typeof data.indexed_files === "number") {
                indexedFiles = data.indexed_files;
              } else if (typeof data.files_indexed === "number") {
                indexedFiles = data.files_indexed;
              }
            } catch {
              // Continue if parsing fails
            }
          }
        }

        // Create session file
        // Store the CodePrism client in the cache so queries can reuse it
        activeSessions.set(workspace, client);

        // For the session file PID: We use a placeholder marker since the actual
        // CodePrism process PID is not easily accessible from the MCP SDK.
        // The PID field is kept for compatibility but the actual liveness check
        // is done via the cache lookup. We use -1 as a marker for "persistent process".
        sessionFile = {
          pid: -1, // Marker: persistent CodePrism process, managed by cache
          workspace,
          status: "ready",
          indexed_files: indexedFiles,
          started_at: startedAt,
          endpoint:
            config.codeprism.command + ":" + config.codeprism.args.join(" ")
        };

        await saveSessionFile(workspace, sessionFile);
        return sessionFile;
      } catch (error) {
        lastError = getErrorMessage(error);

        // Check if this is an unrecoverable error (e.g., binary not found)
        // If so, fail immediately rather than retrying
        if (
          lastError.includes("CodePrism binary not found") ||
          lastError.includes("not executable") ||
          lastError.includes("Failed to access CodePrism binary")
        ) {
          // Mark for cleanup by outer error handler
          throw error;
        }

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    // Timeout reached without successful response
    throw new CLIError(
      `CodePrism indexing timeout after ${Math.floor(maxWait / 1000)}s`,
      ErrorCategory.SYSTEM,
      [
        "The CodePrism process may have crashed or is taking too long to index",
        `Last error: ${lastError}`,
        "Try checking CodePrism logs or stopping the process manually"
      ]
    );
  } catch (error) {
    // Single cleanup site for all error paths
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors during error cleanup
      }
      activeSessions.delete(workspace);
    }
    throw error;
  }
}

/**
 * Stop CodePrism session
 *
 * Gracefully shuts down the running CodePrism process by disconnecting the MCP client.
 * Removes the session file to invalidate the session.
 *
 * The MCP client's disconnect() method closes the stdio transport, which
 * automatically terminates the child CodePrism process.
 *
 * @param workspace - Workspace root path
 * @throws CLIError if session cannot be stopped or doesn't exist
 */
export async function stopSession(workspace: string): Promise<void> {
  const session = await loadSessionFile(workspace);

  if (!session) {
    throw new CLIError("No active session", ErrorCategory.USER, [
      `No session file found in ${workspace}`,
      "Use 'dr scan session start' to start a new session"
    ]);
  }

  // Get the cached client and disconnect it
  // This closes the stdio transport and terminates the CodePrism process
  const client = activeSessions.get(workspace);
  if (client) {
    try {
      await client.disconnect();
    } catch (error) {
      // Log but don't fail - we still want to clean up the session file
      const errorMsg = getErrorMessage(error);
      console.debug(
        `Warning: failed to disconnect CodePrism client: ${errorMsg}`
      );
    }
    activeSessions.delete(workspace);
  }

  // Remove session file regardless of client disconnect success
  await removeSessionFile(workspace);
}

/**
 * Query running CodePrism session
 *
 * Reuses the running CodePrism process to forward a tool call.
 * Returns the tool result without re-indexing or spawning a new process.
 *
 * The persistent CodePrism process is stored in the session cache and
 * reused across multiple queries, allowing the indexing cost to be amortized.
 *
 * @param workspace - Workspace root path
 * @param toolName - CodePrism tool name (e.g., "repository_stats", "search_code")
 * @param toolParams - Tool parameters as JSON object
 * @returns Tool results from CodePrism
 * @throws CLIError if session doesn't exist or query fails
 */
export async function querySession(
  workspace: string,
  toolName: string,
  toolParams: Record<string, unknown>
): Promise<ToolResult[]> {
  const session = await loadSessionFile(workspace);

  if (!session) {
    throw new CLIError("No active session", ErrorCategory.USER, [
      `No session file found in ${workspace}`,
      "Use 'dr scan session start' to start a new session"
    ]);
  }

  // Get the cached client from the persistent session
  const client = activeSessions.get(workspace);

  if (!client) {
    throw new CLIError(
      "Session process not found in cache",
      ErrorCategory.SYSTEM,
      [
        `The CodePrism process for workspace ${workspace} is no longer cached`,
        "This may indicate the process crashed or the session was invalidated",
        "Use 'dr scan session stop' and then 'dr scan session start' to restart"
      ]
    );
  }

  // Forward the query to the running process
  // The client will detect if the connection has been lost and throw an error
  try {
    const result = await client.callTool(toolName, toolParams);
    return result;
  } catch (error) {
    const errorMsg = getErrorMessage(error);

    // Check if this is a connection/transport error by looking for common indicators
    // This is still string-based matching but is more explicit about what we're checking
    const isConnectionError =
      errorMsg.toLowerCase().includes("connection") ||
      errorMsg.toLowerCase().includes("disconnected") ||
      errorMsg.toLowerCase().includes("transport") ||
      errorMsg.toLowerCase().includes("pipe") ||
      errorMsg.toLowerCase().includes("stdin") ||
      errorMsg.toLowerCase().includes("closed");

    if (isConnectionError) {
      activeSessions.delete(workspace);
      throw new CLIError("CodePrism connection lost", ErrorCategory.SYSTEM, [
        `The CodePrism process in ${workspace} disconnected unexpectedly`,
        "The session has been invalidated",
        "Use 'dr scan session stop' and then 'dr scan session start' to restart",
        `Details: ${errorMsg}`
      ]);
    }
    throw error;
  }
}
