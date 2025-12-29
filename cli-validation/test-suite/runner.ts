/**
 * Test Suite Runner Entry Point
 *
 * This file delegates to test-runner.ts which implements the full
 * Phase 4 pipeline execution engine with YAML test case loading.
 */

// Import and run the main test runner
import('./test-runner.ts').catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
