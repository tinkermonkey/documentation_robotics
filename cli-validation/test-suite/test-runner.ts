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
  const errors: string[] = [];

  for (const file of testFiles) {
    try {
      const content = await readFile(file, 'utf-8');
      const suite = YAML.parse(content) as TestSuite;
      suites.push(suite);
      console.log(`Loaded: ${suite.name}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const message = `Failed to load ${file}: ${errorMsg}`;
      console.error(message);
      errors.push(message);
    }
  }

  // Fail fast if any test suites had parse errors
  if (errors.length > 0) {
    throw new Error(
      `${errors.length} test suite(s) failed to load:\n${errors.map((e) => `  - ${e}`).join('\n')}`
    );
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
 * Validate that an incoming IPC message has the correct WorkerResult structure.
 * Guards against malformed messages that could corrupt results or throw at runtime.
 *
 * @throws Error if the message is malformed
 */
function validateWorkerResult(msg: unknown): msg is WorkerResult {
  if (!msg || typeof msg !== 'object') {
    throw new Error('Invalid worker message: not an object');
  }

  const obj = msg as Record<string, unknown>;

  if (typeof obj.workerId !== 'number') {
    throw new Error(`Invalid worker message: workerId must be a number, got ${typeof obj.workerId}`);
  }

  if (!Array.isArray(obj.results)) {
    throw new Error(`Invalid worker message: results must be an array, got ${typeof obj.results}`);
  }

  if (typeof obj.output !== 'string') {
    throw new Error(`Invalid worker message: output must be a string, got ${typeof obj.output}`);
  }

  return true;
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

  // Create a map of suite names to suite definitions for matching results
  const suitesByName = new Map<string, TestSuite>();
  for (const suite of filteredSuites) {
    suitesByName.set(suite.name, suite);
  }

  // Track active workers
  const workers = new Map<number, ChildProcess>();

  // Collect results incrementally as workers report them
  const collectedResults: SuiteResult[] = [];
  let fastFailTriggered = false;

  // Worker timeout: 60 minutes per worker (generous upper bound)
  const WORKER_TIMEOUT = 60 * 60 * 1000;

  // Create a promise that resolves when fast-fail is triggered (via IPC handler)
  let triggerFastFail: () => void;
  const fastFailPromise = new Promise<void>((resolve) => {
    triggerFastFail = resolve;
  });

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

      // Buffer stderr for diagnostic inclusion in error messages
      // Buffer stdout separately for future diagnostic use if needed
      const stderrBuffer: string[] = [];
      const stdoutBuffer: string[] = [];

      if (worker.stdout) {
        worker.stdout.on('data', (data) => {
          stdoutBuffer.push(data.toString());
        });
      }
      if (worker.stderr) {
        worker.stderr.on('data', (data) => {
          stderrBuffer.push(data.toString());
        });
      }

      // Handle messages from worker
      let resultData: WorkerResult | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;
      let settled = false; // Track if promise has been settled to prevent double-settlement

      // Set timeout for this worker
      timeoutHandle = setTimeout(() => {
        if (!resultData) {
          const error = new Error(
            `Worker ${workerId + 1} exceeded timeout of ${WORKER_TIMEOUT}ms with no response`
          );
          console.error(`⚠ ${error.message}`);
          worker.kill();
          if (!settled) {
            settled = true;
            reject(error);
          }
        }
      }, WORKER_TIMEOUT);

      worker.on('message', (msg: unknown) => {
        // Validate message structure at IPC boundary before trusting the data
        try {
          if (!validateWorkerResult(msg)) {
            const error = new Error('Worker message failed validation');
            if (!settled) {
              settled = true;
              reject(error);
            }
            return;
          }
        } catch (validationError) {
          const errorMsg = validationError instanceof Error ? validationError.message : String(validationError);
          console.error(`Worker ${workerId + 1} sent malformed message: ${errorMsg}`);
          if (!settled) {
            settled = true;
            reject(new Error(`Worker ${workerId + 1} sent malformed message: ${errorMsg}`));
          }
          return;
        }

        resultData = msg;

        // Clear timeout on successful message
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        // Display buffered output from worker
        if (msg.output) {
          console.log('\n' + '='.repeat(70));
          console.log(`Worker ${workerId + 1} Output:`);
          console.log('='.repeat(70));
          console.log(msg.output);
          console.log('='.repeat(70));
        }

        // Collect results incrementally as they arrive
        collectedResults.push(...msg.results);

        // Check for failures in fast-fail mode
        if (options.fastFail && msg.results.some((r) => !r.passed)) {
          if (!fastFailTriggered) {
            fastFailTriggered = true;
            // Trigger the fast-fail promise to exit the race immediately
            triggerFastFail!();

            // Signal and kill all other workers to force exit
            for (const [otherId, otherWorker] of workers.entries()) {
              if (otherId !== workerId && otherWorker && !otherWorker.killed) {
                try {
                  otherWorker.send({ type: 'fast-fail' });
                } catch (error) {
                  // Worker may have already exited - this is acceptable during fast-fail
                  const errorMsg = error instanceof Error ? error.message : String(error);
                  console.debug(`Could not signal worker ${otherId} to stop: ${errorMsg}`);
                }
                // Kill the worker immediately to force exit
                try {
                  otherWorker.kill();
                } catch (error) {
                  const errorMsg = error instanceof Error ? error.message : String(error);
                  console.debug(`Could not kill worker ${otherId}: ${errorMsg}`);
                }
              }
            }
          }
        }

        if (!settled) {
          settled = true;
          resolve(msg.results);
        }
      });

      worker.on('error', (error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        // Always log worker errors, even during fast-fail
        // This ensures independent worker crashes are not silently swallowed
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`Worker ${workerId + 1} error:`, errorMsg);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      worker.on('exit', (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        // If no result data was received from the worker, resolve or reject based on exit code
        if (!resultData && !settled) {
          // Guard against null code (can happen when worker is killed)
          if (code !== null && code !== 0) {
            settled = true;
            // Include buffered stderr in error message for diagnostics
            const stderrOutput = stderrBuffer.length > 0 ? stderrBuffer.join('') : '';
            const errorMessage = stderrOutput
              ? `Worker ${workerId + 1} exited with code ${code}\nStderr:\n${stderrOutput}`
              : `Worker ${workerId + 1} exited with code ${code}`;
            reject(new Error(errorMessage));
          } else {
            // Graceful exit with no data (resolved or no meaningful result)
            settled = true;
            resolve([]);
          }
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

  // Wait for all workers to complete, but exit early if fast-fail is triggered
  // Race between all workers completing normally and fast-fail being triggered

  // Attach catch handlers to each workerPromise to prevent unhandled promise rejections
  // when fast-fail triggers and kills workers (their promises will reject with non-zero exit codes).
  // Only swallow errors if fast-fail was triggered; otherwise propagate them.
  const safeWorkerPromises = workerPromises.map((p) =>
    p.catch((err) => {
      if (fastFailTriggered) {
        // During fast-fail, log crashes but don't propagate the error
        console.error(
          `Worker crashed during fast-fail: ${err instanceof Error ? err.message : String(err)}`
        );
        return [];
      }
      // If fast-fail was not triggered, this is a real error - propagate it
      throw err;
    })
  );

  try {
    await Promise.race([
      Promise.all(safeWorkerPromises),
      fastFailPromise,
    ]);
  } catch (error) {
    // If fast-fail was triggered, we catch it here and use collected results
    // If a real error occurred, re-throw it
    if (!fastFailTriggered) {
      throw error;
    }
  }

  // Use the results we've collected incrementally (from worker messages)
  // Don't re-await promises or call allSettled - just return what we have
  const results: SuiteResult[] = collectedResults;

  // Validate that all scheduled suites produced results (or fast-fail was triggered)
  if (results.length !== filteredSuites.length && !fastFailTriggered) {
    const scheduledNames = new Set(filteredSuites.map((s) => s.name));
    const resultNames = new Set(results.map((r) => r.name));
    const missingNames = Array.from(scheduledNames).filter((name) => !resultNames.has(name));
    throw new Error(
      `Result count mismatch: scheduled ${filteredSuites.length} suites, got ${results.length} results. ` +
      `Missing suites: ${missingNames.join(', ')}`
    );
  }

  // Report results with proper start/complete lifecycle
  for (const result of results) {
    // Find the original suite definition to get complete metadata
    const originalSuite = suitesByName.get(result.name);
    if (!originalSuite) {
      throw new Error(`Result returned for unknown suite: ${result.name}`);
    }

    // Call onSuiteStart to initialize reporter state
    reporter.onSuiteStart(originalSuite);

    // Call onSuiteComplete with original suite metadata
    reporter.onSuiteComplete(originalSuite, result);
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

    // Determine test case directory
    const testCaseDir = join(process.cwd(), 'test-cases');

    // Load test suites
    console.log('Loading test cases...');
    let testSuites = await loadTestSuites(testCaseDir);
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
        testCaseDir,
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

    // Note: Worker baseline copies are expected to be modified by tests
    // The isolation check above (validateBaselineIntegrity) ensures that tests
    // do not escape their isolation and contaminate the original baseline directory.
    // Individual worker copies may have their model files reorganized and updated,
    // which is expected behavior when the CLI loads and saves the model.
    if (!baselineContaminated) {
      console.log('✓ Worker isolation verified - original baseline not contaminated');
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
    if (errorStack) {
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
