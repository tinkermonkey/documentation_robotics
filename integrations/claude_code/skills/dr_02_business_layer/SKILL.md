---
name: LAYER_02_BUSINESS
description: Expert knowledge for Business Layer modeling in Documentation Robotics
triggers:
  [
    "business process",
    "business service",
    "business actor",
    "business role",
    "business object",
    "BPMN",
    "business layer",
    "archimate business"
  ]
version: 0.8.3
---

# Business Layer Skill

**Layer Number:** 02
**Specification:** Metadata Model Spec v0.8.3
**Purpose:** Represents business services, processes, actors, and objects that define the organization's operational structure and capabilities.

---

## Layer Overview

The Business Layer captures the **operational structure** of the organization:

- **WHO** - Business actors, roles, and collaborations
- **WHAT** - Business services and products
- **HOW** - Business processes, functions, and interactions
- **INFORMATION** - Business objects and their representations

This layer uses **ArchiMate 3.2 Business Layer** standard without custom extensions, with optional extensions for BPMN integration, SLA tracking, and security controls.

---

## Entity Types

> **CLI Introspection:** Run `dr schema types business` for the authoritative, always-current list of node types.
> Run `dr schema node <type-id>` for full attribute details on any type.

| Entity Type               | Description                                          | Key Attributes                                                        |
| ------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| **BusinessActor**         | Organizational entity capable of performing behavior | Examples: Customer, Employee, Partner, Supplier                       |
| **BusinessRole**          | Responsibility for performing specific behavior      | Examples: Sales Representative, Account Manager, System Administrator |
| **BusinessCollaboration** | Aggregate of business roles working together         | Examples: Sales Team, Customer Service Department, Project Team       |
| **BusinessInterface**     | Point of access where business service is available  | Examples: Customer Portal, Phone Support, Email Support               |
| **BusinessProcess**       | Sequence of business behaviors achieving a result    | Can include BPMN references, security controls, KPI targets           |
| **BusinessFunction**      | Collection of business behavior based on criteria    | Examples: Marketing, Sales, Customer Service, Finance                 |
| **BusinessInteraction**   | Unit of collective behavior by collaboration         | Examples: Sales Meeting, Contract Negotiation, Customer Onboarding    |
| **BusinessEvent**         | Something that happens and influences behavior       | Types: time-driven, state-change, external                            |
| **BusinessService**       | Service that fulfills a business need                | Includes SLA properties, motivation links, APM monitoring             |
| **BusinessObject**        | Concept used within business domain                  | Examples: Order, Invoice, Customer, Opportunity, Support Ticket       |
| **Contract**              | Formal specification of agreement                    | Examples: SLA, Terms of Service, Purchase Agreement                   |
| **Representation**        | Perceptible form of business object                  | Required `format`: pdf, html, xml, json, plain-text, binary           |
| **Product**               | Coherent collection of services with a value         | Aggregates services and contracts, delivers value to customers        |

---

## Type Decision Tree

Use this decision tree **before assigning a type** to any observed business concept.

```
IS this an individual person, organization, or system that acts in the business domain?
  → BusinessActor (e.g., Customer, Supplier, Partner)

IS this a named responsibility or hat worn by an actor?
  → BusinessRole (e.g., Sales Representative, Account Manager)

IS this a group of roles working together toward a shared goal?
  → BusinessCollaboration (e.g., Sales Team, Project Team)

IS this a channel or contact point where a business service is accessed?
  → BusinessInterface (e.g., Customer Portal, Phone Support Line)

IS this a structured sequence of steps that produces a business outcome?
  → BusinessProcess (e.g., Order Fulfillment, Loan Approval)

IS this a grouping of related business behaviors (department-level capability)?
  → BusinessFunction (e.g., Marketing, Finance, Customer Support)

IS this a joint behavior performed by two or more roles together?
  → BusinessInteraction (e.g., Contract Negotiation, Sales Meeting)

IS this something that happens and triggers a response in the business?
  → BusinessEvent (e.g., Order Received, Payment Confirmed)

IS this an externally visible capability the business offers to stakeholders?
  → BusinessService (e.g., Order Management Service, Payment Service)

IS this a key domain concept or data entity used in business language?
  → BusinessObject (e.g., Order, Invoice, Customer)

IS this a formal agreement with binding terms between parties?
  → Contract (e.g., SLA, Purchase Agreement, Terms of Service)

IS this a concrete form in which a business object is communicated?
  → Representation (e.g., Invoice PDF, Order Confirmation Email)

IS this a coherent bundle of services with a value proposition for customers?
  → Product (e.g., E-commerce Platform, Premium Support Package)
```

