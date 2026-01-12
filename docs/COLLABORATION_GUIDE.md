# Changeset Sharing and Collaboration Guide

This guide explains how to use the changeset export/import features for offline sharing and Git-based collaboration workflows in Documentation Robotics.

## Overview

The export/import functionality enables:

- **Offline collaboration**: Share changesets without requiring live access to repositories
- **Git-based workflows**: Track changesets in version control for code review
- **Multi-user collaboration**: Multiple team members can work on changesets independently
- **Format flexibility**: Export in YAML, JSON, or patch format depending on your workflow
- **Compatibility validation**: Automatic detection of base model drift and validation

## Quick Start: Export a Changeset

### Export to YAML (Default)

```bash
dr changeset export api-updates
# Output: api-updates.yaml
```

### Export with Custom Output Path

```bash
dr changeset export api-updates --output changes.yaml
```

### Export to JSON Format

```bash
dr changeset export api-updates --format json --output changes.json
```

### Export to Patch Format

```bash
dr changeset export api-updates --format patch --output changes.patch
```

## Importing Changesets

### Basic Import

```bash
dr changeset import changes.yaml
# Output: ✓ Imported changeset: API Layer Updates (imported-1704067200000)
```

### Import with Validation

The import command automatically:

1. Validates the file format
2. Checks base model compatibility
3. Warns about base model drift
4. Assigns a new changeset ID to avoid conflicts

### Handling Compatibility Issues

If import fails due to incompatibilities:

```
✗ Import failed: Changeset is incompatible
  Issues:
    - Cannot update non-existent element api-endpoint-delete-me
    - Element api-endpoint-create-user already exists in layer api
```

Review the changeset before importing and ensure all referenced elements exist.

## Git-Based Collaboration Workflow

This section describes how to use changesets for team collaboration via Git.

### User A: Create and Share Changes

#### Step 1: Create a Feature Branch

```bash
git checkout -b feature/api-user-endpoints
```

#### Step 2: Create a Changeset

```bash
dr changeset create api-user-endpoints \
  --description "Add user management endpoints"
```

#### Step 3: Stage Your Changes

```bash
dr changeset activate api-user-endpoints

# Add new endpoints
dr add endpoint create-user --layer api \
  --properties '{"method":"POST","path":"/users"}'

dr add endpoint get-user --layer api \
  --properties '{"method":"GET","path":"/users/{id}"}'

dr add endpoint update-user --layer api \
  --properties '{"method":"PUT","path":"/users/{id}"}'

dr changeset deactivate
```

#### Step 4: Preview Changes

```bash
dr changeset preview --layer api
```

#### Step 5: Export the Changeset

```bash
dr changeset export api-user-endpoints \
  --output api-user-endpoints.yaml
```

#### Step 6: Commit and Push to Git

```bash
git add api-user-endpoints.yaml documentation-robotics/changesets/api-user-endpoints/
git commit -m "feat: Add user management API endpoints"
git push origin feature/api-user-endpoints
```

### User B: Review and Import Changes

#### Step 1: Pull the Feature Branch

```bash
git checkout feature/api-user-endpoints
git pull origin feature/api-user-endpoints
```

#### Step 2: Import the Changeset

```bash
dr changeset import api-user-endpoints.yaml
# Output: ✓ Imported changeset: Add user management endpoints (imported-1704067200000)
```

#### Step 3: Preview the Changes

```bash
dr changeset preview --layer api
```

#### Step 4: Validate Against Current Model

```bash
dr changeset diff --layer api
```

#### Step 5: Approve and Commit Changes

Once satisfied with the changes:

```bash
# Get the imported changeset ID (shown during import)
CHANGESET_ID="imported-1704067200000"

# Activate to check staged changes
dr changeset activate $CHANGESET_ID
dr changeset staged

# Commit the changes
dr changeset commit

# Deactivate
dr changeset deactivate
```

#### Step 6: Create Pull Request

```bash
git add documentation-robotics/
git commit -m "feat: Apply user management endpoints"
git push origin feature/api-user-endpoints
```

Then create a pull request on GitHub for code review.

## Export Formats

### YAML Format (Default)

Best for: Human readability, Git diffs, version control

**Example:**

