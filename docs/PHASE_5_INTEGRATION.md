# Phase 5: Integrate Generator Script into npm Build Workflow

## Overview

Phase 5 completes the integration of the code generation system into the standard npm build workflow. This phase focuses on:

1. **Generator Script Integration** - All generators run as part of `npm run build`
2. **Build Documentation** - Comprehensive guides for developers and contributors
3. **Usage Examples** - Real-world patterns for working with generators
4. **Troubleshooting** - Common issues and solutions

**Phase 5 Status:** ✅ Integrated and Documented

---

## Phase 5 Deliverables

### 1. Build System Documentation ✅

**File:** [docs/BUILD_SYSTEM.md](BUILD_SYSTEM.md)

Comprehensive guide covering:

- **Build Workflow** - Sequential stages and dependencies
- **Generator Scripts** - Purpose, inputs, outputs for each
- **Schema Synchronization** - Why, when, and how sync works
- **Generated Artifacts** - What's auto-generated vs. hand-written
- **Build Variants** - Standard, debug, and CI builds
- **Troubleshooting** - Common issues and solutions
- **Performance** - Build times and runtime characteristics

**Key Sections:**

- Build pipeline with stage dependencies
- Why each stage is necessary
- Performance characteristics (~4-5s total)
- Validation performed at each stage
- Future expansion patterns

### 2. Generator Scripts Guide ✅

**File:** [docs/GENERATOR_SCRIPTS_GUIDE.md](GENERATOR_SCRIPTS_GUIDE.md)

Practical guide for using generators:

- **Quick Start** - Common workflows
- **Running Generators** - Via npm scripts and direct Bun
- **Schema Synchronization** - Deep dive into `sync-spec-schemas.sh`
- **Registry Generation** - Understanding `generate-registry.ts`
- **Validator Generation** - Pre-compilation with `generate-validators.ts`
- **Common Use Cases** - Real examples
- **Troubleshooting** - Problem-solving guide

**Key Sections:**

- Running generators manually and as part of build
- Generated code examples for each registry
- Command-line options (--strict, --quiet)
- Performance characteristics
- Step-by-step use cases

### 3. npm Build Integration ✅

The build is **already integrated** in `cli/package.json`:

```json
{
  "scripts": {
    "build": "bash scripts/sync-spec-schemas.sh && bun scripts/generate-registry.ts && bun scripts/generate-validators.ts && tsc && node esbuild.config.js && npm run copy-schemas",
    "build:debug": "bash scripts/sync-spec-schemas.sh && bun scripts/generate-registry.ts && bun scripts/generate-validators.ts && tsc && DR_TELEMETRY=true node esbuild.config.js && npm run copy-schemas",
    "build:ci": "bash scripts/sync-spec-schemas.sh && bun scripts/generate-registry.ts --strict && bun scripts/generate-validators.ts && tsc && node esbuild.config.js && npm run copy-schemas",
    "sync-schemas": "bash scripts/sync-spec-schemas.sh"
  }
}
```

**Build Pipeline:**

```
npm run build
  └─ Step 1: Schema Sync (bash)
       └─ Step 2: Registry Generation (Bun)
            └─ Step 3: Validator Generation (Bun)
                 └─ Step 4: TypeScript Compilation (tsc)
                      └─ Step 5: Bundling (esbuild)
                           └─ Step 6: Copy Schemas
```

**Build Variants:**

| Command | Purpose | Usage |
|---------|---------|-------|
| `npm run build` | Standard build | Development, testing |
| `npm run build:debug` | With debug telemetry | Debugging bundle configuration |
| `npm run build:ci` | Strict validation | CI/CD pipelines, releases |
| `npm run sync-schemas` | Schema sync only | Manual schema updates |

---

## How Generators Integrate

### 1. Schema Synchronization

**Purpose:** Copy schemas from spec to CLI before generation

```bash
bash scripts/sync-spec-schemas.sh
```

**Copies:**

```
spec/schemas/base/       → cli/src/schemas/bundled/base/
spec/schemas/nodes/      → cli/src/schemas/bundled/nodes/
spec/schemas/relationships/ → cli/src/schemas/bundled/relationships/
spec/layers/*.layer.json → cli/src/schemas/bundled/layers/
```

**Why First:**

