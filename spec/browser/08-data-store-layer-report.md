# Data Store Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Column](#column)
  - [Constraint](#constraint)
  - [Constrainttype](#constrainttype)
  - [Database](#database)
  - [Databaseschema](#databaseschema)
  - [Databasetype](#databasetype)
  - [Function](#function)
  - [Functionlanguage](#functionlanguage)
  - [Functionvolatility](#functionvolatility)
  - [Generationtype](#generationtype)
  - [Index](#index)
  - [Indexmethod](#indexmethod)
  - [Parallelsafety](#parallelsafety)
  - [Parametermode](#parametermode)
  - [Referentialaction](#referentialaction)
  - [Refreshmode](#refreshmode)
  - [Securitydefiner](#securitydefiner)
  - [Sequence](#sequence)
  - [Sequencedatatype](#sequencedatatype)
  - [Sqldatatype](#sqldatatype)
  - [Table](#table)
  - [Trigger](#trigger)
  - [Triggerevent](#triggerevent)
  - [Triggerforeach](#triggerforeach)
  - [Triggertiming](#triggertiming)
  - [View](#view)

## Layer Introduction

**Layer 8**: Data Store
**Standard**: [SQL 2016](https://en.wikipedia.org/wiki/SQL:2016)

Layer 8: Data Store Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 26    |
| Intra-Layer Relationships | 18    |
| Inter-Layer Relationships | 3     |
| Inbound Relationships     | 3     |
| Outbound Relationships    | 0     |

### Layer Dependencies

**Depends On**: [API](./06-api-layer-report.md)

**Depended On By**: None

## Intra-Layer Relationships

```mermaid
flowchart LR
  subgraph data-store
    column["column"]
    constraint["constraint"]
    constrainttype["constrainttype"]
    database["database"]
    databaseschema["databaseschema"]
    databasetype["databasetype"]
    function["function"]
    functionlanguage["functionlanguage"]
    functionvolatility["functionvolatility"]
    generationtype["generationtype"]
    index["index"]
    indexmethod["indexmethod"]
    parallelsafety["parallelsafety"]
    parametermode["parametermode"]
    referentialaction["referentialaction"]
    refreshmode["refreshmode"]
    securitydefiner["securitydefiner"]
    sequence["sequence"]
    sequencedatatype["sequencedatatype"]
    sqldatatype["sqldatatype"]
    table["table"]
    trigger["trigger"]
    triggerevent["triggerevent"]
    triggerforeach["triggerforeach"]
    triggertiming["triggertiming"]
    view["view"]
    constraint -->|aggregates| column
    database -->|composes| column
    database -->|composes| constraint
    database -->|composes| databaseschema
    database -->|composes| index
    database -->|composes| table
    databaseschema -->|composes| column
    databaseschema -->|composes| constraint
    databaseschema -->|composes| databaseschema
    databaseschema -->|composes| index
    databaseschema -->|composes| table
    index -->|aggregates| column
    table -->|composes| column
    table -->|composes| constraint
    table -->|composes| databaseschema
    table -->|composes| index
    table -->|composes| table
    trigger -->|triggers| function
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
  api --> apm
  api --> application
  api --> business
  api --> data_store
  api --> security
  application --> apm
  application --> motivation
  business --> application
  business --> data_model
  business --> motivation
  business --> security
  data_model --> application
  data_model --> business
  technology --> security
  testing --> motivation
  class data_store current
```

## Inter-Layer Relationships Table

| Relationship ID                                    | Source Node                                               | Dest Node                                        | Dest Layer                                    | Predicate       | Cardinality | Strength |
| -------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------- | --------------- | ----------- | -------- |
| api.schema.database-column.data-store.column       | [schema](./06-api-layer-report.md#schema)                 | [column](./08-data-store-layer-report.md#column) | [Data Store](./08-data-store-layer-report.md) | database-column | many-to-one | medium   |
| api.schema.database-table.data-store.table         | [schema](./06-api-layer-report.md#schema)                 | [table](./08-data-store-layer-report.md#table)   | [Data Store](./08-data-store-layer-report.md) | database-table  | many-to-one | medium   |
| api.securityscheme.database-table.data-store.table | [securityscheme](./06-api-layer-report.md#securityscheme) | [table](./08-data-store-layer-report.md#table)   | [Data Store](./08-data-store-layer-report.md) | database-table  | many-to-one | medium   |

## Node Reference

### Column {#column}

**Spec Node ID**: `data-store.column`

Table column definition

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 0
- **Inter-Layer**: Inbound: 1 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate  | Direction | Cardinality  |
| --------------------------------- | ---------- | --------- | ------------ |
| [constraint](#constraint)         | aggregates | inbound   | many-to-many |
| [database](#database)             | composes   | inbound   | many-to-many |
| [databaseschema](#databaseschema) | composes   | inbound   | many-to-many |
| [index](#index)                   | aggregates | inbound   | many-to-many |
| [table](#table)                   | composes   | inbound   | many-to-many |

#### Inter-Layer Relationships

| Related Node                              | Layer                           | Predicate       | Direction | Cardinality |
| ----------------------------------------- | ------------------------------- | --------------- | --------- | ----------- |
| [schema](./06-api-layer-report.md#schema) | [API](./06-api-layer-report.md) | database-column | inbound   | many-to-one |

[Back to Index](#report-index)

### Constraint {#constraint}

**Spec Node ID**: `data-store.constraint`

Table constraint

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate  | Direction | Cardinality  |
| --------------------------------- | ---------- | --------- | ------------ |
| [column](#column)                 | aggregates | outbound  | many-to-many |
| [database](#database)             | composes   | inbound   | many-to-many |
| [databaseschema](#databaseschema) | composes   | inbound   | many-to-many |
| [table](#table)                   | composes   | inbound   | many-to-many |

[Back to Index](#report-index)

### Constrainttype {#constrainttype}

**Spec Node ID**: `data-store.constrainttype`

ConstraintType element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Database {#database}

**Spec Node ID**: `data-store.database`

Database instance containing schemas

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate | Direction | Cardinality  |
| --------------------------------- | --------- | --------- | ------------ |
| [column](#column)                 | composes  | outbound  | many-to-many |
| [constraint](#constraint)         | composes  | outbound  | many-to-many |
| [databaseschema](#databaseschema) | composes  | outbound  | many-to-many |
| [index](#index)                   | composes  | outbound  | many-to-many |
| [table](#table)                   | composes  | outbound  | many-to-many |

[Back to Index](#report-index)

### Databaseschema {#databaseschema}

**Spec Node ID**: `data-store.databaseschema`

Logical grouping of database objects

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate | Direction | Cardinality  |
| --------------------------------- | --------- | --------- | ------------ |
| [database](#database)             | composes  | inbound   | many-to-many |
| [column](#column)                 | composes  | outbound  | many-to-many |
| [constraint](#constraint)         | composes  | outbound  | many-to-many |
| [databaseschema](#databaseschema) | composes  | outbound  | many-to-many |
| [index](#index)                   | composes  | outbound  | many-to-many |
| [table](#table)                   | composes  | outbound  | many-to-many |
| [table](#table)                   | composes  | inbound   | many-to-many |

[Back to Index](#report-index)

### Databasetype {#databasetype}

**Spec Node ID**: `data-store.databasetype`

DatabaseType element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Function {#function}

**Spec Node ID**: `data-store.function`

A stored database function that encapsulates reusable computation logic. Returns a value and can be used in SQL expressions for data transformation or validation.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node        | Predicate | Direction | Cardinality  |
| ------------------- | --------- | --------- | ------------ |
| [trigger](#trigger) | triggers  | inbound   | many-to-many |

[Back to Index](#report-index)

### Functionlanguage {#functionlanguage}

**Spec Node ID**: `data-store.functionlanguage`

FunctionLanguage element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Functionvolatility {#functionvolatility}

**Spec Node ID**: `data-store.functionvolatility`

FunctionVolatility element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Generationtype {#generationtype}

**Spec Node ID**: `data-store.generationtype`

GenerationType element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Index {#index}

**Spec Node ID**: `data-store.index`

Database index for query optimization

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate  | Direction | Cardinality  |
| --------------------------------- | ---------- | --------- | ------------ |
| [database](#database)             | composes   | inbound   | many-to-many |
| [databaseschema](#databaseschema) | composes   | inbound   | many-to-many |
| [column](#column)                 | aggregates | outbound  | many-to-many |
| [table](#table)                   | composes   | inbound   | many-to-many |

[Back to Index](#report-index)

### Indexmethod {#indexmethod}

**Spec Node ID**: `data-store.indexmethod`

IndexMethod element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Parallelsafety {#parallelsafety}

**Spec Node ID**: `data-store.parallelsafety`

ParallelSafety element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Parametermode {#parametermode}

**Spec Node ID**: `data-store.parametermode`

ParameterMode element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Referentialaction {#referentialaction}

**Spec Node ID**: `data-store.referentialaction`

ReferentialAction element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Refreshmode {#refreshmode}

**Spec Node ID**: `data-store.refreshmode`

RefreshMode element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Securitydefiner {#securitydefiner}

**Spec Node ID**: `data-store.securitydefiner`

SecurityDefiner element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Sequence {#sequence}

**Spec Node ID**: `data-store.sequence`

A database sequence generator that produces unique, ordered numeric values. Used for generating primary keys, order numbers, or other sequential identifiers.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Sequencedatatype {#sequencedatatype}

**Spec Node ID**: `data-store.sequencedatatype`

SequenceDataType element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Sqldatatype {#sqldatatype}

**Spec Node ID**: `data-store.sqldatatype`

SQLDataType element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Table {#table}

**Spec Node ID**: `data-store.table`

Database table definition

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 5
- **Inter-Layer**: Inbound: 2 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate | Direction | Cardinality  |
| --------------------------------- | --------- | --------- | ------------ |
| [database](#database)             | composes  | inbound   | many-to-many |
| [databaseschema](#databaseschema) | composes  | inbound   | many-to-many |
| [column](#column)                 | composes  | outbound  | many-to-many |
| [constraint](#constraint)         | composes  | outbound  | many-to-many |
| [databaseschema](#databaseschema) | composes  | outbound  | many-to-many |
| [index](#index)                   | composes  | outbound  | many-to-many |
| [table](#table)                   | composes  | outbound  | many-to-many |

#### Inter-Layer Relationships

| Related Node                                              | Layer                           | Predicate      | Direction | Cardinality |
| --------------------------------------------------------- | ------------------------------- | -------------- | --------- | ----------- |
| [schema](./06-api-layer-report.md#schema)                 | [API](./06-api-layer-report.md) | database-table | inbound   | many-to-one |
| [securityscheme](./06-api-layer-report.md#securityscheme) | [API](./06-api-layer-report.md) | database-table | inbound   | many-to-one |

[Back to Index](#report-index)

### Trigger {#trigger}

**Spec Node ID**: `data-store.trigger`

A database trigger that automatically executes in response to data modification events (INSERT, UPDATE, DELETE). Enables reactive database behavior and data integrity enforcement.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node          | Predicate | Direction | Cardinality  |
| --------------------- | --------- | --------- | ------------ |
| [function](#function) | triggers  | outbound  | many-to-many |

[Back to Index](#report-index)

### Triggerevent {#triggerevent}

**Spec Node ID**: `data-store.triggerevent`

TriggerEvent element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Triggerforeach {#triggerforeach}

**Spec Node ID**: `data-store.triggerforeach`

TriggerForEach element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Triggertiming {#triggertiming}

**Spec Node ID**: `data-store.triggertiming`

TriggerTiming element in Data Store Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### View {#view}

**Spec Node ID**: `data-store.view`

Database view

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

---

_Generated: 2026-02-13T12:13:48.564Z | Spec Version: 0.8.0 | Generator: generate-layer-reports.ts_
