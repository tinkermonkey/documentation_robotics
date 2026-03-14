---
description: Wire intra-layer and inter-layer relationships across populated model layers
argument-hint: "[--layers <layers>] [--intra-only | --inter-only]"
---

# Wire Relationships Across the Architecture Model

Analyze the current model state, discover valid predicates per element-type pair, and wire
intra-layer and inter-layer relationships across every populated layer.

This command is the relationship counterpart to `/dr-map`. Where `/dr-map` creates elements
(nodes), `/dr-relate` wires how those elements connect to each other.

## What This Command Does

1. Reads the full model to determine which layers have elements
2. Loads valid relationship schemas for those layers via `dr schema relationship`
3. **Phase A — Intra-layer:** For each populated layer, identifies and creates
   relationships between elements within that layer
4. **Phase B — Inter-layer:** Identifies and creates cross-layer relationships between
   elements in different populated layers
5. Validates the resulting relationship graph
6. Reports relationships created, skipped, and any gaps

Both phases use `dr relationship add`, which validates every relationship against the
full set of spec-defined schemas — intra-layer and cross-layer alike.

## Why Relationships Are a Separate Pass

Relationships require the full model to be visible before wiring can begin:

- A `ux.librarycomponent.renders.ux.view` relationship can't be created until both
  the source and target UX elements exist
- Cross-layer relationships (e.g., `business.businessservice --[delivers-value]--> motivation.value`)
  can't be wired until both layers are populated
- Re-running `/dr-relate` after adding more layers is cheap — no nodes are re-created

## Two Phases

**Phase A — Intra-layer** (per populated layer):

Wire relationships between elements within the same layer. The spec defines hundreds of
intra-layer schemas; Claude evaluates which pairs are semantically warranted based on
element names, descriptions, and shared source provenance.

**Phase B — Inter-layer** (cross-layer):

Wire relationships between elements in different layers. Uses the same `dr relationship add`
command — the CLI validates each attempt against all 32 cross-layer schemas defined in
the spec and rejects combinations not present in the relationship index.

## Usage

```
/dr-relate [--layers <layers>] [--intra-only] [--inter-only]
```

**Options:**

- `--layers <layers>` — Comma-separated list of layers to process
  (e.g., `ux,api,data-model`). Defaults to all populated layers.
- `--intra-only` — Skip Phase B; only wire intra-layer relationships.
- `--inter-only` — Skip Phase A; only wire inter-layer relationships.

**Examples:**

```
/dr-relate
/dr-relate --layers ux,navigation
/dr-relate --layers api,application,data-model --intra-only
/dr-relate --inter-only
```

---

## Instructions for Claude Code

### Step 1: Validate Prerequisites

Check that a model exists and has elements:

```bash
ls documentation-robotics/model/manifest.yaml 2>/dev/null
dr list motivation
```

If no model exists, stop and inform the user:

```
No DR model found. Initialize and populate one first:
  /dr-init <project-name>
  /dr-map <path>
```

If the model exists but has 0 elements, stop:

```
The model has no elements yet. Run /dr-map first to populate nodes,
then re-run /dr-relate to wire their relationships.
```

---

### Step 2: Discover Populated Layers

Read every layer to build a census of what's populated:

```bash
dr list --json
```

Or per layer if a global list is unavailable:

```bash
dr list motivation --json
dr list business --json
# ... repeat for all 12 layers
```

Build a table of populated layers — layers with at least 1 element:

```
Populated layers:
  technology    — 12 elements
  data-store    —  4 elements
  data-model    —  9 elements
  application   —  6 elements
  api           — 31 elements
  ux            — 71 elements
  navigation    —  8 elements

Empty layers (skipped):
  motivation, business, security, apm, testing
```

If `--layers` was specified, filter to only those layers. Warn if a requested layer
is empty.

---

### Step 3: Load Valid Relationship Types

For each populated layer, discover which relationship schemas are defined:

```bash
# All relationship schemas for an element type (intra-layer and cross-layer)
dr schema relationship <element-type>

# Or via the catalog for semantic context
dr catalog types --layer <layer>
```

Run `dr schema relationship` for each distinct element type in the populated layers.
Build a relationship map that includes both intra-layer and cross-layer schemas:

```
ux layer relationship map (intra-layer):
  ux.librarycomponent →[renders]→ ux.view
  ux.librarycomponent →[extends]→ ux.librarycomponent
  ux.view             →[contains]→ ux.widget
  ux.view             →[handles]→ ux.event
  ux.widget           →[triggers]→ ux.event
  ... (123 total intra-layer schemas in ux)

application layer cross-layer schemas:
  application.applicationprocess →[realizes]→ business.businessprocess
  application.applicationservice →[delivers-value]→ motivation.value
  application.applicationservice →[references]→ apm.traceconfiguration
  ...
```

Use this map to drive Phases A and B — only attempt relationships that exist in the
spec. Never guess predicates.

---

### Step 4: Phase A — Intra-layer Relationship Pass

