# Layer 2: Business Layer

Represents business services, processes, actors, and objects that define the organization's operational structure and capabilities.

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

This section documents the intra-layer relationships available within the Business Layer. All relationship types align with ArchiMate 3.2 semantics and are catalogued in the relationship catalog.

### Structural Relationships

Structural relationships define static connections between elements, establishing composition, specialization, and assignment patterns.

#### Composition

- **Product composes BusinessService**: Products contain services as integral parts
- **BusinessCollaboration composes BusinessRole**: Collaborations are composed of participating roles (use Aggregation as roles can exist independently)
- **BusinessProcess composes BusinessProcess**: Complex processes decompose into sub-processes
- **BusinessFunction composes BusinessProcess**: Functions group processes by capability

**Semantics**: Part cannot exist without the whole; lifecycle is tightly coupled.

#### Aggregation

- **Product aggregates BusinessService**: Products bundle services that can exist independently
- **Product aggregates Contract**: Products bundle contracts (SLAs, terms)
- **BusinessCollaboration aggregates BusinessRole**: Collaborations aggregate roles that participate
- **Goal aggregates Goal**: High-level goals aggregate sub-goals (cross-layer to Motivation)
- **Requirement aggregates Requirement**: Requirements decompose into detailed requirements (cross-layer to Motivation)

**Semantics**: Part can exist independently; lifecycle is loosely coupled.

#### Assignment

- **BusinessActor assigned-to BusinessRole**: Actors are assigned to perform roles
- **BusinessRole assigned-to BusinessProcess**: Roles are responsible for executing processes
- **BusinessRole assigned-to BusinessFunction**: Roles are responsible for functions
- **BusinessActor assigned-to BusinessProcess**: Actors can be directly assigned to processes (simpler models)
- **BusinessCollaboration assigned-to BusinessInteraction**: Collaborations perform interactions

**Semantics**: Active element (actor, role, collaboration) performs behavior (process, function, interaction).

#### Realization

- **BusinessProcess realizes BusinessService**: Processes implement service capabilities
- **BusinessFunction realizes BusinessService**: Functions realize service capabilities through grouped behaviors
- **BusinessInteraction realizes BusinessService**: Interactions realize services through collective behavior
- **Representation realizes BusinessObject**: Representations (forms, documents) make business objects tangible

**Semantics**: Implementation element realizes abstract or intended element.

#### Specialization

- **BusinessObject specializes BusinessObject**: Type hierarchy (e.g., PremiumOrder specializes Order)
- **Contract specializes Contract**: Contract type hierarchy (e.g., PremiumSLA specializes StandardSLA)
- **BusinessRole specializes BusinessRole**: Role hierarchy

**Semantics**: Subtype inherits and extends characteristics of supertype; transitive.

### Behavioral Relationships

Behavioral relationships describe dynamic interactions, flows, and temporal dependencies between business behaviors.

#### Triggering

- **BusinessEvent triggers BusinessProcess**: Events initiate process execution
- **BusinessEvent triggers BusinessFunction**: Events initiate functional capabilities
- **BusinessEvent triggers BusinessInteraction**: Events initiate collaborative interactions
- **BusinessProcess triggers BusinessEvent**: Processes emit events upon completion or state changes
- **BusinessInteraction triggers BusinessProcess**: Interactions can trigger follow-up processes

**Semantics**: Temporal causation; source initiates target execution.

#### Flow

- **BusinessProcess flows-to BusinessProcess**: Sequential process flow (control/data transfer)
- **BusinessInteraction flows-to BusinessProcess**: Interaction outcomes flow to processes

**Semantics**: Transfer of control, data, or responsibility from one behavior to the next.

#### Serving

- **BusinessService serves BusinessActor**: Services are available to actors
- **BusinessService serves BusinessRole**: Services serve roles
- **BusinessService serves BusinessProcess**: Services provide capabilities to processes
- **BusinessInterface serves BusinessActor**: Interfaces provide access to actors
- **BusinessInterface serves BusinessRole**: Interfaces provide access to roles

**Semantics**: Service/interface makes functionality available to consumer.

#### Access

- **BusinessProcess accesses BusinessObject**: Processes read/write business object data
- **BusinessFunction accesses BusinessObject**: Functions access business object data
- **BusinessInteraction accesses BusinessObject**: Interactions access business objects during execution

