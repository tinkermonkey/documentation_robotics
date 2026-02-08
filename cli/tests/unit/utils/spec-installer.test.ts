import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, access, readFile } from 'fs/promises';
import path from 'path';
import { installSpecReference, needsSpecReferenceInstall } from '../../../src/utils/spec-installer.js';

describe('spec-installer', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('installSpecReference', () => {
    it('should create .dr directory structure', async () => {
      await installSpecReference(testDir);

      // Verify directory structure
      const drPath = path.join(testDir, '.dr');
      await access(drPath);
      await access(path.join(drPath, 'schemas'));
      await access(path.join(drPath, 'schemas', 'common'));
      await access(path.join(drPath, 'changesets'));
    });

    it('should create manifest.json with spec version', async () => {
      await installSpecReference(testDir);

      const manifestPath = path.join(testDir, '.dr', 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);

      expect(manifest.specVersion).toBeDefined();
      expect(typeof manifest.specVersion).toBe('string');
      expect(manifest.installedAt).toBeDefined();
    });

    it('should copy all layer schema files', async () => {
      await installSpecReference(testDir);

      const layerSchemas = [
        '01-motivation-layer.schema.json',
        '02-business-layer.schema.json',
        '03-security-layer.schema.json',
        '04-application-layer.schema.json',
        '05-technology-layer.schema.json',
        '06-api-layer.schema.json',
        '07-data-model-layer.schema.json',
        '08-data-store-layer.schema.json',
        '09-ux-layer.schema.json',
        '10-navigation-layer.schema.json',
        '11-apm-observability-layer.schema.json',
        '12-testing-layer.schema.json',
      ];

      const schemasDir = path.join(testDir, '.dr', 'schemas');
      for (const schema of layerSchemas) {
        const schemaPath = path.join(schemasDir, schema);
        await access(schemaPath);

        // Verify file is valid JSON
        const content = await readFile(schemaPath, 'utf-8');
        const parsed = JSON.parse(content);
        expect(parsed).toBeDefined();
      }
    });

    it('should copy common schema files', async () => {
      await installSpecReference(testDir);

      const commonSchemas = [
        'layer-extensions.schema.json',
        'predicates.schema.json',
        'relationships.schema.json',
        'source-references.schema.json',
      ];

      const commonDir = path.join(testDir, '.dr', 'schemas', 'common');
      for (const schema of commonSchemas) {
        const schemaPath = path.join(commonDir, schema);
        await access(schemaPath);

        // Verify file is valid JSON
        const content = await readFile(schemaPath, 'utf-8');
        const parsed = JSON.parse(content);
        expect(parsed).toBeDefined();
      }
    });

    it('should copy catalog files', async () => {
      await installSpecReference(testDir);

      const catalogFiles = [
        'relationship-catalog.json',
        'link-registry.json',
        'link-registry.schema.json',
        'relationship-type.schema.json',
      ];

      const schemasDir = path.join(testDir, '.dr', 'schemas');
      for (const file of catalogFiles) {
        const filePath = path.join(schemasDir, file);
        await access(filePath);

        // Verify file is valid JSON
        const content = await readFile(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        expect(parsed).toBeDefined();
      }
    });

    it('should create README.md with spec version', async () => {
      await installSpecReference(testDir);

      const readmePath = path.join(testDir, '.dr', 'README.md');
      const content = await readFile(readmePath, 'utf-8');

      expect(content).toContain('Documentation Robotics - Spec Reference');
      expect(content).toContain('manifest.json');
      expect(content).toContain('schemas/');
      expect(content).toContain('changesets/');
    });

    it('should handle force parameter gracefully', async () => {
      // First installation
      await installSpecReference(testDir, false);

      // Second installation with force=true (should not throw)
      await installSpecReference(testDir, true);

      // Verify files still exist
      const drPath = path.join(testDir, '.dr');
      await access(drPath);
    });

    it('should handle successful installation with fallback paths', async () => {
      // The function implements triple-fallback logic:
      // 1. dirname(fileURLToPath(import.meta.url))/../schemas/bundled
      // 2. projectRoot/src/schemas/bundled
      // 3. projectRoot/dist/schemas/bundled
      //
      // This test verifies installation succeeds when schemas are available

      await installSpecReference(testDir);

      // Verify files were installed by checking .dr directory exists
      const drPath = path.join(testDir, '.dr');
      await access(drPath);

      // Verify manifest was created
      const manifestPath = path.join(drPath, 'manifest.json');
      const manifestContent = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);
      expect(manifest.specVersion).toBeDefined();
    });
  });

  describe('needsSpecReferenceInstall', () => {
    it('should return true if .dr/manifest.json does not exist', async () => {
      const result = await needsSpecReferenceInstall(testDir);
      expect(result).toBe(true);
    });

    it('should return false if .dr/manifest.json exists', async () => {
      // Create the manifest first
      const drPath = path.join(testDir, '.dr');
      await mkdir(drPath, { recursive: true });
      const manifestPath = path.join(drPath, 'manifest.json');
      await writeFile(manifestPath, JSON.stringify({ specVersion: '0.8.0' }));

      const result = await needsSpecReferenceInstall(testDir);
      expect(result).toBe(false);
    });

    it('should handle non-existent project root gracefully', async () => {
      const nonExistentDir = path.join(testDir, 'does-not-exist');
      const result = await needsSpecReferenceInstall(nonExistentDir);
      expect(result).toBe(true);
    });
  });
});
