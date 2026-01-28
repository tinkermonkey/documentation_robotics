# Cross-Layer Reference Registry

## Overview

This document catalogs all cross-layer reference patterns used throughout the Documentation Robotics specification. Cross-layer references enable integration between the 12 architectural layers, providing traceability from strategic goals down to implementation details.

**Total Reference Patterns:** 60+ distinct patterns
**Purpose:** Enable discovery, validation, and navigation of inter-layer links
**Audience:** Architects, developers, and tooling implementers

## Reference Pattern Categories

The spec uses four distinct reference patterns, each optimized for different use cases:

### Pattern A: X-Extensions (OpenAPI/JSON Schema)

**Format:** `x-{target-layer}-{type}-ref` or `x-archimate-ref`

**Use When:** External standard specs (OpenAPI 3.0, JSON Schema) need to reference back to the spec

**Rationale:** Follows OpenAPI extension conventions (`x-` prefix), doesn't conflict with standard fields

**Examples:**

- `x-archimate-ref` - Reference to ArchiMate Application Layer element
- `x-business-service-ref` - Reference to Business Layer BusinessService
- `x-security-resource` - Reference to Security Layer SecureResource
- `x-supports-goals` - Reference to Motivation Layer Goals
- `x-required-permissions` - Reference to Security Layer Permissions

### Pattern B: Dot-Notation Properties (Upward References)

**Format:** `{target-layer}.{relationship-type}`

**Use When:** Implementation layers reference strategic/higher layers

**Rationale:** Clear namespace separation, follows established spec pattern, maintains separation of concerns

**Examples:**

- `motivation.supports-goals` - Links element to business goals it supports
- `motivation.governed-by-principles` - Links element to architectural principles
- `business.realizes-services` - Links element to business services it realizes
- `security.model` - Links element to security model
- `apm.business-metrics` - Links element to metrics that measure it

### Pattern C: Nested Objects (Complex Relationships)

**Format:** `{target-layer}: { field1, field2, ... }`

**Use When:** Multiple related references need grouping OR channel-specific overrides

**Rationale:** Groups related references, reduces top-level clutter, allows for additional metadata

**Examples:**

- `motivationAlignment: { supportsGoals, deliversValue, governedByPrinciples }`
- `business: { supportsProcesses, realizesServices, targetActors }`
- `security: { resourceRef, requiredRoles, requiredPermissions }`
- `api: { operationId, method, endpoint }`

### Pattern D: Direct Field Names (Standard References)

**Format:** Standard field name from the spec

**Use When:** Using native spec features (like OpenAPI's `operationId`, JSON Schema's `$ref`)

**Rationale:** Leverages existing standards, no need to reinvent

**Examples:**

- `operationId` - OpenAPI operation identifier
- `$ref` - JSON Schema reference
- `schemaRef` - Reference to JSON Schema
- `experience` - UX experience specification path

## Naming Conventions

### General Rules

1. **Kebab-case for relationships:** `supports-goals`, `realizes-services`, `governed-by-principles`
2. **CamelCase for object keys:** `motivationAlignment`, `businessAlignment`, `securityContext`
3. **Suffix ID references:** Use `Ref` or `Id` suffix for explicit ID references
   - `businessActorRef` - Reference to a BusinessActor
   - `dataModelSchemaId` - JSON Schema $id value
4. **Plural for arrays:** `supportsGoals` (array of goal IDs), `realizesServices` (array)
5. **Singular for single refs:** `securityModel` (single string), `dataSchemaRef` (single path)

### Layer Prefixes

Use consistent layer prefixes in property names:

- `motivation.*` - Motivation Layer (Goals, Requirements, Principles, Constraints)
- `business.*` - Business Layer (Actors, Processes, Services)
- `security.*` - Security Layer (Models, Resources, Roles, Permissions)
- `api.*` - API Layer (Operations, Endpoints)
- `apm.*` - APM/Observability Layer (Metrics, Traces, SLAs)
- `application.*` - Application Layer (Components, Services)

## Complete Reference Catalog

### From Motivation Layer (01)

The Motivation Layer is referenced BY other layers but doesn't reference implementation layers.

**Referenced By:**

- All layers 02-11 reference motivation elements for strategic alignment

### To Motivation Layer (All → 01)

