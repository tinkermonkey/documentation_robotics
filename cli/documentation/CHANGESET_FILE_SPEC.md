# Changeset File Format Specification

Version: 1.0
Date: 2025-11-27

## Overview

This document specifies the file format and structure for Documentation Robotics changesets. Changesets track isolated modifications (add/update/delete operations) to architecture model elements before they are applied to the main model.

## Directory Structure

```
.dr/changesets/
├── active                           # Contains ID of currently active changeset (plain text)
├── registry.yaml                    # Index of all changesets
└── {changeset-id}/                  # Individual changeset directory
    ├── metadata.yaml                # Changeset metadata
    └── changes.yaml                 # List of tracked changes
```

### Changeset ID Format

Changeset IDs follow the pattern:

```
{type}-{slug}-{date}-{counter}
```

**Examples:**

- `feature-auth-system-2025-01-15-001`
- `bugfix-login-error-2025-01-15-002`
- `exploration-new-architecture-2025-01-16-001`

**Components:**

- `type`: `feature`, `bugfix`, or `exploration`
- `slug`: lowercase, hyphenated version of changeset name
- `date`: ISO date format `YYYY-MM-DD`
- `counter`: 3-digit sequential counter for that date

---

## File: `.dr/changesets/active`

**Format:** Plain text file containing a single line

**Content:** The changeset ID of the currently active changeset

**Example:**

```
feature-auth-system-2025-01-15-001
```

**Notes:**

- File may not exist if no changeset is active
- Only one changeset can be active at a time
- All model operations apply to the active changeset

---

## File: `.dr/changesets/registry.yaml`

**Format:** YAML

**Purpose:** Index and summary of all changesets for quick listing

### Schema

```yaml
version: string # Registry format version (currently "1.0")
changesets: # Map of changeset_id -> summary
  { changeset-id }:
    name: string # Human-readable name
    status: string # "active", "applied", or "abandoned"
    type: string # "feature", "bugfix", or "exploration"
    created_at: string # ISO 8601 timestamp
    elements_count: integer # Total number of changes
```

### Example

```yaml
version: "1.0"
changesets:
  feature-auth-system-2025-01-15-001:
    name: "Authentication System"
    status: "active"
    type: "feature"
    created_at: "2025-01-15T10:30:00Z"
    elements_count: 12
  bugfix-login-error-2025-01-14-001:
    name: "Fix Login Validation"
    status: "applied"
    type: "bugfix"
    created_at: "2025-01-14T14:20:00Z"
    elements_count: 3
  exploration-microservices-2025-01-10-001:
    name: "Microservices Exploration"
    status: "abandoned"
    type: "exploration"
    created_at: "2025-01-10T09:00:00Z"
    elements_count: 45
```

---

## File: `.dr/changesets/{changeset-id}/metadata.yaml`

**Format:** YAML

**Purpose:** Detailed metadata about a specific changeset

### Schema

```yaml
id: string # Changeset ID (matches directory name)
name: string # Human-readable name
description: string # Description of what this changeset does
type: string # "feature", "bugfix", or "exploration"
status: string # "active", "applied", or "abandoned"
created_at: string # ISO 8601 timestamp with timezone
updated_at: string # ISO 8601 timestamp with timezone
workflow: string # "direct-cli", "requirements", or "agent-conversation"
summary: # Aggregate counts of operations
  elements_added: integer # Number of elements added
  elements_updated: integer # Number of elements updated
  elements_deleted: integer # Number of elements deleted
```

### Field Descriptions

| Field                      | Type     | Description                                                                   |
| -------------------------- | -------- | ----------------------------------------------------------------------------- |
| `id`                       | string   | Unique changeset identifier matching directory name                           |
| `name`                     | string   | Short, descriptive name for the changeset                                     |
| `description`              | string   | Detailed description of purpose and scope                                     |
| `type`                     | enum     | `feature` (new functionality), `bugfix` (fixes), `exploration` (experimental) |
| `status`                   | enum     | `active` (in progress), `applied` (merged to main), `abandoned` (discarded)   |
| `created_at`               | ISO 8601 | When changeset was created (with timezone)                                    |
| `updated_at`               | ISO 8601 | Last modification time (with timezone)                                        |
| `workflow`                 | enum     | How changeset was created: `direct-cli`, `requirements`, `agent-conversation` |
| `summary.elements_added`   | integer  | Count of add operations                                                       |
| `summary.elements_updated` | integer  | Count of update operations                                                    |
| `summary.elements_deleted` | integer  | Count of delete operations                                                    |

### Example

