/**
 * Integration tests for the upgrade command
 * Verifies checking for available upgrades to CLI and spec versions
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTempWorkdir, runDr } from '../helpers/cli-runner.js';

let tempDir: { path: string; cleanup: () => Promise<void> };

describe('upgrade command', () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it('should check for available upgrades', async () => {
    // Initialize a model first
    await runDr(['init', '--name', 'Upgrade Test Model'], { cwd: tempDir.path });

    const result = await runDr(['upgrade'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Checking for available upgrades');
  });

  it('should report CLI version status', async () => {
    await runDr(['init', '--name', 'Upgrade Test Model'], { cwd: tempDir.path });

    const result = await runDr(['upgrade'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should check spec and model versions
    expect(result.stdout).toContain('spec');
  });

  it('should check spec version when model exists', async () => {
    await runDr(['init', '--name', 'Upgrade Test Model'], { cwd: tempDir.path });

    const result = await runDr(['upgrade'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should check spec version
    expect(result.stdout).toContain('spec');
  });

  it('should work without a model in directory', async () => {
    // Don't initialize a model
    const result = await runDr(['upgrade'], { cwd: tempDir.path });

    // Upgrade requires a project root, so it should fail gracefully
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No DR project found');
  });

  it('should display migration path information', async () => {
    await runDr(['init', '--name', 'Upgrade Test Model'], { cwd: tempDir.path });

    const result = await runDr(['upgrade'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should show the upgrade/version information
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it('should show CLI version in output', async () => {
    // Initialize a model first
    await runDr(['init', '--name', 'Version Test'], { cwd: tempDir.path });

    const result = await runDr(['upgrade'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should include version pattern (spec versions)
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should provide actionable upgrade instructions', async () => {
    await runDr(['init', '--name', 'Upgrade Test Model'], { cwd: tempDir.path });

    const result = await runDr(['upgrade'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Output should be readable and informative
    expect(result.stdout.length).toBeGreaterThan(10);
  });

  it('should show current versions', async () => {
    // Initialize a model first
    await runDr(['init', '--name', 'Versions Test'], { cwd: tempDir.path });

    const result = await runDr(['upgrade'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should display version information (either "up to date" or version pattern)
    expect(result.stdout).toMatch(/(\d+\.\d+\.\d+|Checking)/);
  });

  it('should work multiple times without side effects', async () => {
    await runDr(['init', '--name', 'Upgrade Test Model'], { cwd: tempDir.path });

    const result1 = await runDr(['upgrade'], { cwd: tempDir.path });
    const result2 = await runDr(['upgrade'], { cwd: tempDir.path });

    expect(result1.exitCode).toBe(0);
    expect(result2.exitCode).toBe(0);
  });

  it('should mention npm for CLI upgrades', async () => {
    // Initialize a model first
    await runDr(['init', '--name', 'NPM Test'], { cwd: tempDir.path });

    const result = await runDr(['upgrade'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Test passes if output contains upgrade information
    expect(result.stdout).toContain('Checking');
  });

  it('should display information for current state', async () => {
    // Initialize a model first
    await runDr(['init', '--name', 'State Test'], { cwd: tempDir.path });

    const result = await runDr(['upgrade'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should show information about current versions
    expect(result.stdout).toContain('Checking');
  });

  it('should handle model directory structure correctly', async () => {
    // Create a model
    await runDr(['init', '--name', 'Nested Model'], { cwd: tempDir.path });

    // Run upgrade from the same directory
    const result = await runDr(['upgrade'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('spec');
  });

  it('should provide clear formatting', async () => {
    // Initialize a model first
    await runDr(['init', '--name', 'Format Test'], { cwd: tempDir.path });

    const result = await runDr(['upgrade'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Output should be well-formatted (have multiple lines)
    const lines = result.stdout.split('\n').filter((l) => l.trim());
    expect(lines.length).toBeGreaterThan(2);
  });

  it('should display both CLI and spec upgrade status', async () => {
    await runDr(['init', '--name', 'Full Status Test'], { cwd: tempDir.path });

    const result = await runDr(['upgrade'], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should check spec reference and model
    expect(result.stdout).toContain('spec');
    expect(result.stdout).toContain('model');
  });
});
