# Build System Documentation

## Overview

The Documentation Robotics CLI uses a sophisticated **multi-stage code generation system** that converts JSON specification files into type-safe TypeScript code at build time. This document covers the build workflow, generator scripts, and how to maintain the build system.

**Key Principle:** Schemas are the single source of truth. All generated code is derived from specifications in `spec/layers/*.layer.json` and `spec/schemas/**/*.schema.json`.

## Table of Contents

1. [Build Workflow](#build-workflow)
2. [Generator Scripts](#generator-scripts)
3. [Schema Synchronization](#schema-synchronization)
4. [Generated Artifacts](#generated-artifacts)
5. [Build Variants](#build-variants)
6. [Troubleshooting](#troubleshooting)

---

## Build Workflow

### Sequential Build Process

The npm build command runs these steps in order:

```bash
npm run build
```

**Build Pipeline:**

```
1. Schema Sync (bash)
   ↓
2. Registry Generation (TypeScript/Bun)
   ↓
3. Validator Generation (TypeScript/Bun)
   ↓
4. TypeScript Compilation (tsc)
   ↓
5. Bundling (esbuild)
   ↓
6. Copy Schemas to dist/
```

### Why Sequential?

Each stage depends on the previous:

- **Stage 1** (Schema Sync) copies spec schemas to `cli/src/schemas/bundled/` so stages 2-3 can read them
- **Stages 2-3** (Generators) read bundled schemas and produce TypeScript output that stage 4 compiles
- **Stage 4** (tsc) compiles all TypeScript including generated files to `dist/`
- **Stage 5** (esbuild) bundles the compiled output
- **Stage 6** (Copy Schemas) ensures schemas are packaged in the distribution

### Build Times

- **Schema Sync:** ~50ms
- **Registry Generation:** ~200ms
- **Validator Generation:** ~500ms
- **TypeScript Compilation:** ~2-3s
- **Bundling:** ~1s
- **Copy Schemas:** ~200ms
- **Total:** ~4-5 seconds

---

## Generator Scripts

### 1. Schema Synchronization: `sync-spec-schemas.sh`

**Location:** `/workspace/cli/scripts/sync-spec-schemas.sh`

**Purpose:** Copies specification schemas from `spec/` to `cli/src/schemas/bundled/` so generators can access them.

**Run During:** First step of `npm run build`

**Copies:**

```
spec/schemas/base/
  → cli/src/schemas/bundled/base/
    (base schemas used by all validators)

spec/schemas/nodes/
  → cli/src/schemas/bundled/nodes/
    (354 per-type node schemas organized by layer)

spec/schemas/relationships/
  → cli/src/schemas/bundled/relationships/
    (252 per-type relationship schemas)

spec/layers/*.layer.json
  → cli/src/schemas/bundled/layers/
    (12 layer instance files)
```

**Why Not Reference Spec Directly?**

1. **Build Isolation** - CLI builds independently of spec changes
2. **Bundling** - Schemas are packaged in the distributed CLI
3. **Performance** - Copy is faster than symbolic links during development
4. **Portability** - Extracted CLI npm package has complete schemas

**Manual Usage:**

```bash
npm run sync-schemas
```

---

### 2. Registry Generation: `generate-registry.ts`

**Location:** `/workspace/cli/scripts/generate-registry.ts`

**Purpose:** Generates TypeScript code that provides compile-time type safety for the 12 layers, 354 node types, and 252 relationships.

**Run During:** Second step of `npm run build`

**Inputs:**

```
cli/src/schemas/bundled/layers/*.layer.json
  ↓ (reads layer definitions)

cli/src/schemas/bundled/nodes/**/*.node.schema.json
  ↓ (extracts node type metadata)

cli/src/schemas/bundled/relationships/**/*.relationship.schema.json
  ↓ (extracts relationship specifications)
```

**Outputs:**

```
cli/src/generated/
├── layer-registry.ts       # LayerMetadata, LAYERS map, layer lookup functions
├── node-types.ts          # NodeTypeInfo, NODE_TYPES map, node type unions
├── relationship-index.ts  # RelationshipSpec, RELATIONSHIPS map
├── layer-types.ts         # LayerId union type (12 valid layers)
└── index.ts              # Barrel export
```

#### Layer Registry (`layer-registry.ts`)

```typescript
interface LayerMetadata {
  id: string;                    // "motivation", "data-store", etc.
  number: number;               // 1-12
  name: string;                 // "Motivation Layer"
  description: string;          // Layer description from spec
  nodeTypes: string[];         // ["motivation.goal", "motivation.requirement", ...]
  inspiredBy?: {
    standard: string;           // "ArchiMate 3.2"
    version: string;
    url?: string;
  };
}

// Generated exports
export const LAYERS: Map<string, LayerMetadata>;
export const LAYER_HIERARCHY: number[];  // [1, 2, 3, ..., 12]

export function getLayerById(id: string): LayerMetadata | undefined;
export function getLayerByNumber(n: number): LayerMetadata | undefined;
export function isValidLayer(id: string): boolean;
export function getAllLayerIds(): string[];
export function getNodeTypesForLayer(layerId: string): string[];
```

#### Node Type Index (`node-types.ts`)

```typescript
interface NodeTypeInfo {
  specNodeId: string;              // "motivation.goal"
  layer: string;                   // "motivation"
  type: string;                    // "goal"
  title: string;                   // "Goal" (from schema $id)
  requiredAttributes: string[];    // From schema required[]
  optionalAttributes: string[];    // From schema properties keys
  attributeConstraints: Record<string, unknown>; // Min/max lengths, patterns, etc.
}

// Generated exports
export const NODE_TYPES: Map<SpecNodeId, NodeTypeInfo>;
export type SpecNodeId = "motivation.goal" | "motivation.requirement" | ...; // All 354
export type LayerId = "motivation" | "business" | ...; // All 12
export type NodeType = "goal" | "requirement" | ...; // Unique types

export function getNodeType(specNodeId: SpecNodeId): NodeTypeInfo | undefined;
export function getNodeTypesForLayer(layer: LayerId): NodeTypeInfo[];
export function isValidNodeType(specNodeId: string): boolean;
```

#### Relationship Index (`relationship-index.ts`)

```typescript
interface RelationshipSpec {
  id: string;                      // "motivation:supports"
  sourceSpecNodeId: string;        // "motivation.goal"
  destinationSpecNodeId: string;   // "motivation.requirement"
  predicate: string;               // "supports"
  cardinality: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  strength: "critical" | "high" | "medium" | "low";
  required: boolean;
}

export const RELATIONSHIPS: Map<string, RelationshipSpec>;
export function getRelationship(id: string): RelationshipSpec | undefined;
export function getRelationshipsFrom(sourceSpecNodeId: string): RelationshipSpec[];
export function getRelationshipsTo(destinationSpecNodeId: string): RelationshipSpec[];
```

**Command-Line Options:**

```bash
# Standard generation
bun scripts/generate-registry.ts

# Strict mode (fails on duplicate relationship IDs) - used in CI
bun scripts/generate-registry.ts --strict

# Quiet mode (suppresses debug output)
bun scripts/generate-registry.ts --quiet

# Both
bun scripts/generate-registry.ts --strict --quiet
```

**Validation Performed:**

- ✅ Exactly 12 layers found in `spec/layers/*.layer.json`
- ✅ All node types properly formatted (layer.type)
- ✅ All relationship schemas have required fields
- ✅ (In strict mode) No duplicate relationship IDs

---

### 3. Validator Generation: `generate-validators.ts`

**Location:** `/workspace/cli/scripts/generate-validators.ts`

**Purpose:** Pre-compiles AJV JSON schema validators at build time to eliminate runtime schema loading overhead.

**Run During:** Third step of `npm run build`

**Inputs:**

```
cli/src/schemas/bundled/base/spec-node.schema.json
  → Pre-compile for element validation

cli/src/schemas/bundled/base/spec-node-relationship.schema.json
  → Pre-compile for relationship validation

cli/src/schemas/bundled/base/source-references.schema.json
  → Pre-compile for provenance tracking

cli/src/schemas/bundled/base/attribute-spec.schema.json
  → Pre-compile for attribute definitions
```

**Output:**

```
cli/src/generated/compiled-validators.ts
```

**Generated Code Structure:**

```typescript
import Ajv from "ajv";

const ajv = new Ajv();

// Pre-compiled validators for each base schema
export const validators = {
  specNode: ajv.compile(/* spec-node.schema.json */),
  specNodeRelationship: ajv.compile(/* spec-node-relationship.schema.json */),
  sourceReferences: ajv.compile(/* source-references.schema.json */),
  attributeSpec: ajv.compile(/* attribute-spec.schema.json */),
};

// Performance: ~10-100x faster than loading schemas at runtime
```

**Why Pre-compile?**

1. **Startup Performance** - Validators ready immediately at runtime
2. **Reduced Memory** - No schema parsing at startup
3. **Build Verification** - Schema syntax errors caught at build time, not runtime
4. **Production Efficiency** - No runtime JSON schema parsing

**Build-Time Schema Validation:**

If a schema has syntax errors, the build fails immediately with clear error messages:

```bash
$ npm run build
...
Error: Failed to compile schema for spec-node.schema.json
ReferenceError: Invalid schema reference at line 45
```

---

## Schema Synchronization

### Why Separate Sync Step?

The `sync-spec-schemas.sh` script is a dedicated first build step because:

1. **Source of Truth Clarity** - Spec owns schemas; CLI is consumer
2. **Clean Separation** - CLI build is independent of spec state
3. **Atomic Updates** - All schemas synced before any code generation
4. **Version Alignment** - Ensures CLI schema version matches spec at build time

### Sync Direction (One-way)

```
spec/schemas/  → (copy)  → cli/src/schemas/bundled/
spec/layers/   → (copy)  → cli/src/schemas/bundled/layers/
```

**NOT the other way around.** Changes to `cli/src/schemas/bundled/` are overwritten during the next build.

### Manual Schema Sync

```bash
# Sync all schemas without rebuilding
npm run sync-schemas

# Verify schemas synced correctly
ls cli/src/schemas/bundled/layers/
ls cli/src/schemas/bundled/nodes/
ls cli/src/schemas/bundled/relationships/
```

---

## Generated Artifacts

### What's Generated vs. Hand-Written

**Generated (auto-updated during build):**

- `cli/src/generated/layer-registry.ts` - From `spec/layers/*.layer.json`
- `cli/src/generated/node-types.ts` - From `spec/schemas/nodes/**/*.node.schema.json`
- `cli/src/generated/relationship-index.ts` - From `spec/schemas/relationships/**/*.relationship.schema.json`
- `cli/src/generated/layer-types.ts` - Union types for layer IDs
- `cli/src/generated/compiled-validators.ts` - Pre-compiled AJV validators
- `cli/src/generated/index.ts` - Barrel export

**Hand-Written (do not edit generated files, edit source instead):**

- `spec/layers/*.layer.json` - Layer definitions
- `spec/schemas/nodes/**/*.node.schema.json` - Node type definitions
- `spec/schemas/relationships/**/*.relationship.schema.json` - Relationship definitions
- `cli/src/validators/schema-validator.ts` - Uses generated validators
- `cli/src/commands/schema.ts` - Uses generated registries

### When to Rebuild

**Auto-rebuild needed when:**

- ✅ `npm run build` is run (part of development workflow)
- ✅ CI runs tests or builds distribution
- ✅ Package is installed from npm (prebuild hook)

**Manual rebuild if:**

- ⚠️ You modify `spec/layers/*.layer.json` directly (should not do this)
- ⚠️ You add/modify schemas in `spec/schemas/` without using CLI commands
- ⚠️ You see "out of sync" error messages

### Validation

Generated files should always match current spec. If they don't:

```bash
# Check if rebuild is needed
npm run build

# Verify no changes are pending
git status

# If files changed, they're now synced
```

---

## Build Variants

### Standard Build

```bash
npm run build
```

Runs all stages with default settings. Used in:
- Local development
- Pre-release testing

### Debug Build

```bash
npm run build:debug
```

Sets `DR_TELEMETRY=true` environment variable for additional debug output during bundling.

**Use when:**
- Debugging bundle configuration
- Investigating performance issues
- Understanding code generation

### CI Build

```bash
npm run build:ci
```

Uses `--strict` flag for registry generation that:
- Fails if any duplicate relationship IDs exist
- Enables stricter validation for production safety

**Used in:**
- `.github/workflows/cli-tests.yml`
- GitHub CI pipeline (required for merge)

**Key Difference from Standard:**

```bash
# Standard
bun scripts/generate-registry.ts

# CI (strict)
bun scripts/generate-registry.ts --strict
```

---

## Troubleshooting

### Problem: "Schema files not found during generation"

**Cause:** Schema sync didn't run or failed

**Solution:**

```bash
# Run sync manually
npm run sync-schemas

# Verify schemas exist
ls cli/src/schemas/bundled/layers/
# Should list: 01-motivation.layer.json, 02-business.layer.json, ... 12-testing.layer.json

ls cli/src/schemas/bundled/nodes/
# Should show directories: motivation/, business/, security/, etc.

# Then rebuild
npm run build
```

### Problem: "Build failed: Unexpected layer count"

**Cause:** Layer instance files missing or not all 12 present

**Solution:**

```bash
# Check layer count
ls spec/layers/*.layer.json | wc -l
# Should output: 12

# Look for missing files
for i in {01..12}; do
  if [ ! -f "spec/layers/$i-*.layer.json" ]; then
    echo "Missing layer $i"
  fi
done

# If files are missing, restore them from git
git restore spec/layers/
npm run build
```

### Problem: "Duplicate relationship ID error (strict mode)"

**Cause:** Two relationship schemas have the same `id` field

**Solution:**

```bash
# Find the duplicate
grep -r "\"id\":" spec/schemas/relationships/ | grep "duplicate-value"

# Edit the problematic schema file and change the id
vi spec/schemas/relationships/layer-name/relationship-id.relationship.schema.json

# Verify uniqueness
grep -r "\"id\":" spec/schemas/relationships/ | sort | uniq -d
# Should output nothing if all IDs are unique

npm run build
```

### Problem: "Schema validation failed in build"

**Cause:** A schema file has invalid JSON schema syntax

**Solution:**

```bash
# The error message shows which file failed
# Example: "Error: Failed to compile schema for spec-node.schema.json"

# Check the file syntax
cat cli/src/schemas/bundled/base/spec-node.schema.json | jq .

# Check for common issues:
# - Missing quotes on property names
# - Unclosed braces or brackets
# - Invalid JSON schema keywords

# Fix the schema, then rebuild
npm run build
```

### Problem: "Generated files are out of sync"

**Cause:** Generated files don't match current spec

**Solution:**

```bash
# Rebuild to sync
npm run build

# Check what changed
git diff cli/src/generated/

# If changes look correct, they're now synced
git add cli/src/generated/
git commit -m "Sync generated files with spec"
```

### Problem: "Build succeeds but validation fails at runtime"

**Cause:** Generated validators don't match actual schema content

**Solution:**

```bash
# Rebuild with debug info
npm run build:debug

# Check validator compilation errors in output
# They'll indicate which schema failed to compile

# Verify the schema file exists and is readable
ls -la cli/src/schemas/bundled/base/*.schema.json

# Rebuild
npm run build
```

---

## Development Workflow

### Adding a New Layer

The system currently validates exactly 12 layers. To add a new layer (future expansion):

1. Create layer instance: `spec/layers/13-new-layer.layer.json`
2. Update generator: Change `EXPECTED_LAYER_COUNT = 13` in `generate-registry.ts`
3. Create node schemas: `spec/schemas/nodes/new-layer/*.node.schema.json`
4. Create relationship schemas: `spec/schemas/relationships/new-layer/*.relationship.schema.json`
5. Rebuild: `npm run build`

### Adding a New Node Type

1. Create schema: `spec/schemas/nodes/{layer}/{type}.node.schema.json`
   - Must extend `spec-node.schema.json` via `allOf`
   - Must define `id` matching `{layer}.{type}`
2. Register type in layer: Add to `node_types[]` in `spec/layers/{layer}.layer.json`
3. Rebuild: `npm run build`
4. Generator creates `NodeTypeInfo` entries automatically

### Modifying a Node Type Schema

1. Edit: `spec/schemas/nodes/{layer}/{type}.node.schema.json`
2. Rebuild: `npm run build`
3. Generator updates `NodeTypeInfo` with new attributes/constraints
4. TypeScript compiler ensures compatibility with existing code

### Adding a New Relationship Type

1. Create schema: `spec/schemas/relationships/{layer}/{type}.relationship.schema.json`
   - Must extend `spec-node-relationship.schema.json` via `allOf`
   - Must define `id`, `source_spec_node_id`, `destination_spec_node_id`, `predicate`
2. Rebuild: `npm run build`
3. Generator creates `RelationshipSpec` entry automatically

---

## Performance Characteristics

### Build Time Impact

| Stage | Time | Notes |
|-------|------|-------|
| Schema Sync | ~50ms | Shell script, copies files |
| Registry Gen | ~200ms | Reads 12 layers + 354 node schemas |
| Validator Gen | ~500ms | Compiles AJV validators |
| TypeScript | ~2-3s | Main compilation time |
| Bundling | ~1s | esbuild optimization |
| Copy Schemas | ~200ms | Copies to dist/ |
| **Total** | **~4-5s** | Incremental builds are faster |

### Runtime Performance

Generated code provides:

- **Layer Lookup:** O(1) via Map (vs. O(n) array search)
- **Node Type Lookup:** O(1) via Map (vs. O(n) scan)
- **Relationship Lookup:** O(1) via Map (vs. linear search)
- **Validation:** Pre-compiled validators eliminate schema parsing overhead

### Bundle Size Impact

Generated files are tree-shakeable:

- `layer-registry.ts` + exports: ~15KB (minified)
- `node-types.ts` + exports: ~45KB (minified)
- `relationship-index.ts` + exports: ~35KB (minified)
- **Total:** ~95KB added (typical CLI bundle: ~500KB)

---

## See Also

- [Schema-Driven Architecture Guide](CLI_SCHEMA_DRIVEN_ARCHITECTURE.md)
- [CLI README - Build Section](../cli/README.md#building)
- [Contributing Guide](COLLABORATION_GUIDE.md)
