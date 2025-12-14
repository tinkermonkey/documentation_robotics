# Application Layer - Intra-Layer Relationships

## Overview

**Purpose**: Define semantic links between entities WITHIN this layer, capturing
structural composition, behavioral dependencies, and influence relationships.

**Layer ID**: `04-application`
**Analysis Date**: Generated automatically
**Validation**: Uses MarkdownLayerParser for closed-loop validation

---

### Relationship Diagram

```mermaid
graph TB
  subgraph "Application Layer"

    ApplicationCollaboration["ApplicationCollaboration"]
    ApplicationComponent["ApplicationComponent"]
    ApplicationEvent["ApplicationEvent"]
    ApplicationFunction["ApplicationFunction"]
    ApplicationInteraction["ApplicationInteraction"]
    ApplicationInterface["ApplicationInterface"]
    ApplicationProcess["ApplicationProcess"]
    ApplicationService["ApplicationService"]
    DataObject["DataObject"]

    ApplicationComponent -->|composes| ApplicationInterface
    ApplicationComponent -->|assigned-to| ApplicationFunction
    ApplicationComponent -->|realizes| ApplicationService
    ApplicationCollaboration -->|aggregates| ApplicationComponent
    ApplicationCollaboration -->|assigned-to| ApplicationInteraction
    ApplicationInterface -->|serves| ApplicationComponent
    ApplicationFunction -->|realizes| ApplicationService
    ApplicationFunction -->|accesses| DataObject
    ApplicationInteraction -->|accesses| DataObject
    ApplicationProcess -->|composes| ApplicationProcess
    ApplicationProcess -->|realizes| ApplicationService
    ApplicationProcess -->|triggers| ApplicationEvent
    ApplicationProcess -->|flows-to| ApplicationProcess
    ApplicationProcess -->|accesses| DataObject
    ApplicationEvent -->|triggers| ApplicationComponent
    ApplicationEvent -->|triggers| ApplicationFunction
    ApplicationEvent -->|triggers| ApplicationProcess
    ApplicationService -->|realizes| ApplicationInterface
    ApplicationService -->|flows-to| ApplicationService
    ApplicationService -->|accesses| DataObject
    ApplicationService -->|used-by| BusinessProcess
    DataObject -->|specializes| DataObject
  end

  %% Styling
  classDef default fill:#E3F2FD,stroke:#1976D2,stroke-width:2px
```

## Layer Summary

### Entity Coverage (Target: 2+ relationships per entity)

- **Entities Meeting Target**: 9/9
- **Entity Coverage**: 100.0%

### Coverage Matrix

| Entity                   | Outgoing | Incoming | Total  | Meets Target | Status     |
| ------------------------ | -------- | -------- | ------ | ------------ | ---------- |
| ApplicationCollaboration | 2        | 0        | 2      | ✓            | Complete   |
| ApplicationComponent     | 3        | 3        | 6      | ✓            | Complete   |
| ApplicationEvent         | 3        | 1        | 4      | ✓            | Complete   |
| ApplicationFunction      | 2        | 2        | 4      | ✓            | Complete   |
| ApplicationInteraction   | 1        | 1        | 2      | ✓            | Complete   |
| ApplicationInterface     | 1        | 2        | 3      | ✓            | Complete   |
| ApplicationProcess       | 5        | 3        | 8      | ✓            | Complete   |
| ApplicationService       | 4        | 4        | 8      | ✓            | Complete   |
| DataObject               | 1        | 5        | 6      | ✓            | Complete   |
| **TOTAL**                | **-**    | **-**    | **43** | **9/9**      | **100.0%** |

### Relationship Statistics

- **Total Unique Relationships**: 22
- **Total Connections (Entity Perspective)**: 43
- **Average Connections per Entity**: 4.8
- **Entity Coverage Target**: 2+ relationships

## Entity: ApplicationCollaboration

**Definition**: Aggregate of application components working together

### Outgoing Relationships (ApplicationCollaboration → Other Entities)

| Relationship Type | Target Entity          | Predicate     | Status | Source                                                         | In Catalog | Documented |
| ----------------- | ---------------------- | ------------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| aggregation       | ApplicationComponent   | `aggregates`  | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| assignment        | ApplicationInteraction | `assigned-to` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Incoming Relationships (Other Entities → ApplicationCollaboration)

_No incoming intra-layer relationships documented._

