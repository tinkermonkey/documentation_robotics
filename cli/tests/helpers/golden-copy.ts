/**
 * Golden Copy Test Helper
 *
 * Provides the core interface for tests to use per-worker golden copy caches.
 * This is the spec-aligned implementation that all tests should use.
 *
 * Architecture:
 * - One golden copy per worker, created during test initialization
 * - Stored in a temporary location (`/tmp/dr-golden-worker-{id}/`)
 * - Each test receives a unique working directory cloned from its worker's golden copy
 * - Thread-safe: Each worker clones exclusively from its own baseline (no I/O contention)
 * - Cleanup occurs at test suite shutdown via cleanupAllWorkerGoldenCopies()
 */

import { mkdir, cp, rm, access } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { cwd } from "process";

/**
 * Recommended timeout (ms) for beforeEach hooks that call createTestWorkdir().
 * Golden copy clone + filesystem verification can take several seconds in
 * containerized environments with slow disk I/O or high concurrency.
 */
export const GOLDEN_COPY_HOOK_TIMEOUT = 30_000;

// Map of worker ID to worker-specific golden copy path
const workerGoldenCopyPaths: Map<string, string> = new Map();
// Map of worker ID to initialization promise (for preventing concurrent initialization)
const workerInitializationPromises: Map<string, Promise<string>> = new Map();
// Map of worker ID to initialization error
const workerInitializationErrors: Map<string, Error> = new Map();

// Legacy single shared golden copy (for backwards compatibility)
let goldenCopyPath: string | null = null;
let initializationPromise: Promise<string> | null = null;
let initializationError: Error | null = null;

/**
 * Initialize a per-worker golden copy of the baseline test project.
 * This is called once per worker during test initialization via setup.ts.
 * Thread-safe: subsequent calls return the same path.
 *
 * Architecture:
 * - Creates one copy of the baseline project per worker
 * - Stored at `/tmp/dr-golden-worker-{workerId}/`
 * - All test working directories for that worker are cloned from this baseline
 * - The golden copy itself is read-only after initialization
 * - Each worker owns its baseline exclusively (no I/O contention)
 *
 * Usage:
 * ```typescript
 * // In setup.ts preload:
 * await initWorkerGoldenCopy(process.env.TEST_WORKER_ID);
 * ```
 *
 * @param workerId - Unique identifier for the worker
 * @returns Promise<string> Path to the worker's golden copy directory
 */
export async function initWorkerGoldenCopy(workerId: string): Promise<string> {
  // Return cached path if already initialized for this worker
  if (workerGoldenCopyPaths.has(workerId)) {
    return workerGoldenCopyPaths.get(workerId)!;
  }

  // If there was a previous error, throw it again
  if (workerInitializationErrors.has(workerId)) {
    throw workerInitializationErrors.get(workerId);
  }

  // If initialization is in progress, wait for it to complete
  if (workerInitializationPromises.has(workerId)) {
    return workerInitializationPromises.get(workerId)!;
  }

  // Create a new initialization promise and cache it to prevent concurrent initialization
  const initPromise = (async () => {
    // Resolve baseline path - try both possible locations
    let BASELINE = resolve("/workspace", "cli-validation/test-project/baseline");

    // Fallback: try relative to current working directory
    try {
      await access(BASELINE);
    } catch {
      const projectRoot = resolve(cwd(), "..");
      BASELINE = resolve(projectRoot, "cli-validation/test-project/baseline");
    }

    const workerGoldenPath = join(tmpdir(), `dr-golden-worker-${workerId}`);

    try {
      await mkdir(workerGoldenPath, { recursive: true });
      await cp(BASELINE, workerGoldenPath, { recursive: true });

      // Verify filesystem operations are committed by checking key files
      await verifyFilesystemReady(workerGoldenPath);

      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log(`Worker golden copy initialized for ${workerId} at: ${workerGoldenPath}`);
      }

      workerGoldenCopyPaths.set(workerId, workerGoldenPath);
    } catch (error) {
      const err = new Error(
        `Failed to initialize worker golden copy for ${workerId}: ${error instanceof Error ? error.message : String(error)}`
      );
      workerInitializationErrors.set(workerId, err);
      throw err;
    }

    return workerGoldenPath;
  })();

  workerInitializationPromises.set(workerId, initPromise);
  return initPromise;
}

