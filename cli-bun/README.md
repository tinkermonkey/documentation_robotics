# Documentation Robotics CLI - Bun Implementation

TypeScript-based CLI for managing federated architecture data models across 12 interconnected layers.

## Overview

This is the Bun implementation of the Documentation Robotics CLI. It provides a parallel implementation to the existing Python CLI while maintaining full compatibility with the shared specification and model structure.

## Foundation

- ✅ Project structure initialized
- ✅ TypeScript configuration (strict mode)
- ✅ Core domain models (Element, Layer, Model, Manifest)
- ✅ Reference and Relationship registries for tracking dependencies
- ✅ File I/O utilities with atomic writes
- ✅ JSON schemas bundled (all 12 layers)
- ✅ Comprehensive unit tests
- ✅ Code formatted and configured for linting

## Directory Structure

```
cli-bun/
├── src/
│   ├── cli.ts                          # Entry point
│   ├── core/                           # Domain models
│   │   ├── element.ts                  # Individual architecture items
│   │   ├── layer.ts                    # Layer containers
│   │   ├── model.ts                    # Complete model orchestration
│   │   ├── manifest.ts                 # Model metadata (JSON)
│   │   ├── reference-registry.ts       # Cross-layer reference tracking
│   │   └── relationship-registry.ts    # Intra-layer relationship management
│   ├── types/
│   │   └── index.ts                    # TypeScript type definitions
│   ├── utils/
│   │   └── file-io.ts                  # File operations (atomic writes)
│   └── schemas/
│       └── bundled/                    # All JSON schemas from spec/
│           ├── 01-motivation-layer.schema.json
│           ├── 02-business-layer.schema.json
│           ├── ... (all 12 layer schemas)
│           ├── relationship-catalog.json
│           ├── link-registry.json
│           └── common/
│               ├── relationships.schema.json
│               ├── predicates.schema.json
│               └── ...
├── tests/
│   └── unit/
│       ├── core/
│       │   ├── element.test.ts
│       │   ├── layer.test.ts
│       │   ├── manifest.test.ts
│       │   ├── model.test.ts
│       │   ├── reference-registry.test.ts
│       │   ├── relationship-registry.test.ts
│       │   └── element.integration.test.js
│       └── utils/
│           └── file-io.test.ts
├── dist/                               # Compiled JavaScript
├── package.json
├── tsconfig.json
├── biome.json
└── README.md
```

## Setup

### Prerequisites

- Node.js 18+ (Bun 1.3+ preferred, but Node.js works for development)
- npm or bun

### Installation

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests (when Bun is available)
bun test

# Format code
npm run format
```

## Core Classes

### Element

Individual architecture items in the model. Supports:

- Properties with type-safe getters/setters
- Array properties with add/get operations
- References to other elements (cross-layer)
- Relationships with other elements (intra-layer)

```typescript
const element = new Element({
  id: 'motivation-goal-test',
  type: 'Goal',
  name: 'Test Goal',
  description: 'A test goal',
  properties: { priority: 'high' }
});

element.setProperty('owner', 'team-a');
element.addToArrayProperty('tags', 'important');
```

### Layer

Container for elements within a single layer. Supports:

- Add/get/delete/list operations
- Dirty tracking (unsaved changes)
- JSON serialization/deserialization

```typescript
const layer = new Layer('motivation');
layer.addElement(element);

if (layer.isDirty()) {
  await model.saveLayer('motivation');
  layer.markClean();
}
```

### Manifest

Model metadata (JSON-based). Supports:

- Automatic timestamp management
- JSON serialization/deserialization
- Version tracking

```typescript
const manifest = new Manifest({
  name: 'Test Model',
  version: '1.0.0',
  description: 'A test model',
  specVersion: '0.6.0'
});

