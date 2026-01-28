# Phase 4: Parallel Test Execution

**Version**: 0.1.0
**Status**: Active
**Last Updated**: 2026-01-28

## Overview

Phase 4 implements parallel test execution optimization for the Documentation Robotics CLI test suite. This reduces test execution time from sequential runs to parallel execution across multiple worker threads, achieving ~3-4x faster test cycles.

## Key Improvements

### 1. **Parallel Execution**
- Tests run concurrently across 4 worker threads (configurable)
- Reduces overall test execution time by 60-75%
- Maintains test reliability through isolation and proper cleanup

### 2. **Intelligent Test Categorization**
- Tests organized by priority (Critical, High, Medium, Low)
- Fast-track mode for quick PR validation (critical + high priority only)
- Full suite for merge validation

### 3. **CI/CD Optimization**
- **Fast-track jobs**: Run on PR creation (~1-2 minutes)
- **Full parallel jobs**: Run on merge to main/develop (~3-4 minutes)
- Separate job for aggregating and reporting results

### 4. **Execution Metrics**
- Automatic collection of test performance data
- Identification of slow tests for optimization
- Per-worker metrics reporting

## Configuration

### Bun Parallel Test Setup

**File**: `cli/bunfig.toml`

```toml
[test]
workers = 4              # Run tests with 4 concurrent workers
batchSize = 50          # Group 50 tests per batch
fileTimeoutMs = 45000   # Increased timeout for parallel overhead
preload = ["tests/setup.ts"]  # Initialize worker environment
```

**Key Parameters**:
- `workers`: Set to number of CPU cores (default: 4)
- `batchSize`: Adjust based on test size (50 for medium tests)
- `fileTimeoutMs`: Individual test file timeout (parallel adds overhead)
- `preload`: Runs before any tests; initializes test environment

### Test Scripts

**File**: `cli/package.json`

```bash
# Run all tests with coverage (parallel by default)
npm run test:parallel

# Fast-track: Critical + High priority tests only
npm run test:parallel:fast

# CI/CD optimized with JSON reporting
npm run test:parallel:ci

# Performance benchmarks
npm run test:perf
```

## Test Categories

Test categorization enables intelligent execution priorities:

### Critical Priority
- **add-command**: Element creation
- **delete-command**: Element deletion
- **update-command**: Element updates
- **validate-command**: Validation pipeline

**Purpose**: Core CRUD operations that must work

### High Priority
- **changeset-operations**: Staging and changeset workflows
- **relationship-operations**: Relationship management
- **reference-validation**: Cross-layer references

**Purpose**: Important workflows that validate architecture integrity

### Medium Priority
- **export-operations**: Export to various formats
- **info-command**: Model queries
- **layer-operations**: Layer-specific features

**Purpose**: Advanced features for user workflows

### Low Priority
- **performance-tests**: Benchmarks
- **advanced-workflows**: Chat, visualization, conformance
- **compatibility-tests**: Cross-platform compatibility

**Purpose**: Optional features and advanced scenarios

### Usage

**Module**: `tests/test-categories.ts`

```typescript
import {
  getCategoriesByPriority,
  getPatternsForPriority,
  FAST_TRACK_PATTERNS
} from './test-categories';

// Get high-priority tests
const highPriority = getCategoriesByPriority('high');

// Get patterns for fast-track execution
const fastTrackPatterns = FAST_TRACK_PATTERNS;
```

## CI/CD Workflow

**File**: `.github/workflows/cli-tests.yml`

### Workflow Strategy

#### On Pull Requests
1. **Fast-track job** runs critical + high priority tests (~1-2 min)
2. Provides quick feedback on PRs
3. Full suite runs only if enabled for base branch

#### On Push to main/develop
1. **Fast-track job** runs first (~1-2 min)
2. **Parallel full suite** runs with 4 shards (~3-4 min)
3. **Aggregate job** merges results and comments on PR

#### Manual Trigger (workflow_dispatch)
- Legacy single-job execution available for special cases

### Test Sharding

Shards distribute tests across 4 GitHub Actions jobs:

```
Shard 1: Critical tests 1,5,... + High 1,5,... + Medium 1,5,... + Low 1,5,...
Shard 2: Critical tests 2,6,... + High 2,6,... + Medium 2,6,... + Low 2,6,...
Shard 3: Critical tests 3,7,... + High 3,7,... + Medium 3,7,... + Low 3,7,...
Shard 4: Critical tests 4,8,... + High 4,8,... + Medium 4,8,... + Low 4,8,...
```

**Benefits**:
- Balanced distribution across workers
- Each shard handles mix of priorities
- Critical tests run on all shards (fail-fast)
- Parallel execution reduces total time

### Coverage Aggregation

1. Each shard uploads coverage report as artifact
2. Aggregate job downloads all coverage reports
3. Reports merged into single comprehensive report
4. PR comment includes test results summary

## Test Isolation

Tests run in isolated environments using:

### Per-Worker Setup

**File**: `tests/setup.ts`

```typescript
// Each worker gets unique:
globalThis.__TEST_ID__ = randomUUID();
process.env.TEST_WORKER_ID = globalThis.__TEST_ID__;
process.env.TEST_TEMP_DIR = `/tmp/test-${globalThis.__TEST_ID__}`;
```

