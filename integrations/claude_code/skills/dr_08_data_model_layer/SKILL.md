---
name: LAYER_07_DATA_MODEL
description: Expert knowledge for Data Model Layer modeling in Documentation Robotics
triggers:
  [
    "JSON Schema",
    "data model",
    "schema",
    "object schema",
    "data structure",
    "properties",
    "validation",
    "data type"
  ]
version: 0.8.3
---

# Data Model Layer Skill

**Layer Number:** 07
**Specification:** Metadata Model Spec v0.8.3
**Purpose:** Defines logical data structures using JSON Schema Draft 7, specifying entities, properties, validation rules, and data governance.

---

## Layer Overview

The Data Model Layer captures **logical data structures**:

- **SCHEMAS** - Object, array, string, numeric schemas
- **VALIDATION** - Type constraints, required fields, patterns, ranges
- **COMPOSITION** - Schema combinations (allOf, anyOf, oneOf, not)
- **GOVERNANCE** - Data classification, PII, retention policies
- **INTEGRATION** - Links to business objects, database tables, API operations

This layer uses **JSON Schema Draft 7** (industry standard) with custom extensions for cross-layer traceability.

**Central Entity:** The **ObjectSchema** (defining an object structure) is the core modeling unit.

---

## Entity Types

> **CLI Introspection:** Run `dr schema types data-model` for the authoritative, always-current list of node types.
> Run `dr schema node <type-id>` for full attribute details on any type.

### Core JSON Schema Entities (9 types)

| Entity Type           | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| **JSONSchema**        | Root schema document                                       |
| **ObjectSchema**      | Defines object structure with properties                   |
| **ArraySchema**       | Defines array with items and constraints                   |
| **StringSchema**      | String validation (length, pattern, format)                |
| **NumericSchema**     | Number/integer validation (min, max, multipleOf)           |
| **SchemaComposition** | Combines schemas (allOf, anyOf, oneOf, not)                |
| **SchemaDefinition**  | Named reusable type for shared use in `definitions` blocks |
| **SchemaProperty**    | Individual property definition                             |
| **Reference**         | $ref to other schemas                                      |

> **Note:** Data governance and database mapping are not node types or `x-...` attributes. Record
> them as relationships from the schema element they describe: `schemaproperty satisfies
security.dataclassification` for field-level governance (e.g., marking an `email` property as PII),
> and `objectschema maps-to data-store.collection` for the physical table or collection.

---

## Type Decision Tree

Use this decision tree **before assigning a type** to any code pattern.

