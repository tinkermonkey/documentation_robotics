# Graph Representation Mapping Guide

## Overview

The codebase uses multiple graph representations with inconsistent field naming:

1. **GraphNode/GraphEdge** - Internal representation in `graph-model.ts`
2. **MigrationGraphNode/MigrationGraphEdge** - Export/migration format
3. **Element/Relationship/Reference** - Core domain types

This guide documents the field mapping between these representations and provides strategies for working with them.

## Field Naming Inconsistencies

### Node Representation

| Aspect       | GraphNode                 | MigrationGraphNode        | Element                   |
| ------------ | ------------------------- | ------------------------- | ------------------------- |
| Identifier   | `id: string`              | `id: string`              | `id: string`              |
| Type         | `type: string`            | `labels: string[]`        | `type: string`            |
| Layer        | `layer: string`           | `labels[0]`               | `layer: string`           |
| Name         | `name: string`            | (in properties)           | `name: string`            |
| Description  | `description?: string`    | (in properties)           | `description?: string`    |
| Custom Props | `properties: Record<...>` | `properties: Record<...>` | `properties: Record<...>` |

### Edge Representation

| Aspect          | GraphEdge                               | MigrationGraphEdge         | Relationship               | Reference        |
| --------------- | --------------------------------------- | -------------------------- | -------------------------- | ---------------- |
| ID              | `id: string`                            | `id: string`               | (generated)                | (generated)      |
| Source          | `source: string`                        | `source: string`           | `source: string`           | `source: string` |
| **Destination** | `destination`                           | **`target`**               | `target`                   | `target`         |
| **Type**        | `predicate`                             | **`relationship`**         | `predicate`                | `type`           |
| Properties      | `properties?: Record<...>`              | `properties?: Record<...>` | `properties?: Record<...>` | description only |
| Category        | `category?: 'structural'\|'behavioral'` | —                          | `category?: ...`           | —                |

**Key differences highlighted in bold** - This is where errors occur most frequently.

## Conversion Patterns

### GraphEdge ↔ MigrationGraphEdge

```typescript
// GraphEdge → MigrationGraphEdge
const migrationEdge: MigrationGraphEdge = {
  id: graphEdge.id,
  source: graphEdge.source,
  target: graphEdge.destination, // ← destination → target
  relationship: graphEdge.predicate, // ← predicate → relationship
  properties: graphEdge.properties,
};

// MigrationGraphEdge → GraphEdge
const graphEdge: GraphEdge = {
  id: migrationEdge.id,
  source: migrationEdge.source,
  destination: migrationEdge.target, // ← target → destination
  predicate: migrationEdge.relationship, // ← relationship → predicate
  properties: migrationEdge.properties,
};
```

### Core Types ↔ GraphEdge

```typescript
// Relationship → GraphEdge
const edge: GraphEdge = {
  id: generateId(),
  source: relationship.source,
  destination: relationship.target, // ← same field name but different context
  predicate: relationship.predicate,
  properties: relationship.properties,
};

// Reference → GraphEdge
const edge: GraphEdge = {
  id: generateId(),
  source: reference.source,
  destination: reference.target, // ← same field name
  predicate: `REFERENCES_${reference.type.toUpperCase()}`,
  properties: reference.description ? { description: reference.description } : undefined,
};
```

## Using the Mapping Layer

The `src/core/graph-mapping.ts` module provides utilities for safe conversions:

```typescript
import {
  UnifiedEdge,
  graphEdgeToUnified,
  unifiedToGraphEdge,
  migrationEdgeToUnified,
  getEdgeDestination,
  getEdgeType,
  getNodeType,
} from "./graph-mapping.js";

// Safe accessor for destination regardless of representation
function processEdge(edge: GraphEdge | MigrationGraphEdge) {
  const destination = getEdgeDestination(edge);
  const edgeType = getEdgeType(edge);

  // Now you can use these safely without worrying about field naming
}

// Convert to unified representation for processing
const unified = graphEdgeToUnified(graphEdge);
// unified.destination and unified.type are guaranteed to exist

// Convert back to specific representation
const specific = unifiedToGraphEdge(unified);
```

## Common Mistakes to Avoid

### ❌ Accessing `edge.target` on GraphEdge

```typescript
// WRONG - GraphEdge doesn't have .target
const dest = graphEdge.target; // undefined!

// CORRECT
const dest = graphEdge.destination;
```

### ❌ Accessing `edge.destination` on MigrationGraphEdge

```typescript
// WRONG - MigrationGraphEdge doesn't have .destination
const dest = migrationEdge.destination; // undefined!

// CORRECT
const dest = migrationEdge.target;
```

### ❌ Accessing `predicate` on MigrationGraphEdge

```typescript
// WRONG - MigrationGraphEdge uses 'relationship'
const type = migrationEdge.predicate; // undefined!

// CORRECT
const type = migrationEdge.relationship;
```

### ❌ Assuming node.type is always a string

```typescript
// WRONG - MigrationGraphNode has labels array
if (node.type === "goal") {
  // This works for GraphNode but not MigrationGraphNode
  // ...
}

// CORRECT - Use mapping layer
const nodeType = getNodeType(node); // Works for both
if (nodeType === "goal") {
  // ...
}
```

## Refactoring Strategy

This inconsistency was introduced during a major refactor and fixing it immediately would require changing many files. The gradual approach:

### Phase 1: Document & Provide Accessors ✅

- Created `graph-mapping.ts` with safe accessors
- Documented field mappings
- Created this guide

### Phase 2: Add Type Guards (Recommended)

```typescript
function isGraphEdge(edge: unknown): edge is GraphEdge {
  return typeof edge === "object" && edge !== null && "destination" in edge;
}

function isMigrationGraphEdge(edge: unknown): edge is MigrationGraphEdge {
  return typeof edge === "object" && edge !== null && "target" in edge;
}
```

### Phase 3: Gradually Standardize (Future)

- Decide on standard names (`target` vs `destination`, `type` vs `predicate`)
- Add type aliases to existing interfaces
- Gradually migrate code to use standard names
- Add linting rules to prevent mixing representations

### Phase 4: Major Version Deprecation (Future)

- In next major version, remove old field names
- Keep only unified representation
- Update all code to use standardized names

## Checklist for New Code

When working with graph representations:

- [ ] Use `getEdgeDestination()` / `getEdgeType()` / `getNodeType()` for safe access
- [ ] Convert to `UnifiedEdge` if you need to process multiple representation types
- [ ] Document if your code only handles one representation type
- [ ] Add type guards if mixing representations
- [ ] Test both GraphEdge and MigrationGraphEdge if your code handles edges
- [ ] Use `const edge: GraphEdge | MigrationGraphEdge` type hint when appropriate

## See Also

- `src/core/graph-mapping.ts` - Implementation of mapping utilities
- `src/core/graph-model.ts` - GraphNode/GraphEdge definitions
- `src/export/graph-migration.ts` - MigrationGraphNode/MigrationGraphEdge definitions
- `src/types/index.ts` - Element/Relationship/Reference definitions
