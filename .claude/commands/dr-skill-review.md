---
description: Audit a layer's SKILL.md against the spec — finds missing types, invalid type names, wrong element IDs, and missing guidance sections
argument-hint: "<layer> [--auto]"
---

# DR Skill Review

Audits a layer's extraction skill file (`integrations/claude_code/skills/dr_{NN}_{layer}_layer/SKILL.md`) against the authoritative spec for that layer. Finds and interactively resolves:

- Spec-defined types missing from the Entity Types table
- Invalid type names used in the skill (not recognized by the spec)
- Element ID examples that use wrong type segments
- Missing structural sections (type decision tree, coverage checklist, detection patterns, misclassification warnings)

Intended for schema maintainers keeping skill files synchronized with spec evolution.

## Usage

```bash
/dr-skill-review application
/dr-skill-review technology
/dr-skill-review data-model
/dr-skill-review ux

# Non-interactive mode — automatically applies the recommended fix for each finding:
/dr-skill-review application --auto
/dr-skill-review technology --auto
```

Layer names follow the canonical DR layer naming: `motivation`, `business`, `security`, `application`, `technology`, `api`, `data-model`, `data-store`, `ux`, `navigation`, `apm`, `testing`.

---

## Instructions for Claude Code

When this command is invoked, execute the following steps precisely.

---

### STEP 1: Resolve the Layer and Parse Flags

Parse all arguments. The layer name is the first non-flag token. Check for `--auto` anywhere in the argument list — if present, set `autoMode = true`.

**`--auto` behavior:**

- Skips all `AskUserQuestion` calls entirely.
- For each finding, automatically executes the action marked "(Recommended)" and prints a one-line `[AUTO]` summary so the changes are visible.
- For SECTION findings: auto-applies high-severity sections (Type Decision Tree, Coverage Checklist); auto-skips medium-severity sections (Common Misclassifications, Detection Patterns) because these require codebase-specific knowledge.
- For INVALID findings: auto-applies the suggested reclassification. If no suggestion can be determined, logs a warning and skips.
- Still prints the full report header and the final summary regardless of mode.

Determine the canonical layer name and skill file path.

**Layer name → skill directory map:**

| Canonical Name | Skill Directory           |
| -------------- | ------------------------- |
| `motivation`   | `dr_01_motivation_layer`  |
| `business`     | `dr_02_business_layer`    |
| `security`     | `dr_03_security_layer`    |
| `application`  | `dr_04_application_layer` |
| `technology`   | `dr_05_technology_layer`  |
| `api`          | `dr_06_api_layer`         |
| `data-model`   | `dr_07_data_model_layer`  |
| `data-store`   | `dr_08_dataset_layer`     |
| `ux`           | `dr_09_ux_layer`          |
| `navigation`   | `dr_10_navigation_layer`  |
| `apm`          | `dr_11_apm_layer`         |
| `testing`      | `dr_12_testing_layer`     |

If the argument is not a recognized canonical layer name, print:

```
Unknown layer: "<argument>"

Valid layer names:
  motivation | business | security | application | technology | api
  data-model | data-store | ux | navigation | apm | testing

Usage: /dr-skill-review <layer> [--auto]
```

Then stop.

Resolve the skill file path:

```
integrations/claude_code/skills/{skill_directory}/SKILL.md
```

If the file does not exist, print:

```
Skill file not found: {path}

Expected at: integrations/claude_code/skills/{skill_directory}/SKILL.md
Create the file first, then re-run this command.
```

Then stop.

---

### STEP 2: Get the Authoritative Type List from the Spec

Run `dr schema types <layer>` to get the complete, current list of valid spec-defined types for this layer.

```bash
dr schema types <layer>
```

Parse the output to extract:

- The list of valid type names (e.g., `systemsoftware`, `artifact`, `node`, `technologyprocess`, ...)

If the command fails, try reading the spec directly:

