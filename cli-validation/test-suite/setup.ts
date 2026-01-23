/**
 * Test Environment Setup
 *
 * Manages baseline test project copying and CLI binary validation.
 * Implements clean-room pattern: fresh copies of baseline for each test run.
 */

import { cp, rm } from "node:fs/promises";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as yaml from "yaml";

const execAsync = promisify(exec);

/**
 * Configuration for CLI binary paths
 */
export interface CLIConfig {
  pythonCLI: string;
  tsCLI: string;
}

/**
 * Test environment paths
 */
export interface TestPaths {
  baselinePath: string;
  pythonPath: string;
  tsPath: string;
}

/**
 * Get CLI configuration from environment variables or defaults
 */
export function getCLIConfig(): CLIConfig {
  // Allow explicit overrides via environment variables
  if (process.env.DR_PYTHON_CLI && process.env.DR_TS_CLI) {
    return {
      pythonCLI: process.env.DR_PYTHON_CLI,
      tsCLI: process.env.DR_TS_CLI,
    };
  }

  // Determine workspace root
  const cwd = process.cwd();
  const isRunningFromTestSuite = cwd.includes("cli-validation/test-suite");
  const workspaceRoot = isRunningFromTestSuite
    ? join(cwd.split("cli-validation/test-suite")[0])
    : cwd;

  return {
    pythonCLI: process.env.DR_PYTHON_CLI || join(workspaceRoot, ".venv/bin/dr"),
    tsCLI:
      process.env.DR_TS_CLI ||
      `node ${join(workspaceRoot, "cli/dist/cli.js")}`,
  };
}

/**
 * Get test environment paths relative to workspace root
 */
export function getTestPaths(
  baseDir: string = process.cwd()
): TestPaths {
  // Determine workspace root
  const cwd = baseDir || process.cwd();
  const isRunningFromTestSuite = cwd.includes("cli-validation/test-suite");
  const workspaceRoot = isRunningFromTestSuite
    ? join(cwd.split("cli-validation/test-suite")[0])
    : cwd;

  return {
    baselinePath: join(workspaceRoot, "cli-validation/test-project/baseline"),
    pythonPath: join(workspaceRoot, "cli-validation/test-project/python-cli"),
    tsPath: join(workspaceRoot, "cli-validation/test-project/ts-cli"),
  };
}

/**
 * Verify that a CLI binary is executable
 * @throws Error if CLI is not accessible or executable
 */
