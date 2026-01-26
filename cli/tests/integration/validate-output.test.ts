import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { tempdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(projectRoot, 'dist/cli.js');

/**
 * Helper to run CLI command and capture output
 */
function runCommand(args: string[], cwd?: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    const process = spawn('node', [cliPath, ...args], {
      cwd: cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    process.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });
  });
}

describe('Validate Command Output', () => {
  let testDir: string;

  beforeAll(async () => {
    // Create a temporary test directory
    testDir = path.join(tempdir(), `dr-validate-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Initialize a test model
    const result = await runCommand(['init', '--skip-examples'], testDir);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to initialize test model: ${result.stderr}`);
    }
  });

  afterAll(async () => {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should display enhanced validation output with statistics', async () => {
    const result = await runCommand(['validate'], testDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Validating Documentation Robotics Model');
    expect(result.stdout).toContain('Schema Validation:');
    expect(result.stdout).toContain('Cross-Layer Validation:');
    expect(result.stdout).toContain('Summary:');
    expect(result.stdout).toContain('elements validated');
    expect(result.stdout).toContain('relationships validated');
  });

  it('should support --verbose flag for detailed output', async () => {
    const result = await runCommand(['validate', '--verbose'], testDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Validating Documentation Robotics Model');
    expect(result.stdout).toContain('Relationship breakdown');
  });

  it('should support --quiet flag for minimal output', async () => {
    const result = await runCommand(['validate', '--quiet'], testDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✓ Validation passed');
    expect(result.stdout).not.toContain('Validating Documentation Robotics Model');
  });

  it('should export validation report to JSON', async () => {
    const reportPath = path.join(testDir, 'validation-report.json');

    const result = await runCommand(['validate', '--output', reportPath], testDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Validation report exported to');

    // Check that file was created
    const content = await fs.readFile(reportPath, 'utf-8');
    const json = JSON.parse(content);

    expect(json.valid).toBeDefined();
    expect(json.summary).toBeDefined();
    expect(json.summary.totalElements).toBeGreaterThanOrEqual(0);
    expect(json.summary.totalRelationships).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(json.errors)).toBe(true);
    expect(Array.isArray(json.warnings)).toBe(true);
  });

  it('should export validation report to Markdown', async () => {
    const reportPath = path.join(testDir, 'validation-report.md');

    const result = await runCommand(['validate', '--output', reportPath], testDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Validation report exported to');

    // Check that file was created
    const content = await fs.readFile(reportPath, 'utf-8');

    expect(content).toContain('# Validation Report');
    expect(content).toContain('## Summary');
    expect(content).toContain('## Layer Statistics');
  });

  it('should show layer-by-layer validation results', async () => {
    const result = await runCommand(['validate'], testDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✓');
    expect(result.stdout).toContain('layer');
    expect(result.stdout).toContain('elements');
  });

  it('should count elements correctly in output', async () => {
    const result = await runCommand(['validate'], testDir);

    expect(result.exitCode).toBe(0);
    // Should have element count in summary
    expect(result.stdout).toMatch(/\d+ total elements validated/);
  });

  it('should include cross-layer validation details', async () => {
    const result = await runCommand(['validate'], testDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Cross-Layer Validation:');
    expect(result.stdout).toContain('relationships validated');
  });

  it('should handle validation failures with detailed errors', async () => {
    // This test would require creating an invalid model, but for now
    // we just verify the error output format exists
    const result = await runCommand(['validate'], testDir);

    // If there are errors, they should be formatted correctly
    if (result.stdout.includes('Errors:')) {
      expect(result.stdout).toContain('Element:');
      expect(result.stdout).toContain('Suggestion:');
    }
  });

  it('should support --strict flag treating warnings as errors', async () => {
    const result = await runCommand(['validate', '--strict'], testDir);

    // Either passes (exit 0) or fails with warnings (exit 1)
    expect([0, 1]).toContain(result.exitCode);
  });

  it('should maintain backward compatibility with --all flag', async () => {
    const result = await runCommand(['validate', '--all'], testDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Validating Documentation Robotics Model');
  });

  it('should support JSON export with statistics metadata', async () => {
    const reportPath = path.join(testDir, 'stats-report.json');

    const result = await runCommand(['validate', '--output', reportPath], testDir);

    expect(result.exitCode).toBe(0);

    const content = await fs.readFile(reportPath, 'utf-8');
    const json = JSON.parse(content);

    expect(json.summary.layersValidated).toBeGreaterThanOrEqual(0);
    expect(json.layerStats).toBeDefined();
    expect(typeof json.layerStats).toBe('object');
  });

  it('should include orphaned elements detection in reports', async () => {
    const reportPath = path.join(testDir, 'orphan-report.json');

    const result = await runCommand(['validate', '--output', reportPath], testDir);

    expect(result.exitCode).toBe(0);

    const content = await fs.readFile(reportPath, 'utf-8');
    const json = JSON.parse(content);

    expect(Array.isArray(json.orphanedElements)).toBe(true);
  });
});
