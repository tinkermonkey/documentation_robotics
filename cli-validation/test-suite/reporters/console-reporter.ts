/**
 * Console Reporter
 *
 * Formats test results for display in the terminal with color coding
 * and detailed failure information.
 */

import { TestRunSummary, SuiteResult, PipelineResult, StepResult } from '../pipeline';
import { BaseReporter } from './reporter';

/**
 * ANSI color codes for terminal output
 */
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

/**
 * Maximum characters to display from stdout before truncation
 */
const MAX_STDOUT_DISPLAY = 200;

/**
 * Maximum number of file changes to show before truncation
 */
const MAX_FILES_SHOWN = 5;

/**
 * Format text with color
 */
function colorize(text: string, color: string): string {
  return `${color}${text}${COLORS.reset}`;
}

/**
 * Format a single step result for console output
 */
function formatStepResult(step: StepResult, indent: string = '', verbose: boolean = false): string {
  const status = step.passed
    ? colorize('✓', COLORS.green)
    : colorize('✗', COLORS.red);
  const command = step.command.length > 60 ? step.command.substring(0, 57) + '...' : step.command;

  let output = `${indent}${status} ${command}\n`;

  if (!step.passed) {
    for (const failure of step.failures) {
      output += `${indent}  ${colorize('⚠', COLORS.yellow)} ${failure}\n`;
    }
  }

  if (verbose && !step.passed) {
    output += `${indent}  ${colorize('Exit Code:', COLORS.dim)} ${step.tsOutput.exitCode}\n`;
    if (step.tsOutput.stdout) {
      const stdout = step.tsOutput.stdout.substring(0, MAX_STDOUT_DISPLAY);
      output += `${indent}  ${colorize('Stdout:', COLORS.dim)} ${stdout}${
        step.tsOutput.stdout.length > MAX_STDOUT_DISPLAY ? '...' : ''
      }\n`;
    }
    if (step.filesystemDiff.ts.length > 0) {
      output += `${indent}  ${colorize('Files Changed:', COLORS.dim)} ${step.filesystemDiff.ts.length}\n`;
      for (const change of step.filesystemDiff.ts.slice(0, MAX_FILES_SHOWN)) {
        output += `${indent}    ${change.type[0].toUpperCase()} ${change.path}\n`;
      }
      if (step.filesystemDiff.ts.length > MAX_FILES_SHOWN) {
        output += `${indent}    ... and ${step.filesystemDiff.ts.length - MAX_FILES_SHOWN} more\n`;
      }
    }
  }

  return output;
}

/**
 * Format a single pipeline result for console output
 */
function formatPipelineResult(
  pipeline: PipelineResult,
  indent: string = '',
  verbose: boolean = false
): string {
  const status = pipeline.passed
    ? colorize('✓', COLORS.green)
    : colorize('✗', COLORS.red);
  const duration = colorize(`${pipeline.totalDuration}ms`, COLORS.dim);
  let output = `${indent}${status} ${pipeline.name} (${duration})\n`;

  for (const step of pipeline.steps) {
    output += formatStepResult(step, indent + '  ', verbose);
  }

  return output;
}

/**
 * Format a single suite result for console output
 */
function formatSuiteResult(
  suite: SuiteResult,
  indent: string = '',
  verbose: boolean = false
): string {
  const status = suite.passed
    ? colorize('✓', COLORS.green)
    : colorize('✗', COLORS.red);
  const priority = colorize(`[${suite.priority.toUpperCase()}]`, COLORS.cyan);
  const duration = colorize(`${suite.totalDuration}ms`, COLORS.dim);
  let output = `${indent}${status} ${suite.name} ${priority} (${duration})\n`;

  for (const pipeline of suite.pipelines) {
    output += formatPipelineResult(pipeline, indent + '  ', verbose);
  }

  return output;
}

/**
 * Console reporter implementation
 */
export class ConsoleReporter extends BaseReporter {
  private verbose: boolean = false;
  private currentPipelineName: string = '';

  constructor(verbose: boolean = false) {
    super();
    this.verbose = verbose;
  }

  override onSuiteStart(suite: any): void {
    // Visual separator between suites
    super.onSuiteStart(suite);
    console.log(colorize('▶', COLORS.cyan) + ` Suite: ${this.currentSuite}`);
  }

