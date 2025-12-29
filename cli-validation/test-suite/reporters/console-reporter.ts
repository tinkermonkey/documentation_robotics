/**
 * Console Reporter
 *
 * Formats test results for display in the terminal
 */

import { TestRunSummary, SuiteResult, PipelineResult, StepResult } from '../pipeline';

/**
 * Format a single step result for console output
 */
function formatStepResult(step: StepResult, indent: string = ''): string {
  const status = step.passed ? '✓' : '✗';
  const command = step.command.length > 60 ? step.command.substring(0, 57) + '...' : step.command;

  let output = `${indent}${status} ${command}\n`;

  if (!step.passed) {
    for (const failure of step.failures) {
      output += `${indent}  ⚠ ${failure}\n`;
    }
  }

  return output;
}

/**
 * Format a single pipeline result for console output
 */
function formatPipelineResult(pipeline: PipelineResult, indent: string = ''): string {
  const status = pipeline.passed ? '✓' : '✗';
  let output = `${indent}${status} ${pipeline.name} (${pipeline.totalDuration}ms)\n`;

  for (const step of pipeline.steps) {
    output += formatStepResult(step, indent + '  ');
  }

  return output;
}

/**
 * Format a single suite result for console output
 */
function formatSuiteResult(suite: SuiteResult, indent: string = ''): string {
  const status = suite.passed ? '✓' : '✗';
  let output = `${indent}${status} ${suite.name} [${suite.priority}] (${suite.totalDuration}ms)\n`;

  for (const pipeline of suite.pipelines) {
    output += formatPipelineResult(pipeline, indent + '  ');
  }

  return output;
}

/**
 * Format complete test run summary for console output
 */
export function formatConsoleReport(summary: TestRunSummary): string {
  let output = 'Test Results Summary\n';
  output += '='.repeat(70) + '\n';
  output += '\n';

  // Summary statistics
  output += 'Statistics:\n';
  output += `  Suites:    ${summary.passedSuites}/${summary.totalSuites} passed`;
  if (summary.failedSuites > 0) {
    output += ` (${summary.failedSuites} failed)`;
  }
  output += '\n';

  output += `  Pipelines: ${summary.passedPipelines}/${summary.totalPipelines} passed`;
  if (summary.failedPipelines > 0) {
    output += ` (${summary.failedPipelines} failed)`;
  }
  output += '\n';

  output += `  Steps:     ${summary.passedSteps}/${summary.totalSteps} passed`;
  if (summary.failedSteps > 0) {
    output += ` (${summary.failedSteps} failed)`;
  }
  output += '\n';

  output += `  Duration:  ${summary.totalDuration}ms\n`;
  output += '\n';

  // Detailed results
  output += 'Detailed Results:\n';
  for (const suite of summary.results) {
    output += formatSuiteResult(suite, '  ');
  }

  // Summary line
  output += '\n';
  const allPassed = summary.failedSuites === 0;
  output += allPassed ? '✓ All tests passed!\n' : `✗ ${summary.failedSuites} suite(s) failed\n`;

  return output;
}
