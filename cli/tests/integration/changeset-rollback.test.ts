import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { Model } from '../../src/core/model.js';
import { StagingAreaManager } from '../../src/core/staging-area.js';
import { Element } from '../../src/core/element.js';
import { rm, mkdir, readFile, writeFile, cp, readdir } from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { fileExists } from '../../src/utils/file-io.js';

const TEST_DIR = '/tmp/changeset-rollback-test';
const BASELINE_DIR = path.join(process.cwd(), '..', 'cli-validation', 'test-project', 'baseline');

describe('Changeset Rollback Verification', () => {
  let model: Model;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original working directory
    originalCwd = process.cwd();

    // Clean test directory
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }

    await mkdir(TEST_DIR, { recursive: true });

    // Copy baseline project
    await cp(BASELINE_DIR, TEST_DIR, { recursive: true });

    // Change to test directory and load model
    process.chdir(TEST_DIR);
    model = await Model.load(undefined, { lazyLoad: false });
  });

  afterAll(async () => {
    // Restore original working directory
    process.chdir(originalCwd);

    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('backup content verification', () => {
    it('should create backup that exactly matches original model', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Capture checksums of original files
      const originalChecksums = await captureModelChecksums(model);

      // Create backup
      const backupDir = await (manager as any).backupModel(model);

      // Verify backup checksums match originals
      const backupChecksums = await captureBackupChecksums(backupDir);

      expect(backupChecksums.manifest).toBe(originalChecksums.manifest);

      for (const [layerName, originalChecksum] of Object.entries(originalChecksums.layers)) {
        expect(backupChecksums.layers[layerName]).toBe(originalChecksum);
      }
    });

    it('should restore model to exact original state', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Capture original state
      const originalChecksums = await captureModelChecksums(model);
      const originalElementCount = await countElements(model);

      // Create backup
      const backupDir = await (manager as any).backupModel(model);

      // Modify model (add elements)
      const layer = await model.getLayer('motivation');
      if (layer) {
        layer.addElement(new Element({
          id: 'motivation-goal-test1',
          type: 'goal',
          name: 'Test Goal 1',
          properties: {}
        }));
        layer.addElement(new Element({
          id: 'motivation-goal-test2',
          type: 'goal',
          name: 'Test Goal 2',
          properties: {}
        }));
        await model.saveLayer('motivation');
      }

      // Verify model was modified
      await model.loadLayer('motivation');
      const modifiedElementCount = await countElements(model);
      expect(modifiedElementCount).toBeGreaterThan(originalElementCount);

      // Restore from backup
      await (manager as any).restoreModel(model, backupDir);

      // Reload all layers from disk to verify restoration
      const layerNames = ['motivation', 'business', 'security', 'application', 'technology',
                          'api', 'data_model', 'datastore', 'ux', 'navigation', 'testing'];
      for (const layerName of layerNames) {
        await model.loadLayer(layerName);
      }

      // Verify checksums match original
      const restoredChecksums = await captureModelChecksums(model);
      expect(restoredChecksums.manifest).toBe(originalChecksums.manifest);

      for (const [layerName, originalChecksum] of Object.entries(originalChecksums.layers)) {
        expect(restoredChecksums.layers[layerName]).toBe(originalChecksum);
      }

      // Verify element count matches original
      const restoredElementCount = await countElements(model);
      expect(restoredElementCount).toBe(originalElementCount);
    });

    it('should verify backup manifest tracks all files', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Create backup
      const backupDir = await (manager as any).backupModel(model);

      // Load backup manifest
      const manifestPath = path.join(backupDir, '.backup-manifest.json');
      const manifestContent = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      // Verify manifest includes all expected files
      expect(manifest.files.length).toBeGreaterThan(0);

      const filePaths = manifest.files.map((f: any) => f.path);
      // Check for either manifest.yaml or manifest.json
      const hasManifest = filePaths.includes('manifest.yaml') || filePaths.includes('manifest.json');
      expect(hasManifest).toBe(true);

      // Verify manifest includes all layers (check for files within layer directories)
      for (const layer of model.layers.values()) {
        const layerFiles = filePaths.filter(p => p.startsWith(`layers/${layer.name}/`));
        expect(layerFiles.length).toBeGreaterThan(0);
      }

      // Verify all files have checksums and sizes
      for (const file of manifest.files) {
        expect(file.checksum).toBeDefined();
        expect(file.checksum).toMatch(/^[a-f0-9]{64}$/);
        expect(file.size).toBeGreaterThan(0);
      }
    });
  });

  describe('backup integrity validation', () => {
    it('should validate intact backup successfully', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Create backup
      const backupDir = await (manager as any).backupModel(model);

      // Validate backup integrity
      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(true);
      expect(health.filesChecked).toBeGreaterThan(0);
      expect(health.errors.length).toBe(0);
    });

    it('should detect missing backup files', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Create backup
      const backupDir = await (manager as any).backupModel(model);

      // Corrupt backup by removing a file
      const manifestPath = path.join(backupDir, 'manifest.yaml');
      if (await fileExists(manifestPath)) {
        await rm(manifestPath, { force: true });
      } else {
        await rm(path.join(backupDir, 'manifest.json'), { force: true });
      }

      // Validate should detect missing file
      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      expect(health.errors.length).toBeGreaterThan(0);
      expect(health.errors.some(e => e.includes('Missing'))).toBe(true);
    });

    it('should detect checksum mismatches', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Create backup
      const backupDir = await (manager as any).backupModel(model);

      // Find and corrupt a layer file
      const layersDir = path.join(backupDir, 'layers');
      const layerSubDirs = await readdir(layersDir);
      if (layerSubDirs.length > 0) {
        const firstLayer = layerSubDirs[0];
        const layerDir = path.join(layersDir, firstLayer);
        const layerFiles = await readdir(layerDir);
        if (layerFiles.length > 0) {
          const filePath = path.join(layerDir, layerFiles[0]);
          // Corrupt the file by appending garbage
          await writeFile(filePath, (await readFile(filePath, 'utf-8')) + '\nCORRUPTED');
        }
      }

      // Validate should detect checksum mismatch
      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      expect(health.errors.length).toBeGreaterThan(0);
      expect(health.errors.some(e => e.includes('Checksum mismatch'))).toBe(true);
    });

    it('should detect missing backup manifest', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Create a fake backup directory without manifest
      const backupDir = path.join(TEST_DIR, 'documentation-robotics', '.backups', 'fake-backup');
      await mkdir(backupDir, { recursive: true });

      // Validate should fail
      try {
        await manager.validateBackupIntegrity(backupDir);
        expect(true).toBe(false); // Should throw
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('Backup manifest not found');
      }
    });

    it('should detect nonexistent backup directory', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Validate should fail for nonexistent directory
      try {
        await manager.validateBackupIntegrity('/nonexistent/backup/dir');
        expect(true).toBe(false); // Should throw
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('Backup directory not found');
      }
    });

    it('should provide detailed error information on validation failure', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Create backup
      const backupDir = await (manager as any).backupModel(model);

      // Corrupt multiple files
      const layersDir = path.join(backupDir, 'layers');
      const layerSubDirs = await readdir(layersDir);
      for (let i = 0; i < Math.min(2, layerSubDirs.length); i++) {
        const layerDir = path.join(layersDir, layerSubDirs[i]);
        const layerFiles = await readdir(layerDir);
        if (layerFiles.length > 0) {
          const filePath = path.join(layerDir, layerFiles[0]);
          await writeFile(filePath, 'CORRUPTED_DATA');
        }
      }

      // Validate should report multiple errors
      const health = await manager.validateBackupIntegrity(backupDir);

      expect(health.isValid).toBe(false);
      expect(health.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('rollback failure scenarios', () => {
    it('should handle commit failure with successful rollback', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Create changeset with invalid change
      const changeset = await manager.create('test-rollback', 'Test');
      await manager.setActive(changeset.id!);

      // Capture original state
      const originalChecksums = await captureModelChecksums(model);

      // Add invalid change (nonexistent layer)
      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'test-elem',
        layerName: 'nonexistent-layer',
        timestamp: new Date().toISOString(),
        after: { name: 'Test' }
      });

      // Try to commit (should fail and rollback)
      try {
        await manager.commit(model, changeset.id!);
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('not found');
      }

      // Verify model was rolled back to original state
      // Reload all layers to verify restoration
      for (const layerName of model.getLayerNames()) {
        await model.loadLayer(layerName);
      }
      const restoredChecksums = await captureModelChecksums(model);

      expect(restoredChecksums.manifest).toBe(originalChecksums.manifest);

      for (const [layerName, originalChecksum] of Object.entries(originalChecksums.layers)) {
        expect(restoredChecksums.layers[layerName]).toBe(originalChecksum);
      }
    });

    it('should provide detailed error when rollback fails', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Mock restoreModel to fail
      const originalRestore = (manager as any).restoreModel;
      (manager as any).restoreModel = async () => {
        throw new Error('Simulated restore failure');
      };

      const changeset = await manager.create('test-restore-fail', 'Test');
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'test',
        layerName: 'nonexistent',
        timestamp: new Date().toISOString(),
        after: {}
      });

      try {
        // Disable validation to reach the apply phase where failure occurs
        await manager.commit(model, changeset.id!, { validate: false });
        expect(true).toBe(false);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        const message = (error as Error).message;
        expect(message).toContain('Commit failed AND rollback failed');
        expect(message).toContain('Original commit error');
        expect(message).toContain('Rollback error');
        expect(message).toContain('Backup location');
        // CRITICAL: Verify backup integrity check is included
        expect(message).toContain('Backup integrity check');
      }

      // Restore mock
      (manager as any).restoreModel = originalRestore;
    });

    it('should validate backup integrity before suggesting manual restoration', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Mock restoreModel to fail
      const originalRestore = (manager as any).restoreModel;
      (manager as any).restoreModel = async () => {
        throw new Error('Simulated restore failure');
      };

      const changeset = await manager.create('test-backup-check', 'Test');
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'test',
        layerName: 'nonexistent',
        timestamp: new Date().toISOString(),
        after: {}
      });

      try {
        // Disable validation to reach the apply phase where failure occurs
        await manager.commit(model, changeset.id!, { validate: false });
        expect(true).toBe(false);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        const message = (error as Error).message;
        const cliError = error as any;

        // Should include backup integrity check result in message
        expect(message).toContain('Backup integrity check');

        // If backup is valid, suggestions should include manual restoration
        if (message.includes('✓ Backup is valid')) {
          expect(cliError.suggestions).toBeDefined();
          const suggestionsText = (cliError.suggestions || []).join(' ');
          expect(suggestionsText).toContain('Backup is valid');
          expect(suggestionsText).toContain('Manually restore from backup');
        } else {
          // Backup is corrupted, suggestions should warn against restoration
          expect(cliError.suggestions).toBeDefined();
          const suggestionsText = (cliError.suggestions || []).join(' ');
          expect(suggestionsText).toContain('Do NOT use this backup for recovery');
        }
      }

      // Restore mock
      (manager as any).restoreModel = originalRestore;
    });

    it('should warn when backup is corrupted during failed rollback', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Mock restoreModel to fail
      const originalRestore = (manager as any).restoreModel;
      (manager as any).restoreModel = async () => {
        throw new Error('Simulated restore failure');
      };

      // Create changeset and trigger failure
      const changeset = await manager.create('test-corrupted-backup', 'Test');
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'test',
        layerName: 'nonexistent',
        timestamp: new Date().toISOString(),
        after: {}
      });

      // Corrupt the backup during commit by mocking validation to fail
      const originalValidate = manager.validateBackupIntegrity;
      let backupDirToCorrupt: string | null = null;

      (manager as any).restoreModel = async () => {
        throw new Error('Simulated restore failure');
      };

      manager.validateBackupIntegrity = async (backupDir: string) => {
        backupDirToCorrupt = backupDir;
        return {
          isValid: false,
          filesChecked: 1,
          errors: ['Test: simulated backup corruption']
        };
      };

      try {
        await manager.commit(model, changeset.id!, { validate: false });
        expect(true).toBe(false);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        const message = (error as Error).message;
        const cliError = error as any;

        // Should detect backup corruption in message
        expect(message).toContain('Backup integrity issues found');

        // Suggestions should warn against manual restoration
        expect(cliError.suggestions).toBeDefined();
        const suggestionsText = (cliError.suggestions || []).join(' ');
        expect(suggestionsText).toContain('Do NOT use this backup for recovery');
      }

      // Restore original
      (manager as any).restoreModel = originalRestore;
      manager.validateBackupIntegrity = originalValidate;
    });
  });

  describe('partial restoration handling', () => {
    it('should handle missing layer in backup', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Create backup
      const backupDir = await (manager as any).backupModel(model);

      // Remove a layer directory from backup
      const layerDir = path.join(backupDir, 'layers', 'motivation');
      await rm(layerDir, { recursive: true, force: true });

      // Capture console warnings
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (msg: string) => warnings.push(msg);

      try {
        // Restore should succeed but warn
        await (manager as any).restoreModel(model, backupDir);

        // Should have warned about missing layer
        expect(warnings.some(w => w.includes('not found in backup'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });

    it('should fail immediately if manifest restore fails', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Create backup
      const backupDir = await (manager as any).backupModel(model);

      // Corrupt manifest in backup - remove both possible formats
      await rm(path.join(backupDir, 'manifest.yaml'), { force: true });
      await rm(path.join(backupDir, 'manifest.json'), { force: true });

      // Restore should fail immediately
      try {
        await (manager as any).restoreModel(model, backupDir);
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('Failed to restore manifest');
      }
    });

    it('should provide detailed progress report on failure', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Create backup
      const backupDir = await (manager as any).backupModel(model);

      // Make manifest unreadable by removing it - remove both possible formats
      await rm(path.join(backupDir, 'manifest.yaml'), { force: true });
      await rm(path.join(backupDir, 'manifest.json'), { force: true });

      try {
        await (manager as any).restoreModel(model, backupDir);
        expect(true).toBe(false);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        const message = (error as Error).message;
        expect(message).toContain('Restoration progress');
        expect(message).toContain('Successfully restored');
        expect(message).toContain('Failed to restore');
        expect(message).toContain('Backup location');
      }
    });
  });
});

