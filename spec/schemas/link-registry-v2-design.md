# Link Registry v2.0 Enhanced Design

**Version**: 2.0.0
**Status**: Design (Implementation in Week 6)
**Last Updated**: 2025-12-10

## Overview

This document specifies the enhanced link registry schema for v2.0.0, adding semantic predicates, inverse relationships, source element types, and other metadata to enable richer ontology queries and bidirectional navigation.

## Design Goals

1. **Semantic Predicates**: Make relationship semantics explicit, not just implied by field names
2. **Bidirectional Navigation**: Support inverse queries (e.g., "what supports this goal?")
3. **Complete Element Typing**: Include both source and target element types
4. **Relationship Strength**: Indicate importance of relationships
5. **ArchiMate Alignment**: Explicit mapping to ArchiMate where applicable
6. **Rich Examples**: Populate empty examples[] fields with concrete usage
7. **Backward Compatible**: Existing v0.6.0 tools continue to work

## New Fields

### Core Semantic Fields

#### `predicate` (string, optional)
Forward direction semantic predicate from the relationship taxonomy.

**Example**: `"supports-goals"`, `"fulfills-requirements"`, `"realizes"`

#### `inversePredicate` (string, optional)
Inverse direction predicate for bidirectional navigation.

**Example**: `"supported-by"`, `"fulfilled-by"`, `"realized-by"`

#### `relationshipCategory` (string, optional)
High-level semantic category from relationship taxonomy.

**Valid values**: `"structural"`, `"behavioral"`, `"dependency"`, `"traceability"`, `"governance"`, `"apm"`, `"security"`, `"ux"`, `"data"`

**Example**: `"traceability"` for supports-goals, `"structural"` for realizes

### Element Type Fields

#### `sourceElementTypes` (array of strings, optional)
Element types in source layer(s) that can have this link. **Missing in v0.6.0!**

**Example**: `["BusinessService", "ApplicationService"]` for supports-goals link

### Relationship Metadata Fields

#### `strength` (string, optional)
Indicates importance/strength of this relationship.

**Valid values**: `"critical"`, `"high"`, `"medium"`, `"low"`

**Example**:
- `"critical"` for security-resource (security controls are critical)
- `"high"` for supports-goals (strategic alignment is important)
- `"medium"` for business-metrics (useful but not essential)
- `"low"` for classification (nice-to-have metadata)

#### `isRequired` (boolean, optional)
Whether this link is mandatory for the source element.

**Example**:
- `true` for security-resource if all operations must have security controls
- `false` for supports-goals (not all services need explicit goal links)

#### `bidirectional` (boolean, optional)
Whether this link supports bidirectional navigation via inverse queries.

**Example**: `true` for most links with defined inverse predicates

#### `archimateAlignment` (string or null, optional)
Corresponding ArchiMate 3.2 relationship type, if any.

**Valid values**: `"Composition"`, `"Aggregation"`, `"Specialization"`, `"Realization"`, `"Assignment"`, `"Triggering"`, `"Flow"`, `"Serving"`, `"Access"`, `"Influence"`, `null`

**Example**:
- `"Realization"` for application-realized-by-process
- `null` for supports-goals (no ArchiMate equivalent)

### Enhanced Example Structure

#### Old (v0.6.0):
```json
"examples": []
```

#### New (v2.0.0):
```json
"examples": [
  {
    "source": {
      "layer": "04-application",
      "type": "ApplicationService",
      "id": "payment-service"
    },
    "target": {
      "layer": "01-motivation",
      "type": "Goal",
      "id": "goal-revenue-growth"
    },
    "value": "goal-revenue-growth",
    "description": "Payment service supports revenue growth goal by enabling transactions"
  }
]
```

### Enhanced Validation Rules

#### Old (v0.6.0):
```json
"validationRules": {
  "targetExists": true,
  "targetType": "Goal"
}
```

#### New (v2.0.0):
```json
"validationRules": {
  "targetExists": true,
  "targetType": "Goal",
  "sourceElementTypesValid": ["BusinessService", "ApplicationService"],
  "minimumCardinality": 0,
  "maximumCardinality": null
}
```

### Deprecation Support

#### `deprecation` (object or null, optional)
Information about deprecated link types.

```json
"deprecation": {
  "deprecated": true,
  "since": "2.0.0",
  "reason": "Replaced by more specific link types",
  "replacement": "new-link-type-id"
}
```

## Complete Example

Here's a complete link type with all v2.0 enhancements:

