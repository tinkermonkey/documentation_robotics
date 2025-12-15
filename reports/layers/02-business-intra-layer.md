# Business Layer - Intra-Layer Relationships

## Overview

**Purpose**: Define semantic links between entities WITHIN this layer, capturing
structural composition, behavioral dependencies, and influence relationships.

**Layer ID**: `02-business`
**Analysis Date**: Generated automatically
**Validation**: Uses MarkdownLayerParser for closed-loop validation

---

### Relationship Diagram

```mermaid
graph TB
  subgraph "Business Layer"

    BusinessActor["BusinessActor"]
    BusinessCollaboration["BusinessCollaboration"]
    BusinessEvent["BusinessEvent"]
    BusinessFunction["BusinessFunction"]
    BusinessInteraction["BusinessInteraction"]
    BusinessInterface["BusinessInterface"]
    BusinessObject["BusinessObject"]
    BusinessProcess["BusinessProcess"]
    BusinessRole["BusinessRole"]
    BusinessService["BusinessService"]
    Contract["Contract"]
    Product["Product"]
    Representation["Representation"]

    BusinessActor -->|assigned-to| BusinessRole
    BusinessActor -->|assigned-to| BusinessProcess
    BusinessRole -->|assigned-to| BusinessProcess
    BusinessRole -->|assigned-to| BusinessFunction
    BusinessRole -->|specializes| BusinessRole
    BusinessCollaboration -->|composes| BusinessRole
    BusinessCollaboration -->|aggregates| BusinessRole
    BusinessCollaboration -->|assigned-to| BusinessInteraction
    BusinessInterface -->|serves| BusinessActor
    BusinessInterface -->|serves| BusinessRole
    BusinessProcess -->|composes| BusinessProcess
    BusinessProcess -->|realizes| BusinessService
    BusinessProcess -->|triggers| BusinessEvent
    BusinessProcess -->|flows-to| BusinessProcess
    BusinessProcess -->|accesses| BusinessObject
    BusinessProcess -->|accesses| Representation
    BusinessFunction -->|composes| BusinessProcess
    BusinessFunction -->|realizes| BusinessService
    BusinessFunction -->|accesses| BusinessObject
    BusinessInteraction -->|realizes| BusinessService
    BusinessInteraction -->|triggers| BusinessProcess
    BusinessInteraction -->|flows-to| BusinessProcess
    BusinessInteraction -->|accesses| BusinessObject
    BusinessEvent -->|triggers| BusinessProcess
    BusinessEvent -->|triggers| BusinessFunction
    BusinessEvent -->|triggers| BusinessInteraction
    BusinessService -->|serves| BusinessActor
    BusinessService -->|serves| BusinessRole
    BusinessService -->|serves| BusinessProcess
    BusinessObject -->|specializes| BusinessObject
    BusinessObject -->|associated-with| BusinessProcess
    Contract -->|specializes| Contract
    Contract -->|associated-with| BusinessService
    Representation -->|realizes| BusinessObject
    Product -->|composes| BusinessService
    Product -->|aggregates| BusinessService
    Product -->|aggregates| Contract
  end

  %% Styling
  classDef default fill:#E3F2FD,stroke:#1976D2,stroke-width:2px
```

## Layer Summary

### Entity Coverage (Target: 2+ relationships per entity)

- **Entities Meeting Target**: 13/13
- **Entity Coverage**: 100.0%

### Coverage Matrix

| Entity                | Outgoing | Incoming | Total  | Meets Target | Status     |
| --------------------- | -------- | -------- | ------ | ------------ | ---------- |
| BusinessActor         | 2        | 2        | 4      | ✓            | Complete   |
| BusinessCollaboration | 3        | 0        | 3      | ✓            | Complete   |
| BusinessEvent         | 3        | 1        | 4      | ✓            | Complete   |
| BusinessFunction      | 3        | 2        | 5      | ✓            | Complete   |
| BusinessInteraction   | 4        | 2        | 6      | ✓            | Complete   |
| BusinessInterface     | 2        | 0        | 2      | ✓            | Complete   |
| BusinessObject        | 2        | 5        | 7      | ✓            | Complete   |
| BusinessProcess       | 6        | 10       | 16     | ✓            | Complete   |
| BusinessRole          | 3        | 6        | 9      | ✓            | Complete   |
| BusinessService       | 3        | 6        | 9      | ✓            | Complete   |
| Contract              | 2        | 2        | 4      | ✓            | Complete   |
| Product               | 3        | 0        | 3      | ✓            | Complete   |
| Representation        | 1        | 1        | 2      | ✓            | Complete   |
| **TOTAL**             | **-**    | **-**    | **74** | **13/13**    | **100.0%** |

