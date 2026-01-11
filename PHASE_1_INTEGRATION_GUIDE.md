# Phase 1 Integration Guide

## Overview

This guide explains how to integrate the Phase 1 changeset migration into the CLI initialization flow.

## Integration Points

### 1. CLI Startup (Recommended Location)

The migration should run automatically on first use after upgrade. Add to CLI initialization:

```typescript
// In cli/src/cli.ts or main entry point

import { isMigrationNeeded, migrateChangesets } from './core/changeset-migration.js';
import { Model } from './core/model.js';

async function initializeProject(rootPath: string): Promise<Model> {
  // 1. Load existing model
  const model = await Model.loadOrInitialize(rootPath);

  // 2. Check if migration is needed
  const needsMigration = await isMigrationNeeded(rootPath);

  if (needsMigration) {
    console.log('Migrating changesets to new storage format...');
    try {
      const result = await migrateChangesets(rootPath, model);

      console.log(`✓ Migration complete:`);
      console.log(`  - Migrated: ${result.migratedChangesets} changesets`);
      console.log(`  - Skipped: ${result.skippedChangesets}`);

      if (result.failedChangesets > 0) {
        console.warn(`  - Failed: ${result.failedChangesets}`);
        result.errors.forEach(e => {
          console.warn(`    • ${e.name}: ${e.error}`);
        });
      }
    } catch (error) {
      console.error('Migration failed:', error);
      // Don't fail startup, user can retry with migration command
    }
  }

  return model;
}
```

### 2. Manual Migration Command (Optional)

Add a CLI command for manual migration:

```typescript
// In cli/src/commands/migrate.ts (new file)

import { Command } from 'commander';
import { isMigrationNeeded, migrateChangesets } from '../core/changeset-migration.js';
import { Model } from '../core/model.js';

export function createMigrateCommand(): Command {
  return new Command('migrate')
    .description('Migrate changesets to new storage format')
    .option('--force', 'Force migration even if already done')
    .action(async (options) => {
      try {
        const projectRoot = process.cwd();
        const model = await Model.loadOrInitialize(projectRoot);

        const needed = await isMigrationNeeded(projectRoot);

        if (!needed && !options.force) {
          console.log('No migration needed. All changesets already use new format.');
          return;
        }

        console.log('Starting changeset migration...');
        const result = await migrateChangesets(projectRoot, model);

        console.log('\nMigration Results:');
        console.log(`  Total changesets:   ${result.totalChangesets}`);
        console.log(`  Migrated:           ${result.migratedChangesets}`);
        console.log(`  Skipped (already):  ${result.skippedChangesets}`);
        console.log(`  Failed:             ${result.failedChangesets}`);

        if (result.errors.length > 0) {
          console.error('\nErrors during migration:');
          result.errors.forEach(e => {
            console.error(`  • ${e.name}: ${e.error}`);
          });
        }

        console.log('\nChangesets are now stored in: documentation-robotics/changesets/');
      } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
      }
    });
}
```

Register in main CLI:

```typescript
// In cli/src/cli.ts

program.addCommand(createMigrateCommand());
```

## Usage Scenarios

### Scenario 1: Automatic Migration on Upgrade

When user upgrades to new version:

```bash
$ npm install @documentation-robotics/cli@latest
$ dr info

# Output:
# Migrating changesets to new storage format...
# ✓ Migration complete:
#   - Migrated: 5 changesets
#   - Skipped: 0
#
# Model: My Architecture
# Version: 1.0.0
# ...
```

### Scenario 2: Manual Migration

User can manually trigger migration:

```bash
$ dr migrate
# Starting changeset migration...
#
# Migration Results:
#   Total changesets:   5
#   Migrated:           5
#   Skipped (already):  0
#   Failed:             0
#
# Changesets are now stored in: documentation-robotics/changesets/
```

### Scenario 3: Verify Migration Success

```bash
$ dr changeset list
# Listed changesets in: documentation-robotics/changesets/
#
# api-updates-001
#   Name: API Layer Updates
#   Status: draft
#   Changes: 3 (2 additions, 1 modification)
#   Base Snapshot: sha256:abc123...
#
# db-migration-002
#   Name: Database Migration
#   Status: committed
#   Changes: 2 (1 addition, 1 deletion)
#   Base Snapshot: sha256:def456...
```

## Implementation Considerations

### 1. Progress Reporting

For large migrations with many changesets:

```typescript
async function migrateChangesets(
  rootPath: string,
  model: Model,
  onProgress?: (current: number, total: number) => void
): Promise<MigrationResult> {
  const oldChangesets = await oldManager.list();
  const total = oldChangesets.length;

  for (let i = 0; i < oldChangesets.length; i++) {
    // ... migration logic ...
    onProgress?.(i + 1, total);
  }

  return result;
}

// Usage with progress:
const result = await migrateChangesets(rootPath, model, (current, total) => {
  console.log(`Migrating: ${current}/${total}`);
});
```