Skip this phase if `--inter-only` was specified.

For each populated layer (in the order they appear in the model):

1. List all elements in the layer with their types and metadata:

   ```bash
   dr list <layer> --json
   ```

2. For each valid intra-layer relationship type `source_type →[predicate]→ dest_type`
   in that layer's relationship map:

   - Find all source elements of `source_type`
   - Find all destination elements of `dest_type`
   - For each (source, dest) pair, evaluate whether the relationship is semantically
     warranted based on:
     - Element names and descriptions
     - Source provenance files (if elements share the same source file, a relationship
       is likely)
     - Domain semantics of the predicate (e.g., `renders` implies a parent component
       rendering a child view)

3. For warranted pairs, create the relationship:

   ```bash
   dr relationship add <source-element-id> <dest-element-id> \
     --predicate <predicate> \
     --properties '{"source_provenance": "inferred", "confidence": "high"}'
   ```

   Set `"confidence"` to `"high"`, `"medium"`, or `"low"` based on how clearly the
   relationship is warranted. Use `"high"` when two elements share a source file or
   a direct naming dependency. Use `"low"` when the relationship is inferred from
   general domain patterns.

4. If `dr relationship add` returns an error (invalid schema combination, duplicate,
   cardinality violation), log the error and continue. Do not abort the pass.

5. After completing the layer, show a checkpoint:

   ```
   Phase A — ux layer complete
   ===========================
   Created: 47 relationships
   Skipped: 8 (low confidence — review recommended)
   Errors:  2 (logged below)

   [c] Continue to next layer
   [r] Review skipped pairs before continuing
   [q] Stop here and validate
   ```

**Intra-layer relationship priorities by layer:**

| Layer       | High-value predicates to look for                              |
| ----------- | -------------------------------------------------------------- |
| ux          | renders, contains, handles, extends, triggers, navigates-to   |
| navigation  | routes-to, contains, links-to, guards                         |
| api         | service-of, extends, depends-on, produces, consumes            |
| data-model  | extends, references, contains                                  |
| data-store  | stores, partitions, indexes                                    |
| application | depends-on, orchestrates, delegates-to                         |
| technology  | depends-on, runs-on, extends                                   |
| security    | protects, requires, grants, scopes                             |
| apm         | monitors, aggregates, triggers                                 |
| testing     | tests, covers, depends-on                                      |
| business    | realizes, depends-on, triggers, supports                       |
| motivation  | supports, influences, realizes, fulfills                       |

---

### Step 5: Phase B — Inter-layer Relationship Pass

Skip this phase if `--intra-only` was specified.

For each pair of populated layers where cross-layer relationship schemas exist:

1. Use the relationship map built in Step 3 to identify which element types in the
   source layer have schemas pointing to element types in the target layer.

2. For each valid cross-layer schema, find warranted (source, dest) pairs across the
   two layers by evaluating element names, descriptions, and source provenance.

3. Create each warranted cross-layer relationship using the same command as Phase A:

   ```bash
   dr relationship add <source-id> <dest-id> \
     --predicate <predicate> \
     --properties '{"source_provenance": "inferred", "confidence": "medium"}'
   ```

4. If `dr relationship add` returns an error (invalid schema combination not in
   the spec index, duplicate, cardinality violation), log and continue.

**Inter-layer relationship schemas (complete spec inventory):**

| Source Layer | Target Layer | Predicates                                                    |
| ------------ | ------------ | ------------------------------------------------------------- |
| api          | application  | references                                                    |
| api          | apm          | references                                                    |
| api          | business     | references                                                    |
| api          | data-store   | maps-to                                                       |
| api          | security     | references, requires                                          |
| application  | apm          | references                                                    |
| application  | business     | realizes                                                      |
| application  | motivation   | delivers-value                                                |
| business     | application  | aggregates, references                                        |
| business     | motivation   | delivers-value                                                |
| business     | security     | constrained-by                                                |
| data-model   | application  | references                                                    |
| data-model   | business     | references                                                    |
| testing      | motivation   | constrained-by, fulfills-requirements, governed-by-principles, supports-goals |

This table is generated from the spec relationship schemas and is authoritative. Run
`dr schema relationship <element-type>` for the exact source and destination types
within each layer pair.

---

### Step 6: Validation

Run validation after all phases complete:

```bash
dr validate
```

If `--strict` was not used by the user, run standard validation first. Offer strict:

```
Validation: ✓ Passed (standard)

Run strict validation for deeper checks?
  dr validate --strict
```

Present results:

```
Validation Results
==================
✓ Schema validation passed
✓ Relationship integrity: all source/target IDs resolve

⚠ 3 semantic warnings:
  1. ux.view.dashboard — no outgoing relationships (isolated node)
  2. api.operation.delete-user — no intra-layer relationships
  3. data-model.objectschema.audit-log — no inbound relationships
```

---

### Step 7: Final Report

Present a complete summary:

```
/dr-relate Complete
===================

Phase A — Intra-layer:
  technology    — 8 relationships created
  data-model    — 5 relationships created
  application   — 12 relationships created
  api           — 41 relationships created
  ux            — 47 relationships created
  navigation    — 9 relationships created
  ─────────────────────────────────────────
  Total:         122 intra-layer relationships

Phase B — Inter-layer:
  application → business      3 created
  application → motivation    2 created
  api → application           7 created
  api → security              4 created
  business → application      5 created
  ─────────────────────────────────────────
  Total:                      21 inter-layer relationships

Validation: ✓ Passed / ⚠ N warnings

Confidence breakdown:
  High:   82% (clear source-sharing or naming dependency)
  Medium: 14% (domain-pattern inference)
  Low:     4% (review recommended)

Next steps:
  - Review low-confidence relationships: dr relationship list <element-id>
  - Fill model gaps: /dr-model
  - Wire more layers when populated: /dr-relate --layers <new-layers>
```

---

## Source Mapping

Relationships should carry provenance whenever it can be determined:

```bash
dr relationship add <source> <target> \
  --predicate <predicate> \
  --properties '{"source_provenance": "inferred", "confidence": "high", "basis": "shared source file"}'
```

**When to record provenance basis:**

| Basis | When to use |
|-------|-------------|
| `shared source file` | Source and target elements share the same `source_file` in their metadata |
| `import dependency` | Source element's file imports the target's file |
| `naming convention` | Names follow a known pattern (e.g., `OrderView` → `OrderService`) |
| `domain pattern` | Relationship inferred from layer-level architectural patterns |

Use `dr show <element-id>` to read source_file metadata from existing elements before
deciding provenance basis.

---

## Error Handling

### No populated layers

```
No populated layers found. The model has no elements to wire.

Run /dr-map first, then re-run /dr-relate.
```

### No valid relationships for a layer

```
No relationship schemas defined for requested layer: <layer-name>

This layer may not have relationships defined in the current spec version.
Skipping.
```

### dr relationship add fails (schema validation)

Log the failure and continue. At the end of the pass, surface skipped pairs:

```
Skipped relationships (not in spec):
  ux.view.dashboard-view →[contains]→ ux.widget.sidebar
    Reason: ux.view.contains.ux.widget is not a defined relationship schema
    Suggestion: Valid predicates for ux.view: renders, handles, triggers
```

### Element not found

```
Skipping: element <id> not found in model
```

This can happen if elements were deleted after the census was built. Log and continue.

---

## Example Interactions

### Example 1: Wire all populated layers

```
User: /dr-relate

You:
Reading model state...

Populated layers: technology (12), data-model (9), application (6), api (31), ux (71)
Empty layers (skipped): motivation, business, security, data-store, navigation, apm, testing

Loading relationship schemas for 5 layers...

Phase A — Intra-layer pass:
  Wiring technology...   8 relationships
  Wiring data-model...   5 relationships
  Wiring application...  12 relationships
  Wiring api...          41 relationships
  Wiring ux...

  Checkpoint: ux layer (71 elements)
  ----------------------------------
  Valid schemas: 123 relationship types
  Warranted pairs identified: 52
  Created: 47 | Skipped (low confidence): 5

  [c] Continue to Phase B (inter-layer)
  [r] Review 5 skipped pairs
  [q] Stop here

> [c]

Phase B — Inter-layer pass:
  application → business   3 created
  api → application        7 created
  api → security           4 created

Validation: ✓ Passed

Total: 113 intra-layer | 14 inter-layer | 0 errors
```

### Example 2: Targeted layer pair

```
User: /dr-relate --layers ux,api

You:
Targeting: ux (71 elements), api (31 elements)

Phase A — Intra-layer:
  Wiring ux...   47 created
  Wiring api...  41 created

Phase B — Inter-layer (api ↔ ux cross-layer schemas):
  api → application  [application not in scope — skipped]
  No cross-layer schemas exist directly between ux and api in the spec.

Done. 88 intra-layer relationships created.

Tip: Include application in --layers to wire api → application cross-layer relationships.
```

### Example 3: Inter-layer only pass after adding new layers

```
User: /dr-relate --inter-only

You:
Skipping Phase A (--inter-only).

Phase B — Inter-layer pass:
  application → business      3 created
  application → motivation    2 created
  api → application           7 created
  business → application      5 created
  business → security         2 created

Inter-layer complete. 19 relationships created.

Validation: ✓ Passed
```

---

## Related Commands

- `/dr-map` — Extract and create model elements (nodes); run before `/dr-relate`
- `/dr-model` — Manually add, adjust, or describe individual elements
- `/dr-validate` — Run deeper model validation after wiring
- `/dr-sync` — Update model after code changes (re-run `/dr-relate` after if structure changed)
- `dr relationship list <id>` — Inspect relationships for a specific element
- `dr schema relationship <type>` — Query valid predicates for an element type (intra-layer and cross-layer)
- `dr catalog types --layer <layer>` — Browse semantic relationship type definitions
