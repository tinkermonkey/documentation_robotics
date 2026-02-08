# Layer 3: Security Layer

**Standard**: [NIST SP 800-53](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf)

---

## Overview

This layer defines **66** node types that represent various aspects of the architecture.

## Node Types

### ClassificationLevel

**ID**: `security.classificationlevel`

ClassificationLevel element in Security Layer


### Likelihood

**ID**: `security.likelihood`

Likelihood element in Security Layer


### MaskingStrategy

**ID**: `security.maskingstrategy`

MaskingStrategy element in Security Layer


### Impact

**ID**: `security.impact`

Impact element in Security Layer


### PolicyTarget

**ID**: `security.policytarget`

PolicyTarget element in Security Layer


### Classification

**ID**: `security.classification`

A single classification level defining data sensitivity and protection requirements

**Attributes**:

- `level`: string (required)
- `label`: string (required)
- `description`: string (required)

### PolicyRule

**ID**: `security.policyrule`

Individual policy rule

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `condition`: string (required)
- `effect`: string (required)
- `message`: string
- `actions`: array
  - Contains relationship
- `source`: object
  - Source code reference

### ActorDependency

**ID**: `security.actordependency`

Dependency between actors

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `dependee`: string (required)
- `resource`: string (required)
- `objective`: string (required)
- `criticality`: string (required)

### ValidationRuleType

**ID**: `security.validationruletype`

ValidationRuleType element in Security Layer


### AccessControlLevel

**ID**: `security.accesscontrollevel`

AccessControlLevel element in Security Layer


### RateLimit

**ID**: `security.ratelimit`

Defines throttling constraints for API or service access, specifying maximum request counts, time windows, and actions to take when limits are exceeded. Protects resources from abuse and ensures fair usage across consumers.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `requests`: integer (required)
- `window`: string (required)
- `scope`: string
- `keyBy`: string (required)
- `source`: object
  - Source code reference

### DeletionMethod

**ID**: `security.deletionmethod`

DeletionMethod element in Security Layer


### AuditLevel

**ID**: `security.auditlevel`

AuditLevel element in Security Layer


### RateLimitAction

**ID**: `security.ratelimitaction`

RateLimitAction element in Security Layer


### DelegationType

**ID**: `security.delegationtype`

DelegationType element in Security Layer


### StorageClass

**ID**: `security.storageclass`

StorageClass element in Security Layer


### PolicyEffect

**ID**: `security.policyeffect`

PolicyEffect element in Security Layer


### AuthenticationConfig

**ID**: `security.authenticationconfig`

Authentication configuration

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `provider`: string (required)
- `sessionTimeout`: integer (required)
- `mfaRequired`: boolean
- `passwordPolicy`: string
- `source`: object
  - Source code reference

### TrustLevel

**ID**: `security.trustlevel`

TrustLevel element in Security Layer


### AccessCondition

**ID**: `security.accesscondition`

Conditional access rule

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `field`: string (required)
- `operator`: string (required)
- `value`: string (required)
- `message`: string (required)
- `source`: string (required)

### AuthProvider

**ID**: `security.authprovider`

AuthProvider element in Security Layer


### AccountabilityRequirement

**ID**: `security.accountabilityrequirement`

Accountability and non-repudiation requirements

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `action`: string (required)
- `resource`: string (required)
- `nonRepudiation`: boolean (required)
- `purposeDeclaration`: string (required)
- `challengeable`: boolean (required)

### NeedToKnow

**ID**: `security.needtoknow`

Information access based on objective/purpose requirements

**Attributes**:

- `name`: string (required)
- `resource`: string (required)
- `objective`: string (required)
- `message`: string (required)
- `justificationRequired`: boolean (required)

### SecurityPolicy

**ID**: `security.securitypolicy`

Declarative security policy

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `enabled`: boolean
- `priority`: integer (required)
- `target`: string (required)
- `rules`: array
  - Contains relationship
- `source`: object
  - Source code reference

### ActorObjective

**ID**: `security.actorobjective`

