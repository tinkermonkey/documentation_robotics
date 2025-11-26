# Business Layer - ArchiMate Business Elements

## Overview

The Business Layer represents the business services offered to customers, realized by business processes performed by business actors. This layer uses standard ArchiMate elements without custom extensions.

## Layer Characteristics

- **Standard**: ArchiMate 3.2 Business Layer
- **Custom Extensions**: None required
- **Validation**: ArchiMate XSD schema
- **Tooling**: ArchiMate modeling tools (Archi, Enterprise Architect, etc.)

## Entity Definitions

### BusinessActor

```yaml
BusinessActor:
  description: "An organizational entity capable of performing behavior"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  examples:
    - Customer
    - Employee
    - Partner
    - Supplier
```

### BusinessRole

```yaml
BusinessRole:
  description: "The responsibility for performing specific behavior"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  examples:
    - Sales Representative
    - Account Manager
    - System Administrator
```

### BusinessCollaboration

```yaml
BusinessCollaboration:
  description: "Aggregate of business roles working together"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  properties:
    - key: "collaboration.security-actors"
      value: "actor-id-1,actor-id-2" (optional, Security Actor IDs)
    - key: "collaboration.shared-permissions"
      value: "permission.name-1,permission.name-2" (optional)

  examples:
    - Sales Team
    - Customer Service Department
```

### BusinessInterface

```yaml
BusinessInterface:
  description: "Point of access where business service is available"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  properties:
    - key: "interface.api-operations"
      value: "operationId-1,operationId-2" (optional, comma-separated OpenAPI operation IDs)
    - key: "interface.digital-channel"
      value: "web|mobile|api|partner-integration" (optional)

  examples:
    - Customer Portal
    - Phone Support
    - Email Channel
```

### BusinessProcess

```yaml
BusinessProcess:
  description: "Sequence of business behaviors achieving a result"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  properties:
    - key: "process.bpmn"
      value: "path/to/bpmn/file.bpmn" (optional)
    - key: "process.security-controls"
      value: "control-id-1,control-id-2" (optional, security control references)
    - key: "process.audit-required"
      value: "true|false" (optional)
    - key: "process.separation-of-duty"
      value: "true|false" (optional)
    - key: "apm.business-metrics"
      value: "metric-id-1,metric-id-2" (optional, business metric IDs)
    - key: "process.kpi-target"
      value: "completion-time: 2hours" (optional)

    # Application Layer Integration
    - key: "application.realized-by-process"
      value: "app-process-id" (optional, ApplicationProcess ID that automates this business process)
    - key: "application.process-steps"
      value: "step-1,step-2" (optional, which specific ApplicationProcess steps realize this business process)

  examples:
    - Order Fulfillment
    - Customer Onboarding
    - Invoice Processing
```

### BusinessFunction

```yaml
BusinessFunction:
  description: "Collection of business behavior based on criteria"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  examples:
    - Marketing
    - Sales
    - Customer Service
```

### BusinessInteraction

```yaml
BusinessInteraction:
  description: "Unit of collective behavior by collaboration"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  examples:
    - Sales Meeting
    - Contract Negotiation
```

### BusinessEvent

```yaml
BusinessEvent:
  description: "Something that happens and influences behavior"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)
    type: EventType [enum]

  properties:
    - key: "event.application-ref"
      value: "app-event-id" (optional, reference to ApplicationEvent)
    - key: "event.topic"
      value: "orders.received" (optional, event bus topic)

  enums:
    EventType:
      - time-driven
      - state-change
      - external

  examples:
    - Customer Order Received
    - Payment Due
    - Contract Expired
```

### BusinessService

```yaml
BusinessService:
  description: "Service that fulfills a business need"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  properties:
    - key: "sla.availability"
      value: "99.9%" (optional)
    - key: "sla.response-time"
      value: "24 hours" (optional)

    # Motivation Layer Integration
    - key: "motivation.delivers-value"
      value: "value-id-1,value-id-2" (optional, comma-separated Value IDs)
    - key: "motivation.supports-goals"
      value: "goal-id-1,goal-id-2" (optional, comma-separated Goal IDs)
    - key: "motivation.governed-by-principles"
      value: "principle-id-1,principle-id-2" (optional, comma-separated Principle IDs)

  examples:
    - Order Processing Service
    - Customer Support Service
    - Billing Service
```

### BusinessObject

```yaml
BusinessObject:
  description: "Concept used within business domain"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  properties:
    - key: "spec.schema"
      value: "schemas/business-object.json" (optional)
    - key: "spec.schema-id"
      value: "schema-uuid" (optional, formal reference to Data Model Layer)
    - key: "data.governance-owner"
      value: "business-actor-id" (optional, data owner reference)

    # Application Layer Integration
    - key: "application.represented-by-dataobject"
      value: "data-object-id" (optional, DataObject ID that represents this business concept in applications)
    - key: "application.master-data-source"
      value: "data-object-id" (optional, authoritative DataObject for this business object)

  examples:
    - Order
    - Invoice
    - Customer
    - Product
```