```yaml
id: api-user-endpoints
name: Add user management endpoints
description: New REST endpoints for user management
created: '2024-01-15T10:00:00Z'
modified: '2024-01-15T14:30:00Z'
status: staged
baseSnapshot: 'sha256:abc123...'
export:
  version: '0.1.0'
  exportedAt: '2024-01-15T15:00:00Z'
  format: yaml
stats:
  additions: 3
  modifications: 0
  deletions: 0
changes:
  - type: add
    elementId: api-endpoint-create-user
    layerName: api
    sequenceNumber: 0
    timestamp: '2024-01-15T10:15:00Z'
    after:
      id: api-endpoint-create-user
      name: Create User
      type: endpoint
      properties:
        method: POST
        path: /users
  - type: add
    elementId: api-endpoint-get-user
    layerName: api
    sequenceNumber: 1
    timestamp: '2024-01-15T10:20:00Z'
    after:
      id: api-endpoint-get-user
      name: Get User
      type: endpoint
      properties:
        method: GET
        path: /users/{id}
```

**Advantages:**
- Human-readable
- Easy to review in Git diffs
- Supports comments
- Industry standard for configuration

### JSON Format

Best for: Programmatic processing, API integrations

**Example:**

```json
{
  "id": "api-user-endpoints",
  "name": "Add user management endpoints",
  "description": "New REST endpoints for user management",
  "created": "2024-01-15T10:00:00Z",
  "modified": "2024-01-15T14:30:00Z",
  "status": "staged",
  "baseSnapshot": "sha256:abc123...",
  "export": {
    "version": "0.1.0",
    "exportedAt": "2024-01-15T15:00:00Z",
    "format": "json"
  },
  "stats": {
    "additions": 3,
    "modifications": 0,
    "deletions": 0
  },
  "changes": [
    {
      "type": "add",
      "elementId": "api-endpoint-create-user",
      "layerName": "api",
      "sequenceNumber": 0,
      "timestamp": "2024-01-15T10:15:00Z",
      "after": {
        "id": "api-endpoint-create-user",
        "name": "Create User",
        "type": "endpoint",
        "properties": {
          "method": "POST",
          "path": "/users"
        }
      }
    }
  ]
}
```

**Advantages:**
- Machine-readable
- Easy to parse programmatically
- Good for automation

### Patch Format

Best for: Email/messaging, traditional diff viewing

**Example:**

```diff
From: api-user-endpoints
Date: 2024-01-15T15:00:00Z
Base: sha256:abc123...
Subject: Add user management endpoints

New REST endpoints for user management

---
 3 files changed, 3 insertions(+)

diff --git a/api/elements.yaml b/api/elements.yaml
index abc123..def456 100644
--- a/api/elements.yaml
+++ b/api/elements.yaml
@@ -10,3 +10,27 @@ elements:
     properties:
       method: GET
       path: /customers
+  - id: api-endpoint-create-user
+    name: "Create User"
+    type: endpoint
+    properties:
+      method: POST
+      path: /users
+  - id: api-endpoint-get-user
+    name: "Get User"
+    type: endpoint
+    properties:
+      method: GET
+      path: /users/{id}
+  - id: api-endpoint-update-user
+    name: "Update User"
+    type: endpoint
+    properties:
+      method: PUT
+      path: /users/{id}
```

**Advantages:**
- Familiar to developers (Git-style)
- Good for email/messaging
- Easy to review changes

## Base Model Drift Detection

When importing a changeset, the system automatically detects if the base model has changed since the changeset was created.

### What Happens When Drift is Detected

```bash
dr changeset import changes.yaml
# Output:
# ✓ Imported changeset: API Updates (imported-1704067200000)
# ⚠ Warning: Base model has changed
#   The model has been modified since this changeset was created.
#   Review the changes carefully before committing.
```

### Handling Drift

1. **Non-conflicting changes**: If your changeset only adds new elements, it can be safely committed despite drift
2. **Conflicting changes**: If your changeset modifies or deletes elements that were also changed, you may need to resolve conflicts manually
3. **Review carefully**: Always preview changes before committing when drift is detected

```bash
# Check what the merged state will look like
dr changeset preview --layer api

# Review differences
dr changeset diff --layer api

# If comfortable, commit
dr changeset commit
```

## Compatibility Validation

