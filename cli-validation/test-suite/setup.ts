/**
 * Test Environment Setup
 *
 * Manages baseline test project copying and CLI binary validation.
 * Implements clean-room pattern: fresh copies of baseline for each test run.
 */

import { cp, rm, readdir, stat } from "node:fs/promises";
import { readFile, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as yaml from "yaml";
import { createHash } from "node:crypto";

const execAsync = promisify(exec);

/**
 * Resolve the workspace root directory
 * Used by getCLIConfig, getTestPaths, and getMultiWorkerTestPaths to find the project root
 * @throws Error if the workspace root cannot be resolved from the given path
 */
function resolveWorkspaceRoot(baseDir: string = process.cwd()): string {
  const isRunningFromTestSuite = baseDir.includes("cli-validation/test-suite");

  if (!isRunningFromTestSuite) {
    return baseDir;
  }

  const marker = "cli-validation/test-suite";
  const markerIndex = baseDir.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(
      `Could not resolve workspace root: Expected path to contain "${marker}", but got: "${baseDir}"`
    );
  }

  const workspaceRoot = baseDir.substring(0, markerIndex);

  if (!workspaceRoot || workspaceRoot.endsWith(sep)) {
    throw new Error(
      `Could not resolve workspace root: Invalid path segment before "${marker}": "${workspaceRoot}"`
    );
  }

  return workspaceRoot;
}

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
 * Multi-worker test environment paths
 */
export interface MultiWorkerTestPaths {
  baselinePath: string;
  pythonPath: string;
  tsPaths: string[]; // Array of N worker paths: ts-cli-1, ts-cli-2, ..., ts-cli-N
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
  const workspaceRoot = resolveWorkspaceRoot();

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
  const workspaceRoot = resolveWorkspaceRoot(baseDir);

  return {
    baselinePath: join(workspaceRoot, "cli-validation/test-project/baseline"),
    pythonPath: join(workspaceRoot, "cli-validation/test-project/python-cli"),
    tsPath: join(workspaceRoot, "cli-validation/test-project/ts-cli"),
  };
}

/**
 * Get multi-worker test environment paths relative to workspace root
 * Creates paths for N isolated worker baseline copies (ts-cli-1, ts-cli-2, ..., ts-cli-N)
 */
