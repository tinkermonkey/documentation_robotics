# Cross-Layer Integration

## Introduction

The 11 layers work together through well-defined integration patterns and reference mechanisms. This document describes how layers reference each other and maintain consistency.

## Integration Mechanisms

### 1. ArchiMate Properties

ArchiMate elements use **properties** to reference external specifications:

```yaml
ApplicationComponent:
  id: "app-product-ui"
  name: "Product Management UI"
  properties:
    spec.openapi: "specs/api/product-api.yaml"
    spec.ux: "specs/ux/product-ui.ux.yaml"
    spec.security: "specs/security/product-security.yaml"
```

### 2. Extension Attributes

External specifications reference back to ArchiMate using `x-archimate-ref`:

```yaml
# OpenAPI specification
openapi: 3.0.0
info:
  title: Product API
  x-archimate-ref: "app-product-api"  # Links back to ArchiMate
```

### 3. Standard References

Standard specifications use their native reference mechanisms:

```yaml
# OpenAPI → JSON Schema
components:
  schemas:
    Product:
      $ref: "schemas/product.json#/definitions/Product"

# UX → OpenAPI
states:
  - id: "product-list"
    api:
      operationId: "listProducts"  # References OpenAPI operation
```

## Cross-Layer Reference Types

| Source Layer | Target Layer | Reference Type | Example |
|--------------|--------------|----------------|---------|
| ArchiMate (All) | External Specs | `spec.*` property | `spec.openapi: "api.yaml"` |
| External Specs | ArchiMate | `x-archimate-ref` | `x-archimate-ref: "app-id"` |
| OpenAPI (06) | JSON Schema (07) | `$ref` | `$ref: "schema.json#/Product"` |
| UX (09) | Motivation (01) | `fulfillsRequirements` | `fulfillsRequirements: ["req-123"]` |
| UX (09) | Business (02) | `supportsProcesses` | `supportsProcesses: ["bp-checkout"]` |
| UX (09) | Security (03) | `security.model` | `security: {model: "rbac.yaml"}` |
| UX (09) | API (06) | `operationId` | `api: {operationId: "getProducts"}` |
| UX (09) | Data (07) | `schemaRef` | `schemaRef: "product.json#/Product"` |
| UX (09) | Navigation (10) | `route` | `route: "/products"` |
| Navigation (10) | UX (09) | `experience` | `experience: "product-list.ux.yaml"` |
| APM (11) | All | Trace context | Correlates spans across layers |

## Example: E-commerce Checkout

### Layer 01: Motivation
```yaml
Goal:
  id: "goal-fast-checkout"
  name: "Fast Checkout Experience"

Requirement:
  id: "req-checkout-30sec"
  name: "30-Second Checkout"
  description: "Complete checkout in under 30 seconds"
  constrains: "goal-fast-checkout"
```

### Layer 02: Business
```yaml
BusinessProcess:
  id: "bp-checkout"
  name: "Customer Checkout Process"
  motivation.fulfillsRequirements: ["req-checkout-30sec"]
```

### Layer 04: Application
```yaml
ApplicationService:
  id: "app-checkout-service"
  name: "Checkout Service"
  realizes: "bp-checkout"
  properties:
    spec.openapi: "specs/api/checkout-api.yaml"
```

### Layer 06: API
```yaml
# specs/api/checkout-api.yaml
openapi: 3.0.0
info:
  title: Checkout API
  x-archimate-ref: "app-checkout-service"
paths:
  /checkout:
    post:
      operationId: createCheckout
      requestBody:
        content:
          application/json:
            schema:
              $ref: "schemas/checkout.json#/definitions/Checkout"
```

### Layer 07: Data Model
```json
// specs/schemas/checkout.json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "definitions": {
    "Checkout": {
      "x-archimate-ref": "data-object-checkout",
      "type": "object",
      "properties": {
        "orderId": {"type": "string"},
        "items": {"type": "array"}
      }
    }
  }
}
```

### Layer 09: UX
```yaml
# specs/ux/checkout.ux.yaml
specVersion: "1.0"
experienceId: "checkout"
metadata:
  x-archimate-ref: "app-checkout-ui"
  fulfillsRequirements: ["req-checkout-30sec"]
  supportsProcesses: ["bp-checkout"]

states:
  - id: "checkout-form"
    api:
      operationId: "createCheckout"
    dataBinding:
      schemaRef: "checkout.json#/definitions/Checkout"
    route: "/checkout"
    security:
      requiredPermissions: ["create:order"]
```