### Relationship Summary

- **Total Relationships**: 2
- **Outgoing**: 2
- **Incoming**: 0
- **Documented**: 0/2
- **With XML Examples**: 2/2
- **In Catalog**: 2/2

---

## Entity: ApplicationComponent

**Definition**: Modular, deployable, and replaceable part of a system

### Outgoing Relationships (ApplicationComponent → Other Entities)

| Relationship Type | Target Entity        | Predicate     | Status | Source                                                         | In Catalog | Documented |
| ----------------- | -------------------- | ------------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| assignment        | ApplicationFunction  | `assigned-to` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| composition       | ApplicationInterface | `composes`    | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| realization       | ApplicationService   | `realizes`    | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Incoming Relationships (Other Entities → ApplicationComponent)

| Relationship Type | Source Entity            | Predicate    | Status | Source                                                         | In Catalog | Documented |
| ----------------- | ------------------------ | ------------ | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| aggregation       | ApplicationCollaboration | `aggregates` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| triggering        | ApplicationEvent         | `triggers`   | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| serving           | ApplicationInterface     | `serves`     | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Relationship Summary

- **Total Relationships**: 6
- **Outgoing**: 3
- **Incoming**: 3
- **Documented**: 0/6
- **With XML Examples**: 6/6
- **In Catalog**: 6/6

---

## Entity: ApplicationEvent

**Definition**: Application state change notification

### Outgoing Relationships (ApplicationEvent → Other Entities)

| Relationship Type | Target Entity        | Predicate  | Status | Source                                                         | In Catalog | Documented |
| ----------------- | -------------------- | ---------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| triggering        | ApplicationComponent | `triggers` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| triggering        | ApplicationFunction  | `triggers` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| triggering        | ApplicationProcess   | `triggers` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Incoming Relationships (Other Entities → ApplicationEvent)

| Relationship Type | Source Entity      | Predicate  | Status | Source                                                         | In Catalog | Documented |
| ----------------- | ------------------ | ---------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| triggering        | ApplicationProcess | `triggers` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Relationship Summary

- **Total Relationships**: 4
- **Outgoing**: 3
- **Incoming**: 1
- **Documented**: 0/4
- **With XML Examples**: 4/4
- **In Catalog**: 4/4

---

## Entity: ApplicationFunction

**Definition**: Automated behavior performed by application component

### Outgoing Relationships (ApplicationFunction → Other Entities)

| Relationship Type | Target Entity      | Predicate  | Status | Source                                                         | In Catalog | Documented |
| ----------------- | ------------------ | ---------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| realization       | ApplicationService | `realizes` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| access            | DataObject         | `accesses` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Incoming Relationships (Other Entities → ApplicationFunction)

| Relationship Type | Source Entity        | Predicate     | Status | Source                                                         | In Catalog | Documented |
| ----------------- | -------------------- | ------------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| assignment        | ApplicationComponent | `assigned-to` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| triggering        | ApplicationEvent     | `triggers`    | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Relationship Summary

- **Total Relationships**: 4
- **Outgoing**: 2
- **Incoming**: 2
- **Documented**: 0/4
- **With XML Examples**: 4/4
- **In Catalog**: 4/4

---

## Entity: ApplicationInteraction

**Definition**: Unit of collective application behavior

### Outgoing Relationships (ApplicationInteraction → Other Entities)

| Relationship Type | Target Entity | Predicate  | Status | Source                                                         | In Catalog | Documented |
| ----------------- | ------------- | ---------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| access            | DataObject    | `accesses` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Incoming Relationships (Other Entities → ApplicationInteraction)

| Relationship Type | Source Entity            | Predicate     | Status | Source                                                         | In Catalog | Documented |
| ----------------- | ------------------------ | ------------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| assignment        | ApplicationCollaboration | `assigned-to` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Relationship Summary

- **Total Relationships**: 2
- **Outgoing**: 1
- **Incoming**: 1
- **Documented**: 0/2
- **With XML Examples**: 2/2
- **In Catalog**: 2/2

---

## Entity: ApplicationInterface

**Definition**: Point of access where application service is available

### Outgoing Relationships (ApplicationInterface → Other Entities)

| Relationship Type | Target Entity        | Predicate | Status | Source                                                         | In Catalog | Documented |
| ----------------- | -------------------- | --------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| serving           | ApplicationComponent | `serves`  | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Incoming Relationships (Other Entities → ApplicationInterface)

