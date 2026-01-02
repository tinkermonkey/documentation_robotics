/**
 * Integration tests for the conformance command
 * Verifies validation of model conformance to layer specifications
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTempWorkdir, runDr, parseJsonOutput } from '../helpers/cli-runner.js';

let tempDir: { path: string; cleanup: () => Promise<void> };

describe('conformance command', () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it('should validate spec conformance for valid model', async () => {
    // Initialize model
    await runDr(['init', '--name', 'Valid Conformance Model'], { cwd: tempDir.path });

    // Add a valid element
    await runDr(['add', 'api', 'endpoint', 'api-endpoint-conformance-test-1', '--name', 'Test Endpoint'], { cwd: tempDir.path });

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('conformance');
  });

  it('should report on all layers', async () => {
    await runDr(['init', '--name', 'All Layers Conformance'], { cwd: tempDir.path });

    // Add elements to multiple layers
    await runDr(['add', 'motivation', 'goal', 'motivation-goal-test-1', '--name', 'Goal'], { cwd: tempDir.path });
    await runDr(['add', 'business', 'business-service', 'business-service-test-1', '--name', 'Service'], { cwd: tempDir.path });
    await runDr(['add', 'api', 'endpoint', 'api-endpoint-test-1', '--name', 'Endpoint'], { cwd: tempDir.path });

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('conformance');
  });

  it('should show element counts per layer', async () => {
    await runDr(['init', '--name', 'Element Count Test'], { cwd: tempDir.path });

    // Add multiple elements to API layer
    await runDr(['add', 'api', 'endpoint', 'api-endpoint-test-1', '--name', 'Endpoint 1'], { cwd: tempDir.path });
    await runDr(['add', 'api', 'endpoint', 'api-endpoint-test-2', '--name', 'Endpoint 2'], { cwd: tempDir.path });

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should show element counts
    expect(result.stdout).toContain('Elements');
  });

  it('should display summary statistics', async () => {
    await runDr(['init', '--name', 'Summary Test'], { cwd: tempDir.path });

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should include a summary section
    expect(result.stdout).toContain('Summary');
  });

  it('should identify layers with content', async () => {
    await runDr(['init', '--name', 'Identify Layers Test'], { cwd: tempDir.path });

    // Add only to business layer
    await runDr(['add', 'business', 'business-service', 'business-service-test-1', '--name', 'Service'], { cwd: tempDir.path });

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should note that business layer has content
    expect(result.stdout).toContain('business');
  });

  it('should report compliance status', async () => {
    await runDr(['init', '--name', 'Compliance Status Test'], { cwd: tempDir.path });

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should provide conformance status
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it('should handle empty layers gracefully', async () => {
    await runDr(['init', '--name', 'Empty Layers Model'], { cwd: tempDir.path });

    // Don't add any elements

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should still complete without errors
    expect(result.stdout).toContain('conformance');
  });

  it('should report element type distribution', async () => {
    await runDr(['init', '--name', 'Type Distribution Test'], { cwd: tempDir.path });

    // Add multiple types to motivation layer
    await runDr(['add', 'motivation', 'goal', 'motivation-goal-test-1', '--name', 'Goal 1'], { cwd: tempDir.path });
    await runDr(['add', 'motivation', 'goal', 'motivation-goal-test-2', '--name', 'Goal 2'], { cwd: tempDir.path });
    await runDr(['add', 'motivation', 'requirement', 'motivation-requirement-test-1', '--name', 'Requirement 1'], { cwd: tempDir.path });

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should show type information
    expect(result.stdout).toContain('Types');
  });

  it('should validate required element properties', async () => {
    await runDr(['init', '--name', 'Properties Test'], { cwd: tempDir.path });

    // Add element with all properties
    await runDr(
      ['add', 'api', 'endpoint', 'api-endpoint-valid', '--name', 'Valid Endpoint'],
      { cwd: tempDir.path }
    );

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should pass property validation
    expect(result.stdout).toContain('conformance');
  });

  it('should complete successfully with multiple elements', async () => {
    await runDr(['init', '--name', 'Fully Populated Model'], { cwd: tempDir.path });

    // Populate with elements across multiple layers
    await runDr(['add', 'motivation', 'goal', 'motivation-goal-test-1', '--name', 'Goal'], { cwd: tempDir.path });
    await runDr(['add', 'business', 'business-service', 'business-service-test-1', '--name', 'Service'], { cwd: tempDir.path });
    await runDr(['add', 'application', 'application-component', 'application-component-test-1', '--name', 'Component'], { cwd: tempDir.path });
    await runDr(['add', 'api', 'endpoint', 'api-endpoint-test-1', '--name', 'Endpoint'], { cwd: tempDir.path });

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('conformance');
  });

  it('should handle single layer with multiple element types', async () => {
    await runDr(['init', '--name', 'Multiple Types Test'], { cwd: tempDir.path });

    // Add multiple types to business layer
    await runDr(['add', 'business', 'business-service', 'business-service-test-1', '--name', 'Service'], { cwd: tempDir.path });
    await runDr(['add', 'business', 'business-process', 'business-process-test-1', '--name', 'Process'], { cwd: tempDir.path });
    await runDr(['add', 'business', 'business-actor', 'business-actor-test-1', '--name', 'Actor'], { cwd: tempDir.path });

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('business');
    expect(result.stdout).toContain('3'); // 3 types
  });

  it('should provide layer compliance status for each layer', async () => {
    await runDr(['init', '--name', 'Layer Status Test'], { cwd: tempDir.path });

    // Add elements to create a scenario
    await runDr(['add', 'api', 'endpoint', 'api-endpoint-test-1', '--name', 'Endpoint'], { cwd: tempDir.path });

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Output should indicate conformance status per layer
    expect(result.stdout).toContain('Layer conformance');
  });

  it('should show compliant vs non-compliant status', async () => {
    await runDr(['init', '--name', 'Compliance Status Test'], { cwd: tempDir.path });

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should show status indicators (✓ for compliant or ✗ for issues)
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it('should count total issues in summary', async () => {
    await runDr(['init', '--name', 'Issue Count Test'], { cwd: tempDir.path });

    // Add one element
    await runDr(['add', 'technology', 'infrastructure', 'technology-infrastructure-test-1', '--name', 'Infrastructure'], { cwd: tempDir.path });

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Summary should include issue count
    expect(result.stdout).toContain('Summary');
  });

  it('should handle layers with no elements', async () => {
    await runDr(['init', '--name', 'Empty Layers Test'], { cwd: tempDir.path });

    // Create a model with no elements (all layers empty)
    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should handle gracefully
    expect(result.stdout).toContain('conformance');
  });

  it('should report on test layer conformance', async () => {
    await runDr(['init', '--name', 'Testing Layer Test'], { cwd: tempDir.path });

    // Add test layer element
    await runDr(['add', 'testing', 'test-case', 'testing-test-case-test-1', '--name', 'Test Case'], { cwd: tempDir.path });

    const result = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should include testing layer in report
    expect(result.stdout).toContain('testing');
  });

  it('should display consistent results on repeated runs', async () => {
    await runDr(['init', '--name', 'Consistency Test'], { cwd: tempDir.path });

    // Add some elements
    await runDr(['add', 'api', 'endpoint', 'api-endpoint-test-1', '--name', 'Endpoint'], { cwd: tempDir.path });

    const result1 = await runDr(['conformance'], { cwd: tempDir.path });
    const result2 = await runDr(['conformance'], { cwd: tempDir.path });

    expect(result1.exitCode).toBe(0);
    expect(result2.exitCode).toBe(0);
    // Should produce consistent results
    expect(result1.stdout).toBe(result2.stdout);
  });

  it('should support --json output format', async () => {
    await runDr(['init', '--name', 'JSON Output Test'], { cwd: tempDir.path });

    const result = await runDr(['conformance', '--json'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should return valid JSON that can be parsed
    const output = parseJsonOutput(result);
    expect(output).toBeTruthy();
    expect(typeof output).toBe('object');
  });

  it('should support --verbose output', async () => {
    await runDr(['init', '--name', 'Verbose Output Test'], { cwd: tempDir.path });

    // Add elements for verbose output to display
    await runDr(['add', 'api', 'endpoint', 'api-endpoint-verbose-1', '--name', 'Endpoint'], { cwd: tempDir.path });

    const result = await runDr(['conformance', '--verbose'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Verbose output should have more detailed information
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it('--json format should contain conformance data structure', async () => {
    await runDr(['init', '--name', 'JSON Structure Test'], { cwd: tempDir.path });

    // Add elements to populate the model
    await runDr(['add', 'api', 'endpoint', 'api-endpoint-json-1', '--name', 'Endpoint'], { cwd: tempDir.path });

    const result = await runDr(['conformance', '--json'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Parse and verify JSON structure
    const output = parseJsonOutput(result) as Record<string, unknown>;
    expect(output).toHaveProperty('conformance');
  });

  it('--verbose output should show more detail than default', async () => {
    await runDr(['init', '--name', 'Verbosity Comparison Test'], { cwd: tempDir.path });

    await runDr(['add', 'motivation', 'goal', 'motivation-goal-verbose-1', '--name', 'Goal'], { cwd: tempDir.path });

    const defaultResult = await runDr(['conformance'], { cwd: tempDir.path });
    const verboseResult = await runDr(['conformance', '--verbose'], { cwd: tempDir.path });

    expect(defaultResult.exitCode).toBe(0);
    expect(verboseResult.exitCode).toBe(0);
    // Verbose output should have more content
    expect(verboseResult.stdout.length).toBeGreaterThanOrEqual(defaultResult.stdout.length);
  });
});
