# Navigation Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Breadcrumbconfig](#breadcrumbconfig)
  - [Contextvariable](#contextvariable)
  - [Flowstep](#flowstep)
  - [Guardaction](#guardaction)
  - [Guardcondition](#guardcondition)
  - [Navigationflow](#navigationflow)
  - [Navigationgraph](#navigationgraph)
  - [Navigationguard](#navigationguard)
  - [Navigationtransition](#navigationtransition)
  - [Route](#route)
  - [Routemeta](#routemeta)

## Layer Introduction

**Layer 10**: Navigation
**Standard**: [SPA Navigation Patterns](https://www.w3.org/TR/navigation-timing-2/)

Layer 10: Navigation Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 11    |
| Intra-Layer Relationships | 51    |
| Inter-Layer Relationships | 0     |
| Inbound Relationships     | 0     |
| Outbound Relationships    | 0     |

### Layer Dependencies

**Depends On**: None

**Depended On By**: None

## Intra-Layer Relationships

```mermaid
flowchart LR
  subgraph navigation
    breadcrumbconfig["breadcrumbconfig"]
    contextvariable["contextvariable"]
    flowstep["flowstep"]
    guardaction["guardaction"]
    guardcondition["guardcondition"]
    navigationflow["navigationflow"]
    navigationgraph["navigationgraph"]
    navigationguard["navigationguard"]
    navigationtransition["navigationtransition"]
    route["route"]
    routemeta["routemeta"]
    breadcrumbconfig -->|associated-with| navigationgraph
    breadcrumbconfig -->|provides| routemeta
    breadcrumbconfig -->|references| route
    contextvariable -->|consumes| route
    contextvariable -->|flows-to| flowstep
    contextvariable -->|triggers| navigationtransition
    flowstep -->|consumes| contextvariable
    flowstep -->|navigates-to| route
    flowstep -->|realizes| route
    flowstep -->|requires| navigationguard
    flowstep -->|triggers| navigationtransition
    guardaction -->|depends-on| guardcondition
    guardaction -->|navigates-to| route
    guardaction -->|uses| contextvariable
    guardcondition -->|constrains| route
    guardcondition -->|consumes| contextvariable
    guardcondition -->|references| routemeta
    guardcondition -->|triggers| guardaction
    guardcondition -->|uses| contextvariable
    navigationflow -->|aggregates| contextvariable
    navigationflow -->|aggregates| flowstep
    navigationflow -->|composes| flowstep
    navigationflow -->|flows-to| navigationtransition
    navigationflow -->|requires| navigationguard
    navigationgraph -->|aggregates| breadcrumbconfig
    navigationgraph -->|aggregates| navigationflow
    navigationgraph -->|aggregates| navigationguard
    navigationgraph -->|aggregates| navigationtransition
    navigationgraph -->|aggregates| route
    navigationgraph -->|composes| navigationtransition
    navigationgraph -->|composes| route
    navigationguard -->|constrains| navigationtransition
    navigationguard -->|consumes| contextvariable
    navigationguard -->|protects| route
    navigationguard -->|triggers| guardaction
    navigationguard -->|uses| guardcondition
    navigationtransition -->|flows-to| route
    navigationtransition -->|navigates-to| route
    navigationtransition -->|requires| navigationguard
    navigationtransition -->|triggers| guardaction
    navigationtransition -->|uses| contextvariable
    route -->|aggregates| route
    route -->|associated-with| routemeta
    route -->|composes| routemeta
    route -->|flows-to| navigationtransition
    route -->|navigates-to| route
    route -->|triggers| navigationtransition
    routemeta -->|governs| navigationguard
    routemeta -->|references| breadcrumbconfig
    routemeta -->|serves| route
    routemeta -->|uses| navigationtransition
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
  class navigation current
```

## Inter-Layer Relationships Table

No inter-layer relationships defined.

## Node Reference

### Breadcrumbconfig {#breadcrumbconfig}

**Spec Node ID**: `navigation.breadcrumbconfig`

Configuration for breadcrumb navigation display, specifying path generation rules, separator styles, truncation behavior, and home link settings. Applied globally to define breadcrumb rendering for a navigation scope rather than attached per individual Route. Provides users with location context and navigation history.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate       | Direction | Cardinality |
| ----------------------------------- | --------------- | --------- | ----------- |
| [Navigationgraph](#navigationgraph) | associated-with | outbound  | many-to-one |
| [Routemeta](#routemeta)             | provides        | outbound  | many-to-one |
| [Route](#route)                     | references      | outbound  | many-to-one |
| [Navigationgraph](#navigationgraph) | aggregates      | inbound   | many-to-one |
| [Routemeta](#routemeta)             | references      | inbound   | many-to-one |

[Back to Index](#report-index)

### Contextvariable {#contextvariable}

**Spec Node ID**: `navigation.contextvariable`

A typed variable shared across steps of a NavigationFlow, enabling state to persist and transfer between route transitions.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 7 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality |
| --------------------------------------------- | ---------- | --------- | ----------- |
| [Route](#route)                               | consumes   | outbound  | many-to-one |
| [Flowstep](#flowstep)                         | flows-to   | outbound  | many-to-one |
| [Navigationtransition](#navigationtransition) | triggers   | outbound  | many-to-one |
| [Flowstep](#flowstep)                         | consumes   | inbound   | many-to-one |
| [Guardaction](#guardaction)                   | uses       | inbound   | many-to-one |
| [Guardcondition](#guardcondition)             | consumes   | inbound   | many-to-one |
| [Guardcondition](#guardcondition)             | uses       | inbound   | many-to-one |
| [Navigationflow](#navigationflow)             | aggregates | inbound   | many-to-one |
| [Navigationguard](#navigationguard)           | consumes   | inbound   | many-to-one |
| [Navigationtransition](#navigationtransition) | uses       | inbound   | many-to-one |

[Back to Index](#report-index)

### Flowstep {#flowstep}

**Spec Node ID**: `navigation.flowstep`

One step in a navigation flow

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate    | Direction | Cardinality |
| --------------------------------------------- | ------------ | --------- | ----------- |
| [Contextvariable](#contextvariable)           | flows-to     | inbound   | many-to-one |
| [Contextvariable](#contextvariable)           | consumes     | outbound  | many-to-one |
| [Route](#route)                               | navigates-to | outbound  | many-to-one |
| [Route](#route)                               | realizes     | outbound  | many-to-one |
| [Navigationguard](#navigationguard)           | requires     | outbound  | many-to-one |
| [Navigationtransition](#navigationtransition) | triggers     | outbound  | many-to-one |
| [Navigationflow](#navigationflow)             | aggregates   | inbound   | many-to-one |
| [Navigationflow](#navigationflow)             | composes     | inbound   | many-to-one |

[Back to Index](#report-index)

### Guardaction {#guardaction}

**Spec Node ID**: `navigation.guardaction`

Defines the response executed by a NavigationGuard when its condition evaluates to false (access denied). Specifies whether to redirect the user, block navigation in place, notify with a message, or prompt for confirmation — along with the target destination and whether to preserve the attempted route for post-authentication redirect.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate    | Direction | Cardinality |
| --------------------------------------------- | ------------ | --------- | ----------- |
| [Guardcondition](#guardcondition)             | depends-on   | outbound  | many-to-one |
| [Route](#route)                               | navigates-to | outbound  | many-to-one |
| [Contextvariable](#contextvariable)           | uses         | outbound  | many-to-one |
| [Guardcondition](#guardcondition)             | triggers     | inbound   | many-to-one |
| [Navigationguard](#navigationguard)           | triggers     | inbound   | many-to-one |
| [Navigationtransition](#navigationtransition) | triggers     | inbound   | many-to-one |

[Back to Index](#report-index)

### Guardcondition {#guardcondition}

**Spec Node ID**: `navigation.guardcondition`

Boolean predicate evaluated by a NavigationGuard to determine whether route access should be permitted. Expressions may reference user session state, roles, or feature flags. Async conditions (e.g., token validation API calls) are supported with a configurable timeout; on timeout, the condition fails closed (access denied) to preserve security.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate  | Direction | Cardinality |
| ----------------------------------- | ---------- | --------- | ----------- |
| [Guardaction](#guardaction)         | depends-on | inbound   | many-to-one |
| [Route](#route)                     | constrains | outbound  | many-to-one |
| [Contextvariable](#contextvariable) | consumes   | outbound  | many-to-one |
| [Routemeta](#routemeta)             | references | outbound  | many-to-one |
| [Guardaction](#guardaction)         | triggers   | outbound  | many-to-one |
| [Contextvariable](#contextvariable) | uses       | outbound  | many-to-one |
| [Navigationguard](#navigationguard) | uses       | inbound   | many-to-one |

[Back to Index](#report-index)

### Navigationflow {#navigationflow}

**Spec Node ID**: `navigation.navigationflow`

Sequence of routes that realizes a business process

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality |
| --------------------------------------------- | ---------- | --------- | ----------- |
| [Contextvariable](#contextvariable)           | aggregates | outbound  | many-to-one |
| [Flowstep](#flowstep)                         | aggregates | outbound  | many-to-one |
| [Flowstep](#flowstep)                         | composes   | outbound  | many-to-one |
| [Navigationtransition](#navigationtransition) | flows-to   | outbound  | many-to-one |
| [Navigationguard](#navigationguard)           | requires   | outbound  | many-to-one |
| [Navigationgraph](#navigationgraph)           | aggregates | inbound   | many-to-one |

[Back to Index](#report-index)

### Navigationgraph {#navigationgraph}

**Spec Node ID**: `navigation.navigationgraph`

Root container for an application's complete routing structure, composing all Route, NavigationTransition, and NavigationGuard nodes into a unified navigation model.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 7
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate       | Direction | Cardinality |
| --------------------------------------------- | --------------- | --------- | ----------- |
| [Breadcrumbconfig](#breadcrumbconfig)         | associated-with | inbound   | many-to-one |
| [Breadcrumbconfig](#breadcrumbconfig)         | aggregates      | outbound  | many-to-one |
| [Navigationflow](#navigationflow)             | aggregates      | outbound  | many-to-one |
| [Navigationguard](#navigationguard)           | aggregates      | outbound  | many-to-one |
| [Navigationtransition](#navigationtransition) | aggregates      | outbound  | many-to-one |
| [Route](#route)                               | aggregates      | outbound  | many-to-one |
| [Navigationtransition](#navigationtransition) | composes        | outbound  | many-to-one |
| [Route](#route)                               | composes        | outbound  | many-to-one |

[Back to Index](#report-index)

### Navigationguard {#navigationguard}

**Spec Node ID**: `navigation.navigationguard`

Guard condition for route access

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality |
| --------------------------------------------- | ---------- | --------- | ----------- |
| [Flowstep](#flowstep)                         | requires   | inbound   | many-to-one |
| [Navigationflow](#navigationflow)             | requires   | inbound   | many-to-one |
| [Navigationgraph](#navigationgraph)           | aggregates | inbound   | many-to-one |
| [Navigationtransition](#navigationtransition) | constrains | outbound  | many-to-one |
| [Contextvariable](#contextvariable)           | consumes   | outbound  | many-to-one |
| [Route](#route)                               | protects   | outbound  | many-to-one |
| [Guardaction](#guardaction)                   | triggers   | outbound  | many-to-one |
| [Guardcondition](#guardcondition)             | uses       | outbound  | many-to-one |
| [Navigationtransition](#navigationtransition) | requires   | inbound   | many-to-one |
| [Routemeta](#routemeta)                       | governs    | inbound   | many-to-one |

[Back to Index](#report-index)

### Navigationtransition {#navigationtransition}

**Spec Node ID**: `navigation.navigationtransition`

Transition from one route to another

#### Relationship Metrics

- **Intra-Layer**: Inbound: 9 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate    | Direction | Cardinality |
| ----------------------------------- | ------------ | --------- | ----------- |
| [Contextvariable](#contextvariable) | triggers     | inbound   | many-to-one |
| [Flowstep](#flowstep)               | triggers     | inbound   | many-to-one |
| [Navigationflow](#navigationflow)   | flows-to     | inbound   | many-to-one |
| [Navigationgraph](#navigationgraph) | aggregates   | inbound   | many-to-one |
| [Navigationgraph](#navigationgraph) | composes     | inbound   | many-to-one |
| [Navigationguard](#navigationguard) | constrains   | inbound   | many-to-one |
| [Route](#route)                     | flows-to     | outbound  | many-to-one |
| [Route](#route)                     | navigates-to | outbound  | many-to-one |
| [Navigationguard](#navigationguard) | requires     | outbound  | many-to-one |
| [Guardaction](#guardaction)         | triggers     | outbound  | many-to-one |
| [Contextvariable](#contextvariable) | uses         | outbound  | many-to-one |
| [Route](#route)                     | flows-to     | inbound   | many-to-one |
| [Route](#route)                     | triggers     | inbound   | many-to-one |
| [Routemeta](#routemeta)             | uses         | inbound   | many-to-one |

[Back to Index](#report-index)

### Route {#route}

**Spec Node ID**: `navigation.route`

Single route/destination in the application (channel-agnostic)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 14 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate       | Direction | Cardinality |
| --------------------------------------------- | --------------- | --------- | ----------- |
| [Breadcrumbconfig](#breadcrumbconfig)         | references      | inbound   | many-to-one |
| [Contextvariable](#contextvariable)           | consumes        | inbound   | many-to-one |
| [Flowstep](#flowstep)                         | navigates-to    | inbound   | many-to-one |
| [Flowstep](#flowstep)                         | realizes        | inbound   | many-to-one |
| [Guardaction](#guardaction)                   | navigates-to    | inbound   | many-to-one |
| [Guardcondition](#guardcondition)             | constrains      | inbound   | many-to-one |
| [Navigationgraph](#navigationgraph)           | aggregates      | inbound   | many-to-one |
| [Navigationgraph](#navigationgraph)           | composes        | inbound   | many-to-one |
| [Navigationguard](#navigationguard)           | protects        | inbound   | many-to-one |
| [Navigationtransition](#navigationtransition) | flows-to        | inbound   | many-to-one |
| [Navigationtransition](#navigationtransition) | navigates-to    | inbound   | many-to-one |
| [Route](#route)                               | aggregates      | outbound  | many-to-one |
| [Routemeta](#routemeta)                       | associated-with | outbound  | many-to-one |
| [Routemeta](#routemeta)                       | composes        | outbound  | many-to-one |
| [Navigationtransition](#navigationtransition) | flows-to        | outbound  | many-to-one |
| [Route](#route)                               | navigates-to    | outbound  | many-to-one |
| [Navigationtransition](#navigationtransition) | triggers        | outbound  | many-to-one |
| [Routemeta](#routemeta)                       | serves          | inbound   | many-to-one |

[Back to Index](#report-index)

### Routemeta {#routemeta}

**Spec Node ID**: `navigation.routemeta`

Per-route rendering and access configuration attached to a Route node and consumed by the SPA router at runtime. Covers layout selection, component instance caching, animation transitions, breadcrumb labeling, and access control hints. Security attributes (requiresAuth, roles, permissions) are navigation hints that should be enforced through NavigationGuard nodes in the security layer.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 4 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate       | Direction | Cardinality |
| --------------------------------------------- | --------------- | --------- | ----------- |
| [Breadcrumbconfig](#breadcrumbconfig)         | provides        | inbound   | many-to-one |
| [Guardcondition](#guardcondition)             | references      | inbound   | many-to-one |
| [Route](#route)                               | associated-with | inbound   | many-to-one |
| [Route](#route)                               | composes        | inbound   | many-to-one |
| [Navigationguard](#navigationguard)           | governs         | outbound  | many-to-one |
| [Breadcrumbconfig](#breadcrumbconfig)         | references      | outbound  | many-to-one |
| [Route](#route)                               | serves          | outbound  | many-to-one |
| [Navigationtransition](#navigationtransition) | uses            | outbound  | many-to-one |

[Back to Index](#report-index)

---

_Generated: 2026-03-05T22:49:42.793Z | Spec Version: 0.8.1 | Generator: generate-layer-reports.ts_