### 2. Error Recovery

If migration fails partway through:

```typescript
async function migrateChangesets(
  rootPath: string,
  model: Model,
  continueOnError: boolean = true
): Promise<MigrationResult> {
  const result: MigrationResult = {
    totalChangesets: 0,
    migratedChangesets: 0,
    failedChangesets: 0,
    skippedChangesets: 0,
    errors: [],
  };

  try {
    const oldChangesets = await oldManager.list();

    for (const oldChangeset of oldChangesets) {
      try {
        // ... migration logic ...
      } catch (error) {
        result.failedChangesets++;
        result.errors.push({
          name: oldChangeset.name,
          error: error instanceof Error ? error.message : String(error),
        });

        if (!continueOnError) {
          throw error;
        }
      }
    }
  } catch (error) {
    if (!continueOnError) throw error;
  }

  return result;
}
```

### 3. Dry Run Mode

Allow users to preview migration without applying:

```typescript
async function migrateChangesets(
  rootPath: string,
  model: Model,
  options?: { dryRun?: boolean }
): Promise<MigrationResult> {
  // ... setup ...

  if (options?.dryRun) {
    console.log('[DRY RUN] Would migrate:');
    for (const changeset of oldChangesets) {
      console.log(`  • ${changeset.name} → ${generateChangesetId(changeset.name)}`);
    }
    return result;
  }

  // ... actual migration ...
  return result;
}
```

## Testing the Integration

### Unit Tests

Run the migration tests:

```bash
npm run test:unit -- tests/unit/core/changeset-migration.test.ts
```

### Integration Tests

Create an integration test for the full workflow:

```typescript
// tests/integration/changeset-migration.test.ts

describe('Changeset Migration Integration', () => {
  it('should migrate changesets during project initialization', async () => {
    // Create test project with old-format changesets
    const projectPath = '/tmp/test-migration-project';

    // Add old changesets to .dr/changesets/
    const oldManager = new ChangesetManager(projectPath);
    await oldManager.create('legacy-1', 'Legacy Changeset');

    // Initialize project (triggers migration)
    const model = await initializeProject(projectPath);

    // Verify new format exists
    const newStorage = new StagedChangesetStorage(projectPath);
    const migrated = await newStorage.list();
    expect(migrated.length).toBeGreaterThan(0);
  });
});
```

### Manual Testing

1. Create a test project with old-format changesets
2. Upgrade to new CLI version
3. Verify migration runs automatically
4. Confirm changesets appear in `documentation-robotics/changesets/`
5. Verify metadata and changes are correct in YAML files

## Rollback Strategy

If migration causes issues, users can:

1. Restore from Git (if changesets were tracked)
2. Use old CLI version temporarily
3. Report issue with error logs
4. Manual re-apply of changesets if needed

```bash
# Rollback to previous version
npm install @documentation-robotics/cli@0.0.4

# Old format still available in .dr/changesets/
dr changeset list --old-format
```

## Documentation Updates

Update CLI documentation to include:

1. **Migration Guide** - How to migrate changesets
2. **New Storage Format** - Explain YAML structure
3. **Breaking Changes** - Old `.dr/changesets/` deprecated
4. **Troubleshooting** - Common migration issues

Example documentation entry:

```markdown
## Changeset Storage Migration (v0.2.0+)

### Overview
Changesets have been migrated from `.dr/changesets/` to `documentation-robotics/changesets/`
for better Git integration and collaboration.

### Migration
Migration runs automatically on first use after upgrade. To manually run:

\`\`\`bash
dr migrate
\`\`\`

### Storage Structure
New changesets use YAML format:

\`\`\`
documentation-robotics/changesets/{id}/
├── metadata.yaml
└── changes.yaml
\`\`\`

### New Features
- **Status Lifecycle**: draft → staged → committed
- **Base Snapshots**: Detect drift from original base model
- **Sequence Numbers**: Deterministic change replay
- **Git Integration**: Easy to version control and collaborate
```

## Success Metrics

After integration, verify:

- [ ] Migration runs automatically on first CLI invocation after upgrade
- [ ] All changesets successfully migrated to new format
- [ ] YAML files are human-readable and Git-friendly
- [ ] Existing commands (`changeset list`, `apply`, `revert`) still work
- [ ] No data loss or corruption
- [ ] Clear status messages to user
- [ ] Error handling is graceful
- [ ] Rollback is possible if needed

---

For detailed API reference, see `/workspace/PHASE_1_API_REFERENCE.md`

For implementation summary, see `/workspace/PHASE_1_IMPLEMENTATION_SUMMARY.md`
