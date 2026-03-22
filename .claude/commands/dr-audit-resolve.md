---
description: Interactively resolve node, relationship, and inter-layer audit findings — walks through low-alignment items and applies spec updates
argument-hint: "[path/to/audit.json|audit-reports/relationships/inter-layer-validation/] [--auto]"
---

# DR Audit Resolve

Walks through audit findings (node, relationship, or inter-layer gap) and guides the spec maintainer through resolving each one interactively. For every flagged item it pre-evaluates the suggestion against the actual spec files, asks what to do, and executes the chosen action directly in the spec.

## Usage

```bash
# With a specific audit file:
/dr-audit-resolve audit-report/nodes-audit.json
/dr-audit-resolve audit-report/relationships-audit.json

# Inter-layer validation — pass the directory to process all pairs at once,
# or pass a single pair file:
/dr-audit-resolve audit-reports/relationships/inter-layer-validation/
/dr-audit-resolve audit-reports/relationships/inter-layer-validation/ux_to_navigation.json

# Auto-discover latest audit in common locations:
/dr-audit-resolve

# Non-interactive mode — automatically execute the recommended action for each item:
/dr-audit-resolve --auto
/dr-audit-resolve audit-reports/all-nodes.json --auto
/dr-audit-resolve audit-reports/relationships/inter-layer-validation/ --auto
```

**Producing audit files:**

```bash
# Node audit with AI scores (required for alignment filtering):
# Saves markdown report + JSON sidecar automatically to audit-reports/
npm run audit:nodes -- --enable-ai --save-json audit-reports/all-nodes.json

# Layer-specific node audit:
npm run audit:nodes -- --layer data-model --enable-ai --save-json audit-reports/data-model-nodes.json

# Relationship audit (writes both .md and .json automatically):
npm run audit:relationships

# Inter-layer gap analysis (requires --enable-ai):
npm run audit:pipeline -- --enable-ai
# Results written to: audit-reports/relationships/inter-layer-validation/
```

## Instructions for Claude Code

When this command is invoked, execute the following steps precisely.

---

### STEP 1: Locate the Audit File

1. If an argument was provided:
   - If it ends with `/` or is a directory path, treat it as the **inter-layer validation directory** — set `auditType = "inter-layer"` immediately and skip to Step 3.
   - Otherwise, treat it as the path to a single audit JSON file. Resolve relative to the repository root. Read and parse it, then proceed to Step 2.

2. If no argument was provided, search for the most recent audit JSON in this order:
   - `audit-reports/all-nodes.json`
   - `audit-reports/all-relationships.json`
   - Any `audit-reports/*-nodes.json` (most recently modified first)
   - Any `audit-reports/*-relationships.json` (most recently modified first)
   - `audit-reports/relationships/inter-layer-validation/` — if this directory exists and contains `.json` files, treat it as an inter-layer validation directory (set `auditType = "inter-layer"`, skip to Step 3)
   - `audit-results/*/before/*.json` (legacy pipeline output, most recently modified)

3. If no file or directory is found, print:

```
No audit file found in audit-reports/. Run one of:
  npm run audit:nodes -- --enable-ai --save-json audit-reports/all-nodes.json
  npm run audit:relationships -- --format json
  npm run audit:pipeline -- --enable-ai   (inter-layer gap analysis)

Then re-run: /dr-audit-resolve [path]   (or omit path to auto-discover)
```

4. Read and parse the JSON file (single-file path only; directory path handled in Step 3).

---

### STEP 1.5: Parse Flags

Check the provided arguments for an `--auto` flag. If present, set `autoMode = true`.

**`--auto` behavior:**

- Skips all `AskUserQuestion` calls entirely.
- For each item, automatically executes the default recommended action (see Step 4b for per-item defaults).
- Still performs the full pre-evaluation (step 4a) and prints it to the console so the user can see the reasoning and the chosen action.
- Does not change what actions are considered recommended — it only removes the pause for input.

---

### STEP 2: Detect Audit Type

Inspect the top-level keys of the JSON (single-file path only — directory paths set `auditType` in Step 1 and skip here):

