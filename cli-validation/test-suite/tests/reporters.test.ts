/**
 * Reporter Tests
 *
 * Tests for console and JUnit reporter implementations
 */

import { describe, it, expect } from 'bun:test';
import { ConsoleReporter } from '../reporters/console-reporter.js';
import { JUnitReporter } from '../reporters/junit-reporter.js';
import {
  TestRunSummary,
  SuiteResult,
  PipelineResult,
  StepResult,
  Pipeline,
  PipelineStep,
} from '../pipeline.js';

/**
 * Create mock test data for testing reporters
 */
function createMockSummary(): TestRunSummary {
  const stepResult: StepResult = {
    command: 'dr add motivation goal test-goal --name "Test Goal"',
    pythonOutput: {
      stdout: 'Added element',
      stderr: '',
      exitCode: 0,
      duration: 100,
    },
    tsOutput: {
      stdout: 'Added element',
      stderr: '',
      exitCode: 0,
      duration: 110,
    },
    filesystemDiff: {
      python: [{ path: 'manifest.yaml', type: 'modified' }],
      ts: [{ path: 'manifest.yaml', type: 'modified' }],
    },
    passed: true,
    failures: [],
  };

  const failedStepResult: StepResult = {
    command: 'dr add business service test-service',
    pythonOutput: {
      stdout: 'Error: service missing required field',
      stderr: 'Validation failed',
      exitCode: 1,
      duration: 50,
    },
    tsOutput: {
      stdout: 'Error: Could not create element',
      stderr: '',
      exitCode: 2,
      duration: 60,
    },
    filesystemDiff: {
      python: [],
      ts: [],
    },
    passed: false,
    failures: ['CLI exit code: expected 0, got 2', 'stdout missing: "Added element"'],
  };

  const pipelineResult: PipelineResult = {
    name: 'Element CRUD Operations',
    passed: true,
    steps: [stepResult, stepResult],
    totalDuration: 250,
  };

  const failedPipelineResult: PipelineResult = {
    name: 'Business Service Creation',
    passed: false,
    steps: [stepResult, failedStepResult],
    totalDuration: 150,
  };

  const suiteResult: SuiteResult = {
    name: 'Element Management',
    priority: 'high',
    passed: true,
    pipelines: [pipelineResult],
    totalDuration: 250,
  };

  const failedSuiteResult: SuiteResult = {
    name: 'Business Layer Operations',
    priority: 'high',
    passed: false,
    pipelines: [failedPipelineResult],
    totalDuration: 150,
  };

  return {
    totalSuites: 2,
    passedSuites: 1,
    failedSuites: 1,
    totalPipelines: 2,
    passedPipelines: 1,
    failedPipelines: 1,
    totalSteps: 4,
    passedSteps: 3,
    failedSteps: 1,
    totalDuration: 400,
    results: [suiteResult, failedSuiteResult],
  };
}

describe('ConsoleReporter', () => {
  it('should generate console report with summary statistics', () => {
    const reporter = new ConsoleReporter(false);
    const summary = createMockSummary();

    const report = reporter.generateReport(summary);

    expect(report).toContain('Test Results Summary');
    expect(report).toContain('Statistics:');
    // Check for the statistics sections
    expect(report).toContain('Suites:');
    expect(report).toContain('Pipelines:');
    expect(report).toContain('Steps:');
    // Verify the counts are present (accounting for ANSI color wrapping which includes escape codes between numbers and "passed")
    expect(report).toMatch(/Suites:[\s\S]*?1[\s\S]*?2[\s\S]*?passed/);
    expect(report).toMatch(/Pipelines:[\s\S]*?1[\s\S]*?2[\s\S]*?passed/);
    expect(report).toMatch(/Steps:[\s\S]*?3[\s\S]*?4[\s\S]*?passed/);
  });

  it('should include failure details in console report', () => {
    const reporter = new ConsoleReporter(false);
    const summary = createMockSummary();

    const report = reporter.generateReport(summary);

    expect(report).toContain('Business Layer Operations');
    expect(report).toContain('✗');
  });

  it('should include duration in console report', () => {
    const reporter = new ConsoleReporter(false);
    const summary = createMockSummary();

    const report = reporter.generateReport(summary);

    expect(report).toContain('400ms');
  });

  it('should display success message when all tests pass', () => {
    const reporter = new ConsoleReporter(false);
    const summary = createMockSummary();
    summary.failedSuites = 0;
    summary.failedSteps = 0;

    const report = reporter.generateReport(summary);

    expect(report).toContain('All tests passed!');
  });

  it('should display failure message when tests fail', () => {
    const reporter = new ConsoleReporter(false);
    const summary = createMockSummary();

    const report = reporter.generateReport(summary);

    expect(report).toContain('1 suite(s) failed');
  });

  it('should support verbose mode', () => {
    const reporter = new ConsoleReporter(true);
    const summary = createMockSummary();

    const report = reporter.generateReport(summary);

    // Verbose mode should still generate valid report
    expect(report).toBeTruthy();
    expect(report.length > 0).toBe(true);
  });

  it('should use ANSI color codes', () => {
    const reporter = new ConsoleReporter(false);
    const summary = createMockSummary();

    const report = reporter.generateReport(summary);

    // Check for ANSI escape codes
    expect(report).toContain('\x1b[');
  });

  it('should handle empty test results', () => {
    const reporter = new ConsoleReporter(false);
    const summary: TestRunSummary = {
      totalSuites: 0,
      passedSuites: 0,
      failedSuites: 0,
      totalPipelines: 0,
      passedPipelines: 0,
      failedPipelines: 0,
      totalSteps: 0,
      passedSteps: 0,
      failedSteps: 0,
      totalDuration: 0,
      results: [],
    };

    const report = reporter.generateReport(summary);

    expect(report).toContain('All tests passed!');
  });
});

