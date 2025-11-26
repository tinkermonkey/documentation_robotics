# CLI Changelog

All notable changes to the Documentation Robotics CLI tool will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2025-01-15

### Added

- **Claude Code Integration Enhancements**: New specialized agents and comprehensive documentation
  - **DR Helper Agent** (`dr-helper`)
    - Expert guidance companion for understanding and working with DR
    - Explains DR philosophy, concepts, and architectural principles
    - Guides modeling decisions with decision trees and best practices
    - Assists with CLI navigation, upgrades, and maintenance
    - Adapts explanations to user's expertise level (beginner/intermediate/advanced)
    - Educational approach focused on teaching architectural thinking
  - **DR Ideation Agent** (`dr-ideator`)
    - Collaborative architectural exploration in changesets
    - Question-driven, research-oriented approach (Socratic method)
    - WebSearch integration for technology and pattern research
    - Context-7 integration for library/framework documentation (when available)
    - Multi-changeset awareness and management
    - Comparative analysis (model multiple approaches side-by-side)
    - Merge/abandon guidance based on validation and analysis
  - **Updated Reference Sheets**: All 3 tiers updated with new agents
    - `tier1-essentials.md` - Quick reference for helper and ideation agents
    - `tier2-developer-guide.md` - Complete agent descriptions and use cases
    - `tier3-complete-reference.md` - Comprehensive agent documentation with workflows
  - **Command Documentation**: New slash command for link management
    - `dr-links.md` - Complete `/dr-links` command guide (600+ lines)
    - Query link types, validate links, trace paths, generate documentation
    - Migration guidance for v0.1.x → v0.2.0

### Added (continued)

- **Cross-Layer Link Management System**: Complete infrastructure for managing and validating inter-layer references
  - **Link Registry** (`LinkRegistry` class):
    - Machine-readable catalog of 60+ cross-layer reference patterns
    - Loads from `/spec/schemas/link-registry.json`
    - Query by category, source layer, target layer, or field path
    - Export to JSON, Markdown table, or full documentation
    - Statistics and metadata tracking
  - **Link Analyzer** (`LinkAnalyzer` class):
    - Automatic discovery of link instances in models
    - Builds multi-graph of inter-layer connections
    - BFS path-finding between elements
    - Broken link detection
    - Orphaned element identification
    - Link statistics and reporting
  - **Link Validator** (`LinkValidator` class):
    - Validates link existence, type compatibility, cardinality, and format
    - Levenshtein distance for typo suggestions
    - Configurable severity (warning vs. error)
    - Strict mode for CI/CD pipelines
    - Detailed issue reporting with suggestions
  - **Link Documentation Generator** (`LinkDocGenerator` class):
    - Generate Markdown summaries and detailed references
    - Create interactive HTML documentation with search
    - Generate Mermaid diagrams showing layer relationships
    - Quick reference guides for common patterns
  - **CLI Commands**: Full command suite under `dr links` group
    - `types` - List available link types with filtering
    - `registry` - Display or export complete link registry
    - `stats` - Show link registry and model statistics
    - `docs` - Generate comprehensive documentation (MD, HTML, Mermaid)
    - `list` - List all link instances in model (pending)
    - `find` - Find links for specific element (pending)
    - `validate` - Validate all model links (pending)
    - `trace` - Find paths between elements (pending)
  - **Validation Integration**:
    - `dr validate --validate-links` - Enable cross-layer link validation
    - `dr validate --strict-links` - Treat link warnings as errors
    - Link validation results in both text and JSON output
    - Integrated with manifest validation status

- **Cross-Layer Reference Registry Documentation**:
  - Complete catalog in `/spec/core/06-cross-layer-reference-registry.md`
  - Shared JSON Schema definitions in `/spec/schemas/shared-references.schema.json`
  - Machine-readable registry in `/spec/schemas/link-registry.json`
  - Documentation includes naming conventions, examples, and migration guide

- **Schema Enhancements**:
  - **Navigation Layer** (`10-navigation-layer.schema.json`):
    - Added `experience` field to Route for UX layer references
    - Added `motivationAlignment.fulfillsRequirements` to Route
    - Added `motivationAlignment.enforcesRequirement` to NavigationGuard
    - Added `api.operationId` and `api.method` to NavigationGuard
    - Enhanced NavigationFlow with motivation alignment
  - **APM Layer** (`11-apm-observability-layer.schema.json`):
    - Added `dataModelSchemaId` to distinguish JSON Schema $id from file path
    - Clarified distinction between schema reference and schema identifier