### Contract

```yaml
Contract:
  description: "Formal specification of agreement"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  properties:
    - key: "contract.constraint-refs"
      value: "constraint-id-1,constraint-id-2" (optional, comma-separated Constraint IDs)
    - key: "contract.sla-metrics"
      value: "specs/sla-metrics.yaml" (optional, measurable SLA commitments)

  examples:
    - Service Level Agreement
    - Terms of Service
    - Purchase Agreement
```

### Representation

```yaml
Representation:
  description: "Perceptible form of business object"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)
    format: RepresentationFormat [enum]

  enums:
    RepresentationFormat:
      - document
      - report
      - form
      - message

  examples:
    - Order Form
    - Invoice PDF
    - Customer Report
```

### Product

```yaml
Product:
  description: "Coherent collection of services with a value"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  contains:
    - services: BusinessService[] (1..*)
    - contracts: Contract[] (0..*)

  examples:
    - Basic Subscription
    - Premium Package
    - Enterprise Solution
```

## Relationships

### Structural Relationships

- **Composition**: Product contains BusinessServices
- **Aggregation**: BusinessCollaboration aggregates BusinessRoles
- **Assignment**: BusinessActor assigned to BusinessRole
- **Realization**: BusinessProcess realizes BusinessService

### Behavioral Relationships

- **Triggering**: BusinessEvent triggers BusinessProcess
- **Flow**: BusinessProcess flows to BusinessProcess

### Other Relationships

- **Association**: BusinessObject associated with BusinessProcess
- **Access**: BusinessProcess accesses BusinessObject
- **Serving**: BusinessService serves BusinessActor

## Example Model

```xml
<model>
  <!-- Business Actors -->
  <element id="customer" type="BusinessActor">
    <name>Customer</name>
    <documentation>External customer of our services</documentation>
  </element>

  <element id="sales-rep" type="BusinessActor">
    <name>Sales Representative</name>
  </element>

  <!-- Business Collaboration -->
  <element id="sales-team" type="BusinessCollaboration">
    <name>Sales Team</name>
    <property key="collaboration.security-actors">actor-sales-rep,actor-sales-manager</property>
    <property key="collaboration.shared-permissions">order.create,customer.read</property>
  </element>

  <!-- Business Interface -->
  <element id="customer-portal" type="BusinessInterface">
    <name>Customer Portal</name>
    <property key="interface.api-operations">listOrders,createOrder,getOrderStatus</property>
    <property key="interface.digital-channel">web</property>
  </element>

  <!-- Business Process -->
  <element id="order-process" type="BusinessProcess">
    <name>Order Fulfillment Process</name>
    <property key="process.bpmn">processes/order-fulfillment.bpmn</property>
    <property key="process.security-controls">control-order-approval,control-payment-verification</property>
    <property key="process.audit-required">true</property>
    <property key="process.separation-of-duty">true</property>
    <property key="apm.business-metrics">metric-order-fulfillment-time,metric-order-success-rate</property>
    <property key="process.kpi-target">completion-time: 2hours, success-rate: 99%</property>
  </element>

  <!-- Business Event -->
  <element id="order-received-event" type="BusinessEvent">
    <name>Customer Order Received</name>
    <property key="event.application-ref">app-event-order-created</property>
    <property key="event.topic">orders.received</property>
  </element>

  <!-- Business Service -->
  <element id="order-service" type="BusinessService">
    <name>Order Processing Service</name>
    <property key="sla.availability">99.9%</property>
    <property key="sla.response-time">24 hours</property>
    <property key="motivation.delivers-value">value-customer-convenience,value-operational-efficiency</property>
    <property key="motivation.supports-goals">goal-customer-satisfaction,goal-revenue-growth</property>
    <property key="motivation.governed-by-principles">principle-customer-first,principle-automation</property>
  </element>

  <!-- Business Object -->
  <element id="order-object" type="BusinessObject">
    <name>Order</name>
    <property key="spec.schema">schemas/order.json</property>
    <property key="spec.schema-id">550e8400-e29b-41d4-a716-446655440000</property>
    <property key="data.governance-owner">sales-rep</property>
  </element>

  <!-- Contract -->
  <element id="order-sla" type="Contract">
    <name>Order Processing SLA</name>
    <property key="contract.constraint-refs">constraint-processing-time,constraint-availability</property>
    <property key="contract.sla-metrics">specs/order-sla-metrics.yaml</property>
  </element>

  <!-- Relationships -->
  <relationship type="Realization" source="order-process" target="order-service"/>
  <relationship type="Access" source="order-process" target="order-object"/>
  <relationship type="Serving" source="order-service" target="customer"/>
  <relationship type="Triggering" source="order-received-event" target="order-process"/>
  <relationship type="Serving" source="customer-portal" target="customer"/>
</model>
```

## Integration Points

**For complete link patterns and validation rules**, see [Cross-Layer Reference Registry](../core/06-cross-layer-reference-registry.md). The following integration points are defined in the registry with specific patterns and validation requirements.

### To Application Layer

