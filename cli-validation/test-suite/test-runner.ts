/**
 * Main Test Pipeline Orchestrator
 *
 * Loads YAML test cases, executes pipelines against the TypeScript CLI,
 * compares filesystem state, and generates reports.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { glob } from 'glob';
import YAML from 'yaml';

import { initializeTestEnvironment, TestPaths, CLIConfig } from './setup';
import { captureSnapshot, compareSnapshots, formatComparisonResult } from './comparator';
import { executeCommand, CommandOutput } from './executor';
import {
  TestSuite,
  Pipeline,
  PipelineStep,
  StepResult,
  PipelineResult,
  SuiteResult,
  TestRunSummary,
} from './pipeline';
import { formatConsoleReport } from './reporters/console-reporter';
import { formatJunitReport } from './reporters/junit-reporter';

/**
 * Main test runner configuration
 */
interface TestRunnerConfig {
  tsCLI: string;
  tsDir: string;
  testCaseDir: string;
}

/**
 * Path to model directory within baseline (for easier updates if structure changes)
 */
const MODEL_DIR = 'documentation-robotics/model';

/**
 * Load all test suites from YAML files
 */
async function loadTestSuites(testCaseDir: string): Promise<TestSuite[]> {
  const testFiles = await glob(join(testCaseDir, '*.yaml'));

  if (testFiles.length === 0) {
    console.warn(`No test case files found in ${testCaseDir}`);
    return [];
  }

  const suites: TestSuite[] = [];

  for (const file of testFiles) {
    try {
      const content = await readFile(file, 'utf-8');
      const suite = YAML.parse(content) as TestSuite;
      suites.push(suite);
      console.log(`Loaded: ${suite.name}`);
    } catch (error) {
      console.error(`Failed to load ${file}: ${error}`);
    }
  }

  return suites;
}

/**
 * Validate a single step's expectations
 * Validates exit codes, output content, and filesystem changes
 */
function validateStep(
  step: PipelineStep,
  tsOutput: CommandOutput,
  tsChanges: Array<{ path: string; type: string }>
): StepResult {
  const failures: string[] = [];

  // Validate exit codes
  const expectedExitCode = step.expect_exit_code ?? 0;
  if (tsOutput.exitCode !== expectedExitCode) {
    failures.push(
      `CLI exit code: expected ${expectedExitCode}, got ${tsOutput.exitCode}`
    );
  }

  // Validate stdout contains
  if (step.expect_stdout_contains) {
    for (const expected of step.expect_stdout_contains) {
      if (!tsOutput.stdout.includes(expected)) {
        failures.push(`stdout missing: "${expected}"`);
      }
    }
  }

  // Validate stderr contains
  if (step.expect_stderr_contains) {
    for (const expected of step.expect_stderr_contains) {
      if (!tsOutput.stderr.includes(expected)) {
        failures.push(`stderr missing: "${expected}"`);
      }
    }
  }

  // Validate filesystem changes match expected files
  for (const expectedFile of step.files_to_compare) {
    const tsModified = tsChanges.some(
      (c) => c.path === expectedFile && c.type !== 'unchanged'
    );

    if (!tsModified) {
      failures.push(`Did not modify expected file: ${expectedFile}`);
    }
  }

  // Map filesystem changes to proper types
  const typedChanges = tsChanges.map((c) => ({
    path: c.path,
    type: c.type === 'added' || c.type === 'deleted' || c.type === 'modified'
      ? c.type as 'added' | 'deleted' | 'modified'
      : 'modified' as const,
  }));

  return {
    command: step.command,
    pythonOutput: {
      stdout: '',
      stderr: '',
      exitCode: 0,
      duration: 0,
    },
    tsOutput,
    filesystemDiff: {
      python: [],
      ts: typedChanges,
    },
    passed: failures.length === 0,
    failures,
  };
}

/**
 * Execute a single pipeline
 */
async function executePipeline(
  pipeline: Pipeline,
  config: TestRunnerConfig
): Promise<PipelineResult> {
  const stepResults: StepResult[] = [];
  const startTime = Date.now();

  for (const step of pipeline.steps) {
    console.log(`    Step: ${step.command}`);

    // Capture before snapshot
    const tsBefore = await captureSnapshot(config.tsDir);

    // Execute command on TypeScript CLI
    const timeout = step.timeout ?? 30000;
    const tsOutput = await executeCommand(
      `${config.tsCLI} ${step.command}`,
      config.tsDir,
      timeout
    );

    // Capture after snapshot
    const tsAfter = await captureSnapshot(config.tsDir);

    // Compare filesystem changes
    const tsResult = compareSnapshots(tsBefore, tsAfter);

    // Validate results
    const result = validateStep(
      step,
      tsOutput,
      tsResult.changes.map((c) => ({ path: c.path, type: c.type }))
    );

    stepResults.push(result);

    if (!result.passed) {
      console.error(`      ✗ FAILED`);
      for (const failure of result.failures) {
        console.error(`        - ${failure}`);
      }
      // Stop pipeline on first failure
      break;
    } else {
      console.log(`      ✓ PASSED`);
    }
  }

  const totalDuration = Date.now() - startTime;

  return {
    name: pipeline.name,
    passed: stepResults.every((s) => s.passed),
    steps: stepResults,
    totalDuration,
  };
}

