# Technical Documentation Analysis: CLI Refactoring for Schema-Driven Architecture

**Issue:** #330 - Refactor the CLI to work with the newly refactored specification model
**Status:** Planning & Design Phase
**Date:** 2026-02-10
**Technical Writer Analysis**

---

## Executive Summary

This analysis identifies documentation requirements for refactoring the Documentation Robotics CLI to leverage the newly refactored specification model (Issue #316). The refactoring establishes JSON schemas as the single source of truth for all 354 node types and 252 relationship types, enabling complete conformance validation while eliminating hardcoded type definitions.

**Documentation Scope:** This refactoring requires comprehensive documentation across five categories: API documentation for developers integrating with the CLI, user documentation for CLI operators, developer documentation for contributors, system documentation for architecture understanding, and operations documentation for deployment and maintenance.

**Key Documentation Challenge:** Balancing technical depth for developers implementing the schema-driven architecture with accessibility for users who need to understand how to work with the refactored CLI commands and validation system.

---

## Table of Contents

1. [API Documentation](#1-api-documentation)
2. [User Documentation](#2-user-documentation)
3. [Developer Documentation](#3-developer-documentation)
4. [System Documentation](#4-system-documentation)
5. [Operations Documentation](#5-operations-documentation)
6. [Documentation Delivery Plan](#6-documentation-delivery-plan)

---

## 1. API Documentation

### 1.1 Overview

The schema-driven architecture introduces new generated APIs and modifies existing validation APIs. Documentation must cover both the generated code structure and the public APIs that CLI extensions and integrations will use.

### 1.2 Required API Documentation

#### 1.2.1 LayerRegistry API

**Location:** `cli/src/generated/layer-registry.ts` (auto-generated)

**Documentation Requirements:**

- **Interface Specification:**
  - `LayerMetadata` interface with all fields documented
  - Purpose of each field (id, number, name, nodeTypes, inspiredBy)
  - Valid value ranges and formats
  - Relationship to spec layer instances

- **Public API Methods:**
  - `LAYERS: Map<string, LayerMetadata>` - Complete layer registry
  - `getLayerById(id: string): LayerMetadata | undefined` - Layer lookup by canonical ID
  - `getLayerByNumber(n: number): LayerMetadata | undefined` - Layer lookup by number (1-12)
  - `isValidLayer(id: string): boolean` - Layer ID validation
  - `getAllLayerIds(): string[]` - Get all valid layer identifiers
  - `getNodeTypesForLayer(layerId: string): string[]` - Get valid node types for layer
  - `LAYER_HIERARCHY: number[]` - Ordered array of layer numbers

- **Usage Examples:**
  - Validating user input for layer selection
  - Discovering valid node types for a layer
  - Navigating layer hierarchy for reference validation
  - Error message generation with valid layer lists

- **Code Generation Notes:**
  - How the API is generated from `spec/layers/*.layer.json`
  - When regeneration occurs (build time, schema sync)
  - Why this API is generated vs. runtime-loaded

**Format:** JSDoc comments in generated code + dedicated API reference markdown

---

#### 1.2.2 NodeTypeIndex API

**Location:** `cli/src/generated/node-types.ts` (auto-generated)

**Documentation Requirements:**

- **Type Definitions:**
  - `SpecNodeId` union type - All 354 valid spec node IDs
  - `NodeType` union type - All unique node type identifiers
  - `LayerId` union type - All 12 layer identifiers
  - `NodeTypeInfo` interface - Metadata for each node type

- **Public API:**
  - `NODE_TYPES: Map<SpecNodeId, NodeTypeInfo>` - Complete node type registry
  - `getNodeType(specNodeId: SpecNodeId): NodeTypeInfo | undefined` - Node type lookup
  - `getNodeTypesForLayer(layer: LayerId): NodeTypeInfo[]` - Layer-scoped node types
  - `isValidNodeType(specNodeId: string): boolean` - Node type validation

- **NodeTypeInfo Structure:**
  - `specNodeId: SpecNodeId` - Full spec node identifier (e.g., "motivation.goal")
  - `layer: LayerId` - Extracted layer ID
  - `type: NodeType` - Extracted type identifier
  - `requiredAttributes: string[]` - Required attribute keys from schema
  - `optionalAttributes: string[]` - Optional attribute keys from schema

- **Usage Examples:**
  - Type-safe element creation with autocomplete
  - Validating element types during command parsing
  - Discovering required attributes for a node type
  - Building dynamic forms for element creation

**Format:** JSDoc + TypeScript interface documentation + API reference markdown

---

#### 1.2.3 RelationshipIndex API

**Location:** `cli/src/generated/relationship-index.ts` (auto-generated)

**Documentation Requirements:**

- **Interface Specification:**
  - `RelationshipSpec` interface
    - `id: string` - Relationship schema identifier
    - `sourceSpecNodeId: SpecNodeId` - Valid source node type
    - `destinationSpecNodeId: SpecNodeId` - Valid destination node type
    - `predicate: string` - Semantic relationship predicate
    - `cardinality: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many"`
    - `strength: "critical" | "high" | "medium" | "low"`
    - `required: boolean` - Whether relationship is mandatory

- **Public API:**
  - `RELATIONSHIPS_BY_SOURCE: Map<SpecNodeId, RelationshipSpec[]>` - Indexed by source type
  - `RELATIONSHIPS_BY_PREDICATE: Map<string, RelationshipSpec[]>` - Indexed by predicate
  - `RELATIONSHIPS_BY_DESTINATION: Map<SpecNodeId, RelationshipSpec[]>` - Indexed by destination
  - `getValidRelationships(sourceType: SpecNodeId, predicate?: string): RelationshipSpec[]`
  - `isValidRelationship(source: SpecNodeId, predicate: string, destination: SpecNodeId): boolean`

- **Usage Examples:**
  - Suggesting valid predicates for a source element type
  - Validating relationship combinations before creation
  - Filtering destination types based on source + predicate
  - Enforcing cardinality constraints

**Format:** JSDoc + API reference markdown with relationship validation examples

---

#### 1.2.4 SchemaValidator API (Modified)

**Location:** `cli/src/validators/schema-validator.ts`

**Documentation Requirements:**

- **Public Methods:**
  - `validateElement(element: Element, layer: string): ValidationResult`
    - Now validates against `spec-node.schema.json` + per-type schema
    - No transformation required (elements align with spec structure)
  - `validateRelationship(relationship: Relationship): ValidationResult`
    - Validates against relationship schemas
  - `getValidationErrors(element: Element): ValidationError[]`
  - `isValid(element: Element): boolean`

- **ValidationResult Interface:**
  - `valid: boolean`
  - `errors: ValidationError[]`
  - `warnings: ValidationWarning[]`

- **ValidationError Interface:**
  - `path: string` - JSONPath to failed constraint
  - `message: string` - Human-readable error
  - `schemaPath: string` - Schema path that failed
  - `constraint: string` - Constraint type (e.g., "required", "pattern", "type")

- **Usage Examples:**
  - Validating elements before adding to model
  - Batch validation with error collection
  - Integration with command error handling

**Format:** JSDoc + API reference markdown + migration guide from old validation

---

#### 1.2.5 RelationshipValidator API (New)

**Location:** `cli/src/validators/relationship-validator.ts`

**Documentation Requirements:**

- **Purpose:** Fifth stage of validation pipeline for relationship schema compliance

- **Public Methods:**
  - `validateRelationshipSchema(relationship: ModelRelationship): ValidationResult`
  - `validateCardinality(source: Element, relationship: RelationshipSpec): CardinalityResult`
  - `suggestValidPredicates(sourceType: SpecNodeId): string[]`
  - `suggestValidDestinations(sourceType: SpecNodeId, predicate: string): SpecNodeId[]`

- **CardinalityResult Interface:**
  - `valid: boolean`
  - `currentCount: number`
  - `allowedCount: number | "unlimited"`
  - `conflictingRelationships: string[]` - IDs of relationships that would be violated

- **Usage Examples:**
  - Pre-validation before relationship creation
  - Suggesting valid relationship options in interactive commands
  - Error messages explaining cardinality violations

**Format:** JSDoc + API reference markdown with cardinality examples

---

### 1.3 API Documentation Deliverables

| Document                    | Format   | Location                          | Audience                               |
| --------------------------- | -------- | --------------------------------- | -------------------------------------- |
| **Generated API Reference** | Markdown | `docs/api/generated-apis.md`      | CLI developers, extension authors      |
| **Validation API Guide**    | Markdown | `docs/api/validation-api.md`      | CLI developers, integration developers |
| **Code Generation Guide**   | Markdown | `docs/api/code-generation.md`     | Contributors, build system maintainers |
| **API Migration Guide**     | Markdown | `docs/api/migration-from-v0.1.md` | Existing CLI extension developers      |
| **JSDoc Comments**          | Inline   | All `.ts` files                   | IDE users, code reviewers              |

---

## 2. User Documentation

### 2.1 Overview

User documentation focuses on CLI operators who use the `dr` command to manage architecture models. The refactoring introduces new validation behaviors, enhanced error messages, and new introspection commands.

### 2.2 Required User Documentation

#### 2.2.1 Updated Command Reference

**Commands Requiring Documentation Updates:**

| Command               | Changes                                                      | Documentation Impact                                     |
| --------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `dr add`              | Validates element types against generated NodeTypeIndex      | Document type validation, improved error messages        |
| `dr update`           | Validates attributes against per-type schemas                | Document attribute validation, schema-driven constraints |
| `dr relationship add` | Validates against relationship schemas, enforces cardinality | Document relationship validation, cardinality errors     |
| `dr validate`         | Uses schema validators, reports schema conformance           | Document new validation output format                    |
| `dr conformance`      | Uses LayerRegistry for expected types                        | Document conformance checking against spec               |
| `dr schema` (new)     | Introspection commands for layers/types/relationships        | Full command documentation                               |

**Documentation Structure per Command:**

```markdown
## dr <command>

### Synopsis

Brief description of command purpose

### Usage

dr <command> [options] <arguments>

### Options

Detailed option descriptions

### Examples

Practical examples with expected output

### Validation

What validation occurs and how errors are reported

### Related Commands

Cross-references to related commands

### See Also

Links to concepts (schemas, layers, relationships)
```

---

#### 2.2.2 New `dr schema` Command Suite

**Commands to Document:**

1. **`dr schema layers`**
   - **Purpose:** List all layers with node type counts
   - **Output:** Table of layers with metadata (number, name, node type count, standard)
   - **Use Cases:** Discovering layer structure, understanding model scope
   - **Examples:**

     ```bash
     dr schema layers
     # Output:
     # Layer | Number | Name              | Node Types | Standard
     # ------|--------|-------------------|------------|-------------
     # motivation | 1  | Motivation Layer  | 8          | ArchiMate 3.2
     # business   | 2  | Business Layer    | 12         | ArchiMate 3.2
     # ...
     ```

2. **`dr schema types <layer>`**
   - **Purpose:** List valid node types for a specific layer
   - **Output:** Table of node types with required/optional attributes
   - **Use Cases:** Discovering valid types before adding elements
   - **Examples:**

     ```bash
     dr schema types motivation
     # Output:
     # Type         | Spec Node ID       | Required Attributes | Optional Attributes
     # -------------|--------------------|--------------------|--------------------
     # goal         | motivation.goal    | name, description  | priority, status
     # requirement  | motivation.requirement | name, type     | priority, source
     # ...
     ```

3. **`dr schema node <spec_node_id>`**
   - **Purpose:** Show detailed schema for a specific node type
   - **Output:** JSON schema excerpt + human-readable attribute list
   - **Use Cases:** Understanding attribute constraints before creating elements
   - **Examples:**

     ```bash
     dr schema node motivation.goal
     # Output:
     # Spec Node: motivation.goal
     # Layer: motivation (1)
     # Name: Goal
     #
     # Required Attributes:
     #   - name (string): Goal name
     #   - description (string): Detailed goal description
     #
     # Optional Attributes:
     #   - priority (enum: high, medium, low): Goal priority
     #   - status (enum: active, achieved, abandoned): Current status
     # ...
     ```

4. **`dr schema relationship <source_type> [predicate]`**
   - **Purpose:** Show valid relationships for a source node type
   - **Output:** Table of valid predicates and destination types with cardinality
   - **Use Cases:** Discovering valid relationships, understanding cardinality constraints
   - **Examples:**

     ```bash
     dr schema relationship motivation.goal
     # Output:
     # Source: motivation.goal
     #
     # Predicate        | Destination Types     | Cardinality  | Strength
     # -----------------|----------------------|--------------|----------
     # supports         | business.service     | one-to-many  | high
     # motivates        | business.process     | one-to-many  | medium
     # ...

     dr schema relationship motivation.goal supports
     # Output:
     # Relationship: motivation.goal --supports--> business.service
     # Cardinality: one-to-many (one goal can support many services)
     # Strength: high
     # Required: false
     # ...
     ```

---

#### 2.2.3 Enhanced Error Messages

**Documentation Requirements:**

- **Error Message Catalog:**
  - Schema validation errors with explanations
  - Relationship validation errors with cardinality context
  - Type mismatch errors with valid type suggestions
  - Layer reference errors with layer hierarchy context

- **Error Resolution Guide:**

  ````markdown
  ## Common Validation Errors

  ### "Invalid element type"

  **Cause:** Element type does not match any spec node schema
  **Resolution:** Use `dr schema types <layer>` to see valid types
  **Example:**

  ```bash
  # Error: Invalid element type 'Goal' for layer 'motivation'
  # Resolution:
  dr schema types motivation  # See valid types (use lowercase 'goal')
  dr add motivation goal my-goal --name "My Goal"
  ```
  ````

### "Relationship cardinality violation"

  **Cause:** Adding relationship would violate cardinality constraint
  **Resolution:** Review existing relationships and cardinality rules
  **Example:**

  ```bash
  # Error: Cannot add relationship - 'motivation.goal.g1' already has
  #        one-to-one relationship with 'business.service.s1'
  # Resolution:
  dr relationship list motivation.goal.g1  # See existing relationships
  dr schema relationship motivation.goal supports  # Check cardinality
  ```

### "Missing required attribute"

  **Cause:** Element missing attribute required by spec node schema
  **Resolution:** Use `dr schema node <spec_node_id>` to see required attributes
  **Example:**

  ```bash
  # Error: Missing required attribute 'description' for motivation.goal
  # Resolution:
  dr schema node motivation.goal  # See required attributes
  dr add motivation goal my-goal --name "Name" --description "Description"
  ```

---

#### 2.2.4 Migration Guide for Users

**Target Audience:** Existing Documentation Robotics CLI users upgrading from v0.1.0

**Content Requirements:**

1. **Breaking Changes:**
   - Element structure changes (if any public API changes)
   - Validation strictness changes (new schema requirements)
   - Command behavior changes

2. **New Features:**
   - Schema introspection commands
   - Enhanced validation with precise error paths
   - Relationship cardinality enforcement

3. **Migration Checklist:**

   ```markdown
   ## Pre-Migration Checklist

   - [ ] Backup your model: `cp -r documentation-robotics documentation-robotics.backup`
   - [ ] Review current model validity: `dr validate`
   - [ ] Note any existing validation warnings
   - [ ] Upgrade CLI: `npm install -g @documentation-robotics/cli@latest`

   ## Post-Migration Validation

   - [ ] Run conformance check: `dr conformance`
   - [ ] Fix any new validation errors
   - [ ] Test exports: `dr export archimate`, `dr export openapi`
   - [ ] Verify relationships: `dr relationship list <element-id>` for key elements

   ## Common Migration Issues

   - Schema validation now stricter - missing required attributes will fail
   - Relationship cardinality now enforced - duplicate one-to-one relationships will fail
   - Element IDs must use correct type casing (lowercase: 'goal', not 'Goal')
   ```

---

### 2.3 User Documentation Deliverables

| Document                        | Format   | Location                                     | Audience                         |
| ------------------------------- | -------- | -------------------------------------------- | -------------------------------- |
| **Command Reference (Updated)** | Markdown | `cli/README.md` (sections), `docs/commands/` | All CLI users                    |
| **Schema Introspection Guide**  | Markdown | `docs/user-guide/schema-introspection.md`    | CLI users, architects            |
| **Validation Error Guide**      | Markdown | `docs/troubleshooting/validation-errors.md`  | CLI users troubleshooting errors |
| **User Migration Guide**        | Markdown | `docs/migration/v0.1-to-v0.2.md`             | Existing CLI users upgrading     |
| **Quick Start (Updated)**       | Markdown | `docs/quick-start/README.md`                 | New CLI users                    |

---

## 3. Developer Documentation

### 3.1 Overview

Developer documentation targets contributors to the CLI codebase who need to understand the schema-driven architecture, code generation system, and validation pipeline.

### 3.2 Required Developer Documentation

#### 3.2.1 Architecture Overview

**Purpose:** High-level understanding of the schema-driven architecture

**Content:**

1. **Architecture Diagram:**

   ```
   ┌─────────────────────────────────────────────────────────────────┐
   │                        BUILD TIME                               │
   ├─────────────────────────────────────────────────────────────────┤
   │  spec/schemas/        sync-spec-schemas.sh   cli/src/schemas/   │
   │  ├── base/        ─────────────────────►    bundled/           │
   │  ├── nodes/                                  ├── base/          │
   │  └── relationships/                          ├── nodes/         │
   │                                               └── relationships/ │
   │                                                                  │
   │  spec/layers/         generate-registry.ts   cli/src/generated/ │
   │  ├── *.layer.json ─────────────────────►    ├── layer-registry │
   │                                              ├── node-types      │
   │                                              └── relationship-   │
   │                                                  index           │
   └─────────────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────────────┐
   │                         RUNTIME                                 │
   ├─────────────────────────────────────────────────────────────────┤
   │  Commands           Core                    Validators          │
   │  ├── add         ──► LayerRegistry      ──► SchemaValidator    │
   │  ├── validate       (generated)            (pre-compiled AJV)   │
   │  ├── conformance ──► NodeTypeIndex     ──► RelationshipValidator│
   │  └── schema         (generated)                                 │
   └─────────────────────────────────────────────────────────────────┘
   ```

2. **Key Design Principles:**
   - Schemas as single source of truth (no hardcoded types)
   - Build-time code generation for type safety
   - Runtime validation with pre-compiled AJV validators
   - Hybrid approach: generated registries + lazy-loaded schemas

3. **Component Responsibilities:**
   - `LayerRegistry`: Layer metadata and hierarchy
   - `NodeTypeIndex`: Node type discovery and metadata
   - `RelationshipIndex`: Relationship validation rules
   - `SchemaValidator`: Node schema compliance
   - `RelationshipValidator`: Relationship schema compliance

**Format:** Markdown with Mermaid diagrams in `docs/architecture/schema-driven-architecture.md`

---

#### 3.2.2 Code Generation Guide

**Purpose:** Explain how code generation works and how to modify it

**Content:**

1. **Generator Script Overview:**
   - **Location:** `cli/scripts/generate-registry.ts`
   - **Trigger:** Runs during `npm run build` after schema sync
   - **Inputs:** `spec/layers/*.layer.json`, `spec/schemas/nodes/**/*.json`, `spec/schemas/relationships/**/*.json`
   - **Outputs:** `cli/src/generated/*.ts` files

2. **Generation Process:**

   ```typescript
   // Pseudo-code for generation process
   1. Load all layer instance files from spec/layers/
   2. Extract layer metadata (id, number, name, nodeTypes, inspiredBy)
   3. Generate LayerRegistry with typed interfaces

   4. Scan all node schemas from spec/schemas/nodes/**
   5. Extract per-type metadata (spec_node_id, required/optional attributes)
   6. Generate NodeTypeIndex with union types

   7. Scan all relationship schemas from spec/schemas/relationships/**
   8. Extract relationship rules (source, destination, predicate, cardinality)
   9. Generate RelationshipIndex with indexed maps

   10. Write all generated files to cli/src/generated/
   11. Format with prettier
   ```

3. **Modifying the Generator:**
   - How to add new extracted metadata fields
   - How to modify generated API structure
   - Testing generated code
   - Handling schema parsing errors

4. **Generated Code Structure:**

   ```typescript
   // Example of generated layer-registry.ts structure
   // AUTO-GENERATED - DO NOT EDIT
   // Generated from spec/layers/*.layer.json
   // Last updated: 2026-02-10

   export interface LayerMetadata { ... }

   export const LAYERS: Map<string, LayerMetadata> = new Map([
     ["motivation", { id: "motivation", number: 1, ... }],
     ...
   ]);

   export function getLayerById(id: string): LayerMetadata | undefined {
     return LAYERS.get(id);
   }
   ```

**Format:** Markdown in `docs/development/code-generation.md`

---

#### 3.2.3 Validation Pipeline Guide

**Purpose:** Explain the 5-stage validation pipeline and how to extend it

**Content:**

1. **Validation Stages:**

   ```
   Stage 1: Schema Validation (SchemaValidator)
     └─► Validates element against spec-node.schema.json + per-type schema

   Stage 2: Naming Validation (NamingValidator)
     └─► Validates element ID format: {layer}.{type}.{kebab-case}

   Stage 3: Reference Validation (ReferenceValidator)
     └─► Validates cross-layer references (higher → lower only)

   Stage 4: Semantic Validation (SemanticValidator)
     └─► Business rule validation (layer-specific rules)

   Stage 5: Relationship Validation (RelationshipValidator) [NEW]
     └─► Validates relationships against schemas + cardinality
   ```

2. **Validator Interface:**

   ```typescript
   interface Validator {
     validate(element: Element, context: ValidationContext): ValidationResult;
   }

   interface ValidationContext {
     model: Model;
     layer: Layer;
     existingElement?: Element; // For updates
   }

   interface ValidationResult {
     valid: boolean;
     errors: ValidationError[];
     warnings: ValidationWarning[];
   }
   ```

3. **Adding a New Validator:**
   - Create validator class implementing `Validator` interface
   - Register in validation pipeline (`cli/src/validators/pipeline.ts`)
   - Add tests in `cli/tests/validators/`
   - Document validation rules

4. **Schema Validator Details:**
   - Uses AJV with JSON Schema Draft 7
   - Pre-compiles base schemas at build time
   - Lazy-loads per-type schemas on first use
   - Caches compiled validators for performance

5. **Relationship Validator Details:**
   - Uses `RelationshipIndex` for schema lookup
   - Validates source/destination type compatibility
   - Enforces cardinality constraints by counting existing relationships
   - Provides suggestions for valid relationships

**Format:** Markdown in `docs/development/validation-pipeline.md`

---

#### 3.2.4 Testing Guide

**Purpose:** Explain how to test schema-driven components

**Content:**

1. **Test Structure:**
   - Unit tests for generated registries: `cli/tests/unit/generated/`
   - Integration tests for validation pipeline: `cli/tests/integration/validators/`
   - Schema validation tests: `cli/tests/integration/schema-validation.test.ts`
   - Relationship validation tests: `cli/tests/integration/relationship-validation.test.ts`

2. **Testing Generated Code:**

   ```typescript
   // Example test for LayerRegistry
   describe("LayerRegistry", () => {
     it("should load all 12 layers", () => {
       expect(LAYERS.size).toBe(12);
     });

     it("should validate layer IDs", () => {
       expect(isValidLayer("motivation")).toBe(true);
       expect(isValidLayer("invalid")).toBe(false);
     });

     it("should get layer by number", () => {
       const layer = getLayerByNumber(1);
       expect(layer?.id).toBe("motivation");
     });
   });
   ```

3. **Testing Validation:**

   ```typescript
   // Example test for schema validation
   describe("SchemaValidator", () => {
     it("should validate element against spec node schema", () => {
       const element = {
         id: "uuid-here",
         spec_node_id: "motivation.goal",
         type: "goal",
         layer_id: "motivation",
         name: "Test Goal",
         attributes: { description: "Test description" },
       };
       const result = validator.validateElement(element, "motivation");
       expect(result.valid).toBe(true);
     });

     it("should fail validation for missing required attribute", () => {
       const element = {
         id: "uuid-here",
         spec_node_id: "motivation.goal",
         type: "goal",
         layer_id: "motivation",
         name: "Test Goal",
         attributes: {}, // Missing required 'description'
       };
       const result = validator.validateElement(element, "motivation");
       expect(result.valid).toBe(false);
       expect(result.errors[0].path).toBe("attributes.description");
     });
   });
   ```

4. **Golden Copy Test Pattern:**
   - How to use `createTestWorkdir()` for isolated tests
   - Editing baseline data in `cli-validation/test-project/baseline/`
   - Test cleanup and performance considerations

**Format:** Markdown in `docs/development/testing-guide.md`

---

#### 3.2.5 Contributing Guide (Updated)

**Purpose:** Guide contributors through the new schema-driven workflow

**Content:**

1. **Adding a New Layer:**
   - Create layer instance: `spec/layers/NN-layer-name.layer.json`
   - Create layer schema: `spec/schemas/NN-layer-name-layer.schema.json`
   - Create node schemas: `spec/schemas/nodes/layer-name/*.node.schema.json`
   - Run code generation: `npm run build` in CLI
   - Update docs: Add layer to CLAUDE.md and README.md

2. **Adding a New Node Type:**
   - Create node schema: `spec/schemas/nodes/{layer}/{type}.node.schema.json`
   - Extend `spec-node.schema.json` via `allOf`
   - Add to layer instance `node_types` array
   - Run code generation: `npm run build` in CLI
   - **No CLI code changes required** ✅

3. **Adding a New Relationship Type:**
   - Create relationship schema: `spec/schemas/relationships/{layer}/{source}-{predicate}-{destination}.relationship.schema.json`
   - Extend `spec-node-relationship.schema.json` via `allOf`
   - Define `source_spec_node_id`, `destination_spec_node_id`, `predicate`
   - Run code generation: `npm run build` in CLI
   - **No CLI code changes required** ✅

4. **Development Workflow:**

   ```bash
   # 1. Make schema changes in spec/
   cd spec/schemas/nodes/motivation/
   # Edit goal.node.schema.json

   # 2. Sync schemas to CLI
   cd ../../../cli
   npm run build  # Runs sync + generation

   # 3. Test changes
   npm run test

   # 4. Validate locally
   dr validate --schemas

   # 5. Commit
   git add spec/ cli/src/schemas/bundled/ cli/src/generated/
   git commit -m "Add new goal attributes"
   ```

5. **Schema Design Guidelines:**
   - Always extend base schemas via `allOf`
   - Use `const` constraints for `spec_node_id`, `layer_id`, `type`
   - Document attributes with `description` fields
   - Use standard JSON Schema Draft 7 keywords
   - Validate schemas with `check-jsonschema` before committing

**Format:** Update existing `CONTRIBUTING.md` + new `docs/development/schema-workflow.md`

---

### 3.3 Developer Documentation Deliverables

| Document                         | Format   | Location                                          | Audience                          |
| -------------------------------- | -------- | ------------------------------------------------- | --------------------------------- |
| **Architecture Overview**        | Markdown | `docs/architecture/schema-driven-architecture.md` | New contributors, architects      |
| **Code Generation Guide**        | Markdown | `docs/development/code-generation.md`             | Contributors modifying generators |
| **Validation Pipeline Guide**    | Markdown | `docs/development/validation-pipeline.md`         | Contributors adding validation    |
| **Testing Guide**                | Markdown | `docs/development/testing-guide.md`               | Contributors writing tests        |
| **Schema Workflow Guide**        | Markdown | `docs/development/schema-workflow.md`             | Contributors modifying schemas    |
| **Contributing Guide (Updated)** | Markdown | `CONTRIBUTING.md`                                 | All contributors                  |

---

## 4. System Documentation

### 4.1 Overview

System documentation provides comprehensive technical reference for the schema-driven architecture, data models, and system behavior.

### 4.2 Required System Documentation

#### 4.2.1 Data Model Documentation

**Purpose:** Document the spec-aligned element structure

**Content:**

1. **SpecNode Data Model:**

   ```typescript
   interface SpecNode {
     id: string; // UUIDv4 - globally unique instance ID
     spec_node_id: string; // Reference to spec node type (e.g., "motivation.goal")
     type: string; // Denormalized type (extracted from spec_node_id)
     layer_id: string; // Denormalized layer (extracted from spec_node_id)
     name: string; // Human-readable instance name
     description?: string; // Optional detailed description
     attributes?: object; // Type-specific attributes (validated by per-type schema)
     source_reference?: SourceReference; // Provenance tracking
     metadata?: {
       // Lifecycle metadata
       created_at?: string; // ISO 8601 timestamp
       updated_at?: string; // ISO 8601 timestamp
       created_by?: string; // User or system
       version?: number; // Version number
     };
   }
   ```

2. **SourceReference Data Model:**

   ```typescript
   interface SourceReference {
     file: string; // Relative path from repo root
     symbol?: string; // Function/class/variable name
     provenance: "extracted" | "manual" | "inferred" | "generated";
     repository?: {
       remote: string; // Git remote URL
       commit: string; // Full 40-char SHA
     };
   }
   ```

3. **ModelRelationship Data Model:**

   ```typescript
   interface ModelRelationship {
     id: string; // UUIDv4
     source_element_id: string; // Element UUID
     destination_element_id: string; // Element UUID
     predicate: string; // Semantic relationship type
     attributes?: object; // Relationship-specific attributes
     metadata?: {
       created_at?: string;
       created_by?: string;
     };
   }
   ```

4. **Migration from Legacy Element:**

   ```markdown
   ## Legacy Element → SpecNode Migration

   | Legacy Field                  | SpecNode Field                      | Notes                                        |
   | ----------------------------- | ----------------------------------- | -------------------------------------------- |
   | `id` (semantic)               | `name` + auto-generated `id` (UUID) | Semantic ID becomes name, new UUID generated |
   | `type`                        | `type` + `spec_node_id`             | Type becomes part of spec_node_id            |
   | `layer`                       | `layer_id` + part of `spec_node_id` | Layer extracted to layer_id                  |
   | `properties`                  | `attributes`                        | Renamed to align with spec                   |
   | `description`                 | `description`                       | Preserved                                    |
   | `properties.source.reference` | `source_reference`                  | Lifted to top level                          |
   | N/A                           | `metadata`                          | New field for lifecycle tracking             |
   ```

**Format:** Markdown in `docs/data-models/spec-node.md`

---

#### 4.2.2 Schema System Documentation

**Purpose:** Explain the schema hierarchy and validation rules

**Content:**

1. **Schema Hierarchy:**

   ```
   spec-node.schema.json (base)
     ├── Defines common fields: id, spec_node_id, type, layer_id, name
     ├── Defines optional fields: description, attributes, source_reference, metadata
     └── Extended by per-type schemas via allOf

   {layer}/{type}.node.schema.json (per-type)
     ├── Constrains spec_node_id to specific value (e.g., "motivation.goal")
     ├── Constrains type to specific value (e.g., "goal")
     ├── Constrains layer_id to specific value (e.g., "motivation")
     ├── Defines required attributes in attributes.required
     └── Defines attribute schemas in attributes.properties

   Example: motivation/goal.node.schema.json
   {
     "allOf": [
       { "$ref": "../base/spec-node.schema.json" },
       {
         "properties": {
           "spec_node_id": { "const": "motivation.goal" },
           "type": { "const": "goal" },
           "layer_id": { "const": "motivation" },
           "attributes": {
             "required": ["description", "priority"],
             "properties": {
               "description": { "type": "string", "minLength": 10 },
               "priority": { "enum": ["high", "medium", "low"] }
             }
           }
         }
       }
     ]
   }
   ```

2. **Validation Rules:**
   - Required field validation (id, spec_node_id, type, layer_id, name)
   - Format validation (UUID for id, pattern for spec_node_id)
   - Attribute validation (type-specific via per-type schema)
   - Source reference validation (format of file paths, commit SHAs)
   - Metadata validation (timestamp formats, version numbers)

3. **Schema Evolution:**
   - How to add new attributes to existing types (backwards compatibility)
   - How to deprecate attributes (using `deprecated` keyword)
   - How to version schemas (spec version in schema $id)

**Format:** Markdown in `docs/schemas/schema-system.md`

---

#### 4.2.3 Build System Documentation

**Purpose:** Document the build pipeline and code generation

**Content:**

1. **Build Pipeline Stages:**

   ```
   npm run build
     ├── 1. Clean dist/
     ├── 2. Sync schemas (scripts/sync-spec-schemas.sh)
     │   ├── Copy spec/schemas/base/ → cli/src/schemas/bundled/base/
     │   ├── Copy spec/schemas/nodes/ → cli/src/schemas/bundled/nodes/
     │   └── Copy spec/schemas/relationships/ → cli/src/schemas/bundled/relationships/
     ├── 3. Generate registries (scripts/generate-registry.ts)
     │   ├── Generate cli/src/generated/layer-registry.ts
     │   ├── Generate cli/src/generated/node-types.ts
     │   └── Generate cli/src/generated/relationship-index.ts
     ├── 4. Compile TypeScript (tsc)
     └── 5. Post-process (copy assets, chmod +x, etc.)
   ```

2. **Schema Sync Process:**
   - Source: `spec/schemas/`
   - Destination: `cli/src/schemas/bundled/`
   - Trigger: Automatic during build
   - Checksum: Validates schemas haven't diverged
   - Error handling: Build fails if schemas are invalid

3. **Code Generation Process:**
   - Input: Schema files from `cli/src/schemas/bundled/`
   - Processing: Parse JSON schemas, extract metadata
   - Output: TypeScript files in `cli/src/generated/`
   - Formatting: Prettier run on generated code
   - Validation: Generated code must compile without errors

4. **Troubleshooting Build Issues:**

   ```markdown
   ## Build Error: Schema sync failed

   **Cause:** Schemas in spec/ are invalid JSON
   **Resolution:** Validate schemas with `check-jsonschema`

   ## Build Error: Code generation failed

   **Cause:** Schema structure doesn't match expected format
   **Resolution:** Check schema parsing errors in build output

   ## Build Error: Generated code doesn't compile

   **Cause:** Generated TypeScript has syntax errors
   **Resolution:** Review generate-registry.ts for template issues
   ```

**Format:** Markdown in `docs/system/build-system.md`

---

#### 4.2.4 Performance Characteristics

**Purpose:** Document performance expectations and optimizations

**Content:**

1. **Code Generation Performance:**
   - Schema sync: ~50ms (606 schemas)
   - Registry generation: ~200ms (parse + generate + format)
   - Total build time impact: ~250ms additional overhead
   - Incremental builds: No regeneration if schemas unchanged

2. **Runtime Performance:**
   - Registry lookups: O(1) via Map structures
   - Schema validation: ~1-2ms per element (pre-compiled AJV)
   - Relationship validation: ~0.5ms per relationship
   - Startup time: <150ms (lazy schema loading)

3. **Memory Usage:**
   - Generated registries: ~200KB in memory
   - Cached validators: ~50KB per validator
   - Schema files: Lazy-loaded as needed
   - Total overhead: ~5MB additional memory usage

4. **Scalability:**
   - Supports 354 node types + 252 relationship types
   - Tested with models containing 10,000+ elements
   - Relationship validation scales linearly with element count
   - No degradation with additional schema types

**Format:** Markdown in `docs/system/performance.md`

---

### 4.3 System Documentation Deliverables

| Document                        | Format   | Location                        | Audience                   |
| ------------------------------- | -------- | ------------------------------- | -------------------------- |
| **Data Model Reference**        | Markdown | `docs/data-models/spec-node.md` | Developers, integrators    |
| **Schema System Guide**         | Markdown | `docs/schemas/schema-system.md` | Schema authors, validators |
| **Build System Reference**      | Markdown | `docs/system/build-system.md`   | Build system maintainers   |
| **Performance Characteristics** | Markdown | `docs/system/performance.md`    | Architects, ops teams      |

---

## 5. Operations Documentation

### 5.1 Overview

Operations documentation provides guidance for deploying, monitoring, and maintaining the schema-driven CLI in production environments.

### 5.2 Required Operations Documentation

#### 5.2.1 Deployment Guide

**Purpose:** Guide operators through CLI deployment and configuration

**Content:**

1. **Installation Methods:**
   - Global npm installation: `npm install -g @documentation-robotics/cli`
   - Local project installation: `npm install @documentation-robotics/cli`
   - Docker container: Use pre-built image with bundled schemas
   - CI/CD integration: Install as pipeline dependency

2. **Verification:**

   ```bash
   # Verify installation
   dr --version

   # Verify schema registry generation
   dr schema layers  # Should show all 12 layers

   # Verify validation works
   dr validate --schemas  # Cross-validate spec schemas
   ```

3. **Configuration:**
   - Model directory: `documentation-robotics/model/`
   - Schema cache location: `cli/src/schemas/bundled/`
   - Generated code location: `cli/src/generated/`
   - No external configuration files required

4. **Upgrade Process:**

   ```bash
   # 1. Backup model
   cp -r documentation-robotics documentation-robotics.backup

   # 2. Upgrade CLI
   npm install -g @documentation-robotics/cli@latest

   # 3. Validate model against new schemas
   cd your-project
   dr conformance

   # 4. Fix any conformance issues
   # (Follow error messages and migration guide)

   # 5. Verify exports still work
   dr export archimate --output test.xml
   dr export openapi --layers api --output test.yaml
   ```

**Format:** Markdown in `docs/operations/deployment.md`

---

#### 5.2.2 Monitoring & Troubleshooting

**Purpose:** Help operators diagnose and resolve issues

**Content:**

1. **Health Checks:**

   ```bash
   # Check CLI is functional
   dr --version

   # Check schema registry loaded
   dr schema layers

   # Check model validity
   dr validate

   # Check schema synchronization
   dr validate --schemas
   ```

2. **Common Issues:**

   ```markdown
   ## Issue: "Schema validation failed"

   **Symptoms:** Elements fail validation with schema errors
   **Diagnosis:**

   - Run `dr validate` to see specific errors
   - Check `dr schema node <spec_node_id>` for requirements
     **Resolution:**
   - Fix elements to match schema requirements
   - Use `dr update <element-id>` to correct attributes

   ## Issue: "Invalid layer"

   **Symptoms:** Commands reject layer names
   **Diagnosis:**

   - Run `dr schema layers` to see valid layers
   - Check for typos (use hyphenated form: "data-model", not "datamodel")
     **Resolution:**
   - Use canonical layer names from registry
   - Update scripts/documentation with correct names

   ## Issue: "Generated code out of sync"

   **Symptoms:** CLI behaves unexpectedly after schema changes
   **Diagnosis:**

   - Check if `cli/src/generated/` is stale
   - Verify `npm run build` completed successfully
     **Resolution:**
   - Run `npm run build` to regenerate
   - Clear node_modules and reinstall if persistent
   ```

3. **Logging & Diagnostics:**
   - Enable debug logging: `DEBUG=dr:* dr validate`
   - Validation error details: Always include JSON paths
   - Schema error reporting: Show schema path + failed constraint

4. **Performance Issues:**

   ```markdown
   ## Issue: Slow validation

   **Cause:** Large models with many elements
   **Resolution:**

   - Validate specific layers: `dr conformance --layers api,data-model`
   - Use parallel validation (future enhancement)

   ## Issue: Slow startup

   **Cause:** Cold schema cache
   **Resolution:**

   - Normal on first run (schemas lazy-loaded)
   - Subsequent runs should be fast (~150ms)
   ```

**Format:** Markdown in `docs/operations/troubleshooting.md`

---

#### 5.2.3 CI/CD Integration

**Purpose:** Guide integration with continuous integration pipelines

**Content:**

1. **GitHub Actions Example:**

   ```yaml
   name: Validate Architecture Model

   on: [push, pull_request]

   jobs:
     validate:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3

         - name: Setup Node.js
           uses: actions/setup-node@v3
           with:
             node-version: "18"

         - name: Install CLI
           run: npm install -g @documentation-robotics/cli

         - name: Validate model
           run: dr validate

         - name: Check conformance
           run: dr conformance

         - name: Export ArchiMate
           run: dr export archimate --output model.xml
   ```

2. **GitLab CI Example:**

   ```yaml
   validate-model:
     image: node:18
     script:
       - npm install -g @documentation-robotics/cli
       - dr validate
       - dr conformance
       - dr export archimate --output model.xml
     artifacts:
       paths:
         - model.xml
   ```

3. **Pre-commit Hooks:**

   ```yaml
   # .pre-commit-config.yaml
   repos:
     - repo: local
       hooks:
         - id: dr-validate
           name: Validate Documentation Robotics Model
           entry: dr validate
           language: system
           pass_filenames: false

         - id: dr-conformance
           name: Check Model Conformance
           entry: dr conformance
           language: system
           pass_filenames: false
   ```

4. **Validation in PR Reviews:**
   - Run `dr validate` on every PR
   - Run `dr conformance` to check schema compliance
   - Fail PR if validation errors
   - Generate exports as artifacts for review

**Format:** Markdown in `docs/operations/ci-cd-integration.md`

---

### 5.3 Operations Documentation Deliverables

| Document                    | Format   | Location                               | Audience                |
| --------------------------- | -------- | -------------------------------------- | ----------------------- |
| **Deployment Guide**        | Markdown | `docs/operations/deployment.md`        | DevOps, system admins   |
| **Troubleshooting Guide**   | Markdown | `docs/operations/troubleshooting.md`   | Support engineers, ops  |
| **CI/CD Integration Guide** | Markdown | `docs/operations/ci-cd-integration.md` | DevOps, CI/CD engineers |

---

## 6. Documentation Delivery Plan

### 6.1 Documentation Phases

The documentation delivery is phased to align with the 6-phase implementation plan from the software architect's design:

| Implementation Phase                 | Documentation Deliverables                                                                   | Timeline |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | -------- |
| **Phase 1: Foundation**              | - LayerRegistry API docs<br>- Architecture overview<br>- Build system reference              | Week 1   |
| **Phase 2: Node Type Index**         | - NodeTypeIndex API docs<br>- Schema introspection user guide<br>- Updated command reference | Week 2   |
| **Phase 3: Relationship Index**      | - RelationshipIndex API docs<br>- Relationship validation guide<br>- Error message catalog   | Week 3   |
| **Phase 4: Element Alignment**       | - Data model reference<br>- Migration guide for users<br>- Schema system guide               | Week 4   |
| **Phase 5: Pre-compiled Validators** | - Validation pipeline guide<br>- Performance characteristics<br>- Testing guide              | Week 5   |
| **Phase 6: UX Enhancements**         | - Complete command reference<br>- Quick start updates<br>- Operations guides                 | Week 6   |

### 6.2 Documentation Quality Standards

All documentation must meet these quality criteria:

1. **Accuracy:**
   - Code examples must be tested and functional
   - API signatures must match implementation
   - Version numbers and dates must be current

2. **Completeness:**
   - All public APIs documented with JSDoc
   - All commands documented with examples
   - All error messages explained in troubleshooting guide

3. **Clarity:**
   - Use active voice and present tense
   - Define technical terms on first use
   - Provide context before details

4. **Consistency:**
   - Use standard terminology (from glossary)
   - Follow markdown formatting conventions
   - Use consistent code example style

5. **Maintainability:**
   - Link related documentation sections
   - Version documentation with spec/CLI versions
   - Use include/reference for shared content

### 6.3 Documentation Review Process

1. **Technical Review:**
   - API docs reviewed by CLI developers
   - Schema docs reviewed by specification maintainers
   - Examples tested by QA/integration team

2. **User Review:**
   - Command docs reviewed by CLI users
   - Migration guide tested by existing users
   - Quick start validated by new users

3. **Editorial Review:**
   - Spelling, grammar, and style check
   - Link verification (internal + external)
   - Markdown rendering validation

### 6.4 Documentation Maintenance

- **Update Triggers:**
  - New CLI release → Update version numbers, add migration notes
  - New spec version → Update schema examples, validate compatibility
  - Bug fixes → Update troubleshooting guide
  - New features → Update command reference, add examples

- **Quarterly Reviews:**
  - Validate all code examples still work
  - Update performance benchmarks
  - Review and update troubleshooting guide
  - Prune outdated content

- **Feedback Integration:**
  - Monitor GitHub issues for documentation requests
  - Track common support questions
  - Incorporate user feedback into docs

---

## Summary

This documentation analysis identifies comprehensive documentation requirements across five categories:

1. **API Documentation:** 6 deliverables covering LayerRegistry, NodeTypeIndex, RelationshipIndex, SchemaValidator, RelationshipValidator, and migration guides

2. **User Documentation:** 5 deliverables covering command reference updates, schema introspection guide, validation error guide, user migration guide, and quick start updates

3. **Developer Documentation:** 6 deliverables covering architecture overview, code generation guide, validation pipeline guide, testing guide, schema workflow guide, and contributing guide updates

4. **System Documentation:** 4 deliverables covering data model reference, schema system guide, build system reference, and performance characteristics

5. **Operations Documentation:** 3 deliverables covering deployment guide, troubleshooting guide, and CI/CD integration guide

**Total:** 24 documentation deliverables to be delivered across 6 implementation phases.

The documentation plan ensures that developers, users, and operators all have the resources they need to successfully work with the schema-driven CLI architecture.

---

**Document Status:** Planning
**Next Steps:** Review with stakeholders, prioritize deliverables, assign owners
**Approval Required:** Project lead, technical architect, user representative
