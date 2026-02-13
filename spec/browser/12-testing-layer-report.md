# Testing Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Contexttype](#contexttype)
  - [Contextvariation](#contextvariation)
  - [Coveragecriteria](#coveragecriteria)
  - [Coverageexclusion](#coverageexclusion)
  - [Coveragegap](#coveragegap)
  - [Coveragerequirement](#coveragerequirement)
  - [Coveragesummary](#coveragesummary)
  - [Dependencyeffect](#dependencyeffect)
  - [Environmentfactor](#environmentfactor)
  - [Fieldrelevance](#fieldrelevance)
  - [Gapseverity](#gapseverity)
  - [Implementationformat](#implementationformat)
  - [Inputpartitionselection](#inputpartitionselection)
  - [Inputselection](#inputselection)
  - [Inputspacepartition](#inputspacepartition)
  - [Outcomecategory](#outcomecategory)
  - [Outcometype](#outcometype)
  - [Partitioncategory](#partitioncategory)
  - [Partitiondependency](#partitiondependency)
  - [Partitionvalue](#partitionvalue)
  - [Presencerule](#presencerule)
  - [Priority](#priority)
  - [Sketchstatus](#sketchstatus)
  - [Targetcoveragesummary](#targetcoveragesummary)
  - [Targetinputfield](#targetinputfield)
  - [Targettype](#targettype)
  - [Testcasesketch](#testcasesketch)
  - [Testcoveragemodel](#testcoveragemodel)
  - [Testcoveragetarget](#testcoveragetarget)

## Layer Introduction

**Layer 12**: Testing
**Standard**: [IEEE 829-2008](https://en.wikipedia.org/wiki/IEEE_829)

Layer 12: Testing Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 29    |
| Intra-Layer Relationships | 46    |
| Inter-Layer Relationships | 8     |
| Inbound Relationships     | 0     |
| Outbound Relationships    | 8     |

### Layer Dependencies

**Depends On**: None

**Depended On By**: [Motivation](./01-motivation-layer-report.md)

## Intra-Layer Relationships

```mermaid
flowchart LR
  subgraph testing
    contexttype["contexttype"]
    contextvariation["contextvariation"]
    coveragecriteria["coveragecriteria"]
    coverageexclusion["coverageexclusion"]
    coveragegap["coveragegap"]
    coveragerequirement["coveragerequirement"]
    coveragesummary["coveragesummary"]
    dependencyeffect["dependencyeffect"]
    environmentfactor["environmentfactor"]
    fieldrelevance["fieldrelevance"]
    gapseverity["gapseverity"]
    implementationformat["implementationformat"]
    inputpartitionselection["inputpartitionselection"]
    inputselection["inputselection"]
    inputspacepartition["inputspacepartition"]
    outcomecategory["outcomecategory"]
    outcometype["outcometype"]
    partitioncategory["partitioncategory"]
    partitiondependency["partitiondependency"]
    partitionvalue["partitionvalue"]
    presencerule["presencerule"]
    priority["priority"]
    sketchstatus["sketchstatus"]
    targetcoveragesummary["targetcoveragesummary"]
    targetinputfield["targetinputfield"]
    targettype["targettype"]
    testcasesketch["testcasesketch"]
    testcoveragemodel["testcoveragemodel"]
    testcoveragetarget["testcoveragetarget"]
    testcoveragetarget -->|flows-to| testcasesketch
    testcoveragetarget -->|flows-to| coveragerequirement
    testcoveragetarget -->|composes| testcoveragetarget
    testcoveragetarget -->|composes| outcomecategory
    testcoveragetarget -->|composes| inputpartitionselection
    testcoveragemodel -->|composes| testcoveragetarget
    testcoveragemodel -->|composes| outcomecategory
    testcoveragemodel -->|composes| inputpartitionselection
    testcasesketch -->|validates| testcoveragetarget
    testcasesketch -->|validates| coveragerequirement
    testcasesketch -->|references| testcoveragetarget
    testcasesketch -->|references| partitionvalue
    testcasesketch -->|references| coveragerequirement
    testcasesketch -->|depends-on| outcomecategory
    testcasesketch -->|depends-on| inputspacepartition
    testcasesketch -->|depends-on| contextvariation
    testcasesketch -->|accesses| inputselection
    testcasesketch -->|accesses| inputpartitionselection
    targetcoveragesummary -->|validates| testcoveragetarget
    targetcoveragesummary -->|validates| coveragerequirement
    partitiondependency -->|triggers| partitionvalue
    partitiondependency -->|triggers| coveragerequirement
    inputspacepartition -->|serves| testcoveragetarget
    inputselection -->|references| testcoveragetarget
    inputselection -->|references| partitionvalue
    inputselection -->|references| coveragerequirement
    inputpartitionselection -->|aggregates| partitionvalue
    inputpartitionselection -->|aggregates| contextvariation
    coveragerequirement -->|references| testcoveragetarget
    coveragerequirement -->|references| partitionvalue
    coveragerequirement -->|references| coveragerequirement
    coveragerequirement -->|flows-to| testcasesketch
    coveragerequirement -->|flows-to| coveragerequirement
    coveragerequirement -->|depends-on| outcomecategory
    coveragerequirement -->|depends-on| inputspacepartition
    coveragerequirement -->|depends-on| contextvariation
    coveragerequirement -->|composes| testcoveragetarget
    coveragerequirement -->|composes| outcomecategory
    coveragerequirement -->|composes| inputpartitionselection
    coveragerequirement -->|aggregates| partitionvalue
    coveragerequirement -->|aggregates| contextvariation
    coveragerequirement -->|accesses| inputselection
    coveragerequirement -->|accesses| inputpartitionselection
    coveragegap -->|triggers| partitionvalue
    coveragegap -->|triggers| coveragerequirement
    contextvariation -->|serves| testcoveragetarget
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
  class testing current
```

## Inter-Layer Relationships Table

| Relationship ID                                                          | Source Node                                                             | Dest Node                                                  | Dest Layer                                    | Predicate              | Cardinality  | Strength |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- | ---------------------- | ------------ | -------- |
| testing.testcoveragemodel.constrained-by.motivation.constraint           | [testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)     | [constraint](./01-motivation-layer-report.md#constraint)   | [Motivation](./01-motivation-layer-report.md) | constrained-by         | many-to-many | medium   |
| testing.coveragerequirement.constrained-by.motivation.constraint         | [coveragerequirement](./12-testing-layer-report.md#coveragerequirement) | [constraint](./01-motivation-layer-report.md#constraint)   | [Motivation](./01-motivation-layer-report.md) | constrained-by         | many-to-many | medium   |
| testing.testcoveragemodel.fulfills-requirements.motivation.requirement   | [testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)     | [requirement](./01-motivation-layer-report.md#requirement) | [Motivation](./01-motivation-layer-report.md) | fulfills-requirements  | many-to-many | high     |
| testing.testcasesketch.fulfills-requirements.motivation.requirement      | [testcasesketch](./12-testing-layer-report.md#testcasesketch)           | [requirement](./01-motivation-layer-report.md#requirement) | [Motivation](./01-motivation-layer-report.md) | fulfills-requirements  | many-to-many | high     |
| testing.coveragerequirement.fulfills-requirements.motivation.requirement | [coveragerequirement](./12-testing-layer-report.md#coveragerequirement) | [requirement](./01-motivation-layer-report.md#requirement) | [Motivation](./01-motivation-layer-report.md) | fulfills-requirements  | many-to-many | high     |
| testing.testcoveragemodel.governed-by-principles.motivation.principle    | [testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)     | [principle](./01-motivation-layer-report.md#principle)     | [Motivation](./01-motivation-layer-report.md) | governed-by-principles | many-to-many | high     |
| testing.testcoveragemodel.supports-goals.motivation.goal                 | [testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)     | [goal](./01-motivation-layer-report.md#goal)               | [Motivation](./01-motivation-layer-report.md) | supports-goals         | many-to-many | high     |
| testing.testcasesketch.supports-goals.motivation.goal                    | [testcasesketch](./12-testing-layer-report.md#testcasesketch)           | [goal](./01-motivation-layer-report.md#goal)               | [Motivation](./01-motivation-layer-report.md) | supports-goals         | many-to-many | high     |

## Node Reference

### Contexttype {#contexttype}

**Spec Node ID**: `testing.contexttype`

ContextType element in Testing Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Contextvariation {#contextvariation}

**Spec Node ID**: `testing.contextvariation`

Different context in which functionality can be invoked

#### Relationship Metrics

- **Intra-Layer**: Inbound: 4 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                        | Predicate  | Direction | Cardinality  |
| --------------------------------------------------- | ---------- | --------- | ------------ |
| [testcasesketch](#testcasesketch)                   | depends-on | inbound   | many-to-many |
| [inputpartitionselection](#inputpartitionselection) | aggregates | inbound   | many-to-many |
| [coveragerequirement](#coveragerequirement)         | depends-on | inbound   | many-to-many |
| [coveragerequirement](#coveragerequirement)         | aggregates | inbound   | many-to-many |
| [testcoveragetarget](#testcoveragetarget)           | serves     | outbound  | many-to-many |

[Back to Index](#report-index)

### Coveragecriteria {#coveragecriteria}

**Spec Node ID**: `testing.coveragecriteria`

CoverageCriteria element in Testing Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Coverageexclusion {#coverageexclusion}

**Spec Node ID**: `testing.coverageexclusion`

Explicit exclusion from coverage with justification

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Coveragegap {#coveragegap}

**Spec Node ID**: `testing.coveragegap`

Identified gap in test coverage requiring attention

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 2
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate | Direction | Cardinality  |
| ------------------------------------------- | --------- | --------- | ------------ |
| [partitionvalue](#partitionvalue)           | triggers  | outbound  | many-to-many |
| [coveragerequirement](#coveragerequirement) | triggers  | outbound  | many-to-many |

[Back to Index](#report-index)

### Coveragerequirement {#coveragerequirement}

**Spec Node ID**: `testing.coveragerequirement`

Requirement for test coverage of a target

#### Relationship Metrics

- **Intra-Layer**: Inbound: 9 | Outbound: 15
- **Inter-Layer**: Inbound: 0 | Outbound: 2

#### Intra-Layer Relationships

| Related Node                                        | Predicate  | Direction | Cardinality  |
| --------------------------------------------------- | ---------- | --------- | ------------ |
| [testcoveragetarget](#testcoveragetarget)           | flows-to   | inbound   | many-to-many |
| [testcasesketch](#testcasesketch)                   | validates  | inbound   | many-to-many |
| [testcasesketch](#testcasesketch)                   | references | inbound   | many-to-many |
| [targetcoveragesummary](#targetcoveragesummary)     | validates  | inbound   | many-to-many |
| [partitiondependency](#partitiondependency)         | triggers   | inbound   | many-to-many |
| [inputselection](#inputselection)                   | references | inbound   | many-to-many |
| [testcoveragetarget](#testcoveragetarget)           | references | outbound  | many-to-many |
| [partitionvalue](#partitionvalue)                   | references | outbound  | many-to-many |
| [coveragerequirement](#coveragerequirement)         | references | outbound  | many-to-many |
| [testcasesketch](#testcasesketch)                   | flows-to   | outbound  | many-to-many |
| [coveragerequirement](#coveragerequirement)         | flows-to   | outbound  | many-to-many |
| [outcomecategory](#outcomecategory)                 | depends-on | outbound  | many-to-many |
| [inputspacepartition](#inputspacepartition)         | depends-on | outbound  | many-to-many |
| [contextvariation](#contextvariation)               | depends-on | outbound  | many-to-many |
| [testcoveragetarget](#testcoveragetarget)           | composes   | outbound  | many-to-many |
| [outcomecategory](#outcomecategory)                 | composes   | outbound  | many-to-many |
| [inputpartitionselection](#inputpartitionselection) | composes   | outbound  | many-to-many |
| [partitionvalue](#partitionvalue)                   | aggregates | outbound  | many-to-many |
| [contextvariation](#contextvariation)               | aggregates | outbound  | many-to-many |
| [inputselection](#inputselection)                   | accesses   | outbound  | many-to-many |
| [inputpartitionselection](#inputpartitionselection) | accesses   | outbound  | many-to-many |
| [coveragegap](#coveragegap)                         | triggers   | inbound   | many-to-many |

#### Inter-Layer Relationships

| Related Node                                               | Layer                                         | Predicate             | Direction | Cardinality  |
| ---------------------------------------------------------- | --------------------------------------------- | --------------------- | --------- | ------------ |
| [requirement](./01-motivation-layer-report.md#requirement) | [Motivation](./01-motivation-layer-report.md) | fulfills-requirements | outbound  | many-to-many |
| [constraint](./01-motivation-layer-report.md#constraint)   | [Motivation](./01-motivation-layer-report.md) | constrained-by        | outbound  | many-to-many |

[Back to Index](#report-index)

### Coveragesummary {#coveragesummary}

**Spec Node ID**: `testing.coveragesummary`

Summary of coverage status (can be computed or declared)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Dependencyeffect {#dependencyeffect}

**Spec Node ID**: `testing.dependencyeffect`

DependencyEffect element in Testing Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Environmentfactor {#environmentfactor}

**Spec Node ID**: `testing.environmentfactor`

Environmental condition that may affect behavior

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Fieldrelevance {#fieldrelevance}

**Spec Node ID**: `testing.fieldrelevance`

FieldRelevance element in Testing Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Gapseverity {#gapseverity}

**Spec Node ID**: `testing.gapseverity`

GapSeverity element in Testing Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Implementationformat {#implementationformat}

**Spec Node ID**: `testing.implementationformat`

ImplementationFormat element in Testing Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Inputpartitionselection {#inputpartitionselection}

**Spec Node ID**: `testing.inputpartitionselection`

Selection of partition values to include in coverage

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 2
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate  | Direction | Cardinality  |
| ------------------------------------------- | ---------- | --------- | ------------ |
| [testcoveragetarget](#testcoveragetarget)   | composes   | inbound   | many-to-many |
| [testcoveragemodel](#testcoveragemodel)     | composes   | inbound   | many-to-many |
| [testcasesketch](#testcasesketch)           | accesses   | inbound   | many-to-many |
| [partitionvalue](#partitionvalue)           | aggregates | outbound  | many-to-many |
| [contextvariation](#contextvariation)       | aggregates | outbound  | many-to-many |
| [coveragerequirement](#coveragerequirement) | composes   | inbound   | many-to-many |
| [coveragerequirement](#coveragerequirement) | accesses   | inbound   | many-to-many |

[Back to Index](#report-index)

### Inputselection {#inputselection}

**Spec Node ID**: `testing.inputselection`

Specific partition value selected for a test case

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate  | Direction | Cardinality  |
| ------------------------------------------- | ---------- | --------- | ------------ |
| [testcasesketch](#testcasesketch)           | accesses   | inbound   | many-to-many |
| [testcoveragetarget](#testcoveragetarget)   | references | outbound  | many-to-many |
| [partitionvalue](#partitionvalue)           | references | outbound  | many-to-many |
| [coveragerequirement](#coveragerequirement) | references | outbound  | many-to-many |
| [coveragerequirement](#coveragerequirement) | accesses   | inbound   | many-to-many |

[Back to Index](#report-index)

### Inputspacepartition {#inputspacepartition}

**Spec Node ID**: `testing.inputspacepartition`

Partitioning of an input dimension into testable categories

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate  | Direction | Cardinality  |
| ------------------------------------------- | ---------- | --------- | ------------ |
| [testcasesketch](#testcasesketch)           | depends-on | inbound   | many-to-many |
| [testcoveragetarget](#testcoveragetarget)   | serves     | outbound  | many-to-many |
| [coveragerequirement](#coveragerequirement) | depends-on | inbound   | many-to-many |

[Back to Index](#report-index)

### Outcomecategory {#outcomecategory}

**Spec Node ID**: `testing.outcomecategory`

Category of expected outcomes (not specific assertions)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate  | Direction | Cardinality  |
| ------------------------------------------- | ---------- | --------- | ------------ |
| [testcoveragetarget](#testcoveragetarget)   | composes   | inbound   | many-to-many |
| [testcoveragemodel](#testcoveragemodel)     | composes   | inbound   | many-to-many |
| [testcasesketch](#testcasesketch)           | depends-on | inbound   | many-to-many |
| [coveragerequirement](#coveragerequirement) | depends-on | inbound   | many-to-many |
| [coveragerequirement](#coveragerequirement) | composes   | inbound   | many-to-many |

[Back to Index](#report-index)

### Outcometype {#outcometype}

**Spec Node ID**: `testing.outcometype`

OutcomeType element in Testing Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Partitioncategory {#partitioncategory}

**Spec Node ID**: `testing.partitioncategory`

PartitionCategory element in Testing Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Partitiondependency {#partitiondependency}

**Spec Node ID**: `testing.partitiondependency`

Constraint between partition values across fields

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 2
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate | Direction | Cardinality  |
| ------------------------------------------- | --------- | --------- | ------------ |
| [partitionvalue](#partitionvalue)           | triggers  | outbound  | many-to-many |
| [coveragerequirement](#coveragerequirement) | triggers  | outbound  | many-to-many |

[Back to Index](#report-index)

### Partitionvalue {#partitionvalue}

**Spec Node ID**: `testing.partitionvalue`

A specific partition within the input space

#### Relationship Metrics

- **Intra-Layer**: Inbound: 7 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                        | Predicate  | Direction | Cardinality  |
| --------------------------------------------------- | ---------- | --------- | ------------ |
| [testcasesketch](#testcasesketch)                   | references | inbound   | many-to-many |
| [partitiondependency](#partitiondependency)         | triggers   | inbound   | many-to-many |
| [inputselection](#inputselection)                   | references | inbound   | many-to-many |
| [inputpartitionselection](#inputpartitionselection) | aggregates | inbound   | many-to-many |
| [coveragerequirement](#coveragerequirement)         | references | inbound   | many-to-many |
| [coveragerequirement](#coveragerequirement)         | aggregates | inbound   | many-to-many |
| [coveragegap](#coveragegap)                         | triggers   | inbound   | many-to-many |

[Back to Index](#report-index)

### Presencerule {#presencerule}

**Spec Node ID**: `testing.presencerule`

PresenceRule element in Testing Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Priority {#priority}

**Spec Node ID**: `testing.priority`

Priority element in Testing Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Sketchstatus {#sketchstatus}

**Spec Node ID**: `testing.sketchstatus`

SketchStatus element in Testing Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Targetcoveragesummary {#targetcoveragesummary}

**Spec Node ID**: `testing.targetcoveragesummary`

Coverage metrics summary for a single test coverage target

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 2
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate | Direction | Cardinality  |
| ------------------------------------------- | --------- | --------- | ------------ |
| [testcoveragetarget](#testcoveragetarget)   | validates | outbound  | many-to-many |
| [coveragerequirement](#coveragerequirement) | validates | outbound  | many-to-many |

[Back to Index](#report-index)

### Targetinputfield {#targetinputfield}

**Spec Node ID**: `testing.targetinputfield`

Input field associated with a coverage target

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Targettype {#targettype}

**Spec Node ID**: `testing.targettype`

TargetType element in Testing Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Testcasesketch {#testcasesketch}

**Spec Node ID**: `testing.testcasesketch`

Abstract test case selecting specific partition values

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 10
- **Inter-Layer**: Inbound: 0 | Outbound: 2

#### Intra-Layer Relationships

| Related Node                                        | Predicate  | Direction | Cardinality  |
| --------------------------------------------------- | ---------- | --------- | ------------ |
| [testcoveragetarget](#testcoveragetarget)           | flows-to   | inbound   | many-to-many |
| [testcoveragetarget](#testcoveragetarget)           | validates  | outbound  | many-to-many |
| [coveragerequirement](#coveragerequirement)         | validates  | outbound  | many-to-many |
| [testcoveragetarget](#testcoveragetarget)           | references | outbound  | many-to-many |
| [partitionvalue](#partitionvalue)                   | references | outbound  | many-to-many |
| [coveragerequirement](#coveragerequirement)         | references | outbound  | many-to-many |
| [outcomecategory](#outcomecategory)                 | depends-on | outbound  | many-to-many |
| [inputspacepartition](#inputspacepartition)         | depends-on | outbound  | many-to-many |
| [contextvariation](#contextvariation)               | depends-on | outbound  | many-to-many |
| [inputselection](#inputselection)                   | accesses   | outbound  | many-to-many |
| [inputpartitionselection](#inputpartitionselection) | accesses   | outbound  | many-to-many |
| [coveragerequirement](#coveragerequirement)         | flows-to   | inbound   | many-to-many |

#### Inter-Layer Relationships

| Related Node                                               | Layer                                         | Predicate             | Direction | Cardinality  |
| ---------------------------------------------------------- | --------------------------------------------- | --------------------- | --------- | ------------ |
| [goal](./01-motivation-layer-report.md#goal)               | [Motivation](./01-motivation-layer-report.md) | supports-goals        | outbound  | many-to-many |
| [requirement](./01-motivation-layer-report.md#requirement) | [Motivation](./01-motivation-layer-report.md) | fulfills-requirements | outbound  | many-to-many |

[Back to Index](#report-index)

### Testcoveragemodel {#testcoveragemodel}

**Spec Node ID**: `testing.testcoveragemodel`

Complete test coverage model for application

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 4

#### Intra-Layer Relationships

| Related Node                                        | Predicate | Direction | Cardinality  |
| --------------------------------------------------- | --------- | --------- | ------------ |
| [testcoveragetarget](#testcoveragetarget)           | composes  | outbound  | many-to-many |
| [outcomecategory](#outcomecategory)                 | composes  | outbound  | many-to-many |
| [inputpartitionselection](#inputpartitionselection) | composes  | outbound  | many-to-many |

#### Inter-Layer Relationships

| Related Node                                               | Layer                                         | Predicate              | Direction | Cardinality  |
| ---------------------------------------------------------- | --------------------------------------------- | ---------------------- | --------- | ------------ |
| [goal](./01-motivation-layer-report.md#goal)               | [Motivation](./01-motivation-layer-report.md) | supports-goals         | outbound  | many-to-many |
| [principle](./01-motivation-layer-report.md#principle)     | [Motivation](./01-motivation-layer-report.md) | governed-by-principles | outbound  | many-to-many |
| [requirement](./01-motivation-layer-report.md#requirement) | [Motivation](./01-motivation-layer-report.md) | fulfills-requirements  | outbound  | many-to-many |
| [constraint](./01-motivation-layer-report.md#constraint)   | [Motivation](./01-motivation-layer-report.md) | constrained-by         | outbound  | many-to-many |

[Back to Index](#report-index)

### Testcoveragetarget {#testcoveragetarget}

**Spec Node ID**: `testing.testcoveragetarget`

An artifact or functionality that requires test coverage

#### Relationship Metrics

- **Intra-Layer**: Inbound: 10 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                        | Predicate  | Direction | Cardinality  |
| --------------------------------------------------- | ---------- | --------- | ------------ |
| [testcasesketch](#testcasesketch)                   | flows-to   | outbound  | many-to-many |
| [coveragerequirement](#coveragerequirement)         | flows-to   | outbound  | many-to-many |
| [testcoveragetarget](#testcoveragetarget)           | composes   | outbound  | many-to-many |
| [outcomecategory](#outcomecategory)                 | composes   | outbound  | many-to-many |
| [inputpartitionselection](#inputpartitionselection) | composes   | outbound  | many-to-many |
| [testcoveragemodel](#testcoveragemodel)             | composes   | inbound   | many-to-many |
| [testcasesketch](#testcasesketch)                   | validates  | inbound   | many-to-many |
| [testcasesketch](#testcasesketch)                   | references | inbound   | many-to-many |
| [targetcoveragesummary](#targetcoveragesummary)     | validates  | inbound   | many-to-many |
| [inputspacepartition](#inputspacepartition)         | serves     | inbound   | many-to-many |
| [inputselection](#inputselection)                   | references | inbound   | many-to-many |
| [coveragerequirement](#coveragerequirement)         | references | inbound   | many-to-many |
| [coveragerequirement](#coveragerequirement)         | composes   | inbound   | many-to-many |
| [contextvariation](#contextvariation)               | serves     | inbound   | many-to-many |

[Back to Index](#report-index)

---

_Generated: 2026-02-13T11:58:05.067Z | Spec Version: 0.8.0 | Commit: c1cfcc4 | Generator: generate-layer-reports.ts_
