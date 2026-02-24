import { ClaudeCodeClient } from "../coding-agents/claude-code-client.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Invoke Claude Code CLI in non-interactive print mode, relaying text and
 * tool-use events to stdout in real-time, and returning the complete response
 * text for parsing.
 *
 * Delegates entirely to ClaudeCodeClient.sendMessage(), which handles:
 * - Prompt delivery via stdin (handles long prompts)
 * - stream-json event parsing
 * - Real-time tool-use and text output to process.stdout
 * - Complete response capture for the caller to parse
 *
 * @param prompt - The prompt to send to Claude via stdin
 * @param target - Human-readable label used in error messages (e.g. "layer: api")
 * @param timeoutMs - Per-invocation timeout in milliseconds (default: 5 min)
 * @returns The complete response text, ready for parsing
 */
export async function invokeClaudeStreaming(
  prompt: string,
  target: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const client = new ClaudeCodeClient();

  const timeoutPromise = new Promise<string>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(`Claude invocation timed out after ${timeoutMs / 1000}s (${target})`)
        ),
      timeoutMs
    )
  );

  return Promise.race([
    client.sendMessage(prompt, { withDanger: true, outputStream: process.stderr }),
    timeoutPromise,
  ]);
}
