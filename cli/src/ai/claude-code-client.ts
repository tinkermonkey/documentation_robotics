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
import { getChatLogger } from '../utils/chat-logger.js';
import { isTelemetryEnabled, startSpan, endSpan, emitLog, SeverityNumber } from '../telemetry/index.js';

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
    const span = isTelemetryEnabled ? startSpan('claude-code.availability-check') : null;

    try {
      const result = spawnSync('which', ['claude'], {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      const available = result.status === 0;

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute('client.available', available);
        (span as any).setAttribute('client.name', 'Claude Code');
        (span as any).setStatus({ code: 0 });
      }

      return available;
    } catch (error) {
      if (isTelemetryEnabled && span) {
        (span as any).recordException(error as Error);
        (span as any).setAttribute('client.available', false);
        (span as any).setAttribute('client.name', 'Claude Code');
        (span as any).setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
      }
      return false;
    } finally {
      endSpan(span);
    }
  }

  /**
   * Send a message to Claude Code CLI and stream the response
   * @param message The user's message
   * @param options Chat options
   */
  async sendMessage(message: string, options?: ChatOptions): Promise<void> {
    const span = isTelemetryEnabled ? startSpan('claude-code.send-message', {
      'message.length': message.length,
      'client.name': 'Claude Code',
      'client.agent': options?.agent,
      'client.withDanger': options?.withDanger === true,
      'client.workingDirectory': options?.workingDirectory,
      'client.sessionId': options?.sessionId,
    }) : null;

    // Log the user message
    const logger = getChatLogger();
    if (logger) {
      await logger.logUserMessage(message, {
        client: 'Claude Code',
        agent: options?.agent,
      });
    }

    // Create session for this message
    // Note: Claude Code doesn't support cross-invocation sessions,
    // each invocation is a fresh conversation
    this.createSession();
    this.updateSessionTimestamp();

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute('client.sessionCreated', true);
      (span as any).setAttribute('client.internalSessionId', this.getCurrentSession()?.id ?? 'none');
    }

    return new Promise((resolve, reject) => {
        const proc = this.spawnClaudeProcess(message, options);

        let buffer = '';
        let assistantOutput = '';
        let eventCount = 0;
        let toolUseCount = 0;

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
            eventCount++;
            const result = this.handleClaudeEvent(event);
            if (result.output) {
              assistantOutput += result.output;
            }
            if (result.usedTool) {
              toolUseCount++;
            }
          } catch {
            // Non-JSON line, print as-is
            process.stdout.write(line + '\n');
            assistantOutput += line + '\n';
          }
        }
      });

      // Handle stderr (usually quiet unless there's an error)
      proc.stderr?.on('data', (data: Buffer) => {
        const errorText = data.toString();
        // Claude Code stderr is usually verbose logging
        // We log it but don't display unless it's an actual error
        if (errorText.includes('error')) {
          if (isTelemetryEnabled && span) {
            emitLog(SeverityNumber.ERROR, 'Claude Code stderr error', {
              'error.source': 'stderr',
              'error.text': errorText.substring(0, 500),
            });
          }
          if (logger) {
            void logger.logError(errorText, {
              source: 'stderr',
              client: 'Claude Code',
            });
          }
        }
      });

      // Handle errors
      proc.on('error', (error) => {
        if (isTelemetryEnabled && span) {
          emitLog(SeverityNumber.ERROR, 'Claude Code process error', {
            'error.message': error.message,
            'error.stack': error.stack,
          });
          (span as any).recordException(error);
        }
        if (logger) {
          void logger.logError(error.message, {
            source: 'process',
            client: 'Claude Code',
            stack: error.stack,
          });
        }
        endSpan(span);
        reject(error);
      });

      // Handle process exit
      proc.on('close', (exitCode) => {
        // Print any remaining buffer
        if (buffer.trim()) {
          try {
            const event: ClaudeEvent = JSON.parse(buffer);
            eventCount++;
            const result = this.handleClaudeEvent(event);
            if (result.output) {
              assistantOutput += result.output;
            }
            if (result.usedTool) {
              toolUseCount++;
            }
          } catch {
            process.stdout.write(buffer);
            assistantOutput += buffer;
          }
        }

        if (isTelemetryEnabled && span) {
          (span as any).setAttribute('client.eventCount', eventCount);
          (span as any).setAttribute('client.toolUseCount', toolUseCount);
          (span as any).setAttribute('client.outputLength', assistantOutput.length);
          (span as any).setAttribute('client.exitCode', exitCode || 0);
        }

        if (exitCode === 0) {
          // Log assistant message if we got output
          if (logger && assistantOutput.trim()) {
            void logger.logAssistantMessage(assistantOutput, {
              client: 'Claude Code',
            });
          }
          if (isTelemetryEnabled && span) {
            (span as any).setStatus({ code: 0 });
          }
          endSpan(span);
          resolve();
        } else {
          const errorMsg = `Claude process exited with code ${exitCode}`;
          if (isTelemetryEnabled && span) {
            emitLog(SeverityNumber.ERROR, 'Claude Code process exited with error', {
              'process.exitCode': exitCode,
            });
            (span as any).setStatus({ code: 2, message: errorMsg });
          }
          if (logger) {
            void logger.logError(errorMsg, {
              exitCode,
              client: 'Claude Code',
            });
          }
          endSpan(span);
          reject(new Error(errorMsg));
        }
      });
    });
  }

  /**
   * Handle a Claude Code event from the JSON stream
   * @param event The Claude event to handle
   * @returns Object with output text and tool use flag
   */
  private handleClaudeEvent(event: ClaudeEvent): { output: string; usedTool: boolean } {
    let output = '';
    let usedTool = false;

    if (event.type === 'assistant') {
      const content = event.message?.content || [];
      for (const block of content) {
        if (block.type === 'text') {
          const text = block.text || '';
          process.stdout.write(text);
          output += text;
        } else if (block.type === 'tool_use') {
          usedTool = true;
          const toolMsg = ansis.dim(`\n[Using tool: ${block.name}]\n`);
          process.stdout.write(toolMsg);
          output += toolMsg;
        }
      }
    }

    return { output, usedTool };
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
    const span = isTelemetryEnabled ? startSpan('claude-code.spawn-process') : null;

    try {
      const args = ['--print'];

      // Add dangerously-skip-permissions flag if withDanger is enabled
      if (options?.withDanger) {
        args.push('--dangerously-skip-permissions');
      }

      args.push('--verbose', '--output-format', 'stream-json');

      // Add agent if specified
      if (options?.agent) {
        args.unshift('--agent', options.agent);
      }

      const cwd = options?.workingDirectory || process.cwd();

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute('process.command', 'claude');
        (span as any).setAttribute('process.args', args.join(' '));
        (span as any).setAttribute('process.argCount', args.length);
        (span as any).setAttribute('process.hasAgent', !!options?.agent);
        (span as any).setAttribute('process.agent', options?.agent);
        (span as any).setAttribute('process.withDanger', options?.withDanger === true);
        (span as any).setAttribute('process.workingDirectory', cwd);
        (span as any).setAttribute('process.messageLength', message.length);
      }

      // Log the command that's being executed
      const logger = getChatLogger();
      if (logger) {
        void logger.logCommand('claude', args, {
          client: 'Claude Code',
          workingDirectory: cwd,
          agent: options?.agent,
          withDanger: options?.withDanger || false,
          messageLength: message.length,
          hasVerboseFlag: args.includes('--verbose'),
          hasOutputFormat: args.includes('--output-format'),
        });
      }

      const proc = spawn('claude', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Send message via stdin
      proc.stdin?.write(message);
      proc.stdin?.end();

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute('process.spawned', true);
        (span as any).setAttribute('process.pid', proc.pid);
        (span as any).setStatus({ code: 0 });
      }

      return proc;
    } catch (error) {
      if (isTelemetryEnabled && span) {
        (span as any).recordException(error as Error);
        (span as any).setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    } finally {
      endSpan(span);
    }
  }

  /**
   * Get the name of this client
   */
  getClientName(): string {
    return 'Claude Code';
  }
}
