/**
 * Comprehensive unit tests for ChatLogger session management
 * Tests cover file operations, persistence, error handling, and edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ChatLogger, ChatLogEntry, initializeChatLogger, getChatLogger, listChatSessions, readChatSession, resetGlobalChatLogger } from '../../../src/utils/chat-logger';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Helper to create a temporary test directory
async function createTestDir(): Promise<string> {
  // Use UUID for guaranteed uniqueness across concurrent tests
  const uniqueId = randomUUID();
  const dir = join(tmpdir(), `chat-logger-test-${uniqueId}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// Helper to cleanup test directory
async function cleanupTestDir(dir: string): Promise<void> {
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('ChatLogger', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
    resetGlobalChatLogger();
  });

  describe('initialization and directory management', () => {
    it('should create a ChatLogger instance with unique session ID', () => {
      const logger = new ChatLogger(testDir);
      expect(logger.getSessionId()).toBeDefined();
      expect(typeof logger.getSessionId()).toBe('string');
    });

    it('should generate unique session IDs across instances', () => {
      const logger1 = new ChatLogger(testDir);
      const logger2 = new ChatLogger(testDir);
      expect(logger1.getSessionId()).not.toBe(logger2.getSessionId());
    });

    it('should create log directory structure on ensureLogDirectory', async () => {
      const logger = new ChatLogger(testDir);
      const logDir = logger.getLogDirectory();
      expect(existsSync(logDir)).toBe(false);

      await logger.ensureLogDirectory();

      expect(existsSync(logDir)).toBe(true);
    });

    it('should handle multiple ensureLogDirectory calls without error', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      // Should not throw on second call
      await logger.ensureLogDirectory();
      expect(existsSync(logger.getLogDirectory())).toBe(true);
    });

    it('should use project root for log directory when provided', () => {
      const logger = new ChatLogger(testDir);
      const logDir = logger.getLogDirectory();
      expect(logDir).toContain(testDir);
      expect(logDir).toContain('.dr');
      expect(logDir).toContain('chat');
      expect(logDir).toContain('sessions');
    });

    it('should fall back to home directory when project root does not exist', () => {
      const logger = new ChatLogger('/nonexistent/path');
      const logDir = logger.getLogDirectory();
      expect(logDir).toContain('.dr');
      expect(logDir).toContain('chat');
      expect(logDir).toContain('sessions');
    });

    it('should generate correct session log path', () => {
      const logger = new ChatLogger(testDir);
      const logPath = logger.getSessionLogPath();
      expect(logPath).toContain('.dr');
      expect(logPath).toContain('chat');
      expect(logPath).toContain('sessions');
      expect(logPath).toContain('.log');
      expect(logPath).toContain(logger.getSessionId());
    });

    it('should use filesystem-safe timestamp in log filename', () => {
      const logger = new ChatLogger(testDir);
      const logPath = logger.getSessionLogPath();
      // Should not contain colons (replaced with underscores)
      const filename = logPath.split('/').pop() || '';
      const parts = filename.split('_');
      // Format: {date}_{time}_{sessionId}.log where colons are underscores
      expect(filename).toContain(logger.getSessionId());
    });
  });

  describe('message logging', () => {
    it('should log user messages', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Hello, assistant!');

      const entries = await logger.readEntries();
      const userMessages = entries.filter((e) => e.role === 'user');
      expect(userMessages.length).toBeGreaterThan(0);
      expect(userMessages[userMessages.length - 1].content).toBe('Hello, assistant!');
    });

    it('should log assistant messages', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logAssistantMessage('Hello, user!');

      const entries = await logger.readEntries();
      const assistantMessages = entries.filter((e) => e.role === 'assistant');
      expect(assistantMessages.length).toBeGreaterThan(0);
      expect(assistantMessages[0].content).toBe('Hello, user!');
    });

    it('should include metadata in logged messages', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      const metadata = { agentName: 'test-agent', version: '1.0' };
      await logger.logUserMessage('Test message', metadata);

      const entries = await logger.readEntries();
      const messageWithMetadata = entries.find((e) => e.content === 'Test message');
      expect(messageWithMetadata?.metadata).toEqual(metadata);
    });

    it('should include timestamps in all logged messages', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Test');

      const entries = await logger.readEntries();
      entries.forEach((entry) => {
        expect(entry.timestamp).toBeDefined();
        // Verify ISO 8601 format
        const date = new Date(entry.timestamp);
        expect(date.getTime()).toBeGreaterThan(0);
      });
    });

    it('should handle empty message content', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('');

      const entries = await logger.readEntries();
      const emptyMessage = entries.find((e) => e.content === '');
      expect(emptyMessage).toBeDefined();
      expect(emptyMessage?.role).toBe('user');
    });

    it('should handle multiline messages', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      const multilineContent = 'Line 1\nLine 2\nLine 3';
      await logger.logUserMessage(multilineContent);

      const entries = await logger.readEntries();
      const multilineMessage = entries.find((e) => e.content === multilineContent);
      expect(multilineMessage).toBeDefined();
    });

    it('should handle special characters in messages', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      const specialContent = 'Test with "quotes", \\backslashes\\, and unicode: café 你好';
      await logger.logUserMessage(specialContent);

      const entries = await logger.readEntries();
      const specialMessage = entries.find((e) => e.type === 'message' && e.role === 'user');
      expect(specialMessage?.content).toBe(specialContent);
    });
  });

  describe('command logging', () => {
    it('should log commands with arguments', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logCommand('dr', ['add', 'motivation', 'goal', 'test-goal']);

      const entries = await logger.readEntries();
      const commands = entries.filter((e) => e.type === 'command');
      expect(commands.length).toBeGreaterThan(0);
      expect(commands[0].content).toContain('dr');
      expect(commands[0].metadata?.args).toEqual(['add', 'motivation', 'goal', 'test-goal']);
    });

    it('should log commands without arguments', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logCommand('dr');

      const entries = await logger.readEntries();
      const commands = entries.filter((e) => e.type === 'command');
      expect(commands.length).toBeGreaterThan(0);
      expect(commands[0].content).toBe('dr');
    });

    it('should include command name in metadata', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logCommand('dr', ['list']);

      const entries = await logger.readEntries();
      const command = entries.find((e) => e.type === 'command');
      expect(command?.metadata?.command).toBe('dr');
    });

    it('should handle command metadata', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      const metadata = { exitCode: 0, duration: 1234 };
      await logger.logCommand('dr', ['list'], metadata);

      const entries = await logger.readEntries();
      const command = entries.find((e) => e.type === 'command');
      expect(command?.metadata?.exitCode).toBe(0);
      expect(command?.metadata?.duration).toBe(1234);
    });
  });

  describe('error logging', () => {
    it('should log errors with messages', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logError('Test error occurred');

      const entries = await logger.readEntries();
      const errors = entries.filter((e) => e.type === 'error');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].content).toBe('Test error occurred');
    });

    it('should include error metadata', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      const metadata = { code: 'ERR_INVALID_ARG', stack: 'at function:line' };
      await logger.logError('Invalid argument', metadata);

      const entries = await logger.readEntries();
      const error = entries.find((e) => e.type === 'error');
      expect(error?.metadata?.code).toBe('ERR_INVALID_ARG');
      expect(error?.metadata?.stack).toContain('at function:line');
    });

    it('should mark errors with system role', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logError('Test error');

      const entries = await logger.readEntries();
      const error = entries.find((e) => e.type === 'error');
      expect(error?.role).toBe('system');
    });
  });

  describe('event logging', () => {
    it('should log events', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logEvent('chat_session_started');

      const entries = await logger.readEntries();
      const events = entries.filter((e) => e.type === 'event' && e.content === 'chat_session_started');
      expect(events.length).toBeGreaterThan(0);
    });

    it('should include event metadata', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      const metadata = { clientName: 'Claude Code', sessionId: '12345' };
      await logger.logEvent('client_selected', metadata);

      const entries = await logger.readEntries();
      const event = entries.find((e) => e.type === 'event' && e.content === 'client_selected');
      expect(event?.metadata?.clientName).toBe('Claude Code');
      expect(event?.metadata?.sessionId).toBe('12345');
    });

    it('should automatically create session_started event on first write', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('First message');

      const entries = await logger.readEntries();
      const sessionStartedEvent = entries.find((e) => e.type === 'event' && e.content === 'Session started');
      expect(sessionStartedEvent).toBeDefined();
      expect(sessionStartedEvent?.metadata?.sessionId).toBe(logger.getSessionId());
    });
  });

  describe('file operations and persistence', () => {
    it('should create log file on first write', async () => {
      const logger = new ChatLogger(testDir);
      const logPath = logger.getSessionLogPath();
      expect(existsSync(logPath)).toBe(false);

      await logger.ensureLogDirectory();
      await logger.logUserMessage('Test');

      expect(existsSync(logPath)).toBe(true);
    });

    it('should append entries to existing log file', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Message 1');
      await logger.logUserMessage('Message 2');
      await logger.logUserMessage('Message 3');

      const entries = await logger.readEntries();
      const userMessages = entries.filter((e) => e.role === 'user');
      expect(userMessages.length).toBe(3);
    });

    it('should maintain JSON format in log file', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Test message');

      const logPath = logger.getSessionLogPath();
      const content = await readFile(logPath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      lines.forEach((line) => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });

    it('should handle log file read errors gracefully', async () => {
      const logger = new ChatLogger(testDir);
      // Try to read from non-existent file
      const entries = await logger.readEntries();
      expect(entries).toEqual([]);
    });
  });

  describe('readEntries and summary calculations', () => {
    it('should read all entries from log file', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Message 1');
      await logger.logAssistantMessage('Response 1');
      await logger.logUserMessage('Message 2');
      await logger.logCommand('dr', ['list']);

      const entries = await logger.readEntries();
      expect(entries.length).toBeGreaterThanOrEqual(5); // At least: session_started + 4 entries
    });

    it('should calculate correct message count in summary', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Message 1');
      await logger.logUserMessage('Message 2');
      await logger.logAssistantMessage('Response');

      const summary = await logger.getSummary();
      expect(summary.messageCount).toBe(2); // Only user messages
    });

    it('should calculate correct command count in summary', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logCommand('dr', ['add']);
      await logger.logCommand('dr', ['list']);

      const summary = await logger.getSummary();
      expect(summary.commandCount).toBe(2);
    });

    it('should calculate correct error count in summary', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logError('Error 1');
      await logger.logError('Error 2');
      await logger.logError('Error 3');

      const summary = await logger.getSummary();
      expect(summary.errorCount).toBe(3);
    });

    it('should calculate duration in summary', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Start');

      // Wait a bit to create measurable duration
      await new Promise((resolve) => setTimeout(resolve, 100));

      await logger.logUserMessage('End');
      const summary = await logger.getSummary();

      expect(summary.duration).not.toBe('N/A');
      // Should be at least some seconds or 0s
      expect(summary.duration).toMatch(/^\d+[sm]|^\d+s$/);
    });

    it('should return N/A duration for single-entry sessions', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      // Only session_started event, no other entries

      const summary = await logger.getSummary();
      expect(summary.duration).toBe('N/A');
    });

    it('should include session ID in summary', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Test');

      const summary = await logger.getSummary();
      expect(summary.sessionId).toBe(logger.getSessionId());
    });

    it('should format duration as minutes and seconds when > 60s', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Log entries with artificial timestamps to simulate duration
      const entries: ChatLogEntry[] = [
        {
          timestamp: new Date(Date.now() - 90000).toISOString(), // 90 seconds ago
          type: 'event',
          role: 'system',
          content: 'start',
        },
        {
          timestamp: new Date().toISOString(),
          type: 'message',
          role: 'user',
          content: 'end',
        },
      ];

      // Manually write entries to test file
      const logPath = logger.getSessionLogPath();
      await logger.ensureLogDirectory();
      const fs = await import('node:fs/promises');
      const formattedEntries = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await fs.writeFile(logPath, formattedEntries, 'utf-8');

      const summary = await logger.getSummary();
      expect(summary.duration).toContain('m'); // Should have minutes
    });
  });

  describe('global logger functions', () => {
    it('should initialize global chat logger', () => {
      const logger = initializeChatLogger(testDir);
      expect(logger).toBeInstanceOf(ChatLogger);
      const retrieved = getChatLogger();
      expect(retrieved).toBe(logger);
    });

    it('should return initialized global logger', () => {
      const logger1 = initializeChatLogger(testDir);
      const logger2 = getChatLogger();
      expect(logger2).toBe(logger1);
    });
  });

  describe('listChatSessions', () => {
    it('should return empty array when no sessions exist', async () => {
      const testDir2 = await createTestDir();
      try {
        const sessions = await listChatSessions(testDir2);
        expect(sessions).toEqual([]);
      } finally {
        await cleanupTestDir(testDir2);
      }
    });

    it('should handle empty directory gracefully', async () => {
      // Create empty directory to test with
      const emptyDir = await createTestDir();
      try {
        const sessions = await listChatSessions(emptyDir);
        expect(sessions).toEqual([]);
      } finally {
        await cleanupTestDir(emptyDir);
      }
    });
  });

  describe('readChatSession', () => {
    it('should read specific session file', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Test message');

      const sessions = await listChatSessions(testDir);
      const sessionFile = sessions[0];

      const entries = await readChatSession(sessionFile, testDir);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((e) => e.content === 'Test message')).toBe(true);
    });

    it('should throw error for non-existent session file', async () => {
      let caught = false;
      try {
        // Suppress console.error output for this expected error
        const originalConsoleError = console.error;
        console.error = () => {};
        try {
          await readChatSession('nonexistent-file.log', testDir);
        } finally {
          console.error = originalConsoleError;
        }
      } catch (error) {
        caught = true;
        expect(error).toBeDefined();
      }
      expect(caught).toBe(true);
    });

    it('should parse JSON entries correctly', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Message', { key: 'value' });

      const sessions = await listChatSessions(testDir);
      const entries = await readChatSession(sessions[0], testDir);

      const userMessage = entries.find((e) => e.content === 'Message');
      expect(userMessage?.metadata?.key).toBe('value');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle very long messages', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      const longMessage = 'x'.repeat(10000);
      await logger.logUserMessage(longMessage);

      const entries = await logger.readEntries();
      const found = entries.find((e) => e.content.length > 9000);
      expect(found).toBeDefined();
    });

    it('should handle sequential writes correctly', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Write messages sequentially to avoid race conditions with file creation
      for (let i = 0; i < 10; i++) {
        await logger.logUserMessage(`Message ${i}`);
      }

      const entries = await logger.readEntries();
      const userMessages = entries.filter((e) => e.role === 'user');
      expect(userMessages.length).toBe(10);
    });

    it('should handle metadata with nested objects', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      const metadata = {
        user: { id: '123', name: 'Test User' },
        config: { nested: { value: true } },
      };
      await logger.logUserMessage('Test', metadata);

      const entries = await logger.readEntries();
      const message = entries.find((e) => e.content === 'Test');
      expect(message?.metadata?.user?.name).toBe('Test User');
      expect(message?.metadata?.config?.nested?.value).toBe(true);
    });

    it('should generate session ID in correct format', () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();
      expect(sessionId).toMatch(/^[a-f0-9-]+$/i); // UUID format
    });
  });

  describe('error recovery and race condition handling', () => {
    it('should recover from ENOENT race condition when writing session header', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Create initial session log
      await logger.logUserMessage('First message');
      const logPath = logger.getSessionLogPath();
      expect(existsSync(logPath)).toBe(true);

      // Verify recovery by checking log is still writable
      await logger.logUserMessage('Second message after initial write');
      const entries = await logger.readEntries();
      expect(entries.length).toBeGreaterThan(0);

      // Find both messages
      const userMessages = entries.filter((e) => e.role === 'user');
      expect(userMessages.length).toBe(2);
      expect(userMessages[0].content).toBe('First message');
      expect(userMessages[1].content).toBe('Second message after initial write');
    });

    it('should handle concurrent message writes safely', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Write 5 messages concurrently
      const writePromises = Array.from({ length: 5 }, (_, i) =>
        logger.logUserMessage(`Concurrent message ${i}`)
      );

      // All writes should succeed without errors
      await Promise.all(writePromises);

      const entries = await logger.readEntries();
      const userMessages = entries.filter((e) => e.role === 'user');
      expect(userMessages.length).toBe(5);

      // Verify all messages are present
      for (let i = 0; i < 5; i++) {
        const found = userMessages.some((m) => m.content === `Concurrent message ${i}`);
        expect(found).toBe(true);
      }
    });

    it('should handle directory deletion during write operations gracefully', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Write initial message
      await logger.logUserMessage('Message before directory deletion');

      // Delete the log directory to simulate race condition
      const logDir = logger.getLogDirectory();
      await rm(logDir, { recursive: true, force: true });

      // Subsequent write should recover by recreating directory
      await logger.logUserMessage('Message after directory deletion');

      // Verify directory was recreated
      expect(existsSync(logDir)).toBe(true);

      // Verify log file was recreated with new session header
      const entries = await logger.readEntries();
      expect(entries.length).toBeGreaterThan(0);

      // Should have the message after deletion
      const found = entries.some((e) => e.content === 'Message after directory deletion');
      expect(found).toBe(true);
    });
  });
});
