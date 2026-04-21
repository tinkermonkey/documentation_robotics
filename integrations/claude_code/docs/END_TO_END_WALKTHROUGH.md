---
title: End-to-End DR Workflow Walkthrough
description: Complete manual walkthrough from fresh project through architecture model extraction, analyzer setup, and verification
---

# End-to-End Documentation Robotics Workflow

This guide walks through the complete Documentation Robotics (DR) workflow: from initializing a fresh project through extracting an architecture model, setting up code analysis, and verifying alignment between your codebase and the generated model.

**Estimated time:** 10-20 minutes (depending on codebase size)

---

## The Complete Workflow Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ START: Fresh Project (or existing codebase)                     │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │ 1. Initialize DR Model     │
        │    dr init <project-name>  │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────────────────────┐
        │ 2. Choose Your Workflow Path               │
        └────────────┬───────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
   ┌─────────────┐        ┌──────────────────────┐
   │ Option A    │        │ Option B              │
   │ (w/ Analyzer)        │ (Skip Analyzer)      │
   │             │        │                      │
   │ dr analyzer │        │ Skip to Step 3      │
   │ discover    │        │                      │
   │ dr analyzer │        │ • Faster setup       │
   │ index       │        │ • Manual control     │
   │             │        │                      │
   │ • Enables   │        │ • No /dr-verify      │
   │   /dr-verify         │   until added later  │
   └────────────┬┘        └──────────────┬───────┘
                │                       │
                └───────────┬───────────┘
                            │
                            ▼
        ┌─────────────────────────────────────────────────────┐
        │ 3. Extract Architecture Model from Codebase        │
        │    /dr-map <path> [--layers] [--tech]              │
        │    • Consumes pre-briefs from analyzer (if present) │
        │    • Creates elements with source provenance        │
        │    • Wires cross-layer references                   │
        │    • Validates extracted model                      │
        └────────────┬────────────────────────────────────────┘
                     │
                     ▼
        ┌─────────────────────────────────────────────────────┐
        │ 4. Verify Model (if analyzer available)             │
        │    /dr-verify [--layer <layer>]                     │
        │    • Reports matched elements ✓                     │
        │    • Shows suspected gaps (graph-only) ⚠            │
        │    • Identifies possible drift (model-only) ?       │
        │    • Generates actionable reports                   │
        └────────────┬────────────────────────────────────────┘
                     │
                     ▼
        ┌─────────────────────────────────────────────────────┐
        │ 5. User Reconciliation & Refinement                │
        │    • Add missing operations from gaps               │
        │    • Remove or update drifted elements              │
        │    • Establish additional relationships             │
        │    • Validate final model                           │
        └────────────┬────────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │ COMPLETE: Model Ready      │
        │ Ready for use/export       │
        └────────────────────────────┘
```

---

## Step 1: Initialize a DR Model

**What this does:** Creates a new Documentation Robotics model for your project.

**Command:**

```bash
dr init <project-name>
```

**Example:**

```bash
dr init my-awesome-api
```

**Output:**

```
✓ Model initialized: my-awesome-api
```

**What was created:**

- `documentation-robotics/model/manifest.yaml` — Project metadata
- `documentation-robotics/model/{NN}_{layer-name}/` — Empty layer directories for all 12 layers (e.g., `01_motivation/`, `02_business/`, ..., `12_testing/`)
- `.dr/` — Local DR configuration directory

(Use `--verbose` to see additional details about the model setup)

---

## Step 2: Choose Your Workflow Path

At this point, you have two options for how to proceed:

### Option A: With Code Analyzer (Recommended for Verification)

If you want to verify extracted elements against your codebase, set up an analyzer and index your code:

#### Discover Available Analyzers

**What this does:** Shows available code analyzers that can scan your codebase and build a code graph for verification.

**Command:**

```bash
dr analyzer discover
```

**Output:**

```
Available Code Analyzers
========================

1. codebase-memory (Recommended)
   Type: Graph-based code analyzer
   Coverage: Python, TypeScript, JavaScript, Java, Go
   Install: codebase-memory-mcp

   Builds a semantic graph of your codebase:
   • Identifies all endpoints/routes
   • Maps service dependencies
   • Detects data store schemas
   • Provides pre-briefs for extraction

   Install this analyzer?
   [y] Yes, install codebase-memory-mcp
   [n] Skip (you can add it later)
```

**Select your analyzer:**

- **Recommended:** `codebase-memory` for most projects
- Other options may be available for specific tech stacks

If you select [y], the analyzer is installed and ready.

#### Index Your Codebase

**What this does:** Scans your codebase and builds an indexed code graph for later verification.

**Command:**

```bash
dr analyzer index
```

**Output:**

```
Indexing codebase...

