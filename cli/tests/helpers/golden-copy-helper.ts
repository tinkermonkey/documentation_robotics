/**
 * Golden Copy Test Helper
 *
 * Provides convenient functions for tests to use the shared golden copy cache.
 * This simplifies test setup and provides the same interface as the existing
 * createTestModel() function while leveraging the golden copy optimization.
 */

import { Model } from '../../src/core/model.js';
import { GoldenCopyCacheManager, type GoldenCopyCacheConfig } from '../../src/core/golden-copy-cache.js';

/**
 * Options for creating a test model from the golden copy
 */
export interface CreateTestModelFromGoldenOptions {
  /** Whether to use golden copy (defaults to true) */
  useGoldenCopy?: boolean;

  /** Cache configuration if using golden copy */
  goldenCopyConfig?: GoldenCopyCacheConfig;

  /** Fallback options if not using golden copy */
  fallbackOptions?: {
    name?: string;
    version?: string;
    specVersion?: string;
    description?: string;
    author?: string;
    lazyLoad?: boolean;
  };
}

/**
 * Create a test model, optionally using the golden copy for better performance
 *
 * If useGoldenCopy is true (default), this will clone from a shared golden copy
 * which provides:
 * - Faster initialization (especially in parallel tests)
 * - Consistent test data across tests
 * - Reduced memory overhead
 *
 * If useGoldenCopy is false, this falls back to the original createTestModel behavior
 * for cases where a completely fresh model is needed.
 *
 * Usage (with golden copy - default):
 * ```typescript
 * const { model, cleanup } = await createTestModelWithGoldenCopy();
 * // use model...
 * await cleanup();
 * ```
 *
 * Usage (without golden copy):
 * ```typescript
 * const { model, cleanup } = await createTestModelWithGoldenCopy({
 *   useGoldenCopy: false
 * });
 * // use model...
 * await cleanup();
 * ```
 *
 * @param options Configuration options
 * @returns Promise resolving to model, rootPath, and cleanup function
 */
export async function createTestModelWithGoldenCopy(
  options: CreateTestModelFromGoldenOptions = {}
): Promise<{
  model: Model;
  rootPath: string;
  cleanup: () => Promise<void>;
  fromGoldenCopy: boolean;
}> {
  const useGoldenCopy = options.useGoldenCopy ?? true;

  if (!useGoldenCopy) {
    // Fall back to original behavior
    const { createTestModel } = await import('./test-fixtures.js');
    const result = await createTestModel(options.fallbackOptions);
    return {
      ...result,
      fromGoldenCopy: false,
    };
  }

  try {
    // Initialize golden copy cache if needed
    const manager = GoldenCopyCacheManager.getInstance(options.goldenCopyConfig);
    if (!manager.isInitialized()) {
      await manager.init();
    }

    // Clone from golden copy
    const cloned = await manager.clone();

    return {
      model: cloned.model,
      rootPath: cloned.rootPath,
      cleanup: cloned.cleanup,
      fromGoldenCopy: true,
    };
  } catch (error) {
    // If golden copy fails, fall back gracefully
    if (process.env.GOLDEN_COPY_STRICT === 'true') {
      throw error;
    }

    if (process.env.DEBUG_GOLDEN_COPY) {
      console.warn(
        `[GoldenCopy] Failed to use golden copy, falling back to createTestModel:`,
        error instanceof Error ? error.message : String(error)
      );
    }

    // Fall back to original behavior
    const { createTestModel } = await import('./test-fixtures.js');
    const result = await createTestModel(options.fallbackOptions);
    return {
      ...result,
      fromGoldenCopy: false,
    };
  }
}

/**
 * Initialize the golden copy cache for a test suite
 *
 * This should be called in beforeAll/beforeEach hooks to ensure the golden copy
 * is ready before tests run.
 *
 * Usage:
 * ```typescript
 * beforeAll(async () => {
 *   await initializeGoldenCopy({
 *     warmup: true,  // Populate with sample data
 *     eagerLoad: false  // Load layers on demand
 *   });
 * });
 * ```
 *
 * @param config Cache configuration
 */
export async function initializeGoldenCopy(config?: GoldenCopyCacheConfig): Promise<void> {
  const manager = GoldenCopyCacheManager.getInstance(config);
  if (!manager.isInitialized()) {
    await manager.init();
  }
}

/**
 * Clean up the golden copy cache after test suite completion
 *
 * This should be called in afterAll hooks to clean up the cached model.
 * Note: Individual test model cleanups should still be called as usual.
 *
 * Usage:
 * ```typescript
 * afterAll(async () => {
 *   await cleanupGoldenCopy();
 * });
 * ```
 */
export async function cleanupGoldenCopy(): Promise<void> {
  const manager = GoldenCopyCacheManager.getInstance();
  if (manager.isInitialized()) {
    await manager.cleanup();
  }
}

/**
 * Get statistics about golden copy cache performance
 *
 * Useful for performance analysis and debugging.
 *
 * Usage:
 * ```typescript
 * const stats = getGoldenCopyStats();
 * console.log(`Average clone time: ${stats.avgCloneTime}ms`);
 * ```
 *
 * @returns Statistics object with timing and count data
 */
export function getGoldenCopyStats() {
  const manager = GoldenCopyCacheManager.getInstance();
  return manager.getStats();
}

/**
 * Reset the golden copy cache manager (mainly for testing)
 *
 * This clears the singleton instance and allows a fresh initialization.
 * Normally not needed in test code.
 */
export function resetGoldenCopyManager(): void {
  GoldenCopyCacheManager.resetInstance();
}

/**
 * Create an isolated test working directory from the golden copy.
 * Each test receives a unique directory pre-populated with baseline data.
 *
 * This is the spec-required function that returns { path, cleanup }.
 *
 * Usage:
 * ```typescript
 * const { path, cleanup } = await createTestWorkdir();
 * // use path for test working directory...
 * await cleanup();
 * ```
 *
 * @returns Promise resolving to working directory path and cleanup handler
 */
export async function createTestWorkdir(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const manager = GoldenCopyCacheManager.getInstance();
  if (!manager.isInitialized()) {
    await manager.init();
  }

  const cloned = await manager.clone();
  return {
    path: cloned.rootPath,
    cleanup: cloned.cleanup,
  };
}
