import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Model } from '../../src/core/model.js';
import { MigrationRegistry } from '../../src/core/migration-registry.js';
import { rm } from 'fs/promises';

import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';

let TEST_DIR: string;

describe('migrate command integration', () => {
  beforeAll(async () => {
    // Create test directory and model
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Directory may not exist
    }

    // Initialize a test model at v0.5.0
    const model = await Model.init(TEST_DIR, {
      name: 'test-model',
      version: '1.0.0',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      specVersion: '0.5.0',
    });

    await model.saveManifest();
  });

  afterAll(async () => {
    // Clean up
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore errors
    }
  });

  describe('migration path validation', () => {
    it('should identify available migrations', () => {
      const registry = new MigrationRegistry();
      const path = registry.getMigrationPath('0.5.0', '0.6.0');

      expect(path).toHaveLength(1);
      expect(path[0].fromVersion).toBe('0.5.0');
      expect(path[0].toVersion).toBe('0.6.0');
    });

    it('should return empty path when no migrations needed', () => {
      const registry = new MigrationRegistry();
      const path = registry.getMigrationPath('0.6.0', '0.6.0');

      expect(path).toHaveLength(0);
    });
  });

  describe('migration execution', () => {
    it('should apply migration and update model version', async () => {
      const model = await Model.load(TEST_DIR, { lazyLoad: false });
      expect(model.manifest.specVersion).toBe('0.5.0');

      const registry = new MigrationRegistry();
      const result = await registry.applyMigrations(model, {
        fromVersion: '0.5.0',
        toVersion: '0.6.0',
      });

      expect(result.applied).toHaveLength(1);
      expect(model.manifest.specVersion).toBe('0.6.0');
    });

    it('should support dry-run mode', async () => {
      // Create a fresh model for dry-run test
      const dryRunDir = '/tmp/migrate-dryrun-test';
      try {
        await rm(dryRunDir, { recursive: true });
      } catch {
        // May not exist
      }

      const model = await Model.init(dryRunDir, {
        name: 'test-model',
        version: '1.0.0',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: '0.5.0',
      });

      const originalVersion = model.manifest.specVersion;

      const registry = new MigrationRegistry();
      await registry.applyMigrations(model, {
        fromVersion: '0.5.0',
        toVersion: '0.6.0',
        dryRun: true,
      });

      // Verify version was not changed in memory (dry run)
      expect(model.manifest.specVersion).toBe(originalVersion);

      // Clean up
      try {
        await rm(dryRunDir, { recursive: true });
      } catch {
        // Ignore
      }
    });
  });

  describe('migration summary', () => {
    it('should provide accurate migration summary', () => {
      const registry = new MigrationRegistry();
      const summary = registry.getMigrationSummary('0.5.0', '0.6.0');

      expect(summary.currentVersion).toBe('0.5.0');
      expect(summary.targetVersion).toBe('0.6.0');
      expect(summary.migrationsNeeded).toBe(1);
      expect(summary.migrations[0].description).toContain('0.6.0');
    });

    it('should use latest version as default', () => {
      const registry = new MigrationRegistry();
      const summary = registry.getMigrationSummary('0.5.0');

      expect(summary.targetVersion).toBe('0.7.0');
    });
  });

  describe('version comparison', () => {
    it('should correctly compare semantic versions', () => {
      const registry = new MigrationRegistry();

      // These use the private compareVersions which we test indirectly
      expect(registry.getMigrationPath('0.1.0', '0.2.0')).toHaveLength(0); // No migration for this path
      expect(registry.getMigrationPath('0.5.0', '0.6.0')).toHaveLength(1);
      expect(registry.getMigrationPath('0.6.0', '0.5.0')).toHaveLength(0); // No downgrade
    });
  });
});
