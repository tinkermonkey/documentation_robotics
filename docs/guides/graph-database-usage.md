# Graph Database Usage Guide for Spec Maintainers

This guide shows you how to use the LadybugDB graph database to explore and validate the Documentation Robotics specification.

## What is the Graph Database?

The graph database provides an interactive way to explore the complete spec ontology:
- **12 architectural layers** and their relationships
- **Entity type definitions** from each layer schema
- **38+ cross-layer link types** with semantic predicates
- **Traceability paths** from strategic goals to implementation details
- **Validation queries** to ensure ontological consistency

## Installation

```bash
# Install LadybugDB
pip install real_ladybug

# Build the database from spec schemas
python scripts/tools/ladybug_importer.py --force
```

This creates `tools/graph-db/spec-ontology.lbug/` containing the complete graph.

## Quick Start

### 1. Interactive Shell

```bash
# Launch LadybugDB shell
lbug tools/graph-db/spec-ontology.lbug
```

Try these queries:

```cypher
-- List all layers
MATCH (l:Layer)
RETURN l.id, l.name
ORDER BY l.id;

-- Show link types by category
MATCH (lt:LinkType)
RETURN lt.category, count(*) AS count
ORDER BY count DESC;

-- Find traceability links
MATCH (lt:LinkType)
WHERE lt.relationshipCategory = 'traceability'
RETURN lt.name, lt.predicate, lt.strength;
```

### 2. Python Query Library

```bash
# Run summary
python scripts/tools/ladybug_queries.py

# List available queries
python scripts/tools/ladybug_queries.py --list-queries

# Run specific query
python scripts/tools/ladybug_queries.py --query traceability-paths

# Run all queries
python scripts/tools/ladybug_queries.py --all
```

### 3. Saved Query Files

```bash
# Run traceability analysis
lbug tools/graph-db/spec-ontology.lbug < tools/graph-db/queries/traceability.cypher

# Run validation checks
lbug tools/graph-db/spec-ontology.lbug < tools/graph-db/queries/validation.cypher
```

## Common Use Cases

### Use Case 1: Understanding Cross-Layer Dependencies

**Question**: "Which layers reference the Security layer?"

```cypher
MATCH (lt:LinkType)-[:LINKS_FROM]->(source:Layer),
      (lt)-[:LINKS_TO]->(target:Layer {id: '03'})
RETURN DISTINCT source.name AS SourceLayer,
       count(lt) AS LinkCount
ORDER BY LinkCount DESC;
```

**Or use Python:**
```bash
python scripts/tools/ladybug_queries.py --query security-links
```

### Use Case 2: Tracing Requirements to Implementation

**Question**: "How do API operations trace back to requirements?"

```cypher
MATCH (lt:LinkType)
WHERE lt.predicate = 'fulfills-requirements'
  AND '06' IN [layer.id FOR layer IN (lt)-[:LINKS_FROM]->(layer:Layer)]
RETURN lt.name, lt.predicate, lt.strength;
```

**Or use Python:**
```bash
python scripts/tools/ladybug_queries.py --query requirement-fulfillment
```

### Use Case 3: Finding Gaps in the Ontology

**Question**: "Which entity types aren't targeted by any link?"

```cypher
MATCH (e:EntityType)
WHERE NOT EXISTS {
    MATCH (lt:LinkType)-[:TARGETS_ENTITY]->(e)
}
RETURN e.layer, e.name
ORDER BY e.layer, e.name;
```

**Or use Python:**
```bash
python scripts/tools/ladybug_queries.py --query untargeted-entities
```

### Use Case 4: Validating Bidirectional Relationships

**Question**: "Do all bidirectional links have inverse predicates?"

```cypher
MATCH (lt:LinkType)
WHERE lt.bidirectional = true
  AND (lt.inversePredicate = '' OR lt.inversePredicate IS NULL)
RETURN lt.name, lt.predicate;
```

**Or use Python:**
```bash
python scripts/tools/ladybug_queries.py --query validate-targets
```

### Use Case 5: Analyzing Predicate Usage

**Question**: "Which predicates are most commonly used?"

```cypher
MATCH (lt:LinkType)-[:USES_PREDICATE]->(p:Predicate)
RETURN p.name, p.category, count(lt) AS usageCount
ORDER BY usageCount DESC
LIMIT 10;
```

**Or use Python:**
```bash
python scripts/tools/ladybug_queries.py --query predicate-usage
```

## Workflow Integration

### When Editing Schemas

1. **Edit schema files** in `spec/schemas/`
2. **Regenerate link registry** (if needed):
   ```bash
   python scripts/generators/link_registry_generator.py
   ```
3. **Rebuild graph database**:
   ```bash
   python scripts/tools/ladybug_importer.py --force
   ```
