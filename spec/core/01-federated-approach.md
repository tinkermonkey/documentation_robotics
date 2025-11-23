# Federated Architecture Approach

## Introduction

The Federated Architecture Metadata Model uses a **federation pattern** where ArchiMate serves as the architectural spine, integrating multiple specialized standards for specific concerns. This approach minimizes custom invention and maximizes tool ecosystem compatibility.

## The Federation Pattern

### Core Concept

Rather than creating a monolithic, custom metamodel, this specification:

1. **Uses ArchiMate as the spine** - Provides structural relationships and cross-layer traceability
2. **Federates specialized standards** - OpenAPI, JSON Schema, OpenTelemetry for specific domains
3. **Invents only for gaps** - Custom specifications only where standards don't exist
4. **Links via properties** - ArchiMate elements reference external specifications

### Visual Model

```
┌─────────────────────────────────────────────────────────────┐
│                    ArchiMate Model                           │
│                                                              │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │ Application  │────────▶│  OpenAPI     │                 │
│  │ Component    │         │  Reference   │                 │
│  │              │         │              │                 │
│  │ properties:  │         │ operationId: │                 │
│  │  spec.openapi│         │  "getUser"   │                 │
│  └──────────────┘         └──────────────┘                 │
│         │                                                   │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │ Data Object  │────────▶│ JSON Schema  │                 │
│  │              │         │  Reference   │                 │
│  │ properties:  │         │              │                 │
│  │  spec.schema │         │ $ref: "..."  │                 │
│  └──────────────┘         └──────────────┘                 │
└─────────────────────────────────────────────────────────────┘
                    │           │
                    ▼           ▼
         ┌─────────────┐  ┌─────────────┐
         │ OpenAPI     │  │ JSON Schema │
         │ Validator   │  │ Validator   │
         └─────────────┘  └─────────────┘
```

## Why Federation?

### Advantages Over Monolithic Approaches

#### 1. **Leverage Existing Standards**

**Problem with Custom Metamodels:**
- Reinvent concepts already defined in standards
- Lose compatibility with existing tools
- Require custom validators and generators
- Small ecosystem of tools

**Federation Solution:**
- Use proven standards with mature definitions
- Benefit from extensive tool ecosystems
- Standard validators work out-of-the-box
- Large community support

**Example:**
```yaml
# ❌ Custom approach: Reinvent API modeling
CustomAPIOperation:
  id: "get-user"
  method: "GET"
  path: "/users/{id}"
  parameters: [...]
  responses: [...]
  # Now need custom validator, code generator, mock server, etc.

# ✅ Federated approach: Use OpenAPI
ApplicationService:
  id: "user-api"
  properties:
    spec.openapi: "specs/user-api.yaml"  # References OpenAPI file
# Use Swagger, Postman, etc. directly
```

#### 2. **Independent Evolution**

**Problem with Monolithic:**
- All layers coupled to single specification version
- Changes cascade across all layers
- Breaking change in one area affects everything

**Federation Solution:**
- Each standard evolves independently
- Update OpenAPI support without touching UX layer
- ArchiMate version independent of JSON Schema version

**Example:**
```yaml
# Can upgrade independently
Layer 06 (API): OpenAPI 3.0 → OpenAPI 3.1
Layer 07 (Data): JSON Schema Draft 7 → Draft 2020-12
Layer 11 (APM): OpenTelemetry 1.0 → OpenTelemetry 1.5

# ArchiMate spine version remains stable
Core Model: ArchiMate 3.2 (unchanged)
```

#### 3. **Specialized Validation**

Each layer uses the **best validator** for its standard:

```javascript
// Multi-layer validation with specialized tools
const results = {
  // ArchiMate layers: Use ArchiMate validators
  archimate: validateArchiMate('model.xml'),

  // API layer: Use OpenAPI validators
  openapi: validateOpenAPI('api.yaml'),          // Swagger, Spectral

  // Data layer: Use JSON Schema validators
  schemas: validateJSONSchema('schema.json'),    // AJV, Ajv

  // UX layer: Custom validator (no standard exists)
  ux: validateUXSpec('ux.yaml'),

  // APM layer: OpenTelemetry validators
  apm: validateOTelConfig('apm.yaml'),

  // Cross-layer: Custom reference checker
  crossRefs: validateCrossReferences(all)
};
```

