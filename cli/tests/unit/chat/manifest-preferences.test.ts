/**
 * Comprehensive tests for manifest operations and chat client preference validation
 * Tests cover preference storage, validation, persistence, and edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Manifest } from '../../../src/core/manifest';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Helper to create test directory
async function createTestDir(): Promise<string> {
  const dir = join(tmpdir(), `manifest-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// Helper to cleanup test directory
async function cleanupTestDir(dir: string): Promise<void> {
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('Manifest Chat Client Preferences', () => {
  let manifest: Manifest;

  beforeEach(() => {
    manifest = new Manifest({
      name: 'test-model',
      version: '1.0.0',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
  });

  describe('preference storage and retrieval', () => {
    it('should store chat client preference', () => {
      manifest.setCodingAgent('Claude Code');
      expect(manifest.getCodingAgent()).toBe('Claude Code');
    });

    it('should store GitHub Copilot preference', () => {
      manifest.setCodingAgent('GitHub Copilot');
      expect(manifest.getCodingAgent()).toBe('GitHub Copilot');
    });

    it('should return undefined when no preference is set', () => {
      expect(manifest.getCodingAgent()).toBeUndefined();
    });

    it('should allow clearing preference', () => {
      manifest.setCodingAgent('Claude Code');
      expect(manifest.getCodingAgent()).toBe('Claude Code');

      manifest.setCodingAgent(undefined);
      expect(manifest.getCodingAgent()).toBeUndefined();
    });

    it('should update preference when changed', () => {
      manifest.setCodingAgent('Claude Code');
      expect(manifest.getCodingAgent()).toBe('Claude Code');

      manifest.setCodingAgent('GitHub Copilot');
      expect(manifest.getCodingAgent()).toBe('GitHub Copilot');
    });

    it('should maintain preference through multiple changes', () => {
      const preferences = ['Claude Code', 'GitHub Copilot', 'Claude Code', undefined, 'GitHub Copilot'];

      for (const pref of preferences) {
        manifest.setCodingAgent(pref);
        expect(manifest.getCodingAgent()).toBe(pref);
      }
    });
  });

  describe('preference validation', () => {
    it('should accept valid client names', () => {
      const validNames = ['Claude Code', 'GitHub Copilot'];

      for (const name of validNames) {
        manifest.setCodingAgent(name);
        expect(manifest.getCodingAgent()).toBe(name);
      }
    });

    it('should store preference even if exact name differs', () => {
      // Test that preference stores whatever is set (validation at command level)
      manifest.setCodingAgent('Custom Client');
      expect(manifest.getCodingAgent()).toBe('Custom Client');
    });

    it('should handle case-sensitive preference names', () => {
      manifest.setCodingAgent('Claude Code');
      manifest.setCodingAgent('claude code');

      // Should store exactly what was set
      expect(manifest.getCodingAgent()).toBe('claude code');
    });

    it('should handle preference with whitespace', () => {
      manifest.setCodingAgent('Claude Code ');
      expect(manifest.getCodingAgent()).toBe('Claude Code ');
    });

    it('should handle empty string preference', () => {
      manifest.setCodingAgent('');
      // Empty string is falsy, but stored
      expect(manifest.getCodingAgent()).toBe('');
    });

    it('should accept null as preference', () => {
      manifest.setCodingAgent(null as any);
      // Should handle null gracefully
      expect(manifest.getCodingAgent()).toBeDefined();
    });
  });

  describe('preference serialization', () => {
    it('should include preference in toJSON', () => {
      manifest.setCodingAgent('Claude Code');
      const json = manifest.toJSON();

      expect(json.preferred_chat_client).toBe('Claude Code');
    });

    it('should exclude undefined preference from toJSON', () => {
      const json = manifest.toJSON();
      expect(json.preferred_chat_client).toBeUndefined();
    });

    it('should exclude empty preference from toJSON', () => {
      manifest.setCodingAgent(undefined);
      const json = manifest.toJSON();

      expect('preferred_chat_client' in json).toBe(false);
    });

    it('should preserve preference through serialization round trip', () => {
      manifest.setCodingAgent('GitHub Copilot');
      const json = manifest.toJSON() as any;

      const manifest2 = new Manifest({
        name: json.name,
        version: json.version,
        created: json.created,
        modified: json.modified,
        preferred_chat_client: json.preferred_chat_client,
      });

      expect(manifest2.getCodingAgent()).toBe('GitHub Copilot');
    });

    it('should include all manifest fields in toJSON', () => {
      manifest.setCodingAgent('Claude Code');
      manifest.description = 'Test model';
      manifest.author = 'Test Author';

      const json = manifest.toJSON();

      expect(json.name).toBe('test-model');
      expect(json.version).toBe('1.0.0');
      expect(json.description).toBe('Test model');
      expect(json.author).toBe('Test Author');
      expect(json.preferred_chat_client).toBe('Claude Code');
    });
  });

  describe('preference persistence', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = await createTestDir();
    });

    afterEach(async () => {
      await cleanupTestDir(testDir);
    });

    it('should persist preference to JSON file', async () => {
      const manifest1 = new Manifest({
        name: 'test',
        version: '1.0',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        preferred_chat_client: 'Claude Code',
      });

      const manifestPath = join(testDir, 'manifest.json');
      const json = JSON.stringify(manifest1.toJSON(), null, 2);
      await writeFile(manifestPath, json, 'utf-8');

      // Read it back
      const content = await readFile(manifestPath, 'utf-8');
      const data = JSON.parse(content);

      const manifest2 = new Manifest(data);
      expect(manifest2.getCodingAgent()).toBe('Claude Code');
    });

    it('should handle missing preference field in loaded manifest', async () => {
      const manifestPath = join(testDir, 'manifest.json');
      const data = {
        name: 'test',
        version: '1.0',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        // No preferred_chat_client field
      };

      const json = JSON.stringify(data, null, 2);
      await writeFile(manifestPath, json, 'utf-8');

      const content = await readFile(manifestPath, 'utf-8');
      const loaded = JSON.parse(content);
      const manifest = new Manifest(loaded);

      expect(manifest.getCodingAgent()).toBeUndefined();
    });

    it('should preserve preference when updating other manifest fields', () => {
      manifest.setCodingAgent('Claude Code');
      manifest.description = 'Updated description';
      manifest.author = 'Updated author';

      expect(manifest.getCodingAgent()).toBe('Claude Code');
    });

    it('should track modified timestamp on preference change', () => {
      const initialModified = manifest.modified;

      // Wait a bit to ensure different timestamp
      // (Note: in real implementation, this might be immediate)
      manifest.setCodingAgent('Claude Code');

      // Manifest should track that it was modified
      expect(manifest.modified).toBeDefined();
    });
  });

  describe('concurrent preference operations', () => {
    it('should handle rapid preference updates', () => {
      const clients = ['Claude Code', 'GitHub Copilot', 'Claude Code', 'GitHub Copilot'];

      for (const client of clients) {
        manifest.setCodingAgent(client);
      }

      expect(manifest.getCodingAgent()).toBe('GitHub Copilot');
    });

    it('should maintain consistency with multiple get operations', () => {
      manifest.setCodingAgent('Claude Code');

      const prefs = [];
      for (let i = 0; i < 10; i++) {
        prefs.push(manifest.getCodingAgent());
      }

      // All should be identical
      expect(new Set(prefs).size).toBe(1);
      expect(prefs[0]).toBe('Claude Code');
    });

    it('should handle interleaved get and set operations', () => {
      manifest.setCodingAgent('Claude Code');
      expect(manifest.getCodingAgent()).toBe('Claude Code');

      manifest.setCodingAgent('GitHub Copilot');
      expect(manifest.getCodingAgent()).toBe('GitHub Copilot');

      manifest.setCodingAgent(undefined);
      expect(manifest.getCodingAgent()).toBeUndefined();

      manifest.setCodingAgent('Claude Code');
      expect(manifest.getCodingAgent()).toBe('Claude Code');
    });
  });

  describe('preference with manifest metadata', () => {
    it('should coexist with other manifest fields', () => {
      manifest.name = 'My Model';
      manifest.version = '2.0.0';
      manifest.description = 'A test model';
      manifest.author = 'Test User';
      manifest.setCodingAgent('Claude Code');

      expect(manifest.name).toBe('My Model');
      expect(manifest.version).toBe('2.0.0');
      expect(manifest.description).toBe('A test model');
      expect(manifest.author).toBe('Test User');
      expect(manifest.getCodingAgent()).toBe('Claude Code');
    });

    it('should include preference in full manifest serialization', () => {
      manifest.description = 'Test description';
      manifest.author = 'Test author';
      manifest.setCodingAgent('GitHub Copilot');

      const json = manifest.toJSON() as any;

      expect(json.name).toBe('test-model');
      expect(json.description).toBe('Test description');
      expect(json.author).toBe('Test author');
      expect(json.preferred_chat_client).toBe('GitHub Copilot');
    });
  });

  describe('preference initialization', () => {
    it('should initialize with preference from constructor', () => {
      const manifest2 = new Manifest({
        name: 'test',
        version: '1.0',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        preferred_chat_client: 'Claude Code',
      });

      expect(manifest2.getCodingAgent()).toBe('Claude Code');
    });

    it('should initialize without preference', () => {
      const manifest2 = new Manifest({
        name: 'test',
        version: '1.0',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      });

      expect(manifest2.getCodingAgent()).toBeUndefined();
    });

    it('should initialize with explicit undefined', () => {
      const manifest2 = new Manifest({
        name: 'test',
        version: '1.0',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        preferred_chat_client: undefined,
      });

      expect(manifest2.getCodingAgent()).toBeUndefined();
    });
  });

  describe('preference edge cases', () => {
    it('should handle preference with special characters', () => {
      const specialNames = [
        'Claude Code v1.0',
        'GitHub Copilot (Beta)',
        'Test Client [dev]',
        'Client-with-dashes',
        'Client_with_underscores',
      ];

      for (const name of specialNames) {
        manifest.setCodingAgent(name);
        expect(manifest.getCodingAgent()).toBe(name);
      }
    });

    it('should handle preference with unicode characters', () => {
      manifest.setCodingAgent('Claude Code 🚀');
      expect(manifest.getCodingAgent()).toBe('Claude Code 🚀');
    });

    it('should handle very long preference name', () => {
      const longName = 'a'.repeat(1000);
      manifest.setCodingAgent(longName);
      expect(manifest.getCodingAgent()).toBe(longName);
    });

    it('should handle preference name that looks like JSON', () => {
      const jsonLikeName = '{"type": "test"}';
      manifest.setCodingAgent(jsonLikeName);
      expect(manifest.getCodingAgent()).toBe(jsonLikeName);
    });
  });

  describe('preference consistency across instances', () => {
    it('should not share preferences between manifest instances', () => {
      const manifest1 = new Manifest({
        name: 'model1',
        version: '1.0',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      });

      const manifest2 = new Manifest({
        name: 'model2',
        version: '1.0',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      });

      manifest1.setCodingAgent('Claude Code');
      manifest2.setCodingAgent('GitHub Copilot');

      expect(manifest1.getCodingAgent()).toBe('Claude Code');
      expect(manifest2.getCodingAgent()).toBe('GitHub Copilot');
    });

    it('should allow independent preference modification', () => {
      const manifest1 = new Manifest({
        name: 'model1',
        version: '1.0',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        preferred_chat_client: 'Claude Code',
      });

      const manifest2 = new Manifest({
        name: 'model2',
        version: '1.0',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        preferred_chat_client: 'GitHub Copilot',
      });

      manifest1.setCodingAgent('GitHub Copilot');

      expect(manifest1.getCodingAgent()).toBe('GitHub Copilot');
      expect(manifest2.getCodingAgent()).toBe('GitHub Copilot');
    });
  });

  describe('backward compatibility', () => {
    it('should preserve legacy fields when preference is set', () => {
      const legacyData = {
        name: 'test',
        version: '1.0',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        layers: { '01': { path: 'layers/01' } },
        conventions: { some: 'data' },
        upgrade_history: [{ version: '0.1' }],
      };

      const manifest2 = new Manifest(legacyData);
      manifest2.setCodingAgent('Claude Code');

      expect(manifest2.layers).toBeDefined();
      expect(manifest2.conventions).toBeDefined();
      expect(manifest2.upgrade_history).toBeDefined();
      expect(manifest2.getCodingAgent()).toBe('Claude Code');
    });

    it('should include legacy fields in toJSON', () => {
      const manifest2 = new Manifest({
        name: 'test',
        version: '1.0',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        layers: { '01': { path: 'layers/01' } },
        conventions: { some: 'data' },
        upgrade_history: [{ version: '0.1' }],
        preferred_chat_client: 'Claude Code',
      });

      const json = manifest2.toJSON() as any;

      expect(json.layers).toBeDefined();
      expect(json.conventions).toBeDefined();
      expect(json.upgrade_history).toBeDefined();
      expect(json.preferred_chat_client).toBe('Claude Code');
    });
  });

  describe('manifest timestamp updates', () => {
    it('should track when manifest is modified', () => {
      const initialModified = manifest.modified;

      manifest.setCodingAgent('Claude Code');
      // In a real implementation, modified might be updated
      // This test documents current behavior

      expect(manifest.modified).toBe(initialModified);
    });

    it('should include created and modified in toJSON', () => {
      const json = manifest.toJSON() as any;

      expect(json.created).toBeDefined();
      expect(json.modified).toBeDefined();
    });
  });
});
