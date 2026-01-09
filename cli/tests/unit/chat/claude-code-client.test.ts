/**
 * Unit tests for ClaudeCodeClient
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ClaudeCodeClient } from '../../../src/ai/claude-code-client';

describe('ClaudeCodeClient', () => {
  let client: ClaudeCodeClient;

  beforeEach(() => {
    client = new ClaudeCodeClient();
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
  });

  describe('getClientName', () => {
    it('should return correct client name', () => {
      expect(client.getClientName()).toBe('Claude Code');
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
  });
});
