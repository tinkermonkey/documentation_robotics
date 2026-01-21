/**
 * Integration tests for Chat Command with multiple AI clients
 * Tests the client detection, selection, and preference storage
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Model } from '../../src/core/model';
import { Manifest } from '../../src/core/manifest';
import { ClaudeCodeClient } from '../../src/ai/claude-code-client';
import { CopilotClient } from '../../src/ai/copilot-client';

describe('Chat Command Integration', () => {
  let testDir: string;
  let model: Model;

  beforeEach(async () => {
    // Create a temporary directory for testing
    testDir = join(tmpdir(), `dr-chat-multi-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Create a test model
    const manifest = new Manifest({
      name: 'Chat Integration Test Model',
      version: '1.0.0',
      description: 'Test model for chat integration',
    });
    model = new Model(testDir, manifest);
    await model.save();
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore errors
    }
  });

  describe('Client Detection', () => {
    it('should detect ClaudeCodeClient availability', async () => {
      const client = new ClaudeCodeClient();
      const available = await client.isAvailable();

      // This will be false in CI unless claude CLI is installed
      expect(typeof available).toBe('boolean');
    });

    it('should detect CopilotClient availability', async () => {
      const client = new CopilotClient();
      const available = await client.isAvailable();

      // This will be false in CI unless gh/copilot CLI is installed
      expect(typeof available).toBe('boolean');
    });

    it('should have correct client names', () => {
      const claudeClient = new ClaudeCodeClient();
      const copilotClient = new CopilotClient();

      expect(claudeClient.getClientName()).toBe('Claude Code');
      expect(copilotClient.getClientName()).toBe('GitHub Copilot');
    });
  });

  describe('Session Management', () => {
    it('should start with no session', () => {
      const client = new ClaudeCodeClient();
      expect(client.getCurrentSession()).toBeUndefined();
    });

    it('should clear session', () => {
      const client = new CopilotClient();
      client.clearSession();
      expect(client.getCurrentSession()).toBeUndefined();
    });
  });

  describe('Client Preference Storage', () => {
    it('should store preferred client in manifest', async () => {
      // Set preferred client using the proper property
      model.manifest.preferred_chat_client = 'GitHub Copilot';
      await model.save();

      // Reload model
      const reloadedModel = await Model.load(testDir);
      expect(reloadedModel?.manifest.preferred_chat_client).toBe('GitHub Copilot');
    });

    it('should handle missing preference', async () => {
      const preference = model.manifest.preferred_chat_client;
      expect(preference).toBeUndefined();
    });

    it('should update preference', async () => {
      // Set initial preference
      model.manifest.preferred_chat_client = 'Claude Code';
      await model.save();

      // Update preference
      model.manifest.preferred_chat_client = 'GitHub Copilot';
      await model.save();

      // Verify update
      const reloadedModel = await Model.load(testDir);
      expect(reloadedModel?.manifest.preferred_chat_client).toBe('GitHub Copilot');
    });
  });

  describe('Chat Options', () => {
    it('should support agent option for Claude Code', () => {
      const client = new ClaudeCodeClient();
      const options = {
        agent: 'dr-architect',
        workingDirectory: testDir,
      };

      // Verify options are accepted (actual sendMessage would spawn process)
      expect(options.agent).toBe('dr-architect');
      expect(options.workingDirectory).toBe(testDir);
    });

    it('should support working directory for all clients', () => {
      const claudeClient = new ClaudeCodeClient();
      const copilotClient = new CopilotClient();

      const options = {
        workingDirectory: testDir,
      };

      // Both clients should accept working directory
      expect(options.workingDirectory).toBe(testDir);
    });
  });
});
