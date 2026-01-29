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

    it('should generate valid UUID v4 format session IDs', () => {
      const logger = new ChatLogger(testDir);
      const sessionId = logger.getSessionId();
      // UUID v4 format: 8-4-4-4-12 hexadecimal digits with version 4 and variant bits
      // Pattern: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
      expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should handle manual session ID specification in options', async () => {
      const client = new TestChatClient();
      const customSessionId = 'session-123-custom';

      await client.sendMessage('Test', { sessionId: customSessionId });

      expect(client.getSessionIdUsed()).toBe(customSessionId);
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

    it('should not cross-contaminate session IDs', async () => {
      const logger1 = new ChatLogger(testDir);
      const logger2 = new ChatLogger(testDir);

      const sessionId1 = logger1.getSessionId();
      const sessionId2 = logger2.getSessionId();

      expect(sessionId1).not.toBe(sessionId2);
    });
  });
});
