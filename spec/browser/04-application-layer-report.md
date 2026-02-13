# Application Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Applicationcollaboration](#applicationcollaboration)
  - [Applicationcomponent](#applicationcomponent)
  - [Applicationevent](#applicationevent)
  - [Applicationeventtype](#applicationeventtype)
  - [Applicationfunction](#applicationfunction)
  - [Applicationinteraction](#applicationinteraction)
  - [Applicationinterface](#applicationinterface)
  - [Applicationprocess](#applicationprocess)
  - [Applicationservice](#applicationservice)
  - [Componenttype](#componenttype)
  - [Dataobject](#dataobject)
  - [Interactionpattern](#interactionpattern)
  - [Interfaceprotocol](#interfaceprotocol)
  - [Servicetype](#servicetype)

## Layer Introduction

**Layer 4**: Application
**Standard**: [ArchiMate 3.2](https://pubs.opengroup.org/architecture/archimate32-doc/)

Layer 4: Application Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 14    |
| Intra-Layer Relationships | 1     |
| Inter-Layer Relationships | 9     |
| Inbound Relationships     | 7     |
| Outbound Relationships    | 2     |

### Layer Dependencies

**Depends On**: [Business](./02-business-layer-report.md), [API](./06-api-layer-report.md), [Data Model](./07-data-model-layer-report.md)

**Depended On By**: [Motivation](./01-motivation-layer-report.md), [APM](./11-apm-layer-report.md)

## Intra-Layer Relationships

```mermaid
flowchart LR
  subgraph application
    applicationcollaboration["applicationcollaboration"]
    applicationcomponent["applicationcomponent"]
    applicationevent["applicationevent"]
    applicationeventtype["applicationeventtype"]
    applicationfunction["applicationfunction"]
    applicationinteraction["applicationinteraction"]
    applicationinterface["applicationinterface"]
    applicationprocess["applicationprocess"]
    applicationservice["applicationservice"]
    componenttype["componenttype"]
    dataobject["dataobject"]
    interactionpattern["interactionpattern"]
    interfaceprotocol["interfaceprotocol"]
    servicetype["servicetype"]
    applicationservice -->|depends-on| dataobject
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
  testing --> motivation
  data_model --> business
  data_model --> application
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
  class application current
```

## Inter-Layer Relationships Table

| Relationship ID                                                             | Source Node                                                               | Dest Node                                                                 | Dest Layer                                      | Predicate                 | Cardinality  | Strength |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------- | ------------ | -------- |
| application.applicationservice.traced.apm.traceconfiguration                | [applicationservice](./04-application-layer-report.md#applicationservice) | [traceconfiguration](./11-apm-layer-report.md#traceconfiguration)         | [APM](./11-apm-layer-report.md)                 | traced                    | many-to-one  | medium   |
| data-model.jsonschema.archimate-ref.application.applicationservice          | [jsonschema](./07-data-model-layer-report.md#jsonschema)                  | [applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | archimate-ref             | many-to-one  | medium   |
| api.securityscheme.archimate-ref.application.applicationservice             | [securityscheme](./06-api-layer-report.md#securityscheme)                 | [applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | archimate-ref             | many-to-one  | medium   |
| api.operation.archimate-ref.application.applicationservice                  | [operation](./06-api-layer-report.md#operation)                           | [applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | archimate-ref             | many-to-one  | medium   |
| business.businessobject.master-data-source.application.dataobject           | [businessobject](./02-business-layer-report.md#businessobject)            | [dataobject](./04-application-layer-report.md#dataobject)                 | [Application](./04-application-layer-report.md) | master-data-source        | many-to-one  | medium   |
| business.businessprocess.process-steps.application.applicationprocess       | [businessprocess](./02-business-layer-report.md#businessprocess)          | [applicationprocess](./04-application-layer-report.md#applicationprocess) | [Application](./04-application-layer-report.md) | process-steps             | many-to-many | medium   |
| business.businessprocess.realized-by-process.application.applicationprocess | [businessprocess](./02-business-layer-report.md#businessprocess)          | [applicationprocess](./04-application-layer-report.md#applicationprocess) | [Application](./04-application-layer-report.md) | realized-by-process       | many-to-one  | medium   |
| business.businessobject.represented-by-dataobject.application.dataobject    | [businessobject](./02-business-layer-report.md#businessobject)            | [dataobject](./04-application-layer-report.md#dataobject)                 | [Application](./04-application-layer-report.md) | represented-by-dataobject | many-to-one  | medium   |
| application.applicationservice.delivers-value.motivation.value              | [applicationservice](./04-application-layer-report.md#applicationservice) | [value](./01-motivation-layer-report.md#value)                            | [Motivation](./01-motivation-layer-report.md)   | delivers-value            | many-to-many | medium   |

## Node Reference

### Applicationcollaboration {#applicationcollaboration}

**Spec Node ID**: `application.applicationcollaboration`

Aggregate of application components working together

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Applicationcomponent {#applicationcomponent}

**Spec Node ID**: `application.applicationcomponent`

Modular, deployable, and replaceable part of a system

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Applicationevent {#applicationevent}

**Spec Node ID**: `application.applicationevent`

Application state change notification

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Applicationeventtype {#applicationeventtype}

**Spec Node ID**: `application.applicationeventtype`

ApplicationEventType element in Application Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Applicationfunction {#applicationfunction}

**Spec Node ID**: `application.applicationfunction`

Automated behavior performed by application component

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Applicationinteraction {#applicationinteraction}

**Spec Node ID**: `application.applicationinteraction`

Unit of collective application behavior

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Applicationinterface {#applicationinterface}

**Spec Node ID**: `application.applicationinterface`

Point of access where application service is available

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Applicationprocess {#applicationprocess}

**Spec Node ID**: `application.applicationprocess`

Sequence of application behaviors

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 2 | Outbound: 0

#### Inter-Layer Relationships

| Related Node                                                     | Layer                                     | Predicate           | Direction | Cardinality  |
| ---------------------------------------------------------------- | ----------------------------------------- | ------------------- | --------- | ------------ |
| [businessprocess](./02-business-layer-report.md#businessprocess) | [Business](./02-business-layer-report.md) | realized-by-process | inbound   | many-to-one  |
| [businessprocess](./02-business-layer-report.md#businessprocess) | [Business](./02-business-layer-report.md) | process-steps       | inbound   | many-to-many |

[Back to Index](#report-index)

### Applicationservice {#applicationservice}

**Spec Node ID**: `application.applicationservice`

Service that exposes application functionality

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 1
- **Inter-Layer**: Inbound: 3 | Outbound: 2

#### Intra-Layer Relationships

| Related Node              | Predicate  | Direction | Cardinality  |
| ------------------------- | ---------- | --------- | ------------ |
| [dataobject](#dataobject) | depends-on | outbound  | many-to-many |

#### Inter-Layer Relationships

| Related Node                                                      | Layer                                         | Predicate      | Direction | Cardinality  |
| ----------------------------------------------------------------- | --------------------------------------------- | -------------- | --------- | ------------ |
| [jsonschema](./07-data-model-layer-report.md#jsonschema)          | [Data Model](./07-data-model-layer-report.md) | archimate-ref  | inbound   | many-to-one  |
| [traceconfiguration](./11-apm-layer-report.md#traceconfiguration) | [APM](./11-apm-layer-report.md)               | traced         | outbound  | many-to-one  |
| [value](./01-motivation-layer-report.md#value)                    | [Motivation](./01-motivation-layer-report.md) | delivers-value | outbound  | many-to-many |
| [securityscheme](./06-api-layer-report.md#securityscheme)         | [API](./06-api-layer-report.md)               | archimate-ref  | inbound   | many-to-one  |
| [operation](./06-api-layer-report.md#operation)                   | [API](./06-api-layer-report.md)               | archimate-ref  | inbound   | many-to-one  |

[Back to Index](#report-index)

### Componenttype {#componenttype}

**Spec Node ID**: `application.componenttype`

ComponentType element in Application Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Dataobject {#dataobject}

**Spec Node ID**: `application.dataobject`

Data structured for automated processing

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 0
- **Inter-Layer**: Inbound: 2 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                              | Predicate  | Direction | Cardinality  |
| ----------------------------------------- | ---------- | --------- | ------------ |
| [applicationservice](#applicationservice) | depends-on | inbound   | many-to-many |

#### Inter-Layer Relationships

| Related Node                                                   | Layer                                     | Predicate                 | Direction | Cardinality |
| -------------------------------------------------------------- | ----------------------------------------- | ------------------------- | --------- | ----------- |
| [businessobject](./02-business-layer-report.md#businessobject) | [Business](./02-business-layer-report.md) | represented-by-dataobject | inbound   | many-to-one |
| [businessobject](./02-business-layer-report.md#businessobject) | [Business](./02-business-layer-report.md) | master-data-source        | inbound   | many-to-one |

[Back to Index](#report-index)

### Interactionpattern {#interactionpattern}

**Spec Node ID**: `application.interactionpattern`

InteractionPattern element in Application Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Interfaceprotocol {#interfaceprotocol}

**Spec Node ID**: `application.interfaceprotocol`

InterfaceProtocol element in Application Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Servicetype {#servicetype}

**Spec Node ID**: `application.servicetype`

ServiceType element in Application Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

---

_Generated: 2026-02-13T10:34:36.989Z | Spec Version: 0.8.0 | Commit: f946950 | Generator: generate-layer-reports.ts_
