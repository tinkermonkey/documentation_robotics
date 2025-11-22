# Federated Architecture Metadata Model

## Overview

This metadata model defines a **federated architecture approach** for complex software systems, using ArchiMate as the architectural spine with specialized standards for different concerns. The approach minimizes custom invention by leveraging established standards wherever possible.

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

**Key Principles:**
- **Use standards where they exist** (OpenAPI, JSON Schema, OpenTelemetry)
- **Invent only for gaps** (UX, Security, Navigation)
- **ArchiMate ties everything together** via property references
- **Each layer validated independently** with specialized tools

## Layer Ordering Philosophy

Layers are ordered to balance **abstraction hierarchy** with **pragmatic workflow**, following the natural flow from business intent through design constraints to technical implementation:

1. **Motivation** - WHY: Goals, requirements, stakeholders, constraints
2. **Business** - WHAT: Business services, processes, actors
3. **Security** - WHO CAN: Cross-cutting access control and policies
4. **Application** - HOW: Software applications and services
5. **Technology** - WITH WHAT: Platforms, frameworks, design constraints
6. **API** - INTERFACE: Service contracts and protocols
7. **Data Model** - STRUCTURE: Logical data definitions
8. **Data Store** - STORAGE: Physical database schemas
9. **UX** - PRESENTATION: User interface specifications
10. **Navigation** - FLOW: User navigation and routing
11. **APM/Observability** - OBSERVE: Monitoring and tracing

### Why Technology at Layer 5?

Technology is positioned early (Layer 5) because in practice:
- **Technology choices are design constraints**, not just deployment details
- Teams select technology stacks (Node.js, React, PostgreSQL) early in the design process
- These choices constrain subsequent layers:
  - API design (REST vs GraphQL, protocol options)
  - Data models (database capabilities, type systems)
  - UX implementation (framework-specific patterns)
  - Navigation (SPA vs MPA, routing frameworks)

This balances:
- ✅ **Pragmatic workflow** - matches how teams actually work
- ✅ **Constraint-driven design** - technology shapes implementation
- ⚠️ **Slight abstraction compromise** - technology is more concrete than APIs conceptually, but serves as an earlier design constraint

### Ordering Principles

This ordering ensures that:
- Higher layers drive requirements for lower layers
- Cross-cutting concerns (Security) are addressed early
- Technology constraints are established before detailed design
- Implementation specifications (API, Data, UX) are designed within technology constraints
- Operational concerns (APM) are positioned at the most concrete level

## Layer Inventory

| Layer | Standard Used | Custom Required | Documentation |
|-------|--------------|-----------------|---------------|
| **Motivation** | ArchiMate Motivation Layer | No | [01-motivation-layer.md](layers/01-motivation-layer.md) |
| **Business** | ArchiMate Business Layer | No | [02-business-layer.md](layers/02-business-layer.md) |
| **Security** | Custom Specification | Yes | [03-security-layer.md](layers/03-security-layer.md) |
| **Application** | ArchiMate Application Layer | No | [04-application-layer.md](layers/04-application-layer.md) |
| **Technology** | ArchiMate Technology Layer | No | [05-technology-layer.md](layers/05-technology-layer.md) |
| **API** | OpenAPI 3.0 | No | [06-api-layer.md](layers/06-api-layer.md) |
| **Data Model** | JSON Schema Draft 7 | No | [07-data-model-layer.md](layers/07-data-model-layer.md) |
| **Data Store** | SQL DDL + Extensions | Minimal | [08-datastore-layer.md](layers/08-datastore-layer.md) |
| **UX** | Custom Specification | Yes | [09-ux-layer.md](layers/09-ux-layer.md) |
| **Navigation** | Custom Specification | Yes | [10-navigation-layer.md](layers/10-navigation-layer.md) |
| **APM/Observability** | OpenTelemetry | No | [11-apm-observability-layer.md](layers/11-apm-observability-layer.md) |