- **Comprehensive Testing**: 100+ tests for link management functionality
  - `test_link_registry.py` - 24 tests for LinkRegistry class
  - `test_link_analyzer.py` - 22 tests for LinkAnalyzer class
  - `test_link_validator.py` - 27 tests for LinkValidator class
  - Tests cover valid/invalid links, type checking, path finding, validation

- **Documentation**:
  - Comprehensive [Link Management Guide](./docs/user-guide/link-management.md)
  - Command reference with examples
  - Best practices and troubleshooting
  - CI/CD integration examples

### Changed

- **dr validate command** now supports optional link validation:
  - Use `--validate-links` to enable cross-layer link checking
  - Use `--strict-links` to treat link warnings as errors
  - Link validation results displayed separately from schema validation
  - Exit code reflects both schema and link validation status

### Migration Tools

- **Link Migrator** (`LinkMigrator` class):
  - Scans models for non-standard reference patterns
  - Detects naming convention issues (camelCase → kebab-case)
  - Identifies cardinality mismatches
  - Can apply migrations automatically with confirmation
- **CLI Commands**: `dr migrate` group
  - `check-version` - Check model specification version
  - `links --check` - Analyze what needs migration
  - `links --dry-run` - Preview changes without applying
  - `links --apply` - Apply migrations to model files
- Prepares models for v0.2.0 specification standards

### Implementation Details

- Four reference pattern types supported:
  1. X-extensions (e.g., `x-business-service-ref`)
  2. Dot-notation properties (e.g., `motivation.supports-goals`)
  3. Nested objects (e.g., `motivationAlignment.supportsGoals`)
  4. Direct field names (e.g., `operationId`, `$ref`)
- Link validation checks:
  - **Existence**: Target elements exist in the model
  - **Type Compatibility**: Targets are correct element type
  - **Cardinality**: Single vs. array values match definition
  - **Format**: UUID, path, duration formats are valid
- Documentation generator creates:
  - Markdown summary tables by category
  - Detailed reference with all metadata
  - Interactive HTML with search and filtering
  - Mermaid diagrams showing layer relationships
  - Quick reference for common patterns

### Version Strategy

- **Specification v0.1.1** (current): Initial specification with organic link patterns
- **Specification v0.2.0** (next): Backward-compatible addition with standardized link patterns and optional strict enforcement
- **CLI v0.4.0** (this release): Tools to help migrate models from v0.1.x to v0.2.0 standards

## [0.3.3] - 2024-11-26

### Breaking Changes

- **Dropped Python 3.9 support** - Minimum required Python version is now 3.10
  - Python 3.10+ is required for modern type hint syntax (`type | None`)
  - CI/CD pipeline now tests against Python 3.10, 3.11, 3.12, and 3.13
  - Resolves type errors in Python 3.9 related to union type operators

### Added

- **Changeset Management System**: Complete isolated workspace functionality for safe architecture experimentation
  - **Core Implementation**:
    - `Changeset` class for tracking changes (add/update/delete operations)
    - `ChangesetManager` class for lifecycle management
    - `ChangesetModel` class extending Model with transparent change tracking
    - `Model.load()` factory method supporting changeset context
  - **CLI Commands**: Full command suite under `dr changeset` group
    - `create` - Create new changesets with types (feature/bugfix/exploration)
    - `list` - List all changesets with filtering by status
    - `status` - Show detailed changeset information and changes
    - `switch` - Switch between changesets or return to main model
    - `apply` - Apply changeset changes to main model with preview
    - `abandon` - Mark changesets as abandoned
    - `clear` - Deactivate current changeset
    - `delete` - Permanently delete changesets
    - `diff` - Compare changesets or with main model
  - **Python API**:
    - `ChangesetManager` for programmatic changeset operations
    - `Model.load(root_path, changeset=changeset_id)` for context loading
    - Change tracking classes: `Change`, `ChangesetMetadata`
    - Diff and conflict detection capabilities
  - **Automatic Integration**:
    - All modeling commands (`add`, `update`, `remove`) work transparently in changeset context
    - Changes tracked automatically with before/after snapshots
    - Active changeset indicator in command output
  - **File Structure**:
    - `.dr/changesets/` directory for changeset storage
    - `registry.yaml` for changeset metadata tracking
    - Individual changeset directories with metadata and change logs

- **Comprehensive Testing**: 75 tests for changeset functionality with excellent coverage
  - `test_changeset.py` - 15 tests for core changeset classes (97% coverage)
  - `test_changeset_manager.py` - 18 tests for manager operations (94% coverage)
  - `test_changeset_model.py` - 16 tests for model integration (90% coverage)
  - `test_changeset_commands.py` - 26 tests for CLI commands (68% coverage)
  - All 75 tests passing with comprehensive edge case coverage