**Semantics**: Behavior element reads, writes, or manipulates passive element (data/artifact).

### Dependency Relationships

Dependency relationships indicate that one element requires or relies on another for functionality.

#### Association

- **Contract associated-with BusinessService**: Contracts govern services (SLAs, terms)
- **BusinessObject associated-with BusinessProcess**: Generic relationship indicating relevance

**Semantics**: Generic bidirectional relationship; indicates elements are related or connected.

### Relationship Patterns by Entity

#### BusinessActor Patterns

- **assigned-to** BusinessRole (performs roles)
- **assigned-to** BusinessProcess (performs processes directly)
- **served-by** BusinessService (consumes services)
- **served-by** BusinessInterface (accesses interfaces)

#### BusinessRole Patterns

- **aggregated-by** BusinessCollaboration (participates in teams)
- **assigned-to** BusinessProcess (executes processes)
- **assigned-to** BusinessFunction (performs functions)
- **served-by** BusinessService (consumes services)
- **served-by** BusinessInterface (accesses interfaces)
- **specializes** BusinessRole (role hierarchy)

#### BusinessCollaboration Patterns

- **aggregates** BusinessRole (includes participating roles)
- **assigned-to** BusinessInteraction (performs collaborative behaviors)

#### BusinessProcess Patterns

- **realizes** BusinessService (implements service capability)
- **composes** BusinessProcess (contains sub-processes)
- **composed-by** BusinessFunction (grouped by functional capability)
- **flows-to** BusinessProcess (sequential flow)
- **accesses** BusinessObject (data access)
- **triggered-by** BusinessEvent (initiated by events)
- **triggers** BusinessEvent (emits events)
- **served-by** BusinessService (consumes services)
- **assigned-to** BusinessRole (executed by roles)
- **assigned-to** BusinessActor (executed by actors)

#### BusinessFunction Patterns

- **realizes** BusinessService (provides service capability)
- **composes** BusinessProcess (groups processes)
- **accesses** BusinessObject (data access)
- **triggered-by** BusinessEvent (initiated by events)

#### BusinessInteraction Patterns

- **realizes** BusinessService (provides service through collaboration)
- **accesses** BusinessObject (data access during interaction)
- **triggers** BusinessProcess (initiates follow-up processes)
- **assigned-to** BusinessCollaboration (performed by collaboration)

#### BusinessEvent Patterns

- **triggers** BusinessProcess (initiates processes)
- **triggers** BusinessFunction (initiates functions)
- **triggers** BusinessInteraction (initiates interactions)
- **triggered-by** BusinessProcess (emitted by processes)

#### BusinessService Patterns

- **realized-by** BusinessProcess (implemented by processes)
- **realized-by** BusinessFunction (implemented by functions)
- **realized-by** BusinessInteraction (implemented by interactions)
- **aggregated-by** Product (bundled in products)
- **serves** BusinessActor (available to actors)
- **serves** BusinessRole (available to roles)
- **serves** BusinessProcess (provides capabilities to processes)
- **associated-with** Contract (governed by contracts)

#### BusinessInterface Patterns

- **serves** BusinessActor (provides access to actors)
- **serves** BusinessRole (provides access to roles)

#### BusinessObject Patterns

- **accessed-by** BusinessProcess (used by processes)
- **accessed-by** BusinessFunction (used by functions)
- **accessed-by** BusinessInteraction (used by interactions)
- **realized-by** Representation (manifested as forms/documents)
- **specializes** BusinessObject (type hierarchy)

#### Contract Patterns

- **aggregated-by** Product (bundled with products)
- **associated-with** BusinessService (governs services)
- **specializes** Contract (contract type hierarchy)

#### Representation Patterns

- **realizes** BusinessObject (tangible form of business object)

#### Product Patterns

- **aggregates** BusinessService (bundles services)
- **aggregates** Contract (bundles contracts/SLAs)

## Example Model

