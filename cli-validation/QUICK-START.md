# CLI Compatibility Test Suite - Quick Start Guide

## Installation

```bash
cd cli-validation/test-suite
npm install
```

## Basic Usage

### Run All Tests
```bash
npm run test:compatibility
```

### Run High-Priority Tests (Fast Feedback)
```bash
npm run test:compatibility:fast
```

### Run with Verbose Output
```bash
npm run test:compatibility:verbose
```

### Run Specific Priority Level
```bash
npm run test:compatibility:high      # High-priority only
npm run test:compatibility:medium    # Medium-priority only
npm run test:compatibility:low       # Low-priority only
```

## Development Workflows

### Local Development (Quick Feedback)
```bash
# Fastest: High-priority tests with fast-fail and verbose output
npm run test:compatibility:fast

# Or run a specific test case
npm run test:compatibility -- --test-case="element" --fast-fail --verbose
```

### Before Committing
```bash
# Run high-priority tests to catch issues early
npm run test:compatibility:high
```

### Full Test Suite
```bash
# Run all tests for comprehensive validation
npm run test:compatibility
```

## CI/CD Integration

### GitHub Actions
The workflow automatically runs when you push or create a PR. Results are published to:
- PR checks and status
- PR comments with test statistics
- Artifacts with failure details

### Local CI/CD Testing
```bash
# Generate JUnit XML like CI/CD does
npm run test:compatibility:ci

# Check test-results/junit.xml
cat test-results/junit.xml
```

## Command-Line Options

### Common Combinations

```bash
# Fast-fail mode for development
npm run test:compatibility -- --fast-fail

# Verbose output with high-priority tests
npm run test:compatibility -- --priority=high --verbose

# Generate JUnit XML output
npm run test:compatibility -- --reporter=junit --output=results/junit.xml

# Run specific test by name
npm run test:compatibility -- --test-case="element-crud"

# Combine all options
npm run test:compatibility -- \
  --priority=high \
  --test-case="element" \
  --fast-fail \
  --verbose \
  --reporter=console
```

### All Flags

```bash
-r, --reporter <format>  # console, junit (default: console)
-f, --fast-fail          # Stop on first failure
-v, --verbose            # Show detailed output
-p, --priority <level>   # Filter by priority: high, medium, low
-t, --test-case <name>   # Run specific test (substring match)
-o, --output <file>      # Write report to file
-h, --help               # Show help message
```

## Understanding Test Results

### Console Output
```
✓ Green checkmark     = Test passed
✗ Red X              = Test failed
⚠ Yellow warning    = Failure detail

Statistics show:
- Suites passed/total
- Pipelines passed/total
- Steps passed/total
- Total duration
```

### JUnit XML
View in CI/CD systems or parse programmatically:
```bash
# Pretty print JUnit XML
cat test-results/junit.xml | xmllint --format -
```

## Troubleshooting

### Tests Don't Run
```bash
# Check that test cases exist
ls -la test-cases/

# Check that CLIs are configured
echo "Python CLI: $DR_PYTHON_CLI"
echo "TypeScript CLI: $DR_TS_CLI"

# Run with verbose output
npm run test:compatibility -- --verbose
```

### Build CLI First
```bash
# Make sure TypeScript CLI is built
cd ../../cli
npm install
npm run build

# Run tests
cd ../cli-validation/test-suite
npm run test:compatibility
```

### Tests Keep Failing
```bash
# Run high-priority tests only
npm run test:compatibility:high

# Run with fast-fail to find the first issue
npm run test:compatibility -- --fast-fail

# Show detailed output
npm run test:compatibility -- --verbose

# Run specific test case
npm run test:compatibility -- --test-case="element"
```

## From Repository Root

You can also run tests from the repository root:

```bash
# From /workspace
npm run test:fs-compatibility              # All tests
npm run test:fs-compatibility:fast         # Fast mode
npm run test:fs-compatibility:ci           # CI mode (JUnit)
npm run test:fs-compatibility:verbose      # Verbose mode
npm run test:fs-compatibility:high         # High-priority only
```

## Unit Tests

Test the reporter implementations:

```bash
npm run test:unit          # Run unit tests
npm run test:all           # Run unit + compatibility tests
```

## Output Locations

- **Console Output**: Printed to terminal
- **JUnit XML**: `test-results/junit.xml`
- **Custom Output**: Specified with `--output` flag
- **Verbose Logs**: Printed to terminal with `--verbose`
- **Failure Artifacts**: `test-project/python-cli/` and `test-project/ts-cli/`

## Examples

### Example 1: Quick Check
```bash
npm run test:compatibility:fast
# Output: Summary of high-priority tests in 5-10 seconds
```

### Example 2: Full Validation
```bash
npm run test:compatibility
# Output: Complete test report with all suites, pipelines, and steps
```

### Example 3: Debugging Failure
```bash
npm run test:compatibility -- --test-case="business-services" --verbose
# Output: Detailed output including command, exit codes, and file changes
```

### Example 4: CI Pipeline
```bash
npm run test:compatibility:ci
# Output: JUnit XML in test-results/junit.xml for GitHub Actions
```

### Example 5: Find First Failure
```bash
npm run test:compatibility -- --fast-fail
# Output: Stops at first failure, shows detailed error information
```

## Next Steps

1. **Read Full Documentation**: Review `reporters/` directory for implementation details
2. **Explore Test Cases**: Check `test-cases/` directory
3. **Review Implementation**: Look at `reporters/` directory
4. **Check Results**: View output in console or JUnit XML
5. **Integrate with CI/CD**: Use GitHub Actions workflow

## Tips

- Use **fast mode** during development for quick feedback
- Use **verbose mode** when debugging failures
- Use **priority filters** to test critical features first
- Use **test case filters** to focus on specific areas
- Use **fast-fail** to find the first issue quickly
- Use **JUnit output** in CI/CD pipelines

For more details, review the reporters in the `reporters/` directory.
