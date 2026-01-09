/**
 * Unit tests for ClaudeCodeClient
 */

import { describe, it, expect, beforeEach, spyOn } from 'bun:test';
import { ClaudeCodeClient } from '../../../src/ai/claude-code-client';
import { spawnSync } from 'child_process';

// Mock child_process
const mockSpawnSync = spyOn(require('child_process'), 'spawnSync');

describe('ClaudeCodeClient', () => {
  let client: ClaudeCodeClient;

  beforeEach(() => {
    client = new ClaudeCodeClient();
    mockSpawnSync.mockClear();
  });

  describe('isAvailable', () => {
    it('should detect claude availability', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: '/usr/local/bin/claude',
        stderr: '',
      });

      const available = await client.isAvailable();
      expect(available).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'which',
        ['claude'],
        expect.any(Object)
      );
    });

    it('should return false when claude is not available', async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: '',
      });

      const available = await client.isAvailable();
      expect(available).toBe(false);
    });

    it('should handle exceptions gracefully', async () => {
      mockSpawnSync.mockImplementation(() => {
        throw new Error('Command not found');
      });

      const available = await client.isAvailable();
      expect(available).toBe(false);
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
