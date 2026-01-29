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

    // Create NEW internal session for this message invocation
    // The sessionId in options (if provided) is passed to Claude CLI subprocess
    // to maintain conversation continuity at the Claude CLI level, not internally
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
          } catch (error) {
            // Log JSON parse failure - this indicates a protocol mismatch or CLI bug
            if (isTelemetryEnabled && span) {
              emitLog(SeverityNumber.WARN, 'Failed to parse Claude event JSON', {
                'error.message': error instanceof Error ? error.message : String(error),
                'event.rawLine': line.substring(0, 200),
                'event.lineLength': line.length,
              });
            }
            if (logger) {
              void logger.logError(`Failed to parse Claude event: ${error instanceof Error ? error.message : String(error)}`, {
                source: 'json-parse',
                client: 'Claude Code',
                rawLine: line.substring(0, 200),
              });
            }

            // Non-JSON line, print as-is (expected for some CLI output)
            process.stdout.write(line + '\n');
            assistantOutput += line + '\n';
          }
        }
      });

      // Handle stderr - always log for debugging, with severity detection
      proc.stderr?.on('data', (data: Buffer) => {
        const stderrText = data.toString().trim();
        if (!stderrText) return; // Skip empty lines

        // Determine severity based on content patterns
        const isError = /\b(error|failed|exception|fatal|critical)\b/i.test(stderrText);
        const isWarning = /\b(warning|warn|deprecated)\b/i.test(stderrText);

        // Always log to telemetry and ChatLogger for debugging
        if (isTelemetryEnabled && span) {
          const severity = isError ? SeverityNumber.ERROR :
                           isWarning ? SeverityNumber.WARN :
                           SeverityNumber.DEBUG;
          emitLog(severity, 'Claude Code stderr output', {
            'stderr.source': 'claude-cli',
            'stderr.text': stderrText.substring(0, 500),
            'stderr.isError': isError,
            'stderr.isWarning': isWarning,
          });
        }

        if (logger) {
          if (isError) {
            void logger.logError(stderrText, {
              source: 'stderr',
              client: 'Claude Code',
            });
          } else {
            // Log non-errors as events for complete session history
            void logger.logEvent('stderr_output', {
              text: stderrText.substring(0, 500),
              isWarning,
              client: 'Claude Code',
            });
          }
        }

        // Display errors and warnings to user
        if (isError || isWarning) {
          const prefix = isError ? '[ERROR]' : '[WARNING]';
          process.stderr.write(`${ansis.yellow(prefix)} ${stderrText}\n`);
        }
      });

      // Handle errors
      proc.on('error', (error) => {
        const errorContext = {
          'error.message': error.message,
          'error.stack': error.stack,
          'error.code': (error as any).code, // ENOENT, EACCES, etc.
          'process.command': 'claude',
          'process.args': JSON.stringify(this.getProcessArgs(options)),
          'process.sessionId': options?.sessionId,
          'process.agent': options?.agent,
          'process.workingDirectory': options?.workingDirectory || process.cwd(),
          'message.length': message.length,
          'message.preview': message.substring(0, 100),
        };

        if (isTelemetryEnabled && span) {
          emitLog(SeverityNumber.ERROR, 'Claude Code process error', errorContext);
          (span as any).recordException(error);
        }
        if (logger) {
          void logger.logError(
            `Claude process failed to spawn or encountered error: ${error.message}`,
            {
              source: 'process',
              client: 'Claude Code',
              ...errorContext,
            }
          );
        }

        // Log to console for immediate visibility
        console.error('[ClaudeCodeClient] Process error:', error.message);
        console.error('[ClaudeCodeClient]   Command:', 'claude', this.getProcessArgs(options).join(' '));
        if ((error as any).code === 'ENOENT') {
          console.error('[ClaudeCodeClient]   Claude CLI not found - ensure it is installed and in PATH');
        } else if ((error as any).code === 'EACCES') {
          console.error('[ClaudeCodeClient]   Permission denied - check Claude CLI executable permissions');
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
          } catch (error) {
            // Log JSON parse failure for remaining buffer
            if (isTelemetryEnabled && span) {
              emitLog(SeverityNumber.WARN, 'Failed to parse remaining buffer as JSON', {
                'error.message': error instanceof Error ? error.message : String(error),
                'buffer.content': buffer.substring(0, 200),
                'buffer.length': buffer.length,
              });
            }
            if (logger) {
              void logger.logError(`Failed to parse remaining buffer: ${error instanceof Error ? error.message : String(error)}`, {
                source: 'json-parse-buffer',
                client: 'Claude Code',
                bufferContent: buffer.substring(0, 200),
              });
            }

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
   * Get the process arguments that would be used for spawning
   * @param options Chat options
   * @returns Array of command line arguments
   */
  private getProcessArgs(options?: ChatOptions): string[] {
    const args = ['--print'];

    // Add dangerously-skip-permissions flag if withDanger is enabled
    if (options?.withDanger) {
      args.push('--dangerously-skip-permissions');
    }

    args.push('--verbose', '--output-format', 'stream-json');

    // Add session ID if provided for conversation continuity
    if (options?.sessionId) {
      args.push('--session-id', options.sessionId);
    }

    // Add agent if specified
    if (options?.agent) {
      args.unshift('--agent', options.agent);
    }

    return args;
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
      const args = this.getProcessArgs(options);
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
          sessionId: options?.sessionId,
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
