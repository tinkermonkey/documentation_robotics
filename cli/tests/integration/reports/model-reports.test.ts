import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestWorkdir } from '../../helpers/golden-copy.js';
import { Model } from '@/core/model';
import { ModelReportOrchestrator } from '@/reports/model-report-orchestrator';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CANONICAL_LAYER_NAMES, getLayerOrder } from '@/core/layers';

let _workdir: Awaited<ReturnType<typeof createTestWorkdir>> | null = null;

// Use beforeAll with a 30s timeout so golden-copy filesystem setup does not race
// against the default 5s per-test timeout during concurrent test file execution.
beforeAll(async () => {
  _workdir = await createTestWorkdir();
}, 30000);

afterAll(async () => {
  if (_workdir) await _workdir.cleanup();
});

function getWorkdir() {
  if (!_workdir) throw new Error('Workdir not initialized — beforeAll must have failed');
  return _workdir;
}

describe('ModelReportOrchestrator Integration', () => {
  it('should generate all 12 layer reports on first run', async () => {
    const workdir = getWorkdir();
    const model = await Model.load(workdir.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    const orchestrator = new ModelReportOrchestrator(model, workdir.path);
    await orchestrator.regenerateAll();

    // Verify all 12 reports exist
    const reportsDir = path.join(workdir.path, 'documentation-robotics', 'reports');

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
    const workdir = getWorkdir();
    const model = await Model.load(workdir.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    // Remove reports directory if it exists
    const reportsDir = path.join(workdir.path, 'documentation-robotics', 'reports');
    try {
      await fs.rm(reportsDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist, that's fine
    }

    // Regenerate should create the directory
    const orchestrator = new ModelReportOrchestrator(model, workdir.path);
    await orchestrator.regenerateAll();

    const exists = await fs.access(reportsDir)
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(true);
  });

  it('should regenerate only affected layers when reports exist', async () => {
    const workdir = getWorkdir();
    const model = await Model.load(workdir.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    // First, generate all reports
    const orchestrator = new ModelReportOrchestrator(model, workdir.path);
    await orchestrator.regenerateAll();

    // Record initial modification times
    const reportsDir = path.join(workdir.path, 'documentation-robotics', 'reports');
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
    const workdir = getWorkdir();
    const model = await Model.load(workdir.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    // Remove reports directory
    const reportsDir = path.join(workdir.path, 'documentation-robotics', 'reports');
    try {
      await fs.rm(reportsDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }

    // Call regenerate with a small set, should fall back to regenerateAll
    const orchestrator = new ModelReportOrchestrator(model, workdir.path);
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
    const workdir = getWorkdir();
    const model = await Model.load(workdir.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    const orchestrator = new ModelReportOrchestrator(model, workdir.path);
    await orchestrator.regenerateAll();

    const reportsDir = path.join(workdir.path, 'documentation-robotics', 'reports');

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
    const workdir = getWorkdir();
    const model = await Model.load(workdir.path);

    if (!model) {
      throw new Error('Failed to load model');
    }

    const orchestrator = new ModelReportOrchestrator(model, workdir.path);
    await orchestrator.regenerateAll();

    const reportsDir = path.join(workdir.path, 'documentation-robotics', 'reports');
    const apiPath = path.join(reportsDir, '06-api-layer-report.md');

    const content = await fs.readFile(apiPath, 'utf-8');

    // Should contain model version in footer
    expect(content).toContain('Model Version:');
  });
});