// Helper functions

async function captureModelChecksums(model: Model): Promise<{
  manifest: string;
  layers: Record<string, string>;
}> {
  // Use the actual manifest path from the model
  const manifestPath = path.join(model.rootPath, 'documentation-robotics', 'model', 'manifest.yaml');
  const manifestContent = await readFile(manifestPath, 'utf-8');
  const manifestChecksum = createHash('sha256').update(manifestContent).digest('hex');

  const layerChecksums: Record<string, string> = {};

  for (const layer of model.layers.values()) {
    // Layers in baseline are in numbered directories with elements.yaml files
    const layerNumber = getLayerNumber(layer.name);
    const layerPath = path.join(model.rootPath, 'documentation-robotics', 'model', layerNumber, 'elements.yaml');
    if (await fileExists(layerPath)) {
      const layerContent = await readFile(layerPath, 'utf-8');
      layerChecksums[layer.name] = createHash('sha256').update(layerContent).digest('hex');
    }
  }

  return {
    manifest: manifestChecksum,
    layers: layerChecksums
  };
}

function getLayerNumber(layerName: string): string {
  const layerMap: Record<string, string> = {
    'motivation': '01_motivation',
    'business': '02_business',
    'security': '03_security',
    'application': '04_application',
    'technology': '05_technology',
    'api': '06_api',
    'data_model': '07_data_model',
    'datastore': '08_datastore',
    'ux': '09_ux',
    'navigation': '10_navigation',
    'apm': '11_apm',
    'testing': '12_testing',
  };
  return layerMap[layerName] || layerName;
}