```yaml
id: feature-auth-system-2025-01-15-001
name: Authentication System
description: |
  Implements comprehensive authentication and authorization system including:
  - Role-based access control
  - JWT token management
  - Session handling
  - Password policies
type: feature
status: active
created_at: "2025-01-15T10:30:00+00:00"
updated_at: "2025-01-15T16:45:30+00:00"
workflow: agent-conversation
summary:
  elements_added: 8
  elements_updated: 3
  elements_deleted: 1
```

---

## File: `.dr/changesets/{changeset-id}/changes.yaml`

**Format:** YAML

**Purpose:** Chronological list of all changes in this changeset

### Schema

```yaml
version: string                      # Changes format version (currently "1.0")
changes:                             # Array of change objects
  - timestamp: string                # ISO 8601 timestamp when change was made
    operation: string                # "add", "update", or "delete"
    element_id: string               # Full element ID (layer.type.name)
    layer: string                    # Layer name (e.g., "business", "application")
    element_type: string             # Type of element (e.g., "service", "component")
    # For 'add' operations:
    data:                            # Complete element data
      {element-specific-fields}
    # For 'update' operations:
    before:                          # Element state before update
      {element-specific-fields}
    after:                           # Element state after update
      {element-specific-fields}
    # For 'delete' operations:
    before:                          # Element state before deletion
      {element-specific-fields}
```

### Change Operations

#### 1. Add Operation

Represents adding a new element to the model.

**Required fields:** `timestamp`, `operation`, `element_id`, `layer`, `element_type`, `data`

**Example:**

```yaml
- timestamp: "2025-01-15T10:35:00+00:00"
  operation: add
  element_id: security.role.admin
  layer: security
  element_type: role
  data:
    name: Admin
    description: Administrator role with full system access
    permissions:
      - user.create
      - user.delete
      - system.configure
    inherits: []
```

#### 2. Update Operation

Represents modifying an existing element.

**Required fields:** `timestamp`, `operation`, `element_id`, `layer`, `element_type`, `before`, `after`

**Example:**

```yaml
- timestamp: "2025-01-15T14:20:00+00:00"
  operation: update
  element_id: application.service.auth
  layer: application
  element_type: service
  before:
    name: Authentication Service
    status: planned
    dependencies: []
  after:
    name: Authentication Service
    status: in-development
    dependencies:
      - security.role.admin
      - security.role.user
    securedBy: security.policy.auth-required
```

#### 3. Delete Operation

Represents removing an element from the model.

**Required fields:** `timestamp`, `operation`, `element_id`, `layer`, `element_type`, `before`

**Example:**

```yaml
- timestamp: "2025-01-15T16:40:00+00:00"
  operation: delete
  element_id: business.service.legacy-auth
  layer: business
  element_type: service
  before:
    name: Legacy Authentication
    status: deprecated
    description: Old authentication system, replaced by new security layer
```

### Complete Example

```yaml
version: "1.0"
changes:
  - timestamp: "2025-01-15T10:35:00+00:00"
    operation: add
    element_id: security.role.admin
    layer: security
    element_type: role
    data:
      name: Admin
      description: Administrator role with full system access
      permissions:
        - user.create
        - user.delete
        - system.configure
      inherits: []

  - timestamp: "2025-01-15T10:36:00+00:00"
    operation: add
    element_id: security.role.user
    layer: security
    element_type: role
    data:
      name: User
      description: Standard user role with basic access
      permissions:
        - profile.read
        - profile.update
      inherits: []

  - timestamp: "2025-01-15T14:20:00+00:00"
    operation: update
    element_id: application.service.auth
    layer: application
    element_type: service
    before:
      name: Authentication Service
      status: planned
      dependencies: []
    after:
      name: Authentication Service
      status: in-development
      dependencies:
        - security.role.admin
        - security.role.user
      securedBy: security.policy.auth-required

  - timestamp: "2025-01-15T16:40:00+00:00"
    operation: delete
    element_id: business.service.legacy-auth
    layer: business
    element_type: service
    before:
      name: Legacy Authentication
      status: deprecated
      description: Old authentication system, replaced by new security layer
```

---

## Element ID Format

Element IDs follow the pattern:

```
{layer}.{element_type}.{name}
```

**Examples:**

- `business.service.user-management`
- `application.component.login-form`
- `security.role.admin`
- `infrastructure.database.user-db`

---

## Timestamp Format

All timestamps use ISO 8601 format with timezone information:

```
YYYY-MM-DDTHH:MM:SS+00:00
```

**Example:** `2025-01-15T10:30:00+00:00`

**Notes:**

- Timestamps are in UTC (timezone offset +00:00)
- Include seconds precision
- Use timezone-aware format for accurate ordering

---

## Status Values

### Changeset Status

