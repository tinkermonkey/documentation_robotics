/**
 * Claude Code CLI Agent Implementation
 *
 * Integrates Claude Code CLI (https://claude.ai) for AI-powered
 * architecture model exploration. Supports the dr-architect agent
 * with streaming JSON output parsing.
 */

import { spawnSync, spawn } from "child_process";
import {
  CodingAgent,
  AgentProcess,
  ChatEvent,
  SpawnAgentOptions,
  AgentProcessResult,
} from "./types.js";

/**
 * Claude Code CLI agent implementation
 *
 * Uses `claude` command with:
 * - dr-architect agent for DR-specific knowledge
 * - --output-format stream-json for structured events
 * - stdin for message input
 * - stdout for JSON event stream
 */
export class ClaudeCodeAgent implements CodingAgent {
  readonly name = "Claude Code";
  readonly command = "claude";

  /**
   * Check if Claude Code CLI is available
   * Uses 'which' on Unix-like systems or 'where' on Windows
   */
  async isAvailable(): Promise<boolean> {
    try {
      const isWindows = process.platform === "win32";
      const checkCommand = isWindows ? "where" : "which";

      const result = spawnSync(checkCommand, [this.command], {
        stdio: "pipe",
        encoding: "utf-8",
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Spawn Claude Code CLI process
   *
   * Creates subprocess with dr-architect agent, sends initial message via stdin,
   * and monitors stdout for JSON events.
   */
  spawn(options: SpawnAgentOptions): AgentProcess {
    const { cwd, message, agentName = "dr-architect", additionalArgs = [] } = options;

    // Generate conversation ID
    const conversationId = `claude-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Build command arguments
    const args = [
      "--agent",
      agentName,
      "--print",
      "--dangerously-skip-permissions",
      "--verbose",
      "--output-format",
      "stream-json",
      ...additionalArgs,
    ];

    // Spawn process
    const proc = spawn(this.command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Send initial message via stdin
    proc.stdin.write(message);
    proc.stdin.end();

    // Set up completion promise
    const completion = this.monitorProcess(proc, conversationId);

    return {
      process: proc,
      conversationId,
      completion,
    };
  }

  /**
   * Parse Claude Code JSON output into chat events
   *
   * Claude Code outputs line-delimited JSON events:
   * - {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
   * - {"type":"assistant","message":{"content":[{"type":"tool_use","name":"..."}]}}
   *
   * Non-JSON lines are treated as plain text output.
   */
  parseOutput(chunk: string): ChatEvent[] {
    const events: ChatEvent[] = [];
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line);

        if (event.type === "assistant") {
          const content = event.message?.content || [];
          for (const block of content) {
            if (block.type === "text") {
              events.push({
                type: "text",
                content: block.text,
              });
            } else if (block.type === "tool_use") {
              events.push({
                type: "tool_use",
                toolName: block.name,
                toolInput: block.input,
              });
            }
          }
        } else if (event.type === "result") {
          events.push({
            type: "tool_result",
            toolResult: event.result,
          });
        } else if (event.type === "error") {
          events.push({
            type: "error",
            error: event.message || "Unknown error",
          });
        }
      } catch {
        // Non-JSON line - treat as plain text
        events.push({
          type: "text",
          content: line,
        });
      }
    }

    return events;
  }

  /**
   * Monitor process execution and accumulate results
   *
   * Collects all output, parses events, and resolves when process completes.
   */
  private monitorProcess(
    proc: ReturnType<typeof spawn>,
    _conversationId: string
  ): Promise<AgentProcessResult> {
    return new Promise((resolve) => {
      let buffer = "";
      const allEvents: ChatEvent[] = [];
      let fullResponse = "";
      let errorMessage: string | undefined;

      // Collect stdout
      proc.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        buffer += chunk;

        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        const lineChunk = lines.join("\n");
        if (lineChunk) {
          const events = this.parseOutput(lineChunk);
          allEvents.push(...events);

          // Accumulate text content
          for (const event of events) {
            if (event.type === "text" && event.content) {
              fullResponse += event.content;
            }
          }
        }
      });

      // Collect stderr for errors
      proc.stderr?.on("data", (data: Buffer) => {
        const error = data.toString();
        if (error.trim()) {
          errorMessage = error;
        }
      });

      // Handle process completion
      proc.on("close", (exitCode) => {
        // Process any remaining buffer
        if (buffer.trim()) {
          const events = this.parseOutput(buffer);
          allEvents.push(...events);
          for (const event of events) {
            if (event.type === "text" && event.content) {
              fullResponse += event.content;
            }
          }
        }

        // Add completion event
        allEvents.push({ type: "complete" });

        resolve({
          exitCode: exitCode || 0,
          fullResponse,
          events: allEvents,
          error: errorMessage,
        });
      });

      // Handle process errors
      proc.on("error", (error) => {
        allEvents.push({
          type: "error",
          error: error.message,
        });

        resolve({
          exitCode: 1,
          fullResponse,
          events: allEvents,
          error: error.message,
        });
      });
    });
  }
}
