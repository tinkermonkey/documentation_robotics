# Compatibility Test Suite

## Overview

The compatibility test suite provides comprehensive validation that the Bun CLI implementation produces equivalent outputs and behavior to the Python CLI implementation. This ensures complete parity between the two implementations across all command categories, validation rules, export formats, and error handling.

**Note:** As of the Python CLI deprecation phase (December 2025), these tests document the expected behavior that was validated against the Python CLI. The test infrastructure remains valuable for:

- Validating Bun CLI behavior consistency
- Regression testing during Bun CLI development
- Documentation of expected command behavior and output formats

## Test Suite Statistics

### Total Test Coverage: 243 Tests

| Category           | Tests | Coverage                                                    |
| ------------------ | ----- | ----------------------------------------------------------- |
| **Commands**       | 100   | All 21 essential commands                                   |
| **Validation**     | 40    | All 4 validator types (schema, naming, reference, semantic) |
| **Export Formats** | 24    | All 6 export formats                                        |
| **API Endpoints**  | 29    | Visualization API + WebSocket                               |
| **Model Files**    | 28    | CRUD operations across all 12 layers                        |
| **Edge Cases**     | 20    | Error handling and special cases                            |
| **Diagnostics**    | 2     | Debugging tools                                             |

### Coverage by Task Group

- **Task Group 2** (Commands): 100 tests - ✅ COMPLETE
- **Task Group 3** (Validators): 40 tests - ✅ COMPLETE
- **Task Group 4** (Export Formats): 24 tests - ✅ COMPLETE
- **Task Group 5** (API): 29 tests - ✅ COMPLETE
- **Task Group 6** (Model Files): 28 tests - ✅ COMPLETE

## Test Structure

### 1. **Test Harness** (`harness.ts`)

The core testing infrastructure that manages dual CLI execution and output comparison.

**Key Components:**

- `CLIHarness` - Main test harness class
- `CLIResult` - Interface for CLI execution results
- `ComparisonResult` - Detailed comparison data between Python and Bun outputs

**Core Methods:**

```typescript
// Run CLIs with identical arguments
async runPython(args: string[], cwd?: string): Promise<CLIResult>
async runBun(args: string[], cwd?: string): Promise<CLIResult>

// Compare outputs from both CLIs
async compareOutputs(args: string[], cwd?: string): Promise<ComparisonResult>

// Compare generated files
async compareFileOutputs(
  args: string[],
  outputPath: string,
  cwd?: string,
  fileExtension?: string
): Promise<{ pythonFile: string; bunFile: string; match: boolean; ... }>
```

**Output Normalization:**

- Removes ANSI color codes
- Normalizes whitespace
- Handles line ending differences
- Converts path separators for consistency

## Test Categories

### 2. **Command Output Tests** (`commands.test.ts`)

Validates that CLI commands produce equivalent outputs for all major operations.

**100 Test Scenarios Covering:**

**Core Commands (21 tests):**

- `init` - Model initialization with various options (3 tests)
- `add` - Adding elements to different layers (15 tests covering all 12 layers)
- `update` - Modifying element properties (2 tests)
- `delete` - Removing elements (1 test)

**Query Commands (20 tests):**

- `list` - Listing elements with filters (8 tests)
- `search` - Searching elements by name/properties (5 tests)
- `trace` - Tracing dependencies (4 tests)
- `validate` - Model validation (3 tests)

**Relationship Commands (12 tests):**

- `relationship add` - Adding relationships (4 tests)
- `relationship remove` - Removing relationships (2 tests)
- `relationship list` - Listing relationships (6 tests)

**Project Commands (15 tests):**

- `project` - Project metadata (5 tests)
- `changeset` - Changeset management (4 tests)
- `migrate` - Model migration (3 tests)
- `upgrade` - Version upgrades (3 tests)

**Export Commands (12 tests):**

- `export archimate` (2 tests)
- `export openapi` (2 tests)
- `export json-schema` (2 tests)
- `export plantuml` (2 tests)
- `export markdown` (2 tests)
- `export graphml` (2 tests)

**Utility Commands (10 tests):**

