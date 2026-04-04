import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestWorkdir } from '../../helpers/golden-copy.js';
import { Model } from '@/core/model';
import { ModelReportOrchestrator } from '@/reports/model-report-orchestrator';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CANONICAL_LAYER_NAMES, getLayerOrder } from '@/core/layers';

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