Scanning files:
  ✓ 245 files scanned
  ✓ 8 layers detected
  ✓ 45 endpoints identified
  ✓ 12 services mapped
  ✓ 35 data models indexed

Building graph:
  ✓ 892 nodes created
  ✓ 1,247 edges created

Index complete and fresh.
  Endpoints summary: /tmp/dr-analyzer-endpoints.json
  Services summary: /tmp/dr-analyzer-services.json
  Datastores summary: /tmp/dr-analyzer-datastores.json

Ready for extraction with /dr-map
```

**What happens:**

- Your codebase is scanned for architectural elements (endpoints, services, data models)
- Pre-briefs are generated — summaries that `/dr-map` will consume during extraction
- The index is saved locally; you can verify freshness before running `/dr-verify`

**Then proceed to Step 3** with the analyzer installed. This enables `/dr-verify` for gap and drift detection.

---

### Option B: Without Code Analyzer (Faster, Manual-First Approach)

If you prefer to build your model without code analysis, **skip the analyzer setup entirely** and go straight to Step 3:

```bash
# Skip dr analyzer discover and dr analyzer index
# Go directly to Step 3: /dr-map
```

**When to use this path:**

- You prefer to manually define your architecture model
- Your codebase is small and doesn't need systematic verification
- You want to iterate quickly without indexing overhead
- You'll add an analyzer later if needed

**Tradeoffs:**

- ❌ You won't have `/dr-verify` until you add an analyzer later
- ❌ No automated gap/drift detection
- ✅ Faster initial setup (no indexing wait)
- ✅ Full manual control over model creation

**Adding an analyzer later:**

If you decide later that you want verification capabilities, you can add an analyzer at any time:

```bash
dr analyzer discover      # Install analyzer
dr analyzer index         # Index your code
/dr-verify                # Now verification is available
```

---

## Step 3: Extract Architecture Model with `/dr-map`

**What this does:** Analyzes your codebase and automatically generates DR model elements across the relevant layers. Uses pre-briefs from the analyzer if available.

### 3a: Start the Extraction

**Command:**

```bash
/dr-map <path> [--layers <layers>] [--tech <technology>]
```

**Examples:**

**Simple extraction (infers layers):**

```bash
/dr-map ./src
```

**Specific layers only:**

```bash
/dr-map ./src --layers application,api,data-model
```

**With technology hints:**

```bash
/dr-map ./backend --tech "Python FastAPI PostgreSQL"
```

### 3b: Choose Extraction Mode

If your model is empty, you'll be asked which mode to use:

```
I see this is a new model with no existing elements.

I can extract in two ways:

1. Recipe Mode (recommended)
   Walks through all 12 layers in the correct architectural order,
   with checkpoints to review and validate each layer before proceeding.
   Takes longer but produces a complete, well-structured model.

2. Targeted Mode
   Extract specific layers only.

Which would you prefer?
[r] Recipe Mode
[t] Targeted Mode
```

**Recommendation:** Choose **Recipe Mode** for a comprehensive first extraction. It ensures infrastructure and data layers are populated before business and motivation layers are inferred.

### 3c: Preliminary Analysis

The extraction performs a quick scan before starting:

```
Preliminary scan of ./src:

Detected:
✓ Language: Python (45 .py files)
✓ Framework: FastAPI (found fastapi imports)
✓ API: 8 route files detected
✓ Database: SQLAlchemy models found (12 files)
✓ Tests: pytest structure detected

Detected Analyzer (Status):
✓ Analyzer: codebase-memory (installed and indexed)
  → Endpoints summary available
  → Services summary available
  → Datastores summary available
  → Extraction will cross-reference these for high-confidence mappings

Estimated extraction:
- Business services: ~5
- Application services: ~8
- API operations: ~35
- Data models: ~12

This will take approximately 2-3 minutes.
Proceed with extraction?
[y] Yes, proceed
[n] Cancel
```

### 3d: Recipe Mode Layer-by-Layer Extraction

If you selected Recipe Mode, you'll see checkpoints after each layer:

**Layer 1: Technology**

```
Checkpoint: Technology Layer Complete
=========================================
Extracted 3 elements:
  - technology.platform.fastapi
  - technology.platform.postgresql
  - technology.framework.sqlalchemy

Validation: ✓ Passed (all elements valid)

What would you like to do?
  [c] Continue to next layer (Data Store)
  [a] Add a missing element
  [s] Skip to a specific layer
  [r] Re-extract this layer
  [q] Finish here
