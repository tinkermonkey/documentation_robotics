# Reference Registry Behavior Specification

## Overview

Extracted from Python CLI implementation at commit 504a945^

## Core Data Structures

### Reference

```typescript
interface Reference {
  source: string; // Source element ID (e.g., "business.service.customer")
  target: string; // Target element ID (e.g., "motivation.goal.crm")
  property: string; // Property path (e.g., "realizes", "data.schemaRef")
  type: string; // Reference type (realization, access, composition, etc.)
  required: boolean; // Whether reference must exist
}
```

### ReferenceDefinition

```typescript
interface ReferenceDefinition {
  layer: string; // Source layer
  elementType: string | null; // Source element type (null = any)
  propertyPath: string; // Property name
  targetLayer: string; // Target layer
  targetType: string | null; // Target element type (null = any)
  referenceType: string; // Type of relationship
  required: boolean; // Must exist?
  cardinality: string; // "1", "0..1", "1..*", "0..*", "array", "single"
}
```

## Public Methods

### `registerElement(element: Element): void`

**Purpose:** Extract all references from an element and register them

**Behavior:**

1. Scans element properties for known reference property names
2. Handles both single string references and array of references
3. Recursively scans nested objects for properties ending in "Ref" or "Reference"
4. Infers reference type from property name
5. Adds all found references to registry

**Known Reference Properties:**

```typescript
const KNOWN_REF_PROPERTIES = [
  "realizes",
  "realizedBy",
  "serves",
  "servedBy",
  "accesses",
  "accessedBy",
  "uses",
  "usedBy",
  "composedOf",
  "partOf",
  "flows",
  "triggers",
  "archimateRef",
  "businessActorRef",
  "stakeholderRef",
  "motivationGoalRef",
  "dataObjectRef",
  "apiOperationRef",
  "applicationServiceRef",
  "schemaRef",
];
```

**Reference Type Inference:**

```typescript
const TYPE_MAP = {
  realizes: "realization",
  realizedBy: "realization",
  serves: "serving",
  servedBy: "serving",
  accesses: "access",
  accessedBy: "access",
  uses: "usage",
  usedBy: "usage",
  composedOf: "composition",
  partOf: "composition",
  flows: "flow",
  triggers: "triggering",
  // Default: 'association'
};
```

**Test Cases:**

```yaml
- name: Single string reference
  input:
    element:
      id: business.service.customer
      properties:
        realizes: motivation.goal.crm
  expected:
    - source: business.service.customer
      target: motivation.goal.crm
      property: realizes
      type: realization

- name: Array of references
  input:
    element:
      id: app.service.user
      properties:
        accesses: [data.entity.user, data.entity.role]
  expected:
    - source: app.service.user
      target: data.entity.user
      property: accesses
      type: access
    - source: app.service.user
      target: data.entity.role
      property: accesses
      type: access

- name: Nested reference
  input:
    element:
      id: api.endpoint.users
      properties:
        data:
          schemaRef: data.schema.user
  expected:
    - source: api.endpoint.users
      target: data.schema.user
      property: data.schemaRef
      type: association

- name: Unknown property name
  input:
    element:
      id: test.element
      properties:
        customRef: target.element
  expected:
    - source: test.element
      target: target.element
      property: customRef
      type: association
```

---

### `getReferencesFrom(elementId: string): Reference[]`

**Purpose:** Get all references originating from an element

**Behavior:**

- Returns array of references where `reference.source === elementId`
- Returns empty array if element has no outgoing references
- O(1) lookup via source index

**Test Cases:**

```yaml
- name: Element with references
  setup:
    - add reference: A -> B
    - add reference: A -> C
  call: getReferencesFrom('A')
  expected: [ref(A->B), ref(A->C)]

- name: Element with no references
  call: getReferencesFrom('X')
  expected: []
```

---

### `getReferencesTo(elementId: string): Reference[]`

**Purpose:** Get all references pointing to an element

**Behavior:**

- Returns array of references where `reference.target === elementId`
- Returns empty array if element has no incoming references
- O(1) lookup via target index

**Test Cases:**

```yaml
- name: Element with incoming references
  setup:
    - add reference: A -> C
    - add reference: B -> C
  call: getReferencesTo('C')
  expected: [ref(A->C), ref(B->C)]

- name: Element with no incoming references
  call: getReferencesTo('X')
  expected: []
```

---

### `getReferencesByType(type: string): Reference[]`

**Purpose:** Get all references of a specific type

**Behavior:**

- Returns array of references where `reference.type === type`
- Returns empty array if no references of that type exist
- O(1) lookup via type index

**Test Cases:**

```yaml
- name: Get realization references
  setup:
    - add reference: A -> B (type: realization)
    - add reference: C -> D (type: access)
  call: getReferencesByType('realization')
  expected: [ref(A->B)]

- name: Non-existent type
  call: getReferencesByType('unknown')
  expected: []
```

---

### `findBrokenReferences(validElementIds: Set<string>): Reference[]`

**Purpose:** Find references pointing to non-existent elements

**Behavior:**

- Checks each reference's target against valid IDs set
- Returns references where target not in valid set
- Useful for validation

**Test Cases:**

