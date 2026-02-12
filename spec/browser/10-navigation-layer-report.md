# Navigation Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Breadcrumbconfig](#breadcrumbconfig)
  - [Breadcrumbmode](#breadcrumbmode)
  - [Contextscope](#contextscope)
  - [Contextvariable](#contextvariable)
  - [Datamapping](#datamapping)
  - [Flowanalytics](#flowanalytics)
  - [Flowstep](#flowstep)
  - [Guardaction](#guardaction)
  - [Guardactiontype](#guardactiontype)
  - [Guardcondition](#guardcondition)
  - [Guardtype](#guardtype)
  - [Httpmethod](#httpmethod)
  - [Navigationflow](#navigationflow)
  - [Navigationgraph](#navigationgraph)
  - [Navigationguard](#navigationguard)
  - [Navigationtransition](#navigationtransition)
  - [Navigationtrigger](#navigationtrigger)
  - [Notificationaction](#notificationaction)
  - [Notificationtype](#notificationtype)
  - [Processtracking](#processtracking)
  - [Route](#route)
  - [Routemeta](#routemeta)
  - [Routetype](#routetype)
  - [Storagetype](#storagetype)
  - [Truncationtype](#truncationtype)
  - [Waittype](#waittype)

## Layer Introduction

**Layer 10**: Navigation
**Standard**: [SPA Navigation Patterns](https://www.w3.org/TR/navigation-timing-2/)

Layer 10: Navigation Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 26    |
| Intra-Layer Relationships | 0     |
| Inter-Layer Relationships | 0     |
| Inbound Relationships     | 0     |
| Outbound Relationships    | 0     |

### Layer Dependencies

**Depends On**: None

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
  class navigation current
```

## Inter-Layer Relationships Table

No inter-layer relationships defined.

## Node Reference

### Breadcrumbconfig {#breadcrumbconfig}

**Spec Node ID**: `navigation.breadcrumbconfig`

Configuration for breadcrumb navigation display, specifying path generation rules, separator styles, truncation behavior, and home link settings. Provides users with location context and navigation history.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Breadcrumbmode {#breadcrumbmode}

**Spec Node ID**: `navigation.breadcrumbmode`

BreadcrumbMode element in Navigation Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Contextscope {#contextscope}

**Spec Node ID**: `navigation.contextscope`

ContextScope element in Navigation Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Contextvariable {#contextvariable}

**Spec Node ID**: `navigation.contextvariable`

Shared variable across flow steps (Gap #1: Cross-experience state)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Datamapping {#datamapping}

**Spec Node ID**: `navigation.datamapping`

Maps data between flow context and experience (Gap #2: Data handoff)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Flowanalytics {#flowanalytics}

**Spec Node ID**: `navigation.flowanalytics`

Analytics for funnel tracking (Gap #9: Funnel analytics)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Flowstep {#flowstep}

**Spec Node ID**: `navigation.flowstep`

One step in a navigation flow

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Guardaction {#guardaction}

**Spec Node ID**: `navigation.guardaction`

Action when guard denies access

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Guardactiontype {#guardactiontype}

**Spec Node ID**: `navigation.guardactiontype`

GuardActionType element in Navigation Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Guardcondition {#guardcondition}

**Spec Node ID**: `navigation.guardcondition`

Condition expression for guard

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Guardtype {#guardtype}

**Spec Node ID**: `navigation.guardtype`

GuardType element in Navigation Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Httpmethod {#httpmethod}

**Spec Node ID**: `navigation.httpmethod`

HttpMethod element in Navigation Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Navigationflow {#navigationflow}

**Spec Node ID**: `navigation.navigationflow`

Sequence of routes that realizes a business process

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Navigationgraph {#navigationgraph}

**Spec Node ID**: `navigation.navigationgraph`

Complete navigation structure for application

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Navigationguard {#navigationguard}

**Spec Node ID**: `navigation.navigationguard`

Guard condition for route access

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Navigationtransition {#navigationtransition}

**Spec Node ID**: `navigation.navigationtransition`

Transition from one route to another

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Navigationtrigger {#navigationtrigger}

**Spec Node ID**: `navigation.navigationtrigger`

NavigationTrigger element in Navigation Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Notificationaction {#notificationaction}

**Spec Node ID**: `navigation.notificationaction`

Notification to send during flow step

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Notificationtype {#notificationtype}

**Spec Node ID**: `navigation.notificationtype`

NotificationType element in Navigation Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Processtracking {#processtracking}

**Spec Node ID**: `navigation.processtracking`

Tracks business process instance across flow (Gap #3: Process correlation)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Route {#route}

**Spec Node ID**: `navigation.route`

Single route/destination in the application (channel-agnostic)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Routemeta {#routemeta}

**Spec Node ID**: `navigation.routemeta`

Route metadata

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Routetype {#routetype}

**Spec Node ID**: `navigation.routetype`

RouteType element in Navigation Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Storagetype {#storagetype}

**Spec Node ID**: `navigation.storagetype`

StorageType element in Navigation Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Truncationtype {#truncationtype}

**Spec Node ID**: `navigation.truncationtype`

TruncationType element in Navigation Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Waittype {#waittype}

**Spec Node ID**: `navigation.waittype`

WaitType element in Navigation Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

---

_Generated: 2026-02-12T16:13:32.600Z | Spec Version: 0.8.0 | Commit: 9fb8d45 | Generator: generate-layer-reports.ts_
