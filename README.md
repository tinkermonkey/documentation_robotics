# Documentation Robotics

![Documentation Robotics Header](docs/logo/page-header.png)

A comprehensive toolkit for managing federated data models for modeling large software systems using industry standards.

[![CLI Tests](https://github.com/tinkermonkey/documentation_robotics/actions/workflows/cli-tests.yml/badge.svg)](https://github.com/tinkermonkey/documentation_robotics/actions/workflows/cli-tests.yml)

[![Specification](https://img.shields.io/badge/Specification-v0.8.1-blue)](spec/)
[![CLI Version](https://img.shields.io/badge/CLI-v0.1.0-green)](cli/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Overview

Documentation Robotics provides:

- **A Specification** - A federated data model for modeling complex software systems
- **A CLI Tool** - `dr` command for managing models according to the specification
- **Standards Integration** - Leverages ArchiMate, OpenAPI, JSON Schema, OpenTelemetry

---

## The Challenge

Modern software systems are complex, distributed, and constantly evolving. Working with large cross-functional teams to design, build, and maintain these systems is a significant challenge. Communicating business intent and the art of the possible across business, architecture, and engineering teams is difficult. Creating a robust feedback loop between these groups throughout the product development lifecycle / software development lifecycle is even more difficult. Good communication is required to move quickly and effectively and to manage risk, but often it's out of the reach of many organizations.

As the rate of software development accelerates with the adoption of generative AI and agentic development tools, this challenge is both increasing in scale and complexity for these large teams, but also, it is bringing these cognitive bottlenecks down to level of solo developer building with agentic tools. We can now code faster than we can effectively design, document, and communicate about what we're building. Coordinating across the various layers of a software system, from business requirements to architecture to implementation details, and creating a feedback loop which allows a developer to be confident that the output aligns with the intent is now the bottleneck for productivity.

There are many strategies and tools which help with this, but at some point to scale out the human in the loop has to transcend the implementation details and be able to reason about the system at a higher level consistently and be able to provide precise direction based on that higher level thought, and it needs to work with whatever tools are being used for implementation.

**Documentation Robotics** aims to address this challenge by providing a standards-based, federated approach to modeling complex software systems that is easy to use, maintain, and integrate into existing development workflows.

## The Specification

The vision for the spec is to be able to descibe what a software system is, how it works, and why it works that way, in a form that is both human readable and machine readable. To accomplish this the spec needs to be comprehensive. To make it broadly useful it should be (as much as possible) a standards-based approach. There are many excellent specifications and "standards" covering much of this, and they have been used to their fullest extent: minimizing invention, but also adding some glue between them and a few "missing" layers to take a stab at a unified and holistic modeling framework that is not overly complex.

## The Tooling

The goal for the tooling is to provide a tool that makes it easy and efficient to create, manage, validate, and export models that conform to the specification. With the adoption of infrastructure-as-code, APM, specs like OpenAPI, JSON Schema, and OpenTelemetry, much of this data is available some form to technologists. AI-assisted development make it much easiers to generate, extract, and maintain this metadata as part of the software development lifecycle to fill in the gaps. With a unified data model and tooling, it can be easier for humans and AI agents to better understand, communicate, and evolve complex software systems.

The vision is to be able to explore adding functionality to a system at any level that we happen to be envisioning it, whether that's the business layer, application layer, API layer, data model layer, etc, and from that vision point, to project those changes into the other layers to explore impact and opportunity. Having a defined model that spans all these layers makes it easier to ensure consistency and traceability across the entire system design.

The CLI is a quick way for both humans and automated systems (CI/CD, AI agents, etc.) to manage these models in a collaborative manner. On top of the CLI, tools like sub-agents, custom commands, and other automation scripts can be built to further streamline the process of managing system models in a way that is not tied to a specific agentic ecosystem or vendor. We've started with a Claude Code integration to enable natural language interaction with the models, but the vision is to enable a wide variety of integrations and automation around this unified data model.

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

- **Standards-First** - Uses ArchiMate, OpenAPI, JSON Schema, OpenTelemetry
- **Federated Approach** - ArchiMate spine + specialized standards
- **12 Layers** - Motivation through APM/Observability
- **Glue Layers** - 4 custom layer definitions (security, UX, navigation, testing)
- **Tool Ecosystem Access** - Compatible with hundreds of existing tools through standards-based exports

**Quick Start:**

1. Read [spec/README.md](spec/README.md)
2. Explore [spec/core/00-overview.md](spec/core/00-overview.md)
3. Browse [spec/examples/](spec/examples/)

[→ Full Specification Documentation](spec/)

### 2. The CLI Tool (`dr`)

**Location:** [`cli/`](cli/)
**Status:** Production-ready

A TypeScript-based command-line tool for managing project models conforming to the specification.

**Key Features:**

- ✅ **Model Management** - Initialize, add, update, validate
- ✅ **Agentic Assistants** - Claude Code and Github Copilot agents for model generation, maintenance, and exploration
- ✅ **Link Registry** - 60+ cross-layer reference patterns with automated validation
- ✅ **Link Management** - Discover, validate, trace, and document inter-layer links
- ✅ **Managed Upgrades** - Automated migration between specification versions
- ✅ **Export Formats** - ArchiMate, OpenAPI, PlantUML, Markdown, GraphML
- ✅ **Visualization Server** - Serves interactive model visualizations for easier exploration and validation
- ✅ **Fast Performance** - ~150ms startup time, 8x faster than legacy implementations

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

[→ CLI Documentation](cli/) | [→ CLI User Guide](cli/docs/user-guide/)

## Repository Structure

```
documentation_robotics/
│
├── spec/                        # SPECIFICATION
│   ├── VERSION                  # Spec version (see badges above)
│   ├── CHANGELOG.md             # Specification changelog
│   ├── layers/                  # 12 layer specifications
│   ├── schemas/                 # JSON Schema definitions
│   ├── core/                    # Core specification docs
│   ├── guides/                  # Implementation guides
│   └── examples/                # Example models
│
├── cli/                         # TYPESCRIPT CLI
│   ├── src/                     # TypeScript source code
│   │   ├── commands/            # Command implementations
│   │   ├── core/                # Domain models
│   │   ├── validators/          # Validation pipeline
│   │   ├── export/              # Export handlers
│   │   └── server/              # Visualization server
│   ├── tests/                   # Test suite
│   └── README.md                # CLI documentation
│
├── .github/workflows/           # CI/CD workflows
├── README.md                    # This file
├── CLAUDE.md                    # AI assistant instructions
├── CONTRIBUTING.md              # Contribution guidelines
└── LICENSE                      # MIT License
```

## The 12 Layers

The specification defines 12 interconnected layers:

| #   | Layer                                                          | Focus        | Standard      | Notes                                                   |
| --- | -------------------------------------------------------------- | ------------ | ------------- | ------------------------------------------------------- |
| 01  | [Motivation](spec/layers/01-motivation-layer.md)               | WHY          | ArchiMate 3.2 |                                                         |
| 02  | [Business](spec/layers/02-business-layer.md)                   | WHAT         | ArchiMate 3.2 |                                                         |
| 03  | [Security](spec/layers/03-security-layer.md)                   | WHO CAN      | _Custom_      |                                                         |
| 04  | [Application](spec/layers/04-application-layer.md)             | HOW          | ArchiMate 3.2 |                                                         |
| 05  | [Technology](spec/layers/05-technology-layer.md)               | WITH WHAT    | ArchiMate 3.2 |                                                         |
| 06  | [API](spec/layers/06-api-layer.md)                             | INTERFACE    | OpenAPI 3.0   |                                                         |
| 07  | [Data Model](spec/layers/07-data-model-layer.md)               | STRUCTURE    | JSON Schema   |                                                         |
| 08  | [Data Store](spec/layers/08-data-store-layer.md)               | STORAGE      | SQL DDL       |                                                         |
| 09  | [UX](spec/layers/09-ux-layer.md)                               | PRESENTATION | _Custom_      | Three-tier architecture: Libraries, Applications, Specs |
| 10  | [Navigation](spec/layers/10-navigation-layer.md)               | FLOW         | _Custom_      |                                                         |
| 11  | [APM/Observability](spec/layers/11-apm-observability-layer.md) | OBSERVE      | OpenTelemetry |                                                         |
| 12  | [Testing](spec/layers/12-testing-layer.md)                     | VERIFY       | _Custom_      |                                                         |

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
   dr add motivation goal motivation-goal-first --name "My First Goal"
   dr validate
   ```

3. **Learn More**
   - Browse [spec/examples/](spec/examples/)
   - Read [spec/guides/getting-started.md](spec/guides/getting-started.md)
   - Review [cli/docs/user-guide/](cli/docs/user-guide/)

### For Evaluators

Evaluating this approach?

1. Read [spec/core/](spec/core/) for design decisions
2. Review [spec/reference/standards-mapping.md](spec/reference/standards-mapping.md)
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
| **Specification** | 0.8.1   | Stable           |
| **CLI Tool**      | 0.1.1   | Production-ready |

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