| Status      | Description                                                  |
| ----------- | ------------------------------------------------------------ |
| `active`    | Changeset is currently being worked on or available for work |
| `applied`   | Changeset has been merged into the main model                |
| `abandoned` | Changeset has been discarded and will not be applied         |

### Workflow Values

| Workflow             | Description                                 |
| -------------------- | ------------------------------------------- |
| `direct-cli`         | Created and managed via CLI commands        |
| `requirements`       | Created from a requirements document        |
| `agent-conversation` | Created during interactive AI agent session |

---

## Common Operations for Viewer

### Loading a Changeset

1. Read `metadata.yaml` to get changeset information
2. Read `changes.yaml` to get all changes
3. Parse and validate both files

### Displaying Changes

For each change in `changes.yaml`:

**Add operations:**

- Show element_id and element_type
- Display the complete `data` object
- Mark as "Added"

**Update operations:**

- Show element_id and element_type
- Compute diff between `before` and `after`
- Highlight changed fields
- Mark as "Modified"

**Delete operations:**

- Show element_id and element_type
- Display the `before` object showing what was removed
- Mark as "Deleted"

### Computing Statistics

From `changes.yaml`:

- Total changes: `len(changes)`
- Affected elements: unique `element_id` values
- Affected layers: unique `layer` values
- By operation: count where `operation == "add"/"update"/"delete"`

From `metadata.yaml`:

- Aggregate counts available in `summary` object

### Listing All Changesets

Read `registry.yaml` and display:

- Changeset name and ID
- Status (with visual indicator for active)
- Type
- Element count
- Created date

Sort by `created_at` (newest first) or by `status`

---

## Validation Rules

### Changeset ID

- Must match pattern: `{type}-{slug}-{date}-{counter}`
- Type must be: `feature`, `bugfix`, or `exploration`
- Date must be valid YYYY-MM-DD
- Counter must be 3 digits

### Element ID

- Must match pattern: `{layer}.{element_type}.{name}`
- All parts required (no empty strings)
- Name may contain hyphens but not dots

### Operation Types

- Must be exactly: `add`, `update`, or `delete`
- Case-sensitive (lowercase only)

### Change Consistency

- `add` operations must have `data` field (not `before`/`after`)
- `update` operations must have both `before` and `after` fields
- `delete` operations must have `before` field (not `data` or `after`)

### Timestamps

- Must be valid ISO 8601 format
- Should include timezone
- Must be chronologically ordered within a changeset

---

## Example Use Cases

### Use Case 1: View All Changes

```python
import yaml
from pathlib import Path

def load_changeset(changeset_id):
    base_path = Path(".dr/changesets") / changeset_id

    # Load metadata
    with open(base_path / "metadata.yaml") as f:
        metadata = yaml.safe_load(f)

    # Load changes
    with open(base_path / "changes.yaml") as f:
        changes_data = yaml.safe_load(f)

    return {
        "metadata": metadata,
        "changes": changes_data["changes"]
    }
```

### Use Case 2: Filter Changes by Layer

```python
def get_changes_by_layer(changeset_id, layer_name):
    changeset = load_changeset(changeset_id)
    return [
        change for change in changeset["changes"]
        if change["layer"] == layer_name
    ]
```

### Use Case 3: Compute Diff for Update

```python
def compute_field_changes(before, after):
    """Returns dict of {field: (old_value, new_value)} for changed fields"""
    changes = {}
    all_keys = set(before.keys()) | set(after.keys())

    for key in all_keys:
        old_val = before.get(key)
        new_val = after.get(key)
        if old_val != new_val:
            changes[key] = (old_val, new_val)

    return changes
```

### Use Case 4: Get Active Changeset

```python
def get_active_changeset():
    active_file = Path(".dr/changesets/active")
    if not active_file.exists():
        return None
    return active_file.read_text().strip()
```

---

## Notes for Viewer Implementation

1. **Handle Missing Files Gracefully:** Not all changesets may have an `active` file
2. **Sort Changes Chronologically:** Use `timestamp` field for ordering
3. **Display Timestamps in Local Time:** Convert from UTC for user display
4. **Diff Visualization:** For updates, highlight what changed between `before` and `after`
5. **Status Indicators:** Use visual markers (colors, icons) for different statuses
6. **Empty Changesets:** A changeset may have zero changes (newly created)
7. **Large Changesets:** Consider pagination for changesets with many changes
8. **Validation:** Validate file format and show clear errors if format is invalid

---

## Version History

| Version | Date       | Changes               |
| ------- | ---------- | --------------------- |
| 1.0     | 2025-11-27 | Initial specification |

---

## Contact

For questions about this specification, refer to the Documentation Robotics repository or contact the maintainers.
