/**
 * Claude Code CLI Client
 * 
 * Implements chat functionality using Claude Code CLI subprocess.
 * Uses structured JSON streaming output for reliable parsing.
 * 
 * Key features:
 * - Availability detection via `which claude`
 * - JSON event stream parsing
 * - Agent support (dr-architect)
 * - Tool use detection and display
 * - Session management per process invocation
 */

import { BaseChatClient, ChatOptions } from './base-chat-client.js';
import { spawnSync, spawn, ChildProcess } from 'child_process';
import ansis from 'ansis';

/**
 * Claude Code CLI event types
 */
interface ClaudeEvent {
  type: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
    }>;
  };
}

/**
 * Claude Code CLI Client
 */
export class ClaudeCodeClient extends BaseChatClient {
  /**
   * Check if Claude Code CLI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = spawnSync('which', ['claude'], {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Send a message to Claude Code CLI and stream the response
   * @param message The user's message
   * @param options Chat options
   */
  async sendMessage(message: string, options?: ChatOptions): Promise<void> {
    // Create session for this message
    // Note: Claude Code doesn't support cross-invocation sessions,
    // each invocation is a fresh conversation
    this.createSession();
    this.updateSessionTimestamp();

    return new Promise((resolve, reject) => {
      const proc = this.spawnClaudeProcess(message, options);

      let buffer = '';

      // Handle stdout - JSON event stream
      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        buffer += chunk;

        // Process complete lines (each line is a JSON event)
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event: ClaudeEvent = JSON.parse(line);
            this.handleClaudeEvent(event);
          } catch {
            // Non-JSON line, print as-is
            process.stdout.write(line + '\n');
          }
        }
      });

      // Handle stderr (usually quiet unless there's an error)
      proc.stderr?.on('data', (_data: Buffer) => {
        // Claude Code stderr is usually verbose logging
        // We intentionally suppress it for cleaner output
      });

      // Handle errors
      proc.on('error', (error) => {
        reject(error);
      });

      // Handle process exit
      proc.on('close', (exitCode) => {
        // Print any remaining buffer
        if (buffer.trim()) {
          try {
            const event: ClaudeEvent = JSON.parse(buffer);
            this.handleClaudeEvent(event);
          } catch {
            process.stdout.write(buffer);
          }
        }

        if (exitCode === 0) {
          resolve();
        } else {
          reject(new Error(`Claude process exited with code ${exitCode}`));
        }
      });
    });
  }

  /**
   * Handle a Claude Code event from the JSON stream
   * @param event The Claude event to handle
   */
  private handleClaudeEvent(event: ClaudeEvent): void {
    if (event.type === 'assistant') {
      const content = event.message?.content || [];
      for (const block of content) {
        if (block.type === 'text') {
          process.stdout.write(block.text || '');
        } else if (block.type === 'tool_use') {
          process.stdout.write(ansis.dim(`\n[Using tool: ${block.name}]\n`));
        }
      }
    }
  }

  /**
   * Spawn the Claude Code CLI process
   * @param message The message to send
   * @param options Chat options
   * @returns The spawned child process
   */
  private spawnClaudeProcess(
    message: string,
    options?: ChatOptions
  ): ChildProcess {
    const args = [
      '--print',
      '--verbose',
      '--output-format',
      'stream-json',
    ];

    // Add dangerously-skip-permissions flag if withDanger is enabled
    if (options?.withDanger) {
      args.splice(1, 0, '--dangerously-skip-permissions');
    }

    // Add agent if specified
    if (options?.agent) {
      args.unshift('--agent', options.agent);
    }

    const cwd = options?.workingDirectory || process.cwd();

    const proc = spawn('claude', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Send message via stdin
    proc.stdin?.write(message);
    proc.stdin?.end();

    return proc;
  }

  /**
   * Get the name of this client
   */
  getClientName(): string {
    return 'Claude Code';
  }
}
