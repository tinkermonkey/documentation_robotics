import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createTestWorkdir } from '../../helpers/golden-copy.js';
import { Model } from '@/core/model';
import { ModelReportOrchestrator } from '@/reports/model-report-orchestrator';
import { MutationHandler } from '@/core/mutation-handler';
import { Element } from '@/core/element';
import { StagingAreaManager } from '@/core/staging-area';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CANONICAL_LAYER_NAMES, getLayerOrder } from '@/core/layers';
import * as telemetry from '@/telemetry/index';

describe('ModelReportOrchestrator Integration', () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>> | null = null;

  // Each test gets its own isolated workdir to avoid test execution order dependencies
  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    if (workdir) await workdir.cleanup();
  });

  function getWorkdir() {
    if (!workdir) throw new Error('Workdir not initialized');
    return workdir;
  }

  it('should generate all 12 layer reports on first run', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    const orchestrator = new ModelReportOrchestrator(model, workdir_temp.path);
    await orchestrator.regenerateAll();

    // Verify all 12 reports exist
    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');

    for (const layerName of CANONICAL_LAYER_NAMES) {
      const layerNumber = getLayerOrder(layerName);
      const filename = `${String(layerNumber).padStart(2, '0')}-${layerName}-layer-report.md`;
      const filePath = path.join(reportsDir, filename);

      const exists = await fs.access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      // Verify file has content
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);

      // Verify markdown structure
      expect(content).toContain('# ');
      expect(content).toContain('## ');
    }
  });

  it('should create reports directory if it does not exist', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    // Remove reports directory if it exists
    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');
    try {
      await fs.rm(reportsDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist, that's fine
    }

    // Regenerate should create the directory
    const orchestrator = new ModelReportOrchestrator(model, workdir_temp.path);
    await orchestrator.regenerateAll();

    const exists = await fs.access(reportsDir)
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(true);
  });

  it('should regenerate only affected layers when reports exist', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    // First, generate all reports
    const orchestrator = new ModelReportOrchestrator(model, workdir_temp.path);
    await orchestrator.regenerateAll();

    // Record initial modification times
    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');
    const initialMtimes = new Map<string, number>();

    for (const layerName of CANONICAL_LAYER_NAMES) {
      const layerNumber = getLayerOrder(layerName);
      const filename = `${String(layerNumber).padStart(2, '0')}-${layerName}-layer-report.md`;
      const filePath = path.join(reportsDir, filename);
      const stat = await fs.stat(filePath);
      initialMtimes.set(layerName, stat.mtimeMs);
    }

    // Small delay to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Regenerate only api layer
    const affectedLayers = new Set(['api']);
    await orchestrator.regenerate(affectedLayers);

    // Check that only api report was modified
    for (const layerName of CANONICAL_LAYER_NAMES) {
      const layerNumber = getLayerOrder(layerName);
      const filename = `${String(layerNumber).padStart(2, '0')}-${layerName}-layer-report.md`;
      const filePath = path.join(reportsDir, filename);
      const stat = await fs.stat(filePath);

      if (layerName === 'api') {
        // API should have been regenerated (newer)
        expect(stat.mtimeMs).toBeGreaterThan(initialMtimes.get(layerName)!);
      } else {
        // Other layers should not have changed
        expect(stat.mtimeMs).toBe(initialMtimes.get(layerName));
      }
    }
  });

  it('should fall back to regenerateAll when reports directory is missing', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    // Remove reports directory
    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');
    try {
      await fs.rm(reportsDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }

    // Call regenerate with a small set, should fall back to regenerateAll
    const orchestrator = new ModelReportOrchestrator(model, workdir_temp.path);
    await orchestrator.regenerate(new Set(['api']));

    // Should have created all 12 reports
    for (const layerName of CANONICAL_LAYER_NAMES) {
      const layerNumber = getLayerOrder(layerName);
      const filename = `${String(layerNumber).padStart(2, '0')}-${layerName}-layer-report.md`;
      const filePath = path.join(reportsDir, filename);

      const exists = await fs.access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    }
  });

  it('should use correct file naming convention', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    const orchestrator = new ModelReportOrchestrator(model, workdir_temp.path);
    await orchestrator.regenerateAll();

    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');

    // Check specific examples
    const apiPath = path.join(reportsDir, '06-api-layer-report.md');
    const dataModelPath = path.join(reportsDir, '07-data-model-layer-report.md');
    const testingPath = path.join(reportsDir, '12-testing-layer-report.md');

    const apiExists = await fs.access(apiPath)
      .then(() => true)
      .catch(() => false);
    const dataModelExists = await fs.access(dataModelPath)
      .then(() => true)
      .catch(() => false);
    const testingExists = await fs.access(testingPath)
      .then(() => true)
      .catch(() => false);

    expect(apiExists).toBe(true);
    expect(dataModelExists).toBe(true);
    expect(testingExists).toBe(true);
  });

  it('should contain model version in reports', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    const orchestrator = new ModelReportOrchestrator(model, workdir_temp.path);
    await orchestrator.regenerateAll();

    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');
    const apiPath = path.join(reportsDir, '06-api-layer-report.md');

    const content = await fs.readFile(apiPath, 'utf-8');

    // Should contain model version in footer
    expect(content).toContain('Model Version:');
  });

  it('should add element to model → verify affected layers regenerate', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    // First, generate initial reports
    const orchestrator = new ModelReportOrchestrator(model, workdir_temp.path);
    await orchestrator.regenerateAll();

    // Record initial API report content
    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');
    const apiReportPath = path.join(reportsDir, '06-api-layer-report.md');
    const initialContent = await fs.readFile(apiReportPath, 'utf-8');
    const initialLength = initialContent.length;

    // Add a new endpoint element to the API layer
    const apiLayer = await model.getLayer('api');
    if (!apiLayer) throw new Error('API layer not found');

    apiLayer.addElement({
      id: 'api.endpoint.test-new-endpoint',
      name: 'Test New Endpoint',
      type: 'endpoint',
      description: 'A newly added endpoint for testing',
      metadata: {},
    });

    // Compute affected layers (should include api and any layers that reference it)
    const affectedLayers = orchestrator.computeAffectedLayers('api');
    expect(affectedLayers.has('api')).toBe(true);

    // Regenerate affected layers
    await orchestrator.regenerate(affectedLayers);

    // Verify the API report was updated with new content
    const updatedContent = await fs.readFile(apiReportPath, 'utf-8');
    expect(updatedContent).toContain('test-new-endpoint');
    // New report should reflect the added element (typically longer or different)
    expect(updatedContent).not.toBe(initialContent);
  });

  it('computeAffectedLayers should reject invalid layer names', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    const orchestrator = new ModelReportOrchestrator(model, workdir_temp.path);

    // Should throw on invalid layer name
    expect(() => {
      orchestrator.computeAffectedLayers('invalid-layer');
    }).toThrow();

    expect(() => {
      orchestrator.computeAffectedLayers('apii'); // Typo
    }).toThrow();
  });

  it('regenerate should skip invalid layer names with warning', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    const orchestrator = new ModelReportOrchestrator(model, workdir_temp.path);
    await orchestrator.regenerateAll();

    // Capture console.warn calls
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0]));
    };

    // Call regenerate with a set containing an invalid layer name
    const affectedLayers = new Set(['api', 'invalid-layer', 'motivation']);
    await orchestrator.regenerate(affectedLayers);

    // Restore console.warn
    console.warn = originalWarn;

    // Should have warned about the invalid layer
    expect(warnings.some((w) => w.includes('invalid-layer'))).toBe(true);

    // Valid layers should have been processed without error
    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');
    const apiPath = path.join(reportsDir, '06-api-layer-report.md');
    const motivationPath = path.join(reportsDir, '01-motivation-layer-report.md');

    const apiExists = await fs.access(apiPath)
      .then(() => true)
      .catch(() => false);
    const motivationExists = await fs.access(motivationPath)
      .then(() => true)
      .catch(() => false);

    expect(apiExists).toBe(true);
    expect(motivationExists).toBe(true);
  });
});