The import process validates:

- **File format**: Detects YAML, JSON, or patch format automatically
- **Required fields**: Ensures `id`, `name`, `created`, `modified` are present
- **Element references**: For updates and deletes, verifies elements exist in current model
- **No conflicts**: For additions, verifies elements don't already exist
- **Base compatibility**: Warns if base model has drifted

### Example Validation Failure

```bash
dr changeset import broken-changeset.yaml
# Output:
# ✗ Import failed: Changeset is incompatible
#   Issues:
#     - Cannot update non-existent element api-endpoint-missing
#     - Element api-endpoint-exists already exists in layer api
```

Fix the issues and try again, or create a new changeset based on current model state.

## Multi-Format Workflow

You can leverage different formats for different purposes:

1. **YAML in Git**: Store primary changeset in YAML for readability
2. **JSON for Automation**: Generate JSON exports for CI/CD pipelines
3. **Patch for Email**: Export patch format to share via email or messaging

```bash
# Create all formats from single changeset
dr changeset export api-updates --format yaml --output api-updates.yaml
dr changeset export api-updates --format json --output api-updates.json
dr changeset export api-updates --format patch --output api-updates.patch
```

## Best Practices

### 1. Always Export Before Sharing

```bash
dr changeset export my-changes --output my-changes.yaml
git add my-changes.yaml
git commit -m "Export changeset for team review"
```

### 2. Validate Before Committing

```bash
dr changeset import team-changes.yaml
dr changeset preview
dr changeset diff
# Review output carefully
dr changeset commit
```

### 3. Use Descriptive Changeset Names

```bash
# Good
dr changeset create api-customer-endpoints \
  --description "Add CRUD endpoints for customer management"

# Less helpful
dr changeset create changes-2024-01-15 \
  --description "New stuff"
```

### 4. Export Before Branch Switching

If you need to switch branches, export your changeset first:

```bash
dr changeset export my-feature --output ../my-feature.yaml
git stash
git checkout main
# Later...
git checkout feature/my-feature
dr changeset import ../my-feature.yaml
```

### 5. Document Complex Changes

Use detailed descriptions for changesets:

```bash
dr changeset create user-auth-overhaul \
  --description "Refactor authentication system:
  - Replace session tokens with JWT
  - Add OAuth2 endpoints
  - Update security layer policies"
```

### 6. Review Before Committing

Always preview and diff before final commit:

```bash
dr changeset preview --layer api
dr changeset diff --layer data-model
dr changeset diff --layer security
# Review all changes across layers
dr changeset commit
```

## Troubleshooting

### Import Says File Not Found

Make sure the path is correct and the file exists:

```bash
# Use absolute path
dr changeset import /absolute/path/to/changes.yaml

# Or verify relative path
ls changes.yaml  # Check if file exists
```

### Base Model Drift Warnings

If your changeset is very old and the model has changed significantly:

1. Export the current model state
2. Compare with your changeset
3. Manually resolve conflicts
4. Update changeset or create new one

### Format Detection Issues

Explicitly specify format if auto-detection fails:

```bash
# Force YAML parsing
dr changeset import changes.yaml  # auto-detected

# Or use another format
dr changeset import changes.json  # auto-detected
```

### Changeset ID Conflicts

Import automatically assigns new IDs, but you can manage this:

```bash
# View imported changeset ID
dr changeset import changes.yaml
# Output shows new ID

# List all changesets
dr changeset list
```

## Integration with CI/CD

Export changesets in CI pipelines for automated processing:

```bash
#!/bin/bash
# Export all changesets for backup
mkdir -p ./exports
for changeset in $(dr changeset list --format json | jq -r '.[].id'); do
  dr changeset export "$changeset" --output "./exports/$changeset.yaml"
done

# Upload to backup storage
# ...
```

## Security Considerations

- **Sensitive data**: Be careful not to export changesets containing sensitive configuration
- **Access control**: Store exported files in appropriate locations with proper permissions
- **Git history**: Remember that exported files become part of Git history
- **PII**: Don't include personally identifiable information in element names or descriptions

## See Also

- [Staging Workflow Guide](./STAGING_GUIDE.md) - Detailed staging operations
- [CLI Commands Reference](../cli/README.md) - Complete command reference
