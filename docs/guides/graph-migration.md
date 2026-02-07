# Graph Migration Guide

Transform your architecture models to graph database formats for visualization, analysis, and integration with graph tools.

## Overview

The graph migration feature enables you to export your Documentation Robotics architecture models to various graph database formats:

- **Neo4j** - Industry-leading graph database with powerful query language (Cypher)
- **LadybugDB** - Lightweight graph database optimized for analysis and visualization
- **Gremlin** - Apache Gremlin graph traversal language for distributed graph processing
- **GraphML** - Standard XML format for graph interchange

## Quick Start

### Migrate to Neo4j

Generate a Cypher script for importing your model into Neo4j:

```bash
dr graph-migrate neo4j --output model.cypher
```

Then import into your Neo4j instance:

```bash
# Using neo4j-admin
neo4j-admin import --from-neo4j-uri=file:///path/to/model.cypher

# Or using Neo4j Browser
# Open Neo4j Browser and paste the Cypher commands
```

### Migrate to LadybugDB

Generate a LadybugDB JSON document:

```bash
dr graph-migrate ladybug --output model.lbug.json
```

Import into LadybugDB:

```bash
ladybug import model.lbug.json
```

### Migrate to Gremlin

Generate Apache Gremlin script:

```bash
dr graph-migrate gremlin --output model.groovy
```

Execute in Gremlin console:

```bash
bin/gremlin.sh < model.groovy
```

## Command Reference

### Basic Syntax

```bash
dr graph-migrate <format> [options]
```

### Formats

| Format  | Description           | Use Case                     |
| ------- | --------------------- | ---------------------------- |
| neo4j   | Neo4j Cypher script   | Production graph database    |
| cypher  | Alias for neo4j       | Same as neo4j                |
| ladybug | LadybugDB JSON        | Lightweight analysis         |
| gremlin | Apache Gremlin Groovy | Distributed graph processing |
| graphml | GraphML XML           | Graph visualization tools    |

### Options

```
--output <path>          Output file path
--model <path>          Path to model root directory
--dry-run               Preview migration without writing files
--validate              Validate model before migration (default: true)
--drop-existing         Drop existing data in Neo4j before import
--batch-size <size>     Batch size for database imports (default: 1000)
--include-properties    Include element properties in migration (default: true)
--include-metadata      Include metadata in migration (default: true)
--compress              Compress output (LadybugDB only)
```

## Common Tasks

### Preview Migration Before Executing

Use `--dry-run` to see what would be generated:

```bash
dr graph-migrate neo4j --dry-run
```

Output preview:

```
📊 Graph Database Migration

Transforming model to NEO4J format

Output: model-neo4j-2025-02-07T23-26-00.cypher

Neo4j Migration Summary:
  Nodes processed: 45
  Edges processed: 123
  Layers: motivation, business, api, data-model, ux

[DRY RUN] Would write 5234 characters to model-neo4j-2025-02-07T23-26-00.cypher
```

### Validate Model Before Migration

Enable validation to check for issues:

```bash
dr graph-migrate neo4j --validate --output model.cypher
```

Validation checks:

- Node ID uniqueness
- Reference integrity (no dangling edges)
- Layer completeness
- Relationship consistency

### Migrate Specific Model Directory

```bash
dr graph-migrate ladybug --model /path/to/model --output graph.json
```

### Exclude Properties for Smaller Output

Reduce file size by excluding properties:

```bash
dr graph-migrate neo4j --include-properties false --output model.cypher
```

### Batch Processing Large Models

For very large models, configure batch size:

```bash
dr graph-migrate neo4j --batch-size 500 --output model.cypher
```

Smaller batch sizes = better memory usage but slower imports
Larger batch sizes = faster imports but higher memory usage

## Format-Specific Guides

### Neo4j Migration

#### Setup

1. Install Neo4j (Community or Enterprise)
2. Start Neo4j server

#### Generate Cypher Script

```bash
dr graph-migrate neo4j --output architecture.cypher
```

The script includes:

- Constraint definitions (unique node IDs)
- Index definitions (layer, type)
- Data load commands
- Example queries for validation

#### Execute Migration

Option 1 - Using neo4j-admin:

```bash
neo4j-admin import --from-neo4j-uri=file:///absolute/path/to/architecture.cypher
```

Option 2 - Using Neo4j Browser:

1. Open Neo4j Browser (http://localhost:7474)
2. Copy the script content
3. Paste into the query editor
4. Execute

#### Verify Migration

Query your imported data:

```cypher
// Count nodes by layer
MATCH (n:Element)
RETURN n.layer AS layer, COUNT(*) AS count
ORDER BY layer;

// Find all API endpoints
MATCH (n:Element {layer: 'api', type: 'endpoint'})
RETURN n.name, n.id;

// Find relationships between layers
MATCH (a:Element)-[r]->(b:Element)
WHERE a.layer <> b.layer
RETURN a.layer, type(r), b.layer, COUNT(*) AS count
ORDER BY a.layer, b.layer;
```

### LadybugDB Migration

#### Setup

1. Install LadybugDB: `npm install -g ladybugdb` or `pip install ladybugdb`
2. Create database directory

#### Generate Document

```bash
dr graph-migrate ladybug --output architecture.lbug.json
```

The JSON document includes:

- Schema definitions (node types, relationships)
- Metadata (model name, creation timestamp)
- All nodes and edges with properties
- Index definitions for efficient querying

#### Import into LadybugDB

```bash
ladybug create architecture.lbugdb
ladybug import architecture.lbugdb architecture.lbug.json
```

#### Query Your Graph

```javascript
// Using LadybugDB query language
db.nodes()
  .filter((n) => n.layer === "api")
  .select("name", "type");

// Find connected components
db.paths({
  source: { type: "endpoint" },
  maxHops: 3,
  relationship: "REFERENCES",
});
```

### Gremlin Migration

#### Setup

1. Download Apache TinkerPop: https://tinkerpop.apache.org/
2. Install Gremlin server
3. Configure graph backend (Neo4j, JanusGraph, etc.)

#### Generate Script

```bash
dr graph-migrate gremlin --output architecture.groovy
```

#### Execute Script

```bash
bin/gremlin.sh < architecture.groovy
```

#### Traverse Your Graph

```groovy
// Count nodes by layer
g.V().group().by('layer').by(count())

// Find all references from API layer
g.V().has('layer', 'api').outE('REFERENCES').inV().values('name')

// Calculate distance between nodes
g.V('api.endpoint.create-order')
  .repeat(outE().inV())
  .until(has('id', 'data-model.entity.order'))
  .path()
  .count()
```

### GraphML Migration

#### Usage

```bash
dr graph-migrate graphml --output architecture.graphml
```

Or use the export command:

```bash
dr export graphml --output architecture.graphml
```

#### Visualization Tools

Open the GraphML file in:

- **yEd** - Free graph editor with auto-layout algorithms
- **Cytoscape** - Open-source software for complex network analysis
- **Gephi** - Network visualization and analysis platform
- **Neo4j Bloom** - Neo4j's graph visualization tool

#### Example - Opening in yEd

1. Download yEd from https://www.yworks.com/products/yed
2. Open the GraphML file: File → Open
3. Apply layout: Layout → One of several auto-layout options
4. Export to image: File → Export

## Advanced Usage

### Incremental Migration

For large models, migrate by layers:

```bash
# Migrate only API layer
dr export graphml --layers api --output api.graphml

# Migrate multiple layers
dr export graphml --layers api,data-model,ux --output layers.graphml
```

### CI/CD Integration

Automatically generate graph exports during build:

```yaml
# GitHub Actions example
- name: Generate graph migrations
  run: |
    dr graph-migrate neo4j --output model.cypher
    dr graph-migrate ladybug --output model.json
    dr graph-migrate gremlin --output model.groovy

- name: Upload artifacts
  uses: actions/upload-artifact@v3
  with:
    name: graph-exports
    path: |
      model.cypher
      model.json
      model.groovy
```

### Batch Processing Script

Process multiple models:

```bash
#!/bin/bash

for model_dir in models/*/; do
  model_name=$(basename "$model_dir")
  echo "Migrating $model_name..."

  dr graph-migrate neo4j \
    --model "$model_dir" \
    --output "exports/${model_name}.cypher"

  dr graph-migrate ladybug \
    --model "$model_dir" \
    --output "exports/${model_name}.json"
done
```

### Custom Analysis Scripts

Use exported formats for custom analysis:

```python
# analyze-graph.py - Analyze LadybugDB export
import json

with open('model.lbug.json') as f:
    data = json.load(f)

# Count nodes by type
type_counts = {}
for node in data['data']['nodes']:
    node_type = node['properties']['type']
    type_counts[node_type] = type_counts.get(node_type, 0) + 1

print("Node counts by type:")
for node_type, count in sorted(type_counts.items()):
    print(f"  {node_type}: {count}")
```

## Troubleshooting

### "Migration failed: No nodes found"

**Cause**: Model is empty or layers not loaded
**Solution**: Ensure model is initialized and contains elements

```bash
# Check model status
dr info

# Add elements if needed
dr add api endpoint test --name "Test"

# Try migration again
dr graph-migrate neo4j --output model.cypher
```

### "Graph validation failed: dangling references"

**Cause**: Elements reference non-existent targets
**Solution**: Validate model first

```bash
# Run validation
dr validate --relationships

# Fix broken references
dr show <element-id>
dr update <element-id> --properties '{...}'
```

### "Cypher script execution failed"

**Cause**: Neo4j version incompatibility or syntax error
**Solution**:

1. Check Neo4j version: `neo4j --version`
2. Review generated script for errors
3. Try executing without constraints first:

```cypher
// Comment out constraint creation temporarily
// CREATE CONSTRAINT element_id ...

// Execute data import
UNWIND $nodes AS nodeData
CREATE (n:Element) SET n = nodeData.properties
```

### "LadybugDB import failed"

**Cause**: Invalid JSON or schema mismatch
**Solution**: Validate JSON first

```bash
# Validate JSON
cat model.lbug.json | jq .

# Try simpler import
ladybug import --skip-schema model.lbug.json
```

## Performance Tips

### Optimize for Large Models

1. **Exclude unnecessary properties**:

   ```bash
   dr graph-migrate neo4j --include-properties false --output model.cypher
   ```

2. **Use batch processing**:

   ```bash
   dr graph-migrate neo4j --batch-size 5000 --output model.cypher
   ```

3. **Migrate by layers** instead of all at once:

   ```bash
   for layer in api business data-model; do
     dr export graphml --layers "$layer" --output "$layer.graphml"
   done
   ```

### Database Optimization

**For Neo4j**:

```cypher
-- Add these after import
CREATE INDEX element_name FOR (n:Element) ON (n.name);
CREATE INDEX element_type FOR (n:Element) ON (n.type);

-- Analyze query performance
EXPLAIN MATCH (n)-[r]->(m) WHERE n.layer = 'api' RETURN n, r, m;
```

**For LadybugDB**:

- Use materialized views for frequently accessed data
- Create composite indexes on common query patterns
- Archive older versions to separate databases

## API Reference

### GraphMigrationService

```typescript
import { GraphMigrationService, GraphFormat } from "@documentation-robotics/cli";

const service = new GraphMigrationService(model, {
  includeProperties: true,
  includeMetadata: true,
  validateReferences: true,
});

const result = await service.migrate(GraphFormat.NEO4J);
// Returns: { success, nodeCount, edgeCount, layersProcessed, warnings, errors, duration, format }
```

### Neo4jMigrationService

```typescript
import { Neo4jMigrationService } from "@documentation-robotics/cli";

const service = new Neo4jMigrationService({
  uri: "bolt://localhost:7687",
  username: "neo4j",
  password: "password",
});

const result = await service.generateMigrationScript(nodes, edges);
// Returns: { success, scriptContent, warnings, errors }

const { nodesCsv, edgesCsv } = service.generateImportCsvFiles(nodes, edges);
```

### LadybugMigrationService

```typescript
import { LadybugMigrationService } from "@documentation-robotics/cli";

const service = new LadybugMigrationService({
  includeMetadata: true,
  formatVersion: "1.0.0",
});

const document = await service.generateLadybugDocument(
  nodes,
  edges,
  "My Model",
  "Model description"
);

const json = service.serializeToJson(document);
const validation = service.validateGraph(nodes, edges);
```

## See Also

- [Export Guide](./export.md) - Export to other formats
- [Validation Guide](./validation.md) - Validate your models
- [CLI Reference](../cli-reference.md) - Full command reference

## Next Steps

- Learn about [graph database queries](./graph-queries.md)
- Set up [automated exports in CI/CD](./ci-cd-integration.md)
- Explore [visualization tools](./visualization-tools.md)