- **Node audit** — has keys: `layerSummaries`, `definitionQuality`, `overlaps`, `completenessIssues`, `aiReviews`
- **Relationship audit** — has keys: `coverage`, `gaps`, `duplicates`, `balance`, `connectivity`
- **Inter-layer validation (single pair file)** — has keys: `pair` and `validation`, where `validation` has `violations` and `recommendations` arrays. Set `auditType = "inter-layer"`.

If the type cannot be determined, tell the user and abort.

For a **node audit without `aiReviews`**, print a warning and abort:

```
This node audit was run without --enable-ai. Alignment scores are required.

Re-run with:
  npm run audit:nodes -- --enable-ai --save-json audit-report/nodes-audit.json
```

---

### STEP 3: Build the Review Queue

**For inter-layer validation (`auditType = "inter-layer"`):**

Load all gap data from the source:

- **Directory path:** Read every `.json` file in the directory. Each file has the shape `{ pair, timestamp, validation: { violations[], recommendations[] } }`. Merge violations across all files into a single flat list, retaining the `pair` field for display.
- **Single file:** Use `validation.violations` and `validation.recommendations` from that file.

**Important:** The `pair` field (e.g., `"api->apm"`) reflects the pipeline's enumeration order — abstract layer first — and does NOT indicate schema direction. Always use `violation.sourceLayer` and `violation.targetLayer` for actual schema direction. In `api_to_apm.json` for example, `violation.sourceLayer = "apm"` and `violation.targetLayer = "api"` because apm (layer 11) is more concrete and references api (layer 6).

For each violation at index `i`, pair it with `recommendations[i]` (the `recommendations` array is parallel to `violations`). Parse the recommended file path to extract the gap components:

```
recommendation: "Add spec/schemas/relationships/{sourceLayer}/{filename}.relationship.schema.json"
filename: "{sourceType}.{predicate}.{destType}"
```

Parsing rules for the filename (node type names are lowercase concatenated, never hyphenated; predicates may contain hyphens):

- `sourceLayer` — use `violation.sourceLayer` (authoritative); also visible as the directory segment between `relationships/` and the filename — they must match
- `sourceType` — everything before the first `.` in the filename
- `destType` — everything after the last `.` in the filename (before `.relationship.schema.json`)
- `predicate` — everything between the first and last `.` in the filename (handles hyphenated predicates like `navigates-to`)
- `destLayer` — `violation.targetLayer`

Example from a real file (`api_to_apm.json`):

- recommendation: `"Add spec/schemas/relationships/apm/span.monitors.operation.relationship.schema.json"`
- violation: `{ sourceLayer: "apm", targetLayer: "api", issue: "Missing schema: span.monitors.operation — ..." }`
- → sourceLayer=`apm`, sourceType=`span`, predicate=`monitors`, destType=`operation`, destLayer=`api`

If `recommendations[i]` is missing or malformed, fall back to parsing from `violation.issue`. The issue format is:
`"Missing schema: {sourceType}.{predicate}.{destType} — {justification}"`
Strip the `"Missing schema: "` prefix first, then split on `—` to isolate the schema part, then parse the filename segment using the same first/last-dot rules.

Build a gap record for each violation:

```
{
  sourceLayer: violation.sourceLayer,
  sourceType:  (parsed from recommendation filename),
  predicate:   (parsed from recommendation filename),
  destType:    (parsed from recommendation filename),
  destLayer:   violation.targetLayer,
  justification: violation.issue,
  recommendedPath: (the full spec file path from recommendation, sans the "Add " prefix),
  pairLabel:   file's pair field for display only (e.g., "api->apm") — not used for logic
}
```

Check whether `recommendedPath` already exists on disk. Mark it `alreadyExists: true` if so — these will be shown to the user but flagged as candidates to skip.

Filter out any gap records that could not be parsed (log a warning for each).

Sort the queue: group by source layer (in canonical layer order 1–12), then alphabetically by source type within each layer.

**Print the queue summary:**

```
Inter-Layer Gap Analysis
  Source: {directory or file path}
  Pairs loaded: {N} pair file(s)
  Total gap suggestions: {total}
  Already exist (will be flagged): {N}
  To review: {N}

Items to review:
  1. [inter-layer] apm.span --monitors--> api.operation                  (pair: api->apm)
  2. [inter-layer] apm.metric --monitors--> api.operation                (pair: api->apm)
  3. [inter-layer] apm.alert --monitors--> api.ratelimit                 (pair: api->apm)
  ...
```

