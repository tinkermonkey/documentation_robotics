# Layer 7: Data Model Layer

**Standard**: [JSON Schema Draft 7](https://json-schema.org/draft-07/)

---

## Overview

This layer defines **30** node types that represent various aspects of the architecture.

## Node Types

### MaskingStrategy

**ID**: `data-model.maskingstrategy`

MaskingStrategy element in Data Model Layer

### ArraySchema

**ID**: `data-model.arrayschema`

ArraySchema validation rules

**Attributes**:

- `type`: string (required)
- `items`: string
- `minItems`: integer
- `maxItems`: integer
- `uniqueItems`: boolean
- `contains`: string

### ConstraintType

**ID**: `data-model.constrainttype`

ConstraintType element in Data Model Layer

### x-business-object-ref

**ID**: `data-model.x-business-object-ref`

Reference to BusinessObject this schema implements

**Attributes**:

- `value`: string (required)

### Reference

**ID**: `data-model.reference`

Reference to another schema

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)

### SQLType

**ID**: `data-model.sqltype`

SQLType element in Data Model Layer

### DataGovernance

**ID**: `data-model.datagovernance`

Metadata about data ownership, classification, sensitivity level, and handling requirements. Ensures data is managed according to organizational policies and regulations.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)

### ObjectSchema

**ID**: `data-model.objectschema`

ObjectSchema validation rules

**Attributes**:

- `type`: string (required)
- `required`: string
- `additionalProperties`: string
- `minProperties`: integer
- `maxProperties`: integer
- `properties`: array
  - Contains relationship

### SchemaProperty

**ID**: `data-model.schemaproperty`

Defines a single property within a schema, including its type, constraints, validation rules, and documentation. The fundamental building block of data model structure.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `title`: string (required)
- `description`: string
- `format`: string (required)
- `default`: string (required)
- `enum`: string (required)
- `const`: string (required)
- `readOnly`: boolean
- `writeOnly`: boolean
- `deprecated`: boolean
- `examples`: string (required)

### PartitionStrategy

**ID**: `data-model.partitionstrategy`

PartitionStrategy element in Data Model Layer

### x-security

**ID**: `data-model.x-security`

Security and privacy metadata

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `pii`: boolean (required)
- `encrypted`: boolean (required)
- `classification`: string (required)
- `retention`: string (required)
- `masking`: string (required)
- `redaction`: boolean (required)

### x-database

**ID**: `data-model.x-database`

Database mapping information

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `table`: string (required)
- `schema`: string (required)
- `engine`: string (required)

### DatabaseMapping

**ID**: `data-model.databasemapping`

Specifies how a logical data model entity maps to physical database storage, including table names, column mappings, and storage optimizations. Bridges logical and physical data layers.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `table`: string (required)
- `schema`: string (required)
- `catalog`: string (required)
- `engine`: string (required)

### DataQualityMetrics

**ID**: `data-model.dataqualitymetrics`

Defines measurable quality attributes for data elements such as completeness, accuracy, consistency, and timeliness. Enables data quality monitoring and SLA enforcement.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `schemaRef`: string (required)
- `monitoringEnabled`: boolean

### IndexType

**ID**: `data-model.indextype`

IndexType element in Data Model Layer

### x-ui

**ID**: `data-model.x-ui`

UI rendering hints

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `component`: string (required)
- `label`: string (required)
- `placeholder`: string (required)
- `helpText`: string (required)
- `order`: integer (required)
- `readOnly`: boolean (required)
- `hidden`: boolean (required)
- `group`: string (required)

### SchemaDefinition

**ID**: `data-model.schemadefinition`

A reusable JSON Schema definition that can be referenced throughout the data model. Enables DRY schema design and consistent type definitions across entities.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `title`: string (required)
- `description`: string
- `type`: string (required)
- `properties`: array
  - Contains relationship
- `items`: array
  - Contains relationship

### JSONSchema

**ID**: `data-model.jsonschema`

Root schema document

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `$schema`: string (required)
- `$id`: string (required)
- `title`: string
- `description`: string
- `type`: string (required)
- `definitions`: array
  - Contains relationship
- `properties`: array
  - Contains relationship
- `x-source-reference`: string
  - Source code reference using OpenAPI x- extension pattern. This pattern is used for OpenAPI-style layers (API, Data Model, Datastore) to maintain compatibility with OpenAPI tooling, as opposed to the nested properties.source.reference pattern used in ArchiMate-style layers (Application, Technology).

### SecurityClassification

**ID**: `data-model.securityclassification`

SecurityClassification element in Data Model Layer

### UIComponent

**ID**: `data-model.uicomponent`

UIComponent element in Data Model Layer

### string

**ID**: `data-model.string`

string element in Data Model Layer

### DataClassificationLevel

**ID**: `data-model.dataclassificationlevel`

DataClassificationLevel element in Data Model Layer

### SchemaComposition

**ID**: `data-model.schemacomposition`

Combining multiple schemas

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)

### x-data-governance

**ID**: `data-model.x-data-governance`

Data model governance metadata (root-level)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `governedBy`: object

### NumericSchema

**ID**: `data-model.numericschema`

NumericSchema validation rules

**Attributes**:

- `type`: string (required)
- `minimum`: number
- `maximum`: number
- `exclusiveMinimum`: number
- `exclusiveMaximum`: number
- `multipleOf`: number

### JSONType

**ID**: `data-model.jsontype`

Core JSON data types

**Attributes**:

- `value`: string (required)

### ReferentialAction

**ID**: `data-model.referentialaction`

ReferentialAction element in Data Model Layer

### StringSchema

**ID**: `data-model.stringschema`

StringSchema validation rules

**Attributes**:

- `type`: string (required)
- `minLength`: integer
- `maxLength`: integer
- `pattern`: string
- `format`: string

### x-apm-data-quality-metrics

**ID**: `data-model.x-apm-data-quality-metrics`

Links schema to data quality metrics in APM/Observability Layer

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `completenessMetrics`: string (required)
- `accuracyMetrics`: string (required)
- `consistencyMetrics`: string (required)
- `freshnessMetrics`: string (required)
- `uniquenessMetrics`: string (required)
- `integrityMetrics`: string (required)

### StringFormat

**ID**: `data-model.stringformat`

StringFormat element in Data Model Layer

## References

- [JSON Schema Draft 7](https://json-schema.org/draft-07/)