```

**Between-layer wiring:**
After each layer, the system wires relationships to elements in already-populated lower layers:

```
Wiring cross-layer references...
✓ 8 realizes references (application → business)
✓ 35 exposes references (api → application)
✓ 12 stores references (data-store → data-model)
```

### 3e: Extraction Complete

After all layers (or when you finish):

```
Recipe Extraction Complete!
=============================

Layers:
  ✓ Layer 5 (Technology):   3 elements
  ✓ Layer 8 (Data Store):   8 elements
  ✓ Layer 7 (Data Model):  12 elements
  ✓ Layer 4 (Application): 8 elements
  ✓ Layer 6 (API):         35 elements
  ✓ Layer 9 (UX):          0 elements (no frontend detected)
  ✓ Layer 2 (Business):    5 elements (inferred)
  ✓ Layer 3 (Security):    2 elements (inferred)
  ✓ Layer 1 (Motivation):  1 element (inferred)

Total: 74 elements across 9 layers

Final validation: ✓ Passed

Connectivity:
  dr validate --orphans
  This shows elements still needing relationships, grouped by layer
  Orphans remaining after /dr-map are best handled by running
  /dr-relate --orphans rather than a full /dr-relate pass.

Next steps:
  - Review element quality: /dr-model
  - Verify against code: /dr-verify
  - Establish relationships: /dr-relate
```

### 3f: Source Provenance

All extracted elements include **source provenance**:

- `source_file` — The file the element was extracted from
- `source_symbol` — The specific class, function, or symbol
- `source_provenance` — How the element was identified (extracted or inferred)

This traceability is critical for:

- `/dr-sync` — Detecting drift when code changes
- `dr validate` — Verifying referenced files still exist
- Reconciliation — Linking model elements back to their code origins

**Example element with provenance:**

```bash
dr show api.operation.create-order
```

```
Element: api.operation.create-order
Description: POST /api/v1/orders
Layer: API (Layer 6)

Source Reference:
  File: src/routes/orders.ts
  Symbol: createOrder
  Provenance: extracted
  Lines: 45-60
```

---

## Step 4: Verify Model Against Code with `/dr-verify`

**⚠️ This step only applies if you chose Option A (with Code Analyzer) in Step 2.** If you chose Option B (no analyzer), skip to Step 5 or refer to [Adding an analyzer later](#option-b-without-code-analyzer-faster-manual-first-approach) for instructions on adding verification capability.

**What this does:** Cross-references your extracted model against the code analyzer's index and reports on alignment. Shows what's matched, what's missing (gaps), and what's out of sync (drift).

### 4a: Run Verification

**Command:**

```bash
/dr-verify [--layer <layer>]
```

**Check analyzer status first:**

```bash
dr analyzer status
```

```
Analyzer Status
===============
Analyzer: codebase-memory
Status: installed and indexed
Index freshness: fresh (updated 2 minutes ago)
Ready for verification.
```

**Run verification:**

```bash
/dr-verify --layer api
```

### 4b: Verification Results

**Summary:**

```
Verified 45 graph routes against 40 model operations.
35 matched, 8 graph-only (suspected gaps), 2 model-only (possible drift).

Verifying against base model (no active changeset).
```

**Where:**

- **Matched (35)** — Routes found in code AND in your model ✓
- **Graph-only (8)** — Routes found in code but NOT in model (suspected gaps) ⚠
- **Model-only (2)** — Operations in model but NOT in code (possible drift) ?

### 4c: Matched Elements

```
Matched Operations (35):
========================
✓ api.operation.create-order (POST /api/v1/orders)
  Source: src/routes/orders.ts:createOrder

✓ api.operation.get-order (GET /api/v1/orders/{id})
  Source: src/routes/orders.ts:getOrder

✓ api.operation.update-order (PUT /api/v1/orders/{id})
  Source: src/routes/orders.ts:updateOrder

[... and 32 more matched operations ...]
```

**These are good!** Your model has correct coverage for these elements.

### 4d: Graph-Only Entries (Suspected Gaps)

```
Graph-Only Routes (8 suspected gaps):
======================================
⚠ POST /api/v1/orders/bulk-create
  Source: src/routes/orders.ts:bulkCreate

  Add this operation to the model?
  [a] Add with command
  [i] Ignore (not a public operation)
  [s] Skip