const json = JSON.stringify(manifest.toJSON());
const deserialized = Manifest.fromJSON(json);
```

### Model

Central orchestrator for the complete architecture model. Supports:

- Lazy layer loading
- Manifest management
- Atomic persistence to `.dr/` directory structure

```typescript
// Initialize a new model
const model = await Model.init('.', {
  name: 'My Model',
  version: '1.0.0'
});

// Load an existing model
const loaded = await Model.load('.');

// Save changes
await model.saveManifest();
await model.saveDirtyLayers();
```

### ReferenceRegistry

Tracks cross-layer references between architecture elements. Provides:

- Add/query references by source, target, or type
- Reference validation and integrity checking
- Impact analysis (find all references to/from an element)
- Statistics on reference usage

```typescript
const refRegistry = new ReferenceRegistry();

refRegistry.addReference({
  source: '01-motivation-goal-create-customer',
  target: '02-business-process-create-order',
  type: 'realizes'
});

const refsFrom = refRegistry.getReferencesFrom('01-motivation-goal-create-customer');
const refsTo = refRegistry.getReferencesTo('02-business-process-create-order');
```

### RelationshipRegistry

Manages intra-layer relationships and their semantic metadata. Provides:

- Register relationship types with predicates and metadata
- Query relationships by source, layer, or predicate
- Validate relationship predicates
- Layer-specific relationship rules

```typescript
const relRegistry = new RelationshipRegistry();

relRegistry.registerType({
  id: 'depends-on',
  predicate: 'depends-on',
  category: 'dependency'
});

relRegistry.addRelationship({
  source: '02-process-create-order',
  target: '02-process-validate-order',
  predicate: 'depends-on'
});
```

## File I/O Utilities

Atomic file operations for safe persistence:

```typescript
import { ensureDir, writeFile, readFile, writeJSON, readJSON, atomicWrite } from '@/utils/file-io';

// Ensure directory exists
await ensureDir('.dr/layers');

// Atomic write (safe for crash recovery)
await atomicWrite('.dr/manifest.json', content);

// JSON operations
await writeJSON('.dr/layers/motivation.json', data, true);
const loaded = await readJSON('.dr/layers/motivation.json');
```

## Type Definitions

Core types defined in `src/types/index.ts`:

- `Element` - Architecture item representation
- `LayerData` - Layer serialization format
- `ManifestData` - Manifest metadata
- `Reference` - Cross-layer references
- `Relationship` - Intra-layer relationships
- `ModelOptions` - Model configuration

## Testing

Comprehensive test coverage for core classes:

```bash
# Run Bun tests (requires Bun runtime)
bun test

# Run specific test file
bun test tests/unit/core/element.test.ts

# With coverage
bun test --coverage

# Node.js integration test
node tests/unit/core/element.integration.test.js
```

## Bundled Schemas

All JSON schemas from `spec/schemas/` are bundled:

- **Layer Schemas**: 01-motivation through 12-testing
- **Catalogs**: relationship-catalog.json, link-registry.json
- **Common Schemas**: predicates, relationships, source-references, layer-extensions

These schemas are loaded at build time and do not require filesystem access at runtime.

## Code Quality

- **TypeScript**: Strict mode with comprehensive type coverage
- **Linting**: Biome configured for code quality checks
- **Formatting**: Code formatted to project standards

## Next Steps

- Validation pipeline (schema, naming, reference, semantic)
- AJV schema validation
- Naming convention enforcement
- Cross-layer constraint checking
- Relationship predicate validation

## Related Resources

- Specification: `/workspace/spec/`
- Python CLI: `/workspace/cli/`
- Design Discussion: [GitHub Discussion #68](https://github.com/tinkermonkey/documentation_robotics/discussions/68)

## Architecture Alignment

This implementation follows the parallel-stack architecture:

- **Shared**: Specification (`/spec/`), test fixtures, schemas
- **Separate**: Implementations (`/cli/` Python, `/cli-bun/` Bun)
- **Compatible**: Identical data structures, `.dr/` directory format, element ID conventions

## License

MIT
