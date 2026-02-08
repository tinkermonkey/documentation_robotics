# Layer 1: Motivation Layer

**Standard**: [ArchiMate 3.2](https://pubs.opengroup.org/architecture/archimate32-doc/)

---

## Overview

This layer defines **19** node types that represent various aspects of the architecture.

## Node Types

### OutcomeStatus

**ID**: `motivation.outcomestatus`

OutcomeStatus element in Motivation Layer

### RequirementType

**ID**: `motivation.requirementtype`

RequirementType element in Motivation Layer

### ConstraintType

**ID**: `motivation.constrainttype`

ConstraintType element in Motivation Layer

### Goal

**ID**: `motivation.goal`

High-level statement of intent, direction, or desired end state

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `priority`: string (required)
- `properties`: object
  - Cross-layer properties

### PrincipleCategory

**ID**: `motivation.principlecategory`

PrincipleCategory element in Motivation Layer

### Requirement

**ID**: `motivation.requirement`

Statement of need that must be realized

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `requirementType`: string (required)
- `priority`: string (required)
- `properties`: object
  - Cross-layer properties

### Driver

**ID**: `motivation.driver`

External or internal condition that motivates an organization

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `category`: string (required)

### Principle

**ID**: `motivation.principle`

Normative property of all systems in a given context

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `category`: string (required)
- `properties`: object
  - Cross-layer properties

### Meaning

**ID**: `motivation.meaning`

Knowledge or expertise present in a representation

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string

### ValueType

**ID**: `motivation.valuetype`

ValueType element in Motivation Layer

### Value

**ID**: `motivation.value`

Relative worth, utility, or importance of something

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `valueType`: string (required)
- `properties`: object
  - Cross-layer properties

### StakeholderType

**ID**: `motivation.stakeholdertype`

StakeholderType element in Motivation Layer

### AssessmentType

**ID**: `motivation.assessmenttype`

AssessmentType element in Motivation Layer

### Priority

**ID**: `motivation.priority`

Priority element in Motivation Layer

### Assessment

**ID**: `motivation.assessment`

Outcome of analysis of the state of affairs

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `assessmentType`: string (required)

### Outcome

**ID**: `motivation.outcome`

End result that has been achieved

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `status`: string (required)
- `properties`: object
  - Cross-layer properties

### DriverCategory

**ID**: `motivation.drivercategory`

DriverCategory element in Motivation Layer

### Constraint

**ID**: `motivation.constraint`

Restriction on the way in which a system is realized

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `constraintType`: string (required)
- `properties`: object
  - Cross-layer properties

### Stakeholder

**ID**: `motivation.stakeholder`

Individual, team, or organization with interest in the outcome

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `type`: string (required)

## References

- [ArchiMate 3.2](https://pubs.opengroup.org/architecture/archimate32-doc/)
