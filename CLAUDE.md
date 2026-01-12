# CLAUDE.md - AI Assistant Guide

## Project Overview

**Documentation Robotics** is a toolkit for managing federated architecture data models across 12 interconnected layers.

**Components:**

1. **CLI Tool (`cli/`)** - TypeScript implementation
2. **Metadata Model Specification** - Formal documentation defining the 12-layer model

**Current Versions:** Typescript CLI v0.1.0, Spec v0.7.1

## Repository Structure

```
documentation_robotics/
├── spec/                        # SPECIFICATION
│   ├── VERSION                  # Spec version number
│   ├── layers/                  # 12 layer specifications
│   └── schemas/                 # JSON Schema definitions
│
└── cli/                         # TYPESCRIPT CLI
    ├── src/
    │   ├── commands/           # 23+ command implementations
    │   ├── core/               # Domain models & registries
    │   ├── validators/         # Validation pipeline
    │   ├── export/             # Export handlers
    │   └── schemas/            # Bundled JSON schemas
    └── tests/                  # Unit & integration tests
```

## Quick Start

```bash
cd cli && npm install && npm run build
npm run test              # Run all tests
node dist/cli.js --help   # CLI usage

# Pre-commit checks
pre-commit run --all-files
```

See `cli/README.md` for complete setup and usage documentation.

## Critical Rules

### 1. Spec vs. CLI Separation

- **Two separate version numbers**: Spec (`spec/VERSION`) and CLI (`cli/package.json`)
- **Schema synchronization**: Schema changes require updating BOTH:
  - `spec/schemas/{layer}.schema.json`
  - `cli/src/schemas/bundled/{layer}.schema.json`
- **Layer spec changes**: Must update both `spec/layers/{layer}.md` AND corresponding CLI validators/code

### 2. When to Ask First

- **ASK before proceeding:**
  - Modifying layer specifications or schemas
  - Breaking changes to CLI commands or public APIs
  - Version bumps (use `/dr-release-prep` command for releases)
  - Changes affecting backwards compatibility
- **PROCEED without asking:**
  - Bug fixes in CLI implementation
  - Internal refactoring (no API changes)
  - Adding tests or improving documentation
  - Code quality improvements (typing, linting)

### 3. Version Compatibility

- CLI version can be ahead of spec version
- CLI must remain compatible with current spec version
- Breaking spec changes require spec version bump
- Check `spec/CHANGELOG.md` and `cli/CHANGELOG.md` for version history

### 4. Element Naming Convention

- **Format**: `{layer}-{type}-{kebab-case-name}`
- **Example**: `api-endpoint-create-customer`
- Must be unique across entire model
- Use element utilities for consistency

### 5. Cross-Layer References

- **Direction**: Higher layers → lower layers only
- Always validate references exist before creating
- Use reference registry for lookups and validation

## The 12-Layer Architecture Model

Federated architecture model spanning 12 interconnected layers:

1. **Motivation** - Goals, requirements, stakeholders (ArchiMate)
2. **Business** - Business processes and services (ArchiMate)
3. **Security** - Authentication, authorization, threats
4. **Application** - Application services and components (ArchiMate)
5. **Technology** - Infrastructure and platforms (ArchiMate)
6. **API** - REST APIs and operations (OpenAPI)
7. **Data Model** - Entities and relationships (JSON Schema)
8. **Data Store** - Database schemas
9. **UX** - User interface components
10. **Navigation** - Application routing
11. **APM** - Observability and monitoring (OpenTelemetry)
12. **Testing** - Test strategies, test cases, test data

**Key Principle:** Elements in higher layers reference elements in lower layers, creating a dependency graph.

## Architecture Overview

### Core Domain (`core/`)

- **Model** - Complete architecture model across all layers
- **Layer** - Container for elements within a layer
- **Element** - Individual architecture items
- **Reference Registry** - Tracks cross-layer references
- **Relationship Registry** - Tracks intra-layer relationships

### Validation Pipeline (`validators/`)

1. **Schema Validation** - JSON schema compliance
2. **Naming Validation** - Naming convention enforcement
3. **Reference Validation** - Cross-layer reference integrity
4. **Semantic Validation** - Business rule validation

### Export System (`export/`)

- **ArchiMate** - Layers 1, 2, 4, 5
- **OpenAPI** - Layer 6 (API)
- **JSON Schema** - Layer 7 (Data Model)
- **PlantUML** - Visual diagrams
- **Markdown** - Documentation

### Data Storage

- Filesystem-based (no database)
- Models in `.dr/` directory
- Manifest: `.dr/manifest.json`
- Layers: `.dr/layers/{layer-name}.json`

## Common Pitfalls

### 1. Schema Synchronization

**CRITICAL**: Schema changes require updating BOTH spec and CLI schemas.

Layer schemas include relationship metadata:

- `layerMetadata` - layer identifier and catalog version
- `intraLayerRelationships` - relationships within the layer
- `crossLayerRelationships` - outgoing/incoming relationships to/from other layers

**Always update both:**

- `spec/schemas/{layer}.schema.json`
- `cli/src/schemas/bundled/{layer}.schema.json`

Relationship catalog (`relationship-catalog.json`) must stay in sync.

### 2. Cross-Layer References

- **Never** violate the "higher → lower" rule
- Always validate references exist before creating
- Use the reference registry, don't manually check

### 3. Element IDs

- **Must** follow `{layer}-{type}-{kebab-case}` convention
- Must be unique across entire model
- Use element utilities, don't manually construct IDs

### 4. Export Format Compatibility

- ArchiMate only supports layers 1, 2, 4, 5
- OpenAPI only supports layer 6
- JSON Schema only supports layer 7
- Check format compatibility before exporting

### 5. Version Bumps

- **Never** manually edit version numbers
- Use `/dr-release-prep` command for proper release preparation
- Maintains consistency across changelogs and versions

## Development Quick Reference

### Adding a Command

1. Create in `cli/src/commands/`
2. Register in `cli/src/cli.ts`
3. Add tests in `cli/tests/integration/`
4. Run `npm run test`

### Modifying a Layer

1. **ASK FIRST** - Layer changes affect spec
2. Update `spec/layers/{layer}.md`
3. Update `spec/schemas/{layer}.schema.json`
4. Copy schema to `cli/src/schemas/bundled/`
5. Update validators if needed
6. Update tests

### Key Files

- `cli/src/cli.ts` - CLI entry point, command routing
- `cli/src/core/model.ts` - Central model management
- `cli/src/core/reference-registry.ts` - Reference tracking
- `cli/src/core/relationship-registry.ts` - Relationship tracking
- `cli/src/validators/semantic.ts` - Business rule validation

### Testing

```bash
npm run test              # All tests
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests only
```

## Standards

- **ArchiMate 3.2** - Layers 1, 2, 4, 5
- **OpenAPI 3.0** - Layer 6
- **JSON Schema Draft 7** - Layer 7
- **OpenTelemetry** - Layer 11

## Design Philosophy

1. **Separation of Concerns** - Clear boundaries between commands, core logic, validators
2. **Standards Compliance** - Leverage industry standards (ArchiMate, OpenAPI, JSON Schema)
3. **Testability** - Comprehensive test coverage
4. **User Experience** - Clear errors, helpful output

## Documentation References

- Main README: `/README.md`
- Specification: `/spec/` (especially `spec/layers/` and `spec/CHANGELOG.md`)
- CLI README: `/cli/README.md`
- Release preparation: Use `/dr-release-prep` command
