# Security Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Accesscondition](#accesscondition)
  - [Accountabilityrequirement](#accountabilityrequirement)
  - [Actor](#actor)
  - [Auditconfig](#auditconfig)
  - [Authenticationconfig](#authenticationconfig)
  - [Bindingofduty](#bindingofduty)
  - [Condition](#condition)
  - [Countermeasure](#countermeasure)
  - [Dataclassification](#dataclassification)
  - [Delegation](#delegation)
  - [Evidence](#evidence)
  - [Fieldaccesscontrol](#fieldaccesscontrol)
  - [Informationentity](#informationentity)
  - [Informationright](#informationright)
  - [Needtoknow](#needtoknow)
  - [Passwordpolicy](#passwordpolicy)
  - [Permission](#permission)
  - [Policyaction](#policyaction)
  - [Policyrule](#policyrule)
  - [Resourceoperation](#resourceoperation)
  - [Retentionpolicy](#retentionpolicy)
  - [Role](#role)
  - [Secureresource](#secureresource)
  - [Securityconstraints](#securityconstraints)
  - [Securitymodel](#securitymodel)
  - [Securitypolicy](#securitypolicy)
  - [Separationofduty](#separationofduty)
  - [Threat](#threat)
  - [Validationrule](#validationrule)

## Layer Introduction

**Layer 3**: Security
**Standard**: [NIST SP 800-53](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf)

Layer 3: Security Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 29    |
| Intra-Layer Relationships | 154   |
| Inter-Layer Relationships | 6     |
| Inbound Relationships     | 6     |
| Outbound Relationships    | 0     |

### Layer Dependencies

**Depends On**: [Business](./02-business-layer-report.md), [API](./06-api-layer-report.md)

**Depended On By**: None

## Intra-Layer Relationships

```mermaid
flowchart LR
  subgraph security
    accesscondition["accesscondition"]
    accountabilityrequirement["accountabilityrequirement"]
    actor["actor"]
    auditconfig["auditconfig"]
    authenticationconfig["authenticationconfig"]
    bindingofduty["bindingofduty"]
    condition["condition"]
    countermeasure["countermeasure"]
    dataclassification["dataclassification"]
    delegation["delegation"]
    evidence["evidence"]
    fieldaccesscontrol["fieldaccesscontrol"]
    informationentity["informationentity"]
    informationright["informationright"]
    needtoknow["needtoknow"]
    passwordpolicy["passwordpolicy"]
    permission["permission"]
    policyaction["policyaction"]
    policyrule["policyrule"]
    resourceoperation["resourceoperation"]
    retentionpolicy["retentionpolicy"]
    role["role"]
    secureresource["secureresource"]
    securityconstraints["securityconstraints"]
    securitymodel["securitymodel"]
    securitypolicy["securitypolicy"]
    separationofduty["separationofduty"]
    threat["threat"]
    validationrule["validationrule"]
    accesscondition -->|composes| policyrule
    accesscondition -->|constrains| permission
    accesscondition -->|governs| fieldaccesscontrol
    accesscondition -->|references| secureresource
    accesscondition -->|uses| validationrule
    accountabilityrequirement -->|constrains| actor
    accountabilityrequirement -->|requires| auditconfig
    accountabilityrequirement -->|requires| evidence
    accountabilityrequirement -->|requires| retentionpolicy
    actor -->|accesses| secureresource
    actor -->|assigned-to| role
    actor -->|associated-with| delegation
    actor -->|associated-with| threat
    actor -->|references| delegation
    actor -->|requires| authenticationconfig
    auditconfig -->|depends-on| retentionpolicy
    auditconfig -->|fulfills| accountabilityrequirement
    auditconfig -->|governs| retentionpolicy
    auditconfig -->|governs| secureresource
    auditconfig -->|mitigates| threat
    auditconfig -->|monitors| secureresource
    auditconfig -->|triggers| evidence
    authenticationconfig -->|authenticates| actor
    authenticationconfig -->|constrained-by| securitypolicy
    authenticationconfig -->|depends-on| auditconfig
    authenticationconfig -->|protects| secureresource
    authenticationconfig -->|references| passwordpolicy
    authenticationconfig -->|uses| passwordpolicy
    bindingofduty -->|associated-with| separationofduty
    bindingofduty -->|constrains| role
    bindingofduty -->|governs| resourceoperation
    bindingofduty -->|requires| evidence
    bindingofduty -->|supports| accountabilityrequirement
    condition -->|composes| accesscondition
    condition -->|constrains| policyrule
    condition -->|constrains| securitypolicy
    condition -->|triggers| policyaction
    countermeasure -->|fulfills| securityconstraints
    countermeasure -->|implements| securitypolicy
    countermeasure -->|mitigates| threat
    countermeasure -->|protects| secureresource
    countermeasure -->|requires| evidence
    dataclassification -->|governs| fieldaccesscontrol
    dataclassification -->|governs| informationentity
    dataclassification -->|governs| retentionpolicy
    dataclassification -->|governs| secureresource
    dataclassification -->|requires| countermeasure
    dataclassification -->|supports| securitypolicy
    delegation -->|authorizes| role
    delegation -->|constrained-by| securitypolicy
    delegation -->|requires| actor
    delegation -->|triggers| evidence
    evidence -->|mitigates| threat
    evidence -->|realizes| auditconfig
    evidence -->|supports| accountabilityrequirement
    evidence -->|validates| policyrule
    fieldaccesscontrol -->|constrained-by| accesscondition
    fieldaccesscontrol -->|constrained-by| dataclassification
    fieldaccesscontrol -->|governs| secureresource
    fieldaccesscontrol -->|implements| policyrule
    fieldaccesscontrol -->|protects| secureresource
    fieldaccesscontrol -->|requires| permission
    informationentity -->|constrained-by| dataclassification
    informationentity -->|constrained-by| retentionpolicy
    informationentity -->|governs| informationright
    informationentity -->|requires| accountabilityrequirement
    informationright -->|accesses| informationentity
    informationright -->|assigned-to| actor
    informationright -->|constrained-by| accesscondition
    informationright -->|governs| informationentity
    informationright -->|implements| permission
    needtoknow -->|associated-with| role
    needtoknow -->|constrained-by| dataclassification
    needtoknow -->|constrains| permission
    needtoknow -->|implements| policyrule
    needtoknow -->|protects| informationentity
    passwordpolicy -->|constrains| authenticationconfig
    passwordpolicy -->|mitigates| threat
    passwordpolicy -->|requires| auditconfig
    passwordpolicy -->|requires| countermeasure
    passwordpolicy -->|uses| validationrule
    permission -->|authorizes| resourceoperation
    policyaction -->|enforces-requirement| policyrule
    policyaction -->|governs| permission
    policyaction -->|mitigates| threat
    policyaction -->|requires| countermeasure
    policyaction -->|triggers| auditconfig
    policyrule -->|authorizes| permission
    policyrule -->|composes| securitypolicy
    policyrule -->|governs| informationright
    policyrule -->|protects| secureresource
    policyrule -->|requires| countermeasure
    policyrule -->|triggers| policyaction
    policyrule -->|uses| accesscondition
    policyrule -->|uses| condition
    resourceoperation -->|accesses| secureresource
    resourceoperation -->|constrained-by| accesscondition
    resourceoperation -->|governs| secureresource
    resourceoperation -->|triggers| auditconfig
    retentionpolicy -->|constrains| informationentity
    retentionpolicy -->|governs| auditconfig
    retentionpolicy -->|governs| evidence
    retentionpolicy -->|requires| countermeasure
    role -->|accesses| secureresource
    role -->|aggregates| permission
    role -->|authorizes| permission
    role -->|constrained-by| separationofduty
    role -->|provides| permission
    role -->|specializes| role
    secureresource -->|aggregates| fieldaccesscontrol
    secureresource -->|aggregates| resourceoperation
    securityconstraints -->|aggregates| bindingofduty
    securityconstraints -->|aggregates| needtoknow
    securityconstraints -->|aggregates| separationofduty
    securityconstraints -->|constrains| role
    securityconstraints -->|governs| securitypolicy
    securitymodel -->|aggregates| actor
    securitymodel -->|aggregates| authenticationconfig
    securitymodel -->|aggregates| delegation
    securitymodel -->|aggregates| informationentity
    securitymodel -->|aggregates| permission
    securitymodel -->|aggregates| role
    securitymodel -->|aggregates| secureresource
    securitymodel -->|aggregates| threat
    securitymodel -->|composes| authenticationconfig
    securitymodel -->|composes| securityconstraints
    securitymodel -->|composes| securitypolicy
    securitymodel -->|constrains| accountabilityrequirement
    securitymodel -->|governs| dataclassification
    securitymodel -->|governs| securitypolicy
    securitypolicy -->|aggregates| policyrule
    securitypolicy -->|constrains| permission
    securitypolicy -->|enforces-requirement| accesscondition
    securitypolicy -->|fulfills| accountabilityrequirement
    securitypolicy -->|governs| passwordpolicy
    securitypolicy -->|governs| secureresource
    securitypolicy -->|requires| countermeasure
    separationofduty -->|associated-with| bindingofduty
    separationofduty -->|constrains| role
    separationofduty -->|governs| policyrule
    separationofduty -->|mitigates| threat
    separationofduty -->|requires| accountabilityrequirement
    threat -->|accesses| secureresource
    threat -->|aggregates| countermeasure
    threat -->|constrains| accesscondition
    threat -->|influence| dataclassification
    threat -->|influence| securitypolicy
    threat -->|triggers| auditconfig
    validationrule -->|constrains| accesscondition
    validationrule -->|constrains| fieldaccesscontrol
    validationrule -->|enforces-requirement| fieldaccesscontrol
    validationrule -->|enforces-requirement| securityconstraints
    validationrule -->|realizes| policyrule
    validationrule -->|supports| securitypolicy
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
  class security current
```

## Inter-Layer Relationships Table

| Relationship ID                                                      | Source Node                                                      | Dest Node                                                                | Dest Layer                                | Predicate      | Cardinality | Strength |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------- | -------------- | ----------- | -------- |
| api.operation.references.security.secureresource                     | [operation](./06-api-layer-report.md#operation)                  | [secureresource](./03-security-layer-report.md#secureresource)           | [Security](./03-security-layer-report.md) | references     | many-to-one | medium   |
| api.operation.requires.security.permission                           | [operation](./06-api-layer-report.md#operation)                  | [permission](./03-security-layer-report.md#permission)                   | [Security](./03-security-layer-report.md) | requires       | many-to-one | medium   |
| api.securityscheme.references.security.secureresource                | [securityscheme](./06-api-layer-report.md#securityscheme)        | [secureresource](./03-security-layer-report.md#secureresource)           | [Security](./03-security-layer-report.md) | references     | many-to-one | medium   |
| api.securityscheme.requires.security.permission                      | [securityscheme](./06-api-layer-report.md#securityscheme)        | [permission](./03-security-layer-report.md#permission)                   | [Security](./03-security-layer-report.md) | requires       | many-to-one | medium   |
| business.businessprocess.constrained-by.security.securityconstraints | [businessprocess](./02-business-layer-report.md#businessprocess) | [securityconstraints](./03-security-layer-report.md#securityconstraints) | [Security](./03-security-layer-report.md) | constrained-by | many-to-one | medium   |
| business.businessprocess.constrained-by.security.separationofduty    | [businessprocess](./02-business-layer-report.md#businessprocess) | [separationofduty](./03-security-layer-report.md#separationofduty)       | [Security](./03-security-layer-report.md) | constrained-by | many-to-one | medium   |

## Node Reference

### Accesscondition {#accesscondition}

**Spec Node ID**: `security.accesscondition`

Defines a single boolean predicate evaluated against a request context attribute (field), comparing the runtime value using a specified operator. Composed inside a PolicyRule condition chain to form compound access control expressions.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 8 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                              | Predicate            | Direction | Cardinality |
| ----------------------------------------- | -------------------- | --------- | ----------- |
| [policyrule](#policyrule)                 | composes             | outbound  | many-to-one |
| [permission](#permission)                 | constrains           | outbound  | many-to-one |
| [fieldaccesscontrol](#fieldaccesscontrol) | governs              | outbound  | many-to-one |
| [secureresource](#secureresource)         | references           | outbound  | many-to-one |
| [validationrule](#validationrule)         | uses                 | outbound  | many-to-one |
| [condition](#condition)                   | composes             | inbound   | many-to-one |
| [fieldaccesscontrol](#fieldaccesscontrol) | constrained-by       | inbound   | many-to-one |
| [informationright](#informationright)     | constrained-by       | inbound   | many-to-one |
| [policyrule](#policyrule)                 | uses                 | inbound   | many-to-one |
| [resourceoperation](#resourceoperation)   | constrained-by       | inbound   | many-to-one |
| [securitypolicy](#securitypolicy)         | enforces-requirement | inbound   | many-to-one |
| [threat](#threat)                         | constrains           | inbound   | many-to-one |
| [validationrule](#validationrule)         | constrains           | inbound   | many-to-one |

[Back to Index](#report-index)

### Accountabilityrequirement {#accountabilityrequirement}

**Spec Node ID**: `security.accountabilityrequirement`

Expresses who is obligated to provide evidence that a specific action occurred and under what conditions that evidence can be challenged. Distinct from AuditConfig, which defines what events are captured — this node defines the obligation to prove an action took place. Implements NIST SP 800-53 AU-10 non-repudiation.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 7 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                            | Predicate  | Direction | Cardinality |
| --------------------------------------- | ---------- | --------- | ----------- |
| [actor](#actor)                         | constrains | outbound  | many-to-one |
| [auditconfig](#auditconfig)             | requires   | outbound  | many-to-one |
| [evidence](#evidence)                   | requires   | outbound  | many-to-one |
| [retentionpolicy](#retentionpolicy)     | requires   | outbound  | many-to-one |
| [auditconfig](#auditconfig)             | fulfills   | inbound   | many-to-one |
| [bindingofduty](#bindingofduty)         | supports   | inbound   | many-to-one |
| [evidence](#evidence)                   | supports   | inbound   | many-to-one |
| [informationentity](#informationentity) | requires   | inbound   | many-to-one |
| [securitymodel](#securitymodel)         | constrains | inbound   | many-to-one |
| [securitypolicy](#securitypolicy)       | fulfills   | inbound   | many-to-one |
| [separationofduty](#separationofduty)   | requires   | inbound   | many-to-one |

[Back to Index](#report-index)

### Actor {#actor}

**Spec Node ID**: `security.actor`

A named principal — human user, service account, automated system, or external entity — whose identity and trust level govern what operations it may perform. Associates with Roles for permission grouping and with SeparationOfDuty and Delegation controls, per NIST SP 800-53 AC-2 (Account Management) and SP 800-207 (Zero Trust Architecture).

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                            | Predicate       | Direction | Cardinality  |
| ------------------------------------------------------- | --------------- | --------- | ------------ |
| [accountabilityrequirement](#accountabilityrequirement) | constrains      | inbound   | many-to-one  |
| [secureresource](#secureresource)                       | accesses        | outbound  | many-to-one  |
| [role](#role)                                           | assigned-to     | outbound  | many-to-one  |
| [delegation](#delegation)                               | associated-with | outbound  | many-to-one  |
| [threat](#threat)                                       | associated-with | outbound  | many-to-one  |
| [delegation](#delegation)                               | references      | outbound  | many-to-one  |
| [authenticationconfig](#authenticationconfig)           | requires        | outbound  | many-to-one  |
| [authenticationconfig](#authenticationconfig)           | authenticates   | inbound   | many-to-one  |
| [delegation](#delegation)                               | requires        | inbound   | many-to-one  |
| [informationright](#informationright)                   | assigned-to     | inbound   | many-to-one  |
| [securitymodel](#securitymodel)                         | aggregates      | inbound   | many-to-many |

[Back to Index](#report-index)

### Auditconfig {#auditconfig}

**Spec Node ID**: `security.auditconfig`

Configuration for security audit logging, specifying what events to capture, retention periods, storage destinations, and compliance requirements. Enables security monitoring and forensic analysis.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 8 | Outbound: 7
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                            | Predicate  | Direction | Cardinality |
| ------------------------------------------------------- | ---------- | --------- | ----------- |
| [accountabilityrequirement](#accountabilityrequirement) | requires   | inbound   | many-to-one |
| [retentionpolicy](#retentionpolicy)                     | depends-on | outbound  | many-to-one |
| [accountabilityrequirement](#accountabilityrequirement) | fulfills   | outbound  | many-to-one |
| [retentionpolicy](#retentionpolicy)                     | governs    | outbound  | many-to-one |
| [secureresource](#secureresource)                       | governs    | outbound  | many-to-one |
| [threat](#threat)                                       | mitigates  | outbound  | many-to-one |
| [secureresource](#secureresource)                       | monitors   | outbound  | many-to-one |
| [evidence](#evidence)                                   | triggers   | outbound  | many-to-one |
| [authenticationconfig](#authenticationconfig)           | depends-on | inbound   | many-to-one |
| [evidence](#evidence)                                   | realizes   | inbound   | many-to-one |
| [passwordpolicy](#passwordpolicy)                       | requires   | inbound   | many-to-one |
| [policyaction](#policyaction)                           | triggers   | inbound   | many-to-one |
| [resourceoperation](#resourceoperation)                 | triggers   | inbound   | many-to-one |
| [retentionpolicy](#retentionpolicy)                     | governs    | inbound   | many-to-one |
| [threat](#threat)                                       | triggers   | inbound   | many-to-one |

[Back to Index](#report-index)

### Authenticationconfig {#authenticationconfig}

**Spec Node ID**: `security.authenticationconfig`

Specifies how principals are verified before accessing protected resources, including the identity provider, multi-factor requirements, session lifetime, and credential policy references. Scoped per application or service. Maps to NIST SP 800-53 IA-2, IA-5, and IA-11.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 4 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate      | Direction | Cardinality |
| --------------------------------- | -------------- | --------- | ----------- |
| [actor](#actor)                   | requires       | inbound   | many-to-one |
| [actor](#actor)                   | authenticates  | outbound  | many-to-one |
| [securitypolicy](#securitypolicy) | constrained-by | outbound  | many-to-one |
| [auditconfig](#auditconfig)       | depends-on     | outbound  | many-to-one |
| [secureresource](#secureresource) | protects       | outbound  | many-to-one |
| [passwordpolicy](#passwordpolicy) | references     | outbound  | many-to-one |
| [passwordpolicy](#passwordpolicy) | uses           | outbound  | many-to-one |
| [passwordpolicy](#passwordpolicy) | constrains     | inbound   | many-to-one |
| [securitymodel](#securitymodel)   | aggregates     | inbound   | many-to-one |
| [securitymodel](#securitymodel)   | composes       | inbound   | many-to-one |

[Back to Index](#report-index)

### Bindingofduty {#bindingofduty}

**Spec Node ID**: `security.bindingofduty`

Obligation control requiring that a single actor who initiates a task must also complete it, preventing task hijacking or inconsistent workflow state that could be exploited by a different actor. Complements SeparationOfDuty by enforcing task continuity rather than task segregation. Anchored to NIST SP 800-53 CM-5 (Access Restrictions for Change) and workflow integrity controls.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                            | Predicate       | Direction | Cardinality |
| ------------------------------------------------------- | --------------- | --------- | ----------- |
| [separationofduty](#separationofduty)                   | associated-with | outbound  | many-to-one |
| [role](#role)                                           | constrains      | outbound  | many-to-one |
| [resourceoperation](#resourceoperation)                 | governs         | outbound  | many-to-one |
| [evidence](#evidence)                                   | requires        | outbound  | many-to-one |
| [accountabilityrequirement](#accountabilityrequirement) | supports        | outbound  | many-to-one |
| [securityconstraints](#securityconstraints)             | aggregates      | inbound   | many-to-one |
| [separationofduty](#separationofduty)                   | associated-with | inbound   | many-to-one |

[Back to Index](#report-index)

### Condition {#condition}

**Spec Node ID**: `security.condition`

A reusable logical expression evaluated against request context (time, location, user attributes, resource state) to determine when a SecurityPolicy rule applies. Distinct from AccessCondition, which is a concrete field+operator+value predicate composed inside a PolicyRule condition chain.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate  | Direction | Cardinality |
| ----------------------------------- | ---------- | --------- | ----------- |
| [accesscondition](#accesscondition) | composes   | outbound  | many-to-one |
| [policyrule](#policyrule)           | constrains | outbound  | many-to-one |
| [securitypolicy](#securitypolicy)   | constrains | outbound  | many-to-one |
| [policyaction](#policyaction)       | triggers   | outbound  | many-to-one |
| [policyrule](#policyrule)           | uses       | inbound   | many-to-one |

[Back to Index](#report-index)

### Countermeasure {#countermeasure}

**Spec Node ID**: `security.countermeasure`

A security control or mitigation technique that reduces the likelihood or impact of a specific threat. Maps to NIST SP 800-53 controls by type (technical, operational, management) and tracks implementation status and residual risk.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 7 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate  | Direction | Cardinality  |
| ------------------------------------------- | ---------- | --------- | ------------ |
| [securityconstraints](#securityconstraints) | fulfills   | outbound  | many-to-one  |
| [securitypolicy](#securitypolicy)           | implements | outbound  | many-to-one  |
| [threat](#threat)                           | mitigates  | outbound  | many-to-one  |
| [secureresource](#secureresource)           | protects   | outbound  | many-to-one  |
| [evidence](#evidence)                       | requires   | outbound  | many-to-one  |
| [dataclassification](#dataclassification)   | requires   | inbound   | many-to-one  |
| [passwordpolicy](#passwordpolicy)           | requires   | inbound   | many-to-one  |
| [policyaction](#policyaction)               | requires   | inbound   | many-to-one  |
| [policyrule](#policyrule)                   | requires   | inbound   | many-to-one  |
| [retentionpolicy](#retentionpolicy)         | requires   | inbound   | many-to-one  |
| [securitypolicy](#securitypolicy)           | requires   | inbound   | many-to-one  |
| [threat](#threat)                           | aggregates | inbound   | many-to-many |

[Back to Index](#report-index)

### Dataclassification {#dataclassification}

**Spec Node ID**: `security.dataclassification`

Data classification and protection policies

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                              | Predicate      | Direction | Cardinality |
| ----------------------------------------- | -------------- | --------- | ----------- |
| [fieldaccesscontrol](#fieldaccesscontrol) | governs        | outbound  | many-to-one |
| [informationentity](#informationentity)   | governs        | outbound  | many-to-one |
| [retentionpolicy](#retentionpolicy)       | governs        | outbound  | many-to-one |
| [secureresource](#secureresource)         | governs        | outbound  | many-to-one |
| [countermeasure](#countermeasure)         | requires       | outbound  | many-to-one |
| [securitypolicy](#securitypolicy)         | supports       | outbound  | many-to-one |
| [fieldaccesscontrol](#fieldaccesscontrol) | constrained-by | inbound   | many-to-one |
| [informationentity](#informationentity)   | constrained-by | inbound   | many-to-one |
| [needtoknow](#needtoknow)                 | constrained-by | inbound   | many-to-one |
| [securitymodel](#securitymodel)           | governs        | inbound   | many-to-one |
| [threat](#threat)                         | influence      | inbound   | many-to-one |

[Back to Index](#report-index)

### Delegation {#delegation}

**Spec Node ID**: `security.delegation`

Explicit transfer of permissions or authority from a delegator to a delegatee, subject to scope constraints and optional time bounds. Supports least-privilege enforcement (NIST AC-6) by enabling time-limited privilege elevation rather than permanent role assignment.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate       | Direction | Cardinality  |
| --------------------------------- | --------------- | --------- | ------------ |
| [actor](#actor)                   | associated-with | inbound   | many-to-one  |
| [actor](#actor)                   | references      | inbound   | many-to-one  |
| [role](#role)                     | authorizes      | outbound  | many-to-one  |
| [securitypolicy](#securitypolicy) | constrained-by  | outbound  | many-to-one  |
| [actor](#actor)                   | requires        | outbound  | many-to-one  |
| [evidence](#evidence)             | triggers        | outbound  | many-to-one  |
| [securitymodel](#securitymodel)   | aggregates      | inbound   | many-to-many |

[Back to Index](#report-index)

### Evidence {#evidence}

**Spec Node ID**: `security.evidence`

An artifact that provides verifiable proof of an action or event for non-repudiation and audit purposes. Anchored to NIST SP 800-53 AU-10 (Non-repudiation), evidence types range from cryptographic signatures to plain audit log entries, with strength characterizing the assurance level per NIST SP 800-63-3.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                            | Predicate | Direction | Cardinality |
| ------------------------------------------------------- | --------- | --------- | ----------- |
| [accountabilityrequirement](#accountabilityrequirement) | requires  | inbound   | many-to-one |
| [auditconfig](#auditconfig)                             | triggers  | inbound   | many-to-one |
| [bindingofduty](#bindingofduty)                         | requires  | inbound   | many-to-one |
| [countermeasure](#countermeasure)                       | requires  | inbound   | many-to-one |
| [delegation](#delegation)                               | triggers  | inbound   | many-to-one |
| [threat](#threat)                                       | mitigates | outbound  | many-to-one |
| [auditconfig](#auditconfig)                             | realizes  | outbound  | many-to-one |
| [accountabilityrequirement](#accountabilityrequirement) | supports  | outbound  | many-to-one |
| [policyrule](#policyrule)                               | validates | outbound  | many-to-one |
| [retentionpolicy](#retentionpolicy)                     | governs   | inbound   | many-to-one |

[Back to Index](#report-index)

### Fieldaccesscontrol {#fieldaccesscontrol}

**Spec Node ID**: `security.fieldaccesscontrol`

Defines access restrictions and transformation rules for a specific data field, controlling how sensitive values are masked or redacted when exposed to unauthorized principals. Used within SecureResource fieldAccess to enforce field-level data protection per NIST SP 800-53 AC-3 and SC-28.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                              | Predicate            | Direction | Cardinality |
| ----------------------------------------- | -------------------- | --------- | ----------- |
| [accesscondition](#accesscondition)       | governs              | inbound   | many-to-one |
| [dataclassification](#dataclassification) | governs              | inbound   | many-to-one |
| [accesscondition](#accesscondition)       | constrained-by       | outbound  | many-to-one |
| [dataclassification](#dataclassification) | constrained-by       | outbound  | many-to-one |
| [secureresource](#secureresource)         | governs              | outbound  | many-to-one |
| [policyrule](#policyrule)                 | implements           | outbound  | many-to-one |
| [secureresource](#secureresource)         | protects             | outbound  | many-to-one |
| [permission](#permission)                 | requires             | outbound  | many-to-one |
| [secureresource](#secureresource)         | aggregates           | inbound   | many-to-one |
| [validationrule](#validationrule)         | constrains           | inbound   | many-to-one |
| [validationrule](#validationrule)         | enforces-requirement | inbound   | many-to-one |

[Back to Index](#report-index)

### Informationentity {#informationentity}

**Spec Node ID**: `security.informationentity`

Named information asset subject to fine-grained access rights and data classification. Represents a logical grouping of data (e.g., customer PII, financial records) whose access is governed by associated InformationRight grants and AccountabilityRequirements, per NIST SP 800-53 AC-3 and IP-1.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                            | Predicate      | Direction | Cardinality  |
| ------------------------------------------------------- | -------------- | --------- | ------------ |
| [dataclassification](#dataclassification)               | governs        | inbound   | many-to-one  |
| [dataclassification](#dataclassification)               | constrained-by | outbound  | many-to-one  |
| [retentionpolicy](#retentionpolicy)                     | constrained-by | outbound  | many-to-one  |
| [informationright](#informationright)                   | governs        | outbound  | many-to-one  |
| [accountabilityrequirement](#accountabilityrequirement) | requires       | outbound  | many-to-one  |
| [informationright](#informationright)                   | accesses       | inbound   | many-to-one  |
| [informationright](#informationright)                   | governs        | inbound   | many-to-one  |
| [needtoknow](#needtoknow)                               | protects       | inbound   | many-to-one  |
| [retentionpolicy](#retentionpolicy)                     | constrains     | inbound   | many-to-one  |
| [securitymodel](#securitymodel)                         | aggregates     | inbound   | many-to-many |

[Back to Index](#report-index)

### Informationright {#informationright}

**Spec Node ID**: `security.informationright`

A granular access grant specifying which operations a named actor may perform on an InformationEntity, subject to a qualifying constraint expression. Implements attribute-based access control (ABAC) at the information asset level, per NIST SP 800-162 (ABAC Guide) and NIST SP 800-53 AC-3(14).

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                            | Predicate      | Direction | Cardinality |
| --------------------------------------- | -------------- | --------- | ----------- |
| [informationentity](#informationentity) | governs        | inbound   | many-to-one |
| [informationentity](#informationentity) | accesses       | outbound  | many-to-one |
| [actor](#actor)                         | assigned-to    | outbound  | many-to-one |
| [accesscondition](#accesscondition)     | constrained-by | outbound  | many-to-one |
| [informationentity](#informationentity) | governs        | outbound  | many-to-one |
| [permission](#permission)               | implements     | outbound  | many-to-one |
| [policyrule](#policyrule)               | governs        | inbound   | many-to-one |

[Back to Index](#report-index)

### Needtoknow {#needtoknow}

**Spec Node ID**: `security.needtoknow`

Restricts access to a resource to only those actors whose stated purpose requires it, implementing the NIST SP 800-53 AC-3(3) mandatory access control principle. JustificationRequired enforces that actors must declare their purpose before access is granted.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate       | Direction | Cardinality |
| ------------------------------------------- | --------------- | --------- | ----------- |
| [role](#role)                               | associated-with | outbound  | many-to-one |
| [dataclassification](#dataclassification)   | constrained-by  | outbound  | many-to-one |
| [permission](#permission)                   | constrains      | outbound  | many-to-one |
| [policyrule](#policyrule)                   | implements      | outbound  | many-to-one |
| [informationentity](#informationentity)     | protects        | outbound  | many-to-one |
| [securityconstraints](#securityconstraints) | aggregates      | inbound   | many-to-one |

[Back to Index](#report-index)

### Passwordpolicy {#passwordpolicy}

**Spec Node ID**: `security.passwordpolicy`

Defines password complexity, rotation, and lockout requirements for credential-based authentication. Implements NIST SP 800-53 IA-5(1) controls including minimum length, character class requirements, history enforcement, and brute-force lockout thresholds.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality |
| --------------------------------------------- | ---------- | --------- | ----------- |
| [authenticationconfig](#authenticationconfig) | references | inbound   | many-to-one |
| [authenticationconfig](#authenticationconfig) | uses       | inbound   | many-to-one |
| [authenticationconfig](#authenticationconfig) | constrains | outbound  | many-to-one |
| [threat](#threat)                             | mitigates  | outbound  | many-to-one |
| [auditconfig](#auditconfig)                   | requires   | outbound  | many-to-one |
| [countermeasure](#countermeasure)             | requires   | outbound  | many-to-one |
| [validationrule](#validationrule)             | uses       | outbound  | many-to-one |
| [securitypolicy](#securitypolicy)             | governs    | inbound   | many-to-one |

[Back to Index](#report-index)

### Permission {#permission}

**Spec Node ID**: `security.permission`

An atomic grant authorizing a specific action (e.g., read, write, execute) on a resource within a defined scope. Permissions are assigned to Roles and enforced by SecureResource access control lists. Implements NIST SP 800-53 AC-3 access enforcement and AC-6 least privilege.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 11 | Outbound: 1
- **Inter-Layer**: Inbound: 2 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                              | Predicate  | Direction | Cardinality  |
| ----------------------------------------- | ---------- | --------- | ------------ |
| [accesscondition](#accesscondition)       | constrains | inbound   | many-to-one  |
| [fieldaccesscontrol](#fieldaccesscontrol) | requires   | inbound   | many-to-one  |
| [informationright](#informationright)     | implements | inbound   | many-to-one  |
| [needtoknow](#needtoknow)                 | constrains | inbound   | many-to-one  |
| [resourceoperation](#resourceoperation)   | authorizes | outbound  | many-to-one  |
| [policyaction](#policyaction)             | governs    | inbound   | many-to-one  |
| [policyrule](#policyrule)                 | authorizes | inbound   | many-to-one  |
| [role](#role)                             | aggregates | inbound   | many-to-one  |
| [role](#role)                             | authorizes | inbound   | many-to-one  |
| [role](#role)                             | provides   | inbound   | many-to-one  |
| [securitymodel](#securitymodel)           | aggregates | inbound   | many-to-many |
| [securitypolicy](#securitypolicy)         | constrains | inbound   | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                              | Layer                           | Predicate | Direction | Cardinality |
| --------------------------------------------------------- | ------------------------------- | --------- | --------- | ----------- |
| [operation](./06-api-layer-report.md#operation)           | [API](./06-api-layer-report.md) | requires  | inbound   | many-to-one |
| [securityscheme](./06-api-layer-report.md#securityscheme) | [API](./06-api-layer-report.md) | requires  | inbound   | many-to-one |

[Back to Index](#report-index)

### Policyaction {#policyaction}

**Spec Node ID**: `security.policyaction`

The enforcement action executed when a SecurityPolicy rule condition is met. Defines the system response to a policy match (allow, deny, remediation, notification), ensuring consistent policy enforcement across the security model per NIST SP 800-53 CA-9 (Internal System Connections) and SI-3 (Malicious Code Protection).

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate            | Direction | Cardinality |
| --------------------------------- | -------------------- | --------- | ----------- |
| [condition](#condition)           | triggers             | inbound   | many-to-one |
| [policyrule](#policyrule)         | enforces-requirement | outbound  | many-to-one |
| [permission](#permission)         | governs              | outbound  | many-to-one |
| [threat](#threat)                 | mitigates            | outbound  | many-to-one |
| [countermeasure](#countermeasure) | requires             | outbound  | many-to-one |
| [auditconfig](#auditconfig)       | triggers             | outbound  | many-to-one |
| [policyrule](#policyrule)         | triggers             | inbound   | many-to-one |

[Back to Index](#report-index)

### Policyrule {#policyrule}

**Spec Node ID**: `security.policyrule`

An atomic policy evaluation unit consisting of a condition predicate and an enforcement effect (PERMIT or DENY), with optional obligation actions executed upon match. Multiple PolicyRules compose a SecurityPolicy evaluated in priority order.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 9 | Outbound: 8
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                              | Predicate            | Direction | Cardinality |
| ----------------------------------------- | -------------------- | --------- | ----------- |
| [accesscondition](#accesscondition)       | composes             | inbound   | many-to-one |
| [condition](#condition)                   | constrains           | inbound   | many-to-one |
| [evidence](#evidence)                     | validates            | inbound   | many-to-one |
| [fieldaccesscontrol](#fieldaccesscontrol) | implements           | inbound   | many-to-one |
| [needtoknow](#needtoknow)                 | implements           | inbound   | many-to-one |
| [policyaction](#policyaction)             | enforces-requirement | inbound   | many-to-one |
| [permission](#permission)                 | authorizes           | outbound  | many-to-one |
| [securitypolicy](#securitypolicy)         | composes             | outbound  | many-to-one |
| [informationright](#informationright)     | governs              | outbound  | many-to-one |
| [secureresource](#secureresource)         | protects             | outbound  | many-to-one |
| [countermeasure](#countermeasure)         | requires             | outbound  | many-to-one |
| [policyaction](#policyaction)             | triggers             | outbound  | many-to-one |
| [accesscondition](#accesscondition)       | uses                 | outbound  | many-to-one |
| [condition](#condition)                   | uses                 | outbound  | many-to-one |
| [securitypolicy](#securitypolicy)         | aggregates           | inbound   | many-to-one |
| [separationofduty](#separationofduty)     | governs              | inbound   | many-to-one |
| [validationrule](#validationrule)         | realizes             | inbound   | many-to-one |

[Back to Index](#report-index)

### Resourceoperation {#resourceoperation}

**Spec Node ID**: `security.resourceoperation`

A permitted operation that an actor may perform on a secured resource, forming the verb component of a subject-verb-object access control policy. Bound to AccessConditions, RateLimits, and AuditConfig nodes via the security policy model, per NIST SP 800-53 AC-3 (Access Enforcement).

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate      | Direction | Cardinality |
| ----------------------------------- | -------------- | --------- | ----------- |
| [bindingofduty](#bindingofduty)     | governs        | inbound   | many-to-one |
| [permission](#permission)           | authorizes     | inbound   | many-to-one |
| [secureresource](#secureresource)   | accesses       | outbound  | many-to-one |
| [accesscondition](#accesscondition) | constrained-by | outbound  | many-to-one |
| [secureresource](#secureresource)   | governs        | outbound  | many-to-one |
| [auditconfig](#auditconfig)         | triggers       | outbound  | many-to-one |
| [secureresource](#secureresource)   | aggregates     | inbound   | many-to-one |

[Back to Index](#report-index)

### Retentionpolicy {#retentionpolicy}

**Spec Node ID**: `security.retentionpolicy`

Defines how long security-related data (audit logs, access records, encryption keys) must be retained, archival strategies, and secure deletion procedures. Ensures compliance with regulatory requirements.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                            | Predicate      | Direction | Cardinality |
| ------------------------------------------------------- | -------------- | --------- | ----------- |
| [accountabilityrequirement](#accountabilityrequirement) | requires       | inbound   | many-to-one |
| [auditconfig](#auditconfig)                             | depends-on     | inbound   | many-to-one |
| [auditconfig](#auditconfig)                             | governs        | inbound   | many-to-one |
| [dataclassification](#dataclassification)               | governs        | inbound   | many-to-one |
| [informationentity](#informationentity)                 | constrained-by | inbound   | many-to-one |
| [informationentity](#informationentity)                 | constrains     | outbound  | many-to-one |
| [auditconfig](#auditconfig)                             | governs        | outbound  | many-to-one |
| [evidence](#evidence)                                   | governs        | outbound  | many-to-one |
| [countermeasure](#countermeasure)                       | requires       | outbound  | many-to-one |

[Back to Index](#report-index)

### Role {#role}

**Spec Node ID**: `security.role`

A named collection of Permissions implementing RBAC per NIST SP 800-53 AC-2 and AC-6. Roles can inherit from parent roles (role hierarchy), accumulating permissions transitively. The level attribute defines the role privilege tier for least-privilege enforcement.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 8 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate       | Direction | Cardinality  |
| ------------------------------------------- | --------------- | --------- | ------------ |
| [actor](#actor)                             | assigned-to     | inbound   | many-to-one  |
| [bindingofduty](#bindingofduty)             | constrains      | inbound   | many-to-one  |
| [delegation](#delegation)                   | authorizes      | inbound   | many-to-one  |
| [needtoknow](#needtoknow)                   | associated-with | inbound   | many-to-one  |
| [secureresource](#secureresource)           | accesses        | outbound  | many-to-one  |
| [permission](#permission)                   | aggregates      | outbound  | many-to-one  |
| [permission](#permission)                   | authorizes      | outbound  | many-to-one  |
| [separationofduty](#separationofduty)       | constrained-by  | outbound  | many-to-one  |
| [permission](#permission)                   | provides        | outbound  | many-to-one  |
| [role](#role)                               | specializes     | outbound  | many-to-one  |
| [securityconstraints](#securityconstraints) | constrains      | inbound   | many-to-one  |
| [securitymodel](#securitymodel)             | aggregates      | inbound   | many-to-many |
| [separationofduty](#separationofduty)       | constrains      | inbound   | many-to-one  |

[Back to Index](#report-index)

### Secureresource {#secureresource}

**Spec Node ID**: `security.secureresource`

Represents a named resource subject to security controls, defining the operations that can be performed on it and optional field-level access restrictions. Acts as the resource component in subject-action-resource access control triples per NIST SP 800-53 AC-3.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 16 | Outbound: 2
- **Inter-Layer**: Inbound: 2 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality  |
| --------------------------------------------- | ---------- | --------- | ------------ |
| [accesscondition](#accesscondition)           | references | inbound   | many-to-one  |
| [actor](#actor)                               | accesses   | inbound   | many-to-one  |
| [auditconfig](#auditconfig)                   | governs    | inbound   | many-to-one  |
| [auditconfig](#auditconfig)                   | monitors   | inbound   | many-to-one  |
| [authenticationconfig](#authenticationconfig) | protects   | inbound   | many-to-one  |
| [countermeasure](#countermeasure)             | protects   | inbound   | many-to-one  |
| [dataclassification](#dataclassification)     | governs    | inbound   | many-to-one  |
| [fieldaccesscontrol](#fieldaccesscontrol)     | governs    | inbound   | many-to-one  |
| [fieldaccesscontrol](#fieldaccesscontrol)     | protects   | inbound   | many-to-one  |
| [policyrule](#policyrule)                     | protects   | inbound   | many-to-one  |
| [resourceoperation](#resourceoperation)       | accesses   | inbound   | many-to-one  |
| [resourceoperation](#resourceoperation)       | governs    | inbound   | many-to-one  |
| [role](#role)                                 | accesses   | inbound   | many-to-one  |
| [fieldaccesscontrol](#fieldaccesscontrol)     | aggregates | outbound  | many-to-one  |
| [resourceoperation](#resourceoperation)       | aggregates | outbound  | many-to-one  |
| [securitymodel](#securitymodel)               | aggregates | inbound   | many-to-many |
| [securitypolicy](#securitypolicy)             | governs    | inbound   | many-to-one  |
| [threat](#threat)                             | accesses   | inbound   | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                              | Layer                           | Predicate  | Direction | Cardinality |
| --------------------------------------------------------- | ------------------------------- | ---------- | --------- | ----------- |
| [operation](./06-api-layer-report.md#operation)           | [API](./06-api-layer-report.md) | references | inbound   | many-to-one |
| [securityscheme](./06-api-layer-report.md#securityscheme) | [API](./06-api-layer-report.md) | references | inbound   | many-to-one |

[Back to Index](#report-index)

### Securityconstraints {#securityconstraints}

**Spec Node ID**: `security.securityconstraints`

An aggregate container defining the procedural access control constraints for an application, grouping SeparationOfDuty, BindingOfDuty, and NeedToKnow rules. Applied within SecurityModel to enforce AC-5 and workflow integrity controls.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 5
- **Inter-Layer**: Inbound: 1 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                          | Predicate            | Direction | Cardinality |
| ------------------------------------- | -------------------- | --------- | ----------- |
| [countermeasure](#countermeasure)     | fulfills             | inbound   | many-to-one |
| [bindingofduty](#bindingofduty)       | aggregates           | outbound  | many-to-one |
| [needtoknow](#needtoknow)             | aggregates           | outbound  | many-to-one |
| [separationofduty](#separationofduty) | aggregates           | outbound  | many-to-one |
| [role](#role)                         | constrains           | outbound  | many-to-one |
| [securitypolicy](#securitypolicy)     | governs              | outbound  | many-to-one |
| [securitymodel](#securitymodel)       | composes             | inbound   | many-to-one |
| [validationrule](#validationrule)     | enforces-requirement | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                     | Layer                                     | Predicate      | Direction | Cardinality |
| ---------------------------------------------------------------- | ----------------------------------------- | -------------- | --------- | ----------- |
| [businessprocess](./02-business-layer-report.md#businessprocess) | [Business](./02-business-layer-report.md) | constrained-by | inbound   | many-to-one |

[Back to Index](#report-index)

### Securitymodel {#securitymodel}

**Spec Node ID**: `security.securitymodel`

The root aggregate for an application's security posture, composing authentication, authorization (roles, permissions, resources), threat model, data classification, accountability requirements, and policies into a unified security specification. Scoped to a single application or bounded context.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 14
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                            | Predicate  | Direction | Cardinality  |
| ------------------------------------------------------- | ---------- | --------- | ------------ |
| [actor](#actor)                                         | aggregates | outbound  | many-to-many |
| [authenticationconfig](#authenticationconfig)           | aggregates | outbound  | many-to-one  |
| [delegation](#delegation)                               | aggregates | outbound  | many-to-many |
| [informationentity](#informationentity)                 | aggregates | outbound  | many-to-many |
| [permission](#permission)                               | aggregates | outbound  | many-to-many |
| [role](#role)                                           | aggregates | outbound  | many-to-many |
| [secureresource](#secureresource)                       | aggregates | outbound  | many-to-many |
| [threat](#threat)                                       | aggregates | outbound  | many-to-one  |
| [authenticationconfig](#authenticationconfig)           | composes   | outbound  | many-to-one  |
| [securityconstraints](#securityconstraints)             | composes   | outbound  | many-to-one  |
| [securitypolicy](#securitypolicy)                       | composes   | outbound  | many-to-one  |
| [accountabilityrequirement](#accountabilityrequirement) | constrains | outbound  | many-to-one  |
| [dataclassification](#dataclassification)               | governs    | outbound  | many-to-one  |
| [securitypolicy](#securitypolicy)                       | governs    | outbound  | many-to-one  |

[Back to Index](#report-index)

### Securitypolicy {#securitypolicy}

**Spec Node ID**: `security.securitypolicy`

A named, prioritized security policy containing ordered evaluation rules that determine access control decisions for targeted resources or operations. Policies are evaluated in priority order with the highest-priority matching policy determining the outcome. Implements NIST SP 800-53 AC-1 policy requirements.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 11 | Outbound: 7
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                            | Predicate            | Direction | Cardinality |
| ------------------------------------------------------- | -------------------- | --------- | ----------- |
| [authenticationconfig](#authenticationconfig)           | constrained-by       | inbound   | many-to-one |
| [condition](#condition)                                 | constrains           | inbound   | many-to-one |
| [countermeasure](#countermeasure)                       | implements           | inbound   | many-to-one |
| [dataclassification](#dataclassification)               | supports             | inbound   | many-to-one |
| [delegation](#delegation)                               | constrained-by       | inbound   | many-to-one |
| [policyrule](#policyrule)                               | composes             | inbound   | many-to-one |
| [securityconstraints](#securityconstraints)             | governs              | inbound   | many-to-one |
| [securitymodel](#securitymodel)                         | composes             | inbound   | many-to-one |
| [securitymodel](#securitymodel)                         | governs              | inbound   | many-to-one |
| [policyrule](#policyrule)                               | aggregates           | outbound  | many-to-one |
| [permission](#permission)                               | constrains           | outbound  | many-to-one |
| [accesscondition](#accesscondition)                     | enforces-requirement | outbound  | many-to-one |
| [accountabilityrequirement](#accountabilityrequirement) | fulfills             | outbound  | many-to-one |
| [passwordpolicy](#passwordpolicy)                       | governs              | outbound  | many-to-one |
| [secureresource](#secureresource)                       | governs              | outbound  | many-to-one |
| [countermeasure](#countermeasure)                       | requires             | outbound  | many-to-one |
| [threat](#threat)                                       | influence            | inbound   | many-to-one |
| [validationrule](#validationrule)                       | supports             | inbound   | many-to-one |

[Back to Index](#report-index)

### Separationofduty {#separationofduty}

**Spec Node ID**: `security.separationofduty`

Enforces NIST SP 800-53 AC-5 by requiring that sensitive tasks (e.g., request + approval, initiate + authorize) are performed by different actors or roles, preventing fraud, collusion, and undetected errors. MutuallyExclusive indicates roles that cannot be assigned to the same individual.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 5
- **Inter-Layer**: Inbound: 1 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                            | Predicate       | Direction | Cardinality |
| ------------------------------------------------------- | --------------- | --------- | ----------- |
| [bindingofduty](#bindingofduty)                         | associated-with | inbound   | many-to-one |
| [role](#role)                                           | constrained-by  | inbound   | many-to-one |
| [securityconstraints](#securityconstraints)             | aggregates      | inbound   | many-to-one |
| [bindingofduty](#bindingofduty)                         | associated-with | outbound  | many-to-one |
| [role](#role)                                           | constrains      | outbound  | many-to-one |
| [policyrule](#policyrule)                               | governs         | outbound  | many-to-one |
| [threat](#threat)                                       | mitigates       | outbound  | many-to-one |
| [accountabilityrequirement](#accountabilityrequirement) | requires        | outbound  | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                     | Layer                                     | Predicate      | Direction | Cardinality |
| ---------------------------------------------------------------- | ----------------------------------------- | -------------- | --------- | ----------- |
| [businessprocess](./02-business-layer-report.md#businessprocess) | [Business](./02-business-layer-report.md) | constrained-by | inbound   | many-to-one |

[Back to Index](#report-index)

### Threat {#threat}

**Spec Node ID**: `security.threat`

Represents an identified security threat with assessed likelihood and impact, targeting specific resources or controls. Linked to Countermeasures that reduce exposure. Supports NIST SP 800-53 RA-3 risk assessment and enables residual risk tracking.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 8 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                              | Predicate       | Direction | Cardinality  |
| ----------------------------------------- | --------------- | --------- | ------------ |
| [actor](#actor)                           | associated-with | inbound   | many-to-one  |
| [auditconfig](#auditconfig)               | mitigates       | inbound   | many-to-one  |
| [countermeasure](#countermeasure)         | mitigates       | inbound   | many-to-one  |
| [evidence](#evidence)                     | mitigates       | inbound   | many-to-one  |
| [passwordpolicy](#passwordpolicy)         | mitigates       | inbound   | many-to-one  |
| [policyaction](#policyaction)             | mitigates       | inbound   | many-to-one  |
| [securitymodel](#securitymodel)           | aggregates      | inbound   | many-to-one  |
| [separationofduty](#separationofduty)     | mitigates       | inbound   | many-to-one  |
| [secureresource](#secureresource)         | accesses        | outbound  | many-to-one  |
| [countermeasure](#countermeasure)         | aggregates      | outbound  | many-to-many |
| [accesscondition](#accesscondition)       | constrains      | outbound  | many-to-one  |
| [dataclassification](#dataclassification) | influence       | outbound  | many-to-one  |
| [securitypolicy](#securitypolicy)         | influence       | outbound  | many-to-one  |
| [auditconfig](#auditconfig)               | triggers        | outbound  | many-to-one  |

[Back to Index](#report-index)

### Validationrule {#validationrule}

**Spec Node ID**: `security.validationrule`

Specifies data validation constraints for FieldAccessControl, defining allowed patterns, value ranges, or transformations applied when accessing protected fields. Prevents data corruption and enforces field-level integrity.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate            | Direction | Cardinality |
| ------------------------------------------- | -------------------- | --------- | ----------- |
| [accesscondition](#accesscondition)         | uses                 | inbound   | many-to-one |
| [passwordpolicy](#passwordpolicy)           | uses                 | inbound   | many-to-one |
| [accesscondition](#accesscondition)         | constrains           | outbound  | many-to-one |
| [fieldaccesscontrol](#fieldaccesscontrol)   | constrains           | outbound  | many-to-one |
| [fieldaccesscontrol](#fieldaccesscontrol)   | enforces-requirement | outbound  | many-to-one |
| [securityconstraints](#securityconstraints) | enforces-requirement | outbound  | many-to-one |
| [policyrule](#policyrule)                   | realizes             | outbound  | many-to-one |
| [securitypolicy](#securitypolicy)           | supports             | outbound  | many-to-one |

[Back to Index](#report-index)

---

_Generated: 2026-02-28T15:47:18.822Z | Spec Version: 0.8.1 | Generator: generate-layer-reports.ts_
