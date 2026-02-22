/**
 * JUnit Reporter
 *
 * Formats test results in JUnit XML format for CI/CD integration
 * Compatible with GitHub Actions, Jenkins, and other CI/CD systems
 */

import { TestRunSummary, SuiteResult, PipelineResult, StepResult, Pipeline, PipelineStep } from '../pipeline.js';
import { BaseReporter } from './reporter.js';

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format failure details including command, exit code, and filesystem changes
 */
function formatFailureDetails(step: StepResult): string {
  const details: string[] = [];

  // Command information
  details.push(`Command: ${step.command}`);
  details.push(`Exit Code: ${step.tsOutput.exitCode}`);

  // Output information
  if (step.tsOutput.stdout) {
    details.push(`\nStdout:\n${step.tsOutput.stdout.substring(0, 1000)}`);
    if (step.tsOutput.stdout.length > 1000) {
      details.push('(... output truncated)');
    }
  }

  if (step.tsOutput.stderr) {
    details.push(`\nStderr:\n${step.tsOutput.stderr.substring(0, 1000)}`);
    if (step.tsOutput.stderr.length > 1000) {
      details.push('(... error output truncated)');
    }
  }

  // Filesystem changes
  if (step.filesystemDiff.ts.length > 0) {
    details.push(`\nFilesystem Changes: ${step.filesystemDiff.ts.length} files`);
    for (const change of step.filesystemDiff.ts) {
      details.push(`  ${change.type.toUpperCase()} ${change.path}`);
    }
  }

  return details.join('\n');
}

/**
 * Format a single step as a JUnit test case
 */
function formatStepAsTestCase(
  step: StepResult,
  stepIdx: number,
  pipelineName: string
): string {
  // Use pipeline name + step as the test name for better organization
  const testName = `${pipelineName} / Step ${stepIdx + 1}`;
  const duration = step.tsOutput.duration / 1000; // Convert to seconds

  let xml = `    <testcase name="${escapeXml(testName)}" classname="CLI-Compatibility-Test" time="${duration}">\n`;

  if (!step.passed) {
    const failureMessage = step.failures.join('; ');
    const failureDetails = formatFailureDetails(step);

    xml += `      <failure message="${escapeXml(failureMessage)}" type="AssertionError">\n`;
    xml += escapeXml(failureDetails);
    xml += `\n      </failure>\n`;
  }

  xml += `    </testcase>\n`;

  return xml;
}

/**
 * Format a single pipeline as a JUnit test suite
 */
function formatPipelineAsTestSuite(
  pipeline: PipelineResult,
  steps: StepResult[]
): string {
  const suiteName = pipeline.name;
  const duration = pipeline.totalDuration / 1000; // Convert to seconds
  const failures = pipeline.steps.filter((s) => !s.passed).length;
  const tests = pipeline.steps.length;

  let xml = `  <testsuite name="${escapeXml(suiteName)}" tests="${tests}" failures="${failures}" time="${duration}">\n`;

  for (let i = 0; i < steps.length; i++) {
    xml += formatStepAsTestCase(steps[i], i, suiteName);
  }

  xml += `  </testsuite>\n`;

  return xml;
}

/**
 * Format a single suite as a JUnit test suite container
 */
function formatSuiteAsTestSuite(suite: SuiteResult): string {
  const suiteName = `${suite.name} [${suite.priority.toUpperCase()}]`;
  const duration = suite.totalDuration / 1000; // Convert to seconds
  const failures = suite.pipelines.filter((p) => !p.passed).length;
  const tests = suite.pipelines.length;

  let xml = `  <testsuite name="${escapeXml(suiteName)}" tests="${tests}" failures="${failures}" time="${duration}">\n`;

  for (const pipeline of suite.pipelines) {
    xml += formatPipelineAsTestSuite(pipeline, pipeline.steps);
  }

  xml += `  </testsuite>\n`;

  return xml;
}

/**
 * JUnit reporter implementation
 */
export class JUnitReporter extends BaseReporter {
  generateReport(summary: TestRunSummary): string {
    const duration = summary.totalDuration / 1000; // Convert to seconds
    const failures = summary.failedSteps;
    const tests = summary.totalSteps;

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += `<testsuites name="CLI Compatibility Tests" tests="${tests}" failures="${failures}" time="${duration}">\n`;

    for (const result of summary.results) {
      xml += formatSuiteAsTestSuite(result);
    }

    xml += '</testsuites>\n';

    return xml;
  }
}

/**
 * Format complete test run summary in JUnit XML format (legacy function)
 */
export function formatJunitReport(summary: TestRunSummary): string {
  const reporter = new JUnitReporter();
  return reporter.generateReport(summary);
}
