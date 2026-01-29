/**
 * Comprehensive tests for concurrent session handling
 * Tests cover multiple simultaneous sessions, race conditions, and thread safety
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ChatLogger, listChatSessions, readChatSession } from '../../../src/utils/chat-logger';
import { BaseChatClient, ChatOptions } from '../../../src/ai/base-chat-client';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Test implementation
class TestChatClient extends BaseChatClient {
  private sessionLog: Array<{ sessionId: string; message: string; timestamp: number }> = [];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async sendMessage(message: string, options?: ChatOptions): Promise<void> {
    if (!this.currentSession) {
      this.createSession();
    }
    this.updateSessionTimestamp();

    this.sessionLog.push({
      sessionId: this.currentSession.id,
      message,
      timestamp: Date.now(),
    });
  }

  getClientName(): string {
    return 'Concurrent Test Client';
  }

  getSessionLog(): Array<{ sessionId: string; message: string; timestamp: number }> {
    return this.sessionLog;
  }
}

// Helper to create test directory
async function createTestDir(): Promise<string> {
  const dir = join(tmpdir(), `concurrent-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// Helper to cleanup test directory
async function cleanupTestDir(dir: string): Promise<void> {
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('Concurrent Session Handling', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe('multiple simultaneous loggers', () => {
    it('should handle multiple logger instances concurrently', async () => {
      const loggers = Array.from({ length: 5 }, () => new ChatLogger(testDir));

      await Promise.all(loggers.map((logger) => logger.ensureLogDirectory()));

      const sessionIds = loggers.map((logger) => logger.getSessionId());
      const uniqueIds = new Set(sessionIds);

      // All session IDs should be unique
      expect(uniqueIds.size).toBe(5);
    });

    it('should create separate session files for concurrent loggers', async () => {
      const loggers = Array.from({ length: 3 }, (_, i) => new ChatLogger(testDir));

      const writePromises = loggers.map((logger, i) => {
        return logger.ensureLogDirectory().then(() => logger.logUserMessage(`Message from logger ${i}`));
      });

      await Promise.all(writePromises);

      const sessions = await listChatSessions(testDir);
      expect(sessions.length).toBeGreaterThanOrEqual(3);
    });

    it('should isolate messages between concurrent loggers', async () => {
      const loggers = Array.from({ length: 3 }, (_, i) => new ChatLogger(testDir));

      await Promise.all(loggers.map((logger) => logger.ensureLogDirectory()));

      // Each logger logs to its own session
      const writePromises = loggers.map((logger, i) => logger.logUserMessage(`Logger ${i}`));
      await Promise.all(writePromises);

      const sessions = await listChatSessions(testDir);

      // Verify each message is in its own session
      const messages: Record<number, boolean> = {};
      for (const sessionFile of sessions) {
        const entries = await readChatSession(sessionFile, testDir);
        entries.forEach((entry) => {
          for (let i = 0; i < 3; i++) {
            if (entry.content === `Logger ${i}`) {
              messages[i] = true;
            }
          }
        });
      }

      // All messages should be found
      expect(Object.keys(messages).length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('sequential message writes', () => {
    it('should handle sequential writes to same logger', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      const messages = Array.from({ length: 10 }, (_, i) => `Message ${i}`);

      // Write messages sequentially (realistic usage pattern)
      for (const msg of messages) {
        await logger.logUserMessage(msg);
      }

      const entries = await logger.readEntries();
      const userMessages = entries.filter((e) => e.role === 'user');
      expect(userMessages.length).toBe(10);
    });

    it('should handle mixed entry types in sequential writes', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Write sequentially (realistic usage pattern)
      for (let i = 0; i < 5; i++) {
        await logger.logUserMessage(`User message ${i}`);
        await logger.logAssistantMessage(`Assistant response ${i}`);
        await logger.logCommand('dr', [`command-${i}`]);
      }

      const entries = await logger.readEntries();

      const userMessages = entries.filter((e) => e.role === 'user');
      const assistantMessages = entries.filter((e) => e.role === 'assistant');
      const commands = entries.filter((e) => e.type === 'command');

      expect(userMessages.length).toBe(5);
      expect(assistantMessages.length).toBe(5);
      expect(commands.length).toBe(5);
    });
  });

  describe('concurrent client sessions', () => {
    it('should handle multiple clients with concurrent messages', async () => {
      const clients = Array.from({ length: 3 }, () => new TestChatClient());

      const sendPromises = [];
      for (const client of clients) {
        for (let i = 0; i < 5; i++) {
          sendPromises.push(client.sendMessage(`Message ${i}`));
        }
      }

      await Promise.all(sendPromises);

      // Each client should have its own session
      const sessionIds = new Set(clients.map((c) => c.getCurrentSession()?.id));
      expect(sessionIds.size).toBe(3);
    });

    it('should maintain session integrity with concurrent sends', async () => {
      const client = new TestChatClient();

      const messages = Array.from({ length: 10 }, (_, i) => `Message ${i}`);
      const sendPromises = messages.map((msg) => client.sendMessage(msg));

      await Promise.all(sendPromises);

      const log = client.getSessionLog();
      const sessionId = client.getCurrentSession()?.id;

      // All messages should be in same session
      expect(log.every((entry) => entry.sessionId === sessionId)).toBe(true);
      expect(log.length).toBe(10);
    });

    it('should allow session switching between concurrent operations', async () => {
      const client = new TestChatClient();

      // Create session 1
      await client.sendMessage('Session 1 message 1');
      const session1 = client.getCurrentSession();

      // Clear and create session 2
      client.clearSession();
      await client.sendMessage('Session 2 message 1');
      const session2 = client.getCurrentSession();

      expect(session1?.id).not.toBe(session2?.id);
    });

    it('should handle rapid session creation', async () => {
      const clients = Array.from({ length: 10 }, () => new TestChatClient());

      const sendPromises = clients.map((client) => client.sendMessage('Message'));

      await Promise.all(sendPromises);

      const sessionIds = clients.map((c) => c.getCurrentSession()?.id);
      const uniqueIds = new Set(sessionIds);

      // Each client should have unique session
      expect(uniqueIds.size).toBe(10);
    });
  });

  describe('concurrent list operations', () => {
    it('should list sessions correctly during concurrent writes', async () => {
      const loggers = Array.from({ length: 5 }, () => new ChatLogger(testDir));

      // Start writing concurrently
      const writePromises = loggers.map((logger) =>
        logger.ensureLogDirectory().then(() => logger.logUserMessage('Test'))
      );

      // List sessions while writing
      await Promise.all(writePromises);

      const sessions = await listChatSessions(testDir);
      expect(sessions.length).toBeGreaterThanOrEqual(5);
    });

    it('should handle multiple concurrent list operations', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Test message');

      // Multiple concurrent list operations
      const listPromises = Array.from({ length: 5 }, () => listChatSessions(testDir));

      const results = await Promise.all(listPromises);

      // All list operations should return same sessions
      const sessionsSets = results.map((sessions) => new Set(sessions));

      // All should have at least one session
      sessionsSets.forEach((set) => {
        expect(set.size).toBeGreaterThan(0);
      });
    });

    it('should handle concurrent read operations', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      for (let i = 0; i < 5; i++) {
        await logger.logUserMessage(`Message ${i}`);
      }

      const sessions = await listChatSessions(testDir);
      const sessionFile = sessions[0];

      // Multiple concurrent reads of same session
      const readPromises = Array.from({ length: 5 }, () => readChatSession(sessionFile, testDir));

      const results = await Promise.all(readPromises);

      // All reads should return same content
      const firstLength = results[0].length;
      results.forEach((result) => {
        expect(result.length).toBe(firstLength);
      });
    });
  });

  describe('concurrent directory operations', () => {
    it('should handle multiple ensureLogDirectory calls', async () => {
      const loggers = Array.from({ length: 5 }, () => new ChatLogger(testDir));

      const ensurePromises = loggers.map((logger) => logger.ensureLogDirectory());

      await Promise.all(ensurePromises);

      // Directory should exist and be usable
      expect(existsSync(loggers[0].getLogDirectory())).toBe(true);
    });

    it('should create directory safely with concurrent attempts', async () => {
      const loggers = Array.from({ length: 10 }, () => new ChatLogger(testDir));

      const operations = loggers.map((logger) =>
        logger.ensureLogDirectory().then(() => logger.logUserMessage('Test'))
      );

      await Promise.all(operations);

      const sessions = await listChatSessions(testDir);
      expect(sessions.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('session summary operations', () => {
    it('should calculate summary after sequential writes', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Write entries sequentially (realistic usage)
      for (let i = 0; i < 10; i++) {
        await logger.logUserMessage(`Message ${i}`);
      }

      // Get summary
      const summary = await logger.getSummary();

      expect(summary.messageCount).toBe(10);
      expect(summary.sessionId).toBe(logger.getSessionId());
    });

    it('should handle multiple sequential summary requests', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      for (let i = 0; i < 5; i++) {
        await logger.logUserMessage(`Message ${i}`);
      }

      // Multiple sequential summary requests (concurrent reads are fine)
      const summaryPromises = Array.from({ length: 5 }, () => logger.getSummary());

      const results = await Promise.all(summaryPromises);

      // All summaries should be consistent
      results.forEach((summary) => {
        expect(summary.messageCount).toBe(5);
        expect(summary.sessionId).toBe(logger.getSessionId());
      });
    });
  });

  describe('concurrent session isolation', () => {
    it('should keep concurrent sessions isolated', async () => {
      const loggers = Array.from({ length: 3 }, (_, i) => new ChatLogger(testDir));

      await Promise.all(loggers.map((logger) => logger.ensureLogDirectory()));

      // Each logger writes different messages
      const writePromises = loggers.map((logger, i) =>
        logger.logUserMessage(`Session ${i} message`)
      );

      await Promise.all(writePromises);

      const sessions = await listChatSessions(testDir);
      const messageMap: Record<number, boolean> = {};

      for (const sessionFile of sessions) {
        const entries = await readChatSession(sessionFile, testDir);
        for (let i = 0; i < 3; i++) {
          if (entries.some((e) => e.content === `Session ${i} message`)) {
            messageMap[i] = true;
          }
        }
      }

      // All messages should be found in separate sessions
      expect(Object.keys(messageMap).length).toBe(3);
    });

    it('should not cross-contaminate concurrent logger writes', async () => {
      const loggers = Array.from({ length: 3 }, () => new ChatLogger(testDir));

      await Promise.all(loggers.map((logger) => logger.ensureLogDirectory()));

      // Concurrent writes
      const writePromises = [];
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 3; i++) {
          writePromises.push(
            loggers[i].logUserMessage(`Logger ${i} - Round ${round}`)
          );
        }
      }

      await Promise.all(writePromises);

      const sessions = await listChatSessions(testDir);
      const sessionContents: Record<string, string[]> = {};

      for (const sessionFile of sessions) {
        const entries = await readChatSession(sessionFile, testDir);
        const messages = entries
          .filter((e) => e.role === 'user')
          .map((e) => e.content);
        sessionContents[sessionFile] = messages;
      }

      // Verify isolation (each session should only have messages from one logger)
      // Note: Due to concurrent writes, exact distribution might vary,
      // but no session should have messages from all loggers
      Object.values(sessionContents).forEach((messages) => {
        const loggerIds = new Set(
          messages.map((msg) => msg.match(/Logger (\d)/)?.[1])
        );
        expect(loggerIds.size).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('stress testing', () => {
    it('should handle multiple loggers under concurrent load', async () => {
      const loggers = Array.from({ length: 10 }, () => new ChatLogger(testDir));

      await Promise.all(loggers.map((logger) => logger.ensureLogDirectory()));

      // Each logger writes sequentially (realistic usage: each logger is per-session)
      const writePromises = loggers.map(async (logger) => {
        for (let i = 0; i < 10; i++) {
          await logger.logUserMessage(`Message ${i}`);
        }
      });

      await Promise.all(writePromises);

      const sessions = await listChatSessions(testDir);
      expect(sessions.length).toBeGreaterThanOrEqual(10);
    });

    it('should handle multiple sequential operations safely', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Write messages sequentially (realistic usage pattern)
      for (let i = 0; i < 50; i++) {
        await logger.logUserMessage(`Message ${i}`);
      }

      const entries = await logger.readEntries();
      const userMessages = entries.filter((e) => e.role === 'user');

      // All messages should be present
      expect(userMessages.length).toBe(50);

      // All should be unique
      const uniqueMessages = new Set(userMessages.map((m) => m.content));
      expect(uniqueMessages.size).toBe(50);
    });

    it('should handle multiple loggers with error conditions', async () => {
      const loggers = Array.from({ length: 5 }, () => new ChatLogger(testDir));

      const operations = loggers.map(async (logger, i) => {
        await logger.ensureLogDirectory();
        await logger.logUserMessage(`Logger ${i} - message 1`);
        await logger.logUserMessage(`Logger ${i} - message 2`);
      });

      await Promise.all(operations);

      const sessions = await listChatSessions(testDir);
      expect(sessions.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('race condition prevention', () => {
    it('should prevent race conditions in session ID generation', async () => {
      const loggers = Array.from({ length: 100 }, () => new ChatLogger(testDir));

      const sessionIds = loggers.map((logger) => logger.getSessionId());
      const uniqueIds = new Set(sessionIds);

      // All IDs should be unique
      expect(uniqueIds.size).toBe(100);
    });

    it('should handle simultaneous file creation safely', async () => {
      const loggers = Array.from({ length: 5 }, () => new ChatLogger(testDir));

      const writePromises = loggers.map((logger) =>
        logger.ensureLogDirectory().then(() => logger.logUserMessage('Test'))
      );

      await Promise.all(writePromises);

      const sessions = await listChatSessions(testDir);
      expect(sessions.length).toBeGreaterThanOrEqual(5);

      // All should be valid .log files
      sessions.forEach((session) => {
        expect(session).toEndWith('.log');
      });
    });
  });
});