```yaml
- name: Broken reference
  setup:
    - add reference: A -> B
    - add reference: A -> Z
  call: findBrokenReferences(new Set(['A', 'B']))
  expected: [ref(A->Z)]

- name: All references valid
  setup:
    - add reference: A -> B
  call: findBrokenReferences(new Set(['A', 'B']))
  expected: []
```

---

### `getDependencyGraph(): Graph`

**Purpose:** Build directed graph from all references

**Behavior:**

- Creates directed graph where nodes = elements, edges = references
- Edge attributes include `type` and `property`
- Used by DependencyTracker

**Test Cases:**

```yaml
- name: Simple chain
  setup:
    - add reference: A -> B
    - add reference: B -> C
  call: getDependencyGraph()
  verify:
    - graph.hasNode('A') === true
    - graph.hasNode('B') === true
    - graph.hasNode('C') === true
    - graph.hasEdge('A', 'B') === true
    - graph.getEdgeAttribute('A', 'B', 'type') === 'realization'
```

---

### `findCircularDependencies(): string[][]`

**Purpose:** Detect cycles in dependency graph

**Behavior:**

- Uses graph cycle detection algorithm
- Returns array of cycles, each cycle is array of element IDs
- Empty array if no cycles

**Test Cases:**

```yaml
- name: Simple cycle
  setup:
    - add reference: A -> B
    - add reference: B -> C
    - add reference: C -> A
  call: findCircularDependencies()
  expected: [["A", "B", "C"]]

- name: No cycles
  setup:
    - add reference: A -> B
    - add reference: B -> C
  call: findCircularDependencies()
  expected: []

- name: Self-reference
  setup:
    - add reference: A -> A
  call: findCircularDependencies()
  expected: [["A"]]
```

---

### `getImpactAnalysis(elementId: string, maxDepth?: number): Set<string>`

**Purpose:** Find all elements impacted by changes to given element

**Behavior:**

- Reverses graph (dependents = incoming edges in original)
- Performs BFS/DFS to find all reachable nodes
- Respects maxDepth if provided (null = unlimited)
- Returns set of impacted element IDs (excludes source element)

**Test Cases:**

```yaml
- name: Simple chain impact
  setup:
    - add reference: A -> B (A depends on B)
    - add reference: C -> B (C depends on B)
  call: getImpactAnalysis('B')
  expected: Set(['A', 'C']) # Changing B impacts A and C

- name: Multi-level impact
  setup:
    - add reference: A -> B
    - add reference: B -> C
    - add reference: D -> C
  call: getImpactAnalysis('C')
  expected: Set(['B', 'D', 'A']) # C impacts B and D directly, A indirectly

- name: With max depth
  setup:
    - add reference: A -> B
    - add reference: B -> C
    - add reference: C -> D
  call: getImpactAnalysis('D', 2)
  expected: Set(['C', 'B']) # Only 2 levels up

- name: No impact
  call: getImpactAnalysis('X')
  expected: Set()
```

---

## Edge Cases

### Empty Registry

- All getters return empty arrays/sets
- Graph is empty
- No cycles found
- No broken references

### Duplicate References

- Adding same reference twice creates two entries
- Both appear in results
- Python doesn't deduplicate (implementation detail)

### Nested References

- Scans recursively through nested objects
- Property path uses dot notation (e.g., "data.schemaRef")
- Arrays of objects not scanned (only arrays of strings)

### Invalid Element IDs

- Methods don't validate element IDs exist
- Non-existent IDs simply return empty results
- Validation is caller's responsibility

---

## Performance Characteristics

| Operation                | Python CLI                | Expected TS |
| ------------------------ | ------------------------- | ----------- |
| registerElement          | O(n) where n = properties | O(n)        |
| getReferencesFrom        | O(1) (indexed)            | O(1)        |
| getReferencesTo          | O(1) (indexed)            | O(1)        |
| getReferencesByType      | O(1) (indexed)            | O(1)        |
| findBrokenReferences     | O(m) where m = total refs | O(m)        |
| getDependencyGraph       | O(m) build graph          | O(m)        |
| findCircularDependencies | O(V + E) cycle detection  | O(V + E)    |
| getImpactAnalysis        | O(V + E) BFS/DFS          | O(V + E)    |

---

## Integration Points

### Used By

- `Model` class - initializes and populates registry
- `DependencyTracker` - uses registry for graph operations
- `validate` command - checks broken references
- `trace` command - uses for dependency analysis

### Dependencies

- Graph library (networkx in Python, graphology in TS)
- Element class
- Layer schemas for reference definitions

---

## Migration Notes

### Python to TypeScript Differences

1. **Graph Library:**
   - Python: `networkx` (scipy-based)
   - TypeScript: `graphology` (pure JS)
   - Both provide similar APIs

2. **Collections:**
   - Python: `defaultdict(list)`
   - TypeScript: `Map<string, Array<T>>`
   - Same semantics, different syntax

3. **Set Operations:**
   - Python: `Set[str]`
   - TypeScript: `Set<string>`
   - Identical behavior

### Breaking Changes (Intentional)

None - should be byte-for-byte compatible where possible

### Implementation Status

✅ Class exists in TS CLI
⚠️ Needs verification tests
⚠️ May have bugs from incomplete port