| Pattern                | Source Layers | Target Type | Field Path                                                                                                  | Cardinality | Format |
| ---------------------- | ------------- | ----------- | ----------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| Supports Goals         | 02, 04-11     | Goal        | `motivation.supports-goals`, `motivationAlignment.supportsGoals`, `x-supports-goals`                        | Array       | UUID   |
| Fulfills Requirements  | 04-11         | Requirement | `motivation.fulfills-requirements`, `motivationAlignment.fulfillsRequirements`, `x-fulfills-requirements`   | Array       | UUID   |
| Governed By Principles | 02, 04-11     | Principle   | `motivation.governed-by-principles`, `motivationAlignment.governedByPrinciples`, `x-governed-by-principles` | Array       | UUID   |
| Constrained By         | 05-08, 10     | Constraint  | `motivation.constrained-by`, `x-constrained-by`                                                             | Array       | UUID   |
| Delivers Value         | 02, 04, 09-11 | Value       | `motivation.delivers-value`, `motivationAlignment.deliversValue`                                            | Array       | UUID   |
| Measures Outcome       | 11            | Outcome     | `motivationMapping.measuresOutcome`                                                                         | Array       | UUID   |

### From Business Layer (02)

| Pattern                | Target Layer | Target Type      | Field Path                          | Cardinality | Format | Description                                 |
| ---------------------- | ------------ | ---------------- | ----------------------------------- | ----------- | ------ | ------------------------------------------- |
| Delivers Value         | 01           | Value            | `motivation.delivers-value`         | Array       | UUID   | Values delivered by BusinessService         |
| Supports Goals         | 01           | Goal             | `motivation.supports-goals`         | Array       | UUID   | Goals supported by BusinessService          |
| Governed By Principles | 01           | Principle        | `motivation.governed-by-principles` | Array       | UUID   | Principles guiding BusinessService          |
| Application Ref        | 04           | ApplicationEvent | `event.application-ref`             | Single      | UUID   | ApplicationEvent triggered by BusinessEvent |
| Schema Ref             | 07           | JSON Schema      | `spec.schema`                       | Single      | Path   | JSON Schema for BusinessObject              |
| Schema ID              | 07           | Schema $id       | `spec.schema-id`                    | Single      | UUID   | Formal schema reference                     |
| Master Data Source     | 04           | DataObject       | `application.master-data-source`    | Single      | UUID   | Authoritative DataObject                    |
| API Operations         | 06           | Operation        | `interface.api-operations`          | Array       | String | OpenAPI operationIds exposed via interface  |
| Security Actors        | 03           | Actor            | `collaboration.security-actors`     | Array       | String | Security actors in collaboration            |
| Security Controls      | 03           | Control          | `process.security-controls`         | Array       | String | Controls protecting process                 |
| Business Metrics       | 11           | Metric           | `apm.business-metrics`              | Array       | String | Metrics measuring process                   |

### From Security Layer (03)

| Pattern                   | Target Layer | Target Type         | Field Path                | Cardinality | Format | Description                                   |
| ------------------------- | ------------ | ------------------- | ------------------------- | ----------- | ------ | --------------------------------------------- |
| Stakeholder Ref           | 01           | Stakeholder         | `stakeholderRef`          | Single      | UUID   | Business stakeholder mapped to security actor |
| Business Actor Ref        | 02           | BusinessActor       | `businessActorRef`        | Single      | UUID   | Business actor mapped to security actor       |
| Motivation Goal Ref       | 01           | Goal                | `motivationGoalRef`       | Single      | UUID   | Goal served by actor objective                |
| Assessment Ref            | 01           | Assessment          | `assessmentRef`           | Single      | UUID   | Business assessment linked to threat          |
| Mitigated By Requirements | 01           | Requirement         | `mitigatedByRequirements` | Array       | UUID   | Requirements that mitigate threat             |
| Commitment Refs           | 01           | Constraint          | `commitmentRefs`          | Array       | UUID   | Regulatory/contractual commitments            |
| ArchiMate Ref             | 04           | Application Element | `archimateRef`            | Single      | UUID   | Application component protected by security   |

### From Application Layer (04)