#### 4. **Tool Ecosystem Access**

By using standards, gain access to entire tool ecosystems:

| Standard | Available Tools |
|----------|----------------|
| **OpenAPI** | Swagger Editor, Swagger UI, Postman, Insomnia, Stoplight, Redoc, Spectral |
| **JSON Schema** | AJV, JSON Schema Validator, quicktype, json-schema-to-typescript |
| **OpenTelemetry** | Jaeger, Zipkin, Prometheus, Grafana, Datadog, New Relic |
| **ArchiMate** | Archi, Enterprise Architect, BiZZdesign, Sparx |

**Example Workflow:**
```bash
# Export to OpenAPI → Use Swagger ecosystem
dr export --format openapi --output specs/api/

# Generate TypeScript client
openapi-generator generate -i specs/api/user-api.yaml -g typescript-axios

# Generate mock server
prism mock specs/api/user-api.yaml

# Validate with Spectral
spectral lint specs/api/user-api.yaml
```

#### 5. **Minimal Custom Invention**

**Standards Coverage:**
```
Total Layers: 11
Using Existing Standards: 8 layers (73%)
Custom Specifications: 3 layers (27%)

Custom Only for True Gaps:
- Security (Layer 03): No comprehensive RBAC/ABAC/Policy standard
- UX (Layer 09): No multi-channel experience state machine standard
- Navigation (Layer 10): No channel-agnostic navigation standard
```

Even custom layers follow standard patterns (JSON Schema, YAML syntax).

## How Federation Works

### 1. ArchiMate as the Spine

ArchiMate elements hold **structural relationships** and **properties** that reference external specifications:

```yaml
# ArchiMate Application Component
ApplicationComponent:
  id: "app-product-ui"
  name: "Product Management UI"
  type: "ApplicationComponent"

  # ArchiMate relationships
  relationships:
    - type: "realizes"
      target: "business-service-product-mgmt"
    - type: "uses"
      target: "app-service-product-api"

  # Properties reference external specs
  properties:
    spec.ux: "specs/ux/product-management.ux.yaml"
    spec.navigation: "specs/navigation/product-routes.yaml"
    spec.security: "specs/security/product-security.yaml"
```

### 2. External Specifications

Each external spec is **validated independently**:

```yaml
# specs/ux/product-management.ux.yaml (UX Layer)
specVersion: "1.0"
experienceId: "product-management"

# References back to ArchiMate
metadata:
  x-archimate-ref: "app-product-ui"

# References to other standards
states:
  - id: "product-list"
    api:
      operationId: "listProducts"  # → OpenAPI operation
    dataBinding:
      schemaRef: "product.json#/definitions/Product"  # → JSON Schema
```

### 3. Cross-Layer References

References flow **bidirectionally**:

```
ArchiMate Element ←──────────→ External Spec
                  properties    x-archimate-ref

ArchiMate (Layer 04) ─────────▶ OpenAPI (Layer 06)
                     spec.openapi

OpenAPI (Layer 06) ───────────▶ JSON Schema (Layer 07)
                     $ref

UX (Layer 09) ────────────────▶ OpenAPI (Layer 06)
                  operationId

UX (Layer 09) ────────────────▶ Navigation (Layer 10)
                  route
```

### 4. Validation Flow

```
1. Validate each layer independently
   ✓ ArchiMate → ArchiMate XSD
   ✓ OpenAPI → Swagger Validator
   ✓ JSON Schema → AJV
   ✓ UX → Custom Validator
   ✓ OTel → OTel Validator

2. Validate cross-layer references
   ✓ spec.openapi → file exists
   ✓ operationId → exists in OpenAPI
   ✓ schemaRef → valid JSON Pointer
   ✓ route → exists in navigation spec

3. Validate semantic consistency
   ✓ Data types match across layers
   ✓ Security constraints align
   ✓ No circular dependencies
```

## Benefits Summary

| Benefit | Monolithic Custom Model | Federated Standards Model |
|---------|------------------------|---------------------------|
| **Standards Compliance** | None | 5 major standards |
| **Tool Ecosystem** | Custom tools only | Hundreds of tools |
| **Validation** | Custom validators | Standard validators + custom cross-layer |
| **Community Support** | Limited | Large communities per standard |
| **Evolution** | Coupled | Independent per standard |
| **Learning Curve** | High (all custom) | Lower (mostly standard) |
| **Interoperability** | Low | High |
| **Custom Code** | Extensive | Minimal (3 custom specs) |