- **BusinessService** realized by **ApplicationService**
- **BusinessProcess** automated by **ApplicationProcess** (application.realized-by-process property)
- **BusinessProcess** maps to **ApplicationProcess** steps (application.process-steps property)
- **BusinessObject** represented in **DataObject** (application.represented-by-dataobject property)
- **BusinessObject** master data source from **DataObject** (application.master-data-source property)
- **BusinessEvent** triggers **ApplicationEvent** (event.application-ref property)

### To Motivation Layer

- **BusinessService** delivers **Value** (motivation.delivers-value property)
- **BusinessService** supports **Goals** (motivation.supports-goals property)
- **BusinessService** governed by **Principles** (motivation.governed-by-principles property)
- **BusinessProcess** achieves **Goal**
- **BusinessActor** is **Stakeholder**
- **Contract** drives **Constraints** (contract.constraint-refs property)
- **BusinessObject** ownership by **BusinessActor** (data.governance-owner property)

### To API Layer

- **BusinessInterface** maps to **API Operations** (interface.api-operations property)
- BusinessInterface digital channels (web, mobile, api, partner-integration)

### To Security Layer

- **BusinessProcess** protected by **Security Controls** (process.security-controls property)
- **BusinessCollaboration** maps to **Security Actors** (collaboration.security-actors property)
- **BusinessCollaboration** defines **Permissions** (collaboration.shared-permissions property)

### To Data Model Layer

- **BusinessObject** → **JSON Schema** (spec.schema property)
- **BusinessObject** → **Schema ID** (spec.schema-id property) for strong data governance

### To APM/Observability Layer

- **BusinessProcess** tracked by **Business Metrics** (apm.business-metrics property)
- **BusinessProcess** defines **KPI Targets** (process.kpi-target property)

### To Other Specifications

- BusinessProcess → BPMN file (process.bpmn property)
- BusinessObject → JSON Schema (spec.schema property)
- BusinessService → SLA document (sla.\* properties)
- Contract → SLA Metrics (contract.sla-metrics property)
- BusinessEvent → Event Topic (event.topic property)

## Validation Rules

### Core Validation

1. **Naming Convention**: BusinessElements use PascalCase
2. **Required Attributes**: All elements must have id and name
3. **Relationship Validity**: Source and target must exist
4. **Property References**: Referenced files should exist
5. **Circular Dependencies**: No circular composition relationships

### Cross-Layer Reference Validation

6. **Event References**: event.application-ref must reference valid ApplicationEvent ID
7. **Constraint References**: contract.constraint-refs must reference valid Constraint IDs
8. **API Operation References**: interface.api-operations must reference valid operationIds from OpenAPI specs
9. **Security Control References**: process.security-controls must reference valid security controls
10. **Security Actor References**: collaboration.security-actors must reference valid Actor IDs
11. **Schema References**: spec.schema-id must reference valid JSON Schema identifier
12. **Business Actor References**: data.governance-owner must reference valid BusinessActor ID
13. **Motivation References**: motivation.\* properties must reference valid Goal/Value/Principle IDs
14. **Metric References**: apm.business-metrics must reference valid metric definitions

### Property Format Validation

15. **Comma-Separated Lists**: Multi-value properties should use comma-separated format (no spaces)
16. **Boolean Values**: Boolean properties must be "true" or "false" (lowercase)
17. **KPI Format**: process.kpi-target should use "key: value" pairs separated by commas
18. **Topic Format**: event.topic should follow hierarchical format (e.g., "domain.entity.action")

## Best Practices

### Core Modeling

1. **Start with Business Services** - Define what value you deliver
2. **Map Actors and Roles** - Identify who performs what
3. **Detail Business Processes** - Show how services are realized
4. **Define Business Objects** - Clarify key business concepts
5. **Model Events** - Capture triggers and state changes

### Cross-Layer Integration

6. **Link Services to Goals** - Use motivation.supports-goals to show business alignment
7. **Link Services to Value** - Use motivation.delivers-value to demonstrate stakeholder value
8. **Connect Events to Applications** - Use event.application-ref to bridge business and technical events
9. **Map Interfaces to APIs** - Use interface.api-operations for digital transformation
10. **Trace Contracts to Constraints** - Use contract.constraint-refs for compliance traceability

### Security and Governance

11. **Secure Business Processes** - Use process.security-controls to document security requirements
12. **Enable Audit Trails** - Set process.audit-required for sensitive processes
13. **Enforce Separation of Duty** - Use process.separation-of-duty for critical processes
14. **Map Collaborations to Actors** - Use collaboration.security-actors for RBAC design

### Data Governance

15. **Link Objects to Schemas** - Use spec.schema-id for strong data governance
16. **Assign Data Owners** - Use data.governance-owner to establish accountability
17. **Document SLAs** - Add sla.\* properties to BusinessServices
18. **Track Contract Metrics** - Use contract.sla-metrics for measurable commitments

### Observability

19. **Define Business Metrics** - Use apm.business-metrics to measure process performance
20. **Set KPI Targets** - Use process.kpi-target to define success criteria