- `--help` - Help output (3 tests)
- `--version` - Version output (2 tests)
- `conformance` - Conformance checking (3 tests)
- `visualize` - Server startup (2 tests)

**Error Handling (10 tests):**

- Invalid arguments (3 tests)
- Missing models (2 tests)
- Malformed input (3 tests)
- Permission errors (2 tests)

**Coverage:**

- ✅ Command success paths
- ✅ Error exit codes
- ✅ Output formatting consistency
- ✅ Argument validation
- ✅ All 21 essential commands tested

### 3. **Validation Equivalence Tests** (`validation.test.ts`)

Ensures both CLIs perform identical validation on models.

**40 Test Scenarios Covering:**

**Schema Validation (12 tests):**

- Valid element schema acceptance (12 layers)
- Invalid schema rejection
- Error message format

**Naming Validation (8 tests):**

- Valid naming pattern: `{layer}-{type}-{kebab-case-name}`
- Invalid patterns: missing layer, invalid format, special characters
- Unicode handling
- Error messages

**Reference Validation (10 tests):**

- Valid cross-layer references (higher → lower)
- Invalid reference detection (non-existent targets)
- Circular dependency detection
- Reference integrity checks across all layers

**Semantic Validation (6 tests):**

- Layer-specific business rules
- API endpoint validation
- Data model constraints
- Navigation route validation

**Error Reporting (4 tests):**

- Error message consistency
- Exit code matching
- JSON output format
- Error count accuracy

**Coverage:**

- ✅ Valid model acceptance
- ✅ Invalid model rejection
- ✅ Error message consistency
- ✅ Reference integrity checking
- ✅ All 4 validator types tested

### 4. **Export Format Tests** (`export.test.ts`)

Validates semantic equivalence of exported outputs.

**24 Test Scenarios Covering:**

**ArchiMate XML Export (4 tests):**

- Motivation layer (Layer 1)
- Business layer (Layer 2)
- Application layer (Layer 4)
- Technology layer (Layer 5)
- XML structure and ArchiMate 3.2 compliance

**OpenAPI JSON Export (4 tests):**

- API layer (Layer 6) export
- OpenAPI 3.0 compliance
- Endpoint definitions
- Schema definitions

**JSON Schema Export (4 tests):**

- Data Model layer (Layer 7)
- JSON Schema Draft 7 compliance
- Entity definitions
- Relationship schemas

**PlantUML Export (3 tests):**

- Diagram generation for all layers
- PlantUML syntax correctness
- Visual representation elements

**Markdown Export (3 tests):**

- Documentation export
- Formatting consistency
- Content completeness

**GraphML Export (3 tests):**

- Graph visualization export
- Node/edge structure
- Dependency representation

**Error Handling (3 tests):**

- Invalid layer exports
- Format-specific errors
- Missing elements

**Coverage:**

- ✅ Full model export
- ✅ Layer-filtered export
- ✅ File generation consistency
- ✅ Format-specific validation
- ✅ All 6 export formats tested

### 5. **API Response Tests** (`api.test.ts`)

Compares JSON API responses from visualization servers and validates data serialization.

**29 Test Scenarios Covering:**

**Model Endpoint (4 tests):**

- `/api/model` - Full model metadata
- Response structure validation
- Manifest data completeness
- Statistics calculation

**Layer Endpoints (4 tests):**

- `/api/layers/:name` - Individual layer data
- Element arrays
- Layer metadata
- Filtering capabilities

**Element Endpoints (4 tests):**

- `/api/elements/:id` - Element details
- Relationship data
- Reference data
- Property completeness

**WebSocket API (4 tests):**

- Real-time update notifications
- Message format consistency
- Connection lifecycle
- Subscription management

**Error Responses (4 tests):**

- 404 for non-existent resources
- 400 for invalid requests
- Error message format
- Status code consistency

**Data Consistency (9 tests):**

- Model structure serialization
- Layer data serialization
- Element data with all fields
- JSON response structure parity
- API endpoint documentation
- WebSocket message types
- API specification compliance
- Annotation API differences
- Specification coverage gaps

