---
description: Critically evaluate AI recommendations for well-aligned nodes (alignmentScore >= 80) — uses git history and ROI analysis to decide if changes are worth making
argument-hint: "[path/to/audit.json] [--auto]"
---

# DR Audit Refine

Reviews AI recommendations for **well-aligned** node types (alignmentScore ≥ 80) with a more critical lens than `/dr-audit-resolve`. These nodes already fit their layer well — changes are only justified if they add genuine clarity or prevent real modeling errors. The script checks git history to understand what improvements have already been made, evaluates whether each recommendation adds meaningful value, and looks for better alternatives before acting.

**Default posture: preserve stability.** The burden of proof is on the recommendation, not on keeping the status quo.

## Usage

```bash
# With a specific audit file:
/dr-audit-refine audit-report/nodes-audit.json

# Auto-discover latest audit in common locations:
/dr-audit-refine

# Non-interactive mode — automatically execute the recommended action for each item:
/dr-audit-refine --auto
/dr-audit-refine audit-reports/testing-nodes.json --auto
```

**Producing audit files:**

```bash
# Node audit with AI scores (required for alignment filtering):
npm run audit:nodes -- --enable-ai --save-json audit-reports/all-nodes.json

# Layer-specific node audit:
npm run audit:nodes -- --layer ux --enable-ai --save-json audit-reports/ux-nodes.json
```

## Instructions for Claude Code

When this command is invoked, execute the following steps precisely.

---

### STEP 1: Locate the Audit File

1. If an argument was provided, treat it as the path to the audit JSON file. Resolve relative to the repository root (`/Users/austinsand/workspace/documentation_robotics`).
2. If no argument was provided, search for the most recent audit JSON in this order:
   - `audit-reports/all-nodes.json`
   - `audit-reports/all-relationships.json`
   - Any `audit-reports/*-nodes.json` (most recently modified first)
   - Any `audit-reports/*-relationships.json` (most recently modified first)
   - `audit-results/*/before/*.json` (legacy pipeline output, most recently modified)
3. If no file is found, print:

```
No audit file found in audit-reports/. Run one of:
  npm run audit:nodes -- --enable-ai --save-json audit-reports/all-nodes.json
  npm run audit:relationships -- --format json --output audit-reports/all-relationships.json

Then re-run: /dr-audit-refine [path]   (or omit path to auto-discover)
```

4. Read and parse the JSON file.

---

### STEP 1.5: Parse Flags

Check the provided arguments for an `--auto` flag. If present, set `autoMode = true`.

**`--auto` behavior:**

- Skips all `AskUserQuestion` calls entirely.
- For each item, automatically executes the action labeled "(Recommended)" in the options, or the action indicated by the `⚠ Recommendation:` line (e.g., "Skip — recently reworked").
- Still performs the full analysis (steps 4a–4c) and prints it to the console so the user can see the reasoning and the chosen action.
- Does not change what actions are considered recommended — it only removes the pause for input.

---

### STEP 2: Detect Audit Type and Validate

Inspect the top-level keys of the JSON:

- **Node audit** — has keys: `layerSummaries`, `definitionQuality`, `overlaps`, `completenessIssues`
- **Relationship audit** — has keys: `coverage`, `gaps`, `duplicates`, `balance`, `connectivity`

If the type cannot be determined, tell the user and abort.

**Node audit:** If `aiReviews` is absent, abort:

```
This node audit was run without --enable-ai. Alignment scores are required.

Re-run with:
  npm run audit:nodes -- --enable-ai --save-json audit-reports/all-nodes.json
```

**Relationship audit:** Proceed — `alignmentScore` is computed from `priority`/`confidence` and is always present in the JSON.

---

### STEP 3: Build the Review Queue

**For node audits:**

Collect all `NodeAIEvaluation` objects from `report.aiReviews[*].nodeEvaluations[]` where `alignmentScore >= 80`.

Sort **descending** by `alignmentScore` (highest-aligned first — review the cleanest nodes while most alert, since these will most often be "skip").

Skip any items with no `suggestions` or with an empty `suggestions` array — they have nothing to evaluate.

**Print the queue summary:**

```
Node Audit — {report.timestamp}
Found {N} well-aligned node types (score ≥ 80) with active recommendations.
(Use /dr-audit-resolve for the {M} items below 80.)

Items to review (highest alignment first):
  1. ux.view                    (alignment: 97/100)  {suggestion count} suggestion(s)
  2. ux.subview                 (alignment: 94/100)  {suggestion count} suggestion(s)
  3. data-model.jsonschema      (alignment: 83/100)  {suggestion count} suggestion(s)
  ...
```

