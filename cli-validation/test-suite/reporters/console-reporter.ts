/**
 * Console Reporter
 *
 * Formats and displays test results to terminal.
 * Phase 2 implementation will provide:
 * - Colored output for pass/fail status
 * - Detailed diff output for debugging
 * - Summary statistics and duration reporting
 */

/**
 * Report test results to console
 * @param testName Name of the test
 * @param passed Whether the test passed
 * @param duration Execution time in milliseconds
 * @param error Optional error message
 */
export function reportTestResult(
  testName: string,
  passed: boolean,
  duration: number,
  error?: string
): void {
  const status = passed ? "PASS" : "FAIL";
  console.log(`[${status}] ${testName} (${duration}ms)`);
  if (error) {
    console.log(`  Error: ${error}`);
  }
}
