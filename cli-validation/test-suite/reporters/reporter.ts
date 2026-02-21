/**
 * Reporter Interface
 *
 * Defines the contract that all reporters must implement.
 * Reporters listen to test execution events and format results for various outputs.
 */

import { TestSuite, Pipeline, PipelineStep, PipelineResult, SuiteResult, TestRunSummary } from '../pipeline.js';

/**
 * Interface for test reporter implementations
 *
 * Reporters are called at key points during test execution:
 * - Suite start/complete
 * - Pipeline start/complete
 * - Step completion
 *
 * At the end, they generate formatted output for their target medium
 * (console, JUnit XML, JSON, etc.)
 */
export interface Reporter {
  /**
   * Called when a test suite starts executing
   */
  onSuiteStart(suite: TestSuite): void;

  /**
   * Called when a pipeline starts executing
   */
  onPipelineStart(pipeline: Pipeline, suiteIndex: number): void;

  /**
   * Called when a single step completes
   */
  onStepComplete(
    step: PipelineStep,
    pipelineIndex: number,
    stepIndex: number,
    result: any // StepResult
  ): void;

  /**
   * Called when a pipeline completes
   */
  onPipelineComplete(pipeline: Pipeline, pipelineIndex: number, result: PipelineResult): void;

  /**
   * Called when a test suite completes
   */
  onSuiteComplete(suite: TestSuite, result: SuiteResult): void;

  /**
   * Generate the final formatted report
   * Called after all tests complete
   */
  generateReport(summary: TestRunSummary): string;
}

/**
 * Abstract base class for reporter implementations
 * Provides common functionality and default implementations
 */
export abstract class BaseReporter implements Reporter {
  protected startTime: number = 0;
  protected suites: string[] = [];
  protected currentSuite: string = '';
  protected failures: any[] = [];

  onSuiteStart(suite: TestSuite): void {
    this.currentSuite = suite.name;
    this.suites.push(suite.name);
    this.startTime = Date.now();
  }

  onPipelineStart(_pipeline: Pipeline, _suiteIndex: number): void {
    // Override in subclasses
  }

  onStepComplete(
    _step: PipelineStep,
    _pipelineIndex: number,
    _stepIndex: number,
    _result: any
  ): void {
    // Override in subclasses
  }

  onPipelineComplete(_pipeline: Pipeline, _pipelineIndex: number, _result: PipelineResult): void {
    // Override in subclasses
  }

  onSuiteComplete(_suite: TestSuite, _result: SuiteResult): void {
    // Override in subclasses
  }

  abstract generateReport(summary: TestRunSummary): string;
}