```bash
cat spec/dist/<layer>.json | node -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync('/dev/stdin','utf8'));
  Object.keys(data.nodeSchemas || {}).forEach(k => console.log(k.split('.')[1]));
"
```

Record the **authoritative spec types** as `SPEC_TYPES`.

---

### STEP 3: Read and Parse the Skill File

Read the SKILL.md content. Extract from it:

**A. Types documented in the Entity Types table**

Scan for the `## Entity Types` section. Parse the table rows and collect the type names — normalize to lowercase, remove `**` bold markers. Store as `SKILL_TYPES`.

For example, a row `| **ApplicationComponent** | ...` → type name `applicationcomponent`.

Also check whether the skill lists the types in a code block (e.g., the CRITICAL block in the technology skill). Collect any type names from those blocks too.

**B. Type names used in example element IDs**

Scan all code blocks for element ID patterns matching:
`{layer}.{something}.{name}` (e.g., `technology.framework.react`, `application.component.user-service`)

Extract the middle segment (the type segment) from each. Store all unique type segments found in examples as `SKILL_ID_TYPES`.

**C. Sections present**

Check which of these structural sections exist (look for `##` headings):

| Section                   | Heading keywords to look for                                  |
| ------------------------- | ------------------------------------------------------------- |
| Type Decision Tree        | `type decision tree`, `decision tree`, `classification`       |
| Common Misclassifications | `misclassification`, `common mistakes`, `do not`, `avoid`     |
| Detection Patterns        | `detection pattern`, `codebase pattern`, `framework-specific` |
| Coverage Checklist        | `coverage`, `checklist`, `completeness`                       |

---

### STEP 4: Build the Findings List

Compare `SPEC_TYPES`, `SKILL_TYPES`, and `SKILL_ID_TYPES` to identify issues. Classify each as one of four finding types:

**MISSING — Spec type not documented in Entity Types table**

For each type in `SPEC_TYPES` that is NOT in `SKILL_TYPES`:

- Finding: `MISSING type: {layer}.{type}` — the skill's Entity Types table has no row for this type

**INVALID — Type name used in the skill that does not exist in the spec**

For each type segment in `SKILL_ID_TYPES` that is NOT in `SPEC_TYPES`:

- Skip the layer name itself (e.g., `technology`, `application`) — those are not type errors
- Finding: `INVALID type in example ID: {layer}.{type_segment}.* — '{type_segment}' is not a spec type`

Also scan for any type names mentioned in prose or attributes (`type: stack`, `type: framework`, etc.) that don't match spec types.

**SECTION — Structural section missing**

For each of the four structural sections that is absent:

- Finding: `SECTION missing: {section name}`

Weight sections by severity:

- Type Decision Tree / Classification Guide — **high** (most important for correct extraction)
- Coverage Checklist — **high**
- Common Misclassifications — **medium**
- Detection Patterns — **medium**

**ID FORMAT — Example IDs with wrong type segment**

For every example ID where the type segment is not a valid spec type (overlap with INVALID, but call these out specifically):

- Finding: `ID FORMAT: {full example ID} — use {layer}.{correct_spec_type}.{name} instead`

---

### STEP 5: Print the Review Report

Print a summary before walking through items:

```
Skill Review: {layer} layer
===========================
Skill file: integrations/claude_code/skills/{skill_directory}/SKILL.md

Spec types ({count}):  {comma-separated list}
Skill types ({count}): {comma-separated list}

Findings ({total}):
  MISSING  ({count}) — spec types absent from Entity Types table
  INVALID  ({count}) — non-spec type names used in examples
  SECTION  ({count}) — structural sections absent
  ID FORMAT ({count}) — example IDs with wrong type segment

{If 0 findings}
✓ No gaps found. The skill file is consistent with the spec.
```

If there are zero findings, stop here.

---

### STEP 6: Walk Through Each Finding

