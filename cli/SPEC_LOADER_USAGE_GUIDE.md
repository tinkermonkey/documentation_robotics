# SpecDataLoader Usage Guide

Quick reference for using SpecDataLoader in CLI commands and applications.

## Installation (Already Included)

SpecDataLoader is included in the CLI package at:
- `src/core/spec-loader.ts` - Low-level loader
- `src/core/spec-data-service.ts` - High-level service
- `src/core/spec-loader-types.ts` - Type definitions

## Quick Start

### For CLI Commands

Use the high-level service for most use cases:

```typescript
import { SpecDataService } from '../core/spec-data-service.js';

export async function myCommand(options: CommandOptions) {
  // Initialize service (loads spec on first call)
  const service = new SpecDataService();
  await service.initialize();

  // Use service for queries
  const nodeTypes = service.getNodeTypesForLayer('api');
  const isValid = service.isValidRelationship(sourceId, destId);

  // Handle not found gracefully
  const nodeType = service.getNodeType('api.endpoint.get-customer');
  if (!nodeType) {
    console.error('Node type not found');
    return;
  }
}
```

### For Application-Wide Access

Use the global singleton:

```typescript
import { getGlobalSpecDataService } from '../core/spec-data-service.js';

// First call initializes
const service = getGlobalSpecDataService();
await service.initialize();

// Subsequent calls return same instance
const service2 = getGlobalSpecDataService();
console.log(service === service2); // true
```

### For Low-Level Access

Use SpecDataLoader directly:

```typescript
import { SpecDataLoader } from '../core/spec-loader.js';

const loader = new SpecDataLoader();
const data = await loader.load();

// Direct access to loaded data
const layers = data.layers;
const predicates = data.predicates.get('implements');
```

## Common Patterns

### Pattern 1: Find Valid Node Types for a Layer

```typescript
const service = new SpecDataService();
await service.initialize();

const apiNodeTypes = service.getNodeTypesForLayer('api');
for (const nodeType of apiNodeTypes) {
  console.log(`- ${nodeType.spec_node_id}: ${nodeType.title}`);
}
```

### Pattern 2: Validate Element Spec

```typescript
const nodeType = service.getNodeType('api.endpoint.get-customer');
if (nodeType) {
  console.log(`✓ Valid: ${nodeType.title}`);
  console.log(`  Attributes: ${nodeType.attributes.length}`);
} else {
  console.error('✗ Not defined in spec');
}
```

### Pattern 3: Check Relationship Validity

```typescript
const isValid = service.isValidRelationship(
  'api.endpoint.create-customer',
  'data-model.entity.customer',
  'uses'
);

if (isValid) {
  console.log('✓ Relationship is valid');
} else {
  console.log('✗ Relationship not defined in spec');
}
```

### Pattern 4: Get Enriched Metadata

```typescript
const metadata = service.getNodeTypeMetadata('api.endpoint.get-customer');
if (metadata) {
  console.log(`Type: ${metadata.nodeType.title}`);
  console.log(`Layer: ${metadata.layer?.name}`);
  console.log(`Referenced by: ${metadata.incomingRelationships.length} types`);
  console.log(`References: ${metadata.outgoingRelationships.length} types`);
}
```

### Pattern 5: Traceability Queries

```typescript
// Find what can reference this type
const sources = service.getSourceNodeTypesForDestination(
  'data-model.entity.customer'
);
console.log(`Referenced by: ${sources.map(s => s.spec_node_id).join(', ')}`);

// Find what this type references
const destinations = service.getDestinationNodeTypesForSource(
  'api.endpoint.create-customer'
);
console.log(`References: ${destinations.map(d => d.spec_node_id).join(', ')}`);
```

### Pattern 6: Validate Spec Integrity

```typescript
const issues = service.validateIntegrity();
if (issues.length > 0) {
  console.warn(`⚠ Found ${issues.length} integrity issues:`);
  for (const issue of issues.slice(0, 5)) {
    console.warn(`  - ${issue}`);
  }
} else {
  console.log('✓ Spec is valid');
}
```

## Query Filters

### Filter by Layer

```typescript
const motivationTypes = service.findNodeTypes({ layer: 'motivation' });
```

### Filter by Type

```typescript
const goals = service.findNodeTypes({ type: 'goal' });
```

### Filter by Multiple Criteria

```typescript
const specs = service.findNodeTypes({
  layer: 'api',
  type: 'endpoint'
});
```

## Performance Tips

### 1. Reuse Service Instance

```typescript
// ✓ Good: Create once
const service = new SpecDataService();
await service.initialize();
export { service }; // Reuse in other modules

// ✗ Bad: Create for each operation
async function operation1() {
  const service = new SpecDataService();
  await service.initialize();
  // ...
}

async function operation2() {
  const service = new SpecDataService();
  await service.initialize();
  // ...
}
```

