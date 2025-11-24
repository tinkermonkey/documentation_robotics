# Documentation Robotics (`dr`) CLI Tool

A command-line tool for managing federated architecture data models across 11 layers using standard specifications (ArchiMate, OpenAPI, JSON Schema, OpenTelemetry) and custom extensions.

> **Part of [Documentation Robotics](../README.md)** - For project overview, motivation, and full context, see the [main README](../README.md).

[![CLI Tests](https://github.com/tinkermonkey/documentation_robotics/actions/workflows/cli-tests.yml/badge.svg)](https://github.com/tinkermonkey/documentation_robotics/actions/workflows/cli-tests.yml)
[![CLI Version](https://img.shields.io/badge/CLI-v0.3.1-green)](.)
[![Specification](https://img.shields.io/badge/Specification-v0.1.0-blue)](../spec/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)

## Installation

```shell
pip install documentation-robotics
```

## Quick Links

- **[Install & Quick Start](#installation)** - Get started in minutes
- **[Claude Code Integration](docs/user-guide/claude-code-integration.md)** - AI-powered modeling
- **[Export Formats](#export-formats)** - ArchiMate, OpenAPI, PlantUML, etc.
- **[The Specification](../spec/)** - Full spec documentation
- **[Development](#development)** - Contributing to the CLI

## Specification Conformance

**Implements:** [Documentation Robotics Specification v0.1.0](../spec/)
**Conformance Level:** Full (All 11 layers)

Run `dr conformance` to see detailed conformance information.

## Status

**Current Version:** v0.3.1
**Specification Version:** v0.1.0

This is the alpha release of the `dr` CLI tool, implementing most core features to prove out the concept:

- **Model CRUD** - Model initialization, element management, validation
- **Validation & Integrity** - Cross-layer references, projection, dependency tracking
- **Export** - Export to ArchiMate, OpenAPI, JSON Schema, PlantUML, Markdown, GraphML

## The Vision

The `dr` CLI makes it easy and efficient to create, manage, validate, and export models that conform to the [Documentation Robotics Specification](../spec/).

**Key Goals:**

- **Easy & Efficient** - Simple commands for complex modeling tasks
- **Standards-Based** - Leverage existing tooling ecosystems (ArchiMate, OpenAPI, etc.)
- **AI-Friendly** - Designed for both human and AI agent interaction
- **Git-Friendly** - All models are text-based and version-controllable
- **Collaborative** - Built for CI/CD, automation, and team workflows

With unified tooling around a federated data model, we help architects, developers, and AI agents better understand, communicate, and evolve complex software systems.

For the broader motivation and context, see [The Need](../README.md#the-need) in the main README.

## Features

### Foundation

- Model initialization with 11-layer structure
- Element management (add, update, remove) across all layers
- Query and search capabilities
- Basic validation (schema, naming, cross-references)
- Manifest tracking and statistics

### Validation & Integrity

- Cross-layer reference tracking and validation
- Element projection across layers
- Dependency tracking and tracing
- Semantic validation
- Circular dependency detection

### Export

- Export to ArchiMate 3.2 XML
- Export to OpenAPI 3.0 specifications
- Export to JSON Schema Draft 7
- Generate PlantUML diagrams (component, class, deployment)
- Generate Markdown documentation
- Export to GraphML for visualization

### Claude Code Integration

- **Natural Language Modeling** - Create architecture models using conversational language
- **Automatic Code Extraction** - Extract models from existing codebases (Python, TypeScript, Java, Go)
- **Intelligent Validation** - Auto-fix common issues with confidence scoring
- **Documentation Generation** - Generate comprehensive docs and diagrams automatically
- **Slash Commands** - Quick access to common workflows (`/dr-model`, `/dr-ingest`, `/dr-validate`)
- **Specialized Agents** - Autonomous agents for complex tasks (extractor, validator, documenter)
- **Customization** - Templates for organization-specific commands and agents

**Try it:**

```bash
dr claude install              # Install Claude integration
claude                         # Open Claude Code
> /dr-model Add order management service
```

See [Claude Code Integration Guide](docs/user-guide/claude-code-integration.md) for details.

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

### Traditional CLI Usage

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

### AI-Powered Usage with Claude Code

```bash
# Install Claude Code integration
dr claude install

# Start Claude Code
claude

# Then use natural language:
> Create an architecture model for an e-commerce platform with:
> - Business services for orders, payments, and inventory
> - Application services that realize each business service
> - REST API operations
> - Security controls (OAuth2, rate limiting)
> - Monitoring metrics (availability, latency)

# Or use slash commands:
> /dr-model Add order management service
> /dr-ingest ./src/api --layers business,application,api
> /dr-validate --fix
> /dr-project business→application

# Extract from existing code:
> Please analyze my FastAPI application in ./src and create an architecture model
```

See [Claude Code Integration Guide](docs/user-guide/claude-code-integration.md) for full details.

## Architecture Model Structure

The `dr` tool manages models with 11 layers as defined in the [Documentation Robotics Specification](../spec/). For a complete overview of all layers and their relationships, see [The 11 Layers](../README.md#the-11-layers) in the main README.

1. **Motivation** - Stakeholders, goals, requirements, principles ([spec](../spec/layers/01-motivation-layer.md))
2. **Business** - Business services, processes, actors, roles ([spec](../spec/layers/02-business-layer.md))
3. **Security** - Authentication, authorization, policies, threats ([spec](../spec/layers/03-security-layer.md))
4. **Application** - Application services, components, interfaces ([spec](../spec/layers/04-application-layer.md))
5. **Technology** - Infrastructure, nodes, devices, networks ([spec](../spec/layers/05-technology-layer.md))
6. **API** - REST APIs, operations, endpoints (OpenAPI) ([spec](../spec/layers/06-api-layer.md))
7. **Data Model** - Entities, relationships (JSON Schema) ([spec](../spec/layers/07-data-model-layer.md))
8. **Data Store** - Databases, tables, columns, constraints ([spec](../spec/layers/08-datastore-layer.md))
9. **UX** - Screens, layouts, components, states ([spec](../spec/layers/09-ux-layer.md))
10. **Navigation** - Routes, guards, transitions, menus ([spec](../spec/layers/10-navigation-layer.md))
11. **APM/Observability** - Traces, logs, metrics (OpenTelemetry) ([spec](../spec/layers/11-apm-observability-layer.md))

For detailed layer specifications, see [../spec/layers/](../spec/layers/)

## Project Structure

```
project/
├── .dr/                                # Tool configuration and schemas
│   ├── schemas/                       # JSON Schema definitions for each layer
│   ├── examples/                      # Example elements
│   └── README.md                      # Model documentation
├── documentation-robotics/             # Main project directory
│   ├── model/                         # The canonical architecture model
│   │   ├── manifest.yaml              # Model metadata and registry
│   │   ├── 01_motivation/             # Motivation layer elements
│   │   ├── 02_business/               # Business layer elements
│   │   └── ...                       # Other layers
│   ├── specs/                         # Generated/exported specifications
│   │   ├── archimate/                 # ArchiMate XML exports
│   │   ├── openapi/                   # OpenAPI 3.0 specs
│   │   ├── schemas/                   # JSON Schema files
│   │   ├── diagrams/                  # PlantUML diagrams
│   │   └── docs/                      # Markdown documentation
│   └── projection-rules.yaml          # Cross-layer projection rules
└── dr.config.yaml                     # Configuration
```

## Design Philosophy

- **Files are the API** - The model is stored as YAML/JSON files that can be directly manipulated
- **CLI provides convenience** - The `dr` tool offers validation, projection, and export functionality
- **Standards-first** - Leverage existing standards wherever possible (ArchiMate, OpenAPI, JSON Schema)
- **AI-native design** - Designed for easy use by both humans and AI agents (Claude Code, etc.)
- **Git-friendly** - All model files are text-based and version-controllable
- **Federated approach** - Each layer uses optimal standards, integrated via ArchiMate spine
- **Cross-layer traceability** - Track relationships from business goals through to observability

## Documentation

### User Guides

- **[Claude Code Integration Guide](docs/user-guide/claude-code-integration.md)** - Complete guide to AI-powered modeling
- [Getting Started](docs/user-guide/getting-started.md) - Basic DR usage
- [Validation Guide](docs/user-guide/validation.md) - Model validation and quality

### Claude Code Integration

- [Integration Guide](docs/user-guide/claude-code-integration.md) - How to use DR with Claude Code
- [Design Document](docs/04_claude_code_integration_design.md) - Architecture and rationale
- [Workflow Examples](src/documentation_robotics/claude_integration/templates/workflow-examples.md) - 10 complete workflows
- [Custom Command Template](src/documentation_robotics/claude_integration/templates/custom-command-template.md)
- [Custom Agent Template](src/documentation_robotics/claude_integration/templates/custom-agent-template.md)
- [Testing Guide](docs/testing/claude-integration-tests.md) - Integration testing procedures
- [Changelog](docs/CLAUDE_INTEGRATION_CHANGELOG.md) - What's new in Claude integration

### CLI Documentation

- [CLI Requirements](docs/01_cli_requirements.md)
- [Quick Start Guide](QUICK_START.md)
- [Implementation Summary](PHASE_3_IMPLEMENTATION_SUMMARY.md)

### Specification Documentation

- [Specification Overview](../spec/README.md)
- [Core Concepts](../spec/core/)
- [Layer Specifications](../spec/layers/)
- [Conformance Requirements](../spec/conformance/)
- [Implementation Guides](../spec/guides/)

## Export Formats

| Format      | Command                        | Output           | Tool Compatibility          |
| ----------- | ------------------------------ | ---------------- | --------------------------- |
| ArchiMate   | `dr export --format archimate` | `.archimate` XML | Archi, Enterprise Architect |
| OpenAPI     | `dr export --format openapi`   | `.yaml` specs    | Swagger Editor, Postman     |
| JSON Schema | `dr export --format schema`    | `.schema.json`   | Any JSON Schema validator   |
| PlantUML    | `dr export --format plantuml`  | `.puml` diagrams | PlantUML, online renderers  |
| Markdown    | `dr export --format markdown`  | `.md` docs       | Any Markdown viewer         |
| GraphML     | `dr export --format graphml`   | `.graphml`       | yEd, Gephi, Cytoscape       |

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

Current: v0.3.1 (MVP Complete)

- Phase 1 (Core): v0.1.0
- Phase 2 (Validation): v0.2.0
- Phase 3 (Export): v0.3.1
