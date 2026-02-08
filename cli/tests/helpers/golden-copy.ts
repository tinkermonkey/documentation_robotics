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

import { mkdir, cp, rm, access } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { cwd } from "process";

let goldenCopyPath: string | null = null;
let initializationPromise: Promise<string> | null = null;
let initializationError: Error | null = null;

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

  let copyAttempts = 0;
  const maxCopyAttempts = 3;
  let lastCopyError: Error | null = null;

  try {
    // Attempt to copy with retries for race conditions
    for (copyAttempts = 0; copyAttempts < maxCopyAttempts; copyAttempts++) {
      try {
        await mkdir(testDir, { recursive: true });
        // Copy golden copy to test directory with timeout
        await Promise.race([
          cp(golden, testDir, { recursive: true }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Copy operation timed out after 30s")), 30000)
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
        // This is critical for concurrent test execution
        // Use higher retry count for test directory since it just had a large copy operation
        await verifyFilesystemReady(testDir, 20);
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
 * This replaces the hardcoded 200ms delay with proper filesystem verification.
 * Checks that manifest and key directories exist and are accessible.
 *
 * @param path - Path to verify
 * @param maxRetries - Maximum number of retries with backoff
 * @private
 */
async function verifyFilesystemReady(path: string, maxRetries: number = 10): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Check that the main path exists
      await access(path);

      // Check that manifest exists (key indicator of successful copy)
      const manifestPath = join(path, "documentation-robotics", "model", "manifest.yaml");
      await access(manifestPath);

      // Check that key layer directories exist (especially the problematic testing layer)
      const testingLayerPath = join(path, "documentation-robotics", "model", "12_testing");
      await access(testingLayerPath);

      // Verify that all expected YAML files in testing layer are accessible
      // This helps catch filesystem sync issues during concurrent test execution
      const expectedTestingFiles = [
        "input-space-partitions.yaml",
        "test-case-sketches.yaml",
        "test-coverage-models.yaml",
      ];
      for (const file of expectedTestingFiles) {
        const filePath = join(testingLayerPath, file);
        await access(filePath);
      }

      // All checks passed, filesystem is ready
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Exponential backoff with jitter: 10ms, 20ms, 40ms, 80ms, etc.
      const backoffMs = Math.min(10 * Math.pow(2, attempt), 500) + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw new Error(
    `Filesystem verification failed after ${maxRetries} attempts. ` +
      `Golden copy may not be properly initialized. ` +
      `Last error: ${lastError?.message}`
  );
}
