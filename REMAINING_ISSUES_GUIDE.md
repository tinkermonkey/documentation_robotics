# Remaining Issues - Action Guide

**Status**: Critical and High-Priority issues FIXED. Following issues remain for follow-up PRs.

---

## High-Priority Issues (Should Fix)

### 1. Unsafe Property Access in Script

**File**: `scripts/generate-layer-reports.ts:441-442, 509-510, 588-589, 616-617`
**Severity**: HIGH - Potential Crashes
**Effort**: 30 minutes

**Issue**:
```typescript
// Splits spec_node_id without checking array length
const parts = spec_node_id.split(".");
const layer = parts[1]; // May be undefined if format is wrong
```

**Fix**: Add validation with clear error messages
```typescript
const parts = spec_node_id.split(".");
if (parts.length < 3) {
  throw new Error(
    `Invalid spec_node_id format: "${spec_node_id}". Expected format: "layer.type.name"`
  );
}
const layer = parts[1];
```

---

### 2. SchemaValidator Static Shared State Test Isolation

**File**: `cli/src/validators/schema-validator.ts`
**Severity**: HIGH - Test Quality Risk
**Effort**: 1 hour

**Issue**: Moving AJV to static class-level state creates test pollution if tests forget to call `reset()`.

**Fix**: Add reset calls to test setup files
```typescript
// In test setup (beforeEach)
SchemaValidator.reset();
```

**Locations to add reset calls**:
- `cli/tests/unit/validators/schema-validator.test.ts`
- `cli/tests/integration/export-command.test.ts`
- Any other tests that create SchemaValidator instances

---

### 3. escapeMarkdown Behavioral Change Not Documented

**File**: `cli/src/export/markdown-utils.ts:40-51`
**Severity**: HIGH - Breaking Change
**Effort**: 15 minutes

**Issue**: New function now escapes `<` and `>` to `&lt;` and `&gt;`, changing output format.

**Fix**: Document in commit message
```
fix: Update markdown escaping to include HTML entities

The escapeMarkdown function now escapes < and > characters to HTML entities
(&lt; and &gt;) for safer markdown output. This is a behavioral change from
the previous implementation which did not escape these characters.

This change improves security by preventing potential HTML injection in
generated markdown documents.
```

**Verify**: Check that existing golden-copy tests still pass with new escaping.

---

### 4. Inconsistent Logging - console.warn vs Structured Logging

**File**: `cli/src/core/report-data-model.ts:458-462`
**Severity**: HIGH - Observability
**Effort**: 30 minutes

**Issue**:
```typescript
// Uses console.warn instead of project logging
console.warn(
  `Malformed element ID format in relationship: source="${rel.source}" ...`
);
```

**Fix**: Use structured logging with error ID
```typescript
import { logWarning } from "../utils/logging.js";

logWarning("REPORT_001", {
  context: "relationship classification",
  source: rel.source,
  target: rel.target,
  reason: "malformed element ID format",
});
```

**Check**:
- Verify project has `logWarning()` in logging utilities
- Use consistent error ID format (`CATEGORY_NNN`)
- Update all console.warn calls in new modules

---

## Important Issues (Consider Fixing)

### 5. Missing Unit Tests for SpecDataLoader

**File**: `cli/src/core/spec-loader.ts`
**Severity**: IMPORTANT - Test Coverage
**Effort**: 2 hours

**Create**: `cli/tests/unit/core/spec-loader.test.ts`

**Test Coverage Needed**:
- Successful schema loading
- Error handling for missing files
- JSON parse errors
- Invalid schema structure
- Caching behavior

**Example structure**:
```typescript
describe("SpecDataLoader", () => {
  describe("load", () => {
    it("should load layers.json successfully", async () => {
      const loader = new SpecDataLoader();
      const data = await loader.load();
      expect(data.layers).toBeDefined();
      expect(data.layers.length).toBeGreaterThan(0);
    });

    it("should throw on missing predicates.json", async () => {
      const loader = new SpecDataLoader({ specDir: "/nonexistent" });
      await expect(loader.load()).rejects.toThrow();
    });
  });
});
```