| Relationship Type | Source Entity        | Predicate  | Status | Source                                                         | In Catalog | Documented |
| ----------------- | -------------------- | ---------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| composition       | ApplicationComponent | `composes` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| realization       | ApplicationService   | `realizes` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Relationship Summary

- **Total Relationships**: 3
- **Outgoing**: 1
- **Incoming**: 2
- **Documented**: 0/3
- **With XML Examples**: 3/3
- **In Catalog**: 3/3

---

## Entity: ApplicationProcess

**Definition**: Sequence of application behaviors

### Outgoing Relationships (ApplicationProcess → Other Entities)

| Relationship Type | Target Entity      | Predicate  | Status | Source                                                         | In Catalog | Documented |
| ----------------- | ------------------ | ---------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| triggering        | ApplicationEvent   | `triggers` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| composition       | ApplicationProcess | `composes` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| flow              | ApplicationProcess | `flows-to` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| realization       | ApplicationService | `realizes` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| access            | DataObject         | `accesses` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Incoming Relationships (Other Entities → ApplicationProcess)

| Relationship Type | Source Entity      | Predicate  | Status | Source                                                         | In Catalog | Documented |
| ----------------- | ------------------ | ---------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| triggering        | ApplicationEvent   | `triggers` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| composition       | ApplicationProcess | `composes` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| flow              | ApplicationProcess | `flows-to` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Relationship Summary

- **Total Relationships**: 8
- **Outgoing**: 5
- **Incoming**: 3
- **Documented**: 0/8
- **With XML Examples**: 8/8
- **In Catalog**: 8/8

---

## Entity: ApplicationService

**Definition**: Service that exposes application functionality

### Outgoing Relationships (ApplicationService → Other Entities)

| Relationship Type | Target Entity        | Predicate  | Status     | Source                                                         | In Catalog | Documented                                                   |
| ----------------- | -------------------- | ---------- | ---------- | -------------------------------------------------------------- | ---------- | ------------------------------------------------------------ |
| realization       | ApplicationInterface | `realizes` | XML        | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗                                                            |
| flow              | ApplicationService   | `flows-to` | XML        | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗                                                            |
| used by           | BusinessProcess      | `used-by`  | Documented | [Doc](../../spec/layers/04-application-layer.md#relationships) | ✓          | [✓](../../spec/layers/04-application-layer.md#relationships) |
| access            | DataObject           | `accesses` | XML        | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗                                                            |

### Incoming Relationships (Other Entities → ApplicationService)

| Relationship Type | Source Entity        | Predicate  | Status | Source                                                         | In Catalog | Documented |
| ----------------- | -------------------- | ---------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| realization       | ApplicationComponent | `realizes` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| realization       | ApplicationFunction  | `realizes` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| realization       | ApplicationProcess   | `realizes` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| flow              | ApplicationService   | `flows-to` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Relationship Summary

- **Total Relationships**: 8
- **Outgoing**: 4
- **Incoming**: 4
- **Documented**: 1/8
- **With XML Examples**: 7/8
- **In Catalog**: 8/8

---

## Entity: DataObject

**Definition**: Data structured for automated processing

### Outgoing Relationships (DataObject → Other Entities)

| Relationship Type | Target Entity | Predicate     | Status | Source                                                         | In Catalog | Documented |
| ----------------- | ------------- | ------------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| specialization    | DataObject    | `specializes` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Incoming Relationships (Other Entities → DataObject)

| Relationship Type | Source Entity          | Predicate     | Status | Source                                                         | In Catalog | Documented |
| ----------------- | ---------------------- | ------------- | ------ | -------------------------------------------------------------- | ---------- | ---------- |
| access            | ApplicationFunction    | `accesses`    | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| access            | ApplicationInteraction | `accesses`    | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| access            | ApplicationProcess     | `accesses`    | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| access            | ApplicationService     | `accesses`    | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |
| specialization    | DataObject             | `specializes` | XML    | [XML](../../spec/layers/04-application-layer.md#example-model) | ✓          | ✗          |

### Relationship Summary

- **Total Relationships**: 6
- **Outgoing**: 1
- **Incoming**: 5
- **Documented**: 0/6
- **With XML Examples**: 6/6
- **In Catalog**: 6/6

---
