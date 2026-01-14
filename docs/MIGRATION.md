# Changeset Migration Guide

This guide walks you through migrating changesets from the old `.dr/` directory structure to the new `documentation-robotics/` directory structure.

## Overview

The Documentation Robotics CLI has evolved its changeset storage format:

- **Old Format**: `.dr/changesets/{name}.json` (flat structure)
- **New Format**: `documentation-robotics/changesets/{id}/metadata.yaml` + `changes.yaml` (hierarchical with metadata)

The new format provides:
- Better organization with dedicated metadata files
- Enhanced tracking of changeset history and snapshots
- Improved rollback and recovery capabilities
- More flexible status management (draft → staged, applied → committed, reverted → discarded)

## Prerequisites and Warnings

Before migrating, ensure:

1. **Backup Your Data**: Create a backup of your `.dr/` directory
   ```bash
   cp -r .dr .dr.backup
   ```

2. **No Active Changesets**: Ensure no changesets are actively being edited
   ```bash
   dr changeset list
   # If any show "active", complete them first
   ```

3. **Compatibility**: You're using CLI v0.1.0 or later
   ```bash
   dr --version
   ```

4. **Write Permissions**: You have write access to your project directory

⚠️ **Important Notes**:
- Migration is **one-way** - old format will no longer be used after migration
- Status mapping changes behavior: `draft` → `staged`, `applied` → `committed`
- Migration creates snapshots for drift detection - ensure your model is clean
- The old `.dr/` directory is **not automatically deleted** - you can manually remove it after verifying the migration

## Step-by-Step Migration Procedure

### 1. Validate Your Current Setup

Check if migration is needed:
```bash
dr changeset validate-migration
```

This will report:
- Whether old `.dr/changesets` directory exists
- Number of changesets to migrate
- Any validation issues found

### 2. Preview the Migration (Dry-Run)

Preview what will be migrated without making changes:
```bash
dr changeset migrate --dry-run
```

This shows:
- Number of changesets to migrate
- Status mapping for each changeset
- Any potential issues or conflicts
- Estimated new directory structure

### 3. Perform the Migration

Execute the actual migration:
```bash
dr changeset migrate
```

The CLI will:
1. Detect old changesets in `.dr/changesets/`
2. Create base snapshot of current model state
3. Convert each changeset to new format
4. Generate changeset IDs (kebab-case from names)
5. Map old statuses to new statuses
6. Preserve all changes and metadata
7. Report migration summary

Example output:
```
Migrating changesets from .dr/ to documentation-robotics/...
✓ Migrated 5 changesets
✓ 2 changesets were already in new format (skipped)
✓ 1 changeset failed (see errors below)

Migration complete!
- Total processed: 8
- Successfully migrated: 5
- Skipped (already migrated): 2
- Failed: 1

Error details:
- feature-branch: Invalid changeset format
```

### 4. Verify the Migration

List new format changesets to confirm migration succeeded:
```bash
dr changeset list
# Should show all migrated changesets with their new statuses
```

Inspect a specific migrated changeset:
```bash
dr changeset show my-feature
# Shows changes, status, snapshots, and metadata
```

### 5. Cleanup (Optional)

Once you've verified the migration, you can safely remove the old `.dr/` directory:
```bash
rm -rf .dr
```

Or keep it as a backup - the new system won't use it.

## Status Mapping

The migration automatically maps old statuses to new ones:

| Old Status | New Status | Meaning |
|-----------|-----------|---------|
| `draft` | `staged` | Changes prepared but not applied to model |
| `applied` | `committed` | Changes already applied to model |
| `reverted` | `discarded` | Changes abandoned (no longer needed) |

The new statuses are more intuitive:
- **Staged**: In the staging area, ready to review and commit
- **Committed**: Applied to the base model permanently
- **Discarded**: Removed and won't be applied

## Rollback Instructions

If migration fails or you need to revert:

