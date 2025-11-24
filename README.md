# Documentation Robotics

A comprehensive toolkit for managing federated architecture metadata models using industry standards.

[![CLI Tests](https://github.com/tinkermonkey/documentation_robotics/actions/workflows/cli-tests.yml/badge.svg)](https://github.com/tinkermonkey/documentation_robotics/actions/workflows/cli-tests.yml)

[![Specification](https://img.shields.io/badge/Specification-v0.1.0-blue)](spec/)
[![CLI Version](https://img.shields.io/badge/CLI-v0.3.0-green)](cli/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Overview

Documentation Robotics provides:

- **A Specification** - Federated Architecture Metadata Model for complex software systems
- **A CLI Tool** - `dr` command for managing architecture models
- **Standards Integration** - Leverages ArchiMate, OpenAPI, JSON Schema, OpenTelemetry

## Quick Links

- 📖 **[Read the Specification](spec/)** - Complete specification with all 11 layers
- 🛠️ **[Use the CLI Tool](cli/)** - Install and use the `dr` command
- 🤝 **[Contributing](CONTRIBUTING.md)** - How to contribute
- 📋 **[Release Process](RELEASE_PROCESS.md)** - How releases work

## Project Components

### 1. The Specification

**Location:** [`spec/`](spec/)
**Version:** 0.1.0 (Stable)
**Status:** Complete

The Federated Architecture Metadata Model specification defines a standards-based approach to modeling enterprise and software architecture across 11 interconnected layers.

**Key Features:**

- ✅ **Standards-First** - Uses ArchiMate, OpenAPI, JSON Schema, OpenTelemetry
- ✅ **Federated Approach** - ArchiMate spine + specialized standards
- ✅ **11 Layers** - Motivation through APM/Observability
- ✅ **Minimal Custom Invention** - Only 3 custom specifications (27%)
- ✅ **Tool Ecosystem Access** - Compatible with hundreds of existing tools

**Quick Start:**

1. Read [spec/README.md](spec/README.md)
2. Explore [spec/core/00-overview.md](spec/core/00-overview.md)
3. Browse [spec/examples/](spec/examples/)

[→ Full Specification Documentation](spec/)

### 2. The CLI Tool (`dr`)

**Location:** [`cli/`](cli/)
**Version:** 0.3.0
**Status:** Phase 3 Complete

A command-line tool for managing architecture models conforming to the specification.

**Key Features:**

- ✅ **Full Conformance** - Implements all 11 layers
- ✅ **Model Management** - Initialize, add, update, validate
- ✅ **Cross-Layer References** - Track and validate relationships
- ✅ **Export Formats** - ArchiMate, OpenAPI, PlantUML, Markdown, GraphML
- ✅ **Standards-Based** - Uses specification v0.1.0

**Quick Start:**

```bash
# Install
pip install -e cli/

# Initialize a model
dr init my-project

# Add elements
dr add motivation goal --name "Improve Customer Satisfaction"

# Validate
dr validate

# Check conformance
dr conformance
```

[→ Full CLI Documentation](cli/)

## Repository Structure

```
documentation_robotics/
│
├── spec/                        # THE SPECIFICATION
│   ├── VERSION                  # Current spec version (0.1.0)
│   ├── CHANGELOG.md             # Specification changelog
│   ├── GOVERNANCE.md            # Governance model
│   ├── CONTRIBUTING.md          # Contribution guidelines
│   ├── core/                    # Core specification documents
│   ├── layers/                  # 11 layer specifications
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

- **ArchiMate 3.2** - Motivation, Business, Application, Technology layers (36%)
- **OpenAPI 3.0** - API specifications (9%)
- **JSON Schema Draft 7** - Data model definitions (9%)
- **OpenTelemetry 1.0+** - Observability and tracing (9%)
- **SQL DDL** - Database schemas (9%)
- **Custom Specifications** - Security, UX, Navigation (27%)

**Result:** 73% standards-based, 27% custom invention

## Getting Started

### For Architects

Want to use this for modeling your architecture?

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
   dr init my-architecture
   cd my-architecture
   dr add motivation goal --name "My First Goal"
   dr validate
   ```

4. **Learn More**
   - Browse [spec/examples/](spec/examples/)
   - Read [spec/guides/getting-started.md](spec/guides/getting-started.md)

### For Tool Vendors

Want to build a conformant tool?

1. **Read the Specification**
   - Start with [spec/README.md](spec/README.md)
   - Review [spec/conformance/conformance-levels.md](spec/conformance/conformance-levels.md)

2. **Choose Conformance Level**
   - Basic (Layers 01-04)
   - Standard (Layers 01-08)
   - Full (All 11 layers)

3. **Implement & Test**
   - Use [spec/schemas/](spec/schemas/) for validation
   - Test with [spec/test-fixtures/](spec/test-fixtures/)
   - Follow [spec/conformance/test-suite.md](spec/conformance/test-suite.md)

4. **Claim Conformance**
   - Follow [spec/conformance/certification-process.md](spec/conformance/certification-process.md)
   - Submit conformance statement

### For Researchers

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

- 🐛 Report issues or ambiguities in the specification
- 💡 Propose new features or improvements
- 📝 Improve documentation
- 🧪 Add test fixtures
- 🎨 Create example models
- 🛠️ Improve the CLI tool

## Governance

- **Specification:** See [spec/GOVERNANCE.md](spec/GOVERNANCE.md)
- **Changes:** Follow governance process for changes
- **Releases:** See [RELEASE_PROCESS.md](RELEASE_PROCESS.md)
- **Versioning:** Semantic Versioning 2.0.0

## Versions

| Component         | Current Version | Status           |
| ----------------- | --------------- | ---------------- |
| **Specification** | 0.1.0           | Stable           |
| **CLI Tool**      | 0.3.0           | Phase 3 Complete |

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.

## Support

- **Questions:** [GitHub Discussions](https://github.com/yourorg/documentation_robotics/discussions)
- **Issues:** [GitHub Issues](https://github.com/yourorg/documentation_robotics/issues)
- **Specification Issues:** Use "Specification Bug Report" template
- **CLI Issues:** Use "CLI Bug Report" template

## Citation

If you use this specification in academic work, please cite:

```bibtex
@techreport{federated-arch-spec,
  title = {Federated Architecture Metadata Model Specification},
  version = {0.1.0},
  year = {2025},
  url = {https://github.com/yourorg/documentation_robotics/tree/main/spec}
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

- 📖 Read the specification: [spec/README.md](spec/README.md)
- 🛠️ Install the CLI: `pip install -e cli/`
- 💬 Join the discussion: [GitHub Discussions](https://github.com/yourorg/documentation_robotics/discussions)