**For relationship audits:**

Collect all items with `alignmentScore >= 80`:

- `duplicates[]` where `confidence === "low"` (alignmentScore = 80) — label as type `"duplicate"`
- Any `gaps[]` where `priority === "low"` (alignmentScore = 75) do NOT appear here — they fall to `/dr-audit-resolve`

Sort **descending** by `alignmentScore` (highest alignment = least urgent, review first since these will most often be skipped).

**Score reference:**

| Duplicate confidence | alignmentScore | Routed to               |
| -------------------- | -------------- | ----------------------- |
| high                 | 25             | /dr-audit-resolve       |
| medium               | 55             | /dr-audit-resolve       |
| low                  | 80             | /dr-audit-refine ← here |

**Print the queue summary:**

```
Relationship Audit — {report.timestamp}
Found {N} well-aligned items (score ≥ 80) for critical evaluation.
(Use /dr-audit-resolve for the {M} items below 80.)

Default posture: preserve stability — only remove a duplicate if there is a clear reason.

Items to review (highest alignment first):
  1. [duplicate] api.endpoint ↔ api.endpoint   (alignment: 80/100, confidence: low)
  2. ...
```

---

### STEP 4: For Each Item, Run the Full Evaluation Pipeline

**If this is a relationship audit**, skip directly to Step 4 — Relationship Items (below) and bypass the node-specific steps 4a–4d entirely.

For node audits, execute steps 4a → 4b → 4c → 4d in sequence. After processing an item, move to the next.

---

#### 4 — Relationship Items (duplicate candidates with alignmentScore ≥ 80)

For each relationship duplicate in the queue:

**4-R-a. Pre-Evaluate**

Parse the two relationship IDs from `relationships[0]` and `relationships[1]`:

- ID format: `{sourceLayer}.{sourceType}.{predicate}.{destLayer}.{destType}`
- Filename: `spec/schemas/relationships/{sourceLayer}/{sourceType}.{predicate}.{destType}.relationship.schema.json`
- Note: layer IDs can be hyphenated (e.g., `data-model`)

Read both relationship schema files.

Count any other relationship schemas in `spec/schemas/relationships/{sourceLayer}/` that share the same source+destination endpoint pair (different predicate). A higher count of intentional distinct relationships is evidence against this being a real duplicate.

**4-R-b. Ask the User (or Auto-Proceed)**

**If `autoMode` is active:** The default action is `"Skip"` — low-confidence duplicates require human judgment to confirm. Log `SKIPPED {relationships[0]} ↔ {relationships[1]} — low confidence, auto-skip`.

**If `autoMode` is not active:** Use `AskUserQuestion`. Present:

```
[{N}/{total}] Possible duplicate relationship (low confidence) — alignment: 80/100

  Relationship A: {relationships[0]}
    predicate: {predicates[0]}
  Relationship B: {relationships[1]}
    predicate: {predicates[1]}

  Source → Destination: {sourceNodeType} → {destinationNodeType}
  Reason: {reason}

  Other relationships between this endpoint pair: {count}

  ⚠ Recommendation: Skip — low confidence; these predicates are likely intentionally distinct.
```

Options:

- **Remove A — keep B** — delete `{fileA}` (only if you are certain it is redundant)
- **Remove B — keep A** — delete `{fileB}` (only if you are certain it is redundant)
- **Keep both — skip** (Recommended)

**4-R-c. Execute**

- **Remove A or B:** Delete the file. Log `REMOVED duplicate relationship {id}`.
- **Skip:** Log `SKIPPED {relationships[0]} ↔ {relationships[1]} — {reason}`.

---

#### 4a. Read the Schema (node audits only)

Parse `specNodeId` to extract `layerId` and `typeName`:

- `ux.view` → layerId = `ux`, typeName = `view`
- `data-model.jsonschema` → layerId = `data-model`, typeName = `jsonschema`
- Note: layer IDs can be hyphenated (data-model, data-store)

Read the schema file:

```
spec/schemas/nodes/{layerId}/{typeName}.node.schema.json
```

Collect from the schema:

- All attribute names from `attributes.properties`
- Required attributes from `attributes.required`
- The `description` field (top-level)
- The `title` field

---

#### 4b. Consult the Git History

Run the following git commands to understand recent activity on this specific schema file and its layer:

```bash
# Commits touching this specific schema file (last 15):
git log --oneline -15 -- spec/schemas/nodes/{layerId}/{typeName}.node.schema.json

# Commits touching the entire layer's node schemas (last 20):
git log --oneline -20 -- "spec/schemas/nodes/{layerId}/"

# Most recent change to this file:
git log -1 --format="%ad %s" --date=short -- spec/schemas/nodes/{layerId}/{typeName}.node.schema.json
```

Analyze the output and classify the history as one of:

| Classification      | Criteria                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `recently-reworked` | File touched in last 5 commits to the layer, or commit message contains "collapse", "refactor", "simplify", "remove", "clean" |
| `active`            | File touched in the last 20 commits to the layer                                                                              |
| `stable`            | File not touched in last 20 commits to the layer                                                                              |
| `new`               | File was created in the last 5 commits to the layer                                                                           |

Also note: what was the most recent change message for this file? This indicates what the last improvement was.

---

#### 4c. Pre-Evaluate the Recommendations

For each suggestion in `suggestions[]`:

**Classify the suggestion type** using this table:

| Pattern in suggestion text                             | Action type     |
| ------------------------------------------------------ | --------------- |
| "move to", "belongs in", "should be in" + layer name   | `MOVE`          |
| "collapse", "enum", `$defs`, "enum constraint"         | `ENUM_COLLAPSE` |
| "remove", "delete", "eliminate"                        | `REMOVE`        |
| "rename", "clarify", "add description", "update title" | `CLARIFY`       |
| "add attribute", "include field", "missing property"   | `ADD_ATTRIBUTE` |
| anything else                                          | `OTHER`         |

**For each action type, check for better alternatives:**

**MOVE suggestions:**

- List files in `spec/schemas/nodes/{targetLayerId}/` to find semantically overlapping types.
- If a similar type already exists in the target layer, the better alternative may be to reference it rather than move the current type.
- If the node is used in relationships, search `spec/schemas/relationships/{layerId}/` for any schema referencing `{layerId}.{typeName}`. Count them.

**ENUM_COLLAPSE suggestions:**

- Identify which parent schema should receive the enum.
- Read the parent schema and check whether an enum constraint already exists on that attribute.
- If the enum already exists, the recommendation may already be implemented — note this explicitly.
- Check if there are other sibling types that would _also_ need to be collapsed for consistency (scan `spec/schemas/nodes/{layerId}/` for types with similar names or descriptions).

**REMOVE suggestions:**

- Search all `spec/schemas/relationships/` for any file referencing `{layerId}.{typeName}` as source or destination. Count them.
- If there are many dependents (> 3), removal has high cascading cost.

**CLARIFY / ADD_ATTRIBUTE suggestions:**

- Read the current description and attributes.
- Assess: does the current description already convey the intent clearly? Is the missing attribute genuinely required for modeling or is it cosmetic?

**Assess ROI** — for each suggestion, assign a value tier:

| Tier         | Criteria                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------- |
| `high-value` | Prevents real modeling errors, resolves genuine ambiguity, or fixes a standards mismatch    |
| `marginal`   | Improves wording/naming, adds optional convenience, aligns style — no correctness impact    |
| `low-value`  | Cosmetic, redundant with existing description, or conflicts with a recent deliberate choice |

---

#### 4d. Ask the User (or Auto-Proceed)

**If `autoMode` is active:** Do not call `AskUserQuestion`. Instead:

1. Determine the recommended action from the analysis in 4a–4c:
   - If the `⚠ Recommendation:` line says "Skip", log `SKIPPED` with that reason and move to the next item.
   - Otherwise, identify the option that would be labeled "(Recommended)" and execute it directly.
2. Print a one-line summary of the chosen action (e.g., `[AUTO] testing.coveragerequirement — applying suggestion #1: expand description`).
3. Proceed immediately to Step 5 to execute the action.

**If `autoMode` is not active:** Use the `AskUserQuestion` tool. Construct the question using the full context gathered in 4a–4c.

**Question structure:**

