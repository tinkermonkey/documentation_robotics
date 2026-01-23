# Changeset Migration Guide

This guide walks you through migrating changesets from the old `.dr/` directory structure to the new `documentation-robotics/` structure introduced in DR CLI v0.1.0.

## Overview

The DR CLI has evolved to use a new changeset storage format with improved metadata management and staging capabilities. This migration is **optional but recommended** for projects using the older changeset format.

**Key Changes:**
- **Old format**: `.dr/changesets/{name}.json` (flat structure)
- **New format**: `documentation-robotics/changesets/{id}/metadata.yaml + changes.yaml` (structured directories)
- **Status mapping**: `draft` → `staged`, `applied` → `committed`, `reverted` → `discarded`
- **New capabilities**: Virtual projections, drift detection, staged changes

## Prerequisites and Warnings

### Before You Migrate

1. **Backup your repository**: This is critical. Create a git commit or full backup of your project before proceeding.
   ```bash
   git add -A && git commit -m "Pre-migration backup"
   ```

2. **Stop active CLI operations**: Ensure no other CLI processes are running that might access changesets.
   ```bash
   ps aux | grep "dr"  # Check for running DR processes
   ```

3. **Review changeset status**: Understand which changesets will be migrated and their current status.
   ```bash
   dr changeset list
   ```

4. **Check migration readiness**: Validate that all changesets are compatible.
   ```bash
   dr changeset validate-migration
   ```

### Important Warnings

- ⚠️ **Atomic operation**: The migration is atomic—all changesets migrate together or the operation rolls back.
- ⚠️ **Status changes**: Changeset statuses will be remapped. Review the mapping below.
- ⚠️ **Directory changes**: New changesets will be stored in `documentation-robotics/` instead of `.dr/`.
- ⚠️ **Old format remains**: Old `.dr/changesets/` directory is preserved in backup for rollback.
- ⚠️ **One-way migration**: Once migrated and committed to git, rollback requires manual restoration from backup.

## Migration Process

### Step 1: Validate Migration

First, check if migration is needed and validate changesets:

```bash
dr changeset validate-migration
```

This command will:
- Detect old-format changesets
- Check for already-migrated changesets
- Validate changeset structure
- Report any issues that might prevent migration
- Show warnings if all changesets are already migrated

**Expected output:**
```
✓ Validation complete

Old-format changesets found: 5
Already migrated: 0
Ready to migrate: 5

No validation issues detected
```

### Step 2: Dry-Run (Preview)

Preview the migration without making changes:

```bash
dr changeset migrate --dry-run
```

This shows:
- How many changesets will be migrated
- Status mapping for each changeset
- Any potential issues
- A summary of changes

**Expected output:**
```
Migration Preview (dry-run mode)

Changesets to migrate:
  • feature-branch (5 changes) [draft → staged]
  • hotfix-release (3 changes) [applied → committed]
  • old-experiment (2 changes) [reverted → discarded]
  • api-redesign (8 changes) [draft → staged]
  • bugfix-123 (1 change) [draft → staged]

Summary:
  Total to migrate: 5
  Already migrated: 0
  Expected to fail: 0

No issues detected. Safe to proceed.
```

### Step 3: Create Backup

Before running the actual migration, create a backup of old changesets:

```bash
dr changeset migrate --backup
```

This creates:
- Backup directory: `.dr.backup/changesets/`
- Preserves old format for rollback
- Enables recovery if migration fails

### Step 4: Execute Migration

Run the actual migration:

```bash
dr changeset migrate
```

This performs:
1. Pre-migration validation
2. Backup creation (if not already done)
3. Changeset format conversion
4. Status remapping
5. Verification of migrated changesets
6. Cleanup of old format (optional)

**Expected output:**
```
✓ Migration complete

Results:
  Migrated: 5 changesets
  Skipped: 0 (already migrated)
  Failed: 0

Changesets migrated:
  • feature-branch (staged)
  • hotfix-release (committed)
  • old-experiment (discarded)
  • api-redesign (staged)
  • bugfix-123 (staged)

Backup location: .dr.backup/changesets/
```

### Step 5: Verify Migration

After successful migration, verify all changesets are accessible:

```bash
dr changeset list
```

Confirm:
- All changesets appear with correct names
- Statuses are properly mapped
- Change counts match original changesets
- Descriptions and metadata are preserved

## Status Mapping Reference

Understanding how statuses change during migration:

| Old Status | New Status | Meaning |
|------------|------------|---------|
| `draft` | `staged` | In-progress changesets moved to staging area |
| `applied` | `committed` | Already-applied changes marked as committed |
| `reverted` | `discarded` | Reverted changes marked as discarded |

**Important**: Staged changesets are in the staging area and require explicit commit to be applied to the model.

## Rollback Procedure

### If Migration Fails

If the migration process encounters an error:

1. **Automatic rollback**: The CLI automatically rolls back on failure.
2. **Check backup**: Verify `.dr.backup/changesets/` exists.
3. **Restore manually**: If automatic rollback fails:
   ```bash
   cp -r .dr.backup/changesets .dr/changesets
   ```
