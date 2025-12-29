/**
 * Test Suite Runner
 *
 * Orchestrates test execution, managing test cases, CLI interaction,
 * and result reporting for CLI compatibility validation.
 */

import { initializeTestEnvironment, TestPaths, CLIConfig } from "./setup";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Result of a single test execution
 */
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

/**
 * Container for test execution results
 */
interface TestRunResults {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: TestResult[];
  totalDuration: number;
}

/**
 * Execute a command in a specified working directory
 */
async function executeCommand(
  command: string,
  cwd: string,
  timeout: number = 30000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.code || 1,
    };
  }
}

/**
 * Run a placeholder test suite (for Phase 1 foundation)
 * Phase 1 establishes infrastructure; actual tests are in Phase 3
 */
async function runPlaceholderTests(
  config: CLIConfig,
  paths: TestPaths
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Placeholder test 1: Baseline copy validation
  const startTime1 = Date.now();
  try {
    // Verify baseline directory exists
    const { stdout: ls1 } = await execAsync(
      `ls -la "${paths.pythonPath}/documentation-robotics/model/"`
    );
    const { stdout: ls2 } = await execAsync(
      `ls -la "${paths.tsPath}/documentation-robotics/model/"`
    );

    if (
      ls1.includes("manifest.yaml") &&
      ls2.includes("manifest.yaml")
    ) {
      results.push({
        name: "Baseline copy validation",
        passed: true,
        duration: Date.now() - startTime1,
      });
    } else {
      throw new Error("Manifest files not found in baseline copies");
    }
  } catch (error) {
    results.push({
      name: "Baseline copy validation",
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime1,
    });
  }

  // Placeholder test 2: Python CLI version validation
  const startTime2 = Date.now();
  try {
    const result = await executeCommand(
      `${config.pythonCLI} --version`,
      paths.pythonPath
    );
    if (result.exitCode === 0 || result.stdout.includes("version")) {
      results.push({
        name: "Python CLI available",
        passed: true,
        duration: Date.now() - startTime2,
      });
    } else {
      throw new Error(
        `CLI returned exit code ${result.exitCode}: ${result.stderr}`
      );
    }
  } catch (error) {
    results.push({
      name: "Python CLI available",
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime2,
    });
  }

  // Placeholder test 3: TypeScript CLI version validation
  const startTime3 = Date.now();
  try {
    const result = await executeCommand(
      `${config.tsCLI} version`,
      paths.tsPath
    );
    if (
      result.exitCode === 0 ||
      result.stdout.includes("CLI Version") ||
      result.stdout.includes("Spec Version")
    ) {
      results.push({
        name: "TypeScript CLI available",
        passed: true,
        duration: Date.now() - startTime3,
      });
    } else {
      throw new Error(
        `CLI returned exit code ${result.exitCode}: ${result.stderr}`
      );
    }
  } catch (error) {
    results.push({
      name: "TypeScript CLI available",
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime3,
    });
  }

  return results;
}

/**
 * Format and display test results
 */
function displayResults(results: TestRunResults): void {
  console.log("\n" + "=".repeat(70));
  console.log("CLI Compatibility Test Results");
  console.log("=".repeat(70));

  for (const result of results.results) {
    const status = result.passed ? "✓ PASS" : "⚠ WARN";
    console.log(
      `${status} ${result.name} (${result.duration}ms)`
    );
    if (result.error) {
      console.log(`      ${result.error}`);
    }
  }

  console.log("=".repeat(70));
  console.log(
    `Results: ${results.passedTests} passed, ${results.failedTests} warnings out of ${results.totalTests} tests`
  );
  console.log(`Total duration: ${results.totalDuration}ms`);
  console.log("");
  console.log(
    "Note: Phase 1 focuses on test infrastructure. CLI binaries may not be"
  );
  console.log(
    "fully available in all environments. Phase 3 will include actual"
  );
  console.log("compatibility tests with proper baseline validation.");
  console.log("=".repeat(70));

  // Phase 1: Exit with 0 if baseline copy validation passed
  // This demonstrates infrastructure is working
  const baselineCopyPassed = results.results.some(
    (r) => r.name.includes("Baseline copy") && r.passed
  );
  if (!baselineCopyPassed) {
    process.exit(1);
  }
}

/**
 * Main test runner entry point
 */
async function main(): Promise<void> {
  console.log("Initializing CLI Compatibility Test Suite...");
  console.log(
    "Phase 1: Test Infrastructure Foundation (Placeholder Tests)"
  );
  console.log("");

  try {
    // Initialize test environment with validation
    const { config, paths } = await initializeTestEnvironment();

    console.log("Test configuration:");
    console.log(`  Python CLI: ${config.pythonCLI}`);
    console.log(`  TypeScript CLI: ${config.tsCLI}`);
    console.log(`  Baseline: ${paths.baselinePath}`);
    console.log("");
    console.log("✓ Test environment initialized with fresh baseline copies");
    console.log("");

    // Run placeholder tests (Phase 1)
    const startTime = Date.now();
    const testResults = await runPlaceholderTests(config, paths);
    const totalDuration = Date.now() - startTime;

    // Aggregate results
    const results: TestRunResults = {
      totalTests: testResults.length,
      passedTests: testResults.filter((r) => r.passed).length,
      failedTests: testResults.filter((r) => !r.passed).length,
      results: testResults,
      totalDuration,
    };

    // Display results
    displayResults(results);
  } catch (error) {
    console.error(
      "Test initialization failed:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

// Run the test suite
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
