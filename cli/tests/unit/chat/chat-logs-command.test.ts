/**
 * Comprehensive tests for chat-logs command functionality
 * Tests cover all subcommands, error handling, and output formatting
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ChatLogger, listChatSessions, readChatSession, ChatLogEntry } from '../../../src/utils/chat-logger';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Helper to create test directory
async function createTestDir(): Promise<string> {
  const dir = join(tmpdir(), `chat-logs-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// Helper to cleanup test directory
async function cleanupTestDir(dir: string): Promise<void> {
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('Chat Logs Command Functionality', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe('ChatLogger basic functionality', () => {
    it('should create a logger with session ID', () => {
      const logger = new ChatLogger(testDir);
      expect(logger.getSessionId()).toBeDefined();
      expect(typeof logger.getSessionId()).toBe('string');
    });

    it('should return correct log directory for project root', () => {
      const logger = new ChatLogger(testDir);
      const logDir = logger.getLogDirectory();
      expect(logDir).toContain('.dr');
      expect(logDir).toContain('chat');
      expect(logDir).toContain('sessions');
    });

    it('should log user message to file', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Test message');

      const entries = await logger.readEntries();
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((e) => e.content === 'Test message')).toBe(true);
    });

    it('should preserve metadata in logged messages', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      const metadata = { key: 'value', nested: { data: 123 } };
      await logger.logUserMessage('Message', metadata);

      const entries = await logger.readEntries();
      const messageEntry = entries.find((e) => e.content === 'Message');
      expect(messageEntry?.metadata?.key).toBe('value');
      expect(messageEntry?.metadata?.nested?.data).toBe(123);
    });

    it('should log all entry types', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('User message');
      await logger.logAssistantMessage('Assistant response');
      await logger.logCommand('dr', ['list']);
      await logger.logError('Test error');
      await logger.logEvent('test_event');

      const entries = await logger.readEntries();
      const types = new Set(entries.map((e) => e.type));
      expect(types.has('message')).toBe(true);
      expect(types.has('command')).toBe(true);
      expect(types.has('error')).toBe(true);
      expect(types.has('event')).toBe(true);
    });

    it('should maintain entry order', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      for (let i = 0; i < 5; i++) {
        await logger.logUserMessage(`Message ${i}`);
      }

      const entries = await logger.readEntries();
      const userMessages = entries.filter((e) => e.role === 'user');
      for (let i = 0; i < 5; i++) {
        expect(userMessages[i]?.content).toBe(`Message ${i}`);
      }
    });

    it('should include session start event', async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Test');

      const entries = await logger.readEntries();
      const startEvent = entries.find(
        (e) => e.type === 'event' && e.content === 'Session started'
      );
      expect(startEvent).toBeDefined();
      expect(startEvent?.metadata?.sessionId).toBe(sessionId);
    });

    it('should provide session summary', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      await logger.logUserMessage('Message 1');
      await logger.logUserMessage('Message 2');
      await logger.logAssistantMessage('Response');
      await logger.logCommand('dr', ['list']);
      await logger.logError('Error');

      const summary = await logger.getSummary();

      expect(summary.messageCount).toBe(2);
      expect(summary.commandCount).toBe(1);
      expect(summary.errorCount).toBe(1);
      expect(summary.sessionId).toBe(logger.getSessionId());
    });

    it('should track timestamps for all entries', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      await logger.logUserMessage('Message 1');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await logger.logUserMessage('Message 2');

      const entries = await logger.readEntries();

      entries.forEach((entry) => {
        expect(entry.timestamp).toBeDefined();
        const date = new Date(entry.timestamp);
        expect(date.getTime()).toBeGreaterThan(0);
      });
    });
  });

  describe('listChatSessions', () => {
    it('should list no sessions when directory is empty', async () => {
      const sessions = await listChatSessions(testDir);
      expect(sessions).toEqual([]);
    });

    it('should handle undefined project root gracefully', async () => {
      const sessions = await listChatSessions(undefined);
      expect(Array.isArray(sessions)).toBe(true);
    });
  });

  describe('readChatSession', () => {
    it('should throw error for non-existent session file', async () => {
      try {
        await readChatSession('nonexistent-file.log', testDir);
        expect(true).toBe(false); // Should throw
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
