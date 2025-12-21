# CLAUDE.md - AI Assistant Guide

## Project Overview

**Documentation Robotics** is a toolkit for managing federated architecture data models across 12 interconnected layers.

**Components:**

1. **CLI Tool - Python (`cli/`)** - Python command-line interface for managing architecture models (v0.7.3)
2. **CLI Tool - Bun (`cli-bun/`)** - TypeScript/Bun implementation with parallel feature parity (v0.1.0)
3. **Metadata Model Specification** - Formal documentation defining the 12-layer model

**Current Versions:** Python CLI v0.7.3, Bun CLI v0.1.0, Spec v0.6.0

## Repository Structure

```
documentation_robotics/
├── spec/                        # SPECIFICATION (v0.6.0)
│   ├── VERSION                  # Spec version number
│   ├── layers/                  # 12 layer specifications
│   ├── schemas/                 # JSON Schema definitions
│   └── [CHANGELOG, guides, examples, test-fixtures]
│
├── cli/                         # PYTHON CLI (v0.7.3)
│   ├── src/documentation_robotics/
│   │   ├── cli.py              # Main entry point
│   │   ├── commands/           # Command implementations
│   │   ├── core/               # Domain logic (model, layer, element)
│   │   ├── validators/         # Validation pipeline
│   │   ├── export/             # Export format handlers
│   │   ├── schemas/            # CLI's copy of JSON schemas
│   │   └── [server, viewer, claude_integration, copilot_integration, utils]
│   ├── tests/                  # Unit and integration tests
│   └── pyproject.toml          # Package configuration
│
└── cli-bun/                     # Bстановuntypescript/BUN CLI (v0.1.0)
    ├── src/
    │   ├── cli.ts              # CLI entry point (Commander.js)
    │   ├── commands/           # 23+ command implementations
    │   ├── core/               # Domain models (Element, Layer, Model, Manifest)
    │   ├── validators/         # Validation pipeline (Schema, Naming, Reference, Semantic)
    │   ├── export/             # Export handlers (ArchiMate, OpenAPI, PlantUML, etc.)
    │   ├── server/             # Visualization server (Hono + WebSocket)
    │   ├── ai/                 # AI integration (Claude API)
    │   ├── schemas/            # Bundled JSON schemas
    │   ├── types/              # TypeScript type definitions
    │   └── utils/              # Utilities (file-io, errors, element-utils)
    ├── tests/
    │   ├── unit/               # Unit tests
    │   ├── integration/        # Integration tests
    │   └── compatibility/      # Python CLI compatibility tests
    ├── dist/                   # Compiled JavaScript
    ├── package.json            # Dependencies and build scripts
    ├── tsconfig.json           # TypeScript configuration
    └── README.md               # Installation and usage guide
```

## Quick Reference

### Python CLI Setup (Legacy)

```bash
# Venv is at repo root, CLI code is in cli/ subdirectory
cd cli && pip install -e ".[dev]"
source ../.venv/bin/activate  # From cli/ directory

# Common commands
dr --help                    # CLI help
pytest                       # Run all tests
pytest tests/unit/           # Unit tests only
pytest --cov                 # With coverage
```

### Bun CLI Setup (Recommended)

```bash
# Install from source for development
cd cli-bun
npm install
npm run build

# Test
npm run test                 # Run all tests with Bun
npm run test:unit           # Unit tests only
npm run test:compatibility  # Compatibility tests

# Run CLI locally
node dist/cli.js --help

# Install globally
npm install -g .
dr --help
```

### Key Dependencies

**Python CLI:**

- Python 3.10+, click, pydantic, jsonschema, networkx, rich

**Bun CLI:**

- Node.js 18+, TypeScript, Commander.js, AJV, Ansis, Graphology, Hono, @anthropic-ai/sdk

### Approved Commands

You have pre-approved access to:

- **Python CLI:** `python3`, `source .venv/bin/activate`, `dr validate`, `dr search`, `pip install`, `pytest`
- **Bun CLI:** `npm`, `node`, `bun`, `npm run build`, `npm run test`, `npm run format`

### Pre-commit Checks

Run `pre-commit run --all-files` from the repo root before committing to ensure formatting and linters pass.

## Critical Rules

### 1. Spec vs. CLI Separation

- **Two separate version numbers**: Spec (`spec/VERSION`) and CLI (`cli/pyproject.toml`)
- **Schema synchronization**: Schema changes require updating BOTH:
  - `spec/schemas/{layer}.schema.json`
  - `cli/src/documentation_robotics/schemas/bundled/{layer}.schema.json`
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
- Use `id_generator.py` utilities for consistency

### 5. Cross-Layer References

- **Direction**: Higher layers → lower layers only
- Always validate references exist before creating
- Use `reference_registry.py` for lookups and validation

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

## Architecture Patterns

### Core Domain (`core/`)

- **Element** - Individual architecture items
- **Layer** - Container for elements within a layer
- **Model** - Complete architecture model across all layers
- **Manifest** - Model metadata (version, name, etc.)

### Reference & Dependency System (`core/`)

- **Reference Registry** - Tracks cross-layer references
- **Relationship Registry** - Tracks intra-layer relationships
- **Dependency Tracker** - Builds and analyzes dependency graphs
- **Projection Engine** - Projects dependencies across layers

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
- **GraphML** - Graph visualization

## Standards and Conventions

### Industry Standards

