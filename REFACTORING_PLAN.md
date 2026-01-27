# Phase 2: Update all changeset commands to use StagingAreaManager exclusively

## Overview
Refactor all changeset commands to use `StagingAreaManager` instead of legacy `ChangesetManager`, eliminating dual implementations and standardizing on the new staging workflow architecture.

## Current State Analysis

### Dual Implementation Problem
- **Legacy**: `ChangesetManager` (JSON files in `.dr/changesets/`)
- **New**: `StagingAreaManager` (YAML files in `documentation-robotics/changesets/`)
- **Current**: Commands mix both approaches

### Commands Affected (13 total)

| Command | Current Implementation | Lines | Issue |
|---------|--------|-------|-------|
| `create` | ChangesetManager | 27-76 | Uses old manager |
| `list` | ChangesetManager | 81-112 | Uses old manager |
| `apply` | ChangesetManager | 151-219 | **LEGACY** - direct apply |
| `revert` | ChangesetManager | 224-291 | **LEGACY** - direct revert |
| `delete` | ChangesetManager | 296-340 | Uses old manager |
| `staged` | Mixed (both managers) | 449-501 | **MIXED** - loads with old, displays as staged |
| `unstage` | StagingAreaManager | 506-573 | Uses new manager correctly ✓ |
| `discard` | StagingAreaManager | 578-627 | Uses new manager correctly ✓ |
| `preview` | ChangesetManager | 632-723 | **MISSING** VirtualProjectionEngine |
| `diff` | ChangesetManager | 728-789 | **MISSING** VirtualProjectionEngine |
| `commit` | Mixed (both managers) | 819-887 | Uses new manager but mixes patterns |
| `validate-migration` | ChangesetManager | 892-913 | Legacy utility (keep for migration) |
| `migrate` | ChangesetManager | 918-985 | Legacy utility (keep for migration) |

### Commands Using StagingAreaManager Correctly (2)
- `unstage` ✓
- `discard` ✓

### Commands Needing Refactoring (11)

## Refactoring Strategy

### Phase 2a: Migrate Core Commands
Priority: High-impact, frequently used commands

#### 1. Refactor `changesetApplyCommand` → Use StagingAreaManager.commit()
**File**: cli/src/commands/changeset.ts:151-219
**Current**:
```typescript
const manager = new ChangesetManager(model.rootPath);
const changeset = await manager.load(name);
const result = await manager.apply(model, name);
// Changes applied directly to base model
```

**Target**:
```typescript
const stagingManager = new StagingAreaManager(model.rootPath, model);
const changeset = await stagingManager.load(name);
const result = await stagingManager.commit(model, name, {
  skipValidation: options.force || false,
  skipDriftCheck: options.force || false,
});
// Full validation, drift detection, atomic with rollback
```

**Changes**:
- Load full model (required for validation)
- Use StagingAreaManager.commit() instead of ChangesetManager.apply()
- Respect --force flag for drift override only (validation always runs)
- Display commit results (committed count, validation errors)

#### 2. Refactor `changesetRevertCommand` → Use StagingAreaManager.discard()
**File**: cli/src/commands/changeset.ts:224-291
**Current**:
```typescript
const manager = new ChangesetManager(model.rootPath);
const result = await manager.revert(model, name);
// Changes rolled back directly
```

**Target**:
```typescript
const stagingManager = new StagingAreaManager(model.rootPath, model);
const result = await stagingManager.discard(name);
// Proper cleanup of staged changes
```

