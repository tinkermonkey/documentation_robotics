/**
 * Test Suite Execution Engine
 *
 * Loads YAML test cases, distributes them across workers via scheduler,
 * executes pipelines against the TypeScript CLI, compares filesystem state,
 * and generates reports. Each worker has its own isolated baseline copy.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { glob } from 'glob';
import { fork, type ChildProcess } from 'node:child_process';
import YAML from 'yaml';

import { initializeMultiWorkerTestEnvironment, cleanupMultiWorkerTestArtifacts, validateBaselineIntegrity, BaselineContaminationError } from './setup.js';
import {
  TestSuite,
  SuiteResult,
  TestRunSummary,
} from './pipeline.js';
import { ConsoleReporter } from './reporters/console-reporter.js';
import { JUnitReporter } from './reporters/junit-reporter.js';
import { Reporter } from './reporters/reporter.js';
import { parseRunnerArgs, RunnerOptions, matchesFilters } from './runner-config.js';
import { scheduleSuites } from './scheduler.js';
import { TestRunnerConfig, WorkerResult } from './types.js';

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
 * Execute test suites using worker processes
 * Returns collected results from all workers and handles fast-fail signaling
 */
async function executeWithWorkers(
  filteredSuites: TestSuite[],
  workerCount: number,
  testConfig: TestRunnerConfig,
  reporter: Reporter,
  options: RunnerOptions,
  tsPaths: string[]
): Promise<SuiteResult[]> {
  // Schedule suites across workers
  const schedule = scheduleSuites(filteredSuites, workerCount);

  // Track active workers
  const workers = new Map<number, ChildProcess>();
  let shouldStopAllWorkers = false;

  // Create worker processes
  const workerPromises: Promise<SuiteResult[]>[] = [];

  for (let workerId = 0; workerId < workerCount; workerId++) {
    const suites = schedule.get(workerId) || [];

    const promise = new Promise<SuiteResult[]>((resolve, reject) => {
      // Fork worker process
      // Use the TypeScript file directly - runner is executed from test-suite directory
      const worker = fork('./worker.ts', [], {
        silent: true, // Capture stdout/stderr
        execArgv: ['--import', 'tsx'], // Use tsx to run TypeScript
      });

      workers.set(workerId, worker);

      // Handle messages from worker
      let resultData: WorkerResult | null = null;

      worker.on('message', (msg: WorkerResult) => {
        resultData = msg;

        // Display buffered output from worker
        if (msg.output) {
          console.log('\n' + '='.repeat(70));
          console.log(`Worker ${workerId + 1} Output:`);
          console.log('='.repeat(70));
          console.log(msg.output);
          console.log('='.repeat(70));
        }

        // Check for failures in fast-fail mode
        if (options.fastFail && msg.results.some((r) => !r.passed)) {
          shouldStopAllWorkers = true;
          // Signal all other workers to stop
          for (const [otherId, otherWorker] of workers.entries()) {
            if (otherId !== workerId && otherWorker) {
              otherWorker.send({ type: 'fast-fail' });
            }
          }
        }

        resolve(msg.results);
      });

      worker.on('error', (error) => {
        console.error(`Worker ${workerId + 1} error:`, error);
        reject(error);
      });

      worker.on('exit', (code) => {
        if (code !== 0 && !resultData) {
          reject(new Error(`Worker ${workerId + 1} exited with code ${code}`));
        }
      });

      // Send assignment to worker
      worker.send({
        suites,
        config: {
          tsCLI: testConfig.tsCLI,
          tsDir: join(tsPaths[workerId], MODEL_DIR),
          testCaseDir: testConfig.testCaseDir,
        },
        workdirPath: tsPaths[workerId],
        workerId,
      });
    });

    workerPromises.push(promise);
  }

  // Wait for all workers to complete
  const allResults = await Promise.all(workerPromises);

  // Flatten results
  const results: SuiteResult[] = allResults.flat();

  // Report results
  for (const result of results) {
    reporter.onSuiteComplete(
      {
        name: result.name,
        description: '',
        priority: result.priority,
        pipelines: [],
      },
      result
    );
  }

  return results;
}

/**
 * Create appropriate reporter instance based on options
 */
function createReporter(options: RunnerOptions): Reporter {
  switch (options.reporter) {
    case 'junit':
      return new JUnitReporter();
    case 'console':
    default:
      return new ConsoleReporter(options.verbose);
  }
}

/**
 * Main test runner entry point
 */
