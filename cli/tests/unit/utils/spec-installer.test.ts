import { describe, it, expect } from 'bun:test';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { installSpecReference, needsSpecReferenceInstall } from '../../../src/utils/spec-installer.js';
import { getCliBundledSpecVersion } from '../../../src/utils/spec-version.js';

describe('spec-installer', () => {
  describe('needsSpecReferenceInstall', () => {
    it('should return true if .dr/manifest.json does not exist', async () => {
      const testDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(testDir, { recursive: true });

      try {
        const result = await needsSpecReferenceInstall(testDir);
        expect(result).toBe(true);
      } finally {
        await rm(testDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should handle non-existent project root gracefully', async () => {
      const nonExistentDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`, 'does-not-exist');
      const result = await needsSpecReferenceInstall(nonExistentDir);
      expect(result).toBe(true);
    });

    it('should return true if manifest specVersion does not match bundled version', async () => {
      const testDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(path.join(testDir, '.dr'), { recursive: true });
      await writeFile(
        path.join(testDir, '.dr', 'manifest.json'),
        JSON.stringify({ specVersion: '0.0.0' })
      );

      try {
        const result = await needsSpecReferenceInstall(testDir);
        expect(result).toBe(true);
      } finally {
        await rm(testDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should return false if manifest specVersion matches bundled version', async () => {
      const testDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(path.join(testDir, '.dr'), { recursive: true });
      await writeFile(
        path.join(testDir, '.dr', 'manifest.json'),
        JSON.stringify({ specVersion: getCliBundledSpecVersion() })
      );

      try {
        const result = await needsSpecReferenceInstall(testDir);
        expect(result).toBe(false);
      } finally {
        await rm(testDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });

  describe('installSpecReference', () => {
    it('should create .dr directory with manifest, changesets, and README', async () => {
      const tempDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(tempDir, { recursive: true });

      try {
        await installSpecReference(tempDir);

        // Core structure
        expect(existsSync(path.join(tempDir, '.dr'))).toBe(true);
        expect(existsSync(path.join(tempDir, '.dr', 'manifest.json'))).toBe(true);
        expect(existsSync(path.join(tempDir, '.dr', 'changesets'))).toBe(true);
        expect(existsSync(path.join(tempDir, '.dr', 'README.md'))).toBe(true);

        // Schema files are NOT copied — CLI reads from bundled schemas directly
        expect(existsSync(path.join(tempDir, '.dr', 'spec'))).toBe(false);

        // Verify manifest content
        const manifestContent = await readFile(path.join(tempDir, '.dr', 'manifest.json'), 'utf-8');
        const manifest = JSON.parse(manifestContent);
        expect(manifest).toHaveProperty('specVersion');
        expect(manifest.specVersion).toBe(getCliBundledSpecVersion());
        expect(manifest).toHaveProperty('installedAt');
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should preserve existing changesets during install', async () => {
      const tempDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(tempDir, { recursive: true });

      try {
        // Create old installation with changesets
        await mkdir(path.join(tempDir, '.dr', 'changesets', 'test-changeset'), { recursive: true });
        await writeFile(
          path.join(tempDir, '.dr', 'changesets', 'test-changeset', 'metadata.yaml'),
          'id: test-changeset\nstatus: active'
        );

        await installSpecReference(tempDir);

        const changesetMetadata = await readFile(
          path.join(tempDir, '.dr', 'changesets', 'test-changeset', 'metadata.yaml'),
          'utf-8'
        );
        expect(changesetMetadata).toContain('test-changeset');
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should preserve existing changesets during force upgrade', async () => {
      const tempDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(tempDir, { recursive: true });

      try {
        await installSpecReference(tempDir);

        await mkdir(path.join(tempDir, '.dr', 'changesets', 'my-feature'), { recursive: true });
        await writeFile(
          path.join(tempDir, '.dr', 'changesets', 'my-feature', 'metadata.yaml'),
          'id: my-feature\nstatus: active'
        );

        await installSpecReference(tempDir, true);

        const changesetContent = await readFile(
          path.join(tempDir, '.dr', 'changesets', 'my-feature', 'metadata.yaml'),
          'utf-8'
        );
        expect(changesetContent).toContain('my-feature');
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should update manifest version on reinstall', async () => {
      const tempDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(tempDir, { recursive: true });

      try {
        // Plant old version
        await mkdir(path.join(tempDir, '.dr'), { recursive: true });
        await writeFile(
          path.join(tempDir, '.dr', 'manifest.json'),
          JSON.stringify({ specVersion: '0.7.0', installedAt: '2024-01-01T00:00:00.000Z' })
        );

        await installSpecReference(tempDir, true);

        const manifestContent = await readFile(path.join(tempDir, '.dr', 'manifest.json'), 'utf-8');
        const manifest = JSON.parse(manifestContent);
        expect(manifest.specVersion).toBe(getCliBundledSpecVersion());
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });
});
