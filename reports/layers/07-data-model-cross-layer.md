# Data Model Layer - Cross-Layer Relationships

## Cross-Layer Relationships

**Purpose**: Define semantic links to entities in other layers, supporting traceability, governance, and architectural alignment.

### Cross-Layer Relationship Diagram

```mermaid
graph TB
  subgraph thisLayer["07: Data Model Layer"]
    thisColumn["Column"]
    thisDataQualityMetric["DataQualityMetric"]
    thisDatabase["Database"]
    thisGovernance["Governance"]
    thisGovernanceOwner["GovernanceOwner"]
    thisRetention["Retention"]
    thisTable["Table"]
  end

  %% Target layers
  subgraph target02Layer["02: Business Layer"]
    target02BusinessObject["BusinessObject"]
  end
  subgraph target04Layer["04: Application Layer"]
    target04Element["Element"]
  end
  subgraph target07Layer["07: Data Model Layer"]
    target07DataQualityMetric["DataQualityMetric"]
    target07Database["Database"]
    target07Governance["Governance"]
  end

  %% Source layers
  subgraph source02Layer["02: Business Layer"]
    source02Node["Any Business Layer entity"]
  end
  subgraph source04Layer["04: Application Layer"]
    source04Node["Any Application Layer entity"]
  end
  subgraph source06Layer["06: API Layer"]
    source06Node["Any API Layer entity"]
  end

  %% Outgoing relationships
  thisColumn -->|archimate-ref| target04Element
  thisColumn -->|business-object-ref| target02BusinessObject
  thisColumn -->|apm-data-quality-metrics| target07DataQualityMetric
  thisColumn -->|data-governance| target07Governance
  thisColumn -->|database| target07Database

  %% Incoming relationships
  source02Node -->|governance-owner| thisGovernanceOwner
  source04Node -->|retention| thisRetention
  source06Node -->|database-column| thisColumn
  source06Node -->|database-table| thisTable

  %% Styling
  classDef thisLayerStyle fill:#4ECDC4,stroke:#333,stroke-width:3px
  classDef targetLayerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef sourceLayerStyle fill:#E17055,stroke:#333,stroke-width:2px

  class thisColumn thisLayerStyle
  class thisDataQualityMetric thisLayerStyle
  class thisDatabase thisLayerStyle
  class thisGovernance thisLayerStyle
  class thisGovernanceOwner thisLayerStyle
  class thisRetention thisLayerStyle
  class thisTable thisLayerStyle
  class target02BusinessObject targetLayerStyle
  class target04Element targetLayerStyle
  class target07DataQualityMetric targetLayerStyle
  class target07Database targetLayerStyle
  class target07Governance targetLayerStyle
  class source02Node sourceLayerStyle
  class source04Node sourceLayerStyle
  class source06Node sourceLayerStyle
```

### Outgoing Relationships (This Layer → Other Layers)

Links from entities in this layer to entities in other layers.

#### To Business Layer (02)

Links to business services, processes, and actors.

| Predicate             | Source Element                                                    | Target Element | Field Path              | Description                                    | Documented |
| --------------------- | ----------------------------------------------------------------- | -------------- | ----------------------- | ---------------------------------------------- | ---------- |
| `business-object-ref` | JSONSchema, x-business-object-ref Extension, x-security Extension | BusinessObject | `x-business-object-ref` | string (BusinessObject.id reference, optional) | ✗          |

**Example**:

```yaml
properties:
  x-business-object-ref:
    type: string
    description: string (BusinessObject.id reference, optional)
    example: "target-id-1"
```

#### To Application Layer (04)

Links to application layer elements.

| Predicate       | Source Element                   | Target Element | Field Path        | Description                                         | Documented |
| --------------- | -------------------------------- | -------------- | ----------------- | --------------------------------------------------- | ---------- |
| `archimate-ref` | JSONSchema, x-security Extension | Element        | `x-archimate-ref` | string (Element.id reference to ApplicationService) | ✗          |

**Example**:

```yaml
properties:
  x-archimate-ref:
    type: string
    description: string (Element.id reference to ApplicationService)
    example: "target-id-1"
```

#### To Data Model Layer (07)

Links to data schemas, tables, and columns.

| Predicate                  | Source Element                                                         | Target Element    | Field Path                   | Description                   | Documented |
| -------------------------- | ---------------------------------------------------------------------- | ----------------- | ---------------------------- | ----------------------------- | ---------- |
| `apm-data-quality-metrics` | JSONSchema, x-apm-data-quality-metrics Extension, x-security Extension | DataQualityMetric | `x-apm-data-quality-metrics` | DataQualityMetrics (optional) | ✗          |
| `data-governance`          | JSONSchema, x-data-governance Extension, x-security Extension          | Governance        | `x-data-governance`          | DataGovernance (optional)     | ✗          |
| `database`                 | JSONSchema, SchemaProperty, x-database Extension, x-security Extension | Database          | `x-database`                 | DatabaseMapping (optional)    | ✗          |

**Example**:

```yaml
properties:
  x-apm-data-quality-metrics:
    type: string
    description: DataQualityMetrics (optional)
    example: "target-id-1"
```

### Incoming Relationships (Other Layers → This Layer)

Links from entities in other layers to entities in this layer.

#### From Business Layer (02)

| Predicate          | Source Element | Target Element  | Field Path              | Description                               | Documented                                 |
| ------------------ | -------------- | --------------- | ----------------------- | ----------------------------------------- | ------------------------------------------ |
| `governance-owner` | BusinessObject | GovernanceOwner | `data.governance-owner` | BusinessObject ownership by BusinessActor | [✓](../../spec/schemas/link-registry.json) |

#### From Application Layer (04)

| Predicate   | Source Element              | Target Element | Field Path       | Description                        | Documented                                 |
| ----------- | --------------------------- | -------------- | ---------------- | ---------------------------------- | ------------------------------------------ |
| `retention` | Data Properties, DataObject | Retention      | `data.retention` | Links to Retention in target layer | [✓](../../spec/schemas/link-registry.json) |

#### From API Layer (06)

| Predicate         | Source Element         | Target Element | Field Path          | Description | Documented |
| ----------------- | ---------------------- | -------------- | ------------------- | ----------- | ---------- |
| `database-column` | Schema                 | Column         | `x-database-column` | string      | ✗          |
| `database-table`  | Schema, SecurityScheme | Table          | `x-database-table`  | string      | ✗          |

#### From Data Model Layer (07)

| Predicate                  | Source Element                                                         | Target Element    | Field Path                   | Description                   | Documented |
| -------------------------- | ---------------------------------------------------------------------- | ----------------- | ---------------------------- | ----------------------------- | ---------- |
| `apm-data-quality-metrics` | JSONSchema, x-apm-data-quality-metrics Extension, x-security Extension | DataQualityMetric | `x-apm-data-quality-metrics` | DataQualityMetrics (optional) | ✗          |
| `data-governance`          | JSONSchema, x-data-governance Extension, x-security Extension          | Governance        | `x-data-governance`          | DataGovernance (optional)     | ✗          |
| `database`                 | JSONSchema, SchemaProperty, x-database Extension, x-security Extension | Database          | `x-database`                 | DatabaseMapping (optional)    | ✗          |
