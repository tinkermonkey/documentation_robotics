---
title: DR Quick Start Guide
description: Fastest path from zero to extracted and verified architecture model
---

# Documentation Robotics: Quick Start (5 Minutes)

**TL;DR:** The fastest way to extract and verify your architecture model.

## One-Minute Summary

```bash
# 1. Initialize (30 seconds)
dr init my-project

# 2. Setup analyzer (1 minute)
dr analyzer discover      # Choose codebase-memory
dr analyzer index         # Wait for indexing

# 3. Extract (2-5 minutes depending on codebase)
/dr-map ./src

# 4. Verify (1 minute)
/dr-verify

# Done! Model extracted and verified.
```

---

## The Three Essential Commands

### 1️⃣ Extract: `/dr-map <path>`

```bash
/dr-map ./src --tech "Python FastAPI"
```

**What it does:** Analyzes your codebase and extracts an architecture model.

**Options:**
- `--layers <layers>` — Specific layers (e.g., `api,application,data-model`)
- `--tech <stack>` — Technology hints (helps with detection)

**Output:** Model elements across all relevant layers with source provenance.

**Time:** 2-5 minutes (depending on size)

---

### 2️⃣ Verify: `/dr-verify [--layer <layer>]`

```bash
/dr-verify --layer api
```

**What it does:** Cross-references your model against the code analyzer.

**Shows:**
- ✓ **Matched** — Elements correctly in both code and model
- ⚠ **Graph-only** — Routes in code but missing from model (gaps)
- ? **Model-only** — Operations in model but not in code (drift)

**Interactive:** Prompts you to add gaps or remove drift.

**Time:** 1-2 minutes

---

### 3️⃣ Validate: `dr validate --strict`

```bash
dr validate --strict
```

**What it does:** Checks model integrity (schema, references, naming).

**Output:** Errors, warnings, and recommendations.

**Time:** 30 seconds

---

## Choosing Your Path

### Path A: New Project (Empty Model)
```
Initialize → Discover Analyzer → Index → Extract (Recipe Mode) → Verify → Done
```
**Time:** ~15-20 minutes

### Path B: Existing Project (You Have a Model)
```
Verify → Address Gaps/Drift → Validate → Done
```
**Time:** ~5-10 minutes

### Path C: Incremental Extraction
```
Extract Specific Layers → Verify → Reconcile → Done
```
**Time:** ~5-10 minutes

---

## What Each Step Does

| Step | Command | Time | What Happens |
|------|---------|------|--------------|
| **Initialize** | `dr init <name>` | 30s | Creates empty model |
| **Discover** | `dr analyzer discover` | 2m | Installs code analyzer |
| **Index** | `dr analyzer index` | 1-2m | Scans codebase & builds graph |
| **Extract** | `/dr-map <path>` | 2-5m | Generates model from code |
| **Verify** | `/dr-verify` | 1-2m | Cross-checks against code |
| **Reconcile** | Interactive prompts | 2-5m | Fix gaps and drift |
| **Validate** | `dr validate --strict` | 30s | Final integrity check |

**Total for new project:** ~15-20 minutes

---

## Common Workflows

### "I just have code, no model"

```bash
dr init my-service
dr analyzer discover      # Follow prompts to install
dr analyzer index
/dr-map ./src
/dr-verify --layer api
```

**Result:** Complete model extracted and verified against code.

---

### "I have a model but want to verify it"

```bash
dr analyzer index         # (if not already indexed)
/dr-verify --layer api
```

**Result:** See gaps and drift, reconcile interactively.

---

### "I want to extract just one layer"

```bash
/dr-map ./src --layers api
/dr-verify --layer api
```

**Result:** API layer extracted, verified, and ready.

---

### "I need a complete model fast"

```bash
dr init my-project
dr analyzer discover
dr analyzer index
/dr-map ./src            # Choose Recipe Mode when prompted
/dr-verify               # Answer prompts interactively
```

**Pro tip:** Recipe Mode walks you through all 12 layers with checkpoints. Most thorough approach.

---

## Key Concepts in 30 Seconds

- **Source Provenance:** Every extracted element includes `source_file`, `source_symbol`, `source_provenance` — the link back to code
- **Pre-Briefs:** Analyzer provides summaries of endpoints, services, datastores that `/dr-map` uses for high-confidence extraction
- **Three Buckets:** Verification shows **matched** (good), **graph-only** (gaps), **model-only** (drift)
- **Interactive Reconciliation:** `/dr-verify` prompts you to add gaps or remove drift one by one

---

## Output You'll See

### After `/dr-map`
```
✓ Extraction complete!

Created Elements:
  - 8 application services
  - 35 API operations
  - 12 data models

Validation: ✓ Passed

Next: /dr-verify
```

### After `/dr-verify`
```
Verified 45 graph routes against 40 model operations.
35 matched ✓, 8 graph-only ⚠, 2 model-only ?

[Interactive prompts for each gap/drift]

Verification Complete
Next Steps: dr validate --strict
```

### After `dr validate --strict`
```
✓ Schema validation passed
✓ Reference validation passed
⚠ 2 semantic warnings (see /dr-model)

Ready for export/sharing
```

---

## Troubleshooting Quick Fixes

| Problem | Solution |
|---------|----------|
| "No analyzer" | `dr analyzer discover` then pick one |
| "Not indexed" | `dr analyzer index` to build graph |
| "Index stale" | `dr analyzer index` to refresh |
| "Many gaps" | `/dr-map ./src --layers api` to re-extract |
| "Validation errors" | `dr validate --strict` to see details, then `/dr-model` to fix |
| "Lost in process" | Read `END_TO_END_WALKTHROUGH.md` for detailed guide |

---

## Pro Tips

1. **Start with Recipe Mode** if extracting everything — ensures proper layer order
2. **Use `--tech` flag** when extracting — helps detector recognize your stack
3. **Always run `/dr-verify`** after `/dr-map` — catches gaps and drift immediately
4. **Use Interactive Prompts** — `/dr-verify` offers pre-populated `dr add` commands
5. **Commit `source_provenance`** — Makes `/dr-sync` work later when code changes

---

## Next Steps

**Ready to start?**

→ Full walkthrough: [END_TO_END_WALKTHROUGH.md](END_TO_END_WALKTHROUGH.md)

**Need command reference?**

- `/dr-map` — See `commands/dr-map.md`
- `/dr-verify` — See `commands/dr-verify.md`  
- `dr validate` — See `commands/dr-validate.md`

**Want to explore your model?**

- `/dr-model` — Manually add/edit elements
- `dr search` — Query elements
- `dr show <element-id>` — Inspect details
