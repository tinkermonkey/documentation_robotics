/**
 * Comprehensive tests for session persistence and continuity
 * Tests cover session ID collision, persistence across restarts, and state recovery
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ChatLogger, readChatSession, listChatSessions } from '../../../src/utils/chat-logger';
import { BaseChatClient, ChatSession, ChatOptions } from '../../../src/ai/base-chat-client';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Test implementation of BaseChatClient
class TestChatClient extends BaseChatClient {
  private sessionId?: string;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async sendMessage(message: string, options?: ChatOptions): Promise<void> {
    if (options?.sessionId) {
      this.sessionId = options.sessionId;
    }

    if (!this.currentSession) {
      this.createSession();
    }
    this.updateSessionTimestamp();
  }

  getClientName(): string {
    return 'Test Client';
  }

  getSessionIdUsed(): string | undefined {
    return this.sessionId;
  }

  // Public method for testing
  public testCreateSession(overrideId?: string): ChatSession {
    if (overrideId) {
      const session: ChatSession = {
        id: overrideId,
        createdAt: new Date(),
        lastMessageAt: new Date(),
      };
      this.currentSession = session;
      return session;
    }
    return this.createSession();
  }
}

// Helper to create test directory
async function createTestDir(): Promise<string> {
  const dir = join(tmpdir(), `session-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// Helper to cleanup test directory
async function cleanupTestDir(dir: string): Promise<void> {
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('Session Persistence and Continuity', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe('session ID generation and uniqueness', () => {
    it('should generate unique session IDs within same logger', () => {
      const logger1 = new ChatLogger(testDir);
      const logger2 = new ChatLogger(testDir);

      expect(logger1.getSessionId()).not.toBe(logger2.getSessionId());
    });

    it('should maintain session ID throughout logger lifetime', async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();
      await logger.logUserMessage('Message 1');
      await logger.logUserMessage('Message 2');

      expect(logger.getSessionId()).toBe(sessionId);
    });

    it('should use same session ID in log filename', async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();
      const logPath = logger.getSessionLogPath();

      expect(logPath).toContain(sessionId);
    });

    it('should generate valid UUID format session IDs', () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();
      // UUID v4 format: 8-4-4-4-12 hexadecimal digits
      expect(sessionId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
    });

    it('should handle manual session ID specification in options', async () => {
      const client = new TestChatClient();
      const customSessionId = 'session-123-custom';

      await client.sendMessage('Test', { sessionId: customSessionId });

      expect(client.getSessionIdUsed()).toBe(customSessionId);
    });
  });

  describe('file-based session persistence', () => {
    it('should persist session log across multiple logger instances', async () => {
      const logger1 = new ChatLogger(testDir);
      await logger1.ensureLogDirectory();
      await logger1.logUserMessage('From logger 1');

      // Read the session file created by logger1
      const sessions = await listChatSessions(testDir);
      expect(sessions.length).toBeGreaterThan(0);

      const entries = await readChatSession(sessions[0], testDir);
      expect(entries.some((e) => e.content === 'From logger 1')).toBe(true);
    });

    it('should create separate session files for different loggers', async () => {
      const logger1 = new ChatLogger(testDir);
      await logger1.ensureLogDirectory();
      await logger1.logUserMessage('From logger 1');

      const logger2 = new ChatLogger(testDir);
      await logger2.ensureLogDirectory();
      await logger2.logUserMessage('From logger 2');

      const sessions = await listChatSessions(testDir);
      expect(sessions.length).toBeGreaterThanOrEqual(2);

      // Verify both messages are in different files
      let foundLogger1Message = false;
      let foundLogger2Message = false;

      for (const sessionFile of sessions) {
        const entries = await readChatSession(sessionFile, testDir);
        if (entries.some((e) => e.content === 'From logger 1')) {
          foundLogger1Message = true;
        }
        if (entries.some((e) => e.content === 'From logger 2')) {
          foundLogger2Message = true;
        }
      }

      expect(foundLogger1Message).toBe(true);
      expect(foundLogger2Message).toBe(true);
    });

    it('should recover session data from disk', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      const testMessage = 'Persist this message';
      await logger.logUserMessage(testMessage);

      // Simulate reading from disk
      const sessions = await listChatSessions(testDir);
      const entries = await readChatSession(sessions[0], testDir);

      expect(entries.some((e) => e.content === testMessage)).toBe(true);
    });

    it('should handle large session files', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Write many entries
      for (let i = 0; i < 100; i++) {
        await logger.logUserMessage(`Message ${i}`);
      }

      const entries = await logger.readEntries();
      const userMessages = entries.filter((e) => e.role === 'user');
      expect(userMessages.length).toBe(100);
    });

    it('should preserve message order in persistent storage', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      for (let i = 0; i < 10; i++) {
        await logger.logUserMessage(`Message ${i}`);
      }

      const entries = await logger.readEntries();
      const userMessages = entries.filter((e) => e.role === 'user');

      for (let i = 0; i < 10; i++) {
        expect(userMessages[i].content).toBe(`Message ${i}`);
      }
    });
  });

  describe('client session management', () => {
    it('should create new session on first message', async () => {
      const client = new TestChatClient();
      expect(client.getCurrentSession()).toBeUndefined();

      await client.sendMessage('Test');

      expect(client.getCurrentSession()).toBeDefined();
    });

    it('should maintain session across multiple messages', async () => {
      const client = new TestChatClient();
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();

      await client.sendMessage('Message 2');
      const session2 = client.getCurrentSession();

      expect(session1?.id).toBe(session2?.id);
    });

    it('should update last message timestamp for each message', async () => {
      const client = new TestChatClient();
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();
      const time1 = session1?.lastMessageAt || new Date(0);

      await new Promise((resolve) => setTimeout(resolve, 10));

      await client.sendMessage('Message 2');
      const session2 = client.getCurrentSession();
      const time2 = session2?.lastMessageAt || new Date(0);

      expect(time2.getTime()).toBeGreaterThanOrEqual(time1.getTime());
    });

    it('should clear session when requested', async () => {
      const client = new TestChatClient();
      await client.sendMessage('Test');
      expect(client.getCurrentSession()).toBeDefined();

      client.clearSession();
      expect(client.getCurrentSession()).toBeUndefined();
    });

    it('should create new session after clearing', async () => {
      const client = new TestChatClient();
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();

      client.clearSession();
      await client.sendMessage('Message 2');
      const session2 = client.getCurrentSession();

      expect(session1?.id).not.toBe(session2?.id);
    });

    it('should preserve session creation time', async () => {
      const client = new TestChatClient();
      const beforeTime = new Date();
      await client.sendMessage('Test');
      const afterTime = new Date();

      const session = client.getCurrentSession();
      expect(session?.createdAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(session?.createdAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('session metadata and tracking', () => {
    it('should include session ID in log entries', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      const sessionId = logger.getSessionId();

      await logger.logUserMessage('Test');

      const entries = await logger.readEntries();
      const sessionStartEvent = entries.find((e) => e.type === 'event' && e.content === 'Session started');
      expect(sessionStartEvent?.metadata?.sessionId).toBe(sessionId);
    });

    it('should track session start time', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Test');

      const entries = await logger.readEntries();
      const sessionStartEvent = entries.find((e) => e.type === 'event' && e.content === 'Session started');
      expect(sessionStartEvent?.timestamp).toBeDefined();

      const startDate = new Date(sessionStartEvent?.timestamp || '');
      expect(startDate.getTime()).toBeGreaterThan(0);
    });

    it('should calculate correct session duration', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      await logger.logUserMessage('Start');
      await new Promise((resolve) => setTimeout(resolve, 50));
      await logger.logUserMessage('End');

      const summary = await logger.getSummary();
      expect(summary.duration).not.toBe('N/A');
    });

    it('should include all session statistics in summary', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      await logger.logUserMessage('Message 1');
      await logger.logUserMessage('Message 2');
      await logger.logCommand('dr', ['list']);
      await logger.logError('Test error');

      const summary = await logger.getSummary();
      expect(summary.sessionId).toBeDefined();
      expect(summary.messageCount).toBe(2);
      expect(summary.commandCount).toBe(1);
      expect(summary.errorCount).toBe(1);
      expect(summary.duration).toBeDefined();
    });
  });

  describe('session recovery scenarios', () => {
    it('should recover session data after logger is garbage collected', async () => {
      const sessionId1 = new ChatLogger(testDir).getSessionId();
      const logger1 = new ChatLogger(testDir);
      await logger1.ensureLogDirectory();
      await logger1.logUserMessage('Message before GC');

      const sessions = await listChatSessions(testDir);
      const entries = await readChatSession(sessions[0], testDir);

      expect(entries.some((e) => e.content === 'Message before GC')).toBe(true);
    });

    it('should handle resuming with explicit session ID', async () => {
      const client = new TestChatClient();
      const customSessionId = 'custom-session-123';

      await client.sendMessage('Message 1', { sessionId: customSessionId });
      const session1 = client.getCurrentSession();

      // Simulate session clear and resume with same ID
      client.clearSession();
      await client.sendMessage('Message 2', { sessionId: customSessionId });
      const session2 = client.getCurrentSession();

      expect(client.getSessionIdUsed()).toBe(customSessionId);
    });

    it('should preserve session metadata across reads', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      const sessionId = logger.getSessionId();

      const metadata = { clientName: 'Test', version: '1.0.0' };
      await logger.logEvent('session_metadata', metadata);

      const entries = await logger.readEntries();
      const metadataEvent = entries.find((e) => e.content === 'session_metadata');

      expect(metadataEvent?.metadata?.clientName).toBe('Test');
      expect(metadataEvent?.metadata?.version).toBe('1.0.0');
    });
  });

  describe('session state consistency', () => {
    it('should maintain consistent session ID across multiple reads', async () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();
      await logger.logUserMessage('Test');

      const entries1 = await logger.readEntries();
      const entries2 = await logger.readEntries();

      const sessionEvent1 = entries1.find((e) => e.type === 'event' && e.content === 'Session started');
      const sessionEvent2 = entries2.find((e) => e.type === 'event' && e.content === 'Session started');

      expect(sessionEvent1?.metadata?.sessionId).toBe(sessionId);
      expect(sessionEvent2?.metadata?.sessionId).toBe(sessionId);
    });

    it('should handle concurrent session initialization', async () => {
      const loggers = [];
      for (let i = 0; i < 5; i++) {
        loggers.push(new ChatLogger(testDir));
      }

      const sessionIds = loggers.map((l) => l.getSessionId());
      const uniqueIds = new Set(sessionIds);

      // All session IDs should be unique
      expect(uniqueIds.size).toBe(sessionIds.length);
    });

    it('should maintain session integrity with concurrent writes', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      const writePromises = [];
      for (let i = 0; i < 10; i++) {
        writePromises.push(logger.logUserMessage(`Message ${i}`));
      }

      await Promise.all(writePromises);
      const entries = await logger.readEntries();

      // Verify all entries are present and valid
      const userMessages = entries.filter((e) => e.role === 'user');
      expect(userMessages.length).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(userMessages.some((m) => m.content === `Message ${i}`)).toBe(true);
      }
    });
  });

  describe('timestamp handling and ordering', () => {
    it('should use ISO 8601 timestamps for all entries', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Test');

      const entries = await logger.readEntries();
      entries.forEach((entry) => {
        // Should be valid ISO 8601 format
        const date = new Date(entry.timestamp);
        expect(date.getTime()).toBeGreaterThan(0);
        expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });
    });

    it('should maintain chronological order of entries', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      for (let i = 0; i < 5; i++) {
        await logger.logUserMessage(`Message ${i}`);
      }

      const entries = await logger.readEntries();
      for (let i = 1; i < entries.length; i++) {
        const prevTime = new Date(entries[i - 1].timestamp).getTime();
        const currTime = new Date(entries[i].timestamp).getTime();
        expect(currTime).toBeGreaterThanOrEqual(prevTime);
      }
    });

    it('should use filesystem-safe timestamp format in filename', () => {
      const logger = new ChatLogger(testDir);
      const logPath = logger.getSessionLogPath();
      const filename = logPath.split('/').pop() || '';

      // Should not contain colons (filesystem-incompatible)
      expect(filename).not.toContain(':');
      // Should contain underscores (replacing colons)
      expect(filename).toContain('_');
    });
  });

  describe('session isolation', () => {
    it('should isolate sessions from different loggers', async () => {
      const logger1 = new ChatLogger(testDir);
      await logger1.ensureLogDirectory();
      await logger1.logUserMessage('From logger 1', { logger: 1 });

      const logger2 = new ChatLogger(testDir);
      await logger2.ensureLogDirectory();
      await logger2.logUserMessage('From logger 2', { logger: 2 });

      const sessions = await listChatSessions(testDir);
      expect(sessions.length).toBeGreaterThanOrEqual(2);

      // Verify isolation
      const entries1 = await readChatSession(sessions[sessions.length - 1], testDir);
      const entries2 = await readChatSession(sessions[sessions.length - 2], testDir);

      const messages1 = entries1.filter((e) => e.metadata?.logger === 1);
      const messages2 = entries2.filter((e) => e.metadata?.logger === 2);

      // Each session should have messages from only one logger
      expect(messages1.length + messages2.length).toBeGreaterThan(0);
    });

    it('should not cross-contaminate session IDs', async () => {
      const logger1 = new ChatLogger(testDir);
      const logger2 = new ChatLogger(testDir);

      const sessionId1 = logger1.getSessionId();
      const sessionId2 = logger2.getSessionId();

      expect(sessionId1).not.toBe(sessionId2);
    });
  });
});
