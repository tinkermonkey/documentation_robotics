import { describe, it, expect } from 'bun:test';
import { mkdir, rm, writeFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import {
  installSpecReference,
  needsSpecReferenceInstall,
  specReferenceNotice,
  specReferenceStanding,
} from '../../../src/utils/spec-installer.js';
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
    it('should create .dr directory with manifest, changesets, README, and spec files', async () => {
      const tempDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(tempDir, { recursive: true });

      try {
        await installSpecReference(tempDir);

        // Core structure
        expect(existsSync(path.join(tempDir, '.dr'))).toBe(true);
        expect(existsSync(path.join(tempDir, '.dr', 'manifest.json'))).toBe(true);
        expect(existsSync(path.join(tempDir, '.dr', 'changesets'))).toBe(true);
        expect(existsSync(path.join(tempDir, '.dr', 'README.md'))).toBe(true);

        // Spec files are copied to .dr/spec/
        expect(existsSync(path.join(tempDir, '.dr', 'spec'))).toBe(true);
        expect(existsSync(path.join(tempDir, '.dr', 'spec', 'manifest.json'))).toBe(true);
        expect(existsSync(path.join(tempDir, '.dr', 'spec', 'base.json'))).toBe(true);
        expect(existsSync(path.join(tempDir, '.dr', 'spec', 'motivation.json'))).toBe(true);

        // All 15 compiled files are present (manifest, base, 13 layers)
        const specFiles = await readdir(path.join(tempDir, '.dr', 'spec'));
        const jsonFiles = specFiles.filter(f => f.endsWith('.json'));
        expect(jsonFiles.length).toBe(15);

        // Verify manifest content
        const manifestContent = await readFile(path.join(tempDir, '.dr', 'manifest.json'), 'utf-8');
        const manifest = JSON.parse(manifestContent);
        expect(manifest).toHaveProperty('specVersion');
        expect(manifest.specVersion).toBe(getCliBundledSpecVersion());
        expect(manifest).toHaveProperty('installedAt');

        // Verify a layer file has full compiled content (not just layer instance)
        const motivationContent = await readFile(path.join(tempDir, '.dr', 'spec', 'motivation.json'), 'utf-8');
        const motivation = JSON.parse(motivationContent);
        expect(motivation).toHaveProperty('layer');
        expect(motivation).toHaveProperty('nodeSchemas');
        expect(motivation).toHaveProperty('relationshipSchemas');
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should overwrite stale .dr/spec/ files from old-format installations', async () => {
      const tempDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(tempDir, { recursive: true });

      try {
        // Simulate old-style installation with stale individual schema files
        await mkdir(path.join(tempDir, '.dr', 'spec', 'layers'), { recursive: true });
        await writeFile(
          path.join(tempDir, '.dr', 'spec', 'layers', '01-motivation.layer.json'),
          JSON.stringify({ id: 'motivation', number: 1 })
        );

        await installSpecReference(tempDir, true);

        // Old subdirectories are gone, replaced by flat compiled files
        expect(existsSync(path.join(tempDir, '.dr', 'spec', 'layers'))).toBe(false);
        expect(existsSync(path.join(tempDir, '.dr', 'spec', 'manifest.json'))).toBe(true);
        expect(existsSync(path.join(tempDir, '.dr', 'spec', 'motivation.json'))).toBe(true);
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should preserve existing changesets during install', async () => {
      const tempDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(tempDir, { recursive: true });

      try {
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
  describe('specReferenceStanding (#1168)', () => {
    const freshDir = () => path.join('/tmp', `spec-standing-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);

    it('says a checkout without .dr/spec has no reference, in one line with the fix', async () => {
      const testDir = freshDir();
      // .dr/ with other per-checkout state only, as a worktree with a code index has
      await mkdir(path.join(testDir, '.dr', 'analyzers'), { recursive: true });
      try {
        const standing = await specReferenceStanding(testDir);
        expect(standing).toEqual({ state: 'missing' });
        const notice = specReferenceNotice(standing)!;
        expect(notice).toContain('Spec reference not installed in this checkout');
        expect(notice).toContain(`dr validates against the spec it carries (v${getCliBundledSpecVersion()})`);
        expect(notice).toContain('run "dr upgrade"');
        expect(notice).not.toContain('\n');
      } finally {
        await rm(testDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('is installed, with nothing to say, after an install', async () => {
      const testDir = freshDir();
      await mkdir(testDir, { recursive: true });
      try {
        await installSpecReference(testDir);
        const standing = await specReferenceStanding(testDir);
        expect(standing).toEqual({ state: 'installed', version: getCliBundledSpecVersion() });
        expect(specReferenceNotice(standing)).toBeNull();
      } finally {
        await rm(testDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('is stale when it is for another spec version or its manifest is gone', async () => {
      const testDir = freshDir();
      await mkdir(testDir, { recursive: true });
      try {
        await installSpecReference(testDir);
        await writeFile(path.join(testDir, '.dr', 'manifest.json'), JSON.stringify({ specVersion: '0.12.0' }));
        const older = await specReferenceStanding(testDir);
        expect(older).toEqual({ state: 'stale', version: '0.12.0' });
        expect(specReferenceNotice(older)).toContain('The spec reference in .dr/ is for spec v0.12.0');

        await rm(path.join(testDir, '.dr', 'manifest.json'));
        const noManifest = await specReferenceStanding(testDir);
        expect(noManifest).toEqual({ state: 'stale', version: null });
        expect(specReferenceNotice(noManifest)).toContain('incomplete');
      } finally {
        await rm(testDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });
});
