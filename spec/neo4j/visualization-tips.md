# Neo4j Visualization Tips

## Common Issue: Cluttered Graph Views

When exploring the spec in Neo4j Browser, you may encounter cluttered visualizations with overlapping edges and nodes. Here are strategies to get cleaner, more useful graph views.

## 🎨 Neo4j Browser Layout Controls

### Built-in Layout Options

**Location:** Bottom-right corner of the graph view (gear icon ⚙️)

**Available Layouts:**

1. **Force-directed** (default) - Physics-based, nodes repel each other
2. **Hierarchical** - Top-down tree structure (excellent for layered architecture!)
3. **Radial** - Circular layout centered on selected node

**How to use:**

1. Run a query that returns graph results
2. Click the gear icon (⚙️) in bottom-right corner
3. Select "Hierarchical" under "Layout"
4. For our 12-layer model, this creates a top-down view!

### Manual Controls

- **Unpin all** - Release all nodes and let Neo4j re-layout (button at bottom)
- **Drag nodes** - Click and drag to manually position nodes
- **Pin nodes** - Drag a node, then it stays in place
- **Double-click node** - Expand/collapse connected neighbors
- **Right-click background** → "Dismiss" - Remove nodes from view

### Graph Settings (Gear Icon)

**Reduce Visual Clutter:**

- **Node styling** - Adjust node size and color by property
- **Relationship styling** - Reduce thickness, hide labels
- **Initial node display** - Limit how many nodes appear initially
- **Max neighbors** - Limit relationships shown per node

**Recommended Settings for Spec Exploration:**

- Initial node display: 25-50 nodes
- Max neighbors: 10-20 relationships
- Hide relationship labels until you click a relationship
- Use hierarchical layout for layer-to-layer views

## 📊 Query Strategies for Clean Visualizations

### Strategy 1: Limit Results

**Problem:** Too many nodes make the graph unreadable

**Solution:** Use LIMIT to show manageable subsets

```cypher
// Show just 10 API layer types
MATCH (source:SpecNode_api)
MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(source)
MATCH (sr)-[:HAS_TARGET]->(target:SpecNode)
RETURN source, sr, target
LIMIT 10;
```

**Tip:** Start with LIMIT 10, then increase to 25, 50 as needed

### Strategy 2: Focus on Single Predicates

**Problem:** Multiple relationship types overlap and create visual noise

**Solution:** Query one predicate at a time

```cypher
// Show ONLY "influence" relationships
MATCH (sr:SpecRelationship {predicate: 'influence'})
MATCH (sr)-[:HAS_SOURCE]->(source:SpecNode)
MATCH (sr)-[:HAS_TARGET]->(target:SpecNode)
RETURN source, sr, target;
```

**Try these predicates individually:**

- `influence` - Motivation layer impacts
- `composes` - Structural composition
- `realizes` - Implementation relationships
- `depends-on` - Dependencies
- `references` - Cross-layer references

### Strategy 3: Layer-to-Layer Paths

**Problem:** Querying entire graph shows too much

**Solution:** Focus on specific layer interactions

```cypher
// Show only API → Business layer relationships
MATCH (api:SpecNode_api)
MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(api)
MATCH (sr)-[:HAS_TARGET]->(business:SpecNode_business)
RETURN api, sr, business;
```

```cypher
// Show only cross-layer relationships (no intra-layer)
MATCH (source:SpecNode)-[:BELONGS_TO_LAYER]->(l1:Layer)
MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(source)
MATCH (sr)-[:HAS_TARGET]->(target:SpecNode)-[:BELONGS_TO_LAYER]->(l2:Layer)
WHERE l1.id <> l2.id
RETURN source, sr, target
LIMIT 30;
```

### Strategy 4: Ego Networks (Node-Centric)

**Problem:** Want to explore around a specific node without clutter

**Solution:** Query from a single node outward

```cypher
// Explore everything connected to api.endpoint
MATCH (center:SpecNode {spec_node_id: 'api.endpoint'})
OPTIONAL MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(center)
OPTIONAL MATCH (sr)-[:HAS_TARGET]->(target:SpecNode)
RETURN center, sr, target;
```

```cypher
// Two-hop exploration from a node
MATCH (center:SpecNode {spec_node_id: 'motivation.goal'})
MATCH path = (center)-[*1..2]-(connected)
RETURN path
LIMIT 20;
```

### Strategy 5: Specific Type Relationships

**Problem:** Too many node types in view

**Solution:** Filter to specific element types

```cypher
// Show only endpoint → service relationships
MATCH (endpoint:SpecNode {type: 'endpoint'})
MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(endpoint)
MATCH (sr)-[:HAS_TARGET]->(service:SpecNode {type: 'service'})
RETURN endpoint, sr, service;
```

### Strategy 6: Progressive Disclosure

**Problem:** Need to explore gradually without overwhelming the view

**Solution:** Start small, expand interactively

**Step 1:** Show just layers

```cypher
MATCH (l:Layer)
RETURN l;
```

**Step 2:** Double-click a layer in the graph to see its nodes

**Step 3:** Double-click a node to see its relationships

**Or use WHERE to expand:**

```cypher
// Start with API layer
MATCH (l:Layer {id: 'api'})
MATCH (sn:SpecNode)-[:BELONGS_TO_LAYER]->(l)
RETURN l, sn
LIMIT 15;
```

## 🎯 Recommended Workflow

