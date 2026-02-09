# Specification Changelog

All notable changes to the Documentation Robotics specification will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this specification adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **BREAKING: Schema Validation Architecture Simplified**:
  - Model elements now validate against per-type spec node schemas instead of layer-specific schemas
  - Removed 24 layer-specific schemas (12 from spec/, 12 from CLI bundled/)
  - Removed generation script (conversion to schema-based architecture complete)
  - Spec node schemas are now the single source of truth (hand-maintained)
  - Schema validator refactored to validate each element individually with better error messages
  - Manifest no longer includes schema path references

- **Spec Relationships Converted to JSON Schemas**:
  - All 252 relationship files converted from data instances (`.relationship.json`) to JSON Schemas (`.relationship.schema.json`)
  - Each schema extends `spec-node-relationship.schema.json` via `allOf`
  - Uses `const` constraints for all identifying fields (id, source_spec_node_id, predicate, etc.)
  - Follows same pattern as spec nodes from issue #316
  - Hand-maintained (no generation needed)
  - Old `.relationship.json` files backed up and removed

### Removed

- **Layer-Specific Schemas**: Removed redundant `{NN}-{layer}-layer.schema.json` files
- **Generation Script**: Removed `cli/scripts/generate-spec-instances.ts` (one-time conversion complete)

### Added

- **Spec Node Schema Bundling**: CLI now bundles 354 spec node schemas for runtime validation

## [0.8.0] - 2026-02-06

### Breaking Changes

- **Layer 8 Canonical Naming**: Layer 8 renamed from `datastore` to `data-store` throughout specification
  - Specification files renamed: `08-datastore-layer.md` → `08-data-store-layer.md`
  - Schema files renamed: `08-datastore-layer.schema.json` → `08-data-store-layer.schema.json`
  - All element IDs must use `data-store.` prefix (e.g., `data-store.table.users`)
  - Manifests must use `data-store:` as the layer key
  - Layer directories must be named `08_data-store/`
  - All cross-layer references updated to use `08-data-store` identifier
  - Users with existing projects must manually migrate their models

### Added

- **Changeset Storage Migration**:
  - Changesets migrated from legacy `.dr/changesets/` format to new `documentation-robotics/changesets/` structure
  - Auto-migration triggers on first CLI invocation after upgrade
  - Status mapping: `draft` → `staged`, `applied` → `committed`
  - Preserves changeset IDs, timestamps, and change arrays
  - Base snapshot capture for drift detection

- **Staging Feature Schema**:
  - `StagedChangeset` schema with changeset metadata (id, name, description, created, modified, status)
  - `StagedChange` schema with operation type (add, update, delete), element ID, layer name, sequence number
  - Base snapshot format for drift detection across model snapshots
  - Status enum: `staged`, `committed`, `discarded`

### Changed

- **Changeset Format Evolution**:
  - Old format: Single `{name}.json` file in `.dr/changesets/`
  - New format: Structured directory per changeset: `documentation-robotics/changesets/{id}/metadata.yaml + changes.yaml`
  - Maintains full backward compatibility during migration period

## [0.7.1] - 2026-01-07

### Added

- **Source Code Reference Infrastructure Formalization**:
  - Documented `spec/schemas/common/` as canonical location for cross-layer schemas
  - Formalized source reference integration across 10 layers (03, 04, 05, 06, 07, 08, 09, 10, 11, 12)
  - Common schema definitions:
    - `source-references.schema.json` - Defines ProvenanceType, SourceLocation, RepositoryContext, SourceReference
    - `layer-extensions.schema.json` - Layer metadata and relationship catalog structures
    - `relationships.schema.json` - Relationship type definitions
    - `predicates.schema.json` - Predicate definitions for relationship semantics

- **Source Reference Layer Integration**:
  - **ArchiMate Layers** (04-application, 05-technology, 09-ux, 10-navigation, 11-apm, 12-testing): Use nested `properties.source.reference` pattern for compatibility with architecture description format
  - **Custom Security Layer** (03-security): Uses nested `properties.source.reference` pattern consistent with ArchiMate-style layers
  - **OpenAPI Layers** (06-api, 07-data-model, 08-datastore): Use `x-source-reference` extension pattern for compatibility with OpenAPI tooling
  - All 10 layers reference common schema definitions via `$ref: "common/source-references.schema.json#/definitions/SourceReference"`

