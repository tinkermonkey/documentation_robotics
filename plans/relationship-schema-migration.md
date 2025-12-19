# Relationship Schema Migration Plan

**Date:** 2025-12-19
**Spec Version:** 0.6.0 → 0.7.0
**CLI Version:** 0.7.3 → 0.8.0
**Status:** In Progress

## Overview

Migrate relationship and cross-layer link definitions from separate registry files into layer schemas, creating a unified, self-documenting schema structure. This eliminates redundancy, improves discoverability, and ensures AI assistants have complete relationship information.

## Terminology

- **Relationship**: Generic term for any semantic connection between elements
  - **Intra-layer relationship**: Connection between elements WITHIN the same layer (e.g., composition, aggregation)
  - **Cross-layer relationship**: Connection between elements in DIFFERENT layers (e.g., supports-goals, fulfills-requirements)
- **Predicate**: Semantic verb describing the relationship direction (e.g., "supports", "realizes")
- **Relationship Type**: A category of relationship from the relationship catalog (e.g., "composition", "realization")

## Problem Statement

### Current Issues

1. **Fragmented Information:**
   - Relationship definitions scattered across multiple files
   - Layer markdown specs incomplete (testing layer has 0 relationship docs, but 21 relationships exist in catalog)
   - Link registry incomplete (only 6 of 12 layers covered)

2. **Missing from CLI Bundle:**
   - `relationship-catalog.json` not bundled (34 relationship types missing)
   - `relationship-type.schema.json` not bundled
   - `common/predicates.schema.json` not bundled
   - `common/relationships.schema.json` not bundled

3. **AI Assistant Limitations:**
   - Claude Code/GitHub Copilot only see layer markdown files
   - Miss critical relationship metadata (transitivity, symmetry, ArchiMate alignment)
   - Cannot validate relationship usage without catalog access

## Solution Design

### Terminology Update

Replace "link" terminology with "relationship" consistently:

- `crossLayerLinks` → `crossLayerRelationships`
- `link-registry.json` → DEPRECATED (functionality moved to schemas)
- Documentation: "cross-layer relationship" instead of "cross-layer link"

### Enhanced Layer Schema Structure

Each layer schema gains three new top-level sections:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Testing Layer Schema",
  "version": "1.0.0",

  "layerMetadata": {
    "layerId": "12-testing",
    "layerName": "Testing Layer",
    "intraLayerRelationshipSupport": true,
    "crossLayerRelationshipSupport": true,
    "relationshipCatalogVersion": "2.1.0"
  },

  "intraLayerRelationships": {
    "$comment": "Relationships between entities within this layer. References relationship-catalog.json by ID.",
    "allowed": [
      {
        "relationshipTypeId": "composition",
        "sourceTypes": ["TestCoverageModel"],
        "targetTypes": ["TestCoverageTarget", "OutcomeCategory"],
        "examples": [
          {
            "source": "TestCoverageModel",
            "target": "TestCoverageTarget",
            "description": "Coverage model composes targets defining what needs testing"
          }
        ]
      },
      {
        "relationshipTypeId": "aggregation",
        "sourceTypes": ["InputPartitionSelection"],
        "targetTypes": ["PartitionValue"],
        "examples": [
          {
            "source": "InputPartitionSelection",
            "target": "PartitionValue",
            "description": "Partition selection aggregates multiple partition values to cover"
          }
        ]
      }
    ]
  },

  "crossLayerRelationships": {
    "$comment": "Relationships to/from entities in other layers",
    "outgoing": [
      {
        "id": "testing-supports-goals",
        "predicate": "supports-goals",
        "inversePredicate": "supported-by",
        "targetLayer": "01-motivation",
        "targetTypes": ["Goal"],
        "sourceTypes": ["TestCoverageModel", "TestCaseSketch"],
        "fieldPath": "motivation.supports-goals",
        "cardinality": "array",
        "format": "uuid",
        "strength": "high",
        "required": false,
        "description": "Testing elements support strategic goals",
        "examples": [
          {
            "source": "TestCoverageModel",
            "sourceType": "TestCoverageModel",
            "target": "goal-quality-assurance",
            "targetType": "Goal",
            "description": "Coverage model supports quality assurance goal"
          }
        ]
      }
    ],
    "incoming": [
      {
        "id": "api-tests-endpoint",
        "predicate": "tests",
        "inversePredicate": "tested-by",
        "sourceLayer": "12-testing",
        "sourceTypes": ["TestCase"],
        "targetTypes": ["Operation"],
        "fieldPath": "testing.tested-by",
        "cardinality": "array",
        "description": "Test cases validate API operations"
      }
    ]
  },

  "definitions": {
    // ... existing entity definitions
  }
}
```

### File Structure Changes

#### Files to Keep and Bundle

```
spec/schemas/
├── relationship-catalog.json              # KEEP: Canonical source
├── relationship-type.schema.json          # KEEP: Validates catalog
├── common/
│   ├── predicates.schema.json            # KEEP: Predicate library
│   └── relationships.schema.json         # KEEP: Property schemas
└── 01-motivation-layer.schema.json       # EXTEND
    02-business-layer.schema.json         # EXTEND
    ... (all 12 layer schemas)            # EXTEND

