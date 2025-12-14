# ✅ GraphML Export

## Overview

This new feature provides a simple way to export the entire specification ontology as a GraphML file, which can be easily visualized using popular graph tools like yEd, Gephi, or Cytoscape. This allows architects and engineers to explore the architecture layers, link types, and relationships visually without needing to set up a graph database.

### 1. GraphML Exporter Script ✅

**File**: `scripts/tools/export_graphml.py`

**Features**:

- Pure Python (no dependencies except stdlib)
- Exports to standard GraphML format
- Three export modes: standard, full (with entities), minimal
- Clean, well-documented code

### 2. Generated Visualizations ✅

**Files created**:

- `reports/visualization/spec-ontology.graphml` (47 KB)
  - 81 nodes (12 Layers + 38 LinkTypes + 31 Predicates)
  - 130 edges (relationships)

- `reports/visualization/spec-ontology-full.graphml` (larger)
  - 292 nodes (includes 211 EntityTypes)
  - 348 edges

### 3. Documentation ✅

- `reports/visualization/README.md` - Technical reference
- `docs/guides/graph-visualization-quickstart.md` - User guide

## Quick Start

### Generate GraphML

```bash
# Standard export (recommended)
python scripts/tools/export_graphml.py

# With all entity types
python scripts/tools/export_graphml.py --include-entities

# Minimal (layers and links only)
python scripts/tools/export_graphml.py --minimal
```

### Visualize

**Option 1: yEd (Easiest)**

1. Download: https://www.yworks.com/products/yed/download
2. Open `reports/visualization/spec-ontology.graphml`
3. Layout → Hierarchical
4. Done! Interactive graph in seconds

**Option 2: Gephi (Most Powerful)**

1. Download: https://gephi.org/
2. Open `reports/visualization/spec-ontology-full.graphml`
3. Layout → Force Atlas 2
4. Analyze with built-in metrics

**Option 3: Cytoscape (Scientific)**

1. Download: https://cytoscape.org/
2. Import network from file
3. Apply layouts and analysis

## What You Can Do

### Explore the Architecture

- See all 12 layers and how they connect
- Identify which layers link to motivation/security/etc.
- Understand the layer hierarchy

### Analyze Link Types

- 38 different cross-layer link types
- Categorized: motivation, business, security, archimate, api, data, apm, ux, navigation
- See which links are critical (high betweenness centrality)

### Trace Relationships

- Follow traceability from goals → requirements → implementation
- Find shortest paths between layers
- Identify dependency chains

### Validate the Ontology

- Find disconnected components
- Identify over/under-connected layers
- Discover gaps in coverage

## Graph Structure

### Node Types

1. **Layer** (12) - The 12 architectural layers
2. **LinkType** (38) - Cross-layer reference types
3. **Predicate** (31) - Semantic relationship types
4. **EntityType** (211, optional) - Entity definitions from schemas

### Edge Types

1. **LINKS_FROM** - LinkType to source Layer
2. **LINKS_TO** - LinkType to target Layer
3. **USES_PREDICATE** - LinkType to Predicate it uses
4. **INVERSE_OF** - Predicate to its inverse
5. **DEFINES** - Layer to EntityTypes it defines
6. **TARGETS_ENTITY** - LinkType to target EntityType

## Example Queries

### In yEd

- "Which layers link to Motivation?" → Select layer_01, right-click → Select Incoming Edges
- "Show me traceability links" → Filter edges by category = "traceability"

### In Gephi

- "Most important link types" → Statistics → Betweenness Centrality → Sort by score
- "Find clusters" → Statistics → Modularity → Color by modularity class

### In Cytoscape

- "Path from Goal to API" → Select layer_01 and layer_06 → Shortest Path
- "Entity dependencies" → Open full export → Analyze network topology

## Export Details

### Standard Export (Default)

```
Nodes by Type:
  Layer.........................     12
  LinkType......................     38
  Predicate.....................     31
  Total Nodes...................     81

Edges by Relationship:
  INVERSE_OF....................     31
  LINKS_FROM....................     56
  LINKS_TO......................     38
  USES_PREDICATE................      5
  Total Edges...................    130
```

### Full Export (--include-entities)

```
Nodes by Type:
  EntityType....................    211
  Layer.........................     12
  LinkType......................     38
  Predicate.....................     31
  Total Nodes...................    292

Edges by Relationship:
  DEFINES.......................    211
  INVERSE_OF....................     31
  LINKS_FROM....................     56
  LINKS_TO......................     38
  TARGETS_ENTITY................      7
  USES_PREDICATE................      5
  Total Edges...................    348
```

## Advantages Over Database

### Why GraphML is Great

✅ **No installation** - Just Python stdlib, no database needed
✅ **Standard format** - Works with all major graph tools
✅ **Portable** - Share files via email, git, etc.
✅ **Visual** - See the ontology immediately
✅ **Flexible** - Use any visualization tool you prefer
✅ **Fast** - Generate in seconds, load instantly
✅ **Cross-platform** - Works on Mac, Linux, Windows

### When to Use Each Tool

**yEd**: Quick viewing, creating documentation diagrams
**Gephi**: Deep analysis, metrics, finding patterns
**Cytoscape**: Pathway analysis, biological-style networks
**Neo4j**: If you need a queryable graph database later

## Integration with Workflow

### Update Process

```bash
# 1. Edit schemas
vim spec/schemas/06-api-layer.schema.json

# 2. Regenerate link registry (if needed)
python scripts/generators/link_registry_generator.py

# 3. Export GraphML
python scripts/tools/export_graphml.py

# 4. Open in visualization tool
# yEd, Gephi, or Cytoscape

# 5. Validate changes visually
```

### CI/CD Integration

```yaml
# Add to .github/workflows/validate.yml
- name: Generate GraphML
  run: python scripts/tools/export_graphml.py

- name: Upload visualization
  uses: actions/upload-artifact@v3
  with:
    name: spec-visualization
    path: reports/visualization/spec-ontology.graphml
```

## Files to Visualize

All generated and ready:

- ✅ `reports/visualization/spec-ontology.graphml`
- ✅ `reports/visualization/spec-ontology-full.graphml`

## Documentation

Everything you need:

- ✅ `scripts/tools/export_graphml.py --help`
- ✅ `reports/visualization/README.md`
- ✅ `docs/guides/graph-visualization-quickstart.md`

## Next Steps

### For You Right Now

1. **Download yEd** (5 minutes): https://www.yworks.com/products/yed/download
2. **Open the file** (10 seconds): File → Open → `spec-ontology.graphml`
3. **Apply layout** (5 seconds): Layout → Hierarchical
4. **Explore!** Interactive visualization of your entire spec

### For Later

- Try Gephi for network analysis
- Export high-res images for documentation
- Share GraphML files with team
- Create custom filtered exports

## Success

You now have:

- ✅ Working graph export (no database needed)
- ✅ Two GraphML files ready to visualize
- ✅ Complete documentation
- ✅ Multiple visualization tool options
- ✅ Integration with existing workflow

The GraphML export gives you everything you need to:

- Explore the ontology visually
- Analyze layer dependencies
- Validate traceability
- Share with team
- Document the architecture

**And it works right now!** 🎉
