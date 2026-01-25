# Layer 4: Application Layer

Describes application services, components, and interfaces that support business processes and bridge requirements with technical implementation.

## Overview

The Application Layer describes the application services that support the business, and the applications that realize them. This layer bridges business requirements with technical implementation.

## Layer Characteristics

- **Standard**: ArchiMate 3.2 Application Layer
- **Custom Extensions**: Properties for external specifications
- **Validation**: ArchiMate XSD schema
- **Tooling**: ArchiMate modeling tools, API design tools

## Entity Definitions

### ApplicationComponent

```yaml
ApplicationComponent:
  description: "Modular, deployable, and replaceable part of a system"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)
    type: ComponentType [enum]

  properties:
    - key: "implementation.framework"
      value: "react|vue|angular|spring|express" (optional)
    - key: "spec.ux"
      value: "specs/component-ux.yaml" (optional)
    - key: "spec.openapi"
      value: "specs/component-api.yaml" (optional)

  enums:
    ComponentType:
      - frontend
      - backend
      - mobile
      - desktop
      - service

  examples:
    - Product Management UI
    - Order Service
    - Mobile App
    - API Gateway
```

### ApplicationCollaboration

```yaml
ApplicationCollaboration:
  description: "Aggregate of application components working together"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  contains:
    - components: ApplicationComponent[] (2..*)

  examples:
    - Microservices Cluster
    - Frontend Application Suite
    - Integration Layer
```

### ApplicationInterface

```yaml
ApplicationInterface:
  description: "Point of access where application service is available"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)
    protocol: InterfaceProtocol [enum]

  properties:
    - key: "spec.openapi"
      value: "specs/interface-api.yaml" (optional)
    - key: "interface.endpoint"
      value: "https://api.example.com/v1" (optional)

  enums:
    InterfaceProtocol:
      - REST
      - GraphQL
      - SOAP
      - gRPC
      - WebSocket
      - Message Queue

  examples:
    - REST API
    - GraphQL Endpoint
    - Message Queue Interface
```

### ApplicationFunction

```yaml
ApplicationFunction:
  description: "Automated behavior performed by application component"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  properties:
    - key: "function.async"
      value: "true|false" (optional)
    - key: "function.idempotent"
      value: "true|false" (optional)

    # Motivation Layer Integration
    - key: "motivation.fulfills-requirements"
      value: "requirement-id-1,requirement-id-2" (optional, comma-separated Requirement IDs this function fulfills)
    - key: "motivation.governed-by-principles"
      value: "principle-id-1,principle-id-2" (optional, comma-separated Principle IDs)

  examples:
    - Data Validation
    - Payment Processing
    - Report Generation
```

### ApplicationInteraction

```yaml
ApplicationInteraction:
  description: "Unit of collective application behavior"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)
    pattern: InteractionPattern [enum]

  enums:
    InteractionPattern:
      - request-response
      - publish-subscribe
      - async-messaging
      - streaming

  examples:
    - API Call Sequence
    - Event Broadcasting
    - Data Synchronization
```

### ApplicationProcess

```yaml
ApplicationProcess:
  description: "Sequence of application behaviors"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  properties:
    - key: "process.orchestration"
      value: "specs/orchestration.yaml" (optional)
    - key: "process.saga"
      value: "specs/saga-definition.yaml" (optional)

  examples:
    - Order Processing Workflow
    - Data Pipeline
    - Batch Job
```

### ApplicationEvent

```yaml
ApplicationEvent:
  description: "Application state change notification"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)
    eventType: ApplicationEventType [enum]

  properties:
    - key: "event.schema"
      value: "schemas/event.json" (optional)
    - key: "event.topic"
      value: "orders.created" (optional)

  enums:
    ApplicationEventType:
      - domain-event
      - integration-event
      - system-event
      - audit-event

  examples:
    - OrderCreated
    - UserLoggedIn
    - DataProcessed
    - SystemError
```

### ApplicationService