/**
 * Initialize the shared golden copy of the baseline test project.
 * DEPRECATED: Use initWorkerGoldenCopy() instead for per-worker isolation.
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
  // Return cached path if already initialized
  if (goldenCopyPath) return goldenCopyPath;

  // If there was a previous error, throw it again
  if (initializationError) {
    throw initializationError;
  }

  // If initialization is in progress, wait for it to complete
  if (initializationPromise) return initializationPromise;

  // Create a new initialization promise and cache it to prevent concurrent initialization
  initializationPromise = (async () => {
    // Resolve baseline path - try both possible locations
    let BASELINE = resolve("/workspace", "cli-validation/test-project/baseline");

    // Fallback: try relative to current working directory
    try {
      await access(BASELINE);
    } catch {
      const projectRoot = resolve(cwd(), "..");
      BASELINE = resolve(projectRoot, "cli-validation/test-project/baseline");
    }

    goldenCopyPath = join(
      tmpdir(),
      `dr-golden-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    );

    try {
      await mkdir(goldenCopyPath, { recursive: true });
      await cp(BASELINE, goldenCopyPath, { recursive: true });

      // Verify filesystem operations are committed by checking key files
      await verifyFilesystemReady(goldenCopyPath);

      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log(`Golden copy initialized at: ${goldenCopyPath}`);
      }
    } catch (error) {
      goldenCopyPath = null;
      initializationPromise = null;
      const err = new Error(
        `Failed to initialize golden copy: ${error instanceof Error ? error.message : String(error)}`
      );
      initializationError = err;
      throw err;
    }

    return goldenCopyPath!;
  })();

  return initializationPromise;
}

/**
 * Create an isolated test working directory from the worker's golden copy.
 * Each test receives a unique directory pre-populated with baseline data.
 *
 * This is the primary function tests use for setup.
 *
 * Architecture:
 * - Uses the per-worker golden copy initialized during test setup
 * - Creates a unique temporary directory for each test
 * - Copies entire worker golden copy to the test directory
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
  // Get the worker ID from environment (set by setup.ts)
  const workerId = process.env.TEST_WORKER_ID;

  if (!workerId) {
    throw new Error(
      "TEST_WORKER_ID not set. This should be set by setup.ts preload during test initialization."
    );
  }

  // Get the worker's golden copy (should have been initialized by setup.ts)
  let golden = workerGoldenCopyPaths.get(workerId);

  if (!golden) {
    // Fallback: try to initialize if not already done
    // This handles cases where createTestWorkdir is called before worker golden copy initialization
    golden = await initWorkerGoldenCopy(workerId);
  }

  const testId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const testDir = join(tmpdir(), `dr-test-${testId}`);

  let copyAttempts = 0;
  const maxCopyAttempts = 3;
  let lastCopyError: Error | null = null;

  try {
    // Attempt to copy with retries for race conditions
    for (copyAttempts = 0; copyAttempts < maxCopyAttempts; copyAttempts++) {
      try {
        await mkdir(testDir, { recursive: true });
        // Copy golden copy to test directory with timeout
        // Use 60s timeout to accommodate slow disk I/O in containerized environments
        await Promise.race([
          cp(golden, testDir, { recursive: true }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Copy operation timed out after 60s")), 60000)
          ),
        ]);

        // After copy, add explicit sync to ensure all filesystem operations are flushed
        // This is a workaround for concurrent test execution race conditions
        if (process.platform !== "win32") {
          try {
            // Try to access a key file to force filesystem sync
            const { spawnSync } = await import("child_process");
            spawnSync("sync", [], { stdio: "ignore" });
          } catch {
            // Ignore sync errors on systems that don't support it
          }
        }

        // Verify filesystem is ready for the test directory
        // With per-worker golden copies, each worker owns its baseline exclusively
        // so we only need a single existence check, not a retry loop
        await verifyFilesystemReady(testDir, 1);
        break; // Success
      } catch (error) {
        lastCopyError = error instanceof Error ? error : new Error(String(error));
        if (copyAttempts < maxCopyAttempts - 1) {
          // Clean up partial copy before retrying
          try {
            await rm(testDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors during retry
          }
          // Wait before retrying
          const backoffMs = 100 * Math.pow(2, copyAttempts);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    if (copyAttempts === maxCopyAttempts && lastCopyError) {
      throw lastCopyError;
    }

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
          // Always log cleanup errors - they can cause disk space issues
          console.error(
            `[GoldenCopy] ERROR: Failed to clean up test workdir at ${testDir}. ` +
              `This may cause disk space issues. ` +
              `Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },
    };
  } catch (error) {
    // Attempt cleanup on error
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // Log cleanup failures even in error paths
      console.error(
        `[GoldenCopy] ERROR: Test workdir creation failed AND cleanup failed. ` +
          `Orphaned directory may exist at ${testDir}. ` +
          `Creation error: ${error instanceof Error ? error.message : String(error)}. ` +
          `Cleanup error: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
      );
    }
    throw new Error(
      `Failed to create test workdir: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Clean up all worker golden copies at test suite shutdown.
 * Call this in global afterAll hook.
 *
 * Architecture:
 * - Removes all per-worker golden copy directories from temporary storage
 * - Resets the initialization state so next test run creates new golden copies
 * - Safe to call multiple times (idempotent)
 * - Should be called in test runner's global teardown
 *
 * Usage:
 * ```typescript
 * afterAll(async () => {
 *   await cleanupAllWorkerGoldenCopies();
 * });
 * ```
 *
 * @returns Promise<void>
 */
