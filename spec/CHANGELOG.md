# Specification Changelog

All notable changes to the Documentation Robotics specification will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this specification adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-01-15

### Added

- **Cross-Layer Reference Registry** ([spec/core/06-cross-layer-reference-registry.md](core/06-cross-layer-reference-registry.md))
  - Complete catalog of 60+ cross-layer reference patterns
  - 4 reference pattern types: x-extensions, dot-notation, nested objects, direct fields
  - 9 categories: motivation, business, security, application, api, data, ux, navigation, apm
  - Comprehensive naming conventions and validation rules
  - Migration guide from organic patterns to standardized patterns

- **Machine-Readable Registry** ([spec/schemas/link-registry.json](schemas/link-registry.json))
  - 520-line JSON catalog of all valid link types
  - Queryable by category, source layer, target layer, field path
  - Enables automated validation and tooling
  - Each link type includes: ID, name, category, layers, field paths, cardinality, format, validation rules

- **Shared References Schema** ([spec/schemas/shared-references.schema.json](schemas/shared-references.schema.json))
  - Centralized definitions for common reference patterns
  - Reusable across all layer schemas
  - Consistent validation rules for cross-layer references

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
dr validate --validate-links
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
