# Cross-Layer Relationships Guide

**Purpose**: Clarify the confusing and inconsistent cross-layer relationship syntax used across the 12-layer architecture model.

**Audience**: Architects, developers, tool implementers, and anyone modeling cross-layer relationships.

---

## TL;DR - Quick Start

**When linking an element to another layer:**

1. **Is it to a STANDARD SPEC (OpenAPI, JSON Schema)?** → Use **Pattern A** (`x-` extensions)
2. **Is it referencing UP to the Motivation Layer (01)?** → Use **Pattern B** (`motivation.field-name`)
3. **Is it a complex group of related references?** → Use **Pattern C** (nested objects)
4. **Otherwise?** → Use native field names from that layer's spec

**Naming Rule**: Use `kebab-case` for relationship types in property names: `supports-goals`, `governed-by-principles`, `fulfills-requirements`

---

## The Four Reference Patterns

Every cross-layer reference in the spec uses one of four distinct patterns. Understanding which pattern to use prevents confusion and inconsistency.

### Pattern A: X-Extensions for Standard Specs

**Format**: `x-{property-name}` (OpenAPI/JSON Schema extension convention)

**When to use**: When adding references to external standard specifications (OpenAPI 3.0, JSON Schema Draft 7)

**Why**: The `x-` prefix is OpenAPI/JSON Schema convention for custom extensions and avoids conflicts with standard fields

**Cardinality**: JSON array for multiple values

**Format**: JSON array of UUIDs or strings

**Examples**:

```yaml
# In OpenAPI specification file
openapi: 3.0.0
info:
  x-archimate-ref: "app-product-api" # Single reference
  x-supports-goals: # Multiple references
    - "goal-revenue"
    - "goal-customer-satisfaction"
  x-fulfills-requirements:
    - "req-product-creation"
paths:
  /products:
    post:
      x-business-service-ref: "service-product-mgmt"
      x-required-permissions:
        - "products:create"
        - "products:write"
```

**Used by**: Layers 6 (API), 7 (Data Model), 8 (Datastore), 11 (APM)

---

### Pattern B: Dot-Notation Properties

**Format**: `{target-layer}.{relationship-type}` where target-layer is lowercase (e.g., `motivation`, `business`, `security`)

**When to use**: When implementation layers (2-11) reference UP to higher layers, especially the Motivation Layer (01)

**Why**: Clear namespace separation, maintains separation of concerns, signals that references are "upward"

**Cardinality**: Comma-separated string for multiple values (NO SPACES between values)

**Format**: String IDs separated by commas: `"id1,id2,id3"`

**Examples**:

```yaml
# In element properties (layers 2-11)
BusinessService:
  id: "order-service"
  name: "Order Processing Service"
  properties:
    # References to Motivation Layer
    motivation.supports-goals: "goal-customer-satisfaction,goal-revenue-growth"
    motivation.delivers-value: "value-customer-convenience,value-operational-efficiency"
    motivation.governed-by-principles: "principle-customer-first,principle-automation"
    motivation.fulfills-requirements: "req-secure-ordering,req-payment-validation"

    # References to other layers
    business.realizes-services: "service-logistics"
    security.security-actors: "actor-payment-processor"
    application.master-data-source: "dataobject-order"
```

**Used by**: Layers 2 (Business), 4 (Application), 5 (Technology), 9 (UX), 10 (Navigation), 11 (APM)

---

### Pattern C: Nested Objects for Complex Reference Groups

**Format**: Nested YAML/JSON object with camelCase keys (different from Pattern B!)

**When to use**: When multiple related references need grouping OR when a layer supports context-specific variants

**Why**: Reduces top-level property clutter, groups semantically related references, allows for additional metadata per group

**Cardinality**: True JSON array for multiple values

**Format**: JSON array of UUIDs

**Examples**:

```yaml
# In UX Layer element
UserInterface:
  id: "checkout-flow"
  name: "Checkout Experience"

  # Pattern C: Nested object with camelCase keys
  motivationAlignment:
    supportsGoals:
      - "goal-customer-satisfaction"
      - "goal-revenue-growth"
    deliversValue:
      - "value-customer-convenience"
    governedByPrinciples:
      - "principle-customer-first"
    fulfillsRequirements:
      - "req-mobile-friendly"

  # Another grouped reference
  businessAlignment:
    supportsProcesses:
      - "process-order-fulfillment"
    realizesServices:
      - "service-order-checkout"
    targetActors:
      - "actor-customer"

  # Security grouping
  securityContext:
    resourceRef: "resource-checkout-page"
    requiredRoles:
      - "customer"
    requiredPermissions:
      - "checkout:execute"
      - "payment:process"
```

