# Generator Maintenance Guide

## Overview

This guide is for developers maintaining and extending the code generation system. It covers:

- **Architecture** - How generators work together
- **Adding Features** - Extending generator capabilities
- **Testing** - Validating generator changes
- **Debugging** - Troubleshooting generator issues
- **Performance** - Optimizing generator performance

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Generator Details](#generator-details)
3. [Adding New Features](#adding-new-features)
4. [Testing Generators](#testing-generators)
5. [Debugging](#debugging)
6. [Performance Optimization](#performance-optimization)

---

## Architecture Overview

### Generator Flow Diagram

```
Input Files                  Generators                Generated Output
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

spec/layers/*.layer.json  ┐
                          ├─→ generate-registry.ts  ┬─→ layer-registry.ts
spec/schemas/nodes/       │                         ├─→ node-types.ts
                          ├─→ (reads layer & node   ├─→ relationship-index.ts
spec/schemas/relationships│   schema files)         ├─→ layer-types.ts
                          │                         └─→ index.ts
spec/schemas/base/        └─→ generate-validators.ts ──→ compiled-validators.ts

cli/src/schemas/bundled/  (copied from spec/)
(after sync-spec-schemas.sh)
```

### Generation Pipeline

```typescript
// 1. Sync schemas from spec to CLI
npm run sync-schemas
// Result: cli/src/schemas/bundled/ contains all schemas

// 2. Generate registries (layer, node types, relationships)
bun scripts/generate-registry.ts
// Input: cli/src/schemas/bundled/layers/ + nodes/ + relationships/
// Output: cli/src/generated/layer-registry.ts + node-types.ts + relationship-index.ts

// 3. Generate compiled validators
bun scripts/generate-validators.ts
// Input: cli/src/schemas/bundled/base/
// Output: cli/src/generated/compiled-validators.ts

// 4. Compile TypeScript (uses generated files)
tsc
// Compiles CLI including generated code

// 5. Bundle
esbuild
// Bundles CLI for distribution
```

### Design Principles

1. **Single Source of Truth** - Spec files are authoritative
2. **Type Safety** - Generated code is fully typed TypeScript
3. **Performance** - Pre-compilation and caching where possible
4. **Reproducibility** - Same input always produces same output
5. **Isolation** - Generators don't depend on each other

---

## Generator Details

### 1. sync-spec-schemas.sh

**Purpose:** Copy schemas from spec to CLI bundled location

**Language:** Bash

**File:** `/workspace/cli/scripts/sync-spec-schemas.sh`

**Key Implementation:**

```bash
#!/bin/bash

# Locations
SPEC_DIR="../spec"
CLI_DIR="$(dirname "$0")/.."
BUNDLED_DIR="$CLI_DIR/src/schemas/bundled"

# Copy base schemas
cp "$SPEC_DIR/schemas/base"/*.schema.json "$BUNDLED_DIR/base/"

# Copy node schemas (preserves directory structure)
cp -r "$SPEC_DIR/schemas/nodes"/* "$BUNDLED_DIR/nodes/"

# Copy relationship schemas
cp -r "$SPEC_DIR/schemas/relationships"/* "$BUNDLED_DIR/relationships/"

# Copy layer instances
cp "$SPEC_DIR/layers"/*.layer.json "$BUNDLED_DIR/layers/"
```

**Why Bash?**

- Simple file operations
- No build tools required
- Fast execution (~50ms)
- Easy to understand and maintain

**Improvements Needed:**

- Add error handling (check if files exist)
- Verify permissions before copying
- Add checksum validation to detect partial copies

### 2. generate-registry.ts

**Purpose:** Generate TypeScript code from layer and schema files

**Language:** TypeScript (run with Bun)

**File:** `/workspace/cli/scripts/generate-registry.ts`

**Key Data Structures:**

```typescript
interface LayerInstance {
  id: string;              // "motivation"
  number: number;          // 1
  name: string;            // "Motivation Layer"
  description: string;
  node_types: string[];    // ["motivation.goal", ...]
  inspired_by?: { ... };
}

interface NodeTypeInfo {
  specNodeId: string;              // "motivation.goal"
  layer: string;                   // "motivation"
  type: string;                    // "goal"
  title: string;                   // "Goal"
  requiredAttributes: string[];
  optionalAttributes: string[];
  attributeConstraints: Record<string, unknown>;
}

interface RelationshipSchemaFile {
  id: string;                      // Relationship ID
  source_spec_node_id: string;
  destination_spec_node_id: string;
  predicate: string;
  cardinality: CardinalityType;
  strength: StrengthType;
  required?: boolean;
}
```

**Key Functions:**

```typescript
// Find all node schema files recursively
function findNodeSchemaFiles(dir: string): string[]

// Parse a JSON file
function readJsonFile<T>(filePath: string): T

// Extract attributes from node schema
function extractAttributesFromSchema(schema: object): {
  required: string[];
  optional: string[];
  constraints: Record<string, unknown>;
}

// Generate TypeScript code (returns string)
function generateRegistryCode(
  layers: LayerMetadata[],
  nodeTypes: Map<SpecNodeId, NodeTypeInfo>,
  relationships: RelationshipSpec[]
): string

// Write generated files
function writeGeneratedFile(filePath: string, content: string): void
```

**Extension Points:**

To add new generated code, add a new function:

```typescript
function generateNewFileCode(data: any): string {
  // Generate code for new output file
  return `
// Auto-generated file
export const MY_NEW_CODE = ...
`;
}

// Then call it in main:
function main() {
  const registryCode = generateRegistryCode(...);
  writeGeneratedFile(LAYER_REGISTRY_PATH, registryCode);

  // Add this:
  const newCode = generateNewFileCode(...);
  writeGeneratedFile(NEW_FILE_PATH, newCode);
}
```

### 3. generate-validators.ts

**Purpose:** Pre-compile AJV validators at build time

**Language:** TypeScript (run with Bun)

**File:** `/workspace/cli/scripts/generate-validators.ts`

**Key Implementation:**

```typescript
import Ajv from "ajv";
import * as fs from "fs";

const ajv = new Ajv({
  strict: true,
  validateSchema: true,
});

// Load base schemas
const specNodeSchema = JSON.parse(
  fs.readFileSync("cli/src/schemas/bundled/base/spec-node.schema.json", "utf-8")
);
const specNodeRelationshipSchema = JSON.parse(
  fs.readFileSync(
    "cli/src/schemas/bundled/base/spec-node-relationship.schema.json",
    "utf-8"
  )
);

// Compile validators
const specNodeValidator = ajv.compile(specNodeSchema);
const specNodeRelationshipValidator = ajv.compile(specNodeRelationshipSchema);

// Generate TypeScript code
function generateValidatorCode(
  validators: Map<string, ValidateFunction>
): string {
  return `
import Ajv from "ajv";

export const validators = {
  specNode: ${generateValidatorFunctionCode(specNodeValidator)},
  specNodeRelationship: ${generateValidatorFunctionCode(specNodeRelationshipValidator)},
};
`;
}

// Write generated file
fs.writeFileSync("cli/src/generated/compiled-validators.ts", code);
```

**Why Pre-compile?**

1. **Performance** - Validators ready instantly
2. **Reliability** - Schema errors caught at build time
3. **Reduced Overhead** - No runtime schema parsing

---

## Adding New Features

### Scenario 1: Generate New Metadata

**Goal:** Add generated file with custom metadata

**Steps:**

1. **Create new function in generate-registry.ts:**

```typescript
function generateNewMetadata(input: any[]): string {
  const code = `
export const MY_METADATA = {
  // Custom metadata here
};
`;
  return code;
}
```

2. **Call in main():**

```typescript
function main() {
  // ... existing code ...

  const newCode = generateNewMetadata(data);
  writeGeneratedFile(
    path.join(GENERATED_DIR, "new-metadata.ts"),
    newCode
  );
}
```

3. **Add to barrel export (index.ts):**

```typescript
export * from "./new-metadata.js";
```

4. **Test the output:**

```bash
npm run build
ls cli/src/generated/new-metadata.ts
```

### Scenario 2: Add New Validator

**Goal:** Pre-compile validator for new schema

**Steps:**

1. **Add schema to spec/schemas/base/ (e.g., `my-schema.schema.json`)**

2. **Update generate-validators.ts:**

```typescript
const mySchema = JSON.parse(
  fs.readFileSync("cli/src/schemas/bundled/base/my-schema.schema.json", "utf-8")
);

const myValidator = ajv.compile(mySchema);

// In generated code:
export const validators = {
  specNode: ...,
  specNodeRelationship: ...,
  mySchema: ${generateValidatorFunctionCode(myValidator)},  // Add this
};
```

3. **Test:**

```bash
npm run build
grep "mySchema" cli/src/generated/compiled-validators.ts
```

### Scenario 3: Generate Code for New Schema Type

**Goal:** Generate TypeScript interfaces from a new category of schemas

**Steps:**

1. **Understand the schema structure** - Review the schema files to understand their format

2. **Create new generator function:**

```typescript
function generateNewSchemaTypes(schemaDir: string): string {
  // Find schema files
  const schemaFiles = fs.readdirSync(schemaDir)
    .filter(f => f.endsWith(".schema.json"));

  // Parse and extract metadata
  const schemas = schemaFiles.map(file =>
    JSON.parse(fs.readFileSync(path.join(schemaDir, file), "utf-8"))
  );

  // Generate code
  return `
// Generated from ${schemaDir}
export interface NewSchemaInfo {
  // Fields extracted from schemas
}
`;
}
```

3. **Integrate into build:**

```typescript
function main() {
  const code = generateNewSchemaTypes("cli/src/schemas/bundled/new-category/");
  writeGeneratedFile(
    path.join(GENERATED_DIR, "new-schema-types.ts"),
    code
  );
}
```

---

## Testing Generators

### 1. Unit Tests for Generators

**Location:** `/workspace/cli/tests/unit/generators/`

**Test Pattern:**

```typescript
// generate-registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";

describe("generate-registry", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = "/tmp/test-gen-" + Date.now();
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true });
  });

  it("should generate layer registry with 12 layers", async () => {
    // Run generator
    const result = await exec("bun cli/scripts/generate-registry.ts", {
      cwd: testDir,
    });

    // Verify output
    const code = fs.readFileSync("cli/src/generated/layer-registry.ts", "utf-8");
    expect(code).toContain("export const LAYERS");
    expect(code.match(/id: ["'].*["']/g)).toHaveLength(12);
  });

  it("should fail with --strict on duplicate IDs", async () => {
    // Create duplicate relationship schema
    // Run with --strict
    // Expect exit code 1
    expect(exitCode).toBe(1);
  });

  it("should skip missing optional fields", async () => {
    // Create schema without optional fields
    // Run generator
    // Verify optional fields not included
  });
});
```

### 2. Integration Tests

**Test the complete build:**

```bash
# Full build test
npm run build

# Verify all generated files exist
test -f cli/src/generated/layer-registry.ts
test -f cli/src/generated/node-types.ts
test -f cli/src/generated/relationship-index.ts
test -f cli/src/generated/compiled-validators.ts

# Verify build produces valid TypeScript
npm run lint

# Verify generated code works
npm run test
```

### 3. Validation Tests

**Test that generators enforce invariants:**

```bash
# Test 1: Layer count validation
# Simulate missing layer file, expect build to fail
rm spec/layers/12-testing.layer.json
npm run build 2>&1 | grep -q "Expected 12 layers"

# Test 2: Schema compilation
# Create invalid schema, expect build to fail
echo '{ invalid json }' > spec/schemas/base/test.schema.json
npm run build 2>&1 | grep -q "Schema compilation failed"

# Test 3: Duplicate ID detection (strict mode)
# Create duplicate relationship ID
# Run with --strict, expect failure
npm run build:ci 2>&1 | grep -q "Duplicate relationship ID"
```

---

## Debugging

### 1. Enable Debug Output

```bash
# Run generator with debug output
bun cli/scripts/generate-registry.ts --debug

# Or modify scripts to log more
export DEBUG=* npm run build
```

### 2. Inspect Generated Code

```bash
# View layer registry
cat cli/src/generated/layer-registry.ts | head -50

# View node types
cat cli/src/generated/node-types.ts | head -50

# Search for specific type
grep "motivation.goal" cli/src/generated/node-types.ts
```

### 3. Check Build Artifacts

```bash
# Verify sync happened
ls -la cli/src/schemas/bundled/layers/ | wc -l
# Should be 12

# Verify registry generated
ls -la cli/src/generated/
# Should show 5 files

# Check generated code compiles
npm run lint
```

### 4. Debug Generator Logic

**Add logging to generate-registry.ts:**

```typescript
function main() {
  console.log("Starting registry generation...");

  // Load layers
  const layerFiles = findLayerFiles(BUNDLED_LAYERS_DIR);
  console.log(`Found ${layerFiles.length} layer files`);

  // Load node schemas
  const nodeFiles = findNodeSchemaFiles(BUNDLED_NODES_DIR);
  console.log(`Found ${nodeFiles.length} node schema files`);

  // Generate
  const code = generateRegistryCode(...);
  console.log(`Generated ${code.split('\n').length} lines`);

  // Write
  writeGeneratedFile(LAYER_REGISTRY_PATH, code);
  console.log(`✓ Wrote ${LAYER_REGISTRY_PATH}`);
}
```

### 5. Common Issues

**Problem:** "Schema file not found"

```bash
# Check if sync happened first
npm run sync-schemas

# Verify files exist
find cli/src/schemas/bundled -name "*.schema.json" | wc -l

# If empty, check spec has schemas
find spec/schemas -name "*.schema.json" | wc -l
```

**Problem:** "Generate fails silently"

```bash
# Run with bash -x for debugging
bun scripts/generate-registry.ts --debug 2>&1 | tail -100

# Check Node.js version
node --version
# Should be 18+

# Check Bun is available
which bun
```

**Problem:** "Type errors after generation"

```bash
# Regenerate
npm run build

# Check for syntax errors in generated
npm run lint

# If errors, check generator logic
# Look at last few lines of generated files
tail -20 cli/src/generated/layer-registry.ts
```

---

## Performance Optimization

### 1. Measure Current Performance

```bash
time npm run build

# Breakdown by stage:
time bash cli/scripts/sync-spec-schemas.sh
time bun cli/scripts/generate-registry.ts
time bun cli/scripts/generate-validators.ts
```

### 2. Optimize Schema Reading

**Before:**

```typescript
// Read schemas one at a time in a loop
for (const file of nodeFiles) {
  const schema = JSON.parse(fs.readFileSync(file, "utf-8"));
  // process schema
}
```

**After:**

```typescript
// Read all schemas in parallel
const schemas = await Promise.all(
  nodeFiles.map(file =>
    fs.promises.readFile(file, "utf-8")
      .then(content => JSON.parse(content))
  )
);
```

### 3. Cache Generated Code

**Skip regeneration if input hasn't changed:**

```typescript
function shouldRegenerate(inputFiles: string[], outputFile: string): boolean {
  if (!fs.existsSync(outputFile)) return true;

  const outputMtime = fs.statSync(outputFile).mtime;

  return inputFiles.some(input => {
    const inputMtime = fs.statSync(input).mtime;
    return inputMtime > outputMtime;
  });
}

function main() {
  if (!shouldRegenerate(layerFiles, LAYER_REGISTRY_PATH)) {
    console.log("Layer registry up-to-date, skipping generation");
    return;
  }

  // Generate...
}
```

### 4. Optimize Code Generation

**Use string templates instead of concatenation:**

```typescript
// Inefficient
let code = "";
for (const layer of layers) {
  code += `export const ${layer.id} = `;
  code += JSON.stringify(layer);
  code += ";\n";
}

// Efficient
const code = layers
  .map(layer => `export const ${layer.id} = ${JSON.stringify(layer)};`)
  .join("\n");
```

### 5. Profile Bottlenecks

```bash
# Time each stage
time bash cli/scripts/sync-spec-schemas.sh 2>&1
time bun --time cli/scripts/generate-registry.ts 2>&1
time bun --time cli/scripts/generate-validators.ts 2>&1
```

**Typical times:**

- Schema Sync: ~50ms (file copy)
- Registry Gen: ~200ms (parse 366 schemas)
- Validator Gen: ~500ms (compile validators)
- TypeScript: ~2-3s (main time sink)

---

## Contributing Changes

### Checklist for Generator Changes

- [ ] Change is in a single generator script
- [ ] Generated output is verified to be valid TypeScript
- [ ] New output files are added to `.gitignore`
- [ ] Generated files are not committed (only checked after rebuild)
- [ ] Tests pass: `npm run test:generated`
- [ ] Build passes: `npm run build`
- [ ] TypeScript check passes: `npm run lint`
- [ ] Documentation is updated (if user-facing)

### Submitting Changes

1. **Create a feature branch:**

```bash
git checkout -b feature/improve-generator-xyz
```

2. **Make changes to generator scripts:**

```bash
vi cli/scripts/generate-registry.ts
vi cli/scripts/generate-validators.ts
vi cli/scripts/sync-spec-schemas.sh
```

3. **Test thoroughly:**

```bash
npm run build       # Full build
npm run test        # All tests
npm run test:generated  # Generator tests
npm run lint        # Type check
```

4. **Update documentation:**

```bash
# If user-facing change:
vi docs/GENERATOR_SCRIPTS_GUIDE.md
vi docs/BUILD_SYSTEM.md
```

5. **Commit:**

```bash
git add cli/scripts/ docs/
git commit -m "Improve generator: [description]"
git push origin feature/improve-generator-xyz
```

6. **Create PR with description of changes**

---

## See Also

- [Build System Documentation](BUILD_SYSTEM.md)
- [Generator Scripts Guide](GENERATOR_SCRIPTS_GUIDE.md)
- [Phase 5 Integration](PHASE_5_INTEGRATION.md)
