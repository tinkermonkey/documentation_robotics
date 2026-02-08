# Layer 12: Testing Layer

Layer 12: Testing Layer

**Standard**: [IEEE 829-2008 2008](https://en.wikipedia.org/wiki/IEEE_829)

---

## Overview

Layer 12: Testing Layer

This layer defines **29** node types that represent various aspects of the architecture.

## Node Types

### SketchStatus

**ID**: `testing.sketchstatus`

SketchStatus element in Testing Layer


### TestCoverageModel

**ID**: `testing.testcoveragemodel`

Complete test coverage model for application

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `version`: string (required)
- `application`: string (required)
- `description`: string
- `coverageTargets`: array
  - Contains relationship
- `inputSpacePartitions`: array
  - Contains relationship
- `contextVariations`: array
  - Contains relationship
- `coverageRequirements`: array
  - Contains relationship
- `testCaseSketches`: array
  - Contains relationship
- `source`: object
  - Source code reference

### TargetCoverageSummary

**ID**: `testing.targetcoveragesummary`

Coverage metrics summary for a single test coverage target

**Attributes**:

- `targetRef`: string (required)
- `sketchCount`: integer (required)
- `implementedCount`: integer (required)
- `automatedCount`: integer (required)
- `coveragePercentage`: number

### CoverageGap

**ID**: `testing.coveragegap`

Identified gap in test coverage requiring attention

**Attributes**:

- `description`: string (required)
- `severity`: string (required)
- `affectedRequirements`: string (required)

### PresenceRule

**ID**: `testing.presencerule`

PresenceRule element in Testing Layer


### CoverageExclusion

**ID**: `testing.coverageexclusion`

Explicit exclusion from coverage with justification

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string (required)
- `reason`: string (required)
- `riskAccepted`: boolean (required)
- `approvedBy`: string (required)

### DependencyEffect

**ID**: `testing.dependencyeffect`

DependencyEffect element in Testing Layer


### FieldRelevance

**ID**: `testing.fieldrelevance`

FieldRelevance element in Testing Layer


### CoverageCriteria

**ID**: `testing.coveragecriteria`

CoverageCriteria element in Testing Layer


### ImplementationFormat

**ID**: `testing.implementationformat`

ImplementationFormat element in Testing Layer


### InputSpacePartition

**ID**: `testing.inputspacepartition`

Partitioning of an input dimension into testable categories

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `fieldRef`: string (required)
- `presenceRule`: string (required)
- `partitions`: array
  - Contains relationship
- `dependencies`: array
  - Contains relationship

### GapSeverity

**ID**: `testing.gapseverity`

GapSeverity element in Testing Layer


### OutcomeCategory

**ID**: `testing.outcomecategory`

Category of expected outcomes (not specific assertions)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `outcomeType`: string (required)
- `httpStatusRange`: string (required)

### InputSelection

**ID**: `testing.inputselection`

Specific partition value selected for a test case

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `partitionRef`: string (required)
- `selectedValue`: string (required)
- `concreteValue`: string (required)
- `valueSource`: string (required)

### PartitionDependency

**ID**: `testing.partitiondependency`

Constraint between partition values across fields

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `dependsOnPartition`: string (required)
- `dependsOnValue`: string (required)
- `effect`: string (required)
- `affectedValues`: string (required)
- `description`: string

### PartitionCategory

**ID**: `testing.partitioncategory`

PartitionCategory element in Testing Layer


### TestCoverageTarget

**ID**: `testing.testcoveragetarget`

An artifact or functionality that requires test coverage

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `targetType`: string (required)
- `priority`: string
- `applicableContexts`: array
  - Contains relationship
- `inputFields`: array
  - Contains relationship
- `outcomeCategories`: array
  - Contains relationship
- `source`: object
  - Source code reference for the artifact requiring test coverage

### ContextVariation

**ID**: `testing.contextvariation`

Different context in which functionality can be invoked

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `contextType`: string (required)
- `environmentFactors`: array
  - Contains relationship

### TargetInputField

**ID**: `testing.targetinputfield`

Input field associated with a coverage target

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `fieldRef`: string (required)
- `partitionRef`: string (required)
- `description`: string
- `relevance`: string

### InputPartitionSelection

**ID**: `testing.inputpartitionselection`

Selection of partition values to include in coverage

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `partitionRef`: string (required)
- `coverValues`: string (required)
- `coverAllCategories`: boolean (required)
- `excludeValues`: string (required)

### Priority

**ID**: `testing.priority`

Priority element in Testing Layer


### CoverageRequirement

**ID**: `testing.coveragerequirement`

Requirement for test coverage of a target

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `coverageCriteria`: string (required)
- `priority`: string
- `inputPartitionSelections`: array
  - Contains relationship
- `contextSelections`: array
  - Contains relationship
- `outcomeSelections`: array
  - Contains relationship
- `exclusions`: array
  - Contains relationship

### TargetType

**ID**: `testing.targettype`

TargetType element in Testing Layer


### CoverageSummary

**ID**: `testing.coveragesummary`

Summary of coverage status (can be computed or declared)

**Attributes**:

- `generatedAt`: string
- `totalTargets`: integer (required)
- `totalRequirements`: integer (required)
- `totalSketches`: integer (required)
- `targetSummaries`: array
  - Contains relationship
- `gaps`: array
  - Contains relationship

### OutcomeType

**ID**: `testing.outcometype`

OutcomeType element in Testing Layer


### PartitionValue

**ID**: `testing.partitionvalue`

A specific partition within the input space

**Attributes**:

- `name`: string (required)
- `id`: string (uuid) (required)
- `label`: string (required)
- `description`: string
- `constraint`: string (required)
- `constraintExpression`: string (required)
- `category`: string (required)
- `representativeValue`: string (required)

### EnvironmentFactor

**ID**: `testing.environmentfactor`

Environmental condition that may affect behavior

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `factor`: string (required)
- `value`: string (required)
- `description`: string

### TestCaseSketch

**ID**: `testing.testcasesketch`

Abstract test case selecting specific partition values

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `status`: string (required)
- `inputSelections`: array
  - Contains relationship
- `source`: object
  - Source code reference to the test case implementation

### ContextType

**ID**: `testing.contexttype`

ContextType element in Testing Layer



## References

- [IEEE 829-2008 2008](https://en.wikipedia.org/wiki/IEEE_829)