| Pattern                 | Target Layer | Target Type | Field Path                          | Cardinality | Format     | Description                            |
| ----------------------- | ------------ | ----------- | ----------------------------------- | ----------- | ---------- | -------------------------------------- |
| Supports Goals          | 01           | Goal        | `motivation.supports-goals`         | Array       | UUID       | Goals supported by ApplicationService  |
| Delivers Value          | 01           | Value       | `motivation.delivers-value`         | Array       | UUID       | Values delivered by ApplicationService |
| Governed By Principles  | 01           | Principle   | `motivation.governed-by-principles` | Array       | UUID       | Principles guiding design              |
| Fulfills Requirements   | 01           | Requirement | `motivation.fulfills-requirements`  | Array       | UUID       | Requirements fulfilled by component    |
| Business Metrics        | 11           | Metric      | `apm.business-metrics`              | Array       | String     | Metrics measuring service              |
| SLA Target Latency      | 11           | SLA         | `apm.sla-target-latency`            | Single      | Duration   | Performance target                     |
| SLA Target Availability | 11           | SLA         | `apm.sla-target-availability`       | Single      | Percentage | Availability target                    |
| Traced                  | 11           | Tracing     | `apm.traced`                        | Single      | Boolean    | Enable distributed tracing             |
| OpenAPI Spec            | 06           | API Spec    | `spec.openapi`                      | Single      | Path       | OpenAPI specification path             |
| UX Spec                 | 09           | UX Spec     | `spec.ux`                           | Single      | Path       | UX specification path                  |
| Database Spec           | 08           | Datastore   | `spec.database`                     | Single      | Path       | Database specification path            |
| Schema Ref              | 07           | JSON Schema | `spec.schema`                       | Single      | Path       | JSON Schema for DataObject             |

### From Technology Layer (05)

| Pattern                 | Target Layer | Target Type | Field Path                          | Cardinality | Format     | Description                     |
| ----------------------- | ------------ | ----------- | ----------------------------------- | ----------- | ---------- | ------------------------------- |
| Governed By Principles  | 01           | Principle   | `motivation.governed-by-principles` | Array       | UUID       | Technology selection principles |
| Constrained By          | 01           | Constraint  | `motivation.constrained-by`         | Array       | UUID       | Technology constraints          |
| Fulfills Requirements   | 01           | Requirement | `motivation.fulfills-requirements`  | Array       | UUID       | Requirements fulfilled by tech  |
| Supports Goals          | 01           | Goal        | `motivation.supports-goals`         | Array       | UUID       | Goals supported by tech service |
| SLA Target Latency      | 11           | SLA         | `apm.sla-target-latency`            | Single      | Duration   | Performance target              |
| SLA Target Availability | 11           | SLA         | `apm.sla-target-availability`       | Single      | Percentage | Availability target             |
| Health Monitored        | 11           | Health      | `apm.health-monitored`              | Single      | Boolean    | Enable health checks            |
| Health Check Endpoint   | 11           | Endpoint    | `apm.health-check-endpoint`         | Single      | URI        | Health check URL                |

### From API Layer (06)

| Pattern                | Target Layer | Target Type        | Field Path                      | Cardinality | Format     | Description                            |
| ---------------------- | ------------ | ------------------ | ------------------------------- | ----------- | ---------- | -------------------------------------- |
| ArchiMate Ref          | 04           | ApplicationService | `x-archimate-ref`               | Single      | UUID       | Application service realized by API    |
| Business Service Ref   | 02           | BusinessService    | `x-business-service-ref`        | Single      | UUID       | Business service realized by operation |
| Business Interface Ref | 02           | BusinessInterface  | `x-business-interface-ref`      | Single      | UUID       | Business interface exposing operation  |
| Supports Goals         | 01           | Goal               | `x-supports-goals`              | Array       | UUID       | Goals supported by operation           |
| Fulfills Requirements  | 01           | Requirement        | `x-fulfills-requirements`       | Array       | UUID       | Requirements fulfilled by operation    |
| Governed By Principles | 01           | Principle          | `x-governed-by-principles`      | Array       | UUID       | API design principles                  |
| Constrained By         | 01           | Constraint         | `x-constrained-by`              | Array       | UUID       | Regulatory/compliance constraints      |
| Security Resource      | 03           | SecureResource     | `x-security-resource`           | Single      | String     | Security resource for authorization    |
| Required Permissions   | 03           | Permission         | `x-required-permissions`        | Array       | String     | Permission names required              |
| APM SLA Latency        | 11           | SLA                | `x-apm-sla-target-latency`      | Single      | Duration   | Operation latency target               |
| APM SLA Availability   | 11           | SLA                | `x-apm-sla-target-availability` | Single      | Percentage | Operation availability target          |
| APM Business Metrics   | 11           | Metric             | `x-apm-business-metrics`        | Array       | String     | Metrics affected by operation          |
| APM Criticality        | 11           | Enum               | `x-apm-criticality`             | Single      | Enum       | Monitoring priority level              |