---

**For node audits:**

Collect all `NodeAIEvaluation` objects from `report.aiReviews[*].nodeEvaluations[]` where `alignmentScore < 80`.

Sort ascending by `alignmentScore` (worst first).

**For relationship audits:**

Collect all items with `alignmentScore < 80`:

- All `gaps[]` entries (all have `alignmentScore` derived from their `priority`)
- All `duplicates[]` entries (all have `alignmentScore` derived from their `confidence`)

Label each as type `"gap"` or `"duplicate"`. Merge into a single list and sort ascending by `alignmentScore` (lowest score = most urgent, first). Process gaps and duplicates interleaved in this sorted order.

**Score reference:**

| Gap priority | alignmentScore | Duplicate confidence | alignmentScore |
| ------------ | -------------- | -------------------- | -------------- |
| high         | 15             | high                 | 25             |
| medium       | 45             | medium               | 55             |
| low          | 80             | low                  | 80             |

Items with `alignmentScore >= 80` (low-priority gaps and low-confidence duplicates) are handled by `/dr-audit-refine`.

**Print the queue summary:**

For node audit:

```
Node Audit — {report.timestamp}
Found {N} node types with alignment score < 80 (out of {total}).

Items to review:
  1. data-model.x-database          (alignment: 12/100)
  2. data-model.x-ui                (alignment: 15/100)
  3. data-model.jsontype            (alignment: 38/100)
  ...
```

For relationship audit:

```
Relationship Audit — {report.timestamp}
Found {N} items with alignment score < 80
  ({N_high_gaps} high-priority gaps, {N_medium_gaps} medium-priority gaps,
   {N_high_dupes} high-confidence duplicates, {N_medium_dupes} medium-confidence duplicates)
{N_skipped} item(s) with alignmentScore >= 80 (low-priority gaps, low-confidence duplicates) → use /dr-audit-refine for those.

Items to review (lowest alignment first):
  1. [gap]       data-model.jsonschema → data-store.table        (alignment: 15, predicate: maps-to, priority: high)
  2. [duplicate] api.endpoint ↔ api.endpoint                     (alignment: 25, confidence: high)
  3. [gap]       api.operation → api.endpoint                    (alignment: 45, predicate: serves, priority: medium)
  ...
```

---

### STEP 4: Process Each Item

**For inter-layer validation (`auditType = "inter-layer"`):** Skip 4a–4c entirely and use the inter-layer section below.

For node and relationship audits, execute steps 4a → 4b → 4c in sequence. After processing an item, move to the next.

---

#### 4-IL: Inter-Layer Gap Items

For each gap record in the queue, execute 4-IL-a → 4-IL-b → 4-IL-c in sequence.

---

**4-IL-a. Pre-Evaluate**

Given the gap record:

1. Check whether `recommendedPath` already exists on disk:

   ```bash
   ls {recommendedPath} 2>/dev/null && echo "EXISTS" || echo "MISSING"
   ```

   If it already exists, note this — the schema may have been created since the audit ran.

2. Check how many relationship schemas already exist for this source layer + source type:

   ```bash
   ls spec/schemas/relationships/{sourceLayer}/{sourceType}.*.relationship.schema.json 2>/dev/null | wc -l
   ```

3. Verify the source node type exists in the spec:

   ```bash
   ls spec/schemas/nodes/{sourceLayer}/{sourceType}.node.schema.json 2>/dev/null && echo "EXISTS" || echo "MISSING"
   ```

4. Verify the destination node type exists in the spec:

   ```bash
   ls spec/schemas/nodes/{destLayer}/{destType}.node.schema.json 2>/dev/null && echo "EXISTS" || echo "MISSING"
   ```

If either node type schema is missing, note the discrepancy — the AI may have hallucinated a type name. This is grounds to skip the item.

---

**4-IL-b. Ask the User (or Auto-Proceed)**

**If `autoMode` is active:**

- If `alreadyExists` is true: log `SKIPPED {sourceLayer}.{sourceType} --{predicate}--> {destLayer}.{destType} — schema already exists` and move to next.
- If either node type is missing from spec: log `SKIPPED — source or destination node type not found in spec` and move to next.
- Otherwise: apply the default action `"Create this relationship"` with cardinality `many-to-one`. Log `[AUTO] CREATING {recommendedPath}`.

