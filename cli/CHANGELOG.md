# CLI Changelog

All notable changes to the Documentation Robotics CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Enhanced Delete Command

- **Cascade deletion** - `--cascade` flag removes dependent elements automatically to prevent orphaned references
- **Dry-run mode** - `--dry-run` flag previews what would be deleted without actually deleting
- **Dependency display** - Shows all elements that depend on the target element before deletion
- **Transitive dependency tracking** - Identifies both direct and transitive dependents
- **Safe deletion workflow** - Prevents deletion of elements with dependents unless explicitly cascaded

#### Relationship Catalog Command (Modern Link Registry Replacement)

- **`catalog types`** - List all relationship types from the catalog with filtering by category or layer
- **`catalog info`** - Display catalog metadata (version, total types, categories)
- **`catalog search`** - Search relationship types by keyword across ID, predicate, and description
- **`catalog validate`** - Validate model relationships against the catalog with strict mode support
- **`catalog docs`** - Generate comprehensive markdown or JSON documentation
- **Modern architecture** - Uses `relationship-catalog.json` v2.1.0 instead of deprecated `link-registry.json`
- **34 relationship types** - Covers structural, behavioral, dependency, flow, and other semantic relationships
- **ArchiMate alignment** - Maps relationships to ArchiMate 3.2 concepts where applicable
- **Multiple output formats** - Table, JSON, and Markdown for different use cases

#### Core Relationship Catalog System

- **RelationshipCatalog class** - Manages semantic relationship type definitions
- **Predicate validation** - Ensures relationships use valid predicates from the catalog
- **Layer-specific filtering** - Get relationship types applicable to specific layers
- **Category-based organization** - Group relationships by semantic category
- **Rich metadata** - Includes directionality, transitivity, symmetry for each relationship type

#### Improved Safety Features

- **Dependency checking** - Automatically detects and warns about dependent elements
- **Preview capability** - Combine `--cascade --dry-run` to see all elements that would be removed
- **Enhanced error messages** - Clear guidance on using `--cascade` or `--force` flags
- **Relationship validation** - Validates predicates and layer applicability

### Changed

- **`--force` flag behavior** - Now also skips dependency checks in addition to confirmation prompts
- **Delete command output** - More detailed information about dependencies and elements to be removed

#### Migration Tools & Documentation

- **Comprehensive migration guide** - Complete guide for migrating from Python CLI to TypeScript CLI (`docs/MIGRATION_FROM_PYTHON_CLI.md`)
- **Annotation export utility** - Tool to export Python CLI annotations to JSON/Markdown (`cli/src/utils/export-python-annotations.ts`)
- **Deprecation notice** - Formal deprecation announcement with timeline and FAQ (`docs/PYTHON_CLI_DEPRECATION.md`)
- **CI/CD migration examples** - GitHub Actions, GitLab CI, Jenkins, Docker examples
- **Command mapping table** - Complete mapping of all Python CLI commands to TypeScript CLI equivalents
- **Troubleshooting guide** - Common migration issues and solutions

### Deprecated

- **Python CLI (entire codebase)** - Deprecated as of January 2026
  - Final release: v0.8.0 (planned)
  - Removal: After 1-month transition period
  - Migration: See `docs/MIGRATION_FROM_PYTHON_CLI.md`
  - Reason: Uses deprecated link-registry.json, slower performance, divided development effort

- **Python CLI's `links` command** - Replaced by modern `catalog` command in TypeScript CLI
  - Old system used deprecated `link-registry.json` (removed in spec v0.8.0)
  - New system uses `relationship-catalog.json` v2.1.0+
  - Migration: Use `dr catalog types` instead of `dr links types`

## [0.1.0] - 2026-01-11

### 🎉 Initial Release

First stable release of the Documentation Robotics CLI - a TypeScript/Bun implementation providing fast, production-ready architecture modeling.

**Specification Support:** v0.7.1

### Added

#### Core Model Management

- **Initialize models** - Create new DR models with `dr init`
- **Element operations** - Add, update, delete, and show elements across all 12 layers
- **List and search** - Query elements by layer, type, or search term
- **Model info** - Display model metadata and statistics

#### Validation Pipeline

- **4-stage validation** - Schema, naming, reference, and semantic validation
- **Schema validation** - JSON Schema compliance (AJV)
- **Naming validation** - Element ID format enforcement (`{layer}.{type}.{kebab-case-name}`)
- **Reference validation** - Cross-layer reference integrity (higher → lower only)
- **Semantic validation** - Business rule validation
- **Validation commands** - `dr validate`, `dr validate-layer`, `dr validate-element`

#### Cross-Layer Integration