### From Data Model Layer (07)

| Pattern                  | Target Layer | Target Type    | Field Path                                     | Cardinality | Format | Description                       |
| ------------------------ | ------------ | -------------- | ---------------------------------------------- | ----------- | ------ | --------------------------------- |
| ArchiMate Ref            | 04           | DataObject     | `x-archimate-ref`                              | Single      | UUID   | DataObject represented by schema  |
| Business Object Ref      | 02           | BusinessObject | `x-business-object-ref`                        | Single      | UUID   | Business object modeled by schema |
| Governed By Principles   | 01           | Principle      | `x-data-governance.governedBy.principleRefs`   | Array       | UUID   | Data governance principles        |
| Governed By Requirements | 01           | Requirement    | `x-data-governance.governedBy.requirementRefs` | Array       | UUID   | Data protection requirements      |
| Governed By Constraints  | 01           | Constraint     | `x-data-governance.governedBy.constraintRefs`  | Array       | UUID   | Retention/compliance constraints  |
| Security Principles      | 01           | Principle      | `x-security.governedBy.principleRefs`          | Array       | UUID   | Security design principles        |
| Security Requirements    | 01           | Requirement    | `x-security.governedBy.requirementRefs`        | Array       | UUID   | Security requirements             |
| Security Constraints     | 01           | Constraint     | `x-security.governedBy.constraintRefs`         | Array       | UUID   | Security constraints              |
| Data Quality Metrics     | 11           | Metric         | `x-apm-data-quality-metrics`                   | Array       | String | Data quality metric IDs           |

### From Datastore Layer (08)

| Pattern                  | Target Layer | Target Type | Field Path                   | Cardinality | Format | Description                      |
| ------------------------ | ------------ | ----------- | ---------------------------- | ----------- | ------ | -------------------------------- |
| ArchiMate Ref            | 04           | DataObject  | `x-archimate-ref`            | Single      | UUID   | DataObject stored in table       |
| JSON Schema              | 07           | JSON Schema | `x-json-schema`              | Single      | URI    | JSON Schema for table structure  |
| Governed By Principles   | 01           | Principle   | `x-governed-by-principles`   | Array       | UUID   | Database design principles       |
| Governed By Requirements | 01           | Requirement | `x-governed-by-requirements` | Array       | UUID   | Database requirements            |
| Governed By Constraints  | 01           | Constraint  | `x-governed-by-constraints`  | Array       | UUID   | Retention/compliance constraints |
| Performance Metrics      | 11           | Metric      | `x-apm-performance-metrics`  | Array       | String | Performance metric IDs           |
| Data Quality Metrics     | 11           | Metric      | `x-apm-data-quality-metrics` | Array       | String | Data quality metric IDs          |

### From UX Layer (09)

