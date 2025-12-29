# Phase 6: Reporting and CI/CD Integration

This document describes the reporting and CI/CD integration implementation for the CLI Compatibility Test Suite.

## Overview

Phase 6 implements comprehensive reporting capabilities for human-readable console output and machine-readable JUnit XML for CI/CD integration. It also provides execution modes for development workflows (fast-fail, verbose, subset execution) and integrates with GitHub Actions.

## Components

### Reporter Interface (`reporters/reporter.ts`)

The `Reporter` interface defines the contract for all reporter implementations:

```typescript
export interface Reporter {
  onSuiteStart(suite: TestSuite): void;
  onPipelineStart(pipeline: Pipeline, suiteIndex: number): void;
  onStepComplete(step: PipelineStep, pipelineIndex: number, stepIndex: number, result: any): void;
  onPipelineComplete(pipeline: Pipeline, pipelineIndex: number, result: PipelineResult): void;
  onSuiteComplete(suite: TestSuite, result: SuiteResult): void;
  generateReport(summary: TestRunSummary): string;
}
```

All reporters extend `BaseReporter` which provides common functionality.

### Console Reporter (`reporters/console-reporter.ts`)

Formats test results for human consumption with:
- **Color-coded output** using ANSI color codes
  - ✓ in green for passed tests
  - ✗ in red for failed tests
  - ⚠ in yellow for warnings
- **Summary statistics** showing passed/failed counts for suites, pipelines, and steps
- **Detailed failure information** when tests fail
- **Verbose mode** for additional debugging output
- **Duration tracking** for performance analysis

Example output:
```
══════════════════════════════════════════════════════════════════════
Test Results Summary
══════════════════════════════════════════════════════════════════════

Statistics:
  Suites:    7/8 passed (1 failed)
  Pipelines: 12/14 passed (2 failed)
  Steps:     48/50 passed (2 failed)
  Duration:  12345ms

Detailed Results:
  ✗ Business Services [HIGH] (2450ms)
    ✗ Create Business Service Pipeline (1200ms)
      ✗ dr add business service test-service
        ⚠ CLI exit code: expected 0, got 1
        ⚠ stdout missing: "Added element"

✗ 1 suite(s) failed
```

### JUnit Reporter (`reporters/junit-reporter.ts`)

Generates JUnit XML output compatible with:
- GitHub Actions
- Jenkins
- GitLab CI
- Any CI/CD system that consumes JUnit XML

Features:
- **Proper XML structure** with testsuites/testsuite/testcase hierarchy
- **Failure details** including command, exit code, stdout, stderr
- **Filesystem change tracking** in failure messages
- **XML escaping** for special characters in output
- **Duration in seconds** for CI/CD system compatibility

Example structure:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="CLI Compatibility Tests" tests="50" failures="2" time="12.345">
  <testsuite name="Element Management [HIGH]" tests="14" failures="0" time="3.45">
    <testcase name="Element CRUD Operations / Step 1" time="0.110">
    </testcase>
    <!-- More test cases -->
  </testsuite>
  <testsuite name="Business Services [HIGH]" tests="12" failures="2" time="2.50">
    <testcase name="Create Service / Step 1" time="0.050">
      <failure message="CLI exit code: expected 0, got 1">
        Command: dr add business service test-service
        Exit Code: 1

        Stdout:
        Error: service missing required field

        Filesystem Changes: 0 files
      </failure>
    </testcase>
  </testsuite>
</testsuites>
```

## Execution Modes

### Runner Configuration (`runner-config.ts`)

The test runner supports configurable execution modes via command-line flags:

```bash
# Basic usage
npm run test:compatibility

# Fast-fail mode: Stop on first failure
npm run test:compatibility --fast-fail

# Verbose mode: Show detailed output
npm run test:compatibility --verbose

# Filter by priority
npm run test:compatibility --priority=high
npm run test:compatibility --priority=medium
npm run test:compatibility --priority=low

# Filter by test case name
npm run test:compatibility --test-case="element"

# Different reporters
npm run test:compatibility --reporter=console
npm run test:compatibility --reporter=junit
npm run test:compatibility --reporter=json

