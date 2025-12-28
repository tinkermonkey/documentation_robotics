# Dependency Tracker - Python CLI Behavior Specification

**Source:** `cli-validation/python-cli/src/documentation_robotics/core/dependency_tracker.py` (252 lines)

**Purpose:** Analyzes dependencies between elements using graph algorithms for impact assessment and traceability.

## Data Structures

### TraceDirection (Enum)

```python
class TraceDirection(Enum):
    UP = "up"      # Find what this depends on (successors in graph)
    DOWN = "down"  # Find what depends on this (predecessors in graph)
    BOTH = "both"  # Both directions
```

**TypeScript Equivalent:**

```typescript
enum TraceDirection {
  UP = "up",
  DOWN = "down",
  BOTH = "both",
}
```

### DependencyPath (Data Class)

```python
@dataclass
class DependencyPath:
    source: str                  # Starting element ID
    target: str                  # Ending element ID
    path: List[str]              # Full path of element IDs
    depth: int                   # Number of hops (len(path) - 1)
    relationship_types: List[str] # Edge types along path
```

**TypeScript Equivalent:**

```typescript
interface DependencyPath {
  source: string;
  target: string;
  path: string[];
  depth: number;
  relationship_types: string[];
}
```

## Constructor Behavior

```python
def __init__(self, model: Any):
    self.model = model
    self.registry = ReferenceRegistry()
    self._build_registry()

def _build_registry(self) -> None:
    for layer in self.model.layers.values():
        for element in layer.elements.values():
            self.registry.register_element(element)
```

**Key Behavior:**

- Creates own ReferenceRegistry instance
- Automatically registers all elements from model
- Assumes model has `layers` dict with `elements` dict

**TypeScript Note:** Should accept pre-built ReferenceRegistry or build from model.

## Public Methods

### 1. trace_dependencies()

**Signature:**

```python
def trace_dependencies(
    element_id: str,
    direction: TraceDirection = TraceDirection.BOTH,
    max_depth: Optional[int] = None
) -> List[Any]
```

**Purpose:** Trace dependencies from an element in specified direction.

**Algorithm:**

1. Get dependency graph from registry
2. Return empty list if element not in graph
3. For UP direction: Get successors (what element depends on)
   - If max_depth is None: Use nx.descendants() for all
   - If max_depth is set: BFS traversal limited by depth
4. For DOWN direction: Get predecessors (what depends on element)
   - If max_depth is None: Use nx.ancestors() for all
   - If max_depth is set: BFS traversal limited by depth
5. For BOTH: Combine UP and DOWN results
6. Convert element IDs to Element objects via model.get_element()
7. Return list of Elements

**Important Details:**

- UP traces successors (outgoing edges) = what this depends on
- DOWN traces predecessors (incoming edges) = what depends on this
- max_depth=None means unlimited traversal
- max_depth=1 means direct neighbors only
- Returns Element objects, not IDs
- Excludes the starting element from results

**Test Cases:**

```yaml
test_trace_up_unlimited:
  setup:
    graph: A -> B -> C
    element: A
    direction: UP
    max_depth: null
  expected: [B, C]

test_trace_up_depth_1:
  setup:
    graph: A -> B -> C
    element: A
    direction: UP
    max_depth: 1
  expected: [B]

test_trace_down_unlimited:
  setup:
    graph: A -> B -> C
    element: C
    direction: DOWN
    max_depth: null
  expected: [A, B]

test_trace_both:
  setup:
    graph: A -> B -> C
    element: B
    direction: BOTH
    max_depth: null
  expected: [A, C]

test_nonexistent_element:
  setup:
    element: "nonexistent"
    direction: BOTH
  expected: []
```

### 2. find_dependency_paths()

**Signature:**

```python
def find_dependency_paths(
    source_id: str,
    target_id: str,
    max_paths: int = 10
) -> List[DependencyPath]
```

**Purpose:** Find all simple paths between two elements.

**Algorithm:**

1. Get dependency graph from registry
2. Return empty list if source or target not in graph
3. Use nx.all_simple_paths(graph, source, target, cutoff=max_paths)
4. For each path:
   - Extract relationship types from edge data
   - Create DependencyPath with path, depth, types
