# Documentation Robotics

A comprehensive toolkit for managing federated architecture metadata models. This project provides tools and specifications for creating, validating, and exporting multi-layer architecture models using industry standards.

## Project Structure

```
documentation_robotics/
├── cli/                        # CLI tool for model management
│   ├── src/                   # Python source code
│   ├── tests/                 # Test suite
│   ├── docs/                  # CLI documentation and design docs
│   └── README.md              # CLI-specific README
│
└── documentation/             # Architecture model specifications
    └── 01_metadata_model/     # 11-layer metadata model definition
        ├── 00-overview.md
        └── layers/            # Individual layer specifications
            ├── 01-motivation-layer.md
            ├── 02-business-layer.md
            ├── 03-security-layer.md
            ├── 04-application-layer.md
            ├── 05-technology-layer.md
            ├── 06-api-layer.md
            ├── 07-data-model-layer.md
            ├── 08-datastore-layer.md
            ├── 09-ux-layer.md
            ├── 10-navigation-layer.md
            └── 11-apm-layer.md
```

## Components

### 1. CLI Tool (`dr`)

A command-line tool for managing architecture models across 11 layers.

**Location:** `cli/`

**Features:**
- Model initialization and element management
- Cross-layer reference validation
- Dependency tracking and projection
- Export to ArchiMate, OpenAPI, JSON Schema, PlantUML, Markdown, GraphML

**Status:** Phase 3 Complete (v0.3.0)

[→ Go to CLI documentation](cli/README.md)

### 2. Metadata Model Specification

Comprehensive specifications for a federated architecture metadata model spanning 11 layers.

**Location:** `documentation/01_metadata_model/`

**Layers:**
1. **Motivation** - Goals, requirements, stakeholders
2. **Business** - Business processes and services
3. **Security** - Authentication, authorization, threats
4. **Application** - Application services and components
5. **Technology** - Infrastructure and platforms
6. **API** - REST APIs and operations
7. **Data Model** - Entities and relationships
8. **Data Store** - Database schemas
9. **UX** - User interface components
10. **Navigation** - Application routing
11. **APM** - Observability and monitoring

[→ Go to metadata model documentation](documentation/01_metadata_model/)

## Quick Start

### Using the CLI Tool

```bash
# Navigate to CLI directory
cd cli

# Install the tool
pip install -e .

# Initialize a new architecture model
dr init my-project

# Add elements, validate, export
dr add business service --name "Customer Management"
dr validate
dr export --format archimate
```

See [cli/README.md](cli/README.md) for detailed CLI documentation.

### Understanding the Metadata Model

The metadata model provides specifications for representing enterprise architecture across 11 interconnected layers. Each layer uses industry standards where possible:

- **ArchiMate 3.2** for motivation, business, application, and technology layers
- **OpenAPI 3.0** for API specifications
- **JSON Schema** for data models
- **OpenTelemetry** for observability

See [documentation/01_metadata_model/](documentation/01_metadata_model/) for layer specifications.

## Development

### CLI Tool Development

```bash
cd cli

# Install with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Run with coverage
pytest --cov=documentation_robotics --cov-report=html
```

### Documentation

All documentation is in Markdown format and can be viewed directly on GitHub or in any Markdown viewer.

## Standards Used

- **ArchiMate 3.2** - Enterprise architecture modeling
- **OpenAPI 3.0** - API specifications
- **JSON Schema Draft 7** - Data model schemas
- **OpenTelemetry** - Application monitoring
- **PlantUML** - Diagram generation
- **GraphML** - Graph visualization

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Version

- CLI Tool: v0.3.0 (Phase 3 Complete)
- Metadata Model: v1.0 (Stable)

## Contributing

Contributions are welcome! Please see individual component READMEs for specific contribution guidelines.

## Support

For issues, questions, or contributions:
- CLI Tool: See [cli/README.md](cli/README.md)
- Metadata Model: See [documentation/01_metadata_model/](documentation/01_metadata_model/)
