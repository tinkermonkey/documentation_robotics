# Documentation Robotics Specification

> **Part of [Documentation Robotics](../README.md)** - For project overview and tooling, see the [main README](../README.md).

[![Specification](https://img.shields.io/badge/Specification-v0.1.1-blue)](.)
[![CLI Version](https://img.shields.io/badge/CLI-v0.3.1-green)](../cli/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)

**Version:** 0.1.1
**Status:** Draft
**Last Updated:** 2025-11-23

## Overview

This directory contains the complete Documentation Robotics Specification, a standards-based approach to modeling enterprise and software architecture as a federated architecture data model across 11 interconnected layers.

## Quick Links

- **[Read the Spec](#how-to-read-this-specification)** - Start with [core/00-overview.md](core/00-overview.md)
- **[Implement a Tool](conformance/conformance-levels.md)** - Conformance requirements
- **[Browse Examples](examples/)** - Practical patterns
- **[Use the CLI](../cli/)** - Reference implementation
- **[Contribute](CONTRIBUTING.md)** - How to contribute
- **[Governance](GOVERNANCE.md)** - Change process

## Directory Structure

```
spec/
├── VERSION                     # Current specification version
├── CHANGELOG.md                # Version history and changes
├── GOVERNANCE.md               # Governance model
├── CONTRIBUTING.md             # Contribution guidelines
├── README.md                   # This file
│
├── core/                       # Core specification (normative)
│   ├── 00-overview.md          # Specification overview
│   ├── 01-federated-approach.md    # Federation pattern
│   ├── 02-layering-philosophy.md   # Layer ordering rationale
│   ├── 03-cross-layer-integration.md   # Integration patterns
│   ├── 04-reference-directionality.md  # Traceability approach
│   └── 05-validation-strategy.md   # Multi-layer validation
│
├── layers/                     # Layer specifications (normative)
│   ├── 01-motivation-layer.md      # WHY - Goals, requirements
│   ├── 02-business-layer.md        # WHAT - Business processes
│   ├── 03-security-layer.md        # WHO CAN - Access control
│   ├── 04-application-layer.md     # HOW - Application services
│   ├── 05-technology-layer.md      # WITH WHAT - Technology stack
│   ├── 06-api-layer.md             # INTERFACE - Service contracts
│   ├── 07-data-model-layer.md      # STRUCTURE - Data definitions
│   ├── 08-datastore-layer.md       # STORAGE - Database schemas
│   ├── 09-ux-layer.md              # PRESENTATION - User experience
│   ├── 10-navigation-layer.md      # FLOW - Navigation patterns
│   └── 11-apm-observability-layer.md   # OBSERVE - Monitoring
│
├── schemas/                    # JSON Schemas (normative)
│   ├── README.md
│   ├── federated-architecture.schema.json  # Master schema
│   ├── 01-motivation-layer.schema.json
│   ├── 02-business-layer.schema.json
│   └── ...                     # One schema per layer
│
├── conformance/                # Conformance requirements (normative)
│   ├── README.md
│   ├── conformance-levels.md       # Basic/Standard/Full levels
│   ├── test-suite.md               # Required validation tests
│   └── certification-process.md    # How to claim conformance
│
├── guides/                     # Implementation guides (informative)
│   ├── README.md
│   ├── getting-started.md
│   ├── LAYER_INTEGRATION_GUIDE.md
│   ├── migration-guide.md
│   ├── best-practices.md
│   └── anti-patterns.md
│
├── examples/                   # Example models (informative)
│   ├── README.md
│   ├── minimal/                    # Minimal conformant model
│   ├── e-commerce/                 # E-commerce example
│   └── microservices/              # Microservices example
│
├── test-fixtures/              # Test data for validators (normative)
│   ├── README.md
│   ├── valid/                      # Must pass validation
│   │   ├── motivation/
│   │   ├── business/
│   │   └── ...
│   └── invalid/                    # Must fail validation
│       ├── missing-required-fields/
│       ├── invalid-references/
│       └── ...
│
├── extensions/                 # Extension guidelines (informative)
│   ├── README.md
│   ├── extension-guidelines.md
│   └── registry.md
│
└── reference/                  # Reference materials (informative)
    ├── glossary.md
    ├── entity-index.md
    ├── relationship-index.md
    ├── standards-mapping.md
    └── bibliography.md
```

## The Vision

The specification aims to be a comprehensive, standards-based approach to describing:

- **What** a software system is
- **How** it works
- **Why** it works that way
- **How to observe it** in production

**Key Principles:**

- **Standards-first** - Use excellent existing standards to their fullest extent
- **Minimal invention** - Only add glue between standards and fill critical gaps
- **Federated approach** - Each layer uses optimal standards, integrated via ArchiMate spine
- **As simple as possible** - While being reasonably complete
- **Tool ecosystem access** - Compatible with hundreds of existing tools

For the broader motivation, see [The Need](../README.md#the-need) in the main README.

## How to Read This Specification

1. Start with [core/00-overview.md](core/00-overview.md) - Get the big picture
2. Read [core/01-federated-approach.md](core/01-federated-approach.md) - Understand why federation
3. Read [core/02-layering-philosophy.md](core/02-layering-philosophy.md) - Understand layer ordering
4. Browse layer specifications relevant to your work
5. Check [examples/](examples/) for practical patterns
6. Use [guides/getting-started.md](guides/getting-started.md) to start modeling

**Time Investment:** 2-3 hours for overview, then explore as needed

## Specification Highlights

### Standards-First Approach

This specification **leverages existing standards** for most of its layers:

| Standard            | Layers         | Status      |
| ------------------- | -------------- | ----------- |
| ArchiMate 3.2       | 01, 02, 04, 05 | Established |
| OpenAPI 3.0         | 06             | Established |
| JSON Schema Draft 7 | 07             | Established |
| OpenTelemetry 1.0+  | 11             | Established |
| SQL DDL             | 08             | Established |
| **Custom**          | 03, 09, 10     | New         |

**Result:** Maximum tool ecosystem compatibility with only 27% custom invention.

For more details, see [Standards Leveraged](../README.md#standards-leveraged) in the main README.

### 11 Interconnected Layers

The specification defines 11 layers that cover the complete software system lifecycle:

```
01. Motivation       WHY        Goals, requirements, stakeholders
02. Business         WHAT       Business processes and services
03. Security         WHO CAN    Access control and policies
04. Application      HOW        Application services and components
05. Technology       WITH WHAT  Technology stack and platforms
06. API              INTERFACE  Service contracts (OpenAPI)
07. Data Model       STRUCTURE  Data definitions (JSON Schema)
08. Datastore        STORAGE    Database schemas (SQL DDL)
09. UX               PRESENT    User experience specifications
10. Navigation       FLOW       Navigation and routing
11. APM              OBSERVE    Monitoring and tracing (OTel)
```

For detailed layer descriptions and relationships, see [The 11 Layers](../README.md#the-11-layers) in the main README.

Each layer specification includes:

- **Purpose** - What the layer models
- **Entity Types** - Elements that can be defined
- **Relationships** - How elements relate within and across layers
- **Standards** - Which standard is used (if applicable)
- **Validation Rules** - What makes a valid layer model

### Federation Pattern

ArchiMate serves as the architectural **spine**, integrating specialized standards:

```
    ArchiMate Model (Structural Spine)
            │
    ┌───────┼───────┬───────┬───────┐
    ▼       ▼       ▼       ▼       ▼
OpenAPI  JSON     UX     Security  OTel
 Specs  Schema   Specs   Model   Config
```

Each layer validates independently, then cross-layer references are validated.

### Pragmatic Layer Ordering

Layers are ordered to match **real-world design workflow**:

1. **Strategy First** (Layers 01-03) - Why, what, who can
2. **Architecture** (Layers 04-05) - How and with what (technology as constraint)
3. **Detailed Design** (Layers 06-10) - Specifications within tech constraints
4. **Operations** (Layer 11) - Runtime observability

See [core/02-layering-philosophy.md](core/02-layering-philosophy.md) for rationale.

## Key Features

✅ **Standards-Based** - Uses ArchiMate, OpenAPI, JSON Schema, OpenTelemetry
✅ **Tool-Friendly** - Compatible with hundreds of existing tools
✅ **Federated** - Each layer uses optimal standard, integrated via ArchiMate
✅ **Validated** - JSON Schemas and conformance test suite included
✅ **Extensible** - Clear extension points for domain-specific needs
✅ **Traceable** - Cross-layer references enable requirements traceability
✅ **Pragmatic** - Layer ordering matches real-world workflows

## Conformance Levels

Implementations can claim three conformance levels:

| Level        | Layers | Use Case                                       |
| ------------ | ------ | ---------------------------------------------- |
| **Basic**    | 01-04  | Small projects, motivation through application |
| **Standard** | 01-08  | Most projects, through database design         |
| **Full**     | 01-11  | Enterprise projects, complete traceability     |

See [conformance/conformance-levels.md](conformance/conformance-levels.md) for details.

## Getting Started

### Read the Specification

```bash
# Clone the repository
git clone https://github.com/yourorg/documentation_robotics.git
cd documentation_robotics/spec

# Read in order
1. core/00-overview.md
2. core/01-federated-approach.md
3. core/02-layering-philosophy.md
4. layers/01-motivation-layer.md
5. ... (continue with layers relevant to you)
```

### Validate an Example

```bash
# Install a conformant tool (e.g., dr CLI)
pip install documentation-robotics

# Initialize a model from an example
cd examples/minimal
dr validate --all

# See validation results
```

### Implement a Tool

1. Read [conformance/conformance-levels.md](conformance/conformance-levels.md)
2. Choose a conformance level
3. Implement layers according to [schemas/](schemas/)
4. Validate against [test-fixtures/](test-fixtures/)
5. Follow [conformance/certification-process.md](conformance/certification-process.md)

## Version Information

**Current Version:** 0.1.1
**Release Date:** 2025-11-23
**Status:** Draft
**Next Review:** 2026-05-23

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- How to report issues
- How to propose changes
- Style guidelines
- Review process

## Governance

This specification follows a defined governance model. See [GOVERNANCE.md](GOVERNANCE.md) for:

- Change process
- Decision-making
- Versioning policy
- Deprecation policy

## Support

- **Questions:** GitHub Discussions
- **Issues:** GitHub Issues
- **Implementation Help:** See [guides/](guides/)
- **Conformance Questions:** See [conformance/](conformance/)

## License

This specification is licensed under the MIT License. See [../LICENSE](../LICENSE) for details.

## Acknowledgments

This specification builds upon and integrates:

- **ArchiMate®** - Registered trademark of The Open Group
- **OpenAPI Specification** - OpenAPI Initiative
- **JSON Schema** - JSON Schema team
- **OpenTelemetry** - Cloud Native Computing Foundation
- **W3C Trace Context** - World Wide Web Consortium

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

---

**Ready to get started?** Begin with [core/00-overview.md](core/00-overview.md)