```
[{N}/{total}] {specNodeId}  —  alignment: {alignmentScore}/100

Action item: {documentationReasoning}

Summary: {alignmentReasoning}

Git history: {classification}
  Last change: "{most recent commit message}" ({date})
  {If recently-reworked}: ⚠ This schema was recently reworked — consider whether these suggestions were already addressed.

Suggestions ({count} total):
  1. [{action_type}] [{value_tier}] {suggestion text}
  2. [{action_type}] [{value_tier}] {suggestion text}
  ...

Current schema:
  Attributes: {comma-separated list of attribute names}
  Required:   {comma-separated list of required attributes}
  Description: "{first 120 chars of description}..."

{If MOVE} Better-alternative check:
  Target layer: {targetLayerId}
  Overlapping types already in target: {list, or "none found"}
  Relationships that would need updating: {count}

{If ENUM_COLLAPSE} Better-alternative check:
  Parent schema: {parentType}.node.schema.json
  Attribute to constrain: {attributeName}
  Enum already present? {yes/no}
  Other sibling types to also collapse for consistency: {list, or "none"}

{If REMOVE} Better-alternative check:
  Dependent relationships: {count} file(s) {list}

{If any suggestion is low-value or recently-reworked}
⚠ Recommendation: Skip — the suggestions appear marginal or may duplicate recent work.
```

**Options presented to the user:**

- **Apply suggestion(s)** — describe concisely which suggestion(s) to apply and how (e.g., "Add enum constraint to `type` attribute on parent schema, collapse this type")
- **Apply a better alternative** — describe what the better approach is in 1–2 sentences
- **Skip — already well-aligned** — leave unchanged; this schema is healthy as-is
- **Skip — recently reworked** — this was addressed in a recent commit; recommendation is stale
- **Something else** — describe what you'd like to do

> **Guidance for weighing options:** High-alignment scores (≥ 80) mean the schema is already doing its job well. Only apply a suggestion if the value tier is `high-value` **and** the git history doesn't indicate the concern was recently addressed. Marginal suggestions should almost always be skipped for stable, well-aligned schemas. The goal is net improvement to the spec, not mechanically following every AI suggestion.

---

### STEP 5: Execute the Chosen Action

Track all changes in a session log (files created, modified, deleted).

---

**APPLY SUGGESTION — ENUM COLLAPSE**

1. Read the node type schema to be collapsed: `spec/schemas/nodes/{layerId}/{typeName}.node.schema.json`

2. Read the parent schema: `spec/schemas/nodes/{layerId}/{parentType}.node.schema.json`

3. Confirm the attribute in the parent schema that should receive the enum. If enum values aren't listed explicitly in the suggestion or schema, derive them from the description or existing `$comment` — do NOT invent values.

4. Check: does the enum already exist on that attribute? If yes, skip the write and log `ALREADY_IMPLEMENTED`.

5. Modify the parent schema: add the `enum` array to the attribute.

   Example transformation:

   ```json
   // Before:
   "type": { "type": "string" }

   // After:
   "type": {
     "type": "string",
     "enum": ["value-a", "value-b", "value-c"],
     "description": "..."
   }
   ```

6. Write the updated parent schema.

7. Delete the collapsed node type schema: `spec/schemas/nodes/{layerId}/{typeName}.node.schema.json`

8. Update the layer instance `spec/layers/{NN}-{layerId}.layer.json`: remove `{layerId}.{typeName}` from `node_types` (only if the array is non-empty).

9. Log: `COLLAPSED {layerId}.{typeName} into enum on {layerId}.{parentType}.{attributeName}`

---

**APPLY SUGGESTION — MOVE**

1. Read the full source schema.

2. Read 2–3 existing schemas in `spec/schemas/nodes/{targetLayerId}/` to understand that layer's attribute conventions.

3. Build the adapted schema. Key changes:
   - `spec_node_id` const → `{targetLayerId}.{typeName}`
   - `layer_id` const → `{targetLayerId}`
   - `$ref` → always `../../base/spec-node.schema.json`
   - `attributes.properties` → restructured to fit target layer conventions
   - `title` and `description` → updated to reflect new context

4. Show a diff-style summary of the key changes (spec_node_id, layer_id, restructured attributes). If `autoMode` is active, proceed to write immediately. Otherwise, confirm with the user before writing.

5. Write to `spec/schemas/nodes/{targetLayerId}/{typeName}.node.schema.json`

6. Delete `spec/schemas/nodes/{sourceLayerId}/{typeName}.node.schema.json`

7. Update source layer instance: remove `{sourceLayerId}.{typeName}` from `node_types`.

8. Update target layer instance: add `{targetLayerId}.{typeName}` in alphabetical order.

9. If relationships reference the old source node ID, list them. If `autoMode` is active, leave them for manual cleanup and note this in the log. Otherwise, ask:
   - **Update references** — change source/dest layer references to the new ID
   - **Delete orphaned relationships**
   - **Leave for manual cleanup**

10. Log: `MOVED {sourceLayerId}.{typeName} → {targetLayerId}.{typeName}`

---

**APPLY SUGGESTION — REMOVE**