Process findings in this order: MISSING → INVALID → ID FORMAT → SECTION.

If `autoMode` is active, execute the recommended action immediately without pausing. Print a `[AUTO]` prefix on each action line so the maintainer can see what was applied. If `autoMode` is not active, present the finding and use `AskUserQuestion` to ask what to do.

---

#### 6-MISSING: Spec type absent from Entity Types table

```
[MISSING {N}/{total}] {layer}.{type}

This type is defined in the spec but has no row in the Entity Types table.

Spec definition (from dr schema node {layer}.{type}):
  {print key attributes from the schema — title, description, key attribute names}

Options:
  1. Add a row to the Entity Types table (Recommended)
  2. Skip — intentionally omitted (explain why)
  3. Something else
```

**If option 1 chosen (or `autoMode` is active):**

- Read the schema: `dr schema node {layer}.{type}`
- Draft a table row following the format of existing rows in the skill:

  ```
  | **{TypeName}** | {description} | {key attributes} |
  ```

- If `autoMode`: insert immediately, log `[AUTO] ADDED row for {layer}.{type} to Entity Types table`
- Otherwise: show the draft, ask: "Insert this row? (yes / revise / skip)", insert on yes
- Log: `ADDED row for {layer}.{type} to Entity Types table`

**If option 2 chosen:**

- Ask: "What's the reason?" — record in the session log
- Log: `SKIPPED {layer}.{type} — {reason}`

---

#### 6-INVALID: Non-spec type name in example IDs

```
[INVALID {N}/{total}] '{type_segment}' is not a valid spec type

Found in example IDs:
  {list all IDs containing this type segment}

Valid spec types for the {layer} layer:
  {SPEC_TYPES list}

Common reclassification:
  {If 'framework' → suggest 'systemsoftware'}
  {If 'library' → suggest 'artifact'}
  {If 'stack' → suggest 'systemsoftware' or 'technologycollaboration'}
  {If 'tool' or 'cicd' → suggest 'technologyprocess'}
  {If 'runtime' → suggest 'systemsoftware' or 'node'}

Options:
  1. Replace all '{type_segment}' occurrences with correct spec type (Recommended)
  2. Remove the invalid example IDs
  3. Skip — leave for manual review
```

**If option 1 chosen (or `autoMode` is active):**

- If `autoMode`: use the suggested reclassification directly. If no suggestion can be determined (no entry in the common reclassification table), log `[AUTO] SKIPPED '{type_segment}' — no unambiguous reclassification; review manually` and move on.
- Otherwise: prompt "Replace with which spec type? (default: {suggested})", then show all proposed replacements and confirm before writing.
- Edit the SKILL.md, replacing each invalid type segment with the correct one in all example IDs.
- If `autoMode`: log `[AUTO] REPLACED '{type_segment}' → '{correct_type}' in {N} example IDs`
- Otherwise: log `REPLACED '{type_segment}' → '{correct_type}' in {N} example IDs`

**If option 2 chosen:**

- Show affected code blocks. Ask: "Remove these {N} example blocks? (yes / skip)"
- On yes: remove or trim the invalid examples
- Log: `REMOVED {N} invalid example IDs using '{type_segment}'`

---

#### 6-ID-FORMAT: Example ID with wrong type segment (combined with INVALID)

These are reported together with INVALID findings. No separate interactive step needed — resolving the INVALID type corrects all its ID FORMAT occurrences.

---

#### 6-SECTION: Structural section missing

```
[SECTION {N}/{total}] Missing: {section name}   [SEVERITY: high/medium]

This section is absent from the skill file.

Purpose: {brief description of what this section provides}
  - Type Decision Tree: unambiguous per-pattern rules for selecting entity types
  - Coverage Checklist: mandatory gate before declaring a layer complete
  - Common Misclassifications: explicit DO NOT rules with rationale
  - Detection Patterns: codebase-specific code examples mapped to entity types

Options:
  1. Add a starter section (Recommended for high severity)
  2. Skip — this layer doesn't need it (explain why)
  3. Something else
```