describe('Mutation → Report Generation Integration', () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>> | null = null;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    if (workdir) await workdir.cleanup();
  });

  function getWorkdir() {
    if (!workdir) throw new Error('Workdir not initialized');
    return workdir;
  }

  it('element add → updates corresponding layer report', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) throw new Error('Failed to load model');

    // Remove reports directory to start fresh
    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');
    try {
      await fs.rm(reportsDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }

    // Add a new element using MutationHandler (which calls orchestrator)
    const handler = new MutationHandler(model, 'api.endpoint.test-endpoint', 'api');
    const newElement = new Element({
      id: 'api.endpoint.test-endpoint',
      name: 'Test Endpoint',
      type: 'endpoint',
      description: 'Test endpoint',
      metadata: {},
    });

    await handler.executeAdd(newElement, async () => {
      const layer = await model.getLayer('api');
      if (layer) {
        layer.addElement(newElement);
      }
    });

    // Verify report file was created
    const apiReportPath = path.join(reportsDir, '06-api-layer-report.md');
    const exists = await fs.access(apiReportPath)
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(true);

    // Verify the report contains the new element
    const content = await fs.readFile(apiReportPath, 'utf-8');
    expect(content).toContain('test-endpoint');
  });

  it('element delete → updates corresponding layer report', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) throw new Error('Failed to load model');

    // First generate initial reports
    const orchestrator = new ModelReportOrchestrator(model, workdir_temp.path);
    await orchestrator.regenerateAll();

    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');
    const apiReportPath = path.join(reportsDir, '06-api-layer-report.md');
    const initialContent = await fs.readFile(apiReportPath, 'utf-8');

    // Get an existing element from the API layer to delete
    const apiLayer = await model.getLayer('api');
    if (!apiLayer) throw new Error('API layer not found');

    const elements = apiLayer.listElements();
    if (elements.length === 0) throw new Error('No elements in API layer');

    const elementToDelete = elements[0];

    // Delete using MutationHandler
    const handler = new MutationHandler(model, elementToDelete.id, 'api');
    await handler.executeDelete(elementToDelete);

    // Verify the report was updated
    const updatedContent = await fs.readFile(apiReportPath, 'utf-8');
    expect(updatedContent).not.toBe(initialContent);
  });

  it('relationship add → updates reports for both source and target layers', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) throw new Error('Failed to load model');

    // Generate initial reports
    const orchestrator = new ModelReportOrchestrator(model, workdir_temp.path);
    await orchestrator.regenerateAll();

    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');
    const apiReportPath = path.join(reportsDir, '06-api-layer-report.md');
    const appReportPath = path.join(reportsDir, '04-application-layer-report.md');

    const initialApiContent = await fs.readFile(apiReportPath, 'utf-8');
    const initialAppContent = await fs.readFile(appReportPath, 'utf-8');

    // Add a cross-layer relationship directly
    const sourceLayerName = 'api';
    const targetLayerName = 'application';

    // Get first element from each layer
    const sourceLayer = await model.getLayer(sourceLayerName);
    const targetLayer = await model.getLayer(targetLayerName);

    if (!sourceLayer || !targetLayer) throw new Error('Layers not found');

    const sourceElements = sourceLayer.listElements();
    const targetElements = targetLayer.listElements();

    if (sourceElements.length === 0 || targetElements.length === 0) {
      throw new Error('Not enough elements to create relationship');
    }

    const sourceElement = sourceElements[0];
    const targetElement = targetElements[0];

    // Add relationship directly (simulating no active changeset path)
    model.relationships.add({
      source: sourceElement.id,
      target: targetElement.id,
      predicate: 'exposes',
      layer: sourceLayerName,
      targetLayer: targetLayerName,
      category: 'structural',
    });

    await model.saveRelationships();
    await model.saveManifest();

    // Trigger report regeneration (as the mutation handler would do)
    await orchestrator.regenerate(new Set([sourceLayerName, targetLayerName]));

    // Verify both reports were updated
    const updatedApiContent = await fs.readFile(apiReportPath, 'utf-8');
    const updatedAppContent = await fs.readFile(appReportPath, 'utf-8');

    // Reports should reflect the new relationship
    expect(updatedApiContent).not.toBe(initialApiContent);
    expect(updatedAppContent).not.toBe(initialAppContent);
  });

  it('relationship delete → updates reports for both affected layers', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) throw new Error('Failed to load model');

    // Generate initial reports
    const orchestrator = new ModelReportOrchestrator(model, workdir_temp.path);
    await orchestrator.regenerateAll();

    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');

    // Find an existing relationship
    const allRelationships = model.relationships.getAll();
    expect(allRelationships.length).toBeGreaterThan(0);

    const relToDelete = allRelationships[0];
    const layer1 = relToDelete.layer;
    const layer2 = relToDelete.targetLayer || relToDelete.layer;

    // Get report paths
    const layerNumber1 = getLayerOrder(layer1);
    const layerNumber2 = getLayerOrder(layer2);
    const reportPath1 = path.join(reportsDir, `${String(layerNumber1).padStart(2, '0')}-${layer1}-layer-report.md`);
    const reportPath2 = path.join(reportsDir, `${String(layerNumber2).padStart(2, '0')}-${layer2}-layer-report.md`);

    const initialContent1 = await fs.readFile(reportPath1, 'utf-8');
    const initialContent2 = layer1 !== layer2 ? await fs.readFile(reportPath2, 'utf-8') : initialContent1;

    // Delete the relationship
    model.relationships.delete(relToDelete.source, relToDelete.target, relToDelete.predicate);
    await model.saveRelationships();
    await model.saveManifest();

    // Regenerate reports
    const affectedLayers = new Set([layer1]);
    if (layer2 !== layer1) {
      affectedLayers.add(layer2);
    }
    await orchestrator.regenerate(affectedLayers);

    // Verify reports were updated
    const updatedContent1 = await fs.readFile(reportPath1, 'utf-8');
    const updatedContent2 = layer1 !== layer2 ? await fs.readFile(reportPath2, 'utf-8') : updatedContent1;

    expect(updatedContent1).not.toBe(initialContent1);
    if (layer1 !== layer2) {
      expect(updatedContent2).not.toBe(initialContent2);
    }
  });

  it('report failure does not fail the mutation', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) throw new Error('Failed to load model');

    // Add a new element - the orchestrator will be created and regenerate called
    const handler = new MutationHandler(model, 'api.endpoint.fail-test', 'api');
    const newElement = new Element({
      id: 'api.endpoint.fail-test',
      name: 'Fail Test Endpoint',
      type: 'endpoint',
      description: 'Test',
      metadata: {},
    });

    // Inject a failing orchestrator by replacing the regenerate method
    const originalInstanceCreator = ModelReportOrchestrator.prototype.regenerate;
    let regenerateCalled = false;

    ModelReportOrchestrator.prototype.regenerate = async function() {
      regenerateCalled = true;
      throw new Error('Report generation failed');
    };

    try {
      await handler.executeAdd(newElement, async () => {
        const layer = await model.getLayer('api');
        if (layer) {
          layer.addElement(newElement);
        }
      });

      // Verify mutation succeeded despite orchestrator failure
      const apiLayer = await model.getLayer('api');
      expect(apiLayer?.getElement('api.endpoint.fail-test')).toBeDefined();

      // Verify regenerate was called (and failed)
      expect(regenerateCalled).toBe(true);
    } finally {
      // Restore original method
      ModelReportOrchestrator.prototype.regenerate = originalInstanceCreator;
    }
  });

  it('staged change does not trigger report generation', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) throw new Error('Failed to load model');

    // Create a changeset and activate it
    const stagingManager = new StagingAreaManager(workdir_temp.path, model);
    const changeset = await stagingManager.create('test-changeset', 'Test staged changes');

    // Activate the changeset to intercept mutations
    await stagingManager.setActive(changeset.id);

    // Remove reports directory to verify it doesn't get created
    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');
    try {
      await fs.rm(reportsDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }

    // Add an element while changeset is active
    const handler = new MutationHandler(model, 'api.endpoint.staged-test', 'api');
    const newElement = new Element({
      id: 'api.endpoint.staged-test',
      name: 'Staged Test Endpoint',
      type: 'endpoint',
      description: 'Test',
      metadata: {},
    });

    await handler.executeAdd(newElement, async () => {
      const layer = await model.getLayer('api');
      if (layer) {
        layer.addElement(newElement);
      }
    });

    // Reports directory should NOT be created (staging doesn't trigger reports)
    const dirExists = await fs.access(reportsDir)
      .then(() => true)
      .catch(() => false);

    expect(dirExists).toBe(false);

    // Clean up
    await stagingManager.clearActive();
  });

  it('fresh model with no reports dir → first mutation creates all 12 reports', async () => {
    const workdir_temp = getWorkdir();
    const model = await Model.load(workdir_temp.path);

    if (!model) throw new Error('Failed to load model');

    // Remove reports directory
    const reportsDir = path.join(workdir_temp.path, 'documentation-robotics', 'reports');
    try {
      await fs.rm(reportsDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }

    // Verify directory doesn't exist
    let dirExists = await fs.access(reportsDir)
      .then(() => true)
      .catch(() => false);
    expect(dirExists).toBe(false);

    // Add an element (should trigger initialization of all 12 reports)
    const handler = new MutationHandler(model, 'api.endpoint.init-test', 'api');
    const newElement = new Element({
      id: 'api.endpoint.init-test',
      name: 'Init Test',
      type: 'endpoint',
      description: 'Test',
      metadata: {},
    });

    await handler.executeAdd(newElement, async () => {
      const layer = await model.getLayer('api');
      if (layer) {
        layer.addElement(newElement);
      }
    });

    // Verify all 12 reports were created
    dirExists = await fs.access(reportsDir)
      .then(() => true)
      .catch(() => false);
    expect(dirExists).toBe(true);

    for (const layerName of CANONICAL_LAYER_NAMES) {
      const layerNumber = getLayerOrder(layerName);
      const filename = `${String(layerNumber).padStart(2, '0')}-${layerName}-layer-report.md`;
      const filePath = path.join(reportsDir, filename);

      const exists = await fs.access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    }
  });
});
