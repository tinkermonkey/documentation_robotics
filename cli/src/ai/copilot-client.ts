/**
 * GitHub Copilot CLI Client
 *
 * Implements chat functionality using GitHub Copilot CLI subprocess.
 * Supports both `gh copilot` (GitHub CLI extension) and `@github/copilot` (npm package).
 *
 * Key features:
 * - Availability detection for both CLI variants
 * - Plain text/markdown output parsing (heuristic)
 * - Session management using command-line flags
 * - Code block detection
 * - System message detection
 */

import { BaseChatClient, ChatOptions } from './base-chat-client.js';
import { spawnSync, spawn, ChildProcess } from 'child_process';
import ansis from 'ansis';
import { getChatLogger } from '../utils/chat-logger.js';
import { isTelemetryEnabled, startSpan, endSpan, emitLog, SeverityNumber } from '../telemetry/index.js';

/**
 * Output parser for GitHub Copilot plain text responses
 * Uses heuristics to detect code blocks, system messages, and tool invocations
 */
class CopilotOutputParser {
  private inCodeBlock = false;
  private codeBlockLanguage = '';

  /**
   * Parse a line of output from Copilot
   * @param line The line to parse
   * @returns Formatted output string or null if line should be skipped
   */
  parseLine(line: string): string | null {
    // Detect code block start/end (markdown fences)
    const codeBlockMatch = line.match(/^```(\w*)$/);
    if (codeBlockMatch) {
      this.inCodeBlock = !this.inCodeBlock;
      if (this.inCodeBlock) {
        this.codeBlockLanguage = codeBlockMatch[1] || '';
        return ansis.dim(`\n[Code block: ${this.codeBlockLanguage || 'text'}]\n`);
      } else {
        this.codeBlockLanguage = '';
        return ansis.dim('\n[End code block]\n');
      }
    }

    // Detect system messages (lines starting with special markers)
    if (line.match(/^(Note:|Warning:|Error:|Info:)/i)) {
      return ansis.yellow(line);
    }

    // Detect potential tool invocation patterns
    if (line.match(/^(Running|Executing|Searching|Analyzing):/i)) {
      return ansis.dim(line);
    }

    // Return line as-is
    return line;
  }

  /**
   * Reset parser state
   */
  reset(): void {
    this.inCodeBlock = false;
    this.codeBlockLanguage = '';
  }
}

/**
 * GitHub Copilot CLI Client
 */
export class CopilotClient extends BaseChatClient {
  private parser = new CopilotOutputParser();
  private copilotCommand: 'copilot' | null = null;
  private isFirstMessage = true;

  /**
   * Check if GitHub Copilot CLI is available
   * Only supports standalone `copilot` npm package (@github/copilot)
   */
  async isAvailable(): Promise<boolean> {
    const span = isTelemetryEnabled ? startSpan('copilot.availability-check') : null;

    try {
      // Return cached result if already detected
      if (this.copilotCommand !== null) {
        if (isTelemetryEnabled && span) {
          (span as any).setAttribute('client.available', true);
          (span as any).setAttribute('client.name', 'GitHub Copilot');
          (span as any).setAttribute('client.cached', true);
          (span as any).setAttribute('client.variant', this.copilotCommand);
          (span as any).setStatus({ code: 0 });
        }
        return true;
      }

      // Check for standalone copilot command (npm package)
      try {
        const copilotResult = spawnSync('copilot', ['--version'], {
          stdio: 'pipe',
          encoding: 'utf-8',
        });
        if (copilotResult.status === 0) {
          this.copilotCommand = 'copilot';
          if (isTelemetryEnabled && span) {
            (span as any).setAttribute('client.available', true);
            (span as any).setAttribute('client.name', 'GitHub Copilot');
            (span as any).setAttribute('client.cached', false);
            (span as any).setAttribute('client.variant', 'copilot');
            (span as any).setStatus({ code: 0 });
          }
          return true;
        }
      } catch {
        // standalone copilot not available
      }

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute('client.available', false);
        (span as any).setAttribute('client.name', 'GitHub Copilot');
        (span as any).setStatus({ code: 0 });
      }

      return false;
    } catch (error) {
      if (isTelemetryEnabled && span) {
        (span as any).recordException(error as Error);
        (span as any).setAttribute('client.available', false);
        (span as any).setAttribute('client.name', 'GitHub Copilot');
        (span as any).setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
      }
      return false;
    } finally {
      endSpan(span);
    }
  }

  /**
   * Send a message to GitHub Copilot and stream the response
   * @param message The user's message
   * @param options Chat options
   */
  async sendMessage(message: string, options?: ChatOptions): Promise<void> {
    const span = isTelemetryEnabled ? startSpan('copilot.send-message', {
      'message.length': message.length,
      'message.content': message.substring(0, 500), // First 500 chars for context
      'client.name': 'GitHub Copilot',
      'client.agent': options?.agent,
      'client.withDanger': options?.withDanger === true,
      'options.workingDirectory': options?.workingDirectory,
      'options.sessionId': options?.sessionId,
      'client.workingDirectory': options?.workingDirectory,
      'client.sessionId': options?.sessionId,
      'client.isFirstMessage': this.isFirstMessage,
    }) : null;

    // Ensure we have determined which command to use
    if (!this.copilotCommand) {
      const available = await this.isAvailable();
      if (!available) {
        throw new Error('GitHub Copilot CLI is not available');
      }
    }

    // Log the user message
    const logger = getChatLogger();
    if (logger) {
      await logger.logUserMessage(message, {
        client: 'GitHub Copilot',
        agent: options?.agent,
      });
    }

    // Create or continue session
    const hadExistingSession = !!this.currentSession;
    if (!this.currentSession) {
      this.createSession();
    } else {
      this.updateSessionTimestamp();
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute('client.hadExistingSession', hadExistingSession);
      (span as any).setAttribute('client.internalSessionId', this.getCurrentSession()?.id ?? 'none');
      (span as any).setAttribute('client.variant', this.copilotCommand);
    }

    return new Promise((resolve, reject) => {
        const proc = this.spawnCopilotProcess(message, options);

        let buffer = '';
        let assistantOutput = '';
        let lineCount = 0;
        this.parser.reset();

      // Handle stdout
      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        buffer += chunk;
        assistantOutput += chunk;

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          lineCount++;
          if (!line.trim()) {
            process.stdout.write('\n');
            continue;
          }

          const parsed = this.parser.parseLine(line);
          if (parsed !== null) {
            process.stdout.write(parsed + '\n');
          }
        }
      });

      // Handle stderr (usually authentication prompts or errors)
      proc.stderr?.on('data', (data: Buffer) => {
        const errorText = data.toString();
        // Only show errors that are relevant to the user
        if (
          errorText.includes('error') ||
          errorText.includes('Error') ||
          errorText.includes('not authenticated')
        ) {
          process.stderr.write(ansis.red(errorText));

          if (isTelemetryEnabled && span) {
            emitLog(SeverityNumber.ERROR, 'Copilot stderr error', {
              'error.source': 'stderr',
              'error.text': errorText.substring(0, 500),
              'error.isAuthError': errorText.includes('not authenticated'),
            });
          }

          // Log error
          if (logger) {
            void logger.logError(errorText, {
              source: 'stderr',
              client: 'GitHub Copilot',
            });
          }
        }
      });

      // Handle errors
      proc.on('error', (error) => {
        if (isTelemetryEnabled && span) {
          emitLog(SeverityNumber.ERROR, 'Copilot process error', {
            'error.message': error.message,
            'error.stack': error.stack,
            'error.code': (error as any).code, // ENOENT, EACCES, etc.
            'process.command': this.copilotCommand === 'copilot' ? 'copilot' : 'gh copilot',
            'message.length': message.length,
            'message.preview': message.substring(0, 200),
          });
          (span as any).recordException(error);
          (span as any).setStatus({ code: 2, message: error.message });
        }
        if (logger) {
          void logger.logError(error.message, {
            source: 'process',
            client: 'GitHub Copilot',
            stack: error.stack,
            errorCode: (error as any).code,
          });
        }
        endSpan(span);
        reject(error);
      });

      // Handle process exit
      proc.on('close', (exitCode) => {
        // Print any remaining buffer
        if (buffer.trim()) {
          const parsed = this.parser.parseLine(buffer);
          if (parsed !== null) {
            process.stdout.write(parsed);
          }
        }

        if (isTelemetryEnabled && span) {
          (span as any).setAttribute('client.lineCount', lineCount);
          (span as any).setAttribute('client.outputLength', assistantOutput.length);
          (span as any).setAttribute('client.exitCode', exitCode || 0);
          (span as any).setAttribute('response.content', assistantOutput.substring(0, 1000)); // First 1000 chars
          (span as any).setAttribute('response.preview', assistantOutput.substring(0, 200)); // Short preview
        }

        if (exitCode === 0) {
          // Log assistant message if we got output
          if (logger && assistantOutput.trim()) {
            void logger.logAssistantMessage(assistantOutput, {
              client: 'GitHub Copilot',
            });
          }
          if (isTelemetryEnabled && span) {
            (span as any).setStatus({ code: 0 });
          }
          endSpan(span);
          resolve();
        } else {
          const errorMsg = `Copilot process exited with code ${exitCode}`;
          if (isTelemetryEnabled && span) {
            emitLog(SeverityNumber.ERROR, 'Copilot process exited with error', {
              'process.exitCode': exitCode,
            });
            (span as any).setStatus({ code: 2, message: errorMsg });
          }
          if (logger) {
            void logger.logError(errorMsg, {
              exitCode,
              client: 'GitHub Copilot',
            });
          }
          endSpan(span);
          reject(new Error(errorMsg));
        }
      });
    });
  }

  /**
   * Spawn the GitHub Copilot CLI process
   * @param message The message to send
   * @param options Chat options
   * @returns The spawned child process
   */
  private spawnCopilotProcess(
    message: string,
    options?: ChatOptions
  ): ChildProcess {
    const span = isTelemetryEnabled ? startSpan('copilot.spawn-process') : null;

    try {
      const args: string[] = [];
      const cwd = options?.workingDirectory || process.cwd();

      const isFirst = this.isFirstMessage;

      // For first message: copilot --prompt "message" --agent "dr-architect" --allow-all-tools
      // For subsequent messages: copilot --continue --prompt "message" --allow-all-tools
      if (isFirst) {
        args.push('--prompt', message);
        this.isFirstMessage = false;
      } else {
        args.push('--continue', '--prompt', message);
      }

      // Add agent if specified (only on first message, agent persists in session)
      if (isFirst && options?.agent) {
        args.push('--agent', options.agent);
      }

      // Add allow-all-tools flag if withDanger is enabled (required for non-interactive)
      // Note: This flag may not be available in all copilot versions
      if (options?.withDanger) {
        try {
          // Check if flag is supported by testing with --help
          const helpResult = spawnSync(this.copilotCommand === 'copilot' ? 'copilot' : 'gh',
            this.copilotCommand === 'copilot' ? ['--help'] : ['copilot', '--help'],
            { stdio: 'pipe', encoding: 'utf-8', timeout: 1000 });
          if (helpResult.stdout?.includes('--allow-all-tools') || helpResult.stdout?.includes('allow-all-tools')) {
            args.push('--allow-all-tools');
            if (isTelemetryEnabled && span) {
              (span as any).setAttribute('process.allowAllToolsSupported', true);
            }
          } else {
            if (isTelemetryEnabled && span) {
              (span as any).setAttribute('process.allowAllToolsSupported', false);
              emitLog(SeverityNumber.WARN, 'GitHub Copilot --allow-all-tools flag not available', {
                'copilot.variant': this.copilotCommand,
                'withDanger': true,
              });
            }
            console.warn(ansis.yellow('Warning: --allow-all-tools flag not supported by your copilot version'));
          }
        } catch (error) {
          // If check fails, try adding the flag anyway
          args.push('--allow-all-tools');
          if (isTelemetryEnabled && span) {
            (span as any).setAttribute('process.allowAllToolsCheckFailed', true);
          }
        }
      }

      const command = 'copilot';

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute('process.command', command);
        (span as any).setAttribute('process.args', args.join(' '));
        (span as any).setAttribute('process.argCount', args.length);
        (span as any).setAttribute('process.isFirstMessage', isFirst);
        (span as any).setAttribute('process.hasContinue', args.includes('--continue'));
        (span as any).setAttribute('process.hasAgent', !!options?.agent);
        (span as any).setAttribute('process.agent', options?.agent);
        (span as any).setAttribute('process.withDanger', options?.withDanger === true);
        (span as any).setAttribute('process.workingDirectory', cwd);
        (span as any).setAttribute('process.messageLength', message.length);
        (span as any).setAttribute('process.variant', this.copilotCommand);
      }

      // Log the command that's being executed
      const logger = getChatLogger();
      if (logger) {
        void logger.logCommand(command, args, {
          client: 'GitHub Copilot',
          workingDirectory: cwd,
          withDanger: options?.withDanger || false,
          copilotVariant: this.copilotCommand,
          messageLength: message.length,
          hasAgent: !!options?.agent,
          isFirstMessage: isFirst,
        });
      }

      const proc = spawn(command, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

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
    return 'GitHub Copilot';
  }
}