4. **Validate changes**:
   ```bash
   python scripts/tools/ladybug_queries.py --query validate-targets
   python scripts/tools/ladybug_queries.py --query validate-predicates
   ```

### Before Committing Changes

Run validation queries to ensure consistency:

```bash
# Comprehensive validation
lbug tools/graph-db/spec-ontology.lbug < tools/graph-db/queries/validation.cypher

# Check ontology summary
python scripts/tools/ladybug_queries.py --query summary
```

## Advanced Topics

### Custom Queries

Create your own query file:

```cypher
// my-query.cypher
MATCH (lt:LinkType)
WHERE lt.strength = 'critical'
RETURN lt.name, lt.predicate
ORDER BY lt.name;
```

Run it:
```bash
lbug tools/graph-db/spec-ontology.lbug < my-query.cypher
```

### Python API

```python
import real_ladybug as lb

db = lb.Database("tools/graph-db/spec-ontology.lbug")
conn = lb.Connection(db)

result = conn.execute("""
    MATCH (l:Layer)-[:DEFINES]->(e:EntityType)
    WHERE l.id = '01'
    RETURN e.name
""")

rows = result.get_all()
for row in rows:
    print(row)
```

### Export Results

Export to CSV:

```bash
lbug tools/graph-db/spec-ontology.lbug <<EOF
COPY (
  MATCH (lt:LinkType)
  RETURN lt.id, lt.name, lt.category, lt.predicate, lt.strength
  ORDER BY lt.category, lt.name
) TO 'link-types-export.csv';
EOF
```

## Troubleshooting

### Database Not Found

```
ERROR: Database not found
```

**Solution**: Build the database first:
```bash
python scripts/tools/ladybug_importer.py
```

### No Results Returned

**Check**:
1. Database was built successfully
2. Query syntax is correct (Cypher uses `MATCH`, not `SELECT`)
3. Node/property names match exactly (case-sensitive)

### Query Timeout

For complex queries, add `LIMIT`:
```cypher
MATCH (n)
RETURN n
LIMIT 100;
```

## Best Practices

1. **Rebuild after schema changes**: Always rebuild the graph DB after updating schemas
2. **Use predefined queries**: Start with `ladybug_queries.py` queries before writing custom ones
3. **Validate regularly**: Run validation queries before committing schema changes
4. **Document custom queries**: Save useful custom queries in `tools/graph-db/queries/`
5. **Version control**: Don't commit `.lbug/` files (regenerate from schemas)

## Quick Reference

### Available Python Queries

```bash
# Layer exploration
list-layers, layer-entity-counts, layer-link-matrix

# Traceability
traceability-paths, motivation-links, requirement-fulfillment

# Security & governance
security-links, governance-predicates, critical-links

# Predicate analysis
predicate-usage, bidirectional, predicates-without-inverse

# Coverage & gaps
link-categories, layers-no-outgoing, untargeted-entities

# ArchiMate
archimate-relationships, archimate-links

# Validation
validate-targets, validate-predicates

# Summary
summary
```

### Graph Schema Quick Reference

**Node Types:**
- `Layer` - 12 architectural layers
- `EntityType` - Entities defined in schemas
- `LinkType` - Cross-layer reference types
- `Predicate` - Semantic relationship predicates

**Relationship Types:**
- `DEFINES` - Layer → EntityType
- `LINKS_FROM` - LinkType → Layer (source)
- `LINKS_TO` - LinkType → Layer (target)
- `TARGETS_ENTITY` - LinkType → EntityType
- `USES_PREDICATE` - LinkType → Predicate
- `INVERSE_OF` - Predicate → Predicate

### Common Cypher Patterns

```cypher
-- Find nodes
MATCH (n:NodeType)
WHERE n.property = 'value'
RETURN n;

-- Follow relationships
MATCH (a)-[r:REL_TYPE]->(b)
RETURN a, r, b;

-- Count
MATCH (n:NodeType)
RETURN count(n);

-- Filter
MATCH (n)
WHERE n.prop IN ['val1', 'val2']
RETURN n;

-- Order and limit
MATCH (n)
RETURN n
ORDER BY n.property DESC
LIMIT 10;
```

## Getting Help

- **LadybugDB Documentation**: https://docs.ladybugdb.com/
- **LadybugDB GitHub**: https://github.com/LadybugDB/ladybug
- **Cypher Reference**: https://neo4j.com/docs/cypher-manual/
- **Graph DB README**: `tools/graph-db/README.md`

## Next Steps

1. Build the database: `python scripts/tools/ladybug_importer.py --force`
2. Explore with Python queries: `python scripts/tools/ladybug_queries.py --all`
3. Try interactive shell: `lbug tools/graph-db/spec-ontology.lbug`
4. Review saved queries: `ls tools/graph-db/queries/`
5. Create custom analysis queries for your needs
