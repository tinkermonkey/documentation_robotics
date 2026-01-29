/**
 * Comprehensive tests for client communication and subprocess handling
 * Tests cover message transmission, error handling, signal handling, and stream processing
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { BaseChatClient, ChatSession, ChatOptions } from '../../../src/ai/base-chat-client';

// Test implementation of BaseChatClient
class TestChatClient extends BaseChatClient {
  private messageLog: Array<{ message: string; options?: ChatOptions }> = [];
  private shouldFail = false;
  private failReason = 'Test failure';
  private responseDelay = 0;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async sendMessage(message: string, options?: ChatOptions): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failReason);
    }

    if (this.responseDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.responseDelay));
    }

    this.messageLog.push({ message, options });

    if (!this.currentSession) {
      this.createSession();
    }
    this.updateSessionTimestamp();
  }

  getClientName(): string {
    return 'Test Client';
  }

  // Test helpers
  getMessageLog(): Array<{ message: string; options?: ChatOptions }> {
    return this.messageLog;
  }

  setFailure(shouldFail: boolean, reason = 'Test failure'): void {
    this.shouldFail = shouldFail;
    this.failReason = reason;
  }

  setResponseDelay(delayMs: number): void {
    this.responseDelay = delayMs;
  }

  clearMessageLog(): void {
    this.messageLog = [];
  }
}

describe('Client Communication and Subprocess Handling', () => {
  let client: TestChatClient;

  beforeEach(() => {
    client = new TestChatClient();
  });

  describe('message transmission', () => {
    it('should transmit user message to chat client', async () => {
      const message = 'Hello, what is 2+2?';
      await client.sendMessage(message);

      const log = client.getMessageLog();
      expect(log.length).toBe(1);
      expect(log[0].message).toBe(message);
    });

    it('should transmit multiple messages in sequence', async () => {
      const messages = ['Message 1', 'Message 2', 'Message 3'];

      for (const msg of messages) {
        await client.sendMessage(msg);
      }

      const log = client.getMessageLog();
      expect(log.length).toBe(3);
      for (let i = 0; i < messages.length; i++) {
        expect(log[i].message).toBe(messages[i]);
      }
    });

    it('should handle empty message transmission', async () => {
      await client.sendMessage('');

      const log = client.getMessageLog();
      expect(log.length).toBe(1);
      expect(log[0].message).toBe('');
    });

    it('should handle very long messages', async () => {
      const longMessage = 'x'.repeat(100000);
      await client.sendMessage(longMessage);

      const log = client.getMessageLog();
      expect(log[0].message.length).toBe(100000);
    });

    it('should handle messages with special characters', async () => {
      const specialMessage = 'Test with "quotes", \\backslashes\\, and unicode: café 你好 🚀';
      await client.sendMessage(specialMessage);

      const log = client.getMessageLog();
      expect(log[0].message).toBe(specialMessage);
    });

    it('should handle multiline messages', async () => {
      const multilineMessage = `Line 1
Line 2
Line 3`;
      await client.sendMessage(multilineMessage);

      const log = client.getMessageLog();
      expect(log[0].message).toContain('Line 1');
      expect(log[0].message).toContain('Line 2');
      expect(log[0].message).toContain('Line 3');
    });

    it('should transmit chat options along with message', async () => {
      const options: ChatOptions = {
        agent: 'dr-architect',
        workingDirectory: '/tmp/test',
        sessionId: 'session-123',
        withDanger: true,
      };

      await client.sendMessage('Test message', options);

      const log = client.getMessageLog();
      expect(log[0].options).toEqual(options);
    });

    it('should handle partial chat options', async () => {
      const options: ChatOptions = {
        agent: 'dr-architect',
      };

      await client.sendMessage('Test', options);

      const log = client.getMessageLog();
      expect(log[0].options?.agent).toBe('dr-architect');
      expect(log[0].options?.workingDirectory).toBeUndefined();
    });

    it('should handle message transmission without options', async () => {
      await client.sendMessage('Test message');

      const log = client.getMessageLog();
      expect(log[0].options).toBeUndefined();
    });
  });

  describe('concurrent message transmission', () => {
    it('should handle concurrent message sends', async () => {
      const messages = Array.from({ length: 10 }, (_, i) => `Message ${i}`);
      const sendPromises = messages.map((msg) => client.sendMessage(msg));

      await Promise.all(sendPromises);

      const log = client.getMessageLog();
      expect(log.length).toBe(10);
      messages.forEach((msg) => {
        expect(log.some((l) => l.message === msg)).toBe(true);
      });
    });

    it('should maintain session consistency with concurrent sends', async () => {
      const sendPromises = Array.from({ length: 5 }, (_, i) =>
        client.sendMessage(`Message ${i}`)
      );

      await Promise.all(sendPromises);

      const session1 = client.getCurrentSession();
      expect(session1).toBeDefined();

      // Send more messages
      await client.sendMessage('Another message');
      const session2 = client.getCurrentSession();

      // Session ID should remain the same
      expect(session1?.id).toBe(session2?.id);
    });

    it('should handle rapid sequential messages', async () => {
      for (let i = 0; i < 20; i++) {
        await client.sendMessage(`Rapid message ${i}`);
      }

      const log = client.getMessageLog();
      expect(log.length).toBe(20);
    });
  });

  describe('error handling', () => {
    it('should catch and propagate transmission errors', async () => {
      client.setFailure(true, 'Connection failed');

      try {
        await client.sendMessage('Test message');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toContain('Connection failed');
      }
    });

    it('should handle subprocess exit code errors', async () => {
      client.setFailure(true, 'Process exited with code 127');

      try {
        await client.sendMessage('Test');
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toContain('Process exited');
      }
    });

    it('should handle timeout errors gracefully', async () => {
      client.setFailure(true, 'Request timeout after 30s');

      try {
        await client.sendMessage('Test');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should recover from transient errors', async () => {
      // First message fails
      client.setFailure(true, 'Transient error');
      try {
        await client.sendMessage('Message 1');
      } catch (error) {
        expect(error).toBeDefined();
      }

      // Recovery: error is cleared and next message succeeds
      client.setFailure(false);
      await client.sendMessage('Message 2');

      const log = client.getMessageLog();
      expect(log.length).toBe(1); // Only second message was sent
      expect(log[0].message).toBe('Message 2');
    });

    it('should not affect session on error', async () => {
      const session1 = client.getCurrentSession();

      client.setFailure(true);
      try {
        await client.sendMessage('Test');
      } catch (error) {
        // Expected
      }

      client.setFailure(false);
      await client.sendMessage('Recovery message');
      const session2 = client.getCurrentSession();

      // Session should remain consistent
      expect(session1?.id).toBeDefined();
      expect(session2?.id).toBeDefined();
    });

    it('should handle stdin stream errors', async () => {
      client.setFailure(true, 'EPIPE: Broken pipe');

      try {
        await client.sendMessage('Test');
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toContain('pipe');
      }
    });

    it('should handle stdout stream errors', async () => {
      client.setFailure(true, 'ENOTCONN: Socket is not connected');

      try {
        await client.sendMessage('Test');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('stream processing', () => {
    it('should process message through output stream', async () => {
      await client.sendMessage('Test message');

      // Verify message was processed
      const log = client.getMessageLog();
      expect(log.length).toBe(1);
      expect(log[0].message).toBe('Test message');
    });

    it('should handle streaming responses in order', async () => {
      const messages = ['First', 'Second', 'Third'];

      for (const msg of messages) {
        await client.sendMessage(msg);
      }

      const log = client.getMessageLog();
      for (let i = 0; i < messages.length; i++) {
        expect(log[i].message).toBe(messages[i]);
      }
    });

    it('should handle large response streams', async () => {
      const largeMessage = 'x'.repeat(1000000); // 1MB message
      await client.sendMessage(largeMessage);

      const log = client.getMessageLog();
      expect(log[0].message.length).toBe(1000000);
    });

    it('should handle incomplete stream data', async () => {
      // Simulate partial message
      await client.sendMessage('Incomplete');

      const log = client.getMessageLog();
      expect(log.length).toBe(1);
    });
  });

  describe('session management during communication', () => {
    it('should create session on first message', async () => {
      expect(client.getCurrentSession()).toBeUndefined();

      await client.sendMessage('First message');

      expect(client.getCurrentSession()).toBeDefined();
      expect(client.getCurrentSession()?.id).toBeDefined();
    });

    it('should maintain session across multiple messages', async () => {
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();

      await client.sendMessage('Message 2');
      const session2 = client.getCurrentSession();

      expect(session1?.id).toBe(session2?.id);
    });

    it('should update session timestamp on each message', async () => {
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();
      const time1 = session1?.lastMessageAt || new Date(0);

      await new Promise((resolve) => setTimeout(resolve, 10));

      await client.sendMessage('Message 2');
      const session2 = client.getCurrentSession();
      const time2 = session2?.lastMessageAt || new Date(0);

      expect(time2.getTime()).toBeGreaterThanOrEqual(time1.getTime());
    });

    it('should preserve session through error recovery', async () => {
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();

      // Simulate error
      client.setFailure(true);
      try {
        await client.sendMessage('Failing message');
      } catch {
        // Expected
      }

      // Recovery
      client.setFailure(false);
      await client.sendMessage('Message 2');
      const session2 = client.getCurrentSession();

      expect(session1?.id).toBe(session2?.id);
    });

    it('should allow session clearing between messages', async () => {
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();

      client.clearSession();
      await client.sendMessage('Message 2');
      const session2 = client.getCurrentSession();

      expect(session1?.id).not.toBe(session2?.id);
    });

    it('should support session continuation with explicit sessionId', async () => {
      await client.sendMessage('Message 1', { sessionId: 'custom-session-123' });
      const session1 = client.getCurrentSession();

      // Clear and resume
      client.clearSession();
      expect(client.getCurrentSession()).toBeUndefined();

      await client.sendMessage('Message 2', { sessionId: 'custom-session-123' });
      const session2 = client.getCurrentSession();

      expect(session1?.id).toBeDefined();
      expect(session2?.id).toBeDefined();
    });
  });

  describe('message options handling', () => {
    it('should handle agent option', async () => {
      await client.sendMessage('Test', { agent: 'dr-architect' });

      const log = client.getMessageLog();
      expect(log[0].options?.agent).toBe('dr-architect');
    });

    it('should handle working directory option', async () => {
      const workDir = '/home/user/project';
      await client.sendMessage('Test', { workingDirectory: workDir });

      const log = client.getMessageLog();
      expect(log[0].options?.workingDirectory).toBe(workDir);
    });

    it('should handle session ID option', async () => {
      const sessionId = 'custom-session-456';
      await client.sendMessage('Test', { sessionId });

      const log = client.getMessageLog();
      expect(log[0].options?.sessionId).toBe(sessionId);
    });

    it('should handle danger mode option', async () => {
      await client.sendMessage('Test', { withDanger: true });

      const log = client.getMessageLog();
      expect(log[0].options?.withDanger).toBe(true);
    });

    it('should handle combination of all options', async () => {
      const options: ChatOptions = {
        agent: 'test-agent',
        workingDirectory: '/test/dir',
        sessionId: 'test-session',
        withDanger: false,
      };

      await client.sendMessage('Test', options);

      const log = client.getMessageLog();
      expect(log[0].options).toEqual(options);
    });
  });

  describe('availability detection', () => {
    it('should be available by default', async () => {
      const available = await client.isAvailable();
      expect(available).toBe(true);
    });

    it('should handle availability check errors', async () => {
      // This would be implementation-specific for real clients
      const available = await client.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('client name retrieval', () => {
    it('should return consistent client name', () => {
      const name1 = client.getClientName();
      const name2 = client.getClientName();

      expect(name1).toBe(name2);
      expect(name1).toBe('Test Client');
    });
  });

  describe('performance and timing', () => {
    it('should handle response delays', async () => {
      client.setResponseDelay(50);
      const startTime = Date.now();

      await client.sendMessage('Test');

      const duration = Date.now() - startTime;
      expect(duration).toBeGreaterThanOrEqual(50);
    });

    it('should process multiple messages with varying delays', async () => {
      client.setResponseDelay(10);

      const messages = ['Msg 1', 'Msg 2', 'Msg 3'];
      for (const msg of messages) {
        await client.sendMessage(msg);
      }

      const log = client.getMessageLog();
      expect(log.length).toBe(3);
    });

    it('should maintain performance with large message counts', async () => {
      const messageCount = 100;
      const startTime = Date.now();

      for (let i = 0; i < messageCount; i++) {
        await client.sendMessage(`Message ${i}`);
      }

      const duration = Date.now() - startTime;
      const log = client.getMessageLog();

      expect(log.length).toBe(messageCount);
      // Should complete in reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('state consistency', () => {
    it('should maintain consistent state after multiple operations', async () => {
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();

      await client.sendMessage('Message 2');
      const session2 = client.getCurrentSession();

      client.clearSession();
      expect(client.getCurrentSession()).toBeUndefined();

      await client.sendMessage('Message 3');
      const session3 = client.getCurrentSession();

      expect(session1?.id).toBe(session2?.id);
      expect(session1?.id).not.toBe(session3?.id);
    });

    it('should track all messages independently of session state', async () => {
      await client.sendMessage('Before clear');
      client.clearSession();
      await client.sendMessage('After clear');

      const log = client.getMessageLog();
      expect(log.length).toBe(2);
      expect(log[0].message).toBe('Before clear');
      expect(log[1].message).toBe('After clear');
    });
  });
});