async function runTestSuite(): Promise<void> {
  // Parse command-line arguments
  const options = parseRunnerArgs();

  console.log('='.repeat(70));
  console.log('CLI Compatibility Test Suite - Test Pipeline Execution');
  console.log('='.repeat(70));

  // Print configuration
  console.log(`Reporter: ${options.reporter}`);
  if (options.fastFail) console.log('Fast-fail mode: enabled');
  if (options.verbose) console.log('Verbose output: enabled');
  if (options.priority) console.log(`Priority filter: ${options.priority}`);
  if (options.testCase) console.log(`Test case filter: ${options.testCase}`);
  console.log('');

  let cleanupPaths;
  try {
    // Initialize test environment with multiple workers
    console.log(`Initializing test environment with ${options.workers} worker(s)...`);
    const { config, paths, primaryTsPath } = await initializeMultiWorkerTestEnvironment(options.workers);
    console.log(`✓ Test environment initialized (${paths.tsPaths.length} baseline copies created)`);
    console.log('');

    // Store paths for cleanup in error handler
    cleanupPaths = paths;

    // Create test runner config using the primary (first) worker
    const testConfig: TestRunnerConfig = {
      tsCLI: config.tsCLI,
      tsDir: join(primaryTsPath, MODEL_DIR),
      testCaseDir: join(process.cwd(), 'test-cases'),
    };

    // Load test suites
    console.log('Loading test cases...');
    let testSuites = await loadTestSuites(testConfig.testCaseDir);
    console.log(`✓ Loaded ${testSuites.length} test suites`);

    // Apply filters
    testSuites = testSuites.filter((suite) =>
      matchesFilters(suite.name, suite.priority, options)
    );
    console.log(`✓ Filtered to ${testSuites.length} test suites`);
    console.log('');

    if (testSuites.length === 0) {
      console.log('No test cases matched your filters.');
      process.exit(0);
    }

    // Create reporter instance
    const reporter = createReporter(options);

    // Execute test suites using workers
    const startTime = Date.now();
    console.log(`Scheduling ${testSuites.length} suite(s) across ${options.workers} worker(s)...`);
    console.log('');

    const results = await executeWithWorkers(
      testSuites,
      options.workers,
      {
        tsCLI: config.tsCLI,
        tsDir: '', // Not used with workers (each worker gets its own)
        testCaseDir: testConfig.testCaseDir,
      },
      reporter,
      options,
      cleanupPaths.tsPaths
    );

    // Generate summary
    const summary = generateSummary(results);
    summary.totalDuration = Date.now() - startTime;

    // Generate report using reporter
    const report = reporter.generateReport(summary);

    // Output report
    if (options.outputFile) {
      // Write to file
      await mkdir(dirname(options.outputFile), { recursive: true });
      await writeFile(options.outputFile, report, 'utf-8');
      console.log(`\n✓ Report written to: ${options.outputFile}`);
    } else {
      // Write to stdout
      console.log(report);
    }

    // Always write JUnit report to file for CI/CD integration
    if (options.reporter !== 'junit') {
      const junitReporter = new JUnitReporter();
      const junitReport = junitReporter.generateReport(summary);
      const junitPath = join(process.cwd(), 'results', 'junit.xml');
      await mkdir(dirname(junitPath), { recursive: true });
      await writeFile(junitPath, junitReport, 'utf-8');
      console.log(`✓ JUnit report written to: ${junitPath}`);
    }

    // Post-test cleanup and validation
    console.log('\n' + '='.repeat(70));
    console.log('Post-test cleanup and validation...');

    // Validate baseline integrity before cleanup
    // This must run BEFORE cleanupMultiWorkerTestArtifacts to detect contamination,
    // as cleanup uses git checkout to restore the baseline
    let baselineContaminated = false;
    try {
      await validateBaselineIntegrity(cleanupPaths.baselinePath);
      console.log('✓ Baseline integrity verified - no contamination detected');
    } catch (error) {
      if (error instanceof BaselineContaminationError) {
        // Contamination is a test failure - uncommitted baseline changes indicate test isolation issues
        baselineContaminated = true;
        console.error('⚠ Baseline contamination detected:');
        console.error(`   ${error.message}`);
      } else {
        // Git infrastructure failures (repo not found, git not installed, etc.) are diagnostic warnings
        // These are environmental issues, not test isolation failures, so don't fail the run
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('⚠ Could not validate baseline integrity (may indicate missing git or workspace issue):');
        console.error(`   ${errorMsg}`);
      }
    }

    // Clean up test artifacts
    let cleanupFailed = false;
    try {
      const cleanupResult = await cleanupMultiWorkerTestArtifacts(cleanupPaths);
      console.log('✓ Test artifacts cleaned up');

      // Warn if baseline restore failed, but don't fail the run
      if (!cleanupResult.baselineRestoreSuccess) {
        console.error('⚠ Baseline restoration failed during cleanup (may require manual git checkout):');
        for (const error of cleanupResult.errors) {
          console.error(`   - ${error}`);
        }
      }
    } catch (error) {
      cleanupFailed = true;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('⚠ Cleanup failed:');
      console.error(`   ${errorMsg}`);
    }

    // Exit with failure if baseline was contaminated or cleanup failed
    if (baselineContaminated || cleanupFailed) {
      process.exit(1);
    }

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

    // Attempt cleanup even on test failure
    try {
      if (cleanupPaths) {
        const cleanupResult = await cleanupMultiWorkerTestArtifacts(cleanupPaths);
        if (!cleanupResult.baselineRestoreSuccess) {
          console.error(
            '⚠ Baseline restoration failed during cleanup (may require manual git checkout)'
          );
          for (const error of cleanupResult.errors) {
            console.error(`   - ${error}`);
          }
        }
      }
    } catch (cleanupError) {
      console.error(
        `⚠ Failed to cleanup after test failure: ${String(cleanupError)}`
      );
    }

    process.exit(1);
  }
}

// Run the test suite
runTestSuite().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