```json
{
  "id": "motivation-supports-goals",
  "name": "Supports Goals",
  "category": "motivation",

  "sourceLayers": ["02-business", "04-application", "05-technology", "06-api"],
  "targetLayer": "01-motivation",
  "targetElementTypes": ["Goal"],
  "fieldPaths": ["motivation.supports-goals", "x-supports-goals"],
  "cardinality": "array",
  "format": "uuid",
  "description": "comma-separated Goal IDs this service supports",

  "validationRules": {
    "targetExists": true,
    "targetType": "Goal",
    "sourceElementTypesValid": ["BusinessService", "ApplicationService", "TechnologyService", "APIOperation"],
    "minimumCardinality": 0,
    "maximumCardinality": null
  },

  "predicate": "supports-goals",
  "inversePredicate": "supported-by",
  "relationshipCategory": "traceability",
  "sourceElementTypes": ["BusinessService", "ApplicationService", "TechnologyService", "APIOperation"],
  "strength": "high",
  "isRequired": false,
  "bidirectional": true,
  "archimateAlignment": null,

  "examples": [
    {
      "source": {
        "layer": "04-application",
        "type": "ApplicationService",
        "id": "payment-service"
      },
      "target": {
        "layer": "01-motivation",
        "type": "Goal",
        "id": "goal-revenue-growth"
      },
      "value": "goal-revenue-growth",
      "description": "Payment service supports revenue growth goal by enabling online transactions"
    },
    {
      "source": {
        "layer": "06-api",
        "type": "APIOperation",
        "id": "create-order"
      },
      "target": {
        "layer": "01-motivation",
        "type": "Goal",
        "id": "goal-improve-conversion"
      },
      "value": "goal-improve-conversion",
      "description": "Create order API operation supports conversion improvement goal"
    }
  ],

  "deprecation": null
}
```

## Migration Strategy

### Phase 1: Additive Fields (Week 5)
- Add new fields to schema as **optional**
- Existing tools continue to work (backward compatible)
- New fields enhance capabilities but aren't required

### Phase 2: Populate New Fields (Week 6)
- Use automated generator to populate:
  - `predicate` and `inversePredicate` from relationship-catalog.json
  - `relationshipCategory` from predicate mapping
  - `sourceElementTypes` from layer markdown analysis
  - `strength` from heuristics (APM/Security = critical/high, metadata = low)
  - `isRequired` from validation rule analysis
  - `bidirectional` = true for all with inverse predicates
  - `archimateAlignment` from relationship-catalog.json
  - `examples` from layer markdown Example Model sections

### Phase 3: Validation & Testing (Week 6)
- Validate enhanced registry against link-registry.schema.json
- Test LinkRegistry class with enhanced fields
- Ensure backward compatibility with v0.6.0 usage

## Mapping to Relationship Catalog

Link types will be mapped to relationship catalog entries:

| Link Registry Field | Relationship Catalog Source |
|---------------------|----------------------------|
| `predicate` | `relationshipTypes[].predicate` |
| `inversePredicate` | `relationshipTypes[].inversePredicate` |
| `relationshipCategory` | `relationshipTypes[].category` |
| `archimateAlignment` | `relationshipTypes[].archimateAlignment` |
| `examples` | `relationshipTypes[].examples` |

### Automatic Mapping Algorithm

1. Extract predicate from `fieldPaths[0]`:
   - `"motivation.supports-goals"` → `"supports-goals"`
   - `"x-supports-goals"` → `"supports-goals"`

2. Look up predicate in relationship-catalog.json

3. If found, populate:
   - `predicate`
   - `inversePredicate`
   - `relationshipCategory`
   - `archimateAlignment`

4. If not found, use fallback:
   - `relationshipCategory = "other"`
   - `predicate = null`
   - Log warning for manual review

## Field Population Heuristics

### `sourceElementTypes`
Extract from layer markdown files by:
1. Finding all entity definitions in source layers (### headings)
2. Searching for field path usage in property definitions
3. Recording which entity types use this field path
4. Deduplicating and sorting

### `strength`
Use category-based heuristics:
- **critical**: security (security-resource, security-roles, security-permissions)
- **high**: traceability (supports-goals, fulfills-requirements), governance (governed-by-principles)
- **medium**: business alignment (business-metrics, target-actors), APM (sla-target-*)
- **low**: metadata/classification (classification, tags)

### `isRequired`
Based on validation rules:
- `isRequired = true` if `validationRules.minimumCardinality > 0`
- `isRequired = false` otherwise (default)

### `examples`
Extract from layer markdown Example Model sections:
1. Parse YAML/XML examples in markdown
2. Find property usages matching field paths
3. Extract source/target IDs and types
4. Generate example objects with descriptions

## Backward Compatibility

### v0.6.0 Tools Compatibility
All v0.6.0 tools that read link-registry.json will continue to work because:
- New fields are **optional**
- Core required fields unchanged:
  - `id`, `name`, `category`
  - `sourceLayers`, `targetLayer`, `targetElementTypes`
  - `fieldPaths`, `cardinality`, `format`, `description`
  - `validationRules`

### New Capabilities Enabled
v2.0.0 tools gain:
- Semantic query capabilities: "find all links with predicate 'supports-goals'"
- Inverse navigation: "what supports goal X?"
- Strength filtering: "show only critical/high strength relationships"
- ArchiMate mapping: "export to ArchiMate with correct relationship types"
- Rich examples: "show me how to use this link type"

## Implementation Timeline

- **Week 5** (Current): Design specification (this document), schema validation
- **Week 6**: Automated generator implementation, population, testing

## Related Documents

- [Relationship Taxonomy](../core/07-relationship-taxonomy.md) - Predicate definitions
- [Relationship Catalog](relationship-catalog.json) - Machine-readable predicate catalog
- [Link Registry Schema](link-registry.schema.json) - JSON Schema validator
- [Link Registry Generator](../../scripts/generators/link_registry_generator.py) - Automated generator (Week 6)