**Used by**: Layers 9 (UX), 10 (Navigation), sometimes Layer 11 (APM)

---

### Pattern D: Native Field Names from Standard Specs

**Format**: Standard field names defined by the spec (OpenAPI, JSON Schema, ArchiMate, etc.)

**When to use**: Using native features from industry standards

**Why**: Leverages existing standards, no need for custom extensions

**Examples**:

```yaml
# OpenAPI native fields
Operation:
  operationId: "createCheckout" # Native OpenAPI field

# JSON Schema native fields
DataSchema:
  $ref: "checkout-schema.json#/Product" # Native JSON Schema reference

# Application Layer native fields
ApplicationService:
  specification: "path/to/spec.yaml" # ArchiMate native field
```

**Used by**: All layers when native spec fields are appropriate

---

## Pattern Selection Decision Tree

```
Does this reference belong in a standard spec file?
├─ YES (OpenAPI, JSON Schema)? → Pattern A (x-extensions)
│
└─ NO, it's in our architecture model
   ├─ Is it referencing the Motivation Layer (01)?
   │  └─ YES? → Pattern B (motivation.field-name)
   │
   ├─ Is it multiple related references that should be grouped?
   │  └─ YES? → Pattern C (nested object with camelCase)
   │
   └─ Can I use a native field from this layer's spec?
      └─ YES? → Pattern D (native field name)
```

---

## Naming Conventions Reference

### Kebab-Case for Relationship Types (Patterns A & B)

Use `kebab-case` (lowercase with hyphens) for relationship type names:

**Standard Motivation Layer relationships**:

- `supports-goals` - Element helps achieve specified goals
- `delivers-value` - Element creates value for stakeholders
- `governed-by-principles` - Element follows architectural principles
- `fulfills-requirements` - Element satisfies requirements
- `constrained-by` - Element respects constraints

**Cross-layer relationships**:

- `supports-processes` - Supports business processes
- `realizes-services` - Realizes business services
- `application-ref` - References application element
- `schema-ref` - References JSON schema
- `security-actors` - Maps to security actors
- `business-metrics` - Measured by business metrics

### CamelCase for Object Keys (Pattern C)

When using nested objects, use `camelCase` for keys:

```yaml
motivationAlignment: # camelCase
  supportsGoals: [...] # camelCase (NOT supports-goals)
  deliversValue: [...] # camelCase (NOT delivers-value)
  governedByPrinciples: [...] # camelCase (NOT governed-by-principles)
```

### Layer Prefix Conventions (Pattern B)

Use consistent, lowercase layer prefixes:

- `motivation.*` - Motivation Layer references
- `business.*` - Business Layer references
- `security.*` - Security Layer references
- `application.*` - Application Layer references
- `technology.*` - Technology Layer references
- `api.*` - API Layer references
- `data.*` - Data Model Layer references
- `data-store.*` - Data Store Layer references
- `ux.*` - UX Layer references
- `navigation.*` - Navigation Layer references
- `apm.*` - APM/Observability Layer references
- `testing.*` - Testing Layer references

---

## Cardinality Rules

| Pattern              | Single/Multiple | Format                             | Example                                      |
| -------------------- | --------------- | ---------------------------------- | -------------------------------------------- |
| **A (x-extension)**  | Both            | JSON array `["id1", "id2"]`        | `x-supports-goals: ["goal-1", "goal-2"]`     |
| **B (dot-notation)** | Both            | Comma-separated string `"id1,id2"` | `motivation.supports-goals: "goal-1,goal-2"` |
| **C (nested)**       | Both            | JSON array `["id1", "id2"]`        | `supportsGoals: ["goal-1", "goal-2"]`        |
| **D (native)**       | Varies          | Per spec                           | Depends on standard                          |

**Important**:

- Pattern A uses JSON arrays
- Pattern B uses comma-separated strings (no spaces!)
- Pattern C uses JSON arrays
- Pattern D depends on the native spec

---

## Complete Reference Catalog by Target Layer

### To Motivation Layer (Layer 01)

**Field Paths (Pattern B)**: `motivation.supports-goals`, `motivation.delivers-value`, `motivation.governed-by-principles`, `motivation.fulfills-requirements`, `motivation.constrained-by`

**X-Extensions (Pattern A)**: `x-supports-goals`, `x-delivers-value`, `x-governed-by-principles`, `x-fulfills-requirements`, `x-constrained-by`

