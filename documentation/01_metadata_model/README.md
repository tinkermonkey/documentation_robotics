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
9. **UX** - PRESENTATION: Multi-channel user experience specifications
10. **Navigation** - FLOW: Channel-agnostic navigation and routing
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
| **Data Model** | JSON Schema Draft 7 | Minimal (3 extensions) | [07-data-model-layer.md](layers/07-data-model-layer.md) |
| **Data Store** | SQL DDL + Extensions | Minimal | [08-datastore-layer.md](layers/08-datastore-layer.md) |
| **UX** | Custom Multi-Channel UX Specification | Yes | [09-ux-layer.md](layers/09-ux-layer.md) |
| **Navigation** | Custom Navigation Specification | Yes | [10-navigation-layer.md](layers/10-navigation-layer.md) |
| **APM/Observability** | OpenTelemetry | No | [11-apm-observability-layer.md](layers/11-apm-observability-layer.md) |

## Statistics

```yaml
Total Entity Types: 70+
Total Attributes: ~430
Total Enums: 35+
Cross-Layer References: 65+

Standards Leveraged: 5
- ArchiMate 3.2
- OpenAPI 3.0
- JSON Schema Draft 7
- OpenTelemetry 1.0
- W3C Trace Context

Custom Specifications: 3 major, 3 extensions
- UX Multi-Channel Experience (major)
- Navigation Routing (major)
- Security Model (major)
- Data Model Extensions: x-business-object-ref, x-data-governance, x-apm-data-quality-metrics
```

## Cross-Layer Integration

The metadata model defines how layers reference each other:

1. **ArchiMate → Specs**: Properties point to external specification files
2. **OpenAPI → JSON Schema**: `$ref` links to schema definitions
3. **UX → API**: State actions reference OpenAPI operations
4. **UX → Data**: Form fields reference JSON Schema properties
5. **APM → All**: Traces and logs correlate across all layers

## Link Directionality Philosophy

### Architectural Decision: Implementation-Driven Traceability

While layers are numbered to indicate abstraction hierarchy (01 = highest, 11 = lowest), **references intentionally flow upward** from implementation layers to motivation/strategy layers. This is a deliberate architectural choice, not an oversight.

### Current Link Pattern

```
Motivation Layer (01)
    ↑ supports-goals
    ↑ delivers-value
    ↑ governed-by-principles
    ↑ fulfills-requirements
Business Layer (02)
    ↑ references stakeholders
    ↑ references business actors
Security Layer (03)
Application Layer (04)
    ⋮
APM Layer (11)
```

**Key Observation:** Only the Motivation Layer (01) contains purely downward references. All other layers (02-11) contain upward references back to Motivation Layer elements (Goals, Values, Principles, Requirements, Constraints).

### Why Upward References Are Preferred

#### 1. **Separation of Concerns**
```yaml
# ✅ Good: Implementation knows its purpose
ApplicationService:
  id: "product-api"
  motivation.supports-goals: ["goal-customer-satisfaction"]
  motivation.delivers-value: ["value-convenience"]

# ❌ Bad: Strategy layer knows implementation details
Goal:
  id: "goal-customer-satisfaction"
  implemented-by-services: ["product-api", "order-api", ...]  # Leaks implementation
```

**Rationale:** High-level strategy (Goals, Principles) should not be coupled to low-level implementation details. Implementation changes frequently; strategy should remain stable.

#### 2. **Maintenance Locality**
```yaml
# Developer workflow when implementing a feature:
# ✅ Natural: Edit implementation layer only
ApplicationService:
  id: "new-feature-api"
  motivation.supports-goals: ["goal-feature-x"]  # Local annotation

# ❌ Awkward: Must edit both implementation AND strategy layers
Goal:
  id: "goal-feature-x"
  implemented-by-services: ["new-feature-api"]  # Requires motivation layer edit
```

**Rationale:** Developers work in implementation layers. Requiring them to also update strategy layers creates:
- **Tight coupling** between abstraction levels
- **Maintenance burden** of keeping two layers in sync
- **Merge conflicts** when multiple teams work on different features supporting the same goal

#### 3. **Cohesion of Related Information**
```yaml
# ✅ Good: Service definition includes its purpose
ApplicationService:
  id: "product-api"
  name: "Product Management API"
  motivation.supports-goals: ["goal-product-catalog"]
  properties:
    spec.openapi: "specs/product-api.yaml"

# ❌ Bad: Service definition separated from its purpose
# (Purpose tracked in distant motivation layer file)
```

**Rationale:** Related information should be co-located. A service's purpose is part of its definition.

#### 4. **Industry Precedent**
This pattern matches established practices:
- **Requirements Management Tools** (DOORS, Jama): Implementation artifacts link UP to requirements
- **Traceability Matrices**: Code/tests reference requirements they fulfill
- **Architecture Documentation**: Components declare which requirements they satisfy
- **Agile User Stories**: Features reference business goals they support

