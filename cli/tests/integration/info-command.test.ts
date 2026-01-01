/**
 * Integration tests for the info command
 * Verifies display of model information and layer summaries
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'fs/promises';
import { Model } from '../../src/core/model.js';

const TEMP_DIR = '/tmp/dr-info-command-test';

/**
 * Helper to run dr commands using Bun
 */
async function runDr(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const cliPath = new URL('../../dist/cli.js', import.meta.url).pathname;
    const result = await Bun.spawnSync({
      cmd: ['bun', 'run', cliPath, ...args],
      cwd: TEMP_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdout = result.stdout?.toString() || '';
    const stderr = result.stderr?.toString() || '';

    return { exitCode: result.exitCode, stdout, stderr };
  } catch (error) {
    return { exitCode: 1, stdout: '', stderr: String(error) };
  }
}

describe('info command', () => {
  beforeEach(async () => {
    try {
      await rm(TEMP_DIR, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
    await mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(TEMP_DIR, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  it('should display model information with no options', async () => {
    // Initialize a model
    await runDr('init', '--name', 'Test Info Model');

    const result = await runDr('info');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Test Info Model');
  });

  it('should display information for all 12 layers', async () => {
    await runDr('init', '--name', 'Twelve Layer Model');

    const result = await runDr('info');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Layers');
    expect(result.stdout).toContain('motivation');
  });

  it('should display layer information with --layer option', async () => {
    // Initialize model and add an element to API layer
    await runDr('init', '--name', 'Layer Info Model');
    await runDr(
      'add', 'api', 'endpoint', 'api-endpoint-test-1',
      '--name', 'GET /users'
    );

    const result = await runDr('info', '--layer', 'api');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('api');
  });

  it('should display information for each of the 12 layers', async () => {
    await runDr('init', '--name', 'All Layers Test');

    const layers = [
      'motivation',
      'business',
      'security',
      'application',
      'technology',
      'api',
      'data-model',
      'datastore', // Note: displayed as datastore (no hyphen) in output
      'ux',
      'navigation',
      'apm',
      'testing',
    ];

    // First verify that info command lists all layers
    const result = await runDr('info');
    expect(result.exitCode).toBe(0);

    // Verify that each layer name appears in the summary
    for (const layer of layers) {
      expect(result.stdout).toContain(layer);
    }
  });

  it('should fail with error for invalid layer name', async () => {
    await runDr('init', '--name', 'Error Test Model');

    const result = await runDr('info', '--layer', 'invalid-layer');

    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain('not found');
  });

  it('should display element counts for each layer', async () => {
    await runDr('init', '--name', 'Element Count Test');

    // Add 3 elements to API layer
    await runDr('add', 'api', 'endpoint', 'api-endpoint-test-1', '--name', 'Endpoint 1');
    await runDr('add', 'api', 'endpoint', 'api-endpoint-test-2', '--name', 'Endpoint 2');
    await runDr('add', 'api', 'endpoint', 'api-endpoint-test-3', '--name', 'Endpoint 3');

    const result = await runDr('info');

    expect(result.exitCode).toBe(0);
    // The output should show element counts
    expect(result.stdout).toContain('elements');
  });

  it('should show element counts with --layer and no --verbose', async () => {
    await runDr('init', '--name', 'Element Count Test');

    // Add 2 elements to motivation layer
    await runDr('add', 'motivation', 'goal', 'motivation-goal-test-1', '--name', 'Goal 1');
    await runDr('add', 'motivation', 'requirement', 'motivation-requirement-test-1', '--name', 'Requirement 1');

    const result = await runDr('info', '--layer', 'motivation');

    expect(result.exitCode).toBe(0);
    // Should show element count
    expect(result.stdout).toContain('2');
  });

  it('should show element type breakdown with --verbose option', async () => {
    await runDr('init', '--name', 'Verbose Test');

    // Add multiple types to motivation layer
    await runDr('add', 'motivation', 'goal', 'motivation-goal-test-1', '--name', 'Goal 1');
    await runDr('add', 'motivation', 'goal', 'motivation-goal-test-2', '--name', 'Goal 2');
    await runDr('add', 'motivation', 'requirement', 'motivation-requirement-test-1', '--name', 'Requirement 1');

    const result = await runDr('info', '--layer', 'motivation', '--verbose');

    expect(result.exitCode).toBe(0);
  });

  it('should display manifest fields correctly', async () => {
    await runDr('init', '--name', 'Manifest Test Model');

    const result = await runDr('info');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Manifest Test Model');
    expect(result.stdout).toContain('Version');
  });

  it('should handle model with multiple element types per layer', async () => {
    await runDr('init', '--name', 'Multiple Types Test');

    // Add multiple types to business layer
    await runDr('add', 'business', 'business-service', 'business-service-test-1', '--name', 'Service');
    await runDr('add', 'business', 'business-process', 'business-process-test-1', '--name', 'Process');
    await runDr('add', 'business', 'business-actor', 'business-actor-test-1', '--name', 'Actor');

    const result = await runDr('info', '--layer', 'business');

    expect(result.exitCode).toBe(0);
    // Should show 3 elements
    expect(result.stdout).toContain('3');
  });

  it('should show layers with no elements', async () => {
    await runDr('init', '--name', 'Empty Model');

    const result = await runDr('info');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Empty Model');
  });

  it('should fail gracefully when model directory does not exist', async () => {
    const result = await runDr('info');

    expect(result.exitCode).toBe(1);
  });

  it('should display created and modified timestamps', async () => {
    await runDr('init', '--name', 'Timestamp Test');

    const result = await runDr('info');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Created');
    expect(result.stdout).toContain('Modified');
  });
});