  override onPipelineStart(pipeline: any): void {
    this.currentPipelineName = pipeline.name;
    console.log(`  ${colorize('▸', COLORS.cyan)} ${pipeline.name}`);
  }

  override onStepComplete(step: PipelineStep, _pipelineIndex: number, _stepIndex: number, result: any): void {
    const passed = result.passed;
    const status = passed
      ? colorize('✓', COLORS.green)
      : colorize('✗', COLORS.red);
    const cmd = step.command.length > 50 ? step.command.substring(0, 47) + '...' : step.command;

    process.stdout.write(`    ${status} ${cmd}`);

    if (!passed) {
      process.stdout.write(` ${colorize(`[FAILED]`, COLORS.red)}`);
      for (const failure of result.failures) {
        process.stdout.write(`\n      ${colorize('⚠', COLORS.yellow)} ${failure}`);
      }
    }

    process.stdout.write('\n');
  }

  override onSuiteComplete(suite: any, result: SuiteResult): void {
    const status = result.passed ? colorize('✓', COLORS.green) : colorize('✗', COLORS.red);
    console.log(
      `\n${status} ${result.name} completed in ${colorize(`${result.totalDuration}ms`, COLORS.dim)}`
    );
  }

  /**
   * Format complete test run summary for console output
   */
  generateReport(summary: TestRunSummary): string {
    let output = '\n' + colorize('═'.repeat(70), COLORS.bold) + '\n';
    output += colorize('Test Results Summary', COLORS.bold) + '\n';
    output += colorize('═'.repeat(70), COLORS.bold) + '\n\n';

    // Summary statistics
    output += colorize('Statistics:', COLORS.bold) + '\n';
    const suiteStatus =
      summary.failedSuites === 0
        ? colorize(`${summary.passedSuites}/${summary.totalSuites}`, COLORS.green)
        : colorize(`${summary.passedSuites}/${summary.totalSuites}`, COLORS.red);
    output += `  Suites:    ${suiteStatus} passed`;
    if (summary.failedSuites > 0) {
      output += ` ${colorize(`(${summary.failedSuites} failed)`, COLORS.red)}`;
    }
    output += '\n';

    const pipelineStatus =
      summary.failedPipelines === 0
        ? colorize(`${summary.passedPipelines}/${summary.totalPipelines}`, COLORS.green)
        : colorize(`${summary.passedPipelines}/${summary.totalPipelines}`, COLORS.red);
    output += `  Pipelines: ${pipelineStatus} passed`;
    if (summary.failedPipelines > 0) {
      output += ` ${colorize(`(${summary.failedPipelines} failed)`, COLORS.red)}`;
    }
    output += '\n';

    const stepStatus =
      summary.failedSteps === 0
        ? colorize(`${summary.passedSteps}/${summary.totalSteps}`, COLORS.green)
        : colorize(`${summary.passedSteps}/${summary.totalSteps}`, COLORS.red);
    output += `  Steps:     ${stepStatus} passed`;
    if (summary.failedSteps > 0) {
      output += ` ${colorize(`(${summary.failedSteps} failed)`, COLORS.red)}`;
    }
    output += '\n';

    output += `  Duration:  ${colorize(`${summary.totalDuration}ms`, COLORS.dim)}\n\n`;

    // Detailed results (only if there are failures)
    if (summary.failedSteps > 0) {
      output += colorize('Detailed Results:', COLORS.bold) + '\n';
      for (const suite of summary.results) {
        if (!suite.passed) {
          output += formatSuiteResult(suite, '  ', this.verbose);
        }
      }
      output += '\n';
    }

    // Summary line
    const allPassed = summary.failedSuites === 0;
    output += allPassed
      ? colorize('✓ All tests passed!', COLORS.green) + '\n'
      : colorize(`✗ ${summary.failedSuites} suite(s) failed`, COLORS.red) + '\n';

    return output;
  }
}

/**
 * Format complete test run summary for console output (legacy function)
 */
export function formatConsoleReport(summary: TestRunSummary): string {
  const reporter = new ConsoleReporter(false);
  return reporter.generateReport(summary);
}