## Statistics

```yaml
Total Entity Types: 70+
Total Attributes: ~400
Total Enums: 35+
Cross-Layer References: 55+

Standards Leveraged: 5
- ArchiMate 3.2
- OpenAPI 3.0
- JSON Schema Draft 7
- OpenTelemetry 1.0
- W3C Trace Context

Custom Specifications: 3
- UX State & Layout
- Navigation Graph
- Security Model
```

## Cross-Layer Integration

The metadata model defines how layers reference each other:

1. **ArchiMate → Specs**: Properties point to external specification files
2. **OpenAPI → JSON Schema**: `$ref` links to schema definitions
3. **UX → API**: State actions reference OpenAPI operations
4. **UX → Data**: Form fields reference JSON Schema properties
5. **APM → All**: Traces and logs correlate across all layers

## Validation Strategy

Each layer has independent validation:

```javascript
// Multi-layer validation
const results = {
  archimate: validateArchiMate('model.xml'),           // XSD validation
  openapi: validateOpenAPI('api.yaml'),                // Swagger validator
  schemas: validateJSONSchema('schema.json'),          // AJV validator
  ux: validateUXSpec('ux.yaml'),                       // Custom validator
  security: validateSecurity('security.yaml'),         // Custom validator
  apm: validateOTelConfig('apm.yaml'),                // OTel validator
  crossRefs: validateCrossReferences(all)              // Reference checker
};
```

## Benefits of Federation

✅ **Minimal invention** - Only 3 custom specs instead of reinventing everything  
✅ **Tool ecosystem** - Each standard has mature tooling  
✅ **Independent evolution** - Standards can be updated independently  
✅ **Validation at each layer** - Specialized validators per standard  
✅ **Interoperability** - Other tools can consume standard formats  
✅ **Clear separation of concerns** - Each layer has focused responsibility  

## Implementation Guidance

Follow the layer ordering for a systematic implementation approach:

1. **Define Motivation** (Layer 01) - Establish goals, requirements, stakeholders, and constraints
2. **Model Business** (Layer 02) - Define business services, processes, and actors
3. **Design Security** (Layer 03) - Establish roles, permissions, and policies
4. **Architect Application** (Layer 04) - Define application services and components
5. **Select Technology** (Layer 05) - Choose platforms, frameworks, and technology constraints
6. **Specify APIs** (Layer 06) - Create OpenAPI specifications for service contracts
7. **Define Data Model** (Layer 07) - Create JSON Schemas for data structures
8. **Design Data Store** (Layer 08) - Define physical database schemas
9. **Specify UX** (Layer 09) - Define user interface specifications
10. **Map Navigation** (Layer 10) - Define routes, guards, and flows
11. **Configure APM** (Layer 11) - Set up observability and monitoring

**Key Practices:**
- **Top-Down Flow**: Higher layers drive requirements for lower layers
- **Technology as Constraint**: Layer 5 technology choices constrain layers 6-10 design decisions
- **ArchiMate Spine**: Link layers via ArchiMate properties (`spec.*` references)
- **Independent Validation**: Validate each layer with specialized tools
- **Cross-Layer Verification**: Verify cross-layer references for consistency
- **Code Generation**: Generate implementation from specifications where possible

## File Structure Convention

```
project/
├── architecture/
│   └── model.archimate          # ArchiMate model (spine)
├── specs/
│   ├── api/
│   │   └── *.openapi.yaml      # OpenAPI specifications
│   ├── schemas/
│   │   └── *.schema.json       # JSON Schema definitions
│   ├── ux/
│   │   └── *.ux.yaml          # UX specifications
│   ├── navigation/
│   │   └── navigation.yaml     # Navigation graph
│   ├── security/
│   │   └── security.yaml       # Security model
│   └── apm/
│       └── apm-config.yaml     # APM configuration
└── validation/
    └── validate-all.js          # Cross-layer validation
```
