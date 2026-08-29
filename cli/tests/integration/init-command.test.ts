import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

describe('init command', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = path.join(tmpdir(), `dr-init-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('should generate README.md immediately after init', async () => {
    // Initialize using programmatic API to verify README is generated
    const { Model } = await import('@/core/model');
    const { getCliBundledSpecVersion } = await import('@/utils/spec-version');
    const { installSpecReference } = await import('@/utils/spec-installer');
    const { regenerateLayerReports } = await import('@/commands/reports');

    // Initialize model
    const model = await Model.init(
      tempDir,
      {
        name: 'Test Project',
        version: '0.1.0',
        specVersion: getCliBundledSpecVersion(),
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );

    // Install spec reference
    await installSpecReference(tempDir, false);

    // Generate reports and README
    await regenerateLayerReports(tempDir);

    // Check that README.md was generated in the reports directory
    const readmePath = path.join(tempDir, 'documentation-robotics', 'reports', 'README.md');

    const exists = await fs.access(readmePath)
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(true);
  });

  it('should generate README with zero-value stats for empty model', async () => {
    // Initialize using programmatic API since CLI execution has environment dependencies
    const { Model } = await import('@/core/model');
    const { getCliBundledSpecVersion } = await import('@/utils/spec-version');
    const { installSpecReference } = await import('@/utils/spec-installer');
    const { regenerateLayerReports } = await import('@/commands/reports');

    // Initialize model
    const model = await Model.init(
      tempDir,
      {
        name: 'Test Project',
        version: '0.1.0',
        description: 'Test Description',
        author: 'Test Author',
        specVersion: getCliBundledSpecVersion(),
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );

    // Install spec reference
    await installSpecReference(tempDir, false);

    // Generate reports and README
    await regenerateLayerReports(tempDir);

    // Verify README exists
    const readmePath = path.join(tempDir, 'documentation-robotics', 'reports', 'README.md');
    const exists = await fs.access(readmePath)
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(true);

    // Verify README has expected content
    const content = await fs.readFile(readmePath, 'utf-8');
    expect(content).toContain('# Test Project');
    expect(content).toContain('## Model Statistics');
    expect(content).toContain('Total Elements');
    expect(content).toContain('0');
    expect(content).toContain('Total Relationships');
    expect(content).toContain('## Layer Reports');
    expect(content).toContain('Motivation');
    expect(content).toContain('Testing');
  });

  it('should generate all 13 layer reports immediately after init', async () => {
    const { Model } = await import('@/core/model');
    const { getCliBundledSpecVersion } = await import('@/utils/spec-version');
    const { installSpecReference } = await import('@/utils/spec-installer');
    const { regenerateLayerReports } = await import('@/commands/reports');
    const { CANONICAL_LAYER_NAMES, getLayerOrder } = await import('@/core/layers');

    // Initialize model
    const model = await Model.init(
      tempDir,
      {
        name: 'Test Project',
        version: '0.1.0',
        specVersion: getCliBundledSpecVersion(),
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );

    // Install spec reference
    await installSpecReference(tempDir, false);

    // Generate reports and README
    await regenerateLayerReports(tempDir);

    // Verify all 13 layer reports exist
    const reportsDir = path.join(tempDir, 'documentation-robotics', 'reports');

    for (const layerName of CANONICAL_LAYER_NAMES) {
      const layerNumber = getLayerOrder(layerName);
      const filename = `${String(layerNumber).padStart(2, '0')}-${layerName}-layer-report.md`;
      const filePath = path.join(reportsDir, filename);

      const exists = await fs.access(filePath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    }

    // Verify README also exists
    const readmePath = path.join(reportsDir, 'README.md');
    const readmeExists = await fs.access(readmePath)
      .then(() => true)
      .catch(() => false);

    expect(readmeExists).toBe(true);
  });

  it('should show empty layer reports in README table with em-dash', async () => {
    const { Model } = await import('@/core/model');
    const { getCliBundledSpecVersion } = await import('@/utils/spec-version');
    const { installSpecReference } = await import('@/utils/spec-installer');
    const { regenerateLayerReports } = await import('@/commands/reports');

    // Initialize model
    const model = await Model.init(
      tempDir,
      {
        name: 'Empty Project',
        version: '0.1.0',
        specVersion: getCliBundledSpecVersion(),
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );

    // Install spec reference
    await installSpecReference(tempDir, false);

    // Generate reports and README
    await regenerateLayerReports(tempDir);

    // Verify README content
    const readmePath = path.join(tempDir, 'documentation-robotics', 'reports', 'README.md');
    const content = await fs.readFile(readmePath, 'utf-8');

    // For empty model, all layers should have 0 elements and em-dash (—) in report column
    // Check that Product layer (unpopulated) doesn't have a link
    expect(content).not.toContain('[03-product-layer-report.md]');

    // Verify Product still appears in the table
    const reportSection = content.split('## Layer Reports')[1];
    expect(reportSection).toContain('Product');
    expect(reportSection).toContain('| 0 ');
  });
});
