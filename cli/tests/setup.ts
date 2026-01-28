/**
 * Parallel Test Execution Setup
 *
 * This file is preloaded by Bun before running tests in parallel.
 * It initializes shared resources, configures isolation, and sets up
 * metrics collection for test execution analysis.
 *
 * Shared Golden Copy Initialization:
 * - Creates a shared golden model on first use per worker
 * - Enables efficient cloning for test initialization
 */

import { randomUUID } from 'crypto';
import { GoldenCopyCacheManager } from '../dist/core/golden-copy-cache.js';

// Global test configuration for parallel execution
declare global {
  var __TEST_ID__: string;
  var __TEST_START_TIME__: number;
  var __GOLDEN_COPY_INITIALIZED__: boolean;
}

// Initialize per-worker test context
globalThis.__TEST_ID__ = randomUUID();
globalThis.__TEST_START_TIME__ = Date.now();

// Initialize golden copy cache flag
globalThis.__GOLDEN_COPY_INITIALIZED__ = false;

// Configure test isolation: each worker gets unique directories
process.env.TEST_WORKER_ID = globalThis.__TEST_ID__;
process.env.TEST_TEMP_DIR = `/tmp/test-${globalThis.__TEST_ID__}`;

// Suppress verbose CLI output in tests
if (!process.env.TEST_VERBOSE) {
  process.env.CLI_QUIET = 'true';
}

// Enable test-specific configuration
process.env.NODE_ENV = 'test';

// Initialize golden copy cache asynchronously
// This runs once per worker and provides a shared model for cloning
const initializeGoldenCopyAsync = async () => {
  if (process.env.DISABLE_GOLDEN_COPY === 'true') {
    if (process.env.DEBUG_TEST_SETUP) {
      console.log(`[Setup] Golden copy disabled via DISABLE_GOLDEN_COPY environment variable`);
    }
    return;
  }

  try {
    const manager = GoldenCopyCacheManager.getInstance({
      warmup: process.env.GOLDEN_COPY_WARMUP === 'true',
      eagerLoad: process.env.GOLDEN_COPY_EAGER === 'true',
    });

    // Initialize the golden copy cache (creates or loads shared model)
    const initStart = Date.now();
    await manager.init();
    const initTime = Date.now() - initStart;

    globalThis.__GOLDEN_COPY_INITIALIZED__ = true;

    if (process.env.DEBUG_TEST_SETUP) {
      console.log(`[Setup] Golden copy initialized in ${initTime}ms`);
      console.log(`[Setup] Cache location: ${manager.getCacheDir()}`);
    }
  } catch (error) {
    console.error('[Setup] Failed to initialize golden copy cache:', error instanceof Error ? error.message : String(error));
    // Don't fail setup if golden copy fails - tests will fall back to createTestModel
  }
};

// Kick off initialization (don't wait, let it happen in background)
initializeGoldenCopyAsync().catch((error) => {
  console.error('[Setup] Unexpected error in golden copy initialization:', error);
});

// Log test environment setup
if (process.env.DEBUG_TEST_SETUP) {
  console.log(`[Setup] Test worker initialized: ${globalThis.__TEST_ID__}`);
  console.log(`[Setup] Temp directory: ${process.env.TEST_TEMP_DIR}`);
  console.log(`[Setup] Golden copy will initialize asynchronously`);
}

// Set up cleanup on process exit
// This ensures golden copy is cleaned up after all tests complete
process.on('exit', async () => {
  if (globalThis.__GOLDEN_COPY_INITIALIZED__) {
    try {
      const manager = GoldenCopyCacheManager.getInstance();
      await manager.cleanup();
      if (process.env.DEBUG_TEST_SETUP) {
        console.log(`[Setup] Golden copy cleaned up on process exit`);
      }
    } catch (error) {
      if (process.env.DEBUG_TEST_SETUP) {
        console.warn(`[Setup] Error during golden copy cleanup:`, error instanceof Error ? error.message : String(error));
      }
    }
  }
});

export {};
