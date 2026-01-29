/**
 * Comprehensive tests for session continuity and timeout behavior
 * Tests cover session lifecycle, timeout scenarios, and recovery mechanisms
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { BaseChatClient, ChatSession, ChatOptions } from '../../../src/ai/base-chat-client';

// Test implementation of BaseChatClient with timeout support
class TestChatClientWithTimeout extends BaseChatClient {
  private sessionTimeout = 30000; // 30 seconds default
  private lastActivityTime: number = Date.now();
  private isTimedOut = false;
  private messageLog: Array<{ message: string; timestamp: number }> = [];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async sendMessage(message: string, options?: ChatOptions): Promise<void> {
    this.lastActivityTime = Date.now();
    this.isTimedOut = false;

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
    return 'Test Client With Timeout';
  }

  setSessionTimeout(timeoutMs: number): void {
    this.sessionTimeout = timeoutMs;
  }

  checkSessionTimeout(): boolean {
    const elapsed = Date.now() - this.lastActivityTime;
    this.isTimedOut = elapsed > this.sessionTimeout;
    return this.isTimedOut;
  }

  getSessionElapsedTime(): number {
    return Date.now() - this.lastActivityTime;
  }

  isSessionExpired(): boolean {
    return this.isTimedOut;
  }

  getMessageLog(): Array<{ message: string; timestamp: number }> {
    return this.messageLog;
  }

  clearMessageLog(): void {
    this.messageLog = [];
  }
}

describe('Session Continuity and Timeout Behavior', () => {
  let client: TestChatClientWithTimeout;

  beforeEach(() => {
    client = new TestChatClientWithTimeout();
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

    it('should calculate session duration from creation', async () => {
      const startTime = Date.now();
      await client.sendMessage('Message 1');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const session = client.getCurrentSession();
      const endTime = Date.now();

      const createdAt = session?.createdAt || new Date();
      const duration = endTime - createdAt.getTime();

      expect(duration).toBeGreaterThanOrEqual(50);
    });
  });

  describe('timeout detection', () => {
    it('should detect session timeout', async () => {
      client.setSessionTimeout(100);
      await client.sendMessage('Test');

      expect(client.checkSessionTimeout()).toBe(false);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(client.checkSessionTimeout()).toBe(true);
    });

    it('should not timeout before timeout period', async () => {
      client.setSessionTimeout(200);
      await client.sendMessage('Test');

      // Check at 50ms (before 200ms timeout)
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(client.checkSessionTimeout()).toBe(false);
    });

    it('should reset timeout on new message', async () => {
      client.setSessionTimeout(100);
      await client.sendMessage('Message 1');

      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(client.checkSessionTimeout()).toBe(false);

      // Send new message within timeout window
      await client.sendMessage('Message 2');

      // Timeout clock should reset
      expect(client.checkSessionTimeout()).toBe(false);
    });

    it('should report elapsed time since last activity', async () => {
      await client.sendMessage('Test');
      const elapsed1 = client.getSessionElapsedTime();

      await new Promise((resolve) => setTimeout(resolve, 50));
      const elapsed2 = client.getSessionElapsedTime();

      expect(elapsed2).toBeGreaterThan(elapsed1);
    });

    it('should track session expiration state', async () => {
      client.setSessionTimeout(100);
      await client.sendMessage('Test');

      expect(client.isSessionExpired()).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 150));
      client.checkSessionTimeout();

      expect(client.isSessionExpired()).toBe(true);
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
      const log1 = client.getMessageLog();

      await client.sendMessage('Message 2');
      const log2 = client.getMessageLog();

      expect(log2.length).toBe(log1.length + 1);
      expect(log2[0].message).toBe('Message 1');
      expect(log2[1].message).toBe('Message 2');
    });

    it('should allow resuming after timeout', async () => {
      client.setSessionTimeout(100);
      await client.sendMessage('Before timeout');

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));
      client.checkSessionTimeout();

      expect(client.isSessionExpired()).toBe(true);

      // Resume with new message
      await client.sendMessage('After timeout');

      // Should reset timeout
      expect(client.isSessionExpired()).toBe(false);
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

  describe('idle time tracking', () => {
    it('should track time since last message', async () => {
      await client.sendMessage('First message');
      const idleTime1 = client.getSessionElapsedTime();

      await new Promise((resolve) => setTimeout(resolve, 100));
      const idleTime2 = client.getSessionElapsedTime();

      expect(idleTime2).toBeGreaterThan(idleTime1);
    });

    it('should reset idle time on new message', async () => {
      await client.sendMessage('Message 1');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const idleTime1 = client.getSessionElapsedTime();

      await client.sendMessage('Message 2');
      const idleTime2 = client.getSessionElapsedTime();

      expect(idleTime2).toBeLessThan(idleTime1);
    });

    it('should accumulate idle time during inactive period', async () => {
      await client.sendMessage('Test');

      const times = [];
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        times.push(client.getSessionElapsedTime());
      }

      // Each measurement should be greater than the last
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThan(times[i - 1]);
      }
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

    it('should handle sparse messages with delays', async () => {
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();

      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await client.sendMessage(`Message ${i + 2}`);
      }

      const session2 = client.getCurrentSession();
      expect(session1?.id).toBe(session2?.id);
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