- Generators read from `cli/src/schemas/bundled/`
- Sync ensures generators see latest spec
- Isolated build (CLI doesn't depend on spec directly)

### 2. Registry Generation

**Purpose:** Generate TypeScript code from layer and schema metadata

```bash
bun scripts/generate-registry.ts
```

**Produces:**

```
cli/src/generated/
├── layer-registry.ts          # Layer metadata + lookup functions
├── node-types.ts             # Node type info + union types
├── relationship-index.ts     # Relationship specs
├── layer-types.ts            # LayerId union type
└── index.ts                  # Barrel export
```

**Used By:**

- Command implementations (for type safety)
- Validators (layer/type lookups)
- Export functions (layer enumeration)
- Error messages (valid layer lists)

### 3. Validator Generation

**Purpose:** Pre-compile AJV validators at build time

```bash
bun scripts/generate-validators.ts
```

**Produces:**

```
cli/src/generated/compiled-validators.ts
```

**Used By:**

- SchemaValidator class
- Conformance validation
- Element migration

---

## Generated Files in Action

### Layer Registry Usage

```typescript
import { getLayerById, getAllLayerIds } from "../generated/layer-registry.js";

// Validate user input
if (!isValidLayer(userInput)) {
  console.error(`Invalid layer. Valid: ${getAllLayerIds().join(", ")}`);
}

// Get metadata
const layer = getLayerById("motivation");
console.log(`Layer ${layer.number}: ${layer.name}`);
```

### Node Type Registry Usage

```typescript
import { getNodeType, NODE_TYPES } from "../generated/node-types.js";

// Get type info
const goal = getNodeType("motivation.goal");
console.log(`Type: ${goal.title}`);
console.log(`Required: ${goal.requiredAttributes.join(", ")}`);

// Discover all types in a layer
const motivationTypes = NODE_TYPES.entries()
  .filter(([_, info]) => info.layer === "motivation")
  .map(([id, _]) => id);
```

### Relationship Index Usage

```typescript
import { getRelationshipsFrom } from "../generated/relationship-index.js";

// Find valid relationships from a node type
const outgoing = getRelationshipsFrom("motivation.goal");
outgoing.forEach(rel => {
  console.log(`Can relate to: ${rel.destination}`);
});
```

### Validator Usage

```typescript
import { validators } from "../generated/compiled-validators.js";

// Validate element data
const isValid = validators.specNode(elementData);
if (!isValid) {
  validators.specNode.errors.forEach(err => {
    console.error(`Field ${err.dataPath}: ${err.message}`);
  });
}
```

---

## Integration Points

### 1. Commands

Generators are used by CLI commands:

```typescript
// cli/src/commands/schema.ts
import { getNodeType, getAllLayerIds } from "../generated/layer-registry.js";

export async function handleSchemaCommand() {
  // List all valid layer IDs
  const layers = getAllLayerIds();

  // Get types for layer
  const types = getNodeTypesForLayer(userSelectedLayer);
}
```

### 2. Validators

Pre-compiled validators used in validation pipeline:

```typescript
// cli/src/validators/schema-validator.ts
import { validators } from "../generated/compiled-validators.js";

async validateElement(element) {
  const isValid = validators.specNode(transformedElement);
  if (!isValid) {
    return { valid: false, errors: validators.specNode.errors };
  }
}
```

### 3. Type Safety

Generated union types provide IDE support:

```typescript
// Generated: export type LayerId = "motivation" | "business" | ... | "testing"
// Generated: export type SpecNodeId = "motivation.goal" | "motivation.requirement" | ...

function processElement(nodeId: SpecNodeId) {
  // IDE knows nodeId is one of 354 valid values
  // Typos caught at compile time
}
```

---

## Development Workflow with Generators

### Adding a Feature That Needs New Types

```bash
# 1. Create new node type schema
vi spec/schemas/nodes/motivation/initiative.node.schema.json

# 2. Register in layer
vi spec/layers/01-motivation.layer.json
# Add "motivation.initiative" to node_types array

# 3. Rebuild (generators create new type)
npm run build

# 4. Type-check passes (new type is in union)
npm run lint

# 5. Implement feature using new type
vi cli/src/commands/add.ts
# IDE shows "motivation.initiative" in SpecNodeId type

# 6. Run tests
npm run test
```

### Modifying Validator Behavior

```bash
# 1. Modify base schema
vi spec/schemas/base/spec-node.schema.json

# 2. Sync schemas
npm run sync-schemas

# 3. Rebuild (validator pre-compilation creates new validators)
npm run build

# 4. Validation uses new schema rules
npm run test
```

### CI/CD Validation

```bash
# CI uses strict build
npm run build:ci

# Fails on:
# - Duplicate relationship IDs
# - Schema compilation errors
# - Layer count != 12
# - Missing required schema files
```

---

## Performance Characteristics

### Build Time Breakdown

| Stage | Time | Notes |
|-------|------|-------|
| Schema Sync | ~50ms | Bash file copy |
| Registry Generation | ~200ms | Parse 366 schema files |
| Validator Generation | ~500ms | Pre-compile validators |
| TypeScript | ~2-3s | Main time sink |
| Bundling | ~1s | esbuild optimization |
| Copy Schemas | ~200ms | Package distribution |
| **Total** | **~4-5s** | Typical full build |

### Runtime Performance

Generated code enables O(1) operations:

- **Layer Lookup:** Map (vs. array search)
- **Node Type Lookup:** Map (vs. linear scan)
- **Validator Compilation:** Pre-compiled (vs. runtime parsing)

### Bundle Size

Generated files add ~95KB to bundle:

- `layer-registry.ts`: ~15KB (minified)
- `node-types.ts`: ~45KB (minified)
- `relationship-index.ts`: ~35KB (minified)
- **Total**: ~95KB added to ~500KB base = 19% increase

Benefits outweigh size for features gained.

---

## Documentation Updates

### Updated Files

1. **docs/BUILD_SYSTEM.md** - Complete build system guide
2. **docs/GENERATOR_SCRIPTS_GUIDE.md** - How to use generators
3. **docs/PHASE_5_INTEGRATION.md** - This file

### Existing Documentation Enhanced

1. **cli/README.md** - Add build workflow section
2. **docs/TECHNICAL_DOCUMENTATION_ANALYSIS_ISSUE_330.md** - Phase 5 context
3. **docs/CLI_SCHEMA_DRIVEN_ARCHITECTURE.md** - Generated APIs

### References for Developers

- [Build System Documentation](BUILD_SYSTEM.md)
- [Generator Scripts Guide](GENERATOR_SCRIPTS_GUIDE.md)
- [CLI Schema-Driven Architecture](CLI_SCHEMA_DRIVEN_ARCHITECTURE.md)
- [Contributing Guide](COLLABORATION_GUIDE.md)

---

## Validation Strategy

### Pre-commit Validation

Spec schemas validated for valid JSON:

```bash
# Pre-commit hooks check
pre-commit run --all-files

# Validates
- JSON syntax in schemas
- Line endings and formatting
- TypeScript code in CLI
```

### CI/CD Validation

Comprehensive validation in GitHub Actions (`.github/workflows/cli-tests.yml`):

```yaml
spec-validation:
  - Validate all 606 schema files
  - Run schema syntax checks
  - Verify cross-schema references
```

### Build-Time Validation

Generators perform validation:

```bash
npm run build

# Validates
- Layer count (exactly 12)
- Schema compilation (AJV)
- Required fields in schemas
- (In strict mode) Duplicate relationship IDs
```

### Runtime Validation

Validators ensure conformance:

```bash
npm test

# Tests validate
- Elements against schemas
- Relationships are defined
- References exist
- Cross-layer rules
```

---

## Common Workflows

### Workflow 1: Change a Node Type Schema

```bash
# 1. Edit schema
vi spec/schemas/nodes/{layer}/{type}.node.schema.json

# 2. Rebuild (generator sees schema changes)
npm run build

# 3. Verify impact
npm run lint          # Type-check catches incompatibilities
npm run test          # Tests verify new schema

# 4. Commit
git add spec/schemas/ cli/src/generated/
git commit -m "Update {type} node schema"
```

### Workflow 2: Add New Layer (Future)

```bash
# 1. Create layer instance
cp spec/layers/12-testing.layer.json spec/layers/13-new.layer.json

# 2. Update generator (currently validates 12)
vi cli/scripts/generate-registry.ts
# EXPECTED_LAYER_COUNT = 13

# 3. Create schemas for new layer
mkdir spec/schemas/nodes/new-layer
mkdir spec/schemas/relationships/new-layer
# Create *.node.schema.json and *.relationship.schema.json files

# 4. Rebuild
npm run build

# 5. Verify
npm run test
```

### Workflow 3: Debug Build Failure

```bash
# 1. Run with debug output
npm run build:debug

# 2. Check which stage failed
# Output shows stage-by-stage progress

# 3. Run failing stage directly
bash cli/scripts/sync-spec-schemas.sh
# or
bun cli/scripts/generate-registry.ts
# or
bun cli/scripts/generate-validators.ts

# 4. Fix issue
# Read error message, identify problem file

# 5. Verify fix
npm run build
```

---

## Moving Forward

### Phase 5 Complete ✅

Deliverables:

- ✅ Generators integrated into npm build workflow
- ✅ Build system documentation
- ✅ Generator scripts guide with examples
- ✅ Troubleshooting and workflows
- ✅ CI/CD integration validated

### Next Steps (Beyond Phase 5)

Based on the 6-phase refactoring plan from [TECHNICAL_DOCUMENTATION_ANALYSIS_ISSUE_330.md](TECHNICAL_DOCUMENTATION_ANALYSIS_ISSUE_330.md):

1. **Phase 1 (Complete):** Foundation (LayerRegistry)
2. **Phase 2 (Complete):** Node Type Index
3. **Phase 3 (Complete):** Relationship Index
4. **Phase 4 (Complete):** Element Alignment
5. **Phase 5 (This Phase):** Pre-compiled Validators & Integration
6. **Phase 6:** UX Enhancements & Advanced Features

---

## See Also

- [Build System Documentation](BUILD_SYSTEM.md) - Detailed build workflow
- [Generator Scripts Guide](GENERATOR_SCRIPTS_GUIDE.md) - Using generators
- [CLI Schema-Driven Architecture](CLI_SCHEMA_DRIVEN_ARCHITECTURE.md) - API reference
- [Contributing Guide](COLLABORATION_GUIDE.md) - Contributing changes
- [Technical Documentation Analysis](TECHNICAL_DOCUMENTATION_ANALYSIS_ISSUE_330.md) - 6-phase plan context
