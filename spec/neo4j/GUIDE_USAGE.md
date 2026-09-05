# Neo4j Guide Usage - Complete Documentation

## Overview

This directory contains **three guide formats** for exploring the Documentation Robotics specification in Neo4j:

1. **Standalone HTML Guide** - Modern web interface (recommended)
2. **Neo4j Browser Guide** - General spec exploration with `:play` integration
3. **Layer Explorer Guide** - Layer-by-layer exploration with intra/inter-layer views

All guides feature queries optimized for your Neo4j Browser version with clean visualizations.

**Note:** When you run `./spec/neo4j/launch-neo4j.sh`, the CORS server is started automatically on port 8000, making all guides immediately available.

## Quick Start

### Recommended: Standalone Guide

**Open in your browser:** http://localhost:8000/guide.html

Features:

- ✅ Beautiful, modern interface
- ✅ One-click copy-to-clipboard for all queries
- ✅ Organized by topic with table of contents
- ✅ Works immediately, no configuration
- ✅ Use side-by-side with Neo4j Browser

**How to use:**

1. Open http://localhost:8000/guide.html in a browser tab
2. Keep Neo4j Browser open in another tab/window
3. Click "Copy" on any query
4. Paste into Neo4j Browser and run

### Alternative: Neo4j Browser Guide

**In Neo4j Browser, run:**

```cypher
:play http://localhost:8000/browser-guide.html
```

Features:

- ✅ 14 interactive slides
- ✅ Clickable queries (just click to run!)
- ✅ Navigate with arrow buttons
- ✅ Native Neo4j Browser integration
- ✅ General spec exploration

### Layer-by-Layer: Layer Explorer Guide

**In Neo4j Browser, run:**

```cypher
:play http://localhost:8000/layer-explorer-guide.html
```

Features:

- ✅ 25 interactive slides covering all 12 layers
- ✅ Two query patterns per layer:
  - **Intra-layer view**: All nodes and relationships within a single layer
  - **Inter-layer view**: All nodes and cross-layer relationships (both sources and sinks)
- ✅ Perfect for systematic layer exploration
- ✅ Shows internal structure and external dependencies for each layer

**When to use this guide:**

- You want to explore one specific layer in depth
- You need to understand both internal (intra-layer) and external (inter-layer) relationships
- You're analyzing how a layer connects to other layers
- You want to see all nodes in a layer with their relationships

## What's Different from Generic Guides?

These guides are **specifically optimized** for your Neo4j Browser version:

### Visualization Strategy

Your Neo4j Browser doesn't have hierarchical layout controls, so the queries use:

1. **LIMIT clauses** - Keep node counts manageable (10-20 nodes)
2. **Single predicate focus** - One relationship type at a time
3. **Layer isolation** - Explore one layer instead of everything
4. **Node label filters** - Use the right sidebar to show/hide types

### Clean Graph Queries

Instead of the original messy query:

```cypher
// ❌ Too many nodes, overlapping edges
MATCH (source:SpecNode_api)
MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(source)
MATCH (sr)-[:HAS_TARGET]->(target:SpecNode)
MATCH (sr)-[:USES_PREDICATE]->(p:Predicate)
RETURN source, sr, target, p
LIMIT 50;
```

Use focused queries like:

```cypher
// ✅ Clean, simple visualization
MATCH (api:SpecNode_api)-[:BELONGS_TO_LAYER]->(l:Layer)
RETURN api, l;
```

Or:

```cypher
// ✅ One predicate, limited nodes
MATCH (sr:SpecRelationship {predicate: 'composes'})
MATCH (sr)-[:HAS_SOURCE]->(source:SpecNode)
MATCH (sr)-[:HAS_TARGET]->(target:SpecNode)
RETURN source, target
LIMIT 15;
```

## Graph Visualization Tips

### Controls Available in Your Neo4j Browser

**Bottom-right icons:**

- 🔍+ **Zoom in**
- 🔍- **Zoom out**
- ⬜ **Zoom to fit** - Shows entire graph

**Right sidebar - Node Labels (Filters):**

- Click any label to show/hide that node type
- Example: Click "SpecNode (14)" to show only SpecNodes
- Click "Predicate (7)" to hide predicates

**Manual Arrangement:**

- **Drag nodes** to position them
- Nodes stay where you place them
- Zoom and pan to explore

### Best Practices

**For clean visualizations:**

1. **Start small:** Use `LIMIT 10` then gradually increase
2. **Focus on one thing:** One layer, one predicate, or one node type
3. **Use filters:** Click node labels in the sidebar to hide clutter
4. **Manually arrange:** Drag important nodes to the center
5. **Progressive disclosure:** Start with high-level view, drill down

**Query patterns that work well:**

```cypher
// Pattern 1: Layer membership
MATCH (nodes:SpecNode_api)-[:BELONGS_TO_LAYER]->(l:Layer)
RETURN nodes, l;

// Pattern 2: Single predicate
MATCH (sr:SpecRelationship {predicate: 'influence'})
MATCH (sr)-[:HAS_SOURCE]->(source)
MATCH (sr)-[:HAS_TARGET]->(target)
RETURN source, target LIMIT 15;

// Pattern 3: Ego network (explore from one node)
MATCH (center:SpecNode {spec_node_id: 'api.endpoint'})
OPTIONAL MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(center)
OPTIONAL MATCH (sr)-[:HAS_TARGET]->(target)
RETURN center, target LIMIT 20;

// Pattern 4: Cross-layer (limited)
MATCH (source:SpecNode_api)
WITH source LIMIT 5
MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(source)
MATCH (sr)-[:HAS_TARGET]->(target:SpecNode)
RETURN source, target;
```

