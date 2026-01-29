/**
 * Chat Logger Utility
 *
 * Provides universal logging for all chat messages and commands.
 * Stores logs in .dr/chat/sessions/ with one file per session using session ID in filename.
 *
 * Log format:
 * - Session file: .dr/chat/sessions/{timestamp}_{sessionId}.log
 * - Timestamp format: ISO 8601 with colons replaced by underscores for filesystem compatibility
 * - Each entry contains: timestamp, type (message/command/error), role, content
 */

import { mkdir, writeFile, appendFile, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Chat log entry types
 */
export type ChatLogEntryType = 'message' | 'command' | 'error' | 'event';

/**
 * A single chat log entry
 */
export interface ChatLogEntry {
  timestamp: string;
  type: ChatLogEntryType;
  role?: 'user' | 'assistant' | 'system' | 'cli';
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Chat Logger class
 *
 * Manages logging of chat sessions and messages
 */
export class ChatLogger {
  private sessionId: string;
  private sessionStartTime: string;
  private sessionLogPath: string;
  private logDir: string;
  private projectRoot?: string;

  /**
   * Creates a new ChatLogger instance
   * @param projectRoot Optional project root for relative path resolution
   */
  constructor(projectRoot?: string) {
    this.sessionId = randomUUID();
    this.sessionStartTime = this.getTimestamp();
    this.projectRoot = projectRoot;
    this.logDir = this.getLogDirectory();
    // Timestamp first for natural sorting, replace colons with underscores for filesystem compatibility
    const filenameSafeTimestamp = this.sessionStartTime.replace(/:/g, '_');
    this.sessionLogPath = join(this.logDir, `${filenameSafeTimestamp}_${this.sessionId}.log`);
  }

  /**
   * Get the log directory path
   * Prefers .dr/chat/sessions/ in project root, falls back to ~/.dr/chat/sessions/
   */
  getLogDirectory(): string {
    if (this.projectRoot && existsSync(this.projectRoot)) {
      const projectLogDir = join(this.projectRoot, '.dr', 'chat', 'sessions');
      return projectLogDir;
    }

    // Fall back to home directory
    return join(homedir(), '.dr', 'chat', 'sessions');
  }

  /**
   * Get current ISO timestamp with milliseconds
   */
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get session log file path
   */
  getSessionLogPath(): string {
    return this.sessionLogPath;
  }

  /**
   * Ensure log directory exists
   */
  async ensureLogDirectory(): Promise<void> {
    try {
      await mkdir(this.logDir, { recursive: true });
    } catch (error) {
      if (error instanceof Error && !error.message.includes('EEXIST')) {
        throw error;
      }
    }
  }

  /**
   * Format a log entry as JSON
   */
  private formatEntry(entry: ChatLogEntry): string {
    return JSON.stringify(entry) + '\n';
  }

  /**
   * Log a user message
   * @param message The user message content
   * @param metadata Optional metadata
   */
  async logUserMessage(message: string, metadata?: Record<string, unknown>): Promise<void> {
    const entry: ChatLogEntry = {
      timestamp: this.getTimestamp(),
      type: 'message',
      role: 'user',
      content: message,
      metadata,
    };

    await this.writeEntry(entry);
  }

  /**
   * Log an assistant/AI response
   * @param content The response content
   * @param metadata Optional metadata
   */
  async logAssistantMessage(content: string, metadata?: Record<string, unknown>): Promise<void> {
    const entry: ChatLogEntry = {
      timestamp: this.getTimestamp(),
      type: 'message',
      role: 'assistant',
      content,
      metadata,
    };

    await this.writeEntry(entry);
  }

  /**
   * Log a command being sent to the CLI
   * @param command Command name (e.g., "gh copilot explain")
   * @param args Command arguments
   * @param metadata Optional metadata
   */
  async logCommand(
    command: string,
    args: string[] = [],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const content = [command, ...args].join(' ');

    const entry: ChatLogEntry = {
      timestamp: this.getTimestamp(),
      type: 'command',
      role: 'cli',
      content,
      metadata: {
        ...metadata,
        command,
        args,
      },
    };

    await this.writeEntry(entry);
  }

  /**
   * Log an error
   * @param errorMessage The error message
   * @param metadata Optional metadata including error details
   */
  async logError(errorMessage: string, metadata?: Record<string, unknown>): Promise<void> {
    const entry: ChatLogEntry = {
      timestamp: this.getTimestamp(),
      type: 'error',
      role: 'system',
      content: errorMessage,
      metadata,
    };

    await this.writeEntry(entry);
  }

  /**
   * Log an event (initialization, session start, etc.)
   * @param eventName Event name
   * @param metadata Optional metadata
   */
  async logEvent(eventName: string, metadata?: Record<string, unknown>): Promise<void> {
    const entry: ChatLogEntry = {
      timestamp: this.getTimestamp(),
      type: 'event',
      role: 'system',
      content: eventName,
      metadata,
    };

    await this.writeEntry(entry);
  }

  /**
   * Write an entry to the log file
   */
  private async writeEntry(entry: ChatLogEntry): Promise<void> {
    try {
      await this.ensureLogDirectory();

      // On first write, create the file with session header
      if (!existsSync(this.sessionLogPath)) {
        const header: ChatLogEntry = {
          timestamp: this.sessionStartTime,
          type: 'event',
          role: 'system',
          content: 'Session started',
          metadata: {
            sessionId: this.sessionId,
            logVersion: '1.0',
          },
        };
        try {
          await writeFile(this.sessionLogPath, this.formatEntry(header), 'utf-8');
        } catch (error) {
          // If writeFile fails due to missing directory (race condition in concurrent tests),
          // ensure directory again and retry
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            await this.ensureLogDirectory();
            await writeFile(this.sessionLogPath, this.formatEntry(header), 'utf-8');
          } else {
            throw error;
          }
        }
      }

      // Append the entry
      await appendFile(this.sessionLogPath, this.formatEntry(entry), 'utf-8');
    } catch (error) {
      console.warn('[ChatLogger] Warning: Could not write to log file:', error);
    }
  }

  /**
   * Read all entries from the session log
   */
  async readEntries(): Promise<ChatLogEntry[]> {
    try {
      const content = await readFile(this.sessionLogPath, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as ChatLogEntry);
    } catch (error) {
      console.warn('[ChatLogger] Warning: Could not read log file:', error);
      return [];
    }
  }

  /**
   * Get summary of the session
   */
  async getSummary(): Promise<{
    sessionId: string;
    messageCount: number;
    commandCount: number;
    errorCount: number;
    duration: string;
  }> {
    const entries = await this.readEntries();

    const messageCount = entries.filter((e) => e.type === 'message' && e.role === 'user').length;
    const commandCount = entries.filter((e) => e.type === 'command').length;
    const errorCount = entries.filter((e) => e.type === 'error').length;

    // Calculate duration from first to last entry
    let duration = 'N/A';
    if (entries.length > 1) {
      const first = new Date(entries[0].timestamp);
      const last = new Date(entries[entries.length - 1].timestamp);
      const ms = last.getTime() - first.getTime();
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;

      if (minutes > 0) {
        duration = `${minutes}m ${secs}s`;
      } else {
        duration = `${secs}s`;
      }
    }

    return {
      sessionId: this.sessionId,
      messageCount,
      commandCount,
      errorCount,
      duration,
    };
  }
}

/**
 * Global chat logger instance or undefined
 */
let globalChatLogger: ChatLogger | undefined;

/**
 * Initialize global chat logger
 * @param projectRoot Optional project root
 * @returns The initialized ChatLogger instance
 */
export function initializeChatLogger(projectRoot?: string): ChatLogger {
  globalChatLogger = new ChatLogger(projectRoot);
  return globalChatLogger;
}

/**
 * Get the global chat logger instance
 * @returns The global ChatLogger instance or undefined if not initialized
 */
export function getChatLogger(): ChatLogger | undefined {
  return globalChatLogger;
}

/**
 * Reset the global chat logger (for testing purposes)
 */
export function resetGlobalChatLogger(): void {
  globalChatLogger = undefined;
}

/**
 * List all chat session logs
 * @param projectRoot Optional project root for relative path resolution
 */
export async function listChatSessions(projectRoot?: string): Promise<string[]> {
  const logger = new ChatLogger(projectRoot);
  const logDir = logger.getLogDirectory();

  try {
    const files = await readdir(logDir);
    return files.filter((f) => f.endsWith('.log')).sort().reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Read a specific chat session
 * @param logFile The log filename
 * @param projectRoot Optional project root
 */
export async function readChatSession(logFile: string, projectRoot?: string): Promise<ChatLogEntry[]> {
  const logger = new ChatLogger(projectRoot);
  const logDir = logger.getLogDirectory();
  const logPath = join(logDir, logFile);

  try {
    const content = await readFile(logPath, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as ChatLogEntry);
  } catch (error) {
    console.error('Error reading chat session:', error);
    throw error;
  }
}
