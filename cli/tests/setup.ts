/**
 * Phase 4: Parallel Test Execution Setup
 *
 * This file is preloaded by Bun before running tests in parallel.
 * It initializes shared resources, configures isolation, and sets up
 * metrics collection for test execution analysis.
 */

import { randomUUID } from 'crypto';

// Global test configuration for parallel execution
declare global {
  var __TEST_ID__: string;
  var __TEST_START_TIME__: number;
  var __TEST_METRICS__: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    executionStartTime: number;
    executionEndTime: number;
    totalDuration: number;
  };
}

// Initialize per-worker test context
globalThis.__TEST_ID__ = randomUUID();
globalThis.__TEST_START_TIME__ = Date.now();

// Initialize metrics collection
globalThis.__TEST_METRICS__ = {
  totalTests: 0,
  passedTests: 0,
  failedTests: 0,
  executionStartTime: Date.now(),
  executionEndTime: 0,
  totalDuration: 0,
};

// Configure test isolation: each worker gets unique directories
process.env.TEST_WORKER_ID = globalThis.__TEST_ID__;
process.env.TEST_TEMP_DIR = `/tmp/test-${globalThis.__TEST_ID__}`;

// Suppress verbose CLI output in tests
if (!process.env.TEST_VERBOSE) {
  process.env.CLI_QUIET = 'true';
}

// Enable test-specific configuration
process.env.NODE_ENV = 'test';

// Log test environment setup
if (process.env.DEBUG_TEST_SETUP) {
  console.log(`[Setup] Test worker initialized: ${globalThis.__TEST_ID__}`);
  console.log(`[Setup] Temp directory: ${process.env.TEST_TEMP_DIR}`);
}

export {};
