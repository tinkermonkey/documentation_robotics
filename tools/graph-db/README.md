# Documentation Robotics Graph Database

This directory contains the LadybugDB graph database for interactive exploration of the Documentation Robotics specification ontology.

## Overview

The graph database provides an intuitive way to explore:
- 12 architectural layers
- Entity type definitions
- 38+ cross-layer link types
- Semantic predicates and relationships
- Traceability from goals to implementation
- Security and governance relationships

## Quick Start

### 1. Install LadybugDB

```bash
# Using pip
pip install real_ladybug

# Or using uv (recommended)
uv pip install real_ladybug
```

### 2. Build the Database

```bash
# From repository root
python scripts/tools/ladybug_importer.py --force

# Output: tools/graph-db/spec-ontology.lbug/
```

### 3. Query the Database

```bash
# Interactive shell
lbug tools/graph-db/spec-ontology.lbug

# Run predefined queries
python scripts/tools/ladybug_queries.py --query summary
python scripts/tools/ladybug_queries.py --all

# List available queries
python scripts/tools/ladybug_queries.py --list-queries
```

## Graph Schema

### Node Types

- **Layer**: 12 architectural layers (Motivation, Business, Security, etc.)
- **EntityType**: Entities defined in each layer schema (Stakeholder, Goal, API, etc.)
- **LinkType**: Cross-layer reference types (38+ types)
- **Predicate**: Semantic relationship predicates (supports-goals, fulfills-requirements, etc.)

### Relationship Types

- **DEFINES**: Layer → EntityType (which entities are defined in each layer)
- **LINKS_FROM**: LinkType → Layer (source layers for a link)
- **LINKS_TO**: LinkType → Layer (target layer for a link)
- **TARGETS_ENTITY**: LinkType → EntityType (specific entity types targeted)
- **USES_PREDICATE**: LinkType → Predicate (semantic predicate used)
- **INVERSE_OF**: Predicate → Predicate (inverse relationships)

## Example Queries

### List All Layers

```cypher
MATCH (l:Layer)
RETURN l.id, l.name, l.description
ORDER BY l.id;
```

### Find Traceability Links

```cypher
MATCH (lt:LinkType)
WHERE lt.relationshipCategory = 'traceability'
RETURN lt.name, lt.predicate, lt.strength
ORDER BY lt.strength DESC;
```

### Show Links to Motivation Layer

```cypher
MATCH (lt:LinkType)-[:LINKS_FROM]->(source:Layer),
      (lt)-[:LINKS_TO]->(target:Layer {id: '01'})
RETURN source.name AS From,
       lt.name AS LinkType,
       lt.predicate AS Predicate
ORDER BY source.id;
```

### Find Critical Security Links

```cypher
MATCH (lt:LinkType)
WHERE lt.category = 'security' AND lt.strength IN ['critical', 'high']
RETURN lt.name, lt.predicate, lt.strength
ORDER BY lt.strength DESC, lt.name;
```

### Analyze Predicate Usage

```cypher
MATCH (lt:LinkType)-[:USES_PREDICATE]->(p:Predicate)
RETURN p.name AS Predicate,
       p.category AS Category,
       count(lt) AS UsageCount
ORDER BY UsageCount DESC;
```

### Validate Link Target Entities

```cypher
MATCH (lt:LinkType)
WHERE NOT EXISTS {
    MATCH (lt)-[:TARGETS_ENTITY]->(:EntityType)
}
RETURN lt.id, lt.name, lt.category;
```

### Find Entity Count by Layer

```cypher
MATCH (l:Layer)-[:DEFINES]->(e:EntityType)
RETURN l.id AS LayerID,
       l.name AS LayerName,
       count(e) AS EntityCount
ORDER BY l.id;
```

### Show Cross-Layer Link Matrix

```cypher
MATCH (lt:LinkType)-[:LINKS_FROM]->(source:Layer),
      (lt)-[:LINKS_TO]->(target:Layer)
RETURN source.id AS From,
       target.id AS To,
       count(lt) AS LinkCount
ORDER BY source.id, target.id;
```

## Predefined Query Scripts

The `scripts/tools/ladybug_queries.py` script provides ready-to-use queries:

