# Documentation Robotics (`dr`) CLI Tool

A command-line tool for managing federated architecture metadata models across 11 layers using standard specifications (ArchiMate, OpenAPI, JSON Schema, OpenTelemetry) and custom extensions.

## Status

**Current Version:** v0.3.0

- ✅ **Phase 1 (MVP)** - Model initialization, element management, validation
- ✅ **Phase 2 (Validation & Integrity)** - Cross-layer references, projection, dependency tracking
- ✅ **Phase 3 (Export)** - Export to ArchiMate, OpenAPI, JSON Schema, PlantUML, Markdown, GraphML

## Features

### Phase 1 (MVP)
- ✅ Model initialization with 11-layer structure
- ✅ Element management (add, update, remove) across all layers
- ✅ Query and search capabilities
- ✅ Basic validation (schema, naming, cross-references)
- ✅ Manifest tracking and statistics

### Phase 2 (Validation & Integrity)
- ✅ Cross-layer reference tracking and validation
- ✅ Element projection across layers
- ✅ Dependency tracking and tracing
- ✅ Semantic validation
- ✅ Circular dependency detection

### Phase 3 (Export)
- ✅ Export to ArchiMate 3.2 XML
- ✅ Export to OpenAPI 3.0 specifications
- ✅ Export to JSON Schema Draft 7
- ✅ Generate PlantUML diagrams (component, class, deployment)
- ✅ Generate Markdown documentation
- ✅ Export to GraphML for visualization

### Coming in Future Phases
- Code generation (TypeScript, Python, React components)
- Interactive REPL mode
- Diff/merge functionality
- Advanced reporting and analytics
- CI/CD integration

## Installation

```bash
# From the cli directory
cd cli

# Install from source
pip install -e .

# Install with development dependencies
pip install -e ".[dev]"
```

## Quick Start

```bash
# Initialize a new model
dr init my-project

# Add a business service
dr add business service --name "Customer Management" \
  --description "Manages customer lifecycle"

# Find an element
dr find business.service.customer-management

# List all elements in a layer
dr list business

# Validate the model
dr validate

# Search across layers
dr search --type service --name "Customer*"

# Project to other layers
dr project business.service.customer-management --to application,api

# Trace dependencies
dr trace application.service.customer-service

# Export to various formats
dr export --format archimate
dr export --format openapi
dr export --format plantuml
dr export --format markdown
dr export --format all
```

## Architecture Model Structure

The `dr` tool manages models with 11 layers:

1. **Motivation** - Stakeholders, goals, requirements, principles
2. **Business** - Business services, processes, actors, roles
3. **Security** - Authentication, authorization, policies, threats
4. **Application** - Application services, components, interfaces
5. **Technology** - Infrastructure, nodes, devices, networks
6. **API** - REST APIs, operations, endpoints (OpenAPI)
7. **Data Model** - Entities, relationships (JSON Schema)
8. **Data Store** - Databases, tables, columns, constraints
9. **UX** - Screens, layouts, components, states
10. **Navigation** - Routes, guards, transitions, menus
11. **APM/Observability** - Traces, logs, metrics (OpenTelemetry)

## Project Structure

```
project/
├── .dr/                    # Tool configuration and schemas
│   ├── schemas/           # JSON Schema definitions for each layer
│   ├── examples/          # Example elements
│   └── README.md          # Model documentation
├── model/                  # The canonical architecture model
│   ├── manifest.yaml      # Model metadata and registry
│   ├── 01_motivation/     # Motivation layer elements
│   ├── 02_business/       # Business layer elements
│   └── ...               # Other layers
├── specs/                  # Generated/exported specifications
│   ├── archimate/         # ArchiMate XML exports
│   ├── openapi/           # OpenAPI 3.0 specs
│   ├── schemas/           # JSON Schema files
│   ├── diagrams/          # PlantUML diagrams
│   └── docs/              # Markdown documentation
├── dr.config.yaml         # Configuration
└── projection-rules.yaml  # Cross-layer projection rules
```

## Design Philosophy

- **Files are the API** - The model is stored as YAML/JSON files that can be directly manipulated
- **CLI provides convenience** - The `dr` tool offers validation, projection, and export functionality
- **Claude Code integration** - Designed to be easily used by both humans and Claude Code
- **Standards-based** - Leverage existing standards wherever possible (ArchiMate, OpenAPI, JSON Schema)
- **Git-friendly** - All model files are text-based and version-controllable

## Documentation

- [CLI Requirements](docs/01_cli_requirements.md)
- [Phase 3 Design](docs/02_cli_design_phase_3.md)
- [Phase 3 Development Plan](docs/03_cli_dev_plan_phase_3.md)
- [Quick Start Guide](QUICK_START.md)
- [Implementation Summary](PHASE_3_IMPLEMENTATION_SUMMARY.md)

## Export Formats

| Format | Command | Output | Tool Compatibility |
|--------|---------|--------|-------------------|
| ArchiMate | `dr export --format archimate` | `.archimate` XML | Archi, Enterprise Architect |
| OpenAPI | `dr export --format openapi` | `.yaml` specs | Swagger Editor, Postman |
| JSON Schema | `dr export --format schema` | `.schema.json` | Any JSON Schema validator |
| PlantUML | `dr export --format plantuml` | `.puml` diagrams | PlantUML, online renderers |
| Markdown | `dr export --format markdown` | `.md` docs | Any Markdown viewer |
| GraphML | `dr export --format graphml` | `.graphml` | yEd, Gephi, Cytoscape |

## Development

```bash
# Run tests
pytest

# Run tests with coverage
pytest --cov=documentation_robotics --cov-report=html

# Run specific test suites
pytest tests/unit/
pytest tests/integration/

# Type checking
mypy src/documentation_robotics/

# Linting
ruff check src/
black --check src/

# Format code
black src/
```

## License

MIT License - see LICENSE file for details.

## Version

Current: v0.3.0 (Phase 3 Complete)
- Phase 1 (MVP): v0.1.0
- Phase 2 (Validation): v0.2.0
- Phase 3 (Export): v0.3.0
