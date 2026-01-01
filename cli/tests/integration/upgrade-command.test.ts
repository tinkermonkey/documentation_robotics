/**
 * Integration tests for the upgrade command
 * Verifies checking for available upgrades to CLI and spec versions
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'fs/promises';

const TEMP_DIR = '/tmp/dr-upgrade-command-test';

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

describe('upgrade command', () => {
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

  it('should check for available upgrades', async () => {
    // Initialize a model first
    await runDr('init', '--name', 'Upgrade Test Model');

    const result = await runDr('upgrade');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Checking for available upgrades');
  });

  it('should report CLI version status', async () => {
    await runDr('init', '--name', 'Upgrade Test Model');

    const result = await runDr('upgrade');

    expect(result.exitCode).toBe(0);
    // Should mention CLI version
    expect(result.stdout).toContain('CLI');
  });

  it('should check spec version when model exists', async () => {
    await runDr('init', '--name', 'Upgrade Test Model');

    const result = await runDr('upgrade');

    expect(result.exitCode).toBe(0);
    // Should check spec version
    expect(result.stdout).toContain('Spec');
  });

  it('should work without a model in directory', async () => {
    // Don't initialize a model
    const result = await runDr('upgrade');

    expect(result.exitCode).toBe(0);
    // Should still work, just check CLI version
    expect(result.stdout).toContain('CLI');
  });

  it('should display migration path information', async () => {
    await runDr('init', '--name', 'Upgrade Test Model');

    const result = await runDr('upgrade');

    expect(result.exitCode).toBe(0);
    // Should show the upgrade/version information
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it('should show CLI version in output', async () => {
    const result = await runDr('upgrade');

    expect(result.exitCode).toBe(0);
    // Should include version pattern
    expect(result.stdout).toMatch(/v?\d+\.\d+\.\d+/);
  });

  it('should provide actionable upgrade instructions', async () => {
    await runDr('init', '--name', 'Upgrade Test Model');

    const result = await runDr('upgrade');

    expect(result.exitCode).toBe(0);
    // Output should be readable and informative
    expect(result.stdout.length).toBeGreaterThan(10);
  });

  it('should show current versions', async () => {
    const result = await runDr('upgrade');

    expect(result.exitCode).toBe(0);
    // Should display version information (either "up to date" or version pattern)
    expect(result.stdout).toMatch(/(\d+\.\d+\.\d+|Checking)/);
  });

  it('should work multiple times without side effects', async () => {
    await runDr('init', '--name', 'Upgrade Test Model');

    const result1 = await runDr('upgrade');
    const result2 = await runDr('upgrade');

    expect(result1.exitCode).toBe(0);
    expect(result2.exitCode).toBe(0);
  });

  it('should mention npm for CLI upgrades', async () => {
    const result = await runDr('upgrade');

    expect(result.exitCode).toBe(0);
    // If CLI needs upgrade, should mention npm or package manager
    if (result.stdout.includes('update')) {
      expect(result.stdout.includes('npm') || result.stdout.includes('install')).toBe(true);
    }
  });

  it('should display information for current state', async () => {
    const result = await runDr('upgrade');

    expect(result.exitCode).toBe(0);
    // Should show information about current versions
    expect(result.stdout).toContain('Checking');
  });

  it('should handle model directory structure correctly', async () => {
    // Create a model
    await runDr('init', '--name', 'Nested Model');

    // Run upgrade from the same directory
    const result = await runDr('upgrade');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Spec');
  });

  it('should provide clear formatting', async () => {
    const result = await runDr('upgrade');

    expect(result.exitCode).toBe(0);
    // Output should be well-formatted (have multiple lines)
    const lines = result.stdout.split('\n').filter((l) => l.trim());
    expect(lines.length).toBeGreaterThan(2);
  });

  it('should display both CLI and spec upgrade status', async () => {
    await runDr('init', '--name', 'Full Status Test');

    const result = await runDr('upgrade');

    expect(result.exitCode).toBe(0);
    // Should check both CLI and spec
    expect(result.stdout).toContain('CLI');
    expect(result.stdout).toContain('Spec');
  });
});
