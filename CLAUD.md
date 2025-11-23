# CLAUD.md - AI Assistant Guide

## Project Overview

**Documentation Robotics** is a comprehensive toolkit for managing federated architecture metadata models. The project consists of:

1. **CLI Tool (`dr`)** - A Python command-line interface for managing 11-layer architecture models
2. **Metadata Model Specifications** - Comprehensive documentation defining the 11-layer federated architecture model

**Current Version:** CLI v0.3.0 (Phase 3 Complete), Metadata Model v1.0

## Repository Structure

```
documentation_robotics/
├── cli/                         # CLI tool (self-contained)
│   ├── src/documentation_robotics/
│   │   ├── cli.py              # Main CLI entry point
│   │   ├── commands/           # Command implementations
│   │   ├── core/               # Core domain logic
│   │   ├── export/             # Export format handlers
│   │   ├── validators/         # Validation logic
│   │   ├── schemas/            # JSON schemas
│   │   └── utils/              # Utility functions
│   ├── dr/                     # Documentation Robotics package for the dr CLI tool
│   │   ├── model/              # Documentation Robotics model for the dr CLI tool
│   │   └── specs/              # Documentation Robotics specifications for the dr CLI tool
│   ├── tests/                  # Test suite
│   ├── docs/                   # CLI design documentation
│   └── pyproject.toml          # Python package config
│
└── documentation/              # Architecture specifications
    └── 01_metadata_model/      # 11-layer model specs
```

## The 11-Layer Architecture Model

The core concept is a federated architecture model spanning 11 interconnected layers:

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

**Key Principle:** Elements in higher layers can reference elements in lower layers, creating a dependency graph.

## Architecture Patterns

### Core Domain Model

- **Element** (`core/element.py`) - Individual architecture items (services, components, entities)
- **Layer** (`core/layer.py`) - Container for elements within a specific layer
- **Model** (`core/model.py`) - Complete architecture model across all layers
- **Manifest** (`core/manifest.py`) - Metadata about the model (version, name, etc.)

### Reference System

- **Reference Registry** (`core/reference_registry.py`) - Tracks all cross-layer references
- **Dependency Tracker** (`core/dependency_tracker.py`) - Builds and analyzes dependency graphs
- **Projection Engine** (`core/projection_engine.py`) - Projects dependencies across layers

### Validation Pipeline

1. **Schema Validation** (`validators/schema.py`) - JSON schema validation
2. **Naming Validation** (`validators/naming.py`) - Naming conventions
3. **Reference Validation** (`validators/references.py`) - Cross-layer reference integrity
4. **Semantic Validation** (`validators/semantic.py`) - Business rule validation

### Export System

- **Export Manager** (`export/export_manager.py`) - Orchestrates export operations
- Format-specific exporters:
  - **ArchiMate** - Layers 1, 2, 4, 5
  - **OpenAPI** - Layer 6 (API)
  - **JSON Schema** - Layer 7 (Data Model)
  - **PlantUML** - Visual diagrams
  - **Markdown** - Documentation
  - **GraphML** - Graph visualization

## Standards and Conventions

### Industry Standards

- **ArchiMate 3.2** - Enterprise architecture modeling (motivation, business, application, technology)
- **OpenAPI 3.0** - API specifications (API layer)
- **JSON Schema Draft 7** - Data model schemas (data model layer)
- **OpenTelemetry** - Application monitoring (APM layer)
- **PlantUML** - Diagram generation
- **GraphML** - Graph visualization

### Coding Conventions

1. **Python Style**
   - Follow PEP 8
   - Use type hints throughout
   - Docstrings for all public functions/classes

2. **Naming Conventions**
   - Element IDs: `{layer}-{type}-{kebab-case-name}`
   - Example: `api-endpoint-create-customer`

3. **File Organization**
   - Commands in `commands/` directory
   - Core logic in `core/` directory
   - Validators in `validators/` directory
   - Exports in `export/` directory

4. **Testing**
   - Unit tests in `tests/unit/`
   - Integration tests in `tests/integration/`
   - Use pytest fixtures from `conftest.py`

## Development Workflow

### Setup

