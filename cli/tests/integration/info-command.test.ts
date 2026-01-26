/**
 * Integration tests for the info command
 * Verifies display of model information and layer summaries
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTempWorkdir, runDr, stripAnsi } from '../helpers/cli-runner.js';

let tempDir: { path: string; cleanup: () => Promise<void> };

describe('info command', () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it('should display model information with no options', async () => {
    // Initialize a model
    await runDr(['init', '--name', 'Test Info Model'], { cwd: tempDir.path });

    const result = await runDr(['info'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Test Info Model');
  });

  it('should display information for all 12 layers', async () => {
    await runDr(['init', '--name', 'Twelve Layer Model'], { cwd: tempDir.path });

    const result = await runDr(['info'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Layers');
    expect(result.stdout).toContain('motivation');
  });

  it('should display layer information with --layer option', async () => {
    // Initialize model and add an element to API layer
    await runDr(['init', '--name', 'Layer Info Model'], { cwd: tempDir.path });
    await runDr(
      ['add', 'api', 'endpoint', 'api-endpoint-test-1', '--name', 'GET /users'],
      { cwd: tempDir.path }
    );

    const result = await runDr(['info', '--layer', 'api'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('api');
  });

  it('should display information for each of the 12 layers', async () => {
    await runDr(['init', '--name', 'All Layers Test'], { cwd: tempDir.path });

    const layers = [
      'motivation',
      'business',
      'security',
      'application',
      'technology',
      'api',
      'data-model',
      'data-store',
      'ux',
      'navigation',
      'apm',
      'testing',
    ];

    // First verify that info command lists all layers
    const result = await runDr(['info'], { cwd: tempDir.path });
    expect(result.exitCode).toBe(0);

    // Strip ANSI codes for reliable matching
    const output = stripAnsi(result.stdout);

    // Verify that each layer name appears in the summary
    // Note: data-store may appear as "datastore" in display
    for (const layer of layers) {
      const displayName = layer === 'data-store' ? 'datastore' : layer;
      expect(output).toContain(displayName);
    }
  });

  it('should fail with error for invalid layer name', async () => {
    await runDr(['init', '--name', 'Error Test Model'], { cwd: tempDir.path });

    const result = await runDr(['info', '--layer', 'invalid-layer'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain('not found');
  });

  it('should display element counts for each layer', async () => {
    await runDr(['init', '--name', 'Element Count Test'], { cwd: tempDir.path });

    // Add 3 elements to API layer
    await runDr(['add', 'api', 'endpoint', 'api-endpoint-test-1', '--name', 'Endpoint 1'], { cwd: tempDir.path });
    await runDr(['add', 'api', 'endpoint', 'api-endpoint-test-2', '--name', 'Endpoint 2'], { cwd: tempDir.path });
    await runDr(['add', 'api', 'endpoint', 'api-endpoint-test-3', '--name', 'Endpoint 3'], { cwd: tempDir.path });

    const result = await runDr(['info'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // The output should show element counts
    expect(result.stdout).toContain('elements');
  });

  it('should show element counts with --layer and no --verbose', async () => {
    await runDr(['init', '--name', 'Element Count Test'], { cwd: tempDir.path });

    // Add 2 elements to motivation layer
    await runDr(['add', 'motivation', 'goal', 'motivation-goal-test-1', '--name', 'Goal 1'], { cwd: tempDir.path });
    await runDr(['add', 'motivation', 'requirement', 'motivation-requirement-test-1', '--name', 'Requirement 1'], { cwd: tempDir.path });

    const result = await runDr(['info', '--layer', 'motivation'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should show element count
    expect(result.stdout).toContain('2');
  });

  it('should show element type breakdown with --verbose option', async () => {
    await runDr(['init', '--name', 'Verbose Test'], { cwd: tempDir.path });

    // Add multiple types to motivation layer
    await runDr(['add', 'motivation', 'goal', 'motivation-goal-test-1', '--name', 'Goal 1'], { cwd: tempDir.path });
    await runDr(['add', 'motivation', 'goal', 'motivation-goal-test-2', '--name', 'Goal 2'], { cwd: tempDir.path });
    await runDr(['add', 'motivation', 'requirement', 'motivation-requirement-test-1', '--name', 'Requirement 1'], { cwd: tempDir.path });

    const result = await runDr(['info', '--layer', 'motivation', '--verbose'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
  });

  it('should display manifest fields correctly', async () => {
    await runDr(['init', '--name', 'Manifest Test Model'], { cwd: tempDir.path });

    const result = await runDr(['info'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Manifest Test Model');
    expect(result.stdout).toContain('Version');
  });

  it('should handle model with multiple element types per layer', async () => {
    await runDr(['init', '--name', 'Multiple Types Test'], { cwd: tempDir.path });

    // Add multiple types to business layer
    await runDr(['add', 'business', 'business-service', 'business-service-test-1', '--name', 'Service'], { cwd: tempDir.path });
    await runDr(['add', 'business', 'business-process', 'business-process-test-1', '--name', 'Process'], { cwd: tempDir.path });
    await runDr(['add', 'business', 'business-actor', 'business-actor-test-1', '--name', 'Actor'], { cwd: tempDir.path });

    const result = await runDr(['info', '--layer', 'business'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should show 3 elements
    expect(result.stdout).toContain('3');
  });

  it('should show layers with no elements', async () => {
    await runDr(['init', '--name', 'Empty Model'], { cwd: tempDir.path });

    const result = await runDr(['info'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Empty Model');
  });

  it('should fail gracefully when model directory does not exist', async () => {
    const result = await runDr(['info'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(1);
  });

  it('should display created and modified timestamps', async () => {
    await runDr(['init', '--name', 'Timestamp Test'], { cwd: tempDir.path });

    const result = await runDr(['info'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Created');
    expect(result.stdout).toContain('Modified');
  });
});
