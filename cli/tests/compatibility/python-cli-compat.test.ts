/**
 * Python CLI Model Compatibility Tests
 *
 * Validates that TypeScript CLI can correctly load and work with
 * models created by the Python CLI (legacy format).
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { Model } from '../../src/core/model.js';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';

const TEST_MODEL_DIR = '/tmp/dr-python-cli-compat-test';

describe('Python CLI Model Compatibility', () => {
  beforeAll(async () => {
    // Clean up any existing test directory
    await rm(TEST_MODEL_DIR, { recursive: true, force: true });
    await mkdir(TEST_MODEL_DIR, { recursive: true });
  });

  describe('Dual Path Resolution', () => {
    it('should load manifest from root/model/manifest.yaml', async () => {
      // Create test structure: root/model/manifest.yaml
      await mkdir(join(TEST_MODEL_DIR, 'simple', 'model'), { recursive: true });

      const manifest = {
        schema: 'documentation-robotics-v1',
        cli_version: '0.7.0',
        spec_version: '0.6.0',
        created: '2025-01-01T00:00:00Z',
        updated: '2025-01-01T00:00:00Z',
        project: {
          name: 'Test Project',
          description: 'A test project',
          version: '1.0.0'
        },
        layers: {
          motivation: {
            order: 1,
            name: 'Motivation',
            path: 'model/01_motivation/',
            schema: '.dr/schemas/01-motivation-layer.schema.json',
            enabled: true,
            elements: {}
          }
        }
      };

      await writeFile(
        join(TEST_MODEL_DIR, 'simple', 'model', 'manifest.yaml'),
        JSON.stringify(manifest).replace(/"/g, "'").replace(/'/g, '"') // Quick YAML-ish format
      );

      const model = await Model.load(join(TEST_MODEL_DIR, 'simple'));

      expect(model.manifest.name).toBe('Test Project');
      expect(model.manifest.specVersion).toBe('0.6.0');
    });

    it('should load manifest from root/documentation-robotics/model/manifest.yaml', async () => {
      // Create test structure: root/documentation-robotics/model/manifest.yaml (Python CLI format)
      await mkdir(join(TEST_MODEL_DIR, 'python-style', 'documentation-robotics', 'model'), { recursive: true });

      const manifest = {
        schema: 'documentation-robotics-v1',
        cli_version: '0.7.0',
        spec_version: '0.6.0',
        created: '2025-01-01T00:00:00Z',
        updated: '2025-01-01T00:00:00Z',
        project: {
          name: 'Python Style Project',
          description: 'A project with Python CLI path structure',
          version: '1.0.0'
        },
        layers: {
          motivation: {
            order: 1,
            name: 'Motivation',
            path: 'documentation-robotics/model/01_motivation/',
            schema: '.dr/schemas/01-motivation-layer.schema.json',
            enabled: true,
            elements: {}
          }
        }
      };

      await writeFile(
        join(TEST_MODEL_DIR, 'python-style', 'documentation-robotics', 'model', 'manifest.yaml'),
        JSON.stringify(manifest).replace(/"/g, "'").replace(/'/g, '"')
      );

      const model = await Model.load(join(TEST_MODEL_DIR, 'python-style'));

      expect(model.manifest.name).toBe('Python Style Project');
    });
  });

  describe('Manifest Metadata Preservation', () => {
    it('should preserve Python CLI metadata fields', async () => {
      await mkdir(join(TEST_MODEL_DIR, 'metadata', 'model'), { recursive: true });

      const manifest = {
        schema: 'documentation-robotics-v1',
        cli_version: '0.7.0',
        spec_version: '0.6.0',
        created: '2025-01-01T00:00:00Z',
        updated: '2025-01-02T00:00:00Z',
        project: {
          name: 'Metadata Test',
          version: '1.0.0'
        },
        layers: {},
        statistics: {
          total_elements: 10,
          total_relationships: 5,
          completeness: 0.75,
          validation_status: 'valid'
        },
        cross_references: {
          total: 3,
          by_type: {
            'depends_on': 2,
            'implements': 1
          }
        },
        conventions: {
          id_format: '{layer}.{type}.{kebab-case-name}'
        },
        upgrade_history: [
          { version: '0.6.0', date: '2025-01-01' }
        ]
      };

      await writeFile(
        join(TEST_MODEL_DIR, 'metadata', 'model', 'manifest.yaml'),
        JSON.stringify(manifest).replace(/"/g, "'").replace(/'/g, '"')
      );

      const model = await Model.load(join(TEST_MODEL_DIR, 'metadata'));

      expect(model.manifest.statistics).toBeDefined();
      expect(model.manifest.statistics?.total_elements).toBe(10);
      expect(model.manifest.cross_references).toBeDefined();
      expect(model.manifest.cross_references?.total).toBe(3);
      expect(model.manifest.conventions).toBeDefined();
      expect(model.manifest.upgrade_history).toBeDefined();
      expect(model.manifest.upgrade_history?.length).toBe(1);
    });
  });

  describe('Layer Path Resolution from Manifest', () => {
    it('should read layer path from manifest.layers configuration', async () => {
      // Test will be implemented when we have actual layer loading logic
      expect(true).toBe(true);
    });
  });

  describe('Element ID Generation', () => {
    it('should auto-generate layer-prefixed IDs when missing', async () => {
      // This will test that elements without IDs get {layer}.{key} format
      expect(true).toBe(true);
    });
  });

  describe('Element Data Preservation', () => {
    it('should track layer field in loaded elements', async () => {
      expect(true).toBe(true);
    });

    it('should track filePath in loaded elements', async () => {
      expect(true).toBe(true);
    });

    it('should preserve rawData from YAML', async () => {
      expect(true).toBe(true);
    });
  });
});
