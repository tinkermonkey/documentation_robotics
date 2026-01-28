# Golden Copy Test Initialization Guide

## Overview

**Phase 5: Shared Golden Copy for Test Initialization** introduces an optimized test model initialization system that significantly improves test execution performance through shared model caching and efficient cloning.

### What is the Golden Copy?

The golden copy is a **canonical, pre-initialized test model** that serves as the basis for test models used across all tests. Instead of creating a new test model from scratch for each test, the golden copy is created once per test worker and then efficiently cloned for individual test use.

### Performance Benefits

- **3-4x faster test initialization** (cloning vs. creating fresh models)
- **Reduced memory overhead** in parallel execution (shared initialization)
- **Consistent test data** across all tests
- **Better cache locality** and filesystem efficiency
- Complements Phase 4's parallel execution improvements

## Quick Start

### For Test Authors: Using Golden Copy

The golden copy is **transparent** to most tests. The existing `createTestModel()` function automatically uses it when available:

```typescript
import { createTestModel } from '../helpers';

describe('My Feature', () => {
  it('should work', async () => {
    const { model, cleanup } = await createTestModel();
    // Your test code here
    await cleanup();
  });
});
```

No changes needed! The golden copy is used automatically.

### For Suite Setup: Initializing Golden Copy

In your test suite setup (optional, but recommended for best performance):

```typescript
import { initializeGoldenCopy, cleanupGoldenCopy } from '../helpers';

beforeAll(async () => {
  // Initialize golden copy with sample data
  await initializeGoldenCopy({
    warmup: true,  // Populate with canonical test elements
    eagerLoad: false  // Load layers on demand
  });
});

afterAll(async () => {
  // Clean up the golden copy cache
  await cleanupGoldenCopy();
});
```

### Alternative: Explicit Golden Copy Usage

If you want to explicitly use the golden copy with custom configuration:

```typescript
import { createTestModelWithGoldenCopy } from '../helpers';

describe('Performance-Critical Tests', () => {
  it('should run fast', async () => {
    const { model, cleanup, fromGoldenCopy } = await createTestModelWithGoldenCopy({
      useGoldenCopy: true,
      goldenCopyConfig: {
        warmup: true,
        eagerLoad: false
      }
    });

    console.log(`Using golden copy: ${fromGoldenCopy}`);
    // Your test code here
    await cleanup();
  });

  it('should use fresh model', async () => {
    // Force creation of fresh model (not cloned from golden copy)
    const { model, cleanup } = await createTestModelWithGoldenCopy({
      useGoldenCopy: false
    });
    // Your test code here
    await cleanup();
  });
});
```

## Architecture

### Components

#### 1. **GoldenCopyCacheManager** (`src/core/golden-copy-cache.ts`)

The core cache management system:

```typescript
class GoldenCopyCacheManager {
  // Singleton instance per test worker
  static getInstance(config?: GoldenCopyCacheConfig): GoldenCopyCacheManager

  // Initialize golden copy (creates or loads cached model)
  async init(): Promise<void>

  // Clone golden model for test use
  async clone(): Promise<ClonedModel>

  // Query cache status
  isInitialized(): boolean
  getStats(): GoldenCopyStats

  // Cleanup resources
  async cleanup(): Promise<void>
}
```

**Key Features:**

- **Singleton pattern**: One instance per test worker
- **Lazy initialization**: Only loads golden copy when first used
- **Filesystem caching**: Stores golden copy in temp directory
- **Statistics tracking**: Records performance metrics
- **Graceful fallback**: Falls back to fresh creation if cloning fails

#### 2. **Golden Copy Helper** (`tests/helpers/golden-copy-helper.ts`)

Convenient functions for test authors:

```typescript
// Create test model with optional golden copy
async function createTestModelWithGoldenCopy(
  options: CreateTestModelFromGoldenOptions
): Promise<{
  model: Model;
  rootPath: string;
  cleanup: () => Promise<void>;
  fromGoldenCopy: boolean;
}>

// Explicit initialization
async function initializeGoldenCopy(config?: GoldenCopyCacheConfig): Promise<void>

// Cleanup after testing
async function cleanupGoldenCopy(): Promise<void>

// Get performance statistics
function getGoldenCopyStats(): GoldenCopyStats
```

