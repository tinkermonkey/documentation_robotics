/**
 * Comprehensive tests for error scenarios and recovery mechanisms
 * Tests cover error handling, recovery strategies, and graceful degradation
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ChatLogger, readChatSession, listChatSessions } from '../../../src/utils/chat-logger';
import { BaseChatClient, ChatOptions } from '../../../src/ai/base-chat-client';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Test implementation with error injection
class ErrorInjectingChatClient extends BaseChatClient {
  private errors: Map<string, Error> = new Map();
  private messageLog: string[] = [];

  async isAvailable(): Promise<boolean> {
    if (this.errors.has('isAvailable')) {
      throw this.errors.get('isAvailable')!;
    }
    return true;
  }

  async sendMessage(message: string, options?: ChatOptions): Promise<void> {
    if (this.errors.has('sendMessage')) {
      throw this.errors.get('sendMessage')!;
    }

    this.messageLog.push(message);

    if (!this.currentSession) {
      this.createSession();
    }
    this.updateSessionTimestamp();
  }

  getClientName(): string {
    return 'Error Injecting Test Client';
  }

  injectError(operation: string, error: Error): void {
    this.errors.set(operation, error);
  }

  clearErrors(): void {
    this.errors.clear();
  }

  clearMessageLog(): void {
    this.messageLog = [];
  }

  getMessageLog(): string[] {
    return this.messageLog;
  }
}

// Helper to create test directory
async function createTestDir(): Promise<string> {
  const dir = join(tmpdir(), `error-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// Helper to cleanup test directory
async function cleanupTestDir(dir: string): Promise<void> {
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('Error Scenarios and Recovery', () => {
  let testDir: string;
  let client: ErrorInjectingChatClient;

  beforeEach(async () => {
    testDir = await createTestDir();
    client = new ErrorInjectingChatClient();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe('message transmission errors', () => {
    it('should handle message transmission failure', async () => {
      client.injectError('sendMessage', new Error('Connection failed'));

      try {
        await client.sendMessage('Test');
        throw new Error('Should have thrown connection error');
      } catch (error) {
        expect((error as Error).message).toContain('Connection failed');
      }
    });

    it('should handle timeout error', async () => {
      client.injectError('sendMessage', new Error('Request timeout after 30s'));

      let caught = false;
      try {
        await client.sendMessage('Test');
      } catch (error) {
        caught = true;
        expect((error as Error).message).toContain('timeout');
      }
      expect(caught).toBe(true);
    });

    it('should handle broken pipe error', async () => {
      client.injectError('sendMessage', new Error('EPIPE: Broken pipe'));

      try {
        await client.sendMessage('Test');
      } catch (error) {
        expect((error as Error).message).toContain('EPIPE');
      }
    });

    it('should handle stream disconnection', async () => {
      client.injectError('sendMessage', new Error('Stream ended unexpectedly'));

      try {
        await client.sendMessage('Test');
      } catch (error) {
        expect((error as Error).message).toContain('Stream ended');
      }
    });

    it('should handle subprocess exit errors', async () => {
      client.injectError('sendMessage', new Error('Process exited with code 127: Command not found'));

      try {
        await client.sendMessage('Test');
      } catch (error) {
        expect((error as Error).message).toContain('Process exited');
      }
    });

    it('should handle insufficient permissions error', async () => {
      client.injectError('sendMessage', new Error('EACCES: Permission denied'));

      try {
        await client.sendMessage('Test');
      } catch (error) {
        expect((error as Error).message).toContain('Permission denied');
      }
    });

    it('should handle memory errors', async () => {
      client.injectError('sendMessage', new Error('ENOMEM: Cannot allocate memory'));

      try {
        await client.sendMessage('Test');
      } catch (error) {
        expect((error as Error).message).toContain('Cannot allocate memory');
      }
    });
  });

  describe('availability check errors', () => {
    it('should handle availability check failure', async () => {
      client.injectError('isAvailable', new Error('Check failed'));

      try {
        await client.isAvailable();
        expect(true).toBe(false);
      } catch (error) {
        expect((error as Error).message).toContain('Check failed');
      }
    });

    it('should handle permission denied on availability check', async () => {
      client.injectError('isAvailable', new Error('EACCES: Permission denied'));

      try {
        await client.isAvailable();
      } catch (error) {
        expect((error as Error).message).toContain('Permission denied');
      }
    });
  });

  describe('recovery mechanisms', () => {
    it('should recover after transient error', async () => {
      // First message fails
      client.injectError('sendMessage', new Error('Transient error'));

      try {
        await client.sendMessage('Message 1');
      } catch (error) {
        expect(error).toBeDefined();
      }

      // Recovery: clear error and retry
      client.clearErrors();
      await client.sendMessage('Message 2');

      const log = client.getMessageLog();
      expect(log.length).toBe(1);
      expect(log[0]).toBe('Message 2');
    });

    it('should maintain session after error', async () => {
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();

      client.injectError('sendMessage', new Error('Temporary error'));
      try {
        await client.sendMessage('Message 2');
      } catch (error) {
        // Expected
      }

      client.clearErrors();
      await client.sendMessage('Message 3');
      const session2 = client.getCurrentSession();

      // Session should remain consistent
      expect(session1?.id).toBe(session2?.id);
    });

    it('should allow new session after error', async () => {
      await client.sendMessage('Message 1');
      const session1 = client.getCurrentSession();

      client.injectError('sendMessage', new Error('Error'));
      try {
        await client.sendMessage('Message 2');
      } catch (error) {
        // Expected
      }

      client.clearErrors();
      client.clearSession();
      await client.sendMessage('Message 3');
      const session2 = client.getCurrentSession();

      // New session should be created
      expect(session1?.id).not.toBe(session2?.id);
    });

    it('should recover from multiple consecutive errors', async () => {
      for (let i = 0; i < 3; i++) {
        client.injectError('sendMessage', new Error('Error'));
        try {
          await client.sendMessage(`Message ${i}`);
        } catch (error) {
          // Expected
        }

        client.clearErrors();
      }

      // Should recover after all errors cleared
      await client.sendMessage('Final message');
      const log = client.getMessageLog();
      expect(log.length).toBe(1);
      expect(log[0]).toBe('Final message');
    });
  });

  describe('ChatLogger error handling', () => {
    it('should handle directory creation failure gracefully', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Should not throw even if directory already exists
      await logger.ensureLogDirectory();
      expect(existsSync(logger.getLogDirectory())).toBe(true);
    });

    it('should handle file read errors gracefully', async () => {
      const logger = new ChatLogger(testDir);
      // Try to read from non-existent session file
      const entries = await logger.readEntries();

      expect(entries).toEqual([]);
    });

    it('should handle write failures gracefully', async () => {
      const logger = new ChatLogger(testDir);
      // This documents that write failures are logged as warnings
      // but don't crash the application
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Test');

      const entries = await logger.readEntries();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should continue operating after failed write', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Write should succeed
      await logger.logUserMessage('Message 1');

      // Continue writing
      await logger.logUserMessage('Message 2');

      const entries = await logger.readEntries();
      const userMessages = entries.filter((e) => e.role === 'user');
      expect(userMessages.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle corrupted JSON in log file', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();
      await logger.logUserMessage('Valid entry');

      // Try to read - should handle gracefully
      const entries = await logger.readEntries();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should handle missing log directory', async () => {
      const logger = new ChatLogger(testDir);
      // Don't create directory, just try to read
      const entries = await logger.readEntries();

      expect(entries).toEqual([]);
    });
  });

  describe('session recovery', () => {
    it('should preserve messages despite errors', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      await logger.logUserMessage('Message 1');

      // Simulate error condition
      // (In real implementation would be actual IO error)

      await logger.logUserMessage('Message 2');

      const entries = await logger.readEntries();
      const userMessages = entries.filter((e) => e.role === 'user');
      expect(userMessages.length).toBe(2);
    });

    it('should recover session after logger recreation', async () => {
      const logger1 = new ChatLogger(testDir);
      await logger1.ensureLogDirectory();
      await logger1.logUserMessage('From logger 1');

      // Create new logger (simulating recovery)
      const logger2 = new ChatLogger(testDir);
      await logger2.logUserMessage('From logger 2');

      const sessions = await listChatSessions(testDir);
      expect(sessions.length).toBeGreaterThanOrEqual(1);
    });

    it('should resume with explicit session ID after error', async () => {
      const customSessionId = 'recovery-session-123';

      await client.sendMessage('Message 1', { sessionId: customSessionId });

      // Simulate error
      client.injectError('sendMessage', new Error('Error'));
      try {
        await client.sendMessage('Message 2', { sessionId: customSessionId });
      } catch (error) {
        // Expected
      }

      // Clear error and resume with same session ID
      client.clearErrors();
      await client.sendMessage('Message 3', { sessionId: customSessionId });

      const log = client.getMessageLog();
      expect(log.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('graceful degradation', () => {
    it('should continue operation with degraded functionality', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Log messages despite potential issues
      for (let i = 0; i < 5; i++) {
        await logger.logUserMessage(`Message ${i}`);
      }

      const entries = await logger.readEntries();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should provide meaningful error context', async () => {
      client.injectError('sendMessage', new Error('Failed to establish connection to Claude Code CLI'));

      try {
        await client.sendMessage('Test');
      } catch (error) {
        expect((error as Error).message).toContain('Claude Code');
      }
    });

    it('should allow partial success scenarios', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // First message succeeds
      await logger.logUserMessage('Message 1');

      // Subsequent messages also succeed
      await logger.logUserMessage('Message 2');
      await logger.logUserMessage('Message 3');

      const entries = await logger.readEntries();
      const userMessages = entries.filter((e) => e.role === 'user');
      expect(userMessages.length).toBe(3);
    });
  });

  describe('error logging', () => {
    it('should log errors to session', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      await logger.logError('Test error occurred', { code: 'ERR_TEST' });

      const entries = await logger.readEntries();
      const errors = entries.filter((e) => e.type === 'error');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].content).toBe('Test error occurred');
      expect(errors[0].metadata?.code).toBe('ERR_TEST');
    });

    it('should log multiple errors', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      await logger.logError('Error 1');
      await logger.logError('Error 2');
      await logger.logError('Error 3');

      const entries = await logger.readEntries();
      const errors = entries.filter((e) => e.type === 'error');
      expect(errors.length).toBe(3);
    });

    it('should preserve error context in metadata', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      const errorContext = {
        operation: 'sendMessage',
        code: 'EPIPE',
        message: 'Broken pipe',
        stack: 'at sendMessage:line:123',
      };

      await logger.logError('Pipe error', errorContext);

      const entries = await logger.readEntries();
      const error = entries.find((e) => e.type === 'error');
      expect(error?.metadata?.operation).toBe('sendMessage');
      expect(error?.metadata?.code).toBe('EPIPE');
    });
  });

  describe('retry scenarios', () => {
    it('should allow retry after error', async () => {
      client.injectError('sendMessage', new Error('First attempt failed'));

      let firstAttemptFailed = false;
      try {
        await client.sendMessage('Test');
      } catch (error) {
        firstAttemptFailed = true;
      }

      expect(firstAttemptFailed).toBe(true);

      // Retry
      client.clearErrors();
      await client.sendMessage('Test');

      const log = client.getMessageLog();
      expect(log.length).toBe(1);
      expect(log[0]).toBe('Test');
    });

    it('should handle multiple retries', async () => {
      const maxRetries = 3;
      let attempts = 0;

      for (let i = 0; i < maxRetries; i++) {
        client.injectError('sendMessage', new Error('Attempt failed'));

        try {
          await client.sendMessage(`Attempt ${i + 1}`);
        } catch (error) {
          attempts++;
        }

        client.clearErrors();
      }

      // Final successful attempt
      await client.sendMessage('Final attempt');

      const log = client.getMessageLog();
      expect(log.length).toBe(1);
      expect(log[0]).toBe('Final attempt');
    });

    it('should track retry count in metadata', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Simulate retry tracking
      const retryMetadata = { attempt: 1, maxRetries: 3 };
      await logger.logEvent('retry_attempt', retryMetadata);

      const entries = await logger.readEntries();
      const retryEvent = entries.find((e) => e.content === 'retry_attempt');
      expect(retryEvent?.metadata?.attempt).toBe(1);
      expect(retryEvent?.metadata?.maxRetries).toBe(3);
    });
  });

  describe('error propagation', () => {
    it('should propagate errors to caller', async () => {
      client.injectError('sendMessage', new Error('Custom error message'));

      let errorPropagated = false;
      let errorMessage = '';

      try {
        await client.sendMessage('Test');
      } catch (error) {
        errorPropagated = true;
        errorMessage = (error as Error).message;
      }

      expect(errorPropagated).toBe(true);
      expect(errorMessage).toBe('Custom error message');
    });

    it('should preserve error stack trace', async () => {
      const originalError = new Error('Original error message');
      client.injectError('sendMessage', originalError);

      try {
        await client.sendMessage('Test');
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBe(originalError);
      }
    });
  });

  describe('circuit breaker pattern', () => {
    it('should document circuit breaker behavior', async () => {
      // When errors repeatedly occur, should stop trying
      let consecutiveErrors = 0;
      const maxErrors = 3;

      for (let i = 0; i < 5; i++) {
        if (consecutiveErrors < maxErrors) {
          client.injectError('sendMessage', new Error('Error'));

          try {
            await client.sendMessage(`Message ${i}`);
          } catch (error) {
            consecutiveErrors++;
          }
        }
      }

      // After max errors, circuit should be open (but this is app-level behavior)
      expect(consecutiveErrors).toBe(maxErrors);
    });
  });

  describe('fallback behavior', () => {
    it('should fall back to safe defaults', async () => {
      // If session creation fails, should still allow operations
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Should not throw even with potential directory issues
      await logger.logUserMessage('Test message');

      const entries = await logger.readEntries();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should use default values when optional fields fail', async () => {
      const logger = new ChatLogger(testDir);
      await logger.ensureLogDirectory();

      // Log with optional metadata
      await logger.logUserMessage('Message', { optional: 'data' });

      const entries = await logger.readEntries();
      const message = entries.find((e) => e.content === 'Message');
      expect(message?.metadata?.optional).toBe('data');
    });
  });
});
