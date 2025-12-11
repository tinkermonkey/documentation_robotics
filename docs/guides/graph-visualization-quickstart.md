# Graph Visualization Quick Start

This guide shows you how to visualize the Documentation Robotics specification as an interactive graph.

## TL;DR - Get Started in 2 Minutes

```bash
# 1. Generate GraphML file
python scripts/tools/export_graphml.py

# 2. Download yEd (free graph editor)
# Visit: https://www.yworks.com/products/yed/download

# 3. Open the file
# File → Open → reports/visualization/spec-ontology.graphml

# 4. Apply layout
# Layout → Hierarchical → OK
```

You now have an interactive visualization of all 12 layers, 38 link types, and 31 semantic predicates!

## What You'll See

### Standard View (81 nodes, 130 edges)

- **12 Layers** (blue circles)
  - Motivation, Business, Security, Application, Technology, API, Data Model, Datastore, UX, Navigation, APM, Testing

- **38 Link Types** (colored by category)
  - motivation (gold), business (red), security (crimson), archimate (teal), api (blue), data (green), etc.

- **31 Predicates** (semantic relationships)
  - supports-goals, fulfills-requirements, realizes, composes, etc.

### Relationships Shown

- **LINKS_FROM/TO**: Which layers reference which other layers
- **USES_PREDICATE**: Which link types use which semantic predicates
- **INVERSE_OF**: Bidirectional predicate relationships

## Visualization Options

### Option 1: yEd (Easiest - Recommended for Beginners)

**Best for**: Quick exploration, creating diagrams for documentation

**Install**: https://www.yworks.com/products/yed/download (Free, cross-platform)

**Steps**:
1. Generate GraphML: `python scripts/tools/export_graphml.py`
2. Open yEd
3. File → Open → `reports/visualization/spec-ontology.graphml`
4. Layout → Hierarchical (or Organic, or Circular)
5. Edit → Properties → Style nodes by type

**Pro Tips**:
- Right-click nodes → Properties to see all attributes
- Tools → Fit Node to Label for better readability
- Use color coding: Edit → Manage Palette → Create palette from node types

### Option 2: Gephi (Most Powerful - For Deep Analysis)

**Best for**: Network analysis, finding patterns, calculating metrics

**Install**: https://gephi.org/users/download/ (Free, cross-platform)

**Steps**:
1. Generate full export: `python scripts/tools/export_graphml.py --include-entities`
2. Open Gephi
3. File → Open → `reports/visualization/spec-ontology-full.graphml`
4. Choose "Directed Graph"
5. Layout → Force Atlas 2 → Run
6. Statistics → Average Degree, Modularity, PageRank

**Pro Tips**:
- Color nodes by "type" attribute (Appearance → Nodes → Partition → type)
- Size nodes by degree (Appearance → Nodes → Ranking → Degree)
- Use Filters to show only specific node types or categories
- Export high-resolution images: File → Export → PNG/PDF/SVG

### Option 3: Cytoscape (Scientific - For Pathway Analysis)

**Best for**: Biological-style network analysis, pathway tracing

**Install**: https://cytoscape.org/download.html (Free, cross-platform)

**Steps**:
1. Generate GraphML: `python scripts/tools/export_graphml.py`
2. Open Cytoscape
3. File → Import → Network from File → `spec-ontology.graphml`
4. Layout → Prefuse Force Directed Layout
5. Style → Create visual style based on node type

**Pro Tips**:
- Use VizMapper for advanced styling
- Calculate shortest paths for traceability analysis
- Export session for reuse

### Option 4: Online Viewers (No Install Required)

**GraphOnline**: https://graphonline.ru/en/
1. Upload `spec-ontology.graphml`
2. Visualize in browser
3. Limited features but works on any device

**WebCola**: http://marvl.infotech.monash.edu/webcola/
1. Works with GraphML
2. Good for quick viewing
3. No installation needed

## Common Tasks

### Task 1: Understand Layer Dependencies

**Question**: "Which layers link to the Motivation layer?"

**In yEd**:
1. Open `spec-ontology.graphml`
2. Edit → Find → "Motivation Layer"
3. Right-click node → Select → Incoming Edges
4. See all layers that reference motivation layer

**In Gephi**:
1. Open graph
2. Filters → Topology → Neighbors → Select "Motivation Layer" node
3. Filter settings: Mode = "Predecessors"
4. See all source layers

### Task 2: Find Critical Link Types

**Question**: "Which link types connect the most layers?"

**In Gephi**:
1. Open graph
2. Statistics → Average Degree → Run
3. Data Laboratory → Nodes → Sort by "Degree" (descending)
4. Look at LinkType nodes with highest degree

**In yEd**:
1. Tools → Analyze → Centrality → Betweenness Centrality
2. View → Show Properties
3. Sort by betweenness value

### Task 3: Trace Requirements to Implementation

**Question**: "How do requirements flow from Motivation → API layer?"