- **Source Reference Schema Definition**:
  - **ProvenanceType**: Four-value enum tracking how references were created
    - `extracted` - Automated tooling ingestion
    - `manual` - Human entry
    - `inferred` - Pattern matching analysis
    - `generated` - Code generated from model
  - **SourceLocation**: File path and optional symbol for precise code location
  - **RepositoryContext**: Optional Git remote URL and 40-character commit SHA
  - **SourceReference**: Complete reference linking elements to one or more source code locations

- **Layer 03-Security Source Reference Support**:
  - **10 entity types** with source reference integration:
    - AuthenticationConfig - Auth provider implementations (JWT validation, session handlers)
    - SecurityPolicy - Policy-as-code implementations (OPA, RBAC middleware)
    - PolicyRule - Authorization logic functions
    - PolicyAction - Security action handlers (MFA, rate limiting)
    - RateLimit - Rate limiting middleware
    - AuditConfig - Audit logging implementations
    - Condition - ABAC condition evaluators
    - ValidationRule - Field validation code
    - Countermeasure - Security control implementations
    - Threat - Security test code, vulnerability scanners
  - Enables traceability from security policies to actual implementation code

- **Layer 05-Technology Source Reference Support**:
  - **7 entity types** with source reference integration:
    - Node - Terraform/CloudFormation/Pulumi infrastructure definitions
    - SystemSoftware - Dockerfiles, Ansible playbooks, Helm charts
    - TechnologyProcess - Automation scripts, CI/CD pipeline definitions
    - CommunicationNetwork - Network IaC (VPC definitions, networking configs)
    - Artifact - SQL migrations, configuration files
    - TechnologyInterface - API gateway configs, load balancer configs, ingress definitions
    - TechnologyService - Kubernetes manifests, Docker Compose files
  - Supports linking infrastructure elements to infrastructure-as-code definitions

### Changed

- **All Common Schemas**: Updated to reside in `spec/schemas/common/` as canonical location
- **10 Layer Schemas**: All schemas with source reference support verified and documented (03, 04, 05, 06, 07, 08, 09, 10, 11, 12)

### Backward Compatibility

- No breaking changes - source references remain optional properties
- All existing models remain valid under v0.7.1
- New source reference definitions are purely additive enhancements

## [0.7.0] - 2025-12-19

### Added

- **Layer Schema Relationship Sections**:
  - All 12 layer schemas now include `layerMetadata` section with layer ID, name, and relationship catalog version
  - `intraLayerRelationships.allowed[]` arrays define valid relationships within each layer (5-19 relationship types per layer)
  - `crossLayerRelationships.outgoing[]` arrays define relationships to other layers (0-19 relationships per layer)
  - `crossLayerRelationships.incoming[]` arrays define relationships from other layers (0-29 relationships per layer)
  - Total: 143 intra-layer relationships and 103 cross-layer relationships migrated from catalog and link registry

- **Common Schema Extensions**:
  - `common/layer-extensions.schema.json` - Definitions for layerMetadata, intraLayerRelationships, and crossLayerRelationships sections
  - Relationship catalog and common schemas now bundled with specification

- **Migration Tools**:
  - `scripts/extract-relationship-data.py` - Extracts relationship data from catalog, link registry, and markdown
  - `scripts/update-layer-schemas.py` - Programmatically updates layer schemas with relationship metadata

### Deprecated

- **link-registry.json** (deprecated in v0.7.0, will be removed in v0.8.0):
  - Cross-layer relationships now defined in layer schemas using `crossLayerRelationships` section
  - See layer schema `crossLayerRelationships` sections for migration
  - Deprecation notice added to file with migration guidance

- **link-registry.schema.json** (deprecated in v0.7.0, will be removed in v0.8.0):
  - Schema for validating link registry structure
  - Deprecated in favor of layer schema relationship sections

### Changed

- **Terminology Update**:
  - "Cross-layer links" → "cross-layer relationships" throughout specification
  - Consistent use of "relationship" terminology for semantic connections between elements
- **Layer Schemas**: All 12 layer schemas updated with comprehensive relationship metadata
- **Documentation**: Updated layer specification markdown files to reference schema-defined relationships

## [0.6.0] - 2025-12-14

### Added

- **Relationship Taxonomy** ([spec/core/07-relationship-taxonomy.md](core/07-relationship-taxonomy.md))
  - Comprehensive formalization of 6 relationship categories with 60+ distinct predicates
  - **Categories**: Structural, Behavioral, Dependency, Traceability, Governance, Domain-Specific
  - ArchiMate 3.2 alignment with software-specific extensions
  - Bidirectional navigation support (every relationship has an inverse predicate)
  - Formal semantics for transitivity, symmetry, and cardinality
  - Traceability-first design for upward-flowing requirement chains

