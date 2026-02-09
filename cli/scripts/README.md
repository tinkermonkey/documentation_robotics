# CLI Test Scripts and Utilities

This directory contains helper scripts for running tests locally and generating specification instances.

## Specification Instance Generation

### Overview

The `generate-spec-instances.ts` script generates SpecLayer, SpecNode, and PredicateCatalog instances from existing layer schemas. This is part of Phase 2 of the specification refactor (#319), which creates structured, validated instances of the 12-layer architecture model.

### Quick Start

```bash
# Generate instances with validation
bun run scripts/generate-spec-instances.ts --validate

# Preview what would be generated (dry-run)
bun run scripts/generate-spec-instances.ts --dry-run

# Generate without validation (faster)
bun run scripts/generate-spec-instances.ts
```

### Features

- **Layer Extraction**: Parses all 12 layer schemas from `spec/schemas/`
- **Node Type Generation**: Creates SpecNode instances for all element types
- **Predicate Consolidation**: Consolidates predicate definitions from `common/predicates.schema.json`
- **Validation**: Validates all generated instances against Phase 1 base type schemas
- **Dry-Run Mode**: Preview output without writing files
- **Validation Report**: Generates detailed report of generation results

### Output Structure

```
spec/
├── layers/
│   ├── 01-motivation.layer.json
│   ├── 02-business.layer.json
│   └── ... (12 layer instances)
├── nodes/
│   ├── motivation/
│   │   ├── goal.node.schema.json
│   │   ├── stakeholder.node.schema.json
│   │   └── ... (motivation node types)
│   ├── business/
│   │   └── ... (business node types)
│   └── ... (12 layer directories)
├── predicates.json  (Consolidated predicate catalog)
└── generation-report.json  (Validation results)
```

### Extraction Logic

#### Layer Extraction

1. Reads all 12 layer schema files from `spec/schemas/`
2. Extracts `layerMetadata` containing catalogVersion
3. Maps layer number to canonical layer ID (e.g., "motivation", "data-model")
4. Maps layer to corresponding standard (ArchiMate 3.2, OpenAPI 3.0, etc.)
5. Creates SpecLayer instance with metadata and node type references

#### Node Type Extraction

1. For each layer schema, iterates over all `definitions`
2. For each element type (e.g., "Goal", "Stakeholder"):
   - Creates spec_node_id: `{layer}.{element-type-lowercase}`
   - Extracts attributes from type's `properties` (excluding relationship fields)
   - Maps JSON Schema property definitions to AttributeSpec format
   - Records required fields
3. Creates SpecNode instance for each type

#### Predicate Consolidation

1. Reads `spec/schemas/common/predicates.schema.json`
2. Normalizes property names to match base schema:
   - `inversePredicate` → `inverse`
   - `archimateAlignment` → `archimate_alignment`
   - `defaultStrength` → `default_strength`
3. Creates PredicateCatalog with all normalized predicates
4. Validates against `predicate-catalog.schema.json`

### Validation Report

After generation with `--validate`, the script generates `spec/generation-report.json`:

```json
{
  "timestamp": "2026-02-07T22:33:05.987Z",
  "specLayers": {
    "valid": true,
    "errors": [],
    "instanceCount": 12
  },
  "specNodes": {
    "valid": true,
    "errors": [],
    "instanceCount": 364
  },
  "specNodeRelationships": {
    "valid": true,
    "errors": [],
    "instanceCount": 0
  },
  "predicateCatalog": {
    "valid": true,
    "errors": [],
    "instanceCount": 22
  },
  "totalInstancesGenerated": 398,
  "totalInstancesValid": 398,
  "success": true
}
```

### Generation Counts

- **SpecLayers**: 12 instances (one per layer)
- **SpecNodes**: 364 instances (element types across all layers)
- **PredicateCatalog**: 1 instance with 22 predicates
- **SpecNodeRelationships**: 0 instances (deferred to Phase 3)
- **Total**: 398 instances, 100% validation pass rate

### Command-Line Options

```
--validate   : Validate generated instances against base type schemas
--dry-run    : Preview output without writing files to disk
```

### Example Usage

```bash
# Generate all instances with full validation
bun run scripts/generate-spec-instances.ts --validate

# Preview generation without touching filesystem
bun run scripts/generate-spec-instances.ts --dry-run --validate

# Generate instances (faster, no validation)
bun run scripts/generate-spec-instances.ts
```

### Testing

Unit tests verify the extraction logic:

```bash
bun test tests/unit/generation/

# Test results:
# - extract-layers.test.ts: 5 tests (layer extraction logic)
# - extract-nodes.test.ts: 5 tests (node type extraction)
# - extract-predicates.test.ts: 5 tests (predicate consolidation)
```

## Parallel Test Execution

### Overview

The CI pipeline runs tests across 4 parallel shards to optimize execution time. These scripts allow you to replicate that behavior locally.

### Quick Start

```bash
# Run all tests in parallel (4 shards, matching CI)
npm run test:parallel

# Run all tests in parallel with coverage
npm run test:parallel:coverage

# Run fast-track tests (matching PR validation)
npm run test:fast-track

# Run individual shard (useful for debugging specific shard failures)
npm run test:shard1
npm run test:shard2
npm run test:shard3
npm run test:shard4
```

### Parallel Test Script (`run-parallel-tests.sh`)

This script mimics the GitHub Actions matrix execution strategy:

**Features:**

- Distributes test files across 4 shards using modulo arithmetic
- Runs each shard in parallel as a background process
- Provides color-coded output for shard status
- Saves detailed logs for each shard
- Reports aggregate pass/fail status

**Usage:**

```bash
# Without coverage
bash scripts/run-parallel-tests.sh false

# With coverage
bash scripts/run-parallel-tests.sh true
```

**Output:**

Test results are saved to `test-results-parallel/`:

- `shard-1.log` - Shard 1 execution log
- `shard-2.log` - Shard 2 execution log
- `shard-3.log` - Shard 3 execution log
- `shard-4.log` - Shard 4 execution log

### Test Distribution Strategy

Tests are distributed using the same algorithm as CI:

```bash
# Shard N gets files where: (line_number % 4) == (N - 1)
find tests -name "*.test.ts" | sort | awk 'NR % 4 == (N-1)'
```

This ensures:

- Consistent distribution between local and CI
- Deterministic shard assignment
- Even distribution of test files

### Fast-Track Tests

The fast-track suite runs critical tests without parallelism (matching PR validation):

```bash
npm run test:fast-track
```

**Includes:**

- All unit tests
- Critical integration tests: `add-*.test.ts`, `delete-*.test.ts`, `validate-*.test.ts`

**Note:** Fast-track runs sequentially (no `--concurrent` flag) to avoid race conditions in filesystem operations and singleton state.

## Comparison: Local vs CI

| Feature               | Local (`npm run test:parallel`)        | CI (GitHub Actions)                |
| --------------------- | -------------------------------------- | ---------------------------------- |
| Parallelism           | 4 background processes                 | 4 parallel jobs (separate runners) |
| Test Distribution     | Modulo-based sharding                  | Modulo-based sharding              |
| Execution Environment | Single machine                         | 4 separate VMs                     |
| Output                | Shard logs in `test-results-parallel/` | Artifacts uploaded to GitHub       |
| Typical Runtime       | ~30-60s (depends on CPU)               | ~30-45s (dedicated runners)        |

## Debugging Shard Failures

If a shard fails in CI:

1. **Identify the failing shard** from GitHub Actions output
2. **Run that shard locally**:

   ```bash
   npm run test:shard2  # if shard 2 failed
   ```

3. **View detailed logs**:

   ```bash
   cat test-results-parallel/shard-2.log
   ```

4. **Run specific test file**:

   ```bash
   # Extract failing file from shard log, then:
   bun test tests/path/to/failing.test.ts
   ```

## Known Limitations

**Concurrent Execution Differences:**

- Some tests may exhibit race conditions when run via the parallel script that don't occur with the regular `npm test` command
- This is due to how background processes in bash handle concurrent execution vs. Bun's native `--concurrent` flag
- The regular `npm test` command is the authoritative test execution method
- Use `test:parallel` primarily for:
  - Debugging CI shard-specific failures
  - Understanding test distribution
  - Reproducing CI execution patterns locally

**When to Use Each Command:**

- `npm test` - Daily development, authoritative test results
- `npm run test:parallel` - Debugging CI shard failures, performance testing
- `npm run test:fast-track` - Quick validation during PR development
- `npm run test:shard1` - Debug specific shard failures from CI

## CI Pipeline Alignment

These scripts match the CI pipeline configuration in `.github/workflows/cli-tests.yml`:

- **Shard count**: 4 (configurable via `TOTAL_SHARDS` in script)
- **Distribution algorithm**: `awk 'NR % total == shard - 1'`
- **Concurrent execution**: `--concurrent` flag within each shard
- **Coverage support**: Optional coverage reporting

## Customization

To change the number of shards:

1. Edit `scripts/run-parallel-tests.sh`:

   ```bash
   TOTAL_SHARDS=8  # Change from 4 to 8
   ```

2. Add corresponding shard scripts to `package.json`:

   ```json
   "test:shard5": "bun test --concurrent $(find tests -name '*.test.ts' | sort | awk 'NR % 8 == 4')",
   "test:shard6": "bun test --concurrent $(find tests -name '*.test.ts' | sort | awk 'NR % 8 == 5')",
   // ... etc
   ```

3. Update `.github/workflows/cli-tests.yml` matrix:

   ```yaml
   strategy:
     matrix:
       shard: [1, 2, 3, 4, 5, 6, 7, 8]
   ```
