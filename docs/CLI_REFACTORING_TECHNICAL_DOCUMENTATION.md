# Technical Documentation Analysis: CLI Schema-Driven Architecture Refactoring

**Issue:** #330 - Refactor the CLI to work with the newly refactored specification model
**Related Issue:** #316 - Specification model refactoring
**Status:** Planning & Design Phase
**Date:** 2026-02-10
**Prepared by:** Technical Writer

---

## Executive Summary

This document provides comprehensive documentation requirements for refactoring the Documentation Robotics CLI to implement a fully schema-driven architecture. The refactoring capitalizes on the specification model refactoring (Issue #316) where every model node and relationship now maps to a JSON schema, enabling complete conformance validation and eliminating hardcoded type definitions.

**Documentation Scope:** Five documentation categories covering API references, user guides, developer documentation, system architecture, and operations procedures for the refactored CLI.

**Key Documentation Deliverables:**

- API reference documentation for generated registries and validators
- User guides for new validation commands and workflows
- Developer guides for schema-driven development patterns
- Architecture documentation for build-time code generation
- Operations guides for schema synchronization and deployment

---

## Table of Contents

1. [API Documentation](#1-api-documentation)
2. [User Documentation](#2-user-documentation)
3. [Developer Documentation](#3-developer-documentation)
4. [System Documentation](#4-system-documentation)
5. [Operations Documentation](#5-operations-documentation)
6. [Documentation Delivery Timeline](#6-documentation-delivery-timeline)

---

## 1. API Documentation

### 1.1 Overview

The schema-driven architecture introduces three major generated API modules (LayerRegistry, NodeTypeIndex, RelationshipIndex) and modifies existing validation APIs. API documentation must serve two audiences:

1. **CLI Extension Developers** - Building custom commands or integrations
2. **Library Consumers** - Using CLI components programmatically

### 1.2 LayerRegistry API Reference

**File:** `cli/src/generated/layer-registry.ts` (auto-generated)
**Purpose:** Runtime access to layer metadata derived from specification layer instances

#### 1.2.1 Core Interfaces

```typescript
/**
 * Metadata for a single architecture layer.
 * Generated from spec/layers/*.layer.json files during build.
 */
interface LayerMetadata {
  /** Canonical layer identifier (hyphenated lowercase, e.g., "data-store") */
  id: string;

  /** Layer number (1-12) for hierarchy and reference validation */
  number: number;

  /** Human-readable layer name (e.g., "Data Store Layer") */
  name: string;

  /** Layer description and purpose */
  description: string;

  /** Valid spec_node_id values for this layer (e.g., ["motivation.goal", "motivation.requirement"]) */
  nodeTypes: string[];

  /** Source standard metadata (if applicable) */
  inspiredBy?: {
    standard: string; // "ArchiMate", "OpenAPI", "JSON Schema", etc.
    version: string; // "3.2", "3.0", "draft-07", etc.
    url?: string; // URL to standard specification
  };
}
```

**Documentation Requirements:**

- **Field Descriptions:**
  - `id`: Canonical layer name format rules (hyphenated, lowercase)
  - `number`: Layer hierarchy position (1-12), used for reference direction validation
  - `name`: Display name for UI and error messages
  - `description`: Layer purpose and scope
  - `nodeTypes`: Array of valid `spec_node_id` values (layer.type format)
  - `inspiredBy`: Standards mapping for ArchiMate, OpenAPI, etc.

- **Value Constraints:**
  - `id` must match canonical format (see CLAUDE.md Section 4.1)
  - `number` must be 1-12 (inclusive)
  - `nodeTypes` must reference existing node schemas

#### 1.2.2 Public API Methods

```typescript
/**
 * Complete layer registry indexed by layer ID.
 * Key: canonical layer ID (e.g., "data-store")
 * Value: LayerMetadata
 */
export const LAYERS: Map<string, LayerMetadata>;

/**
 * Retrieve layer metadata by canonical ID.
 * @param id - Canonical layer ID (e.g., "motivation", "data-store")
 * @returns LayerMetadata or undefined if not found
 */
export function getLayerById(id: string): LayerMetadata | undefined;

/**
 * Retrieve layer metadata by layer number.
 * @param n - Layer number (1-12)
 * @returns LayerMetadata or undefined if not found
 */
export function getLayerByNumber(n: number): LayerMetadata | undefined;

/**
 * Validate if a string is a valid layer ID.
 * @param id - Layer identifier to validate
 * @returns true if valid layer ID, false otherwise
 */
export function isValidLayer(id: string): boolean;

/**
 * Get all valid layer IDs in canonical form.
 * @returns Array of layer IDs ordered by layer number
 */
export function getAllLayerIds(): string[];

/**
 * Get valid node types for a specific layer.
 * @param layerId - Canonical layer ID
 * @returns Array of spec_node_id values (e.g., ["motivation.goal", "motivation.requirement"])
 */
export function getNodeTypesForLayer(layerId: string): string[];

/**
 * Layer hierarchy ordered by layer number (1-12).
 * Used for reference direction validation (higher → lower only).
 */
export const LAYER_HIERARCHY: number[];
```

**Documentation Requirements:**

- **Usage Examples:**
  - Validating user input for layer selection
  - Generating error messages with valid layer lists
  - Navigating layer hierarchy for cross-layer reference validation
  - Discovering valid node types for a layer during element creation

- **Example Code:**

```typescript
import {
  getLayerById,
  getAllLayerIds,
  isValidLayer,
  getNodeTypesForLayer,
} from "../generated/layer-registry.js";

// Example 1: Validate user input
function validateLayerInput(userInput: string): void {
  if (!isValidLayer(userInput)) {
    const validLayers = getAllLayerIds().join(", ");
    throw new Error(`Invalid layer "${userInput}". Valid layers: ${validLayers}`);
  }
}

// Example 2: Get layer metadata
const dataStoreLayer = getLayerById("data-store");
console.log(`Layer ${dataStoreLayer.number}: ${dataStoreLayer.name}`);
console.log(
  `Standard: ${dataStoreLayer.inspiredBy?.standard} ${dataStoreLayer.inspiredBy?.version}`
);

// Example 3: Discover valid node types
const nodeTypes = getNodeTypesForLayer("motivation");
console.log(`Valid node types for motivation layer: ${nodeTypes.join(", ")}`);
// Output: motivation.goal, motivation.requirement, motivation.stakeholder, ...
```

#### 1.2.3 Build-Time Generation Notes

**Documentation Requirements:**

- **Generation Source:** `spec/layers/*.layer.json` files
- **Generation Trigger:**
  - `npm run build` in CLI directory
  - `scripts/sync-spec-schemas.sh` execution
  - Pre-commit hook (if schema changes detected)
- **Generated File Location:** `cli/src/generated/layer-registry.ts`
- **Version Control:** Generated files are in `.gitignore`, regenerated per build
- **Why Generated:**
  - Zero runtime overhead for metadata access
  - Type safety for layer references
  - Compile-time validation of layer references in CLI code

**Maintenance Notes:**

- Adding a new layer requires only spec changes, no CLI code changes
- Layer metadata changes propagate automatically on next build
- Breaking changes to layer structure require CLI rebuild and testing

---

### 1.3 NodeTypeIndex API Reference

**File:** `cli/src/generated/node-types.ts` (auto-generated)
**Purpose:** Type-safe registry of all 354 node types with metadata extraction from node schemas

#### 1.3.1 Type Definitions

```typescript
/**
 * Union type of all 12 layer identifiers.
 * Generated from spec/layers/*.layer.json
 */
export type LayerId =
  | "motivation"
  | "business"
  | "security"
  | "application"
  | "technology"
  | "api"
  | "data-model"
  | "data-store"
  | "ux"
  | "navigation"
  | "apm"
  | "testing";

/**
 * Union type of all unique node type identifiers.
 * Generated from spec/schemas/nodes/**\/*.node.schema.json
 */
export type NodeType = "goal" | "requirement" | "stakeholder" | "service" | "endpoint" | "entity";
// ... all 354 unique type identifiers

/**
 * Union type of all 354 valid spec_node_id values.
 * Format: "{layer}.{type}"
 */
export type SpecNodeId =
  | "motivation.goal"
  | "motivation.requirement"
  | "business.service"
  | "api.endpoint"
  | "data-model.entity";
// ... all 354 combinations

/**
 * Metadata for a specific node type extracted from its JSON schema.
 */
interface NodeTypeInfo {
  /** Full spec node identifier (e.g., "motivation.goal") */
  specNodeId: SpecNodeId;

  /** Layer this node type belongs to */
  layer: LayerId;

  /** Node type identifier (e.g., "goal", "endpoint") */
  type: NodeType;

  /** Required attribute keys from schema (from attributes.required array) */
  requiredAttributes: string[];

  /** Optional attribute keys from schema (attributes.properties minus required) */
  optionalAttributes: string[];

  /** Schema description (if present) */
  description?: string;
}
```

**Documentation Requirements:**

- **Union Type Benefits:**
  - Compile-time validation of spec_node_id references
  - IDE autocomplete for valid node types
  - Type safety prevents invalid combinations (e.g., "motivation.endpoint")

- **NodeTypeInfo Usage:**
  - Discovering required attributes for element creation forms
  - Validating element types during CLI command parsing
  - Building dynamic UI based on schema-defined attributes

#### 1.3.2 Public API Methods

```typescript
/**
 * Complete node type registry indexed by spec_node_id.
 * Key: spec_node_id (e.g., "motivation.goal")
 * Value: NodeTypeInfo
 */
export const NODE_TYPES: Map<SpecNodeId, NodeTypeInfo>;

/**
 * Retrieve node type metadata by spec_node_id.
 * @param specNodeId - Full spec node identifier (e.g., "motivation.goal")
 * @returns NodeTypeInfo or undefined if not found
 */
export function getNodeType(specNodeId: SpecNodeId): NodeTypeInfo | undefined;

/**
 * Get all node types for a specific layer.
 * @param layer - Layer identifier
 * @returns Array of NodeTypeInfo for the layer, ordered alphabetically by type
 */
export function getNodeTypesForLayer(layer: LayerId): NodeTypeInfo[];

/**
 * Validate if a string is a valid spec_node_id.
 * @param specNodeId - Spec node ID to validate
 * @returns true if valid spec_node_id, false otherwise
 */
export function isValidNodeType(specNodeId: string): boolean;

/**
 * Extract layer from spec_node_id.
 * @param specNodeId - Full spec node identifier
 * @returns Layer ID or undefined if invalid format
 */
export function getLayerFromSpecNodeId(specNodeId: string): LayerId | undefined;

/**
 * Extract type from spec_node_id.
 * @param specNodeId - Full spec node identifier
 * @returns Node type or undefined if invalid format
 */
export function getTypeFromSpecNodeId(specNodeId: string): NodeType | undefined;
```

**Documentation Requirements:**

- **Usage Examples:**

```typescript
import {
  getNodeType,
  getNodeTypesForLayer,
  isValidNodeType,
  SpecNodeId,
} from "../generated/node-types.js";

// Example 1: Type-safe element creation
function createElement(
  specNodeId: SpecNodeId,
  name: string,
  attributes: Record<string, unknown>
): void {
  const nodeType = getNodeType(specNodeId);

  // Validate required attributes
  for (const required of nodeType.requiredAttributes) {
    if (!(required in attributes)) {
      throw new Error(`Missing required attribute: ${required}`);
    }
  }

  // Create element...
}

// Example 2: Build dynamic form
function buildElementForm(specNodeId: SpecNodeId): FormConfig {
  const nodeType = getNodeType(specNodeId);

  return {
    title: `Create ${nodeType.type}`,
    fields: [
      ...nodeType.requiredAttributes.map((attr) => ({ name: attr, required: true })),
      ...nodeType.optionalAttributes.map((attr) => ({ name: attr, required: false })),
    ],
  };
}

// Example 3: Validate user input
function validateElementType(layer: string, type: string): void {
  const specNodeId = `${layer}.${type}`;

  if (!isValidNodeType(specNodeId)) {
    const validTypes = getNodeTypesForLayer(layer as LayerId)
      .map((info) => info.type)
      .join(", ");
    throw new Error(`Invalid type "${type}" for layer "${layer}". Valid types: ${validTypes}`);
  }
}
```

#### 1.3.3 Schema Metadata Extraction

**Documentation Requirements:**

- **Extraction Logic:**
  - Reads all files matching `spec/schemas/nodes/**/*.node.schema.json`
  - Extracts `spec_node_id` from schema `const` constraint
  - Parses `attributes.required` array for required attributes
  - Derives optional attributes from `attributes.properties` minus required
  - Extracts `description` from schema root (if present)

- **Schema Requirements:**
  - Node schemas must extend `spec-node.schema.json` via `allOf`
  - Must define `spec_node_id`, `layer_id`, `type` as `const` constraints
  - Must include `attributes` object with `required` and `properties`

- **Error Handling:**
  - Generation fails if schema is malformed
  - Generation fails if required constraints are missing
  - Clear error messages indicate which schema failed and why

---

### 1.4 RelationshipIndex API Reference

**File:** `cli/src/generated/relationship-index.ts` (auto-generated)
**Purpose:** Registry of all 252 valid relationship types for relationship validation

#### 1.4.1 Core Interfaces

```typescript
/**
 * Metadata for a valid relationship type.
 * Generated from spec/schemas/relationships/**\/*.relationship.schema.json
 */
interface RelationshipSpec {
  /** Unique relationship identifier (e.g., "motivation.supports.motivation") */
  id: string;

  /** Valid source spec_node_id (e.g., "motivation.goal") */
  sourceSpecNodeId: SpecNodeId;

  /** Valid destination spec_node_id (e.g., "motivation.requirement") */
  destinationSpecNodeId: SpecNodeId;

  /** Semantic predicate (e.g., "supports", "realizes", "triggers") */
  predicate: string;

  /** Cardinality constraint */
  cardinality: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";

  /** Relationship strength/importance */
  strength: "critical" | "high" | "medium" | "low";

  /** Whether this relationship is mandatory for source element */
  required: boolean;

  /** Relationship description from schema */
  description?: string;
}
```

**Documentation Requirements:**

- **Field Descriptions:**
  - `id`: Unique identifier (format: `{source_layer}.{predicate}.{dest_layer}`)
  - `sourceSpecNodeId`: Spec node type that can be the source
  - `destinationSpecNodeId`: Spec node type that can be the destination
  - `predicate`: Semantic relationship type from predicate catalog
  - `cardinality`: Multiplicity constraint (affects validation logic)
  - `strength`: Relationship importance (informational, not enforced)
  - `required`: Whether source element must have this relationship

- **Cardinality Semantics:**
  - `one-to-one`: Source can have exactly one relationship of this type
  - `one-to-many`: Source can have multiple, destination can have one
  - `many-to-one`: Source can have one, destination can have multiple
  - `many-to-many`: Both source and destination can have multiple

#### 1.4.2 Public API Methods

```typescript
/**
 * Relationships indexed by source spec_node_id for fast lookup.
 * Key: source spec_node_id (e.g., "motivation.goal")
 * Value: Array of RelationshipSpec where source matches
 */
export const RELATIONSHIPS_BY_SOURCE: Map<SpecNodeId, RelationshipSpec[]>;

/**
 * Relationships indexed by predicate for predicate-based queries.
 * Key: predicate (e.g., "supports", "realizes")
 * Value: Array of RelationshipSpec with this predicate
 */
export const RELATIONSHIPS_BY_PREDICATE: Map<string, RelationshipSpec[]>;

/**
 * Relationships indexed by destination spec_node_id for reverse lookup.
 * Key: destination spec_node_id
 * Value: Array of RelationshipSpec where destination matches
 */
export const RELATIONSHIPS_BY_DESTINATION: Map<SpecNodeId, RelationshipSpec[]>;

/**
 * Get valid relationships for a source element type.
 * @param sourceType - Source spec_node_id
 * @param predicate - Optional predicate filter
 * @returns Array of RelationshipSpec
 */
export function getValidRelationships(
  sourceType: SpecNodeId,
  predicate?: string
): RelationshipSpec[];

/**
 * Validate if a relationship combination is valid.
 * @param source - Source spec_node_id
 * @param predicate - Relationship predicate
 * @param destination - Destination spec_node_id
 * @returns true if valid combination, false otherwise
 */
export function isValidRelationship(
  source: SpecNodeId,
  predicate: string,
  destination: SpecNodeId
): boolean;

/**
 * Get valid predicates for a source element type.
 * @param sourceType - Source spec_node_id
 * @returns Array of valid predicate strings
 */
export function getValidPredicates(sourceType: SpecNodeId): string[];

/**
 * Get valid destination types for source + predicate.
 * @param sourceType - Source spec_node_id
 * @param predicate - Relationship predicate
 * @returns Array of valid destination spec_node_ids
 */
export function getValidDestinations(sourceType: SpecNodeId, predicate: string): SpecNodeId[];
```

**Documentation Requirements:**

- **Usage Examples:**

```typescript
import {
  getValidRelationships,
  isValidRelationship,
  getValidPredicates,
  getValidDestinations,
} from "../generated/relationship-index.js";

// Example 1: Validate relationship before creation
function createRelationship(
  sourceId: string,
  sourceType: SpecNodeId,
  predicate: string,
  destId: string,
  destType: SpecNodeId
): void {
  if (!isValidRelationship(sourceType, predicate, destType)) {
    throw new Error(`Invalid relationship: ${sourceType} --[${predicate}]--> ${destType}`);
  }
  // Create relationship...
}

// Example 2: Suggest valid predicates
function suggestPredicates(sourceType: SpecNodeId): string[] {
  const predicates = getValidPredicates(sourceType);
  console.log(`Valid predicates for ${sourceType}: ${predicates.join(", ")}`);
  return predicates;
}

// Example 3: Filter destination types
function getDestinationOptions(sourceType: SpecNodeId, predicate: string): SpecNodeId[] {
  const destinations = getValidDestinations(sourceType, predicate);
  console.log(
    `Valid destinations for ${sourceType} --[${predicate}]--> : ${destinations.join(", ")}`
  );
  return destinations;
}

// Example 4: Check cardinality constraints
function validateCardinality(
  sourceType: SpecNodeId,
  predicate: string,
  existingRelationships: Relationship[]
): void {
  const relationships = getValidRelationships(sourceType, predicate);
  const spec = relationships[0]; // Assuming single match

  if (spec.cardinality === "one-to-one" || spec.cardinality === "many-to-one") {
    const existing = existingRelationships.filter((r) => r.predicate === predicate);
    if (existing.length > 0) {
      throw new Error(
        `Cardinality violation: ${sourceType} can have only one "${predicate}" relationship`
      );
    }
  }
}
```

#### 1.4.3 Schema Metadata Extraction

**Documentation Requirements:**

- **Extraction Logic:**
  - Reads all files matching `spec/schemas/relationships/**/*.relationship.schema.json`
  - Extracts `source_spec_node_id` and `destination_spec_node_id` from schema constraints
  - Extracts `predicate` from schema `const` or `enum` constraint
  - Parses `cardinality`, `strength`, `required` from schema properties
  - Builds three index maps for fast lookup

- **Schema Requirements:**
  - Relationship schemas must extend `spec-node-relationship.schema.json`
  - Must define `source_spec_node_id`, `destination_spec_node_id`, `predicate` constraints
  - Must include `cardinality`, `strength`, `required` fields

---

### 1.5 SchemaValidator API (Modified)

**File:** `cli/src/validators/schema-validator.ts`
**Purpose:** Validate model elements and relationships against spec schemas

#### 1.5.1 Core Validation Methods

```typescript
class SchemaValidator {
  /**
   * Validate a single element against its spec node schema.
   * @param element - Element to validate
   * @param layer - Layer containing the element
   * @returns ValidationResult with errors if validation fails
   */
  async validateElement(element: Element, layer: Layer): Promise<ValidationResult>;

  /**
   * Validate a layer against its spec node schemas.
   * Validates each element in the layer.
   * @param layer - Layer to validate
   * @returns ValidationResult with all errors
   */
  async validateLayer(layer: Layer): Promise<ValidationResult>;

  /**
   * Validate all layers in the model.
   * @param model - Complete model
   * @returns ValidationResult with all errors
   */
  async validateModel(model: Model): Promise<ValidationResult>;
}
```

**Documentation Requirements:**

- **Validation Pipeline:**
  1. Transform CLI Element to spec-node format
  2. Validate against base `spec-node.schema.json`
  3. Validate against type-specific schema (e.g., `motivation.goal.node.schema.json`)
  4. Return aggregated validation errors

- **Error Reporting:**
  - Errors include JSON path to failed constraint
  - Errors reference specific schema requirement
  - Errors indicate keyword that failed (required, type, enum, etc.)
  - Clear error messages for common validation failures

- **Usage Examples:**

```typescript
import { SchemaValidator } from "../validators/schema-validator.js";
import { Model } from "../core/model.js";

async function validateModelElements(model: Model): Promise<void> {
  const validator = new SchemaValidator();
  const result = await validator.validateModel(model);

  if (!result.valid) {
    console.error(`Validation failed with ${result.errors.length} errors:`);
    for (const error of result.errors) {
      console.error(`  - ${error.path}: ${error.message}`);
    }
    throw new Error("Model validation failed");
  }

  console.log("✓ Model validation passed");
}
```

---

### 1.6 RelationshipValidator API (New)

**File:** `cli/src/validators/relationship-validator.ts` (new)
**Purpose:** Validate model relationships against relationship schemas

#### 1.6.1 Core Validation Methods

```typescript
class RelationshipValidator {
  /**
   * Validate a single relationship.
   * @param relationship - Relationship to validate
   * @param model - Model for looking up source/destination elements
   * @returns ValidationResult
   */
  async validateRelationship(relationship: Relationship, model: Model): Promise<ValidationResult>;

  /**
   * Validate all relationships in the model.
   * @param model - Complete model
   * @returns ValidationResult with all errors
   */
  async validateAllRelationships(model: Model): Promise<ValidationResult>;

  /**
   * Check cardinality constraints for a relationship.
   * @param sourceId - Source element ID
   * @param predicate - Relationship predicate
   * @param relationships - All existing relationships
   * @returns ValidationResult
   */
  validateCardinality(
    sourceId: string,
    predicate: string,
    relationships: Relationship[]
  ): ValidationResult;
}
```

**Documentation Requirements:**

- **Validation Logic:**
  - Verify source element exists and get its spec_node_id
  - Verify destination element exists and get its spec_node_id
  - Validate relationship combination via RelationshipIndex
  - Check cardinality constraints against existing relationships
  - Validate relationship attributes (if schema defines them)

- **Error Types:**
  - Invalid source/destination element IDs (element not found)
  - Invalid relationship combination (not in relationship schemas)
  - Cardinality violation (too many relationships of this type)
  - Invalid predicate for source type
  - Invalid destination type for source + predicate

- **Usage Examples:**

```typescript
import { RelationshipValidator } from "../validators/relationship-validator.js";
import { Model } from "../core/model.js";

async function validateRelationships(model: Model): Promise<void> {
  const validator = new RelationshipValidator();
  const result = await validator.validateAllRelationships(model);

  if (!result.valid) {
    console.error(`Relationship validation failed:`);
    for (const error of result.errors) {
      console.error(`  - ${error.message}`);
    }
    throw new Error("Relationship validation failed");
  }

  console.log("✓ Relationship validation passed");
}
```

---

## 2. User Documentation

### 2.1 Overview

User documentation guides CLI operators through new commands, workflows, and validation features introduced by the schema-driven architecture. Target audience: architects, developers, and technical leads using the CLI to manage models.

### 2.2 New Command Reference

#### 2.2.1 `dr schema` Command

**Purpose:** Introspect layer and node type metadata derived from schemas

**Subcommands:**

```bash
# List all layers with node type counts
dr schema layers

# List valid node types for a layer
dr schema types <layer>

# Show node schema details
dr schema node <spec_node_id>

# Show valid relationships for a node type
dr schema relationship <source_type> [predicate]
```

**Documentation Requirements:**

- **Command Descriptions:**
  - `dr schema layers`: Display all 12 layers with metadata (number, name, standard, node type count)
  - `dr schema types <layer>`: List all valid node types for a layer with descriptions
  - `dr schema node <spec_node_id>`: Show detailed schema information for a node type (required attributes, optional attributes, description)
  - `dr schema relationship <source_type> [predicate]`: Show valid relationships for a source type, optionally filtered by predicate

- **Example Usage:**

```bash
# Example 1: Discover layers
$ dr schema layers
Layer 01 (motivation)    - Motivation Layer             [ArchiMate 3.2]  (5 types)
Layer 02 (business)      - Business Layer               [ArchiMate 3.2]  (12 types)
Layer 06 (api)           - API Layer                    [OpenAPI 3.0]    (8 types)
Layer 07 (data-model)    - Data Model Layer             [JSON Schema]    (6 types)
...

# Example 2: Discover node types for a layer
$ dr schema types motivation
Valid node types for layer "motivation":
  - goal              : A high-level statement of intent
  - requirement       : A statement of need
  - stakeholder       : An individual or organization with an interest
  - constraint        : A limitation on the architecture
  - principle         : A normative property of the architecture

# Example 3: Show node schema details
$ dr schema node motivation.goal
Node Type: motivation.goal
Layer: motivation (01)
Description: A high-level statement of intent

Required Attributes:
  - name                : string
  - description         : string

Optional Attributes:
  - priority            : "critical" | "high" | "medium" | "low"
  - measurable_outcomes : string[]
  - target_date         : string (ISO 8601 date)

# Example 4: Show valid relationships
$ dr schema relationship motivation.goal
Valid relationships for "motivation.goal":

As Source:
  - supports          → motivation.goal, motivation.requirement
  - realizes          → business.service
  - constrainedBy     → motivation.constraint

As Destination:
  - supports          ← motivation.goal, motivation.stakeholder
  - realizes          ← business.service, application.component

# Example 5: Filter by predicate
$ dr schema relationship motivation.goal supports
Relationship: motivation.goal --[supports]--> motivation.goal
Cardinality: many-to-many
Strength: high
Description: A goal supports another goal by contributing to its achievement
```

**Error Handling:**

- Invalid layer name: Display valid layers with `dr schema layers`
- Invalid spec_node_id: Display valid types with `dr schema types <layer>`
- Invalid predicate: Display valid predicates for source type

#### 2.2.2 `dr conformance` Command (Enhanced)

**Purpose:** Validate model against layer specifications (now schema-driven)

**Usage:**

```bash
# Validate all layers
dr conformance

# Validate specific layers
dr conformance --layers motivation,business,api

# Verbose output with details
dr conformance --verbose

# JSON output for automation
dr conformance --format json
```

**Documentation Requirements:**

- **What Changed:**
  - Now validates every element against its spec node schema (previously partial validation)
  - Validates every relationship against relationship schemas (new)
  - Reports schema-specific validation errors with JSON paths
  - No longer relies on hardcoded type expectations

- **Output Format:**

```bash
$ dr conformance
Validating model conformance...

✓ Layer 01 (motivation):      5 elements validated
✓ Layer 02 (business):         12 elements validated
✗ Layer 06 (api):              3 elements validated, 2 errors

Errors:
  api.endpoint.create-user:
    - Missing required attribute "method" (path: /attributes/method)
    - Invalid value for "path": must start with "/" (path: /attributes/path)

✓ Relationship validation:    25 relationships validated

Summary:
  Total Elements:     20
  Valid Elements:     18
  Failed Elements:    2
  Total Relationships: 25
  Valid Relationships: 25
  Failed Relationships: 0
```

**Common Validation Errors:**

- **Missing required attributes**: Element is missing a field required by its schema
- **Invalid attribute type**: Attribute value doesn't match schema type constraint
- **Invalid enum value**: Attribute value not in schema-defined enum
- **Invalid relationship**: Source/destination combination not defined in schemas
- **Cardinality violation**: Too many relationships of a type with one-to-one constraint

---

### 2.3 Updated Workflow Guides

#### 2.3.1 Creating Elements with Schema Validation

**Documentation Requirements:**

- **Updated Workflow:**
  1. Discover valid node types for layer: `dr schema types <layer>`
  2. View required attributes for type: `dr schema node <spec_node_id>`
  3. Create element with required attributes: `dr add <layer> <type> <name> --properties '{...}'`
  4. Validate element: `dr conformance --layers <layer>`

- **Example:**

```bash
# Step 1: Discover valid types for API layer
$ dr schema types api
Valid node types for layer "api":
  - endpoint          : REST API endpoint
  - parameter         : API parameter
  - response          : API response
  ...

# Step 2: View required attributes for endpoint
$ dr schema node api.endpoint
Node Type: api.endpoint
Required Attributes:
  - method            : "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  - path              : string (must start with "/")

Optional Attributes:
  - description       : string
  - parameters        : string[]
  - responses         : object

# Step 3: Create element with required attributes
$ dr add api endpoint create-user \
  --name "Create User" \
  --properties '{"method":"POST","path":"/api/users","description":"Creates a new user"}'

✓ Created element: api.endpoint.create-user

# Step 4: Validate
$ dr conformance --layers api
✓ Layer 06 (api): 1 element validated
```

#### 2.3.2 Creating Relationships with Validation

**Documentation Requirements:**

- **Updated Workflow:**
  1. Identify source and destination elements
  2. Discover valid predicates: `dr schema relationship <source_type>`
  3. Create relationship: `dr relationship add <source> <destination> --predicate <predicate>`
  4. Validate: `dr conformance`

- **Example:**

```bash
# Step 1: Source = motivation.goal.customer-satisfaction
# Step 2: Destination = business.service.customer-support

# Step 3: Discover valid predicates
$ dr schema relationship motivation.goal
Valid relationships for "motivation.goal":
  - supports          → motivation.goal, motivation.requirement
  - realizes          → business.service
  ...

# Step 4: Create relationship
$ dr relationship add \
  motivation.goal.customer-satisfaction \
  business.service.customer-support \
  --predicate realizes

✓ Created relationship: motivation.goal.customer-satisfaction --[realizes]--> business.service.customer-support

# Step 5: Validate
$ dr conformance
✓ Relationship validation: 1 relationship validated
```

**Error Scenarios:**

```bash
# Invalid predicate for source type
$ dr relationship add \
  motivation.goal.customer-satisfaction \
  business.service.customer-support \
  --predicate triggers

✗ Error: Invalid relationship: motivation.goal does not support predicate "triggers"
  Valid predicates: supports, realizes

# Invalid destination type for source + predicate
$ dr relationship add \
  motivation.goal.customer-satisfaction \
  api.endpoint.create-user \
  --predicate realizes

✗ Error: Invalid destination type for motivation.goal --[realizes]-->
  Valid destinations: business.service, application.component
```

---

### 2.4 Migration Guide

**Documentation Requirements:**

- **Title:** "Migrating to Schema-Driven CLI"
- **Target Audience:** Users with existing models created before refactoring

**Content:**

1. **What Changed:**
   - CLI now validates every element against spec node schemas
   - Hardcoded layer definitions replaced with schema-derived metadata
   - New validation errors may appear for previously "valid" elements
   - New relationship validation enforces schema-defined constraints

2. **Pre-Migration Steps:**
   - Backup your model: `cp -r documentation-robotics documentation-robotics.backup`
   - Run current validation: `dr validate` (capture baseline errors)
   - Note any existing validation warnings

3. **Migration Process:**
   - Update CLI to latest version: `npm install -g @documentation-robotics/cli@latest`
   - Run schema-driven validation: `dr conformance`
   - Review new validation errors (if any)
   - Fix elements that fail schema validation
   - Re-run validation until all errors resolved

4. **Common Migration Issues:**
   - **Missing required attributes:** Add missing fields to element properties
   - **Invalid attribute types:** Convert attribute values to schema-defined types
   - **Invalid relationships:** Remove or update relationships that don't match schemas
   - **Legacy element formats:** Use `dr migrate elements` to convert to spec-aligned format

5. **Migration Command:**

```bash
# Dry-run to preview changes
dr migrate elements --dry-run

# Execute migration with backup
dr migrate elements

# Validate after migration
dr conformance
```

---

## 3. Developer Documentation

### 3.1 Overview

Developer documentation guides contributors to the CLI project through new architecture patterns, build processes, and schema-driven development workflows.

### 3.2 Schema-Driven Development Guide

**Documentation Requirements:**

#### 3.2.1 Core Principles

- **Schema as Source of Truth:** All type definitions, validation rules, and metadata derive from JSON schemas in `spec/schemas/`
- **Build-Time Code Generation:** Schemas are processed at build time to generate TypeScript types and validators
- **Zero Runtime Overhead:** Generated code eliminates runtime schema loading and parsing
- **Type Safety:** Generated TypeScript types provide compile-time validation of layer/type references

#### 3.2.2 Development Workflow

**Adding a New Node Type:**

1. **Create Schema:**
   - Add schema file: `spec/schemas/nodes/{layer}/{type}.node.schema.json`
   - Extend base schema: `spec/schemas/base/spec-node.schema.json`
   - Define required/optional attributes
   - Example:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://documentation-robotics.org/schemas/nodes/motivation/goal.node.schema.json",
  "title": "Goal Node",
  "description": "A high-level statement of intent",
  "allOf": [
    { "$ref": "../../base/spec-node.schema.json" },
    {
      "type": "object",
      "properties": {
        "spec_node_id": { "const": "motivation.goal" },
        "layer_id": { "const": "motivation" },
        "type": { "const": "goal" },
        "attributes": {
          "type": "object",
          "properties": {
            "priority": {
              "type": "string",
              "enum": ["critical", "high", "medium", "low"]
            },
            "measurable_outcomes": {
              "type": "array",
              "items": { "type": "string" }
            }
          },
          "required": ["name", "description"]
        }
      }
    }
  ]
}
```

2. **Update Layer Instance:**
   - Add type to `spec/layers/{NN}-{layer}.layer.json`
   - Add to `node_types` array

3. **Rebuild CLI:**
   - Run: `cd cli && npm run build`
   - Generated files updated:
     - `cli/src/generated/node-types.ts` (adds new SpecNodeId)
     - `cli/src/generated/layer-registry.ts` (updates nodeTypes array)

4. **Verify:**
   - Type is available in `dr add` command
   - Type appears in `dr schema types <layer>`
   - Validation works: `dr conformance`

**Adding a New Relationship Type:**

1. **Create Schema:**
   - Add schema file: `spec/schemas/relationships/{layer}/{source}-{predicate}-{dest}.relationship.schema.json`
   - Extend base: `spec/schemas/base/spec-node-relationship.schema.json`
   - Define source, destination, predicate, cardinality
   - Example:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://documentation-robotics.org/schemas/relationships/motivation/goal-supports-goal.relationship.schema.json",
  "title": "Goal Supports Goal",
  "description": "A goal supports another goal by contributing to its achievement",
  "allOf": [
    { "$ref": "../../base/spec-node-relationship.schema.json" },
    {
      "type": "object",
      "properties": {
        "source_spec_node_id": { "const": "motivation.goal" },
        "destination_spec_node_id": { "const": "motivation.goal" },
        "predicate": { "const": "supports" },
        "cardinality": { "const": "many-to-many" },
        "strength": { "const": "high" },
        "required": { "const": false }
      }
    }
  ]
}
```

2. **Rebuild CLI:**
   - Run: `cd cli && npm run build`
   - Generated file updated: `cli/src/generated/relationship-index.ts`

3. **Verify:**
   - Relationship appears in `dr schema relationship <source_type>`
   - Relationship validates correctly: `dr conformance`

---

### 3.3 Build System Documentation

**Documentation Requirements:**

#### 3.3.1 Build Process Overview

```
npm run build
    │
    ├─► sync-spec-schemas.sh         # Copy schemas from spec/ to cli/src/schemas/bundled/
    │       ├─► spec/schemas/base/              → cli/src/schemas/bundled/base/
    │       ├─► spec/schemas/nodes/             → cli/src/schemas/bundled/nodes/
    │       ├─► spec/schemas/relationships/     → cli/src/schemas/bundled/relationships/
    │       └─► spec/layers/                    → cli/src/schemas/bundled/layers/
    │
    ├─► generate-registry.ts         # Generate TypeScript registries
    │       ├─► Read spec/layers/*.layer.json
    │       ├─► Read spec/schemas/nodes/**/*.node.schema.json
    │       ├─► Read spec/schemas/relationships/**/*.relationship.schema.json
    │       ├─► Generate cli/src/generated/layer-registry.ts
    │       ├─► Generate cli/src/generated/node-types.ts
    │       └─► Generate cli/src/generated/relationship-index.ts
    │
    └─► tsc                          # TypeScript compilation
            └─► Compile TypeScript including generated files
```

#### 3.3.2 Generated Files

**Documentation Requirements:**

- **Location:** `cli/src/generated/`
- **Version Control:** All files in `.gitignore` (regenerated per build)
- **Contents:**
  - `layer-registry.ts`: Layer metadata and API
  - `node-types.ts`: Node type registry and TypeScript union types
  - `relationship-index.ts`: Relationship registry with indexed lookups

**Maintenance:**

- Generated files are deterministic (same input → same output)
- No manual edits (will be overwritten on next build)
- Schema changes automatically propagate to generated code

#### 3.3.3 Generator Script Documentation

**File:** `cli/scripts/generate-registry.ts`

**Documentation Requirements:**

- **Purpose:** Extract metadata from JSON schemas and generate TypeScript code
- **Inputs:**
  - `spec/layers/*.layer.json` (12 files)
  - `spec/schemas/nodes/**/*.node.schema.json` (354 files)
  - `spec/schemas/relationships/**/*.relationship.schema.json` (252 files)
- **Outputs:**
  - `cli/src/generated/layer-registry.ts`
  - `cli/src/generated/node-types.ts`
  - `cli/src/generated/relationship-index.ts`
- **Error Handling:**
  - Invalid JSON: Reports file path and JSON parse error
  - Missing required fields: Reports file path and missing field
  - Schema validation errors: Reports which schema failed and why
  - Build fails if any schema is invalid (prevents broken builds)

**Usage:**

```bash
# Run generator directly
bun run cli/scripts/generate-registry.ts

# Generator runs automatically during build
cd cli && npm run build
```

---

### 3.4 Testing Guide

**Documentation Requirements:**

#### 3.4.1 Testing Schema-Driven Components

**Generated Code Testing:**

- **Unit Tests:** Test generated registries with known schemas
  - Verify `getLayerById()` returns correct metadata
  - Verify `isValidNodeType()` validates correctly
  - Verify relationship lookups return expected results

- **Integration Tests:** Test code generation pipeline
  - Create test schemas in temp directory
  - Run generator
  - Verify generated code compiles
  - Verify generated code contains expected types

**Example Test:**

```typescript
// cli/tests/unit/generated/layer-registry.test.ts
import { describe, it, expect } from "bun:test";
import {
  getLayerById,
  getAllLayerIds,
  isValidLayer,
} from "../../../src/generated/layer-registry.js";

describe("LayerRegistry", () => {
  it("should return all layer IDs", () => {
    const layers = getAllLayerIds();
    expect(layers).toHaveLength(12);
    expect(layers).toContain("motivation");
    expect(layers).toContain("data-store");
  });

  it("should get layer by ID", () => {
    const layer = getLayerById("motivation");
    expect(layer).toBeDefined();
    expect(layer.number).toBe(1);
    expect(layer.name).toBe("Motivation Layer");
  });

  it("should validate layer IDs", () => {
    expect(isValidLayer("motivation")).toBe(true);
    expect(isValidLayer("invalid")).toBe(false);
  });
});
```

#### 3.4.2 Validation Testing

**Schema Validation Tests:**

- **Valid Elements:** Test that valid elements pass validation
- **Invalid Elements:** Test that invalid elements fail with expected errors
- **Missing Required Attributes:** Verify error messages include JSON path
- **Invalid Types:** Verify type mismatch errors
- **Enum Violations:** Verify enum constraint errors

**Relationship Validation Tests:**

- **Valid Relationships:** Test that valid relationships pass
- **Invalid Combinations:** Test that invalid source/destination/predicate combinations fail
- **Cardinality Violations:** Test that cardinality constraints are enforced
- **Missing Elements:** Test that relationships to non-existent elements fail

---

### 3.5 Contributing to Schema-Driven CLI

**Documentation Requirements:**

#### 3.5.1 Pull Request Checklist

When adding or modifying schemas:

- [ ] Schema follows JSON Schema Draft 7 syntax
- [ ] Schema extends appropriate base schema (`spec-node.schema.json` or `spec-node-relationship.schema.json`)
- [ ] Required constraints are defined (`spec_node_id`, `layer_id`, `type`)
- [ ] Schema includes description and title
- [ ] Schema is added to correct directory (`spec/schemas/nodes/{layer}/` or `spec/schemas/relationships/{layer}/`)
- [ ] Layer instance updated (if adding new node type)
- [ ] CLI builds successfully: `cd cli && npm run build`
- [ ] Generated code compiles without errors
- [ ] Tests added for new functionality
- [ ] Documentation updated (API docs, user guides)

#### 3.5.2 Common Pitfalls

- **Forgetting to rebuild:** Schema changes require `npm run build` to regenerate code
- **Incorrect schema extension:** Must use `allOf` to extend base schemas
- **Missing const constraints:** `spec_node_id`, `layer_id`, `type` must be `const`, not `enum`
- **Circular dependencies:** Avoid referencing schemas that create circular dependencies
- **Version control:** Don't commit generated files (they're in `.gitignore`)

---

## 4. System Documentation

### 4.1 Overview

System documentation describes the architecture, design decisions, and implementation patterns for the schema-driven CLI refactoring.

### 4.2 Architecture Documentation

**Documentation Requirements:**

#### 4.2.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BUILD TIME                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  spec/schemas/           sync-spec-schemas.sh                       │
│  ├── base/           ────────────────────►  cli/src/schemas/       │
│  ├── nodes/                                  bundled/               │
│  └── relationships/                                                 │
│                                                                     │
│  spec/layers/                                                       │
│  └── *.layer.json                                                   │
│                      │                                              │
│                      │                                              │
│                      ▼                                              │
│              generate-registry.ts                                   │
│                      │                                              │
│                      ▼                                              │
│         cli/src/generated/                                          │
│         ├── layer-registry.ts      (Layer metadata + API)           │
│         ├── node-types.ts          (354 spec_node_id types)         │
│         └── relationship-index.ts  (252 relationship specs)         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         RUNTIME                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│     Commands                 Core                  Validators       │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐      │
│  │ add          │      │LayerRegistry │◄─────│SchemaValidator│      │
│  │ schema       │─────►│ (generated)  │      │              │      │
│  │ conformance  │      └──────────────┘      └──────────────┘      │
│  └──────────────┘             │                     │              │
│         │                     │                     │              │
│         │                     ▼                     ▼              │
│         │              ┌──────────────┐      ┌──────────────┐      │
│         │              │NodeTypeIndex │      │Relationship  │      │
│         └─────────────►│ (generated)  │      │Validator     │      │
│                        └──────────────┘      │ (new)        │      │
│                               │              └──────────────┘      │
│                               │                                    │
│                               ▼                                    │
│                        ┌──────────────┐                            │
│                        │RelationIndex │                            │
│                        │ (generated)  │                            │
│                        └──────────────┘                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Description:**

The schema-driven architecture operates in two phases:

1. **Build Time:** Schemas are synchronized and processed to generate TypeScript registries
2. **Runtime:** Commands use generated registries for validation and type-safe operations

#### 4.2.2 Component Responsibilities

**LayerRegistry (Generated):**

- Provides layer metadata (ID, number, name, node types)
- Validates layer IDs
- Supports layer hierarchy navigation
- Replaces hardcoded `VALID_LAYERS` arrays throughout codebase

**NodeTypeIndex (Generated):**

- Provides TypeScript union types for all 354 spec_node_ids
- Metadata for each node type (required/optional attributes)
- Type-safe element creation
- Replaces hardcoded element type expectations

**RelationshipIndex (Generated):**

- Registry of all 252 valid relationship types
- Indexed by source, predicate, destination for fast lookup
- Supports relationship validation and suggestion
- Enables cardinality constraint enforcement

**SchemaValidator (Modified):**

- Validates elements against spec node schemas
- Uses pre-compiled AJV validators for base schemas
- Lazy-loads per-type schemas for 354 node types
- Reports validation errors with JSON paths

**RelationshipValidator (New):**

- Validates relationships against relationship schemas
- Checks source/destination element existence
- Validates source/destination types match schema
- Enforces cardinality constraints

---

### 4.3 Design Decisions

**Documentation Requirements:**

#### 4.3.1 Build-Time vs Runtime Trade-offs

**Decision:** Hybrid approach (generated registries + runtime validation)

**Rationale:**

| Approach                               | Pros                                         | Cons                            | Selected |
| -------------------------------------- | -------------------------------------------- | ------------------------------- | -------- |
| **Full runtime loading**               | Simple, always fresh                         | Slow startup, disk I/O overhead | ❌       |
| **Full build-time generation**         | Zero runtime overhead                        | Large bundle size (606 schemas) | ❌       |
| **Hybrid (registries + lazy loading)** | Fast startup, type safety, manageable bundle | Moderate complexity             | ✅       |

**Implementation:**

- Generate registries at build time (layer metadata, node type index, relationship index)
- Pre-compile base schemas (`spec-node.schema.json`, `spec-node-relationship.schema.json`)
- Lazy-load per-type schemas (354 node + 252 relationship = 606 total)
- Cache compiled validators in memory (existing pattern)

#### 4.3.2 Schema Synchronization Strategy

**Decision:** Copy schemas to CLI bundle, regenerate on build

**Rationale:**

- **Alternative 1:** Reference spec schemas directly from `spec/` → Requires spec as peer dependency, breaks encapsulation
- **Alternative 2:** Publish spec as npm package → Adds version sync complexity
- **Selected:** Copy to `cli/src/schemas/bundled/` → Simple, reliable, works offline

**Implementation:**

- `scripts/sync-spec-schemas.sh` copies schemas during build
- Bundled schemas packaged with CLI distribution
- CLI version controls which spec version it uses
- Users can upgrade CLI independently of spec changes

#### 4.3.3 Element Structure Alignment

**Decision:** Evolve `Element` class to align with `spec-node.schema.json`

**Rationale:**

- **Current State:** CLI transforms `Element` to spec-node format for validation (lossy)
- **Problem:** Transformation loses data (UUID, metadata), requires conversion overhead
- **Solution:** Align `Element` structure with spec-node schema
  - Add `uuid` field (globally unique identifier)
  - Add `specNodeId` field (reference to spec node type)
  - Rename `properties` to `attributes` (match schema terminology)
  - Add `metadata` field (lifecycle tracking)
  - Preserve backward-compatible `id` field (semantic element ID)

**Migration Path:**

- Provide migration utility: `dr migrate elements`
- Detect legacy format automatically
- Generate UUIDs for elements lacking them
- Move `properties` to `attributes`
- Preserve all existing data

---

### 4.4 Data Flow Documentation

**Documentation Requirements:**

#### 4.4.1 Element Creation Flow

```
User Command: dr add motivation goal customer-satisfaction --name "..."
    │
    ├─► Parse CLI arguments
    ├─► Validate layer via LayerRegistry.isValidLayer()
    ├─► Validate type via NodeTypeIndex.isValidNodeType()
    ├─► Get required attributes via NodeTypeIndex.getNodeType()
    ├─► Validate required attributes provided
    │
    ├─► Create Element object
    ├─► Generate UUID
    ├─► Set spec_node_id (e.g., "motivation.goal")
    ├─► Set attributes from --properties
    │
    ├─► Validate Element via SchemaValidator.validateElement()
    │       ├─► Load base schema (spec-node.schema.json)
    │       ├─► Load type schema (motivation.goal.node.schema.json)
    │       └─► Validate with AJV
    │
    ├─► Add Element to Layer
    ├─► Save Model
    └─► Report success
```

#### 4.4.2 Relationship Creation Flow

```
User Command: dr relationship add source dest --predicate "supports"
    │
    ├─► Parse CLI arguments
    ├─► Lookup source element in Model
    ├─► Lookup destination element in Model
    ├─► Get source spec_node_id
    ├─► Get destination spec_node_id
    │
    ├─► Validate relationship via RelationshipValidator
    │       ├─► Check relationship exists in RelationshipIndex
    │       │       └─► isValidRelationship(source_type, predicate, dest_type)
    │       ├─► Validate cardinality constraints
    │       │       ├─► Get existing relationships for source
    │       │       ├─► Check cardinality (one-to-one, one-to-many, etc.)
    │       │       └─► Fail if constraint violated
    │       └─► Return validation result
    │
    ├─► Create Relationship object
    ├─► Add to RelationshipRegistry
    ├─► Save Model
    └─► Report success
```

#### 4.4.3 Conformance Validation Flow

```
User Command: dr conformance
    │
    ├─► Load Model
    │
    ├─► Validate Elements
    │       ├─► For each Layer:
    │       │       ├─► For each Element:
    │       │       │       ├─► Get spec_node_id
    │       │       │       ├─► Load node schema
    │       │       │       ├─► Validate with AJV
    │       │       │       └─► Collect errors
    │       │       └─► Report layer results
    │       └─► Report element validation summary
    │
    ├─► Validate Relationships
    │       ├─► For each Relationship:
    │       │       ├─► Get source/dest spec_node_ids
    │       │       ├─► Validate via RelationshipIndex
    │       │       ├─► Check cardinality
    │       │       └─► Collect errors
    │       └─► Report relationship validation summary
    │
    └─► Generate Conformance Report
            ├─► Total elements (valid/invalid)
            ├─► Total relationships (valid/invalid)
            ├─► Detailed error list with JSON paths
            └─► Exit code (0 = success, 1 = validation errors)
```

---

## 5. Operations Documentation

### 5.1 Overview

Operations documentation provides deployment, maintenance, and troubleshooting guidance for the schema-driven CLI.

### 5.2 Deployment Guide

**Documentation Requirements:**

#### 5.2.1 Installation

**For End Users:**

```bash
# Install latest stable version
npm install -g @documentation-robotics/cli

# Verify installation
dr --version
dr schema layers
```

**For Developers:**

```bash
# Clone repository
git clone https://github.com/tinkermonkey/documentation_robotics.git
cd documentation_robotics/cli

# Install dependencies
npm install

# Build (includes schema sync + code generation)
npm run build

# Run tests
npm test

# Link for local development
npm link

# Verify
dr --version
```

#### 5.2.2 Build Process

**Build Steps (Automated via `npm run build`):**

1. **Schema Synchronization:**

   ```bash
   ./scripts/sync-spec-schemas.sh
   ```

   - Copies schemas from `spec/schemas/` to `cli/src/schemas/bundled/`
   - Copies layer instances from `spec/layers/` to `cli/src/schemas/bundled/layers/`
   - Creates directories if missing
   - Reports files synchronized

2. **Code Generation:**

   ```bash
   bun run scripts/generate-registry.ts
   ```

   - Reads layer instances, node schemas, relationship schemas
   - Generates `cli/src/generated/layer-registry.ts`
   - Generates `cli/src/generated/node-types.ts`
   - Generates `cli/src/generated/relationship-index.ts`
   - Reports schemas processed

3. **TypeScript Compilation:**

   ```bash
   tsc
   ```

   - Compiles TypeScript including generated files
   - Outputs to `cli/dist/`
   - Reports compilation errors (if any)

**Build Verification:**

```bash
# Verify generated files exist
ls -l cli/src/generated/

# Verify build output exists
ls -l cli/dist/

# Run quick smoke test
node cli/dist/cli.js schema layers
```

---

### 5.3 Maintenance Procedures

**Documentation Requirements:**

#### 5.3.1 Schema Updates

**Updating Node Schemas:**

1. Edit schema file: `spec/schemas/nodes/{layer}/{type}.node.schema.json`
2. Commit schema changes to spec repository
3. Rebuild CLI:

   ```bash
   cd cli
   npm run build
   ```

4. Test validation with updated schema:

   ```bash
   dr conformance
   npm test
   ```

5. Commit updated CLI (if in same repository)

**Updating Relationship Schemas:**

1. Edit schema file: `spec/schemas/relationships/{layer}/{source}-{predicate}-{dest}.relationship.schema.json`
2. Rebuild CLI: `npm run build`
3. Test relationship validation:

   ```bash
   dr schema relationship <source_type>
   dr conformance
   ```

**Adding New Layers:**

1. Create layer instance: `spec/layers/{NN}-{layer}.layer.json`
2. Create layer schema: `spec/schemas/{NN}-{layer}-layer.schema.json`
3. Create node schemas: `spec/schemas/nodes/{layer}/*.node.schema.json`
4. Rebuild CLI: `npm run build`
5. Verify layer available:

   ```bash
   dr schema layers
   dr schema types {layer}
   ```

#### 5.3.2 Version Management

**Spec Version vs CLI Version:**

- **Spec Version:** `spec/VERSION` file (e.g., "0.8.0")
- **CLI Version:** `cli/package.json` version field (e.g., "0.1.0")
- **Compatibility:** CLI version can be ahead of spec version
- **Upgrade Path:** CLI must support current spec version

**Version Compatibility Matrix:**

| CLI Version | Spec Version | Status                     |
| ----------- | ------------ | -------------------------- |
| 0.1.x       | 0.8.0        | ✅ Current                 |
| 0.2.x       | 0.8.0        | ✅ Forward compatible      |
| 0.1.x       | 0.9.0        | ⚠️ May require CLI upgrade |

**Checking Compatibility:**

```bash
# CLI version
dr --version

# Spec version (from bundled schemas)
dr info
```

---

### 5.4 Monitoring and Diagnostics

**Documentation Requirements:**

#### 5.4.1 Validation Metrics

**Key Metrics:**

- **Element Validation Rate:** Percentage of elements passing schema validation
- **Relationship Validation Rate:** Percentage of relationships passing validation
- **Common Validation Errors:** Most frequent error types

**Monitoring Commands:**

```bash
# Full conformance report
dr conformance --verbose

# JSON output for automation
dr conformance --format json > validation-report.json

# Layer-specific validation
dr conformance --layers api,data-model

# Export validation metrics
dr stats --format json | jq '.validation'
```

#### 5.4.2 Troubleshooting Common Issues

**Issue: Build Fails During Code Generation**

**Symptoms:**

```
Error: Failed to generate registry from schemas
Schema validation error in spec/schemas/nodes/motivation/goal.node.schema.json
```

**Diagnosis:**

1. Check schema syntax: `cat spec/schemas/nodes/motivation/goal.node.schema.json | jq .`
2. Validate schema structure (required fields: `spec_node_id`, `layer_id`, `type`)
3. Check for circular dependencies in schema references

**Resolution:**

1. Fix schema JSON syntax
2. Add missing required constraints
3. Rebuild: `npm run build`

---

**Issue: Element Fails Validation After CLI Upgrade**

**Symptoms:**

```
$ dr conformance
✗ Layer 06 (api): 1 element validated, 1 error

Errors:
  api.endpoint.create-user:
    - Missing required attribute "method" (path: /attributes/method)
```

**Diagnosis:**

1. Schema changed to require new attribute
2. Existing elements lack new required field

**Resolution:**

1. Update element to include required attribute:

   ```bash
   dr update api.endpoint.create-user --properties '{"method":"POST"}'
   ```

2. Or migrate elements automatically:

   ```bash
   dr migrate elements --dry-run
   dr migrate elements
   ```

---

**Issue: Relationship Creation Fails with "Invalid Relationship"**

**Symptoms:**

```
$ dr relationship add motivation.goal.x business.service.y --predicate triggers
✗ Error: Invalid relationship: motivation.goal does not support predicate "triggers"
```

**Diagnosis:**

1. Relationship combination not defined in schemas
2. Predicate not valid for source type

**Resolution:**

1. Check valid predicates:

   ```bash
   dr schema relationship motivation.goal
   ```

2. Use a valid predicate:

   ```bash
   dr relationship add motivation.goal.x business.service.y --predicate realizes
   ```

---

### 5.5 Backup and Recovery

**Documentation Requirements:**

#### 5.5.1 Model Backup

**Before Major Operations:**

```bash
# Full model backup
cp -r documentation-robotics documentation-robotics.backup

# Specific layer backup
cp -r documentation-robotics/model/01_motivation documentation-robotics/model/01_motivation.backup
```

**Before Migration:**

```bash
# Backup before element migration
dr migrate elements --dry-run > migration-preview.txt
cp -r documentation-robotics documentation-robotics.pre-migration

# Execute migration
dr migrate elements

# Verify
dr conformance

# Rollback if needed
rm -rf documentation-robotics
mv documentation-robotics.pre-migration documentation-robotics
```

#### 5.5.2 Recovery Procedures

**Recover from Failed Validation:**

1. Identify invalid elements: `dr conformance --verbose`
2. Backup model: `cp -r documentation-robotics documentation-robotics.backup`
3. Fix elements individually: `dr update <element-id> --properties '{...}'`
4. Validate incrementally: `dr conformance --layers <layer>`
5. Repeat until all errors resolved

**Recover from Build Failures:**

1. Verify schema syntax: `find spec/schemas -name "*.json" -exec jq . {} \;`
2. Reset generated files:

   ```bash
   rm -rf cli/src/generated/*
   npm run build
   ```

3. Check build logs for specific schema errors
4. Fix schemas and rebuild

---

## 6. Documentation Delivery Timeline

### 6.1 Phased Documentation Delivery

**Documentation Requirements:**

The documentation will be delivered in phases aligned with the implementation phases defined in the Software Architect's analysis.

#### Phase 1: Foundation (Schema Synchronization & Layer Registry)

**Deliverables:**

- API Documentation:
  - LayerRegistry API Reference
  - Build system documentation for schema sync
- Developer Documentation:
  - Schema-driven development guide (layer registry section)
  - Build process documentation
  - Testing guide for layer registry
- Operations Documentation:
  - Build process for schema synchronization
  - Troubleshooting schema sync issues

**Timeline:** Delivered with Phase 1 completion

---

#### Phase 2: Node Type Index

**Deliverables:**

- API Documentation:
  - NodeTypeIndex API Reference
  - Updated build system documentation
- User Documentation:
  - `dr schema types` command reference
  - `dr schema node` command reference
  - Updated element creation workflow guide
- Developer Documentation:
  - Adding new node types guide
  - Node schema structure documentation
  - Testing guide for node type index

**Timeline:** Delivered with Phase 2 completion

---

#### Phase 3: Relationship Index & Validation

**Deliverables:**

- API Documentation:
  - RelationshipIndex API Reference
  - RelationshipValidator API Reference
- User Documentation:
  - `dr schema relationship` command reference
  - Updated relationship creation workflow guide
  - Relationship validation error guide
- Developer Documentation:
  - Adding new relationship types guide
  - Relationship schema structure documentation
  - Testing guide for relationship validation

**Timeline:** Delivered with Phase 3 completion

---

#### Phase 4: Element Structure Alignment

**Deliverables:**

- User Documentation:
  - Migration guide for schema-driven CLI
  - Element structure changes documentation
  - `dr migrate elements` command reference
- Developer Documentation:
  - Element class alignment documentation
  - Migration utility implementation guide
- Operations Documentation:
  - Migration procedures
  - Backup and recovery for migration

**Timeline:** Delivered with Phase 4 completion

---

#### Phase 5: Pre-Compiled Validators

**Deliverables:**

- API Documentation:
  - Updated SchemaValidator API (pre-compiled validators)
- Developer Documentation:
  - Pre-compilation process documentation
  - Performance benchmarking guide
- Operations Documentation:
  - Performance monitoring procedures
  - Validation performance metrics

**Timeline:** Delivered with Phase 5 completion

---

#### Phase 6: Developer Experience Enhancements

**Deliverables:**

- User Documentation:
  - Complete `dr schema` command suite reference
  - Enhanced validation workflow guides
  - UX improvement documentation
- Developer Documentation:
  - Complete schema-driven development guide
  - Contributing guidelines for schema-driven CLI
- Operations Documentation:
  - Complete troubleshooting guide
  - Monitoring and diagnostics procedures

**Timeline:** Delivered with Phase 6 completion

---

### 6.2 Documentation Formats

**Deliverables:**

1. **Markdown Files:**
   - All documentation in `docs/` directory
   - Cross-referenced with navigation links
   - Version controlled with code

2. **API Reference (JSDoc):**
   - Inline JSDoc comments in generated code
   - Generated API reference HTML (via TypeDoc)

3. **User Guides:**
   - Command reference guides
   - Workflow tutorials
   - Migration guides

4. **Developer Guides:**
   - Architecture documentation
   - Contributing guides
   - Testing documentation

5. **Operations Runbooks:**
   - Deployment procedures
   - Maintenance checklists
   - Troubleshooting flowcharts

---

### 6.3 Documentation Maintenance

**Deliverables:**

- **Documentation Update Checklist:** Add to contributing guide
  - When to update API docs (API changes)
  - When to update user docs (command changes, new workflows)
  - When to update developer docs (architecture changes, new patterns)
  - When to update operations docs (deployment changes, new procedures)

- **Documentation Review Schedule:**
  - Review with each phase completion
  - Review before each release
  - Review after user feedback

- **Documentation Quality Standards:**
  - All code examples must be tested and functional
  - All CLI commands must be verified against current implementation
  - All schema examples must validate against current schemas
  - All error messages must match current CLI output

---

## Appendices

### Appendix A: Document Change Log

| Version | Date       | Author           | Changes                                      |
| ------- | ---------- | ---------------- | -------------------------------------------- |
| 1.0     | 2026-02-10 | Technical Writer | Initial comprehensive documentation analysis |

### Appendix B: Related Documents

- [Software Architect Analysis](./TECHNICAL_DOCUMENTATION_ANALYSIS_ISSUE_330.md) - Implementation plan
- [Business Analyst Analysis](../../.claude_prompt_*) - Functional requirements
- [CLAUDE.md](/workspace/CLAUDE.md) - Project conventions
- [CLI README](/workspace/cli/README.md) - User-facing CLI documentation
- [Spec README](/workspace/spec/README.md) - Specification documentation

### Appendix C: Glossary

- **spec_node_id:** Unique identifier for a spec node type (format: `{layer}.{type}`)
- **Schema-driven architecture:** Architecture where JSON schemas are the single source of truth
- **Build-time generation:** Code generation that occurs during build, not runtime
- **Conformance validation:** Validation of model against specification schemas
- **Cardinality constraint:** Multiplicity rule for relationships (one-to-one, one-to-many, etc.)
- **AJV:** Another JSON Schema Validator - library used for schema validation
- **Layer hierarchy:** Ordered sequence of 12 layers by layer number

---

**End of Technical Documentation Analysis**