**If `autoMode` is not active:** Use `AskUserQuestion`. Present:

```
[{N}/{total}] Inter-layer gap — {sourceLayer}.{sourceType} --{predicate}--> {destLayer}.{destType}  (pair file: {pairLabel})

  Source:      {sourceLayer}.{sourceType}
  Predicate:   {predicate}
  Destination: {destLayer}.{destType}
  Justification: {violation.issue with "Missing schema: X — " prefix stripped}

  Schema path: {recommendedPath}
  Already exists? {yes — can skip / no — will create}
  Source node type in spec? {yes / NO — may be hallucinated}
  Dest node type in spec?   {yes / NO — may be hallucinated}
  Other schemas for {sourceLayer}.{sourceType}: {count}
```

Options:

- **Create this relationship** — write the schema at `recommendedPath` (default: cardinality `many-to-one`)
- **Create with different cardinality** — specify `one-to-one`, `one-to-many`, or `many-to-many`
- **Skip — already covered** — if a semantically equivalent schema already exists
- **Skip — not architecturally necessary** — if the justification isn't convincing
- **Skip — node type not in spec** — if source or destination type is missing from the spec

---

**4-IL-c. Execute**

**CREATE:**

1. Build the relationship schema using the standard cross-layer template:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "{SourceTypePascal} {predicate} {DestTypePascal}",
  "description": "Defines relationship: {sourceLayer}.{sourceType} {predicate} {destLayer}.{destType}",
  "allOf": [{ "$ref": "../../base/spec-node-relationship.schema.json" }],
  "properties": {
    "id": {
      "const": "{sourceLayer}.{sourceType}.{predicate}.{destLayer}.{destType}"
    },
    "source_spec_node_id": { "const": "{sourceLayer}.{sourceType}" },
    "source_layer": { "const": "{sourceLayer}" },
    "destination_spec_node_id": { "const": "{destLayer}.{destType}" },
    "destination_layer": { "const": "{destLayer}" },
    "predicate": { "const": "{predicate}" },
    "cardinality": { "const": "{cardinality}" },
    "strength": { "const": "medium" }
  }
}
```

Note: `{SourceTypePascal}` and `{DestTypePascal}` are the type names with first letter uppercased (e.g., `view` → `View`, `navigates-to` stays as-is in the title: `View navigates-to Route`).

2. Write to `{recommendedPath}` (the full path parsed from the recommendation).

3. Log: `CREATED {sourceLayer}.{sourceType} --{predicate}--> {destLayer}.{destType}`

**SKIP:**

Log: `SKIPPED {sourceLayer}.{sourceType} --{predicate}--> {destLayer}.{destType} — {reason}`. Move to next.

---

#### 4a. Pre-Evaluate

Do NOT ask the user yet. First gather facts.

**For a NODE item:**

Parse the `specNodeId` to extract `layerId` and `typeName`:

- `data-model.x-database` → layerId = `data-model`, typeName = `x-database`
- Note: layer IDs can be hyphenated (data-model, data-store)

Read the schema file:

```
spec/schemas/nodes/{layerId}/{typeName}.node.schema.json
```

Read the `suggestions[]` array from the evaluation. Determine the primary action type from the suggestion text:

| Pattern in suggestion text                           | Action type     |
| ---------------------------------------------------- | --------------- |
| "move to", "belongs in", "should be in" + layer name | `MOVE`          |
| "collapse", "enum", `$defs`, "enum constraint"       | `ENUM_COLLAPSE` |
| "remove", "delete", "eliminate"                      | `REMOVE`        |
| anything else                                        | `OTHER`         |

**If action type is MOVE:**

- Extract the target layer name from the suggestion. Map common names to canonical IDs using the table in CLAUDE.md (e.g., "data store" → `data-store`, "APM" → `apm`).
- List files in `spec/schemas/nodes/{targetLayerId}/` to find conceptually similar schemas.
- For each file whose name overlaps with `typeName` or whose title/description looks semantically related, note it as a conflict candidate.

**If action type is ENUM_COLLAPSE:**

- Parse the suggestion to identify: (a) which parent schema node type to modify (e.g., `schemaproperty`, `jsonschema`), and (b) which attribute should receive the enum constraint.
- Read that parent schema file: `spec/schemas/nodes/{layerId}/{parentType}.node.schema.json`

**If action type is REMOVE:**

- Search all files in `spec/schemas/relationships/` for any relationship schema that contains `{layerId}.{typeName}` as a `source_spec_node_id` or `destination_spec_node_id`. Use Grep across `spec/schemas/relationships/**/*.relationship.schema.json`.
- Collect the list of dependent relationship schemas.

---

**For a RELATIONSHIP GAP item:**

Parse `sourceNodeType` and `destinationNodeType`:

- `data-model.jsonschema` → sourceLayer = `data-model`, sourceType = `jsonschema`
- `data-store.table` → destLayer = `data-store`, destType = `table`

Construct the expected relationship filename:

```
spec/schemas/relationships/{sourceLayer}/{sourceType}.{suggestedPredicate}.{destType}.relationship.schema.json
```

Check whether this file already exists. If it does, note it — we may just need to confirm or skip.

---

**For a RELATIONSHIP DUPLICATE item:**

The `relationships` field contains two relationship IDs, e.g.:

- `data-model.jsonschema.apm-data-quality-metrics.data-model.dataqualitymetrics`
- `data-model.jsonschema.references.data-model.dataqualitymetrics`

Parse each ID: `{sourceLayer}.{sourceType}.{predicate}.{destLayer}.{destType}`

- Split on `.` carefully — layer names can be hyphenated, so the format is:
  - First two dot-segments form the source spec node ID: `{sourceLayer}.{sourceType}`
  - Last two dot-segments form the dest spec node ID: `{destLayer}.{destType}`
  - Middle segment(s) form the predicate

Construct filenames for both:

```
spec/schemas/relationships/{sourceLayer}/{sourceType}.{predicate}.{destType}.relationship.schema.json
```

Read both schema files to show the user their definitions.

---

#### 4b. Ask the User (or Auto-Proceed)

**If `autoMode` is active:** Do not call `AskUserQuestion`. Instead, apply the default recommended action for this item type:

| Item type                | Auto action                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Node (MOVE)              | "Follow recommendation" — move schema to target layer                                                               |
| Node (ENUM_COLLAPSE)     | "Follow recommendation" — collapse into enum on parent schema                                                       |
| Node (REMOVE)            | "Follow recommendation" — delete schema and dependent relationships                                                 |
| Node (OTHER action type) | "Skip" — requires manual judgment; cannot be automated                                                              |
| Relationship gap         | "Create this relationship" — use default cardinality `many-to-one`                                                  |
| Relationship duplicate   | "Skip" — duplicate resolution requires judgment; skip in auto mode                                                  |
| Inter-layer gap          | "Create this relationship" — use default cardinality `many-to-one`; skip if already exists or node type not in spec |

Print a one-line summary of the chosen action (e.g., `[AUTO] data-model.x-database — following recommendation: MOVE to data-store layer`).

Proceed immediately to step 4c to execute the action.

**If `autoMode` is not active:** Use the `AskUserQuestion` tool. Construct the question with full context from 4a.

**For a NODE item, the question structure:**

```
[{N}/{total}] {specNodeId}  —  alignment: {alignmentScore}/100