### Layer 10: Navigation
```yaml
# specs/navigation/shop-navigation.yaml
routes:
  - path: "/checkout"
    name: "checkout"
    experience: "checkout.ux.yaml"
    guards:
      - type: "authentication"
        redirect: "/login"
```

### Layer 11: APM
```yaml
# specs/apm/checkout-tracing.yaml
traces:
  - serviceName: "checkout-service"
    spans:
      - name: "business.checkout"
        attributes:
          businessProcess: "bp-checkout"
          goal: "goal-fast-checkout"

      - name: "app.checkout-service"
        attributes:
          applicationService: "app-checkout-service"

      - name: "api.POST./checkout"
        attributes:
          operationId: "createCheckout"

metrics:
  - name: "checkout.duration"
    type: "histogram"
    description: "Checkout process duration"
    labels:
      goal: "goal-fast-checkout"
    slo:
      target: 30  # seconds - from req-checkout-30sec
```

## Validation Rules

### 1. Reference Existence
All references must point to existing elements:

```python
def validate_reference_existence(model):
    errors = []

    # Check spec.* properties point to existing files
    for element in model.archimate_elements:
        for key, value in element.properties.items():
            if key.startswith('spec.'):
                if not file_exists(value):
                    errors.append(f"Missing file: {value}")

    # Check operationId references exist
    for ux_spec in model.ux_specs:
        for state in ux_spec.states:
            if state.api and state.api.operationId:
                if not operation_exists(state.api.operationId):
                    errors.append(f"Missing operation: {state.api.operationId}")

    return errors
```

### 2. Reference Type Consistency
Referenced elements must have compatible types:

```python
def validate_reference_types(model):
    errors = []

    # UX operationId must reference an OpenAPI operation
    for ux_spec in model.ux_specs:
        for state in ux_spec.states:
            if state.api and state.api.operationId:
                operation = find_operation(state.api.operationId)
                if operation.type != 'operation':
                    errors.append(f"Invalid type for {state.api.operationId}")

    return errors
```

### 3. Bidirectional Consistency
Bidirectional references must be consistent:

```python
def validate_bidirectional_refs(model):
    errors = []

    # ArchiMate → OpenAPI via spec.openapi
    # OpenAPI → ArchiMate via x-archimate-ref
    for element in model.archimate_elements:
        if 'spec.openapi' in element.properties:
            openapi_file = element.properties['spec.openapi']
            openapi_spec = load_openapi(openapi_file)

            if openapi_spec.info.get('x-archimate-ref') != element.id:
                errors.append(f"Bidirectional reference mismatch: {element.id}")

    return errors
```

## Integration Patterns

### Pattern 1: Motivation-Driven Traceability

Requirements flow down, implementation traces up:

```
Layer 01 (Motivation)
  Requirement: "Fast checkout"
         ↓ constrains
  Goal: "Customer satisfaction"
         ↑ fulfills (traced by Layer 09)
         ↑ supports (traced by Layer 04)
Layer 02-11 (Implementation)
```

### Pattern 2: Technology-Constrained Design

Technology choices constrain lower layers:

```
Layer 05 (Technology)
  "PostgreSQL 15"
         ↓ constrains
  Layer 07 (Data Model)
    Uses PostgreSQL-compatible types
         ↓ realizes
  Layer 08 (Datastore)
    PostgreSQL-specific DDL
```

### Pattern 3: ArchiMate Spine

ArchiMate provides structural relationships:

```
Layer 04 (Application)
  ApplicationComponent
         ↓ properties
    spec.openapi → Layer 06
    spec.ux → Layer 09
    spec.security → Layer 03
```

## Tooling Support

### Reference Checker

```bash
# Validate all cross-layer references
dr validate --cross-layer

# Check specific reference types
dr validate --references operationId
dr validate --references schemaRef
dr validate --references x-archimate-ref
```

### Traceability Queries

```bash
# Find all implementations of a requirement
dr trace req-checkout-30sec --downstream

# Find all requirements for a component
dr trace app-checkout-ui --upstream

# Generate traceability matrix
dr export --format traceability-matrix
```

### Impact Analysis

```bash
# What's affected if we change this API?
dr impact api.createCheckout

# What UX states use this schema?
dr impact schema.Checkout
```

## Best Practices

1. **Use Standard References** - Prefer `$ref`, `operationId` over custom references
2. **Validate Early** - Check references during development, not deployment
3. **Bidirectional Consistency** - Maintain both forward and backward references
4. **Document Intent** - Explain why layers are connected, not just that they are
5. **Automate Validation** - Use CI/CD to catch broken references

---

**Next:** [04-reference-directionality.md](04-reference-directionality.md) - Understanding upward vs. downward references
