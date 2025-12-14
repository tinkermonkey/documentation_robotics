# Security Layer - Cross-Layer Relationships

## Cross-Layer Relationships

**Purpose**: Define semantic links to entities in other layers, supporting traceability, governance, and architectural alignment.

### Cross-Layer Relationship Diagram

```mermaid
graph TB
  subgraph thisLayer["03: Security Layer"]
    thisClassification["Classification"]
    thisEncrypted["Encrypted"]
    thisEncryptionRequired["EncryptionRequired"]
    thisEncryptionType["EncryptionType"]
    thisPermission["Permission"]
    thisPii["Pii"]
    thisSecureResource["SecureResource"]
    thisSecurityControl["SecurityControl"]
    thisSeparationOfDuty["SeparationOfDuty"]
  end

  %% Source layers
  subgraph source02Layer["02: Business Layer"]
    source02Node["Any Business Layer entity"]
  end
  subgraph source04Layer["04: Application Layer"]
    source04Node["Any Application Layer entity"]
  end
  subgraph source05Layer["05: Technology Layer"]
    source05Node["Any Technology Layer entity"]
  end
  subgraph source06Layer["06: API Layer"]
    source06Node["Any API Layer entity"]
  end

  %% Incoming relationships
  source05Node -->|classification| thisClassification
  source04Node -->|pii| thisPii
  source06Node -->|encrypted| thisEncrypted
  source05Node -->|encryption-required| thisEncryptionRequired
  source05Node -->|encryption-type| thisEncryptionType
  source05Node -->|pii| thisPii
  source06Node -->|pii| thisPii
  source02Node -->|security-controls| thisSecurityControl
  source02Node -->|separation-of-duty| thisSeparationOfDuty
  source06Node -->|required-permissions| thisPermission
  source06Node -->|security-resource| thisSecureResource

  %% Styling
  classDef thisLayerStyle fill:#4ECDC4,stroke:#333,stroke-width:3px
  classDef targetLayerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef sourceLayerStyle fill:#E17055,stroke:#333,stroke-width:2px

  class thisClassification thisLayerStyle
  class thisEncrypted thisLayerStyle
  class thisEncryptionRequired thisLayerStyle
  class thisEncryptionType thisLayerStyle
  class thisPermission thisLayerStyle
  class thisPii thisLayerStyle
  class thisSecureResource thisLayerStyle
  class thisSecurityControl thisLayerStyle
  class thisSeparationOfDuty thisLayerStyle
  class source02Node sourceLayerStyle
  class source04Node sourceLayerStyle
  class source05Node sourceLayerStyle
  class source06Node sourceLayerStyle
```

### Outgoing Relationships (This Layer → Other Layers)

Links from entities in this layer to entities in other layers.

_No outgoing cross-layer relationships defined._

### Incoming Relationships (Other Layers → This Layer)

Links from entities in other layers to entities in this layer.

#### From Business Layer (02)

| Predicate            | Source Element  | Target Element   | Field Path                   | Description                               | Documented                                 |
| -------------------- | --------------- | ---------------- | ---------------------------- | ----------------------------------------- | ------------------------------------------ |
| `security-controls`  | BusinessProcess | SecurityControl  | `process.security-controls`  | security control references               | [✓](../../spec/schemas/link-registry.json) |
| `separation-of-duty` | BusinessProcess | SeparationOfDuty | `process.separation-of-duty` | Links to SeparationOfDuty in target layer | [✓](../../spec/schemas/link-registry.json) |

#### From Application Layer (04)

| Predicate | Source Element              | Target Element | Field Path | Description                  | Documented                                 |
| --------- | --------------------------- | -------------- | ---------- | ---------------------------- | ------------------------------------------ |
| `pii`     | Data Properties, DataObject | Pii            | `data.pii` | Links to Pii in target layer | [✓](../../spec/schemas/link-registry.json) |

#### From Technology Layer (05)

| Predicate             | Source Element | Target Element     | Field Path                     | Description                                  | Documented                                 |
| --------------------- | -------------- | ------------------ | ------------------------------ | -------------------------------------------- | ------------------------------------------ |
| `classification`      | Artifact       | Classification     | `security.classification`      | Links to Classification in target layer      | [✓](../../spec/schemas/link-registry.json) |
| `encryption-required` | Artifact       | EncryptionRequired | `security.encryption-required` | Links to EncryptionRequired in target layer  | [✓](../../spec/schemas/link-registry.json) |
| `encryption-type`     | Artifact       | EncryptionType     | `security.encryption-type`     | Links to EncryptionType in target layer      | [✓](../../spec/schemas/link-registry.json) |
| `pii`                 | Artifact       | Pii                | `security.pii`, `x-pii`        | contains personally identifiable information | [✓](../../spec/schemas/link-registry.json) |

#### From API Layer (06)

| Predicate              | Source Element            | Target Element | Field Path               | Description                                  | Documented                                 |
| ---------------------- | ------------------------- | -------------- | ------------------------ | -------------------------------------------- | ------------------------------------------ |
| `encrypted`            | Schema                    | Encrypted      | `x-encrypted`            | boolean                                      | ✗                                          |
| `pii`                  | Schema                    | Pii            | `security.pii`, `x-pii`  | contains personally identifiable information | [✓](../../spec/schemas/link-registry.json) |
| `required-permissions` | Operation, SecurityScheme | Permission     | `x-required-permissions` | string[] (Permission.name[], optional)       | ✗                                          |
| `security-resource`    | Operation, SecurityScheme | SecureResource | `x-security-resource`    | string (SecureResource.resource, optional)   | ✗                                          |