export function getMultiWorkerTestPaths(
  workerCount: number,
  baseDir: string = process.cwd()
): MultiWorkerTestPaths {
  // Determine workspace root
  const workspaceRoot = resolveWorkspaceRoot(baseDir);
  const baseTestProjectDir = join(workspaceRoot, "cli-validation/test-project");

  // Create paths for N workers: ts-cli-1, ts-cli-2, ..., ts-cli-N
  const tsPaths: string[] = [];
  for (let i = 1; i <= workerCount; i++) {
    tsPaths.push(join(baseTestProjectDir, `ts-cli-${i}`));
  }

  return {
    baselinePath: join(baseTestProjectDir, "baseline"),
    pythonPath: join(baseTestProjectDir, "python-cli"),
    tsPaths,
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
  const versionCommand = `${cliPath} --version`;

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
 * Result of cleanup operation
 */
export interface CleanupResult {
  directoryDeleteSuccess: boolean;
  baselineRestoreSuccess: boolean;
  errors: string[];
}

/**
 * Shared internal cleanup implementation
 * Deletes directories and restores baseline to committed state
 * @param pathsToDelete - Array of directory paths to delete
 * @param baselinePath - Path to the baseline directory (for git restore)
 * @returns CleanupResult with status of each operation
 * @throws Error only if directory deletion fails; baseline restore failures are reported in result
 */
async function cleanupAndRestoreBaseline(
  pathsToDelete: string[],
  baselinePath: string
): Promise<CleanupResult> {
  const result: CleanupResult = {
    directoryDeleteSuccess: true,
    baselineRestoreSuccess: true,
    errors: [],
  };

  // rm with force: true ignores missing directories
  try {
    for (const path of pathsToDelete) {
      await rm(path, { recursive: true, force: true });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to delete test directories: ${errorMsg}`);
  }

  // Restore baseline to its committed state to prevent test contamination
  try {
    const marker = 'cli-validation';
    const markerIndex = baselinePath.indexOf(marker);
    if (markerIndex === -1) {
      throw new Error(`Could not resolve workspace root from baseline path: "${baselinePath}"`);
    }
    const workspaceRoot = baselinePath.substring(0, markerIndex);

    await execAsync('git checkout -- cli-validation/test-project/baseline/', {
      cwd: workspaceRoot,
    });
  } catch (error) {
    // If git restore fails, record it but don't throw
    // The baseline might not be in a git repo or might be read-only
    result.baselineRestoreSuccess = false;
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Baseline restore failed: ${errorMsg}`);
    console.warn(`⚠ Could not restore baseline via git: ${errorMsg}`);
  }

  return result;
}

/**
 * Remove test artifacts from previous runs
 * Implements clean-room pattern by deleting old test directories
 * Also restores the baseline to its committed state to prevent contamination
 * @returns CleanupResult with status of each operation
 * @throws Error only if directory deletion fails; baseline restore failures are reported in result
 */
export async function cleanupTestArtifacts(paths: TestPaths): Promise<CleanupResult> {
  return cleanupAndRestoreBaseline(
    [paths.pythonPath, paths.tsPath],
    paths.baselinePath
  );
}

/**
 * Remove test artifacts for multi-worker setup
 * Deletes all N worker copies (ts-cli-1 through ts-cli-N)
 * Also restores the baseline to its committed state to prevent contamination
 * @returns CleanupResult with status of each operation
 * @throws Error only if directory deletion fails; baseline restore failures are reported in result
 */
export async function cleanupMultiWorkerTestArtifacts(
  paths: MultiWorkerTestPaths
): Promise<CleanupResult> {
  return cleanupAndRestoreBaseline(
    [paths.pythonPath, ...paths.tsPaths],
    paths.baselinePath
  );
}

/**
 * Shared internal setup implementation
 * Creates fresh copies and updates manifests
 * @param baselinePath - Path to the baseline directory
 * @param pythonPath - Path for Python CLI copy
 * @param tsPaths - Array of paths for TypeScript CLI copy/copies
 * @param config - CLI configuration
 * @param pythonAvailable - Whether Python CLI is available
 * @throws Error if copy operation fails
 */
async function setupAndUpdateManifests(
  baselinePath: string,
  pythonPath: string,
  tsPaths: string[],
  config: CLIConfig,
  pythonAvailable: boolean = true
): Promise<void> {
  // Create fresh copy for Python CLI (single copy)
  try {
    await cp(baselinePath, pythonPath, { recursive: true });
  } catch (error) {
    throw new Error(
      `Failed to copy baseline to python-cli: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Create fresh copy/copies for TypeScript CLI
  for (let i = 0; i < tsPaths.length; i++) {
    const tsPath = tsPaths[i];
    try {
      await cp(baselinePath, tsPath, { recursive: true });
    } catch (error) {
      const label = tsPaths.length === 1 ? 'ts-cli' : `ts-cli-${i + 1}`;
      throw new Error(
        `Failed to copy baseline to ${label}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Update cli_version in manifest for this copy
    await updateManifestCLIVersion(tsPath, config.tsCLI);

    // Compute and store checksums for baseline integrity validation
    try {
      await storeWorkerBaselineChecksums(tsPath);
    } catch (error) {
      const label = tsPaths.length === 1 ? 'ts-cli' : `ts-cli-${i + 1}`;
      throw new Error(
        `Failed to compute baseline checksums for ${label}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Update cli_version in Python CLI manifest if available
  if (pythonAvailable) {
    await updateManifestCLIVersion(pythonPath, config.pythonCLI);
  }
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
  const cleanupResult = await cleanupTestArtifacts(paths);
  if (!cleanupResult.baselineRestoreSuccess) {
    // Log warning if baseline restore failed, but proceed - setup will use potentially contaminated baseline
    // This is acceptable here since setup will create fresh test copies
    console.warn('⚠ Baseline restore failed during setup cleanup');
    for (const error of cleanupResult.errors) {
      console.warn(`   - ${error}`);
    }
  }

  // Setup and update manifests
  await setupAndUpdateManifests(
    paths.baselinePath,
    paths.pythonPath,
    [paths.tsPath],
    config,
    pythonAvailable
  );
}

/**
 * Create fresh copies of baseline test project for multi-worker setup
 * Creates N isolated copies (ts-cli-1 through ts-cli-N)
 * Updates cli_version in manifests to match the CLI being tested
 * @param paths - Multi-worker test paths
 * @param config - CLI configuration
 * @param pythonAvailable - Whether Python CLI is available (optional)
 * @throws Error if copy operation fails
 */
export async function setupMultiWorkerTestEnvironment(
  paths: MultiWorkerTestPaths,
  config: CLIConfig,
  pythonAvailable: boolean = true
): Promise<void> {
  // Clean up previous test artifacts
  const cleanupResult = await cleanupMultiWorkerTestArtifacts(paths);
  if (!cleanupResult.baselineRestoreSuccess) {
    // Log warning if baseline restore failed, but proceed - setup will use potentially contaminated baseline
    // This is acceptable here since setup will create fresh test copies
    console.warn('⚠ Baseline restore failed during setup cleanup');
    for (const error of cleanupResult.errors) {
      console.warn(`   - ${error}`);
    }
  }

  // Setup and update manifests for N workers
  await setupAndUpdateManifests(
    paths.baselinePath,
    paths.pythonPath,
    paths.tsPaths,
    config,
    pythonAvailable
  );
}

/**
 * Validation error that indicates baseline contamination
 */
export class BaselineContaminationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaselineContaminationError';
  }
}

/**
 * Validate that the baseline directory hasn't been modified by tests
 * @throws BaselineContaminationError if baseline has uncommitted changes
 * @throws Error if validation cannot be performed due to git/system errors
 */
export async function validateBaselineIntegrity(baselinePath: string): Promise<void> {
  const marker = 'cli-validation';
  const markerIndex = baselinePath.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Could not resolve workspace root from baseline path: "${baselinePath}"`);
  }
  const workspaceRoot = baselinePath.substring(0, markerIndex);

  let gitResult: string;
  try {
    const { stdout } = await execAsync(
      'git status --porcelain cli-validation/test-project/baseline/',
      { cwd: workspaceRoot }
    );
    gitResult = stdout;
  } catch (error) {
    // Git command itself failed - cannot validate
    throw new Error(
      `Failed to check baseline integrity: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Check if there are uncommitted changes
  if (gitResult.trim() !== '') {
    throw new BaselineContaminationError(
      `Baseline directory has uncommitted changes (test isolation issue):\n${gitResult}`
    );
  }
}

/**
 * Compute SHA256 hash of a file's contents
 * @param filePath - Path to the file
 * @returns SHA256 hash in hex format
 */
async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Recursively compute checksums for all files in a directory
 * @param dirPath - Path to the directory
 * @param fileChecksums - Map to accumulate file paths and their checksums
 * @param relativePath - Relative path from the root directory (for consistent key format)
 */
async function computeDirectoryChecksums(
  dirPath: string,
  fileChecksums: Map<string, string> = new Map(),
  relativePath: string = ''
): Promise<Map<string, string>> {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    // Skip git and node_modules directories
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }

    const fullPath = join(dirPath, entry.name);
    const relPath = relativePath ? join(relativePath, entry.name) : entry.name;

    if (entry.isDirectory()) {
      await computeDirectoryChecksums(fullPath, fileChecksums, relPath);
    } else if (entry.isFile()) {
      const hash = await computeFileHash(fullPath);
      fileChecksums.set(relPath, hash);
    }
  }

  return fileChecksums;
}

/**
 * Compute and store checksums for a worker baseline copy
 * Checksums are stored in a hidden file inside the worker directory
 * @param workerPath - Path to the worker directory (e.g., ts-cli-1)
 */
async function storeWorkerBaselineChecksums(workerPath: string): Promise<void> {
  const checksumFile = join(workerPath, '.baseline-checksums.json');

  // Compute checksums for the documentation-robotics model directory
  const modelDir = join(workerPath, 'documentation-robotics/model');
  const checksums = await computeDirectoryChecksums(modelDir);

  // Store checksums
  const checksumData = {
    timestamp: new Date().toISOString(),
    checksums: Object.fromEntries(checksums),
  };

  await writeFile(checksumFile, JSON.stringify(checksumData, null, 2), 'utf-8');
}

/**
 * Validate a worker's baseline copy against stored checksums
 * @throws BaselineContaminationError if files have been modified or deleted
 * @throws Error if checksums cannot be computed or loaded
 */
export async function validateWorkerBaselineIntegrity(workerPath: string): Promise<void> {
  const checksumFile = join(workerPath, '.baseline-checksums.json');

  // Load stored checksums
  let storedChecksumData: { checksums: Record<string, string> };
  try {
    const content = await readFile(checksumFile, 'utf-8');
    storedChecksumData = JSON.parse(content);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load baseline checksums for worker at ${workerPath}: ${errorMsg}`);
  }

  const storedChecksums = new Map(Object.entries(storedChecksumData.checksums));

  // Compute current checksums
  const modelDir = join(workerPath, 'documentation-robotics/model');
  let currentChecksums: Map<string, string>;
  try {
    currentChecksums = await computeDirectoryChecksums(modelDir);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to compute baseline checksums for worker at ${workerPath}: ${errorMsg}`);
  }

  // Compare checksums
  const modifications: string[] = [];

  // Check for modified or deleted files
  for (const [filePath, storedHash] of storedChecksums.entries()) {
    const currentHash = currentChecksums.get(filePath);
    if (!currentHash) {
      modifications.push(`  - DELETED: ${filePath}`);
    } else if (currentHash !== storedHash) {
      modifications.push(`  - MODIFIED: ${filePath}`);
    }
  }

  // Check for added files
  for (const filePath of currentChecksums.keys()) {
    if (!storedChecksums.has(filePath)) {
      modifications.push(`  - ADDED: ${filePath}`);
    }
  }

  if (modifications.length > 0) {
    throw new BaselineContaminationError(
      `Worker baseline copy at ${workerPath} has been contaminated (test isolation issue):\n${modifications.join('\n')}`
    );
  }
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

/**
 * Initialize multi-worker test environment with full validation
 * 1. Validate CLI binaries
 * 2. Clean up previous artifacts
 * 3. Create N isolated baseline copies (ts-cli-1 through ts-cli-N)
 * 4. Each copy gets its own manifest version update
 * @param workerCount - Number of isolated baseline copies to create (default: 4, minimum: 1)
 * @throws Error if setup fails at any step
 */
export async function initializeMultiWorkerTestEnvironment(
  workerCount: number = 4,
  baseDir?: string
): Promise<{ config: CLIConfig; paths: MultiWorkerTestPaths; primaryTsPath: string }> {
  const config = getCLIConfig();
  const paths = getMultiWorkerTestPaths(workerCount, baseDir);

  // Validate CLI binaries exist and are executable
  const { pythonAvailable } = await validateCLIBinaries(config);

  // Setup multi-worker test environment
  await setupMultiWorkerTestEnvironment(paths, config, pythonAvailable);

  // Return the primary worker path (ts-cli-1) for running tests
  const primaryTsPath = paths.tsPaths[0];

  return { config, paths, primaryTsPath };
}