```yaml
ApplicationService:
  description: "Service that exposes application functionality"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)
    serviceType: ServiceType [enum]

  properties:
    - key: "spec.openapi"
      value: "specs/service-api.yaml" (optional)
    - key: "service.version"
      value: "0.1.1" (optional)
    - key: "service.deprecated"
      value: "true|false" (optional)

    # APM/Observability Layer Integration
    - key: "apm.traced"
      value: "true|false" (optional)
    - key: "apm.business-metrics"
      value: "metric-id-1,metric-id-2" (optional, comma-separated business metric IDs this service tracks)
    - key: "apm.sla-target-latency"
      value: "200ms|500ms|1000ms" (optional, target response time)
    - key: "apm.sla-target-availability"
      value: "99.9%|99.95%|99.99%" (optional, target uptime percentage)

    # Motivation Layer Integration
    - key: "motivation.supports-goals"
      value: "goal-id-1,goal-id-2" (optional, comma-separated Goal IDs)
    - key: "motivation.delivers-value"
      value: "value-id-1,value-id-2" (optional, comma-separated Value IDs)
    - key: "motivation.governed-by-principles"
      value: "principle-id-1,principle-id-2" (optional, comma-separated Principle IDs)

  enums:
    ServiceType:
      - synchronous
      - asynchronous
      - batch
      - streaming

  examples:
    # Service with motivation mapping and APM tracking
    - name: "Product API"
      serviceType: synchronous
      properties:
        - key: "spec.openapi"
          value: "specs/product-api.yaml"
        - key: "service.version"
          value: "2.0.0"
        - key: "apm.traced"
          value: "true"
        - key: "apm.business-metrics"
          value: "metric-product-views,metric-product-searches,metric-catalog-accuracy"
        - key: "apm.sla-target-latency"
          value: "200ms"
        - key: "apm.sla-target-availability"
          value: "99.95%"
        - key: "motivation.supports-goals"
          value: "goal-product-catalog-accuracy,goal-mobile-app-launch"
        - key: "motivation.delivers-value"
          value: "value-customer-convenience,value-operational-efficiency"
        - key: "motivation.governed-by-principles"
          value: "principle-api-first,principle-security-by-design"

    - Authentication Service
    - Notification Service
```

### DataObject

```yaml
DataObject:
  description: "Data structured for automated processing"
  attributes:
    id: string (UUID) [PK]
    name: string
    documentation: string (optional)

  properties:
    - key: "spec.schema"
      value: "schemas/data-object.json" (optional)
    - key: "spec.database"
      value: "schemas/table-definition.sql" (optional)
    - key: "data.pii"
      value: "true|false" (optional)
    - key: "data.retention"
      value: "90days|1year|7years" (optional)

  examples:
    - Customer Data
    - Order Data
    - Product Catalog
    - Transaction Log
```

## Relationships

This section documents the intra-layer relationships available within the Application Layer. All relationship types align with ArchiMate 3.2 semantics and are catalogued in the relationship catalog.

### Structural Relationships

Structural relationships define static connections between elements, establishing composition, aggregation, assignment, realization, and specialization patterns.

#### Aggregation

- **ApplicationCollaboration aggregates ApplicationComponent**: Collaborations aggregate multiple components working together

#### Composition

- **ApplicationComponent composes ApplicationInterface**: Components compose interfaces as their access points
- **ApplicationProcess composes ApplicationProcess**: Complex processes decompose into sub-processes

#### Assignment

- **ApplicationComponent assigned-to ApplicationFunction**: Components are assigned to perform functions
- **ApplicationCollaboration assigned-to ApplicationInteraction**: Collaborations are assigned to perform interactions

#### Realization

- **ApplicationComponent realizes ApplicationService**: Components realize the services they provide
- **ApplicationFunction realizes ApplicationService**: Functions realize abstract service behavior
- **ApplicationProcess realizes ApplicationService**: Processes realize services through their execution
- **ApplicationService realizes ApplicationInterface**: Services are realized through interfaces (how services become accessible)

#### Specialization

- **DataObject specializes DataObject**: Data objects support type hierarchies (e.g., OrderData specializes TransactionData)

### Behavioral Relationships

