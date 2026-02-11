# SpecDataLoader - Phase 2 Implementation

## Overview

The **SpecDataLoader** is a Phase 2 implementation that provides programmatic access to Documentation Robotics specification metadata. It loads layer definitions, node type schemas, relationship schemas, and predicates from the `spec/` directory and provides a rich API for querying this data.

This enables:
- Introspection of valid element types per layer
- Validation of cross-layer relationships
- Semantic predicate discovery
- Specification-driven model validation
- Integration with CLI commands and analysis tools

## Architecture

### Components

#### 1. **SpecDataLoader** (`src/core/spec-loader.ts`)

Low-level data loader that handles file I/O and parsing:

```typescript
const loader = new SpecDataLoader({
  specDir: './spec',           // Optional: path to spec directory
  cache: true,                 // Optional: cache loaded data
  includeSchemas: false        // Optional: include full JSON schemas
});

const data = await loader.load();
```

**Features:**
- Lazy loading: data is not loaded until `load()` is called
- Caching: loaded data is cached in memory by default
- Optional schema inclusion: full JSON schemas can be included for advanced use cases
- Comprehensive error handling with descriptive messages

**Key Methods:**
- `load()`: Load all specification data asynchronously
- `getSpecData()`: Get loaded data (throws if not loaded)
- `getStatistics()`: Get statistics about loaded spec
- `clear()`: Clear cached data

**Query Methods:**
- `findNodeTypes(filter)`: Find node types by filter
- `findRelationshipTypes(filter)`: Find relationship types by filter
- `getNodeTypesForLayer(layerId)`: Get all node types for a layer
- `getLayer(layerId)`: Get layer by ID
- `getNodeType(specNodeId)`: Get node type by spec_node_id
- `getPredicate(name)`: Get predicate by name
- `getAllLayers()`: Get all 12 layers
- `getAllPredicates()`: Get all predicates

#### 2. **SpecDataService** (`src/core/spec-data-service.ts`)

High-level service providing semantic operations and caching:

```typescript
const service = new SpecDataService({ specDir: './spec' });
await service.initialize();

// Query operations
const nodeTypes = service.findNodeTypes({ layer: 'api' });
const metadata = service.getNodeTypeMetadata('api.endpoint.get-customer');
const isValid = service.isValidRelationship(sourceId, destId, 'implements');

// Data validation
const issues = service.validateIntegrity();
```

**Features:**
- Lazy initialization: load data when needed
- Metadata enrichment: automatic computation of relationships and layer info
- Query optimization: efficient filtering and lookups
- Integrity validation: check consistency of spec data
- Global singleton pattern for application-wide access

**Key Methods:**
- `initialize()`: Load spec data asynchronously
- `isInitialized()`: Check if service is ready
- `getNodeTypeMetadata(specNodeId)`: Get enriched metadata including relationships
- `isValidRelationship(source, dest, predicate)`: Validate relationship
- `getValidPredicates(source, dest)`: Get valid predicates between types
- `getSourceNodeTypesForDestination(dest)`: Find what can reference this type
- `getDestinationNodeTypesForSource(source)`: Find what this type can reference
- `validateIntegrity()`: Validate all cross-references

### Type Definitions (`src/core/spec-loader-types.ts`)

```typescript
interface LayerSpec {
  id: string;
  number: number;
  name: string;
  description: string;
  node_types: string[];
}

interface NodeTypeSpec {
  spec_node_id: string;
  layer_id: string;
  type: string;
  title: string;
  description: string;
  attributes: AttributeSpec[];
}

interface RelationshipTypeSpec {
  id: string;
  source_spec_node_id: string;
  source_layer: string;
  destination_spec_node_id: string;
  destination_layer: string;
  predicate: string;
  cardinality: string;
  strength: string;
  required?: boolean;
}

interface PredicateSpec {
  predicate: string;
  inverse: string;
  category: string;
  description: string;
  semantics: {
    directionality: string;
    transitivity: boolean;
    symmetry: boolean;
  };
}
```

## Usage Patterns

### Pattern 1: Basic Data Loading

```typescript
import { SpecDataLoader } from './src/core/spec-loader.js';

const loader = new SpecDataLoader();
await loader.load();

const layers = loader.getAllLayers();
const apiTypes = loader.getNodeTypesForLayer('api');
```

### Pattern 2: High-Level Service

```typescript
import { SpecDataService } from './src/core/spec-data-service.js';

const service = new SpecDataService();
await service.initialize();

// Get enriched metadata
const metadata = service.getNodeTypeMetadata('api.endpoint.get-customer');
console.log(metadata.layer.name);  // "API"
console.log(metadata.incomingRelationships);  // What references this
console.log(metadata.outgoingRelationships);  // What this references
```