---

## Common Misclassifications

| Misclassification                                     | Correct Classification                                                                                         | Why                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A department or team as `BusinessService`             | `BusinessFunction` (department) or `BusinessCollaboration` (team)                                              | Services are externally visible capabilities; departments are behavioral groupings |
| A REST endpoint or UI as `BusinessInterface`          | `BusinessInterface` is correct — but link it to the `ApplicationInterface` in the application layer            | Business interfaces are the business-facing access point, not the technical one    |
| A business rule or policy as `BusinessProcess`        | `BusinessProcess` only for sequences of steps; rules belong in Motivation layer as `Principle` or `Constraint` | Processes produce outcomes through behavior; rules govern behavior                 |
| A domain entity (Order, Invoice) as `BusinessProcess` | `BusinessObject`                                                                                               | Objects are concepts; processes are sequences of behavior                          |
| A job title (Sales Rep) as `BusinessActor`            | `BusinessRole`                                                                                                 | Roles are responsibilities; actors are the people/orgs that fill them              |
| An SLA document as `BusinessService`                  | `Contract`                                                                                                     | An SLA is a formal agreement, not the service itself                               |
| A product feature as `BusinessFunction`               | `Product` if it bundles services with customer value; `BusinessService` if it's a single capability            | Products aggregate services; functions are internal behavioral groupings           |

---

## Intra-Layer Relationships

### Structural Relationships

| Source Type           | Predicate   | Target Type         | Example                                                           |
| --------------------- | ----------- | ------------------- | ----------------------------------------------------------------- |
| Product               | composes    | BusinessService     | "E-commerce Platform" composes "Payment Service"                  |
| BusinessCollaboration | composes    | BusinessRole        | "Sales Team" composes "Sales Representative" role                 |
| BusinessProcess       | composes    | BusinessProcess     | "Order Fulfillment" composes "Pick", "Pack", "Ship" sub-processes |
| BusinessFunction      | composes    | BusinessProcess     | "Sales Function" composes "Lead Generation Process"               |
| Product               | aggregates  | BusinessService     | Product bundles multiple services                                 |
| Product               | aggregates  | Contract            | Product includes SLA contracts                                    |
| BusinessCollaboration | aggregates  | BusinessRole        | Collaboration includes multiple roles                             |
| BusinessActor         | assigned-to | BusinessRole        | "John Smith" assigned to "Sales Rep"                              |
| BusinessActor         | assigned-to | BusinessProcess     | Actor directly performs process                                   |
| BusinessRole          | assigned-to | BusinessProcess     | Role responsible for process execution                            |
| BusinessRole          | assigned-to | BusinessFunction    | Role performs function                                            |
| BusinessCollaboration | assigned-to | BusinessInteraction | Collaboration performs interaction                                |
| BusinessProcess       | realizes    | BusinessService     | "Order Processing" realizes "Order Management Service"            |
| BusinessFunction      | realizes    | BusinessService     | "Customer Support Function" realizes "Support Service"            |
| BusinessInteraction   | realizes    | BusinessService     | "Contract Negotiation" realizes "Contracting Service"             |
| Representation        | realizes    | BusinessObject      | "Invoice PDF" realizes "Invoice" concept                          |
| BusinessObject        | specializes | BusinessObject      | "RetailCustomer" specializes "Customer"                           |
| BusinessRole          | specializes | BusinessRole        | "Senior Sales Rep" specializes "Sales Rep"                        |
| Contract              | specializes | Contract            | "Premium SLA" specializes "Standard SLA"                          |