5. Limit to max_paths results
6. Return list of DependencyPath objects

**Important Details:**

- Uses nx.all_simple_paths (no cycles)
- cutoff parameter limits path length, not result count
- Returns first max_paths paths found
- Includes relationship types along path from edge attributes
- Returns empty list on NetworkXNoPath exception
- depth = len(path) - 1 (number of edges/hops)

**Test Cases:**

```yaml
test_single_path:
  setup:
    graph: A -> B -> C
    source: A
    target: C
  expected:
    - path: [A, B, C]
      depth: 2
      relationship_types: [realizes, accesses]

test_multiple_paths:
  setup:
    graph: |
      A -> B -> D
      A -> C -> D
    source: A
    target: D
    max_paths: 10
  expected_count: 2
  expected_paths:
    - [A, B, D]
    - [A, C, D]

test_no_path:
  setup:
    graph: A -> B, C -> D
    source: A
    target: D
  expected: []

test_max_paths_limit:
  setup:
    graph: Complex graph with 20 paths
    source: A
    target: Z
    max_paths: 5
  expected_count: 5
```

### 3. get_dependency_layers()

**Signature:**

```python
def get_dependency_layers(element_id: str) -> Dict[str, List[str]]
```

**Purpose:** Get dependencies organized by architectural layer.

**Algorithm:**

1. Call trace_dependencies(element_id, BOTH)
2. Group resulting elements by their layer attribute
3. Return dict mapping layer name -> list of element IDs

**Important Details:**

- Uses BOTH direction (all dependencies)
- Groups by element.layer attribute
- Returns element IDs, not Element objects
- Empty dict if element has no dependencies

**Test Cases:**

```yaml
test_cross_layer_deps:
  setup:
    element: business.service.x
    dependencies:
      - motivation.goal.y (layer: motivation)
      - application.service.z (layer: application)
  expected:
    motivation: [motivation.goal.y]
    application: [application.service.z]

test_no_dependencies:
  setup:
    element: isolated.element
    dependencies: []
  expected: {}
```

### 4. get_orphaned_elements()

**Signature:**

```python
def get_orphaned_elements() -> List[Any]
```

**Purpose:** Find elements with no references (neither incoming nor outgoing).

**Algorithm:**

1. Get dependency graph from registry
2. For each element in model:
   - If element.id not in graph: Add to orphaned list
   - If graph.degree(element.id) == 0: Add to orphaned list
3. Return list of Element objects

**Important Details:**

- Checks all elements in model, not just graph nodes
- degree() returns total connections (in + out)
- Returns Element objects, not IDs
- Orphaned = not in graph OR degree is 0

**Test Cases:**

```yaml
test_find_orphans:
  setup:
    elements: [A, B, C, D]
    references: [A -> B]
  expected_orphans: [C, D]

test_degree_zero:
  setup:
    element: X
    # X is in graph but has no edges
    graph: nodes=[X], edges=[]
  expected_orphans: [X]

test_no_orphans:
  setup:
    elements: [A, B]
    references: [A -> B]
  expected_orphans: []
```

### 5. get_hub_elements()

**Signature:**

```python
def get_hub_elements(threshold: int = 10) -> List[tuple]
```

**Purpose:** Find highly connected elements (hubs in the dependency network).

**Algorithm:**

1. Get dependency graph from registry
2. For each node in graph:
   - Calculate degree (total connections)
   - If degree >= threshold: Add (node_id, degree) to list
3. Sort list by degree descending
4. Return list of (element_id, connection_count) tuples

**Important Details:**

- Uses total degree (in + out connections)
- Default threshold is 10
- Returns tuples of (id, count), not Element objects
- Sorted highest degree first
- Returns empty list if no hubs found

**Test Cases:**