Action item: {documentationReasoning}

Reasoning: {alignmentReasoning}

Suggestions:
  • {suggestion[0]}
  • {suggestion[1]}
  ...

Current schema attributes: {list attribute names from the schema file}

[If MOVE] Pre-check:
  Target layer: {targetLayerId}
  Similar schemas in target: {list of similar files, or "none found"}

[If ENUM_COLLAPSE] Pre-check:
  Target parent schema: {parentType}.node.schema.json
  Attribute to receive enum: {attributeName}

[If REMOVE] Pre-check:
  Dependent relationships: {list of relationship files, or "none found"}
```

Options:

- **Follow recommendation** — describe the specific action in 1 sentence (e.g., "Move schema to {targetLayerId} layer, restructuring attributes to fit that layer's conventions")
- **Remove this node type** — delete the schema file and update the layer instance
- **Skip for now** — leave unchanged, move to next item

**For a RELATIONSHIP GAP item:**

```
[{N}/{total}] Missing relationship (high priority)

  Source:     {sourceNodeType}
  Predicate:  {suggestedPredicate}
  Destination: {destinationNodeType}
  Reason:     {reason}
  Standard:   {standardReference or "none"}

[If file already exists] Note: A relationship schema for this already exists at {path}
```

Options:

- **Create this relationship** — add the relationship schema to `spec/schemas/relationships/{sourceLayer}/`
- **Skip for now**
- **Something else**

**For a RELATIONSHIP DUPLICATE item:**

```
[{N}/{total}] Possible duplicate relationships (high confidence)

  Relationship A: {relationships[0]}
    predicate: {predicates[0]}
  Relationship B: {relationships[1]}
    predicate: {predicates[1]}

  Source: {sourceNodeType} → {destinationNodeType}
  Reason: {reason}
