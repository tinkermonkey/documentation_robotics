/**
 * Test Suite Runner Entry Point
 *
 * This file delegates to test-runner.ts which implements the full
 * Test Suite Execution Engine with YAML test case loading.
 */

// Import and run the main test runner
import('./test-runner.ts').catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