---

### 6. Missing Unit Tests for SpecDataService

**File**: `cli/src/core/spec-data-service.ts`
**Severity**: IMPORTANT - Test Coverage
**Effort**: 2 hours

**Create**: `cli/tests/unit/core/spec-data-service.test.ts`

**Test Coverage Needed**:
- Service initialization
- Node type queries
- Relationship type queries
- Layer lookups
- Metadata computation
- Caching behavior

---

### 7. Missing Circular Dependency Detection Edge Cases

**File**: `cli/src/core/report-data-model.ts` - `findCircles()` method
**Severity**: IMPORTANT - Algorithm Correctness
**Effort**: 1.5 hours

**Test Cases Needed**:
- Simple 2-node cycle (A→B→A)
- Complex multi-node cycles (A→B→C→A)
- Multiple independent cycles
- Self-referential cycles (A→A)
- Cycles reachable through alternate paths (the case we fixed)
- No cycles in acyclic graph

**Example test**:
```typescript
it("should find cycles reachable through alternate paths", async () => {
  // Build relationships: A→B, B→C, C→B (cycle), D→C
  const rels = [
    { source: "A", target: "B", predicate: "ref" },
    { source: "B", target: "C", predicate: "ref" },
    { source: "C", target: "B", predicate: "ref" },
    { source: "D", target: "C", predicate: "ref" },
  ];

  const circles = reportModel.getCircularDependencies(rels);

  // Should find both B↔C cycle and the D→C→B→C cycle
  expect(circles.length).toBeGreaterThanOrEqual(2);
});
```

---

## Quick Action Plan

### Phase 1: High-Priority (Before Next Merge)
1. [ ] Add reset calls to SchemaValidator tests
2. [ ] Document escapeMarkdown change in commit
3. [ ] Fix property access in generate-layer-reports.ts
4. [ ] Fix logging inconsistencies in report-data-model.ts

**Estimated**: 2-3 hours

### Phase 2: Important (Next PR)
5. [ ] Add SpecDataLoader unit tests
6. [ ] Add SpecDataService unit tests
7. [ ] Add circular dependency edge case tests

**Estimated**: 5-6 hours

### Phase 3: Documentation
8. [ ] Update CHANGELOG with all fixes
9. [ ] Update PR description with complete list of changes
10. [ ] Add notes for maintainers about remaining work

**Estimated**: 1 hour

---

## Files to Focus On

**For High-Priority Fixes**:
- `scripts/generate-layer-reports.ts` - Property access validation
- `cli/src/validators/schema-validator.test.ts` - Add reset calls
- `cli/src/core/report-data-model.ts` - Logging patterns
- Commit messages - Document behavioral changes

**For Important Additions**:
- `cli/tests/unit/core/spec-loader.test.ts` (new)
- `cli/tests/unit/core/spec-data-service.test.ts` (new)
- `cli/tests/unit/core/report-data-model.test.ts` (enhance)

---

## Testing Commands

```bash
# Run all tests
npm test

# Run specific test file
npm test -- cli/tests/unit/core/spec-loader.test.ts

# Run with coverage
npm test -- --coverage

# Watch mode for development
npm test -- --watch
```

---

## Resources

- **CLAUDE.md**: Project standards and patterns
- **PR Review Documents**: Original issue findings
- **Test Examples**: Check existing test files for patterns
- **Logging**: Look at existing logging patterns in codebase

---

## Summary

**Status**: 9 critical/high-priority issues FIXED ✅
**Remaining**: 4 high-priority + 3 important (low risk)
**Effort**: 8-10 hours for complete resolution
**Recommendation**: Merge critical fixes now, address remaining in follow-up PRs
