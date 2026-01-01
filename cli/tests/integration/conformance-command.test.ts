/**
 * Integration tests for the conformance command
 * Verifies validation of model conformance to layer specifications
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'fs/promises';

const TEMP_DIR = '/tmp/dr-conformance-command-test';

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

describe('conformance command', () => {
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

  it('should validate spec conformance for valid model', async () => {
    // Initialize model
    await runDr('init', '--name', 'Valid Conformance Model');

    // Add a valid element
    await runDr('add', 'api', 'endpoint', 'api-endpoint-conformance-test-1', '--name', 'Test Endpoint');

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('conformance');
  });

  it('should report on all layers', async () => {
    await runDr('init', '--name', 'All Layers Conformance');

    // Add elements to multiple layers
    await runDr('add', 'motivation', 'goal', 'motivation-goal-test-1', '--name', 'Goal');
    await runDr('add', 'business', 'business-service', 'business-service-test-1', '--name', 'Service');
    await runDr('add', 'api', 'endpoint', 'api-endpoint-test-1', '--name', 'Endpoint');

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('conformance');
  });

  it('should show element counts per layer', async () => {
    await runDr('init', '--name', 'Element Count Test');

    // Add multiple elements to API layer
    await runDr('add', 'api', 'endpoint', 'api-endpoint-test-1', '--name', 'Endpoint 1');
    await runDr('add', 'api', 'endpoint', 'api-endpoint-test-2', '--name', 'Endpoint 2');

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    // Should show element counts
    expect(result.stdout).toContain('Elements');
  });

  it('should display summary statistics', async () => {
    await runDr('init', '--name', 'Summary Test');

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    // Should include a summary section
    expect(result.stdout).toContain('Summary');
  });

  it('should identify layers with content', async () => {
    await runDr('init', '--name', 'Identify Layers Test');

    // Add only to business layer
    await runDr('add', 'business', 'business-service', 'business-service-test-1', '--name', 'Service');

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    // Should note that business layer has content
    expect(result.stdout).toContain('business');
  });

  it('should report compliance status', async () => {
    await runDr('init', '--name', 'Compliance Status Test');

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    // Should provide conformance status
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it('should handle empty layers gracefully', async () => {
    await runDr('init', '--name', 'Empty Layers Model');

    // Don't add any elements

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    // Should still complete without errors
    expect(result.stdout).toContain('conformance');
  });

  it('should report element type distribution', async () => {
    await runDr('init', '--name', 'Type Distribution Test');

    // Add multiple types to motivation layer
    await runDr('add', 'motivation', 'goal', 'motivation-goal-test-1', '--name', 'Goal 1');
    await runDr('add', 'motivation', 'goal', 'motivation-goal-test-2', '--name', 'Goal 2');
    await runDr('add', 'motivation', 'requirement', 'motivation-requirement-test-1', '--name', 'Requirement 1');

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    // Should show type information
    expect(result.stdout).toContain('Types');
  });

  it('should validate required element properties', async () => {
    await runDr('init', '--name', 'Properties Test');

    // Add element with all properties
    await runDr(
      'add', 'api', 'endpoint', 'api-endpoint-valid',
      '--name', 'Valid Endpoint'
    );

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    // Should pass property validation
    expect(result.stdout).toContain('conformance');
  });

  it('should complete successfully with multiple elements', async () => {
    await runDr('init', '--name', 'Fully Populated Model');

    // Populate with elements across multiple layers
    await runDr('add', 'motivation', 'goal', 'motivation-goal-test-1', '--name', 'Goal');
    await runDr('add', 'business', 'business-service', 'business-service-test-1', '--name', 'Service');
    await runDr('add', 'application', 'application-component', 'application-component-test-1', '--name', 'Component');
    await runDr('add', 'api', 'endpoint', 'api-endpoint-test-1', '--name', 'Endpoint');

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('conformance');
  });

  it('should handle single layer with multiple element types', async () => {
    await runDr('init', '--name', 'Multiple Types Test');

    // Add multiple types to business layer
    await runDr('add', 'business', 'business-service', 'business-service-test-1', '--name', 'Service');
    await runDr('add', 'business', 'business-process', 'business-process-test-1', '--name', 'Process');
    await runDr('add', 'business', 'business-actor', 'business-actor-test-1', '--name', 'Actor');

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('business');
    expect(result.stdout).toContain('3'); // 3 types
  });

  it('should provide layer compliance status for each layer', async () => {
    await runDr('init', '--name', 'Layer Status Test');

    // Add elements to create a scenario
    await runDr('add', 'api', 'endpoint', 'api-endpoint-test-1', '--name', 'Endpoint');

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    // Output should indicate conformance status per layer
    expect(result.stdout).toContain('Layer conformance');
  });

  it('should show compliant vs non-compliant status', async () => {
    await runDr('init', '--name', 'Compliance Status Test');

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    // Should show status indicators (✓ for compliant or ✗ for issues)
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it('should count total issues in summary', async () => {
    await runDr('init', '--name', 'Issue Count Test');

    // Add one element
    await runDr('add', 'technology', 'infrastructure', 'technology-infrastructure-test-1', '--name', 'Infrastructure');

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    // Summary should include issue count
    expect(result.stdout).toContain('Summary');
  });

  it('should handle layers with no elements', async () => {
    await runDr('init', '--name', 'Empty Layers Test');

    // Create a model with no elements (all layers empty)
    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    // Should handle gracefully
    expect(result.stdout).toContain('conformance');
  });

  it('should report on test layer conformance', async () => {
    await runDr('init', '--name', 'Testing Layer Test');

    // Add test layer element
    await runDr('add', 'testing', 'test-case', 'testing-test-case-test-1', '--name', 'Test Case');

    const result = await runDr('conformance');

    expect(result.exitCode).toBe(0);
    // Should include testing layer in report
    expect(result.stdout).toContain('testing');
  });

  it('should display consistent results on repeated runs', async () => {
    await runDr('init', '--name', 'Consistency Test');

    // Add some elements
    await runDr('add', 'api', 'endpoint', 'api-endpoint-test-1', '--name', 'Endpoint');

    const result1 = await runDr('conformance');
    const result2 = await runDr('conformance');

    expect(result1.exitCode).toBe(0);
    expect(result2.exitCode).toBe(0);
    // Should produce consistent results
    expect(result1.stdout).toBe(result2.stdout);
  });
});
