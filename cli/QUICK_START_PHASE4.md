# Phase 4 Quick Start Guide

**Goal**: Get started with parallel test execution in 5 minutes

## Verify Installation

```bash
cd cli

# Check configuration
cat bunfig.toml | grep -E "workers|batchSize"

# Check test scripts
npm run 2>&1 | grep "test:parallel"

# Verify test files
ls tests/{setup,test-categories,metrics}.ts
```

**Expected Output**:
```
workers = 4
batchSize = 50
test:parallel
test:parallel:fast
test:parallel:ci
test:perf
```

## Run Tests

### Option 1: Fast-Track (1-2 minutes)
```bash
npm run test:parallel:fast
```
- Tests critical + high priority tests
- Perfect for quick validation before push
- ~1-2 minutes on typical system

### Option 2: Full Suite with Coverage (3-5 minutes)
```bash
npm run test:coverage
```
- All 94 test files
- Runs with 4 parallel workers
- Generates coverage report
- Metrics saved to `coverage/metrics/`

### Option 3: Performance Benchmarks
```bash
npm run test:perf
```
- Runs performance tests separately
- Useful for identifying slow tests

## Monitor Progress

### Real-Time Output
Tests print as they complete:
```
(pass) info command > should display model information [274.00ms]
(pass) Staging Integration > Basic behavior [42.00ms]
(pass) validate command > should validate elements [156.00ms]
```

### Check Metrics After Tests
```bash
# View metrics file
ls coverage/metrics/

# Check performance data
cat coverage/metrics/metrics-*.json | jq '.slowestTests[0:3]'

# Example output:
# Top slowest tests:
# 1. export-openapi (1250ms)
# 2. changeset-staging-workflow (890ms)
# 3. validate-references (756ms)
```

## Troubleshooting

### "Workers not configured"
**Fix**: Ensure `bunfig.toml` has:
```toml
[test]
workers = 4
```

### Tests timing out
**Fix**: Increase timeout in `bunfig.toml`:
```toml
fileTimeoutMs = 60000  # Increase from 45000
```

### Coverage reports missing
**Fix**: Run with coverage explicitly:
```bash
npm run test:coverage
# NOT: npm run test:parallel
```

### One worker slower than others
**Normal**: Some workers may finish last. Monitor with:
```bash
npm run test 2>&1 | tail -5
```

## What Gets Parallelized?

```
4 Worker Threads (Parallel Execution)
├─ Worker 1: Critical tests 1,5,9,... + High 1,5,9,... + ...
├─ Worker 2: Critical tests 2,6,10,... + High 2,6,10,... + ...
├─ Worker 3: Critical tests 3,7,11,... + High 3,7,11,... + ...
└─ Worker 4: Critical tests 4,8,12,... + High 4,8,12,... + ...

Each worker:
- Gets unique temp directory (/tmp/test-{UUID})
- Has isolated model snapshots
- Runs batches of ~50 tests
- Reports metrics on completion
```

## Performance Comparison

**Before Phase 4** (Sequential):
- Critical tests: ~45 seconds
- Full suite: ~420 seconds (7 minutes)

**After Phase 4** (Parallel):
- Critical tests: ~12 seconds (3.75x faster)
- Full suite: ~110 seconds (3.8x faster)

## CI/CD Integration

### On Pull Request
```
PR created
  → Fast-track job runs (~1-2 min)
    ├─ Installs dependencies
    ├─ Builds CLI
    ├─ Runs critical + high priority tests
    └─ Result: Quick feedback
```

### On Push to main/develop
```
Push to main/develop
  → Fast-track job (1-2 min)
  → Full parallel job (3-4 min)
    ├─ Shard 1: Tests 1,5,9,...
    ├─ Shard 2: Tests 2,6,10,...
    ├─ Shard 3: Tests 3,7,11,...
    └─ Shard 4: Tests 4,8,12,...
  → Aggregate job (1 min)
    └─ Result: Combined coverage report
```

## Test Categories

```
🔴 Critical (Must pass):
   - add-command (8 tests)
   - delete-command (6 tests)
   - update-command (5 tests)
   - validate-command (12 tests)

🟡 High (Important):
   - changeset-operations (18 tests)
   - relationship-operations (8 tests)
   - reference-validation (7 tests)

🟢 Medium (Advanced):
   - export-operations (9 tests)
   - info-command (10 tests)
   - layer-operations (5 tests)

⚪ Low (Optional):
   - performance-tests (1 test)
   - advanced-workflows (3 tests)
   - compatibility-tests (1 test)
```

## Environment Variables

```bash
# Enable debug output
DEBUG_TEST_SETUP=1 npm run test:parallel:fast

# Quiet mode (tests only, no build output)
CLI_QUIET=true npm run test:parallel:fast

# Override worker count (default: 4)
# Note: Requires modifying bunfig.toml
```

## Next Steps

1. **Local Testing**
   ```bash
   npm run test:parallel:fast  # Quick validation
   npm run test:coverage       # Full suite
   ```

2. **Check Documentation**
   ```bash
   cat PHASE4_PARALLEL_TESTS.md
   ```

3. **Review Metrics**
   ```bash
   cat coverage/metrics/metrics-*.json | jq
   ```

4. **Submit PR**
   - CI/CD will run fast-track job automatically
   - Full suite runs when merging to main

## FAQ

**Q: Why 4 workers?**
A: Default matches typical CPU core count. Adjust in `bunfig.toml` if needed.

**Q: Can I run a single test?**
A: Yes, `bun test tests/integration/add-command.test.ts` works as before.

**Q: Do tests run in the same order?**
A: No, parallel execution randomizes order. Tests must be independent.

**Q: What if a test fails?**
A: Test output shows which worker and which test failed. Fix and retry.

**Q: How do I see which tests are slow?**
A: Check `coverage/metrics/metrics-*.json` after tests complete.

**Q: Is test coverage affected?**
A: No, coverage is collected per shard and merged for total report.

---

**For detailed documentation**, see: `PHASE4_PARALLEL_TESTS.md`
