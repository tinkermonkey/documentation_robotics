---
description: Show overview of the architecture model — layer element counts, version, and metadata
argument-hint: "[--layer <name>] [--verbose]"
---

# Model Info

Show an overview of the Documentation Robotics model: project metadata, layer names, and element counts per layer.

## What This Command Does

Displays:

- Project name, version, spec version, author, description
- List of all 12 layers with their element counts
- With `--layer <name>`: detailed view of a single layer (counts only)

## Usage

```
/dr-info [--layer <name>]
```

## Instructions for Claude Code

### When to Run `dr info`

Run `dr info` as the **first orientation step** when starting any modeling session or when you need to understand the model's overall shape. It is the fastest way to answer:

- "How many elements exist per layer?"
- "What version is the model?"
- "Which layers have content?"

### Decision Flowchart: `dr info` vs. Related Commands

| Goal                               | Command                |
| ---------------------------------- | ---------------------- |
| Model overview (counts per layer)  | `dr info`              |
| Per-type breakdown within a layer  | `dr list <name>`       |
| Health metrics (orphans, coverage) | `dr stats`             |
| List actual element IDs in a layer | `dr list <layer>`      |
| Find an element by name/type       | `dr search <term>`     |
| Inspect a single element           | `dr show <element-id>` |

### Recommended Session Start Sequence

```bash
# 1. Orientation — understand what exists
dr info

# 2. Check for active changeset — know your editing context
dr changeset status

# 3. Validate current state before making changes
dr validate
```

### Using `--layer`

```bash
# Overview of all layers
dr info

# Summary for one layer (only that layer is loaded — much faster)
dr info --layer api
# Example output:
#   api
#     Elements: 47
```

Use `dr list <layer>` to get per-type breakdown with specific element IDs.

### Known Blind Spots

`dr info` does NOT show:

- **Active changeset**: Whether a changeset is currently staged. Run `dr changeset status` separately.
- **Validation health**: Whether the model has any errors or warnings. Run `dr validate` separately.
- **Relationship counts**: How many cross-layer references or intra-layer relationships exist. Run `dr stats` for connectivity metrics.
- **Per-type breakdown** (all-layers mode): Without `--layer`, only total element counts per layer are shown, not breakdown by type.

### No Machine-Readable Output

`dr info` has no `--json` or `--output` flag. For programmatic element data, use:

```bash
dr list <layer> --json          # All elements in a layer as JSON
dr stats --format json           # Health metrics as JSON
```

## Example Output

```
Model: Documentation Robotics Viewer
────────────────────────────────────────────────
Name:          Documentation Robotics Viewer
Version:       0.3.1
Spec Version:  0.8.3
Author:        Austin Sand
Created:       2025-11-01T00:00:00.000Z
Modified:      2026-04-11T18:22:14.931Z

Layers:
────────────────────────────────────────────────
motivation       18 elements
business         32 elements
security         14 elements
application      41 elements
technology       12 elements
api              47 elements
data-model       23 elements
data-store        8 elements
ux               19 elements
navigation        9 elements
apm              22 elements
testing          20 elements
```

## Related Commands

- `dr changeset status` — check active changeset before making changes
- `dr validate` — check model health before editing
- `dr list <layer>` — list element IDs in a specific layer
- `dr stats` — relationship coverage and orphan metrics
- `dr show <element-id>` — inspect a single element in detail
