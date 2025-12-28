# Differential Testing Framework

This framework compares the output of the TypeScript CLI against the Python CLI to ensure behavioral equivalence.

## Architecture

### Components

1. **Test Case Definitions** (`test-cases.yaml`)
   - Declarative test cases in YAML format
   - Defines commands to run in both CLIs
   - Specifies expected comparison behavior

2. **Test Runner** (`runner.ts`)
   - Executes both Python scripts and TypeScript CLI commands
   - Captures stdout/stderr from each
   - Handles different invocation styles
   - Normalizes outputs for comparison

3. **Comparison Utilities** (`comparator.ts`)
   - Deep JSON comparison
   - Text normalization
   - Diff generation
   - Equivalence checking with configurable tolerance

4. **Test Suite** (`differential.test.ts`)
   - Integration test that runs all test cases
   - Generates detailed comparison reports
   - Reports pass/fail status

## Python CLI vs TypeScript CLI Mapping

### Python Scripts (Standalone)

```bash
# Validation
python scripts/validate.py --all
python scripts/validate.py --markdown
python scripts/validate.py --relationships

# Report Generation
python scripts/generate_reports.py --all
python scripts/generate_reports.py --traceability
python scripts/generate_reports.py --catalog
python scripts/generate_reports.py --graphml
```

### TypeScript CLI (Unified)

```bash
# Validation
bun run src/cli.ts validate
bun run src/cli.ts validate --type markdown
bun run src/cli.ts validate --type relationships

# Report-like functionality (different approach)
bun run src/cli.ts trace <elementId>
bun run src/cli.ts list <layer>
bun run src/cli.ts export --format graphml
```

## Test Case Format

```yaml
test_cases:
  - name: "Validate markdown structure"
    python:
      command: "python"
      args: ["scripts/validate.py", "--markdown", "--format", "json"]
      cwd: "/Users/austinsand/workspace/documentation_robotics"
    typescript:
      command: "bun"
      args: ["run", "src/cli.ts", "validate", "--type", "markdown", "--format", "json"]
      cwd: "/Users/austinsand/workspace/documentation_robotics/cli"
    comparison:
      type: "json"
      ignore_keys: ["timestamp", "execution_time"]
      sort_arrays: true
```

## Running Tests

```bash
# Run all differential tests
cd cli
bun test tests/differential/differential.test.ts

# Run with verbose output
bun test tests/differential/differential.test.ts --verbose
```

## Comparison Strategy

1. **JSON Output**: Deep structural comparison with configurable key ignoring
2. **Text Output**: Line-by-line comparison with whitespace normalization
3. **Exit Codes**: Both must succeed or both must fail
4. **File Output**: Compare generated files when applicable

## Tolerance Settings

- **Timestamp fields**: Ignored by default
- **Execution time**: Ignored by default
- **Array ordering**: Can be normalized if order doesn't matter
- **Floating point**: Configurable epsilon for numeric comparisons
- **Path separators**: Normalized to forward slashes

## Known Differences

Document any expected/acceptable differences here:

1. **Output format**: Python uses `snake_case`, TypeScript uses `camelCase` for JSON keys
2. **Timestamps**: Different precision/format
3. **Error messages**: May have different wording but same semantic meaning