### Relationship Statistics

- **Total Unique Relationships**: 37
- **Total Connections (Entity Perspective)**: 74
- **Average Connections per Entity**: 5.7
- **Entity Coverage Target**: 2+ relationships

## Entity: BusinessActor

**Definition**: An organizational entity capable of performing behavior

### Outgoing Relationships (BusinessActor → Other Entities)

| Relationship Type | Target Entity   | Predicate     | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | --------------- | ------------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| assigned to       | BusinessProcess | `assigned-to` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| assigned to       | BusinessRole    | `assigned-to` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Incoming Relationships (Other Entities → BusinessActor)

| Relationship Type | Source Entity     | Predicate | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | ----------------- | --------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| serves            | BusinessInterface | `serves`  | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| serves            | BusinessService   | `serves`  | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Relationship Summary

- **Total Relationships**: 4
- **Outgoing**: 2
- **Incoming**: 2
- **Documented**: 4/4
- **With XML Examples**: 0/4
- **In Catalog**: 4/4

---

## Entity: BusinessCollaboration

**Definition**: Aggregate of business roles working together

### Outgoing Relationships (BusinessCollaboration → Other Entities)

| Relationship Type | Target Entity       | Predicate     | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | ------------------- | ------------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| assigned to       | BusinessInteraction | `assigned-to` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| aggregates        | BusinessRole        | `aggregates`  | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| composes          | BusinessRole        | `composes`    | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Incoming Relationships (Other Entities → BusinessCollaboration)

_No incoming intra-layer relationships documented._

### Relationship Summary

- **Total Relationships**: 3
- **Outgoing**: 3
- **Incoming**: 0
- **Documented**: 3/3
- **With XML Examples**: 0/3
- **In Catalog**: 3/3

---

## Entity: BusinessEvent

**Definition**: Something that happens and influences behavior

### Outgoing Relationships (BusinessEvent → Other Entities)

| Relationship Type | Target Entity       | Predicate  | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | ------------------- | ---------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| triggers          | BusinessFunction    | `triggers` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| triggers          | BusinessInteraction | `triggers` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| triggers          | BusinessProcess     | `triggers` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Incoming Relationships (Other Entities → BusinessEvent)

| Relationship Type | Source Entity   | Predicate  | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | --------------- | ---------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| triggers          | BusinessProcess | `triggers` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Relationship Summary

- **Total Relationships**: 4
- **Outgoing**: 3
- **Incoming**: 1
- **Documented**: 4/4
- **With XML Examples**: 0/4
- **In Catalog**: 4/4

---

## Entity: BusinessFunction

**Definition**: Collection of business behavior based on criteria

### Outgoing Relationships (BusinessFunction → Other Entities)

| Relationship Type | Target Entity   | Predicate  | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | --------------- | ---------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| accesses          | BusinessObject  | `accesses` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| composes          | BusinessProcess | `composes` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| realizes          | BusinessService | `realizes` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Incoming Relationships (Other Entities → BusinessFunction)

| Relationship Type | Source Entity | Predicate     | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | ------------- | ------------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| triggers          | BusinessEvent | `triggers`    | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| assigned to       | BusinessRole  | `assigned-to` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Relationship Summary

- **Total Relationships**: 5
- **Outgoing**: 3
- **Incoming**: 2
- **Documented**: 5/5
- **With XML Examples**: 0/5
- **In Catalog**: 5/5

---

## Entity: BusinessInteraction

**Definition**: Unit of collective behavior by collaboration

### Outgoing Relationships (BusinessInteraction → Other Entities)

