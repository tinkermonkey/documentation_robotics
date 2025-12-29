# Content Normalization Pipeline

Normalization pipeline for deterministic CLI compatibility testing

## Overview

The normalization pipeline handles cosmetic differences in CLI outputs to ensure that only true behavioral differences trigger test failures. This prevents spurious failures caused by:

- **Timestamps**: Different generation times (ISO-8601 formatted dates)
- **Path separators**: Windows backslashes vs Unix forward slashes
- **Key ordering**: YAML/JSON key order differences across implementations
- **Whitespace**: Trailing spaces, inconsistent newlines

## Architecture

### Pipeline Order

Normalizers are applied in a specific order to ensure correct behavior:

```
Raw Content
    ↓
1. stripTimestamps      → Remove ISO-8601 timestamps
    ↓
2. canonicalizePaths    → Normalize path separators (/ vs \)
    ↓
3. Format-Specific      → YAML/JSON key sorting
    ↓
4. trimWhitespace       → Remove trailing spaces and newlines
    ↓
Normalized Content (ready for comparison)
```

This ordering is critical:
- Timestamps are removed first (least destructive)
- Whitespace is trimmed last (most destructive)
- Format-specific normalizers work on already-cleaned content

## Normalizer Details

### 1. Timestamp Normalizer

**File**: `normalizers/timestamp-normalizer.ts`

Strips ISO-8601 timestamps using a comprehensive regex pattern:

```typescript
const ISO8601_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g;
```

**Supported Formats**:
- `2025-12-29T10:30:45Z` (UTC)
- `2025-12-29T10:30:45.123456Z` (With milliseconds)
- `2025-12-29T10:30:45+02:00` (With timezone offset)
- `2025-12-29T10:30:45.123456-05:00` (With milliseconds and offset)

**Example**:
```yaml
# Before
updated_at: 2025-12-29T10:30:45.123456Z
created: 2025-12-29T14:22:10+02:00

# After
updated_at: <TIMESTAMP>
created: <TIMESTAMP>
```

### 2. Path Normalizer

**File**: `normalizers/path-normalizer.ts`

Converts Windows-style backslashes to Unix-style forward slashes.

**Example**:
```text
# Before
path: C:\Users\test\model\file.yaml
reference: D:\Projects\project\src\

# After
path: C:/Users/test/model/file.yaml
reference: D:/Projects/project/src/
```

### 3. YAML Normalizer

**File**: `normalizers/yaml-normalizer.ts`

Parses YAML, recursively sorts all object keys alphabetically, and re-serializes with consistent formatting.

**Features**:
- Alphabetical key sorting at all nesting levels
- Preserves array order and semantics
- Preserves data types (strings, numbers, booleans, nulls)
- Graceful fallback: returns original content if parsing fails
- Deterministic output (no random ordering)

**Example**:
```yaml
# Before
zebra: value
apple: value
nested:
  zoo: 1
  apple: 2

# After
apple: value
nested:
  apple: 2
  zoo: 1
zebra: value
```

### 4. JSON Normalizer

**File**: `normalizers/json-normalizer.ts`

Parses JSON, recursively sorts all object keys, and pretty-prints with 2-space indentation.

**Features**:
- Alphabetical key sorting at all nesting levels
- Preserves array order
- Pretty-printing with consistent 2-space indentation
- Graceful fallback: returns original content if parsing fails

**Example**:
```json
// Before
{"zebra":"value","apple":"value"}

// After
{
  "apple": "value",
  "zebra": "value"
}
```

### 5. Whitespace Normalizer

**File**: `normalizers/whitespace-normalizer.ts`

Removes trailing whitespace from each line and trailing newlines at end of file.

**Example**:
```text
# Before
line1:
line2:
line3

# After
line1:
line2:
line3
```

## File Type Detection

The pipeline automatically detects file type from the extension:

| Pattern | Type |
|---------|------|
| `.yaml`, `.yml` | YAML |
| `.json` | JSON |
| `.md`, `.txt`, `.xml`, `.html` | Text (basic normalization only) |
| Other | Unknown (basic normalization only) |

**Code**:
```typescript
export function detectFileType(filePath: string): FileType {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')) {
    return FileType.YAML;
  }
  if (lowerPath.endsWith('.json')) {
    return FileType.JSON;
  }
  // ... more patterns
  return FileType.UNKNOWN;
}
```

## Integration with Comparator

The `comparator.ts` module automatically applies normalization before content hashing:

```typescript
function hashContent(content: string, filePath: string): string {
  // Apply normalization pipeline based on file type
  const fileType = detectFileType(filePath);
  const normalized = normalize(content, fileType);

  // Generate SHA-256 hash of normalized content
  return createHash('sha256').update(normalized).digest('hex');
}
```

This ensures that only true behavioral differences (after normalization) are detected.

## Idempotency

All normalizers are **idempotent**: applying normalization twice produces the same result as applying it once.

```typescript
const content = 'zebra: value\napple: value';
const norm1 = normalize(content, FileType.YAML);
const norm2 = normalize(norm1, FileType.YAML);
assertEqual(norm1, norm2); // ✓ Always passes
```

This is critical for reliable comparison logic.

## Usage Examples

### Basic Normalization

```typescript
import { normalize, detectFileType } from './normalizers/index';

const content = `
updated: 2025-12-29T10:30:45Z
zebra: value
apple: value

`;

const normalized = normalize(content, detectFileType('manifest.yaml'));
// Result: Timestamps removed, keys sorted, whitespace trimmed
```

### Automatic File Type Detection

```typescript
import { normalizeContent } from './normalizers/index';

const normalized = normalizeContent(content, 'model/manifest.yaml');
// Automatically detects YAML and applies appropriate normalizers
```