async function captureBackupChecksums(backupDir: string): Promise<{
  manifest: string;
  layers: Record<string, string>;
}> {
  // Try both .yaml and .json for manifest
  let manifestPath = path.join(backupDir, 'manifest.yaml');
  if (!(await fileExists(manifestPath))) {
    manifestPath = path.join(backupDir, 'manifest.json');
  }

  const manifestContent = await readFile(manifestPath, 'utf-8');
  const manifestChecksum = createHash('sha256').update(manifestContent).digest('hex');

  const layersDir = path.join(backupDir, 'layers');
  const layerFiles = await readdir(layersDir);

  const layerChecksums: Record<string, string> = {};

  for (const file of layerFiles) {
    if (file.endsWith('.json') || file.endsWith('.yaml')) {
      const layerPath = path.join(layersDir, file);
      const layerContent = await readFile(layerPath, 'utf-8');
      const layerName = file.replace(/\.(json|yaml)$/, '');
      layerChecksums[layerName] = createHash('sha256').update(layerContent).digest('hex');
    }
  }

  return {
    manifest: manifestChecksum,
    layers: layerChecksums
  };
}

async function countElements(model: Model): Promise<number> {
  let count = 0;
  for (const layer of model.layers.values()) {
    count += layer.listElements().length;
  }
  return count;
}