| Relationship Type | Target Entity   | Predicate  | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | --------------- | ---------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| accesses          | BusinessObject  | `accesses` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| flows to          | BusinessProcess | `flows-to` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| triggers          | BusinessProcess | `triggers` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| realizes          | BusinessService | `realizes` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Incoming Relationships (Other Entities → BusinessInteraction)

| Relationship Type | Source Entity         | Predicate     | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | --------------------- | ------------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| assigned to       | BusinessCollaboration | `assigned-to` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| triggers          | BusinessEvent         | `triggers`    | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Relationship Summary

- **Total Relationships**: 6
- **Outgoing**: 4
- **Incoming**: 2
- **Documented**: 6/6
- **With XML Examples**: 0/6
- **In Catalog**: 6/6

---

## Entity: BusinessInterface

**Definition**: Point of access where business service is available

### Outgoing Relationships (BusinessInterface → Other Entities)

| Relationship Type | Target Entity | Predicate | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | ------------- | --------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| serves            | BusinessActor | `serves`  | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| serves            | BusinessRole  | `serves`  | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Incoming Relationships (Other Entities → BusinessInterface)

_No incoming intra-layer relationships documented._

### Relationship Summary

- **Total Relationships**: 2
- **Outgoing**: 2
- **Incoming**: 0
- **Documented**: 2/2
- **With XML Examples**: 0/2
- **In Catalog**: 2/2

---

## Entity: BusinessObject

**Definition**: Concept used within business domain

### Outgoing Relationships (BusinessObject → Other Entities)

| Relationship Type | Target Entity   | Predicate         | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | --------------- | ----------------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| specializes       | BusinessObject  | `specializes`     | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| associated with   | BusinessProcess | `associated-with` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Incoming Relationships (Other Entities → BusinessObject)

| Relationship Type | Source Entity       | Predicate     | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | ------------------- | ------------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| accesses          | BusinessFunction    | `accesses`    | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| accesses          | BusinessInteraction | `accesses`    | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| specializes       | BusinessObject      | `specializes` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| accesses          | BusinessProcess     | `accesses`    | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| realizes          | Representation      | `realizes`    | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Relationship Summary

- **Total Relationships**: 7
- **Outgoing**: 2
- **Incoming**: 5
- **Documented**: 7/7
- **With XML Examples**: 0/7
- **In Catalog**: 7/7

---

## Entity: BusinessProcess

**Definition**: Sequence of business behaviors achieving a result

### Outgoing Relationships (BusinessProcess → Other Entities)

