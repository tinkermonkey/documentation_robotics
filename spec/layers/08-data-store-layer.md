# Layer 8: Data Store Layer

Layer 8: Data Store Layer

**Standard**: [SQL 2016 2016](https://en.wikipedia.org/wiki/SQL:2016)

---

## Overview

Layer 8: Data Store Layer

This layer defines **26** node types that represent various aspects of the architecture.

## Node Types

### Trigger

**ID**: `data-store.trigger`

A database trigger that automatically executes in response to data modification events (INSERT, UPDATE, DELETE). Enables reactive database behavior and data integrity enforcement.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `table`: string (required)
- `timing`: string (required)
- `events`: string (required)
- `forEach`: string (required)
- `functionName`: string (required)
- `condition`: string (required)
- `enabled`: boolean

### TriggerForEach

**ID**: `data-store.triggerforeach`

TriggerForEach element in Data Store Layer


### FunctionLanguage

**ID**: `data-store.functionlanguage`

FunctionLanguage element in Data Store Layer


### TriggerTiming

**ID**: `data-store.triggertiming`

TriggerTiming element in Data Store Layer


### ConstraintType

**ID**: `data-store.constrainttype`

ConstraintType element in Data Store Layer


### SecurityDefiner

**ID**: `data-store.securitydefiner`

SecurityDefiner element in Data Store Layer


### TriggerEvent

**ID**: `data-store.triggerevent`

TriggerEvent element in Data Store Layer


### ParameterMode

**ID**: `data-store.parametermode`

ParameterMode element in Data Store Layer


### RefreshMode

**ID**: `data-store.refreshmode`

RefreshMode element in Data Store Layer


### View

**ID**: `data-store.view`

Database view

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `definition`: string
- `materialized`: boolean

### DatabaseSchema

**ID**: `data-store.databaseschema`

Logical grouping of database objects

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `owner`: string
- `tables`: array
  - Contains relationship
- `views`: array
  - Contains relationship
- `functions`: array
  - Contains relationship
- `sequences`: array
  - Contains relationship

### IndexMethod

**ID**: `data-store.indexmethod`

IndexMethod element in Data Store Layer


### SQLDataType

**ID**: `data-store.sqldatatype`

SQLDataType element in Data Store Layer


### Database

**ID**: `data-store.database`

Database instance containing schemas

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `version`: string (required)
- `charset`: string
- `collation`: string
- `schemas`: array
  - Contains relationship

### ParallelSafety

**ID**: `data-store.parallelsafety`

ParallelSafety element in Data Store Layer


### Column

**ID**: `data-store.column`

Table column definition

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `dataType`: string (required)
- `nullable`: boolean
- `defaultValue`: string
- `generated`: string
- `x-source-reference`: string
  - Source code reference using OpenAPI x- extension pattern. This pattern is used for OpenAPI-style layers (API, Data Model, Datastore) to maintain compatibility with OpenAPI tooling, as opposed to the nested properties.source.reference pattern used in ArchiMate-style layers (Application, Technology).

### FunctionVolatility

**ID**: `data-store.functionvolatility`

FunctionVolatility element in Data Store Layer


### Table

**ID**: `data-store.table`

Database table definition

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `schema`: string
- `tablespace`: string
- `columns`: array
  - Contains relationship
- `constraints`: array
  - Contains relationship
- `indexes`: array
  - Contains relationship
- `triggers`: array
  - Contains relationship
- `x-source-reference`: string
  - Source code reference using OpenAPI x- extension pattern. This pattern is used for OpenAPI-style layers (API, Data Model, Datastore) to maintain compatibility with OpenAPI tooling, as opposed to the nested properties.source.reference pattern used in ArchiMate-style layers (Application, Technology).

### Function

**ID**: `data-store.function`

A stored database function that encapsulates reusable computation logic. Returns a value and can be used in SQL expressions for data transformation or validation.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `schema`: string
- `language`: string (required)
- `returnType`: string (required)
- `volatility`: string
- `parallel`: string
- `strict`: boolean
- `security`: string
- `cost`: integer
- `rows`: integer
- `x-source-reference`: string
  - Source code reference using OpenAPI x- extension pattern. This pattern is used for OpenAPI-style layers (API, Data Model, Datastore) to maintain compatibility with OpenAPI tooling, as opposed to the nested properties.source.reference pattern used in ArchiMate-style layers (Application, Technology).

### DatabaseType

**ID**: `data-store.databasetype`

DatabaseType element in Data Store Layer


### Sequence

**ID**: `data-store.sequence`

A database sequence generator that produces unique, ordered numeric values. Used for generating primary keys, order numbers, or other sequential identifiers.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `schema`: string
- `dataType`: string
- `startValue`: integer
- `increment`: integer
- `minValue`: integer
- `maxValue`: integer
- `cycle`: boolean
- `cache`: integer
- `ownedBy`: string

### Index

**ID**: `data-store.index`

Database index for query optimization

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `columns`: string
- `unique`: boolean
- `method`: string
- `where`: string
- `include`: string

### ReferentialAction

**ID**: `data-store.referentialaction`

ReferentialAction element in Data Store Layer


### GenerationType

**ID**: `data-store.generationtype`

GenerationType element in Data Store Layer


### SequenceDataType

**ID**: `data-store.sequencedatatype`

SequenceDataType element in Data Store Layer


### Constraint

**ID**: `data-store.constraint`

Table constraint

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)


## References

- [SQL 2016 2016](https://en.wikipedia.org/wiki/SQL:2016)
