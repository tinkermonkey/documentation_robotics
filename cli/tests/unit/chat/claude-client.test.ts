/**
 * Tests for ClaudeClient
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ClaudeClient } from '../../../src/coding-agents/claude-client';

describe('ClaudeClient', () => {
  let client: ClaudeClient;

  beforeEach(() => {
    // Create a client with a mock API key
    client = new ClaudeClient('test-api-key');
  });

  describe('constructor', () => {
    it('should initialize with API key', () => {
      expect(client).toBeDefined();
    });

    it('should start with empty conversation history', () => {
      expect(client.getHistory()).toEqual([]);
    });

    it('should have history length of 0', () => {
      expect(client.getHistoryLength()).toBe(0);
    });
  });

  describe('conversation history', () => {
    it('should track conversation history', async () => {
      const history = client.getHistory();
      expect(history).toEqual([]);
    });

    it('should clear history', async () => {
      client.clearHistory();
      expect(client.getHistory()).toEqual([]);
    });

    it('should return copy of history', () => {
      client.clearHistory();
      const history1 = client.getHistory();
      const history2 = client.getHistory();
      expect(history1).toEqual(history2);
      // Verify it's a copy, not the same reference
      expect(history1).not.toBe(history2);
    });
  });

  describe('getHistoryLength', () => {
    it('should return correct history length', () => {
      client.clearHistory();
      expect(client.getHistoryLength()).toBe(0);
    });
  });
});