## Tradeoffs

### Advantages
✅ **Maximize standards usage** - 73% of layers use existing standards
✅ **Tool ecosystem access** - Hundreds of compatible tools
✅ **Independent evolution** - Update standards independently
✅ **Validation maturity** - Proven validators for each standard
✅ **Community support** - Large communities for each standard
✅ **Interoperability** - Other tools can consume standard formats

### Challenges
⚠️ **Coordination complexity** - Must manage multiple specifications
⚠️ **Version alignment** - Track multiple standard versions
⚠️ **Cross-layer validation** - Requires custom reference checker
⚠️ **Tool integration** - Multiple tools instead of one unified tool

**Mitigation:** This specification provides:
- Clear integration patterns
- Cross-layer reference validation
- Conformance test suite
- Reference implementation (CLI)

## Design Decisions

### Why ArchiMate as the Spine?

**Alternatives Considered:**
1. ❌ **UML** - Too software-focused, weak motivation/business layers
2. ❌ **BPMN** - Process-focused, not architectural
3. ❌ **Custom** - High invention, no tool ecosystem
4. ✅ **ArchiMate** - Enterprise architecture standard, all layers, mature

**ArchiMate Advantages:**
- Covers motivation, business, application, technology naturally
- Mature standard (3.2) with stable metamodel
- Tool ecosystem (Archi, EA, BiZZdesign)
- Relationship types for cross-layer modeling
- Properties mechanism for external references

### Why Not Extend ArchiMate Fully?

Could ArchiMate be extended for API, Data, UX, etc.?

**Decision:** No, use federation instead.

**Rationale:**
1. **Reinvention** - Would duplicate OpenAPI, JSON Schema
2. **Tool support** - Extended ArchiMate wouldn't work with standard tools
3. **Validation** - Would need custom validators anyway
4. **Community** - Smaller ecosystem than OpenAPI/JSON Schema combined

**Better:** Use ArchiMate for structure, reference specialized standards for detail.

## Practical Example

### E-commerce Product Management

**ArchiMate Model (Spine):**
```xml
<!-- Layer 04: Application -->
<element id="app-product-ui" type="ApplicationComponent">
  <name>Product Management UI</name>
  <property key="spec.ux">specs/ux/product-management.ux.yaml</property>
</element>

<element id="app-product-api" type="ApplicationService">
  <name>Product API</name>
  <property key="spec.openapi">specs/api/product-api.yaml</property>
</element>

<relationship source="app-product-ui" target="app-product-api" type="uses"/>
```

**OpenAPI Specification (Layer 06):**
```yaml
# specs/api/product-api.yaml
openapi: 3.0.0
info:
  title: Product API
  x-archimate-ref: "app-product-api"

paths:
  /products:
    get:
      operationId: listProducts
      responses:
        200:
          content:
            application/json:
              schema:
                $ref: "schemas/product.json#/definitions/ProductList"
```

**JSON Schema (Layer 07):**
```json
// specs/schemas/product.json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "definitions": {
    "Product": {
      "type": "object",
      "x-archimate-ref": "data-object-product",
      "properties": {
        "id": {"type": "string"},
        "name": {"type": "string"},
        "price": {"type": "number"}
      }
    }
  }
}
```

**UX Specification (Layer 09):**
```yaml
# specs/ux/product-management.ux.yaml
specVersion: "1.0"
experienceId: "product-management"
metadata:
  x-archimate-ref: "app-product-ui"

states:
  - id: "product-list"
    api:
      operationId: "listProducts"  # → OpenAPI
    dataBinding:
      schemaRef: "product.json#/definitions/Product"  # → JSON Schema
    route: "/products"  # → Navigation layer
```

**Result:** Each layer uses its optimal standard, all linked via ArchiMate spine.

## Conclusion

The federated approach provides the best balance of:
- **Standards compliance** (73% existing standards)
- **Tool ecosystem access** (hundreds of compatible tools)
- **Minimal custom invention** (only 3 custom specifications)
- **Independent evolution** (standards update separately)
- **Practical implementation** (proven in production systems)

**Next:** [02-layering-philosophy.md](02-layering-philosophy.md) - Understanding layer ordering and rationale