**If option 1 chosen:**

Generate a starter section template appropriate for the layer and section type:

**For Type Decision Tree** — generate a decision tree scaffold based on `SPEC_TYPES`:

```markdown
## Type Decision Tree

Use this decision tree **before assigning a type** to any code pattern.

{For each type in SPEC_TYPES, generate: "IS this a [description from schema]? → {layer}.{type}"}
```

**For Coverage Checklist** — generate a checkbox list of all `SPEC_TYPES`:

```markdown
## Coverage Completeness Checklist

Before declaring {layer} layer extraction complete, verify each type was considered:

{checkbox for each type in SPEC_TYPES with one-line description from schema}

If any type has ZERO elements, explicitly decide:
"This type doesn't apply to this codebase" with reasoning.
```

**For Common Misclassifications** — generate a scaffold table:

```markdown
## Common Misclassifications

| Misclassification | Correct Classification | Why       |
| ----------------- | ---------------------- | --------- |
| [fill in]         | [fill in]              | [fill in] |
```

**For Detection Patterns** — generate a placeholder:

```markdown
## Codebase Detection Patterns

> Add patterns here specific to the codebase being modeled.
> Each pattern should show a code snippet and the entity type(s) it maps to.
```

- If `autoMode` and severity is **high** (Type Decision Tree, Coverage Checklist): insert immediately without asking. Log `[AUTO] ADDED section: {section name}`.
- If `autoMode` and severity is **medium** (Common Misclassifications, Detection Patterns): skip without asking — these sections require codebase-specific knowledge. Log `[AUTO] SKIPPED section: {section name} — medium severity, requires manual authoring`.
- Otherwise: show the draft, ask: "Insert this section? (yes / revise / skip)", insert on yes.
- Insert after the existing section it logically follows (Entity Types → Decision Tree → Misclassifications → Patterns → Checklist).
- Log: `ADDED section: {section name}`

---

### STEP 7: Finalize

After all findings have been processed:

```
Review Complete {[AUTO MODE] if autoMode}
===============
Layer:    {layer}
Skill:    integrations/claude_code/skills/{skill_directory}/SKILL.md

Findings processed: {total}

Disposition:
  ✓ Fixed:          {count}  (types added, invalid IDs corrected, sections added)
  → Skipped:        {count}  (intentional, deferred, or medium-severity in auto mode)
  ⚠ Needs review:  {count}  (auto mode could not determine reclassification)

Files changed:
  {path if changed, or "none"}
```

If any changes were made to the SKILL.md, remind the maintainer:

```
Next steps:
  1. Review the changes: git diff integrations/claude_code/skills/{skill_directory}/SKILL.md
  2. If the skill is part of the claude integration package, reinstall:
     cd ./documentation_robotics/cli && npm run build
  3. Test an extraction using the updated skill to verify the guidance works as expected
```

---

## Reference: Skill File Structure

A well-formed layer skill file has these sections in order:

```
---
name: LAYER_{NN}_{LAYER}
description: ...
triggers: [...]
version: ...
---

# {Layer Name} Layer Skill

## Layer Overview
## Entity Types          ← must list ALL spec types; types match spec exactly
## Type Decision Tree    ← unambiguous per-pattern classification rules
## Common Misclassifications ← explicit DO NOT rules
## Intra-Layer Relationships
## Cross-Layer References
## Codebase Detection Patterns ← code snippets → entity type mappings
## Coverage Completeness Checklist ← checkbox per spec type
## Modeling Workflow
## Best Practices
## Validation Tips
## Quick Reference
```

Not all sections are mandatory for every layer (e.g., a simple layer may not need a Decision Tree). But for layers with many similar-looking entity types (application, technology, ux), the Decision Tree and Misclassifications sections are essential for correct extraction.