- **Enhanced Cross-Layer Reference Registry** ([spec/core/06-cross-layer-reference-registry-enhanced.md](core/06-cross-layer-reference-registry-enhanced.md))
  - Catalog of 60+ cross-layer reference patterns across all 12 layers
  - **4 Reference Pattern Types**:
    - Pattern A: X-Extensions (OpenAPI/JSON Schema compatibility)
    - Pattern B: Dot-Notation Properties (upward references)
    - Pattern C: Nested Objects (complex relationships)
    - Pattern D: Direct Field Names (standard references)
  - Naming conventions and best practices for cross-layer integration
  - Examples for each pattern with rationale

- **Common Schema Infrastructure**:
  - `common/predicates.schema.json` (493 lines) - Predicate definitions for relationship types
  - `common/relationships.schema.json` (791 lines) - Relationship type schemas
  - `link-registry.schema.json` (339 lines) - Schema for link registry validation
  - `relationship-catalog.json` (855 lines) - Catalog of all available relationship types
  - `relationship-type.schema.json` (227 lines) - Schema for relationship type definitions

- **Layer Template** ([spec/templates/layer-template.md](templates/layer-template.md))
  - Standardized template for layer specification documents (341 lines)
  - Ensures consistency across all 12 layer specifications
  - Includes sections for: Overview, Entities, Relationships, Cross-Layer Integration, Examples

### Changed

- **All 12 Layer Specifications Enhanced with Relationship Modeling**:
  - **Motivation Layer** (+173 lines):
    - Expanded relationship sections with structural, influence, and association relationships
    - Added sub-goal and sub-requirement aggregation examples
    - Enhanced with Meaning entity relationships to Value and Outcome
  - **Business Layer** (+466 lines):
    - Comprehensive relationship catalog: composition, aggregation, assignment, triggering, flow, serving
    - Cross-layer integration patterns with all 11 other layers
    - Enhanced example models with relationship instances
  - **Security Layer** (+794 lines):
    - Major expansion of security relationship modeling
    - Enhanced threat modeling with attack patterns and vulnerabilities
    - Comprehensive permission and role assignment relationships
  - **Application Layer** (+294 lines):
    - Enhanced composition, aggregation, and serving relationships
    - Deployment and interaction relationship patterns
  - **Technology Layer** (+99 lines):
    - Infrastructure relationship modeling improvements
  - **API Layer** (+157 lines):
    - Enhanced operation and endpoint relationship patterns
  - **Data Model Layer** (+162 lines):
    - Entity relationship and schema composition enhancements
  - **Datastore Layer** (+156 lines):
    - Storage and persistence relationship patterns
  - **UX Layer** (+186 lines):
    - Component composition and library reference relationships
  - **Navigation Layer** (+171 lines):
    - Route and flow relationship enhancements
  - **APM/Observability Layer** (+209 lines):
    - Metric and tracing relationship patterns
  - **Testing Layer** (+144 lines):
    - Test coverage and traceability relationship patterns

- **All 12 Layer Schemas Regenerated with Enhanced Relationship Definitions**:
  - Motivation Layer Schema (+235 lines): Enhanced relationship properties
  - Business Layer Schema (+44 lines): Updated entity relationships
  - Security Layer Schema (767 line restructuring): Major relationship enhancements
  - Application Layer Schema (+118 lines): Deployment relationships
  - Technology Layer Schema (+228 lines): Infrastructure relationships
  - API Layer Schema (+123 lines): Operation relationships
  - Data Model Layer Schema (358 line restructuring): Entity relationships
  - Datastore Layer Schema (364 line restructuring): Storage relationships
  - UX Layer Schema (750 line restructuring): Component relationships
  - Navigation Layer Schema (+244 lines): Route relationships
  - APM Layer Schema (538 line restructuring): Metric relationships
  - Testing Layer Schema (298 line restructuring): Coverage relationships

- **Link Registry Significantly Expanded** ([spec/schemas/link-registry.json](schemas/link-registry.json))
  - +1,745 lines of relationship and link definitions
  - Comprehensive catalog of all cross-layer reference patterns
  - Enhanced with bidirectional link tracking
  - Formal validation rules for relationship integrity

### Fixed

