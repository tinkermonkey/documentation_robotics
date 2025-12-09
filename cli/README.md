# Documentation Robotics (`dr`) CLI Tool

A command-line tool for managing federated architecture data models across 12 layers using standard specifications (ArchiMate, OpenAPI, JSON Schema, OpenTelemetry) and custom extensions.

> **Part of [Documentation Robotics](https://github.com/tinkermonkey/documentation_robotics)** - For project overview, motivation, and full context, see the [main README](https://github.com/tinkermonkey/documentation_robotics/blob/main/README.md).

[![CLI Tests](https://github.com/tinkermonkey/documentation_robotics/actions/workflows/cli-tests.yml/badge.svg)](https://github.com/tinkermonkey/documentation_robotics/actions/workflows/cli-tests.yml)
[![CLI Version](https://img.shields.io/badge/CLI-v0.7.1-green)](https://github.com/tinkermonkey/documentation_robotics/tree/main/cli)
[![Specification](https://img.shields.io/badge/Specification-v0.4.0-blue)](https://github.com/tinkermonkey/documentation_robotics/tree/main/spec)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/tinkermonkey/documentation_robotics/blob/main/LICENSE)

## Installation

```shell
pip install documentation-robotics
```

## Quick Links

- **[Install & Quick Start](#installation)** - Get started in minutes
- **[Claude Code Integration](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/docs/user-guide/claude-code-integration.md)** - AI-powered modeling
- **[Export Formats](#export-formats)** - ArchiMate, OpenAPI, PlantUML, etc.
- **[The Specification](https://github.com/tinkermonkey/documentation_robotics/tree/main/spec)** - Full spec documentation
- **[Development](#development)** - Contributing to the CLI

## Specification Conformance

**Implements:** [Documentation Robotics Specification v0.4.0](https://github.com/tinkermonkey/documentation_robotics/tree/main/spec)
**Conformance Level:** Full (All 12 layers)

Run `dr conformance` to see detailed conformance information.

## Status

**Current Version:** v0.7.1
**Specification Version:** v0.4.0

This release adds the Testing Layer and updates all integrations:

- **Model CRUD** - Model initialization, element management, validation
- **Changeset Management** - Isolated workspaces for exploring changes before committing (like Git branches)
- **Link Management** - 60+ cross-layer reference patterns with validation, discovery, and documentation
- **Managed Upgrades** - Automated migration between specification versions with dry-run preview
- **Validation & Integrity** - Cross-layer references, projection, dependency tracking, link validation
- **Export** - Export to ArchiMate, OpenAPI, JSON Schema, PlantUML, Markdown, GraphML

## The Vision

The `dr` CLI makes it easy and efficient to create, manage, validate, and export models that conform to the [Documentation Robotics Specification](https://github.com/tinkermonkey/documentation_robotics/tree/main/spec).

**Key Goals:**

- **Easy & Efficient** - Simple commands for complex modeling tasks
- **Standards-Based** - Leverage existing tooling ecosystems (ArchiMate, OpenAPI, etc.)
- **AI-Friendly** - Designed for both human and AI agent interaction
- **Git-Friendly** - All models are text-based and version-controllable
- **Collaborative** - Built for CI/CD, automation, and team workflows

With unified tooling around a federated data model, we help architects, developers, and AI agents better understand, communicate, and evolve complex software systems.

For the broader motivation and context, see [The Need](https://github.com/tinkermonkey/documentation_robotics/blob/main/README.md#the-need) in the main README.

## Features

### Foundation

- Model initialization with 12-layer structure
- Element management (add, update, remove) across all layers
- **Changeset management** - Create isolated workspaces to explore, compare, and apply changes
- **Interactive Visualization** - Real-time web-based model visualization with live updates
- Query and search capabilities
- Basic validation (schema, naming, cross-references)
- Manifest tracking and statistics

### Link Management & Validation

- **Link Registry** - Machine-readable catalog of 60+ cross-layer reference patterns
- **Link Discovery** - Automatic detection and graph building of all inter-layer connections
- **Link Validation** - Verify existence, type compatibility, cardinality, and format
- **Link Documentation** - Generate Markdown, HTML, and Mermaid diagrams
- **Link Navigation** - Query, filter, and trace paths between elements
- **Strict Mode** - CI/CD-ready validation treating warnings as errors
- **CLI Commands**: `dr links types|registry|stats|docs|list|find|validate|trace`
- **Migration Tools**: `dr migrate` for automated spec version upgrades

### Validation & Integrity

- Cross-layer reference tracking and validation
- Element projection across layers
- Dependency tracking and tracing
- Semantic validation
- Circular dependency detection
- Link validation with comprehensive error reporting

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
- **Slash Commands** - Quick access to common workflows (`/dr-model`, `/dr-ingest`, `/dr-validate`, `/dr-links`)
- **Specialized Agents** (5 total) - Autonomous agents for complex tasks:
  - `dr-helper` - Expert guidance and education
  - `dr-ideator` - Collaborative architectural exploration with research
  - `dr-extractor` - Code extraction with changeset safety
  - `dr-validator` - Validation and auto-fixing
  - `dr-documenter` - Comprehensive documentation generation
- **Customization** - Templates for organization-specific commands and agents

**Try it:**

```bash
dr claude install              # Install Claude integration
claude                         # Open Claude Code
> /dr-model Add order management service
```

See [Claude Code Integration Guide](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/docs/user-guide/claude-code-integration.md) for details.

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

# Validate the model (with link checking)
dr validate --validate-links

# Strict validation for CI/CD
dr validate --validate-links --strict-links

# Link management
dr links types                    # List available link types
dr links validate                 # Validate all links
dr links trace elem-1 elem-2      # Find path between elements
dr links docs                     # Generate documentation

# Migrate to latest spec version
dr migrate                        # Check what's needed
dr migrate --dry-run              # Preview changes
dr migrate --apply                # Apply migration

# Search across layers
dr search --type service --name "Customer*"

# Project to other layers
dr project business.service.customer-management --to application,api

# Trace dependencies
dr trace application.service.customer-service

# Start interactive visualization server
dr visualize

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

See [Claude Code Integration Guide](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/docs/user-guide/claude-code-integration.md) for full details.

## Architecture Model Structure

The `dr` tool manages models with 12 layers as defined in the [Documentation Robotics Specification](https://github.com/tinkermonkey/documentation_robotics/tree/main/spec). For a complete overview of all layers and their relationships, see [The 12 Layers](https://github.com/tinkermonkey/documentation_robotics/blob/main/README.md#the-12-layers) in the main README.

1. **Motivation** - Stakeholders, goals, requirements, principles ([spec](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/layers/01-motivation-layer.md))
2. **Business** - Business services, processes, actors, roles ([spec](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/layers/02-business-layer.md))
3. **Security** - Authentication, authorization, policies, threats ([spec](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/layers/03-security-layer.md))
4. **Application** - Application services, components, interfaces ([spec](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/layers/04-application-layer.md))
5. **Technology** - Infrastructure, nodes, devices, networks ([spec](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/layers/05-technology-layer.md))
6. **API** - REST APIs, operations, endpoints (OpenAPI) ([spec](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/layers/06-api-layer.md))
7. **Data Model** - Entities, relationships (JSON Schema) ([spec](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/layers/07-data-model-layer.md))
8. **Data Store** - Databases, tables, columns, constraints ([spec](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/layers/08-datastore-layer.md))
9. **UX** - Screens, layouts, components, states ([spec](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/layers/09-ux-layer.md))
10. **Navigation** - Routes, guards, transitions, menus ([spec](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/layers/10-navigation-layer.md))
11. **APM/Observability** - Traces, logs, metrics (OpenTelemetry) ([spec](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/layers/11-apm-observability-layer.md))
12. **Testing** - Test coverage modeling, requirements traceability ([spec](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/layers/12-testing-layer.md))

For detailed layer specifications, see [spec/layers/](https://github.com/tinkermonkey/documentation_robotics/tree/main/spec/layers)

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

- **[Claude Code Integration Guide](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/docs/user-guide/claude-code-integration.md)** - Complete guide to AI-powered modeling
- **[Visualization Guide](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/docs/user-guide/visualization.md)** - Interactive web-based model visualization
- [Getting Started](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/docs/user-guide/getting-started.md) - Basic DR usage
- [Validation Guide](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/docs/user-guide/validation.md) - Model validation and quality

### Claude Code Integration

- [Integration Guide](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/docs/user-guide/claude-code-integration.md) - How to use DR with Claude Code
- [Design Document](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/docs/04_claude_code_integration_design.md) - Architecture and rationale
- [Workflow Examples](https://github.com/tinkermonkey/documentation_robotics/blob/main/integrations/claude_code/templates/workflow-examples.md) - 10 complete workflows
- [Custom Command Template](https://github.com/tinkermonkey/documentation_robotics/blob/main/integrations/claude_code/templates/custom-command-template.md)
- [Custom Agent Template](https://github.com/tinkermonkey/documentation_robotics/blob/main/integrations/claude_code/templates/custom-agent-template.md)
- [Testing Guide](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/docs/testing/claude-integration-tests.md) - Integration testing procedures
- [Changelog](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/docs/CLAUDE_INTEGRATION_CHANGELOG.md) - What's new in Claude integration

### CLI Documentation

- [CLI Requirements](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/docs/01_cli_requirements.md)
- [Quick Start Guide](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/QUICK_START.md)
- [Implementation Summary](https://github.com/tinkermonkey/documentation_robotics/blob/main/cli/PHASE_3_IMPLEMENTATION_SUMMARY.md)

### Specification Documentation

- [Specification Overview](https://github.com/tinkermonkey/documentation_robotics/blob/main/spec/README.md)
- [Core Concepts](https://github.com/tinkermonkey/documentation_robotics/tree/main/spec/core)
- [Layer Specifications](https://github.com/tinkermonkey/documentation_robotics/tree/main/spec/layers)
- [Conformance Requirements](https://github.com/tinkermonkey/documentation_robotics/tree/main/spec/conformance)
- [Implementation Guides](https://github.com/tinkermonkey/documentation_robotics/tree/main/spec/guides)

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

Current: v0.5.0 (Testing Layer + Spec v0.3.0)

- Phase 1 (Core): v0.1.0
- Phase 2 (Validation): v0.2.0
- Phase 3 (Export): v0.3.0
- Phase 3 Patches: v0.3.1, v0.3.2, v0.3.3
- Phase 4 (Link Management + Claude Agents): v0.4.0
- Phase 4 Patch (Claude Code Compliance): v0.4.1
- Phase 5 (Testing Layer): v0.5.0