Security-related objective or goal of an actor

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string (required)
- `criticality`: string

### AuditConfig

**ID**: `security.auditconfig`

Configuration for security audit logging, specifying what events to capture, retention periods, storage destinations, and compliance requirements. Enables security monitoring and forensic analysis.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `enabled`: boolean
- `level`: string (required)
- `includePayload`: boolean
- `includeHeaders`: boolean
- `sanitizeFields`: string (required)
- `source`: object
  - Source code reference

### SecureResource

**ID**: `security.secureresource`

Protected resource definition

**Attributes**:

- `resource`: string (required)
- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `description`: string
- `operations`: array
  - Contains relationship
- `fieldAccess`: array
  - Contains relationship

### DataSource

**ID**: `security.datasource`

DataSource element in Security Layer


### Countermeasure

**ID**: `security.countermeasure`

Security countermeasure for a threat

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `description`: string (required)
- `effectiveness`: string
- `implemented`: boolean
- `source`: object
  - Source code reference

### ResourceOperation

**ID**: `security.resourceoperation`

Operation on a resource

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `operation`: string (required)
- `description`: string
- `conditions`: array
  - Contains relationship
- `rateLimit`: array
  - Contains relationship
- `audit`: array
  - Contains relationship

### Effectiveness

**ID**: `security.effectiveness`

Effectiveness element in Security Layer


### PasswordPolicy

**ID**: `security.passwordpolicy`

Password requirements

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `minLength`: integer
- `maxLength`: integer
- `requireUppercase`: boolean
- `requireLowercase`: boolean
- `requireNumbers`: boolean
- `requireSpecialChars`: boolean
- `preventReuse`: integer
- `expiryDays`: integer (required)
- `lockoutAttempts`: integer
- `lockoutDuration`: integer

### Actor

**ID**: `security.actor`

Actor in the system (beyond roles)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `description`: string
- `trustLevel`: string
- `objectives`: array
  - Contains relationship
- `dependencies`: array
  - Contains relationship

### RateLimitScope

**ID**: `security.ratelimitscope`

RateLimitScope element in Security Layer


### SeparationOfDuty

**ID**: `security.separationofduty`

Different actors must perform related tasks

**Attributes**:

- `name`: string (required)
- `description`: string
- `message`: string (required)
- `tasks`: array
  - Contains relationship
- `roles`: array
  - Contains relationship
- `mutuallyExclusive`: array
  - Contains relationship

### SocialDependency

**ID**: `security.socialdependency`

Dependencies and trust between actors

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `depender`: string (required)
- `dependee`: string (required)
- `resource`: string (required)
- `objective`: string (required)
- `criticality`: string (required)

### EvaluationType

**ID**: `security.evaluationtype`

EvaluationType element in Security Layer


### Role

**ID**: `security.role`

User role definition

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `displayName`: string (required)
- `description`: string
- `level`: integer (required)
- `inheritsFrom`: string (required)
- `permissions`: array
  - Contains relationship

### EncryptionRequirement

**ID**: `security.encryptionrequirement`

EncryptionRequirement element in Security Layer


### RetentionPolicy

**ID**: `security.retentionpolicy`

Defines how long security-related data (audit logs, access records, encryption keys) must be retained, archival strategies, and secure deletion procedures. Ensures compliance with regulatory requirements.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `period`: string (required)
- `description`: string

### ActorType

**ID**: `security.actortype`

ActorType element in Security Layer


### EvidenceType

**ID**: `security.evidencetype`

EvidenceType element in Security Layer


### ValidationSeverity

**ID**: `security.validationseverity`

ValidationSeverity element in Security Layer


### ConditionOperator

**ID**: `security.conditionoperator`

ConditionOperator element in Security Layer


### Threat

**ID**: `security.threat`

Security threat and countermeasures

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string (required)
- `threatens`: string (required)
- `likelihood`: string (required)
- `impact`: string (required)
- `countermeasures`: array
  - Contains relationship
- `source`: object
  - Source code reference