```bash
# Navigate to CLI directory
cd cli

# Create virtual environment (at repo root)
cd .. && python3 -m venv .venv && source .venv/bin/activate

# Install in development mode
cd cli && pip install -e ".[dev]"

# Run tests
pytest

# Run CLI
dr --help
```

### Testing

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=documentation_robotics --cov-report=html

# Run specific test file
pytest tests/unit/test_reference_registry.py

# Run integration tests only
pytest tests/integration/
```

### Common Development Tasks

1. **Adding a New Command**
   - Create command file in `commands/`
   - Implement command class inheriting from base
   - Register in `cli.py`
   - Add tests in `tests/integration/`

2. **Adding a New Layer**
   - Update layer definitions in `core/layer.py`
   - Add schema in `schemas/`
   - Update validators if needed
   - Add export support if applicable

3. **Adding a New Export Format**
   - Create exporter in `export/`
   - Inherit from base exporter pattern
   - Register in `export_manager.py`
   - Add tests in `tests/unit/test_*_exporter.py`

## Key Files to Understand

1. **cli.py** - CLI entry point, command routing
2. **core/model.py** - Central model management
3. **core/reference_registry.py** - Reference tracking system
4. **validators/semantic.py** - Business rule validation
5. **export/export_manager.py** - Export orchestration

## Important Context

### Phase 3 Completion (v0.3.0)

The CLI recently completed Phase 3, which added:
- Export capabilities for 6+ formats
- Full cross-layer dependency tracking
- Projection engine for impact analysis
- Comprehensive validation pipeline

### Design Philosophy

1. **Separation of Concerns** - Clear boundaries between commands, core logic, and validators
2. **Extensibility** - Easy to add new layers, validators, and export formats
3. **Standards Compliance** - Leverage industry standards where possible
4. **Testability** - Comprehensive test coverage with unit and integration tests
5. **User Experience** - Clear error messages, helpful output, intuitive commands

### Data Storage

- Models stored as JSON files in `.dr/` directory
- Manifest in `.dr/manifest.json`
- Layer data in `.dr/layers/{layer-name}.json`
- No database - filesystem-based for simplicity and version control

## Common Pitfalls

1. **Cross-Layer References**
   - Always validate references exist before creating
   - Use reference registry for lookups
   - Remember: higher layers → lower layers only

2. **Element IDs**
   - Must be unique across the entire model
   - Follow naming convention strictly
   - Use `id_generator.py` for consistency

3. **Export Formats**
   - Each layer maps to specific export formats
   - Not all layers export to all formats
   - Check format compatibility before exporting

4. **Virtual Environment**
   - Virtual environment is at repo root (`.venv/`)
   - CLI code is in `cli/` subdirectory
   - Install from `cli/` directory: `cd cli && pip install -e .`

## Testing Strategy

### Unit Tests
- Test individual components in isolation
- Mock external dependencies
- Focus on edge cases and error handling

### Integration Tests
- Test complete command workflows
- Use temporary directories for test models
- Verify end-to-end functionality

### Test Fixtures
- Common test data in `conftest.py`
- Reusable model builders
- Sample elements for each layer

## Future Considerations

The repository structure supports future additions:
- Web UI in `web/` directory
- REST API server in `api/` directory
- Plugin system in `plugins/` directory

## Quick Reference

### Approved Commands

When working with this project, you have pre-approved access to:
- `python3` commands
- `source .venv/bin/activate`
- `dr validate`
- `dr search`
- `pip install` commands
- Reading files in `/private/tmp/test-dr-project/**`

### Key Dependencies

- Python 3.9+
- click (CLI framework)
- pydantic (data validation)
- jsonschema (schema validation)
- networkx (graph operations)
- jsonpath-ng (JSON querying)

## Documentation

- Main README: `/README.md`
- CLI README: `/cli/README.md`
- Reorganization notes: `/REORGANIZATION.md`
- CLI design docs: `/cli/docs/`
- Metadata model specs: `/documentation/01_metadata_model/`

## Contact and Support

This is a local development project. For issues or questions, refer to:
- CLI documentation in `cli/README.md`
- Design documents in `cli/docs/`
- Metadata model specifications in `documentation/01_metadata_model/`
