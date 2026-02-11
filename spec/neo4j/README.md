# Spec Metadata Neo4j Export

This directory contains Neo4j exports of the Documentation Robotics specification metadata (the schema definitions, not model instances).

## Overview

The spec metadata export captures the **structure** of the 12-layer architecture model:

- **354 SpecNode types** - Element types like `motivation.goal`, `api.endpoint`
- **252 SpecRelationship types** - Allowed relationships between types
- **47 Predicates** - Semantic relationship types (influence, realizes, etc.)
- **12 Layers** - Motivation, Business, Security, Application, etc.
- **AttributeSpec nodes** - Type-specific attributes with validation rules

This is distinct from model instance data (user's actual architecture elements), which is exported via `dr graph-migrate`.

## Quick Start (Recommended)

The easiest way to explore the spec in Neo4j:

```bash
# One command to start Neo4j and import data
./spec/neo4j/launch-neo4j.sh

# Open the provided URL in your browser
# Username: neo4j, Password: password
```

The launch script will:

- Start a Neo4j container automatically
- Import the spec metadata (or skip if already loaded)
- Provide a clickable URL to explore the data

**To stop Neo4j:**

```bash
docker stop doc-robotics-neo4j
```

**To remove container and data:**

```bash
docker rm doc-robotics-neo4j
```

## Files

- `import.cypher` - Cypher script for importing spec metadata (generated, **now tracked in git**)
- `csv/` - CSV files for bulk import via neo4j-admin (generated, **now tracked in git**)
  - `nodes.csv` - All node data
  - `edges.csv` - All relationship data
  - `import.sh` - Shell script for neo4j-admin import
- `launch-neo4j.sh` - One-command launcher script (**recommended**)
- `README.md` - This file
- `.gitignore` - Updated to track generated files

## Alternative Usage Methods

If you need more control than the launch script, you can use these methods:

### Option 1: Cypher Script (Interactive)

```bash
# Start Neo4j
docker run -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/password neo4j:latest

# Load script
cat spec/neo4j/import.cypher | cypher-shell -u neo4j -p password
```

### Option 2: CSV Bulk Import (Fast)

```bash
cd spec/neo4j/csv/
./import.sh
```

## Regenerating

To regenerate these files after spec changes:

```bash
# From repository root
node scripts/export-spec-to-neo4j.ts
```

Or add to package.json and use:

```bash
npm run export:spec-neo4j
```

## Graph Schema

### Node Types

**SpecNode** (354 nodes)

- Properties: `spec_node_id`, `layer_id`, `type`, `title`, `description`, `required_attribute_count`, `total_attribute_count`
- Labels: `SpecNode`, `SpecNode_{layer}`
- Example: `motivation.goal`, `api.endpoint`

**SpecRelationship** (252 nodes)

- Properties: `id`, `source_spec_node_id`, `destination_spec_node_id`, `predicate`, `cardinality`, `strength`, `required`
- Labels: `SpecRelationship`
- Example: `motivation.influence.motivation` (goal → assessment)

**Predicate** (47 nodes)

- Properties: `predicate`, `inverse`, `category`, `description`, `archimate_alignment`, `directionality`, `transitivity`, `symmetry`
- Labels: `Predicate`
- Example: `influence`, `realizes`, `depends-on`

**Layer** (12 nodes)

- Properties: `id`, `number`, `name`, `description`, `standard`, `standard_version`, `node_type_count`
- Labels: `Layer`
- Example: `motivation` (layer 1), `api` (layer 6)

**AttributeSpec** (varies by schema)

- Properties: `id`, `spec_node_id`, `name`, `type`, `format`, `required`, `description`
- Labels: `AttributeSpec`
- Example: `motivation.goal.priority` (required string attribute)

**PredicateCategory** (12 nodes, synthetic)

- Properties: `name`
- Labels: `PredicateCategory`
- Example: `structural`, `behavioral`, `dependency`

### Relationship Types

1. **BELONGS_TO_LAYER**: SpecNode → Layer
2. **HAS_SOURCE**: SpecRelationship → SpecNode (source type)
3. **HAS_TARGET**: SpecRelationship → SpecNode (target type)
4. **USES_PREDICATE**: SpecRelationship → Predicate
5. **HAS_ATTRIBUTE**: SpecNode → AttributeSpec (with `order` property)
6. **IN_CATEGORY**: Predicate → PredicateCategory

## Verification Queries

After import, run these queries in Neo4j Browser to validate:

```cypher
// 1. Count validation
MATCH (n:SpecNode) RETURN COUNT(n) AS specNodes; // Expected: 354
MATCH (n:SpecRelationship) RETURN COUNT(n) AS specRelationships; // Expected: 252
MATCH (n:Predicate) RETURN COUNT(n) AS predicates; // Expected: 47
MATCH (n:Layer) RETURN COUNT(n) AS layers; // Expected: 12

// 2. Relationship integrity
MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(sn:SpecNode)
WHERE sr.source_spec_node_id = sn.spec_node_id
RETURN COUNT(*) AS validSources; // Expected: 252

MATCH (sr:SpecRelationship)-[:HAS_TARGET]->(sn:SpecNode)
WHERE sr.destination_spec_node_id = sn.spec_node_id
RETURN COUNT(*) AS validTargets; // Expected: 252

// 3. Orphan detection
MATCH (sr:SpecRelationship)
WHERE NOT EXISTS((sr)-[:HAS_SOURCE]->()) OR NOT EXISTS((sr)-[:HAS_TARGET]->())
RETURN COUNT(*) AS orphans; // Expected: 0
```

## Example Analysis Queries

### Cross-Layer Relationship Patterns

```cypher
// Find which layers connect to which layers
MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(source:SpecNode)-[:BELONGS_TO_LAYER]->(l1:Layer)
MATCH (sr)-[:HAS_TARGET]->(target:SpecNode)-[:BELONGS_TO_LAYER]->(l2:Layer)
WHERE l1.id <> l2.id
RETURN l1.name AS sourceLayer, l2.name AS targetLayer, COUNT(sr) AS relationships
ORDER BY relationships DESC;
```

### Most Connected Node Types

```cypher
// Find hub types with most relationships
MATCH (sn:SpecNode)
WITH sn, size((sn)<-[:HAS_SOURCE]-()) + size((sn)<-[:HAS_TARGET]-()) AS connections
RETURN sn.spec_node_id, sn.type, connections
ORDER BY connections DESC
LIMIT 10;
```

### Predicate Usage Analysis

```cypher
// Which predicates are used most?
MATCH (sr:SpecRelationship)-[:USES_PREDICATE]->(p:Predicate)
RETURN p.predicate, p.category, COUNT(sr) AS usage
ORDER BY usage DESC;
```

### Predicate Categories

```cypher
// Group predicates by category
MATCH (p:Predicate)-[:IN_CATEGORY]->(c:PredicateCategory)
RETURN c.name, COUNT(p) AS predicateCount
ORDER BY predicateCount DESC;
```

### Required Attributes by Type

```cypher
// Which node types have the most required attributes?
MATCH (sn:SpecNode)
RETURN sn.spec_node_id, sn.required_attribute_count
ORDER BY sn.required_attribute_count DESC
LIMIT 10;
```

### Layer-Specific Types

```cypher
// Show all types in a specific layer
MATCH (sn:SpecNode)-[:BELONGS_TO_LAYER]->(l:Layer {id: 'api'})
RETURN sn.type, sn.title, sn.total_attribute_count
ORDER BY sn.type;
```

### Relationship Type Details

```cypher
// Explore a specific relationship type
MATCH (sr:SpecRelationship {predicate: 'influence'})
MATCH (sr)-[:HAS_SOURCE]->(source:SpecNode)
MATCH (sr)-[:HAS_TARGET]->(target:SpecNode)
RETURN source.spec_node_id, target.spec_node_id, sr.strength, sr.cardinality;
```

### Attribute Analysis

```cypher
// Find all required attributes across the spec
MATCH (sn:SpecNode)-[:HAS_ATTRIBUTE]->(attr:AttributeSpec)
WHERE attr.required = true
RETURN sn.spec_node_id, attr.name, attr.type
ORDER BY sn.spec_node_id, attr.name;
```

## Use Cases

### 1. Schema Documentation

Explore the full type system visually in Neo4j Browser to understand allowed element types and relationships.

### 2. Impact Analysis

When modifying a node type or predicate, query to find all affected relationship schemas.

### 3. Validation Rule Discovery

Query for attribute constraints (required fields, formats) when building validators or documentation.

### 4. Cross-Layer Traceability

Understand which layers can reference which other layers through relationship analysis.

### 5. ArchiMate Alignment

Find predicates aligned with ArchiMate concepts for standards compliance.

### 6. Schema Evolution

Compare exports over time to track how the specification evolves.

## Notes

- This export is **read-only** - it documents the spec structure, not user data
- Generated files **are tracked in git** to allow exploration without regenerating
- Re-run export after modifying schemas in `spec/schemas/`: `npm run export:spec-neo4j`
- The export script is at `scripts/export-spec-to-neo4j.ts`
- For model instance data, use `dr graph-migrate` instead
