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

> **Note:** Data governance (`x-data-governance`) and database mapping (`x-database`) are
> cross-layer extension **attributes**, not node types. Set them directly on the schema element
> they describe — on an `objectschema` for table-level mapping, or on a `schemaproperty` for
> field-level governance (e.g., marking an individual `email` property as PII).

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

| Misclassification                                                       | Correct Classification                                                                          | Why                                                                                                                                                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modeling `x-data-governance` or `x-database` as their own elements      | Set as extension attributes on the relevant schema element (`objectschema` or `schemaproperty`) | These are cross-layer extension attributes, not spec node types                                                                                                                         |
| Using `objectschema` for a reusable definition in a `definitions` block | `schemadefinition`                                                                              | `definitions` entries are named, reusable definitions; `objectschema` is for structural instances                                                                                       |
| Using `schemadefinition` for a top-level schema document                | `jsonschema`                                                                                    | A root document with `$schema` and `$id` is `jsonschema`, not a definition                                                                                                              |
| Using `schemaproperty` for a standalone string/numeric/array type       | `stringschema` / `numericschema` / `arrayschema`                                                | Use the specific schema type when the constraint set is rich enough to stand alone; use `schemaproperty` only for inline field declarations within an `objectschema`                    |
| Using `objectschema` for a schema that uses `allOf` to extend another   | `schemacomposition`                                                                             | When the primary purpose is combining or extending schemas, classify as `schemacomposition` — even if the schema also declares `properties`                                             |
| Using `schemaproperty` for a bare `$ref` with no other constraints      | `reference`                                                                                     | A standalone `$ref` with nothing else is a `reference`; use `schemaproperty` only when the field also carries its own constraints (`title`, `description`, `readOnly`, `default`, etc.) |

---

## When to Use This Skill

Activate when the user:

- Mentions "data model", "schema", "JSON Schema", "data structure"
- Wants to define object structures, properties, or validation rules
- Asks about data types, constraints, or data governance
- Needs to model entities like User, Order, Product, etc.
- Wants to link data models to APIs or databases

---

## Cross-Layer Relationships

**Outgoing (Data Model → Other Layers):**

- `x-business-object-ref` → Business Layer (what business concept does this represent?)
- `x-database` → Data Store Layer (how is this stored physically?)
- `x-data-governance` → Security Layer (classification, PII, retention)
- `x-apm-data-quality-metrics` → APM Layer (data quality monitoring)

**Incoming (Other Layers → Data Model):**

- API Layer → Data Model (request/response schemas via $ref)
- UX Layer → Data Model (form validation rules)
- Testing Layer → Data Model (input constraints for test partitioning)

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
      x-data-governance:
        classification: confidential
        pii: true
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
  x-business-object-ref: business.actor.user
  x-database:
    table: users
    schema: public
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
- Mark PII and sensitive fields with `x-data-governance` on the relevant `schemaproperty` or `objectschema`
- Add `x-business-object-ref` to link to the Business Layer and `x-database` to link to the Data Store Layer
- Use `format` for semantic string types (`email`, `uuid`, `date-time`, `uri`) rather than custom `pattern` where a standard format exists
