/**
 * CodePrism Session Manager
 *
 * Manages the lifecycle of persistent CodePrism sessions:
 * - Start: Spawn CodePrism as background process, store metadata in `.scan-session`
 * - Status: Check if session is active, report indexing/ready status
 * - Query: Reconnect to running session and forward tool calls
 * - Stop: Graceful shutdown and cleanup
 *
 * Session file format (.scan-session):
 * ```json
 * {
 *   "pid": 12345,
 *   "workspace": "/path/to/workspace",
 *   "status": "ready|indexing",
 *   "indexed_files": 150,
 *   "started_at": "2026-01-01T00:00:00Z",
 *   "endpoint": "codeprism:--mcp"
 * }
 * ```
 *
 * Session invariants:
 * - Only one session per workspace
 * - Session file contains PID for liveness checking
 * - Process is detached (daemon) and survives CLI exit
 * - Session stays alive until explicitly stopped or process crashes
 */

import { writeFile, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";
import { spawn } from "node:child_process";
import { createMcpClient, type LoadedScanConfig, type MCPClient, type ToolResult } from "./mcp-client.js";
import { getErrorMessage, CLIError, ErrorCategory } from "../utils/errors.js";

/**
 * Session file schema - validated on read and write
 */
export const SessionFileSchema = z.object({
  pid: z.number().int().positive(),
  workspace: z.string(),
  status: z.enum(["ready", "indexing"]),
  indexed_files: z.number().int().nonnegative(),
  started_at: z.string(),
  endpoint: z.string(),
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
export async function loadSessionFile(workspace: string): Promise<SessionFile | null> {
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
          `Run: rm ${sessionPath}`,
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
export async function saveSessionFile(workspace: string, session: SessionFile): Promise<void> {
  const sessionPath = getSessionPath(workspace);

  try {
    const validated = SessionFileSchema.parse(session);
    await writeFile(sessionPath, JSON.stringify(validated, null, 2), "utf-8");
  } catch (error) {
    const message = error instanceof z.ZodError ? error.message : getErrorMessage(error);
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
 * Checks if session file exists and if process is alive.
 * Returns detailed state including status, PID, and uptime.
 *
 * @param workspace - Workspace root path
 * @returns Session state, or null if no session exists
 */
export async function getSessionState(workspace: string): Promise<SessionState | null> {
  const session = await loadSessionFile(workspace);
  if (!session) {
    return null;
  }

  const isAlive = isProcessAlive(session.pid);
  if (!isAlive) {
    return {
      isActive: false,
      status: "stopped",
      pid: session.pid,
    };
  }

  return {
    isActive: true,
    status: session.status,
    pid: session.pid,
    workspace: session.workspace,
    indexedFiles: session.indexed_files,
    startedAt: session.started_at,
    uptime: calculateUptime(session.started_at),
  };
}

/**
 * Start CodePrism session
 *
 * Spawns CodePrism as a detached background process, polls for indexing completion,
 * and writes session metadata to `.scan-session`.
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
    throw new CLIError(
      "Session already active",
      ErrorCategory.USER,
      [
        `PID ${existing.pid} is running in ${workspace}`,
        "Use 'dr scan session stop' to stop the current session",
        "Or use 'dr scan session query' to reuse the existing session",
      ]
    );
  }

  // Spawn CodePrism as detached background process
  let pid: number;
  try {
    const child = spawn(config.codeprism.command, config.codeprism.args, {
      stdio: "pipe",
      detached: true, // Allow process to outlive parent
      env: {
        ...process.env,
        CODEPRISM_PROFILE: "development",
        RUST_LOG: "warn",
      },
    });

    pid = child.pid!;

    // Unref so Node doesn't wait for the child to exit
    child.unref();

    // Close stdio pipes immediately to avoid hanging
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
  } catch (error) {
    throw new CLIError(
      `Failed to spawn CodePrism process`,
      ErrorCategory.SYSTEM,
      [
        getErrorMessage(error),
        `Command: ${config.codeprism.command} ${config.codeprism.args.join(" ")}`,
      ]
    );
  }

  // Poll for indexing completion
  const maxWait = options?.maxWaitMs ?? 60000; // 60 second default
  const pollInterval = options?.pollIntervalMs ?? 1000; // 1 second polling

  let sessionFile: SessionFile | null = null;
  const startTime = Date.now();

  // Create a temporary client to poll repository_stats
  let client: MCPClient | null = null;

  try {
    // Wait for process to be ready and respond to queries
    let lastError: string = "";
    while (Date.now() - startTime < maxWait) {
      try {
        // Try to create a client to the running process
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
        sessionFile = {
          pid,
          workspace,
          status: "ready",
          indexed_files: indexedFiles,
          started_at: new Date().toISOString(),
          endpoint: config.codeprism.command + ":" + config.codeprism.args.join(" "),
        };

        await saveSessionFile(workspace, sessionFile);
        return sessionFile;
      } catch (error) {
        lastError = getErrorMessage(error);

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
        "Try checking CodePrism logs or stopping the process manually",
      ]
    );
  } finally {
    // Clean up client connection if created
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors during cleanup
      }
    }
  }
}

/**
 * Stop CodePrism session
 *
 * Sends SIGTERM to the CodePrism process and removes the session file.
 * If process doesn't exit cleanly within 5 seconds, sends SIGKILL.
 *
 * @param workspace - Workspace root path
 * @throws CLIError if session cannot be stopped or doesn't exist
 */
export async function stopSession(workspace: string): Promise<void> {
  const session = await loadSessionFile(workspace);

  if (!session) {
    throw new CLIError(
      "No active session",
      ErrorCategory.USER,
      [
        `No session file found in ${workspace}`,
        "Use 'dr scan session start' to start a new session",
      ]
    );
  }

  const { pid } = session;

  // Check if process is actually alive
  if (!isProcessAlive(pid)) {
    // Process is already dead, just clean up the file
    await removeSessionFile(workspace);
    return;
  }

  // Send SIGTERM (graceful shutdown)
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    // Process might have already exited
    await removeSessionFile(workspace);
    return;
  }

  // Wait up to 5 seconds for graceful shutdown
  const checkInterval = 100; // ms
  const maxChecks = 50; // 5 seconds total
  let checks = 0;

  while (checks < maxChecks) {
    if (!isProcessAlive(pid)) {
      await removeSessionFile(workspace);
      return;
    }
    checks++;
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }

  // Process didn't exit gracefully, force kill
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already dead
  }

  // Remove session file regardless of kill success
  await removeSessionFile(workspace);
}

/**
 * Query running CodePrism session
 *
 * Reconnects to the running session and forwards a tool call.
 * Returns the tool result without re-indexing.
 *
 * @param workspace - Workspace root path
 * @param config - Scan configuration
 * @param toolName - CodePrism tool name (e.g., "repository_stats", "search_code")
 * @param toolParams - Tool parameters as JSON object
 * @returns Tool results from CodePrism
 * @throws CLIError if session doesn't exist or query fails
 */
export async function querySession(
  workspace: string,
  config: LoadedScanConfig,
  toolName: string,
  toolParams: Record<string, unknown>
): Promise<ToolResult[]> {
  const session = await loadSessionFile(workspace);

  if (!session) {
    throw new CLIError(
      "No active session",
      ErrorCategory.USER,
      [
        `No session file found in ${workspace}`,
        "Use 'dr scan session start' to start a new session",
        "Or use 'dr scan session query' with a workspace argument",
      ]
    );
  }

  // Check if process is alive
  if (!isProcessAlive(session.pid)) {
    throw new CLIError(
      "Session process is no longer alive",
      ErrorCategory.SYSTEM,
      [
        `PID ${session.pid} is not responding`,
        "The CodePrism process may have crashed",
        "Use 'dr scan session stop' to clean up and 'dr scan session start' to begin a new session",
      ]
    );
  }

  // Create client and forward query
  const client = await createMcpClient(config);
  try {
    const result = await client.callTool(toolName, toolParams);
    return result;
  } finally {
    await client.disconnect();
  }
}