**In Cytoscape**:
1. Select "layer_01" (Motivation) and "layer_06" (API)
2. Tools → Shortest Path → Find paths
3. View relationship chain

**In Gephi**:
1. Filters → Attributes → Equal → relationship → "LINKS_TO"
2. Show only LINKS_TO edges
3. Visually trace from layer 01 → layer 06

### Task 4: Analyze Predicate Usage

**Question**: "Which predicates are most commonly used?"

**In Gephi**:
1. Statistics → Degree → Run
2. Data Laboratory → Nodes → Filter by type = "Predicate"
3. Sort by "In-Degree" (how many LinkTypes use this predicate)

## Export Variants

### Standard Export (Recommended)
```bash
python scripts/tools/export_graphml.py
```
- **Size**: ~47 KB
- **Nodes**: 81 (Layers + LinkTypes + Predicates)
- **Best for**: Overview, quick analysis

### Full Export (With Entities)
```bash
python scripts/tools/export_graphml.py --include-entities
```
- **Size**: ~200+ KB
- **Nodes**: 292 (includes all 211 entity types from schemas)
- **Best for**: Complete ontology view, detailed analysis

### Minimal Export (Layers Only)
```bash
python scripts/tools/export_graphml.py --minimal
```
- **Size**: ~10 KB
- **Nodes**: 50 (just Layers and LinkTypes)
- **Best for**: High-level architecture view

## Styling Recommendations

### Color Scheme by Category

Use these colors in your visualization tool:

**Link Type Categories**:
- `motivation` → Gold (#FFD700)
- `business` → Red (#FF6B6B)
- `security` → Crimson (#DC143C)
- `archimate` → Teal (#4ECDC4)
- `api` → Blue (#45B7D1)
- `data` → Green (#96CEB4)
- `apm` → Purple (#A29BFE)
- `ux` → Yellow (#FFEAA7)
- `navigation` → Gray (#DFE6E9)

**Node Types**:
- `Layer` → Large circles, blue
- `LinkType` → Medium squares, colored by category
- `Predicate` → Small diamonds, gray
- `EntityType` → Small circles, colored by layer

### Layout Recommendations

**Hierarchical Layout** (yEd):
- Good for: Layer-based architecture view
- Settings: Orientation = Top to Bottom, Orthogonal edges

**Force Atlas 2** (Gephi):
- Good for: Discovering clusters and communities
- Settings: Scaling = 2.0, Gravity = 1.0, Prevent Overlap = true

**Prefuse Force Directed** (Cytoscape):
- Good for: Balanced, readable network view
- Settings: Default settings work well

## Troubleshooting

### Graph looks cluttered
- Use the minimal export: `--minimal`
- Filter to show only specific node types
- Increase spacing in layout settings

### Can't see node labels
- yEd: Tools → Fit Node to Label
- Gephi: Appearance → Nodes → Labels → Show labels
- Cytoscape: Style → Label → Set label column to "name"

### File won't open
- Check file exists: `ls -lh reports/visualization/spec-ontology.graphml`
- Validate XML: `xmllint reports/visualization/spec-ontology.graphml`
- Try regenerating: `python scripts/tools/export_graphml.py --force`

### Graph is too large
- Use standard export instead of `--include-entities`
- Filter to show only specific layers or categories
- Increase available memory for Gephi (edit gephi.conf)

## Next Steps

After visualization:

1. **Screenshot for documentation** - Export high-res PNG/SVG
2. **Identify gaps** - Look for disconnected components
3. **Validate traceability** - Ensure paths exist from motivation → implementation
4. **Share findings** - Export images to include in spec documentation
5. **Iterate** - Update schemas, regenerate, visualize changes

## Resources

- **GraphML Spec**: http://graphml.graphdrawing.org/
- **yEd Manual**: https://yed.yworks.com/support/manual/
- **Gephi Tutorials**: https://gephi.org/users/tutorial-visualization/
- **Cytoscape Manual**: https://manual.cytoscape.org/
- **Graph Visualization Best Practices**: https://www.graphviz.org/

## Advanced Usage

### Custom Exports

Edit `scripts/tools/export_graphml.py` to:
- Add custom node/edge attributes
- Filter by specific criteria
- Include additional metadata

### Integration with CI/CD

Generate fresh visualizations on every schema change:

```yaml
# .github/workflows/visualize.yml
- name: Generate GraphML
  run: python scripts/tools/export_graphml.py

- name: Upload artifact
  uses: actions/upload-artifact@v3
  with:
    name: ontology-visualization
    path: reports/visualization/spec-ontology.graphml
```

### Diff Visualization

Compare two versions:

```bash
# Export current state
python scripts/tools/export_graphml.py --output current.graphml

# Checkout old version
git checkout main~10

# Export old state
python scripts/tools/export_graphml.py --output old.graphml

# Compare in Gephi
# File → Open → old.graphml
# File → Append → current.graphml
# Color nodes by "source" to see differences
```

## Questions?

See the detailed README: `reports/visualization/README.md`