```

**Process gaps:**

**Option 1: Add to Model**

- Select [a]
- A pre-populated `dr add` command is generated with all source info from the analyzer:

  ```bash
  dr add api operation "bulk-create-orders" \
    --description "POST /api/v1/orders/bulk-create" \
    --source-file "src/routes/orders.ts" \
    --source-symbol "bulkCreate" \
    --source-provenance extracted
  ```

- Command is executed and element is added

**Option 2: Ignore**

- Select [i]
- Provide a reason: "Internal utility, not user-facing"
- Entry is added to `.dr-verify-ignore.yaml` for future reference

  ```yaml
  version: 1
  ignore:
    - patterns:
        - path: "/api/v1/orders/bulk-create"
      reason: "Internal utility, not user-facing"
      match: "graph_only"
  ```

**Option 3: Skip**

- Select [s]
- Move to next gap, decide later

### 4e: Model-Only Entries (Possible Drift)

```
Model-Only Operations (2):
==========================
? api.operation.legacy-endpoint
  Description: GET /api/v1/legacy/old-endpoint
  Source: src/legacy/endpoints.ts:oldEndpoint

  Possible reasons:
    - Code was refactored or removed
    - Route handler is in a file the analyzer didn't scan
    - Confidence threshold filtered it out

  Options:
  [s] Show element details
  [q] Query analyzer for pattern
  [r] Remove from model
  [u] Update element
  [i] Ignore (still valid but not found)
  [n] Next entry
```

**Process drift:**

**Option 1: Show Details** ([s])

- Display full element information from the model
- Helps you decide if it's truly obsolete

**Option 2: Query Analyzer** ([q])

- Search the code graph for related patterns
- "Are there any routes similar to this?"
- If found, maybe the naming changed in code

**Option 3: Remove** ([r])

- Delete from model if confirmed obsolete
- `dr delete api.operation.legacy-endpoint`
- Clean up outdated elements

**Option 4: Update** ([u])

- Modify the element if it's still valid but renamed
- Update description, source file, etc.

**Option 5: Ignore** ([i])

- Keep it in the model but note that analyzer didn't find it
- Useful for deprecated endpoints you're tracking

### 4f: Verification Complete

```
Verification Complete
=====================

Summary:
✓ 35 matched (operations aligned)
⚠ 8 graph-only (add to model)
? 2 model-only (review or remove)

Changeset Context:
Verifying against base model (no active changeset)

Next Steps:

1. Review added operations:
   /dr-validate --strict

2. View detailed report:
   /dr-verify --output verify.json

3. Full recursive extraction (systematic):
   /dr-relate --orphans

4. Sync team:
   /dr-changeset preview
```

---

## Step 5: User Reconciliation & Refinement

### 5a: Address Gaps

**For each suspected gap from `/dr-verify`:**

1. **Understand the gap** — Why wasn't this operation extracted initially?
   - Low confidence? Hidden in less-obvious code pattern?
   - Newer code added after `/dr-map` ran?
   - Multi-file route registration?

2. **Add to model** (if confirmed valid)

   ```bash
   dr add api operation "bulk-create-orders" \
     --description "POST /api/v1/orders/bulk-create" \
     --source-file "src/routes/orders.ts" \
     --source-symbol "bulkCreate"
   ```

3. **Add to ignore list** (if confirmed not user-facing)

   ```bash
   echo "- path: /api/v1/internal/debug
     reason: Internal debug endpoint
     match: graph_only" >> .dr-verify-ignore.yaml
   ```

### 5b: Address Drift

**For each model-only entry from `/dr-verify`:**

1. **Investigate** — Is the code still there?

   ```bash
   dr analyzer query "MATCH (n) WHERE n.name CONTAINS 'oldEndpoint' RETURN n"
   ```

2. **Remove** (if code no longer exists)

   ```bash
   dr delete api.operation.legacy-endpoint
   ```

3. **Update** (if code was refactored)

   ```bash
   dr update api.operation.legacy-endpoint \
     --source-file "src/routes/new-location.ts" \
     --source-symbol "newName"
   ```

4. **Keep** (if it's intentionally deprecated but tracked)
   - Add to ignore list for future verification runs

### 5c: Establish Relationships

**If you extracted the model but `/dr-map` didn't fully wire relationships:**

```bash
/dr-relate --orphans
```

This systematically establishes intra-layer and cross-layer relationships for elements that are still disconnected.

### 5d: Final Validation

**Run strict validation:**

```bash
dr validate --strict
```

```
Validation Results
==================

✓ Schema validation passed (all elements valid)
✓ Reference validation passed (all cross-layer references exist)
⚠ 2 semantic warnings:

1. api.operation.create-order
   Warning: No security policy assigned
   Recommendation: Add authentication via /dr-design

2. application.service.payment-service
   Warning: Critical service not monitored
   Recommendation: Add APM metrics via /dr-model