### Pattern 3: Global Singleton

```typescript
import { getGlobalSpecDataService } from './src/core/spec-data-service.js';

// First call initializes
const service = getGlobalSpecDataService();
await service.initialize();

// Subsequent calls return same instance
const service2 = getGlobalSpecDataService();
console.log(service === service2); // true
```

### Pattern 4: Relationship Validation

```typescript
const service = new SpecDataService();
await service.initialize();

// Check if relationship is valid
const valid = service.isValidRelationship(
  'api.endpoint.get-customer',
  'data-model.entity.customer',
  'uses'
);

// Get valid predicates
const predicates = service.getValidPredicates(
  'api.endpoint.get-customer',
  'data-model.entity.customer'
);
```

### Pattern 5: Traceability Queries

```typescript
const service = new SpecDataService();
await service.initialize();

// Find what can satisfy a goal
const satisfiers = service.getSourceNodeTypesForDestination(
  'motivation.goal.customer-satisfaction'
);

// Find what an API endpoint uses
const dependencies = service.getDestinationNodeTypesForSource(
  'api.endpoint.create-customer'
);

// Trace data flow between layers
const dataFlows = service.getRelationshipsBetweenLayers('api', 'data-store');
```

## Integration with CLI Commands

The SpecDataLoader enables several CLI commands:

### Schema Introspection

```bash
# List all layers with node type counts
dr schema layers

# List valid node types for a layer
dr schema types api

# Show node type schema details
dr schema node api.endpoint

# Find valid relationships
dr schema relationship api.endpoint business
```

### Conformance Checking

```bash
# Validate model conforms to spec
dr conformance --layers api,data-model
```

### Model Validation

```bash
# Validate model uses only spec-defined types and relationships
dr validate --schemas
```

## Performance Considerations

### Caching Strategy

By default, SpecDataLoader caches loaded data in memory:

```typescript
// Cache is enabled by default
const loader = new SpecDataLoader({ cache: true });

// Disable caching for memory-sensitive scenarios
const loader = new SpecDataLoader({ cache: false });

// Clear cache manually
loader.clear();
```

### Metadata Cache

SpecDataService maintains a cache of enriched node type metadata:

```typescript
// First call computes and caches metadata
const metadata1 = service.getNodeTypeMetadata('api.endpoint.get-customer');

// Subsequent calls use cached version (faster)
const metadata2 = service.getNodeTypeMetadata('api.endpoint.get-customer');
```

### Benchmarks

Typical performance on modern systems:
- Loading full spec: ~15-20ms
- Looking up node type: <1ms
- Computing metadata: ~2-5ms (first time), <1ms (cached)
- Querying relationships: ~2-3ms
- Validating spec integrity: ~50-100ms

## Error Handling

### Common Scenarios

```typescript
const service = new SpecDataService();

// Error: Data not loaded
try {
  service.getSpecData(); // Throws if not initialized
} catch (e) {
  console.error('Service not initialized');
}

// Initialize first
await service.initialize();

// Graceful handling of missing data
const nodeType = service.getNodeType('non.existent.type');
if (!nodeType) {
  console.log('Node type not found');
}

// Query with no results
const results = service.findNodeTypes({ layer: 'api', type: 'NonExistent' });
console.log(results.length); // 0
```

### Integrity Validation

```typescript
const service = new SpecDataService();
await service.initialize();

const issues = service.validateIntegrity();
if (issues.length > 0) {
  console.warn(`Found ${issues.length} integrity issues:`);
  issues.forEach(issue => console.warn(`  - ${issue}`));
}
```

## Specification Structure

The SpecDataLoader reads from these spec files:

```
spec/
├── layers/                          # 12 layer definitions
│   ├── 01-motivation.layer.json
│   ├── 02-business.layer.json
│   └── ...
├── schemas/
│   ├── base/                        # Base type definitions
│   │   ├── spec-node.schema.json
│   │   ├── predicates.json
│   │   └── ...
│   ├── nodes/                       # ~354 node type schemas
│   │   ├── motivation/
│   │   ├── api/
│   │   └── ...
│   └── relationships/               # ~252 relationship schemas
│       ├── motivation/
│       ├── api/
│       └── ...
```

## Testing

### Unit Tests

Comprehensive unit tests cover:
- Data loading from all spec files
- Caching behavior
- Query operations
- Error handling
- Statistics collection

Run unit tests:

```bash
bun test ./tests/unit/spec-loader.test.ts
```

### Integration Tests

Integration tests verify:
- Loading actual specification data
- Cross-layer reference validation
- Real-world query scenarios
- Performance characteristics
- Specification completeness

Run integration tests:

```bash
bun test ./tests/integration/spec-loader-integration.test.ts
```

### Test Coverage