```

Options:

- **Remove A — keep B** — delete `{fileA}`
- **Remove B — keep A** — delete `{fileB}`
- **Keep both** — skip, leave as-is
- **Something else**

---

#### 4c. Execute the Action

Track all changes in a session log (list of files created, modified, deleted).

---

**NODE — FOLLOW RECOMMENDATION: MOVE**

1. Read the full source schema: `spec/schemas/nodes/{sourceLayerId}/{typeName}.node.schema.json`

2. Read 2–3 existing schemas in `spec/schemas/nodes/{targetLayerId}/` to understand that layer's attribute conventions (what required fields, what attribute names, what patterns).

3. Build the adapted schema. The structure is identical to any other node schema, but:
   - `spec_node_id` const → `{targetLayerId}.{typeName}`
   - `layer_id` const → `{targetLayerId}`
   - `type` const → `{typeName}` (unchanged)
   - `$ref` → always `../../base/spec-node.schema.json` (same relative path for all node schemas)
   - `attributes.properties` → restructured to fit the target layer's standard and the suggestion. Remove attributes that are cross-layer metadata. Add or rename attributes that match the target layer's conventions.
   - `attributes.required` → update to match restructured attributes
   - `title` → update if it now reflects the target layer better
   - `description` → update to accurately describe the concept in its new layer context

4. Write the adapted schema to:

   ```
   spec/schemas/nodes/{targetLayerId}/{typeName}.node.schema.json
   ```

5. Delete the source schema:

   ```
   spec/schemas/nodes/{sourceLayerId}/{typeName}.node.schema.json
   ```

6. Update the **source** layer instance `spec/layers/{NN}-{sourceLayerId}.layer.json`:
   - Find it by scanning `spec/layers/` for the file whose `"id"` matches `sourceLayerId`
   - Remove `"{sourceLayerId}.{typeName}"` from the `node_types` array (only if the array is non-empty)

7. Update the **target** layer instance `spec/layers/{NN}-{targetLayerId}.layer.json`:
   - Find it by scanning `spec/layers/` for the file whose `"id"` matches `targetLayerId`
   - If the `node_types` array is non-empty, add `"{targetLayerId}.{typeName}"` in alphabetical order

8. Grep `spec/schemas/relationships/{sourceLayerId}/` for any relationship schema referencing `{sourceLayerId}.{typeName}`. If any are found, print them. If `autoMode` is active, leave them for manual cleanup and note this in the log. Otherwise, ask:
   - **Update references** (change source/dest layer references to the new location)
   - **Delete orphaned relationships**
   - **Leave for manual cleanup**

9. Log: `MOVED {sourceLayerId}.{typeName} → {targetLayerId}.{typeName}`

---

**NODE — FOLLOW RECOMMENDATION: ENUM COLLAPSE**

1. Read the node type schema to be collapsed: `spec/schemas/nodes/{layerId}/{typeName}.node.schema.json`

2. Read the parent schema: `spec/schemas/nodes/{layerId}/{parentType}.node.schema.json`

3. Locate the attribute in the parent schema that should receive the enum constraint. It will be a `string`-typed attribute.

4. Modify the parent schema: add an `enum` array to that attribute's definition listing all the values that `{typeName}` was enumerating. If the values aren't explicit in the schema, derive them from the description or use a `$comment` to note that values should be defined.

   Example transformation:

   ```json
   // Before:
   "type": { "type": "string" }

   // After:
   "type": {
     "type": "string",
     "enum": ["string", "number", "integer", "boolean", "array", "object", "null"],
     "description": "JSON primitive type"
   }
   ```

5. Write the updated parent schema.

6. Delete the collapsed node type schema: `spec/schemas/nodes/{layerId}/{typeName}.node.schema.json`

7. Update the layer instance: remove `{layerId}.{typeName}` from `node_types` (if the array is non-empty).

8. Log: `COLLAPSED {layerId}.{typeName} into enum attribute on {layerId}.{parentType}`

---

**NODE — FOLLOW RECOMMENDATION: OTHER**

If `autoMode` is active, log `SKIPPED {specNodeId} — OTHER action type requires manual judgment` and move to the next item.

Otherwise:

1. Re-read the suggestion carefully.
2. Plan the exact edits needed and describe them to the user in plain language.
3. Confirm with the user before executing.
4. Execute the plan.

---

**NODE — REMOVE**

1. If dependent relationships were found in 4a:
   - List them explicitly
   - If `autoMode` is active, delete them automatically and log each one.
   - Otherwise, ask user: "Remove these relationship schemas too? (yes / no — I'll fix manually)"
     - If yes, delete each one and log it
     - If no, leave them and note they will be orphaned

2. Delete the schema file: `spec/schemas/nodes/{layerId}/{typeName}.node.schema.json`

3. Update the layer instance: remove `{layerId}.{typeName}` from `node_types` (if non-empty).

4. Log: `REMOVED {layerId}.{typeName}`

---

**NODE — SOMETHING ELSE**

Prompt the user to describe what they want to do. Read their description, plan the edits, confirm, and execute.

---

**RELATIONSHIP GAP — CREATE**

1. If `autoMode` is active, use cardinality `"many-to-one"` without asking. Otherwise, ask the user for cardinality if the gap doesn't specify it. Default: `"many-to-one"`. Options: `one-to-one`, `one-to-many`, `many-to-one`, `many-to-many`.

2. Build the relationship schema:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "{SourceType} {suggestedPredicate} {DestType}",
  "description": "Defines relationship: {sourceNodeType} {suggestedPredicate} {destinationNodeType}",
  "allOf": [{ "$ref": "../../base/spec-node-relationship.schema.json" }],
  "properties": {
    "id": {
      "const": "{sourceLayer}.{sourceType}.{predicate}.{destLayer}.{destType}"
    },
    "source_spec_node_id": { "const": "{sourceNodeType}" },
    "source_layer": { "const": "{sourceLayer}" },
    "destination_spec_node_id": { "const": "{destinationNodeType}" },
    "destination_layer": { "const": "{destLayer}" },
    "predicate": { "const": "{suggestedPredicate}" },
    "cardinality": { "const": "{cardinality}" },
    "strength": { "const": "medium" }
  }
}
```

