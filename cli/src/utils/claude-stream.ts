import { ClaudeCodeClient } from "../coding-agents/claude-code-client.js"

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
 * @returns The complete response text, ready for parsing
 */
export async function invokeClaudeStreaming(
  prompt: string,
): Promise<string> {
  const client = new ClaudeCodeClient()

  return await client.sendMessage(prompt, { withDanger: false })
}
