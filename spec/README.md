# Documentation Robotics Specification

> **Part of [Documentation Robotics](../README.md)** - For project overview and tooling, see the [main README](../README.md).

[![Specification](https://img.shields.io/badge/Specification-v0.8.1-blue)](.)
[![CLI Version](https://img.shields.io/badge/CLI-v0.1.0-green)](../cli/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)

**Version:** 0.8.1
**Status:** Draft
**Last Updated:** 2026-02-28

## Overview

This directory contains the complete Documentation Robotics Specification, a standards-based approach to modeling enterprise and software architecture as a federated architecture data model across 12 interconnected layers.

## Quick Links

- **[Browse Layer Specifications](layers/)** - 12 interconnected layers
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
├── layers/                     # Layer specifications (normative)
│   ├── 01-motivation.layer.json    # Source of truth (JSON spec instance)
│   ├── 01-motivation-layer.md      # Generated markdown (human-readable)
│   ├── 02-business.layer.json
│   ├── 02-business-layer.md
│   ├── ...                         # One .layer.json + .md pair per layer
│   ├── 12-testing.layer.json
│   └── 12-testing-layer.md
│
├── nodes/                      # Node type schemas (v0.8.0+)
│   ├── motivation/                 # Per-layer subdirectories
│   │   ├── goal.node.schema.json   # Per-type JSON Schema extending spec-node base
│   │   ├── requirement.node.schema.json
│   │   └── ...
│   ├── business/
│   ├── security/
│   ├── application/
│   ├── technology/
│   ├── api/
│   ├── data-model/
│   ├── data-store/
│   ├── ux/
│   ├── navigation/
│   ├── apm/
│   └── testing/
│
├── relationships/              # Relationship type schemas (v0.8.0+)
│   ├── motivation/                 # Per-layer subdirectories
│   ├── business/
│   ├── ...                         # Relationship schemas per layer
│   └── testing/
│
├── schemas/                    # JSON Schemas (normative)
│   ├── base/                        # Spec-level base schemas (v0.8.0+)
│   │   ├── spec-layer.schema.json           # Validates .layer.json files
│   │   ├── spec-node.schema.json            # Base schema for model node instances
│   │   ├── spec-node-relationship.schema.json  # Spec relationship schemas
│   │   ├── model-node-relationship.schema.json # Model-level relationship validation
│   │   ├── predicate-catalog.schema.json    # Predicate catalog schema
│   │   ├── predicates.json                  # Semantic predicate definitions
│   │   ├── attribute-spec.schema.json       # AttributeSpec for relationship attributes
│   │   └── source-references.schema.json    # Source code location tracking
│   ├── nodes/                       # Per-layer node schemas (links to ../nodes/)
│   ├── relationships/               # Per-layer relationship schemas (links to ../relationships/)
│   ├── 01-motivation-layer.schema.json
│   ├── 02-business-layer.schema.json
│   └── ...                          # One schema per layer
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

## Schema-Driven Documentation Model

As of v0.8.0, the specification uses a **schema-driven documentation model** where JSON spec instances are the source of truth and markdown is generated for human readability.

### Schema Architecture

- **Base schema** (`schemas/base/spec-node.schema.json`) - Validates model node instances with common fields (id, spec_node_id, type, name, attributes, metadata)
- **Per-type schemas** (`nodes/**/*.node.schema.json`) - Extend the base schema via `allOf` to add type-specific attribute constraints
- **Spec-level schemas** (`schemas/base/`) - Validate specification artifacts (`.layer.json` files, relationships)
- **Model-level schemas** (`schemas/*.schema.json`) - Validate architecture model instances created by users

### Source of Truth

- **`.layer.json` files** (`spec/layers/`) - Define each layer's metadata, purpose, entity types, and relationships
- **`.node.schema.json` files** (`spec/schemas/nodes/`) - Per-type JSON Schemas defining type-specific attribute constraints for model node instances
- **Generated `.md` files** (`spec/layers/`) - Human-readable markdown generated from JSON specs

### Workflow

1. Edit the JSON source files (`.layer.json` or `.node.schema.json`)
2. Run `dr docs generate` to regenerate markdown
3. Run `dr docs validate` to verify JSON/markdown sync
4. Commit both JSON schemas and generated markdown

See [docs/SCHEMA_DRIVEN_DOCS.md](../docs/SCHEMA_DRIVEN_DOCS.md) for full details on the schema-driven documentation model.

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

1. Start with the [main README](../README.md) - Get the big picture and understand the 12-layer architecture
2. Browse [layer specifications](layers/) relevant to your work
3. Use the [CLI tool](../cli/) to validate and work with models

> **Note:** The `.md` files in `spec/layers/` are generated from JSON spec instances (`.layer.json` and `.node.schema.json`). To modify layer specifications, edit the JSON source files and run `dr docs generate` to regenerate markdown.

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
| **Custom**          | 03, 09, 10, 12 | New         |

**Result:** Maximum tool ecosystem compatibility with only 33% custom invention.

For more details, see [Standards Leveraged](../README.md#standards-leveraged) in the main README.

### 12 Interconnected Layers

The specification defines 12 layers that cover the complete software system lifecycle:

```
01. Motivation       WHY        Goals, requirements, stakeholders
02. Business         WHAT       Business processes and services
03. Security         WHO CAN    Access control and policies
04. Application      HOW        Application services and components
05. Technology       WITH WHAT  Technology stack and platforms
06. API              INTERFACE  Service contracts (OpenAPI)
07. Data Model       STRUCTURE  Data definitions (JSON Schema)
08. Data Store       STORAGE    Database schemas (SQL DDL)
09. UX               PRESENT    User experience (three-tier: libraries, applications, specs)
10. Navigation       FLOW       Navigation and routing
11. APM              OBSERVE    Monitoring and tracing (OTel)
12. Testing          VERIFY     Test coverage modeling
```

For detailed layer descriptions and relationships, see [The 12 Layers](../README.md#the-12-layers) in the main README.

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

## Recent Enhancements

### Schema-Driven Documentation Model (v0.8.0)

The v0.8.0 release introduces a schema-driven documentation model where JSON spec instances are the source of truth:

- **Schema-Driven Architecture** - JSON spec instances (`.layer.json`, `.node.schema.json`) are the authoritative source; markdown is generated
- **Base Schemas Directory** (`spec/schemas/base/`) - 6 schemas for validating spec-level and model-level artifacts
- **Per-Type Node Schemas** (`spec/schemas/nodes/**/*.node.schema.json`) - JSON Schemas extending the base schema with type-specific attribute constraints
- **Layer Metadata Files** (`spec/layers/*.layer.json`) - Layer-level metadata, purpose, entity types, and relationship declarations
- **Documentation Generation** - `dr docs generate` produces markdown from JSON specs; `dr docs validate` ensures sync
- **Link Registry Removal** - The deprecated `link-registry.json` (deprecated in v0.7.0) has been removed; use `relationship-catalog.json` instead

See [CHANGELOG.md](CHANGELOG.md#080---2026-02-07) for complete details.

### Source Code Reference Infrastructure (v0.7.1)

The v0.7.1 release formalizes the source reference infrastructure for linking architecture elements to source code locations:

- **🔍 Common Schemas Directory** - Canonical location for cross-layer schemas
  - `source-references.schema.json` - Links architecture elements to code locations
  - `layer-extensions.schema.json` - Layer metadata and relationship structures
  - `relationships.schema.json` - Relationship type definitions
  - `predicates.schema.json` - Predicate semantics
- **📍 Source Reference Integration** - 10 layers now support source code linking
  - **ArchiMate Layers** (04, 05, 09, 10, 11, 12): Use `properties.source.reference` nested pattern
  - **Custom Security Layer** (03): Uses `properties.source.reference` nested pattern
  - **OpenAPI Layers** (06, 07, 08): Use `x-source-reference` extension pattern
  - **Layer 03**: 10 entity types (AuthenticationConfig, SecurityPolicy, PolicyRule, PolicyAction, RateLimit, AuditConfig, Condition, ValidationRule, Countermeasure, Threat)
  - **Layer 05**: 7 entity types (Node, SystemSoftware, TechnologyProcess, CommunicationNetwork, Artifact, TechnologyInterface, TechnologyService)
- **🏷️ Provenance Tracking** - Four-value enum distinguishing reference origins
  - `extracted` - Automated tooling ingestion
  - `manual` - Human entry
  - `inferred` - Pattern matching analysis
  - `generated` - Code generated from model

See [CHANGELOG.md](CHANGELOG.md#071---2026-01-07) for complete details.

### Ontology Refinement & Relationship Modeling (v0.6.0)

The v0.6.0 release delivers comprehensive relationship modeling across all 12 layers:

- **📖 Relationship Taxonomy** - Formalized 6 categories with 60+ predicates (ArchiMate 3.2 aligned)
  - Structural, Behavioral, Dependency, Traceability, Governance, Domain-Specific
  - Bidirectional navigation with inverse predicates
  - Formal semantics for transitivity and symmetry
- **🔗 Enhanced Cross-Layer References** - 60+ documented reference patterns
  - 4 pattern types: X-Extensions, Dot-Notation, Nested Objects, Direct Fields
  - Naming conventions and best practices
- **📐 Common Schema Infrastructure** - 5 new schemas for relationship validation
  - Predicates, relationships, link registry, relationship catalog
- **📋 Layer Template** - Standardized template for consistency across all layers

See [CHANGELOG.md](CHANGELOG.md#060---2025-12-14) for complete details.

### UX Layer Three-Tier Architecture (v0.5.0)

The UX Layer has been redesigned with a three-tier component library architecture that optimizes for both reusability and simplicity:

- **📚 Tier 1: UXLibrary** - Reusable design system components, sub-views, and state patterns
  - Define components once, reuse across applications
  - Component variants, slots for customization, data contracts
  - State machine templates (CRUD, Wizard, Search patterns)
- **🏢 Tier 2: UXApplication** - Application-level organization and shared configuration
  - Theme/design tokens for consistent styling
  - Shared layouts (AdminLayout, PublicLayout, etc.)
  - Global state management and library imports
- **📄 Tier 3: UXSpec** - Simplified experience-specific configuration
  - References library components instead of inline definitions
  - ~73% reduction in YAML (300 → 80 lines typical)
  - Pattern extension binding for state machines

**Benefits:**

- **Design System Alignment** - Maps naturally to Figma/Storybook workflows
- **Enterprise Scale** - Multiple apps share design system libraries
- **DRY Principle** - Single source of truth for component behavior
- **Backward Compatible** - Existing flat UXSpecs continue to work

**Complete Specification:**

- **Layer 09 Specification**: [layers/09-ux-layer.md](layers/09-ux-layer.md)
- **JSON Schema**: [schemas/09-ux-layer.schema.json](schemas/09-ux-layer.schema.json)
- **Migration Guide**: Included in layer specification
- **New Entities**: UXLibrary, LibraryComponent, LibrarySubView, StatePattern, ActionPattern, UXApplication

### Testing Coverage Layer (v0.3.0)

The specification now includes a comprehensive Testing Layer for modeling test coverage requirements and traceability:

- **📊 Test Coverage Modeling** - Define what should be tested, not just test instances
- **🎯 Coverage Targets** - Link tests to workflows, forms, APIs, and data models
- **🔀 Input Space Partitioning** - Model test input variations systematically
- **🌐 Context Variations** - Same functionality via different entry points (UI, API, events)
- **✅ Coverage Requirements** - Pairwise, boundary, exhaustive, risk-based criteria
- **🔗 Full Traceability** - Link from requirements through coverage to test implementations
- **📋 Implementation References** - Optional links to Gherkin, Postman, Playwright, etc.

**Complete Specification:**

- **Layer 12 Specification**: [layers/12-testing-layer.md](layers/12-testing-layer.md)
- **JSON Schema**: [schemas/12-testing-layer.schema.json](schemas/12-testing-layer.schema.json)
- **Integration Points**: Links to Motivation, Business, UX, API, Data Model, Security, and Navigation layers

### Previous Enhancements (v0.2.0)

**Cross-Layer Reference Registry:**

- **📖 Complete Catalog** - 60+ reference patterns across 9 categories
- **🔧 Machine-Readable** - JSON registry for automated tooling
- **📋 4 Pattern Types** - X-extensions, dot-notation, nested objects, and direct fields

See [CHANGELOG.md](CHANGELOG.md) for complete version history.

## Getting Started

### Read the Specification

```bash
# Clone the repository
git clone https://github.com/tinkermonkey/documentation_robotics.git
cd documentation_robotics/spec

# Browse layer specifications
ls layers/*.md
```

### Use the CLI Tool

```bash
# Install the CLI tool
npm install -g @documentation-robotics/cli

# Create and validate a model
dr init my-project
cd my-project
dr add motivation goal customer-satisfaction --name "Improve customer satisfaction"
dr validate --all
```

## Version Information

**Current Version:** 0.8.0
**Release Date:** 2026-02-07
**Status:** Draft
**Next Review:** 2026-08-07

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
- **Implementation Help:** See [CLI documentation](../cli/)

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
  version = {0.8.0},
  year = {2026},
  url = {https://github.com/tinkermonkey/documentation_robotics/tree/main/spec}
}
```

---

**Ready to get started?** See the [CLI documentation](../cli/) to begin working with models.
