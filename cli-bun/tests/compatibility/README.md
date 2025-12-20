# Compatibility Test Suite

## Overview

The compatibility test suite provides comprehensive validation that the Bun CLI implementation produces equivalent outputs and behavior to the Python CLI implementation. This ensures complete parity between the two implementations across all command categories, validation rules, export formats, and error handling.

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

**Test Scenarios:**
- `init` - Model initialization with various options
- `element add` - Adding elements to different layers
- `element list` - Listing elements with filters
- `element show` - Displaying element details
- `element search` - Searching elements by name/properties
- `--help` and `--version` - Help and version output
- Error handling - Invalid arguments and missing models

**Coverage:**
- ✅ Command success paths
- ✅ Error exit codes
- ✅ Output formatting consistency
- ✅ Argument validation

### 3. **Validation Equivalence Tests** (`validation.test.ts`)

Ensures both CLIs perform identical validation on models.

**Test Scenarios:**
- **Schema Validation** - JSON schema compliance checking
- **Naming Validation** - Element ID format enforcement
- **Reference Validation** - Cross-layer reference integrity
- **Layer-Specific Validation** - Single and multi-layer validation
- **Error Counting** - Identical error/warning counts

**Coverage:**
- ✅ Valid model acceptance
- ✅ Invalid model rejection
- ✅ Error message consistency
- ✅ Reference integrity checking

### 4. **Export Format Tests** (`export.test.ts`)

Validates semantic equivalence of exported outputs.

**Supported Formats:**
- **ArchiMate XML** (Layers 1, 2, 4, 5)
- **OpenAPI JSON** (Layer 6)
- **JSON Schema** (Layer 7)
- **PlantUML** (Diagrams)
- **Markdown** (Documentation)
- **GraphML** (Graph visualization)

**Comparison Methods:**
- JSON: Deep structural comparison
- XML: Normalized whitespace and attribute comparison
- Text: Semantic similarity checking

**Coverage:**
- ✅ Full model export
- ✅ Layer-filtered export
- ✅ File generation consistency
- ✅ Format-specific validation

### 5. **API Response Tests** (`api.test.ts`)

Compares JSON API responses from visualization servers.

**Test Scenarios:**
- Model serialization (`/api/model`)
- Layer data (`/api/layers/:name`)
- Element details (`/api/elements/:id`)
- Error responses (404, invalid inputs)
- Data consistency between CLIs

**Note:** Server-based tests are marked as `.skip` for CI/CD environments where running long-lived server processes may not be practical. They can be enabled in dedicated integration test environments.

**Coverage:**
- ✅ Response structure parity
- ✅ Data serialization consistency
- ✅ Error response matching

### 6. **Edge Case Tests** (`edge-cases.test.ts`)

Validates behavior in edge cases and error scenarios.

**Test Scenarios:**
- Missing required arguments
- Invalid argument values
- Special characters in names
- Unicode handling
- Command case sensitivity
- Absolute vs. relative paths
- Output format options
- Empty/null value handling
- Sequential operations
- Error message structure

**Coverage:**
- ✅ Input validation consistency
- ✅ Character encoding handling
- ✅ Path resolution consistency
- ✅ Graceful error handling
- ✅ State consistency

## Running the Tests

### Run All Compatibility Tests
```bash
npm run test:compatibility
```

### Run Specific Test Suite
```bash
# Command output tests
npm run test:compatibility:commands

# Validation tests
npm run test:compatibility:validation

# Export tests
npm run test:compatibility:export

# API tests
npm run test:compatibility:api

# Edge case tests
npm run test:compatibility:edge-cases
```

### Run All Tests (Including Unit Tests)
```bash
npm run test:all
```

## Test Environment Setup

The test harness automatically:
1. Creates temporary test directories (`/tmp/dr-compatibility-*`)
2. Initializes fresh models for each test
3. Manages both Python and Bun CLI processes
4. Cleans up temporary files after each test

**Requirements:**
- Python CLI installed at `/home/orchestrator/.local/bin/dr` (or adjust `CLIHarness` constructor)
- Bun CLI built and available at `dist/cli.js`
- Write access to `/tmp` directory

## Accessing Both CLIs

### Python CLI
The harness expects the Python CLI to be installed in the system PATH or at a specific location:
```typescript
const harness = new CLIHarness(
  '/home/orchestrator/.local/bin/dr',  // Python CLI path
  'node dist/cli.js'                    // Bun CLI path
);
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

## Known Intentional Differences

While the test suite expects output equivalence, some minor differences may be acceptable:

1. **Formatting:** Whitespace, indentation, line breaks
2. **Color Codes:** Terminal colors (stripped during comparison)
3. **Timestamps:** If any output contains timestamps
4. **File Paths:** Platform-specific path separators
5. **Error Messages:** Minor wording differences allowed if meaning is same

## CI/CD Integration

The compatibility tests are designed for automated CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Build Bun CLI
  run: npm run build

- name: Run Compatibility Tests
  run: npm run test:compatibility
```

## Troubleshooting

### Python CLI Not Found
**Error:** `Error running Python CLI: command not found`

**Solution:** Update the Python CLI path in `harness.ts` constructor:
```typescript
const harness = new CLIHarness(
  '/path/to/python/dr',  // Update this path
  'node dist/cli.js'
);
```

### Permission Denied
**Error:** `EACCES: permission denied`

**Solution:** Ensure execute permissions on CLI:
```bash
chmod +x /home/orchestrator/.local/bin/dr
chmod +x dist/cli.js
```

### Temp Directory Issues
**Error:** `ENOENT: no such file or directory`

**Solution:** Ensure `/tmp` exists and is writable:
```bash
mkdir -p /tmp
chmod 777 /tmp
```

## Test Statistics

### Coverage
- **Commands:** 20+ scenarios
- **Validation:** 15+ test cases
- **Export Formats:** 6 formats tested
- **API Endpoints:** 10+ endpoints
- **Edge Cases:** 20+ scenarios

### Total Tests: 60+

## Contributing

When adding new functionality to either CLI:

1. **Add compatibility test first** (test-driven)
2. **Implement in Python CLI** (reference implementation)
3. **Implement in Bun CLI** (new implementation)
4. **Run test suite** to verify parity
5. **Update tests** if behavior changes intentionally

## Test Maintenance

- Review test results regularly
- Update tests when CLI behavior changes
- Document intentional behavioral differences
- Keep both CLI implementations in sync
- Monitor for performance regressions

## Related Documentation

- [CLI Architecture](../../README.md)
- [Python CLI](../../../../cli/README.md)
- [Bun CLI Implementation Guide](../../README.md)
- [Testing Strategy](./TESTING.md)