describe('JUnitReporter', () => {
  it('should generate valid JUnit XML', () => {
    const reporter = new JUnitReporter();
    const summary = createMockSummary();

    const xml = reporter.generateReport(summary);

    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<testsuites');
    expect(xml).toContain('</testsuites>');
  });

  it('should include test counts in JUnit XML', () => {
    const reporter = new JUnitReporter();
    const summary = createMockSummary();

    const xml = reporter.generateReport(summary);

    expect(xml).toContain('tests="4"');
    expect(xml).toContain('failures="1"');
  });

  it('should include suite names in JUnit XML', () => {
    const reporter = new JUnitReporter();
    const summary = createMockSummary();

    const xml = reporter.generateReport(summary);

    expect(xml).toContain('Element Management');
    expect(xml).toContain('Business Layer Operations');
  });

  it('should include priority information in suite names', () => {
    const reporter = new JUnitReporter();
    const summary = createMockSummary();

    const xml = reporter.generateReport(summary);

    expect(xml).toContain('HIGH');
  });

  it('should escape XML special characters', () => {
    const reporter = new JUnitReporter();
    const summary = createMockSummary();
    summary.results[0].pipelines[0].name = 'Test & <Suite> with "quotes" and \'apostrophes\'';

    const xml = reporter.generateReport(summary);

    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&gt;');
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&apos;');
  });

  it('should include test case details with failure information', () => {
    const reporter = new JUnitReporter();
    const summary = createMockSummary();

    const xml = reporter.generateReport(summary);

    expect(xml).toContain('<testcase');
    expect(xml).toContain('</testcase>');
    expect(xml).toContain('<failure');
  });

  it('should include duration in seconds', () => {
    const reporter = new JUnitReporter();
    const summary = createMockSummary();

    const xml = reporter.generateReport(summary);

    // Duration should be in seconds (400ms = 0.4s)
    expect(xml).toContain('time="0.4"');
  });

  it('should handle empty results gracefully', () => {
    const reporter = new JUnitReporter();
    const summary: TestRunSummary = {
      totalSuites: 0,
      passedSuites: 0,
      failedSuites: 0,
      totalPipelines: 0,
      passedPipelines: 0,
      failedPipelines: 0,
      totalSteps: 0,
      passedSteps: 0,
      failedSteps: 0,
      totalDuration: 0,
      results: [],
    };

    const xml = reporter.generateReport(summary);

    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('tests="0"');
    expect(xml).toContain('failures="0"');
  });

  it('should use proper JUnit structure', () => {
    const reporter = new JUnitReporter();
    const summary = createMockSummary();

    const xml = reporter.generateReport(summary);

    // Check for proper nesting - testsuites should open first, testsuite second
    const testsuites = xml.indexOf('<?xml');
    const openTestsuites = xml.indexOf('<testsuites '); // with space to distinguish from <testsuite
    const openTestsuite = xml.indexOf('<testsuite '); // first nested testsuite with space
    const closeTestsuites = xml.lastIndexOf('</testsuites>');

    expect(openTestsuites).toBeLessThan(openTestsuite);
    expect(openTestsuite).toBeLessThan(closeTestsuites);
  });
});

describe('Reporter Integration', () => {
  it('should both reporters handle the same summary', () => {
    const consoleReporter = new ConsoleReporter(false);
    const junitReporter = new JUnitReporter();
    const summary = createMockSummary();

    const consoleReport = consoleReporter.generateReport(summary);
    const junitReport = junitReporter.generateReport(summary);

    expect(consoleReport).toBeTruthy();
    expect(junitReport).toBeTruthy();
  });

  it('should reporters correctly reflect all failures', () => {
    const consoleReporter = new ConsoleReporter(false);
    const junitReporter = new JUnitReporter();
    const summary = createMockSummary();

    const consoleReport = consoleReporter.generateReport(summary);
    const junitReport = junitReporter.generateReport(summary);

    // Both should mention failures
    expect(consoleReport).toContain('failed');
    expect(junitReport).toContain('failures="1"');
  });

  it('should handle different priority levels', () => {
    const consoleReporter = new ConsoleReporter(false);
    const summary = createMockSummary();

    summary.results[0].priority = 'high';
    summary.results[1].priority = 'low';

    const report = consoleReporter.generateReport(summary);

    expect(report).toBeTruthy();
  });
});