cli/src/documentation_robotics/schemas/bundled/
├── relationship-catalog.json              # ADD: Bundle this
├── relationship-type.schema.json          # ADD: Bundle this
├── common/
│   ├── predicates.schema.json            # ADD: Bundle this
│   └── relationships.schema.json         # ADD: Bundle this
└── *.schema.json                         # UPDATE: All layer schemas
```

#### Files to Deprecate

```
spec/schemas/
├── link-registry.json                     # DEPRECATE: v0.7.0, remove v0.8.0
└── link-registry.schema.json              # DEPRECATE: v0.7.0, remove v0.8.0
```

## Migration Steps

### Phase 1: Schema Design and Validation (Steps 1-3)

#### Step 1: Create Schema Extension Definitions

Create `spec/schemas/common/layer-extensions.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://documentation-robotics.org/schemas/common/layer-extensions.schema.json",
  "title": "Layer Schema Extensions",
  "description": "Definitions for intraLayerRelationships and crossLayerRelationships sections",
  "version": "1.0.0",

  "definitions": {
    "layerMetadata": {
      "type": "object",
      "properties": {
        "layerId": {
          "type": "string",
          "pattern": "^\\d{2}-[a-z-]+$"
        },
        "layerName": {
          "type": "string"
        },
        "intraLayerRelationshipSupport": {
          "type": "boolean"
        },
        "crossLayerRelationshipSupport": {
          "type": "boolean"
        },
        "relationshipCatalogVersion": {
          "type": "string",
          "pattern": "^\\d+\\.\\d+\\.\\d+$"
        }
      },
      "required": ["layerId", "layerName", "relationshipCatalogVersion"]
    },

    "intraLayerRelationship": {
      "type": "object",
      "properties": {
        "relationshipTypeId": {
          "type": "string",
          "description": "ID from relationship-catalog.json"
        },
        "sourceTypes": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 1
        },
        "targetTypes": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 1
        },
        "examples": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "source": { "type": "string" },
              "target": { "type": "string" },
              "description": { "type": "string" }
            },
            "required": ["source", "target", "description"]
          }
        }
      },
      "required": ["relationshipTypeId", "sourceTypes", "targetTypes"]
    },

    "crossLayerRelationship": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*$"
        },
        "predicate": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*$"
        },
        "inversePredicate": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*$"
        },
        "targetLayer": {
          "type": "string",
          "pattern": "^\\d{2}-[a-z-]+$"
        },
        "targetTypes": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 1
        },
        "sourceTypes": {
          "type": "array",
          "items": { "type": "string" }
        },
        "fieldPath": {
          "type": "string",
          "pattern": "^([a-z][a-zA-Z0-9]*\\.[a-z][a-z0-9-]*|x-[a-z][a-z0-9-]*)$"
        },
        "cardinality": {
          "type": "string",
          "enum": ["single", "array"]
        },
        "format": {
          "type": "string",
          "enum": ["uuid", "id", "string"]
        },
        "strength": {
          "type": "string",
          "enum": ["critical", "high", "medium", "low"]
        },
        "required": {
          "type": "boolean"
        },
        "description": {
          "type": "string"
        },
        "examples": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "source": { "type": "string" },
              "sourceType": { "type": "string" },
              "target": { "type": "string" },
              "targetType": { "type": "string" },
              "description": { "type": "string" }
            }
          }
        }
      },
      "required": [
        "id",
        "predicate",
        "inversePredicate",
        "targetLayer",
        "targetTypes",
        "fieldPath",
        "cardinality",
        "format",
        "description"
      ]
    }
  }
}
```

#### Step 2: Extract Relationship Data

Create data extraction script `scripts/extract-relationship-data.py`:

- Parse relationship-catalog.json for all intra-layer relationships by layer
- Parse link-registry.json for all cross-layer relationships
- Parse layer markdown files for documented relationships
- Generate per-layer relationship data files for review

#### Step 3: Update One Layer as Proof of Concept

Choose testing layer (12-testing) as proof of concept:

- Add `layerMetadata` section
- Add `intraLayerRelationships` section with all 21 relationships from catalog
- Add `crossLayerRelationships` section with outgoing/incoming relationships
- Validate against extended schema
- Review with stakeholders

### Phase 2: Schema Migration (Steps 4-6)

#### Step 4: Update All 12 Layer Schemas

For each layer schema (01 through 12):

1. Add `layerMetadata` section
2. Add `intraLayerRelationships.allowed[]` with all applicable relationship types
3. Add `crossLayerRelationships.outgoing[]` with all outgoing relationships
4. Add `crossLayerRelationships.incoming[]` with all incoming relationships
5. Validate schema syntax
6. Validate against relationship catalog references

#### Step 5: Bundle Catalog Files with CLI

Copy to `cli/src/documentation_robotics/schemas/bundled/`:

- `relationship-catalog.json`
- `relationship-type.schema.json`
- `common/predicates.schema.json`
- `common/relationships.schema.json`
- `common/layer-extensions.schema.json` (new)

Update `cli/src/documentation_robotics/schemas/__init__.py` to expose these files.

#### Step 6: Deprecate Link Registry

1. Add deprecation notice to `link-registry.json`:

   ```json
   {
     "$schema": "...",
     "deprecated": {
       "since": "0.7.0",
       "reason": "Cross-layer relationships now defined in layer schemas",
       "removeIn": "0.8.0",
       "migration": "See layer schema crossLayerRelationships sections"
     },
     ...
   }
   ```

2. Add deprecation notice to `link-registry.schema.json`

3. Update documentation referencing link registry

### Phase 3: Code Updates (Steps 7-9)

#### Step 7: Update Validators

**Files to modify:**

1. `cli/src/documentation_robotics/validators/relationship_validator.py` (new):

   ```python
   class RelationshipValidator:
       def __init__(self, relationship_catalog_path):
           self.catalog = self._load_catalog(relationship_catalog_path)

       def validate_intra_layer_relationship(self, layer_schema, source_type, target_type, relationship_type_id):
           """Validate relationship against layer schema's allowed relationships"""
           pass

       def validate_cross_layer_relationship(self, source_layer, target_layer, predicate, source_id, target_id):
           """Validate cross-layer relationship exists and is valid"""
           pass
   ```

2. `cli/src/documentation_robotics/validators/semantic.py`:
   - Add relationship validation using new RelationshipValidator
   - Check against layer schema's `intraLayerRelationships.allowed`
   - Check against layer schema's `crossLayerRelationships.outgoing`

3. `cli/src/documentation_robotics/core/relationship_registry.py`:
   - Update to load relationship definitions from layer schemas
   - Add method to load relationship catalog
   - Deprecate link-registry loading code

#### Step 8: Update Reference Registry

`cli/src/documentation_robotics/core/reference_registry.py`:

- Add support for cross-layer relationship validation
- Load cross-layer relationships from layer schemas
- Validate against `crossLayerRelationships` definitions

#### Step 9: Update Reporting

**Files to modify:**

1. `cli/src/documentation_robotics/commands/validate.py`:
   - Report on intra-layer relationship validation
   - Report on cross-layer relationship validation
   - Include relationship catalog version in output

2. `cli/src/documentation_robotics/export/plantuml_exporter.py`:
   - Use relationship catalog for relationship styling
   - Use predicate names from cross-layer relationships

3. `cli/src/documentation_robotics/export/graphml_exporter.py`:
   - Include relationship metadata in graph edges
   - Use relationship categories for edge types

### Phase 4: Testing and Documentation (Steps 10-12)

#### Step 10: Update Tests

**New test files:**

1. `cli/tests/unit/test_relationship_validator.py`:
   - Test intra-layer relationship validation
   - Test cross-layer relationship validation
   - Test relationship catalog loading

2. `cli/tests/integration/test_relationship_validation.py`:
   - Test full validation pipeline with relationships
   - Test error reporting for invalid relationships

**Update existing tests:**

1. `cli/tests/unit/test_relationship_registry.py`:
   - Update to use new layer schema structure
   - Add tests for catalog-based validation

2. `cli/tests/integration/test_validation.py`:
   - Update fixtures to include relationship sections
   - Test validation against extended schemas

#### Step 11: Update Documentation

**Files to update:**

1. `CLAUDE.md`:
   - Update "Schema Synchronization" section
   - Document relationship catalog bundling
   - Update examples to show new schema structure

2. `spec/CHANGELOG.md`:

   ```markdown
   ## [0.7.0] - 2025-12-XX

   ### Added

   - Layer schemas now include `intraLayerRelationships` section
   - Layer schemas now include `crossLayerRelationships` section
   - `layerMetadata` section in all layer schemas
   - `relationship-catalog.json` now bundled with spec
   - Common schema library files bundled with spec

   ### Deprecated

   - `link-registry.json` - functionality moved to layer schemas
   - `link-registry.schema.json` - will be removed in v0.8.0

   ### Changed

   - Terminology: "cross-layer links" → "cross-layer relationships"
   ```

3. `cli/CHANGELOG.md`:

   ```markdown
   ## [0.8.0] - 2025-12-XX

   ### Added

   - Relationship validation using relationship catalog
   - Support for intra-layer relationship validation
   - Support for cross-layer relationship validation
   - Bundled relationship-catalog.json with CLI

   ### Changed

   - Validators now use layer schema relationship definitions
   - Reference registry uses cross-layer relationship metadata
   ```

4. `spec/layers/*.md`:
   - Update "Relationships" sections to reference layer schema
   - Update "Cross-Layer Relationships" sections to reference layer schema
   - Add note: "For machine-readable definitions, see layer schema file"

#### Step 12: Run Full Validation

```bash
# Validate all layer schemas
cd spec/schemas
for schema in *.schema.json; do
  echo "Validating $schema..."
  ajv validate -s "$schema" -r "common/*.schema.json" -r "relationship-type.schema.json"
done

# Validate relationship catalog
ajv validate -s relationship-type.schema.json -d relationship-catalog.json

# Run CLI tests
cd ../../cli
pytest --cov=documentation_robotics --cov-report=html

# Validate example models
dr validate --all-layers
```

## Data Migration Details

### Intra-Layer Relationships by Layer

Data source: `relationship-catalog.json`

**Testing Layer (12) - 21 relationships:**

- composition: 4 examples
- aggregation: 3 examples
- triggering: 2 examples
- flow: 2 examples
- serving: 2 examples
- access: 2 examples
- reference: 3 examples
- depends-on: 3 examples
- validates: 2 examples

**Motivation Layer (01) - relationships:**

- aggregation: Goal → Goal, Requirement → Requirement
- realization: Outcome → Goal, Goal → Value
- influence: Driver → Assessment, Driver → Goal, Assessment → Goal, etc.
- association: Stakeholder ↔ Driver, Stakeholder ↔ Goal, etc.

**[Extract remaining layers from catalog...]**

### Cross-Layer Relationships by Layer

Data sources:

1. `link-registry.json` (partial, 38 link types)
2. Layer markdown `## Cross-Layer Relationships` sections
3. Common schema `relationships.schema.json` property definitions

**Testing Layer (12) - Outgoing:**

- To 01-motivation: supports-goals, fulfills-requirements, governed-by-principles, constrained-by
- [Extract from markdown and link-registry...]

**Testing Layer (12) - Incoming:**

- From 06-api: tests (TestCase → Operation)
- [Extract from markdown...]

**[Define for all 12 layers...]**

## Rollback Plan

If migration fails or causes issues:

1. **Revert layer schema changes:**

   ```bash
   git checkout main -- spec/schemas/*.schema.json
   ```

2. **Remove bundled files:**

   ```bash
   rm cli/src/documentation_robotics/schemas/bundled/relationship-catalog.json
   rm cli/src/documentation_robotics/schemas/bundled/relationship-type.schema.json
   rm -rf cli/src/documentation_robotics/schemas/bundled/common/
   ```

3. **Revert code changes:**

   ```bash
   git checkout main -- cli/src/documentation_robotics/validators/
   git checkout main -- cli/src/documentation_robotics/core/
   ```

4. **Revert documentation:**

   ```bash
   git checkout main -- CLAUDE.md spec/CHANGELOG.md cli/CHANGELOG.md
   ```

## Success Criteria

- [ ] All 12 layer schemas have `layerMetadata`, `intraLayerRelationships`, and `crossLayerRelationships` sections
- [ ] All layer schemas validate against JSON Schema Draft 7
- [ ] Relationship catalog and common schemas bundled with CLI
- [ ] All intra-layer relationships from catalog included in layer schemas
- [ ] All cross-layer relationships from link registry migrated to layer schemas
- [ ] CLI validators use new relationship definitions
- [ ] All tests pass (unit and integration)
- [ ] Documentation updated (CLAUDE.md, CHANGELOGs, layer specs)
- [ ] Example models validate successfully
- [ ] Link registry deprecated with clear migration path

## Risks and Mitigations

| Risk                         | Impact | Mitigation                                              |
| ---------------------------- | ------ | ------------------------------------------------------- |
| Schema validation errors     | High   | Implement incrementally, validate each schema           |
| Breaking existing models     | High   | Maintain backward compatibility, deprecation period     |
| Incomplete relationship data | Medium | Cross-reference catalog, link registry, and markdown    |
| Performance impact           | Low    | Lazy-load relationship catalog, cache validations       |
| Documentation drift          | Medium | Update all docs in same PR, include in review checklist |

## Timeline

**Estimated effort:** 12-16 hours

- Phase 1 (Schema Design): 3-4 hours
- Phase 2 (Schema Migration): 4-5 hours
- Phase 3 (Code Updates): 3-4 hours
- Phase 4 (Testing & Docs): 2-3 hours

**Checkpoint intervals:** After each phase, commit progress and validate

## Notes

- Use testing layer (12) as proof of concept in Phase 1
- Validate against relationship catalog version 2.1.0
- Maintain backward compatibility during deprecation period
- Consider generating schema sections from catalog (future automation)

## Resumption Instructions

If this migration is interrupted, resume from:

1. Check last completed step in this document
2. Review git log for last commit
3. Run validation: `pytest cli/tests/unit/test_relationship_*.py`
4. Continue from next step in sequence

**Current Status:** ✅ COMPLETE - All phases finished successfully

**Test Results:**

- ✅ All 13 relationship validator tests passed
- ✅ Schema validation confirmed (layerMetadata, intraLayerRelationships, crossLayerRelationships present)
- ✅ Bundled catalog verified (v2.1.0, 34 relationship types)
- ✅ Common schemas bundled successfully