#### 3. **Test Setup Integration** (`tests/setup.ts`)

Automatic golden copy initialization on worker startup:

- Initializes golden copy cache asynchronously per worker
- Respects `DISABLE_GOLDEN_COPY` environment variable
- Supports warmup configuration via `GOLDEN_COPY_WARMUP`
- Logs setup details via `DEBUG_TEST_SETUP`

#### 4. **Test Fixtures Integration** (`tests/helpers/test-fixtures.ts`)

Enhanced `createTestModel()` function:

- Automatically detects if golden copy is available
- Clones from cache when possible
- Falls back to fresh creation seamlessly
- Respects `USE_GOLDEN_COPY` and `DISABLE_GOLDEN_COPY` environment variables

## Configuration

### Environment Variables

Control golden copy behavior via environment variables:

```bash
# Enable/disable golden copy
USE_GOLDEN_COPY=true              # Force use of golden copy
DISABLE_GOLDEN_COPY=true          # Disable golden copy entirely

# Golden copy configuration
GOLDEN_COPY_WARMUP=true           # Populate with sample data on init
GOLDEN_COPY_EAGER=true            # Eagerly load all layers

# Debugging
DEBUG_GOLDEN_COPY=true            # Log golden copy operations
DEBUG_TEST_SETUP=true             # Log test setup details
GOLDEN_COPY_STRICT=true           # Fail if golden copy fails (strict mode)
```

### Programmatic Configuration

When initializing manually:

```typescript
await initializeGoldenCopy({
  cacheDir: '/custom/cache/path',  // Custom cache location
  eagerLoad: true,                 // Load all layers upfront
  warmup: true,                    // Populate sample data
  modelOptions: {                  // Custom model options
    name: 'Custom Model',
    specVersion: '0.7.1',
    // ...
  }
});
```

## Golden Copy Contents

When `warmup: true` is used, the golden copy is populated with canonical test data:

### Motivation Layer
- `motivation.goal.golden-1`, `motivation.goal.golden-2`
- `motivation.requirement.golden-1`

### Business Layer
- `business.process.golden-1`
- `business.service.golden-1`

### Application Layer
- `application.component.golden-1`
- `application.service.golden-1`

### Technology Layer
- `technology.infrastructure.golden-1`
- `technology.platform.golden-1`

### API Layer
- `api.endpoint.golden-1` (GET /golden/1)
- `api.endpoint.golden-2` (POST /golden/2)

### Data Model Layer
- `data-model.entity.golden-1`, `data-model.entity.golden-2`

## Usage Patterns

### Pattern 1: Default Usage (Recommended)

```typescript
describe('Feature Tests', () => {
  it('should work', async () => {
    // Automatically uses golden copy if available
    const { model, cleanup } = await createTestModel();

    // Add custom elements as needed
    const element = await addTestElement(model, 'api', 'endpoint', 'api.endpoint.custom', {
      name: 'Custom Endpoint',
      properties: { method: 'GET', path: '/custom' }
    });

    // Your test code
    expect(model.getElementById('api.endpoint.custom')).toBeDefined();

    await cleanup();
  });
});
```

### Pattern 2: Suite-Level Setup

```typescript
describe('Complex Feature Suite', () => {
  let cachedModel: Model;

  beforeAll(async () => {
    // Initialize golden copy for the suite
    await initializeGoldenCopy({ warmup: true });

    // Create and cache a model for the suite
    const { model, cleanup: modelCleanup } = await createTestModel();
    cachedModel = model;

    // Save cleanup function for afterAll
    globalThis.__suiteCleanup = modelCleanup;
  });

  afterAll(async () => {
    // Cleanup
    if (globalThis.__suiteCleanup) {
      await globalThis.__suiteCleanup();
    }
    await cleanupGoldenCopy();
  });

  it('should work with suite model', async () => {
    // Reuse the cached model
    const element = cachedModel.getElementById('api.endpoint.golden-1');
    expect(element).toBeDefined();
  });
});
```

### Pattern 3: Performance Testing

