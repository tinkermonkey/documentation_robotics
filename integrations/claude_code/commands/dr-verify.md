---
description: Cross-reference the DR model against an external code analyzer and report matched elements, graph-only evidence (suspected gaps), and model-only entries (possible drift). Reports against the active changeset when one is active.
argument-hint: "[--layer <layer>...] [--name <analyzer>] [--output <path>]"
---

# Verify Model Against Code Analyzer

Cross-reference the Documentation Robotics model against an external code analyzer and report on alignment. Surface matched elements, graph-only evidence (suspected gaps in the model), and model-only entries (possible drift from the code).

## What This Command Does

1. Checks for an active code analyzer and confirms it is indexed
2. Runs verification against the model (base model or active changeset if present)
3. Reports results in three buckets:
   - **Matched**: Routes discovered in the code that exist in the model ✓
   - **Graph-only**: Routes discovered in the code but missing from the model (suspected gaps) ⚠
   - **Model-only**: Operations in the model but not discovered in the code (possible drift) ?

4. Offers actionable next steps: add missing routes, remove orphaned operations, or ignore entries

## Usage

```
/dr-verify [--layer <layer>...] [--name <analyzer>] [--output <path>]
```

**Options:**

- `--layer <layer>`: Layer(s) to verify (default: api; v1 only supports api)
- `--name <analyzer>`: Analyzer name (default: active analyzer from session)
- `--output <path>`: Write report to file (format inferred from extension: .json or .md)

## Instructions for Claude Code

When the user runs this command, perform intelligent verification with helpful suggestions.

### Step 1: Check Analyzer Status

**Check if an analyzer is installed and active:**

```bash
dr analyzer status --json
```

**Handle four scenarios:**

**Scenario 1: No active analyzer**

```
Analyzers are optional but enable deeper insights into your codebase.
See available analyzers:
  dr analyzer discover

Once installed, run:
  /dr-verify
```

Then exit cleanly (no error).

**Scenario 2: Analyzer inactive (detected.installed: false)**

```
Analyzer not installed or unavailable.

To enable code verification:
1. Run: dr analyzer discover
2. Install the recommended analyzer
3. Run: /dr-verify
```

Then exit cleanly (no error).

**Scenario 3: Analyzer installed but not indexed (detected.installed: true, indexed: false)**

```
Analyzer is installed but the project has not been indexed yet.

To enable code verification:
  dr analyzer index

This scans your codebase and builds the code graph (~1-2 minutes).

Would you like me to index now?

[y] Index now and proceed with verification
[n] Skip indexing (cannot verify without an index)
```

If user selects [y]: Run `dr analyzer index`, then proceed to Step 2.

If user selects [n]: Exit cleanly (no error).

**Scenario 4: Analyzer active and indexed (detected.installed: true, indexed: true)**

Proceed to Step 2.

### Step 2: Check Index Freshness

**When analyzer is active, check freshness:**

```bash
dr analyzer status --json | jq '.fresh'
```

**If fresh: true**

Proceed to Step 3.

**If fresh: false (stale index)**

If you are in an **interactive session** with a user present, show a freshness warning and ask:

```
Index is stale (last updated: <timestamp>).

The code may have changed since the index was built.
Would you like me to reindex before verifying?

[y] Reindex now (takes ~1-2 minutes)
[n] Skip and verify against current index
```

If user selects [y]: Run `dr analyzer index`, then proceed to Step 3.

If user selects [n]: Proceed to Step 3.

**If running autonomously** (headless mode, sub-agent, or no interactive user present):

Note the stale index in your output and proceed directly to Step 3 without asking:

```
Note: Index is stale (last updated: <timestamp>). Proceeding with current index.
```

### Step 3: Run Verification

**Run verification against api layer (v1 scope):**

```bash
dr analyzer verify --layer api --json
```

**Parse JSON output** — it contains the `VerifyReport` structure:

- `summary`: matched_count, gap_count, drift_count, ignored_count, total_graph_entries, total_model_entries
- `buckets.matched`: array of matched entries
- `buckets.in_graph_only`: array of routes found in code but not in model
- `buckets.in_model_only`: array of operations in model but not in code
- `changeset_context`: active_changeset (string or null), verified_against ("changeset_view" or "base_model")

### Step 4: Present Summary and Changeset Context