### Behavioral Relationships

| Source Type         | Predicate       | Target Type         | Example                                                      |
| ------------------- | --------------- | ------------------- | ------------------------------------------------------------ |
| BusinessEvent       | triggers        | BusinessProcess     | "Order Received" triggers "Order Fulfillment Process"        |
| BusinessEvent       | triggers        | BusinessFunction    | "Monthly Close" triggers "Financial Reporting Function"      |
| BusinessEvent       | triggers        | BusinessInteraction | "Customer Complaint" triggers "Issue Resolution Interaction" |
| BusinessProcess     | triggers        | BusinessEvent       | "Payment Complete" triggers "Order Confirmed Event"          |
| BusinessInteraction | triggers        | BusinessProcess     | "Sales Meeting" triggers "Proposal Generation Process"       |
| BusinessProcess     | flows-to        | BusinessProcess     | "Credit Check" flows to "Order Approval"                     |
| BusinessInteraction | flows-to        | BusinessProcess     | "Negotiation" flows to "Contract Signing"                    |
| BusinessService     | serves          | BusinessActor       | "Customer Portal" serves "Customer"                          |
| BusinessService     | serves          | BusinessRole        | "Reporting Service" serves "Manager" role                    |
| BusinessService     | serves          | BusinessProcess     | "Authentication Service" serves "Login Process"              |
| BusinessInterface   | serves          | BusinessActor       | "Mobile App" serves "Customer"                               |
| BusinessInterface   | serves          | BusinessRole        | "Admin Console" serves "Administrator" role                  |
| BusinessProcess     | accesses        | BusinessObject      | "Order Process" accesses "Order" object                      |
| BusinessFunction    | accesses        | BusinessObject      | "Billing Function" accesses "Invoice" object                 |
| BusinessInteraction | accesses        | BusinessObject      | "Contract Review" accesses "Contract" object                 |
| Contract            | associated-with | BusinessService     | SLA contract associated with service delivery                |
| BusinessObject      | associated-with | BusinessProcess     | "Customer" associated with "Onboarding Process"              |

---

## Cross-Layer References

### Outgoing References (Business → Lower Layers)

| Target Layer              | Reference Type                                      | Example                                                  |
| ------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| **Layer 1 (Motivation)**  | BusinessService delivers **Value**                  | "Payment Service" delivers "Revenue Generation" value    |
| **Layer 1 (Motivation)**  | BusinessService supports **Goal**                   | Service achieves business goals                          |
| **Layer 1 (Motivation)**  | BusinessService governed by **Principle**           | Follows business principles                              |
| **Layer 1 (Motivation)**  | BusinessActor **is** Stakeholder                    | Actor maps to stakeholder in motivation layer            |
| **Layer 1 (Motivation)**  | BusinessProcess achieves **Goal**                   | Process realizes business goals                          |
| **Layer 1 (Motivation)**  | Contract drives **Constraint**                      | SLA contract defines constraints                         |
| **Layer 4 (Application)** | BusinessService realized by **ApplicationService**  | "Order Service" realized by "OrderManagementAPI"         |
| **Layer 4 (Application)** | BusinessProcess automated by **ApplicationProcess** | Process workflow automated by application                |
| **Layer 4 (Application)** | BusinessObject represented in **DataObject**        | "Customer" business concept maps to customer data object |
| **Layer 4 (Application)** | BusinessEvent triggers **ApplicationEvent**         | Business event generates application event               |
| **Layer 3 (Security)**    | BusinessProcess protected by **SecurityControl**    | Process has authentication/authorization                 |
| **Layer 3 (Security)**    | BusinessCollaboration maps to **SecurityActor**     | Team maps to security roles                              |
| **Layer 6 (API)**         | BusinessInterface maps to **API Operation**         | Portal interface maps to REST endpoints                  |
| **Layer 7 (Data Model)**  | BusinessObject → **JSON Schema**                    | Business object defined as schema                        |
| **Layer 11 (APM)**        | BusinessProcess tracked by **BusinessMetric**       | Process performance measured                             |
| **Layer 11 (APM)**        | BusinessService defines **KPI Target**              | SLA targets for monitoring                               |