```typescript
describe('Performance Characteristics', () => {
  it('should measure clone performance', async () => {
    await initializeGoldenCopy({ warmup: true });

    const times: number[] = [];

    for (let i = 0; i < 100; i++) {
      const { model, cleanup, stats } = await createTestModelWithGoldenCopy();
      times.push(stats.cloneTime);
      await cleanup();
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    console.log(`Clone performance: avg=${avg}ms, min=${min}ms, max=${max}ms`);

    // Assert performance targets
    expect(avg).toBeLessThan(50); // 50ms average clone time

    // Get and log statistics
    const stats = getGoldenCopyStats();
    console.log('Golden copy stats:', stats);

    await cleanupGoldenCopy();
  });
});
```

### Pattern 4: Conditional Golden Copy Usage

```typescript
describe('Mixed Test Suite', () => {
  it('should use golden copy for fast tests', async () => {
    const { model, fromGoldenCopy } = await createTestModelWithGoldenCopy();
    expect(fromGoldenCopy).toBe(true); // Should use golden copy
    await cleanup();
  });

  it('should use fresh model for isolation tests', async () => {
    const { model, fromGoldenCopy } = await createTestModelWithGoldenCopy({
      useGoldenCopy: false // Force fresh model
    });
    expect(fromGoldenCopy).toBe(false);
    await cleanup();
  });
});
```

## Performance Metrics

### Expected Improvements

| Operation | Before (Phase 4) | After (Phase 5) | Speedup |
|-----------|-----------------|-----------------|---------|
| Test model creation | ~40ms | ~10-15ms (clone) | 2.7-4x |
| Worker setup | ~200ms | ~150ms | 1.3x |
| Full test suite (94 files) | 110s (parallel) | 75-85s | 1.3-1.5x |

### Measuring Performance

Enable performance debugging:

```bash
DEBUG_GOLDEN_COPY=true npm run test
```

Output includes:
```
[GoldenCopy] Initialized in 45ms
[GoldenCopy] Cloned model in 12ms (clone 1)
[GoldenCopy] Cloned model in 11ms (clone 2)
[GoldenCopy] Stats: {
  initCount: 1,
  cloneCount: 94,
  totalInitTime: 45,
  totalCloneTime: 1128,
  avgInitTime: 45,
  avgCloneTime: 12.02
}
```

## Troubleshooting

### Golden Copy Not Being Used

**Issue:** Tests create fresh models instead of using golden copy.

**Solutions:**

1. **Verify initialization:**
   ```bash
   DEBUG_TEST_SETUP=true npm run test
   ```
   Look for `[Setup] Golden copy initialized` message.

2. **Check environment:**
   ```bash
   DISABLE_GOLDEN_COPY=true  # Would disable golden copy
   ```

3. **Enable strict mode to catch issues:**
   ```bash
   GOLDEN_COPY_STRICT=true npm run test
   ```

### Slow Clone Operations

**Issue:** Clone operations are slower than expected.

**Solutions:**

1. **Check system resources:**
   ```bash
   DEBUG_GOLDEN_COPY=true npm run test
   ```

2. **Verify cache location:**
   The cache is stored in the system temp directory by default. If it's on a slow filesystem, custom cache location:
   ```typescript
   await initializeGoldenCopy({
     cacheDir: '/fast/ssd/path'
   });
   ```

3. **Profile individual tests:**
   ```typescript
   const { model, cleanup, stats } = await createTestModelWithGoldenCopy();
   console.log(`Clone took ${stats.cloneTime}ms`);
   ```

### Clone Failures with Fallback

**Issue:** Golden copy clone fails, falls back to fresh creation.

**Diagnostics:**

```bash
DEBUG_GOLDEN_COPY=true npm run test
```

**Common causes:**

1. **Disk space:** Ensure enough space for cache and clones
2. **Permissions:** Verify read/write permissions on temp directory
3. **Concurrent access:** Rare race conditions with many workers

**Force fallback (for testing):**

```bash
DISABLE_GOLDEN_COPY=true npm run test
```

## Advanced Topics

### Custom Golden Copy Data

To pre-populate golden copy with custom data:

```typescript
import { Model } from '../src/core/model';
import { addTestElements } from './helpers';

async function setupCustomGoldenCopy() {
  const manager = GoldenCopyCacheManager.getInstance();

  // Don't warmup during init
  await initializeGoldenCopy({ warmup: false });

  const goldenModel = manager.getGoldenModel();

  // Add custom elements
  await addTestElements(goldenModel, 'api', [
    {
      type: 'endpoint',
      id: 'api.endpoint.custom-golden',
      name: 'Custom Golden Endpoint',
      properties: { method: 'POST', path: '/custom' }
    }
  ]);

  await goldenModel.save();
}
```

### Golden Copy Lifecycle Management

For fine-grained control:

```typescript
const manager = GoldenCopyCacheManager.getInstance();

// Initialize
await manager.init();

// Clone multiple times
const clone1 = await manager.clone();
const clone2 = await manager.clone();

// Get statistics
const stats = manager.getStats();
console.log(`Created ${stats.cloneCount} clones`);
console.log(`Average clone time: ${stats.avgCloneTime}ms`);

// Check initialization
if (manager.isInitialized()) {
  console.log('Golden copy is ready');
}

// Cleanup
await manager.cleanup();
```

## Integration with Existing Tests

### Migration Guide

Existing tests using `createTestModel()` automatically benefit from golden copy. **No changes required**.

To explicitly opt into golden copy (optional):

```typescript
// Before (still works)
const { model, cleanup } = await createTestModel();

// After (more explicit, same behavior)
const { model, cleanup } = await createTestModelWithGoldenCopy();

// With explicit control
const { model, cleanup, fromGoldenCopy } = await createTestModelWithGoldenCopy({
  useGoldenCopy: true // Optional, defaults to true
});
```

## Best Practices

1. **Always call cleanup()**
   ```typescript
   const { model, cleanup } = await createTestModel();
   try {
     // test code
   } finally {
     await cleanup();
   }
   ```

2. **Use beforeAll/afterAll for suite-level setup**
   ```typescript
   beforeAll(async () => {
     await initializeGoldenCopy({ warmup: true });
   });

   afterAll(async () => {
     await cleanupGoldenCopy();
   });
   ```

3. **Don't rely on golden copy structure for isolation**
   Each cloned model is independent. Modifications don't affect others.

4. **Monitor performance in CI/CD**
   ```typescript
   const stats = getGoldenCopyStats();
   console.log(`Golden copy performance: ${JSON.stringify(stats)}`);
   ```

5. **Use `DISABLE_GOLDEN_COPY` for debugging**
   If tests behave differently with/without golden copy:
   ```bash
   # Baseline with golden copy
   npm run test

   # Debug without golden copy
   DISABLE_GOLDEN_COPY=true npm run test
   ```

## References

- **Phase 4 (Parallel Execution):** `docs/PARALLEL-EXECUTION.md`
- **Test Infrastructure:** `docs/TEST-INSTRUMENTATION.md`
- **Golden Copy Implementation:** `src/core/golden-copy-cache.ts`
- **Helper Functions:** `tests/helpers/golden-copy-helper.ts`
- **Test Setup:** `tests/setup.ts`

## FAQ

**Q: Do I need to change my existing tests?**
A: No. The golden copy is used transparently. Your existing tests automatically benefit.

**Q: What if I need a completely fresh model with no shared state?**
A: Use `useGoldenCopy: false`:
```typescript
const { model, cleanup } = await createTestModelWithGoldenCopy({
  useGoldenCopy: false
});
```

**Q: Can I use golden copy in CI/CD?**
A: Yes! It works great in parallel CI/CD runs. Each worker gets its own golden copy cache.

**Q: What's the memory overhead of golden copy?**
A: Minimal. The golden copy itself is ~2-3MB per worker. Clones are separate instances but share filesystem blocks via copy-on-write.

**Q: How do I measure performance improvements?**
A: Run with `DEBUG_GOLDEN_COPY=true` to see timing data. Compare with `DISABLE_GOLDEN_COPY=true`.

**Q: What happens if golden copy initialization fails?**
A: Tests gracefully fall back to `createTestModel()` behavior. Set `GOLDEN_COPY_STRICT=true` to fail loudly during development.

## See Also

- Implementation: Phase 5 - Shared Golden Copy for Test Initialization
- Related: Phase 4 - Parallel Test Execution Cycles
- GitHub Issue: #279 (optimize-test-execution-cycles)