Behavioral relationships describe dynamic interactions between elements, including triggering, flow, and data access patterns.

#### Triggering

- **ApplicationEvent triggers ApplicationComponent**: Events trigger component behavior
- **ApplicationEvent triggers ApplicationFunction**: Events trigger function execution
- **ApplicationEvent triggers ApplicationProcess**: Events trigger process execution
- **ApplicationProcess triggers ApplicationEvent**: Processes emit events upon completion or state changes

#### Flow

- **ApplicationService flows-to ApplicationService**: Services flow sequentially in service orchestration
- **ApplicationProcess flows-to ApplicationProcess**: Processes flow sequentially in workflows

#### Access

- **ApplicationService accesses DataObject**: Services access data during operation
- **ApplicationFunction accesses DataObject**: Functions read/write data objects during execution
- **ApplicationProcess accesses DataObject**: Processes access data during execution sequences
- **ApplicationInteraction accesses DataObject**: Interactions access data during collective behavior

### Dependency Relationships

Dependency relationships describe serving and usage patterns between application elements.

#### Serving

- **ApplicationInterface serves ApplicationComponent**: Interfaces serve as access points to components

#### Used By

- **ApplicationService used-by BusinessProcess**: Application services are used by business processes (cross-layer)

## Example Model

```xml
<model>
  <!-- Application Components -->
  <element id="product-api" type="ApplicationComponent">
    <n>Product API</n>
    <documentation>RESTful API for product management</documentation>
    <property key="implementation.framework">express</property>
    <property key="spec.openapi">specs/product-api.yaml</property>
  </element>

  <element id="product-ui" type="ApplicationComponent">
    <n>Product Management UI</n>
    <property key="implementation.framework">react</property>
    <property key="spec.ux">specs/product-ui.yaml</property>
  </element>

  <element id="order-service" type="ApplicationComponent">
    <n>Order Service</n>
    <documentation>Microservice for order processing</documentation>
    <property key="implementation.framework">spring</property>
  </element>

  <!-- Application Collaboration -->
  <element id="ecommerce-platform" type="ApplicationCollaboration">
    <n>E-Commerce Platform</n>
    <documentation>Collaboration of microservices for e-commerce</documentation>
  </element>

  <!-- Application Services -->
  <element id="product-service" type="ApplicationService">
    <n>Product Service</n>
    <property key="spec.openapi">specs/product-service.yaml</property>
    <property key="service.version">2.0.0</property>
    <property key="apm.traced">true</property>
    <property key="motivation.supports-goals">goal-product-catalog-accuracy,goal-customer-satisfaction</property>
    <property key="motivation.delivers-value">value-customer-convenience</property>
    <property key="motivation.governed-by-principles">principle-api-first,principle-cloud-native</property>
  </element>

  <element id="order-management-service" type="ApplicationService">
    <n>Order Management Service</n>
    <property key="service.version">1.5.0</property>
  </element>

  <!-- Application Interfaces -->
  <element id="rest-interface" type="ApplicationInterface">
    <n>REST API Interface</n>
    <property key="interface.endpoint">https://api.example.com/v2</property>
  </element>

  <element id="graphql-interface" type="ApplicationInterface">
    <n>GraphQL API Interface</n>
    <property key="interface.endpoint">https://api.example.com/graphql</property>
  </element>

  <!-- Application Functions -->
  <element id="validate-product-data" type="ApplicationFunction">
    <n>Validate Product Data</n>
    <documentation>Validates product information against business rules</documentation>
  </element>

  <element id="calculate-order-total" type="ApplicationFunction">
    <n>Calculate Order Total</n>
    <documentation>Calculates total cost including tax and shipping</documentation>
  </element>

  <!-- Application Interactions -->
  <element id="product-sync-interaction" type="ApplicationInteraction">
    <n>Product Synchronization</n>
    <documentation>Interaction for syncing product data across services</documentation>
  </element>

  <!-- Application Processes -->
  <element id="order-fulfillment-process" type="ApplicationProcess">
    <n>Order Fulfillment Process</n>
    <documentation>End-to-end order processing workflow</documentation>
    <property key="process.orchestration">specs/order-fulfillment.yaml</property>
  </element>

  <element id="validate-order-subprocess" type="ApplicationProcess">
    <n>Validate Order Subprocess</n>
    <documentation>Validation step within order fulfillment</documentation>
  </element>

  <element id="payment-processing-process" type="ApplicationProcess">
    <n>Payment Processing</n>
    <documentation>Process for handling payment transactions</documentation>
  </element>

  <!-- Application Events -->
  <element id="product-updated-event" type="ApplicationEvent">
    <n>ProductUpdated Event</n>
    <property key="event.schema">schemas/product-updated-event.json</property>
    <property key="event.topic">products.updated</property>
  </element>

  <element id="order-completed-event" type="ApplicationEvent">
    <n>OrderCompleted Event</n>
    <property key="event.schema">schemas/order-completed-event.json</property>
    <property key="event.topic">orders.completed</property>
  </element>

  <!-- Data Objects -->
  <element id="product-data" type="DataObject">
    <n>Product Data</n>
    <property key="spec.schema">schemas/product.json</property>
    <property key="spec.database">schemas/products-table.sql</property>
    <property key="data.pii">false</property>
    <property key="data.retention">61320h</property>
  </element>

  <element id="order-data" type="DataObject">
    <n>Order Data</n>
    <property key="spec.schema">schemas/order.json</property>
    <property key="data.pii">true</property>
    <property key="data.retention">61320h</property>
  </element>

  <element id="transaction-data" type="DataObject">
    <n>Transaction Data</n>
    <documentation>Base type for all transaction records</documentation>
    <property key="data.retention">61320h</property>
  </element>

  <!-- Relationships -->

  <!-- Structural: Aggregation -->
  <relationship type="Aggregation" source="ecommerce-platform" target="product-api"/>
  <relationship type="Aggregation" source="ecommerce-platform" target="order-service"/>

  <!-- Structural: Composition -->
  <relationship type="Composition" source="product-api" target="rest-interface"/>
  <relationship type="Composition" source="order-service" target="graphql-interface"/>
  <relationship type="Composition" source="order-fulfillment-process" target="validate-order-subprocess"/>

  <!-- Structural: Assignment -->
  <relationship type="Assignment" source="product-api" target="validate-product-data"/>
  <relationship type="Assignment" source="order-service" target="calculate-order-total"/>
  <relationship type="Assignment" source="ecommerce-platform" target="product-sync-interaction"/>

  <!-- Structural: Realization -->
  <relationship type="Realization" source="product-api" target="product-service"/>
  <relationship type="Realization" source="order-service" target="order-management-service"/>
  <relationship type="Realization" source="validate-product-data" target="product-service"/>
  <relationship type="Realization" source="order-fulfillment-process" target="order-management-service"/>
  <relationship type="Realization" source="product-service" target="rest-interface"/>
  <relationship type="Realization" source="order-management-service" target="graphql-interface"/>

  <!-- Structural: Specialization -->
  <relationship type="Specialization" source="order-data" target="transaction-data"/>

  <!-- Behavioral: Triggering -->
  <relationship type="Triggering" source="product-updated-event" target="product-api"/>
  <relationship type="Triggering" source="product-updated-event" target="validate-product-data"/>
  <relationship type="Triggering" source="order-completed-event" target="order-fulfillment-process"/>
  <relationship type="Triggering" source="payment-processing-process" target="order-completed-event"/>

  <!-- Behavioral: Flow -->
  <relationship type="Flow" source="product-service" target="order-management-service"/>
  <relationship type="Flow" source="validate-order-subprocess" target="payment-processing-process"/>

  <!-- Behavioral: Access -->
  <relationship type="Access" source="product-service" target="product-data"/>
  <relationship type="Access" source="validate-product-data" target="product-data"/>
  <relationship type="Access" source="order-fulfillment-process" target="order-data"/>
  <relationship type="Access" source="product-sync-interaction" target="product-data"/>

  <!-- Dependency: Serving -->
  <relationship type="Serving" source="rest-interface" target="product-api"/>
  <relationship type="Serving" source="graphql-interface" target="order-service"/>
</model>
```