- **Testing Layer Schema Title** - Removed duplicate "Layer" in title
  - Was: "Testing Layer Layer Schema"
  - Now: "Testing Layer Schema"

### Known Limitations

- **Wave 2 Planned Enhancements**:
  - Structural relationship examples in Business and Application layers marked as TBD (8 placeholders total)
  - Cross-layer upward reference examples marked as TBD (44 placeholders referencing Motivation layer entities)
  - These are non-blocking documentation placeholders - core relationship infrastructure and taxonomy are complete
  - Wave 2 will provide concrete examples for all relationship patterns
  - All schemas validate successfully; TBD markers do not affect model validation

### Removed

- **Conformance Documentation** (moved to separate repository):
  - `conformance/README.md` (124 lines)
  - `conformance/certification-process.md` (279 lines)
  - `conformance/test-suite.md` (296 lines)
  - Total: 699 lines removed

- **Layer Integration Guide** - Superseded by enhanced layer specifications
  - `guides/LAYER_INTEGRATION_GUIDE.md` (526 lines)
  - Content integrated into individual layer specifications

### Migration Path

Models on v0.5.0 can use spec v0.6.0 without changes:

```bash
# Update CLI to use spec v0.6.0 (requires CLI v0.7.3+)
# No model migration required - backward compatible
```

**What Changed**:

- Enhanced relationship definitions (additive only)
- New common schemas (tools can leverage for validation)
- Improved documentation (no structural changes)

**Backward Compatibility**:

- All v0.5.0 models remain valid under v0.6.0
- New relationship types are optional enhancements
- Existing validation rules preserved

**Taking Advantage of New Features**:

1. **Enhanced Relationship Modeling**: Use new predicate types from taxonomy
2. **Cross-Layer References**: Leverage documented reference patterns
3. **Common Schemas**: Validate relationships using new common schemas
4. **Link Registry**: Use expanded link catalog for relationship validation

See individual layer specifications for detailed relationship examples and usage patterns.

---

### Technical Details

**Schema Generation**: All schemas regenerated using `scripts/generate_schemas.py --all`

**Documentation**:

- Total spec size: ~50,000 lines
- Net additions: +6,296 lines
- 40 files modified

**Validation**: All layer schemas validate successfully against JSON Schema Draft 7

**Tools Support**:

- CLI v0.7.3+ required for full spec v0.6.0 support
- Enhanced relationship validation in `dr validate --strict`
- Link registry validation in `dr validate`

## [0.5.0] - 2025-12-09

### Changed

- **UX Layer - Three-Tier Architecture** ([spec/layers/09-ux-layer.md](layers/09-ux-layer.md))
  - MAJOR architectural redesign from flat, self-contained UXSpecs to three-tier component library architecture
  - **Tier 1: UXLibrary** - Reusable design system components, sub-views, and patterns
    - `LibraryComponent` - Atomic UI elements with variants, slots, and data contracts
    - `LibrarySubView` - Composed component groupings (e.g., AddressForm, ProductCard)
    - `StatePattern` - Reusable state machine templates (CRUD, Wizard, Search patterns)
    - `ActionPattern` - Reusable action configurations with confirmation support
  - **Tier 2: UXApplication** - Application-level organization and shared configuration
    - Theme/design tokens, shared layouts, global state, library imports
    - Groups UXSpecs into coherent applications with consistent styling
  - **Tier 3: UXSpec** - Simplified experience-specific configuration
    - References library components instead of inline definitions
    - Pattern binding mechanism for state machines and actions
    - ~73% reduction in YAML lines per experience (300 → 80 lines typical)
  - **Benefits**:
    - Design system alignment - Maps naturally to Figma/Storybook workflows
    - DRY principle - Define components once, reuse across applications
    - Consistency - Single source of truth for component behavior
    - Enterprise scale - Multiple applications share design libraries
    - Versioning - Library versioning enables controlled evolution

- **UX Layer Schema** ([spec/schemas/09-ux-layer.schema.json](schemas/09-ux-layer.schema.json))
  - Complete JSON Schema regenerated with new entity structure
  - 16 entity types (6 new, 3 modified, 7 supporting entities)
  - File size increased from 18KB to 20KB reflecting richer structure
  - New top-level properties: `ux-libraries`, `library-components`, `library-sub-views`, `state-patterns`, `action-patterns`, `ux-applications`

### Added