- **Claude Code Integration Documentation**:
  - **Reference Sheets** (all 3 tiers updated):
    - `tier1-essentials.md` - Basic changeset commands (create, status, apply)
    - `tier2-developer-guide.md` - Complete "Working with Changesets" section
      - When to use changesets guidance
      - Basic and advanced workflows
      - Python API examples
      - Best practices for lifecycle management
    - `tier3-complete-reference.md` - Extensive changeset documentation
      - Core concepts and lifecycle
      - Complete command reference
      - Python API documentation
      - Four detailed use case examples
      - File structure and format specifications
      - Troubleshooting guide
      - Integration with version control
  - **Command Documentation**:
    - `dr-changeset.md` - Complete slash command guide for Claude Code
      - Critical decision points: when to create, check, switch, apply
      - Detailed workflow for each operation
      - Safety protocols for applying changesets
      - Error handling and recovery guidance
      - Integration with other DR commands
      - Quick reference section
  - **Agent Integration**:
    - Updated `dr-documenter.md` - Changeset-aware documentation generation
    - Updated `dr-extractor.md` - **Mandatory changeset usage** for extractions
    - Updated `dr-validator.md` - Changeset-aware validation and fixing
    - Each agent includes specific guidance on when and how to use changesets

### Changed

- **Model Loading**: Enhanced `Model.load()` to support optional changeset context
- **Command Integration**: All modeling commands now detect and work with active changesets
- **Validation**: Validation now runs against changeset state when active

### Technical Details

- **Architecture**: Lightweight change tracking (not copy-on-write)
  - Changes tracked as operations with metadata
  - Virtual application of changes on top of main model
  - Efficient storage and fast changeset switching
- **Isolation**: Full branch-like isolation for safe experimentation
  - Changes invisible to main model until applied
  - Multiple changesets can exist in parallel
  - Atomic apply/abandon operations
- **Persistence**: File-based storage in `.dr/changesets/`
  - YAML format for metadata and changes
  - Persistent across sessions
  - Git-friendly structure
- **Change Tracking**:
  - Add operations: Store complete element data
  - Update operations: Store before/after snapshots
  - Delete operations: Store element backup
  - Timestamp and metadata for all changes

## [0.3.2] - 2024-11-25

### Added

- **Validation System**: Comprehensive schema-driven entity type validation
  - `EntityTypeRegistry` class for extracting and validating entity types from JSON schemas
  - Entity type validation in `add` command (rejects invalid types before creation)
  - Entity type validation in interactive wizard (shows only valid types per layer)
  - Helpful error messages showing valid entity types when validation fails
  - Support for all 11 layers with 101 entity types validated
- **New API Methods**:
  - `Layer.list_elements()` - Get list of all elements in a layer
  - `Model.list_layers()` - Get list of all layer names in the model
- **Documentation**:
  - `VALIDATION_SYSTEM.md` - Comprehensive validation system architecture documentation
  - `cli/docs/validation-loop.md` - Detailed validation loop documentation
- **Testing**:
  - `test_entity_type_registry.py` - 16 unit tests for EntityTypeRegistry (92% coverage)
  - `test_add_validation.py` - Integration tests for add command validation
  - `test_layer.py` - Unit tests for Layer class new methods
  - `test_model.py` - Unit tests for Model class new methods
  - `cli/tests/validation/` - Validation system test suite

### Changed

- **Claude Code Integration**: Updated reference sheets with improved validation guidance
  - Enhanced tier1-essentials.md with entity type validation examples
  - Enhanced tier2-developer-guide.md with validation system details
  - Enhanced tier3-complete-reference.md with complete validation reference

### Fixed

- **Claude Code Integration**: Updated all integration documentation to use correct file structure
  - Fixed file path references to use `./documentation-robotics/model/` for user models
  - Fixed file path references to use `./documentation-robotics/specs/` for exported specs
  - Fixed file path references to use `./.dr/` for tool configuration and schemas
  - Updated all command documentation (dr-init, dr-ingest, dr-validate, dr-project)
  - Updated reference sheets (tier1-essentials, tier2-developer-guide)
  - Updated agent documentation (dr-extractor, dr-validator, dr-documenter)
  - Updated workflow examples with correct paths
- Updated specification version from v0.1.0 to v0.1.1
- Updated README.md to have fully qualified urls for all docs links to function on pypi.org

## [0.3.1] - 2024-11-24

### Fixed

- Updated README.md to more accurately reflect the vision
- Normalized the name for the spec (Documentation Robotics) used throughout
- Cleaned up documentation links and references in prep for making repo public