### Incoming References (Lower Layers → Business)

Lower layers (Application, Technology, API, etc.) reference Business layer elements to show:

- **Realization**: Application services realize business services
- **Support**: Technology supports business operations
- **Traceability**: APIs map to business interfaces

---

## Codebase Detection Patterns

### Pattern 1: Service Layer Classes

```python
# FastAPI Business Service
@app.post("/api/orders")
async def create_order(order_data: OrderRequest):
    """Creates a new customer order (Business Service: Order Management)"""
    pass
```

**Maps to:**

- BusinessService: "Order Management Service"
- BusinessProcess: "Create Order Process"
- BusinessObject: "Order"
- BusinessInterface: "API Interface"

### Pattern 2: Domain Models

```python
from dataclasses import dataclass

@dataclass
class Customer:
    """Customer business object"""
    customer_id: str
    name: str
    email: str
    status: str  # active, inactive, suspended
```

**Maps to:**

- BusinessObject: "Customer"
- Potential BusinessProcess: "Customer Management"

### Pattern 3: Event Definitions

```typescript
// Domain events
export enum BusinessEvents {
  ORDER_CREATED = "order.created",
  ORDER_FULFILLED = "order.fulfilled",
  PAYMENT_RECEIVED = "payment.received"
}
```

**Maps to:**

- BusinessEvent entities (order.created, order.fulfilled, payment.received)

### Pattern 4: BPMN Process References

```python
# Process definition with BPMN reference
class OrderFulfillmentProcess:
    """
    Order fulfillment business process
    BPMN: processes/order-fulfillment.bpmn
    KPI: 95% orders fulfilled within 24 hours
    """
    def execute(self, order_id: str):
        pass
```

**Maps to:**

- BusinessProcess: "Order Fulfillment"
- Properties: `bpmn-file`, `kpi-target`

### Pattern 5: Role-Based Authorization

```python
from enum import Enum

class BusinessRole(Enum):
    SALES_REP = "sales_representative"
    ACCOUNT_MANAGER = "account_manager"
    CUSTOMER_SERVICE = "customer_service"
    ADMIN = "administrator"

@require_role(BusinessRole.SALES_REP)
def create_opportunity(data):
    pass
```

**Maps to:**

- BusinessRole entities (SalesRepresentative, AccountManager, etc.)

### Pattern 6: SLA Configuration

```yaml
# Service SLA definitions
services:
  order_processing:
    sla:
      availability: 99.9%
      response_time: 500ms
      throughput: 1000 req/sec
    business_hours: "24/7"
```

**Maps to:**

- BusinessService with SLA properties
- Contract entity for formal SLA

---

## Coverage Completeness Checklist

Before declaring business layer extraction complete, verify ALL 13 entity types have been considered:

```
□ BusinessActor      — people, orgs, or systems that act (Customer, Supplier, Partner)
□ BusinessRole       — named responsibilities assigned to actors (Sales Rep, Admin)
□ BusinessCollaboration — groups of roles working together (Sales Team, Support Dept)
□ BusinessInterface  — access points where services are available (Portal, API, Phone)
□ BusinessProcess    — step sequences producing a business outcome (Order Fulfillment)
□ BusinessFunction   — department-level behavioral capability (Marketing, Finance)
□ BusinessInteraction — collective behavior by a collaboration (Contract Negotiation)
□ BusinessEvent      — triggers: time-driven, state-change, external (Order Received)
□ BusinessService    — externally visible capability (Order Management, Payment)
□ BusinessObject     — key domain concepts (Order, Invoice, Customer, Opportunity)
□ Contract           — formal agreements: SLA, Terms of Service, Purchase Agreement
□ Representation     — concrete forms of objects (format: pdf, html, xml, json, plain-text, binary)
□ Product            — bundles of services with customer value proposition

If any type has ZERO elements, explicitly decide:
  "This type doesn't apply to this codebase" with reasoning.
```

---

## Modeling Workflow