**Display the verification summary using exact format:**

```
Verified N graph routes against M model operations.
X matched, Y graph-only (suspected gaps), Z model-only (possible drift).
```

**Where:**

- N = `summary.total_graph_entries`
- M = `summary.total_model_entries`
- X = `summary.matched_count`
- Y = `summary.gap_count`
- Z = `summary.drift_count`

**Display changeset context prominently:**

**If changeset is active:**

```
Verifying against active changeset `<changeset_id>`
(Report reflects staged changes merged with the base model)
```

**If no changeset:**

```
Verifying against base model (no active changeset)
```

**Surface top entries from each bucket:**

For each bucket (matched, in_graph_only, in_model_only):

- Show first 5 entries with full details
- If more exist, show count: `` ... and N more — see full report with `dr analyzer verify --output verify.json` ``

### Step 5: Handle Graph-Only Entries (Suspected Gaps)

**For each `in_graph_only` entry, offer to add it to the model:**

```
Route discovered but not in model:
  POST /api/v1/orders

Source: src/routes/orders.ts:createOrder

Add this operation to the model?

[a] Add with command
[i] Ignore (add to .dr-verify-ignore.yaml)
[s] Skip
```

**If user selects [a]:**

**Generate pre-populated `dr add` command with all source flags from graph evidence:**

```bash
dr add api operation "create-order" \
  --description "POST /api/v1/orders" \
  --source-file "src/routes/orders.ts" \
  --source-symbol "createOrder" \
  --source-provenance extracted
```

**If no changeset is active**, offer changeset recommendation before executing:

```
Tip: You can track this work in an isolated changeset.

Would you like to create a changeset before adding entries?

[y] Create changeset (I'll name it verify-<timestamp>)
[n] Add directly to the base model
```

If user selects [y]: Create the changeset and activate it before proceeding.

Show the commands and offer to run them:

```bash
dr changeset create "verify-<timestamp>"
dr changeset activate "verify-<timestamp>"
```

Present options:

```
[r] Run these commands
[e] Edit and run
[c] Cancel
```

If user selects [r]: execute the commands and show result.

**If user selects [i] (ignore):**

**Ask for reason:**

```
Reason for ignoring (e.g., "deprecated endpoint", "internal debug route"):
```