### For Exploring Layer Structure

1. **Start with hierarchical layout:**

   ```cypher
   MATCH (l:Layer)
   RETURN l
   ORDER BY l.number;
   ```

   Then click gear → Hierarchical layout

2. **Explore one layer at a time:**

   ```cypher
   MATCH (sn:SpecNode)-[:BELONGS_TO_LAYER]->(l:Layer {id: 'api'})
   RETURN l, sn;
   ```

3. **Focus on cross-layer patterns:**

   ```cypher
   MATCH (source:SpecNode_api)
   MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(source)
   MATCH (sr)-[:HAS_TARGET]->(target:SpecNode)
   WHERE NOT target:SpecNode_api
   RETURN source, sr, target
   LIMIT 20;
   ```

### For Exploring Predicates

1. **List all predicates first** (table view):

   ```cypher
   MATCH (p:Predicate)
   RETURN p.predicate, p.category, p.description;
   ```

2. **Pick one predicate and visualize:**

   ```cypher
   MATCH (sr:SpecRelationship {predicate: 'composes'})
   MATCH (sr)-[:HAS_SOURCE]->(source)
   MATCH (sr)-[:HAS_TARGET]->(target)
   RETURN source, sr, target
   LIMIT 15;
   ```

3. **Group by category:**

   ```cypher
   MATCH (sr:SpecRelationship)-[:USES_PREDICATE]->(p:Predicate {category: 'structural'})
   MATCH (sr)-[:HAS_SOURCE]->(source)
   MATCH (sr)-[:HAS_TARGET]->(target)
   RETURN source, sr, target
   LIMIT 20;
   ```

### For Exploring Specific Types

1. **Find the type you're interested in:**

   ```cypher
   MATCH (sn:SpecNode)
   WHERE sn.spec_node_id CONTAINS 'endpoint'
   RETURN sn.spec_node_id;
   ```

2. **Explore its relationships:**

   ```cypher
   MATCH (center:SpecNode {spec_node_id: 'api.endpoint'})
   MATCH (sr:SpecRelationship)-[:HAS_SOURCE|HAS_TARGET]->(center)
   MATCH (sr)-[:HAS_SOURCE]->(source)
   MATCH (sr)-[:HAS_TARGET]->(target)
   RETURN source, sr, target;
   ```

## 🔧 Advanced Tips

### Use Node Coloring

**In Neo4j Browser settings**, set node color by property:

- Color by `layer_id` - Each layer gets a different color
- Color by `category` (for predicates) - Structural vs behavioral vs dependency

### Combine Graph + Table Views

1. Run a query
2. Click both **graph** and **table** icons at the top
3. See visualization AND data simultaneously
4. Click rows in table to highlight in graph

### Expand Selectively

Instead of querying everything:

1. Query a small starting set
2. Click a node in the graph
3. Right-click → "Expand"
4. Choose which relationship types to expand

### Save Favorite Queries

**In Neo4j Browser:**

1. Run a query you like
2. Click the star icon to save it
3. Access from the "Favorites" tab
4. Name it for easy recall

## 📈 Example: Clean Cross-Layer View

**Best query for visualizing the layer hierarchy:**

```cypher
// Show layers in hierarchical order with sample nodes
MATCH (l:Layer)
OPTIONAL MATCH (sn:SpecNode)-[:BELONGS_TO_LAYER]->(l)
WITH l, sn
ORDER BY l.number, sn.spec_node_id
WITH l, COLLECT(sn)[0..3] AS sampleNodes
UNWIND sampleNodes AS node
RETURN l, node;
```

**Then:**

1. Click gear icon → Select "Hierarchical" layout
2. Layers will arrange top-to-bottom
3. Drag layer nodes to adjust vertical spacing
4. Click "Pin all" to lock the layout

## 🎨 Visual Style Recommendations

**For Spec Exploration:**

1. **Node sizing:**
   - Size by `total_attribute_count` - Bigger = more attributes
   - Or uniform size for clarity

2. **Node captions:**
   - Show `spec_node_id` for identification
   - Or show `type` for simpler view

3. **Relationship labels:**
   - Hide by default
   - Click a relationship to see its predicate
   - Or filter to single predicate to show labels

4. **Colors:**
   - Use distinct colors per layer
   - Or use category colors for predicates

## 🚀 Quick Reference

| Goal                | Query Pattern                                 | View Setting         |
| ------------------- | --------------------------------------------- | -------------------- |
| Explore one layer   | `MATCH (sn:SpecNode_api) RETURN sn LIMIT 20`  | Force-directed       |
| See layer hierarchy | `MATCH (l:Layer) RETURN l`                    | Hierarchical         |
| Find hubs           | `MATCH (sn:SpecNode)...[count relationships]` | Radial from hub      |
| Trace dependencies  | `MATCH path = (source)-[*1..3]->(target)`     | Hierarchical         |
| Compare predicates  | Filter by `{predicate: 'X'}`                  | Side-by-side queries |

## Summary

**Key Principles:**

1. **Start small** - Use LIMIT generously
2. **Focus** - One layer, predicate, or type at a time
3. **Progressive** - Build up complexity gradually
4. **Layout matters** - Use hierarchical for layers, radial for hubs
5. **Manual adjustment** - Don't be afraid to drag nodes around!

The spec database has 354 nodes and hundreds of relationships - you'll never want to visualize it all at once. The power is in **focused, purposeful queries** that answer specific questions.