## [0.3.0] - 2024-11-24

### Added

#### Core Features

**Model Management**

- Model initialization with automatic 11-layer structure creation
- Element management commands: `add`, `update`, `remove`, `find`, `list`, `search`
- Schema validation for all 11 layers using bundled JSON schemas
- Automatic schema copying to `.dr/schemas/` directory during initialization
- Manifest tracking with project metadata and statistics
- Rich terminal output with progress indicators and formatted displays
- Support for custom element properties and relationships

**Validation & Integrity**

- Cross-layer reference tracking and validation
- Element projection engine with template-based transformations
- Dependency tracking with bidirectional relationship support
- Semantic validation rules (11 built-in rules):
  - Business service realization checking
  - API operation application service references
  - UX screen API operation linkage
  - Security resource application element mapping
  - Data model schema implementation validation
  - Technology node component hosting
  - UX screen navigation route validation
  - APM observability for critical services
  - Goal stakeholder assignment
  - Application component deployment mapping
  - Database table primary key requirements
- Circular dependency detection
- Traceability validation (upward tracing to goals)
- Consistency validation across layers
- Security integration validation

**Export Capabilities**

- ArchiMate 3.2 XML export with full element and relationship mapping
- OpenAPI 3.0 specification generation from API layer
- JSON Schema Draft 7 export from data model layer
- PlantUML diagram generation (component, class, deployment, sequence)
- Markdown documentation generation with auto-generated diagrams
- GraphML export for visualization in graph tools
- Navigation route code generation (React Router, voice intents, chat handlers)
- Customizable export options (validation, output paths, formats)

**Claude Code Integration** 🎉

- Natural language model creation and management
- Automatic model extraction from existing codebases (Python, TypeScript, Java, Go)
- Intelligent validation with auto-fix capabilities
- Documentation generation automation
- Custom slash commands: `/dr-model`, `/dr-ingest`, `/dr-validate`, `/dr-document`
- Specialized autonomous agents:
  - Model extractor agent for codebase analysis
  - Validator agent with auto-repair
  - Documenter agent for comprehensive documentation
  - General-purpose agent for complex workflows
- Reference sheet generation for quick command access
- Organization-specific customization support
- Installation and setup automation

#### Testing Infrastructure

- Comprehensive test suite with 180+ tests:
  - Unit tests for all core components
  - Integration tests for full workflows
  - Conformance tests for specification compliance
- Test coverage reporting (47% coverage, growing)
- Pre-commit hooks matching CI pipeline:
  - All tests run locally before commit
  - Black code formatting (auto-fix)
  - Ruff linting with auto-fixes
  - Mypy type checking (informational)
  - Markdown formatting and linting
- Continuous Integration via GitHub Actions:
  - Tests on Python 3.9, 3.10, 3.11, 3.12
  - Code coverage reporting to Codecov
  - Conformance validation
  - Multi-platform support (ubuntu-latest)

#### Developer Experience

- Rich CLI help system with command documentation
- Comprehensive error messages with actionable guidance
- Progress indicators for long-running operations
- Color-coded output for success/warning/error states
- Validation reports with detailed issue descriptions
- Export summaries showing what was generated

### Changed

- Improved projection engine to handle both dict and object-based property mappings
- Enhanced validation framework with better error messages
- Updated pre-commit configuration to run full test suite (matches CI)
- Streamlined test runner with `CwdCliRunner` for better directory context handling
- Refined semantic validation rules for better coverage

### Fixed

- **Projection Engine**: Fixed dict-based property mapping variable order (target_key, source_spec)
- **Projection Engine**: Added "in" operator for list membership conditions
- **Projection Engine**: Fixed element attribute access (id, layer, type, name) in property mappings
- **Validation**: Fixed `ValidationResult.add_warning()` API - layer as positional argument
- **Testing**: Fixed 180 tests that were failing due to API mismatches
- **Testing**: Corrected command interface in integration tests (removed `--root`, added `cwd` support)
- **Testing**: Fixed `Layer.list_elements()` → `Layer.elements.values()` API usage
- **Testing**: Fixed export command syntax (`--format` option vs positional argument)
- **Linting**: Resolved E501 (line too long) conflicts between Black and Ruff by ignoring E501 in Ruff (Black is authoritative for line length)
- **Pre-commit**: Fixed hook execution order and dependencies

### Testing Statistics

- **Total Tests**: 180 passing, 2 skipped, 0 failing ✅
- **Test Categories**:
  - Unit Tests: 155 (projection engine, validators, exporters, core)
  - Integration Tests: 14 (full workflows, exports, commands)
  - Conformance Tests: 11 (specification compliance)
