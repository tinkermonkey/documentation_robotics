---
title: Documentation Robotics (DR) Documentation Hub
description: Complete documentation for the DR workflow, commands, and features
---

# Documentation Robotics Documentation Hub

Welcome to the Documentation Robotics documentation. This directory contains guides, walkthroughs, and references for using DR to extract, verify, and maintain your architecture model.

---

## 🚀 Getting Started

**New to DR?** Start here:

### [QUICK_START.md](QUICK_START.md) — 5-Minute Overview

The fastest path from zero to an extracted and verified architecture model. Includes:

- One-minute summary of essential commands
- Three command reference (extract, verify, validate)
- Common workflows
- Troubleshooting quick fixes

**Time:** 5 minutes to understand the basics

---

### [END_TO_END_WALKTHROUGH.md](END_TO_END_WALKTHROUGH.md) — Complete Workflow

The comprehensive manual walkthrough covering every step from fresh project through verification and reconciliation. Includes:

- Visual workflow diagram
- Detailed step-by-step instructions with examples
- Pre-brief concepts and source provenance explained
- Complete example (Python FastAPI)
- Interactive reconciliation process
- Key concepts and troubleshooting

**Time:** 20 minutes to read, 15-20 minutes to execute

---

## 📚 Documentation By Topic

### Architecture & Concepts

- **[END_TO_END_WALKTHROUGH.md](END_TO_END_WALKTHROUGH.md)** — The complete workflow from fresh project to verified model
- **[QUICK_START.md](QUICK_START.md)** — Five-minute overview of essential commands

### Command Reference

- **[dr-map.md](../commands/dr-map.md)** — Extract architecture from your codebase
  - Recipe vs. Targeted modes
  - Layer-by-layer extraction
  - Analyzer integration for pre-briefs

- **[dr-verify.md](../commands/dr-verify.md)** — Verify model against code analyzer
  - Three-bucket reporting (matched, gaps, drift)
  - Interactive reconciliation
  - Ignore lists and drift management

- **[dr-validate.md](../commands/dr-validate.md)** — Validate model integrity
  - Schema and reference validation
  - Semantic rules checking
  - Orphan analysis

- **[dr-model.md](../commands/dr-model.md)** — Manually add and edit elements

- **[dr-init.md](../commands/dr-init.md)** — Initialize new models

### Skills & Agents

- **[dr-codebase-memory/SKILL.md](../skills/dr_codebase_memory/SKILL.md)** — Codebase memory and context management
- Layer-specific skills (Layer 1-12)

---

## 🔄 The DR Workflow at a Glance

```
1. Initialize Model
   ↓
2. Setup Code Analyzer (discover + index)
   ↓
3. Extract Architecture (/dr-map)
   • Analyzes codebase
   • Consumes analyzer pre-briefs
   • Creates elements with source provenance
   ↓
4. Verify Alignment (/dr-verify)
   • Reports matched, gaps, drift
   • Interactive prompts to reconcile
   ↓
5. Reconcile & Validate
   • Add missing elements (gaps)
   • Remove/update drifted elements
   • Final validation
   ↓
6. Model Ready for Use
   • Export, share, or enhance further
```

**Total Time:** 15-20 minutes for new project

---

## 🎯 Choose Your Path

### "I have code, need a model"

→ Read [QUICK_START.md](QUICK_START.md) → Follow "Path A: New Project"

- Time: ~20 minutes
- Commands: `dr init` → `dr analyzer discover` → `dr analyzer index` → `/dr-map` → `/dr-verify`

### "I have a model, want to verify it"

→ Read [QUICK_START.md](QUICK_START.md) → Follow "Path B: Existing Project"

- Time: ~5-10 minutes
- Commands: `/dr-verify` → reconcile → `dr validate`

### "I want detailed guidance"

→ Read [END_TO_END_WALKTHROUGH.md](END_TO_END_WALKTHROUGH.md)

- Time: ~20 minutes reading + 15-20 minutes execution
- Covers every step, concept, and decision point

### "I need command reference"

