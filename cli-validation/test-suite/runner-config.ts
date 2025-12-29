/**
 * Test Runner Configuration
 *
 * Parses command-line arguments and provides configuration for test execution
 */

import { parseArgs } from 'node:util';

/**
 * Configuration options for the test runner
 */
export interface RunnerOptions {
  /**
   * Reporter format: 'console' or 'junit'
   */
  reporter: 'console' | 'junit';

  /**
   * Stop test suite on first failure
   */
  fastFail: boolean;

  /**
   * Show detailed output during execution
   */
  verbose: boolean;

  /**
   * Filter tests by priority: 'high', 'medium', 'low'
   */
  priority?: 'high' | 'medium' | 'low';

  /**
   * Run only test suites matching this name (substring match)
   */
  testCase?: string;

  /**
   * Write report to file instead of stdout
   */
  outputFile?: string;

  /**
   * Show help information
   */
  help?: boolean;
}

/**
 * Parse command-line arguments into RunnerOptions
 */
export function parseRunnerArgs(): RunnerOptions {
  const { values } = parseArgs({
    options: {
      reporter: {
        type: 'string',
        short: 'r',
        default: 'console',
        description: 'Reporter format (console, junit)',
      },
      'fast-fail': {
        type: 'boolean',
        short: 'f',
        default: false,
        description: 'Stop on first failure',
      },
      verbose: {
        type: 'boolean',
        short: 'v',
        default: false,
        description: 'Verbose output',
      },
      priority: {
        type: 'string',
        short: 'p',
        description: 'Filter by priority (high, medium, low)',
      },
      'test-case': {
        type: 'string',
        short: 't',
        description: 'Run specific test suite',
      },
      output: {
        type: 'string',
        short: 'o',
        description: 'Output file for report',
      },
      help: {
        type: 'boolean',
        short: 'h',
        default: false,
        description: 'Show help',
      },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  // Validate reporter
  const reporter = (values.reporter || 'console') as string;
  if (!['console', 'junit'].includes(reporter)) {
    console.error(`Invalid reporter: ${reporter}`);
    process.exit(1);
  }

  // Validate priority
  let priority: 'high' | 'medium' | 'low' | undefined;
  if (values.priority) {
    if (!['high', 'medium', 'low'].includes(values.priority)) {
      console.error(`Invalid priority: ${values.priority}`);
      process.exit(1);
    }
    priority = values.priority as 'high' | 'medium' | 'low';
  }

  return {
    reporter: reporter as 'console' | 'junit',
    fastFail: values['fast-fail'] === true || false,
    verbose: values.verbose === true || false,
    priority,
    testCase: values['test-case'] as string | undefined,
    outputFile: values.output as string | undefined,
    help: false,
  };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
CLI Compatibility Test Suite Runner

Usage:
  npm run test:compatibility [options]

Options:
  -r, --reporter <format>  Reporter format: console, junit (default: console)
  -f, --fast-fail          Stop on first failure (default: false)
  -v, --verbose            Verbose output (default: false)
  -p, --priority <level>   Filter by priority: high, medium, low
  -t, --test-case <name>   Run specific test suite (substring match)
  -o, --output <file>      Write report to file
  -h, --help               Show this help message

Examples:
  # Run all tests with console output
  npm run test:compatibility

  # Run only high-priority tests
  npm run test:compatibility --priority high

  # Run with JUnit output for CI/CD
  npm run test:compatibility --reporter junit --output results/junit.xml

  # Run specific test suite with verbose output
  npm run test:compatibility --test-case "element-crud" --verbose

  # Fast-fail mode for development
  npm run test:compatibility --fast-fail --verbose
`);
}

/**
 * Validate that a test suite matches the configured filters
 */
export function matchesFilters(
  suiteName: string,
  suitePriority: string,
  options: RunnerOptions
): boolean {
  // Check priority filter
  if (options.priority && suitePriority !== options.priority) {
    return false;
  }

  // Check test case name filter (substring match)
  if (options.testCase && !suiteName.toLowerCase().includes(options.testCase.toLowerCase())) {
    return false;
  }

  return true;
}