# Write output to file
npm run test:compatibility --reporter=junit --output=results/junit.xml

# Combine options
npm run test:compatibility --priority=high --fast-fail --verbose
```

### CLI Flags

| Flag | Short | Type | Description |
|------|-------|------|-------------|
| `--reporter` | `-r` | console\|junit\|json | Output format (default: console) |
| `--fast-fail` | `-f` | boolean | Stop on first failure |
| `--verbose` | `-v` | boolean | Show detailed output |
| `--priority` | `-p` | high\|medium\|low | Filter by priority |
| `--test-case` | `-t` | string | Run specific test (substring match) |
| `--output` | `-o` | string | Write report to file |
| `--concurrency` | `-c` | number | Max concurrent pipelines |
| `--help` | `-h` | boolean | Show help |

### Test Suite Filtering

The runner filters test suites based on:
1. **Priority filter** - Only run tests matching the specified priority
2. **Test case filter** - Only run tests whose names contain the specified substring (case-insensitive)

Both filters can be combined:
```bash
# Run high-priority element tests
npm run test:compatibility --priority=high --test-case=element
```

## NPM Scripts

### Test Suite Directory (`cli-validation/test-suite/`)

```bash
npm run test                      # Run all compatibility tests
npm run test:compatibility        # Same as above
npm run test:compatibility:fast   # High-priority tests with fast-fail
npm run test:compatibility:ci     # JUnit output for CI/CD
npm run test:compatibility:verbose # Show detailed output
npm run test:compatibility:high   # High-priority tests only
npm run test:compatibility:medium # Medium-priority tests only
npm run test:compatibility:low    # Low-priority tests only
npm run test:unit                 # Run unit tests for reporters/runner
npm run test:all                  # Run all tests (unit + compatibility)
```

### Repository Root (`./`)

```bash
npm run test:fs-compatibility        # Run all compatibility tests
npm run test:fs-compatibility:fast   # High-priority with fast-fail
npm run test:fs-compatibility:ci     # JUnit output for CI/CD
npm run test:fs-compatibility:verbose # Show detailed output
npm run test:fs-compatibility:high   # High-priority only
npm run test:fs-compatibility:medium # Medium-priority only
npm run test:fs-compatibility:low    # Low-priority only
```

## GitHub Actions Integration

The `.github/workflows/cli-compatibility.yml` workflow:

1. **Triggers** on:
   - Pull requests affecting CLI or test suite
   - Pushes to main branch

2. **Runs**:
   - Setup Node.js and Python environments
   - Build TypeScript CLI
   - Install test dependencies
   - Run high-priority tests first
   - Run all tests with JUnit output

3. **Publishes**:
   - Test results to PR checks using `publish-unit-test-result-action`
   - Summary comment on pull requests
   - Test failure artifacts (python-cli/, ts-cli/ directories)

4. **Artifacts**:
   - Test results XML files (7-day retention)
   - Failure artifacts for debugging (7-day retention)

### GitHub Actions Features

- **Parallel execution** of high-priority tests (for quick feedback)
- **Full suite execution** with detailed results
- **Automatic PR comments** with test statistics
- **Failure artifacts** uploaded for debugging
- **Status checks** that block merging if tests fail

## Fast-Fail Mode

When enabled with `--fast-fail`, the test suite stops immediately on the first test failure:

```bash
npm run test:compatibility --fast-fail
```

Benefits:
- **Quick feedback** during development
- **Reduced CI/CD time** for debugging
- **Faster iteration** on fixes

The runner exits with code 1 when a failure is encountered.

## Verbose Mode

When enabled with `--verbose`, provides detailed output including:

```bash
npm run test:compatibility --verbose
```

Output includes:
- Exit codes for each step
- Standard output and error streams
- Filesystem change details
- Command execution timing

## Development Workflows

### Local Development
```bash
# Fast-fail with verbose output for quick feedback
npm run test:fs-compatibility:fast

