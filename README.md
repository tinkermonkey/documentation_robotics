# Documentation Robotics

A comprehensive toolkit for managing federated data models for modeling large software systems using industry standards.

[![CLI Tests](https://github.com/tinkermonkey/documentation_robotics/actions/workflows/cli-tests.yml/badge.svg)](https://github.com/tinkermonkey/documentation_robotics/actions/workflows/cli-tests.yml)

[![Specification](https://img.shields.io/badge/Specification-v0.2.0-blue)](spec/)
[![CLI Version](https://img.shields.io/badge/CLI-v0.4.0-green)](cli/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Overview

Documentation Robotics provides:

- **A Specification** - A federated data model for modeling complex software systems
- **A CLI Tool** - `dr` command for managing models according to the specification
- **Standards Integration** - Leverages ArchiMate, OpenAPI, JSON Schema, OpenTelemetry

## The Need

Modern software systems are complex, distributed, and constantly evolving. Traditional architecture, business, and engineering documentation methods struggle to keep up, leading to outdated or incomplete information. Each of those aspects are improving, but they also remain fairly disconnected from the others. Additionally, keeping a group of humans on the same page regarding what a system is, how it works, and why it works that way is a significant challenge. It's also a significant risk factor for software projects and budgets. With the rise of capable agentic software devlopment tools, this need to communicate large complex systems in context, at a high level, both before and after the SDLC is becoming critical. This project aims to provide a standards-based, federated approach to modeling these systems that is easy to use, maintain, and integrate into existing development workflows. It serves to inform the SDLC and the creative process leading into it while also serving as a validation mechanism and feedback loop for the SDLC.

## The Specification

The vision for the spec is to be a comprehensive, standards-based approach to describing what a software system is, how it works, why it works that way, and how to observe it in production. The many excellent standards that already exist are used to their fullest extent, minimizing invention, but also adding some glue between them and a few missing layers to hopefully create a unified and holistic modeling framework that is not overly complex. A guiding principle is also to keep it as simple as possible while also being reasonably complete.

## The Tooling

The motivation for the tooling is to make it easy and efficient to create, manage, validate, and export models that conform to the specification. With the adoption of infrastructure-as-code, APM, standards like OpenAPI, JSON Schema, and OpenTelemetry, much of this data is available some form to technologists. AI-assisted development make it much easiers to generate and maintain this metadata as part of the software development lifecycle to fill in the gaps. With a unified data model and tooling, we can help architects, developers, and AI agents better understand, communicate, and evolve complex software systems.

The vision is to be able to explore adding functionality to a system at any level that we happen to be envisioning it, whether that's the business layer, application layer, API layer, data model layer, etc, and from there project those changes into the other layers to explore impact and opportunity. By having a unified model that spans all these layers, we can help ensure consistency and traceability across the entire system design.

The CLI is a quick way for both humans and automated systems (CI/CD, AI agents, etc.) to manage these models in a collaborative manner. From the CLI, tools like sub-agents, custom commands, and other automation can be built to further streamline the process of managing system models in a way that is not tied to a specific ecosystem or vendor. We've started with a Claude Code integration to enable natural language interaction with the models, but the vision is to enable a wide variety of integrations and automation around this unified data model.

### Recent Major Additions

**Link Registry & Validation (Spec v0.2.0 / CLI v0.4.0)**

- 📖 **Comprehensive Catalog** - 60+ cross-layer reference patterns across 9 categories
- 🔍 **Automated Discovery** - Automatically detect and analyze all cross-layer links in your model
- ✅ **Link Validation** - Verify existence, type compatibility, cardinality, and format of all references
- 📊 **Interactive Documentation** - Generate searchable HTML documentation with Mermaid diagrams
- 🔄 **Path Tracing** - Find and visualize paths between any two elements across layers
- 🚀 **CI/CD Ready** - Strict mode for treating warnings as errors in automated pipelines

See [Link Management Guide](cli/docs/user-guide/link-management.md) for complete documentation.

**Managed Upgrades (CLI v0.4.0)**

- 🔄 **Automated Migration** - Seamlessly migrate models between specification versions
- 🔧 **Pattern Detection** - Automatically identify and fix non-standard reference patterns
- 📋 **Dry-Run Preview** - See exactly what will change before applying migrations
- ✏️ **Smart Fixes** - Correct naming conventions (camelCase → kebab-case) and cardinality mismatches
- 📈 **Version Tracking** - Maintain upgrade history in your model's manifest

See `dr migrate --help` for usage details.

## Quick Links

- **[Read the Specification](spec/)** - Complete specification with all 12 layers
- **[Use the CLI Tool](cli/)** - Install and use the `dr` command
- **[Contributing](CONTRIBUTING.md)** - How to contribute
- **[Release Process](RELEASE_PROCESS.md)** - How releases work

## Project Components

### 1. The Specification

**Location:** [`spec/`](spec/)
**Version:** 0.2.0 (Stable)
**Status:** Complete

The Documentation Robotics specification defines a standards-based approach to modeling software across 11 interconnected layers.

**Key Features:**

- **Standards-First** - Uses ArchiMate, OpenAPI, JSON Schema, OpenTelemetry
- **Federated Approach** - ArchiMate spine + specialized standards
- **11 Layers** - Motivation through APM/Observability
- **Minimal Custom Invention** - Only 2 custom specifications (security, UX/navigation)
- **Tool Ecosystem Access** - Compatible with hundreds of existing tools

**Quick Start:**

1. Read [spec/README.md](spec/README.md)
2. Explore [spec/core/00-overview.md](spec/core/00-overview.md)
3. Browse [spec/examples/](spec/examples/)

[→ Full Specification Documentation](spec/)

### 2. The CLI Tool (`dr`)

**Location:** [`cli/`](cli/)
**Version:** 0.4.0
**Status:** Feature Complete

A command-line tool for managing project models conforming to the specification.

**Key Features:**

- ✅ **Full Conformance** - Implements all 12 layers
- ✅ **Model Management** - Initialize, add, update, validate
- ✅ **Link Registry** - 60+ cross-layer reference patterns with automated validation
- ✅ **Link Management** - Discover, validate, trace, and document inter-layer links
- ✅ **Managed Upgrades** - Automated migration between specification versions
- ✅ **Export Formats** - ArchiMate, OpenAPI, PlantUML, Markdown, GraphML
- ✅ **Standards-Based** - Uses specification v0.2.0

**Quick Start:**

```bash
# Install
pip install -e cli/

# Initialize a model
dr init my-project

# Add elements
dr add motivation goal --name "Improve Customer Satisfaction"

# Validate (with link checking)
dr validate --validate-links

# Migrate model to latest spec version
dr migrate --dry-run  # Preview changes
dr migrate --apply    # Apply migration

# Check conformance
dr conformance
```

[→ Full CLI Documentation](cli/)

## Repository Structure

```
documentation_robotics/
│
├── spec/                        # THE SPECIFICATION
│   ├── VERSION                  # Current spec version (0.1.1)
│   ├── CHANGELOG.md             # Specification changelog
│   ├── GOVERNANCE.md            # Governance model
│   ├── CONTRIBUTING.md          # Contribution guidelines
│   ├── core/                    # Core specification documents
│   ├── layers/                  # 12 layer specifications
│   ├── schemas/                 # JSON Schema definitions
│   ├── conformance/             # Conformance requirements
│   ├── guides/                  # Implementation guides
│   ├── examples/                # Example models
│   ├── test-fixtures/           # Test data for validators
│   └── reference/               # Reference materials
│
├── cli/                         # CLI IMPLEMENTATION
│   ├── src/                     # Python source code
│   ├── tests/                   # Test suite
│   ├── docs/                    # CLI documentation
│   └── README.md                # CLI README
│
├── implementations/             # REFERENCE IMPLEMENTATIONS
│   └── python-dr/               # Python reference (→ cli/)
│
├── tools/                       # PROJECT TOOLING
│
├── .github/                     # GitHub configuration
│   ├── ISSUE_TEMPLATE/          # Issue templates (spec vs CLI)
│   └── workflows/               # CI/CD workflows
│
├── README.md                    # This file
├── CONTRIBUTING.md              # Project contribution guidelines
├── RELEASE_PROCESS.md           # Release process documentation
└── LICENSE                      # MIT License
```

## The 11 Layers

The specification defines 11 interconnected layers:

| #   | Layer                                                          | Focus        | Standard      |
| --- | -------------------------------------------------------------- | ------------ | ------------- |
| 01  | [Motivation](spec/layers/01-motivation-layer.md)               | WHY          | ArchiMate 3.2 |
| 02  | [Business](spec/layers/02-business-layer.md)                   | WHAT         | ArchiMate 3.2 |
| 03  | [Security](spec/layers/03-security-layer.md)                   | WHO CAN      | Custom        |
| 04  | [Application](spec/layers/04-application-layer.md)             | HOW          | ArchiMate 3.2 |
| 05  | [Technology](spec/layers/05-technology-layer.md)               | WITH WHAT    | ArchiMate 3.2 |
| 06  | [API](spec/layers/06-api-layer.md)                             | INTERFACE    | OpenAPI 3.0   |
| 07  | [Data Model](spec/layers/07-data-model-layer.md)               | STRUCTURE    | JSON Schema   |
| 08  | [Datastore](spec/layers/08-datastore-layer.md)                 | STORAGE      | SQL DDL       |
| 09  | [UX](spec/layers/09-ux-layer.md)                               | PRESENTATION | Custom        |
| 10  | [Navigation](spec/layers/10-navigation-layer.md)               | FLOW         | Custom        |
| 11  | [APM/Observability](spec/layers/11-apm-observability-layer.md) | OBSERVE      | OpenTelemetry |

## Standards Leveraged

This project maximizes use of existing standards:

- **ArchiMate 3.2** - Motivation, Business, Application, Technology layers
- **OpenAPI 3.0** - API specifications
- **JSON Schema Draft 7** - Data model definitions
- **OpenTelemetry 1.0+** - Observability and tracing
- **SQL DDL** - Database schemas
- **Custom Specifications** - Security, UX, Navigation

## Getting Started

Want to use this for modeling your project?

1. **Understand the Approach**
   - Read [spec/core/00-overview.md](spec/core/00-overview.md)
   - Review [spec/core/01-federated-approach.md](spec/core/01-federated-approach.md)

2. **Install the CLI**

   ```bash
   cd cli
   pip install -e .
   ```

3. **Create Your First Model**

   ```bash
   dr init my-project # creates a documentation-robotics folder at the project root
   dr add motivation goal --name "My First Goal"
   dr validate
   ```

4. **Learn More**
   - Browse [spec/examples/](spec/examples/)
   - Read [spec/guides/getting-started.md](spec/guides/getting-started.md)

Evaluating this approach?

1. Read [spec/core/](spec/core/) for design decisions
2. Review [spec/reference/standards-mapping.md](spec/reference/standards-mapping.md)
3. Compare with existing approaches
4. Check [spec/GOVERNANCE.md](spec/GOVERNANCE.md) for governance model

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

## Governance

- **Specification:** See [spec/GOVERNANCE.md](spec/GOVERNANCE.md)
- **Changes:** Follow governance process for changes
- **Releases:** See [RELEASE_PROCESS.md](RELEASE_PROCESS.md)
- **Versioning:** Semantic Versioning 2.0.0

## Versions

| Component         | Current Version | Status                    |
| ----------------- | --------------- | ------------------------- |
| **Specification** | 0.2.0           | Stable                    |
| **CLI Tool**      | 0.4.0           | Feature Complete + Agents |

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.

## Support

- **Questions:** [GitHub Discussions](https://github.com/tinkermonkey/documentation_robotics/discussions)
- **Issues:** [GitHub Issues](https://github.com/tinkermonkey/documentation_robotics/issues)
- **Specification Issues:** Use "Specification Bug Report" template
- **CLI Issues:** Use "CLI Bug Report" template

## Citation

If you use this specification in academic work, please cite:

```bibtex
@techreport{documentation-robotics-spec,
  title = {Documentation Robotics Specification},
  version = {0.1.1},
  year = {2025},
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
- Install the CLI: `pip install -e cli/`
- Join the discussion: [GitHub Discussions](https://github.com/tinkermonkey/documentation_robotics/discussions)
