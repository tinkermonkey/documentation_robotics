# Generator Scripts Usage Guide

## Overview

The Documentation Robotics CLI includes three build-time generator scripts that convert JSON specifications into type-safe TypeScript code. This guide covers how to use, understand, and extend these generators.

**Quick Reference:**

| Script | Purpose | Input | Output |
|--------|---------|-------|--------|
| `sync-spec-schemas.sh` | Copy schemas from spec/ to CLI | Spec schema files | `cli/src/schemas/bundled/` |
| `generate-registry.ts` | Generate layer & node type metadata | Layer and schema files | `cli/src/generated/*.ts` |
| `generate-validators.ts` | Pre-compile AJV validators | Base schemas | `cli/src/generated/compiled-validators.ts` |

## Table of Contents

1. [Quick Start](#quick-start)
2. [Running Generators](#running-generators)
3. [Schema Synchronization](#schema-synchronization-sync-spec-schemashshtml)
4. [Registry Generation](#registry-generation-generate-registryts)
5. [Validator Generation](#validator-generation-generate-validatorsts)
6. [Common Use Cases](#common-use-cases)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Standard Workflow

```bash
# 1. Make changes to spec files (e.g., add new node type)
vi spec/layers/01-motivation.layer.json

# 2. Rebuild the CLI (runs all generators)
npm run build

# 3. Verify generated files are updated
git status
# Shows changes in cli/src/generated/

# 4. Commit generated files
git add cli/src/generated/
git commit -m "Update generated files after spec changes"
```

### One-Time Generator Runs

```bash
# Run just the schema sync step
npm run sync-schemas

# Run entire build
npm run build

# Run with debug output
npm run build:debug

# Run with strict validation (CI mode)
npm run build:ci
```

---

## Running Generators

### Via npm Scripts

**Recommended for development:**

```bash
# Full build (all generators + TypeScript + bundling)
npm run build

# Schema sync only (no code generation)
npm run sync-schemas

# Debug build (with telemetry output)
npm run build:debug

# CI build (strict validation mode)
npm run build:ci
```

### Direct Bun Execution

For development or debugging:

```bash
cd cli

# Registry generation
bun scripts/generate-registry.ts
bun scripts/generate-registry.ts --strict
bun scripts/generate-registry.ts --quiet

# Validator generation
bun scripts/generate-validators.ts
bun scripts/generate-validators.ts --quiet

# Schema sync (bash, not Bun)
bash scripts/sync-spec-schemas.sh
```

### Manual Schema Sync

```bash
# Sync all schemas
bash cli/scripts/sync-spec-schemas.sh

# Or using npm
npm run sync-schemas

# Verify sync worked
ls cli/src/schemas/bundled/layers/ | wc -l
# Should show 12 files
```

---

## Schema Synchronization: `sync-spec-schemas.sh`

### What It Does

Copies specification schemas from `spec/` to `cli/src/schemas/bundled/` so generators can access them.

```
spec/
├── layers/
│   ├── 01-motivation.layer.json
│   ├── 02-business.layer.json
│   └── ... (12 total)
├── schemas/
│   ├── base/
│   │   ├── spec-node.schema.json
│   │   ├── spec-node-relationship.schema.json
│   │   ├── attribute-spec.schema.json
│   │   └── source-references.schema.json
│   ├── nodes/
│   │   ├── motivation/
│   │   │   ├── goal.node.schema.json
│   │   │   └── ...
│   │   └── ... (12 layers)
│   └── relationships/
│       ├── motivation/
│       │   └── ...
│       └── ... (12 layers)
└── relationship-catalog.json
                    ↓ (copied to)

cli/src/schemas/bundled/
├── base/
├── nodes/
├── relationships/
└── layers/
```

### When It Runs

- First step of `npm run build`
- Can be run manually with `npm run sync-schemas`
- Required before registry/validator generation

### Why Synchronization?

1. **Isolation** - CLI builds independently after sync
2. **Distribution** - Synced schemas are bundled in published npm package
3. **Clarity** - Explicit sync step shows spec → CLI dependency
4. **Performance** - Copy is simple and fast

### Manual Run

```bash
# Run sync manually
npm run sync-schemas

# Or directly with bash
bash cli/scripts/sync-spec-schemas.sh

# Verify it worked
find cli/src/schemas/bundled -type f | wc -l
# Should show many schema files
```

### What Gets Copied

```bash
# Base schemas (4 files)
cp spec/schemas/base/*.schema.json cli/src/schemas/bundled/base/

# Node schemas (354 files across 12 layers)
cp -r spec/schemas/nodes/* cli/src/schemas/bundled/nodes/

# Relationship schemas (252 files across 12 layers)
cp -r spec/schemas/relationships/* cli/src/schemas/bundled/relationships/

# Layer instances (12 files)
cp spec/layers/*.layer.json cli/src/schemas/bundled/layers/
```

### Troubleshooting

**Problem:** Script fails with "permission denied"

```bash
# Make script executable
chmod +x cli/scripts/sync-spec-schemas.sh

# Then retry
npm run sync-schemas
```

**Problem:** Schemas not copied

```bash
# Check if spec schemas exist
ls spec/layers/ | head
ls spec/schemas/base/ | head

# Run sync with verbose output (modify script if needed)
bash -x cli/scripts/sync-spec-schemas.sh

# Check destination
ls cli/src/schemas/bundled/layers/ | wc -l
# Should show 12
```

---

## Registry Generation: `generate-registry.ts`

### What It Does

Generates TypeScript code providing compile-time access to:

- **12 Layer Metadata** - Layer numbers, names, descriptions, node types
- **354 Node Types** - Type definitions with required/optional attributes
- **252 Relationships** - Valid source→destination connections, cardinality, strength

### Generated Files

```
cli/src/generated/
├── layer-registry.ts          # LayerMetadata, LAYERS map, layer functions
├── node-types.ts             # NodeTypeInfo, NODE_TYPES map, type unions
├── relationship-index.ts     # RelationshipSpec, RELATIONSHIPS map
├── layer-types.ts            # LayerId union type
└── index.ts                  # Barrel export
```

### Input Files

```bash
# Reads from:
cli/src/schemas/bundled/layers/*.layer.json           # 12 files
cli/src/schemas/bundled/nodes/**/*.node.schema.json   # 354 files
cli/src/schemas/bundled/relationships/**/*.relationship.schema.json  # 252 files
```

### Running Registry Generation

```bash
# As part of build
npm run build

# Manual run (requires schema sync first)
npm run sync-schemas
bun cli/scripts/generate-registry.ts

# With options
bun cli/scripts/generate-registry.ts --strict      # Fail on duplicate IDs
bun cli/scripts/generate-registry.ts --quiet       # Suppress output
bun cli/scripts/generate-registry.ts --strict --quiet
```

### Generated Code Examples

#### Layer Registry

```typescript
import { getLayerById, getAllLayerIds } from "../generated/layer-registry.js";

// Get layer metadata
const motivation = getLayerById("motivation");
console.log(`${motivation.number}: ${motivation.name}`);
// Output: 1: Motivation Layer

// List all valid layer IDs
const layerIds = getAllLayerIds();
console.log(layerIds);
// Output: ["motivation", "business", "security", ..., "testing"]

// Get node types for a layer
const nodeTypes = getNodeTypesForLayer("motivation");
console.log(nodeTypes);
// Output: ["motivation.goal", "motivation.requirement", ...]
```

#### Node Type Index

```typescript
import { getNodeType, NODE_TYPES } from "../generated/node-types.js";

// Get node type metadata
const goal = getNodeType("motivation.goal");
console.log(goal.title);          // "Goal"
console.log(goal.requiredAttributes);  // ["name", "description", ...]
console.log(goal.optionalAttributes);  // ["source", "status", ...]

// Iterate all node types
for (const [specNodeId, nodeType] of NODE_TYPES.entries()) {
  console.log(`${specNodeId}: ${nodeType.title}`);
}
```

#### Relationship Index

```typescript
import { getRelationship, getRelationshipsFrom } from "../generated/relationship-index.js";

// Get relationship spec
const rel = getRelationship("motivation:supports");
console.log(rel.source);              // "motivation.goal"
console.log(rel.destination);         // "motivation.requirement"
console.log(rel.cardinality);         // "one-to-many"

// Find relationships from a node type
const outgoing = getRelationshipsFrom("motivation.goal");
outgoing.forEach(r => {
  console.log(`${r.source} --${r.predicate}--> ${r.destination}`);
});
```

### Options

#### `--strict`

Fails the build if any duplicate relationship IDs are found.

```bash
# Standard mode (logs warnings, continues)
bun cli/scripts/generate-registry.ts

# Strict mode (fails on first duplicate)
bun cli/scripts/generate-registry.ts --strict

# Used in CI to enforce uniqueness
npm run build:ci
```

**Output with duplicates:**

```
Error: Duplicate relationship ID found: "motivation:conflicts"
  - File: spec/schemas/relationships/motivation/conflicts-1.relationship.schema.json
  - File: spec/schemas/relationships/motivation/conflicts-2.relationship.schema.json
Build failed.
```

#### `--quiet`

Suppresses debug output. Useful in CI pipelines.

```bash
# With debug output
bun cli/scripts/generate-registry.ts
# Output: "Generating layer registry from 12 layer files..."

# Quiet (no output unless error)
bun cli/scripts/generate-registry.ts --quiet
```

### Output Format

The generator produces human-readable TypeScript with JSDoc comments:

```typescript
/**
 * Layer metadata registry
 * Generated from spec/layers/*.layer.json at build time
 * Do not edit manually - regenerate via `npm run build`
 */

interface LayerMetadata {
  /** Canonical layer ID (e.g., "motivation", "data-store") */
  id: string;

  /** Layer number in architecture (1-12) */
  number: number;

  /** Human-readable layer name */
  name: string;

  // ... more fields documented
}

export const LAYERS = new Map<string, LayerMetadata>();
// Populated with 12 entries at generation time
```

### Performance

```bash
# Time the generator
time bun cli/scripts/generate-registry.ts
# real: 0.2s
# Reads 366 schema files, generates 5 outputs
```

### Troubleshooting

**Problem:** "Expected 12 layers, found 11"

```bash
# Check layer files
ls spec/layers/*.layer.json | wc -l
# Should output 12

# Look for naming issues
ls spec/layers/ | grep -v "^[0-9][0-9]-"
# Should be empty

# Restore missing layers
git status spec/layers/
git restore spec/layers/

# Retry
npm run build
```

**Problem:** Relationship ID conflicts (with --strict)

```bash
# Find duplicate IDs
grep -h '"id"' spec/schemas/relationships/**/*.relationship.schema.json | sort | uniq -d

# Edit conflicting files
vi spec/schemas/relationships/layer-name/file1.relationship.schema.json
vi spec/schemas/relationships/layer-name/file2.relationship.schema.json

# Change one of the duplicate IDs to be unique

# Retry with strict
npm run build:ci
```

---

## Validator Generation: `generate-validators.ts`

### What It Does

Pre-compiles AJV JSON schema validators at build time for use at runtime, eliminating the need to parse and compile schemas during CLI execution.

### Why Pre-compile?

1. **Performance** - Validators ready instantly, no schema parsing at startup
2. **Reliability** - Schema errors caught at build time, not runtime
3. **Reduced Size** - Pre-compiled validators are smaller than schemas + AJV

### Input Files

```bash
# Compiles validators for base schemas:
cli/src/schemas/bundled/base/spec-node.schema.json
cli/src/schemas/bundled/base/spec-node-relationship.schema.json
cli/src/schemas/bundled/base/source-references.schema.json
cli/src/schemas/bundled/base/attribute-spec.schema.json
```

### Generated Output

```
cli/src/generated/compiled-validators.ts
```

Contains pre-compiled AJV validator functions.

### Running Validator Generation

```bash
# As part of build
npm run build

# Manual run (requires schema sync first)
npm run sync-schemas
bun cli/scripts/generate-validators.ts

# With options
bun cli/scripts/generate-validators.ts --quiet
```

### How Validators Are Used

At runtime, the CLI imports pre-compiled validators:

```typescript
import { validators } from "../generated/compiled-validators.js";

// Validate an element
const isValid = validators.specNode(elementData);

if (!isValid) {
  console.log("Validation errors:", validators.specNode.errors);
}
```

### Build-Time Validation

If a schema has syntax errors, the build fails immediately:

```bash
$ npm run build
...
Step 3: Validator Generation
Error: Schema compilation failed: spec-node.schema.json
  Invalid schema: "$ref" target not found at line 45

Build failed.
```

### Generated Code Structure

```typescript
/**
 * Pre-compiled AJV validators
 * Generated from base schemas at build time
 * Do not edit manually - regenerate via `npm run build`
 */

import Ajv from "ajv";

const ajv = new Ajv({
  strict: true,           // Reject undefined keywords
  validateSchema: true,   // Validate schemas themselves
  coerceTypes: false,    // Don't coerce types
  useDefaults: false,    // Don't apply defaults
});

// Pre-compiled validator for spec-node.schema.json
const specNodeValidator = ajv.compile(/* ... */);

// Pre-compiled validator for spec-node-relationship.schema.json
const specNodeRelationshipValidator = ajv.compile(/* ... */);

// Pre-compiled validator for source-references.schema.json
const sourceReferencesValidator = ajv.compile(/* ... */);

// Pre-compiled validator for attribute-spec.schema.json
const attributeSpecValidator = ajv.compile(/* ... */);

export const validators = {
  specNode: specNodeValidator,
  specNodeRelationship: specNodeRelationshipValidator,
  sourceReferences: sourceReferencesValidator,
  attributeSpec: attributeSpecValidator,
};
```

### Performance Characteristics

```bash
# Build-time cost
$ time bun cli/scripts/generate-validators.ts
real: 0.5s
# Compiles 4 schemas

# Runtime benefit
# Pre-compiled validators: ~1ms per validation
# vs.
# Schema parsing + compilation: ~50-100ms on first validation
```

### Troubleshooting

**Problem:** Build fails with schema compilation error

```bash
# Error message shows which schema failed
# Example: "Error: Failed to compile schema for spec-node.schema.json"

# Check the schema file syntax
cat cli/src/schemas/bundled/base/spec-node.schema.json | jq .

# Look for common JSON errors:
# - Missing quotes on keys
# - Unclosed braces
# - Invalid escape sequences
# - Circular $ref references

# Fix the schema
vi cli/src/schemas/bundled/base/spec-node.schema.json

# Retry build
npm run build
```

**Problem:** Validation fails at runtime with "validator not found"

```bash
# Check that validators are imported correctly
grep "import.*validators" cli/src/validators/schema-validator.ts

# Rebuild to regenerate
npm run build

# Check generated validators file exists
ls -la cli/src/generated/compiled-validators.ts
```

---

## Common Use Cases

### Use Case 1: Adding a New Node Type

**Steps:**

1. Create schema for the new node type
2. Add to layer's node_types list
3. Rebuild

**Example:**

```bash
# 1. Create new node type schema
cat > spec/schemas/nodes/motivation/objective.node.schema.json << 'EOF'
{
  "allOf": [
    { "$ref": "../../../base/spec-node.schema.json" },
    {
      "type": "object",
      "properties": {
        "id": { "const": "motivation.objective" },
        "title": { "const": "Objective" },
        "node_type": { "const": "objective" }
      },
      "required": ["id", "title", "node_type"]
    }
  ]
}
EOF

# 2. Register in layer instance
# Edit spec/layers/01-motivation.layer.json
# Add "motivation.objective" to node_types array

# 3. Rebuild (runs sync + registry generation)
npm run build

# 4. Verify generated
grep "motivation.objective" cli/src/generated/node-types.ts
```

### Use Case 2: Modifying Node Type Attributes

**Steps:**

1. Edit the node type schema
2. Rebuild

**Example:**

```bash
# 1. Edit node type schema
vi spec/schemas/nodes/motivation/goal.node.schema.json

# 2. Update required fields (shown in generated NodeTypeInfo)
# Change: "required": ["name", "description"]
#    to: "required": ["name", "description", "priority"]

# 3. Rebuild
npm run build

# 4. Verify changes
grep -A 5 "motivation.goal" cli/src/generated/node-types.ts
```

### Use Case 3: Verifying Schema Consistency

**Steps:**

1. Sync schemas
2. Run registry generation
3. Check for errors

**Example:**

```bash
# 1. Sync all schemas
npm run sync-schemas

# 2. Generate with strict mode (catches duplicates)
npm run build:ci

# 3. If strict mode passes, schemas are consistent
echo "✓ All schemas consistent"
```

### Use Case 4: Rebuilding After Schema Changes

**Steps:**

1. Make schema changes
2. Rebuild entire project
3. Run tests

**Example:**

```bash
# 1. Make changes to spec files
# (edit spec/schemas/ or spec/layers/)

# 2. Rebuild
npm run build

# 3. Type-check for errors
npm run lint

# 4. Run tests
npm run test

# 5. If all pass, generated files are correct
```

---

## Troubleshooting

### Build Stops With Schema Errors

**Problem:** Build fails during schema sync or generation

**Solution:**

```bash
# 1. Check which step failed
npm run build 2>&1 | head -50
# Look for first error message

# 2. If schema sync failed
npm run sync-schemas

# 3. Verify source schemas exist and are valid
ls -la spec/layers/
ls -la spec/schemas/base/

# 4. Check for permission issues
chmod +x cli/scripts/sync-spec-schemas.sh

# 5. Retry build
npm run build
```

### Generated Files Won't Update

**Problem:** Generated files don't reflect schema changes

**Solution:**

```bash
# 1. Force rebuild (clears any caches)
rm -rf cli/src/generated/
npm run build

# 2. Check schema changes were synced
npm run sync-schemas

# 3. Compare spec and bundled schemas
diff -r spec/schemas/base cli/src/schemas/bundled/base/

# 4. If different, schemas didn't sync
npm run sync-schemas
npm run build
```

### Performance Issues

**Problem:** Build takes too long

**Solution:**

```bash
# 1. Check build times
npm run build
# Look for which step is slow

# 2. Time individual generators
time npm run sync-schemas      # Should be ~50ms
time bun cli/scripts/generate-registry.ts      # Should be ~200ms
time bun cli/scripts/generate-validators.ts    # Should be ~500ms

# 3. If generator is slow:
# - Check if you have 354 node schemas and 252 relationship schemas
# - Verify no large files in bundled schema directories
find cli/src/schemas/bundled -type f -exec wc -l {} + | sort -n | tail -20
```

### Validation Errors in Strict Mode

**Problem:** Build fails with `--strict` flag

**Solution:**

```bash
# Find the conflicting IDs
grep -rh '"id"' spec/schemas/relationships/ --include="*.schema.json" | sort | uniq -c | grep -v "^ *1 "

# Edit the files with duplicates
vi spec/schemas/relationships/layer-name/file1.relationship.schema.json
vi spec/schemas/relationships/layer-name/file2.relationship.schema.json

# Make IDs unique

# Verify
grep -rh '"id"' spec/schemas/relationships/ --include="*.schema.json" | sort | uniq -c | grep -v "^ *1 " | wc -l
# Should output 0

# Retry
npm run build:ci
```

---

## Next Steps

- [Build System Documentation](BUILD_SYSTEM.md) - Deep dive into the build workflow
- [CLI Schema-Driven Architecture](CLI_SCHEMA_DRIVEN_ARCHITECTURE.md) - How generated code is used
- [Contributing Guide](COLLABORATION_GUIDE.md) - Contributing changes to generators
