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
  
  <!-- Business Process -->
  <element id="order-process" type="BusinessProcess">
    <name>Order Fulfillment Process</name>
    <property key="process.bpmn">processes/order-fulfillment.bpmn</property>
  </element>
  
  <!-- Business Service -->
  <element id="order-service" type="BusinessService">
    <name>Order Processing Service</name>
    <property key="sla.availability">99.9%</property>
    <property key="sla.response-time">24 hours</property>
  </element>
  
  <!-- Business Object -->
  <element id="order-object" type="BusinessObject">
    <name>Order</name>
    <property key="spec.schema">schemas/order.json</property>
  </element>
  
  <!-- Relationships -->
  <relationship type="Realization" source="order-process" target="order-service"/>
  <relationship type="Access" source="order-process" target="order-object"/>
  <relationship type="Serving" source="order-service" target="customer"/>
</model>
```

## Integration Points

### To Application Layer
- BusinessService realized by ApplicationService
- BusinessProcess supported by ApplicationProcess
- BusinessObject represented in DataObject

### To Motivation Layer
- BusinessService delivers Value
- BusinessProcess achieves Goal
- BusinessActor is Stakeholder

### To Other Specifications
- BusinessProcess → BPMN file (process.bpmn property)
- BusinessObject → JSON Schema (spec.schema property)
- BusinessService → SLA document (sla.* properties)

## Validation Rules

1. **Naming Convention**: BusinessElements use PascalCase
2. **Required Attributes**: All elements must have id and name
3. **Relationship Validity**: Source and target must exist
4. **Property References**: Referenced files should exist
5. **Circular Dependencies**: No circular composition relationships

## Best Practices

1. **Start with Business Services** - Define what value you deliver
2. **Map Actors and Roles** - Identify who performs what
3. **Detail Business Processes** - Show how services are realized
4. **Define Business Objects** - Clarify key business concepts
5. **Link to Schemas** - Reference detailed specifications via properties
6. **Document SLAs** - Add service level properties to BusinessServices
7. **Model Events** - Capture triggers and state changes