- Is this a **root JSON Schema document** with `$schema`, `$id`, and `type` fields at the top level? → `data-model.jsonschema`
- Is this primarily a **schema combinator** using `allOf`, `anyOf`, `oneOf`, or `not` (even if it also has `properties`)? → `data-model.schemacomposition`
- Is this a **reusable named type** declared in a `definitions` block (has `title` and `type`)? → `data-model.schemadefinition`
- Is this an **object structure** with `type: object` and `properties`? → `data-model.objectschema`
- Is this an **array definition** with `items`, `minItems`, `maxItems`, `uniqueItems`, or `contains`? → `data-model.arrayschema`
- Is this a **string validation rule** with `minLength`, `maxLength`, `pattern`, or `format`? → `data-model.stringschema`
- Is this a **number/integer validation rule** with `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, or `multipleOf`? → `data-model.numericschema`
- Is this a **standalone `$ref` pointer** with no additional constraints? → `data-model.reference`
- Is this an **inline field declaration** within an `objectschema`, carrying its own constraints (`title`, `description`, `readOnly`, `default`, `const`, etc.) alongside or instead of a `$ref`? → `data-model.schemaproperty`

---

## Common Misclassifications

| Misclassification                                                                                                        | Correct Classification                                                                                          | Why                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modeling data governance or database mapping as their own elements (or as `x-data-governance` / `x-database` attributes) | Relationships from the schema element: `satisfies security.dataclassification`, `maps-to data-store.collection` | These are cross-layer links, not data-model node types                                                                                                                                  |
| Using `objectschema` for a reusable definition in a `definitions` block                                                  | `schemadefinition`                                                                                              | `definitions` entries are named, reusable definitions; `objectschema` is for structural instances                                                                                       |
| Using `schemadefinition` for a top-level schema document                                                                 | `jsonschema`                                                                                                    | A root document with `$schema` and `$id` is `jsonschema`, not a definition                                                                                                              |
| Using `schemaproperty` for a standalone string/numeric/array type                                                        | `stringschema` / `numericschema` / `arrayschema`                                                                | Use the specific schema type when the constraint set is rich enough to stand alone; use `schemaproperty` only for inline field declarations within an `objectschema`                    |
| Using `objectschema` for a schema that uses `allOf` to extend another                                                    | `schemacomposition`                                                                                             | When the primary purpose is combining or extending schemas, classify as `schemacomposition` — even if the schema also declares `properties`                                             |
| Using `schemaproperty` for a bare `$ref` with no other constraints                                                       | `reference`                                                                                                     | A standalone `$ref` with nothing else is a `reference`; use `schemaproperty` only when the field also carries its own constraints (`title`, `description`, `readOnly`, `default`, etc.) |

---

## When to Use This Skill

Activate when the user:

- Mentions "data model", "schema", "JSON Schema", "data structure"
- Wants to define object structures, properties, or validation rules
- Asks about data types, constraints, or data governance
- Needs to model entities like User, Order, Product, etc.
- Wants to link data models to APIs or databases

---

## Intra-Layer Relationships

| Source Type       | Predicate   | Target Type       | Example                                                           |
| ----------------- | ----------- | ----------------- | ----------------------------------------------------------------- |
| JSONSchema        | aggregates  | ObjectSchema      | "Order API Schemas" document aggregates "Order"                   |
| JSONSchema        | aggregates  | SchemaDefinition  | "Order API Schemas" aggregates the "Address" definition           |
| JSONSchema        | aggregates  | SchemaComposition | "Order API Schemas" aggregates "PaymentMethod" (`oneOf`)          |
| ObjectSchema      | aggregates  | SchemaProperty    | "Order" aggregates the "status" property                          |
| ObjectSchema      | extends     | ObjectSchema      | "AdminUser" extends "User"                                        |
| SchemaProperty    | references  | StringSchema      | "email" property references "EmailString" (`format: email`)       |
| SchemaProperty    | references  | NumericSchema     | "total" property references "MoneyAmount" (`minimum: 0`)          |
| SchemaProperty    | references  | ArraySchema       | "lineItems" property references "LineItemList"                    |
| SchemaProperty    | references  | ObjectSchema      | "shippingAddress" property references "Address"                   |
| SchemaProperty    | references  | SchemaDefinition  | "currency" property references the "CurrencyCode" definition      |
| ArraySchema       | aggregates  | ObjectSchema      | "LineItemList" aggregates "LineItem" (its `items` schema)         |
| ArraySchema       | aggregates  | StringSchema      | "TagList" aggregates "Tag"                                        |
| ArraySchema       | aggregates  | Reference         | "OrderList" aggregates `$ref: #/definitions/Order`                |
| Reference         | references  | SchemaDefinition  | `$ref: #/definitions/Address` references the "Address" definition |
| SchemaComposition | composes    | ObjectSchema      | "PaymentMethod" (`oneOf`) composes "CardPayment"                  |
| SchemaComposition | composes    | SchemaDefinition  | "CustomerWithAudit" (`allOf`) composes "AuditFields"              |
| SchemaDefinition  | composes    | SchemaDefinition  | "Customer" composes "ContactInfo"                                 |
| SchemaDefinition  | specializes | SchemaDefinition  | "PremiumCustomer" specializes "Customer"                          |
| SchemaDefinition  | references  | SchemaDefinition  | "Invoice" references "Customer"                                   |

---

## Cross-Layer References

Cross-layer links are recorded as relationships (`dr relationship add`), not as `x-...` extension attributes.

### Outgoing References (Data Model → Other Layers)

| Source Type      | Predicate | Target Type                        | Example                                                          |
| ---------------- | --------- | ---------------------------------- | ---------------------------------------------------------------- |
| ObjectSchema     | realizes  | `business.businessobject`          | "Order" schema realizes the "Customer Order" business object     |
| SchemaDefinition | realizes  | `application.dataobject`           | "Customer" definition realizes the "Customer Record" data object |
| ObjectSchema     | maps-to   | `data-store.collection`            | "User" schema maps to the `users` table                          |
| SchemaDefinition | maps-to   | `data-store.collection`            | "AuditEntry" definition maps to the `audit_log` collection       |
| ObjectSchema     | maps-to   | `api.requestbody`                  | "CreateOrderRequest" maps to the `POST /orders` request body     |
| ObjectSchema     | maps-to   | `api.response`                     | "Order" maps to the `GET /orders/{id}` 200 response              |
| SchemaDefinition | maps-to   | `api.schema`                       | "Address" definition maps to the OpenAPI `Address` component     |
| JSONSchema       | realizes  | `api.schema`                       | "Order API Schemas" document realizes the API's schema set       |
| SchemaProperty   | maps-to   | `api.parameter`                    | "orderId" property maps to the `{orderId}` path parameter        |
| SchemaProperty   | satisfies | `security.dataclassification`      | "email" property satisfies the "PII" classification              |
| SchemaProperty   | satisfies | `security.fieldaccesscontrol`      | "ssn" property satisfies the "SSN Masking" field control         |
| SchemaProperty   | satisfies | `security.validationrule`          | "password" property satisfies the "Password Strength" rule       |
| SchemaDefinition | requires  | `security.retentionpolicy`         | "AuditEntry" requires the "7-Year Audit Retention" policy        |
| ObjectSchema     | satisfies | `motivation.requirement`           | "Order" satisfies "Orders must record tax breakdown"             |
| ObjectSchema     | serves    | `application.applicationcomponent` | "Order" serves the "Order Service" component                     |