### Option 1: Restore from Backup (Before Cleanup)

If you still have `.dr.backup`:
```bash
# Remove migrated changesets
rm -rf documentation-robotics/changesets

# Restore old format
rm -rf .dr
cp -r .dr.backup .dr
```

Then the CLI will detect the old format and allow re-migration.

### Option 2: Rollback Specific Changesets

If only some changesets failed:
```bash
# List failed changesets
dr changeset validate-migration --show-errors

# Delete the failed ones
dr changeset delete failed-changeset-id

# Re-run migration to retry failed changesets
dr changeset migrate
```

### Option 3: Manual Recovery

If the migration process was interrupted:

1. Check migration status:
   ```bash
   dr changeset validate-migration
   ```

2. Clean up partially migrated changesets:
   ```bash
   # Identify and delete incomplete migrations
   ls documentation-robotics/changesets/
   ```

3. Restart migration:
   ```bash
   dr changeset migrate
   ```

The migration is designed to be **idempotent** - you can run it multiple times safely. Already-migrated changesets will be skipped.

## Troubleshooting

### Problem: "Migration already in progress"

**Solution**: The system detected incomplete migration from previous attempt.
```bash
# Complete the migration
dr changeset migrate

# Or reset and start over
dr changeset validate-migration --reset
dr changeset migrate
```

### Problem: "Invalid changeset format"

**Cause**: Old changeset file is corrupted or malformed.

**Solution**:
1. Check the file manually:
   ```bash
   cat .dr/changesets/bad-changeset.json
   ```

2. Either fix it manually (if possible) or delete it:
   ```bash
   rm .dr/changesets/bad-changeset.json
   ```

3. Re-run migration:
   ```bash
   dr changeset migrate
   ```

### Problem: "Changeset ID conflict"

**Cause**: Two different changesets generated the same ID after kebab-casing.

**Example**: "My Feature" and "my-feature" both become "my-feature"

**Solution**:
1. Rename one of the conflicting changesets in the old format:
   ```bash
   mv .dr/changesets/my-feature.json .dr/changesets/my-feature-v2.json
   ```

2. Re-run migration:
   ```bash
   dr changeset migrate
   ```

### Problem: "Snapshot mismatch - model has changed"

**Cause**: The model changed between creating and migrating changesets.

**Solution**: This is expected if you've made model changes. The migration will use the current model state as the base snapshot. If changesets are sensitive to the exact model state:

1. Create a new changeset for the migration:
   ```bash
   dr changeset create migration-snapshot
   dr changeset stage migration-snapshot add --element-id ... --layer ...
   ```

2. Commit it:
   ```bash
   dr changeset commit migration-snapshot
   ```

3. Then run migration:
   ```bash
   dr changeset migrate
   ```

### Problem: "Permission denied"

**Cause**: You don't have write permissions to the project directory.

**Solution**:
```bash
# Check current permissions
ls -la .dr/
ls -la documentation-robotics/

# Fix permissions if needed
chmod -R u+w .dr/ documentation-robotics/

# Retry migration
dr changeset migrate
```

## FAQ

**Q: Will migration delete my old changesets?**
A: No, the old `.dr/` directory is preserved. You can safely delete it after verifying the migration.

**Q: Can I migrate just some changesets?**
A: Not selectively - the migration processes all changesets in `.dr/changesets/`. However, you can use `dr changeset delete` to remove unwanted changesets after migration.

**Q: What if I'm using the old format and the new format simultaneously?**
A: The CLI will prioritize the new format. If a changeset exists in both locations, the new format version will be used.