- 38 unit test cases
- 24 integration test cases
- Coverage of all major APIs
- Error scenarios
- Performance validation

## Future Enhancements

### Phase 3 Ideas

1. **Spec Change Detection**: Track changes between spec versions
2. **Spec Visualization**: Generate diagrams from spec structure
3. **Spec Linting**: Validate spec structure completeness
4. **Spec Documentation Generation**: Auto-generate docs from specs
5. **Version Compatibility**: Check model compatibility with spec versions
6. **Spec Diff**: Compare two spec versions

### Performance Optimization

1. **Lazy Schema Loading**: Load schemas on-demand instead of all at once
2. **Compressed Caching**: Cache spec as compressed JSON
3. **Index Generation**: Pre-build indices for faster lookups
4. **Parallel Loading**: Load spec files in parallel with Web Workers

## Examples

### Example 1: List All Valid Node Types for API Layer

```typescript
import { SpecDataService } from './src/core/spec-data-service.js';

const service = new SpecDataService();
await service.initialize();

const apiTypes = service.getNodeTypesForLayer('api');
for (const nodeType of apiTypes) {
  console.log(`${nodeType.spec_node_id}: ${nodeType.title}`);
}
```

### Example 2: Validate a New Element

```typescript
const element = {
  spec_node_id: 'api.endpoint.get-customer',
  layer: 'api',
  type: 'endpoint'
};

const spec = service.getNodeType(element.spec_node_id);
if (spec) {
  console.log(`Element is valid: ${spec.title}`);
} else {
  console.error(`Element type not defined in spec`);
}
```

### Example 3: Check Valid Relationships

```typescript
const fromType = 'api.endpoint.create-customer';
const toType = 'data-model.entity.customer';

const predicates = service.getValidPredicates(fromType, toType);
if (predicates.length > 0) {
  console.log('Valid relationships:');
  for (const p of predicates) {
    console.log(`  - ${p.predicate}: ${p.description}`);
  }
} else {
  console.log('No valid relationships defined');
}
```

### Example 4: Trace Full Dependency Path

```typescript
const service = new SpecDataService();
await service.initialize();

async function traceDependencies(specNodeId: string, depth = 0) {
  const nodeType = service.getNodeType(specNodeId);
  if (!nodeType) return;

  console.log('  '.repeat(depth) + `- ${nodeType.type} (${nodeType.layer_id})`);

  const dependencies = service.getDestinationNodeTypesForSource(specNodeId);
  for (const dep of dependencies.slice(0, 3)) {
    await traceDependencies(dep.spec_node_id, depth + 1);
  }
}

await traceDependencies('api.endpoint.get-customer');
```

## Debugging

### Enable Logging

```typescript
const service = new SpecDataService();
const stats = service.getStatistics();

console.log(`Loaded ${stats.layerCount} layers`);
console.log(`Loaded ${stats.nodeTypeCount} node types`);
console.log(`Loaded ${stats.relationshipTypeCount} relationship types`);
console.log(`Loaded ${stats.predicateCount} predicates`);
console.log(`Loaded at: ${stats.loadedAt}`);
```

### Validate Spec Integrity

```typescript
const issues = service.validateIntegrity();
console.log(`Found ${issues.length} integrity issues:`);
for (const issue of issues.slice(0, 10)) {
  console.log(`  - ${issue}`);
}
```

## Related Documentation

- [Architecture Model Overview](../README.md)
- [Layer Reference](../spec/README.md)
- [Schema Definitions](../spec/schemas/)
- [Relationship Catalog](../spec/schemas/base/predicates.json)

## Migration from Phase 1

Phase 1 used a standalone `SpecDataLoader` in `scripts/export-spec-to-neo4j.ts`.

Phase 2 extracts this into a reusable CLI component:

**Before (Phase 1):**
```bash
node scripts/export-spec-to-neo4j.ts
```

**After (Phase 2):**
```typescript
import { SpecDataService } from '@documentation-robotics/cli';

const service = new SpecDataService();
await service.initialize();
// Use service for all spec queries
```

The Phase 2 implementation:
- ✅ Provides same core functionality as Phase 1
- ✅ Adds high-level service layer
- ✅ Includes comprehensive tests (38 unit + 24 integration)
- ✅ Provides rich query API
- ✅ Enables CLI command integration
- ✅ Supports caching and performance optimization

## Contributing

When modifying the SpecDataLoader:

1. Update both type files and implementation
2. Add unit tests for new functionality
3. Add integration tests with real spec data
4. Update this documentation
5. Run full test suite: `npm test`

## Support

For issues or questions:
- Check test cases for usage examples
- Review integration tests for real-world scenarios
- See `docs/SPEC_DATA_LOADER.md` for detailed API documentation
- File an issue on GitHub
