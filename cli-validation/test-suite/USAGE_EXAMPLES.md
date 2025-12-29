# Normalization Pipeline - Usage Examples

Quick-start examples for using the normalization pipeline and comparator in your tests.

## Basic Usage

### Example 1: Normalize YAML Content

```typescript
import { normalize, FileType } from './normalizers/index';

const yamlContent = `
updated: 2025-12-29T10:30:45Z
zebra: value
apple: value

`;

const normalized = normalize(yamlContent, FileType.YAML);
console.log(normalized);
// Output:
// apple: value
// updated: <TIMESTAMP>
// zebra: value
```

### Example 2: Normalize JSON Content

```typescript
import { normalize, FileType } from './normalizers/index';

const jsonContent = `{
  "zebra": "value",
  "updated": "2025-12-29T10:30:45Z",
  "apple": "value"
}`;

const normalized = normalize(jsonContent, FileType.JSON);
console.log(normalized);
// Output:
// {
//   "apple": "value",
//   "updated": "<TIMESTAMP>",
//   "zebra": "value"
// }
```

### Example 3: Auto-detect File Type

```typescript
import { normalizeContent } from './normalizers/index';

// Automatically detects YAML from extension
const yaml = normalizeContent(content, 'manifest.yaml');

// Automatically detects JSON from extension
const json = normalizeContent(content, 'data.json');

// Text files get basic normalization
const text = normalizeContent(content, 'README.md');
```

## Individual Normalizers

### Example 4: Use Specific Normalizers

```typescript
import {
  stripTimestamps,
  canonicalizePaths,
  normalizeYAML,
  trimWhitespace
} from './normalizers/index';

const content = `
path: C:\\Users\\test\\file.yaml
updated: 2025-12-29T10:30:45Z
zebra: value
`;

// Apply normalizers in custom order
const step1 = stripTimestamps(content);
const step2 = canonicalizePaths(step1);
const step3 = normalizeYAML(step2);
const step4 = trimWhitespace(step3);

console.log(step4);
// Output:
// apple: value
// path: C:/Users/test/file.yaml
// updated: <TIMESTAMP>
```

## Filesystem Snapshots

### Example 5: Capture and Compare Snapshots

```typescript
import {
  captureSnapshot,
  compareSnapshots,
  formatComparisonResult
} from './comparator';

async function testCommand() {
  // Capture baseline state
  const before = await captureSnapshot('/path/to/model');

  // Run command that modifies files
  await executeCommand('dr add motivation goal my-goal --name "My Goal"');

  // Capture new state
  const after = await captureSnapshot('/path/to/model');

  // Compare (normalization applied automatically)
  const result = compareSnapshots(before, after);

  console.log(formatComparisonResult(result));
  // Output:
  // Comparison Results:
  // ├─ Status: ✗ DIFFERENT (2 changes)
  // ├─ Added: 1 files
  // ├─ Deleted: 0 files
  // ├─ Modified: 1 files
  // └─ Changes:
  //    ├─ + model/01_motivation/new.yaml
  //    └─ ~ manifest.yaml
}

testCommand();
```

### Example 6: Detect Specific Changes

```typescript
import { captureSnapshot, compareSnapshots } from './comparator';

const result = compareSnapshots(before, after);

// Get only added files
const added = result.changes.filter(c => c.type === 'added');
console.log('Added files:', added.map(c => c.path));

// Get only modified files
const modified = result.changes.filter(c => c.type === 'modified');
console.log('Modified files:', modified.map(c => c.path));

// Get only deleted files
const deleted = result.changes.filter(c => c.type === 'deleted');
console.log('Deleted files:', deleted.map(c => c.path));

// Check summary
console.log(`Total changes: ${result.summary.total}`);
console.log(`- Added: ${result.summary.added}`);
console.log(`- Deleted: ${result.summary.deleted}`);
console.log(`- Modified: ${result.summary.modified}`);
```

## Integration with Test Runner

### Example 7: Use in Test Runner