4. **Verify restoration**: Check that old changesets are accessible:
   ```bash
   dr changeset list
   ```

### If Migration Succeeds But Needs Reversal

To revert a successful migration:

1. **Restore from backup**:
   ```bash
   dr changeset rollback-migration --from-backup
   ```

   Or manually:
   ```bash
   rm -rf documentation-robotics/changesets
   cp -r .dr.backup/changesets .dr/changesets
   ```

2. **Verify restoration**:
   ```bash
   dr changeset list
   ```

3. **Commit to git**:
   ```bash
   git add -A && git commit -m "Reverted changeset migration"
   ```

### Full Cleanup After Successful Migration

Once confident the migration succeeded:

```bash
# Remove backup to save space
rm -rf .dr.backup/changesets/

# Commit cleanup
git add -A && git commit -m "Remove old changeset backup"
```

## Troubleshooting

### Issue: "Backup directory not found"

**Problem**: Migration failed and backup is missing.

**Solutions**:
1. Check if `.dr.backup/` exists in parent directories
2. Try rollback with force:
   ```bash
   dr changeset rollback-migration --force
   ```
3. Manually restore from git:
   ```bash
   git checkout HEAD -- .dr/changesets/
   ```

### Issue: "Migration incomplete - some changesets failed"

**Problem**: Some changesets couldn't be migrated.

**Solutions**:
1. Review error messages to identify problematic changesets
2. Run validation again:
   ```bash
   dr changeset validate-migration
   ```
3. Check changeset files for corruption:
   ```bash
   cat .dr/changesets/{problematic-name}.json | jq .
   ```
4. Fix issues in old changesets, then re-run migration

### Issue: "Already migrated changesets skipped"

**Problem**: Some changesets appear in both old and new formats.

**Solutions**:
1. Remove old format if confident in new format:
   ```bash
   rm -rf .dr/changesets
   ```
2. Or remove new format to re-migrate:
   ```bash
   rm -rf documentation-robotics/changesets
   dr changeset migrate
   ```

### Issue: "Status mapping looks wrong"

**Problem**: Changesets have unexpected statuses after migration.

**Solutions**:
1. Check old status values:
   ```bash
   cat .dr/changesets/*.json | jq '.status'
   ```
2. Verify mapping is correct (see Status Mapping Reference above)
3. If incorrect, rollback and investigate changeset files
4. Report issue with sample changeset JSON

### Issue: "Migration takes too long"

**Problem**: Large number of changesets causes long migration time.

**Context**:
- Migration processes one changeset at a time
- For 100+ changesets, expect several seconds
- For 1000+ changesets, expect 1+ minute

**Solutions**:
1. Run migration during off-hours
2. Ensure no other processes are accessing changesets
3. Check disk space (backup requires temporary space)
4. For very large migrations, consider splitting into batches

### Issue: "Concurrent CLI access blocked"

**Problem**: Migration fails because other CLI processes are active.

**Solutions**:
1. Stop all running DR processes:
   ```bash
   pkill -f "dr"
   ```
2. Wait for scheduled tasks to complete
3. Disable auto-save if configured
4. Re-run migration

## Working with Migrated Changesets

After successful migration, changesets work similarly but with new capabilities:

### Creating New Changesets

New changesets automatically use the new format:

```bash
dr changeset create my-new-feature --description "New feature"
```

### Accessing Migrated Changesets

Use same commands as before:

```bash
dr changeset list              # List all changesets
dr changeset show old-name     # View specific changeset
dr changeset stage old-name    # Stage changes
dr changeset commit old-name   # Commit staged changes
```

### Virtual Projections

Preview how staged changes will merge with the model:

```bash
dr changeset preview old-name
```

This shows the combined view without permanently applying changes.

### Drift Detection

Check if model changed since changeset was created:

```bash
dr changeset diff old-name
```

This alerts you to potential conflicts before committing.

## Migration Best Practices

1. **Migrate during maintenance window**: Schedule migration when team isn't actively working.

2. **Test in development first**: If possible, test migration on a copy of the project before production.

3. **Document the migration**: Add a git tag or branch noting migration completion.

4. **Keep backup for 30 days**: Don't delete `.dr.backup/` immediately—keep it as safety net.

5. **Verify all changesets**: After migration, verify each changeset works as expected.

6. **Update team workflows**: If your team has changeset procedures, update them to reflect new format.

7. **Monitor for issues**: Watch for unexpected behavior after migration.

8. **Use pre-commit hooks**: Add validation to prevent accidental corruption of new format:
   ```bash
   pre-commit run --all-files
   ```

## Getting Help

If you encounter issues:

1. **Check validation output**: Run validation first for detailed error messages
2. **Review error messages**: Read error messages carefully—they often suggest solutions
3. **Check backup integrity**: Verify backup exists and is readable
4. **Examine changeset files**: Look at problematic `.json` files manually
5. **Check CLI version**: Ensure you're running DR CLI v0.1.0 or later
6. **Report issues**: If stuck, report with:
   - DR CLI version: `dr --version`
   - Validation output: `dr changeset validate-migration`
   - Number and types of changesets
   - Any error messages encountered

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