| Relationship Type | Target Entity   | Predicate  | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | --------------- | ---------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| triggers          | BusinessEvent   | `triggers` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| accesses          | BusinessObject  | `accesses` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| composes          | BusinessProcess | `composes` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| flows to          | BusinessProcess | `flows-to` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| realizes          | BusinessService | `realizes` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| access            | Representation  | `accesses` | XML        | [XML](../../spec/layers/02-business-layer.md#example-model) | ✓          | ✗                                                         |

### Incoming Relationships (Other Entities → BusinessProcess)

| Relationship Type | Source Entity       | Predicate         | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | ------------------- | ----------------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| assigned to       | BusinessActor       | `assigned-to`     | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| triggers          | BusinessEvent       | `triggers`        | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| composes          | BusinessFunction    | `composes`        | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| flows to          | BusinessInteraction | `flows-to`        | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| triggers          | BusinessInteraction | `triggers`        | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| associated with   | BusinessObject      | `associated-with` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| composes          | BusinessProcess     | `composes`        | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| flows to          | BusinessProcess     | `flows-to`        | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| assigned to       | BusinessRole        | `assigned-to`     | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| serves            | BusinessService     | `serves`          | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Relationship Summary

- **Total Relationships**: 16
- **Outgoing**: 6
- **Incoming**: 10
- **Documented**: 15/16
- **With XML Examples**: 1/16
- **In Catalog**: 16/16

---

## Entity: BusinessRole

**Definition**: The responsibility for performing specific behavior

### Outgoing Relationships (BusinessRole → Other Entities)

| Relationship Type | Target Entity    | Predicate     | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | ---------------- | ------------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| assigned to       | BusinessFunction | `assigned-to` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| assigned to       | BusinessProcess  | `assigned-to` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| specializes       | BusinessRole     | `specializes` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Incoming Relationships (Other Entities → BusinessRole)

| Relationship Type | Source Entity         | Predicate     | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | --------------------- | ------------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| assigned to       | BusinessActor         | `assigned-to` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| aggregates        | BusinessCollaboration | `aggregates`  | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| composes          | BusinessCollaboration | `composes`    | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| serves            | BusinessInterface     | `serves`      | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| specializes       | BusinessRole          | `specializes` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| serves            | BusinessService       | `serves`      | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Relationship Summary

- **Total Relationships**: 9
- **Outgoing**: 3
- **Incoming**: 6
- **Documented**: 9/9
- **With XML Examples**: 0/9
- **In Catalog**: 9/9

---

## Entity: BusinessService

**Definition**: Service that fulfills a business need

### Outgoing Relationships (BusinessService → Other Entities)

| Relationship Type | Target Entity   | Predicate | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | --------------- | --------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| serves            | BusinessActor   | `serves`  | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| serves            | BusinessProcess | `serves`  | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| serves            | BusinessRole    | `serves`  | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Incoming Relationships (Other Entities → BusinessService)

| Relationship Type | Source Entity       | Predicate         | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | ------------------- | ----------------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| realizes          | BusinessFunction    | `realizes`        | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| realizes          | BusinessInteraction | `realizes`        | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| realizes          | BusinessProcess     | `realizes`        | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| associated with   | Contract            | `associated-with` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| aggregates        | Product             | `aggregates`      | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| composes          | Product             | `composes`        | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Relationship Summary

- **Total Relationships**: 9
- **Outgoing**: 3
- **Incoming**: 6
- **Documented**: 9/9
- **With XML Examples**: 0/9
- **In Catalog**: 9/9

---

## Entity: Contract

**Definition**: Formal specification of agreement

### Outgoing Relationships (Contract → Other Entities)

| Relationship Type | Target Entity   | Predicate         | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | --------------- | ----------------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| associated with   | BusinessService | `associated-with` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| specializes       | Contract        | `specializes`     | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Incoming Relationships (Other Entities → Contract)

| Relationship Type | Source Entity | Predicate     | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | ------------- | ------------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| specializes       | Contract      | `specializes` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| aggregates        | Product       | `aggregates`  | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Relationship Summary

- **Total Relationships**: 4
- **Outgoing**: 2
- **Incoming**: 2
- **Documented**: 4/4
- **With XML Examples**: 0/4
- **In Catalog**: 4/4

---

## Entity: Product

**Definition**: Coherent collection of services with a value

### Outgoing Relationships (Product → Other Entities)

| Relationship Type | Target Entity   | Predicate    | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | --------------- | ------------ | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| aggregates        | BusinessService | `aggregates` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| composes          | BusinessService | `composes`   | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |
| aggregates        | Contract        | `aggregates` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Incoming Relationships (Other Entities → Product)

_No incoming intra-layer relationships documented._

### Relationship Summary

- **Total Relationships**: 3
- **Outgoing**: 3
- **Incoming**: 0
- **Documented**: 3/3
- **With XML Examples**: 0/3
- **In Catalog**: 3/3

---

## Entity: Representation

**Definition**: Perceptible form of business object

### Outgoing Relationships (Representation → Other Entities)

| Relationship Type | Target Entity  | Predicate  | Status     | Source                                                      | In Catalog | Documented                                                |
| ----------------- | -------------- | ---------- | ---------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| realizes          | BusinessObject | `realizes` | Documented | [Doc](../../spec/layers/02-business-layer.md#relationships) | ✓          | [✓](../../spec/layers/02-business-layer.md#relationships) |

### Incoming Relationships (Other Entities → Representation)

| Relationship Type | Source Entity   | Predicate  | Status | Source                                                      | In Catalog | Documented |
| ----------------- | --------------- | ---------- | ------ | ----------------------------------------------------------- | ---------- | ---------- |
| access            | BusinessProcess | `accesses` | XML    | [XML](../../spec/layers/02-business-layer.md#example-model) | ✓          | ✗          |

### Relationship Summary

- **Total Relationships**: 2
- **Outgoing**: 1
- **Incoming**: 1
- **Documented**: 1/2
- **With XML Examples**: 1/2
- **In Catalog**: 2/2

---