**Q: Can I undo a migration?**
A: Yes, see the [Rollback Instructions](#rollback-instructions) section above.

**Q: How long does migration take?**
A: Migration is fast - typically < 1 second for 10 changesets. The time depends on:
- Number of changesets
- Size of changes in each changeset
- Filesystem performance

**Q: Why does the dry-run take time to complete?**
A: The `--dry-run` mode validates the entire migration process without writing files, ensuring you see accurate results. This includes snapshot generation and validation.

## Migration Examples

### Example 1: Simple Migration (Few Changesets)

```bash
$ dr changeset migrate --dry-run
Dry-run: Migration analysis
- Old format changesets found: 2
- Changeset 1: "feature-1" (draft → staged)
- Changeset 2: "feature-2" (applied → committed)
✓ All changesets valid and ready to migrate

$ dr changeset migrate
✓ Migrated 2 changesets
Migration complete!

$ dr changeset list
STAGED   feature-1       Feature implementation
COMMITTED feature-2      Bug fix (applied)
```

### Example 2: Migration with Errors and Rollback

```bash
$ dr changeset migrate
✓ Migrated 8 changesets
✗ 2 changesets failed:
  - broken-changeset: Invalid format
  - incomplete-data: Missing required fields

$ # Inspect and fix the broken one
$ cat .dr/changesets/broken-changeset.json | jq .

$ # Fix the issues manually...
$ # Or delete if not needed
$ rm .dr/changesets/broken-changeset.json

$ # Retry migration
$ dr changeset migrate
✓ Migrated 1 changeset (1 was skipped as already migrated)
✓ All changesets now migrated!
```

### Example 3: Large Migration with Progress Tracking

```bash
$ dr changeset migrate
Processing changesets...
[████████░░░░░░░░░░░░░░░░░░░░░░] 25% (25/100)
[████████████████░░░░░░░░░░░░░░░] 50% (50/100)
[████████████████████████░░░░░░░░] 75% (75/100)
[████████████████████████████████] 100% (100/100)

✓ Migration complete!
- Total: 100 changesets
- Migrated: 98
- Skipped: 2 (already in new format)
- Failed: 0
```

## Next Steps

After successful migration:

1. **Review Staged Changesets**: Check any `staged` changesets (previously `draft`)
   ```bash
   dr changeset show feature-1
   ```

2. **Commit Ready Changesets**: Apply `staged` changesets to your model
   ```bash
   dr changeset commit feature-1
   ```

3. **Archive Old Format**: Delete or archive the `.dr/` backup
   ```bash
   rm -rf .dr.backup
   ```

4. **Update Scripts**: If you have custom scripts using the old `.dr/` format, update them to use the new format

5. **Test Your Workflow**: Verify that changesets work as expected with the new format

## Getting Help

If you encounter issues not covered here:

1. Check changeset validation:
   ```bash
   dr changeset validate-migration --verbose
   ```

2. View detailed error logs:
   ```bash
   dr changeset migrate --verbose
   ```

3. Report issues:
   - Include output from `dr changeset validate-migration`
   - Include migration logs
   - Include count of changesets to migrate

## Technical Details

### Migration Process

1. **Detection**: Scans `.dr/changesets/` for old-format changesets
2. **Validation**: Checks each changeset for structural integrity
3. **Snapshot**: Captures current model state as base snapshot
4. **Conversion**: Transforms each changeset to new format:
   - Generates kebab-case ID from name
   - Maps status values
   - Preserves all changes with sequence numbers
   - Captures changeset metadata (created, modified dates)
5. **Storage**: Saves to `documentation-robotics/changesets/{id}/`
6. **Verification**: Validates migrated changesets are readable

### New Format Structure

```
documentation-robotics/
└── changesets/
    └── {changeset-id}/
        ├── metadata.yaml    # Changeset metadata (name, description, status, dates)
        └── changes.yaml     # Change list with sequence numbers
```

### Idempotence

The migration is **idempotent** - running it multiple times is safe:
- Already-migrated changesets are skipped (detected by ID)
- Failed changesets can be retried
- Partial migrations can be recovered

This makes it safe to:
- Retry after fixing errors
- Re-run after adding new changesets to migrate
- Recover from interruptions
