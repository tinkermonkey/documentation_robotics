/**
 * Unit tests for CopilotClient
 */

import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { CopilotClient } from '../../../src/ai/copilot-client';
import { spawnSync } from 'child_process';

// Mock child_process
const mockSpawnSync = spyOn(require('child_process'), 'spawnSync');

describe('CopilotClient', () => {
  let client: CopilotClient;

  beforeEach(() => {
    client = new CopilotClient();
    mockSpawnSync.mockClear();
  });

  describe('isAvailable', () => {
    it('should detect gh copilot availability', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'gh copilot version 1.0.0',
        stderr: '',
      });

      const available = await client.isAvailable();
      expect(available).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'gh',
        ['copilot', '--version'],
        expect.any(Object)
      );
    });

    it('should detect standalone copilot availability', async () => {
      // First call (gh) fails, second call (copilot) succeeds
      mockSpawnSync
        .mockReturnValueOnce({
          status: 1,
          stdout: '',
          stderr: 'command not found',
        })
        .mockReturnValueOnce({
          status: 0,
          stdout: 'copilot version 1.0.0',
          stderr: '',
        });

      const available = await client.isAvailable();
      expect(available).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    });

    it('should return false when neither command is available', async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'command not found',
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

    it('should cache the detected command', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'gh copilot version 1.0.0',
        stderr: '',
      });

      await client.isAvailable();
      await client.isAvailable();
      
      // Should only call once since the command is cached
      expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('getClientName', () => {
    it('should return correct client name', () => {
      expect(client.getClientName()).toBe('GitHub Copilot');
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