- **Reference registry** - Tracks 60+ cross-layer reference patterns
- **Relationship registry** - Manages intra-layer relationships with predicates
- **Dependency tracing** - `dr trace` for impact analysis
- **Projection** - `dr project` to project dependencies between layers
- **Link management** - Discover, validate, and document inter-layer links

#### Model Evolution

- **Changesets** - Track, apply, and revert model changes
- **Migration system** - Automated migration between specification versions
- **Upgrade command** - Unified `dr upgrade` for spec reference and model migration
- **Conformance checking** - `dr conformance` validates model completeness

#### Export Formats

- **ArchiMate** - Export layers 1, 2, 4, 5 (motivation, business, application, technology)
- **OpenAPI** - Export layer 6 (API) to OpenAPI 3.0 specs
- **JSON Schema** - Export layer 7 (Data Model) to JSON Schema
- **PlantUML** - Visual diagrams for all layers
- **Markdown** - Documentation export for all layers
- **GraphML** - Graph analysis format for all layers

#### Visualization Server

- **Interactive web interface** - `dr visualize` launches server at http://localhost:8080
- **WebSocket support** - Real-time model updates
- **Element annotations** - Add comments and notes to elements
- **Changeset tracking** - View and manage changesets
- **File watching** - Auto-reload on model changes
- **Authentication** - Token-based auth (enabled by default)

#### AI Integration

- **Claude Code client** - Chat about your model with Claude
- **GitHub Copilot client** - Chat about your model with Copilot
- **Multi-client support** - Auto-detect available AI CLI tools
- **Context provider** - Provides model context to AI conversations
- **Agent abstraction** - Unified interface for AI interactions
- **Preference storage** - Remembers your preferred AI client

#### Source Code Linking

- **Source references** - Link architecture elements to source code locations
- **Provenance tracking** - Track how references were created (extracted, manual, inferred, generated)
- **Repository context** - Optional Git remote URL and commit SHA
- **Symbol references** - Link to specific functions, classes, or variables
- **Search by source** - Find elements by source file path

#### Developer Experience

- **Fast startup** - ~150ms CLI startup time (8x faster than Python CLI)
- **Comprehensive help** - Detailed help for every command
- **Error messages** - Clear, actionable error messages with fix suggestions
- **Verbose and debug modes** - `--verbose` and `--debug` flags for troubleshooting
- **JSON output** - `--json` flag for machine-readable output

#### Testing & Compatibility

- **713 passing tests** - Comprehensive unit and integration test coverage
- **Python CLI compatibility** - Load and work with Python CLI models
- **Test fixtures** - Valid and invalid test cases for all validators
- **CI/CD ready** - GitHub Actions workflows included

### Standards Support

- **ArchiMate 3.2** - Layers 1, 2, 4, 5 (motivation, business, application, technology)
- **OpenAPI 3.0** - Layer 6 (API)
- **JSON Schema Draft 7** - Layer 7 (data model) and all schemas
- **OpenTelemetry** - Layer 11 (APM/observability)
- **SQL DDL** - Layer 8 (datastore)

### The 12 Layers

1. **Motivation** - Goals, requirements, stakeholders
2. **Business** - Business processes and services
3. **Security** - Authentication, authorization, threats
4. **Application** - Application services and components
5. **Technology** - Infrastructure and platforms
6. **API** - REST APIs and operations
7. **Data Model** - Entities and relationships
8. **Data Store** - Database schemas
9. **UX** - User interface components (3-tier architecture)
10. **Navigation** - Application routing
11. **APM** - Observability and monitoring
12. **Testing** - Test strategies and cases

### Performance

- **Startup time** - ~150ms (vs ~1.2s for Python CLI)
- **Build time** - Fast TypeScript + esbuild bundling
- **Test execution** - 713 tests in ~137 seconds
- **Package size** - 482.2 KB

### Requirements

- **Node.js 18+** - Required for running the CLI
- **Bun 1.3+** - Optional, used for development and testing

### Installation

```bash
npm install -g @documentation-robotics/cli
dr --version
```

### Documentation

- **README.md** - Installation and usage guide
- **NPM_PUBLISHING_SETUP.md** - npm publishing instructions
- **CONTRIBUTING.md** - Development guide
- **Specification** - Complete 12-layer specification in `../spec/`

### Known Issues

- **Build warnings** - Four non-critical warnings about require/esm conversion in test instrumentation
- **File watching** - May not work in some environments (Bun.watch not available)

### Notes

- This is the first public npm release
- Python CLI compatibility maintained for migration path
- Future releases will be published via GitHub Actions with provenance attestation

---

## Release Information

**Git Tag:** `cli-v0.1.0`
**npm Package:** `@documentation-robotics/cli@0.1.0`
**Specification Version:** v0.7.1
**Release Date:** January 11, 2026
