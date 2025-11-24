# Documentation Robotics Specification

## Overview

This specification defines a **federated architecture data model** for complex software systems, using ArchiMate as the architectural spine with specialized standards for different concerns. The approach minimizes custom invention by leveraging established standards wherever possible.

## Purpose and Scope

### Purpose

This specification provides a comprehensive, standards-based approach to modeling enterprise and software architecture across 11 interconnected layers, enabling:

1. **Traceability** - Track relationships from business goals through implementation
2. **Validation** - Verify architectural integrity using standard validators
3. **Export** - Generate artifacts for various tools and platforms
4. **Analysis** - Understand dependencies and impacts across layers
5. **Governance** - Enforce architectural principles and constraints

### Scope

**In Scope:**

- Metadata model definitions for 11 architectural layers
- Cross-layer integration patterns and reference types
- Validation requirements and conformance criteria
- Export formats and transformation rules
- Extension mechanisms for domain-specific needs

**Out of Scope:**

- Specific modeling tools or implementations
- Proprietary tool integrations
- Domain-specific business logic
- Deployment and runtime concerns

## Intended Audience

This specification is intended for:

1. **Enterprise Architects** - Modeling complex systems
2. **Solution Architects** - Designing software solutions
3. **Tool Vendors** - Building architecture tooling
4. **Development Teams** - Understanding system architecture
5. **Standards Bodies** - Evaluating architectural approaches

## Document Structure

This specification is organized into:

- **Core Specifications** (normative) - Required understanding
- **Layer Specifications** (normative) - Detailed layer definitions
- **JSON Schemas** (normative) - Machine-readable validation
- **Conformance Requirements** (normative) - Compliance criteria
- **Implementation Guides** (informative) - Best practices and examples
- **Reference Materials** (informative) - Supporting documentation

## Normative vs. Informative

### Normative Content

Content that **MUST** be followed for conformance:

- Layer entity definitions
- Attribute specifications
- Cross-layer reference types
- JSON Schema definitions
- Conformance requirements

Keywords: MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT

### Informative Content

Content that **SHOULD** be considered as guidance:

- Implementation guides
- Example models
- Best practices
- Anti-patterns
- Use cases

Keywords: SHOULD, SHOULD NOT, RECOMMENDED, MAY, OPTIONAL

## Key Principles

The specification is built on these foundational principles:

1. **Standards First** - Use established standards (ArchiMate, OpenAPI, JSON Schema, OpenTelemetry) wherever possible
2. **Minimal Invention** - Create custom specifications only for gaps in existing standards
3. **Federated Integration** - ArchiMate serves as the spine tying specialized standards together
4. **Independent Validation** - Each layer validates independently using specialized tools
5. **Tool Neutrality** - Specification is independent of any specific implementation
6. **Extensibility** - Clear extension points for domain-specific needs
7. **Pragmatism** - Layer ordering balances theoretical purity with practical workflow

## Architecture Philosophy

```
┌─────────────────────────────────────────────────┐
│          ArchiMate Model (Spine)                │
│   - Structural relationships                     │
│   - Cross-layer traceability                    │
│   - Architectural rules                         │
│   - References to external specs                │
└─────────────────────────────────────────────────┘
         │           │            │           │
         ▼           ▼            ▼           ▼
    ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
    │OpenAPI │  │  JSON  │  │   UX   │  │  APM   │
    │  Spec  │  │ Schema │  │  Spec  │  │  OTel  │
    └────────┘  └────────┘  └────────┘  └────────┘
```

## Layer Overview

The specification defines 11 layers, ordered to balance abstraction hierarchy with pragmatic workflow:

| Layer | Name              | Focus        | Standard Used                   |
| ----- | ----------------- | ------------ | ------------------------------- |
| 01    | Motivation        | WHY          | ArchiMate 3.2 Motivation        |
| 02    | Business          | WHAT         | ArchiMate 3.2 Business          |
| 03    | Security          | WHO CAN      | Custom Security Model           |
| 04    | Application       | HOW          | ArchiMate 3.2 Application       |
| 05    | Technology        | WITH WHAT    | ArchiMate 3.2 Technology        |
| 06    | API               | INTERFACE    | OpenAPI 3.0                     |
| 07    | Data Model        | STRUCTURE    | JSON Schema Draft 7             |
| 08    | Datastore         | STORAGE      | SQL DDL + Extensions            |
| 09    | UX                | PRESENTATION | Custom UX Specification         |
| 10    | Navigation        | FLOW         | Custom Navigation Specification |
| 11    | APM/Observability | OBSERVE      | OpenTelemetry 1.0+              |

See [02-layering-philosophy.md](02-layering-philosophy.md) for detailed rationale.

## Standards Leveraged

This specification leverages five established standards:

1. **ArchiMate 3.2** - Motivation, Business, Application, Technology layers
2. **OpenAPI 3.0** - API specifications
3. **JSON Schema Draft 7** - Data model definitions
4. **OpenTelemetry 1.0+** - Observability and tracing
5. **W3C Trace Context** - Distributed tracing correlation

## Custom Specifications

Three custom specifications were created for gaps not covered by existing standards:

1. **Security Model** (Layer 03) - RBAC/ABAC/Policy-based access control
2. **UX Specification** (Layer 09) - Multi-channel experience state machines
3. **Navigation Specification** (Layer 10) - Channel-agnostic routing

## Statistics

```yaml
Total Layers: 11
Total Entity Types: 70+
Total Attributes: ~430
Total Enums: 35+
Cross-Layer References: 65+

Standards Leveraged: 5
Custom Specifications: 3
Extension Points: Multiple per layer
```

## Specification Status

**Current Version:** 0.1.1
**Status:** Stable
**Last Updated:** 2025-11-23

### Version History

- **0.1.1** (2025-11-23) - Initial stable release
  - 11 layer specifications complete
  - JSON Schemas for all layers
  - Conformance requirements defined
  - Example models provided

## Conformance

Implementations can claim conformance at three levels:

- **Level 1: Basic** - Layers 1-4 (Motivation through Application)
- **Level 2: Standard** - Layers 1-8 (through Datastore)
- **Level 3: Full** - All 11 layers

See [../conformance/conformance-levels.md](../conformance/conformance-levels.md) for detailed requirements.

## How to Use This Specification

### For Architects

1. Read core specifications to understand the approach
2. Review layer specifications relevant to your needs
3. Use implementation guides for practical application
4. Reference examples for patterns

### For Tool Vendors

1. Read conformance requirements
2. Implement layers according to specifications
3. Validate against JSON Schemas
4. Run conformance test suite
5. Claim conformance level

### For Developers

1. Understand the federated architecture concept
2. Focus on layers relevant to your work
3. Use CLI tools or other implementations
4. Follow integration guides for cross-layer references

## Getting Help

- **Specification Issues**: File issues in the GitHub repository
- **Implementation Questions**: See implementation guides
- **Conformance Questions**: See conformance documentation
- **General Questions**: Check FAQ or file a discussion

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for how to propose changes to this specification.

## Governance

See [GOVERNANCE.md](../../GOVERNANCE.md) for the specification governance process.

## License

This specification is licensed under MIT License. See [LICENSE](../../LICENSE) for details.

## Acknowledgments

This specification builds upon and integrates:

- ArchiMate® is a registered trademark of The Open Group
- OpenAPI Specification by the OpenAPI Initiative
- JSON Schema by the JSON Schema team
- OpenTelemetry by the Cloud Native Computing Foundation

---

**Next:** [01-federated-approach.md](01-federated-approach.md) - Understanding the federated architecture concept