→ See [Command Reference](#command-reference) section above

- Detailed usage, options, examples for each command

---

## 📖 Documentation Structure

```
integrations/claude_code/
├── docs/                        ← You are here
│   ├── README.md               ← This file
│   ├── QUICK_START.md          ← 5-minute overview
│   └── END_TO_END_WALKTHROUGH.md ← Complete workflow
│
├── commands/                    ← Command documentation
│   ├── dr-map.md               ← Extract architecture
│   ├── dr-verify.md            ← Verify alignment
│   ├── dr-validate.md          ← Validate model
│   ├── dr-model.md             ← Edit elements
│   ├── dr-init.md              ← Initialize model
│   └── ... (30+ command docs)
│
├── skills/                      ← Specialized knowledge modules
│   ├── dr_codebase_memory/
│   ├── dr_01_motivation_layer/
│   ├── ... (all 12 layers)
│   └── dr_engineering_guide/
│
└── agents/                      ← Specialized agents
    ├── dr-architect.md
    ├── dr-advisor.md
    └── dr-extractor.md
```

---

## 🔑 Key Concepts

### Source Provenance

Every extracted element includes:

- **source_file** — The file path (relative to repo root)
- **source_symbol** — The specific class/function/symbol
- **source_provenance** — "extracted" (from code) or "inferred" (from patterns)

This link back to code is critical for:

- `/dr-sync` — Detecting when code changes
- `dr validate` — Verifying files still exist
- Reconciliation — Tracing elements to source

### Analyzer Pre-Briefs

When `/dr-map` runs with an indexed analyzer:

- **Endpoints brief** — Authoritative checklist of all routes
- **Services brief** — Suggested application services
- **Datastores brief** — Suggested data stores

Pre-briefs enable high-confidence extraction without scanning the entire codebase each time.

### Three-Bucket Verification

`/dr-verify` always reports:

- ✓ **Matched** — Routes in code AND model (good alignment)
- ⚠ **Graph-only** — Routes in code but NOT in model (suspected gaps)
- ? **Model-only** — Routes in model but NOT in code (possible drift)

Goal: Maximize matched, minimize gaps and drift.

---

## ❓ FAQ

### "How long does extraction take?"

2-5 minutes depending on codebase size. Recipe Mode (recommended for new models) includes checkpoint pauses for validation.

### "Do I need a code analyzer?"

No, it's optional. `/dr-map` works without one. But with an analyzer:

- Verification is possible (`/dr-verify`)
- Pre-briefs enable more confident extraction
- Gap/drift detection is automated

### "Can I extract incrementally?"

Yes. Use `/dr-map --layers <layers>` to extract specific layers. Combine with previous extractions to build your model over time.

### "What if I already have a model?"

Run `/dr-verify` to check alignment. Add gaps and remove drift interactively. Then validate and you're done.

### "Where's the CLI documentation?"

See the [main CLI README](../../cli/README.md)

### "Where are the changelog and version info?"

- Spec version: `spec/VERSION`
- Spec changelog: `spec/CHANGELOG.md`
- CLI version: `cli/package.json` (version field)
- CLI changelog: `cli/CHANGELOG.md`

---

## 🔗 Related Documentation

- **[CLI README](../../cli/README.md)** — Complete CLI reference and usage
- **[Specification](../../spec/)** — Layer definitions, schemas, and constraints
- **[Architecture Guide](./END_TO_END_WALKTHROUGH.md)** — How all pieces fit together
- **[CLAUDE.md](../../CLAUDE.md)** — Project-wide conventions and guidelines

---

## 🎬 Quick Examples

### Extract Python FastAPI backend

```bash
/dr-map ./backend --tech "Python FastAPI PostgreSQL"
```

### Verify API layer

```bash
/dr-verify --layer api
```

### Search for an element

```bash
dr search "order"
```

### View element details

```bash
dr show api.operation.create-order
```

### Add a new element

```bash
dr add api operation "list-orders" \
  --description "GET /api/v1/orders" \
  --source-file "src/routes/orders.ts"
```

### Export to ArchiMate

```bash
dr export archimate --output model.xml
```

---

## 🤝 Getting Help

- **Quick answer?** → [QUICK_START.md](QUICK_START.md)
- **Step-by-step guide?** → [END_TO_END_WALKTHROUGH.md](END_TO_END_WALKTHROUGH.md)
- **Specific command?** → See [Command Reference](#command-reference)
- **Stuck?** → Check troubleshooting sections in relevant docs
- **Bug or feature request?** → See CLAUDE.md for contributing guidelines

---

## 📋 Workflow Checklist

**First Time Using DR?**

- [ ] Read QUICK_START.md (5 min)
- [ ] Run `dr init my-project`
- [ ] Run `dr analyzer discover` and select an analyzer
- [ ] Run `dr analyzer index` (wait for completion)
- [ ] Run `/dr-map ./src` (choose Recipe Mode if first time)
- [ ] Run `/dr-verify` (reconcile gaps and drift)
- [ ] Run `dr validate --strict` (check for issues)
- [ ] ✓ Done! Model is ready.

**Verifying Existing Model?**

- [ ] Run `/dr-verify --layer api`
- [ ] Follow interactive prompts to add/remove/update
- [ ] Run `dr validate --strict`
- [ ] ✓ Done!

**Extracting Incrementally?**

- [ ] Run `/dr-map ./src --layers <specific-layers>`
- [ ] Run `/dr-verify --layer <same-layers>`
- [ ] Reconcile
- [ ] Repeat for other layers

---

## 🌟 Start Now

**Just want to get started?** → [QUICK_START.md](QUICK_START.md)

**Want comprehensive walkthrough?** → [END_TO_END_WALKTHROUGH.md](END_TO_END_WALKTHROUGH.md)

**Looking for specific command?** → [Command Reference](#command-reference)

---

**Last Updated:** 2026-04-21