### Reference Types and Their Directions

| Reference Type | Direction | Rationale | Keep/Reverse |
|---------------|-----------|-----------|--------------|
| **Goal Alignment** (`supports-goals`, `delivers-value`) | Upward (impl → goal) | Implementation knows its purpose | ✅ **KEEP** |
| **Governance** (`governed-by-principles`) | Upward (impl → principle) | Implementation applies principles | ✅ **KEEP** |
| **Fulfillment** (`fulfills-requirements`) | Upward (impl → requirement) | Implementation satisfies requirements | ✅ **KEEP** |
| **Identity Mapping** (`stakeholderRef`, `businessActorRef`) | Upward (specific → general) | Semantic type/identity relationship | ✅ **KEEP** |
| **Threat Mitigation** (`mitigatedByRequirements`) | Upward (threat → requirement) | Threat describes its mitigations | ✅ **KEEP** |
| **Structural Realization** (Business → Application) | Downward via "From" sections | Proper architectural layering | ✅ **ALREADY CORRECT** |

### Achieving Bidirectional Navigation

While references are stored upward, **downward navigation is achieved through queries and tooling**:

#### **Option A: Query-Based Inverse Relationships**
```python
# Tool to query downward
def find_services_supporting_goal(goal_id: str) -> List[str]:
    """Find all services that support a given goal"""
    return [
        service.id
        for service in all_application_services()
        if goal_id in service.motivation.supports_goals
    ]
```

#### **Option B: Generated Inverse Links**
```yaml
# Source: Manual upward references (layers/04-application-layer.md)
ApplicationService:
  id: "product-api"
  motivation.supports-goals: ["goal-satisfaction"]

# Generated: Computed downward links (layers/01-motivation-layer.md)
Goal:
  id: "goal-satisfaction"
  _computed:
    supported-by-services: ["product-api"]  # Auto-generated at build time
```

#### **Option C: Traceability Matrix**
```yaml
# Generated from all layers: traceability-matrix.yaml
goals:
  goal-customer-satisfaction:
    supported-by:
      business-services: ["order-management"]
      application-services: ["product-api", "cart-api"]
      ux-experiences: ["product-list", "checkout-flow"]
      api-operations: ["getProducts", "createOrder"]
      metrics: ["customer-satisfaction-score"]
```

### Exception: Motivation Layer Links Downward

The **Motivation Layer (01)** is the only layer that references downward by design:

```yaml
# In 01-motivation-layer.md "Integration Points" sections:
Goal:
  - "Goal drives BusinessService"              # To Layer 02
  - "Goal → ApplicationService"                 # To Layer 04
  - "Requirement → API Operations"              # To Layer 06
  - "Principle → Data Design"                   # To Layer 07
  - "Goal → Business Metrics"                   # To Layer 11
```

**Rationale:** The Motivation Layer serves as the **strategic anchor**. It's appropriate for it to reference what it governs, drives, or constrains. These are conceptual/documentation relationships, not implementation dependencies.

### Practical Implications

#### **When Adding a New Feature:**
1. ✅ Edit implementation layer (e.g., `04-application-layer.md`)
2. ✅ Annotate with upward references (`motivation.supports-goals`)
3. ✅ Let tooling generate inverse relationships (optional)
4. ❌ Don't edit motivation layer files (unless changing strategy)

#### **When Querying "What Implements Goal X?":**
1. ✅ Use query tools to find upward references
2. ✅ Use generated traceability matrix
3. ✅ Use IDE search across implementation layers
4. ❌ Don't expect manual downward links in motivation layer

#### **When Validating Traceability:**
```javascript
// Cross-reference validation tool
function validateGoalCoverage(goalId) {
  const implementations = {
    businessServices: findBusinessServicesSupporting(goalId),
    applicationServices: findApplicationServicesSupporting(goalId),
    uxExperiences: findUXExperiencesSupporting(goalId),
    metrics: findMetricsMeasuring(goalId)
  };

  return implementations.applicationServices.length > 0
    ? { status: 'covered', implementations }
    : { status: 'not-implemented', warning: true };
}
```

### Summary: Pragmatic Traceability

This architecture chooses **implementation-driven traceability** over **strategy-driven implementation tracking**:

✅ **Advantages:**
- Maintains separation of concerns (strategy ↔ implementation)
- Reduces maintenance burden (single edit location)
- Improves cohesion (definition + purpose together)
- Matches industry practices and developer workflows

⚠️ **Tradeoffs:**
- Requires tooling for downward queries (but this is solvable)
- Conceptual "top-down flow" appears inverted (but pragmatically correct)

**Recommendation:** Keep upward references, build tooling for downward navigation. Best of both worlds: maintainability + queryability.

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
9. **Specify UX** (Layer 09) - Define multi-channel user experience specifications
10. **Map Navigation** (Layer 10) - Define channel-agnostic routes, guards, and flows
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
