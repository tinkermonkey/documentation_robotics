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

The business layer's modelling rules (from `spec/layers/02-business.layer.json`):

- Actors fill roles. Roles and collaborations are `assigned-to` the processes, functions and interactions they perform; behaviour is never assigned to an actor directly.
- Internal behaviour `realizes` business services. Interfaces offer services (`assigned-to`), and services `serve` actors, roles and processes.
- Only behaviour `accesses` business objects and contracts. Actors, roles and interfaces reach information through the behaviour assigned to them.
- Events `trigger` processes and interactions, and behaviour raises events (`triggers`). A hand-off between behaviours is `flows-to`. A function has no start, so it is reached by `flows-to`, never triggered.

### Structural Relationships

| Source Type           | Predicate  | Target Type      | Example                                                    |
| --------------------- | ---------- | ---------------- | ---------------------------------------------------------- |
| Product               | aggregates | BusinessService  | "Premium Membership" aggregates "Free Shipping Service"    |
| Product               | composes   | Contract         | "Premium Membership" composes "Membership Terms"           |
| BusinessFunction      | composes   | BusinessFunction | "Sales" composes "Lead Management"                         |
| BusinessRole          | composes   | BusinessRole     | "Store Manager" composes "Cashier Supervisor"              |
| BusinessObject        | composes   | BusinessObject   | "Order" composes "Order Line"                              |
| BusinessCollaboration | aggregates | BusinessRole     | "Sales Team" aggregates "Sales Representative"             |
| Representation        | realizes   | BusinessObject   | "Invoice PDF" realizes "Invoice"                           |
| Representation        | realizes   | Contract         | "Signed MSA Document" realizes "Master Services Agreement" |
| Contract              | governs    | BusinessService  | "Premium SLA" governs "Support Service"                    |

### Assignment Relationships (who performs what)

| Source Type           | Predicate   | Target Type         | Example                                                  |
| --------------------- | ----------- | ------------------- | -------------------------------------------------------- |
| BusinessActor         | assigned-to | BusinessRole        | "Jane Smith" assigned to "Account Manager"               |
| BusinessRole          | assigned-to | BusinessProcess     | "Order Processor" assigned to "Order Fulfillment"        |
| BusinessRole          | assigned-to | BusinessFunction    | "Support Agent" assigned to "Customer Support"           |
| BusinessRole          | assigned-to | BusinessInteraction | "Account Manager" assigned to "Contract Negotiation"     |
| BusinessCollaboration | assigned-to | BusinessInteraction | "Sales Team" assigned to "Sales Meeting"                 |
| BusinessInterface     | assigned-to | BusinessService     | "Customer Portal" assigned to "Order Management Service" |

### Service Relationships

| Source Type         | Predicate | Target Type     | Example                                                 |
| ------------------- | --------- | --------------- | ------------------------------------------------------- |
| BusinessProcess     | realizes  | BusinessService | "Order Fulfillment" realizes "Order Management Service" |
| BusinessFunction    | realizes  | BusinessService | "Customer Support" realizes "Support Service"           |
| BusinessInteraction | realizes  | BusinessService | "Contract Negotiation" realizes "Contracting Service"   |
| BusinessService     | serves    | BusinessActor   | "Order Management Service" serves "Customer"            |
| BusinessService     | serves    | BusinessRole    | "Sales Reporting Service" serves "Regional Manager"     |
| BusinessService     | serves    | BusinessProcess | "Credit Check Service" serves "Loan Approval"           |
| BusinessInterface   | serves    | BusinessActor   | "Mobile App" serves "Customer"                          |
| BusinessInterface   | serves    | BusinessRole    | "Admin Console" serves "Administrator"                  |
| BusinessService     | delivers  | BusinessObject  | "Policy Issuance Service" delivers "Insurance Policy"   |

### Behavioral Relationships

| Source Type         | Predicate | Target Type         | Example                                               |
| ------------------- | --------- | ------------------- | ----------------------------------------------------- |
| BusinessEvent       | triggers  | BusinessProcess     | "Order Received" triggers "Order Fulfillment"         |
| BusinessEvent       | triggers  | BusinessInteraction | "Customer Complaint" triggers "Issue Resolution Call" |
| BusinessProcess     | triggers  | BusinessEvent       | "Order Shipping" triggers "Order Shipped"             |
| BusinessFunction    | triggers  | BusinessEvent       | "Financial Close" triggers "Month Closed"             |
| BusinessInteraction | triggers  | BusinessEvent       | "Contract Negotiation" triggers "Deal Agreed"         |
| BusinessProcess     | flows-to  | BusinessProcess     | "Pick Items" flows to "Pack Order"                    |
| BusinessProcess     | flows-to  | BusinessFunction    | "Order Fulfillment" flows to "Invoicing"              |
| BusinessFunction    | flows-to  | BusinessProcess     | "Underwriting" flows to "Policy Issuance"             |
| BusinessInteraction | flows-to  | BusinessProcess     | "Sales Meeting" flows to "Proposal Generation"        |