### Step 1: Identify Business Actors and Roles

```bash
# Add business actors
dr add business actor "Customer" \
  --description "End user purchasing products"

dr add business collaboration "Sales Team" \
  --description "Internal sales organization"

# Add business roles
dr add business role "Sales Representative" \
  --description "Responsible for customer acquisition"

dr add business role "Account Manager" \
  --description "Manages existing customer relationships"
```

### Step 2: Define Business Services

```bash
# Core business service
dr add business service "Order Management Service" \
  --description "Manages customer order lifecycle"

# Link to motivation layer
dr relationship add business.businessservice.order-management-service \
  motivation.goal.improve-order-efficiency --predicate supports
```

### Step 3: Model Business Processes

```bash
# Main process
dr add business process "Order Fulfillment Process" \
  --description "End-to-end order fulfillment from creation to delivery"

# Sub-processes
dr add business process "Pick Items Process" \
  --description "Pick items from warehouse inventory"

dr add business process "Pack Order Process" \
  --description "Pack picked items for shipment"

# Composition relationships
dr relationship add business.businessprocess.order-fulfillment-process \
  business.businessprocess.pick-items-process --predicate composes

dr relationship add business.businessprocess.order-fulfillment-process \
  business.businessprocess.pack-order-process --predicate composes

# Process flows
dr relationship add business.businessprocess.pick-items-process \
  business.businessprocess.pack-order-process --predicate flows-to
```

### Step 4: Define Business Objects

```bash
# Core business objects
dr add business object "Order" \
  --description "Customer purchase order"

dr add business object "Customer" \
  --description "Individual or organization purchasing products"

dr add business object "Product" \
  --description "Item available for purchase"

# Process access to objects
dr relationship add business.businessprocess.order-fulfillment-process \
  business.businessobject.order --predicate accesses
```

### Step 5: Model Business Events

```bash
# Events that trigger processes
dr add business event "Order Received" \
  --description "New order submitted by customer"

dr add business event "Payment Confirmed" \
  --description "Payment successfully processed"

# Event triggering
dr relationship add business.businessevent.order-received \
  business.businessprocess.order-fulfillment-process --predicate triggers
```

### Step 6: Establish Cross-Layer Relationships

```bash
# Link to application layer
dr relationship add business.businessservice.order-management-service \
  application.applicationservice.order-api --predicate realized-by

# Link to motivation layer
dr relationship add business.businessservice.order-management-service \
  motivation.value.customer-satisfaction --predicate delivers

# Link to data layer
dr relationship add business.businessobject.order \
  data-model.objectschema.order --predicate defined-by
```

### Step 7: Validate

```bash
dr validate --layers business
dr validate --relationships
```

---

## Common Modeling Scenarios

### Scenario 1: E-commerce Order Management

```
Product: "E-commerce Platform"
├── composes → BusinessService: "Order Service"
│   ├── realizes ← BusinessProcess: "Order Fulfillment"
│   │   ├── triggers ← BusinessEvent: "Order Received"
│   │   ├── accesses → BusinessObject: "Order"
│   │   └── assigned-to → BusinessRole: "Order Processor"
│   └── realized-by → ApplicationService: "OrderManagementAPI"
├── composes → BusinessService: "Payment Service"
│   └── realizes ← BusinessProcess: "Payment Processing"
└── aggregates → Contract: "E-commerce SLA"
```

### Scenario 2: Customer Support System

```
BusinessFunction: "Customer Support"
├── composes → BusinessProcess: "Ticket Resolution"
│   ├── triggers ← BusinessEvent: "Support Request Received"
│   ├── assigned-to → BusinessRole: "Support Agent"
│   ├── accesses → BusinessObject: "Support Ticket"
│   └── flows-to → BusinessProcess: "Follow-up Communication"
├── realizes → BusinessService: "Support Service"
│   ├── serves → BusinessActor: "Customer"
│   └── properties: sla-response-time=2h, sla-resolution-time=24h
└── tracked-by → BusinessMetric: "First Response Time"
```

### Scenario 3: Sales Pipeline