- **Component Instance Pattern** - New pattern for instantiating library components with overrides
- **Pattern Extension Binding** - Mechanism for binding concrete implementations to pattern extension points
- **Slot-based Composition** - Components and sub-views support slots for customization
- **Library Inheritance** - Libraries can extend other libraries via `extendsLibrary`
- **Migration Guide** - Comprehensive before/after examples in layer specification

### Migration Path

The new three-tier architecture is **additive** - existing flat UXSpecs remain valid:

```bash
# No migration required - both patterns supported
dr validate  # Existing UXSpecs continue to work
```

**Migration to new architecture is optional but recommended:**

1. **Extract common components to UXLibrary** - For components used 3+ times
2. **Create UXApplication** - Group related UXSpecs with shared theme/layouts
3. **Simplify UXSpecs** - Replace inline definitions with library references

See [09-ux-layer.md Migration Guide](layers/09-ux-layer.md#migration-guide) for detailed conversion examples.

**Backward Compatibility**: Both inline and reference patterns are supported. Tools validate both formats during transition period.

## [0.4.0] - 2025-12-07

### Changed

- **Architecture Refactoring - Entity Standardization**:
  - ALL entity types across all 12 layers now have explicit `id` and `name` fields
  - `id` field: UUID format, required, serves as primary key
  - `name` field: Human-readable string, required, for display
  - Affects 165 entity types across all layers
  - Standardizes entity structure for improved tooling

- **Schema Updates**:
  - All 12 layer schemas regenerated with consistent entity structure
  - Link registry expanded from ~520 to 968 lines
  - Auto-generated with `generate_schemas.py --all`

### Migration Path

Models on v0.3.0 can migrate to v0.4.0 using CLI v0.7.0+:

```bash
dr migrate --apply
```

**What Gets Migrated**:

- `id` field: UUID auto-generated deterministically (preserves existing UUIDs)
- `name` field: Derived from existing name/id/description
- Backward compatible: existing fields preserved

## [0.3.0] - 2025-11-29

### Added

- **Testing Layer** ([spec/layers/12-testing-layer.md](layers/12-testing-layer.md))
  - NEW Layer 12: Test Coverage Modeling for requirements traceability
  - Test coverage targets (workflows, forms, APIs, data models)
  - Input space partitioning for systematic test input variation modeling
  - Context variations (UI, API, event-triggered, scheduled, integration)
  - Coverage requirements (pairwise, boundary, exhaustive, risk-based criteria)
  - Test case sketches (abstract test definitions)
  - Outcome categories for expected result partitions
  - Complete traceability from requirements through coverage to test implementations
  - Integration with Motivation, Business, UX, API, Data Model, Security, and Navigation layers
  - Optional references to test implementations (Gherkin, Postman, Playwright, etc.)

- **Testing Layer Schema** ([spec/schemas/12-testing-layer.schema.json](schemas/12-testing-layer.schema.json))
  - Complete JSON Schema for testing layer validation
  - Entity types: TestCoverageModel, TestCoverageTarget, InputSpacePartition, ContextVariation, CoverageRequirement, TestCaseSketch
  - Cross-layer reference patterns for test-to-requirement traceability

### Changed

- **Conformance Levels**:
  - Full conformance now requires all 12 layers (previously 11)
  - Updated conformance documentation to reflect Testing Layer
  - All conformance tests and validation rules updated

- **Documentation**:
  - Updated all references from "11 layers" to "12 layers" throughout specification
  - Updated layer ordering documentation to include Testing Layer
  - Updated standards mapping (33% custom vs 67% established standards)

### Migration Path

Models on specification v0.2.x can migrate to v0.3.0 using the Documentation Robotics CLI:

```bash
# Check what migrations are needed
dr migrate

# Preview changes without applying
dr migrate --dry-run

# Apply migrations to latest specification
dr migrate --apply

# Re-validate with link checking
dr validate
```

**What Gets Migrated**:

- Layer 12 (Testing) schema will be added to `.dr/schemas/`
- Manifest will be updated with Testing layer configuration
- No breaking changes to existing layers

## [0.2.0] - 2025-01-15

### Added

- **Cross-Layer Reference Registry** ([spec/core/06-cross-layer-reference-registry.md](core/06-cross-layer-reference-registry.md))
  - Complete catalog of 60+ cross-layer reference patterns
  - 4 reference pattern types: x-extensions, dot-notation, nested objects, direct fields
  - 9 categories: motivation, business, security, application, api, data, ux, navigation, apm
  - Comprehensive naming conventions and validation rules
  - Migration guide from organic patterns to standardized patterns

- **Machine-Readable Registry** ([spec/schemas/link-registry.json](schemas/link-registry.json))
  - Auto-generated JSON catalog of all valid link types
  - Queryable by category, source layer, target layer, field path
  - Enables automated validation and tooling
  - Each link type includes: ID, name, category, layers, field paths, cardinality, format, validation rules
  - Generated from markdown layer specifications using `generate_schemas.py --all`

### Changed

- **Navigation Layer Schema** (`10-navigation-layer.schema.json`):
  - Added `experience` field to Route for UX layer references
  - Added `motivationAlignment.fulfillsRequirements` to Route for tracing navigation to requirements
  - Added `motivationAlignment.enforcesRequirement` to NavigationGuard for requirement enforcement
  - Added `api.operationId` and `api.method` to NavigationGuard for API operation references
  - Enhanced NavigationFlow with motivation alignment

- **APM Layer Schema** (`11-apm-observability-layer.schema.json`):
  - Added `dataModelSchemaId` field to distinguish JSON Schema `$id` from file path
  - Clarified distinction between schema reference (file path) and schema identifier (JSON Schema $id)
  - Improves accuracy when referencing data model schemas in observability context

### Migration Path

Models on specification v0.1.x can migrate to v0.2.0 using the Documentation Robotics CLI:

```bash
# Check what migrations are needed
dr migrate

# Preview changes without applying
dr migrate --dry-run

# Apply migrations to latest specification
dr migrate --apply

# Re-validate with link checking
dr validate
```

**What Gets Migrated**:

- Naming conventions: camelCase → kebab-case in relationship fields
- Cardinality: Single values → arrays where specification requires arrays
- Format: Validation of UUID, path, duration, and percentage formats

See [CLI Link Management Guide](../cli/docs/user-guide/link-management.md) for detailed migration documentation.

## [0.1.1] - 2024-12-15

### Fixed

- Updated README.md to more accurately reflect the vision
- Normalized the name for the spec (Documentation Robotics) used throughout
- Cleaned up documentation links and references in prep for making repo public

## [0.1.0] - 2024-11-23

### Added

- Initial stable release of the Federated Architecture Metadata Model specification
- Core specification documents (overview, federated approach, layering philosophy, cross-layer integration, reference directionality, validation strategy)

- Complete layer specifications for all 11 layers:
  - 01-motivation-layer.md (ArchiMate)
  - 02-business-layer.md (ArchiMate)
  - 03-security-layer.md (Custom)
  - 04-application-layer.md (ArchiMate)
  - 05-technology-layer.md (ArchiMate)
  - 06-api-layer.md (OpenAPI)
  - 07-data-model-layer.md (JSON Schema)
  - 08-datastore-layer.md (SQL DDL)
  - 09-ux-layer.md (Custom)
  - 10-navigation-layer.md (Custom)
  - 11-apm-observability-layer.md (OpenTelemetry)
- JSON Schema definitions for all layers
- Conformance requirements and test suite
- Implementation guides
- Reference materials (glossary, entity index, standards mapping)
- Governance model and contribution guidelines

### Standards Integrated

- ArchiMate 3.2 (Layers 01, 02, 04, 05)
- OpenAPI 3.0 (Layer 06)
- JSON Schema Draft 7 (Layer 07)
- OpenTelemetry 1.0+ (Layer 11)
- W3C Trace Context (Layer 11)

### Custom Specifications

- Security Model (Layer 03) - RBAC/ABAC/Policy-based access control
- UX Specification (Layer 09) - Multi-channel experience state machines
- Navigation Specification (Layer 10) - Channel-agnostic routing

### Statistics

- 11 layers
- 70+ entity types
- 430+ attributes
- 35+ enums
- 65+ cross-layer reference types
- 5 standards leveraged
- 3 custom specifications

---

## Version Numbering

The specification uses [Semantic Versioning 2.0.0](https://semver.org/):

- **MAJOR** version for breaking changes to layer definitions, entity schemas, or reference types
- **MINOR** version for new layers, entities, or backward-compatible additions
- **PATCH** version for clarifications, typo fixes, and non-normative changes

Examples:

- `2.0.0` - Breaking change (e.g., rename entity type, remove required attribute)
- `1.1.0` - New feature (e.g., add new entity type, new optional attribute)
- `1.0.1` - Clarification (e.g., fix typo, clarify documentation)

[0.1.0]: https://github.com/tinkermonkey/documentation_robotics/releases/tag/v0.1.0