**Nested Object (Pattern C)**: `motivationAlignment.supportsGoals`, `motivationAlignment.deliversValue`, `motivationAlignment.governedByPrinciples`, `motivationAlignment.fulfillsRequirements`

**When to use each**:

- **Pattern B**: Most common for layers 2-11 referencing motivation
- **Pattern A**: When in OpenAPI or JSON Schema files
- **Pattern C**: When grouping multiple motivation references with additional metadata

**Examples by layer**:

```yaml
# Layer 02 (Business)
BusinessService:
  motivation.supports-goals: "goal-revenue"

# Layer 04 (Application)
ApplicationService:
  motivation.fulfills-requirements: "req-secure-auth,req-audit-logging"

# Layer 06 (API) - Pattern A in OpenAPI
paths:
  /checkout:
    post:
      x-fulfills-requirements:
        - "req-payment-processing"

# Layer 09 (UX) - Pattern C
UserInterface:
  motivationAlignment:
    supportsGoals:
      - "goal-customer-satisfaction"
```

---

### To Business Layer (Layer 02)

| Pattern   | Example                                      | Use Case            |
| --------- | -------------------------------------------- | ------------------- |
| Pattern B | `business.supports-processes: "proc-order"`  | Standard reference  |
| Pattern B | `business.realizes-services: "svc-checkout"` | Service realization |
| Pattern B | `business.target-actors: "actor-customer"`   | Target audience     |
| Pattern C | `businessAlignment.supportsProcesses: [...]` | Grouped references  |

---

### To Security Layer (Layer 03)

| Pattern   | Example                                                 | Use Case                |
| --------- | ------------------------------------------------------- | ----------------------- |
| Pattern B | `security.security-actors: "actor-admin"`               | Actor mapping           |
| Pattern B | `security.required-roles: "admin,auditor"`              | Role requirements       |
| Pattern B | `security.required-permissions: "read:user,write:user"` | Permission requirements |
| Pattern C | `securityContext.resourceRef: "resource-api"`           | Grouped security refs   |

---

### To API Layer (Layer 06)

| Pattern   | Example                                              | Use Case            |
| --------- | ---------------------------------------------------- | ------------------- |
| Pattern A | `x-archimate-ref: "app-api-service"`                 | In OpenAPI spec     |
| Pattern B | `api.operation-id: "createOrder"`                    | Single operation    |
| Pattern B | `api.operations: "createOrder,getOrder,deleteOrder"` | Multiple operations |

---

### To Data Model Layer (Layer 07)

| Pattern   | Example                               | Use Case            |
| --------- | ------------------------------------- | ------------------- |
| Pattern A | `x-json-schema: "schemas/order.json"` | In JSON Schema file |
| Pattern B | `data.schema-ref: "order-schema"`     | Schema reference    |
| Pattern B | `data.schema-id: "urn:schema:order"`  | Formal schema ID    |

---

## Practical Examples

### Example 1: Business Service (Layer 02)

```yaml
Order Processing Service:
  id: "service-order-processing"

  # Pattern B: Upward references to Motivation
  motivation.supports-goals: "goal-customer-satisfaction,goal-operational-efficiency"
  motivation.delivers-value: "value-convenience,value-reliability"
  motivation.governed-by-principles: "principle-automation,principle-customer-first"

  # Pattern B: Cross-layer references
  security.security-controls: "control-transaction-validation,control-fraud-detection"
  apm.business-metrics: "metric-order-volume,metric-processing-time"

  # Relations to other Business Layer elements (intra-layer, not cross-layer)
  processes:
    - "process-order-validation"
    - "process-order-fulfillment"
```

### Example 2: OpenAPI Specification (Layer 06)

```yaml
# In OpenAPI file (Pattern A)
openapi: 3.0.0
info:
  title: Order Processing API
  x-archimate-ref: "service-order-processing" # References Layer 02 service
  x-supports-goals:
    - "goal-customer-satisfaction"
  x-fulfills-requirements:
    - "req-order-creation"
    - "req-payment-processing"

paths:
  /orders:
    post:
      operationId: createOrder
      x-business-service-ref: "service-order-processing"
      x-required-permissions:
        - "orders:create"
        - "payments:process"
      requestBody:
        content:
          application/json:
            schema:
              x-data-model-ref: "dataobject-order"
```

### Example 3: UX Component (Layer 09)