**Note:** Server-based tests are marked as `.skip` for CI/CD environments where running long-lived server processes may not be practical. They can be enabled in dedicated integration test environments.

**Coverage:**

- ✅ Response structure parity
- ✅ Data serialization consistency
- ✅ Error response matching
- ✅ WebSocket functionality
- ✅ API specification compliance documented

### 6. **Model File Structure Tests** (`model-files.test.ts`)

Validates that identical commands produce identical (or semantically equivalent) model file structures.

**28 Test Scenarios Covering:**

**Element Creation (12 tests):**

- Add elements to all 12 layers
- Element JSON structure validation
- Field completeness (id, name, type, description, properties)

**Element Updates (4 tests):**

- Property updates
- Description changes
- Metadata modifications
- Timestamp handling

**Relationship Operations (4 tests):**

- Add relationships
- Remove relationships
- Relationship arrays structure
- Reference integrity

**Element Deletion (3 tests):**

- Element removal from layer files
- Orphaned reference cleanup
- Relationship cleanup

**Manifest Operations (3 tests):**

- Version updates
- Name/description changes
- Timestamp formatting

**Migration Operations (2 tests):**

- Model migration
- Version upgrade
- Backwards compatibility

**Coverage:**

- ✅ All CRUD operations
- ✅ All 12 layers
- ✅ Manifest updates
- ✅ Migration compatibility
- ✅ File format consistency

### 7. **Edge Case Tests** (`edge-cases.test.ts`)

Validates behavior in edge cases and error scenarios.

**20 Test Scenarios Covering:**

**Input Validation (6 tests):**

- Missing required arguments
- Invalid argument values
- Empty/null values
- Type mismatches

**Character Encoding (4 tests):**

- Special characters in names
- Unicode handling
- Escape sequences
- Emoji support

**Path Resolution (3 tests):**

- Absolute paths
- Relative paths
- Path normalization

**Output Formatting (3 tests):**

- JSON output
- Table output
- Plain text output

**State Consistency (4 tests):**

- Sequential operations
- Concurrent operations
- Error recovery
- Rollback behavior

**Coverage:**

- ✅ Input validation consistency
- ✅ Character encoding handling
- ✅ Path resolution consistency
- ✅ Graceful error handling
- ✅ State consistency

## Running the Tests

### Prerequisites

1. **Build the Bun CLI:**

   ```bash
   cd cli-bun
   npm install
   npm run build
   ```

2. **Python CLI (Optional):**
   - For full compatibility testing (comparing Python vs Bun)
   - Install Python CLI: `cd cli && pip install -e .`
   - If Python CLI not available, tests will document expected behavior

### Run All Unit Tests

Tests Bun CLI functionality independently (300 tests):

```bash
npm run test:unit
```

**Expected output:**

```
300 pass
0 fail
Ran 300 tests across 22 files. [~700ms]
```

### Run Compatibility Tests

Tests that compare Python and Bun CLI outputs (243 tests):

```bash
# Run all compatibility tests
npm run test:compatibility

# Or run specific test category
bun test ./tests/compatibility/commands.test.ts
bun test ./tests/compatibility/validation.test.ts
bun test ./tests/compatibility/export.test.ts
bun test ./tests/compatibility/api.test.ts
bun test ./tests/compatibility/model-files.test.ts
bun test ./tests/compatibility/edge-cases.test.ts
```

### Run All Tests

Runs both unit tests and compatibility tests:

```bash
npm test
```

## Test Reliability

### Unit Test Reliability (Bun CLI Only)

**Test Runs:** 5 consecutive executions
**Pass Rate:** 100% (300/300 tests pass every time)
**Execution Time:** ~700-900ms per run
**Flaky Tests:** 0

**Results:**

```
Run 1: 300 pass, 0 fail [723ms]
Run 2: 300 pass, 0 fail [714ms]
Run 3: 300 pass, 0 fail [721ms]
Run 4: 300 pass, 0 fail [722ms]
Run 5: 300 pass, 0 fail [715ms]
```

### Compatibility Test Status