### Layer Exploration
- `list-layers` - List all 12 layers
- `layer-entity-counts` - Count entities per layer
- `layer-link-matrix` - Cross-layer link matrix

### Traceability
- `traceability-paths` - Find traceability relationships
- `motivation-links` - Links to Motivation layer
- `requirement-fulfillment` - Requirement fulfillment chains

### Security & Governance
- `security-links` - All security-related links
- `governance-predicates` - Governance relationship predicates
- `critical-links` - Critical and high-strength links

### Predicate Analysis
- `predicate-usage` - Predicate usage statistics
- `bidirectional` - Bidirectional relationships
- `predicates-without-inverse` - Predicates missing inverses

### Coverage & Gaps
- `link-categories` - Link types grouped by category
- `layers-no-outgoing` - Layers with no outgoing links
- `untargeted-entities` - Entity types not targeted by any link

### ArchiMate
- `archimate-relationships` - ArchiMate-aligned predicates
- `archimate-links` - ArchiMate category link types

### Validation
- `validate-targets` - Check link target entities exist
- `validate-predicates` - Find unused predicates

### Summary
- `summary` - Complete ontology summary

## Advanced Usage

### Python API

```python
import real_ladybug as lb

# Connect to database
db = lb.Database("tools/graph-db/spec-ontology.lbug")
conn = lb.Connection(db)

# Execute query
result = conn.execute("""
    MATCH (l:Layer)-[:DEFINES]->(e:EntityType)
    WHERE l.id = '01'
    RETURN e.name
""")

# Process results
rows = result.get_all()
for row in rows:
    print(row)
```

### Custom Queries

Create your own query files in `tools/graph-db/queries/`:

```cypher
// custom-analysis.cypher

// Find layers with most incoming links
MATCH (lt:LinkType)-[:LINKS_TO]->(target:Layer)
RETURN target.name AS Layer,
       count(lt) AS IncomingLinks
ORDER BY IncomingLinks DESC;
```

Run with:
```bash
lbug tools/graph-db/spec-ontology.lbug < tools/graph-db/queries/custom-analysis.cypher
```

## Maintenance

### Rebuild Database

After updating schemas:

```bash
python scripts/tools/ladybug_importer.py --force
```

### Validate Consistency

```bash
python scripts/tools/ladybug_queries.py --query validate-targets
python scripts/tools/ladybug_queries.py --query validate-predicates
```

### Export Results

Export query results to CSV:

```bash
lbug tools/graph-db/spec-ontology.lbug <<EOF
COPY (
  MATCH (l:Layer)
  RETURN l.id, l.name, l.description
) TO 'layers-export.csv';
EOF
```

## Troubleshooting

### Database Not Found

```
ERROR: Database not found at tools/graph-db/spec-ontology.lbug
```

**Solution**: Run the importer first:
```bash
python scripts/tools/ladybug_importer.py
```

### Import Fails

```
ERROR: Schema file not found
```

**Solution**: Ensure you're running from repository root and `spec/schemas/` exists:
```bash
ls spec/schemas/*.schema.json
```

### Query Syntax Errors

LadybugDB uses Cypher syntax. Common issues:
- Use `MATCH` for graph patterns
- Use `WHERE` for filtering
- String literals use single quotes: `'value'`
- Property access: `node.property`

### Performance Issues

For large result sets, add `LIMIT`:
```cypher
MATCH (e:EntityType)
RETURN e.name
LIMIT 100;
```

## Resources

- [LadybugDB Documentation](https://docs.ladybugdb.com/)
- [LadybugDB GitHub](https://github.com/LadybugDB/ladybug)
- [Cypher Query Language](https://neo4j.com/docs/cypher-manual/current/)
- [Graph Database Patterns](https://neo4j.com/developer/graph-database/)

## Contributing

When adding new link types or predicates:

1. Update schemas in `spec/schemas/`
2. Regenerate link registry: `python scripts/generators/link_registry_generator.py`
3. Rebuild graph database: `python scripts/tools/ladybug_importer.py --force`
4. Validate: `python scripts/tools/ladybug_queries.py --query validate-targets`
5. Add relevant queries to `ladybug_queries.py` if needed

## License

This tool is part of the Documentation Robotics specification project.
The graph database contains extracted metadata from the specification schemas.