### Information Access Relationships

| Source Type         | Predicate | Target Type    | Example                                                |
| ------------------- | --------- | -------------- | ------------------------------------------------------ |
| BusinessProcess     | accesses  | BusinessObject | "Order Fulfillment" accesses "Order"                   |
| BusinessFunction    | accesses  | BusinessObject | "Billing" accesses "Invoice"                           |
| BusinessInteraction | accesses  | BusinessObject | "Contract Review" accesses "Quote"                     |
| BusinessProcess     | accesses  | Contract       | "Renewal Processing" accesses "Subscription Agreement" |
| BusinessFunction    | accesses  | Contract       | "Contract Management" accesses "Supplier Agreement"    |
| BusinessService     | accesses  | Contract       | "Support Service" accesses "Premium SLA"               |

---

## Cross-Layer References

### Outgoing References (Business → Other Layers)

| Source Type     | Predicate      | Target Type                    | Example                                                          |
| --------------- | -------------- | ------------------------------ | ---------------------------------------------------------------- |
| BusinessService | realizes       | `motivation.goal`              | "Order Management Service" realizes "Improve Order Efficiency"   |
| BusinessService | realizes       | `motivation.outcome`           | "Same-Day Delivery" realizes "Delivery Complaints Halved"        |
| BusinessService | delivers-value | `motivation.value`             | "Order Management Service" delivers value "Customer Convenience" |
| BusinessService | satisfies      | `motivation.requirement`       | "Support Service" satisfies "24/7 Support Availability"          |
| BusinessProcess | realizes       | `motivation.outcome`           | "Automated Refunds" realizes "Refund Time Under 48h"             |
| BusinessProcess | satisfies      | `motivation.requirement`       | "KYC Verification" satisfies "Verify Customer Identity"          |
| BusinessActor   | serves         | `motivation.stakeholder`       | "Customer" actor serves "Retail Customers" stakeholder           |
| BusinessRole    | serves         | `motivation.stakeholder`       | "Compliance Officer" serves "Regulators"                         |
| BusinessObject  | references     | `application.dataobject`       | "Order" references the "OrderRecord" data object                 |
| BusinessProcess | constrained-by | `security.securityconstraints` | "Payment Approval" constrained by "PCI Payment Constraints"      |
| BusinessProcess | constrained-by | `security.separationofduty`    | "Payment Approval" constrained by "Maker-Checker Rule"           |

### Incoming References (Other Layers → Business)

| Source Type                       | Predicate  | Target Type      | Example                                                 |
| --------------------------------- | ---------- | ---------------- | ------------------------------------------------------- |
| `application.applicationservice`  | realizes   | BusinessService  | "OrderService API" realizes "Order Management Service"  |
| `application.applicationprocess`  | realizes   | BusinessProcess  | "Checkout Saga" realizes "Order Fulfillment"            |
| `application.applicationfunction` | realizes   | BusinessFunction | "Invoice Generator" realizes "Billing"                  |
| `application.applicationevent`    | triggers   | BusinessProcess  | "PaymentSucceeded" event triggers "Order Fulfillment"   |
| `application.applicationservice`  | accesses   | BusinessObject   | "OrderService API" accesses "Order"                     |
| `product.feature`                 | realizes   | BusinessService  | "One-Click Reorder" realizes "Order Management Service" |
| `product.capability`              | realizes   | BusinessFunction | "Subscription Billing" realizes "Billing"               |
| `product.userworkflow`            | aggregates | BusinessProcess  | "Checkout Journey" aggregates "Order Fulfillment"       |
| `api.operation`                   | realizes   | BusinessProcess  | "POST /orders" realizes "Order Fulfillment"             |
| `data-model.objectschema`         | realizes   | BusinessObject   | "Order" schema realizes "Order" business object         |
| `data-store.collection`           | realizes   | BusinessObject   | "orders" table realizes "Order"                         |
| `security.role`                   | maps-to    | BusinessRole     | "admin" security role maps to "Administrator"           |
| `security.securitypolicy`         | governs    | BusinessService  | "Payment Security Policy" governs "Payment Service"     |
| `apm.metricinstrument`            | monitors   | BusinessProcess  | "orders.fulfilled" metric monitors "Order Fulfillment"  |
| `testing.testcoveragemodel`       | covers     | BusinessProcess  | "Checkout Coverage Model" covers "Order Fulfillment"    |

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
  motivation.goal.improve-order-efficiency --predicate realizes
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

