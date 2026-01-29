import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { StagedChangesetStorage } from '../../src/core/staged-changeset-storage.js';
import { BaseSnapshotManager } from '../../src/core/base-snapshot-manager.js';
import { ChangesetExporter } from '../../src/core/changeset-exporter.js';
import { Model } from '../../src/core/model.js';
import { Manifest } from '../../src/core/manifest.js';
import { Layer } from '../../src/core/layer.js';
import { Element } from '../../src/core/element.js';
import { tmpdir } from 'os';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

describe('Export/Import Workflow', () => {
  let storage: StagedChangesetStorage;
  let snapshotManager: BaseSnapshotManager;
  let baseModel: Model;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dr-export-import-test-'));
    storage = new StagedChangesetStorage(tempDir);
    snapshotManager = new BaseSnapshotManager();

    // Create test model
    const manifest = new Manifest({
      name: 'Export Test Model',
      description: 'Model for testing export/import',
      version: '1.0.0',
      specVersion: '0.7.1',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    baseModel = new Model(tempDir, manifest);

    // Add API layer with test elements
    const apiLayer = new Layer('api');
    const endpoint = new Element({
      id: 'api-endpoint-get-user',
      type: 'endpoint',
      name: 'Get User',
      properties: { method: 'GET', path: '/users/{id}' },
    });
    apiLayer.addElement(endpoint);

    baseModel.addLayer(apiLayer);
    await baseModel.saveManifest();
    await baseModel.saveLayer('api');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('YAML Format Export/Import', () => {
    it('should export changeset to YAML format', async () => {
      const changesetId = 'yaml-export-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'YAML Export Test',
        'Test YAML export',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-post-user',
          layerName: 'api',
          after: {
            id: 'api-endpoint-post-user',
            type: 'endpoint',
            name: 'Create User',
            properties: { method: 'POST', path: '/users' },
          },
          sequenceNumber: 0,
        },
      ];

      await storage.save(changeset);

      // Export to YAML
      const yamlPath = join(tempDir, 'changeset.yaml');
      const changesetData = {
        id: changeset.id,
        name: changeset.name,
        description: changeset.description,
        status: changeset.status,
        created: changeset.created,
        modified: changeset.modified,
        changes: changeset.changes,
      };

      await writeFile(yamlPath, stringifyYaml(changesetData));

      // Verify YAML file was created
      const yamlContent = await readFile(yamlPath, 'utf-8');
      expect(yamlContent).toContain('api-endpoint-post-user');
      expect(yamlContent).toContain('Create User');
    });

    it('should import changeset from YAML format and preserve structure', async () => {
      const importId = 'yaml-import-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      // Create original changeset
      const original = await storage.create(
        importId,
        'YAML Import Test',
        'Test YAML import',
        baseSnapshot
      );

      original.changes = [
        {
          type: 'update',
          elementId: 'api-endpoint-get-user',
          layerName: 'api',
          before: {
            id: 'api-endpoint-get-user',
            type: 'endpoint',
            name: 'Get User',
          },
          after: {
            id: 'api-endpoint-get-user',
            type: 'endpoint',
            name: 'Get User (v2)',
            properties: { method: 'GET', path: '/users/{id}', deprecated: true },
          },
          sequenceNumber: 0,
        },
      ];

      await storage.save(original);

      // Export to YAML
      const yamlPath = join(tempDir, 'import-test.yaml');
      const changesetData = {
        id: original.id,
        name: original.name,
        description: original.description,
        status: original.status,
        created: original.created,
        modified: original.modified,
        changes: original.changes,
      };

      await writeFile(yamlPath, stringifyYaml(changesetData));

      // Import from YAML
      const yamlContent = await readFile(yamlPath, 'utf-8');
      const imported = parseYaml(yamlContent);

      // Verify imported data matches original
      expect(imported.id).toBe(original.id);
      expect(imported.name).toBe('YAML Import Test');
      expect(imported.changes.length).toBe(1);
      expect(imported.changes[0].elementId).toBe('api-endpoint-get-user');
      expect(imported.changes[0].after.name).toBe('Get User (v2)');
    });
  });

  describe('Base Snapshot Compatibility Validation', () => {
    it('should detect incompatibility when base model has changed', async () => {
      const changesetId = 'compat-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      // Create changeset with original base snapshot
      const changeset = await storage.create(
        changesetId,
        'Compatibility Test',
        'Test compatibility detection',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-compat',
          layerName: 'api',
          after: {
            id: 'api-endpoint-compat',
            type: 'endpoint',
            name: 'Compatibility Test',
          },
          sequenceNumber: 0,
        },
      ];

      await storage.save(changeset);

      // Modify base model
      const apiLayer = await baseModel.getLayer('api');
      if (apiLayer) {
        const newElement = new Element({
          id: 'api-endpoint-new-in-base',
          type: 'endpoint',
          name: 'New in Base',
        });
        apiLayer.addElement(newElement);
        await baseModel.saveLayer('api');
      }

      // Capture new snapshot
      const newSnapshot = await snapshotManager.captureSnapshot(baseModel);

      // Snapshots should differ
      expect(JSON.stringify(newSnapshot)).not.toBe(JSON.stringify(baseSnapshot));
    });

    it('should identify when new elements can be imported into modified base', async () => {
      const changesetId = 'selective-import';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Selective Import',
        'Test selective import',
        baseSnapshot
      );

      // Create changes that don't conflict with base modifications
      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-non-conflicting',
          layerName: 'api',
          after: {
            id: 'api-endpoint-non-conflicting',
            type: 'endpoint',
            name: 'Non-Conflicting Change',
          },
          sequenceNumber: 0,
        },
      ];

      await storage.save(changeset);

      // Modify base model by adding a completely different element
      const apiLayer = await baseModel.getLayer('api');
      if (apiLayer) {
        const divergentElement = new Element({
          id: 'api-endpoint-divergent',
          type: 'endpoint',
          name: 'Divergent Change',
        });
        apiLayer.addElement(divergentElement);
        await baseModel.saveLayer('api');
      }

      // The staged change should still be valid (doesn't conflict)
      const loaded = await storage.load(changesetId);
      expect(loaded?.changes.length).toBe(1);
      expect(loaded?.changes[0].elementId).toBe('api-endpoint-non-conflicting');
    });
  });

  describe('Changeset Metadata Preservation', () => {
    it('should preserve changeset metadata during export/import cycle', async () => {
      const changesetId = 'metadata-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Metadata Test Changeset',
        'A detailed description of this test changeset',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-metadata',
          layerName: 'api',
          after: {
            id: 'api-endpoint-metadata',
            type: 'endpoint',
            name: 'Metadata Test',
          },
          sequenceNumber: 0,
        },
      ];

      const originalCreated = changeset.created;

      await storage.save(changeset);

      // Load and verify metadata is preserved
      const loaded = await storage.load(changesetId);
      expect(loaded?.id).toBe(changesetId);
      expect(loaded?.name).toBe('Metadata Test Changeset');
      expect(loaded?.description).toBe('A detailed description of this test changeset');
      expect(loaded?.created).toBe(originalCreated);
      expect(loaded?.status).toBe('draft');
      // Verify changes are preserved
      expect(loaded?.changes.length).toBe(1);
      expect(loaded?.changes[0].elementId).toBe('api-endpoint-metadata');
    });
  });

  describe('Multi-Layer Export', () => {
    it('should export changes spanning multiple layers', async () => {
      const changesetId = 'multi-layer-export';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Multi-Layer Export',
        'Test exporting changes across layers',
        baseSnapshot
      );

      // Add data-model layer to base model
      const dataModelLayer = new Layer('data-model');
      const entity = new Element({
        id: 'data-model-entity-user',
        type: 'entity',
        name: 'User',
      });
      dataModelLayer.addElement(entity);
      baseModel.addLayer(dataModelLayer);
      await baseModel.saveLayer('data-model');

      // Create changes in multiple layers
      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-multi-1',
          layerName: 'api',
          after: {
            id: 'api-endpoint-multi-1',
            type: 'endpoint',
            name: 'Multi-Layer Test 1',
          },
          sequenceNumber: 0,
        },
        {
          type: 'add',
          elementId: 'data-model-entity-role',
          layerName: 'data-model',
          after: {
            id: 'data-model-entity-role',
            type: 'entity',
            name: 'Role',
          },
          sequenceNumber: 1,
        },
        {
          type: 'add',
          elementId: 'api-endpoint-multi-2',
          layerName: 'api',
          after: {
            id: 'api-endpoint-multi-2',
            type: 'endpoint',
            name: 'Multi-Layer Test 2',
          },
          sequenceNumber: 2,
        },
      ];

      await storage.save(changeset);

      // Verify all changes are saved
      const loaded = await storage.load(changesetId);
      expect(loaded?.changes.length).toBe(3);

      const apiChanges = loaded?.changes.filter((c) => c.layerName === 'api') || [];
      const dataModelChanges = loaded?.changes.filter((c) => c.layerName === 'data-model') || [];

      expect(apiChanges.length).toBe(2);
      expect(dataModelChanges.length).toBe(1);
    });
  });

  describe('ChangesetExporter Integration', () => {
    it('should export changeset to YAML using exporter', async () => {
      const changesetId = 'exporter-yaml-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Exporter YAML Test',
        'Test YAML export via exporter',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-export-test',
          layerName: 'api',
          after: {
            id: 'api-endpoint-export-test',
            type: 'endpoint',
            name: 'Export Test',
            properties: { method: 'POST', path: '/test' },
          },
          sequenceNumber: 0,
        },
      ];

      await storage.save(changeset);

      const exporter = new ChangesetExporter(tempDir);
      const yamlContent = await exporter.export(changesetId, 'yaml');

      expect(yamlContent).toContain('id: exporter-yaml-test');
      expect(yamlContent).toContain('Exporter YAML Test');
      expect(yamlContent).toContain('api-endpoint-export-test');
      expect(yamlContent).toContain('Export Test');
    });

    it('should export changeset to JSON using exporter', async () => {
      const changesetId = 'exporter-json-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Exporter JSON Test',
        'Test JSON export via exporter',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-json-test',
          layerName: 'api',
          after: {
            id: 'api-endpoint-json-test',
            type: 'endpoint',
            name: 'JSON Test',
          },
          sequenceNumber: 0,
        },
      ];

      await storage.save(changeset);

      const exporter = new ChangesetExporter(tempDir);
      const jsonContent = await exporter.export(changesetId, 'json');
      const parsed = JSON.parse(jsonContent);

      expect(parsed.id).toBe('exporter-json-test');
      expect(parsed.name).toBe('Exporter JSON Test');
      expect(parsed.changes.length).toBe(1);
      expect(parsed.changes[0].elementId).toBe('api-endpoint-json-test');
    });

    it('should export changeset to file', async () => {
      const changesetId = 'export-to-file-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Export to File Test',
        'Test exporting to file',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-file-test',
          layerName: 'api',
          after: {
            id: 'api-endpoint-file-test',
            type: 'endpoint',
            name: 'File Test',
          },
          sequenceNumber: 0,
        },
      ];

      await storage.save(changeset);

      const exporter = new ChangesetExporter(tempDir);
      const outputPath = join(tempDir, 'export-test.yaml');
      await exporter.exportToFile(changesetId, outputPath, 'yaml');

      const fileContent = await readFile(outputPath, 'utf-8');
      expect(fileContent).toContain('api-endpoint-file-test');
      expect(fileContent).toContain('Export to File Test');
    });

    it('should import changeset from YAML', async () => {
      const changesetId = 'import-yaml-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Import YAML Test',
        'Test importing from YAML',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-import-yaml',
          layerName: 'api',
          after: {
            id: 'api-endpoint-import-yaml',
            type: 'endpoint',
            name: 'Import YAML Test',
          },
          sequenceNumber: 0,
        },
      ];

      await storage.save(changeset);

      // Export to YAML
      const exporter = new ChangesetExporter(tempDir);
      const yamlContent = await exporter.export(changesetId, 'yaml');

      // Import from YAML
      const imported = await exporter.import(yamlContent, 'yaml');

      expect(imported.id).toBe(changesetId);
      expect(imported.name).toBe('Import YAML Test');
      expect(imported.changes.length).toBe(1);
      expect(imported.changes[0].elementId).toBe('api-endpoint-import-yaml');
      expect(imported.baseSnapshot).toBe(baseSnapshot);
    });

    it('should import changeset from JSON', async () => {
      const changesetId = 'import-json-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Import JSON Test',
        'Test importing from JSON',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-import-json',
          layerName: 'api',
          after: {
            id: 'api-endpoint-import-json',
            type: 'endpoint',
            name: 'Import JSON Test',
          },
          sequenceNumber: 0,
        },
      ];

      await storage.save(changeset);

      // Export to JSON
      const exporter = new ChangesetExporter(tempDir);
      const jsonContent = await exporter.export(changesetId, 'json');

      // Import from JSON
      const imported = await exporter.import(jsonContent, 'json');

      expect(imported.id).toBe(changesetId);
      expect(imported.name).toBe('Import JSON Test');
      expect(imported.changes.length).toBe(1);
    });

    it('should import changeset from file', async () => {
      const changesetId = 'import-file-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Import File Test',
        'Test importing from file',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-import-file',
          layerName: 'api',
          after: {
            id: 'api-endpoint-import-file',
            type: 'endpoint',
            name: 'Import File Test',
          },
          sequenceNumber: 0,
        },
      ];

      await storage.save(changeset);

      // Export to file
      const exporter = new ChangesetExporter(tempDir);
      const outputPath = join(tempDir, 'import-test.yaml');
      await exporter.exportToFile(changesetId, outputPath, 'yaml');

      // Import from file
      const imported = await exporter.importFromFile(outputPath);

      expect(imported.id).toBe(changesetId);
      expect(imported.name).toBe('Import File Test');
      expect(imported.changes.length).toBe(1);
    });

    it('should auto-detect YAML format', async () => {
      const changesetId = 'autodetect-yaml';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Autodetect YAML',
        'Test format autodetection',
        baseSnapshot
      );

      changeset.changes = [];
      await storage.save(changeset);

      const exporter = new ChangesetExporter(tempDir);
      const yamlContent = await exporter.export(changesetId, 'yaml');

      // Import without specifying format
      const imported = await exporter.import(yamlContent);

      expect(imported.name).toBe('Autodetect YAML');
    });

    it('should auto-detect JSON format', async () => {
      const changesetId = 'autodetect-json';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Autodetect JSON',
        'Test format autodetection',
        baseSnapshot
      );

      changeset.changes = [];
      await storage.save(changeset);

      const exporter = new ChangesetExporter(tempDir);
      const jsonContent = await exporter.export(changesetId, 'json');

      // Import without specifying format
      const imported = await exporter.import(jsonContent);

      expect(imported.name).toBe('Autodetect JSON');
    });

    it('should validate compatibility and detect incompatible elements', async () => {
      const changesetId = 'compat-validation-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Compatibility Validation',
        'Test compatibility validation',
        baseSnapshot
      );

      // Add changes that would be invalid
      changeset.changes = [
        {
          type: 'update',
          elementId: 'api-endpoint-nonexistent',
          layerName: 'api',
          before: { id: 'api-endpoint-nonexistent' },
          after: { id: 'api-endpoint-nonexistent', name: 'Updated' },
          sequenceNumber: 0,
        },
      ];

      await storage.save(changeset);

      const exporter = new ChangesetExporter(tempDir);
      const compatibility = await exporter.validateCompatibility(changeset, baseModel);

      expect(compatibility.compatible).toBe(false);
      expect(compatibility.missingElements).toContain('api-endpoint-nonexistent');
    });

    it('should allow valid additions even with base drift', async () => {
      const changesetId = 'valid-with-drift';
      const originalSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Valid with Drift',
        'Test valid additions despite drift',
        originalSnapshot
      );

      // Add a new element that doesnt conflict
      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-new-valid',
          layerName: 'api',
          after: {
            id: 'api-endpoint-new-valid',
            type: 'endpoint',
            name: 'New Valid Endpoint',
          },
          sequenceNumber: 0,
        },
      ];

      await storage.save(changeset);

      // Modify base model
      const apiLayer = await baseModel.getLayer('api');
      if (apiLayer) {
        const newElement = new Element({
          id: 'api-endpoint-drift-element',
          type: 'endpoint',
          name: 'Drift Element',
        });
        apiLayer.addElement(newElement);
        await baseModel.saveLayer('api');
      }

      const exporter = new ChangesetExporter(tempDir);
      const compatibility = await exporter.validateCompatibility(changeset, baseModel);

      // Should be compatible even though base has drifted
      expect(compatibility.compatible).toBe(true);
      expect(compatibility.baseSnapshotMatch).toBe(false);
    });

    it('should export and re-import with statistics preserved', async () => {
      const changesetId = 'stats-preservation';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Statistics Preservation',
        'Test stats preservation through export/import',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-new-1',
          layerName: 'api',
          after: { id: 'api-endpoint-new-1', type: 'endpoint', name: 'New 1' },
          sequenceNumber: 0,
        },
        {
          type: 'add',
          elementId: 'api-endpoint-new-2',
          layerName: 'api',
          after: { id: 'api-endpoint-new-2', type: 'endpoint', name: 'New 2' },
          sequenceNumber: 1,
        },
        {
          type: 'update',
          elementId: 'api-endpoint-get-user',
          layerName: 'api',
          before: { id: 'api-endpoint-get-user', name: 'Get User' },
          after: { id: 'api-endpoint-get-user', name: 'Get User (v2)' },
          sequenceNumber: 2,
        },
      ];

      changeset.updateStats();
      await storage.save(changeset);

      const exporter = new ChangesetExporter(tempDir);
      const yamlContent = await exporter.export(changesetId, 'yaml');
      const imported = await exporter.import(yamlContent, 'yaml');

      expect(imported.stats?.additions).toBe(2);
      expect(imported.stats?.modifications).toBe(1);
      expect(imported.stats?.deletions).toBe(0);
    });
  });

  describe('Patch format import limitations', () => {
    it('should import patch metadata but result in empty changes array', async () => {
      // This test documents the expected behavior of patch format import:
      // The patch format can extract header metadata but cannot reconstruct
      // individual change details from unified diff without full diff parsing.

      const changesetId = 'api-updates';
      const changeset = new (await import('../../src/core/changeset.js')).Changeset({
        id: changesetId,
        name: 'API Updates',
        description: 'Add new endpoints',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        status: 'staged',
        baseSnapshot: 'sha256:test123',
        changes: [
          {
            type: 'add',
            elementId: 'api-endpoint-create-user',
            layerName: 'api',
            timestamp: new Date().toISOString(),
            after: {
              id: 'api-endpoint-create-user',
              name: 'Create User',
              type: 'endpoint',
              properties: { method: 'POST', path: '/users' },
            },
          },
        ],
        stats: {
          additions: 1,
          modifications: 0,
          deletions: 0,
        },
      });

      await storage.save(changeset);

      const exporter = new ChangesetExporter(tempDir);
      const patchContent = await exporter.export(changesetId, 'patch');
      const imported = await exporter.import(patchContent, 'patch');

      // Verify metadata was extracted
      expect(imported.name).toBe('API Updates');
      expect(imported.description).toBe('Add new endpoints');
      expect(imported.baseSnapshot).toBe('sha256:test123');

      // Document the limitation: changes array is empty when importing patch format
      expect(imported.changes.length).toBe(0);
      expect(imported.stats?.additions).toBe(0);
      expect(imported.stats?.modifications).toBe(0);
      expect(imported.stats?.deletions).toBe(0);
    });
  });
});
