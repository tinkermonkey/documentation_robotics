/**
 * Worker Process for Parallel Test Execution
 *
 * Receives test suite assignments via IPC, executes them sequentially,
 * and returns results. Each worker has its own isolated baseline copy.
 */

import { TestSuite, SuiteResult } from './pipeline.js';
import {
  captureSnapshot,
  captureTargetedSnapshot,
  compareSnapshots,
  FilesystemSnapshot,
  FileChange,
} from './comparator.js';
import { executeCommand, CommandOutput } from './executor.js';
import {
  PipelineStep,
  Pipeline,
  StepResult,
  PipelineResult,
} from './pipeline.js';
import { join } from 'node:path';
import { TestRunnerConfig, WorkerAssignment, WorkerResult, WorkerMessage } from './types.js';

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

  // Map filesystem changes to proper types with validation
  const typedChanges = tsChanges.map((c) => {
    const validTypes = ['added', 'deleted', 'modified', 'unchanged'];
    if (!validTypes.includes(c.type)) {
      console.warn(
        `[validateStep] Unknown filesystem change type "${c.type}" for file "${c.path}", coercing to "modified"`
      );
    }

    return {
      path: c.path,
      type:
        c.type === 'added' || c.type === 'deleted' || c.type === 'modified'
          ? (c.type as 'added' | 'deleted' | 'modified')
          : ('modified' as const),
    };
  });

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
 * Capture targeted snapshot handling files from multiple roots
 *
 * Export files (starting with 'export-') are captured from workdirPath,
 * while model files are captured from modelDir. Snapshots are merged
 * into a single result.
 */
async function captureTargetedSnapshotWithMixedRoots(
  files: string[],
  modelDir: string,
  workdirPath: string
): Promise<FilesystemSnapshot> {
  const exportFiles = files.filter((f) => f.startsWith('export-'));
  const modelFiles = files.filter((f) => !f.startsWith('export-'));

  // Capture from both roots in parallel
  const [modelSnapshot, exportSnapshot] = await Promise.all([
    modelFiles.length > 0
      ? captureTargetedSnapshot(modelDir, modelFiles)
      : Promise.resolve({ timestamp: Date.now(), directory: modelDir, files: new Map() }),
    exportFiles.length > 0
      ? captureTargetedSnapshot(workdirPath, exportFiles)
      : Promise.resolve({ timestamp: Date.now(), directory: workdirPath, files: new Map() }),
  ]);

  // Merge files from both snapshots
  const mergedFiles = new Map(modelSnapshot.files);
  for (const [path, info] of exportSnapshot.files) {
    mergedFiles.set(path, info);
  }

  // Return merged snapshot (use model dir as primary directory)
  return {
    timestamp: modelSnapshot.timestamp,
    directory: modelDir,
    files: mergedFiles,
  };
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

    // Determine snapshot root for full captures
    // For targeted captures with mixed export/model files, the helper handles both roots
    const snapshotRoot = config.tsDir;

    // Capture before snapshot (skip mode: no snapshot needed)
    const tsBefore =
      snapshotMode === 'skip'
        ? { timestamp: Date.now(), directory: snapshotRoot, files: new Map() }
        : snapshotMode === 'targeted'
          ? await captureTargetedSnapshotWithMixedRoots(
              step.files_to_compare,
              snapshotRoot,
              workdirPath
            )
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
          ? await captureTargetedSnapshotWithMixedRoots(
              step.files_to_compare,
              snapshotRoot,
              workdirPath
            )
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
  let disconnectHandler: (() => void) | null = null;

  /**
   * Clean up message handler and safely disconnect from parent
   */
  function cleanup(): void {
    if (messageHandler) {
      process.removeListener('message', messageHandler);
      messageHandler = null;
    }
    if (disconnectHandler) {
      process.removeListener('disconnect', disconnectHandler);
      disconnectHandler = null;
    }
    if (process.connected) {
      process.disconnect();
    }
  }

  // Wait for assignment from parent using a single message handler with state machine
  const assignment = await new Promise<WorkerAssignment>((resolve, reject) => {
    // Timeout to prevent indefinite hanging if parent doesn't send assignment
    const assignmentTimeout = setTimeout(() => {
      if (!assignmentReceived) {
        cleanup();
        reject(new Error('Timeout waiting for worker assignment (30s)'));
      }
    }, 30000);

    // Handle parent process disconnect
    disconnectHandler = () => {
      if (!assignmentReceived) {
        clearTimeout(assignmentTimeout);
        if (messageHandler) {
          process.removeListener('message', messageHandler);
        }
        reject(new Error('Parent process disconnected before sending assignment'));
      }
    };

    messageHandler = (msg: unknown) => {
      // Type narrowing: check if this is a valid object
      if (typeof msg !== 'object' || msg === null) {
        console.error(
          `[Worker] Received malformed IPC message (non-object): ${typeof msg}`
        );
        return; // Ignore non-object messages
      }

      const message = msg as Record<string, unknown>;

      // If we haven't received assignment yet, check if this is it
      if (!assignmentReceived) {
        // Discriminated union: check for 'assignment' type or legacy assignment shape
        const isAssignmentMessage =
          message.type === 'assignment' ||
          ('suites' in message &&
            'config' in message &&
            'workdirPath' in message &&
            'workerId' in message);

        if (isAssignmentMessage) {
          assignmentReceived = true;
          // Clear the assignment timeout now that we've received the assignment
          clearTimeout(assignmentTimeout);
          // Remove the disconnect handler since we now have the assignment
          if (disconnectHandler) {
            process.removeListener('disconnect', disconnectHandler);
            disconnectHandler = null;
          }
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
          `[Worker] Received malformed IPC message before assignment: type="${message.type}" keys=${JSON.stringify(Object.keys(message))}`
        );
        return;
      }

      // After assignment is received, handle fast-fail signals using discriminated union
      if (message.type === 'fast-fail') {
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
    cleanup();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    output.writeLine(`\nWorker error: ${errorMsg}`);
    if (error instanceof Error) {
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
    cleanup();
    process.exit(1);
  }
}

// Start the worker
runWorker().catch((error) => {
  console.error('Fatal worker error:', error);
  process.exit(1);
});