**Changes**:
- Load model (may not need full load if discard doesn't validate)
- Use StagingAreaManager.discard() instead of revert()
- Clear active changeset if reverted changeset is active
- Display discard results

#### 3. Refactor `changesetStagedCommand` → Use StagingAreaManager exclusively
**File**: cli/src/commands/changeset.ts:449-501
**Current**:
```typescript
const context = new ActiveChangesetContext(model.rootPath);
const activeChangeset = await context.getActive();
const manager = new ChangesetManager(model.rootPath);  // ← PROBLEM
const changeset = await manager.load(activeChangeset);
// Displays old-format changeset as if staged
```

**Target**:
```typescript
const stagingManager = new StagingAreaManager(model.rootPath, model);
const activeChangeset = await stagingManager.getActive();
const changeset = await stagingManager.load(activeChangeset);
// Properly loads staged changeset with validation
```

**Changes**:
- Load full model
- Use StagingAreaManager.getActive() instead of ActiveChangesetContext
- Use StagingAreaManager.load() instead of ChangesetManager
- Display only staged changes (not all changes in changeset)

#### 4. Refactor `changesetPreviewCommand` → Add VirtualProjectionEngine
**File**: cli/src/commands/changeset.ts:632-723
**Current**:
```typescript
const manager = new ChangesetManager(model.rootPath);
const changeset = await manager.load(activeChangeset);
// Displays changes without validation or projection
```

**Target**:
```typescript
const stagingManager = new StagingAreaManager(model.rootPath, model);
const changeset = await stagingManager.load(activeChangeset);
const projectionEngine = new VirtualProjectionEngine(model);
const projectedModel = await projectionEngine.projectChanges(changeset.changes);
// Shows accurate merged model state
```

**Changes**:
- Load full model
- Use StagingAreaManager.load()
- Use VirtualProjectionEngine to show merged state
- Display projected elements (merged base + staged)

#### 5. Refactor `changesetDiffCommand` → Use StagingAreaManager + VirtualProjectionEngine
**File**: cli/src/commands/changeset.ts:728-789
**Current**:
```typescript
const manager = new ChangesetManager(model.rootPath);
const changeset = await manager.load(activeChangeset);
// Displays raw changes without context
```

**Target**:
```typescript
const stagingManager = new StagingAreaManager(model.rootPath, model);
const changeset = await stagingManager.load(activeChangeset);
const projectionEngine = new VirtualProjectionEngine(model);
const projectedModel = await projectionEngine.projectChanges(changeset.changes);
// Compare base vs projected with context
```

**Changes**:
- Load full model
- Use StagingAreaManager.load()
- Use VirtualProjectionEngine for comparison
- Display diffs with layer/element context

### Phase 2b: Consolidate Active Changeset Management
Priority: Eliminate ActiveChangesetContext dependency

#### 6. Use StagingAreaManager.setActive() and .getActive() universally
**Current Issue**:
- ActiveChangesetContext uses `.dr/changesets/.active` (old)
- StagingAreaManager uses `documentation-robotics/changesets/.active` (new)
- Commands must check both locations during migration

**Target**:
- All commands use StagingAreaManager.setActive() / .getActive()
- Support reading from both old and new locations (backward compat)
- Write only to new location (forward migration)
- Remove ActiveChangesetContext usage from all commands

**Implementation**:
- Update StagingAreaManager to support reading old `.active` file as fallback
- Update changesetCreateCommand to use stagingManager.setActive()
- Update changesetActivateCommand to use stagingManager.setActive()
- Update changesetDeactivateCommand to use stagingManager.clearActive()
- Remove all ActiveChangesetContext instantiations

### Phase 2c: Simplify Create/List/Delete Commands
Priority: Consistency and data model alignment

#### 7. Refactor `changesetCreateCommand` → Use StagingAreaManager
**Current**: Uses ChangesetManager with JSON format
**Target**: Use StagingAreaManager with YAML format and base snapshot capture

**Changes**:
- Use StagingAreaManager.create() instead of ChangesetManager.create()
- Auto-capture base snapshot
- Auto-generate ID (use name-based ID for backward compat)
- Display new path: `documentation-robotics/changesets/{id}/`

#### 8. Refactor `changesetListCommand` → Use StagingAreaManager
**Current**: Uses ChangesetManager to list JSON files
**Target**: Use StagingAreaManager to list YAML-based changesets

**Changes**:
- Use StagingAreaManager.list() instead of ChangesetManager.list()
- Display both legacy and new changesets during migration phase
- Show changeset status, base snapshot drift, change counts

#### 9. Refactor `changesetDeleteCommand` → Use StagingAreaManager
**Current**: Uses ChangesetManager to delete JSON files
**Target**: Use StagingAreaManager for proper cleanup

**Changes**:
- Use StagingAreaManager.delete() instead of ChangesetManager.delete()
- Clean up both old and new locations during migration
- Prevent deletion of committed changesets (only discard)
- Clear active if deleting active changeset

### Phase 2d: Update Remaining Commands
Priority: Lower priority but important for consistency

#### 10. Update `changesetCommitCommand` to remove ChangesetManager dependency
**Current** (lines 819-887):
```typescript
const manager = new ChangesetManager(model.rootPath);  // Still used
const changeset = await manager.load(activeChangeset);
// Then uses StagingAreaManager for actual commit
```

**Target**:
```typescript
// Remove ChangesetManager entirely
const stagingManager = new StagingAreaManager(model.rootPath, model);
const changeset = await stagingManager.load(activeChangeset);
// StagingAreaManager.commit() handles everything
```

#### 11. Update `changesetStatusCommand` for new status model
**Current**: May be outdated with old changeset statuses
**Target**: Display using new StagingAreaManager status model

### Phase 2e: Remove Migration Commands from Changeset Commands
Priority: Move to separate utility after migration complete

**Future**: Consider moving `validate-migration`, `migrate`, `migrate --dry-run` to separate command path once all existing changesets migrated.

## Implementation Order

### 1. Core Infrastructure (Day 1)
- [ ] Update StagingAreaManager to support reading old `.active` file
- [ ] Add tests for backward compatibility

### 2. High-Impact Commands (Day 2-3)
- [ ] Refactor `changesetStagedCommand`
- [ ] Refactor `changesetPreviewCommand` (add VirtualProjectionEngine)
- [ ] Refactor `changesetDiffCommand` (add VirtualProjectionEngine)
- [ ] Update tests

### 3. Lifecycle Commands (Day 4)
- [ ] Refactor `changesetApplyCommand`
- [ ] Refactor `changesetRevertCommand`
- [ ] Update tests

### 4. Consolidation (Day 5)
- [ ] Update `changesetCreateCommand`
- [ ] Update `changesetListCommand`
- [ ] Update `changesetDeleteCommand`
- [ ] Consolidate active changeset management
- [ ] Update tests

### 5. Cleanup (Day 6)
- [ ] Remove all ChangesetManager instantiations from commands
- [ ] Remove ActiveChangesetContext usage
- [ ] Verify no orphaned dependencies
- [ ] Run full test suite

## Testing Strategy

### Unit Tests
- Test each refactored command with StagingAreaManager mock
- Test backward compatibility (reading old changeset format)
- Test status transitions

### Integration Tests
- Test full workflow: create → stage → preview → commit
- Test drift detection and --force override
- Test rollback on validation failure
- Test backward compatibility workflows

### Migration Tests
- Test reading old `.dr/changesets/` files
- Test reading old `.active` marker
- Test auto-migration when needed

## Success Criteria

1. **Zero ChangesetManager usage in command layer**
   - Only used in migration utilities and tests

2. **All commands use StagingAreaManager**
   - Commands load via StagingAreaManager.load()
   - Commands stage via StagingAreaManager.stage()
   - Commands commit via StagingAreaManager.commit()
   - Commands discard via StagingAreaManager.discard()

3. **Consistent active changeset management**
   - All use StagingAreaManager.setActive()/getActive()
   - Single source of truth for active changeset

4. **Full validation in commit path**
   - Validation always runs (cannot override)
   - Drift detection present with --force override option
   - Atomic commit with rollback on failure

5. **Accurate preview/diff output**
   - Using VirtualProjectionEngine for merged model view
   - Shows actual post-commit state

6. **Backward compatibility maintained**
   - Old `.dr/changesets/` files still readable
   - Old `.active` marker still supported as fallback
   - Commands guide users to new locations

7. **All tests passing**
   - Unit tests for each command
   - Integration tests for workflows
   - No regressions in existing functionality

## Files to Modify

### Primary
- `cli/src/commands/changeset.ts` - Main refactoring (1448 lines)

### Secondary
- `cli/src/core/staging-area.ts` - Add backward compat for `.active` file
- `cli/src/core/active-changeset.ts` - Mark as deprecated, can remove after migration

### Tests
- `cli/tests/integration/changeset-commands.test.ts` (if exists)
- `cli/tests/integration/staging-workflow.test.ts`
- Add new tests for each command refactoring

## Backward Compatibility Approach

### Read Old Format (Migration Phase)
- StagingAreaManager loads from both locations
- Check `documentation-robotics/changesets/` first (new)
- Fall back to `.dr/changesets/` if not found (old)

### Write New Format Only
- All create/update operations use new format
- Gradual migration as users run commands

### Active Changeset Compatibility
- Support reading from `.dr/changesets/.active` (old)
- Write to `documentation-robotics/changesets/.active` (new)
- Detect and migrate old active marker if needed

## Risk Mitigation

### Risk 1: Breaking Old Workflows
**Mitigation**: Maintain backward compat reading from old format for 2+ releases

### Risk 2: Validation Failures During Commit
**Mitigation**: Atomic backup/restore, clear error messages, recovery guidance

### Risk 3: Active Changeset Ambiguity During Migration
**Mitigation**: Prioritize new location, support old as fallback, clear transition message

### Risk 4: Incomplete Refactoring
**Mitigation**: Use grep to verify zero ChangesetManager usage in commands after completion

## Documentation Updates

After refactoring complete:
- [ ] Update STAGING_GUIDE.md with new command examples
- [ ] Update CHANGELOG.md with breaking changes (if any)
- [ ] Add migration guide for old `.dr/changesets/` format
- [ ] Document backward compatibility timeline

---

**Total Estimated Scope**: 11 commands refactored, 5-6 days of work, 500-1000 lines modified/added.