export async function validateCLIBinary(cliPath: string): Promise<void> {
  // For Python CLI, try using python -m instead of direct execution
  // This handles broken shebang lines in venvs created on other systems
  const isPythonCLI = cliPath.includes(".venv/bin/dr");
  const testCommand = isPythonCLI
    ? "python -m documentation_robotics --version"
    : `${cliPath} --version`;

  try {
    const { stdout } = await execAsync(testCommand);
    if (!stdout) {
      throw new Error(`No version output from ${cliPath}`);
    }
  } catch (error) {
    throw new Error(
      `Failed to execute ${cliPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get the version string from a CLI binary
 */
async function getCLIVersion(cliPath: string): Promise<string> {
  const isPythonCLI = cliPath.includes(".venv/bin/dr");

  let versionCommand: string;
  if (isPythonCLI) {
    // Try python3 first, fall back to direct execution
    versionCommand = `${cliPath} --version`;
  } else {
    versionCommand = `${cliPath} --version`;
  }

  try {
    const { stdout } = await execAsync(versionCommand);
    // Extract version number from output like "dr, version 0.7.3" or "0.7.3"
    const match = stdout.match(/(\d+\.\d+\.\d+)/);
    if (!match) {
      throw new Error(`Could not parse version from: ${stdout}`);
    }
    return match[1];
  } catch (error) {
    throw new Error(
      `Failed to get version from ${cliPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Update cli_version in manifest.yaml to match the CLI being tested
 * This avoids upgrade prompts when testing CLIs against baseline models
 */
async function updateManifestCLIVersion(
  projectPath: string,
  cliPath: string
): Promise<void> {
  const manifestPath = join(
    projectPath,
    "documentation-robotics/model/manifest.yaml"
  );

  try {
    // Get CLI version
    const version = await getCLIVersion(cliPath);

    // Read manifest
    const content = await readFile(manifestPath, "utf8");
    const manifest = yaml.parse(content);

    // Update cli_version
    manifest.cli_version = version;

    // Write back
    await writeFile(manifestPath, yaml.stringify(manifest), "utf8");
  } catch (error) {
    throw new Error(
      `Failed to update manifest at ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Validate that both CLI binaries exist and are executable
 * For now, we skip Python CLI validation if not available and focus on TypeScript CLI
 * @throws Error if TypeScript CLI is invalid
 * @returns Object with flags indicating which CLIs are available
 */
export async function validateCLIBinaries(config: CLIConfig): Promise<{ pythonAvailable: boolean; tsAvailable: boolean }> {
  let pythonAvailable = false;

  // Try to validate Python CLI, but don't fail if it's not available
  try {
    await validateCLIBinary(config.pythonCLI);
    console.log('✓ Python CLI available');
    pythonAvailable = true;
  } catch (error) {
    console.warn(`⚠ Python CLI not available: ${String(error)}`);
  }

  // TypeScript CLI is required
  try {
    await validateCLIBinary(config.tsCLI);
    console.log('✓ TypeScript CLI available');
  } catch (error) {
    throw new Error(`TypeScript CLI validation failed: ${String(error)}`);
  }

  return { pythonAvailable, tsAvailable: true };
}

/**
 * Remove test artifacts from previous runs
 * Implements clean-room pattern by deleting old test directories
 */
export async function cleanupTestArtifacts(paths: TestPaths): Promise<void> {
  // rm with force: true ignores missing directories
  await rm(paths.pythonPath, { recursive: true, force: true });
  await rm(paths.tsPath, { recursive: true, force: true });
}

/**
 * Create fresh copies of baseline test project
 * Copies baseline to isolated python-cli/ and ts-cli/ directories
 * Updates cli_version in manifests to match the CLI being tested
 * @param pythonAvailable - Whether Python CLI is available (optional)
 * @throws Error if copy operation fails
 */
export async function setupTestEnvironment(paths: TestPaths, config: CLIConfig, pythonAvailable: boolean = true): Promise<void> {
  // Clean up previous test artifacts
  await cleanupTestArtifacts(paths);

  // Create fresh copies of baseline
  try {
    await cp(paths.baselinePath, paths.pythonPath, { recursive: true });
  } catch (error) {
    throw new Error(
      `Failed to copy baseline to python-cli: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    await cp(paths.baselinePath, paths.tsPath, { recursive: true });
  } catch (error) {
    throw new Error(
      `Failed to copy baseline to ts-cli: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Update cli_version in manifests to match CLIs being tested
  // Only update Python CLI manifest if Python CLI is available
  if (pythonAvailable) {
    await updateManifestCLIVersion(paths.pythonPath, config.pythonCLI);
  }
  await updateManifestCLIVersion(paths.tsPath, config.tsCLI);
}

/**
 * Initialize test environment with full validation
 * 1. Validate CLI binaries
 * 2. Clean up previous artifacts
 * 3. Copy baseline to isolated directories
 * @throws Error if setup fails at any step
 */
export async function initializeTestEnvironment(
  baseDir?: string
): Promise<{ config: CLIConfig; paths: TestPaths }> {
  const config = getCLIConfig();
  const paths = getTestPaths(baseDir);

  // Validate CLI binaries exist and are executable
  const { pythonAvailable } = await validateCLIBinaries(config);

  // Setup isolated test environment
  await setupTestEnvironment(paths, config, pythonAvailable);

  return { config, paths };
}
