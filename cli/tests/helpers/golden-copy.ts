/**
 * Golden Copy Test Helper
 *
 * Provides the core interface for tests to use the shared golden copy cache.
 * This is the spec-aligned implementation that all tests should use.
 *
 * Architecture:
 * - Single golden copy created once per test suite at suite initialization
 * - Stored in a temporary location (`/tmp/dr-golden-*`)
 * - Each test receives a unique working directory cloned from the golden copy
 * - Thread-safe: Multiple test workers can clone from the same golden copy
 * - Cleanup occurs at test suite shutdown via cleanupGoldenCopy()
 */

import { mkdir, cp, rm } from 'fs/promises';
import { tmpdir, availableParallelism } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { cwd } from 'process';

let goldenCopyPath: string | null = null;
const initLock = new Promise<void>((resolve) => resolve()); // Simple initialization guard

/**
 * Initialize the shared golden copy of the baseline test project.
 * This is called once per test suite execution.
 * Thread-safe: subsequent calls return the same path.
 *
 * Architecture:
 * - Creates a single copy of the baseline project in a temporary location
 * - All test working directories are subsequently cloned from this golden copy
 * - The golden copy itself is read-only after initialization
 * - Initialized on first call or when accessed via createTestWorkdir()
 *
 * Usage:
 * ```typescript
 * beforeAll(async () => {
 *   const goldenPath = await initGoldenCopy();
 *   console.log(`Golden copy at: ${goldenPath}`);
 * });
 * ```
 *
 * @returns Promise<string> Path to the golden copy directory
 */
export async function initGoldenCopy(): Promise<string> {
  if (goldenCopyPath) return goldenCopyPath;

  // Resolve baseline path relative to project root (parent of cli/)
  // Works both when running from source and from compiled code
  const projectRoot = resolve(cwd(), '..');
  const BASELINE = resolve(projectRoot, 'cli-validation/test-project/baseline');

  goldenCopyPath = join(tmpdir(), `dr-golden-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

  try {
    await mkdir(goldenCopyPath, { recursive: true });
    await cp(BASELINE, goldenCopyPath, { recursive: true });

    if (process.env.DEBUG_GOLDEN_COPY) {
      console.log(`Golden copy initialized at: ${goldenCopyPath}`);
    }
  } catch (error) {
    goldenCopyPath = null;
    throw new Error(
      `Failed to initialize golden copy: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return goldenCopyPath;
}

/**
 * Create an isolated test working directory from the golden copy.
 * Each test receives a unique directory pre-populated with baseline data.
 *
 * This is the primary function tests use for setup.
 *
 * Architecture:
 * - Ensures golden copy is initialized on first call
 * - Creates a unique temporary directory for each test
 * - Copies entire golden copy to the test directory
 * - Returns cleanup function to remove the test directory
 * - Test directory is independent and can be safely modified
 *
 * Usage:
 * ```typescript
 * let testDir: string;
 * let cleanup: () => Promise<void>;
 *
 * beforeEach(async () => {
 *   const workdir = await createTestWorkdir();
 *   testDir = workdir.path;
 *   cleanup = workdir.cleanup;
 * });
 *
 * afterEach(async () => {
 *   await cleanup();
 * });
 *
 * test("validates model", async () => {
 *   const result = await runDr(['validate'], { cwd: testDir });
 *   expect(result.exitCode).toBe(0);
 * });
 * ```
 *
 * @returns Promise resolving to { path: string, cleanup: () => Promise<void> }
 */
export async function createTestWorkdir(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const golden = await initGoldenCopy();

  const testId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const testDir = join(tmpdir(), `dr-test-${testId}`);

  try {
    await mkdir(testDir, { recursive: true });
    await cp(golden, testDir, { recursive: true });

    if (process.env.DEBUG_GOLDEN_COPY) {
      console.log(`Test workdir created at: ${testDir}`);
    }

    return {
      path: testDir,
      cleanup: async () => {
        try {
          await rm(testDir, { recursive: true, force: true });
          if (process.env.DEBUG_GOLDEN_COPY) {
            console.log(`Test workdir cleaned up: ${testDir}`);
          }
        } catch (error) {
          if (process.env.DEBUG_GOLDEN_COPY) {
            console.warn(`Failed to clean up test workdir ${testDir}:`, error);
          }
        }
      },
    };
  } catch (error) {
    // Attempt cleanup on error
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    throw new Error(
      `Failed to create test workdir: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Clean up the golden copy at test suite shutdown.
 * Call this in global afterAll hook.
 *
 * Architecture:
 * - Removes the golden copy directory from temporary storage
 * - Resets the initialization state so next test run creates a new golden copy
 * - Safe to call multiple times (idempotent)
 * - Should be called in test runner's global teardown
 *
 * Usage:
 * ```typescript
 * afterAll(async () => {
 *   await cleanupGoldenCopy();
 * });
 * ```
 *
 * @returns Promise<void>
 */
export async function cleanupGoldenCopy(): Promise<void> {
  if (goldenCopyPath) {
    try {
      await rm(goldenCopyPath, { recursive: true, force: true });
      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log(`Golden copy cleaned up: ${goldenCopyPath}`);
      }
    } catch (error) {
      if (process.env.DEBUG_GOLDEN_COPY) {
        console.warn(`Failed to clean up golden copy ${goldenCopyPath}:`, error);
      }
    }
    goldenCopyPath = null;
  }
}

/**
 * Get the current golden copy path (for debugging/diagnostics)
 *
 * @returns The golden copy path if initialized, null otherwise
 */
export function getGoldenCopyPath(): string | null {
  return goldenCopyPath;
}

/**
 * Check if golden copy is initialized
 *
 * @returns true if golden copy has been initialized
 */
export function isGoldenCopyInitialized(): boolean {
  return goldenCopyPath !== null;
}