## Integration Points

**For complete link patterns and validation rules**, see:
- **[Cross-Layer Relationships Guide](../guides/CROSS_LAYER_RELATIONSHIPS.md)** - Clarifies which pattern to use and naming conventions
- **[Cross-Layer Reference Registry](../core/06-cross-layer-reference-registry.md)** - Complete catalog of all 60+ patterns. The following integration points are defined in the registry with specific patterns and validation requirements.

### To Motivation Layer

- **ApplicationService** supports **Goal** (motivation.supports-goals property)
- **ApplicationService** delivers **Value** (motivation.delivers-value property)
- **ApplicationService** governed by **Principle** (motivation.governed-by-principles property)
- **ApplicationFunction** fulfills **Requirement** (motivation.fulfills-requirements property)
- **ApplicationFunction** governed by **Principle** (motivation.governed-by-principles property)

### From Business Layer

- **ApplicationService** realizes **BusinessService** (application.realized-by-service property)
- **ApplicationProcess** supports **BusinessProcess** (application.realized-by-process property)
- **DataObject** represents **BusinessObject** (application.represented-by-dataobject property)

### To Technology Layer

- **ApplicationComponent** deployed on **Node** (technology.deployed-on property)
- **ApplicationService** uses **TechnologyService** (technology.uses-service property)
- **DataObject** stored in **Artifact** (technology.stored-in property)