3. Write to:

```
spec/schemas/relationships/{sourceLayer}/{sourceType}.{suggestedPredicate}.{destType}.relationship.schema.json
```

4. Log: `CREATED relationship {sourceNodeType} --{suggestedPredicate}--> {destinationNodeType}`

---

**RELATIONSHIP DUPLICATE — REMOVE ONE**

1. Determine which file to delete based on user choice (A or B).

2. Parse the chosen relationship ID to reconstruct its filename:
   - ID format: `{sourceLayer}.{sourceType}.{predicate}.{destLayer}.{destType}`
   - Filename: `spec/schemas/relationships/{sourceLayer}/{sourceType}.{predicate}.{destType}.relationship.schema.json`

3. Delete the file.

4. Log: `REMOVED duplicate relationship {id}`

---

**SKIP**

Note in session log: `SKIPPED {specNodeId or relationship id}`. Move to the next item.

---

### STEP 5: Finalize

After all items have been processed:

1. Print the session summary:

```
Session Complete
================
Reviewed:  {N} items
  ✓ Followed recommendation:  {count}
  ✗ Removed:                  {count}
  → Skipped:                  {count}
  ✎ Custom action:            {count}

Files changed:
  Created:  {list}
  Modified: {list}
  Deleted:  {list}
```

2. If any spec files were created, modified, or deleted, sync the CLI bundled schemas and rebuild:

