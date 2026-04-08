/**
 * Shared type definitions for test runner and worker processes
 */

import { SuiteResult, TestSuite } from './pipeline.js';

/**
 * Main test runner configuration
 */
export interface TestRunnerConfig {
  tsCLI: string;
  tsDir: string;
  testCaseDir: string;
}

/**
 * Message format for IPC: worker sends results back to parent
 */
export interface WorkerResult {
  workerId: number;
  results: SuiteResult[];
  output: string;
}

/**
 * Message format for IPC: parent sends this to worker
 */
export interface WorkerAssignment {
  suites: TestSuite[];
  config: TestRunnerConfig;
  workdirPath: string;
  workerId: number;
}