export async function cleanupAllWorkerGoldenCopies(): Promise<void> {
  const cleanupPromises: Promise<void>[] = [];

  for (const [workerId, path] of workerGoldenCopyPaths.entries()) {
    cleanupPromises.push(
      (async () => {
        try {
          await rm(path, { recursive: true, force: true });
          if (process.env.DEBUG_GOLDEN_COPY) {
            console.log(`Worker golden copy cleaned up for ${workerId}: ${path}`);
          }
        } catch (error) {
          // Always log cleanup errors
          console.error(
            `[GoldenCopy] ERROR: Failed to clean up worker golden copy for ${workerId} at ${path}. ` +
              `This may cause disk space issues. ` +
              `Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })()
    );
  }

  // Wait for all cleanup operations to complete
  await Promise.all(cleanupPromises);

  // Reset state
  workerGoldenCopyPaths.clear();
  workerInitializationPromises.clear();
  workerInitializationErrors.clear();

  if (process.env.DEBUG_GOLDEN_COPY) {
    console.log(`All worker golden copies cleaned up`);
  }
}

/**
 * Clean up the golden copy at test suite shutdown.
 * DEPRECATED: Use cleanupAllWorkerGoldenCopies() instead.
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
      // Always log cleanup errors
      console.error(
        `[GoldenCopy] ERROR: Failed to clean up golden copy at ${goldenCopyPath}. ` +
          `This may cause disk space issues. ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    goldenCopyPath = null;
  }
  initializationPromise = null;
  initializationError = null;
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

/**
 * Verify that filesystem operations are committed by checking key files exist
 *
 * This performs a simple existence check to ensure critical files are accessible.
 * With per-worker golden copies, retry logic is minimal since each worker owns
 * its baseline exclusively and there is no cross-worker I/O contention.
 *
 * @param path - Path to verify
 * @param maxRetries - Maximum number of retries with backoff (rarely needed with exclusive baselines)
 * @private
 */
async function verifyFilesystemReady(path: string, maxRetries: number = 1): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Check that the main path exists
      await access(path);

      // Check that manifest exists (key indicator of successful copy)
      const manifestPath = join(path, "documentation-robotics", "model", "manifest.yaml");
      await access(manifestPath);

      // Check that key layer directories exist
      const testingLayerPath = join(path, "documentation-robotics", "model", "12_testing");
      await access(testingLayerPath);

      // All checks passed, filesystem is ready
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Only retry on unexpected failures; with exclusive baselines, this should not happen
      if (attempt < maxRetries - 1) {
        // Brief backoff: 50ms base + jitter
        const backoffMs = 50 + Math.random() * 50;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw new Error(
    `Filesystem verification failed. ` +
      `Golden copy may not be properly initialized. ` +
      `Last error: ${lastError?.message}`
  );
}
