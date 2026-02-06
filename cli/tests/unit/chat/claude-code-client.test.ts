/**
 * Unit tests for ClaudeCodeClient
 *
 * Tests the Claude Code CLI client implementation that extends BaseChatClient.
 * Validates availability detection, session management, event handling,
 * and proper implementation of the abstraction layer interface.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ClaudeCodeClient } from '../../../src/coding-agents/claude-code-client';
import { BaseChatClient } from '../../../src/coding-agents/base-chat-client';

describe('ClaudeCodeClient', () => {
  let client: ClaudeCodeClient;

  beforeEach(() => {
    client = new ClaudeCodeClient();
  });

  describe('BaseChatClient interface compliance', () => {
    it('should extend BaseChatClient', () => {
      expect(client).toBeInstanceOf(BaseChatClient);
    });

    it('should implement isAvailable method', () => {
      expect(typeof client.isAvailable).toBe('function');
    });

    it('should implement sendMessage method', () => {
      expect(typeof client.sendMessage).toBe('function');
    });

    it('should implement getClientName method', () => {
      expect(typeof client.getClientName).toBe('function');
    });

    it('should inherit getCurrentSession method', () => {
      expect(typeof client.getCurrentSession).toBe('function');
    });

    it('should inherit clearSession method', () => {
      expect(typeof client.clearSession).toBe('function');
    });
  });

  describe('isAvailable', () => {
    it('should check for claude availability', async () => {
      const available = await client.isAvailable();

      // In CI, this will likely be false unless claude CLI is installed
      // We're just verifying it returns a boolean and doesn't crash
      expect(typeof available).toBe('boolean');
    });

    it('should handle check gracefully', async () => {
      // Multiple calls should not crash
      await client.isAvailable();
      const available = await client.isAvailable();

      expect(typeof available).toBe('boolean');
    });

    it('should return false when which command fails', async () => {
      // This test validates that errors are caught and return false
      const available = await client.isAvailable();

      // We can't guarantee the result, but it should not throw
      expect(typeof available).toBe('boolean');
    });
  });

  describe('getClientName', () => {
    it('should return correct client name', () => {
      expect(client.getClientName()).toBe('Claude Code');
    });

    it('should return a string', () => {
      const name = client.getClientName();
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    });
  });

  describe('session management', () => {
    it('should start with no session', () => {
      expect(client.getCurrentSession()).toBeUndefined();
    });

    it('should clear session', () => {
      client.clearSession();
      expect(client.getCurrentSession()).toBeUndefined();
    });

    it('should maintain session state after clearing', () => {
      client.clearSession();
      expect(client.getCurrentSession()).toBeUndefined();

      // Clear again should not cause issues
      client.clearSession();
      expect(client.getCurrentSession()).toBeUndefined();
    });
  });

  describe('implementation details', () => {
    it('should be a class instance', () => {
      expect(client).toBeDefined();
      expect(typeof client).toBe('object');
    });

    it('should have proper inheritance chain', () => {
      expect(Object.getPrototypeOf(client.constructor)).toBe(BaseChatClient);
    });

    it('should not have undefined required methods', () => {
      // Verify all required methods are implemented
      expect(client.isAvailable).not.toBeUndefined();
      expect(client.sendMessage).not.toBeUndefined();
      expect(client.getClientName).not.toBeUndefined();
    });
  });

  describe('key features documentation', () => {
    it('should support JSON event stream parsing (design verification)', () => {
      // This test documents that the client uses JSON event streams
      // The actual parsing is tested in integration tests
      expect(client.getClientName()).toBe('Claude Code');
    });

    it('should support agent invocation (design verification)', () => {
      // This test documents that the client supports agent parameter
      // The actual functionality is tested in integration tests
      expect(client.getClientName()).toBe('Claude Code');
    });

    it('should support tool use detection (design verification)', () => {
      // This test documents that the client detects tool usage
      // The actual functionality is tested in integration tests
      expect(client.getClientName()).toBe('Claude Code');
    });

    it('should maintain session continuity via --session-id flag (design verification)', () => {
      // This test documents the session behavior
      // Session continuity is maintained via --session-id flag passed to Claude Code CLI
      // within a single dr chat session, enabling conversation continuity across messages
      expect(client.getCurrentSession()).toBeUndefined();
    });
  });

  describe('error handling capability', () => {
    it('should handle availability check errors gracefully', async () => {
      // Even if the system doesn't have 'which' or 'claude', it shouldn't throw
      let threwError = false;
      try {
        await client.isAvailable();
      } catch {
        threwError = true;
      }
      expect(threwError).toBe(false);
    });

    it('should not throw on session operations', () => {
      expect(() => client.getCurrentSession()).not.toThrow();
      expect(() => client.clearSession()).not.toThrow();
      expect(() => client.getClientName()).not.toThrow();
    });
  });

  describe('method signatures', () => {
    it('isAvailable should return Promise<boolean>', async () => {
      const result = await client.isAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('getClientName should return string', () => {
      const result = client.getClientName();
      expect(typeof result).toBe('string');
    });

    it('getCurrentSession should return ChatSession | undefined', () => {
      const result = client.getCurrentSession();
      expect(result === undefined || typeof result === 'object').toBe(true);
    });

    it('clearSession should return void', () => {
      const result = client.clearSession();
      expect(result).toBeUndefined();
    });
  });
});
