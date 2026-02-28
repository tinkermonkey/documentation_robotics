---
description: Update the DR model from a code change delta — PR, branch diff, or file changes
argument-hint: '<pr-url> | --diff <file> | --branch <branch> | "<description>"'
---

# Sync Model from Code Delta

Update the DR model to reflect code changes from a PR, branch diff, file changes, or a description of what was changed.

## What This Command Does

1. Parses the code change delta (PR diff, branch comparison, file list, or description)
2. Maps changed files to existing model elements via source tracking
3. Classifies each impact: new element needed, updated element, deleted, renamed, or relationship change
4. Creates a named changeset with all proposed model updates
5. Presents the proposed changes for review before applying anything

## Usage

```
/dr-sync <pr-url>               # Analyze a GitHub/GitLab PR by URL
/dr-sync --diff <file>          # Read a git diff from a file (e.g., git diff > changes.patch)
/dr-sync --branch <branch>      # Compare <branch> against the base/main branch
/dr-sync "<description>"        # Natural language description of what changed
```

## Instructions for Claude Code

### Step 1: Validate Prerequisites

Check that a DR model exists:

```bash
ls -la documentation-robotics/model/manifest.yaml 2>/dev/null
```

If no model exists, stop and prompt:

```
No DR model found. Run /dr-init first to initialize a model,
then /dr-ingest to extract the initial model from your codebase.
```

### Step 2: Parse the Delta

Determine input type from the user's invocation:

**PR URL** (e.g., `https://github.com/org/repo/pull/142`):

- Use `gh pr diff <pr-url>` to fetch the diff
- Use `gh pr view <pr-url>` to get PR title, description, and metadata
- Extract PR number for changeset naming

**Diff file** (`--diff <file>`):

- Read the diff file directly
- Parse unified diff format to identify changed files

**Branch** (`--branch <branch>`):

- Run `git diff <base-branch>...<branch> --name-status` to list changed files
- Run `git diff <base-branch>...<branch>` for full diff content

**Natural language** (plain description):

- Ask clarifying questions if the scope is unclear
- Map described changes to likely file/module patterns

### Step 3: Map Changed Files to Model Elements

For each changed, added, or removed file, look up which model elements track it:

```bash
# Find elements tracking a specific source file
dr search --source-file <file-path>
```

Also scan the diff content for code patterns that indicate model-significant changes:

- New class definitions → potential new element
- Deleted class/module → potential deleted element
- Renamed class/file → potential renamed element
- New import of external service → potential new relationship
- New route handler or endpoint definition → potential new API operation
- New DB schema/table → potential new data-store or data-model element
- New `@Service`/`@Component` annotation → potential new application element

### Step 4: Classify Impacts

Organize findings into these categories:

| Category                  | Description                                                                      | Action                    |
| ------------------------- | -------------------------------------------------------------------------------- | ------------------------- |
| **New elements**          | Files/classes with no model element yet, detected as architecturally significant | Stage `dr add`            |
| **Updated elements**      | Existing tracked elements with changed properties (renamed method, new field)    | Stage `dr update`         |
| **Deleted elements**      | Tracked elements whose source file/class was removed                             | Stage `dr delete`         |
| **Renamed/moved**         | Source file changed but logical element is the same                              | Stage source-file update  |
| **New relationships**     | New dependencies between services/components detected in imports or calls        | Stage relationship add    |
| **Removed relationships** | Existing relationships broken by code removal                                    | Stage relationship remove |

### Step 5: Create a Named Changeset

Create a changeset before staging any changes:

```bash
# For PR sync
dr changeset create sync-pr-<pr-number>

# For branch sync
dr changeset create sync-<branch-name>

# For description sync
dr changeset create sync-<kebab-description>
```

**Never apply model changes directly without a changeset.**

### Step 6: Stage Proposed Updates

For each classified impact, stage the appropriate change into the changeset. Include a reason for each staged change.

Show progress as you stage:

```
Staging proposed model updates...

+ api.operation.create-payment          (new endpoint detected in payments.ts:42)
+ application.service.payment-service   (new service class in src/services/payment.ts)
~ api.operation.create-order            (updated — now references payment-service)
~ data-model.entity.order               (updated — added paymentId field at order.ts:28)
- application.service.legacy-billing    (deleted — billing.ts was removed)
```

### Step 7: Present for Review

After staging all changes, display the complete proposed changeset:

```
PROPOSED MODEL UPDATES
=======================
Source: PR #142 — "Add payment service"

NEW ELEMENTS (2):
  + api.operation.create-payment
    Source: payments.ts:42 (POST /api/v1/payments)
    Reason: New endpoint detected, no existing model element tracks this file

  + application.service.payment-service
    Source: src/services/payment.ts
    Reason: New @Service class detected

UPDATED ELEMENTS (2):
  ~ api.operation.create-order
    Change: Added dependency on application.service.payment-service
    Reason: order-service.ts now imports PaymentService (line 15)

  ~ data-model.entity.order
    Change: Added field paymentId (string)
    Reason: Order class has new paymentId property (order.ts:28)

DELETED ELEMENTS (1):
  - application.service.legacy-billing
    Reason: billing.ts was removed in this PR

Changeset: sync-pr-142

Options:
  [a] Apply all changes (commit changeset)
  [s] Selectively apply (choose which to keep)
  [p] Preview merged model before committing
  [d] Discard all (delete changeset)
  [e] Edit a specific staged change
```

### Step 8: Apply or Revise

Based on user response:

**Apply all:**

```bash
dr changeset commit sync-pr-142
dr validate --strict
```

**Selective apply:**
Walk through each staged change and ask: keep or discard?

**Preview:**

```bash
dr changeset preview sync-pr-142
```

Then return to the review prompt.

**Edit a change:**
Prompt user for what to change, update the staged element, re-show the review.

**Discard:**

```bash
dr changeset delete sync-pr-142
```

### Step 9: Post-Sync Validation

After committing the changeset, run validation and report:

```bash
dr validate --strict
```

```
Sync Complete — PR #142
========================
Applied: 5 model changes
  ✓ 2 new elements added
  ✓ 2 elements updated
  ✓ 1 element deleted

Validation: ✓ Passed
Cross-layer references: ✓ All intact

Tip: If you notice model drift growing over time, use /dr-ingest
to do a full re-extraction and catch anything sync missed.
```

## Handling Edge Cases

### No model elements track any changed files

```
None of the changed files are tracked by model elements.

This could mean:
1. The changes are in files that were never extracted (run /dr-ingest first)
2. The changes are purely internal/non-architectural (no model update needed)

Changed files:
  - src/utils/helpers.ts (no elements tracked)
  - src/tests/unit/helpers.test.ts (no elements tracked)

These look like utility/test files — likely no model changes needed.
Confirm: skip model sync for this change?
```

### Large PR with many changes

```
This PR touches 47 files. Analyzing for architecturally significant changes...

Found 12 potentially model-relevant changes out of 47 total.
(Filtered out: 23 test files, 8 utility files, 4 config files)

Continuing with 12 candidates...
```

### Ambiguous changes

```
Ambiguous change detected:
  File: src/services/order.ts
  Change: Class renamed from OrderService to OrderManagementService

This could be:
1. A renamed element (update source tracking, keep element ID)
2. A split into a new element (create new, deprecate old)

Which applies?
```

## Related Commands

- `/dr-ingest` — Full codebase extraction (use for initial model or major rebuilds)
- `/dr-design` — Design model changes for a proposed feature (before implementation)
- `/dr-model` — Manually add or adjust individual elements
- `/dr-changeset` — Manage changeset lifecycle directly
- `/dr-validate` — Validate the model after syncing
