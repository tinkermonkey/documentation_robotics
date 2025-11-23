# Application Layer - ArchiMate Application Elements

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
      value: "1.0.0" (optional)
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

### Structural Relationships
- **Composition**: ApplicationCollaboration contains ApplicationComponents
- **Assignment**: ApplicationComponent assigned to ApplicationFunction
- **Realization**: ApplicationComponent realizes ApplicationService

### Behavioral Relationships
- **Triggering**: ApplicationEvent triggers ApplicationProcess
- **Flow**: ApplicationService flows to ApplicationService
- **Access**: ApplicationService accesses DataObject

### Dependency Relationships
- **Serving**: ApplicationInterface serves ApplicationComponent
- **Used By**: ApplicationService used by BusinessProcess

## Example Model

```xml
<model>
  <!-- Application Component -->
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
  
  <!-- Application Service -->
  <element id="product-service" type="ApplicationService">
    <n>Product Service</n>
    <property key="spec.openapi">specs/product-service.yaml</property>
    <property key="service.version">2.0.0</property>
    <property key="apm.traced">true</property>
    <property key="motivation.supports-goals">goal-product-catalog-accuracy,goal-customer-satisfaction</property>
    <property key="motivation.delivers-value">value-customer-convenience</property>
    <property key="motivation.governed-by-principles">principle-api-first,principle-cloud-native</property>
  </element>
  
  <!-- Application Interface -->
  <element id="rest-interface" type="ApplicationInterface">
    <n>REST API Interface</n>
    <property key="interface.endpoint">https://api.example.com/v2</property>
  </element>
  
  <!-- Data Object -->
  <element id="product-data" type="DataObject">
    <n>Product Data</n>
    <property key="spec.schema">schemas/product.json</property>
    <property key="spec.database">schemas/products-table.sql</property>
    <property key="data.pii">false</property>
    <property key="data.retention">7years</property>
  </element>
  
  <!-- Application Event -->
  <element id="product-updated-event" type="ApplicationEvent">
    <n>ProductUpdated Event</n>
    <property key="event.schema">schemas/product-updated-event.json</property>
    <property key="event.topic">products.updated</property>
  </element>
  
  <!-- Relationships -->
  <relationship type="Realization" source="product-api" target="product-service"/>
  <relationship type="Access" source="product-service" target="product-data"/>
  <relationship type="Serving" source="rest-interface" target="product-api"/>
  <relationship type="Serving" source="product-service" target="product-ui"/>
  <relationship type="Triggering" source="product-updated-event" target="product-api"/>
</model>
```

## Integration Points

### To Motivation Layer
- **Services support Goals**: ApplicationService.properties["motivation.supports-goals"] links services to business objectives
- **Services deliver Value**: ApplicationService.properties["motivation.delivers-value"] shows value contribution
- **Principles guide design**: ApplicationService.properties["motivation.governed-by-principles"] ensures architectural consistency
- **Functions fulfill Requirements**: ApplicationFunction.properties["motivation.fulfills-requirements"] provides fine-grained requirement traceability
- **Functions governed by Principles**: ApplicationFunction.properties["motivation.governed-by-principles"] ensures function-level compliance
- **Portfolio management**: Enables capability-based planning and investment prioritization

### From Business Layer
- ApplicationService realizes BusinessService
- ApplicationProcess supports BusinessProcess (referenced by BusinessProcess.application.realized-by-process)
- DataObject represents BusinessObject (referenced by BusinessObject.application.represented-by-dataobject)

### To Technology Layer
- ApplicationComponent deployed on Node
- ApplicationService uses TechnologyService
- DataObject stored in Artifact

### To APM/Observability Layer
- **Services tracked by metrics**: ApplicationService.properties["apm.business-metrics"] links services to business KPIs
- **SLA targets defined**: ApplicationService.properties["apm.sla-target-latency"] and ["apm.sla-target-availability"] specify service levels
- **Distributed tracing**: ApplicationService.properties["apm.traced"] enables observability
- **Goal validation**: Enables closed-loop feedback on business objective achievement

### To External Specifications
- ApplicationService → OpenAPI specification
- DataObject → JSON Schema
- ApplicationComponent → UX specification
- ApplicationEvent → Event schema

## Property Conventions

### API References
```yaml
spec.openapi: "path/to/openapi.yaml"  # OpenAPI specification
spec.graphql: "path/to/schema.graphql" # GraphQL schema
spec.asyncapi: "path/to/asyncapi.yaml" # AsyncAPI for events
```

### Implementation Details
```yaml
implementation.framework: "react|vue|angular|express|spring"
implementation.language: "typescript|java|python|go"
implementation.version: "16.0.0"  # Framework version
```

### Service Properties
```yaml
service.version: "2.0.0"           # Semantic version
service.deprecated: "true|false"   # Deprecation flag
service.auth: "oauth2|jwt|apikey"  # Authentication method
service.rateLimit: "100/minute"    # Rate limiting
```

### Data Properties
```yaml
data.pii: "true|false"              # Contains PII
data.encrypted: "true|false"        # Encryption at rest
data.retention: "90days|1year"      # Retention period
data.classification: "public|internal|confidential"
```

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