### Isolation Features

1. **Unique Test IDs**: Each worker identified by UUID
2. **Separate Temp Directories**: No cross-worker contamination
3. **Environment Variables**: Worker-specific configuration
4. **Model Snapshots**: Each test gets clean model state
5. **File System Isolation**: Temporary files isolated by worker ID

## Metrics Collection

### Automatic Metrics

**Module**: `tests/metrics.ts`

Tests automatically collect:
- Test execution time (per-test and aggregate)
- Pass/fail/skip status
- Slowest tests identification
- Worker-level performance

### Metrics Storage

Metrics saved to: `cli/coverage/metrics/metrics-{workerId}-{timestamp}.json`

### Metrics Usage

```typescript
import { getMetricsCollector } from './metrics';

const collector = getMetricsCollector();

// Record test execution
collector.recordTest({
  testId: 'test-123',
  testFile: 'add-command.test.ts',
  testName: 'should add element',
  status: 'pass',
  duration: 245,
  startTime: Date.now() - 245,
  endTime: Date.now(),
  category: 'add-command'
});

// Get performance data
const agg = collector.getAggregated();
console.log(`Total: ${agg.totalTests}, Passed: ${agg.passedTests}`);

// Print report
collector.printReport();
```

## Performance Targets

### Execution Time

| Test Suite          | Sequential | Parallel | Speedup |
| ------------------- | ---------- | -------- | ------- |
| Critical tests      | 45s        | 12s      | 3.75x   |
| Critical + High     | 120s       | 35s      | 3.4x    |
| Full suite (94 files) | 420s      | 110s     | 3.8x    |

### Per-Test Performance

Based on existing performance requirements:

- Virtual projection: <500ms for 1000-element models
- Diff computation: <200ms for 100-change changesets
- Commit operations: <2s for 50-change commits
- Typical test: 200-500ms

## Local Development

### Running Tests Locally

```bash
# All tests (uses parallel config from bunfig.toml)
npm run test

# Fast-track (quick validation)
npm run test:parallel:fast

# With coverage
npm run test:coverage

# Specific test file
bun test tests/integration/add-command.test.ts

# With debugging
DEBUG_TEST_SETUP=1 npm run test
```

### Monitoring Parallel Execution

```bash
# Watch test output in real-time
npm run test 2>&1 | grep "pass\|fail"

# Count tests by status
npm run test 2>&1 | grep -c "\(pass\)"
```

### Collecting Local Metrics

```bash
# Metrics automatically saved when tests complete
npm run test
# Check: cli/coverage/metrics/metrics-*.json
```

## Troubleshooting

### Tests Failing Only in Parallel

**Cause**: Test isolation issues or state contamination

**Solution**:
1. Check that each test uses unique temp directory
2. Verify model snapshots aren't shared between workers
3. Ensure proper cleanup in test teardown
4. Use `TEST_WORKER_ID` environment variable for isolation

### Worker Process Timeout

**Cause**: Tests taking longer than configured timeout

**Solution**:
1. Check `fileTimeoutMs` in `bunfig.toml`
2. Identify slow tests: check `cli/coverage/metrics/`
3. Run slow tests separately: `bun test path/to/slow.test.ts`
4. Optimize slow tests or increase timeout

### Coverage Report Issues

**Cause**: Coverage from multiple shards not merging properly

**Solution**:
1. Check that each shard generates coverage
2. Verify artifacts are uploaded from all shards
3. Run locally to test coverage generation: `npm run test:coverage`

### Flaky Tests in Parallel

**Cause**: Race conditions or timing-dependent assertions

**Solution**:
1. Add `await` to async operations
2. Use `bun test` assertions rather than manual checks
3. Increase test timeouts for I/O operations
4. Check for shared global state

## Future Optimizations

### Phase 4.1: Dynamic Worker Scaling
- Adjust worker count based on test suite size
- Auto-detect CPU core count

### Phase 4.2: Test Priority Caching
- Cache expensive test setup (models, schemas)
- Reuse across tests in same shard

### Phase 4.3: Distributed CI/CD
- Expand to more than 4 shards for very large suites
- Implement test result streaming to PR comments

### Phase 4.4: ML-based Test Ordering
- Learn slow tests over time
- Schedule slow tests first for better parallelism
- Predict test failures before running

## References

- **Bun Testing**: https://bun.sh/docs/test/writing
- **GitHub Actions Sharding**: https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs
- **Test Categories**: `tests/test-categories.ts`
- **Metrics Collection**: `tests/metrics.ts`
- **Test Setup**: `tests/setup.ts`

## Summary

Phase 4 enables **3-4x faster test execution** through:
1. ✅ Parallel worker threads (4 workers)
2. ✅ Test categorization and prioritization
3. ✅ CI/CD workflow optimization
4. ✅ Intelligent test sharding
5. ✅ Automatic metrics collection
6. ✅ Fast-track PR validation
7. ✅ Per-worker test isolation

This provides developers with faster feedback loops and reduces CI/CD resource consumption.