```typescript
import { initializeTestEnvironment } from './setup';
import { captureSnapshot, compareSnapshots } from './comparator';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

async function runTest(testName: string, command: string) {
  const { config, paths } = await initializeTestEnvironment();

  // Capture baseline
  const before = await captureSnapshot(paths.pythonPath);

  // Run command on Python CLI
  await execAsync(command, { cwd: paths.pythonPath });

  // Capture result
  const afterPython = await captureSnapshot(paths.pythonPath);

  // Reset and run same command on TypeScript CLI
  const afterTS = await captureSnapshot(paths.tsPath);

  // Compare results (should be identical with normalization)
  const result = compareSnapshots(afterPython, afterTS);

  if (result.identical) {
    console.log(`✓ ${testName}: PASSED`);
  } else {
    console.log(`✗ ${testName}: FAILED`);
    console.log(formatComparisonResult(result));
  }
}

// Run tests
await runTest('Add motivation', 'dr add motivation goal test-goal --name "Test Goal"');
await runTest('Add business', 'dr add business service test-service --name "Test Service"');
```

## Edge Cases & Error Handling

### Example 8: Handle Invalid Content

```typescript
import { normalizeYAML, normalizeJSON } from './normalizers/index';

// Invalid YAML returns original unchanged
const invalidYAML = 'invalid: yaml: syntax: error:';
const yamlResult = normalizeYAML(invalidYAML);
console.log(yamlResult === invalidYAML); // true

// Invalid JSON returns original unchanged
const invalidJSON = '{invalid json}';
const jsonResult = normalizeJSON(invalidJSON);
console.log(jsonResult === invalidJSON); // true

// Graceful degradation ensures no exceptions
try {
  const bad = normalizeYAML('not valid yaml at all!!!');
  console.log('No exception thrown'); // ✓
} catch (error) {
  console.log('Unexpected error'); // Should not reach here
}
```

### Example 9: Verify Idempotency

```typescript
import { normalize, FileType } from './normalizers/index';

const content = 'zebra: 2025-12-29T10:30:45Z\napple: value  \n\n';

const norm1 = normalize(content, FileType.YAML);
const norm2 = normalize(norm1, FileType.YAML);
const norm3 = normalize(norm2, FileType.YAML);

// All should be identical
console.log(norm1 === norm2); // true
console.log(norm2 === norm3); // true

// This is guaranteed by the pipeline
```

### Example 10: Different Path Formats

```typescript
import { canonicalizePaths } from './normalizers/index';

// Windows paths
const windows = 'path: C:\\Users\\test\\model\\file.yaml';
console.log(canonicalizePaths(windows));
// Output: path: C:/Users/test/model/file.yaml

// Unix paths (unchanged)
const unix = 'path: /home/user/model/file.yaml';
console.log(canonicalizePaths(unix) === unix); // true

// Mixed paths
const mixed = 'win: C:\\path, unix: /path';
console.log(canonicalizePaths(mixed));
// Output: win: C:/path, unix: /path
```

## Real-World Test Scenario

### Example 11: Complete CLI Compatibility Test

