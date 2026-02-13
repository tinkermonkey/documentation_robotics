# Technology Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Artifact](#artifact)
  - [Artifacttype](#artifacttype)
  - [Communicationnetwork](#communicationnetwork)
  - [Device](#device)
  - [Devicetype](#devicetype)
  - [Networktype](#networktype)
  - [Node](#node)
  - [Nodetype](#nodetype)
  - [Path](#path)
  - [Pathtype](#pathtype)
  - [Systemsoftware](#systemsoftware)
  - [Systemsoftwaretype](#systemsoftwaretype)
  - [Techeventtype](#techeventtype)
  - [Technologycollaboration](#technologycollaboration)
  - [Technologyevent](#technologyevent)
  - [Technologyfunction](#technologyfunction)
  - [Technologyinteraction](#technologyinteraction)
  - [Technologyinterface](#technologyinterface)
  - [Technologyprocess](#technologyprocess)
  - [Technologyservice](#technologyservice)
  - [Techprotocol](#techprotocol)
  - [Techservicetype](#techservicetype)

## Layer Introduction

**Layer 5**: Technology
**Standard**: [ArchiMate 3.2](https://pubs.opengroup.org/architecture/archimate32-doc/)

Layer 5: Technology Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 22    |
| Intra-Layer Relationships | 0     |
| Inter-Layer Relationships | 2     |
| Inbound Relationships     | 0     |
| Outbound Relationships    | 2     |

### Layer Dependencies

**Depends On**: None

**Depended On By**: [Security](./03-security-layer-report.md)

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
  class technology current
```

## Inter-Layer Relationships Table

| Relationship ID                                            | Source Node                                          | Dest Node                                                      | Dest Layer                                | Predicate      | Cardinality | Strength |
| ---------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------- | -------------- | ----------- | -------- |
| technology.artifact.classification.security.classification | [artifact](./05-technology-layer-report.md#artifact) | [classification](./03-security-layer-report.md#classification) | [Security](./03-security-layer-report.md) | classification | many-to-one | low      |
| technology.artifact.referenced-by.security.classification  | [artifact](./05-technology-layer-report.md#artifact) | [classification](./03-security-layer-report.md#classification) | [Security](./03-security-layer-report.md) | referenced-by  | many-to-one | medium   |

## Node Reference

### Artifact {#artifact}

**Spec Node ID**: `technology.artifact`

Physical piece of data used or produced

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 2

#### Inter-Layer Relationships

| Related Node                                                   | Layer                                     | Predicate      | Direction | Cardinality |
| -------------------------------------------------------------- | ----------------------------------------- | -------------- | --------- | ----------- |
| [classification](./03-security-layer-report.md#classification) | [Security](./03-security-layer-report.md) | referenced-by  | outbound  | many-to-one |
| [classification](./03-security-layer-report.md#classification) | [Security](./03-security-layer-report.md) | classification | outbound  | many-to-one |

[Back to Index](#report-index)

### Artifacttype {#artifacttype}

**Spec Node ID**: `technology.artifacttype`

ArtifactType element in Technology Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Communicationnetwork {#communicationnetwork}

**Spec Node ID**: `technology.communicationnetwork`

Set of structures that connects nodes

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Device {#device}

**Spec Node ID**: `technology.device`

Physical IT resource with processing capability

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Devicetype {#devicetype}

**Spec Node ID**: `technology.devicetype`

DeviceType element in Technology Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Networktype {#networktype}

**Spec Node ID**: `technology.networktype`

NetworkType element in Technology Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Node {#node}

**Spec Node ID**: `technology.node`

Computational or physical resource that hosts artifacts

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Nodetype {#nodetype}

**Spec Node ID**: `technology.nodetype`

NodeType element in Technology Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Path {#path}

**Spec Node ID**: `technology.path`

Link between nodes through which they exchange

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Pathtype {#pathtype}

**Spec Node ID**: `technology.pathtype`

PathType element in Technology Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Systemsoftware {#systemsoftware}

**Spec Node ID**: `technology.systemsoftware`

Software that provides platform for applications

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Systemsoftwaretype {#systemsoftwaretype}

**Spec Node ID**: `technology.systemsoftwaretype`

SystemSoftwareType element in Technology Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Techeventtype {#techeventtype}

**Spec Node ID**: `technology.techeventtype`

TechEventType element in Technology Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Technologycollaboration {#technologycollaboration}

**Spec Node ID**: `technology.technologycollaboration`

Aggregate of nodes working together

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Technologyevent {#technologyevent}

**Spec Node ID**: `technology.technologyevent`

Technology state change

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Technologyfunction {#technologyfunction}

**Spec Node ID**: `technology.technologyfunction`

Collection of technology behavior

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Technologyinteraction {#technologyinteraction}

**Spec Node ID**: `technology.technologyinteraction`

Unit of collective technology behavior

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Technologyinterface {#technologyinterface}

**Spec Node ID**: `technology.technologyinterface`

Point of access where technology services are available

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Technologyprocess {#technologyprocess}

**Spec Node ID**: `technology.technologyprocess`

Sequence of technology behaviors

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Technologyservice {#technologyservice}

**Spec Node ID**: `technology.technologyservice`

Externally visible unit of technology functionality

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Techprotocol {#techprotocol}

**Spec Node ID**: `technology.techprotocol`

TechProtocol element in Technology Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Techservicetype {#techservicetype}

**Spec Node ID**: `technology.techservicetype`

TechServiceType element in Technology Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

---

_Generated: 2026-02-13T10:34:36.989Z | Spec Version: 0.8.0 | Commit: f946950 | Generator: generate-layer-reports.ts_