```

---

## Complete Example: Start to Finish

### Scenario: Extracting a Python FastAPI backend

```bash
# Step 1: Initialize model
dr init order-service

# Step 2: Setup analyzer
dr analyzer discover          # Select codebase-memory
dr analyzer index             # Index the codebase (~2 minutes)

# Step 3: Extract architecture
/dr-map ./src --tech "Python FastAPI PostgreSQL"

# At prompt: Select Recipe Mode
# Work through all 12 layers, validating at each checkpoint
# Take ~5-10 minutes to complete

# Step 4: Verify alignment
/dr-verify --layer api

# Process results:
# - Add 3 graph-only operations (pre-populated commands provided)
# - Review and remove 1 model-only drift item
# - Keep 2 operations in ignore list

# Step 5: Final check
dr validate --strict

# All done!
✓ Model extracted and verified
✓ 74 elements across 9 layers
✓ 98% analyzer alignment
✓ Ready for team use
```

**Time to completion: ~20 minutes** (mostly spent at Recipe Mode checkpoints reviewing layer extractions)

---

## Key Concepts

### Pre-Briefs from Analyzer

When `/dr-map` runs and an analyzer is indexed:

- **Endpoints pre-brief** — All discovered routes/endpoints
  - Treated as authoritative checklist for API layer
  - Each candidate must be extracted or explicitly rejected

- **Services pre-brief** — Suggested application services
  - Used as hints; rely on code inspection as primary signal

- **Datastores pre-brief** — Database schemas and tables
  - Suggestions only; verify against actual code

### Source Provenance

Every extracted element includes:

- **source_file** — Where the element came from (relative to repo root)
- **source_symbol** — The specific class/function/symbol name
- **source_provenance** — "extracted" (from code) or "inferred" (from patterns)

This is **mandatory** for traceability. Without it:

- `/dr-sync` can't detect drift
- `dr validate` can't verify file existence
- Model becomes a snapshot with no connection to source code

### Three-Bucket Verification

`/dr-verify` always reports three buckets:

```
Graph-only  ⚠  ← Routes in code but not in model (gaps to fill)
Matched     ✓  ← Routes in code AND in model (good alignment)
Model-only  ?  ← Operations in model but not in code (drift to fix)
```

The goal: Maximize matched, minimize gaps and drift.

---

## Troubleshooting

### "No analyzer installed"

```bash
dr analyzer discover      # Install one first
dr analyzer index         # Then index your codebase
/dr-verify               # Then verify
```

### "Index is stale"

```bash
dr analyzer status        # Check freshness
dr analyzer index         # Reindex if stale
/dr-verify               # Reverify
```

### "Verification found many gaps"

```bash
/dr-map ./src --layers api    # Re-extract API layer specifically
/dr-verify --layer api         # Reverify just that layer
```

### "Model validation errors"

```bash
dr validate --strict      # See all errors
/dr-model                 # Manually fix issues
dr validate --strict      # Revalidate
```

---

## Related Commands

- **Initialize:** `/dr-init <project-name>` — Create new model
- **Extract:** `/dr-map <path>` — Extract from codebase
- **Verify:** `/dr-verify` — Cross-reference against analyzer
- **Validate:** `dr validate` — Validate model integrity
- **Enhance:** `/dr-model` — Manually add/adjust elements
- **Relate:** `/dr-relate` — Wire relationships
- **Sync:** `/dr-sync` — Update when code changes
- **Search:** `dr search` — Query extracted elements
- **Show:** `dr show <element-id>` — Inspect element details

---

## Next Steps After Extraction

Once your model is extracted and verified:

1. **Document Business Goals**
   - `/dr-model Add motivation layer goals`

2. **Add Security Policies**
   - `/dr-model Add authentication to public endpoints`

3. **Establish Monitoring**
   - `/dr-model Add APM metrics to critical services`

4. **Create Changesets**
   - `/dr-changeset Create changeset for new feature`

5. **Export for Stakeholders**
   - `dr export archimate` — Export to ArchiMate format
   - `dr export openapi` — Export API documentation
   - `dr export markdown` — Generate markdown docs

---

## Summary

The end-to-end workflow:

1. **Initialize** — Create fresh model
2. **Analyze** — Setup and index code analyzer
3. **Extract** — Run `/dr-map` to automatically build model from code
4. **Verify** — Run `/dr-verify` to cross-reference against code
5. **Reconcile** — Address gaps and drift discovered during verification
6. **Validate** — Confirm final model integrity and completeness

**Result:** A complete, verified, traceable architecture model ready for team use, exports, and ongoing synchronization.