```typescript
import {
  initializeTestEnvironment,
  CLIConfig,
  TestPaths,
} from './setup';
import {
  captureSnapshot,
  compareSnapshots,
  formatComparisonResult,
} from './comparator';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

interface TestCase {
  name: string;
  command: string;
  expectedChanges?: {
    added?: string[];
    deleted?: string[];
    modified?: string[];
  };
}

async function runCompatibilityTests(testCases: TestCase[]) {
  const { config, paths } = await initializeTestEnvironment();
  const results = [];

  for (const testCase of testCases) {
    try {
      // Capture Python CLI baseline
      const pythonBefore = await captureSnapshot(paths.pythonPath);

      // Run command on Python CLI
      await execAsync(testCase.command, { cwd: paths.pythonPath });

      // Capture Python CLI result
      const pythonAfter = await captureSnapshot(paths.pythonPath);

      // Reset TS CLI to baseline
      // (In real tests, would copy fresh baseline)

      // Run same command on TypeScript CLI
      await execAsync(testCase.command, { cwd: paths.tsPath });

      // Capture TS CLI result
      const tsAfter = await captureSnapshot(paths.tsPath);

      // Compare results
      const result = compareSnapshots(pythonAfter, tsAfter);

      // Validate against expectations if provided
      const passed =
        result.identical ||
        (testCase.expectedChanges &&
          result.summary.added === (testCase.expectedChanges.added?.length || 0) &&
          result.summary.deleted === (testCase.expectedChanges.deleted?.length || 0) &&
          result.summary.modified === (testCase.expectedChanges.modified?.length || 0));

      results.push({
        name: testCase.name,
        passed,
        changes: result.changes,
      });

      if (passed) {
        console.log(`✓ ${testCase.name}`);
      } else {
        console.log(`✗ ${testCase.name}`);
        console.log(formatComparisonResult(result));
      }
    } catch (error) {
      results.push({
        name: testCase.name,
        passed: false,
        error: String(error),
      });
      console.log(`✗ ${testCase.name}: ${error}`);
    }
  }

  // Summary
  const passCount = results.filter(r => r.passed).length;
  console.log(`\n${passCount}/${results.length} tests passed`);

  return results;
}

// Run tests
const tests: TestCase[] = [
  {
    name: 'Add motivation goal',
    command: 'dr add motivation goal test-goal --name "Test Goal"',
    expectedChanges: {
      modified: ['manifest.yaml'],
      added: ['model/01_motivation/goals.yaml'],
    },
  },
  {
    name: 'Add business service',
    command: 'dr add business service test-service --name "Test Service"',
    expectedChanges: {
      modified: ['manifest.yaml'],
      added: ['model/02_business/services.yaml'],
    },
  },
];

await runCompatibilityTests(tests);
```

## Testing the Normalizers

### Example 12: Unit Testing Your Content

```typescript
import { normalize, FileType } from './normalizers/index';

function testNormalization() {
  // Test YAML normalization
  const yaml = `
zebra: 2025-12-29T10:30:45Z
apple: value

`;
  const normalizedYAML = normalize(yaml, FileType.YAML);

  // Verify all expectations
  console.assert(
    !normalizedYAML.includes('2025-12-29'),
    'Timestamps should be removed'
  );
  console.assert(
    normalizedYAML.indexOf('apple') < normalizedYAML.indexOf('zebra'),
    'Keys should be sorted'
  );
  console.assert(
    !normalizedYAML.endsWith('\n\n'),
    'Trailing newlines should be removed'
  );

  console.log('✓ All assertions passed');
}

testNormalization();
```

## Tips & Best Practices

1. **Always detect file type** - Use `detectFileType()` for automatic detection
2. **Apply full pipeline** - Use `normalize()` for all normalizers, not individual ones
3. **Verify idempotency** - Normalizing twice should equal normalizing once
4. **Handle errors gracefully** - Invalid content returns original unchanged
5. **Use comparator integration** - Snapshots automatically apply normalization
6. **Test with real data** - Use actual CLI output for testing

## Performance Notes

- **Memory**: Snapshots load entire files into memory (suitable for CLI output sizes)
- **Speed**: Normalization is fast (~100μs per file for typical manifest files)
- **Hashing**: SHA-256 is computed after normalization (one-time per snapshot)
- **Large directories**: Directory walking is depth-first, skips node_modules/.git/etc

## Troubleshooting

**Q: Why is my YAML not being sorted?**
A: If parsing fails, the original is returned. Check the YAML syntax.

**Q: Why are path separators not changed?**
A: Only backslashes are converted. Verify content contains `\` characters.

**Q: Why are timestamps not removed?**
A: Only ISO-8601 format is matched. Check timestamp format in content.

**Q: Can I customize normalizers?**
A: Not yet - Phase 4 will add custom normalizer registration. For now, import individual normalizers and compose them.

## Next Steps

- Phase 4: Test case authoring framework
- Phase 5: Advanced comparison and reporting
- Future: Custom normalizer registration
