# CLI Changelog

All notable changes to the Documentation Robotics CLI tool will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.3] - 2024-12-10

### Fixed

- **Validator Bug**: Fixed `AttributeError` when using `dr validate --validate-links`
  - Added missing `to_dict()` method to `Model` class (`src/documentation_robotics/core/model.py:409`)
  - Added missing `to_dict()` method to `Layer` class (`src/documentation_robotics/core/layer.py:270`)
  - Link validation now works correctly without crashing
  - Issue was preventing proper validation of cross-layer deployment links and Assignment relationships
  - Added comprehensive test coverage with 7 new integration tests in `tests/commands/test_validate.py`

- **Import Linting Errors**: Fixed N811 linting errors in package imports
  - `src/documentation_robotics/__init__.py`: Now imports `__version__` and `__spec_version__` directly instead of aliasing constants
  - `src/documentation_robotics/viewer/__init__.py`: Now imports `__viewer_version__` directly
  - `src/documentation_robotics/versions.py`: Added `__viewer_version__` alias for consistency

### Changed

- **⚠️ BREAKING: Array Property Handling** ([GitHub Issue #41](https://github.com/tinkermonkey/documentation_robotics/issues/41))
  - `dr update-element --set` is now **additive by default** for array properties
  - **OLD BEHAVIOR**: `--set` would overwrite existing array values (causing data loss)
  - **NEW BEHAVIOR**: `--set` appends to arrays, preventing silent data loss
  - Array properties are automatically detected from:
    - Well-known properties from Documentation Robotics spec (`deployedOn`, `realizes`, `uses`, `dependsOn`, etc.)
    - Existing array values in the model
    - Schema definitions (`type: "array"`)
  - Scalar properties still use replace behavior as expected

- **Enhanced `dr update-element` Command**:
  - Added `--replace` flag: Explicitly overwrite property completely (old `--set` behavior)
  - Added `--unset` flag: Remove property entirely from element
  - Added `--remove` flag: Remove specific value from array property
  - Added rich feedback showing all current values after operations
  - Automatic duplicate prevention in arrays

### Added

- **Array Property Management**: Comprehensive array handling in `Element` class
  - New `Element._is_array_property()` method with intelligent detection
  - Enhanced `Element.update()` with mode parameter ("add", "replace", "remove")
  - New `Element.unset()` method for removing properties
  - Returns detailed results for command-level feedback
  - 25+ well-known array properties from spec automatically detected

- **Agent Guidance Documentation**: New comprehensive guide for automated agents
  - `AGENT_GUIDANCE_ARRAY_PROPERTIES.md`: Complete command reference and usage patterns
  - Migration guide from old behavior to new additive-by-default
  - Best practices for incremental model building
  - Error handling examples

- **Test Coverage**: 18 new comprehensive tests for array handling
  - `tests/unit/test_element_array_handling.py`: Full coverage of all array scenarios
  - Tests for array detection logic
  - Tests for additive update behavior (default mode)
  - Tests for replace, remove, and unset operations
  - Regression tests specifically for Issue #41 scenario
  - All tests passing with 76% coverage on element.py

### Migration Guide

For agents and users who relied on `--set` overwriting arrays:

```bash
# OLD CODE (relied on overwrite):
dr update-element ${ID} --set arrayProp=newValue

# NEW CODE (explicit overwrite):
dr update-element ${ID} --replace arrayProp=newValue

# OR (unset then set):
dr update-element ${ID} --unset arrayProp
dr update-element ${ID} --set arrayProp=newValue
```

**Benefits of this change:**

- ✅ Prevents silent data loss when building arrays incrementally
- ✅ Matches user expectations (append vs overwrite)
- ✅ Safer for automated agents
- ✅ Clear, explicit intent with `--replace` flag

See `AGENT_GUIDANCE_ARRAY_PROPERTIES.md` and `ISSUE_41_RESOLUTION.md` for complete details.

## [0.7.2] - 2024-12-09

### Changed

- **Specification Version**: Updated to v0.5.0
  - Full support for UX Layer Three-Tier Architecture
  - Backward compatible - existing flat UXSpecs remain valid
  - New architecture enables ~73% reduction in YAML per experience

- **UX Layer Schema**: Updated bundled schema with spec v0.5.0 changes
  - **FIXED**: `trigger` attribute was incorrectly parsed as boolean `true` in StateTransition and TransitionTemplate
    - Root cause: YAML reserved word `on` was being converted to boolean by YAML parser
    - Spec renamed attribute from `on` to `trigger` to fix this
    - Bundled CLI schema now has the correct `trigger` attribute
  - Added 10 new entity types for three-tier architecture:
    - **Tier 1 (Library)**: `UXLibrary`, `LibraryComponent`, `LibrarySubView`, `StatePattern`, `ActionPattern`
    - **Tier 2 (Application)**: `UXApplication`
    - **Tier 3 (Supporting)**: `LayoutConfig`, `ErrorConfig`, `ApiConfig`, `DataConfig`, `PerformanceTargets`, `ComponentReference`, `TransitionTemplate`, `StateActionTemplate`, `TableColumn`, `ChartSeries`
  - Total UX layer entity types: 26 (previously 16)

- **Entity Type Registry**: Complete entity coverage for all hard-coded layers
  - **API Layer**: Expanded from 6 to 26 entity types (full OpenAPI 3.0 coverage)
    - Added: `open-api-document`, `info`, `contact`, `license`, `server-variable`, `tag`, `external-documentation`, `paths`, `path-item`, `parameter`, `request-body`, `responses`, `response`, `callback`, `media-type`, `example`, `encoding`, `header`, `link`, `components`, `oauth-flows`, `oauth-flow`
  - **Data Model Layer**: Expanded from 4 to 17 entity types (full JSON Schema Draft 7 coverage)
    - Added: `json-schema`, `json-type`, `schema-definition`, `schema-property`, `reference`, `string-schema`, `numeric-schema`, `array-schema`, `object-schema`, `schema-composition`, `data-governance`, `data-quality-metrics`, `database-mapping`, `x-business-object-ref`, `x-data-governance`, `x-apm-data-quality-metrics`, `x-database`
  - **Testing Layer**: Expanded from 5 to 17 entity types (full ISP coverage model)
    - Added: `test-coverage-model`, `target-input-field`, `partition-value`, `partition-dependency`, `environment-factor`, `outcome-category`, `input-partition-selection`, `coverage-exclusion`, `input-selection`, `coverage-summary`, `target-coverage-summary`, `coverage-gap`
    - Renamed: `coverage-target` -> `test-coverage-target` (consistent with schema)
  - **UX Layer**: All 26 entity types now explicitly defined
    - Organized by tier (Library, Application, Experience, Supporting)
  - All entity type constants now include descriptive comments by category

### Added

- **Migration v0.4.0 -> v0.5.0**:
  - Automatic migration for spec v0.5.0 UX Layer Three-Tier Architecture
  - Migration is additive - no breaking changes to existing models
  - New UX architecture is opt-in for gradual adoption
  - Run `dr migrate` to check and `dr migrate --apply` to upgrade

- **Build Integrity Checking**: Added `--verify` flag to `prepare_build.py`
  - Detects manual modifications to bundled schemas
  - Creates `.manifest.json` with SHA256 checksums for all bundled files
  - Use `python scripts/prepare_build.py --verify` to check integrity
  - Exit code 4 indicates integrity failure

- **Release Process Documentation**: Created `RELEASING.md`
  - Documents the correct spec -> CLI release workflow
  - Explains why bundled schemas should never be manually edited
  - Provides troubleshooting for common release issues

### Changed

- **Bundled Schemas**: Now gitignored to prevent accidental manual edits
  - `cli/src/documentation_robotics/schemas/bundled/` added to `.gitignore`
  - Bundled schemas are generated at build time from spec releases
  - See `RELEASING.md` for the correct workflow

### Fixed

- **UX Layer Schema Bug**: Fixed `trigger` attribute incorrectly parsed as boolean `true`
  - StateTransition.trigger now correctly defined as TriggerType enum
  - TransitionTemplate.trigger now correctly defined as TriggerType enum
  - Affected validation of state machine transitions in UX models

### Documentation

- Updated CLI README.md with spec v0.5.0 version
- Updated integration reference sheets (Claude Code, GitHub Copilot) with new UX types
- Created `RELEASING.md` with complete release workflow documentation

### Migration Guide

```bash
# Check migration requirements
dr migrate

# Preview changes
dr migrate --dry-run

# Apply migration
dr migrate --apply

# Validate updated model
dr validate --validate-links
```

**What Gets Migrated**:

- Manifest spec version updated to 0.5.0
- No data transformations required - three-tier architecture is additive
- Existing UXSpecs continue to work without modification

**New UX Architecture (Optional)**:
See [09-ux-layer.md Migration Guide](../spec/layers/09-ux-layer.md#migration-guide) for adopting the three-tier architecture.

## [0.7.1] - 2025-12-07

### Added

- **Markdown Validation**: Created `scripts/validate_markdown.py` for validating layer specifications
  - Validates markdown layer files conform to correct format for schema generation
  - Validates link registry synchronization
  - Integrated with pre-commit hooks for automatic validation
- **Build Preparation**: Restored `scripts/prepare_build.py` for build preparation
  - Copies integration files and schemas before building CLI package
  - Updated paths for new scripts location at project root

### Changed

- **Project Structure**: Moved `scripts/` directory from `cli/scripts/` to project root
  - Scripts serve the specification (schema generation, bundle viewer) rather than CLI specifically
  - Updated path references in `generate_schemas.py` and `bundle_viewer.py`
  - Better organization with spec-related tools at root level
- **Pre-commit Configuration**: Updated hook paths for moved scripts directory

## [0.7.0] - 2025-12-07

### Added

- **Migration v0.3.0 → v0.4.0**:
  - Automatic migration for spec v0.4.0 entity standardization
  - Adds `id` (UUID) and `name` (string) fields to all entities
  - Deterministic UUID generation (preserves existing UUIDs)
  - Intelligent name derivation from existing data
  - Safe migration with validation

- **Viewer Bundling**:
  - Bundled documentation_robotics_viewer v0.1.0 into CLI
  - No external package installation required
  - Viewer included at build time
  - Eliminates "viewer not available" warnings

### Changed

- **Specification Version**: Updated to v0.4.0
- **Bundled Schemas**: Updated to spec v0.4.0
- **Visualization Server**: Loads viewer from bundled assets

### Migration Guide

```bash
# Check migration requirements
dr migrate

# Preview changes
dr migrate --dry-run

# Apply migration
dr migrate --apply

# Validate
dr validate --validate-links
```

## [0.6.5] - 2025-12-06

### Fixed

- **Visualization**: Fixed `dr visualize` command to correctly locate specification files in the `.dr` directory (resolves "Specification directory not found" error in installed projects).
- **Packaging**: Fixed `Link registry not found` error by ensuring `link-registry.json` is correctly packaged and located at runtime.
- **Claude Integration**: Fixed silent failure in `dr claude install` command.

### Added

- **Testing**: Added comprehensive test coverage for `dr claude` commands.

## [0.6.4] - 2025-12-05

### Added

- **GitHub Copilot Integration**:
  - Added new `dr copilot` command for managing GitHub Copilot integration files.
  - Supports `install`, `update`, `remove`, `status`, and `list` subcommands.
  - Installs knowledge base and agent definitions to `.github/knowledge` and `.github/agents`.
  - Includes version tracking and automatic updates similar to Claude integration.

### Changed

- **Claude Integration Improvements**:
  - Moved Claude integration files to `integrations/claude_code` for better organization.
  - Simplified `dr claude update` logic:
    - Removed `.bak` file creation (updates now overwrite directly).
    - Removed "Modified" status check (always updates if source differs).
    - Removed requirement for `--force` flag on modified files.
  - Fixed progress bar display issues in `dr claude install/update` and `dr upgrade`.

- **Migration Workflow**:
  - Integrated Claude integration update into `dr migrate` command.
  - `dr migrate` now automatically updates installed Claude integration files to the latest version.

## [0.6.3] - 2025-12-05

### Changed

- **Claude Code Integration - CLI-First Prompt Improvements**:
  - Added explicit **CLI-First Development Mandate** to dr-architect agent
  - Completely rewrote **code extraction workflow** with concrete CLI command examples
  - Added **CLI Command Quick Reference** for common operations
  - Added **Common Anti-Patterns** section highlighting top 3 validation failure causes
  - Emphasizes using `dr add`, `dr update`, `dr validate` instead of manual YAML generation
  - Reduces validation failures by catching errors at creation time (vs 5x longer to fix later)
  - Streamlined guidance to avoid context window overload (+152 lines, 12.6% increase)
  - Updated dr-architect.md from 1,209 to 1,361 lines with focused CLI-first messaging

- **GitHub Copilot Integration - Consistency Updates**:
  - Added CLI-First Development Mandate to drArchitect.ts core identity
  - Enhanced extraction workflow in workflows.ts with mandatory CLI-first rules
  - Consistent messaging about 60%+ error rate from manual YAML generation
  - Clear prohibition of manual file editing for model data

### Fixed

- **Validation Failure Rate**: Addressed root cause of 60%+ validation failures during code extraction
  - Agent now uses CLI commands with built-in validation instead of manual YAML generation
  - Errors caught at creation time rather than accumulating and taking 5x longer to fix
  - Validation integrated into workflows (validate after each batch, not at end)
  - Error recovery patterns show how to handle CLI failures and retry with corrections

### Testing

- All 679 tests pass in `test_docs_consistency.py` validating CLI examples in integration prompts
- Confirmed all CLI command examples are syntactically correct across both Claude Code and GitHub Copilot integrations

### Technical Details

**Files Modified**:

- `/cli/src/documentation_robotics/claude_integration/agents/dr-architect.md` (1,209 → 1,361 lines)
  - Added CLI-First Mandate section (32 lines)
  - Rewrote Extraction Workflow (106 lines)
  - Added CLI Command Reference (73 lines)
  - Added Anti-Patterns section (59 lines)
- `/integrations/github_copilot/src/prompts/drArchitect.ts` (added 52 lines)
- `/integrations/github_copilot/src/prompts/workflows.ts` (added 16 lines)

**Key Improvements**:

1. **Explicit prohibition** of manual YAML/JSON generation
2. **Concrete examples** showing correct CLI usage for extraction
3. **Framework-specific patterns** (FastAPI, Express, Django) with CLI commands
4. **Validation loops** demonstrating validate-after-batch approach
5. **Error recovery** showing how to fix and retry failed CLI commands

## [0.6.2] - 2025-12-03

### Fixed

- **Claude Code Integration Upgrade**:
  - Fixed `dr claude upgrade` crashing when target directories don't exist
  - Upgrade process now creates missing directories before copying files
  - Fixed upgrade process skipping modified files - now updates all files with backups
  - Resolves "No such file or directory" error when upgrading templates

### Changed

- **Upgrade Behavior**: Claude integration files (reference sheets, commands, agents) are now always updated during `dr claude upgrade` to stay in sync with the CLI version. Modified files are backed up with `.bak` extension before being updated.

## [0.6.1] - 2025-12-03

### Fixed

- **Version Display Issues**:
  - Fixed `__version__` not being updated in `__init__.py` files (was stuck at 0.5.0)
  - `dr migrate` and `dr claude upgrade` now display correct CLI version
  - Updated Claude Code integration version to match CLI version

- **Migration System**:
  - Added missing migration from spec v0.2.0 to v0.3.0
  - Fixed `dr migrate` incorrectly reporting "Current Model Version: 0.2.0" when spec v0.3.0 is available
  - Migration correctly updates models to spec v0.3.0 (Testing layer support)

- **Messaging Improvements**:
  - Changed "CLI Upgrade Available" to "Component Upgrade Available" for clarity
  - Better reflects that project components are being upgraded, not the CLI tool itself

### Technical Details

- Spec v0.3.0 migration only updates manifest version field
- Testing Layer (Layer 12) remains opt-in via `dr init --add-layer testing`
- No breaking changes to existing models

## [0.6.0] - 2025-12-03

### Added

- **Visualization Server** - New `dr visualize` command with real-time web-based model visualization:
  - Real-time WebSocket-based updates as model files change
  - Interactive React-based UI for exploring architecture models
  - File monitoring with automatic change detection
  - Token-based authentication with magic link generation
  - Specification viewing alongside model exploration
  - Changeset visualization support
  - Cross-layer traceability navigation
  - Comprehensive documentation in `docs/user-guide/visualization.md`
  - Server components:
    - `VisualizationServer` - HTTP server with WebSocket support
    - `FileMonitor` - Real-time file change detection
    - `SpecificationLoader` - Specification loading and caching
    - `ModelSerializer` - JSON serialization for web clients
    - `WebSocketProtocol` - Bidirectional communication protocol
  - Command options: `--port`, `--host`, `--no-browser`
  - Extensive test coverage (1000+ lines of tests):
    - Unit tests for all server components
    - Integration tests for file monitoring and server lifecycle
    - Command tests for CLI interface

- **Claude Code Integration Updates**:
  - **New DR Architect Agent** (`dr-architect`) - Consolidated architectural guidance agent
  - Updated GitHub Copilot integration with new workflows and intent detection

### Changed

- **Claude Code Integration Overhaul** - Streamlined and modernized agent/command structure:
  - Consolidated multiple specialized agents into unified `dr-architect` agent
  - Updated USER_GUIDE.md with improved documentation (147 lines modified)
  - Updated `dr-validate` command with enhanced validation workflows
  - Updated template files for custom agents and commands
  - Modernized `claude.py` command implementation (132 lines modified)

### Removed

- **Deprecated Claude Code Agents** - Removed redundant agents in favor of dr-architect:
  - `dr-documenter` - Documentation generation agent (882 lines)
  - `dr-extractor` - Code extraction agent (1133 lines)
  - `dr-helper` - Helper guidance agent (1369 lines)
  - `dr-ideator` - Ideation agent (1450 lines)
  - `dr-link-validator` - Link validation agent (270 lines)
  - `dr-schema-migrator` - Schema migration agent (213 lines)
  - `dr-security-reviewer` - Security review agent (374 lines)
  - `dr-validator` - Validation agent (802 lines)

- **Deprecated Claude Code Commands**:
  - `dr-links` - Link management command (758 lines)
  - `dr-project` - Project management command (657 lines)

- **Deprecated Claude Code Skills**:
  - `MIGRATION_ASSISTANT` - Migration guidance skill (153 lines)
  - `SCHEMA_VALIDATION` - Schema validation skill (87 lines)

### Fixed

- CI test stability improvements for cross-platform compatibility
- Test suite reliability enhancements
- Linting and code quality fixes

### Migration

Users relying on removed Claude Code agents, commands, or skills should transition to the new `dr-architect` agent, which provides consolidated functionality. The `dr validate` command continues to provide validation capabilities with enhanced workflows.

For the new visualization feature:

```bash
# Start visualization server
dr visualize

# With custom port
dr visualize --port 8000

# Don't auto-open browser
dr visualize --no-browser
```

### Breaking Changes

This release contains breaking changes for Claude Code integration users:

- 8 Claude agents removed (replaced by dr-architect)
- 2 slash commands removed (dr-links, dr-project)
- 2 skills removed (MIGRATION_ASSISTANT, SCHEMA_VALIDATION)

Users should update their workflows to use the new `dr-architect` agent for architectural guidance and validation tasks.

## [0.5.0] - 2025-11-29

### Added

- **Testing Layer Support (Layer 12)**:
  - Added Testing layer to manifest default layers configuration
  - Bundled Testing Layer schema (`12-testing-layer.schema.json`)
  - Full support for test coverage modeling entities:
    - TestCoverageModel, TestCoverageTarget, InputSpacePartition
    - ContextVariation, CoverageRequirement, TestCaseSketch
    - Coverage gap analysis and traceability
  - Entity type registry automatically recognizes Testing layer types

- **Specification v0.3.0 Support**:
  - Updated to support specification version 0.3.0
  - All 12 layers now fully supported (previously 11)
  - Complete integration with Testing Layer cross-layer references

### Changed

- **Version Updates**:
  - CLI version bumped to 0.5.0
  - Specification version updated to 0.3.0
  - Conformance level updated to "Full (All 12 layers)"

- **Documentation Updates**:
  - Updated all documentation references from "11 layers" to "12 layers"
  - Updated CLI README.md with Testing Layer description
  - Updated user guides (getting-started.md, claude-code-integration.md)
  - Updated conformance documentation

- **Test Updates**:
  - Updated schema bundler tests to expect 12 layer schemas
  - All 419 unit tests passing with new layer configuration

### Fixed

- Schema bundler layer count validation (now expects 12 schemas)
- Documentation accuracy across all user-facing files

### Migration

For existing models, the Testing Layer will be automatically available. To start using it:

```bash
# Initialize Testing layer in existing model
dr init --add-layer testing

# Add a test coverage target
dr add testing coverage-target --name "Order Creation Coverage" \
  --target-type workflow \
  --business-process-ref "business.process.create-order"

# Validate with Testing layer
dr validate --layers testing
```

## [0.4.1] - 2025-01-27

### Added

- **New Claude Code Agents**: Specialized agents for advanced workflows
  - **DR Link Validator Agent** (`dr-link-validator`)
    - Automated link validation and broken reference detection
    - Cross-layer reference integrity checks
    - Typo detection with suggestions using Levenshtein distance
  - **DR Schema Migrator Agent** (`dr-schema-migrator`)
    - Guided migration between specification versions
    - Automated schema transformation and validation
    - Migration path planning and conflict resolution
  - **DR Security Reviewer Agent** (`dr-security-reviewer`)
    - Security-focused code and configuration review
    - OWASP top 10 vulnerability detection
    - Security best practices validation

- **New Claude Code Skills**: Reusable workflows for common tasks
  - **CHANGESET_REVIEWER**: Automated changeset review and validation
  - **LINK_VALIDATION**: Comprehensive link validation workflows
  - **MIGRATION_ASSISTANT**: Step-by-step migration guidance
  - **SCHEMA_VALIDATION**: Schema compliance checking

- **New Commands**:
  - `/dr-release-prep` - Automated release preparation workflow
    - Version updates, changelog generation, validation, testing
    - Comprehensive release checklist generation
    - Spec/CLI compatibility verification

- **Documentation Enhancements**:
  - **USER_GUIDE.md** - Comprehensive Claude Code integration user guide (500+ lines)
    - Installation and setup instructions
    - Agent and command usage examples
    - Best practices and troubleshooting
  - **CHANGESET_FILE_SPEC.md** - Complete changeset file format specification (550+ lines)
    - JSON schema and validation rules
    - File format examples and migration guides
  - **Example Templates**:
    - `example-settings.json` - Claude Code settings reference
    - `example-validation-hook.sh` - Pre-commit hook example

### Changed

- **Claude Code Compliance Update**: All agents and slash commands now use YAML frontmatter format required by Claude Code
  - **Agent Files** (8 files total: 5 updated + 3 new):
    - Added YAML frontmatter with `name`, `description`, and `tools` fields
    - Removed inline metadata (`**Agent Type:**`, `**Purpose:**`, `**Autonomy Level:**`)
    - Agents now properly discovered by Claude Code (fixes "agent not found" errors)
    - Updated: `dr-helper.md`, `dr-ideator.md`, `dr-documenter.md`, `dr-extractor.md`, `dr-validator.md`
    - New: `dr-link-validator.md`, `dr-schema-migrator.md`, `dr-security-reviewer.md`
  - **Command Files** (8 files total: 7 updated + 1 new):
    - Added YAML frontmatter with `description` and `argument-hint` fields
    - Improves discoverability in `/help` command
    - Better auto-completion hints
    - Updated: `dr-init.md`, `dr-model.md`, `dr-ingest.md`, `dr-project.md`, `dr-validate.md`, `dr-changeset.md`, `dr-links.md`
    - New: `dr-release-prep.md`
  - **Template Updates** (2 files updated):
    - `custom-agent-template.md` - Now shows YAML frontmatter format with required/optional fields
    - `custom-command-template.md` - Now shows YAML frontmatter format with field descriptions
  - **Documentation Updates**:
    - `04_claude_code_integration_design.md` - New comprehensive format specification section (170+ lines)
    - `claude_integration/README.md` - Migration notice and new features documentation
    - Validation examples and best practices added

- **Enhanced DR Extractor Agent**: Significant functionality expansion (390+ lines added)
  - Improved element extraction workflows
  - Better cross-layer reference handling
  - Enhanced validation integration

### Fixed

- Agent discovery issues in Claude Code (agents were not being recognized)
- Command auto-completion and help text display
- Package data configuration updated to include skills and new templates

### Migration

For existing installations, update to the new format with:

```bash
dr claude update --force
```

This will automatically update all installed agents and commands to the YAML frontmatter format, and install the new agents, skills, and documentation.

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

- **Specification v0.1.1** (previous): Initial specification with organic link patterns
- **Specification v0.2.0** (current): Backward-compatible addition with standardized link patterns and optional strict enforcement
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
