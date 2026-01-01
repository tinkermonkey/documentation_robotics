/**
 * Integration tests for the version command
 * Verifies display of CLI and spec versions
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'fs/promises';
import { readJSON } from '../../src/utils/file-io.js';

const TEMP_DIR = '/tmp/dr-version-command-test';

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

describe('version command', () => {
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

  it('should display CLI version with --version flag', async () => {
    const result = await runDr('--version');

    expect(result.exitCode).toBe(0);
    // Should contain version number in format X.Y.Z
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should display CLI version with version command', async () => {
    const result = await runDr('version');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Documentation Robotics CLI');
  });

  it('should display both CLI and spec versions', async () => {
    const result = await runDr('version');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('CLI Version');
    expect(result.stdout).toContain('Spec Version');
  });

  it('should display version numbers in proper format', async () => {
    const result = await runDr('version');

    expect(result.exitCode).toBe(0);
    // Check for version pattern X.Y.Z
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('version matches CLI package.json', async () => {
    const result = await runDr('version');

    expect(result.exitCode).toBe(0);

    // Read the CLI package.json to get the version
    const cliPackagePath = new URL('../../package.json', import.meta.url).pathname;
    const packageJson = await readJSON<{ version: string }>(cliPackagePath);

    // The output should contain the version from package.json
    expect(result.stdout).toContain(packageJson.version);
  });

  it('should not require a model to exist', async () => {
    // Run version command in a directory with no model
    const result = await runDr('version');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Documentation Robotics CLI');
  });

  it('should display version when model exists', async () => {
    // Create a model first
    await runDr('init', '--name', 'Version Test Model');

    // Now run version command
    const result = await runDr('version');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('CLI Version');
    expect(result.stdout).toContain('Spec Version');
  });

  it('--version flag should work from temp directory', async () => {
    const result = await runDr('--version');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should output spec version when available', async () => {
    const result = await runDr('version');

    expect(result.exitCode).toBe(0);
    // Should show spec version (likely 0.6.0 based on bundled spec)
    expect(result.stdout).toContain('Spec Version');
  });

  it('version command should be idempotent', async () => {
    const result1 = await runDr('version');
    const result2 = await runDr('version');

    expect(result1.exitCode).toBe(0);
    expect(result2.exitCode).toBe(0);
    // Both runs should produce the same output
    expect(result1.stdout).toBe(result2.stdout);
  });

  it('should show version with proper formatting', async () => {
    const result = await runDr('version');

    expect(result.exitCode).toBe(0);
    // Check for expected header
    expect(result.stdout).toContain('Documentation Robotics CLI');
    // Check for version labels
    expect(result.stdout).toContain('Version');
  });

  it('should display complete version information', async () => {
    const result = await runDr('version');

    expect(result.exitCode).toBe(0);
    // Should have multiple lines of output
    const lines = result.stdout.split('\n').filter((l) => l.trim());
    expect(lines.length).toBeGreaterThan(1);
  });
});