```bash
cd cli && npm run build
```

This triggers `scripts/sync-spec-schemas.sh` which copies updated spec schemas into `cli/src/schemas/bundled/`.

3. Run the test suite to confirm no regressions:

```bash
cd cli && npm run test
```

4. Report any test failures. If tests fail due to the spec changes (e.g., a removed node type is referenced in test fixtures), describe the failures and ask the user how to proceed.

---

## Reference: Spec File Conventions

### Node Schema Structure

Every node schema at `spec/schemas/nodes/{layerId}/{typeName}.node.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PascalCaseTitle",
  "description": "Clear, implementation-agnostic description",
  "allOf": [{ "$ref": "../../base/spec-node.schema.json" }],
  "properties": {
    "spec_node_id": { "const": "{layerId}.{typeName}" },
    "layer_id": { "const": "{layerId}" },
    "type": { "const": "{typeName}" },
    "attributes": {
      "type": "object",
      "properties": { ... },
      "required": [...],
      "additionalProperties": false
    }
  }
}
```

The `$ref` path is always `../../base/spec-node.schema.json` regardless of layer — all node schemas are exactly one level deep under their layer directory.

### Relationship Schema Structure

Every relationship schema at `spec/schemas/relationships/{sourceLayer}/{sourceType}.{predicate}.{destType}.relationship.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SourceType Predicate DestType",
  "description": "Defines relationship: {sourceLayerId}.{sourceType} {predicate} {destLayerId}.{destType}",
  "allOf": [{ "$ref": "../../base/spec-node-relationship.schema.json" }],
  "properties": {
    "id": {
      "const": "{sourceLayerId}.{sourceType}.{predicate}.{destLayerId}.{destType}"
    },
    "source_spec_node_id": { "const": "{sourceLayerId}.{sourceType}" },
    "source_layer": { "const": "{sourceLayerId}" },
    "destination_spec_node_id": { "const": "{destLayerId}.{destType}" },
    "destination_layer": { "const": "{destLayerId}" },
    "predicate": { "const": "{predicate}" },
    "cardinality": { "const": "many-to-one" },
    "strength": { "const": "medium" }
  }
}
```

### Layer Instance Structure

At `spec/layers/{NN}-{layerId}.layer.json`. The `node_types` array may be populated or empty depending on the layer. Only modify `node_types` when it is already non-empty (some layers use filesystem discovery instead).

```json
{
  "id": "motivation",
  "number": 1,
  "name": "Motivation Layer",
  "description": "Layer 1: Motivation Layer",
  "inspired_by": { "standard": "...", "version": "...", "url": "..." },
  "node_types": ["motivation.goal", "motivation.stakeholder", ...]
}
```

### Layer Number Map (for finding layer instance files)

| Layer ID    | File prefix |
| ----------- | ----------- |
| motivation  | 01          |
| business    | 02          |
| security    | 03          |
| application | 04          |
| technology  | 05          |
| api         | 06          |
| data-model  | 07          |
| data-store  | 08          |
| ux          | 09          |
| navigation  | 10          |
| apm         | 11          |
| testing     | 12          |

### CLI Bundled Schema Sync

After all spec edits, run `cd cli && npm run build`. This automatically triggers `scripts/sync-spec-schemas.sh` which copies `spec/schemas/nodes/` → `cli/src/schemas/bundled/nodes/` and `spec/schemas/base/` → `cli/src/schemas/bundled/base/`. Do not manually copy files.

---

## Error Handling

**Schema file not found:**
If a schema file expected to exist is missing, report the discrepancy (the layer instance references a type with no schema file) and ask the user: skip this item, or create a stub schema?

**Relationship ID parsing ambiguity:**
If the relationship ID is ambiguous (e.g., hyphenated layer names make splitting unclear), read the actual relationship schema file by grepping for the ID string across `spec/schemas/relationships/**/*.relationship.schema.json`.

**Target layer schema conflicts:**
If a schema with the same `typeName` already exists in the target layer, show both schemas side by side and ask the user: merge, rename the incoming type, or abort this item.

**Build failure after changes:**
If `npm run build` fails, show the error output and ask the user how to proceed. Do not proceed with `npm run test` if the build fails.
