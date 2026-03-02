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
  - [Product](#product)
  - [Representation](#representation)

## Layer Introduction

**Layer 2**: Business
**Standard**: [ArchiMate 3.2](https://pubs.opengroup.org/architecture/archimate32-doc/)

Layer 2: Business Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 13    |
| Intra-Layer Relationships | 51    |
| Inter-Layer Relationships | 11    |
| Inbound Relationships     | 6     |
| Outbound Relationships    | 5     |

### Layer Dependencies

**Depends On**: [Application](./04-application-layer-report.md), [API](./06-api-layer-report.md), [Data Model](./07-data-model-layer-report.md)

**Depended On By**: [Motivation](./01-motivation-layer-report.md), [Security](./03-security-layer-report.md), [Application](./04-application-layer-report.md)

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
    product["product"]
    representation["representation"]
    businessactor -->|accesses| contract
    businessactor -->|assigned-to| businessrole
    businesscollaboration -->|composes| businessrole
    businesscollaboration -->|performs| businessinteraction
    businessevent -->|triggers| businessprocess
    businessfunction -->|accesses| businessobject
    businessfunction -->|composes| businessfunction
    businessfunction -->|flows-to| businessfunction
    businessfunction -->|flows-to| businessprocess
    businessfunction -->|realizes| businessservice
    businessfunction -->|serves| businessrole
    businessfunction -->|triggers| businessevent
    businessinteraction -->|accesses| businessobject
    businessinteraction -->|flows-to| businessinteraction
    businessinteraction -->|flows-to| businessprocess
    businessinteraction -->|serves| businessservice
    businessinteraction -->|triggers| businessevent
    businessinterface -->|accesses| businessobject
    businessinterface -->|flows-to| businessobject
    businessinterface -->|provides| businessservice
    businessinterface -->|serves| businessactor
    businessinterface -->|serves| businessrole
    businessinterface -->|triggers| businessfunction
    businessinterface -->|triggers| businessprocess
    businessprocess -->|accesses| businessobject
    businessprocess -->|accesses| contract
    businessprocess -->|delivers| businessobject
    businessprocess -->|flows-to| businessprocess
    businessprocess -->|realizes| businessservice
    businessprocess -->|triggers| businessevent
    businessprocess -->|triggers| businessprocess
    businessrole -->|accesses| businessobject
    businessrole -->|accesses| contract
    businessrole -->|assigned-to| businessfunction
    businessrole -->|assigned-to| businessinteraction
    businessrole -->|assigned-to| businessinterface
    businessrole -->|assigned-to| businessprocess
    businessrole -->|performs| businessfunction
    businessrole -->|performs| businessprocess
    businessrole -->|serves| businessactor
    businessrole -->|triggers| businessevent
    businessservice -->|accesses| contract
    businessservice -->|realizes| businessprocess
    businessservice -->|serves| businessactor
    contract -->|accesses| businessobject
    contract -->|governs| businessservice
    contract -->|serves| businessrole
    contract -->|triggers| businessprocess
    product -->|aggregates| businessservice
    product -->|composes| contract
    representation -->|realizes| businessobject
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
  application --> business
  application --> motivation
  business --> application
  business --> motivation
  business --> security
  data_model --> application
  data_model --> business
  testing --> motivation
  class business current
```

## Inter-Layer Relationships Table

| Relationship ID                                                      | Source Node                                                               | Dest Node                                                                 | Dest Layer                                      | Predicate      | Cardinality  | Strength |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- | -------------- | ------------ | -------- |
| api.operation.references.business.businessinterface                  | [Operation](./06-api-layer-report.md#operation)                           | [Businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | references     | many-to-one  | medium   |
| api.operation.references.business.businessservice                    | [Operation](./06-api-layer-report.md#operation)                           | [Businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | references     | many-to-one  | medium   |
| api.securityscheme.references.business.businessinterface             | [Securityscheme](./06-api-layer-report.md#securityscheme)                 | [Businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | references     | many-to-one  | medium   |
| api.securityscheme.references.business.businessservice               | [Securityscheme](./06-api-layer-report.md#securityscheme)                 | [Businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | references     | many-to-one  | medium   |
| application.applicationprocess.realizes.business.businessprocess     | [Applicationprocess](./04-application-layer-report.md#applicationprocess) | [Businessprocess](./02-business-layer-report.md#businessprocess)          | [Business](./02-business-layer-report.md)       | realizes       | many-to-one  | medium   |
| business.businessobject.references.application.dataobject            | [Businessobject](./02-business-layer-report.md#businessobject)            | [Dataobject](./04-application-layer-report.md#dataobject)                 | [Application](./04-application-layer-report.md) | references     | many-to-one  | medium   |
| business.businessprocess.aggregates.application.applicationprocess   | [Businessprocess](./02-business-layer-report.md#businessprocess)          | [Applicationprocess](./04-application-layer-report.md#applicationprocess) | [Application](./04-application-layer-report.md) | aggregates     | many-to-one  | medium   |
| business.businessprocess.constrained-by.security.securityconstraints | [Businessprocess](./02-business-layer-report.md#businessprocess)          | [Securityconstraints](./03-security-layer-report.md#securityconstraints)  | [Security](./03-security-layer-report.md)       | constrained-by | many-to-one  | medium   |
| business.businessprocess.constrained-by.security.separationofduty    | [Businessprocess](./02-business-layer-report.md#businessprocess)          | [Separationofduty](./03-security-layer-report.md#separationofduty)        | [Security](./03-security-layer-report.md)       | constrained-by | many-to-one  | medium   |
| business.businessservice.delivers-value.motivation.value             | [Businessservice](./02-business-layer-report.md#businessservice)          | [Value](./01-motivation-layer-report.md#value)                            | [Motivation](./01-motivation-layer-report.md)   | delivers-value | many-to-many | medium   |
| data-model.jsonschema.references.business.businessobject             | [Jsonschema](./07-data-model-layer-report.md#jsonschema)                  | [Businessobject](./02-business-layer-report.md#businessobject)            | [Business](./02-business-layer-report.md)       | references     | many-to-one  | medium   |

## Node Reference

### Businessactor {#businessactor}

**Spec Node ID**: `business.businessactor`

An active structure element representing an organizational entity (person, department, or external organization) capable of performing behavior. BusinessActors are assigned to BusinessRoles and may be associated with BusinessServices they use or provide.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 2
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                            | Predicate   | Direction | Cardinality  |
| --------------------------------------- | ----------- | --------- | ------------ |
| [Contract](#contract)                   | accesses    | outbound  | many-to-one  |
| [Businessrole](#businessrole)           | assigned-to | outbound  | many-to-many |
| [Businessinterface](#businessinterface) | serves      | inbound   | many-to-one  |
| [Businessrole](#businessrole)           | serves      | inbound   | many-to-one  |
| [Businessservice](#businessservice)     | serves      | inbound   | many-to-many |

[Back to Index](#report-index)

### Businesscollaboration {#businesscollaboration}

**Spec Node ID**: `business.businesscollaboration`

An active structure element representing an aggregate of two or more BusinessRoles that work together to perform collective behavior (BusinessInteraction). The collaboration is meaningful only in the context of its participating roles.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 2
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate | Direction | Cardinality  |
| ------------------------------------------- | --------- | --------- | ------------ |
| [Businessrole](#businessrole)               | composes  | outbound  | many-to-many |
| [Businessinteraction](#businessinteraction) | performs  | outbound  | many-to-one  |

[Back to Index](#report-index)

### Businessevent {#businessevent}

**Spec Node ID**: `business.businessevent`

A behavior element that represents an organizational state change, such as a customer order placed or a contract signed, that can trigger or result from a BusinessProcess or BusinessFunction.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 4 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate | Direction | Cardinality  |
| ------------------------------------------- | --------- | --------- | ------------ |
| [Businessprocess](#businessprocess)         | triggers  | outbound  | many-to-many |
| [Businessfunction](#businessfunction)       | triggers  | inbound   | many-to-one  |
| [Businessinteraction](#businessinteraction) | triggers  | inbound   | many-to-one  |
| [Businessprocess](#businessprocess)         | triggers  | inbound   | many-to-one  |
| [Businessrole](#businessrole)               | triggers  | inbound   | many-to-one  |

[Back to Index](#report-index)

### Businessfunction {#businessfunction}

**Spec Node ID**: `business.businessfunction`

A behavior element that groups behavior based on required capabilities, skills, or resources (e.g., HR management, financial reporting). Unlike BusinessProcess, it is not goal-oriented but competency-oriented.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 7
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                            | Predicate   | Direction | Cardinality |
| --------------------------------------- | ----------- | --------- | ----------- |
| [Businessobject](#businessobject)       | accesses    | outbound  | many-to-one |
| [Businessfunction](#businessfunction)   | composes    | outbound  | many-to-one |
| [Businessfunction](#businessfunction)   | flows-to    | outbound  | many-to-one |
| [Businessprocess](#businessprocess)     | flows-to    | outbound  | many-to-one |
| [Businessservice](#businessservice)     | realizes    | outbound  | many-to-one |
| [Businessrole](#businessrole)           | serves      | outbound  | many-to-one |
| [Businessevent](#businessevent)         | triggers    | outbound  | many-to-one |
| [Businessinterface](#businessinterface) | triggers    | inbound   | many-to-one |
| [Businessrole](#businessrole)           | assigned-to | inbound   | many-to-one |
| [Businessrole](#businessrole)           | performs    | inbound   | many-to-one |

[Back to Index](#report-index)

### Businessinteraction {#businessinteraction}

**Spec Node ID**: `business.businessinteraction`

A behavior element representing collective behavior performed by a BusinessCollaboration. It is the interaction counterpart to BusinessProcess (performed by a role) and BusinessFunction (performed by an actor).

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                    | Predicate   | Direction | Cardinality |
| ----------------------------------------------- | ----------- | --------- | ----------- |
| [Businesscollaboration](#businesscollaboration) | performs    | inbound   | many-to-one |
| [Businessobject](#businessobject)               | accesses    | outbound  | many-to-one |
| [Businessinteraction](#businessinteraction)     | flows-to    | outbound  | many-to-one |
| [Businessprocess](#businessprocess)             | flows-to    | outbound  | many-to-one |
| [Businessservice](#businessservice)             | serves      | outbound  | many-to-one |
| [Businessevent](#businessevent)                 | triggers    | outbound  | many-to-one |
| [Businessrole](#businessrole)                   | assigned-to | inbound   | many-to-one |

[Back to Index](#report-index)

### Businessinterface {#businessinterface}

**Spec Node ID**: `business.businessinterface`

An active structure element representing a point of access at which a BusinessService is made available to the environment, used by BusinessActors or external parties.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 7
- **Inter-Layer**: Inbound: 2 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                          | Predicate   | Direction | Cardinality |
| ------------------------------------- | ----------- | --------- | ----------- |
| [Businessobject](#businessobject)     | accesses    | outbound  | many-to-one |
| [Businessobject](#businessobject)     | flows-to    | outbound  | many-to-one |
| [Businessservice](#businessservice)   | provides    | outbound  | many-to-one |
| [Businessactor](#businessactor)       | serves      | outbound  | many-to-one |
| [Businessrole](#businessrole)         | serves      | outbound  | many-to-one |
| [Businessfunction](#businessfunction) | triggers    | outbound  | many-to-one |
| [Businessprocess](#businessprocess)   | triggers    | outbound  | many-to-one |
| [Businessrole](#businessrole)         | assigned-to | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                              | Layer                           | Predicate  | Direction | Cardinality |
| --------------------------------------------------------- | ------------------------------- | ---------- | --------- | ----------- |
| [Operation](./06-api-layer-report.md#operation)           | [API](./06-api-layer-report.md) | references | inbound   | many-to-one |
| [Securityscheme](./06-api-layer-report.md#securityscheme) | [API](./06-api-layer-report.md) | references | inbound   | many-to-one |

[Back to Index](#report-index)

### Businessobject {#businessobject}

**Spec Node ID**: `business.businessobject`

A passive structure element that has relevance from a business perspective, representing information or data that active elements (actors, roles) act upon. Examples include documents, messages, contracts, and reports.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 9 | Outbound: 0
- **Inter-Layer**: Inbound: 1 | Outbound: 1

#### Intra-Layer Relationships

| Related Node                                | Predicate | Direction | Cardinality  |
| ------------------------------------------- | --------- | --------- | ------------ |
| [Businessfunction](#businessfunction)       | accesses  | inbound   | many-to-one  |
| [Businessinteraction](#businessinteraction) | accesses  | inbound   | many-to-one  |
| [Businessinterface](#businessinterface)     | accesses  | inbound   | many-to-one  |
| [Businessinterface](#businessinterface)     | flows-to  | inbound   | many-to-one  |
| [Businessprocess](#businessprocess)         | accesses  | inbound   | many-to-many |
| [Businessprocess](#businessprocess)         | delivers  | inbound   | many-to-one  |
| [Businessrole](#businessrole)               | accesses  | inbound   | many-to-one  |
| [Contract](#contract)                       | accesses  | inbound   | many-to-one  |
| [Representation](#representation)           | realizes  | inbound   | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                              | Layer                                           | Predicate  | Direction | Cardinality |
| --------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Dataobject](./04-application-layer-report.md#dataobject) | [Application](./04-application-layer-report.md) | references | outbound  | many-to-one |
| [Jsonschema](./07-data-model-layer-report.md#jsonschema)  | [Data Model](./07-data-model-layer-report.md)   | references | inbound   | many-to-one |

[Back to Index](#report-index)

### Businessprocess {#businessprocess}

**Spec Node ID**: `business.businessprocess`

A behavior element representing a sequence or set of behaviors that achieves a specific business result for a customer or stakeholder. Driven by external triggers (BusinessEvents) or internal initiations, and performed by BusinessActors or BusinessRoles.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 10 | Outbound: 7
- **Inter-Layer**: Inbound: 1 | Outbound: 3

#### Intra-Layer Relationships

| Related Node                                | Predicate   | Direction | Cardinality  |
| ------------------------------------------- | ----------- | --------- | ------------ |
| [Businessevent](#businessevent)             | triggers    | inbound   | many-to-many |
| [Businessfunction](#businessfunction)       | flows-to    | inbound   | many-to-one  |
| [Businessinteraction](#businessinteraction) | flows-to    | inbound   | many-to-one  |
| [Businessinterface](#businessinterface)     | triggers    | inbound   | many-to-one  |
| [Businessobject](#businessobject)           | accesses    | outbound  | many-to-many |
| [Contract](#contract)                       | accesses    | outbound  | many-to-one  |
| [Businessobject](#businessobject)           | delivers    | outbound  | many-to-one  |
| [Businessprocess](#businessprocess)         | flows-to    | outbound  | many-to-many |
| [Businessservice](#businessservice)         | realizes    | outbound  | many-to-one  |
| [Businessevent](#businessevent)             | triggers    | outbound  | many-to-one  |
| [Businessprocess](#businessprocess)         | triggers    | outbound  | many-to-one  |
| [Businessrole](#businessrole)               | assigned-to | inbound   | many-to-one  |
| [Businessrole](#businessrole)               | performs    | inbound   | many-to-one  |
| [Businessservice](#businessservice)         | realizes    | inbound   | many-to-one  |
| [Contract](#contract)                       | triggers    | inbound   | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                                              | Layer                                           | Predicate      | Direction | Cardinality |
| ------------------------------------------------------------------------- | ----------------------------------------------- | -------------- | --------- | ----------- |
| [Applicationprocess](./04-application-layer-report.md#applicationprocess) | [Application](./04-application-layer-report.md) | realizes       | inbound   | many-to-one |
| [Applicationprocess](./04-application-layer-report.md#applicationprocess) | [Application](./04-application-layer-report.md) | aggregates     | outbound  | many-to-one |
| [Securityconstraints](./03-security-layer-report.md#securityconstraints)  | [Security](./03-security-layer-report.md)       | constrained-by | outbound  | many-to-one |
| [Separationofduty](./03-security-layer-report.md#separationofduty)        | [Security](./03-security-layer-report.md)       | constrained-by | outbound  | many-to-one |

[Back to Index](#report-index)

### Businessrole {#businessrole}

**Spec Node ID**: `business.businessrole`

An active structure element representing a named set of responsibilities, skills, or authorizations that can be assigned to a BusinessActor. Roles abstract away the concrete actor, enabling flexible actor-to-behavior assignment.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 10
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                    | Predicate   | Direction | Cardinality  |
| ----------------------------------------------- | ----------- | --------- | ------------ |
| [Businessactor](#businessactor)                 | assigned-to | inbound   | many-to-many |
| [Businesscollaboration](#businesscollaboration) | composes    | inbound   | many-to-many |
| [Businessfunction](#businessfunction)           | serves      | inbound   | many-to-one  |
| [Businessinterface](#businessinterface)         | serves      | inbound   | many-to-one  |
| [Businessobject](#businessobject)               | accesses    | outbound  | many-to-one  |
| [Contract](#contract)                           | accesses    | outbound  | many-to-one  |
| [Businessfunction](#businessfunction)           | assigned-to | outbound  | many-to-one  |
| [Businessinteraction](#businessinteraction)     | assigned-to | outbound  | many-to-one  |
| [Businessinterface](#businessinterface)         | assigned-to | outbound  | many-to-one  |
| [Businessprocess](#businessprocess)             | assigned-to | outbound  | many-to-one  |
| [Businessfunction](#businessfunction)           | performs    | outbound  | many-to-one  |
| [Businessprocess](#businessprocess)             | performs    | outbound  | many-to-one  |
| [Businessactor](#businessactor)                 | serves      | outbound  | many-to-one  |
| [Businessevent](#businessevent)                 | triggers    | outbound  | many-to-one  |
| [Contract](#contract)                           | serves      | inbound   | many-to-one  |

[Back to Index](#report-index)

### Businessservice {#businessservice}

**Spec Node ID**: `business.businessservice`

An externally visible behavior element that fulfills a business need for a customer or stakeholder. Defined from the consumer perspective; the internal realization (via BusinessProcess or BusinessFunction) is encapsulated and not exposed.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 3
- **Inter-Layer**: Inbound: 2 | Outbound: 1

#### Intra-Layer Relationships

| Related Node                                | Predicate  | Direction | Cardinality  |
| ------------------------------------------- | ---------- | --------- | ------------ |
| [Businessfunction](#businessfunction)       | realizes   | inbound   | many-to-one  |
| [Businessinteraction](#businessinteraction) | serves     | inbound   | many-to-one  |
| [Businessinterface](#businessinterface)     | provides   | inbound   | many-to-one  |
| [Businessprocess](#businessprocess)         | realizes   | inbound   | many-to-one  |
| [Contract](#contract)                       | accesses   | outbound  | many-to-one  |
| [Businessprocess](#businessprocess)         | realizes   | outbound  | many-to-one  |
| [Businessactor](#businessactor)             | serves     | outbound  | many-to-many |
| [Contract](#contract)                       | governs    | inbound   | many-to-one  |
| [Product](#product)                         | aggregates | inbound   | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                              | Layer                                         | Predicate      | Direction | Cardinality  |
| --------------------------------------------------------- | --------------------------------------------- | -------------- | --------- | ------------ |
| [Operation](./06-api-layer-report.md#operation)           | [API](./06-api-layer-report.md)               | references     | inbound   | many-to-one  |
| [Securityscheme](./06-api-layer-report.md#securityscheme) | [API](./06-api-layer-report.md)               | references     | inbound   | many-to-one  |
| [Value](./01-motivation-layer-report.md#value)            | [Motivation](./01-motivation-layer-report.md) | delivers-value | outbound  | many-to-many |

[Back to Index](#report-index)

### Contract {#contract}

**Spec Node ID**: `business.contract`

A passive structure element representing a formal or informal specification of an agreement between a service provider and consumer, defining obligations, rights, and terms. Often associated with a Product or BusinessService.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate | Direction | Cardinality |
| ----------------------------------- | --------- | --------- | ----------- |
| [Businessactor](#businessactor)     | accesses  | inbound   | many-to-one |
| [Businessprocess](#businessprocess) | accesses  | inbound   | many-to-one |
| [Businessrole](#businessrole)       | accesses  | inbound   | many-to-one |
| [Businessservice](#businessservice) | accesses  | inbound   | many-to-one |
| [Businessobject](#businessobject)   | accesses  | outbound  | many-to-one |
| [Businessservice](#businessservice) | governs   | outbound  | many-to-one |
| [Businessrole](#businessrole)       | serves    | outbound  | many-to-one |
| [Businessprocess](#businessprocess) | triggers  | outbound  | many-to-one |
| [Product](#product)                 | composes  | inbound   | many-to-one |

[Back to Index](#report-index)

### Product {#product}

**Spec Node ID**: `business.product`

A passive structure element representing a coherent collection of BusinessServices and Contracts offered to customers or markets. The product encapsulates the value proposition delivered to end users or business partners.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 2
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate  | Direction | Cardinality |
| ----------------------------------- | ---------- | --------- | ----------- |
| [Businessservice](#businessservice) | aggregates | outbound  | many-to-one |
| [Contract](#contract)               | composes   | outbound  | many-to-one |

[Back to Index](#report-index)

### Representation {#representation}

**Spec Node ID**: `business.representation`

A passive structure element representing the perceptible form in which a BusinessObject is manifested (e.g., a printed report, a digital document, or an on-screen form). Multiple representations can carry the same BusinessObject.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate | Direction | Cardinality |
| --------------------------------- | --------- | --------- | ----------- |
| [Businessobject](#businessobject) | realizes  | outbound  | many-to-one |

[Back to Index](#report-index)

---

_Generated: 2026-03-02T23:19:52.838Z | Spec Version: 0.8.1 | Generator: generate-layer-reports.ts_
