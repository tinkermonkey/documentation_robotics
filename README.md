# Documentation Robotics

![Documentation Robotics Header](docs/logo/page-header.png)

A comprehensive toolkit for managing federated data models for modeling large software systems using industry standards.

[![CLI Tests](https://github.com/tinkermonkey/documentation_robotics/actions/workflows/cli-tests.yml/badge.svg)](https://github.com/tinkermonkey/documentation_robotics/actions/workflows/cli-tests.yml)

[![Specification](https://img.shields.io/badge/Specification-v0.8.3-blue)](spec/)
[![CLI Version](https://img.shields.io/badge/CLI-v0.1.3-green)](cli/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Overview

Documentation Robotics provides:

- **A Specification** - A federated data model for modeling complex software systems
- **A CLI Tool** - `dr` command for managing models according to the specification
- **Standards Integration** - Leverages ArchiMate, OpenAPI, JSON Schema, OpenTelemetry

---

## Why a Multi-Layer Model?

With generative AI and agentic tools, teams can now produce code faster than they can design, communicate, or validate what they're building. The bottleneck has shifted from implementation to comprehension — knowing what the system is, what it should become, and whether the changes made actually reflect the intent.

A shared, multi-layered model of a software system addresses this directly. It captures the _why_ (business goals, requirements), the _what_ (services, APIs, data), and the _how_ (components, infrastructure, observability) in a single coherent structure. This gives teams — human and AI — a common frame of reference for reasoning about the system at any level of abstraction.

## A Federated Architecture Model

The Documentation Robotics specification defines a 12-layer federated model spanning motivation through observability. Each layer captures a distinct aspect of the system — from business intent and security policy down to API contracts, data schemas, and test strategies — using established standards (ArchiMate, OpenAPI, JSON Schema, OpenTelemetry) wherever possible.

The model has two complementary views: the **current model** represents the actual state of the system today, and **changesets** represent a proposed future state — a set of model changes across layers that together define a coherent set of requirements. A changeset can specify not just that a new feature is needed, but _how every layer of the system changes to support it_: what new business capability it enables, what API contract it exposes, what data it stores, what it should test.

## Spec-Driven Development

Documentation Robotics is designed to fit into an agentic development workflow:

**Define.** Use the CLI or AI assistant integrations to model a change before writing code — specifying what shifts across business, API, data, and implementation layers. The resulting changeset becomes the specification for an agentic build.

**Build.** Hand the changeset to an agent as a precise, cross-layer spec. Rather than working from vague requirements, the agent builds against a structured model that captures intent at every layer of the system.

**Validate.** After the build, use the model to verify that the right changes were made — checking that the implementation matches the changeset and that the model still reflects the system accurately.

**Maintain.** As the system evolves, AI assistant integrations (Claude Code, GitHub Copilot) can keep the model up to date — extracting structure from source code and surfacing drift between the model and the actual system.

This keeps humans at the conceptual level — focused on goals, architecture, and business logic — while delegating implementation details to agentic systems without losing fidelity about what the system is and where it's headed.

## Quick Links

- **[Read the Specification](spec/)** - Complete specification with all 12 layers
- **[Use the CLI Tool](cli/)** - Install and use the `dr` command
- **[Recent Updates](spec/CHANGELOG.md)** - See what's new in the specification
- **[Contributing](CONTRIBUTING.md)** - How to contribute
- **[Release Process](RELEASE_PROCESS.md)** - How releases work

## Project Components

### 1. The Specification

**Location:** [`spec/`](spec/)
**Status:** Stable

The Documentation Robotics specification defines a standards-based approach to modeling software across 12 interconnected layers.

**Key Features:**

- **Standards** - Inspired by ArchiMate, OpenAPI, JSON Schema, OpenTelemetry
- **12 Layers** - Motivation through APM/Observability, modeling most aspects of a software system with source file references for traceability
- **Relationships Modeling** - Explicit relationships between model elements for functional modeling, interdependency analysis and impact assessment

**Quick Start:**

1. Read [spec/README.md](spec/README.md)
2. Browse layer definitions in [spec/layers/](spec/layers/)
3. Review schemas in [spec/schemas/](spec/schemas/)

[→ Full Specification Documentation](spec/)

### 2. The CLI Tool (`dr`)

**Location:** [`cli/`](cli/)
**Status:** Production-ready

A TypeScript-based command-line tool for managing project models conforming to the specification.

**Key Features:**

- **Model Management** - Initialize, add, update, validate the model
- **Relationship Management** - Discover, validate, trace, and document relationships between elements within and across layers
- **Agentic Assistants** - Claude Code and Github Copilot agents for model generation, maintenance, and exploration
- **Managed Upgrades** - Automated migration between specification versions
- **Export Formats** - ArchiMate, OpenAPI, JSON Schema, PlantUML, GraphML, Markdown, Mermaid
- **Visualization Server** - Serves interactive model visualizations for easier exploration and validation

**Installation:**

```bash
# Install globally via npm
npm install -g @documentation-robotics/cli

# Verify installation
dr --help
```

**Quick Start:**

```bash
# Initialize a new model
dr init --name "My Project"

# Add elements to layers (format: layer type id --name "Name")
dr add motivation goal motivation-goal-improve-satisfaction --name "Improve Customer Satisfaction"
dr add business service business-service-customer-support --name "Customer Support Service"

# Validate your model
dr validate

# Migrate to latest spec version
dr migrate --dry-run

# Check conformance
dr conformance

# Export to various formats
dr export archimate --output model.xml
```

**Requirements:**

- Node.js 18 or higher
- npm (Node package manager)

[→ CLI Documentation](cli/) | [→ CLI Docs](cli/docs/)

### 3. Architecture Decision Records (ADRs)

**Location:** [`docs/adr/`](docs/adr/)

Documentation of significant architectural decisions, their rationale, and consequences:

| Decision | Description |
|----------|-------------|
| [ADR-003](docs/adr/ADR-003-pattern-files-cli-asset.md) | Pattern files are CLI-maintained assets with optional per-project extensions |
| [ADR-004](docs/adr/ADR-004-ast-parser-selection.md) | CodePrism selected as AST parser over tree-sitter, Babel, and alternatives |
| [ADR-005](docs/adr/ADR-005-language-support-management.md) | Language support managed through pattern system with three-tier coverage model |

**Scanning Architecture**: See [Scanning Architecture Guide](cli/docs/SCAN_ARCHITECTURE.md) for comprehensive overview of the code analysis system.

[→ Full ADR Documentation](docs/adr/)

### 4. Claude Code Integration

The CLI is integrated with Claude Code, enabling natural language interaction with your models through specialized agents and commands.

**Installation:**

The Claude Code integration is automatically installed when you initialize a new DR model with `/dr-init`:

```bash
/dr-init my-project
```

For contributors working in the repository, you can manually install the integration files:

```bash
cp -r integrations/claude_code/. documentation-robotics/.claude/
```

**Available Agents:**

- **`/dr-architect`** - Comprehensive agent for all DR tasks (validation, extraction, documentation, security review, migration, ideation)
- **`/dr-advisor`** - Expert guidance on modeling decisions, layer selection, best practices, and validation troubleshooting

**Available Commands:**

- **`/dr-init [project-name]`** - Initialize a new DR model with Claude Code integration
- **`/dr-model`** - Explore and understand your model structure
- **`/dr-validate`** - Validate your model and get detailed feedback
- **`/dr-changeset`** - Create and manage changesets for model updates
- **`/dr-design`** - Design new architectural elements with AI assistance
- **`/dr-map`** - Map and explore cross-layer relationships
- **`/dr-sync`** - Synchronize model changes
- **`/dr-relate`** - Discover and create relationships between elements

**Quick Example:**

```bash
# Initialize a new project with Claude Code integration
/dr-init "My Project"

# Use the architect agent to validate your model
/dr-validate

# Use the advisor to understand layer structure
/dr-advisor "I'm not sure where to put my REST API endpoints"

# Design new elements with AI assistance
/dr-design "Create a customer authentication service"
```

[→ Claude Code Integration Documentation](integrations/claude_code/)

### 5. Project Documentation

## Repository Structure

```
documentation_robotics/
│
├── spec/                        # SPECIFICATION
│   ├── VERSION                  # Spec version (see badges above)
│   ├── CHANGELOG.md             # Specification changelog
│   ├── GOVERNANCE.md            # Governance model
│   ├── layers/                  # 12 layer instance files (.layer.json)
│   ├── schemas/                 # JSON Schema definitions
│   │   ├── base/                #   Core base schemas + predicates
│   │   ├── nodes/               #   Per-type node schemas (by layer)
│   │   └── relationships/       #   Per-type relationship schemas (by layer)
│   └── dist/                    # Compiled spec (auto-generated, committed)
│
├── cli/                         # TYPESCRIPT CLI
│   ├── src/                     # TypeScript source code
│   │   ├── commands/            # Command implementations
│   │   ├── core/                # Domain models
│   │   ├── validators/          # Validation pipeline
│   │   └── export/              # Export handlers
│   ├── tests/                   # Test suite
│   ├── docs/                    # CLI documentation
│   └── README.md                # CLI documentation
│
├── integrations/                # AI assistant integrations
│   ├── claude_code/             #   Claude Code integration
│   └── github_copilot/          #   GitHub Copilot integration
├── .github/workflows/           # CI/CD workflows
├── README.md                    # This file
├── CLAUDE.md                    # AI assistant instructions
├── CONTRIBUTING.md              # Contribution guidelines
└── LICENSE                      # MIT License
```

## The 12 Layers

The specification defines 12 interconnected layers:

| #   | Layer                                                | Focus        | Standard      | Notes                                                   |
| --- | ---------------------------------------------------- | ------------ | ------------- | ------------------------------------------------------- |
| 01  | [Motivation](spec/layers/01-motivation.layer.json)   | WHY          | ArchiMate 3.2 |                                                         |
| 02  | [Business](spec/layers/02-business.layer.json)       | WHAT         | ArchiMate 3.2 |                                                         |
| 03  | [Security](spec/layers/03-security.layer.json)       | WHO CAN      | _Custom_      |                                                         |
| 04  | [Application](spec/layers/04-application.layer.json) | HOW          | ArchiMate 3.2 |                                                         |
| 05  | [Technology](spec/layers/05-technology.layer.json)   | WITH WHAT    | ArchiMate 3.2 |                                                         |
| 06  | [API](spec/layers/06-api.layer.json)                 | INTERFACE    | OpenAPI 3.0   |                                                         |
| 07  | [Data Model](spec/layers/07-data-model.layer.json)   | STRUCTURE    | JSON Schema   |                                                         |
| 08  | [Data Store](spec/layers/08-data-store.layer.json)   | STORAGE      | SQL DDL       |                                                         |
| 09  | [UX](spec/layers/09-ux.layer.json)                   | PRESENTATION | _Custom_      | Three-tier architecture: Libraries, Applications, Specs |
| 10  | [Navigation](spec/layers/10-navigation.layer.json)   | FLOW         | _Custom_      |                                                         |
| 11  | [APM/Observability](spec/layers/11-apm.layer.json)   | OBSERVE      | OpenTelemetry |                                                         |
| 12  | [Testing](spec/layers/12-testing.layer.json)         | VERIFY       | _Custom_      |                                                         |

## Standards Leveraged

This project maximizes use of existing standards:

- **ArchiMate 3.2** - Motivation, Business, Application, Technology layers
- **OpenAPI 3.0** - API specifications
- **JSON Schema Draft 7** - Data model definitions
- **OpenTelemetry 1.0+** - Observability and tracing
- **SQL DDL** - Database schemas
- **Custom Specifications** - Security, UX, Navigation, Testing layers

## Getting Started

### For Users

Want to use this for modeling your project?

1. **Install the CLI**

   ```bash
   npm install -g @documentation-robotics/cli
   ```

2. **Create Your First Model**

   ```bash
   dr init --name "My Project"
   dr add motivation goal "My First Goal"
   dr validate
   ```

3. **Learn More**
   - Browse layer definitions in [spec/layers/](spec/layers/)
   - Review [cli/docs/](cli/docs/) for implementation guides
   - Read [cli/README.md](cli/README.md) for CLI documentation

### For Evaluators

Evaluating this approach?

1. Read [spec/README.md](spec/README.md) for specification overview
2. Review the layer definitions in [spec/layers/](spec/layers/)
3. Check [spec/GOVERNANCE.md](spec/GOVERNANCE.md) for governance model

## Contributing

We welcome contributions! See:

- [CONTRIBUTING.md](CONTRIBUTING.md) - General contribution guidelines
- [spec/CONTRIBUTING.md](spec/CONTRIBUTING.md) - Specification contributions
- [cli/README.md#development](cli/README.md#development) - CLI development

**Ways to Contribute:**

- Report issues or ambiguities in the specification
- Propose new features or improvements
- Improve documentation
- Add test fixtures
- Create example models
- Improve the CLI tool

## Governance & Releases

- **Specification Governance:** See [spec/GOVERNANCE.md](spec/GOVERNANCE.md)
- **Release Process:** See [RELEASE_PROCESS.md](RELEASE_PROCESS.md)
- **Versioning:** Semantic Versioning 2.0.0

## Current Versions

| Component         | Version | Status           |
| ----------------- | ------- | ---------------- |
| **Specification** | 0.8.3   | Stable           |
| **CLI Tool**      | 0.1.3   | Production-ready |

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.

## Support

- **Questions:** [GitHub Discussions](https://github.com/tinkermonkey/documentation_robotics/discussions)
- **Issues:** [GitHub Issues](https://github.com/tinkermonkey/documentation_robotics/issues)

## Citation

If you use this specification in academic work, please cite:

```bibtex
@techreport{documentation-robotics-spec,
  title = {Documentation Robotics Specification},
  version = {X.Y.Z},
  year = {YYYY},
  url = {https://github.com/tinkermonkey/documentation_robotics/tree/main/spec}
}
```

## Acknowledgments

This project integrates and builds upon:

- **ArchiMate®** - Registered trademark of The Open Group
- **OpenAPI Specification** - OpenAPI Initiative
- **JSON Schema** - JSON Schema team
- **OpenTelemetry** - Cloud Native Computing Foundation
- **W3C Trace Context** - World Wide Web Consortium

---

**Ready to get started?**

- Read the specification: [spec/README.md](spec/README.md)
- Install the CLI: `npm install -g @documentation-robotics/cli`
- Join the discussion: [GitHub Discussions](https://github.com/tinkermonkey/documentation_robotics/discussions)