**Note:** Compatibility tests require both Python CLI and Bun CLI to be available. As of the deprecation phase:

- **With Python CLI:** Tests validate output parity between implementations
- **Without Python CLI:** Tests document expected behavior and validate Bun CLI functionality

**Known Test States:**

- Some tests may fail if Python CLI is not installed
- Tests with `.skip` annotation are documented but not executed (e.g., server-based API tests)
- All test infrastructure is in place and reliable when both CLIs are available

## Test Environment Setup

The test harness automatically:

1. Creates temporary test directories (`/tmp/dr-compatibility-*`)
2. Initializes fresh models for each test
3. Manages both Python and Bun CLI processes (when both available)
4. Cleans up temporary files after each test

**Requirements:**

- Node.js 18+ and Bun runtime
- Bun CLI built and available at `dist/cli.js`
- Python CLI (optional, for full compatibility validation)
- Write access to `/tmp` directory

## Accessing Both CLIs

### Python CLI (Optional)

The harness expects the Python CLI to be installed in the system PATH or at a specific location:

```typescript
const harness = new CLIHarness(
  process.env.DR_PYTHON_CLI || "dr", // Python CLI path
  "node dist/cli.js" // Bun CLI path
);
```

Set environment variable to use custom Python CLI location:

```bash
export DR_PYTHON_CLI=/path/to/python/dr
```

### Bun CLI

The Bun CLI is accessed via Node.js from the built `dist/` directory:

```bash
node dist/cli.js [args]
```

## Output Comparison Strategy

### Exit Code Matching

- Both CLIs must exit with the same code (0 for success, non-zero for errors)
- Allows flexibility in exact exit code values (any non-zero = failure)

### Stdout/Stderr Comparison

- **Exact:** Exit codes must match
- **Normalized:** Output compared after:
  - Removing ANSI color codes
  - Normalizing whitespace
  - Standardizing line endings
  - Converting path separators

### File Comparison

- **JSON:** Deep structural comparison (ignoring formatting)
- **XML:** Structure comparison (ignoring attribute order and whitespace)
- **Text:** Normalized string comparison

### Model File Comparison

**Semantic Equivalence Approach:**

Model files are compared using semantic equivalence rather than byte-for-byte matching:

1. **Timestamp Tolerance:** Timestamps may differ by milliseconds
2. **Property Order:** JSON property order may vary
3. **Formatting:** Indentation and whitespace may differ
4. **Null vs Undefined:** Missing optional fields treated as equivalent

**Command Adapter Layer:**

Due to CLI interface differences, a command adapter layer translates commands:

- Python: `dr init <name>`
- Bun: `dr init --name <name>`

The adapter is located in `command-adapters.ts` and handles argument syntax translation.

## Known Intentional Differences

While the test suite expects output equivalence, some minor differences are acceptable:

1. **Formatting:** Whitespace, indentation, line breaks
2. **Color Codes:** Terminal colors (stripped during comparison)
3. **Timestamps:** Millisecond-level precision differences
4. **File Paths:** Platform-specific path separators
5. **Error Messages:** Minor wording differences allowed if meaning is same
6. **Command Interface:** Positional vs. flag-based arguments (handled by adapter)

## Troubleshooting

### Python CLI Not Found

**Error:** `Error running Python CLI: ENOENT`

**Solution 1:** Install Python CLI:

```bash
cd cli
pip install -e .
```

**Solution 2:** Set environment variable:

```bash
export DR_PYTHON_CLI=/path/to/python/dr
```

**Solution 3:** Run Bun-only tests:

```bash
npm run test:unit  # Tests Bun CLI independently
```

### Bun CLI Not Built

**Error:** `ENOENT: no such file or directory, posix_spawn 'node /Users/.../dist/cli.js'`

**Solution:**

```bash
npm run build
```

### Permission Denied

**Error:** `EACCES: permission denied`

**Solution:** Ensure execute permissions on CLI:

```bash
chmod +x dist/cli.js
# If using Python CLI:
chmod +x /path/to/dr
```

### Temp Directory Issues

**Error:** `ENOENT: no such file or directory`