Append to `.dr-verify-ignore.yaml` (created if it doesn't exist):

```yaml
version: 1
ignore:
  - patterns:
      - path: "/api/v1/orders"
    reason: "<user-provided reason>"
    match: "graph_only"
```

### Step 6: Handle Model-Only Entries (Possible Drift)

**For each `in_model_only` entry, offer investigation options:**

```
Operation in model but not discovered in code:
  api.operation.old-endpoint

Possible reasons:
  - Code was refactored or removed
  - Route handler is in a file the analyzer didn't scan
  - Confidence threshold filtered it out

Options:

[s] Show element details: dr show api.operation.old-endpoint
[q] Search codebase: dr analyzer query "<handler-pattern>"
[r] Remove from model: dr delete api.operation.old-endpoint
[u] Update element: dr update api.operation.old-endpoint
[i] Ignore (add to .dr-verify-ignore.yaml)
[n] Next entry
```

**If user selects [s]:**

```bash
dr show api.operation.old-endpoint
```

Show output and re-offer options.

**If user selects [q]:**

Ask for a search term and run query:

```bash
dr analyzer query "MATCH (n) WHERE n.name CONTAINS '<term>' RETURN n"
```

Show results and re-offer options.

**If user selects [r]:**

Ask for confirmation:

```
Delete api.operation.old-endpoint from the model?
This cannot be undone.

[y] Confirm deletion
[n] Cancel
```

If confirmed:

```bash
dr delete api.operation.old-endpoint
```

Show result and move to next entry.

**If user selects [u]:**

```bash
dr update api.operation.old-endpoint
```

Prompt for updated field(s) and proceed to next entry.

**If user selects [i]:**

Ask for reason and append to `.dr-verify-ignore.yaml`:

```yaml
version: 1
ignore:
  - patterns:
      - handler: "*"
    element_ids: ["api.operation.old-endpoint"]
    reason: "<user-provided reason>"
    match: "model_only"
```

### Step 7: Status and Next Steps

**After processing all buckets, summarize:**

```
Verification Complete
====================================================

Summary:
✓ X matched (operations aligned)
⚠ Y graph-only (suggested adds)
? Z model-only (suggested removes/updates)

Next Steps:

1. Review added operations:
   /dr-validate --strict

2. Sync with your team:
   /dr-changeset preview

3. Full report:
   /dr-verify --output verify.json
```

**Provide clickable next-step recommendations:**

- If gaps exist: `I found potential routes to add. Run /dr-map to extract more systematically.`
- If drift exists: `Review model-only operations to see if they've been refactored or deprecated.`
- If all matched: `✓ Model and code are well-aligned!`

## Advanced Features

### Full Report Export

**User can request full report output:**

```
User: /dr-verify --output verify.json

You: Generating verification report...

     dr analyzer verify --layer api --json --output verify.json

     ✓ Report written to: verify.json

     Summary:
     - Matched: X
     - Gaps: Y
     - Drift: Z

     View report: cat verify.json | jq
```

**Supported formats:**

- `.json` — Machine-readable for CI/CD integration
- `.md` — Markdown documentation with tables
- Default (stdout) — Colored text for interactive review

### Verify Specific Analyzer

**User can specify analyzer by name:**

```bash
dr analyzer verify --name cbm --layer api --json
```

If the analyzer is not installed, the command fails cleanly:

```
Analyzer not found: cbm

Available analyzers:
  dr analyzer discover
```

## Error Handling

### Error: No Analyzer Installed

```
No code analyzer found.

To enable verification:
  dr analyzer discover

Analyzers are optional — the model is still valid without one.
```

### Error: Project Not Indexed

```
Analyzer is installed but project index is missing.

Run:
  dr analyzer index

This scans your codebase and builds the code graph.
```

### Error: Verification Failed

```
Verification encountered an error:
[error details]

Troubleshooting:
1. Check analyzer status: dr analyzer status
2. Rebuild index: dr analyzer index --force
3. Check logs: cat .dr/logs/dr.log
```

## Example Interactions

### Example 1: Clean Verification

```
User: /dr-verify

You: Checking analyzer status...

     ✓ Analyzer: cbm (installed and indexed)
     ✓ Index is fresh

     Running verification...

     Verified 45 graph routes against 40 model operations.
     35 matched, 8 graph-only (suspected gaps), 2 model-only (possible drift).

     Verifying against base model (no active changeset).

     Matched Operations (35):
     ✓ api.operation.create-order (POST /api/v1/orders)
     ✓ api.operation.get-order (GET /api/v1/orders/{id})
     ... and 33 more

     Graph-Only Routes (8 suspected gaps):
     ⚠ POST /api/v1/orders/bulk-create
        Source: src/routes/orders.ts:bulkCreate
        Add this operation? [a] Add [i] Ignore [s] Skip

     Model-Only Operations (2):
     ? api.operation.legacy-endpoint
        Source: src/legacy/endpoints.ts:oldEndpoint
        Options: [s] Show [q] Query [r] Remove [u] Update [i] Ignore [n] Next

     Verification Complete
     ====================================================
     Next Steps:
     1. Review gaps: /dr-map ./src --layers api
     2. Validate model: /dr-validate --strict
     3. Full report: /dr-verify --output verify.json
```

### Example 2: With Stale Index

```
User: /dr-verify

You: Checking analyzer status...

     ⚠ Index is stale (last updated 2 hours ago)

     Reindex before verifying?
     [y] Reindex now
     [n] Skip and verify against current index

User: y

You: Reindexing...

     dr analyzer index

     ✓ Reindex complete (892 nodes, 1247 edges)

     Running verification...
     [continues with fresh verification results]
```

### Example 3: No Analyzer

```
User: /dr-verify

You: Checking analyzer status...

     No analyzer installed.

     Analyzers are optional but enable deeper code insights.

     To install:
       dr analyzer discover

     Once installed, run:
       /dr-verify

     Your model is still valid without an analyzer.
```

## Related Commands

- `/dr-validate` - Validate model schema and references
- `/dr-map` - Extract model from codebase (complementary to verify)
- `/dr-model` - Manually add/update elements
- `/dr-changeset` - Create changesets for isolated work
- `dr analyzer discover` - Install and select a code analyzer
- `dr analyzer index` - Rebuild the project index
- `dr show <element-id>` - Inspect element details
