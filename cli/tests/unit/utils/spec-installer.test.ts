import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { installSpecReference, needsSpecReferenceInstall } from '../../../src/utils/spec-installer.js';
import { mkdir, rm, stat } from 'fs/promises';
import path from 'path';
import os from 'os';
import { readFile } from '../../../src/utils/file-io.js';

describe('spec-installer', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    testDir = path.join(os.tmpdir(), `spec-installer-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('installSpecReference', () => {
    it('should create .dr directory structure', async () => {
      await installSpecReference(testDir);

      const drPath = path.join(testDir, '.dr');
      const stats = await stat(drPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create manifest.json with spec version', async () => {
      await installSpecReference(testDir);

      const manifestPath = path.join(testDir, '.dr', 'manifest.json');
      const content = await readFile(manifestPath);
      const manifest = JSON.parse(content);

      expect(manifest).toBeDefined();
      expect(manifest.specVersion).toBeDefined();
      expect(manifest.installedAt).toBeDefined();
    });

    it('should create schemas directory', async () => {
      await installSpecReference(testDir);

      const schemasPath = path.join(testDir, '.dr', 'schemas');
      const stats = await stat(schemasPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create common schemas subdirectory', async () => {
      await installSpecReference(testDir);

      const commonPath = path.join(testDir, '.dr', 'schemas', 'common');
      const stats = await stat(commonPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create changesets directory', async () => {
      await installSpecReference(testDir);

      const changesetsPath = path.join(testDir, '.dr', 'changesets');
      const stats = await stat(changesetsPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should install all layer schema files with correct names', async () => {
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

      for (const schema of layerSchemas) {
        const schemaPath = path.join(testDir, '.dr', 'schemas', schema);
        const exists = await Bun.file(schemaPath).exists();
        expect(exists).toBe(true, `Schema file ${schema} should exist`);
      }
    });

    it('should install data-store schema with correct hyphenated filename', async () => {
      await installSpecReference(testDir);

      const schemaPath = path.join(testDir, '.dr', 'schemas', '08-data-store-layer.schema.json');
      const exists = await Bun.file(schemaPath).exists();
      expect(exists).toBe(true);
    });

    it('should install data-model schema with correct hyphenated filename', async () => {
      await installSpecReference(testDir);

      const schemaPath = path.join(testDir, '.dr', 'schemas', '07-data-model-layer.schema.json');
      const exists = await Bun.file(schemaPath).exists();
      expect(exists).toBe(true);
    });

    it('should install common schemas', async () => {
      await installSpecReference(testDir);

      const commonSchemas = [
        'layer-extensions.schema.json',
        'predicates.schema.json',
        'relationships.schema.json',
        'source-references.schema.json',
      ];

      for (const schema of commonSchemas) {
        const schemaPath = path.join(testDir, '.dr', 'schemas', 'common', schema);
        const exists = await Bun.file(schemaPath).exists();
        expect(exists).toBe(true, `Common schema ${schema} should exist`);
      }
    });

    it('should install relationship catalog and registry files', async () => {
      await installSpecReference(testDir);

      const catalogFiles = [
        'relationship-catalog.json',
        'link-registry.json',
        'link-registry.schema.json',
        'relationship-type.schema.json',
      ];

      for (const file of catalogFiles) {
        const filePath = path.join(testDir, '.dr', 'schemas', file);
        const exists = await Bun.file(filePath).exists();
        expect(exists).toBe(true, `Catalog file ${file} should exist`);
      }
    });

    it('should create README.md in .dr directory', async () => {
      await installSpecReference(testDir);

      const readmePath = path.join(testDir, '.dr', 'README.md');
      const exists = await Bun.file(readmePath).exists();
      expect(exists).toBe(true);
    });

    it('should write valid content to README.md', async () => {
      await installSpecReference(testDir);

      const readmePath = path.join(testDir, '.dr', 'README.md');
      const content = await readFile(readmePath);

      expect(content).toContain('Documentation Robotics');
      expect(content).toContain('Spec Version');
      expect(content).toContain('ephemeral');
    });
  });

  describe('needsSpecReferenceInstall', () => {
    it('should return true when .dr directory does not exist', async () => {
      const needs = await needsSpecReferenceInstall(testDir);
      expect(needs).toBe(true);
    });

    it('should return false when manifest.json exists', async () => {
      await installSpecReference(testDir);
      const needs = await needsSpecReferenceInstall(testDir);
      expect(needs).toBe(false);
    });
  });

  describe('schema filename consistency', () => {
    it('should resolve layer filenames matching SchemaValidator expectations', async () => {
      // The filenames installed by spec-installer should match what SchemaValidator expects
      await installSpecReference(testDir);

      const expectedFilenames = {
        'motivation': '01-motivation-layer.schema.json',
        'business': '02-business-layer.schema.json',
        'security': '03-security-layer.schema.json',
        'application': '04-application-layer.schema.json',
        'technology': '05-technology-layer.schema.json',
        'api': '06-api-layer.schema.json',
        'data-model': '07-data-model-layer.schema.json',
        'data-store': '08-data-store-layer.schema.json',
        'ux': '09-ux-layer.schema.json',
        'navigation': '10-navigation-layer.schema.json',
        'apm': '11-apm-observability-layer.schema.json',
        'testing': '12-testing-layer.schema.json',
      };

      for (const [layer, filename] of Object.entries(expectedFilenames)) {
        const schemaPath = path.join(testDir, '.dr', 'schemas', filename);
        const exists = await Bun.file(schemaPath).exists();
        expect(exists).toBe(true, `Schema for layer '${layer}' should exist at ${filename}`);
      }
    });
  });
});
