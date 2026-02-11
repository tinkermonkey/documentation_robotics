# Security Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Accesscondition](#accesscondition)
  - [Accesscontrollevel](#accesscontrollevel)
  - [Accountabilityrequirement](#accountabilityrequirement)
  - [Actiontype](#actiontype)
  - [Actor](#actor)
  - [Actordependency](#actordependency)
  - [Actorobjective](#actorobjective)
  - [Actortype](#actortype)
  - [Auditconfig](#auditconfig)
  - [Auditlevel](#auditlevel)
  - [Authenticationconfig](#authenticationconfig)
  - [Authprovider](#authprovider)
  - [Bindingofduty](#bindingofduty)
  - [Classification](#classification)
  - [Classificationlevel](#classificationlevel)
  - [Condition](#condition)
  - [Conditionoperator](#conditionoperator)
  - [Countermeasure](#countermeasure)
  - [Criticality](#criticality)
  - [Dataclassification](#dataclassification)
  - [Datasource](#datasource)
  - [Delegation](#delegation)
  - [Delegationtype](#delegationtype)
  - [Deletionmethod](#deletionmethod)
  - [Destinationtype](#destinationtype)
  - [Effectiveness](#effectiveness)
  - [Encryptionrequirement](#encryptionrequirement)
  - [Evaluationtype](#evaluationtype)
  - [Evidence](#evidence)
  - [Evidencestrength](#evidencestrength)
  - [Evidencetype](#evidencetype)
  - [Fieldaccesscontrol](#fieldaccesscontrol)
  - [Impact](#impact)
  - [Informationentity](#informationentity)
  - [Informationright](#informationright)
  - [Likelihood](#likelihood)
  - [Maskingstrategy](#maskingstrategy)
  - [Needtoknow](#needtoknow)
  - [Passwordpolicy](#passwordpolicy)
  - [Permission](#permission)
  - [Permissionscope](#permissionscope)
  - [Policyaction](#policyaction)
  - [Policyeffect](#policyeffect)
  - [Policyrule](#policyrule)
  - [Policytarget](#policytarget)
  - [Ratelimit](#ratelimit)
  - [Ratelimitaction](#ratelimitaction)
  - [Ratelimitscope](#ratelimitscope)
  - [Requirementlevel](#requirementlevel)
  - [Resourceoperation](#resourceoperation)
  - [Resourcetype](#resourcetype)
  - [Retentionpolicy](#retentionpolicy)
  - [Role](#role)
  - [Secureresource](#secureresource)
  - [Securityconstraints](#securityconstraints)
  - [Securitymodel](#securitymodel)
  - [Securitypolicy](#securitypolicy)
  - [Separationofduty](#separationofduty)
  - [Socialdependency](#socialdependency)
  - [Storageclass](#storageclass)
  - [Threat](#threat)
  - [Trustlevel](#trustlevel)
  - [Validationrule](#validationrule)
  - [Validationruletype](#validationruletype)
  - [Validationseverity](#validationseverity)
  - [Verificationlevel](#verificationlevel)

## Layer Introduction

**Layer 3**: Security
**Standard**: [NIST SP 800-53](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf)

Layer 3: Security Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 66    |
| Intra-Layer Relationships | 0     |
| Inter-Layer Relationships | 13    |
| Inbound Relationships     | 13    |
| Outbound Relationships    | 0     |

### Layer Dependencies

**Depends On**: [Business](./02-business-layer-report.md), [Technology](./05-technology-layer-report.md), [Api](./06-api-layer-report.md)
**Depended On By**: None

## Intra-Layer Relationships

No intra-layer relationships defined.

## Inter-Layer Dependencies

```mermaid
flowchart TB
  classDef current fill:#f9f,stroke:#333,stroke-width:2px
  motivation["Motivation"]
  business["Business"]
  security["Security"]
  application["Application"]
  technology["Technology"]
  api["Api"]
  data_model["Data Model"]
  data_store["Data Store"]
  ux["Ux"]
  navigation["Navigation"]
  apm["Apm"]
  testing["Testing"]
  testing --> motivation
  technology --> security
  data_model --> application
  data_model --> business
  business --> data_model
  business --> application
  business --> security
  business --> motivation
  application --> motivation
  application --> apm
  api --> apm
  api --> application
  api --> business
  api --> security
  api --> data_store
  class security current
```

## Inter-Layer Relationships Table

| Relationship ID                                                         | Source Node                                                      | Dest Node                                                                | Dest Layer                                | Predicate            | Cardinality  | Strength |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------- | -------------------- | ------------ | -------- |
| technology.artifact.classification.security.classification              | [artifact](./05-technology-layer-report.md#artifact)             | [classification](./03-security-layer-report.md#classification)           | [Security](./03-security-layer-report.md) | classification       | many-to-one  | low      |
| technology.artifact.referenced-by.security.classification               | [artifact](./05-technology-layer-report.md#artifact)             | [classification](./03-security-layer-report.md#classification)           | [Security](./03-security-layer-report.md) | referenced-by        | many-to-one  | medium   |
| business.businessprocess.referenced-by.security.separationofduty        | [businessprocess](./02-business-layer-report.md#businessprocess) | [separationofduty](./03-security-layer-report.md#separationofduty)       | [Security](./03-security-layer-report.md) | referenced-by        | many-to-one  | medium   |
| api.operation.referenced-by.security.permission                         | [operation](./06-api-layer-report.md#operation)                  | [permission](./03-security-layer-report.md#permission)                   | [Security](./03-security-layer-report.md) | referenced-by        | many-to-many | medium   |
| api.operation.referenced-by.security.secureresource                     | [operation](./06-api-layer-report.md#operation)                  | [secureresource](./03-security-layer-report.md#secureresource)           | [Security](./03-security-layer-report.md) | referenced-by        | many-to-one  | medium   |
| api.securityscheme.referenced-by.security.permission                    | [securityscheme](./06-api-layer-report.md#securityscheme)        | [permission](./03-security-layer-report.md#permission)                   | [Security](./03-security-layer-report.md) | referenced-by        | many-to-many | medium   |
| api.securityscheme.referenced-by.security.secureresource                | [securityscheme](./06-api-layer-report.md#securityscheme)        | [secureresource](./03-security-layer-report.md#secureresource)           | [Security](./03-security-layer-report.md) | referenced-by        | many-to-one  | medium   |
| api.operation.required-permissions.security.permission                  | [operation](./06-api-layer-report.md#operation)                  | [permission](./03-security-layer-report.md#permission)                   | [Security](./03-security-layer-report.md) | required-permissions | many-to-many | critical |
| api.securityscheme.required-permissions.security.permission             | [securityscheme](./06-api-layer-report.md#securityscheme)        | [permission](./03-security-layer-report.md#permission)                   | [Security](./03-security-layer-report.md) | required-permissions | many-to-many | critical |
| business.businessprocess.security-controls.security.securityconstraints | [businessprocess](./02-business-layer-report.md#businessprocess) | [securityconstraints](./03-security-layer-report.md#securityconstraints) | [Security](./03-security-layer-report.md) | security-controls    | many-to-many | high     |
| api.operation.security-resource.security.secureresource                 | [operation](./06-api-layer-report.md#operation)                  | [secureresource](./03-security-layer-report.md#secureresource)           | [Security](./03-security-layer-report.md) | security-resource    | many-to-one  | critical |
| api.securityscheme.security-resource.security.secureresource            | [securityscheme](./06-api-layer-report.md#securityscheme)        | [secureresource](./03-security-layer-report.md#secureresource)           | [Security](./03-security-layer-report.md) | security-resource    | many-to-one  | critical |
| business.businessprocess.separation-of-duty.security.separationofduty   | [businessprocess](./02-business-layer-report.md#businessprocess) | [separationofduty](./03-security-layer-report.md#separationofduty)       | [Security](./03-security-layer-report.md) | separation-of-duty   | many-to-one  | medium   |

## Node Reference

### Accesscondition

**Spec Node ID**: `security.accesscondition`

Conditional access rule

[Back to Index](#report-index)

### Accesscontrollevel

**Spec Node ID**: `security.accesscontrollevel`

AccessControlLevel element in Security Layer

[Back to Index](#report-index)

### Accountabilityrequirement

**Spec Node ID**: `security.accountabilityrequirement`

Accountability and non-repudiation requirements

[Back to Index](#report-index)

### Actiontype

**Spec Node ID**: `security.actiontype`

ActionType element in Security Layer

[Back to Index](#report-index)

### Actor

**Spec Node ID**: `security.actor`

Actor in the system (beyond roles)

[Back to Index](#report-index)

### Actordependency

**Spec Node ID**: `security.actordependency`

Dependency between actors

[Back to Index](#report-index)

### Actorobjective

**Spec Node ID**: `security.actorobjective`

Security-related objective or goal of an actor

[Back to Index](#report-index)

### Actortype

**Spec Node ID**: `security.actortype`

ActorType element in Security Layer

[Back to Index](#report-index)

### Auditconfig

**Spec Node ID**: `security.auditconfig`

Configuration for security audit logging, specifying what events to capture, retention periods, storage destinations, and compliance requirements. Enables security monitoring and forensic analysis.

[Back to Index](#report-index)

### Auditlevel

**Spec Node ID**: `security.auditlevel`

AuditLevel element in Security Layer

[Back to Index](#report-index)

### Authenticationconfig

**Spec Node ID**: `security.authenticationconfig`

Authentication configuration

[Back to Index](#report-index)

### Authprovider

**Spec Node ID**: `security.authprovider`

AuthProvider element in Security Layer

[Back to Index](#report-index)

### Bindingofduty

**Spec Node ID**: `security.bindingofduty`

Same actor must complete related tasks

[Back to Index](#report-index)

### Classification

**Spec Node ID**: `security.classification`

A single classification level defining data sensitivity and protection requirements

#### Inter-Layer Relationships

| Related Node                                         | Layer                                         | Predicate      | Direction | Cardinality |
| ---------------------------------------------------- | --------------------------------------------- | -------------- | --------- | ----------- |
| [artifact](./05-technology-layer-report.md#artifact) | [Technology](./05-technology-layer-report.md) | classification | inbound   | many-to-one |
| [artifact](./05-technology-layer-report.md#artifact) | [Technology](./05-technology-layer-report.md) | referenced-by  | inbound   | many-to-one |

[Back to Index](#report-index)

### Classificationlevel

**Spec Node ID**: `security.classificationlevel`

ClassificationLevel element in Security Layer

[Back to Index](#report-index)

### Condition

**Spec Node ID**: `security.condition`

A logical expression or predicate that determines when a SecurityPolicy rule applies. Supports attribute-based access control by evaluating context such as time, location, user attributes, or resource state.

[Back to Index](#report-index)

### Conditionoperator

**Spec Node ID**: `security.conditionoperator`

ConditionOperator element in Security Layer

[Back to Index](#report-index)

### Countermeasure

**Spec Node ID**: `security.countermeasure`

Security countermeasure for a threat

[Back to Index](#report-index)

### Criticality

**Spec Node ID**: `security.criticality`

Criticality element in Security Layer

[Back to Index](#report-index)

### Dataclassification

**Spec Node ID**: `security.dataclassification`

Data classification and protection policies

[Back to Index](#report-index)

### Datasource

**Spec Node ID**: `security.datasource`

DataSource element in Security Layer

[Back to Index](#report-index)

### Delegation

**Spec Node ID**: `security.delegation`

Explicit delegation of permissions or goals

[Back to Index](#report-index)

### Delegationtype

**Spec Node ID**: `security.delegationtype`

DelegationType element in Security Layer

[Back to Index](#report-index)

### Deletionmethod

**Spec Node ID**: `security.deletionmethod`

DeletionMethod element in Security Layer

[Back to Index](#report-index)

### Destinationtype

**Spec Node ID**: `security.destinationtype`

DestinationType element in Security Layer

[Back to Index](#report-index)

### Effectiveness

**Spec Node ID**: `security.effectiveness`

Effectiveness element in Security Layer

[Back to Index](#report-index)

### Encryptionrequirement

**Spec Node ID**: `security.encryptionrequirement`

EncryptionRequirement element in Security Layer

[Back to Index](#report-index)

### Evaluationtype

**Spec Node ID**: `security.evaluationtype`

EvaluationType element in Security Layer

[Back to Index](#report-index)

### Evidence

**Spec Node ID**: `security.evidence`

Evidence required for accountability

[Back to Index](#report-index)

### Evidencestrength

**Spec Node ID**: `security.evidencestrength`

EvidenceStrength element in Security Layer

[Back to Index](#report-index)

### Evidencetype

**Spec Node ID**: `security.evidencetype`

EvidenceType element in Security Layer

[Back to Index](#report-index)

### Fieldaccesscontrol

**Spec Node ID**: `security.fieldaccesscontrol`

Field-level access control

[Back to Index](#report-index)

### Impact

**Spec Node ID**: `security.impact`

Impact element in Security Layer

[Back to Index](#report-index)

### Informationentity

**Spec Node ID**: `security.informationentity`

Information asset with fine-grained rights

[Back to Index](#report-index)

### Informationright

**Spec Node ID**: `security.informationright`

Fine-grained information access rights

[Back to Index](#report-index)

### Likelihood

**Spec Node ID**: `security.likelihood`

Likelihood element in Security Layer

[Back to Index](#report-index)

### Maskingstrategy

**Spec Node ID**: `security.maskingstrategy`

MaskingStrategy element in Security Layer

[Back to Index](#report-index)

### Needtoknow

**Spec Node ID**: `security.needtoknow`

Information access based on objective/purpose requirements

[Back to Index](#report-index)

### Passwordpolicy

**Spec Node ID**: `security.passwordpolicy`

Password requirements

[Back to Index](#report-index)

### Permission

**Spec Node ID**: `security.permission`

Permission definition

#### Inter-Layer Relationships

| Related Node                                              | Layer                           | Predicate            | Direction | Cardinality  |
| --------------------------------------------------------- | ------------------------------- | -------------------- | --------- | ------------ |
| [operation](./06-api-layer-report.md#operation)           | [Api](./06-api-layer-report.md) | referenced-by        | inbound   | many-to-many |
| [operation](./06-api-layer-report.md#operation)           | [Api](./06-api-layer-report.md) | required-permissions | inbound   | many-to-many |
| [securityscheme](./06-api-layer-report.md#securityscheme) | [Api](./06-api-layer-report.md) | referenced-by        | inbound   | many-to-many |
| [securityscheme](./06-api-layer-report.md#securityscheme) | [Api](./06-api-layer-report.md) | required-permissions | inbound   | many-to-many |

[Back to Index](#report-index)

### Permissionscope

**Spec Node ID**: `security.permissionscope`

PermissionScope element in Security Layer

[Back to Index](#report-index)

### Policyaction

**Spec Node ID**: `security.policyaction`

Action to take when policy rule matches

[Back to Index](#report-index)

### Policyeffect

**Spec Node ID**: `security.policyeffect`

PolicyEffect element in Security Layer

[Back to Index](#report-index)

### Policyrule

**Spec Node ID**: `security.policyrule`

Individual policy rule

[Back to Index](#report-index)

### Policytarget

**Spec Node ID**: `security.policytarget`

PolicyTarget element in Security Layer

[Back to Index](#report-index)

### Ratelimit

**Spec Node ID**: `security.ratelimit`

Defines throttling constraints for API or service access, specifying maximum request counts, time windows, and actions to take when limits are exceeded. Protects resources from abuse and ensures fair usage across consumers.

[Back to Index](#report-index)

### Ratelimitaction

**Spec Node ID**: `security.ratelimitaction`

RateLimitAction element in Security Layer

[Back to Index](#report-index)

### Ratelimitscope

**Spec Node ID**: `security.ratelimitscope`

RateLimitScope element in Security Layer

[Back to Index](#report-index)

### Requirementlevel

**Spec Node ID**: `security.requirementlevel`

RequirementLevel element in Security Layer

[Back to Index](#report-index)

### Resourceoperation

**Spec Node ID**: `security.resourceoperation`

Operation on a resource

[Back to Index](#report-index)

### Resourcetype

**Spec Node ID**: `security.resourcetype`

ResourceType element in Security Layer

[Back to Index](#report-index)

### Retentionpolicy

**Spec Node ID**: `security.retentionpolicy`

Defines how long security-related data (audit logs, access records, encryption keys) must be retained, archival strategies, and secure deletion procedures. Ensures compliance with regulatory requirements.

[Back to Index](#report-index)

### Role

**Spec Node ID**: `security.role`

User role definition

[Back to Index](#report-index)

### Secureresource

**Spec Node ID**: `security.secureresource`

Protected resource definition

#### Inter-Layer Relationships

| Related Node                                              | Layer                           | Predicate         | Direction | Cardinality |
| --------------------------------------------------------- | ------------------------------- | ----------------- | --------- | ----------- |
| [operation](./06-api-layer-report.md#operation)           | [Api](./06-api-layer-report.md) | referenced-by     | inbound   | many-to-one |
| [operation](./06-api-layer-report.md#operation)           | [Api](./06-api-layer-report.md) | security-resource | inbound   | many-to-one |
| [securityscheme](./06-api-layer-report.md#securityscheme) | [Api](./06-api-layer-report.md) | referenced-by     | inbound   | many-to-one |
| [securityscheme](./06-api-layer-report.md#securityscheme) | [Api](./06-api-layer-report.md) | security-resource | inbound   | many-to-one |

[Back to Index](#report-index)

### Securityconstraints

**Spec Node ID**: `security.securityconstraints`

Security patterns and constraints

#### Inter-Layer Relationships

| Related Node                                                     | Layer                                     | Predicate         | Direction | Cardinality  |
| ---------------------------------------------------------------- | ----------------------------------------- | ----------------- | --------- | ------------ |
| [businessprocess](./02-business-layer-report.md#businessprocess) | [Business](./02-business-layer-report.md) | security-controls | inbound   | many-to-many |

[Back to Index](#report-index)

### Securitymodel

**Spec Node ID**: `security.securitymodel`

Complete security model for application

[Back to Index](#report-index)

### Securitypolicy

**Spec Node ID**: `security.securitypolicy`

Declarative security policy

[Back to Index](#report-index)

### Separationofduty

**Spec Node ID**: `security.separationofduty`

Different actors must perform related tasks

#### Inter-Layer Relationships

| Related Node                                                     | Layer                                     | Predicate          | Direction | Cardinality |
| ---------------------------------------------------------------- | ----------------------------------------- | ------------------ | --------- | ----------- |
| [businessprocess](./02-business-layer-report.md#businessprocess) | [Business](./02-business-layer-report.md) | referenced-by      | inbound   | many-to-one |
| [businessprocess](./02-business-layer-report.md#businessprocess) | [Business](./02-business-layer-report.md) | separation-of-duty | inbound   | many-to-one |

[Back to Index](#report-index)

### Socialdependency

**Spec Node ID**: `security.socialdependency`

Dependencies and trust between actors

[Back to Index](#report-index)

### Storageclass

**Spec Node ID**: `security.storageclass`

StorageClass element in Security Layer

[Back to Index](#report-index)

### Threat

**Spec Node ID**: `security.threat`

Security threat and countermeasures

[Back to Index](#report-index)

### Trustlevel

**Spec Node ID**: `security.trustlevel`

TrustLevel element in Security Layer

[Back to Index](#report-index)

### Validationrule

**Spec Node ID**: `security.validationrule`

Specifies data validation constraints for FieldAccessControl, defining allowed patterns, value ranges, or transformations applied when accessing protected fields. Prevents data corruption and enforces field-level integrity.

[Back to Index](#report-index)

### Validationruletype

**Spec Node ID**: `security.validationruletype`

ValidationRuleType element in Security Layer

[Back to Index](#report-index)

### Validationseverity

**Spec Node ID**: `security.validationseverity`

ValidationSeverity element in Security Layer

[Back to Index](#report-index)

### Verificationlevel

**Spec Node ID**: `security.verificationlevel`

VerificationLevel element in Security Layer

[Back to Index](#report-index)

---

_Generated: 2026-02-11T21:39:52.912Z | Generator: generate-layer-reports.ts_