## File Structure

```
spec/neo4j/
├── guide.html                    # Standalone guide (recommended)
├── browser-guide.html            # Neo4j Browser :play guide
├── spec-explorer-guide.html      # Original guide (deprecated)
├── visualization-tips.md         # Detailed visualization strategies
├── README.md                     # Main documentation
├── GUIDE_USAGE.md               # This file
├── launch-neo4j.sh              # Launcher script
├── import.cypher                # Generated Cypher import
└── csv/                         # Generated CSV files
    ├── nodes.csv
    ├── edges.csv
    └── import.sh
```

## Technical Details

### How Neo4j Browser Guides Work

Based on [Neo4j's official documentation](https://neo4j.com/developer/guide-create-neo4j-browser-guide/):

- Guides are HTML slideshows with special formatting
- Each slide is wrapped in `<slide>` tags
- Cypher queries in `<pre class="code runnable">` tags become clickable
- The `:play` command fetches and renders the guide

### Hosting Requirements

**For `:play` to work:**

1. **Whitelisting:** The hosting domain must be whitelisted in Neo4j config
2. **CORS headers:** Server must support CORS for GET and OPTIONS
3. **HTTPS matching:** If Neo4j uses HTTPS, guide must also be HTTPS

**Our setup:**

- Serving via Python HTTP server on `localhost:8000`
- Localhost is whitelisted via Docker environment variable
- HTTP on both sides (Neo4j and guide server)

### Starting the HTTP Server

**Important:** Use the CORS-enabled server for Neo4j Browser guide compatibility.

```bash
cd spec/neo4j
python3 cors-server.py
```

The CORS server:

- Serves files on `localhost:8000`
- Adds proper CORS headers for Neo4j Browser
- Handles OPTIONS preflight requests
- Provides request logging for debugging

Then both guides will be available:

- Standalone: http://localhost:8000/guide.html
- Browser guide: `:play http://localhost:8000/browser-guide.html`

**Alternative (basic server, may not work with `:play`):**

```bash
python3 -m http.server 8000  # No CORS headers
```

## Troubleshooting

### `:play` command shows "Not found"

**Possible causes:**

1. HTTP server not running
2. CORS server not being used (basic Python server doesn't work)
3. Localhost not whitelisted in Neo4j
4. Guide file not accessible

**Solutions:**

1. **Use the CORS server:** `cd spec/neo4j && python3 cors-server.py`
2. Verify server responds: `curl -I http://localhost:8000/browser-guide.html`
3. Check CORS headers present: `curl -i -X OPTIONS http://localhost:8000/browser-guide.html`
4. Restart Neo4j with updated launch script: `./spec/neo4j/launch-neo4j.sh`
5. Use the standalone guide instead: http://localhost:8000/guide.html

**Note:** The basic Python server (`python3 -m http.server`) doesn't send CORS headers and won't work with the `:play` command. Always use `cors-server.py`.

### Graph view is too cluttered

**Solutions:**

1. Use smaller LIMIT values (10-15 instead of 50)
2. Filter by node labels (click labels in right sidebar)
3. Focus on single predicates instead of all relationships
4. Use the queries from the guides - they're optimized for clean views

### Can't find layout controls

**Your Neo4j Browser version doesn't have layout controls.** Instead:

- Use the optimized queries provided
- Manually drag nodes to arrange them
- Use node label filters to hide/show types
- Use LIMIT to control how much is displayed

## References

**Neo4j Browser Guide Documentation:**

- [Tutorial: Create a Custom Browser Guide](https://neo4j.com/developer/guide-create-neo4j-browser-guide/)
- [Create a Custom Neo4j Browser Guide (Gist)](https://gist.github.com/jexp/1abaa155d214569e458e0770e2cab2e3)
- [Neo4j Browser User Manual](https://neo4j.com/docs/browser-manual/current/)

**Community Resources:**

- [Create and play neo4j guide](https://community.neo4j.com/t/create-and-play-neo4j-guide/12677)
- [Neo4j desktop - where to place browser guide file](https://community.neo4j.com/t/neo4j-desktop-where-to-place-browser-guide-file/35804)

## Next Steps

1. **Explore the guides:** Try both formats and see which you prefer
2. **Run the queries:** Start with verification queries, then explore layers
3. **Experiment:** Modify queries to explore different aspects
4. **Read the visualization tips:** See `visualization-tips.md` for strategies
5. **Regenerate after changes:** Run `npm run export:spec-neo4j` after spec updates

## Quick Reference

**Launch Neo4j:**

```bash
./spec/neo4j/launch-neo4j.sh
```

**Access guides:**

- Standalone: http://localhost:8000/guide.html
- Browser: `:play http://localhost:8000/browser-guide.html` (in Neo4j Browser)

**Useful Neo4j Browser commands:**

```
:help        // Neo4j Browser help
:schema      // View graph schema
:clear       // Clear query window
:history     // Show query history
```

**Start CORS server manually:**

```bash
cd spec/neo4j && python3 cors-server.py
```