- **Code Coverage**: 47% (growing with each release)
- **CI/CD**: All tests run on 4 Python versions (3.9-3.12)

### Documentation

- [Getting Started Guide](docs/user-guide/getting-started.md) - Complete quickstart
- [Validation Guide](docs/user-guide/validation.md) - Comprehensive validation documentation
- [Claude Code Integration Guide](docs/user-guide/claude-code-integration.md) - AI-powered workflows
- [Pre-Commit Setup Guide](docs/PRE_COMMIT_SETUP.md) - Local testing configuration
- [Formatter & Linter Guide](docs/FORMATTER_LINTER_GUIDE.md) - Tool explanation and usage
- Design documents for all 5 implementation phases
- Development plans with acceptance criteria

### Performance

- Fast initialization (<1 second for new models)
- Efficient validation (processes hundreds of elements in seconds)
- Incremental validation only checks changed elements
- Optimized export with parallel processing for multiple formats
- In-memory caching for frequently accessed schemas and elements

### Standards & Specifications

**Implements:** Documentation Robotics Specification v0.1.0

**Standards Integrated:**

- ArchiMate 3.2 (Motivation, Business, Application, Technology layers)
- OpenAPI 3.0 (API layer)
- JSON Schema Draft 7 (Data Model layer)
- SQL DDL conventions (Datastore layer)
- OpenTelemetry 1.0+ (APM/Observability layer)
- W3C Trace Context (APM/Observability layer)

**Conformance Level:** Full (All 11 layers)

### Technical Details

- **Python Version**: 3.9+ (tested on 3.9, 3.10, 3.11, 3.12)
- **Dependencies**: 15 core dependencies (Click, PyYAML, jsonschema, Pydantic, Rich, etc.)
- **Architecture**: Modular design with clear separation of concerns
- **Code Quality**: Black formatting, Ruff linting, Mypy type hints
- **Testing**: pytest with coverage reporting
- **CLI Framework**: Click 8.1+ for robust command-line interface

### Known Limitations

- Type hints coverage incomplete (~40% - being added incrementally)
- Some validators still in development (naming, consistency)
- Code generation features planned for future releases
- Interactive REPL mode not yet implemented
- Diff/merge functionality planned for future releases

### Migration Notes

This is the first stable release (0.3.0). For users of earlier development versions:

1. **Schema Location Changed**: Schemas now automatically copy to `.dr/schemas/` during init
2. **Command Interface**: `--root` option removed - commands use current directory by default
3. **Validation API**: `add_warning()` and related methods have updated signatures
4. **Test Infrastructure**: Pre-commit hooks now run full test suite

### Upgrade Path

```bash
# Install or upgrade to 0.3.0
cd cli
pip install -e ".[dev]"

# Verify installation
dr --version  # Should show 0.3.0

# Run conformance check
dr conformance

# Update pre-commit hooks
pre-commit install
pre-commit run --all-files
```

---

## Version Numbering

The CLI uses [Semantic Versioning 2.0.0](https://semver.org/):

- **MAJOR** version for breaking changes to command interfaces or data formats
- **MINOR** version for new features, commands, or backward-compatible additions
- **PATCH** version for bug fixes, documentation, and non-breaking improvements

Examples:

- `2.0.0` - Breaking change (e.g., remove command, change data format)
- `1.1.0` - New feature (e.g., add export format, new validation rule)
- `1.0.1` - Bug fix (e.g., fix validation error, correct export output)

---

## Release Notes Links

- [0.3.3 Release Notes](https://github.com/tinkermonkey/documentation_robotics/releases/tag/cli-v0.3.3)
- [0.3.2 Release Notes](https://github.com/tinkermonkey/documentation_robotics/releases/tag/cli-v0.3.2)
- [0.3.1 Release Notes](https://github.com/tinkermonkey/documentation_robotics/releases/tag/cli-v0.3.1)
- [0.3.0 Release Notes](https://github.com/tinkermonkey/documentation_robotics/releases/tag/cli-v0.3.0)
- [All CLI Releases](https://github.com/tinkermonkey/documentation_robotics/releases?q=cli)

[0.3.3]: https://github.com/tinkermonkey/documentation_robotics/releases/tag/cli-v0.3.3
[0.3.2]: https://github.com/tinkermonkey/documentation_robotics/releases/tag/cli-v0.3.2
[0.3.1]: https://github.com/tinkermonkey/documentation_robotics/releases/tag/cli-v0.3.1
[0.3.0]: https://github.com/tinkermonkey/documentation_robotics/releases/tag/cli-v0.3.0
