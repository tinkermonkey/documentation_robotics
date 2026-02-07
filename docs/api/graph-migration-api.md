# Graph Migration API Reference

Complete API documentation for graph migration services in the Documentation Robotics CLI.

## Table of Contents

1. [GraphMigrationService](#graphmigrationservice)
2. [Neo4jMigrationService](#neo4jmigrationservice)
3. [LadybugMigrationService](#ladybugmigrationservice)
4. [Types and Interfaces](#types-and-interfaces)

## GraphMigrationService

Main service for migrating architecture models to graph database formats.

### Constructor

```typescript
constructor(model: Model, options?: GraphMigrationOptions)
```

**Parameters:**

- `model` (Model) - The architecture model to migrate
- `options` (GraphMigrationOptions, optional) - Migration configuration

**Example:**

```typescript
import { Model } from '@documentation-robotics/cli';
import { GraphMigrationService } from '@documentation-robotics/cli';

const model = await Model.load('./my-model');
const service = new GraphMigrationService(model, {
  includeProperties: true,
  includeMetadata: true,
  validateReferences: true,
});
```

### Methods

#### migrate(format: GraphFormat): Promise<GraphMigrationResult>

Migrate the model to the specified graph format.

**Parameters:**

- `format` (GraphFormat) - Target graph format (NEO4J, LADYBUG, GRAPHML, CYPHER, or GREMLIN)

**Returns:** Promise resolving to GraphMigrationResult

**Example:**

```typescript
const result = await service.migrate(GraphFormat.NEO4J);

if (result.success) {
  console.log(`Migrated ${result.nodeCount} nodes and ${result.edgeCount} edges`);
  console.log(`Layers: ${result.layersProcessed.join(', ')}`);

  if (result.warnings.length > 0) {
    console.warn('Warnings:', result.warnings);
  }
} else {
  console.error('Migration failed:', result.errors);
}
```

## Neo4jMigrationService

Neo4j-specific migration service for generating Cypher scripts and CSV imports.

### Constructor

```typescript
constructor(options?: Neo4jMigrationOptions)
```

**Parameters:**

- `options` (Neo4jMigrationOptions, optional) - Neo4j configuration

**Options:**

```typescript
interface Neo4jMigrationOptions {
  uri?: string;                    // Default: 'bolt://localhost:7687'
  username?: string;               // Default: 'neo4j'
  password?: string;               // Default: 'password'
  database?: string;               // Default: 'neo4j'
  boltPort?: number;               // Default: 7687
  generateCypher?: boolean;         // Default: true
  createConstraints?: boolean;      // Default: true
  createIndexes?: boolean;          // Default: true
  dropExisting?: boolean;           // Default: false
  batchSize?: number;               // Default: 1000
}
```

**Example:**

```typescript
import { Neo4jMigrationService } from '@documentation-robotics/cli';

const service = new Neo4jMigrationService({
  uri: 'bolt://production.example.com:7687',
  username: 'admin',
  password: process.env.NEO4J_PASSWORD,
  database: 'architecture-model',
  batchSize: 2000,
});
```

### Methods

#### generateMigrationScript(nodes: GraphNode[], edges: GraphEdge[]): Promise<Neo4jMigrationResult>

Generate a complete Neo4j Cypher migration script.

**Parameters:**

- `nodes` (GraphNode[]) - Graph nodes to migrate
- `edges` (GraphEdge[]) - Graph edges to migrate

**Returns:** Promise resolving to Neo4jMigrationResult

**Example:**

```typescript
const result = await service.generateMigrationScript(nodes, edges);

if (result.success) {
  console.log(result.scriptContent);
  // Output: Cypher script ready for execution
} else {
  console.error('Generation failed:', result.errors);
}
```

#### generateBatchCreationScripts(nodes: GraphNode[], edges: GraphEdge[]): Promise<BatchScripts>

Generate batched Cypher scripts for large-scale imports.

**Parameters:**

- `nodes` (GraphNode[]) - Nodes to batch
- `edges` (GraphEdge[]) - Edges to batch

**Returns:** Promise with nodeScripts and edgeScripts arrays

**Example:**

```typescript
const { nodeScripts, edgeScripts } = await service.generateBatchCreationScripts(nodes, edges);

console.log(`Generated ${nodeScripts.length} node batches`);
console.log(`Generated ${edgeScripts.length} edge batches`);

// Execute each script in sequence
for (const script of nodeScripts) {
  await executeNeo4jQuery(script);
}
```

#### generateImportCsvFiles(nodes: GraphNode[], edges: GraphEdge[]): { nodesCsv: string; edgesCsv: string }

Generate CSV files for Neo4j import tool.

**Parameters:**

- `nodes` (GraphNode[]) - Nodes to export as CSV
- `edges` (GraphEdge[]) - Edges to export as CSV

**Returns:** Object with nodesCsv and edgesCsv strings

**Example:**

```typescript
const { nodesCsv, edgesCsv } = service.generateImportCsvFiles(nodes, edges);

// Save to files
await fs.writeFile('nodes.csv', nodesCsv);
await fs.writeFile('edges.csv', edgesCsv);

// Import using neo4j-admin
// neo4j-admin import --from nodes.csv edges.csv
```

## LadybugMigrationService

LadybugDB-specific migration service for generating database documents.

### Constructor

```typescript
constructor(options?: LadybugMigrationOptions)
```

**Parameters:**

- `options` (LadybugMigrationOptions, optional) - LadybugDB configuration

**Options:**

```typescript
interface LadybugMigrationOptions {
  outputPath?: string;               // Output directory
  includeMetadata?: boolean;          // Default: true
  formatVersion?: string;             // Default: '1.0.0'
  compress?: boolean;                 // Default: false
  validateGraph?: boolean;            // Default: true
}
```

**Example:**

```typescript
import { LadybugMigrationService } from '@documentation-robotics/cli';

const service = new LadybugMigrationService({
  includeMetadata: true,
  formatVersion: '1.0.0',
  compress: true,
});
```

### Methods

#### generateLadybugDocument(nodes: GraphNode[], edges: GraphEdge[], modelName: string, description?: string): Promise<LadybugDocument>

Generate a complete LadybugDB document with schema inference.

**Parameters:**

- `nodes` (GraphNode[]) - Graph nodes
- `edges` (GraphEdge[]) - Graph edges
- `modelName` (string) - Model name
- `description` (string, optional) - Model description

**Returns:** Promise resolving to LadybugDocument

**Example:**

```typescript
const doc = await service.generateLadybugDocument(
  nodes,
  edges,
  'E-Commerce Platform',
  'Complete architecture model for e-commerce system'
);

console.log(`Schema contains ${doc.schema.nodeTypes.size} node types`);
console.log(`Document created: ${doc.metadata.created}`);
```

#### serializeToJson(document: LadybugDocument): string

Serialize document to formatted JSON (human-readable).

**Parameters:**

- `document` (LadybugDocument) - Document to serialize

**Returns:** Formatted JSON string

**Example:**

```typescript
const json = service.serializeToJson(doc);
await fs.writeFile('model.lbug.json', json);
```

#### serializeToCompactJson(document: LadybugDocument): string

Serialize document to compact JSON (minimized).

**Parameters:**

- `document` (LadybugDocument) - Document to serialize

**Returns:** Compact JSON string (no whitespace)

**Example:**

```typescript
const compact = service.serializeToCompactJson(doc);
console.log(`Compact size: ${compact.length} bytes`);
```

#### generateSchemaDefinition(schema: LadybugSchema): string

Generate LadybugDB schema definition language.

**Parameters:**

- `schema` (LadybugSchema) - Schema to convert to definition language

**Returns:** Schema definition as string

**Example:**

```typescript
const schemaDef = service.generateSchemaDefinition(doc.schema);
console.log(schemaDef);
// Output:
// -- LadybugDB Schema Definition
// CREATE NODE TYPE Element { ... }
// CREATE RELATIONSHIP TYPE REFERENCES { ... }
// CREATE INDEX node_id_unique ...
```

#### validateGraph(nodes: GraphNode[], edges: GraphEdge[]): ValidationResult

Validate graph integrity before migration.

**Parameters:**

- `nodes` (GraphNode[]) - Nodes to validate
- `edges` (GraphEdge[]) - Edges to validate

**Returns:** ValidationResult with errors and warnings

**Example:**

```typescript
const validation = service.validateGraph(nodes, edges);

if (!validation.isValid) {
  console.error('Graph validation failed:');
  validation.errors.forEach(err => console.error(`  - ${err}`));
} else {
  console.log('Graph is valid');
  if (validation.warnings.length > 0) {
    console.warn('Warnings:');
    validation.warnings.forEach(w => console.warn(`  - ${w}`));
  }
}
```

## Types and Interfaces

### GraphFormat Enum

```typescript
enum GraphFormat {
  NEO4J = "neo4j",
  LADYBUG = "ladybug",
  GRAPHML = "graphml",
  CYPHER = "cypher",
  GREMLIN = "gremlin",
}
```

### GraphNode Interface

```typescript
interface GraphNode {
  id: string;                           // Unique identifier
  labels: string[];                     // Node labels/types
  properties: Record<string, unknown>;  // Node properties
}
```

**Example:**

```typescript
const apiNode: GraphNode = {
  id: 'api.endpoint.create-order',
  labels: ['Element', 'Endpoint'],
  properties: {
    name: 'Create Order',
    layer: 'api',
    type: 'endpoint',
    method: 'POST',
    path: '/api/orders',
    description: 'Creates a new order',
  },
};
```

### GraphEdge Interface

```typescript
interface GraphEdge {
  id: string;                               // Unique identifier
  source: string;                           // Source node ID
  target: string;                           // Target node ID
  relationship: string;                     // Relationship type
  properties?: Record<string, unknown>;     // Optional edge properties
}
```

**Example:**

```typescript
const edge: GraphEdge = {
  id: 'edge_1',
  source: 'api.endpoint.create-order',
  target: 'business.service.order-management',
  relationship: 'IMPLEMENTS',
  properties: {
    strength: 'strong',
    latency: 'synchronous',
  },
};
```

### GraphMigrationResult Interface

```typescript
interface GraphMigrationResult {
  success: boolean;
  nodeCount: number;
  edgeCount: number;
  layersProcessed: string[];
  warnings: string[];
  errors: string[];
  duration: number;          // Milliseconds
  format: string;
  outputSize?: number;       // Bytes
}
```

### LadybugDocument Interface

```typescript
interface LadybugDocument {
  version: string;
  metadata: {
    name: string;
    description?: string;
    created: string;         // ISO 8601
    updated: string;         // ISO 8601
    nodeCount: number;
    edgeCount: number;
  };
  schema: LadybugSchema;
  data: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
}
```

### LadybugSchema Interface

```typescript
interface LadybugSchema {
  version: string;
  nodeTypes: Map<string, NodeTypeDefinition>;
  relationshipTypes: Map<string, RelationshipTypeDefinition>;
  indexes: IndexDefinition[];
}

interface NodeTypeDefinition {
  name: string;
  properties: Record<string, PropertyType>;
  description?: string;
}

interface RelationshipTypeDefinition {
  name: string;
  sourceType: string;
  targetType: string;
  properties?: Record<string, PropertyType>;
  isDirected: boolean;
  description?: string;
}

enum PropertyType {
  STRING = "string",
  INTEGER = "integer",
  FLOAT = "float",
  BOOLEAN = "boolean",
  TIMESTAMP = "timestamp",
  JSON = "json",
}
```

### Neo4jMigrationResult Interface

```typescript
interface Neo4jMigrationResult {
  success: boolean;
  nodesCreated?: number;
  edgesCreated?: number;
  constraintsCreated?: number;
  indexesCreated?: number;
  scriptContent?: string;     // Cypher script
  warnings: string[];
  errors: string[];
}
```

## Neo4jCypherGenerator (Static Methods)

Utility class for generating Cypher scripts.

### static generateNodeCreationScript(nodes: GraphNode[]): string

```typescript
const script = Neo4jCypherGenerator.generateNodeCreationScript(nodes);
```

### static generateEdgeCreationScript(edges: GraphEdge[]): string

```typescript
const script = Neo4jCypherGenerator.generateEdgeCreationScript(edges);
```

### static generateCompleteMigrationScript(nodes: GraphNode[], edges: GraphEdge[], dropExisting?: boolean): string

```typescript
const script = Neo4jCypherGenerator.generateCompleteMigrationScript(
  nodes,
  edges,
  true  // Include drop commands
);
```

### static generateConnectionConfig(options: Neo4jMigrationOptions): Record<string, string>

```typescript
const config = Neo4jCypherGenerator.generateConnectionConfig({
  uri: 'bolt://localhost:7687',
  username: 'neo4j',
  password: 'password',
});
```

## Error Handling

All migration methods may throw or return errors in result objects.

**Example:**

```typescript
try {
  const result = await service.migrate(GraphFormat.NEO4J);

  if (!result.success) {
    result.errors.forEach(err => console.error(`Error: ${err}`));
  }
} catch (error) {
  console.error('Migration failed:', error.message);
}
```

## Performance Considerations

### Memory Usage

- **Large models**: Use `batchSize` option to process incrementally
- **Properties**: Set `includeProperties: false` to reduce memory

### Import Speed

- **CSV import**: Faster than Cypher for large datasets
- **Batch scripts**: Use `generateBatchCreationScripts()` for parallel execution

### Validation

- **Skip validation**: Set `validateReferences: false` for speed (use with caution)
- **Parallel validation**: Validates during migration, not separately

## Examples

### Complete Migration Workflow

```typescript
import {
  Model,
  GraphMigrationService,
  Neo4jMigrationService,
  GraphFormat,
} from '@documentation-robotics/cli';

async function migrateModel() {
  // Load model
  const model = await Model.load('./my-model');

  // Migrate to Neo4j
  const graphService = new GraphMigrationService(model, {
    validateReferences: true,
  });

  const result = await graphService.migrate(GraphFormat.NEO4J);

  if (!result.success) {
    console.error('Migration failed:', result.errors);
    return;
  }

  console.log(`✓ Migrated ${result.nodeCount} nodes, ${result.edgeCount} edges`);
  console.log(`  Layers: ${result.layersProcessed.join(', ')}`);
  console.log(`  Duration: ${result.duration}ms`);

  // Generate Cypher script
  const neo4jService = new Neo4jMigrationService({
    dropExisting: false,
  });

  // Note: In real usage, extract actual nodes/edges from model graph
  const nodes = []; // Extract from model
  const edges = [];  // Extract from model

  const scriptResult = await neo4jService.generateMigrationScript(nodes, edges);

  if (scriptResult.success) {
    console.log('✓ Cypher script generated');
    console.log(scriptResult.scriptContent);
  }
}

migrateModel().catch(console.error);
```

### Validation Before Migration

```typescript
import { LadybugMigrationService } from '@documentation-robotics/cli';

async function validateAndMigrate(nodes, edges) {
  const service = new LadybugMigrationService();

  // Validate graph
  const validation = service.validateGraph(nodes, edges);

  if (!validation.isValid) {
    console.error('Validation failed:');
    validation.errors.forEach(err => console.error(`  ✗ ${err}`));
    return false;
  }

  if (validation.warnings.length > 0) {
    console.warn('Validation warnings:');
    validation.warnings.forEach(w => console.warn(`  ⚠ ${w}`));
  }

  // Generate document
  const doc = await service.generateLadybugDocument(
    nodes,
    edges,
    'Valid Model'
  );

  // Serialize and save
  const json = service.serializeToJson(doc);
  return json;
}
```

## See Also

- [Graph Migration Guide](../guides/graph-migration.md) - User guide
- [CLI Reference](../cli-reference.md) - Command-line interface
- [Type Definitions](../../src/export/graph-migration.ts) - Source code
