import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, access, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { glob } from 'glob';
import { installSpecReference, needsSpecReferenceInstall } from '../../../src/utils/spec-installer.js';

describe('spec-installer', () => {
  describe('needsSpecReferenceInstall', () => {
    it('should return true if .dr/manifest.json does not exist', async () => {
      // Create a unique test directory for this test
      const testDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(testDir, { recursive: true });

      try {
        const result = await needsSpecReferenceInstall(testDir);
        expect(result).toBe(true);
      } finally {
        try {
          await rm(testDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should handle non-existent project root gracefully', async () => {
      const nonExistentDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`, 'does-not-exist');
      const result = await needsSpecReferenceInstall(nonExistentDir);
      expect(result).toBe(true);
    });
  });

  describe('installSpecReference', () => {
    it('should install complete spec directory structure', async () => {
      const tempDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(tempDir, { recursive: true });

      try {
        await installSpecReference(tempDir);

        // Verify structure
        expect(existsSync(path.join(tempDir, '.dr', 'spec', 'layers'))).toBe(true);
        expect(existsSync(path.join(tempDir, '.dr', 'spec', 'schemas', 'base'))).toBe(true);
        expect(existsSync(path.join(tempDir, '.dr', 'spec', 'schemas', 'nodes'))).toBe(true);
        expect(existsSync(path.join(tempDir, '.dr', 'spec', 'schemas', 'relationships'))).toBe(true);

        // Verify counts
        const layerFiles = await glob(path.join(tempDir, '.dr', 'spec', 'layers', '*.layer.json'));
        const nodeSchemas = await glob(path.join(tempDir, '.dr', 'spec', 'schemas', 'nodes', '**', '*.node.schema.json'));
        const relSchemas = await glob(path.join(tempDir, '.dr', 'spec', 'schemas', 'relationships', '**', '*.relationship.schema.json'));

        expect(layerFiles.length).toBe(12);
        expect(nodeSchemas.length).toBeGreaterThanOrEqual(354);
        expect(relSchemas.length).toBeGreaterThanOrEqual(252);

        // Verify manifest
        const manifestContent = await readFile(path.join(tempDir, '.dr', 'manifest.json'), 'utf-8');
        const manifest = JSON.parse(manifestContent);
        expect(manifest).toHaveProperty('specVersion');
        expect(manifest).toHaveProperty('installedAt');

        // Verify README
        const readmeContent = await readFile(path.join(tempDir, '.dr', 'README.md'), 'utf-8');
        expect(readmeContent).toContain('Complete specification reference');
        expect(readmeContent).toContain('12 layer instance definitions');
      } finally {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should handle upgrade from incomplete installation', async () => {
      const tempDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(tempDir, { recursive: true });

      try {
        // Create old-style installation (only base schemas)
        await mkdir(path.join(tempDir, '.dr', 'schemas', 'base'), { recursive: true });
        await writeFile(
          path.join(tempDir, '.dr', 'manifest.json'),
          JSON.stringify({ specVersion: '0.7.0' })
        );

        // Upgrade
        await installSpecReference(tempDir, true);

        // Verify complete installation
        const layerFiles = await glob(path.join(tempDir, '.dr', 'spec', 'layers', '*.layer.json'));
        expect(layerFiles.length).toBe(12);

        const nodeSchemas = await glob(path.join(tempDir, '.dr', 'spec', 'schemas', 'nodes', '**', '*.node.schema.json'));
        expect(nodeSchemas.length).toBeGreaterThanOrEqual(354);

        const relSchemas = await glob(path.join(tempDir, '.dr', 'spec', 'schemas', 'relationships', '**', '*.relationship.schema.json'));
        expect(relSchemas.length).toBeGreaterThanOrEqual(252);

        // Verify backward compatibility - old schemas directory still exists
        expect(existsSync(path.join(tempDir, '.dr', 'schemas', 'base'))).toBe(true);
      } finally {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should preserve existing changesets during upgrade', async () => {
      const tempDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(tempDir, { recursive: true });

      try {
        // Create old installation with changesets
        await mkdir(path.join(tempDir, '.dr', 'changesets', 'test-changeset'), { recursive: true });
        await writeFile(
          path.join(tempDir, '.dr', 'changesets', 'test-changeset', 'metadata.yaml'),
          'id: test-changeset\nstatus: active'
        );

        // Install spec reference
        await installSpecReference(tempDir);

        // Verify changesets are preserved
        const changesetMetadata = await readFile(
          path.join(tempDir, '.dr', 'changesets', 'test-changeset', 'metadata.yaml'),
          'utf-8'
        );
        expect(changesetMetadata).toContain('test-changeset');
      } finally {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });
});
