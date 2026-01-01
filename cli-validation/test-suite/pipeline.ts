/**
 * Pipeline Type Definitions
 *
 * Defines the structure of test suite YAML files and pipeline execution results.
 */

/**
 * A single test step in a pipeline
 */
export interface PipelineStep {
  command: string; // CLI command to execute (without CLI prefix)
  files_to_compare: string[]; // Paths to files that should be compared
  expect_exit_code?: number; // Expected exit code (default: 0)
  expect_stdout_contains?: string[]; // Expected stdout substrings
  expect_stderr_contains?: string[]; // Expected stderr substrings
  timeout?: number; // Timeout in milliseconds (default: 30000)
}

/**
 * A named sequence of steps to execute
 */
export interface Pipeline {
  name: string;
  description?: string;
  steps: PipelineStep[];
}

/**
 * A complete test suite with metadata and pipelines
 */
export interface TestSuite {
  name: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  pipelines: Pipeline[];
}

/**
 * Output from executing a single step
 */
export interface StepResult {
  command: string;
  pythonOutput: {
    stdout: string;
    stderr: string;
    exitCode: number;
    duration: number;
  };
  tsOutput: {
    stdout: string;
    stderr: string;
    exitCode: number;
    duration: number;
  };
  filesystemDiff: {
    python: {
      path: string;
      type: 'added' | 'deleted' | 'modified';
    }[];
    ts: {
      path: string;
      type: 'added' | 'deleted' | 'modified';
    }[];
  };
  passed: boolean;
  failures: string[];
}

/**
 * Result of executing a single pipeline
 */
export interface PipelineResult {
  name: string;
  passed: boolean;
  steps: StepResult[];
  totalDuration: number;
}

/**
 * Result of executing an entire test suite
 */
export interface SuiteResult {
  name: string;
  priority: 'high' | 'medium' | 'low';
  passed: boolean;
  pipelines: PipelineResult[];
  totalDuration: number;
}

/**
 * Summary of entire test run
 */
export interface TestRunSummary {
  totalSuites: number;
  passedSuites: number;
  failedSuites: number;
  totalPipelines: number;
  passedPipelines: number;
  failedPipelines: number;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  totalDuration: number;
  results: SuiteResult[];
}