```
BusinessCollaboration: "Sales Team"
├── composes → BusinessRole: "Sales Representative"
├── composes → BusinessRole: "Sales Manager"
└── assigned-to → BusinessInteraction: "Sales Meeting"
    ├── accesses → BusinessObject: "Opportunity"
    ├── flows-to → BusinessProcess: "Proposal Generation"
    └── triggers → BusinessEvent: "Deal Closed"
```

---

## BPMN Integration

When business processes reference BPMN diagrams:

```bash
dr add business process "Loan Approval Process" \
  --description "End-to-end loan application review and approval"
```

**BPMN Properties:**

- `bpmn-file`: Path to BPMN XML file
- `bpmn-version`: BPMN specification version (2.0)
- `bpmn-task-mapping`: Map BPMN tasks to business roles

**Validation:** Ensure BPMN task IDs align with business process sub-processes.

---

## SLA and Performance Tracking

Business services can define SLA targets:

```yaml
business-service:
  id: "payment-processing-service"
  properties:
    sla-availability: "99.99%"
    sla-response-time: "200ms"
    sla-throughput: "5000 tps"
    business-hours: "24/7"
    escalation-time: "15m"
```

These SLAs flow down to:

- **Application Layer** - Application services inherit targets
- **APM Layer** - Monitoring dashboards track against targets
- **Motivation Layer** - SLAs trace to business goals

---

## ArchiMate Export

```bash
dr export archimate --layers business --output business.archimate
```

**Supported ArchiMate Elements:**

- All 13 business entity types map directly to ArchiMate 3.2 Business Layer
- Relationships: composition, aggregation, assignment, realization, specialization, triggering, flow, serving, access, association

---

## Best Practices

1. **Start with Services, Not Processes** - Identify WHAT the business provides before HOW it's delivered
2. **Use Process Composition** - Break complex processes into manageable sub-processes
3. **Model Events Explicitly** - Event-driven architectures need explicit BusinessEvent entities
4. **Link to Motivation Early** - Connect services and processes to goals for traceability
5. **Don't Over-Detail** - Focus on architecturally significant processes, not every task
6. **Use BPMN for Complex Workflows** - Reference BPMN files rather than modeling every detail
7. **Distinguish Role from Actor** - Role is responsibility; Actor is individual/team
8. **Model Contracts for SLAs** - Formalize service agreements as Contract entities
9. **Track Business Objects** - Identify key domain concepts even if data model comes later

---

## Validation Tips

| Issue                        | Cause                                        | Fix                                           |
| ---------------------------- | -------------------------------------------- | --------------------------------------------- |
| Orphaned Process             | No event triggers it, no service realizes it | Add triggering event or link to service       |
| Unrealized Service           | No process/function realizes the service     | Add process that implements the service       |
| Missing Business Objects     | Processes don't access any objects           | Identify key domain concepts and add them     |
| No Cross-Layer Relationships | Business not linked to application/data      | Add realization relationships to lower layers |
| Unassigned Roles             | Roles not assigned to processes              | Assign roles to show responsibility           |
| Missing SLA Properties       | Services lack performance targets            | Add SLA properties for monitoring             |

---

## Quick Reference

**Add Commands:**

```bash
dr add business actor <name>
dr add business role <name>
dr add business service <name> --description <description>
dr add business process <name> --description <description>
dr add business object <name>
dr add business event <name> --description <description>
dr add business function <name>
dr add business collaboration <name>
```

**Relationship Commands:**

```bash
dr relationship add <source> <target> --predicate realizes
dr relationship add <source> <target> --predicate composes
dr relationship add <source> <target> --predicate assigned-to
dr relationship add <source> <target> --predicate triggers
dr relationship add <source> <target> --predicate flows-to
dr relationship add <source> <target> --predicate accesses
dr relationship add <source> <target> --predicate serves
```

**Cross-Layer Relationship Commands:**

```bash
dr relationship add <business-service> <motivation-goal> --predicate supports
dr relationship add <business-service> <application-service> --predicate realized-by
dr relationship add <business-object> <data-schema> --predicate defined-by
```
