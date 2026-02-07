# Changeset Migration Guide (Historical Reference)

> **ℹ️ Status**: This guide is for **historical reference only**. As of DR CLI v0.1.0, changeset migration from the old `.dr/` format to `documentation-robotics/` is **automatic and transparent**, occurring on first use without requiring manual action.

## Overview

The DR CLI evolved from a flat changeset storage format (`.dr/changesets/{name}.json`) to a structured directory-based format (`documentation-robotics/changesets/{id}/metadata.yaml + changes.yaml`). This migration happens automatically.

**Format Migration:**

- **Old format**: `.dr/changesets/{name}.json` (flat JSON files)
- **New format**: `documentation-robotics/changesets/{id}/metadata.yaml + changes.yaml` (structured directories)

**Status Mapping:**
When migrated, changeset statuses map as follows:

- `draft` → `staged` (in-progress work moved to staging area)
- `applied` → `committed` (already-applied changes marked as committed)
- `reverted` → `discarded` (reverted changes marked as discarded)

## Technical Details

### Automatic Migration Process

When you first use the CLI with old-format changesets:

1. **Detection**: Scans `.dr/changesets/` for old-format changesets
2. **Backup**: Creates `.dr.backup/changesets/` preserving old format
3. **Conversion**: Transforms each changeset to new format:
   - Generates kebab-case ID from changeset name
   - Maps status values to new format
   - Preserves all changes with sequence numbers
   - Captures metadata (created, modified dates)
4. **Storage**: Saves to `documentation-robotics/changesets/{id}/`
5. **Verification**: Validates migrated changesets are readable

### New Format Structure

```
documentation-robotics/
└── changesets/
    └── {changeset-id}/
        ├── metadata.yaml    # Changeset metadata (name, description, status, dates)
        └── changes.yaml     # Change list with sequence numbers
```

### Key Properties

- **Automatic**: No manual intervention required
- **Transparent**: Happens silently on first CLI use
- **Idempotent**: Safe to re-run; already-migrated changesets are skipped
- **Recoverable**: Old format preserved in backup directory

## Backup and Recovery

### Backup Location

If migration occurs, the original changeset format is preserved at:

```
.dr.backup/changesets/
```

### Manual Rollback

If you need to restore the old format:

```bash
# Remove new format
rm -rf documentation-robotics/changesets

# Restore from backup
cp -r .dr.backup/changesets .dr/changesets

# Verify restoration
dr changeset list
```

## Working with Migrated Changesets

After automatic migration, changesets use the same commands:

```bash
dr changeset list              # List all changesets
dr changeset show name         # View specific changeset
dr changeset stage name        # Stage changes
dr changeset commit name       # Commit staged changes
dr changeset preview name      # Virtual projection of changes
dr changeset diff name         # Check for drift since creation
```

### New Capabilities

Migrated changesets gain new functionality:

- **Virtual Projections**: Preview how staged changes merge with the model
- **Drift Detection**: Check if model changed since changeset creation
- **Staged Status**: Staged changesets require explicit commit to apply

## Troubleshooting

### Migration didn't occur

This is normal if you're already using the new format. Run:

```bash
dr changeset list
```

If changesets appear in `documentation-robotics/changesets/`, migration has already completed.

### Backup directory exists but migration failed

Check that both old and new locations work:

```bash
# Check old format
ls -la .dr/changesets/

# Check new format
ls -la documentation-robotics/changesets/

# Validate integrity
dr changeset list
```

### Lost changesets after migration

Restore from backup:

```bash
# Check backup exists
ls -la .dr.backup/changesets/

# Restore manually if needed
cp -r .dr.backup/changesets/* documentation-robotics/changesets/
```

## FAQ

**Q: Can I still use the old `.dr/` format?**
A: New CLI versions don't read the old format directly. Migration is one-way but automatic.

**Q: Will my old changesets be deleted?**
A: No, they're preserved in `.dr.backup/changesets/`. You can safely delete the backup after confirming migration.

**Q: Can I choose not to migrate?**
A: Migration happens automatically on first CLI use. If you need to keep the old format, don't upgrade the CLI.

**Q: How do I know if migration completed?**
A: Check for the `documentation-robotics/changesets/` directory. If it exists and has your changesets, migration is complete.

**Q: What if migration fails?**
A: The CLI will alert you and preserve both old and new directories. Check backup integrity and try the restore procedure above.

## See Also

- [Changeset Documentation](../cli/docs/CHANGESETS.md) - Current changeset usage
- [Staging Guide](../docs/STAGING_GUIDE.md) - Using staged changesets with virtual projections