# The catalog has no process-to-process composition; link sub-processes
# in sequence with flows-to, and tie the main process to the service it realizes
dr relationship add business.businessprocess.order-fulfillment-process \
  business.businessservice.order-management-service --predicate realizes

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
# Application service realizes the business service (source is the realizer)
dr relationship add application.applicationservice.order-api \
  business.businessservice.order-management-service --predicate realizes

# Link to motivation layer
dr relationship add business.businessservice.order-management-service \
  motivation.value.customer-satisfaction --predicate delivers-value

# Data-model schema realizes the business object
dr relationship add data-model.objectschema.order \
  business.businessobject.order --predicate realizes
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
├── aggregates → BusinessService: "Order Service"
│   ├── realizes ← BusinessProcess: "Order Fulfillment"
│   │   ├── triggers ← BusinessEvent: "Order Received"
│   │   ├── accesses → BusinessObject: "Order"
│   │   └── assigned-to ← BusinessRole: "Order Processor"
│   └── realizes ← ApplicationService: "OrderManagementAPI"
├── aggregates → BusinessService: "Payment Service"
│   └── realizes ← BusinessProcess: "Payment Processing"
└── composes → Contract: "E-commerce SLA"
```

### Scenario 2: Customer Support System

```
BusinessFunction: "Customer Support"
├── flows-to → BusinessProcess: "Ticket Resolution"
│   ├── triggers ← BusinessEvent: "Support Request Received"
│   ├── assigned-to ← BusinessRole: "Support Agent"
│   ├── accesses → BusinessObject: "Support Ticket"
│   └── flows-to → BusinessProcess: "Follow-up Communication"
├── realizes → BusinessService: "Support Service"
│   ├── serves → BusinessActor: "Customer"
│   └── properties: sla-response-time=2h, sla-resolution-time=24h
└── monitors ← apm.MetricInstrument: "First Response Time"
```

### Scenario 3: Sales Pipeline

```
BusinessCollaboration: "Sales Team"
├── aggregates → BusinessRole: "Sales Representative"
├── aggregates → BusinessRole: "Sales Manager"
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
2. **Decompose Processes** - Break complex processes into sub-processes linked in sequence with `flows-to`
3. **Model Events Explicitly** - Event-driven architectures need explicit BusinessEvent entities
4. **Link to Motivation Early** - Connect services and processes to goals for traceability
5. **Don't Over-Detail** - Focus on architecturally significant processes, not every task
6. **Use BPMN for Complex Workflows** - Reference BPMN files rather than modeling every detail
7. **Distinguish Role from Actor** - Role is responsibility; Actor is individual/team
8. **Model Contracts for SLAs** - Formalize service agreements as Contract entities
9. **Track Business Objects** - Identify key domain concepts even if data model comes later

---

## Validation Tips

| Issue                        | Cause                                        | Fix                                         |
| ---------------------------- | -------------------------------------------- | ------------------------------------------- |
| Orphaned Process             | No event triggers it, no service realizes it | Add triggering event or link to service     |
| Unrealized Service           | No process/function realizes the service     | Add process that implements the service     |
| Missing Business Objects     | Processes don't access any objects           | Identify key domain concepts and add them   |
| No Cross-Layer Relationships | Business not linked to application/data      | Add realizes from application/data elements |
| Unassigned Roles             | Roles not assigned to processes              | Assign roles to show responsibility         |
| Missing SLA Properties       | Services lack performance targets            | Add SLA properties for monitoring           |

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
dr relationship add <source> <target> --predicate aggregates
```

**Cross-Layer Relationship Commands:**

```bash
dr relationship add <business-service> <motivation-goal> --predicate realizes
dr relationship add <business-service> <motivation-value> --predicate delivers-value
dr relationship add <application-service> <business-service> --predicate realizes
dr relationship add <data-model-objectschema> <business-object> --predicate realizes
```
