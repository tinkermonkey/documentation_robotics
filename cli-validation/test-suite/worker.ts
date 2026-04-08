/**
 * Worker Process for Parallel Test Execution
 *
 * Receives test suite assignments via IPC, executes them sequentially,
 * and returns results. Each worker has its own isolated baseline copy.
 */

import { TestSuite, SuiteResult } from './pipeline.js';
import { captureSnapshot, captureTargetedSnapshot, compareSnapshots } from './comparator.js';
import { executeCommand, CommandOutput } from './executor.js';
import {
  PipelineStep,
  Pipeline,
  StepResult,
  PipelineResult,
} from './pipeline.js';
import { join } from 'node:path';
import { TestRunnerConfig, WorkerAssignment, WorkerResult } from './types.js';

/**
 * Output buffer for capturing console output during suite execution
 */
class OutputBuffer {
  private lines: string[] = [];

  write(text: string): void {
    this.lines.push(text);
  }

  writeLine(text: string = ''): void {
    this.lines.push(text);
  }

  getOutput(): string {
    return this.lines.join('\n');
  }

  clear(): void {
    this.lines = [];
  }
}

/**
 * Validate a single step's expectations
 * Validates exit codes, output content, and filesystem changes
 */
export function validateStep(
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
 * Determine which snapshot mode to use based on step configuration
 *
 * Mode 1 (Targeted): Non-empty files_to_compare → read only specified files
 * Mode 2 (Skip): Empty/no files_to_compare with only stdout/stderr assertions → no snapshots
 * Mode 3 (Full): All other cases → full directory walk (safety net)
 */
export function getSnapshotMode(step: PipelineStep): 'targeted' | 'skip' | 'full' {
  // Mode 1: Non-empty files_to_compare
  if (step.files_to_compare && step.files_to_compare.length > 0) {
    return 'targeted';
  }

  // Mode 2: Empty/no files_to_compare with non-empty stdout/stderr assertions
  // (empty assertion arrays are treated as no assertions)
  const hasStdoutAssertions = (step.expect_stdout_contains?.length ?? 0) > 0;
  const hasStderrAssertions = (step.expect_stderr_contains?.length ?? 0) > 0;
  if (
    (!step.files_to_compare || step.files_to_compare.length === 0) &&
    (hasStdoutAssertions || hasStderrAssertions)
  ) {
    return 'skip';
  }

  // Mode 3: Full walk (default for everything else)
  return 'full';
}

/**
 * Execute a single pipeline
 * @param workdirPath - Project root directory where CLI should execute
 */
async function executePipeline(
  pipeline: Pipeline,
  config: TestRunnerConfig,
  output: OutputBuffer,
  shouldStop: () => boolean,
  workdirPath: string
): Promise<PipelineResult | null> {
  const stepResults: StepResult[] = [];
  const startTime = Date.now();

  for (const step of pipeline.steps) {
    output.writeLine(`    Step: ${step.command}`);

    // Check if we should stop (fast-fail signal received)
    if (shouldStop()) {
      output.writeLine('    (stopped due to fast-fail)');
      return null; // Return null to signal early termination
    }

    // Determine snapshot mode for this step
    const snapshotMode = getSnapshotMode(step);

    // Determine snapshot root and actual file paths to capture
    // Export files (export-*.json, export-*.xml, export-*.puml, export-*.md, export-*.graphml)
    // are created at the project root (workdirPath), not in the model directory
    let snapshotRoot = config.tsDir;
    let snapshotFilePaths = step.files_to_compare;

    if (snapshotMode === 'targeted') {
      // Check if any files are export files (at project root level)
      const hasExportFiles = step.files_to_compare.some(f => f.startsWith('export-'));

      if (hasExportFiles) {
        // Capture from project root for export files
        snapshotRoot = workdirPath;
        // Keep file paths as-is since they're already at project root level
        snapshotFilePaths = step.files_to_compare;
      }
    }

    // Capture before snapshot (skip mode: no snapshot needed)
    const tsBefore =
      snapshotMode === 'skip'
        ? { timestamp: Date.now(), directory: snapshotRoot, files: new Map() }
        : snapshotMode === 'targeted'
          ? await captureTargetedSnapshot(snapshotRoot, snapshotFilePaths)
          : await captureSnapshot(snapshotRoot);

    // Execute command on TypeScript CLI from the project root (not model directory)
    // The CLI expects to be run from the directory containing documentation-robotics/model
    const timeout = step.timeout ?? 30000;
    const tsOutput = await executeCommand(
      `${config.tsCLI} ${step.command}`,
      workdirPath,
      timeout
    );

    // Capture after snapshot (skip mode: no snapshot needed)
    const tsAfter =
      snapshotMode === 'skip'
        ? { timestamp: Date.now(), directory: snapshotRoot, files: new Map() }
        : snapshotMode === 'targeted'
          ? await captureTargetedSnapshot(snapshotRoot, snapshotFilePaths)
          : await captureSnapshot(snapshotRoot);

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
      output.writeLine(`      ✗ FAILED`);
      for (const failure of result.failures) {
        output.writeLine(`        - ${failure}`);
      }
      // Stop pipeline on first failure
      break;
    } else {
      output.writeLine(`      ✓ PASSED`);
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
 * @param workdirPath - Project root directory where CLI should execute
 */
async function executeSuite(
  suite: TestSuite,
  config: TestRunnerConfig,
  output: OutputBuffer,
  shouldStop: () => boolean,
  workdirPath: string
): Promise<SuiteResult | null> {
  output.writeLine(`\nRunning suite: ${suite.name} [${suite.priority}]`);

  const pipelineResults: PipelineResult[] = [];
  const startTime = Date.now();

  for (const pipeline of suite.pipelines) {
    output.writeLine(`  Pipeline: ${pipeline.name}`);

    // Check if we should stop (fast-fail signal received)
    if (shouldStop()) {
      output.writeLine('  (stopped due to fast-fail)');
      break;
    }

    const pipelineResult = await executePipeline(pipeline, config, output, shouldStop, workdirPath);

    // If executePipeline returned null (early termination), don't include in results
    if (pipelineResult !== null) {
      pipelineResults.push(pipelineResult);
    } else {
      // Early termination due to fast-fail
      break;
    }
  }

  const totalDuration = Date.now() - startTime;

  // If we were stopped and have no results, return null to signal early termination
  if (shouldStop() && pipelineResults.length === 0) {
    return null;
  }

  return {
    name: suite.name,
    priority: suite.priority,
    passed: pipelineResults.every((p) => p.passed),
    pipelines: pipelineResults,
    totalDuration,
  };
}

/**
 * Main worker process
 * Receives assignment via IPC, executes suites, returns results
 */
async function runWorker(): Promise<void> {
  const output = new OutputBuffer();
  let shouldStopFlag = false;
  let assignmentReceived = false;
  let messageHandler: ((msg: unknown) => void) | null = null;

  // Wait for assignment from parent using a single message handler with state machine
  const assignment = await new Promise<WorkerAssignment>((resolve, reject) => {
    // Timeout to prevent indefinite hanging if parent doesn't send assignment
    const assignmentTimeout = setTimeout(() => {
      if (!assignmentReceived) {
        if (messageHandler) {
          process.removeListener('message', messageHandler);
        }
        reject(new Error('Timeout waiting for worker assignment (30s)'));
      }
    }, 30000);

    // Handle parent process disconnect
    const disconnectHandler = () => {
      if (!assignmentReceived) {
        clearTimeout(assignmentTimeout);
        if (messageHandler) {
          process.removeListener('message', messageHandler);
        }
        reject(new Error('Parent process disconnected before sending assignment'));
      }
    };

    messageHandler = (msg: unknown) => {
      // Type narrowing: check if this is a valid object with a type property
      if (typeof msg !== 'object' || msg === null) {
        console.error(
          `[Worker] Received malformed IPC message (non-object): ${typeof msg}`
        );
        return; // Ignore non-object messages
      }

      const message = msg as Record<string, unknown>;

      // If we haven't received assignment yet, check if this is it
      if (!assignmentReceived) {
        // Check if this looks like an assignment (has required fields)
        if (
          'suites' in message &&
          'config' in message &&
          'workdirPath' in message &&
          'workerId' in message
        ) {
          assignmentReceived = true;
          // Clear the assignment timeout now that we've received the assignment
          clearTimeout(assignmentTimeout);
          // Remove the disconnect handler since we now have the assignment
          process.removeListener('disconnect', disconnectHandler);
          // Resolve with the assignment (handler stays registered to listen for fast-fail)
          resolve(message as unknown as WorkerAssignment);
          return;
        }
        // If it's a fast-fail before assignment, ignore it (shouldn't happen)
        if (message.type === 'fast-fail') {
          return;
        }
        // Log malformed messages that don't match assignment structure
        console.error(
          `[Worker] Received malformed IPC message before assignment: ${JSON.stringify(Object.keys(message))}`
        );
        return;
      }

      // After assignment is received, handle fast-fail signals
      if (assignmentReceived && message.type === 'fast-fail') {
        shouldStopFlag = true;
        output.writeLine('\n[Worker] Received fast-fail signal');
      }
    };

    process.on('message', messageHandler);
    process.on('disconnect', disconnectHandler);
  });

  try {
    const { suites, config, workdirPath, workerId } = assignment;

    output.writeLine(`Worker ${workerId + 1} starting execution of ${suites.length} suite(s)`);
    output.writeLine('');

    const results: SuiteResult[] = [];

    for (const suite of suites) {
      // Check if we should stop
      if (shouldStopFlag) {
        output.writeLine(`\nWorker ${workerId + 1} stopping due to fast-fail signal`);
        break;
      }

      const suiteResult = await executeSuite(suite, config, output, () => shouldStopFlag, workdirPath);

      // If suite returned null (early termination), don't include in results
      if (suiteResult !== null) {
        results.push(suiteResult);
      } else if (shouldStopFlag) {
        // Early termination due to fast-fail
        break;
      }
    }

    output.writeLine(`\nWorker ${workerId + 1} completed (${results.length} suite(s) executed)`);

    // Send results back to parent
    if (!process.send) {
      const errorMsg =
        'IPC channel unavailable: unable to send results back to parent process';
      console.error(`[Worker] ${errorMsg}`);
      output.writeLine(`\n[Worker] ERROR: ${errorMsg}`);
      process.exit(1);
    }

    process.send({
      workerId,
      results,
      output: output.getOutput(),
    } as WorkerResult);

    // Clean up message handler and disconnect from parent to allow process to exit
    if (messageHandler) {
      process.removeListener('message', messageHandler);
    }
    process.disconnect();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    output.writeLine(`\nWorker error: ${errorMsg}`);
    if (error instanceof Error && process.env.DEBUG) {
      output.writeLine(`Stack trace: ${error.stack}`);
    }

    // Send error result with actual workerId from assignment (or -1 if assignment failed)
    const errorWorkerId = assignment ? assignment.workerId : -1;

    if (!process.send) {
      const sendError = 'IPC channel unavailable: unable to send error to parent process';
      console.error(`[Worker] ${sendError}`);
      output.writeLine(`\n[Worker] ERROR: ${sendError}`);
      process.exit(1);
    }

    process.send({
      workerId: errorWorkerId,
      results: [],
      output: output.getOutput(),
    } as WorkerResult);

    // Clean up message handler and disconnect from parent to allow process to exit
    if (messageHandler) {
      process.removeListener('message', messageHandler);
    }
    process.disconnect();
    process.exit(1);
  }
}

// Start the worker
runWorker().catch((error) => {
  console.error('Fatal worker error:', error);
  process.exit(1);
});