**Solution:** Ensure `/tmp` exists and is writable:

```bash
mkdir -p /tmp
chmod 777 /tmp
```

### Test Timeouts

**Error:** `Test timeout exceeded`

**Solution:** Increase timeout in test file or run tests individually:

```bash
# Run single test file
bun test ./tests/compatibility/commands.test.ts

# Or increase timeout globally
CLI_TIMEOUT=60000 npm run test:compatibility
```

## CI/CD Integration

The compatibility tests are designed for automated CI/CD pipelines:

### GitHub Actions Example

```yaml
name: Compatibility Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm install
        working-directory: cli-bun

      - name: Build Bun CLI
        run: npm run build
        working-directory: cli-bun

      - name: Run unit tests
        run: npm run test:unit
        working-directory: cli-bun

      - name: Setup Python (optional, for full compatibility)
        uses: actions/setup-python@v4
        with:
          python-version: "3.10"

      - name: Install Python CLI (optional)
        run: pip install -e .
        working-directory: cli

      - name: Run compatibility tests
        run: npm run test:compatibility
        working-directory: cli-bun
```

### GitLab CI Example

```yaml
test:
  stage: test
  image: node:18
  script:
    - cd cli-bun
    - npm install
    - npm run build
    - npm run test:unit
    - npm run test:compatibility
  artifacts:
    reports:
      junit: cli-bun/test-results.xml
```

## Test Maintenance

### Adding New Tests

When adding new functionality to the Bun CLI:

1. **Add test first** (test-driven development)
2. **Implement in Bun CLI**
3. **Run test suite** to verify functionality
4. **Update test counts** in this README

### Test File Structure

Each test file should:

- Use descriptive test names
- Group related tests with `describe` blocks
- Clean up resources in `afterEach` hooks
- Document expected behavior in test descriptions

### Updating Tests

When CLI behavior changes intentionally:

1. Update affected tests
2. Document the change in test comments
3. Update this README if coverage changes
4. Run full test suite to ensure no regressions

## Test Coverage Metrics

### By Category

| Category    | Total Tests | Pass Rate (Bun Only)          | Coverage                 |
| ----------- | ----------- | ----------------------------- | ------------------------ |
| Commands    | 100         | 100% (unit tests)             | All 21 commands          |
| Validation  | 40          | 100% (unit tests)             | All 4 validators         |
| Export      | 24          | 100% (unit tests)             | All 6 formats            |
| API         | 29          | Varies (server tests skipped) | All endpoints documented |
| Model Files | 28          | Infrastructure complete       | All CRUD ops             |
| Edge Cases  | 20          | 100% (unit tests)             | Major edge cases         |
| **Total**   | **243**     | **~85%**                      | **Comprehensive**        |

### By Layer Coverage

All 12 layers are tested:

- ✅ Motivation (Layer 1)
- ✅ Business (Layer 2)
- ✅ Security (Layer 3)
- ✅ Application (Layer 4)
- ✅ Technology (Layer 5)
- ✅ API (Layer 6)
- ✅ Data Model (Layer 7)
- ✅ Data Store (Layer 8)
- ✅ UX (Layer 9)
- ✅ Navigation (Layer 10)
- ✅ APM (Layer 11)
- ✅ Testing (Layer 12)

## Related Documentation

- [Bun CLI README](../../README.md)
- [Python CLI README](../../../../cli/README.md) (legacy)
- [Command Parity Checklist](../../../../agent-os/specs/2025-12-26-python-cli-deprecation/command-parity-checklist.md)
- [Migration Guide](../../../../docs/migration-from-python-cli.md) (to be created)
- [API Specification](../../../../docs/api-spec.yaml)

## Contributing

Contributions to the test suite are welcome! Please:

1. Follow existing test patterns
2. Add tests for new features
3. Ensure all tests pass before submitting PR
4. Update this README with new test counts
5. Document any new test categories

## Support

For issues with the compatibility test suite:

1. Check [Troubleshooting](#troubleshooting) section above
2. Review test output for specific error messages
3. Open an issue on GitHub with test failure details
4. Include environment information (OS, Node version, CLI versions)
