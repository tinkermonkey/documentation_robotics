# CLI Changelog

All notable changes to the Documentation Robotics CLI tool will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.3.0] - 2025-11-24

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

- [0.3.0 Release Notes](https://github.com/tinkermonkey/documentation_robotics/releases/tag/cli-v0.3.0)
- [All CLI Releases](https://github.com/tinkermonkey/documentation_robotics/releases?q=cli)

[Unreleased]: https://github.com/tinkermonkey/documentation_robotics/compare/cli-v0.3.0...HEAD
[0.3.0]: https://github.com/tinkermonkey/documentation_robotics/releases/tag/cli-v0.3.0
