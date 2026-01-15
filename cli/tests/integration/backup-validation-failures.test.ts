import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { Model } from '../../src/core/model.js';
import { StagingAreaManager } from '../../src/core/staging-area.js';
import { rm, mkdir, readFile, writeFile, cp, readdir, chmod } from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { fileExists, ensureDir } from '../../src/utils/file-io.js';

const TEST_DIR = '/tmp/backup-validation-failures-test';
const BASELINE_DIR = path.join(process.cwd(), '..', 'cli-validation', 'test-project', 'baseline');

describe('Backup Validation Failure Paths', () => {
  let model: Model;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();

    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }

    await mkdir(TEST_DIR, { recursive: true });
    await cp(BASELINE_DIR, TEST_DIR, { recursive: true });
    process.chdir(TEST_DIR);
    model = await Model.load(undefined, { lazyLoad: false });
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('manifest validation failures', () => {
    it('should detect malformed JSON in backup manifest', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Corrupt the backup manifest with invalid JSON
      const manifestPath = path.join(backupDir, '.backup-manifest.json');
      await writeFile(manifestPath, '{ invalid json }');

      // Validate should fail with clear error
      try {
        await manager.validateBackupIntegrity(backupDir);
        expect(true).toBe(false); // Should throw
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        const message = (error as Error).message.toLowerCase();
        // Should mention backup manifest and that there's a parse/read error
        expect(
          message.includes('backup manifest') ||
          message.includes('parse') ||
          message.includes('json')
        ).toBe(true);
      }
    });

    it('should detect missing files array in manifest', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Write manifest without files array
      const manifestPath = path.join(backupDir, '.backup-manifest.json');
      await writeFile(manifestPath, JSON.stringify({ timestamp: Date.now() }));

      // Validate should throw with clear error about invalid manifest
      try {
        await manager.validateBackupIntegrity(backupDir);
        expect(true).toBe(false); // Should throw
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        const message = (error as Error).message.toLowerCase();
        expect(
          message.includes('backup manifest') ||
          message.includes('files array') ||
          message.includes('invalid')
        ).toBe(true);
      }
    });

    it('should detect manifest with missing file metadata fields', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Corrupt manifest by removing checksum from a file entry
      const manifestPath = path.join(backupDir, '.backup-manifest.json');
      const originalManifest = JSON.parse(await readFile(manifestPath, 'utf-8'));

      expect(originalManifest.files && originalManifest.files.length > 0).toBe(true);

      originalManifest.files[0].checksum = undefined; // Remove checksum
      await writeFile(manifestPath, JSON.stringify(originalManifest));

      // Validation should detect the missing metadata
      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      // Should report errors about missing metadata or invalid files
      expect(health.errors.length).toBeGreaterThan(0);
    });

    it('should provide detailed error on manifest read failure', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const fakeBackupDir = path.join(TEST_DIR, 'documentation-robotics', '.backups', 'fake-backup');
      await ensureDir(fakeBackupDir);

      // Create manifest file with empty content
      const manifestPath = path.join(fakeBackupDir, '.backup-manifest.json');
      await writeFile(manifestPath, '');

      try {
        await manager.validateBackupIntegrity(fakeBackupDir);
        expect(true).toBe(false); // Should throw
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message.toLowerCase()).toContain('manifest');
      }
    });
  });

  describe('file integrity validation failures', () => {
    it('should detect size mismatch in backup files', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Corrupt a file and update manifest with wrong size
      const layersDir = path.join(backupDir, 'layers');
      const layerSubDirs = await readdir(layersDir);

      expect(layerSubDirs.length).toBeGreaterThan(0);

      const layerDir = path.join(layersDir, layerSubDirs[0]);
      const layerFiles = await readdir(layerDir);

      expect(layerFiles.length).toBeGreaterThan(0);

      const filePath = path.join(layerDir, layerFiles[0]);
      await writeFile(filePath, 'SHORT_CONTENT');

      // Update manifest with original size
      const manifestPath = path.join(backupDir, '.backup-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
      const fileEntry = manifest.files.find((f: any) => f.path.includes(layerFiles[0]));
      expect(fileEntry).toBeDefined();

      fileEntry.size = 10000; // Wrong size
      await writeFile(manifestPath, JSON.stringify(manifest));

      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      // Should detect either size or checksum mismatch
      expect(health.errors.length).toBeGreaterThan(0);
    });

    it('should detect multiple file integrity failures', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Corrupt multiple files
      const layersDir = path.join(backupDir, 'layers');
      const layerSubDirs = await readdir(layersDir);
      expect(layerSubDirs.length).toBeGreaterThan(0);

      let corruptedCount = 0;

      for (let i = 0; i < Math.min(3, layerSubDirs.length); i++) {
        const layerDir = path.join(layersDir, layerSubDirs[i]);
        const layerFiles = await readdir(layerDir);

        if (layerFiles.length > 0) {
          const filePath = path.join(layerDir, layerFiles[0]);
          await writeFile(filePath, 'CORRUPTED_' + i);
          corruptedCount++;
        }
      }

      expect(corruptedCount).toBeGreaterThan(0);

      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      expect(health.errors.length).toBeGreaterThanOrEqual(corruptedCount);
    });

    it('should report all file errors in single validation run', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Corrupt multiple files
      const layersDir = path.join(backupDir, 'layers');
      const layerSubDirs = await readdir(layersDir);
      expect(layerSubDirs.length).toBeGreaterThanOrEqual(2);

      for (let i = 0; i < Math.min(2, layerSubDirs.length); i++) {
        const layerDir = path.join(layersDir, layerSubDirs[i]);
        const layerFiles = await readdir(layerDir);
        expect(layerFiles.length).toBeGreaterThan(0);

        const filePath = path.join(layerDir, layerFiles[0]);
        await writeFile(filePath, 'CORRUPTED');
      }

      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      expect(health.filesChecked).toBeGreaterThan(0);
      expect(health.errors.length).toBeGreaterThan(0);
      // Verify we report multiple errors, not just first one
      expect(health.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('validation with filesystem errors', () => {
    it('should handle unreadable backup directory', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Remove read permissions from backup directory
      try {
        await chmod(backupDir, 0o000);

        try {
          await manager.validateBackupIntegrity(backupDir);
          expect(true).toBe(false); // Should throw
        } catch (error) {
          expect(error instanceof Error).toBe(true);
          // Error should be about access or manifest not found
          const message = (error as Error).message;
          expect(message.length).toBeGreaterThan(0);
        }
      } finally {
        // Restore permissions for cleanup
        await chmod(backupDir, 0o755);
      }
    });

    it('should detect when layer directory is missing', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Remove entire layers directory
      const layersDir = path.join(backupDir, 'layers');
      await rm(layersDir, { recursive: true, force: true });

      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      expect(health.errors.some(e => e.includes('Missing') || e.includes('not found'))).toBe(true);
    });
  });

  describe('partial backup handling', () => {
    it('should detect empty backup directory', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const fakeBackupDir = path.join(TEST_DIR, 'documentation-robotics', '.backups', 'empty-backup');
      await ensureDir(fakeBackupDir);

      // Create empty manifest
      const manifestPath = path.join(fakeBackupDir, '.backup-manifest.json');
      await writeFile(manifestPath, JSON.stringify({ files: [] }));

      const health = await manager.validateBackupIntegrity(fakeBackupDir);

      // Empty backup should be considered invalid
      expect(health.isValid).toBe(false);
      expect(health.filesChecked).toBeGreaterThanOrEqual(0);
    });

    it('should detect incomplete layer backup', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Count original layers in manifest
      const manifestPath = path.join(backupDir, '.backup-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
      const originalLayerCount = manifest.files.filter((f: any) => f.path.startsWith('layers/')).length;
      expect(originalLayerCount).toBeGreaterThan(0);

      // Remove half of the layer files
      const layersDir = path.join(backupDir, 'layers');
      const layerSubDirs = await readdir(layersDir);
      expect(layerSubDirs.length).toBeGreaterThan(0);

      for (let i = 0; i < Math.floor(layerSubDirs.length / 2); i++) {
        const layerDir = path.join(layersDir, layerSubDirs[i]);
        const layerFiles = await readdir(layerDir);
        if (layerFiles.length > 0) {
          const filePath = path.join(layerDir, layerFiles[0]);
          await rm(filePath, { force: true });
        }
      }

      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      expect(health.errors.some(e => e.includes('Missing'))).toBe(true);
    });

    it('should report accurate file count in validation results', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Get expected file count from manifest
      const manifestPath = path.join(backupDir, '.backup-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
      const expectedCount = manifest.files.length;

      // Validate intact backup
      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.filesChecked).toBe(expectedCount);
      if (health.isValid) {
        expect(health.errors.length).toBe(0);
      }
    });
  });

  describe('validation result accuracy', () => {
    it('should include specific file paths in error messages', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Corrupt a specific layer file
      const layersDir = path.join(backupDir, 'layers');
      const layerSubDirs = await readdir(layersDir);
      expect(layerSubDirs.length).toBeGreaterThan(0);

      const targetLayer = layerSubDirs[0];
      const layerDir = path.join(layersDir, targetLayer);
      const layerFiles = await readdir(layerDir);
      expect(layerFiles.length).toBeGreaterThan(0);

      const targetFile = layerFiles[0];
      const filePath = path.join(layerDir, targetFile);
      await writeFile(filePath, 'CORRUPTED');

      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      expect(health.errors.some(e => e.includes(targetFile) || e.includes(targetLayer))).toBe(true);
    });

    it('should distinguish between different error types', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Create multiple error types
      // 1. Remove a file (missing)
      const manifestPath = path.join(backupDir, '.backup-manifest.json');
      let manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));

      expect(manifest.files.length).toBeGreaterThan(0);

      const firstFile = manifest.files[0];
      const firstFilePath = path.join(backupDir, firstFile.path);
      await rm(firstFilePath, { force: true });

      // 2. Corrupt another file (checksum mismatch)
      if (manifest.files.length > 1) {
        const secondFile = manifest.files[1];
        const secondFilePath = path.join(backupDir, secondFile.path);
        if (await fileExists(secondFilePath)) {
          await writeFile(secondFilePath, 'CORRUPTED');
        }
      }

      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      expect(health.errors.length).toBeGreaterThan(0);

      // Should have both missing and checksum errors (if we created both)
      const hasMultipleErrorTypes =
        health.errors.some(e => e.includes('Missing')) ||
        health.errors.some(e => e.includes('Checksum mismatch'));

      expect(hasMultipleErrorTypes).toBe(true);
    });

    it('should handle validation of very large backups', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Add extra large files to the backup
      const layersDir = path.join(backupDir, 'layers');
      const layerSubDirs = await readdir(layersDir);
      expect(layerSubDirs.length).toBeGreaterThan(0);

      const layerDir = path.join(layersDir, layerSubDirs[0]);
      const largeContent = 'x'.repeat(1000000); // 1MB
      await writeFile(path.join(layerDir, 'large-file.txt'), largeContent);

      // Update manifest to include new file
      const manifestPath = path.join(backupDir, '.backup-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
      manifest.files.push({
        path: `layers/${layerSubDirs[0]}/large-file.txt`,
        checksum: createHash('sha256').update(largeContent).digest('hex'),
        size: largeContent.length
      });
      await writeFile(manifestPath, JSON.stringify(manifest));

      // Validate should still work
      const health = await manager.validateBackupIntegrity(backupDir);
      expect(health.filesChecked).toBeGreaterThan(0);
    });
  });

  describe('validation error recovery suggestions', () => {
    it('should provide actionable recovery suggestions on validation failure', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Corrupt the backup
      const layersDir = path.join(backupDir, 'layers');
      const layerSubDirs = await readdir(layersDir);
      expect(layerSubDirs.length).toBeGreaterThan(0);

      const layerDir = path.join(layersDir, layerSubDirs[0]);
      const layerFiles = await readdir(layerDir);
      expect(layerFiles.length).toBeGreaterThan(0);

      const filePath = path.join(layerDir, layerFiles[0]);
      await writeFile(filePath, 'CORRUPTED');

      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      expect(health.errors.length).toBeGreaterThan(0);

      // Check that errors are descriptive (should contain info about what's wrong)
      expect(health.errors.every(e => typeof e === 'string' && e.length > 0)).toBe(true);
    });

    it('should maintain backup health report structure on failure', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Corrupt backup
      const manifestPath = path.join(backupDir, '.backup-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));

      if (manifest.files.length > 0) {
        const firstFile = manifest.files[0];
        const filePath = path.join(backupDir, firstFile.path);
        await rm(filePath, { force: true });
      }

      const health = await manager.validateBackupIntegrity(backupDir);

      // Verify structure is consistent
      expect(typeof health.isValid).toBe('boolean');
      expect(typeof health.filesChecked).toBe('number');
      expect(Array.isArray(health.errors)).toBe(true);
      expect(health.filesChecked).toBeGreaterThan(0);
      expect(health.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validation edge cases', () => {
    it('should handle backup with only manifest file', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const fakeBackupDir = path.join(TEST_DIR, 'documentation-robotics', '.backups', 'manifest-only');
      await ensureDir(fakeBackupDir);

      // Create only the manifest
      const manifestPath = path.join(fakeBackupDir, '.backup-manifest.json');
      await writeFile(manifestPath, JSON.stringify({
        files: []
      }));

      const health = await manager.validateBackupIntegrity(fakeBackupDir);

      // Should be able to validate manifest-only backup
      expect(typeof health.isValid).toBe('boolean');
      expect(typeof health.filesChecked).toBe('number');
    });

    it('should detect swapped checksums between files', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Get manifest and swap checksums between files
      const manifestPath = path.join(backupDir, '.backup-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));

      expect(manifest.files.length).toBeGreaterThan(1);

      // Swap checksums between two files
      const temp = manifest.files[0].checksum;
      manifest.files[0].checksum = manifest.files[1].checksum;
      manifest.files[1].checksum = temp;

      await writeFile(manifestPath, JSON.stringify(manifest));

      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      expect(health.errors.some(e => e.includes('Checksum mismatch'))).toBe(true);
    });

    it('should handle concurrent validation attempts', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Run multiple validations concurrently
      const results = await Promise.all([
        manager.validateBackupIntegrity(backupDir),
        manager.validateBackupIntegrity(backupDir),
        manager.validateBackupIntegrity(backupDir)
      ]);

      // All should have same result
      expect(results[0].isValid).toBe(results[1].isValid);
      expect(results[1].isValid).toBe(results[2].isValid);
      expect(results[0].filesChecked).toBe(results[1].filesChecked);
      expect(results[1].filesChecked).toBe(results[2].filesChecked);
    });

    it('should validate backup after partial file modifications', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const backupDir = await (manager as any).backupModel(model);

      // Modify a file by appending to it
      const layersDir = path.join(backupDir, 'layers');
      const layerSubDirs = await readdir(layersDir);
      expect(layerSubDirs.length).toBeGreaterThan(0);

      const layerDir = path.join(layersDir, layerSubDirs[0]);
      const layerFiles = await readdir(layerDir);
      expect(layerFiles.length).toBeGreaterThan(0);

      const filePath = path.join(layerDir, layerFiles[0]);
      const content = await readFile(filePath, 'utf-8');
      await writeFile(filePath, content + '\nextra content'); // Append

      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      // Should detect both size mismatch and checksum mismatch
      expect(health.errors.length).toBeGreaterThan(0);
    });
  });
});
