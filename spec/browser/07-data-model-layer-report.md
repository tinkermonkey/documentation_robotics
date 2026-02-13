# Data Model Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Arrayschema](#arrayschema)
  - [Databasemapping](#databasemapping)
  - [Datagovernance](#datagovernance)
  - [Dataqualitymetrics](#dataqualitymetrics)
  - [Jsonschema](#jsonschema)
  - [Jsontype](#jsontype)
  - [Numericschema](#numericschema)
  - [Objectschema](#objectschema)
  - [Reference](#reference)
  - [Schemacomposition](#schemacomposition)
  - [Schemadefinition](#schemadefinition)
  - [Schemaproperty](#schemaproperty)
  - [String](#string)
  - [Stringschema](#stringschema)
  - [X-apm-data-quality-metrics](#x-apm-data-quality-metrics)
  - [X-business-object-ref](#x-business-object-ref)
  - [X-data-governance](#x-data-governance)
  - [X-database](#x-database)
  - [X-security](#x-security)
  - [X-ui](#x-ui)

## Layer Introduction

**Layer 7**: Data Model
**Standard**: [JSON Schema Draft 7](https://json-schema.org/draft-07/)

Layer 7: Data Model Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 20    |
| Intra-Layer Relationships | 4     |
| Inter-Layer Relationships | 4     |
| Inbound Relationships     | 1     |
| Outbound Relationships    | 3     |

### Layer Dependencies

**Depends On**: [Business](./02-business-layer-report.md)

**Depended On By**: [Business](./02-business-layer-report.md), [Application](./04-application-layer-report.md)

## Intra-Layer Relationships

```mermaid
flowchart LR
  subgraph data-model
    arrayschema["arrayschema"]
    databasemapping["databasemapping"]
    datagovernance["datagovernance"]
    dataqualitymetrics["dataqualitymetrics"]
    jsonschema["jsonschema"]
    jsontype["jsontype"]
    numericschema["numericschema"]
    objectschema["objectschema"]
    reference["reference"]
    schemacomposition["schemacomposition"]
    schemadefinition["schemadefinition"]
    schemaproperty["schemaproperty"]
    string["string"]
    stringschema["stringschema"]
    x_apm_data_quality_metrics["x-apm-data-quality-metrics"]
    x_business_object_ref["x-business-object-ref"]
    x_data_governance["x-data-governance"]
    x_database["x-database"]
    x_security["x-security"]
    x_ui["x-ui"]
    jsonschema -->|apm-data-quality-metrics| dataqualitymetrics
    jsonschema -->|data-governance| datagovernance
    jsonschema -->|database-mapping| databasemapping
    schemaproperty -->|database-mapping| databasemapping
  end
```

## Inter-Layer Dependencies

```mermaid
flowchart TB
  classDef current fill:#f9f,stroke:#333,stroke-width:2px
  motivation["Motivation"]
  business["Business"]
  security["Security"]
  application["Application"]
  technology["Technology"]
  api["API"]
  data_model["Data Model"]
  data_store["Data Store"]
  ux["UX"]
  navigation["Navigation"]
  apm["APM"]
  testing["Testing"]
  technology --> security
  data_model --> business
  data_model --> application
  testing --> motivation
  business --> motivation
  business --> security
  business --> application
  business --> data_model
  application --> apm
  application --> motivation
  api --> security
  api --> business
  api --> data_store
  api --> application
  api --> apm
  class data_model current
```

## Inter-Layer Relationships Table

| Relationship ID                                                    | Source Node                                                    | Dest Node                                                                 | Dest Layer                                      | Predicate           | Cardinality | Strength |
| ------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- | ------------------- | ----------- | -------- |
| business.businessobject.governance-owner.data-model.datagovernance | [businessobject](./02-business-layer-report.md#businessobject) | [datagovernance](./07-data-model-layer-report.md#datagovernance)          | [Data Model](./07-data-model-layer-report.md)   | governance-owner    | many-to-one | medium   |
| data-model.jsonschema.archimate-ref.application.applicationservice | [jsonschema](./07-data-model-layer-report.md#jsonschema)       | [applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | archimate-ref       | many-to-one | medium   |
| data-model.jsonschema.business-object-ref.business.businessobject  | [jsonschema](./07-data-model-layer-report.md#jsonschema)       | [businessobject](./02-business-layer-report.md#businessobject)            | [Business](./02-business-layer-report.md)       | business-object-ref | many-to-one | medium   |
| data-model.jsonschema.referenced-by.business.businessobject        | [jsonschema](./07-data-model-layer-report.md#jsonschema)       | [businessobject](./02-business-layer-report.md#businessobject)            | [Business](./02-business-layer-report.md)       | referenced-by       | many-to-one | medium   |

## Node Reference

### Arrayschema {#arrayschema}

**Spec Node ID**: `data-model.arrayschema`

ArraySchema validation rules

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Databasemapping {#databasemapping}

**Spec Node ID**: `data-model.databasemapping`

Specifies how a logical data model entity maps to physical database storage, including table names, column mappings, and storage optimizations. Bridges logical and physical data layers.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate        | Direction | Cardinality |
| --------------------------------- | ---------------- | --------- | ----------- |
| [schemaproperty](#schemaproperty) | database-mapping | inbound   | many-to-one |
| [jsonschema](#jsonschema)         | database-mapping | inbound   | many-to-one |

[Back to Index](#report-index)

### Datagovernance {#datagovernance}

**Spec Node ID**: `data-model.datagovernance`

Metadata about data ownership, classification, sensitivity level, and handling requirements. Ensures data is managed according to organizational policies and regulations.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 0
- **Inter-Layer**: Inbound: 1 | Outbound: 0

#### Intra-Layer Relationships

| Related Node              | Predicate       | Direction | Cardinality |
| ------------------------- | --------------- | --------- | ----------- |
| [jsonschema](#jsonschema) | data-governance | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                   | Layer                                     | Predicate        | Direction | Cardinality |
| -------------------------------------------------------------- | ----------------------------------------- | ---------------- | --------- | ----------- |
| [businessobject](./02-business-layer-report.md#businessobject) | [Business](./02-business-layer-report.md) | governance-owner | inbound   | many-to-one |

[Back to Index](#report-index)

### Dataqualitymetrics {#dataqualitymetrics}

**Spec Node ID**: `data-model.dataqualitymetrics`

Defines measurable quality attributes for data elements such as completeness, accuracy, consistency, and timeliness. Enables data quality monitoring and SLA enforcement.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node              | Predicate                | Direction | Cardinality |
| ------------------------- | ------------------------ | --------- | ----------- |
| [jsonschema](#jsonschema) | apm-data-quality-metrics | inbound   | many-to-one |

[Back to Index](#report-index)

### Jsonschema {#jsonschema}

**Spec Node ID**: `data-model.jsonschema`

Root schema document

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 3

#### Intra-Layer Relationships

| Related Node                              | Predicate                | Direction | Cardinality |
| ----------------------------------------- | ------------------------ | --------- | ----------- |
| [databasemapping](#databasemapping)       | database-mapping         | outbound  | many-to-one |
| [datagovernance](#datagovernance)         | data-governance          | outbound  | many-to-one |
| [dataqualitymetrics](#dataqualitymetrics) | apm-data-quality-metrics | outbound  | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                              | Layer                                           | Predicate           | Direction | Cardinality |
| ------------------------------------------------------------------------- | ----------------------------------------------- | ------------------- | --------- | ----------- |
| [applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | archimate-ref       | outbound  | many-to-one |
| [businessobject](./02-business-layer-report.md#businessobject)            | [Business](./02-business-layer-report.md)       | business-object-ref | outbound  | many-to-one |
| [businessobject](./02-business-layer-report.md#businessobject)            | [Business](./02-business-layer-report.md)       | referenced-by       | outbound  | many-to-one |

[Back to Index](#report-index)

### Jsontype {#jsontype}

**Spec Node ID**: `data-model.jsontype`

Core JSON data types

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Numericschema {#numericschema}

**Spec Node ID**: `data-model.numericschema`

NumericSchema validation rules

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Objectschema {#objectschema}

**Spec Node ID**: `data-model.objectschema`

ObjectSchema validation rules

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Reference {#reference}

**Spec Node ID**: `data-model.reference`

Reference to another schema

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Schemacomposition {#schemacomposition}

**Spec Node ID**: `data-model.schemacomposition`

Combining multiple schemas

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Schemadefinition {#schemadefinition}

**Spec Node ID**: `data-model.schemadefinition`

A reusable JSON Schema definition that can be referenced throughout the data model. Enables DRY schema design and consistent type definitions across entities.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Schemaproperty {#schemaproperty}

**Spec Node ID**: `data-model.schemaproperty`

Defines a single property within a schema, including its type, constraints, validation rules, and documentation. The fundamental building block of data model structure.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate        | Direction | Cardinality |
| ----------------------------------- | ---------------- | --------- | ----------- |
| [databasemapping](#databasemapping) | database-mapping | outbound  | many-to-one |

[Back to Index](#report-index)

### String {#string}

**Spec Node ID**: `data-model.string`

String type definition for data model properties

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Stringschema {#stringschema}

**Spec Node ID**: `data-model.stringschema`

StringSchema validation rules

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### X-apm-data-quality-metrics {#x-apm-data-quality-metrics}

**Spec Node ID**: `data-model.x-apm-data-quality-metrics`

Links schema to data quality metrics in APM/Observability Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### X-business-object-ref {#x-business-object-ref}

**Spec Node ID**: `data-model.x-business-object-ref`

Reference to BusinessObject this schema implements

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### X-data-governance {#x-data-governance}

**Spec Node ID**: `data-model.x-data-governance`

Data model governance metadata (root-level)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### X-database {#x-database}

**Spec Node ID**: `data-model.x-database`

Database mapping information

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### X-security {#x-security}

**Spec Node ID**: `data-model.x-security`

Security and privacy metadata

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### X-ui {#x-ui}

**Spec Node ID**: `data-model.x-ui`

UI rendering hints

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

---

_Generated: 2026-02-13T12:04:30.783Z | Spec Version: 0.8.0 | Commit: 4c0d881 | Generator: generate-layer-reports.ts_
