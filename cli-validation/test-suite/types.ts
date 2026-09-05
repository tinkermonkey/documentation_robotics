/**
 * Shared type definitions for test runner and worker processes
 */

import { SuiteResult, TestSuite } from './pipeline.js';

/**
 * Main test runner configuration
 */
export interface TestRunnerConfig {
  tsCLI: string;
  tsDir?: string; // Optional: only used in parent test runner, not in worker processes
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
 * Discriminated union type for IPC messages sent to worker
 *
 * - 'assignment': Initial test suite assignment from parent
 * - 'fast-fail': Signal to stop execution (sent after first failure)
 */
export type WorkerMessage =
  | {
      type: 'assignment';
      suites: TestSuite[];
      config: TestRunnerConfig;
      workdirPath: string;
      workerId: number;
    }
  | {
      type: 'fast-fail';
    };

/**
 * Message format for worker assignment from parent process.
 * Used alongside WorkerMessage discriminated union for type safety.
 */
export interface WorkerAssignment {
  suites: TestSuite[];
  config: TestRunnerConfig;
  workdirPath: string;
  workerId: number;
}