```xml
<model>
  <!-- ============================= -->
  <!-- Business Actors -->
  <!-- ============================= -->
  <element id="customer" type="BusinessActor">
    <name>Customer</name>
    <documentation>External customer of our services</documentation>
  </element>

  <element id="sales-rep" type="BusinessActor">
    <name>Sales Representative</name>
    <documentation>Internal sales staff member</documentation>
  </element>

  <!-- ============================= -->
  <!-- Business Roles -->
  <!-- ============================= -->
  <element id="role-account-manager" type="BusinessRole">
    <name>Account Manager</name>
    <documentation>Role responsible for managing customer accounts</documentation>
  </element>

  <element id="role-order-processor" type="BusinessRole">
    <name>Order Processor</name>
    <documentation>Role responsible for processing customer orders</documentation>
  </element>

  <element id="role-sales-support" type="BusinessRole">
    <name>Sales Support</name>
    <documentation>Role providing support to sales activities</documentation>
  </element>

  <!-- ============================= -->
  <!-- Business Collaboration -->
  <!-- ============================= -->
  <element id="sales-team" type="BusinessCollaboration">
    <name>Sales Team</name>
    <documentation>Collaborative team of sales roles working together</documentation>
    <property key="collaboration.security-actors">actor-sales-rep,actor-sales-manager</property>
    <property key="collaboration.shared-permissions">order.create,customer.read</property>
  </element>

  <!-- ============================= -->
  <!-- Business Interfaces -->
  <!-- ============================= -->
  <element id="customer-portal" type="BusinessInterface">
    <name>Customer Portal</name>
    <documentation>Web-based customer self-service interface</documentation>
    <property key="interface.api-operations">listOrders,createOrder,getOrderStatus</property>
    <property key="interface.digital-channel">web</property>
  </element>

  <!-- ============================= -->
  <!-- Business Processes -->
  <!-- ============================= -->
  <element id="order-process" type="BusinessProcess">
    <name>Order Fulfillment Process</name>
    <documentation>End-to-end process for fulfilling customer orders</documentation>
    <property key="process.bpmn">processes/order-fulfillment.bpmn</property>
    <property key="process.security-controls">control-order-approval,control-payment-verification</property>
    <property key="process.audit-required">true</property>
    <property key="process.separation-of-duty">true</property>
    <property key="apm.business-metrics">metric-order-fulfillment-time,metric-order-success-rate</property>
    <property key="process.kpi-target">completion-time: 2hours, success-rate: 99%</property>
  </element>

  <element id="payment-verification-process" type="BusinessProcess">
    <name>Payment Verification</name>
    <documentation>Sub-process for verifying payment information</documentation>
  </element>

  <element id="shipping-process" type="BusinessProcess">
    <name>Shipping Process</name>
    <documentation>Process for shipping fulfilled orders</documentation>
  </element>

  <element id="self-service-order-process" type="BusinessProcess">
    <name>Self-Service Order Process</name>
    <documentation>Customer-driven order placement process</documentation>
  </element>

  <!-- ============================= -->
  <!-- Business Functions -->
  <!-- ============================= -->
  <element id="sales-function" type="BusinessFunction">
    <name>Sales</name>
    <documentation>Sales business capability grouping</documentation>
  </element>

  <element id="customer-service-function" type="BusinessFunction">
    <name>Customer Service</name>
    <documentation>Customer service business capability grouping</documentation>
  </element>

  <!-- ============================= -->
  <!-- Business Interactions -->
  <!-- ============================= -->
  <element id="contract-negotiation" type="BusinessInteraction">
    <name>Contract Negotiation</name>
    <documentation>Collaborative interaction for negotiating contracts</documentation>
  </element>

  <!-- ============================= -->
  <!-- Business Events -->
  <!-- ============================= -->
  <element id="order-received-event" type="BusinessEvent">
    <name>Customer Order Received</name>
    <documentation>Event triggered when customer places an order</documentation>
    <property key="event.application-ref">app-event-order-created</property>
    <property key="event.topic">orders.received</property>
  </element>

  <element id="order-completed-event" type="BusinessEvent">
    <name>Order Completed</name>
    <documentation>Event triggered when order fulfillment completes</documentation>
    <property key="event.topic">orders.completed</property>
  </element>

  <element id="new-customer-event" type="BusinessEvent">
    <name>New Customer Registered</name>
    <documentation>Event triggered when new customer registers</documentation>
    <property key="event.topic">customers.registered</property>
  </element>

  <!-- ============================= -->
  <!-- Business Services -->
  <!-- ============================= -->
  <element id="order-service" type="BusinessService">
    <name>Order Processing Service</name>
    <documentation>Service for processing customer orders</documentation>
    <property key="sla.availability">99.9%</property>
    <property key="sla.response-time">24 hours</property>
    <property key="motivation.delivers-value">value-customer-convenience,value-operational-efficiency</property>
    <property key="motivation.supports-goals">goal-customer-satisfaction,goal-revenue-growth</property>
    <property key="motivation.governed-by-principles">principle-customer-first,principle-automation</property>
  </element>

  <element id="customer-support-service" type="BusinessService">
    <name>Customer Support Service</name>
    <documentation>Service for providing customer assistance</documentation>
    <property key="sla.availability">99.5%</property>
    <property key="sla.response-time">4 hours</property>
  </element>

  <element id="payment-service" type="BusinessService">
    <name>Payment Processing Service</name>
    <documentation>Service for processing payments</documentation>
  </element>

  <!-- ============================= -->
  <!-- Business Objects -->
  <!-- ============================= -->
  <element id="order-object" type="BusinessObject">
    <name>Order</name>
    <documentation>Customer order business concept</documentation>
    <property key="spec.schema">schemas/order.json</property>
    <property key="spec.schema-id">550e8400-e29b-41d4-a716-446655440000</property>
    <property key="data.governance-owner">sales-rep</property>
  </element>

  <element id="premium-order" type="BusinessObject">
    <name>Premium Order</name>
    <documentation>Premium tier customer order with enhanced features</documentation>
    <property key="spec.schema">schemas/premium-order.json</property>
  </element>

  <element id="customer-object" type="BusinessObject">
    <name>Customer</name>
    <documentation>Customer business concept</documentation>
    <property key="spec.schema">schemas/customer.json</property>
  </element>

  <element id="contract-object" type="BusinessObject">
    <name>Contract</name>
    <documentation>Business contract concept</documentation>
  </element>

  <element id="invoice-object" type="BusinessObject">
    <name>Invoice</name>
    <documentation>Invoice business concept</documentation>
  </element>

  <!-- ============================= -->
  <!-- Contracts -->
  <!-- ============================= -->
  <element id="order-sla" type="Contract">
    <name>Order Processing SLA</name>
    <documentation>Service level agreement for order processing</documentation>
    <property key="contract.constraint-refs">constraint-processing-time,constraint-availability</property>
    <property key="contract.sla-metrics">specs/order-sla-metrics.yaml</property>
  </element>

  <element id="standard-sla" type="Contract">
    <name>Standard SLA</name>
    <documentation>Standard service level agreement</documentation>
  </element>

  <element id="premium-sla" type="Contract">
    <name>Premium SLA</name>
    <documentation>Enhanced service level agreement for premium customers</documentation>
  </element>

  <!-- ============================= -->
  <!-- Representations -->
  <!-- ============================= -->
  <element id="order-form" type="Representation">
    <name>Order Form</name>
    <documentation>Web form for creating orders</documentation>
    <format>form</format>
  </element>

  <element id="invoice-pdf" type="Representation">
    <name>Invoice PDF</name>
    <documentation>Printable invoice document</documentation>
    <format>document</format>
  </element>

  <!-- ============================= -->
  <!-- Products -->
  <!-- ============================= -->
  <element id="premium-package" type="Product">
    <name>Premium Service Package</name>
    <documentation>Premium tier product offering</documentation>
  </element>

  <!-- ============================= -->
  <!-- RELATIONSHIPS -->
  <!-- ============================= -->

  <!-- Priority 1: Structural Foundation -->
  <relationship type="Assignment" source="sales-rep" target="role-account-manager"/>
  <relationship type="Aggregation" source="sales-team" target="role-account-manager"/>
  <relationship type="Aggregation" source="sales-team" target="role-sales-support"/>
  <relationship type="Aggregation" source="premium-package" target="order-service"/>
  <relationship type="Aggregation" source="premium-package" target="customer-support-service"/>
  <relationship type="Aggregation" source="premium-package" target="order-sla"/>

  <!-- Priority 2: Behavioral Relationships -->
  <relationship type="Assignment" source="role-order-processor" target="order-process"/>
  <relationship type="Realization" source="customer-service-function" target="customer-support-service"/>
  <relationship type="Composition" source="order-process" target="payment-verification-process"/>
  <relationship type="Flow" source="order-process" target="shipping-process"/>
  <relationship type="Composition" source="sales-function" target="order-process"/>

  <!-- Priority 3: Collaboration and Interaction -->
  <relationship type="Assignment" source="sales-team" target="contract-negotiation"/>
  <relationship type="Access" source="contract-negotiation" target="contract-object"/>

  <!-- Priority 4: Service and Interface Relationships -->
  <relationship type="Serving" source="customer-portal" target="role-account-manager"/>
  <relationship type="Serving" source="order-service" target="role-order-processor"/>
  <relationship type="Serving" source="payment-service" target="order-process"/>

  <!-- Priority 5: Contract and Passive Element Relationships -->
  <relationship type="Association" source="order-sla" target="order-service"/>
  <relationship type="Specialization" source="premium-sla" target="standard-sla"/>
  <relationship type="Realization" source="order-form" target="order-object"/>
  <relationship type="Realization" source="invoice-pdf" target="invoice-object"/>
  <relationship type="Specialization" source="premium-order" target="order-object"/>

  <!-- Priority 6: Event Relationships -->
  <relationship type="Triggering" source="new-customer-event" target="customer-service-function"/>
  <relationship type="Triggering" source="order-process" target="order-completed-event"/>

  <!-- Priority 7: Actor and Access Relationships -->
  <relationship type="Assignment" source="customer" target="self-service-order-process"/>
  <relationship type="Access" source="sales-function" target="customer-object"/>
  <relationship type="Access" source="self-service-order-process" target="order-form"/>

  <!-- Original Relationships (from initial example) -->
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

## Intra-Layer Relationships

**Purpose**: Define structural and behavioral relationships between entities within this layer.

### Structural Relationships

Relationships that define the composition, aggregation, and specialization of entities within this layer.

| Relationship   | Source Element | Target Element | Predicate     | Inverse Predicate | Cardinality | Description |
| -------------- | -------------- | -------------- | ------------- | ----------------- | ----------- | ----------- |
| Composition    | (TBD)          | (TBD)          | `composes`    | `composed-of`     | 1:N         | (TBD)       |
| Aggregation    | (TBD)          | (TBD)          | `aggregates`  | `aggregated-by`   | 1:N         | (TBD)       |
| Specialization | (TBD)          | (TBD)          | `specializes` | `generalized-by`  | N:1         | (TBD)       |

### Behavioral Relationships

Relationships that define interactions, flows, and dependencies between entities within this layer.

| Relationship | Source Element | Target Element | Predicate | Inverse Predicate | Cardinality | Description |
| ------------ | -------------- | -------------- | --------- | ----------------- | ----------- | ----------- |
| (TBD)        | (TBD)          | (TBD)          | (TBD)     | (TBD)             | (TBD)       | (TBD)       |

---

## Cross-Layer Relationships

**Purpose**: Define semantic links to entities in other layers, supporting traceability, governance, and architectural alignment.

### Outgoing Relationships (This Layer → Other Layers)

Links from entities in this layer to entities in other layers.

#### To Motivation Layer (01)

Links to strategic goals, requirements, principles, and constraints.

| Predicate                | Source Element | Target Element | Field Path                          | Strength | Required | Examples |
| ------------------------ | -------------- | -------------- | ----------------------------------- | -------- | -------- | -------- |
| `supports-goals`         | (TBD)          | Goal           | `motivation.supports-goals`         | High     | No       | (TBD)    |
| `fulfills-requirements`  | (TBD)          | Requirement    | `motivation.fulfills-requirements`  | High     | No       | (TBD)    |
| `governed-by-principles` | (TBD)          | Principle      | `motivation.governed-by-principles` | High     | No       | (TBD)    |
| `constrained-by`         | (TBD)          | Constraint     | `motivation.constrained-by`         | Medium   | No       | (TBD)    |

### Incoming Relationships (Other Layers → This Layer)

Links from entities in other layers to entities in this layer.

(To be documented based on actual usage patterns)

---

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