### Individual Normalizers

```typescript
import {
  stripTimestamps,
  canonicalizePaths,
  normalizeYAML,
  normalizeJSON,
  trimWhitespace
} from './normalizers/index';

// Apply specific normalizers in custom order
const step1 = stripTimestamps(content);
const step2 = canonicalizePaths(step1);
const step3 = normalizeYAML(step2);
// ... etc
```

### With Filesystem Snapshots

```typescript
import { captureSnapshot, compareSnapshots } from './comparator';

// Capture before state
const before = await captureSnapshot('/path/to/directory');

// Run command that modifies files

// Capture after state
const after = await captureSnapshot('/path/to/directory');

// Compare (normalization automatically applied to content hashes)
const result = compareSnapshots(before, after);
if (!result.identical) {
  console.log(formatComparisonResult(result));
}
```

## Design Decisions

### Why These Normalizers?

1. **Timestamps** - CLIs generate output at different times, but timestamp values are irrelevant to behavior
2. **Paths** - Different OSes use different separators; semantic path meaning is OS-independent
3. **Key Ordering** - YAML/JSON parsers may not preserve key order; order doesn't affect semantics
4. **Whitespace** - Editors add/remove trailing spaces inconsistently; not semantically meaningful

### Why Apply Normalizers Before Hashing?

The comparator applies normalization before generating content hashes. This ensures:
- Only true behavioral differences are captured
- Two CLIs producing "same content, different formatting" pass comparison
- Files are marked as "unchanged" if only cosmetic differences exist

### Why This Pipeline Order?

1. **stripTimestamps first** - Least destructive; changes ISO-8601 patterns to placeholders
2. **canonicalizePaths second** - OS-independent; simple regex replacement
3. **Format-specific normalizers third** - Parse and re-serialize structured data
4. **trimWhitespace last** - Most destructive; modifies all whitespace globally

This order prevents edge cases like:
- YAML keys containing ISO-8601 strings being incorrectly replaced
- Path normalization affecting quoted YAML strings

### Graceful Degradation

If content is not valid YAML/JSON, normalizers return original content unchanged:

```typescript
export function normalizeYAML(content: string): string {
  try {
    const data = YAML.parse(content);
    // ... normalize ...
  } catch (_error) {
    return content;  // ← Return original if parsing fails
  }
}
```

This allows the pipeline to handle:
- Malformed YAML/JSON (returns original)
- Mixed file types
- Unknown content

## Testing

Comprehensive unit tests verify:

### Normalizer Tests (`normalizers.test.ts`)
- Timestamp stripping in all ISO-8601 formats
- Path normalization (Windows, Unix, mixed)
- YAML/JSON key sorting (nested, arrays)
- Whitespace handling (trailing spaces, multiple newlines)
- Idempotency (normalizing twice = normalizing once)
- Edge cases (empty files, malformed content)

### Comparator Tests (`comparator.test.ts`)
- Snapshot comparison (identical, added, deleted, modified)
- Change detection (correct type classification)
- Summary statistics (correct counting)
- Output formatting
- Edge cases (large file counts, special characters)

**Run Tests**:
```bash
# All normalizer tests
node --import tsx normalizers.test.ts

# All comparator tests
node --import tsx comparator.test.ts
```

## Known Limitations

### Files Not Normalized

Some files should skip certain normalizations:

| File Type | Normalization |
|-----------|---------------|
| Binary files (`.png`, `.jpg`) | None (not read as text) |
| Compiled archives (`.zip`, `.tar.gz`) | None (not read as text) |
| Already-normalized exports (`.xml`, `.openapi.json`) | May skip format-specific normalizers |

Current implementation applies full normalization to all text files. Future phases could add exception handling:

```typescript
const NORMALIZATION_EXCEPTIONS = new Map<string, Normalizer[]>([
  ['*.xml', [stripTimestamps]],  // XML exports: only strip timestamps
  ['*.png', []],                  // Binary files: skip entirely
]);
```

### YAML Parsing Limitations

The YAML normalizer uses `yaml@2.8.2` parser. Known limitations:

- Comments are preserved but may be reordered
- YAML tags (e.g., `!!binary`) may be affected by re-serialization
- Anchors and aliases may not be fully preserved

### JSON Precision

JSON normalizer uses `JSON.stringify(null, 2)` which:
- May lose numeric precision for very large numbers
- Uses JavaScript number representation (not arbitrary precision)

For most CLI outputs (manifest files, configuration), this is sufficient.

## Future Enhancements

### Phase 4: Selective Normalization

- Per-file normalization rules
- Binary file detection and skipping
- Custom normalizer registration
- Exclusion patterns (e.g., skip certain directories)

### Phase 5: Advanced Comparison

- Semantic YAML comparison (ignore comment differences)
- Diff output formats (unified diff, side-by-side)
- Per-test normalization configuration
- Performance optimization for large snapshots

## References

- Spec: `/spec/CHANGELOG.md` (version tracking)
- Issue #91: Parent issue for CLI compatibility validation
- Discussion #92: Requirements and design guidance
- PYTHON_VS_TS_COMPARISON.md: Known behavioral differences

## Summary

The normalization pipeline ensures deterministic, reliable comparisons by:

✓ Stripping cosmetic differences (timestamps, paths, key ordering, whitespace)
✓ Preserving semantic meaning and data integrity
✓ Applying normalizers in correct order for edge case handling
✓ Gracefully degrading on malformed content
✓ Maintaining idempotency for reliable comparison logic
✓ Integrating seamlessly with filesystem snapshots and content hashing