1. If dependent relationships were found in 4c:
   - List them explicitly
   - If `autoMode` is active, delete them automatically and log each one.
   - Otherwise, ask: "Remove these relationship schemas too? (yes / leave for manual cleanup)" and delete if confirmed.

2. Double-check: is this type referenced in any layer instance `node_types`? (Grep `spec/layers/` for `"{layerId}.{typeName}"`.)

3. Delete the schema file.

4. Update the layer instance: remove `{layerId}.{typeName}` from `node_types` (if non-empty).

5. Log: `REMOVED {layerId}.{typeName}`

---

**APPLY SUGGESTION — CLARIFY**

1. Read the current `title` and `description` from the schema.

2. Draft improved text based on the suggestion. Constraints:
   - Descriptions must be implementation-agnostic (no framework names, no code syntax)
   - Keep descriptions concise (1–2 sentences)
   - Do not invent details not implied by the existing schema or suggestion

3. Show the before/after diff:

   ```
   title:
     Before: "..."
     After:  "..."

   description:
     Before: "..."
     After:  "..."
   ```

4. If `autoMode` is active, proceed to write immediately. Otherwise, ask: "Apply this change? (yes / revise / skip)" and write only after confirmation.

5. Write the updated schema.

6. Log: `CLARIFIED {layerId}.{typeName} — updated title/description`

---

**APPLY SUGGESTION — ADD ATTRIBUTE**

1. Read the current `attributes.properties` and `required` arrays.

2. Draft the new attribute definition following the conventions visible in peer schemas in `spec/schemas/nodes/{layerId}/`.

3. Show the draft:

   ```
   Proposed new attribute: "{attributeName}"
     type: {type}
     description: "..."
     required: {yes/no}
   ```

4. If `autoMode` is active, proceed to write immediately. Otherwise, ask: "Add this attribute? (yes / revise / skip)" and write only after confirmation.

5. Write the updated schema.

6. Log: `ADDED attribute {attributeName} to {layerId}.{typeName}`

---

**APPLY BETTER ALTERNATIVE**

1. Prompt the user to describe the alternative approach.

2. Read any additional files needed to plan the edit.

3. Show a concise plan of changes before executing.

4. Ask: "Proceed with this plan? (yes / revise)"

5. Execute and log each file changed.

---

**SKIP**

Log: `SKIPPED {specNodeId} (alignment: {alignmentScore}) — {reason}` where reason is one of: `already-well-aligned`, `recently-reworked`, `marginal-value`, `user-choice`.

Move to the next item.

---

**SOMETHING ELSE**

Prompt the user to describe what they want to do. Read any additional schema files needed, plan the edits, confirm, then execute.

---

### STEP 6: Finalize

After all items have been processed:

1. Print the session summary:

```
Session Complete
================
Reviewed:  {N} items (alignment ≥ 80)

Disposition:
  ✓ Applied suggestion:         {count}
  ↺ Applied better alternative: {count}
  → Skipped (already healthy):  {count}
  → Skipped (recently reworked):{count}
  ✎ Custom action:              {count}

Files changed:
  Created:  {list or "none"}
  Modified: {list or "none"}
  Deleted:  {list or "none"}

{If no changes were made}
No spec changes were made. The well-aligned nodes are healthy as-is.
```

2. If any spec files were created, modified, or deleted, sync the CLI bundled schemas and rebuild:

```bash
cd cli && npm run build
```

This triggers `scripts/sync-spec-schemas.sh` which copies updated spec schemas into `cli/src/schemas/bundled/`.

3. Run the test suite:

```bash
cd cli && npm run test
```

4. Report any test failures. If tests fail due to the spec changes, describe the failures and ask the user how to proceed.

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

The `$ref` path is always `../../base/spec-node.schema.json` regardless of layer.

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
If a schema file expected to exist is missing, report the discrepancy and ask the user: skip this item, or investigate manually?

**Git log unavailable:**
If git commands fail (e.g., outside a git repo), classify history as `unknown` and proceed without the history context. Note that the git check was skipped.

**Enum values cannot be determined:**
If a ENUM_COLLAPSE suggestion is chosen but valid enum values cannot be derived from the schema or suggestion, ask the user to provide the values before writing. Do not write a schema with an empty or invented `enum` array.

**Target layer schema conflict on MOVE:**
If a schema with the same `typeName` already exists in the target layer, show both schemas side by side and ask: merge attributes into the existing schema, rename the incoming type, or abort this item.

**Build failure after changes:**
If `npm run build` fails, show the error output and ask the user how to proceed. Do not proceed with `npm run test` if the build fails.
