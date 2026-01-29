/**
 * Tests for session continuity behavior
 * Tests cover session lifecycle and recovery mechanisms
 * Note: Timeout behavior is not implemented in BaseChatClient
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { BaseChatClient, ChatSession, ChatOptions } from '../../../src/ai/base-chat-client';

// Simple test implementation of BaseChatClient
class TestChatClient extends BaseChatClient {
  private messageLog: Array<{ message: string; timestamp: number }> = [];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async sendMessage(message: string, options?: ChatOptions): Promise<void> {
    if (!this.currentSession) {
      this.createSession();
    }
    this.updateSessionTimestamp();

    this.messageLog.push({
      message,
      timestamp: Date.now(),
    });
  }

  getClientName(): string {
    return 'Test Client';
  }

  getMessageLog(): Array<{ message: string; timestamp: number }> {
    return this.messageLog;
  }

  clearMessageLog(): void {
    this.messageLog = [];
  }
}

describe('Session Continuity and Timeout Behavior', () => {
  let client: TestChatClient;

  beforeEach(() => {
    client = new TestChatClient();
    client.clearMessageLog();
  });

  describe('session lifecycle', () => {
    it('should create session on first message', async () => {
      expect(client.getCurrentSession()).toBeUndefined();

      await client.sendMessage('First message');

      expect(client.getCurrentSession()).toBeDefined();
    });

    it('should maintain session through multiple messages', async () => {
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();

      await client.sendMessage('Message 2');
      const session2 = client.getCurrentSession();

      await client.sendMessage('Message 3');
      const session3 = client.getCurrentSession();

      expect(session1?.id).toBe(session2?.id);
      expect(session2?.id).toBe(session3?.id);
    });

    it('should preserve session creation timestamp', async () => {
      const beforeTime = new Date();
      await client.sendMessage('Test');
      const afterTime = new Date();

      const session = client.getCurrentSession();
      const createdTime = session?.createdAt || new Date();

      expect(createdTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(createdTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should track last message timestamp', async () => {
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();
      const lastTime1 = session1?.lastMessageAt || new Date();

      await new Promise((resolve) => setTimeout(resolve, 10));

      await client.sendMessage('Message 2');
      const session2 = client.getCurrentSession();
      const lastTime2 = session2?.lastMessageAt || new Date();

      expect(lastTime2.getTime()).toBeGreaterThanOrEqual(lastTime1.getTime());
    });

  });

  describe('session recovery', () => {
    it('should allow new session after clearing', async () => {
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();

      client.clearSession();
      expect(client.getCurrentSession()).toBeUndefined();

      await client.sendMessage('Message 2');
      const session2 = client.getCurrentSession();

      expect(session1?.id).not.toBe(session2?.id);
    });

    it('should resume session with explicit session ID', async () => {
      const customSessionId = 'custom-session-123';
      await client.sendMessage('Message 1', { sessionId: customSessionId });

      client.clearSession();
      await client.sendMessage('Message 2', { sessionId: customSessionId });

      const session = client.getCurrentSession();
      expect(session).toBeDefined();
    });

    it('should preserve message history across session operations', async () => {
      await client.sendMessage('Message 1');
      const log1Length = client.getMessageLog().length;

      await client.sendMessage('Message 2');
      const log2 = client.getMessageLog();

      expect(log2.length).toBe(log1Length + 1);
      expect(log2[0].message).toBe('Message 1');
      expect(log2[1].message).toBe('Message 2');
    });
  });

  describe('concurrent message handling with continuity', () => {
    it('should maintain session continuity with concurrent sends', async () => {
      const messages = Array.from({ length: 5 }, (_, i) => `Message ${i}`);
      const sendPromises = messages.map((msg) => client.sendMessage(msg));

      await Promise.all(sendPromises);

      const session1 = client.getCurrentSession();
      await client.sendMessage('Sequential message');
      const session2 = client.getCurrentSession();

      // Session should be same despite concurrent sends
      expect(session1?.id).toBe(session2?.id);
    });

    it('should track all messages regardless of concurrency', async () => {
      const sendPromises = Array.from({ length: 10 }, (_, i) =>
        client.sendMessage(`Message ${i}`)
      );

      await Promise.all(sendPromises);

      const log = client.getMessageLog();
      expect(log.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('session state transitions', () => {
    it('should transition from no session to active session', async () => {
      expect(client.getCurrentSession()).toBeUndefined();

      await client.sendMessage('Test');

      expect(client.getCurrentSession()).toBeDefined();
    });

    it('should transition from active session to no session on clear', async () => {
      await client.sendMessage('Test');
      expect(client.getCurrentSession()).toBeDefined();

      client.clearSession();
      expect(client.getCurrentSession()).toBeUndefined();
    });

    it('should transition through multiple session cycles', async () => {
      const sessionIds = [];

      for (let i = 0; i < 3; i++) {
        expect(client.getCurrentSession()).toBeUndefined();

        await client.sendMessage(`Message in session ${i}`);
        const session = client.getCurrentSession();
        sessionIds.push(session?.id);

        client.clearSession();
        expect(client.getCurrentSession()).toBeUndefined();
      }

      // All session IDs should be unique
      const uniqueIds = new Set(sessionIds);
      expect(uniqueIds.size).toBe(3);
    });

    it('should handle rapid state transitions', async () => {
      for (let i = 0; i < 10; i++) {
        await client.sendMessage(`Message ${i}`);
        client.clearSession();
      }

      // Should complete without errors
      expect(client.getCurrentSession()).toBeUndefined();
    });
  });


  describe('session metadata preservation', () => {
    it('should preserve session creation details', async () => {
      const beforeCreate = new Date();
      await client.sendMessage('Test');
      const afterCreate = new Date();

      const session = client.getCurrentSession();
      expect(session?.id).toBeDefined();
      expect(session?.createdAt).toBeDefined();
      expect(session?.lastMessageAt).toBeDefined();

      const createdTime = session?.createdAt || new Date();
      expect(createdTime.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(createdTime.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
    });

    it('should preserve session through extended communication', async () => {
      await client.sendMessage('Start');
      const session1 = client.getCurrentSession();

      for (let i = 0; i < 20; i++) {
        await client.sendMessage(`Message ${i}`);
        const session = client.getCurrentSession();
        expect(session?.id).toBe(session1?.id);
      }
    });
  });

  describe('session continuity with options', () => {
    it('should continue session with consistent working directory', async () => {
      const workDir = '/home/user/project';

      await client.sendMessage('Message 1', { workingDirectory: workDir });
      const session1 = client.getCurrentSession();

      await client.sendMessage('Message 2', { workingDirectory: workDir });
      const session2 = client.getCurrentSession();

      expect(session1?.id).toBe(session2?.id);
    });

    it('should continue session with same agent', async () => {
      const agent = 'dr-architect';

      await client.sendMessage('Message 1', { agent });
      const session1 = client.getCurrentSession();

      await client.sendMessage('Message 2', { agent });
      const session2 = client.getCurrentSession();

      expect(session1?.id).toBe(session2?.id);
    });

    it('should allow changing options within same session', async () => {
      await client.sendMessage('Message 1', {
        workingDirectory: '/dir1',
        agent: 'agent1',
      });
      const session1 = client.getCurrentSession();

      await client.sendMessage('Message 2', {
        workingDirectory: '/dir2',
        agent: 'agent2',
      });
      const session2 = client.getCurrentSession();

      // Session should remain same even with different options
      expect(session1?.id).toBe(session2?.id);
    });
  });

  describe('graceful session closure', () => {
    it('should allow clearing session', async () => {
      await client.sendMessage('Test');
      expect(client.getCurrentSession()).toBeDefined();

      client.clearSession();
      expect(client.getCurrentSession()).toBeUndefined();
    });

    it('should allow starting new session after clear', async () => {
      await client.sendMessage('Session 1');
      const session1 = client.getCurrentSession();

      client.clearSession();

      await client.sendMessage('Session 2');
      const session2 = client.getCurrentSession();

      expect(session1?.id).not.toBe(session2?.id);
    });

    it('should handle multiple consecutive clears', async () => {
      await client.sendMessage('Test');
      client.clearSession();
      client.clearSession();
      client.clearSession();

      expect(client.getCurrentSession()).toBeUndefined();
    });
  });

  describe('session activity patterns', () => {
    it('should handle burst of messages', async () => {
      const startSession = client.getCurrentSession();

      for (let i = 0; i < 10; i++) {
        await client.sendMessage(`Burst message ${i}`);
      }

      const endSession = client.getCurrentSession();

      expect(startSession?.id).toBeUndefined();
      expect(endSession?.id).toBeDefined();
      expect(client.getMessageLog().length).toBe(10);
    });

    it('should track message sequence with timestamps', async () => {
      const messages = ['A', 'B', 'C', 'D'];

      for (const msg of messages) {
        await client.sendMessage(msg);
      }

      const log = client.getMessageLog();
      expect(log.length).toBe(4);

      // Verify message order and timestamps are increasing
      for (let i = 1; i < log.length; i++) {
        expect(log[i].timestamp).toBeGreaterThanOrEqual(log[i - 1].timestamp);
      }
    });
  });
});