/**
 * Execute a single test suite
 */
async function executeSuite(
  suite: TestSuite,
  config: TestRunnerConfig
): Promise<SuiteResult> {
  console.log(`\nRunning suite: ${suite.name} [${suite.priority}]`);

  const pipelineResults: PipelineResult[] = [];
  const startTime = Date.now();

  for (const pipeline of suite.pipelines) {
    console.log(`  Pipeline: ${pipeline.name}`);
    pipelineResults.push(await executePipeline(pipeline, config));
  }

  const totalDuration = Date.now() - startTime;

  return {
    name: suite.name,
    priority: suite.priority,
    passed: pipelineResults.every((p) => p.passed),
    pipelines: pipelineResults,
    totalDuration,
  };
}

/**
 * Generate summary statistics
 */
function generateSummary(results: SuiteResult[]): TestRunSummary {
  let totalPipelines = 0;
  let passedPipelines = 0;
  let totalSteps = 0;
  let passedSteps = 0;
  let totalDuration = 0;

  for (const suite of results) {
    for (const pipeline of suite.pipelines) {
      totalPipelines++;
      if (pipeline.passed) passedPipelines++;

      totalSteps += pipeline.steps.length;
      passedSteps += pipeline.steps.filter((s) => s.passed).length;

      totalDuration += pipeline.totalDuration;
    }
  }

  return {
    totalSuites: results.length,
    passedSuites: results.filter((r) => r.passed).length,
    failedSuites: results.filter((r) => !r.passed).length,
    totalPipelines,
    passedPipelines,
    failedPipelines: totalPipelines - passedPipelines,
    totalSteps,
    passedSteps,
    failedSteps: totalSteps - passedSteps,
    totalDuration,
    results,
  };
}

/**
 * Main test runner entry point
 */
async function runTestSuite(): Promise<void> {
  console.log('='.repeat(70));
  console.log('CLI Compatibility Test Suite - Test Pipeline Execution');
  console.log('='.repeat(70));
  console.log('');

  try {
    // Initialize test environment
    console.log('Initializing test environment...');
    const { config, paths } = await initializeTestEnvironment();
    console.log('✓ Test environment initialized');
    console.log('');

    // Create test runner config
    const testConfig: TestRunnerConfig = {
      tsCLI: config.tsCLI,
      tsDir: join(paths.tsPath, MODEL_DIR),
      testCaseDir: join(process.cwd(), 'test-cases'),
    };

    // Load test suites
    console.log('Loading test cases...');
    const testSuites = await loadTestSuites(testConfig.testCaseDir);
    console.log(`✓ Loaded ${testSuites.length} test suites`);
    console.log('');

    if (testSuites.length === 0) {
      console.log('No test cases found. Test infrastructure is ready.');
      console.log('Please add test case YAML files to test-cases/ directory.');
      process.exit(0);
    }

    // Execute test suites
    const startTime = Date.now();
    const results: SuiteResult[] = [];

    for (const suite of testSuites) {
      results.push(await executeSuite(suite, testConfig));
    }

    // Generate summary
    const summary = generateSummary(results);
    summary.totalDuration = Date.now() - startTime;

    // Display results
    console.log('');
    console.log('='.repeat(70));
    console.log(formatConsoleReport(summary));
    console.log('='.repeat(70));

    // Write JUnit report to file for CI/CD integration
    const junitReport = formatJunitReport(summary);
    const junitPath = join(process.cwd(), 'test-results', 'junit.xml');
    await mkdir(dirname(junitPath), { recursive: true });
    await writeFile(junitPath, junitReport, 'utf-8');
    console.log(`\n✓ JUnit report written to: ${junitPath}`);

    // Exit with appropriate code
    process.exit(summary.failedSuites > 0 ? 1 : 0);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('\n❌ Test suite failed:');
    console.error(`   ${errorMsg}`);
    if (errorStack && process.env.DEBUG) {
      console.error(`\nStack trace:\n${errorStack}`);
    }
    process.exit(1);
  }
}

// Run the test suite
runTestSuite().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
