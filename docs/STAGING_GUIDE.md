# Staging Workflow Guide

This guide explains how to use the staging feature in Documentation Robotics CLI to stage and commit architecture model changes.

## Overview

The staging workflow allows you to:

- **Stage changes** without modifying the base model
- **Preview changes** in a virtual merged view before committing
- **Commit changes** atomically with drift detection
- **Discard changes** without affecting the base model
- **Export/Import changesets** for sharing or backup

## Quick Start

### 1. Create a Changeset

```bash
dr changeset create my-feature \
  --name "Add New API Endpoints" \
  --description "Add REST endpoints for user management"
```

Output:
```
✓ Created changeset: my-feature
```

### 2. Stage Changes

Stage changes to your changeset without modifying the base model:

```bash
# Stage a new element
dr changeset stage my-feature add \
  --element-id api-endpoint-create-user \
  --layer api \
  --properties '{"method":"POST","path":"/users"}'

# Stage an update
dr changeset stage my-feature update \
  --element-id api-endpoint-list-users \
  --properties '{"description":"Updated description"}'

# Stage a deletion
dr changeset stage my-feature delete \
  --element-id api-endpoint-deprecated
```

### 3. Preview Changes

View how the staged changes will look when merged:

```bash
dr changeset preview my-feature
```

Output:
```
Layer: api
├── api-endpoint-list-users (existing)
├── api-endpoint-create-user (staged ✓)
├── api-endpoint-update-user (existing)
└── api-endpoint-deprecated (staged ✗ delete)

Total Changes: 3 (1 add, 1 update, 1 delete)
```

### 4. Commit Changes

Once satisfied, commit the staged changes to the base model:

```bash
dr changeset commit my-feature
```

The CLI will:
1. Check for drift between base model and changeset base snapshot
2. Validate all changes against schemas and business rules
3. Apply changes atomically to all affected layers
4. Update the changeset status to "committed"

## Workflow Scenarios

### Scenario 1: Feature Development

You're developing a new feature that spans multiple layers:

```bash
# Create changeset for the feature
dr changeset create user-mgmt-v2 \
  --name "User Management v2" \
  --description "Redesign user management system"

# Stage multiple changes across layers
dr changeset stage user-mgmt-v2 add \
  --element-id api-endpoint-create-user \
  --layer api

dr changeset stage user-mgmt-v2 add \
  --element-id api-endpoint-update-user \
  --layer api

dr changeset stage user-mgmt-v2 add \
  --element-id data-model-entity-user \
  --layer data-model

# Preview merged view
dr changeset preview user-mgmt-v2

# Get status
dr changeset show user-mgmt-v2

# Commit when ready
dr changeset commit user-mgmt-v2
```

### Scenario 2: Collaborative Architecture Design

Multiple team members working on different aspects:

```bash
# Team member 1: Working on API changes
dr changeset create team-api-changes \
  --name "API Layer Updates"

dr changeset stage team-api-changes add \
  --element-id api-endpoint-v2-users \
  --layer api

# Export for sharing
dr changeset export team-api-changes --format yaml \
  --output api-changes.yaml

# Share api-changes.yaml with team...

# Team member 2: Apply the exported changeset
dr changeset import --format yaml \
  --input api-changes.yaml

# Verify compatibility
dr changeset preview team-api-changes

# Both commit when satisfied
dr changeset commit team-api-changes
```

### Scenario 3: Model Refactoring

Safely refactor parts of the model:

```bash
# Create changeset for refactoring
dr changeset create refactor-security \
  --name "Security Layer Refactoring"

# Stage the changes (renames, restructuring)
dr changeset stage refactor-security update \
  --element-id security-policy-auth \
  --properties '{"name":"Authentication Policy v2"}'

# Preview to ensure no breaking changes
dr changeset preview refactor-security

# Can safely discard if issues found
dr changeset discard refactor-security

# Or commit if all looks good
dr changeset commit refactor-security
```

### Scenario 4: Emergency Hotfix

Quick fix when drift is detected:

```bash
# Create changeset for hotfix
dr changeset create hotfix-critical \
  --name "Critical Security Patch"

# Stage the fix
dr changeset stage hotfix-critical update \
  --element-id security-policy-auth \
  --properties '{"status":"critical-patch-applied"}'

# Commit with --force to skip drift check if necessary
dr changeset commit hotfix-critical --force
```

## Commands Reference

### Create Changeset

```bash
dr changeset create <id> \
  [--name <name>] \
  [--description <desc>]
```

Creates a new changeset for staging changes.

**Options:**
- `--name`: Human-readable name (defaults to ID)
- `--description`: Detailed description of changes

### Stage Changes

```bash
dr changeset stage <id> <operation> \
  --element-id <id> \
  --layer <layer> \
  [--properties <json>] \
  [--name <name>]
```

Stages a change to the changeset.

**Operations:**
- `add`: Add a new element
- `update`: Modify an existing element
- `delete`: Remove an element

**Options:**
- `--element-id` (required): Element identifier
- `--layer` (required): Target layer
- `--properties`: JSON properties object
- `--name`: Element name

### Unstage Changes

```bash
dr changeset unstage <id> \
  --sequence-number <num>
```

Removes a specific change from the changeset.

**Options:**
- `--sequence-number`: The change to remove (0-based index)

### Preview Changes

```bash
dr changeset preview <id> \
  [--layer <layer>]
```

Shows a virtual merged view of the changeset.

**Options:**
- `--layer`: Show only specific layer

### Show Changeset

```bash
dr changeset show <id> \
  [--json]
```

Displays changeset details and change summary.

**Options:**
- `--json`: Output as JSON

### Commit Changeset

```bash
dr changeset commit <id> \
  [--force] \
  [--validate]
```

Applies staged changes to the base model.

**Options:**
- `--force`: Skip drift detection
- `--validate`: Run validation before commit (default: true)

### Discard Changeset

```bash
dr changeset discard <id>
```

Removes all staged changes and discards the changeset.

### List Changesets

```bash
dr changeset list \
  [--status <status>] \
  [--json]
```

Lists all changesets.

**Options:**
- `--status`: Filter by status (staged, committed, discarded)
- `--json`: Output as JSON

### Export Changeset

```bash
dr changeset export <id> \
  --format <format> \
  [--output <path>]
```

Exports changeset for sharing or backup.

**Formats:**
- `yaml`: YAML format (recommended)
- `json`: JSON format

**Options:**
- `--output`: Write to file (default: stdout)

### Import Changeset

```bash
dr changeset import \
  --format <format> \
  --input <path>
```

Imports a previously exported changeset.

**Options:**
- `--format`: File format (yaml or json)
- `--input`: Path to changeset file

## Understanding Changeset Status

Changesets progress through the following statuses:

### 📝 staged
- Default status for new changesets
- Changes are staged but not applied to base model
- Can be modified, previewed, or committed

### ✅ committed
- Changes have been applied to the base model
- All layers updated
- Changeset is archived for audit trail

### ❌ discarded
- Changes were abandoned
- No changes applied
- Changeset is archived

## Drift Detection

Drift occurs when the base model changes while you have staged changes. The CLI detects drift by comparing the current base model against the snapshot taken when the changeset was created.

### Handling Drift

**Without --force:**
```bash
$ dr changeset commit my-feature
✗ Drift detected in layers: api, data-model

  The base model has changed since this changeset was created.
  Affected elements:
  - api-endpoint-new (added)
  - data-model-entity-user (modified)

  Options:
  1. Resolve conflicts in staged changes: dr changeset stage ...
  2. Accept drift and force commit: dr changeset commit --force
  3. Discard and start fresh: dr changeset discard
```

**With --force:**
```bash
dr changeset commit my-feature --force
✓ Applied 5 changes (with drift override)
✓ Committed changeset: my-feature
```

## Best Practices

### 1. Keep Changesets Focused

Create separate changesets for different features:

```bash
# Good: Focused changesets
dr changeset create add-auth-endpoints
dr changeset create refactor-data-model
dr changeset create update-api-docs

# Avoid: Mixing unrelated changes in one changeset
```

