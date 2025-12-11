# Documentation Robotics Ontology Visualizations

This directory contains graph visualizations of the Documentation Robotics specification ontology.

## GraphML Exports

### Files

1. **`spec-ontology.graphml`** (47 KB)
   - **Nodes**: 81 (12 Layers + 38 LinkTypes + 31 Predicates)
   - **Edges**: 130 relationships
   - **Best for**: Overview of layer structure and link types
   - **Recommended tool**: yEd, Gephi

2. **`spec-ontology-full.graphml`** (larger)
   - **Nodes**: 292 (includes 211 EntityTypes from schemas)
   - **Edges**: 348 relationships
   - **Best for**: Complete ontology with all entity definitions
   - **Recommended tool**: Gephi, Cytoscape

### Graph Structure

#### Node Types

- **Layer** (12 nodes)
  - Properties: `name`, `description`, `layer`
  - Example: "Motivation Layer", "API Layer"

- **LinkType** (38 nodes)
  - Properties: `name`, `category`, `predicate`, `strength`, `bidirectional`
  - Example: "supports-goals", "fulfills-requirements"

- **Predicate** (31 nodes)
  - Properties: `name`, `category`, `description`
  - Example: "realizes", "composes", "triggers"

- **EntityType** (211 nodes, full export only)
  - Properties: `name`, `layer`, `description`
  - Example: "Goal", "Requirement", "APIOperation"

#### Edge Types

- **LINKS_FROM**: LinkType → Layer (source)
- **LINKS_TO**: LinkType → Layer (target)
- **USES_PREDICATE**: LinkType → Predicate
- **INVERSE_OF**: Predicate → Predicate
- **DEFINES**: Layer → EntityType (full export only)
- **TARGETS_ENTITY**: LinkType → EntityType (full export only)

## Visualization Tools

### yEd (Recommended for quick viewing)

**Install**: https://www.yworks.com/products/yed/download

**Usage**:
1. Open yEd
2. File → Open → Select `spec-ontology.graphml`
3. Layout → Hierarchical or Organic

**Tips**:
- Use color coding by node type
- Apply hierarchical layout for layer view
- Use organic layout for cluster analysis

### Gephi (Recommended for analysis)

**Install**: https://gephi.org/users/download/

**Usage**:
1. Open Gephi
2. File → Open → Select `spec-ontology.graphml`
3. Choose "Directed Graph"
4. Run Layout algorithm (Force Atlas 2, Fruchterman-Reingold)

**Tips**:
- Color nodes by "type" attribute
- Size nodes by degree centrality
- Use "Filter" to show specific node types
- Export high-res images for documentation

### Cytoscape (Recommended for biological-style analysis)

**Install**: https://cytoscape.org/download.html

**Usage**:
1. Open Cytoscape
2. File → Import → Network from File
3. Select `spec-ontology-full.graphml`
4. Apply layout (Prefuse Force Directed, Hierarchical)

**Tips**:
- Use "VizMapper" for styling
- Apply different colors per node type
- Export to PNG/PDF/SVG

### Neo4j (For graph database import)

**Import GraphML**:
```cypher
// Using APOC plugin
CALL apoc.import.graphml("file:///spec-ontology.graphml", {})
```

**Or use `neo4j-admin` tool**:
```bash
neo4j-admin database import full \
  --nodes=spec-ontology.graphml \
  --relationships=spec-ontology.graphml
```

## Regenerating Exports

### Standard Export
```bash
python scripts/tools/export_graphml.py
```

### With Entity Types
```bash
python scripts/tools/export_graphml.py --include-entities
```

### Minimal (Layers and Links only)
```bash
python scripts/tools/export_graphml.py --minimal
```

### Custom Output Path
```bash
python scripts/tools/export_graphml.py --output custom-path.graphml
```

## Example Visualizations

### Layer Architecture View

Use yEd with Hierarchical layout:
- Layers at the top
- LinkTypes in the middle
- Predicates at the bottom

**Recommended colors**:
- Layers: Blue gradient (01=darkest, 12=lightest)
- LinkTypes: By category (motivation=gold, security=red, etc.)
- Predicates: By category (structural=green, behavioral=orange)

### Dependency Analysis

Use Gephi with Force Atlas 2:
- Identify highly connected layers
- Find critical link types (high betweenness centrality)
- Discover isolated or weakly connected components

**Metrics to calculate**:
- Degree centrality (which layers have most links?)
- Betweenness centrality (which links are critical bridges?)
- Clustering coefficient (which predicates form tight groups?)

### Traceability Pathfinding

Use Cytoscape with edge filtering:
1. Filter edges by `relationship = "LINKS_TO"`
2. Color edges by `category` attribute
3. Show only traceability relationships
4. Calculate shortest paths from implementation → motivation

## Analysis Examples

### Question 1: Which layer is most connected?

**In Gephi**:
1. Statistics → Average Degree
2. Sort nodes by degree
3. Answer: Layer with most LINKS_FROM + LINKS_TO edges

### Question 2: What are the critical link types?

**In yEd**:
1. Select all LinkType nodes
2. Tools → Analyze → Centrality → Betweenness
3. Nodes with high betweenness bridge multiple layers

### Question 3: How do requirements trace to implementation?

**In Cytoscape**:
1. Filter: Show only "traceability" category edges
2. Select "Motivation Layer" node
3. Tools → Shortest Path → Find paths to API/Application layers

## Export Statistics

### Standard Export (spec-ontology.graphml)
- File size: ~47 KB
- Load time: < 1 second
- Suitable for: All visualization tools

### Full Export (spec-ontology-full.graphml)
- File size: ~200+ KB
- Load time: 1-5 seconds
- Suitable for: Gephi, Cytoscape (may be cluttered in yEd)

## Customization

### Adding Custom Attributes

Edit `scripts/tools/export_graphml.py` to add more node/edge attributes:

```python
# In create_graphml_structure(), add new key definitions:
('d8', 'node', 'custom_attr', 'string'),

# In add_node(), include in attributes dict:
attributes={'custom_attr': 'value'}
```

### Filtering Exports

Create filtered exports for specific use cases:

```python
# Export only security-related links
python scripts/tools/export_graphml.py --filter-category security

# Export only specific layers
python scripts/tools/export_graphml.py --layers 01,02,06
```

(Note: These filters would need to be added to the script)

## Troubleshooting

### File won't open in yEd
- **Cause**: XML formatting issue
- **Fix**: Validate XML: `xmllint spec-ontology.graphml`

### Gephi crashes on large graph
- **Cause**: Too many entities in full export
- **Fix**: Use standard export without entities

### Colors not showing
- **Cause**: GraphML doesn't include visual styling
- **Fix**: Apply styling in the visualization tool after import

### Missing edges
- **Cause**: Nodes referenced in edges don't exist
- **Fix**: Check export log for warnings

## Resources

- **GraphML Specification**: http://graphml.graphdrawing.org/
- **yEd Manual**: https://yed.yworks.com/support/manual/
- **Gephi Documentation**: https://gephi.org/users/
- **Cytoscape Manual**: https://manual.cytoscape.org/

## Next Steps

After visualization:

1. **Identify gaps** - Layers or link types with low connectivity
2. **Validate traceability** - Ensure paths exist from goals → implementation
3. **Find critical dependencies** - High centrality nodes are critical to spec
4. **Document findings** - Export high-res images for spec documentation
