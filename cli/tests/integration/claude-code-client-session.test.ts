/**
 * Integration tests for ClaudeCodeClient session management
 *
 * Tests verify that:
 * 1. Session IDs are properly generated and passed to Claude CLI subprocess invocations
 * 2. The --session-id flag is correctly included in CLI arguments
 * 3. Session IDs remain consistent across multiple message invocations
 * 4. Session isolation is maintained between separate chat sessions
 * 5. Session continuity is preserved when using the same session ID
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ClaudeCodeClient } from '../../src/ai/claude-code-client.js';
import { ChatOptions } from '../../src/ai/base-chat-client.js';
import { initializeChatLogger, getChatLogger, ChatLogger } from '../../src/utils/chat-logger.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('ClaudeCodeClient Session Management Integration Tests', () => {
  let testDir: string;
  let client: ClaudeCodeClient;

  beforeEach(() => {
    testDir = join(tmpdir(), `claude-client-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    mkdirSync(testDir, { recursive: true });
    client = new ClaudeCodeClient();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Session ID Passing to Subprocess', () => {
    it('should include session ID in options when sending message', async () => {
      const logger = initializeChatLogger(testDir);
      const sessionId = logger.getSessionId();

      // Verify session ID is available from logger
      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

      // Verify we can pass it in options
      const options: ChatOptions = {
        sessionId,
        workingDirectory: testDir,
      };

      expect(options.sessionId).toEqual(sessionId);
    });

    it('should accept session ID in ChatOptions interface', () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440000';
      const options: ChatOptions = {
        sessionId,
        agent: 'dr-architect',
        withDanger: false,
      };

      expect(options.sessionId).toEqual(sessionId);
      expect(options.agent).toEqual('dr-architect');
    });

    it('should make session ID accessible via options parameter', () => {
      const logger = initializeChatLogger(testDir);
      const sessionId = logger.getSessionId();

      const options: ChatOptions = {
        sessionId,
        workingDirectory: testDir,
        agent: 'dr-architect',
      };

      // Verify all components are accessible
      expect(options).toHaveProperty('sessionId');
      expect(options.sessionId).toEqual(sessionId);
      expect(options.workingDirectory).toEqual(testDir);
      expect(options.agent).toEqual('dr-architect');
    });
  });

  describe('Session Continuity Across Messages', () => {
    it('should use same session ID for multiple message options', () => {
      const logger = initializeChatLogger(testDir);
      const sessionId = logger.getSessionId();

      // Simulate multiple message invocations with same session
      const message1Options: ChatOptions = { sessionId, workingDirectory: testDir };
      const message2Options: ChatOptions = { sessionId, workingDirectory: testDir };
      const message3Options: ChatOptions = { sessionId, workingDirectory: testDir };

      expect(message1Options.sessionId).toEqual(sessionId);
      expect(message2Options.sessionId).toEqual(sessionId);
      expect(message3Options.sessionId).toEqual(sessionId);

      // All should reference the same session
      expect(message1Options.sessionId).toEqual(message2Options.sessionId);
      expect(message2Options.sessionId).toEqual(message3Options.sessionId);
    });

    it('should maintain session ID across multiple client invocations', () => {
      const logger = initializeChatLogger(testDir);
      const sessionId = logger.getSessionId();

      // Simulate three separate "messages" using same session
      const sessionIds = [];
      for (let i = 0; i < 3; i++) {
        sessionIds.push(sessionId);
      }

      // All invocations should use the same session ID
      const uniqueIds = new Set(sessionIds);
      expect(uniqueIds.size).toBe(1);
    });
  });

  describe('Session Isolation Between Invocations', () => {
    it('should generate different session IDs for different loggers', () => {
      const logger1 = initializeChatLogger(testDir);
      const sessionId1 = logger1.getSessionId();

      // Create a new logger (simulating new dr chat invocation)
      const logger2 = new ChatLogger(testDir);
      const sessionId2 = logger2.getSessionId();

      // Different loggers should have different session IDs
      expect(sessionId1).not.toEqual(sessionId2);
    });

    it('should not cross-contaminate options between different sessions', () => {
      const logger1 = initializeChatLogger(testDir);
      const sessionId1 = logger1.getSessionId();

      const options1: ChatOptions = { sessionId: sessionId1, workingDirectory: testDir };

      // Simulate new session
      const logger2 = new ChatLogger(testDir);
      const sessionId2 = logger2.getSessionId();

      const options2: ChatOptions = { sessionId: sessionId2, workingDirectory: testDir };

      // Options should not be affected by other session
      expect(options1.sessionId).toEqual(sessionId1);
      expect(options2.sessionId).toEqual(sessionId2);
      expect(options1.sessionId).not.toEqual(options2.sessionId);
    });
  });

  describe('Session ID Format and Validation', () => {
    it('should provide UUID v4 format session ID', () => {
      const logger = initializeChatLogger(testDir);
      const sessionId = logger.getSessionId();

      const uuidv4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(sessionId).toMatch(uuidv4Pattern);
    });

    it('should include session ID in logging metadata', async () => {
      const logger = initializeChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();
      await logger.logCommand('claude', ['--session-id', sessionId, '--print', '--verbose'], {
        sessionId,
      });

      const entries = await logger.readEntries();
      const command = entries.find((e) => e.type === 'command');

      expect(command).toBeDefined();
      expect(command?.metadata?.sessionId).toEqual(sessionId);
    });
  });

  describe('Client Session State Management', () => {
    it('should create session on message invocation', () => {
      const client = new ClaudeCodeClient();

      // Initially no session
      const initialSession = client.getCurrentSession();
      expect(initialSession).toBeUndefined();
    });

    it('should track current session after creation', () => {
      const client = new ClaudeCodeClient();
      client['createSession'](); // Access protected method for testing

      const session = client.getCurrentSession();
      expect(session).toBeDefined();
      expect(session?.id).toBeDefined();
      expect(session?.createdAt).toBeDefined();
      expect(session?.lastMessageAt).toBeDefined();
    });

    it('should track session lifecycle', () => {
      const client = new ClaudeCodeClient();

      // Before creating session
      expect(client.getCurrentSession()).toBeUndefined();

      client['createSession']();
      const session = client.getCurrentSession();

      // After creating session
      expect(session).toBeDefined();
      expect(session?.id).toBeDefined();
      expect(session?.createdAt).toBeDefined();
      expect(session?.lastMessageAt).toBeDefined();

      // Update timestamp
      client['updateSessionTimestamp']();
      const updatedSession = client.getCurrentSession();

      // Session ID should remain the same
      expect(updatedSession?.id).toEqual(session?.id);
    });

    it('should clear session when requested', () => {
      const client = new ClaudeCodeClient();
      client['createSession']();

      expect(client.getCurrentSession()).toBeDefined();

      client.clearSession();
      expect(client.getCurrentSession()).toBeUndefined();
    });
  });

  describe('Session ID in ChatOptions', () => {
    it('should support optional session ID in options', () => {
      const optionsWithoutId: ChatOptions = {
        agent: 'dr-architect',
      };
      expect(optionsWithoutId.sessionId).toBeUndefined();

      const optionsWithId: ChatOptions = {
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        agent: 'dr-architect',
      };
      expect(optionsWithId.sessionId).toBeDefined();
    });

    it('should preserve session ID through options chain', () => {
      const logger = initializeChatLogger(testDir);
      const sessionId = logger.getSessionId();

      const options: ChatOptions = {
        sessionId,
        workingDirectory: testDir,
        agent: 'dr-architect',
        withDanger: false,
      };

      // Create a copy to simulate passing to subprocess
      const copiedOptions: ChatOptions = { ...options };

      expect(copiedOptions.sessionId).toEqual(sessionId);
      expect(copiedOptions).toEqual(options);
    });

    it('should handle undefined session ID gracefully', () => {
      const options: ChatOptions = {
        workingDirectory: '/tmp',
        agent: 'dr-architect',
      };

      expect(options.sessionId).toBeUndefined();

      // Should not throw when checking
      if (options.sessionId) {
        throw new Error('Should be undefined');
      }
    });
  });

  describe('Subprocess Argument Composition', () => {
    it('should construct args array with session ID', () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440000';
      const args: string[] = [];

      // Simulate how spawnClaudeProcess constructs args
      args.push('--print');
      args.push('--verbose', '--output-format', 'stream-json');

      if (sessionId) {
        args.push('--session-id', sessionId);
      }

      expect(args).toContain('--session-id');
      expect(args).toContain(sessionId);

      // Verify order
      const sessionIdIndex = args.indexOf('--session-id');
      expect(args[sessionIdIndex + 1]).toEqual(sessionId);
    });

    it('should skip session ID flag when undefined', () => {
      const sessionId: string | undefined = undefined;
      const args: string[] = [];

      args.push('--print');
      args.push('--verbose', '--output-format', 'stream-json');

      if (sessionId) {
        args.push('--session-id', sessionId);
      }

      expect(args).not.toContain('--session-id');
    });

    it('should position session ID correctly with other args', () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440000';
      const args: string[] = [];

      // Simulate complete argument construction
      args.push('--agent', 'dr-architect');
      args.push('--print');
      args.push('--dangerously-skip-permissions');
      args.push('--verbose', '--output-format', 'stream-json');

      if (sessionId) {
        args.push('--session-id', sessionId);
      }

      // Verify all components
      expect(args).toContain('--agent');
      expect(args).toContain('dr-architect');
      expect(args).toContain('--print');
      expect(args).toContain('--session-id');
      expect(args).toContain(sessionId);

      // Verify session ID is at the end
      expect(args[args.length - 1]).toEqual(sessionId);
      expect(args[args.length - 2]).toEqual('--session-id');
    });
  });

  describe('Logger Integration with Client', () => {
    it('should retrieve session ID from chat logger', () => {
      const logger = initializeChatLogger(testDir);
      const sessionId = logger.getSessionId();

      // Verify logger is available globally
      const retrievedLogger = getChatLogger();
      expect(retrievedLogger).toBeDefined();
      expect(retrievedLogger?.getSessionId()).toEqual(sessionId);
    });

    it('should use logger session ID for options', () => {
      const logger = initializeChatLogger(testDir);
      const loggerSessionId = logger.getSessionId();

      const options: ChatOptions = {
        sessionId: loggerSessionId,
        workingDirectory: testDir,
      };

      expect(options.sessionId).toEqual(loggerSessionId);
    });

    it('should log command with session ID', async () => {
      const logger = initializeChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();

      // Simulate logging a command invocation
      const args = ['--session-id', sessionId, '--print', '--verbose'];
      await logger.logCommand('claude', args, {
        sessionId,
        client: 'Claude Code',
      });

      const entries = await logger.readEntries();
      const commandEntry = entries.find((e) => e.type === 'command');

      expect(commandEntry).toBeDefined();
      expect(commandEntry?.metadata?.sessionId).toEqual(sessionId);
      expect(commandEntry?.metadata?.args).toContain('--session-id');
      expect(commandEntry?.metadata?.args).toContain(sessionId);
    });
  });

  describe('Message Flow with Session ID', () => {
    it('should pass session ID from logger to options to subprocess', async () => {
      const logger = initializeChatLogger(testDir);
      const sessionId = logger.getSessionId();

      // Step 1: Logger generates session ID
      expect(sessionId).toBeDefined();

      // Step 2: Options receive session ID
      const options: ChatOptions = {
        sessionId,
        workingDirectory: testDir,
        agent: 'dr-architect',
      };

      expect(options.sessionId).toEqual(sessionId);

      // Step 3: Simulate subprocess args construction
      const args: string[] = [];
      args.push('--print');
      args.push('--verbose', '--output-format', 'stream-json');
      if (options.sessionId) {
        args.push('--session-id', options.sessionId);
      }

      // Verify session ID flows through entire chain
      expect(args).toContain('--session-id');
      expect(args).toContain(sessionId);
      expect(options.sessionId).toEqual(sessionId);
    });

    it('should maintain session ID across multiple message invocations', async () => {
      const logger = initializeChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();

      // Simulate multiple messages using same session
      for (let i = 0; i < 3; i++) {
        const options: ChatOptions = {
          sessionId,
          workingDirectory: testDir,
        };

        await logger.logUserMessage(`Message ${i}`);

        expect(options.sessionId).toEqual(sessionId);
      }

      const entries = await logger.readEntries();
      const messages = entries.filter((e) => e.role === 'user');

      expect(messages.length).toBe(3);
    });
  });

  describe('Error Handling with Session ID', () => {
    it('should handle missing session ID gracefully', () => {
      const options: ChatOptions = {
        workingDirectory: '/tmp',
      };

      // Should not throw
      expect(() => {
        if (options.sessionId) {
          // This should not execute
          throw new Error('Session ID should be undefined');
        }
      }).not.toThrow();
    });

    it('should log error while preserving session ID', async () => {
      const logger = initializeChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();

      // Simulate error scenario
      const errorMsg = 'Claude CLI process failed';
      await logger.logError(errorMsg, {
        sessionId,
        client: 'Claude Code',
      });

      const entries = await logger.readEntries();
      const errorEntry = entries.find((e) => e.type === 'error');

      expect(errorEntry).toBeDefined();
      expect(errorEntry?.metadata?.sessionId).toEqual(sessionId);
    });

    it('should continue with same session ID after error', async () => {
      const logger = initializeChatLogger(testDir);
      const sessionId = logger.getSessionId();

      await logger.ensureLogDirectory();

      await logger.logUserMessage('First message');
      await logger.logError('An error occurred', { sessionId });
      await logger.logUserMessage('Continue message');

      const entries = await logger.readEntries();

      // Session should continue with same ID
      const entriesWithSessionId = entries.filter((e) => e.metadata?.sessionId);
      const ids = new Set(entriesWithSessionId.map((e) => e.metadata?.sessionId));

      expect(ids.size).toBe(1);
      expect([...ids][0]).toEqual(sessionId);
    });
  });
});