| Pattern                | Target Layer | Target Type     | Field Path                                 | Cardinality | Format | Description                  |
| ---------------------- | ------------ | --------------- | ------------------------------------------ | ----------- | ------ | ---------------------------- |
| Supports Goals         | 01           | Goal            | `motivationAlignment.supportsGoals`        | Array       | UUID   | Goals supported by UX        |
| Delivers Value         | 01           | Value           | `motivationAlignment.deliversValue`        | Array       | UUID   | Values delivered by UX       |
| Governed By Principles | 01           | Principle       | `motivationAlignment.governedByPrinciples` | Array       | UUID   | UX design principles         |
| Fulfills Requirements  | 01           | Requirement     | `motivationAlignment.fulfillsRequirements` | Array       | UUID   | Requirements fulfilled by UX |
| Supports Processes     | 02           | BusinessProcess | `business.supportsProcesses`               | Array       | UUID   | Business processes supported |
| Realizes Services      | 02           | BusinessService | `business.realizesServices`                | Array       | UUID   | Business services realized   |
| Target Actors          | 02           | BusinessActor   | `business.targetActors`                    | Array       | UUID   | Target business actors       |
| Target Roles           | 02           | BusinessRole    | `business.targetRoles`                     | Array       | UUID   | Target business roles        |
| Security Model         | 03           | SecurityModel   | `security.model`                           | Single      | String | Security model ID            |
| Default Required Roles | 03           | Role            | `security.defaultRequiredRoles`            | Array       | String | Default roles for access     |
| Resource Ref           | 03           | SecureResource  | `security.resourceRef`                     | Single      | String | Secure resource reference    |
| Required Roles         | 03           | Role            | `security.requiredRoles`                   | Array       | String | Roles required for view      |
| Required Permissions   | 03           | Permission      | `security.requiredPermissions`             | Array       | String | Permissions required         |
| Field Access           | 03           | FieldAccess     | `security.fieldAccess`                     | Array       | Object | Field-level access control   |
| API Operation          | 06           | Operation       | `api.operationId`                          | Single      | String | OpenAPI operation ID         |
| API Method             | 06           | HTTP Method     | `api.method`                               | Single      | Enum   | HTTP method                  |
| API Endpoint           | 06           | Path            | `api.endpoint`                             | Single      | String | API endpoint path            |
| Schema Ref             | 07           | JSON Schema     | `dataBinding.schemaRef`                    | Single      | Path   | Schema for data binding      |
| Route                  | 10           | Route           | `route`                                    | Single      | String | Navigation route             |
| ArchiMate Element      | 04           | Component       | `archimateElement`                         | Single      | UUID   | Application component        |
| Measured By Metrics    | 11           | Metric          | `apm.measuredByMetrics`                    | Array       | String | Metrics measuring UX         |
| Performance Targets    | 11           | Target          | `apm.performanceTargets`                   | Object      | Object | Performance target values    |

### From Navigation Layer (10)

| Pattern                | Target Layer | Target Type     | Field Path                                 | Cardinality | Format | Description                       |
| ---------------------- | ------------ | --------------- | ------------------------------------------ | ----------- | ------ | --------------------------------- |
| Governed By Principles | 01           | Principle       | `governedByPrinciples`                     | Array       | UUID   | Navigation design principles      |
| Fulfills Requirements  | 01           | Requirement     | `motivationAlignment.fulfillsRequirements` | Array       | UUID   | Requirements fulfilled by route   |
| Enforces Requirement   | 01           | Requirement     | `motivationAlignment.enforcesRequirement`  | Single      | UUID   | Requirement enforced by guard     |
| Supports Goals         | 01           | Goal            | `motivationAlignment.supportsGoals`        | Array       | UUID   | Goals supported by flow           |
| Delivers Value         | 01           | Value           | `motivationAlignment.deliversValue`        | Array       | UUID   | Values delivered by flow          |
| Realizes Process       | 02           | BusinessProcess | `business.realizesProcess`                 | Single      | UUID   | Business process realized by flow |
| Realizes Services      | 02           | BusinessService | `business.realizesServices`                | Array       | UUID   | Business services realized        |
| API Operation          | 06           | Operation       | `api.operationId`                          | Single      | String | API operation for guard           |
| API Method             | 06           | HTTP Method     | `api.method`                               | Single      | Enum   | HTTP method for guard             |
| Schema Ref             | 07           | JSON Schema     | `schemaRef`                                | Single      | Path   | Schema for context variable       |
| Experience             | 09           | UX Spec         | `experience`                               | Single      | Path   | UX experience specification       |
| Entry State            | 09           | State           | `experience.entryState`                    | Single      | String | Initial UX state                  |
| ArchiMate Element      | 04           | Component       | `archimateElement`                         | Single      | UUID   | Application component             |
| ArchiMate Ref          | 04           | Component       | `archimateRef`                             | Single      | UUID   | Application component reference   |
| Funnel Metrics         | 11           | Metric          | `analytics.funnelMetrics`                  | Array       | String | Funnel conversion metrics         |

### From APM/Observability Layer (11)

