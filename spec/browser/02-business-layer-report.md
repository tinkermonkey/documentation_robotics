# Business Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Businessactor](#businessactor)
  - [Businesscollaboration](#businesscollaboration)
  - [Businessevent](#businessevent)
  - [Businessfunction](#businessfunction)
  - [Businessinteraction](#businessinteraction)
  - [Businessinterface](#businessinterface)
  - [Businessobject](#businessobject)
  - [Businessprocess](#businessprocess)
  - [Businessrole](#businessrole)
  - [Businessservice](#businessservice)
  - [Contract](#contract)
  - [Eventtype](#eventtype)
  - [Product](#product)
  - [Representation](#representation)
  - [Representationformat](#representationformat)

## Layer Introduction

**Layer 2**: Business
**Standard**: [ArchiMate 3.2](https://pubs.opengroup.org/architecture/archimate32-doc/)

Layer 2: Business Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 15    |
| Intra-Layer Relationships | 6     |
| Inter-Layer Relationships | 19    |
| Inbound Relationships     | 10    |
| Outbound Relationships    | 9     |

### Layer Dependencies

**Depends On**: [API](./06-api-layer-report.md), [Data Model](./07-data-model-layer-report.md)

**Depended On By**: [Motivation](./01-motivation-layer-report.md), [Security](./03-security-layer-report.md), [Application](./04-application-layer-report.md), [Data Model](./07-data-model-layer-report.md)

## Intra-Layer Relationships

```mermaid
flowchart LR
  subgraph business
    businessactor["businessactor"]
    businesscollaboration["businesscollaboration"]
    businessevent["businessevent"]
    businessfunction["businessfunction"]
    businessinteraction["businessinteraction"]
    businessinterface["businessinterface"]
    businessobject["businessobject"]
    businessprocess["businessprocess"]
    businessrole["businessrole"]
    businessservice["businessservice"]
    contract["contract"]
    eventtype["eventtype"]
    product["product"]
    representation["representation"]
    representationformat["representationformat"]
    businessactor -->|assigned-to| businessrole
    businesscollaboration -->|composes| businessrole
    businessevent -->|triggers| businessprocess
    businessprocess -->|accesses| businessobject
    businessprocess -->|flows-to| businessprocess
    businessservice -->|serves| businessactor
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
  class business current
```

## Inter-Layer Relationships Table

| Relationship ID                                                             | Source Node                                                      | Dest Node                                                                 | Dest Layer                                      | Predicate                 | Cardinality  | Strength |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------- | ------------ | -------- |
| api.operation.business-interface-ref.business.businessinterface             | [operation](./06-api-layer-report.md#operation)                  | [businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | business-interface-ref    | many-to-one  | medium   |
| api.operation.business-service-ref.business.businessservice                 | [operation](./06-api-layer-report.md#operation)                  | [businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | business-service-ref      | many-to-one  | medium   |
| api.operation.referenced-by.business.businessinterface                      | [operation](./06-api-layer-report.md#operation)                  | [businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | referenced-by             | many-to-one  | medium   |
| api.operation.referenced-by.business.businessservice                        | [operation](./06-api-layer-report.md#operation)                  | [businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | referenced-by             | many-to-one  | medium   |
| api.securityscheme.business-interface-ref.business.businessinterface        | [securityscheme](./06-api-layer-report.md#securityscheme)        | [businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | business-interface-ref    | many-to-one  | medium   |
| api.securityscheme.business-service-ref.business.businessservice            | [securityscheme](./06-api-layer-report.md#securityscheme)        | [businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | business-service-ref      | many-to-one  | medium   |
| api.securityscheme.referenced-by.business.businessinterface                 | [securityscheme](./06-api-layer-report.md#securityscheme)        | [businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | referenced-by             | many-to-one  | medium   |
| api.securityscheme.referenced-by.business.businessservice                   | [securityscheme](./06-api-layer-report.md#securityscheme)        | [businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | referenced-by             | many-to-one  | medium   |
| business.businessobject.governance-owner.data-model.datagovernance          | [businessobject](./02-business-layer-report.md#businessobject)   | [datagovernance](./07-data-model-layer-report.md#datagovernance)          | [Data Model](./07-data-model-layer-report.md)   | governance-owner          | many-to-one  | medium   |
| business.businessobject.master-data-source.application.dataobject           | [businessobject](./02-business-layer-report.md#businessobject)   | [dataobject](./04-application-layer-report.md#dataobject)                 | [Application](./04-application-layer-report.md) | master-data-source        | many-to-one  | medium   |
| business.businessobject.represented-by-dataobject.application.dataobject    | [businessobject](./02-business-layer-report.md#businessobject)   | [dataobject](./04-application-layer-report.md#dataobject)                 | [Application](./04-application-layer-report.md) | represented-by-dataobject | many-to-one  | medium   |
| business.businessprocess.process-steps.application.applicationprocess       | [businessprocess](./02-business-layer-report.md#businessprocess) | [applicationprocess](./04-application-layer-report.md#applicationprocess) | [Application](./04-application-layer-report.md) | process-steps             | many-to-many | medium   |
| business.businessprocess.realized-by-process.application.applicationprocess | [businessprocess](./02-business-layer-report.md#businessprocess) | [applicationprocess](./04-application-layer-report.md#applicationprocess) | [Application](./04-application-layer-report.md) | realized-by-process       | many-to-one  | medium   |
| business.businessprocess.referenced-by.security.separationofduty            | [businessprocess](./02-business-layer-report.md#businessprocess) | [separationofduty](./03-security-layer-report.md#separationofduty)        | [Security](./03-security-layer-report.md)       | referenced-by             | many-to-one  | medium   |
| business.businessprocess.security-controls.security.securityconstraints     | [businessprocess](./02-business-layer-report.md#businessprocess) | [securityconstraints](./03-security-layer-report.md#securityconstraints)  | [Security](./03-security-layer-report.md)       | security-controls         | many-to-many | high     |
| business.businessprocess.separation-of-duty.security.separationofduty       | [businessprocess](./02-business-layer-report.md#businessprocess) | [separationofduty](./03-security-layer-report.md#separationofduty)        | [Security](./03-security-layer-report.md)       | separation-of-duty        | many-to-one  | medium   |
| business.businessservice.delivers-value.motivation.value                    | [businessservice](./02-business-layer-report.md#businessservice) | [value](./01-motivation-layer-report.md#value)                            | [Motivation](./01-motivation-layer-report.md)   | delivers-value            | many-to-many | medium   |
| data-model.jsonschema.business-object-ref.business.businessobject           | [jsonschema](./07-data-model-layer-report.md#jsonschema)         | [businessobject](./02-business-layer-report.md#businessobject)            | [Business](./02-business-layer-report.md)       | business-object-ref       | many-to-one  | medium   |
| data-model.jsonschema.referenced-by.business.businessobject                 | [jsonschema](./07-data-model-layer-report.md#jsonschema)         | [businessobject](./02-business-layer-report.md#businessobject)            | [Business](./02-business-layer-report.md)       | referenced-by             | many-to-one  | medium   |

## Node Reference

### Businessactor {#businessactor}

**Spec Node ID**: `business.businessactor`

An organizational entity capable of performing behavior

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate   | Direction | Cardinality  |
| ----------------------------------- | ----------- | --------- | ------------ |
| [businessrole](#businessrole)       | assigned-to | outbound  | many-to-many |
| [businessservice](#businessservice) | serves      | inbound   | many-to-many |

[Back to Index](#report-index)

### Businesscollaboration {#businesscollaboration}

**Spec Node ID**: `business.businesscollaboration`

Aggregate of business roles working together

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                  | Predicate | Direction | Cardinality  |
| ----------------------------- | --------- | --------- | ------------ |
| [businessrole](#businessrole) | composes  | outbound  | many-to-many |

[Back to Index](#report-index)

### Businessevent {#businessevent}

**Spec Node ID**: `business.businessevent`

Something that happens and influences behavior

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate | Direction | Cardinality  |
| ----------------------------------- | --------- | --------- | ------------ |
| [businessprocess](#businessprocess) | triggers  | outbound  | many-to-many |

[Back to Index](#report-index)

### Businessfunction {#businessfunction}

**Spec Node ID**: `business.businessfunction`

Collection of business behavior based on criteria

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Businessinteraction {#businessinteraction}

**Spec Node ID**: `business.businessinteraction`

Unit of collective behavior by collaboration

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Businessinterface {#businessinterface}

**Spec Node ID**: `business.businessinterface`

Point of access where business service is available

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 4 | Outbound: 0

#### Inter-Layer Relationships

| Related Node                                              | Layer                           | Predicate              | Direction | Cardinality |
| --------------------------------------------------------- | ------------------------------- | ---------------------- | --------- | ----------- |
| [operation](./06-api-layer-report.md#operation)           | [API](./06-api-layer-report.md) | business-interface-ref | inbound   | many-to-one |
| [operation](./06-api-layer-report.md#operation)           | [API](./06-api-layer-report.md) | referenced-by          | inbound   | many-to-one |
| [securityscheme](./06-api-layer-report.md#securityscheme) | [API](./06-api-layer-report.md) | business-interface-ref | inbound   | many-to-one |
| [securityscheme](./06-api-layer-report.md#securityscheme) | [API](./06-api-layer-report.md) | referenced-by          | inbound   | many-to-one |

[Back to Index](#report-index)

### Businessobject {#businessobject}

**Spec Node ID**: `business.businessobject`

Concept used within business domain

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 0
- **Inter-Layer**: Inbound: 2 | Outbound: 3

#### Intra-Layer Relationships

| Related Node                        | Predicate | Direction | Cardinality  |
| ----------------------------------- | --------- | --------- | ------------ |
| [businessprocess](#businessprocess) | accesses  | inbound   | many-to-many |

#### Inter-Layer Relationships

| Related Node                                                     | Layer                                           | Predicate                 | Direction | Cardinality |
| ---------------------------------------------------------------- | ----------------------------------------------- | ------------------------- | --------- | ----------- |
| [datagovernance](./07-data-model-layer-report.md#datagovernance) | [Data Model](./07-data-model-layer-report.md)   | governance-owner          | outbound  | many-to-one |
| [dataobject](./04-application-layer-report.md#dataobject)        | [Application](./04-application-layer-report.md) | master-data-source        | outbound  | many-to-one |
| [dataobject](./04-application-layer-report.md#dataobject)        | [Application](./04-application-layer-report.md) | represented-by-dataobject | outbound  | many-to-one |
| [jsonschema](./07-data-model-layer-report.md#jsonschema)         | [Data Model](./07-data-model-layer-report.md)   | business-object-ref       | inbound   | many-to-one |
| [jsonschema](./07-data-model-layer-report.md#jsonschema)         | [Data Model](./07-data-model-layer-report.md)   | referenced-by             | inbound   | many-to-one |

[Back to Index](#report-index)

### Businessprocess {#businessprocess}

**Spec Node ID**: `business.businessprocess`

Sequence of business behaviors achieving a result

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 2
- **Inter-Layer**: Inbound: 0 | Outbound: 5

#### Intra-Layer Relationships

| Related Node                        | Predicate | Direction | Cardinality  |
| ----------------------------------- | --------- | --------- | ------------ |
| [businessevent](#businessevent)     | triggers  | inbound   | many-to-many |
| [businessobject](#businessobject)   | accesses  | outbound  | many-to-many |
| [businessprocess](#businessprocess) | flows-to  | outbound  | many-to-many |

#### Inter-Layer Relationships

| Related Node                                                              | Layer                                           | Predicate           | Direction | Cardinality  |
| ------------------------------------------------------------------------- | ----------------------------------------------- | ------------------- | --------- | ------------ |
| [applicationprocess](./04-application-layer-report.md#applicationprocess) | [Application](./04-application-layer-report.md) | process-steps       | outbound  | many-to-many |
| [applicationprocess](./04-application-layer-report.md#applicationprocess) | [Application](./04-application-layer-report.md) | realized-by-process | outbound  | many-to-one  |
| [separationofduty](./03-security-layer-report.md#separationofduty)        | [Security](./03-security-layer-report.md)       | referenced-by       | outbound  | many-to-one  |
| [securityconstraints](./03-security-layer-report.md#securityconstraints)  | [Security](./03-security-layer-report.md)       | security-controls   | outbound  | many-to-many |
| [separationofduty](./03-security-layer-report.md#separationofduty)        | [Security](./03-security-layer-report.md)       | separation-of-duty  | outbound  | many-to-one  |

[Back to Index](#report-index)

### Businessrole {#businessrole}

**Spec Node ID**: `business.businessrole`

The responsibility for performing specific behavior

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                    | Predicate   | Direction | Cardinality  |
| ----------------------------------------------- | ----------- | --------- | ------------ |
| [businessactor](#businessactor)                 | assigned-to | inbound   | many-to-many |
| [businesscollaboration](#businesscollaboration) | composes    | inbound   | many-to-many |

[Back to Index](#report-index)

### Businessservice {#businessservice}

**Spec Node ID**: `business.businessservice`

Service that fulfills a business need

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 1
- **Inter-Layer**: Inbound: 4 | Outbound: 1

#### Intra-Layer Relationships

| Related Node                    | Predicate | Direction | Cardinality  |
| ------------------------------- | --------- | --------- | ------------ |
| [businessactor](#businessactor) | serves    | outbound  | many-to-many |

#### Inter-Layer Relationships

| Related Node                                              | Layer                                         | Predicate            | Direction | Cardinality  |
| --------------------------------------------------------- | --------------------------------------------- | -------------------- | --------- | ------------ |
| [operation](./06-api-layer-report.md#operation)           | [API](./06-api-layer-report.md)               | business-service-ref | inbound   | many-to-one  |
| [operation](./06-api-layer-report.md#operation)           | [API](./06-api-layer-report.md)               | referenced-by        | inbound   | many-to-one  |
| [securityscheme](./06-api-layer-report.md#securityscheme) | [API](./06-api-layer-report.md)               | business-service-ref | inbound   | many-to-one  |
| [securityscheme](./06-api-layer-report.md#securityscheme) | [API](./06-api-layer-report.md)               | referenced-by        | inbound   | many-to-one  |
| [value](./01-motivation-layer-report.md#value)            | [Motivation](./01-motivation-layer-report.md) | delivers-value       | outbound  | many-to-many |

[Back to Index](#report-index)

### Contract {#contract}

**Spec Node ID**: `business.contract`

Formal specification of agreement

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Eventtype {#eventtype}

**Spec Node ID**: `business.eventtype`

EventType element in Business Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Product {#product}

**Spec Node ID**: `business.product`

Coherent collection of services with a value

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Representation {#representation}

**Spec Node ID**: `business.representation`

Perceptible form of business object

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Representationformat {#representationformat}

**Spec Node ID**: `business.representationformat`

RepresentationFormat element in Business Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

---

_Generated: 2026-02-13T12:13:48.558Z | Spec Version: 0.8.0 | Generator: generate-layer-reports.ts_