### 2. Use Descriptive Names

```bash
# Good
--name "Add OAuth 2.0 Authentication Endpoints"
--description "Implement OAuth 2.0 for external integrations"

# Avoid
--name "Updates"
--description "Various changes"
```

### 3. Preview Before Committing

Always verify the merged view:

```bash
dr changeset preview my-feature
# Review output carefully
dr changeset commit my-feature
```

### 4. Collaborate Using Exports

For team collaboration:

```bash
# Member 1: Create and export
dr changeset create team-feature
# ... stage changes ...
dr changeset export team-feature --format yaml --output feature.yaml

# Member 2: Import and review
dr changeset import --format yaml --input feature.yaml
dr changeset preview team-feature

# Both: Commit when satisfied
dr changeset commit team-feature
```

### 5. Handle Conflicts Early

If drift is detected:

```bash
# Option 1: Resolve the conflict
dr changeset unstage <id> --sequence-number <num>
dr changeset stage <id> ... # Re-stage with new base state

# Option 2: Accept drift (rare)
dr changeset commit <id> --force

# Option 3: Start over
dr changeset discard <id>
dr changeset create <new-id>
```

## Troubleshooting

### "Changeset not found"

```bash
# Verify changeset exists
dr changeset list

# Check spelling
dr changeset show my-changeset-id
```

### "Drift detected"

Drift is normal when working with shared models. Resolve it by:

1. Reviewing the affected elements
2. Unstaging conflicting changes
3. Staging the changes again with current base state
4. Or using `--force` if you're confident in your changes

### "Validation failed"

```bash
# See validation details
dr changeset preview my-feature --verbose

# Common issues:
# - Invalid element ID format
# - Missing required properties
# - Cross-layer reference to non-existent element
```

### "Import compatibility error"

The exported changeset was created with a different base model state. Options:

1. Create a new changeset and manually stage changes
2. Use `--force` to import despite compatibility warning
3. Check if base model has evolved since export

## Advanced Usage

### Dry-run Commit

Preview what commit will do without applying:

```bash
dr changeset commit my-feature --dry-run
```

### Batch Stage Operations

Create a file with multiple changes:

```bash
# batch-changes.yaml
changes:
  - operation: add
    elementId: api-endpoint-users
    layer: api
    properties: { method: GET, path: /users }

  - operation: add
    elementId: api-endpoint-users-id
    layer: api
    properties: { method: GET, path: /users/{id} }

# Apply batch
dr changeset stage my-feature --batch-file batch-changes.yaml
```

### Export for Audit Trail

```bash
# Keep permanent record
dr changeset export my-feature --format yaml \
  --output archive/committed-changesets/my-feature.yaml
```

### Inspect Changes in Diff Format

```bash
dr changeset diff my-feature api
```

Shows changes specific to the api layer in diff format.

## Git Integration

### Commit Changeset with Git

```bash
# Stage your changeset
dr changeset create feature-x
dr changeset stage feature-x ...

# Commit with git
git add documentation-robotics/
git commit -m "feat: Add feature X to architecture model"

# Export for code review
dr changeset export feature-x --format yaml \
  --output changesets/feature-x.yaml

# Push to feature branch
git push origin feature-x

# Create PR with changeset export
```

### Changeset History

Changesets are stored in `documentation-robotics/changesets/` directory:

```bash
# View commit history
git log -- documentation-robotics/changesets/
```

## Migration from Old Format

If upgrading from older CLI versions:

```bash
# Automatic migration runs on first invocation
$ dr version
✓ Migrated 5 changesets to new staging model
  (2 changesets already migrated)

# Verify migration
dr changeset list
```

Old changesets are automatically converted:
- `draft` status → `staged`
- `applied` status → `committed`
- Location: `.dr/changesets/` → `documentation-robotics/changesets/`

## See Also

- [CLI README](../cli/README.md) - General CLI documentation
- [CLAUDE.md](../CLAUDE.md) - Development guide
- [spec/layers/](../spec/layers/) - Layer specifications