| Pattern                     | Target Layer | Target Type        | Field Path                               | Cardinality | Format | Description                 |
| --------------------------- | ------------ | ------------------ | ---------------------------------------- | ----------- | ------ | --------------------------- |
| Contributes To Goal         | 01           | Goal               | `motivationMapping.contributesToGoal`    | Single      | UUID   | Goal measured by metric     |
| Measures Outcome            | 01           | Outcome            | `motivationMapping.measuresOutcome`      | Single      | UUID   | Outcome validated by metric |
| Fulfills Requirements       | 01           | Requirement        | `motivationMapping.fulfillsRequirements` | Array       | UUID   | Requirements fulfilled      |
| Governed By Principles      | 01           | Principle          | `motivationMapping.governedByPrinciples` | Array       | UUID   | Measurement principles      |
| Business Process Ref        | 02           | BusinessProcess    | `businessProcessRef`                     | Single      | UUID   | Business process tracked    |
| Process Step Name           | 02           | Step               | `processStepName`                        | Single      | String | Business process step       |
| Security Threat Ref         | 03           | Threat             | `securityThreatRef`                      | Single      | UUID   | Security threat monitored   |
| Security Control Ref        | 03           | Control            | `securityControlRef`                     | Single      | UUID   | Security control measured   |
| Accountability Req Ref      | 03           | AccountabilityReq  | `accountabilityRequirementRefs`          | Array       | UUID   | Accountability requirements |
| Security Accountability Ref | 03           | AccountabilityReq  | `securityAccountabilityRef`              | Single      | UUID   | Audit accountability        |
| ArchiMate Element           | 04/05        | Component/Service  | `archimateElement`                       | Single      | UUID   | Element being monitored     |
| ArchiMate Service           | 04           | ApplicationService | `archimateService`                       | Single      | UUID   | Service span belongs to     |
| Operation ID                | 06           | Operation          | `operationId`                            | Single      | String | API operation traced        |
| Schema Ref                  | 07           | JSON Schema        | `schemaRef`                              | Single      | Path   | Schema for data quality     |
| Data Model Schema ID        | 07           | Schema $id         | `dataModelSchemaId`                      | Single      | String | JSON Schema $id             |
| UX Component Ref            | 09           | Component          | `uxComponentRef`                         | Single      | String | UX component measured       |
| Navigation Route Ref        | 10           | Route              | `navigationRouteRef`                     | Single      | String | Navigation route tracked    |

### Source Code References (External → Code)

| Pattern          | Source Layers | Target Type   | Field Path                                      | Cardinality | Format |
| ---------------- | ------------- | ------------- | ----------------------------------------------- | ----------- | ------ |
| Source Reference | 04, 06-12     | External Code | properties.source.reference, x-source-reference | Single      | Object |

## Validation Rules

### Target Existence

All references MUST point to existing elements in the model:

- UUID references must match element IDs in the target layer
- Path references must resolve to existing specification files
- String references (operationId, permission names) must exist in target definitions

### Type Compatibility

References must point to the correct element type:

- `x-business-service-ref` must reference a `BusinessService`, not a `BusinessActor`
- `motivationAlignment.supportsGoals` must reference `Goal` elements
- `schemaRef` must reference a valid JSON Schema file

### Cardinality

References must match the defined cardinality:

- Single references (type: `string`) cannot be arrays
- Array references (type: `array`) must contain valid element IDs
- Optional references can be omitted but cannot be null

### Format Validation

References must match the specified format:

- UUID references: `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
- Path references: Valid file paths relative to spec root
- Duration format: `\d+(ms|s|m|h)` (e.g., "200ms", "2s")
- Percentage format: `\d+(\.\d+)?%` (e.g., "99.9%", "99.95%")

## Migration Guide to v1.0

### Current State (v0.x)

The v0.x specification (current: v0.1.1) uses multiple reference patterns that evolved organically:

- Some layers use `x-` extensions
- Some use dot-notation properties
- Some use nested objects
- Naming is inconsistent (camelCase vs kebab-case)
- No strict enforcement of link standards

### Target State (v1.0)

The v1.0 specification will enforce standardized naming conventions:

- Clear rules for when to use each pattern type
- Consistent kebab-case for relationship names
- Consistent camelCase for object keys
- Explicit `Ref` or `Id` suffixes for ID references
- Strict validation of cross-layer links

### Migration Steps

1. **Audit Current References**

   ```bash
   dr migrate links --check
   ```

2. **Review Required Changes**

   ```bash
   dr migrate links --dry-run
   ```

3. **Apply Migration**

   ```bash
   dr migrate links --apply
   ```

4. **Validate Migrated Model**

   ```bash
   dr validate  
   ```

### Example Migrations

**Before (v0.x):**

```yaml
# Inconsistent naming
motivation:
  supportGoals: ["goal-1", "goal-2"] # Missing hyphen
  governedByPrinciples: ["principle-1"] # OK
  fulfillRequirements: ["req-1"] # Missing hyphen