### To APM/Observability Layer

- **ApplicationService** tracked by **Business Metric** (apm.business-metrics property)
- **ApplicationService** monitored for **SLA Target** (apm.sla-target-latency property)
- **ApplicationService** monitored for **Availability** (apm.sla-target-availability property)
- **ApplicationService** traced by **APM** (apm.traced property)

### To External Specifications

- **ApplicationService** defined by **OpenAPI Specification** (spec.openapi property)
- **DataObject** defined by **JSON Schema** (spec.schema property)
- **ApplicationComponent** defined by **UX Specification** (spec.ux property)
- **ApplicationEvent** defined by **Event Schema** (spec.asyncapi property)

## Property Conventions

### API References

```yaml
spec.openapi: "path/to/openapi.yaml" # OpenAPI specification
spec.graphql: "path/to/schema.graphql" # GraphQL schema
spec.asyncapi: "path/to/asyncapi.yaml" # AsyncAPI for events
```

### Implementation Details

```yaml
implementation.framework: "react|vue|angular|express|spring"
implementation.language: "typescript|java|python|go"
implementation.version: "16.0.0" # Framework version
```

### Service Properties

```yaml
service.version: "2.0.0" # Semantic version
service.deprecated: "true|false" # Deprecation flag
service.auth: "oauth2|jwt|apikey" # Authentication method
service.rateLimit: "100/minute" # Rate limiting
```

### Data Properties

```yaml
data.pii: "true|false" # Contains PII
data.encrypted: "true|false" # Encryption at rest
data.retention: "90days|1year" # Retention period
data.classification: "public|internal|confidential"
```

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

1. **Service Specification**: ApplicationServices with REST interfaces should have spec.openapi
2. **Data Schema**: DataObjects should have spec.schema reference
3. **Version Format**: service.version should follow semantic versioning
4. **Component Type**: Frontend components should have spec.ux reference
5. **Event Schema**: ApplicationEvents should have event.schema
6. **Unique Endpoints**: interface.endpoint values should be unique

## Best Practices

1. **Define Clear Interfaces** - Every ApplicationService should have a well-defined interface
2. **Reference Detailed Specs** - Use properties to link to OpenAPI, schemas, etc.
3. **Model Data Flow** - Show how data moves between components
4. **Capture Events** - Model significant state changes as ApplicationEvents
5. **Version Services** - Always include service.version for APIs
6. **Document Deprecation** - Mark deprecated services explicitly
7. **Trace Critical Paths** - Set apm.traced=true for important services
8. **Classify Data** - Always specify PII and retention for DataObjects