### Incoming References (Other Layers → Data Model)

| Source Type                   | Predicate  | Target Type      | Example                                                    |
| ----------------------------- | ---------- | ---------------- | ---------------------------------------------------------- |
| `ux.dataconfig`               | maps-to    | ObjectSchema     | "Order Form Data" binding maps to the "Order" schema       |
| `ux.componentinstance`        | maps-to    | ObjectSchema     | "Customer Card" instance maps to "Customer"                |
| `ux.tablecolumn`              | maps-to    | SchemaProperty   | "Status" column maps to the "status" property              |
| `navigation.route`            | references | SchemaDefinition | `/orders/:id` route references "Order"                     |
| `navigation.contextvariable`  | maps-to    | SchemaProperty   | "selectedOrderId" context variable maps to "orderId"       |
| `testing.inputspacepartition` | references | SchemaProperty   | "Quantity Out Of Range" partition references "quantity"    |
| `testing.testcasesketch`      | tests      | SchemaDefinition | "Reject invalid currency" test sketch tests "CurrencyCode" |
| `testing.coveragerequirement` | covers     | SchemaProperty   | "Email format coverage" requirement covers "email"         |
| `apm.span`                    | monitors   | ObjectSchema     | "order.validate" span monitors "Order"                     |
| `apm.metricinstrument`        | monitors   | SchemaDefinition | "schema_validation_failures" counter monitors "Customer"   |

> API operations do not point at data-model schemas; the direction is the other way — the schema
> `maps-to` the API request body, response, or parameter it shapes.

---

## Common Commands

```bash
# Add object schema
dr add data-model objectschema "User" --description "User object schema"

# List data models
dr list data-model --type objectschema

# Validate data model layer
dr validate --layers data-model

# Export as JSON Schema
dr export jsonschema --layers data-model
```

---

## Example: User Schema

```yaml
id: data-model.objectschema.user
name: "User Schema"
type: objectschema
properties:
  type: object
  required: [id, email, username]
  properties:
    id:
      type: string
      format: uuid
      description: "Unique user identifier"
    email:
      type: string
      format: email
      description: "User email address"
    username:
      type: string
      minLength: 3
      maxLength: 50
      pattern: "^[a-zA-Z0-9_-]+$"
    created_at:
      type: string
      format: date-time
    roles:
      type: array
      items:
        type: string
      description: "User role assignments"
```

Link the schema to the business concept, its physical storage, and its data classification with relationships:

```bash
dr relationship add data-model.objectschema.user business.businessobject.user --predicate realizes
dr relationship add data-model.objectschema.user data-store.collection.users --predicate maps-to
dr relationship add data-model.schemaproperty.user-email security.dataclassification.pii --predicate satisfies
```

---

## Coverage Completeness Checklist

Before declaring data-model layer extraction complete, verify each type was considered:

- [ ] **arrayschema** — Array definitions with item constraints (e.g., list of strings, paginated results)
- [ ] **jsonschema** — Root schema documents (top-level `$schema` + `$id` declarations)
- [ ] **numericschema** — Numeric validation rules (prices, counts, scores with min/max/multipleOf)
- [ ] **objectschema** — Object structures with named properties (entities, payloads, records)
- [ ] **reference** — `$ref` pointers to shared or external schemas
- [ ] **schemacomposition** — Combinators (`allOf` for inheritance, `anyOf`/`oneOf` for polymorphism)
- [ ] **schemadefinition** — Reusable named definitions in `definitions` blocks
- [ ] **schemaproperty** — Individual field definitions within object schemas
- [ ] **stringschema** — String validation rules (lengths, patterns, formats like email/uuid/date-time)

If any type has ZERO elements, explicitly decide: "This type doesn't apply to this codebase" with reasoning.

---

## Modeling Best Practices

- Always specify `type` on schema elements — validation fails without it
- Break complex schemas into reusable `schemadefinition` entries and reference them via `$ref`
- Mark PII and sensitive fields with a `satisfies` relationship from the `schemaproperty` to a `security.dataclassification`
- Link schemas to the Business Layer with `realizes business.businessobject` and to the Data Store Layer with `maps-to data-store.collection`
- Use `format` for semantic string types (`email`, `uuid`, `date-time`, `uri`) rather than custom `pattern` where a standard format exists