```yaml
test_find_hubs:
  setup:
    graph:
      A: 15 connections
      B: 12 connections
      C: 5 connections
    threshold: 10
  expected:
    - [A, 15]
    - [B, 12]

test_no_hubs:
  setup:
    graph: All nodes < 10 connections
    threshold: 10
  expected: []

test_custom_threshold:
  setup:
    graph:
      A: 5 connections
      B: 3 connections
    threshold: 3
  expected:
    - [A, 5]
    - [B, 3]
```

## Graph Algorithm Details

### Terminology Clarification (IMPORTANT)

Python CLI uses networkx terminology which can be confusing:

```
Graph: A -> B -> C

A's successors: [B] (nodes A points TO / A depends on)
A's predecessors: [] (nodes that point TO A / depend on A)

C's successors: [] (nothing C points to)
C's predecessors: [A, B] (A and B point to C / depend on C)

descendants(A) = [B, C] = all reachable going forward (UP in Python CLI)
ancestors(C) = [A, B] = all reachable going backward (DOWN in Python CLI)
```

**Python CLI Direction Mapping:**

- `TraceDirection.UP` = Get descendants/successors = "what this depends on"
- `TraceDirection.DOWN` = Get ancestors/predecessors = "what depends on this"

This is the opposite of what you might expect! "UP" traces forward in the graph.

### BFS Traversal with max_depth

When max_depth is specified, use level-by-level BFS:

```python
current_level = {start_node}
for _ in range(max_depth):
    next_level = set()
    for node in current_level:
        next_level.update(graph.successors(node))  # or predecessors
    result.update(next_level)
    current_level = next_level
    if not current_level:
        break
```

Key points:

- Start with depth 0 = starting node
- Each iteration goes one level deeper
- Stop after max_depth levels OR when no more nodes
- Don't include starting node in results

## NetworkX vs Graphology Migration

### Method Mappings

| NetworkX                       | Graphology                      | Notes                |
| ------------------------------ | ------------------------------- | -------------------- |
| `nx.descendants(g, n)`         | Custom BFS                      | No direct equivalent |
| `nx.ancestors(g, n)`           | Custom BFS                      | No direct equivalent |
| `graph.successors(n)`          | `graph.outNeighbors(n)`         | Outgoing edges       |
| `graph.predecessors(n)`        | `graph.inNeighbors(n)`          | Incoming edges       |
| `nx.all_simple_paths(g, s, t)` | Custom DFS                      | No direct equivalent |
| `graph.degree(n)`              | `graph.degree(n)`               | Same                 |
| `graph.get_edge_data(u, v)`    | `graph.getEdgeAttributes(u, v)` | Similar              |

### Implementation Notes

1. **Descendants/Ancestors:** Must implement custom BFS/DFS
2. **Simple Paths:** Must implement custom path-finding algorithm
3. **Edge Data:** Graphology stores attributes similarly
4. **Graph Type:** Use directed graph for both

## Edge Cases

1. **Element not in graph:** Return empty list/dict
2. **max_depth=0:** Return empty list (no traversal)
3. **max_depth=1:** Direct neighbors only
4. **Circular dependencies:** all_simple_paths avoids cycles
5. **Self-loops:** Should be included in degree count
6. **Disconnected graph:** Each component handled independently

## Performance Characteristics

- **trace_dependencies (unlimited):** O(V + E) BFS/DFS
- **trace_dependencies (limited):** O(max_depth \* avg_degree)
- **find_dependency_paths:** Exponential in path length (can be slow)
- **get_dependency_layers:** O(V + E) + grouping overhead
- **get_orphaned_elements:** O(V) iteration
- **get_hub_elements:** O(V) + O(V log V) sort

## TypeScript Implementation Checklist

- [ ] TraceDirection enum with UP, DOWN, BOTH
- [ ] DependencyPath interface
- [ ] Constructor accepts ReferenceRegistry
- [ ] trace_dependencies with all three directions
- [ ] BFS traversal with max_depth support
- [ ] find_dependency_paths with path-finding algorithm
- [ ] get_dependency_layers grouping logic
- [ ] get_orphaned_elements scanning
- [ ] get_hub_elements with threshold
- [ ] Unit tests for all methods
- [ ] Integration tests with real model
- [ ] Performance tests for large graphs
