/**
 * JUnit Reporter
 *
 * Formats test results in JUnit XML format for CI/CD integration
 */

import { TestRunSummary, SuiteResult, PipelineResult, StepResult } from '../pipeline';

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
 * Format a single step as a JUnit test case
 */
function formatStepAsTestCase(
  step: StepResult,
  stepIdx: number
): string {
  const testName = `Step_${stepIdx + 1}: ${step.command}`;
  const duration = step.tsOutput.duration / 1000; // Convert to seconds

  let xml = `    <testcase name="${escapeXml(testName)}" time="${duration}">\n`;

  if (!step.passed) {
    const failureMessage = step.failures.join('\n');
    xml += `      <failure message="${escapeXml(failureMessage)}">`;
    xml += escapeXml(failureMessage);
    xml += `</failure>\n`;
  }

  xml += `    </testcase>\n`;

  return xml;
}

/**
 * Format a single pipeline as a JUnit test suite
 */
function formatPipelineAsTestSuite(
  pipeline: PipelineResult
): string {
  const suiteName = pipeline.name;
  const duration = pipeline.totalDuration / 1000; // Convert to seconds
  const failures = pipeline.steps.filter((s) => !s.passed).length;
  const tests = pipeline.steps.length;

  let xml = `  <testsuite name="${escapeXml(suiteName)}" tests="${tests}" failures="${failures}" time="${duration}">\n`;

  for (let i = 0; i < pipeline.steps.length; i++) {
    xml += formatStepAsTestCase(pipeline.steps[i], i);
  }

  xml += `  </testsuite>\n`;

  return xml;
}

/**
 * Format a single suite as a JUnit test suite container
 */
function formatSuiteAsTestSuite(suite: SuiteResult): string {
  const suiteName = `${suite.name} [${suite.priority}]`;
  const duration = suite.totalDuration / 1000; // Convert to seconds
  const failures = suite.pipelines.filter((p) => !p.passed).length;
  const tests = suite.pipelines.length;

  let xml = `  <testsuite name="${escapeXml(suiteName)}" tests="${tests}" failures="${failures}" time="${duration}">\n`;

  for (let i = 0; i < suite.pipelines.length; i++) {
    xml += formatPipelineAsTestSuite(suite.pipelines[i]);
  }

  xml += `  </testsuite>\n`;

  return xml;
}

/**
 * Format complete test run summary in JUnit XML format
 */
export function formatJunitReport(summary: TestRunSummary): string {
  const duration = summary.totalDuration / 1000; // Convert to seconds
  const failures = summary.failedSteps;
  const tests = summary.totalSteps;

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<testsuites name="CLI Compatibility Tests" tests="${tests}" failures="${failures}" time="${duration}">\n`;

  for (let i = 0; i < summary.results.length; i++) {
    xml += formatSuiteAsTestSuite(summary.results[i]);
  }

  xml += '</testsuites>\n';

  return xml;
}
