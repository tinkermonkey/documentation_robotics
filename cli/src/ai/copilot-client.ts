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
  private copilotCommand: 'gh' | 'copilot' | null = null;

  /**
   * Check if GitHub Copilot CLI is available
   * Checks for both `gh copilot` and standalone `copilot` command
   */
  async isAvailable(): Promise<boolean> {
    // Return cached result if already detected
    if (this.copilotCommand !== null) {
      return true;
    }

    // Check for gh CLI with copilot extension
    try {
      const ghResult = spawnSync('gh', ['copilot', '--version'], {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      if (ghResult.status === 0) {
        this.copilotCommand = 'gh';
        return true;
      }
    } catch {
      // gh not available or copilot extension not installed
    }

    // Check for standalone copilot command (npm package)
    try {
      const copilotResult = spawnSync('copilot', ['--version'], {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      if (copilotResult.status === 0) {
        this.copilotCommand = 'copilot';
        return true;
      }
    } catch {
      // standalone copilot not available
    }

    return false;
  }

  /**
   * Send a message to GitHub Copilot and stream the response
   * @param message The user's message
   * @param options Chat options
   */
  async sendMessage(message: string, options?: ChatOptions): Promise<void> {
    // Ensure we have determined which command to use
    if (!this.copilotCommand) {
      const available = await this.isAvailable();
      if (!available) {
        throw new Error('GitHub Copilot CLI is not available');
      }
    }

    // Create or continue session
    if (!this.currentSession) {
      this.createSession();
    } else {
      this.updateSessionTimestamp();
    }

    return new Promise((resolve, reject) => {
      const proc = this.spawnCopilotProcess(message, options);

      let buffer = '';
      this.parser.reset();

      // Handle stdout
      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        buffer += chunk;

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
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
        }
      });

      // Handle errors
      proc.on('error', (error) => {
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

        if (exitCode === 0) {
          resolve();
        } else {
          reject(new Error(`Copilot process exited with code ${exitCode}`));
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
    const args: string[] = [];
    const cwd = options?.workingDirectory || process.cwd();

    if (this.copilotCommand === 'gh') {
      // Use gh CLI with copilot extension
      args.push('copilot', 'explain');
      
      // Add allow-all-tools flag if withDanger is enabled
      if (options?.withDanger) {
        args.push('--allow-all-tools');
      }
      
      // Add session continuation if this is not the first message
      if (this.currentSession && options?.sessionId) {
        // Note: gh copilot doesn't have explicit session IDs,
        // so we rely on the conversation history in the terminal
        // This is a limitation of the gh CLI implementation
      }
    } else {
      // Use standalone copilot command
      args.push('explain');
      
      // Add allow-all-tools flag if withDanger is enabled
      if (options?.withDanger) {
        args.push('--allow-all-tools');
      }
    }

    // Add the message as an argument
    args.push(message);

    const command = this.copilotCommand === 'gh' ? 'gh' : 'copilot';

    return spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Get the name of this client
   */
  getClientName(): string {
    return 'GitHub Copilot';
  }
}