business:
  realizesService: "service-1" # Wrong cardinality (should be array)
```

**After (v1.0):**

```yaml
# Consistent naming
motivation:
  supports-goals: ["goal-1", "goal-2"] # Kebab-case
  governed-by-principles: ["principle-1"] # Kebab-case
  fulfills-requirements: ["req-1"] # Kebab-case

business:
  realizes-services: ["service-1"] # Kebab-case, plural for array
```

## Tools and Commands

### List Link Types

```bash
# Show all available link types
dr links types

# Show links for specific layer
dr links types --layer 06-api

# Export as JSON
dr links types --format json > link-types.json
```

### List Link Instances

```bash
# List all links in current model
dr links list

# List links for specific layer
dr links list --layer 09-ux

# List specific link type
dr links list --type motivation-supports-goals

# Export as tree
dr links list --format tree
```

### Find Element Links

```bash
# Find all links for an element
dr links find goal-customer-satisfaction

# Find only upstream links (what references this)
dr links find goal-customer-satisfaction --direction up

# Find only downstream links (what this references)
dr links find order-service --direction down

# Filter by link type
dr links find order-api --link-type security
```

### Validate Links

```bash
# Validate all links (warnings only)
dr links validate

# Validate specific layer
dr links validate --layer 10-navigation

# Strict mode (fail on broken links)
dr links validate --strict
```

### Trace Link Paths

```bash
# Find path between two elements
dr links trace goal-revenue-growth metric-order-value

# Show link types in path
dr links trace goal-revenue-growth metric-order-value --show-types
```

### Display Registry

```bash
# Display full registry
dr links registry

# Export as JSON
dr links registry --format json

# Export as HTML
dr links registry --format html > link-registry.html
```

## Best Practices

### For Architects

1. **Start with motivation alignment** - Link all significant elements to goals, requirements, or principles
2. **Validate bidirectional consistency** - Ensure forward and backward references match
3. **Use appropriate granularity** - Link to the right level (don't link every detail to strategic goals)
4. **Document rationale** - Use element documentation to explain why links exist

### For Developers

1. **Check available links** - Use `dr links types --layer <your-layer>` before creating specs
2. **Validate early and often** - Run `dr links validate` during development
3. **Follow naming conventions** - Use kebab-case for relationships, camelCase for objects
4. **Include examples** - Reference this registry for correct usage patterns

### For Teams

1. **Establish link policies** - Define which links are mandatory vs optional for your project
2. **Review link coverage** - Use `dr links list` to identify gaps in traceability
3. **Automate validation** - Add `dr links validate` to CI/CD pipelines
4. **Generate reports** - Use `dr links registry` to create project-specific documentation

## Summary Statistics

**Total Link Patterns:** 60+
**Layers with Links:** All 12 layers
**Most Connected Layer:** Motivation Layer (01) - referenced by all other layers
**Link Categories:**

- Motivation references: 6 types (goals, requirements, principles, constraints, values, outcomes)
- Business references: 11 types
- Security references: 14 types
- API references: 4 types
- Data references: 6 types
- UX references: 4 types
- Navigation references: 4 types
- APM references: 9 types

## Additional Resources

- **Machine Registry:** `/spec/schemas/link-registry.json` - Complete link catalog in JSON format (auto-generated)
- **Cross-Layer Integration:** `/spec/core/03-cross-layer-integration.md` - Integration patterns and examples
- **Schema Generation:** `/scripts/generate_schemas.py` - Auto-generates schemas and link registry from markdown specs