### BindingOfDuty

**ID**: `security.bindingofduty`

Same actor must complete related tasks

**Attributes**:

- `name`: string (required)
- `description`: string
- `message`: string (required)
- `tasks`: array
  - Contains relationship
- `scope`: array
  - Contains relationship

### VerificationLevel

**ID**: `security.verificationlevel`

VerificationLevel element in Security Layer


### DataClassification

**ID**: `security.dataclassification`

Data classification and protection policies

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `version`: string
- `classifications`: array
  - Contains relationship

### InformationEntity

**ID**: `security.informationentity`

Information asset with fine-grained rights

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `classification`: string (required)
- `authorizationRequirements`: array
  - Contains relationship

### PermissionScope

**ID**: `security.permissionscope`

PermissionScope element in Security Layer


### ValidationRule

**ID**: `security.validationrule`

Specifies data validation constraints for FieldAccessControl, defining allowed patterns, value ranges, or transformations applied when accessing protected fields. Prevents data corruption and enforces field-level integrity.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `value`: string (required)
- `message`: string (required)
- `severity`: string
- `source`: object
  - Source code reference

### PolicyAction

**ID**: `security.policyaction`

Action to take when policy rule matches

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `parameters`: object (required)
- `source`: object
  - Source code reference

### DestinationType

**ID**: `security.destinationtype`

DestinationType element in Security Layer


### SecurityModel

**ID**: `security.securitymodel`

Complete security model for application

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `version`: string (required)
- `application`: string (required)
- `authentication`: array
  - Contains relationship
- `actors`: array
  - Contains relationship
- `roles`: array
  - Contains relationship
- `permissions`: array
  - Contains relationship
- `resources`: array
  - Contains relationship
- `informationEntities`: array
  - Contains relationship
- `delegations`: array
  - Contains relationship
- `securityConstraints`: array
  - Contains relationship
- `policies`: array
  - Contains relationship
- `dataClassification`: array
  - Contains relationship
- `socialDependencies`: array
  - Contains relationship
- `accountability`: array
  - Contains relationship
- `threats`: array
  - Contains relationship

### RequirementLevel

**ID**: `security.requirementlevel`

RequirementLevel element in Security Layer


### SecurityConstraints

**ID**: `security.securityconstraints`

Security patterns and constraints

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `version`: string
- `separationOfDuty`: array
  - Contains relationship
- `bindingOfDuty`: array
  - Contains relationship
- `needToKnow`: array
  - Contains relationship

### Permission

**ID**: `security.permission`

Permission definition

**Attributes**:

- `name`: string (required)
- `id`: string (uuid) (required)
- `description`: string
- `scope`: string (required)
- `resource`: string (required)
- `action`: string (required)

### InformationRight

**ID**: `security.informationright`

Fine-grained information access rights

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `actor`: string (required)
- `constraint`: string (required)

### Evidence

**ID**: `security.evidence`

Evidence required for accountability

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `strength`: string
- `source`: string (required)

### Condition

**ID**: `security.condition`

A logical expression or predicate that determines when a SecurityPolicy rule applies. Supports attribute-based access control by evaluating context such as time, location, user attributes, or resource state.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `expression`: string (required)
- `description`: string
- `evaluationType`: string
- `source`: object
  - Source code reference

### ActionType

**ID**: `security.actiontype`

ActionType element in Security Layer


### ResourceType

**ID**: `security.resourcetype`

ResourceType element in Security Layer


### FieldAccessControl

**ID**: `security.fieldaccesscontrol`

Field-level access control

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `field`: string (required)
- `description`: string

### Delegation

**ID**: `security.delegation`

Explicit delegation of permissions or goals

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `delegator`: string (required)
- `delegatee`: string (required)
- `delegationType`: string (required)
- `description`: string

### EvidenceStrength

**ID**: `security.evidencestrength`

EvidenceStrength element in Security Layer


### Criticality

**ID**: `security.criticality`

Criticality element in Security Layer



## References

- [NIST SP 800-53](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf)