```yaml
# Pattern C: Nested objects for UX
CheckoutFlow:
  id: "checkout-flow"

  # Pattern C: Grouped motivation references (camelCase keys!)
  motivationAlignment:
    supportsGoals:
      - "goal-customer-satisfaction"
      - "goal-revenue-growth"
    deliversValue:
      - "value-convenience"
      - "value-trust"
    governedByPrinciples:
      - "principle-mobile-first"
      - "principle-accessibility"

  # Pattern B: Business process alignment
  business.supports-processes: "process-order-checkout,process-payment"

  # Pattern B: Security context
  security.required-permissions: "checkout:execute,payment:process"

  # Pattern D: Native UX field
  screens:
    - "cart-review"
    - "payment-details"
    - "confirmation"
```

### Example 4: JSON Schema (Layer 07)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "urn:schema:order",
  "x-archimate-ref": "dataobject-order",
  "x-business-object-ref": "businessobject-order",
  "x-supports-goals": ["goal-data-accuracy"],
  "x-data-governance": {
    "governedBy": {
      "principleRefs": ["principle-data-integrity"],
      "requirementRefs": ["req-gdpr-compliance"],
      "constraintRefs": ["constraint-retention-90days"]
    }
  },
  "type": "object",
  "properties": {
    "orderId": {
      "type": "string",
      "x-apm-business-metrics": ["metric-order-volume"]
    }
  }
}
```

---

## Common Mistakes & How to Fix Them

### Mistake 1: Mixing Cardinality Formats

❌ **WRONG** - Using array in Pattern B (dot-notation):

```yaml
motivation.supports-goals:
  - "goal-1"
  - "goal-2"
```

✅ **CORRECT** - Use comma-separated string:

```yaml
motivation.supports-goals: "goal-1,goal-2"
```

---

### Mistake 2: Inconsistent Naming Convention

❌ **WRONG** - Using kebab-case in nested objects:

```yaml
motivationAlignment:
  supports-goals: ["goal-1"] # Wrong! Should be camelCase
```

✅ **CORRECT** - Use camelCase in nested objects:

```yaml
motivationAlignment:
  supportsGoals: ["goal-1"] # Correct
```

---

### Mistake 3: Using Pattern B Outside Upward References

❌ **WRONG** - Using dot-notation for non-upward references:

```yaml
# Pattern B is for Motivation or cross-layer references
api.business-service: "service-order" # Don't use Pattern B for arbitrary references
```

✅ **CORRECT** - Use Pattern D or native fields:

```yaml
# Use native field or Pattern A
x-business-service-ref: "service-order"
```

---

### Mistake 4: Spaces in Comma-Separated Lists

❌ **WRONG** - Spaces after commas:

```yaml
motivation.supports-goals: "goal-1, goal-2, goal-3" # Wrong! Has spaces
```

✅ **CORRECT** - No spaces:

```yaml
motivation.supports-goals: "goal-1,goal-2,goal-3"
```

---

### Mistake 5: Using Array Notation When String Expected

❌ **WRONG** - Array syntax in Pattern B:

```yaml
motivation.supports-goals: ["goal-1", "goal-2"] # Wrong! Pattern B uses comma-separated string
```

✅ **CORRECT** - Comma-separated string:

```yaml
motivation.supports-goals: "goal-1,goal-2"
```

---

## Validation Checklist

When adding a cross-layer relationship, verify:

- [ ] I identified which pattern to use (A, B, C, or D)
- [ ] I'm using the correct cardinality (array vs comma-separated string)
- [ ] I'm using the correct naming convention (kebab-case for B, camelCase for C)
- [ ] I have no spaces in comma-separated lists (Pattern B)
- [ ] The target element ID exists in the target layer
- [ ] I'm not violating the "higher→lower" reference direction rule
- [ ] The relationship is documented in the `06-cross-layer-reference-registry.md`
- [ ] My relationship matches the catalog entry format

---

## Key Takeaways

1. **Four patterns exist for a reason** - Each optimizes for different use cases (standards, upward refs, grouped refs, native fields)

2. **Cardinality is explicit** - Pattern A/C use arrays, Pattern B uses comma-separated strings

3. **Naming follows conventions** - Kebab-case for Pattern B/A, camelCase for Pattern C

4. **Always reference upward** - Implementation layers reference strategic layers, never the reverse

5. **Document and validate** - Keep the reference registry and schema validation in sync

6. **When in doubt, check the registry** - `/workspace/spec/core/06-cross-layer-reference-registry.md` is the source of truth

---

## See Also

- [Cross-Layer Reference Registry](../core/06-cross-layer-reference-registry.md) - Comprehensive catalog of all patterns
- [Layer Specifications](../layers/) - Individual layer documentation
- [CLI Schemas](../../cli/src/schemas/bundled/) - Implementation validation schemas