### 2. Use Global Singleton for App-Wide Access

```typescript
// Better for application initialization
const service = getGlobalSpecDataService();
await service.initialize();
// Use everywhere without re-initialization
```

### 3. Cache Frequently Used Metadata

```typescript
const cache = new Map();

function getMetadata(specNodeId) {
  if (cache.has(specNodeId)) {
    return cache.get(specNodeId);
  }
  const metadata = service.getNodeTypeMetadata(specNodeId);
  if (metadata) {
    cache.set(specNodeId, metadata);
  }
  return metadata;
}
```

## Error Handling

### Safe Access Pattern

```typescript
// Returns undefined for missing types (doesn't throw)
const nodeType = service.getNodeType('non.existent.type');
if (!nodeType) {
  console.log('Type not found');
  return;
}

// Safe to access properties
console.log(nodeType.title);
```

### Service Not Initialized

```typescript
try {
  const service = new SpecDataService();
  // Forgot to initialize!
  const data = service.getSpecData(); // Throws
} catch (e) {
  console.error('Initialize service first with await service.initialize()');
}
```

### Graceful Degradation

```typescript
const service = new SpecDataService();
await service.initialize();

// These never throw, return empty results instead
const results = service.findNodeTypes({ layer: 'api', type: 'NonExistent' });
console.log(results.length); // 0 (no error)

const metadata = service.getNodeTypeMetadata('non.existent.id');
console.log(metadata); // undefined (no error)
```

## Debugging

### Get Statistics

```typescript
const service = new SpecDataService();
await service.initialize();

const stats = service.getStatistics();
console.log(`Loaded ${stats.layerCount} layers`);
console.log(`Loaded ${stats.nodeTypeCount} node types`);
console.log(`Loaded ${stats.relationshipTypeCount} relationships`);
```

### Check Integrity

```typescript
const issues = service.validateIntegrity();
for (const issue of issues) {
  console.warn(`Issue: ${issue}`);
}
```

### Inspect Layer Structure

```typescript
const layers = service.getAllLayers();
for (const layer of layers) {
  const nodeTypes = service.getNodeTypesForLayer(layer.id);
  console.log(`${layer.name} (layer ${layer.number}): ${nodeTypes.length} types`);
}
```

## Testing

When writing tests, use the provided test helpers:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SpecDataService } from "../../src/core/spec-data-service.js";
import path from "path";
import { fileURLToPath } from "url";

describe("My Command", () => {
  let service: SpecDataService;
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const specDir = path.join(currentDir, "../../../spec");

  beforeEach(async () => {
    service = new SpecDataService({ specDir });
    await service.initialize();
  });

  afterEach(() => {
    service.clear();
  });

  it("should find API node types", () => {
    const types = service.getNodeTypesForLayer('api');
    expect(types.length).toBeGreaterThan(0);
  });
});
```

## API Reference

### SpecDataService Main Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `initialize()` | Promise<void> | Load specification data |
| `isInitialized()` | boolean | Check if initialized |
| `getSpecData()` | SpecData | Get raw spec data |
| `getStatistics()` | SpecStatistics | Get metadata |
| `getNodeTypesForLayer(id)` | NodeTypeSpec[] | Types in layer |
| `getNodeType(id)` | NodeTypeSpec? | Get one type |
| `findNodeTypes(filter)` | NodeTypeSpec[] | Query types |
| `getLayer(id)` | LayerSpec? | Get one layer |
| `getAllLayers()` | LayerSpec[] | Get all layers |
| `getPredicate(name)` | PredicateSpec? | Get one predicate |
| `getAllPredicates()` | PredicateSpec[] | Get all predicates |
| `getNodeTypeMetadata(id)` | NodeTypeMetadata? | Get enriched data |
| `isValidRelationship(src, dst, pred?)` | boolean | Validate relationship |
| `getValidPredicates(src, dst)` | PredicateSpec[] | Get valid predicates |
| `getSourceNodeTypesForDestination(dst, pred?)` | NodeTypeSpec[] | Get sources |
| `getDestinationNodeTypesForSource(src, pred?)` | NodeTypeSpec[] | Get destinations |
| `getRelationshipsBetweenLayers(src, dst?)` | RelationshipTypeSpec[] | Get relationships |
| `validateIntegrity()` | string[] | Check consistency |
| `clear()` | void | Clear cache |

## Related Documentation

- [Complete SpecDataLoader Documentation](docs/SPEC_DATA_LOADER.md)
- [Phase 2 Implementation Summary](../PHASE_2_IMPLEMENTATION_SUMMARY.md)
- [Test Examples](tests/unit/spec-loader.test.ts)
- [Integration Test Examples](tests/integration/spec-loader-integration.test.ts)

## Support

For questions or issues:
1. Check the test files for usage examples
2. Review the complete documentation
3. Check CLAUDE.md for project guidelines
4. File an issue on GitHub