# Or with specific test case
npm run test:compatibility -- --test-case="element" --fast-fail --verbose
```

### CI/CD Pipeline
```bash
# Generate JUnit XML for GitHub Actions
npm run test:fs-compatibility:ci
```

### Pre-commit
```bash
# Quick sanity check
npm run test:fs-compatibility -- --priority=high --test-case="critical"
```

## Test Reports

### Console Report
The console reporter outputs a human-readable summary:
- Color-coded results
- Statistics summary
- Detailed failures (only if tests fail)
- Overall pass/fail indicator

### JUnit Report
The JUnit reporter generates `test-results/junit.xml` with:
- Proper nesting of test suites
- Failure details with command and output
- Timing information for performance tracking
- Compatible with GitHub Actions, Jenkins, etc.

Both formats are automatically generated when tests run.

## Testing the Reporters

Unit tests for the reporter implementations are located in `tests/`:

```bash
# Run reporter unit tests
npm run test:unit

# Run all tests
npm run test:all
```

Test coverage includes:
- Console reporter output formatting
- JUnit XML generation and structure
- XML special character escaping
- Filter matching logic
- Configuration parsing
- Priority and test case filtering

## Implementation Details

### Color Codes
The console reporter uses ANSI color codes:
- Green (`\x1b[32m`) - Passed tests
- Red (`\x1b[31m`) - Failed tests
- Yellow (`\x1b[33m`) - Warnings
- Cyan (`\x1b[36m`) - Suite/pipeline headers
- Dim (`\x1b[2m`) - Secondary information

### XML Structure
JUnit XML follows the standard structure:
```
testsuites (root)
├── testsuite (one per suite)
│   └── testsuite (one per pipeline)
│       └── testcase (one per step)
│           └── failure (optional)
```

### Duration Conversion
All durations are stored internally in milliseconds but output as:
- Console: milliseconds (e.g., "1234ms")
- JUnit: seconds (e.g., "1.234")

## Troubleshooting

### Tests Not Running
- Check that test case YAML files exist in `test-cases/`
- Verify CLI paths are set correctly: `DR_PYTHON_CLI` and `DR_TS_CLI`
- Run with `--verbose` for detailed diagnostics

### JUnit Report Not Generated
- Check output directory is writable
- Ensure `test-results/` directory exists
- Verify reporter is set to `junit`

### Color Not Showing
- Some terminals don't support ANSI color
- Color codes are automatically included in output
- Use `--reporter=junit` for structured output in CI/CD

### Fast-Fail Not Stopping
- Ensure `--fast-fail` flag is set
- Check that tests are actually failing
- First failing test should stop the suite

## Performance Considerations

- **Snapshot capturing** is the slowest operation
- **File normalization** adds overhead (necessary for accurate comparison)
- **Parallel execution** (currently sequential) could improve throughput
- **Large export files** may slow down comparison

For faster testing:
```bash
# Skip low-priority tests
npm run test:fs-compatibility -- --priority=high

# Or use fast-fail mode
npm run test:fs-compatibility:fast
```

## Acceptance Criteria

All requirements from the Phase 6 spec are implemented:

- ✅ Console reporter displays color-coded test results with ✓/✗ indicators
- ✅ JUnit reporter generates valid XML consumable by GitHub Actions
- ✅ Fast-fail mode stops test suite on first failure
- ✅ Verbose mode logs all command stdout/stderr for debugging
- ✅ Priority filtering executes only high/medium/low priority tests
- ✅ Test case filtering executes specific test files by name
- ✅ GitHub Actions workflow runs compatibility tests on PR and push
- ✅ Test results are published to GitHub PR checks
- ✅ Failure artifacts (python-cli/, ts-cli/) are uploaded on test failure
- ✅ npm scripts provide convenient test execution from repository root
- ✅ Comprehensive unit tests for reporters and runner configuration

## Future Enhancements

Potential improvements for future phases:
- **Parallel pipeline execution** for faster test runs
- **JSON reporter** for machine consumption beyond JUnit
- **HTML reports** for visual result analysis
- **Trend tracking** across multiple test runs
- **Performance profiling** to identify slow commands
- **Screenshot/diff generation** for visual comparison