- **ArchiMate 3.2** - Layers 1, 2, 4, 5
- **OpenAPI 3.0** - Layer 6
- **JSON Schema Draft 7** - Layer 7
- **OpenTelemetry** - Layer 11
- **PlantUML, GraphML** - Visualizations

### Coding Conventions

- Follow PEP 8
- Type hints throughout
- Docstrings for public functions/classes
- Commands in `commands/`, core logic in `core/`, validators in `validators/`
- Tests: `tests/unit/` and `tests/integration/`

### Data Storage

- Filesystem-based (no database)
- Models in `.dr/` directory
- Manifest: `.dr/manifest.json`
- Layers: `.dr/layers/{layer-name}.json`

## Development Workflow

### Adding a New Command

1. Create command file in `commands/`
2. Implement command class (inherit from base)
3. Register in `cli.py`
4. Add integration tests in `tests/integration/`
5. Run `pytest` to verify

### Adding/Modifying a Layer

1. **ASK FIRST** - Layer changes affect spec
2. Update `spec/layers/{layer}.md`
3. Update `spec/schemas/{layer}.schema.json`
4. Copy schema to `cli/src/documentation_robotics/schemas/bundled/`
5. Update validators if needed
6. Add export support if applicable
7. Update tests

### Adding an Export Format

1. Create exporter in `export/`
2. Inherit from base exporter pattern
3. Register in `export_manager.py`
4. Add tests in `tests/unit/test_*_exporter.py`

### Testing

```bash
# Run all tests with coverage
pytest --cov=documentation_robotics --cov-report=html

# Run specific test file
pytest tests/unit/test_reference_registry.py

# Run integration tests only
pytest tests/integration/
```

**Testing Strategy:**

- **Unit tests**: Test components in isolation, mock dependencies, focus on edge cases
- **Integration tests**: Test complete workflows using temporary directories
- **Fixtures**: Common test data in `conftest.py`

## Key Files to Understand

1. **cli.py** - CLI entry point, command routing
2. **core/model.py** - Central model management
3. **core/reference_registry.py** - Reference tracking system
4. **core/relationship_registry.py** - Intra-layer relationship tracking
5. **validators/semantic.py** - Business rule validation
6. **export/export_manager.py** - Export orchestration

## Common Pitfalls

1. **Schema Synchronization**
   - Schema changes require updating BOTH spec and CLI schemas
   - As of v0.7.0, layer schemas include relationship metadata:
     - `layerMetadata` - layer identifier and catalog version
     - `intraLayerRelationships` - relationships within the layer
     - `crossLayerRelationships` - outgoing/incoming relationships to/from other layers
   - Relationship catalog (`relationship-catalog.json`) now bundled with CLI
   - Always update both spec and CLI or validation will fail

2. **Cross-Layer References**
   - Violating the "higher → lower" rule
   - Not validating references exist before creating
   - Forgetting to use reference registry

3. **Element IDs**
   - Not following `{layer}-{type}-{kebab-case}` convention
   - Creating duplicate IDs across layers
   - Manually constructing IDs instead of using utilities

4. **Export Format Compatibility**
   - Attempting to export layers to unsupported formats
   - Not checking format compatibility before exporting

5. **Virtual Environment Path**
   - Venv is at repo root (`.venv/`), not in `cli/`
   - Must install from `cli/` directory: `cd cli && pip install -e .`

6. **Version Bumps**
   - Manually editing version numbers
   - Use `/dr-release-prep` command for proper release preparation

## Bun CLI vs. Python CLI

Both CLIs implement the same commands and operate on identical model structures. Choose based on your preference:

| Aspect           | Python CLI                 | Bun CLI                   |
| ---------------- | -------------------------- | ------------------------- |
| **Installation** | `pip install`              | `npm install -g`          |
| **Performance**  | ~1-2s startup              | ~200ms startup            |
| **Environment**  | Python 3.10+               | Node.js 18+               |
| **State**        | Production-ready (v0.7.3)  | Feature-parity (v0.1.0)   |
| **Development**  | Pytest, mature             | Jest/Bun test, modern     |
| **Package Mgmt** | pip/Poetry                 | npm/Bun                   |
| **Best For**     | Legacy Python environments | Modern Node.js dev stacks |

### Using the Bun CLI

All commands are identical to the Python CLI:

```bash
# Basic operations
dr init --name "My Model"
dr add business service my-service --name "My Service"
dr list api
dr validate

# Advanced features
dr trace element-id
dr export archimate --output model.xml
dr visualize
dr chat
```

For complete command documentation:

```bash
dr --help                    # Show all commands
dr <command> --help          # Show command-specific help
```

## Design Philosophy

1. **Separation of Concerns** - Clear boundaries between commands, core logic, validators
2. **Extensibility** - Easy to add layers, validators, export formats
3. **Standards Compliance** - Leverage industry standards (ArchiMate, OpenAPI, etc.)
4. **Testability** - Comprehensive unit and integration test coverage
5. **User Experience** - Clear errors, helpful output, intuitive commands
6. **Parallel Implementations** - Python and Bun CLIs share spec, maintain parity

## Documentation

- Main README: `/README.md`
- Specification: `/spec/` (especially `spec/layers/` and `spec/CHANGELOG.md`)
- Python CLI README: `/cli/README.md`
- Bun CLI README: `/cli-bun/README.md`
- CLI design docs: `/cli/docs/`
- Release command: `/dr-release-prep` for version management
