---
name: LAYER_04_APP
description: Expert knowledge for Application Layer modeling in Documentation Robotics
triggers:
  [
    "application service",
    "application component",
    "data object",
    "application function",
    "application process",
    "microservice",
    "archimate application"
  ]
version: 0.8.3
---

# Application Layer Skill

**Layer Number:** 04
**Specification:** Metadata Model Spec v0.8.3
**Purpose:** Describes application services, components, and interfaces that support business processes and bridge requirements with technical implementation.

---

## Layer Overview

The Application Layer captures **application architecture**:

- **WHAT** - Application services exposed to business
- **HOW** - Application components and functions
- **INTEGRATION** - Application interfaces and interactions
- **DATA** - Data objects processed by applications
- **EVENTS** - Application events for event-driven architecture

This layer uses **ArchiMate 3.2 Application Layer** standard with optional properties for external specifications (OpenAPI, orchestration definitions, event schemas).

---

## Entity Types

> **CLI Introspection:** Run `dr schema types application` for the authoritative, always-current list of node types.
> Run `dr schema node <type-id>` for full attribute details on any type.

| Entity Type                  | Description                                            | Key Attributes                                                                   |
| ---------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **ApplicationComponent**     | Modular, deployable, replaceable part of a system      | Types: generic, external, internal, service-component                            |
| **ApplicationCollaboration** | Aggregate of application components working together   | Example: Microservices ecosystem, service mesh                                   |
| **ApplicationInterface**     | Point of access where application service is available | Protocols: REST, GraphQL, SOAP, gRPC, WebSocket, Message Queue, Event Bus        |
| **ApplicationFunction**      | Automated behavior performed by application component  | Examples: Authentication, Data Validation, Caching, Logging                      |
| **ApplicationInteraction**   | Unit of collective application behavior                | Patterns: request-response, publish-subscribe, async-messaging, streaming, batch |
| **ApplicationProcess**       | Sequence of application behaviors (orchestration/saga) | Can reference orchestration definitions (Temporal, Conductor, Camunda)           |
| **ApplicationEvent**         | Application state change notification                  | Types: domain-event, integration-event, system-event, audit-event                |
| **ApplicationService**       | Service that exposes application functionality         | Types: synchronous, asynchronous, batch, streaming, webhook                      |
| **DataObject**               | A domain object, or data with no declared shape        | A declared shape (interface, record, DTO) is a `data-model.objectschema` instead |
| **Message**                  | Named unit of data sent to a receiver that acts on it  | messageType (required): command, request, reply, document                        |

---

## Type Decision Tree

Use this decision tree **before assigning a type** to any code pattern. Follow the first matching branch.

```
IS this a deployed, executable unit (container, microservice, SPA app shell, module)?
  → ApplicationComponent (type: generic/internal/external)

IS this a React component, UI widget, or view?
  → ApplicationComponent (type: generic) — link to ux.component.* for UI detail

IS this a Zustand store, Redux slice, or other state container?
  → DataObject when its actions only set, derive from or reset its own state (a domain
  object: state plus the rules for changing it). The components and functions that read
  or change it `accesses` it, and the interface that types it (state and actions) is a
  data-model.objectschema that `realizes` it.
  → ApplicationComponent when its actions also call services or do I/O (fetching, saving).
    Persisting the state to browser storage (localStorage, IndexedDB, a persist middleware)
    is I/O: a persisted store is an ApplicationComponent.
  NOT ApplicationFunction or ApplicationService — a store is state that is held, not
  behavior that is performed or a contract that is offered

IS this a class/function that provides a capability to other parts of the system
  (business logic, data transformation, orchestration)?
  → ApplicationService (serviceType: synchronous/asynchronous/event-driven/batch)

IS this a URL, port, protocol interface, or access point
  (REST endpoint group, WebSocket endpoint, message queue, postMessage bridge)?
  → ApplicationInterface (protocol: REST/WebSocket/AMQP/HTTP)

IS this a stateless, single-purpose algorithm or behavior
  (parse, validate, transform, export, calculate, layout)?
  → ApplicationFunction (NOT ApplicationService)

IS this a multi-step workflow, pipeline, or saga
  (load → parse → validate → render)?
  → ApplicationProcess
  NOTE: Use ApplicationProcess for orchestration logic triggered by navigation
  (data loading pipelines, guards that orchestrate multiple async operations).
  Use navigation.route for route definitions that map URL patterns to views.
  If a route component is purely declarative (no significant orchestration logic),
  it belongs only in navigation.route — not ApplicationProcess.

IS this a state change notification or domain event
  (model.updated, annotation.added)?
  → ApplicationEvent (eventType: domain/integration/system)

IS this sent to a receiver that is expected to act on it
  (a command, a request or its reply, a queued job, a protocol frame such as subscribe)?
  → Message (messageType: command/request/reply/document)
  NOTE: An announcement that something happened, published to whoever subscribes,
  is an ApplicationEvent. Each kind of message is one Message element; the transport
  (WebSocket, queue, bus) does not decide the type.

IS this a declaration that only states a shape: an interface, type alias, record,
  struct, dataclass or DTO (ModelData, Annotation, Changeset)?
  → data-model.objectschema (NOT DataObject), whether or not the shape is persisted
  or published. Behaviour that takes or returns it `accesses` the schema. DTO, view
  model and read model name what a shape is used for; the declaration is the schema.

IS this an interface or type for one value, with state fields beside callbacks over
  that state (a store's state and actions, a context value)?
  → data-model.objectschema (NOT ApplicationService). An interface is a service only
  when it is a contract that classes implement and callers depend on.

IS this a domain object: state together with the rules that keep it valid, with methods
  that only validate, derive from or change its own fields (a value object, an in-memory
  aggregate), or data passed around with no declared shape (any, dict, parsed JSON)?
  → DataObject (an object schema `realizes` it when it implements a declared shape)

IS this a collection of components that together form a subsystem
  (all layout engines, all application services)?
  → ApplicationCollaboration
```

---

## Common Misclassifications

Explicit DO NOT rules with rationale:

| Misclassification                            | Correct Classification                                                                               | Why                                                                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zustand store as `ApplicationService`        | `DataObject` (state plus the rules for changing it)                                                  | A store is one value that components read and change, not a contract that classes implement; its state-and-actions interface is a `data-model.objectschema` that realizes it |
| Zustand store as `ApplicationFunction`       | `DataObject`, or `ApplicationComponent` when its actions call services or do I/O                     | A store is state that is held, with rules over that state; an `ApplicationFunction` is behavior a component performs                                                         |
| WebSocket client as `ApplicationService`     | `ApplicationInterface` (protocol: WebSocket)                                                         | A WebSocket connection is an interface/access point, not a service                                                                                                           |
| Layout algorithm as `ApplicationService`     | `ApplicationFunction`                                                                                | Stateless algorithm = function, not a service with a contract                                                                                                                |
| Layout engine CLASS as `ApplicationFunction` | `ApplicationComponent` (type: internal)                                                              | A class implementing an interface IS a deployable, replaceable module — not a stateless function                                                                             |
| Export function as `ApplicationService`      | `ApplicationFunction` if purely internal; `ApplicationService` only if it exposes an output contract | If purely internal algorithm: function. If it has an external contract (API, file): service                                                                                  |
| React UI component as `ApplicationService`   | `ApplicationComponent` (type: generic) with UX cross-reference                                       | UI components are components; link to UX layer for rendering details                                                                                                         |
| Fetch interceptor / auth header injector     | `ApplicationFunction`                                                                                | Stateless function that wraps fetch — NOT a service; cross-reference `security.securitypolicy.*`                                                                             |
| Interface, DTO or record as `DataObject`     | `data-model.objectschema`                                                                            | A declaration that only states a shape is a schema; a DataObject is a domain object, or untyped data                                                                         |
| Protocol message as `ApplicationEvent`       | `Message` (messageType: command, request, reply or document)                                         | A message is sent to a receiver expected to act on it; an event announces what happened to whoever subscribes                                                                |

---

## Intra-Layer Relationships

### Structural Relationships

| Source Type              | Predicate   | Target Type            | Example                                                                                  |
| ------------------------ | ----------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| ApplicationCollaboration | aggregates  | ApplicationComponent   | "Payment Ecosystem" aggregates "PaymentService", "FraudDetection", "NotificationService" |
| ApplicationCollaboration | assigned-to | ApplicationInteraction | "Checkout Collaboration" assigned-to "Checkout Handshake" interaction                    |
| ApplicationCollaboration | realizes    | ApplicationService     | "Payment Ecosystem" realizes "Payment Service"                                           |
| ApplicationComponent     | provides    | ApplicationInterface   | "UserService" provides "User REST API"                                                   |
| ApplicationComponent     | assigned-to | ApplicationFunction    | "UserService" assigned-to "Token Validation"                                             |
| ApplicationComponent     | assigned-to | ApplicationProcess     | "OrderOrchestrator" assigned-to "Order Fulfillment Saga"                                 |
| ApplicationComponent     | realizes    | ApplicationService     | "UserManagementAPI" realizes "User Management Service"                                   |
| ApplicationComponent     | uses        | ApplicationComponent   | "OrderService" uses "InventoryService"                                                   |
| ApplicationFunction      | realizes    | ApplicationService     | "Authentication Function" realizes "Auth Service"                                        |
| ApplicationProcess       | realizes    | ApplicationService     | "Order Processing Workflow" realizes "Order Service"                                     |
| ApplicationInterface     | assigned-to | ApplicationService     | "User REST API" assigned-to "User Management Service" (interface exposes the service)    |
| DataObject               | composes    | DataObject             | "Order" composes "OrderLineItem"                                                         |
| DataObject               | aggregates  | DataObject             | "Cart" aggregates "Product" references                                                   |
| ApplicationInteraction   | aggregates  | Message                | "Topic Subscription" aggregates "Subscribe" and "Unsubscribe"                            |

### Behavioral Relationships

| Source Type            | Predicate  | Target Type            | Example                                                           |
| ---------------------- | ---------- | ---------------------- | ----------------------------------------------------------------- |
| ApplicationEvent       | triggers   | ApplicationProcess     | "PaymentFailed" triggers "Refund Process"                         |
| ApplicationEvent       | triggers   | ApplicationInteraction | "CheckoutStarted" triggers "Checkout Handshake"                   |
| ApplicationProcess     | triggers   | ApplicationEvent       | "Place Order" triggers "OrderCreated"                             |
| ApplicationEvent       | triggers   | ApplicationFunction    | "UserLoggedIn" triggers "Audit Logging" (event handler)           |
| ApplicationFunction    | triggers   | ApplicationEvent       | "Publish Order" triggers "OrderCreated"                           |
| ApplicationInteraction | triggers   | ApplicationEvent       | "Checkout Handshake" triggers "CheckoutCompleted"                 |
| ApplicationProcess     | flows-to   | ApplicationProcess     | "Reserve Inventory" flows-to "Process Payment"                    |
| ApplicationFunction    | flows-to   | ApplicationFunction    | "Parse Document" flows-to "Embed Chunks"                          |
| ApplicationService     | flows-to   | ApplicationService     | "Checkout Service" flows-to "Payment Service" (synchronous call)  |
| ApplicationService     | depends-on | ApplicationService     | "Order Service" depends-on "Inventory Service"                    |
| ApplicationService     | serves     | ApplicationComponent   | "Auth Service" serves "WebApp"                                    |
| ApplicationService     | serves     | ApplicationProcess     | "Payment Service" serves "Order Fulfillment Saga"                 |
| ApplicationInterface   | depends-on | ApplicationFunction    | "API Gateway" depends-on "Rate Limiting"                          |
| ApplicationService     | serves     | ApplicationInteraction | "Payment Service" serves "Checkout Handshake"                     |
| ApplicationService     | accesses   | DataObject             | "User Management Service" accesses "User"                         |
| ApplicationComponent   | accesses   | DataObject             | "OrderService" accesses "Order"                                   |
| ApplicationFunction    | accesses   | DataObject             | "Data Validation" accesses "Order"                                |
| ApplicationProcess     | accesses   | DataObject             | "Order Fulfillment Saga" accesses "Order"                         |
| ApplicationEvent       | accesses   | DataObject             | "OrderCreated" accesses "Order" (event payload)                   |
| ApplicationInteraction | accesses   | DataObject             | "Checkout Handshake" accesses "PaymentIntent"                     |
| ApplicationFunction    | triggers   | Message                | "Subscribe To Topic" triggers "Subscribe" (the function sends it) |
| ApplicationProcess     | triggers   | Message                | "Order Fulfillment Saga" triggers "Ship Order"                    |
| Message                | triggers   | ApplicationFunction    | "Ship Order" triggers "Ship Order Handler" (its handler)          |
| Message                | triggers   | ApplicationProcess     | "Start Import" triggers "Import Pipeline"                         |

---

## Cross-Layer References

### Outgoing References (Application → Other Layers)

| Source Type            | Predicate      | Target Type                     | Example                                                                                                                              |
| ---------------------- | -------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ApplicationService     | realizes       | `business.businessservice`      | "Order API" realizes "Order Management"                                                                                              |
| ApplicationService     | serves         | `business.businessprocess`      | "Payment Service" serves "Checkout" business process                                                                                 |
| ApplicationService     | accesses       | `business.businessobject`       | "Order API" accesses "Customer Order"                                                                                                |
| ApplicationProcess     | realizes       | `business.businessprocess`      | "Order Fulfillment Saga" realizes "Fulfill Order"                                                                                    |
| ApplicationFunction    | realizes       | `business.businessfunction`     | "Credit Scoring" realizes "Risk Assessment"                                                                                          |
| ApplicationEvent       | triggers       | `business.businessprocess`      | "PaymentFailed" triggers "Dunning" process                                                                                           |
| ApplicationInterface   | serves         | `business.businessrole`         | "Admin Console" serves "Support Agent"                                                                                               |
| ApplicationService     | realizes       | `motivation.goal`               | "User Management API" realizes "Improve User Experience"                                                                             |
| ApplicationService     | delivers       | `motivation.value`              | "Instant Checkout" delivers "Convenience"                                                                                            |
| ApplicationFunction    | satisfies      | `motivation.requirement`        | "Token Validation" satisfies "Sessions Expire After 30 Min"                                                                          |
| ApplicationService     | realizes       | `product.softwarecapability`    | "Search Service" realizes "Product Discovery"                                                                                        |
| ApplicationService     | realizes       | `product.feature`               | "Graph Layout Service" realizes "Interactive Graph View"                                                                             |
| ApplicationService     | requires       | `security.authenticationconfig` | "Order API" requires "OAuth2 JWT Auth"                                                                                               |
| ApplicationService     | constrained-by | `security.securitypolicy`       | "Patient Records Service" constrained-by "HIPAA Access Policy"                                                                       |
| ApplicationComponent   | realizes       | `security.countermeasure`       | "Fetch Interceptor" realizes "Bearer Token Injection"                                                                                |
| ApplicationComponent   | accesses       | `security.secureresource`       | "OrderService" accesses "Order Records"                                                                                              |
| ApplicationComponent   | accesses       | `data-model.objectschema`       | "OrderRepository" accesses the "Order" entity class                                                                                  |
| ApplicationFunction    | accesses       | `data-model.objectschema`       | "saveOrder" accesses the "Order" entity class                                                                                        |
| ApplicationService     | accesses       | `data-model.objectschema`       | "Customer Service" accesses the "CustomerDto" it returns                                                                             |
| ApplicationProcess     | accesses       | `data-model.objectschema`       | "Import Pipeline" accesses the "ImportState" it passes along                                                                         |
| ApplicationInteraction | accesses       | `data-model.objectschema`       | "Checkout Handshake" accesses the "PaymentIntent" record                                                                             |
| ApplicationEvent       | accesses       | `data-model.objectschema`       | "OrderPlaced" accesses its "OrderSummary" payload type                                                                               |
| ApplicationComponent   | accesses       | `data-model.schemadefinition`   | "PayloadValidator" accesses the "Address" definition                                                                                 |
| ApplicationFunction    | accesses       | `data-model.schemadefinition`   | "buildInvoice" accesses the "Invoice" definition                                                                                     |
| ApplicationEvent       | accesses       | `data-model.schemadefinition`   | "OrderPlaced" accesses its "OrderPlacedPayload" definition                                                                           |
| ApplicationComponent   | accesses       | `data-store.collection`         | "OrderRepository" accesses the `orders` table                                                                                        |
| ApplicationComponent   | accesses       | `data-store.database`           | "Persistence Layer" accesses `orders-db` as a whole (its connection pool or ORM session; use `collection` when the tables are named) |
| ApplicationFunction    | accesses       | `data-store.collection`         | "findOrdersByCustomer" accesses `orders`                                                                                             |
| ApplicationFunction    | accesses       | `data-store.view`               | "monthlyRevenueReport" accesses `monthly_revenue_mv`                                                                                 |
| ApplicationService     | accesses       | `data-store.collection`         | "Order API" accesses `orders`                                                                                                        |
| ApplicationService     | accesses       | `data-store.view`               | "Reporting Service" accesses `monthly_revenue_mv`                                                                                    |
| ApplicationService     | accesses       | `data-store.database`           | "Order API" accesses `orders-db` (use `collection` when the collections are modelled)                                                |
| ApplicationService     | serves         | `ux.view`                       | "Order API" serves the "Order History" view that loads from it                                                                       |
| ApplicationService     | references     | `apm.traceconfiguration`        | "Order API" references "Order Service Tracing"                                                                                       |

### Incoming References (Other Layers → Application)

| Source Type                    | Predicate  | Target Type          | Example                                                   |
| ------------------------------ | ---------- | -------------------- | --------------------------------------------------------- |
| `technology.node`              | serves     | ApplicationComponent | "K8s Cluster Prod" serves "UserService" (deployment host) |
| `technology.systemsoftware`    | serves     | ApplicationComponent | "React 18" serves "WebApp"                                |
| `technology.technologyservice` | serves     | ApplicationService   | "Managed PostgreSQL" serves "Order API"                   |
| `api.openapidocument`          | realizes   | ApplicationService   | "user-api.yaml" realizes "User Management API"            |
| `api.operation`                | realizes   | ApplicationFunction  | "POST /auth/token" realizes "Token Issuance"              |
| `data-model.objectschema`      | realizes   | DataObject           | "CartShape" interface realizes the "Cart" class           |
| `data-model.objectschema`      | realizes   | Message              | "SubscribePayload" realizes "Subscribe"                   |
| `business.businessobject`      | references | DataObject           | "Customer Order" references "Order"                       |
| `ux.actioncomponent`           | triggers   | ApplicationService   | "Place Order" button triggers "Checkout Service"          |
| `navigation.route`             | lazy-loads | ApplicationComponent | "/settings" lazy-loads "SettingsPanel"                    |
| `apm.span`                     | monitors   | ApplicationService   | "checkout.process" span monitors "Checkout Service"       |
| `apm.metricinstrument`         | monitors   | ApplicationService   | "order_processing_latency" monitors "Order API"           |
| `testing.testcasesketch`       | tests      | ApplicationService   | "Checkout happy path" tests "Checkout Service"            |

---

## Codebase Detection Patterns

### Pattern 1: Microservice Component

```python
# FastAPI microservice
from fastapi import FastAPI

app = FastAPI(
    title="User Management Service",
    description="Handles user authentication and profile management",
    version="1.0.0"
)

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
```

**Maps to:**

- ApplicationComponent: "UserManagementService" (type: backend, subtype: microservice)
- ApplicationService: "User Management Service" (type: synchronous)
- ApplicationInterface: "REST API" (protocol: REST)

### Pattern 2: Application Function (Utility)

```typescript
// Authentication utility function
export class AuthenticationService {
  /**
   * Validates JWT token and returns user context
   * ApplicationFunction: Token Validation
   */
  async validateToken(token: string): Promise<UserContext> {
    // Implementation
  }
}
```

**Maps to:**

- ApplicationFunction: "Token Validation"
- ApplicationComponent: "AuthenticationService"

### Pattern 3: Event-Driven Architecture

```python
# Event definitions
from dataclasses import dataclass
from enum import Enum

class ApplicationEventType(Enum):
    ORDER_CREATED = "order.created"
    ORDER_FULFILLED = "order.fulfilled"
    PAYMENT_PROCESSED = "payment.processed"

@dataclass
class OrderCreatedEvent:
    """
    Domain event: Order created
    Schema: schemas/events/order-created.json
    Topic: orders.created
    """
    order_id: str
    customer_id: str
    timestamp: datetime
```

**Maps to:**

- ApplicationEvent: "OrderCreated" (type: domain-event, topic: orders.created)
- Properties: schema-ref, event-version
- Triggers other ApplicationComponents

### Pattern 4: Service Orchestration (Saga)

```python
# Temporal workflow (saga pattern)
from temporalio import workflow

@workflow.defn
class OrderFulfillmentWorkflow:
    """
    Order fulfillment orchestration
    ApplicationProcess: Order Fulfillment Saga
    Pattern: Saga with compensation
    """
    @workflow.run
    async def run(self, order_id: str) -> str:
        # Step 1: Reserve inventory
        await workflow.execute_activity(reserve_inventory, order_id)

        # Step 2: Process payment
        await workflow.execute_activity(process_payment, order_id)

        # Step 3: Ship order
        await workflow.execute_activity(ship_order, order_id)

        return "fulfilled"
```

**Maps to:**

- ApplicationProcess: "OrderFulfillmentSaga" (pattern: saga)
- Properties: orchestration-engine=temporal, compensation-enabled=true
- Sequences sub-processes (reserve, pay, ship) with `flows-to`

### Pattern 5: Typed Data (DTO, Interface, Record) and Data Objects

```typescript
// A declaration that only states a shape
export interface UserDTO {
  userId: string;
  email: string;
  name: string;
  createdAt: Date;
}

// A domain object: state plus the rules that keep it valid
export class Cart implements CartShape {
  private items: CartItem[] = [];
  addItem(item: CartItem) {
    /* ... */
  }
  total(): number {
    /* ... */
  }
}
```

**Maps to:**

- `data-model.objectschema`: "UserDTO" (not a DataObject: the interface only declares a shape,
  whether or not it is persisted or published). The services and functions that take or return
  it `accesses` the schema.
- DataObject: "Cart" (a domain object: its methods only change or derive from its own
  fields). `data-model.objectschema`
  "CartShape" `realizes` it.
- A value passed around as `any`, a dict or parsed JSON with no declared shape is a DataObject
  that no schema realizes. That missing link is how the model shows untyped data.

### Pattern 6: gRPC Service Interface

```protobuf
// gRPC service definition
service UserService {
  // ApplicationInterface: gRPC
  // Protocol: gRPC
  rpc GetUser (GetUserRequest) returns (User);
  rpc CreateUser (CreateUserRequest) returns (User);
  rpc UpdateUser (UpdateUserRequest) returns (User);
}
```

**Maps to:**

- ApplicationInterface: "UserServiceGRPC" (protocol: gRPC)
- ApplicationService: "User Service"
- ApplicationComponent: "UserService"

### Pattern 7: AI / RAG Processing Pipeline

```python
# Retrieval-Augmented Generation pipeline
class RAGPipeline:
    """
    Multi-stage AI document processing pipeline.
    ApplicationProcess: RAGPipeline (pattern: pipeline)
    """

    def run(self, query: str) -> str:
        chunks = self.chunker.chunk(documents)      # ApplicationFunction: DocumentChunker
        embeddings = self.embedder.embed(chunks)    # ApplicationFunction: EmbeddingGenerator
        results = self.retriever.retrieve(          # ApplicationFunction: VectorRetriever
            query_embedding, embeddings
        )
        return self.reranker.rerank(results, query) # ApplicationFunction: ResultReranker
```

**Maps to:**

- ApplicationProcess: "RAGPipeline" (pattern: pipeline) — the orchestrating process
- ApplicationFunction: "DocumentChunker" — assigned-to the RAG component; `flows-to` EmbeddingGenerator
- ApplicationFunction: "EmbeddingGenerator" — `flows-to` VectorRetriever
- ApplicationFunction: "VectorRetriever" — `flows-to` ResultReranker
- ApplicationFunction: "ResultReranker" — terminal stage; delivers output to the calling service
- ApplicationComponent: "RAGService" — owns all four functions via `assigned-to`

**Key relationships:**

```
ApplicationFunction: chunker → flows-to → ApplicationFunction: embedder
ApplicationFunction: embedder → flows-to → ApplicationFunction: retriever
ApplicationFunction: retriever → flows-to → ApplicationFunction: reranker
ApplicationComponent: rag-service → assigned-to → ApplicationFunction: chunker (×4)
ApplicationProcess: rag-pipeline → realizes → ApplicationService: rag-service
```

> **Rule:** Each discrete pipeline stage is an `ApplicationFunction`, not a separate service — stages share the same component boundary and have no independent business contract. Use `ApplicationProcess` to model the orchestration. If a stage is independently deployable (e.g., a separate embedding microservice), elevate it to `ApplicationComponent` + `ApplicationService`.

---

### Pattern 8: Message Queue Consumer

```python
# RabbitMQ consumer
from kombu import Connection, Queue

class OrderEventConsumer:
    """
    Consumes order events from message queue
    ApplicationComponent: OrderEventConsumer (type: worker)
    ApplicationInterface: Message Queue (protocol: AMQP)
    """
    def __init__(self):
        self.queue = Queue('orders.created', exchange='orders')

    def consume(self):
        with Connection('amqp://localhost') as conn:
            with conn.Consumer(self.queue, callbacks=[self.handle_order]):
                conn.drain_events()

    def handle_order(self, body, message):
        # Process order event
        message.ack()
```

**Maps to:**

- ApplicationComponent: "OrderEventConsumer" (type: worker)
- ApplicationInterface: "OrderQueue" (protocol: AMQP)
- ApplicationEvent: "OrderCreated" (triggers this component)

---

## Modeling Workflow

### Step 1: Identify Application Components

```bash
# Frontend component
dr add application component "web-app" \
  --description "Customer-facing web application"

# Backend microservices
dr add application component "user-service" \
  --description "User management microservice"

dr add application component "order-service" \
  --description "Order processing microservice"

# Worker component
dr add application component "email-worker" \
  --description "Background worker for email notifications"
```

### Step 2: Define Application Services

```bash
# Synchronous service
dr add application service "user-management-api" \
  --description "User management REST API"

# Asynchronous service
dr add application service "notification-service" \
  --description "Asynchronous notification delivery"

# Link component to service
dr relationship add application.applicationcomponent.user-service \
  application.applicationservice.user-management-api --predicate realizes
```

### Step 3: Model Application Interfaces

```bash
# REST API interface
dr add application interface "user-api-rest" \
  --description "REST interface for user service"

# gRPC interface
dr add application interface "order-grpc" \
  --description "gRPC interface for order service"

# Message queue interface
dr add application interface "event-bus" \
  --description "Event bus for async communication"

# Link interface to the service it exposes, and component to interface
dr relationship add application.applicationinterface.user-api-rest \
  application.applicationservice.user-management-api --predicate assigned-to

dr relationship add application.applicationcomponent.user-service \
  application.applicationinterface.user-api-rest --predicate provides
```

### Step 4: Define Application Functions

```bash
# Core functions
dr add application function "authentication" \
  --description "Validates user credentials and issues tokens"

dr add application function "data-validation" \
  --description "Validates input data against business rules"

dr add application function "caching" \
  --description "Caches frequently accessed data"

# Assign function to component
dr relationship add application.applicationcomponent.user-service \
  application.applicationfunction.authentication --predicate assigned-to
```

### Step 5: Model Application Events

```bash
# Domain events
dr add application event "order-created" \
  --description "Published when new order is created"

dr add application event "payment-processed" \
  --description "Published when payment completes"

# Event triggering (processes are defined in Step 7)
dr relationship add application.applicationevent.order-created \
  application.applicationprocess.order-fulfillment-saga --predicate triggers

dr relationship add application.applicationprocess.process-payment \
  application.applicationevent.payment-processed --predicate triggers
```

### Step 6: Define Data Objects

```bash
# Core data objects
dr add application data-object "user" \
  --description "User account information"

dr add application data-object "order" \
  --description "Customer order data"

# Service access to data
dr relationship add application.applicationservice.user-management-api \
  application.dataobject.user --predicate accesses

dr relationship add application.applicationservice.order-api \
  application.dataobject.order --predicate accesses
```

### Step 7: Model Application Processes (Orchestration)

```bash
# Saga workflow
dr add application process "order-fulfillment-saga" \
  --description "End-to-end order fulfillment orchestration"

# Sub-processes
dr add application process "reserve-inventory" \
  --description "Reserve items from inventory"

dr add application process "process-payment" \
  --description "Charge customer payment method"

dr add application process "ship-order" \
  --description "Initiate shipping workflow"

# Process flows (the catalog has no process-composes-process; model saga steps as a flows-to chain)
dr relationship add application.applicationprocess.order-fulfillment-saga \
  application.applicationprocess.reserve-inventory --predicate flows-to

dr relationship add application.applicationprocess.reserve-inventory \
  application.applicationprocess.process-payment --predicate flows-to

dr relationship add application.applicationprocess.process-payment \
  application.applicationprocess.ship-order --predicate flows-to
```

### Step 8: Cross-Layer Integration

```bash
# Link to business layer
dr relationship add application.applicationservice.order-api \
  business.businessservice.order-management --predicate realizes

# Link to motivation layer
dr relationship add application.applicationservice.user-management-api \
  motivation.goal.improve-user-experience --predicate realizes

# Link from technology layer (the node hosting the component serves it)
dr relationship add technology.node.k8s-cluster-prod \
  application.applicationcomponent.user-service --predicate serves

# Link from API layer (the OpenAPI document realizes the service contract)
dr relationship add api.openapidocument.user-api \
  application.applicationservice.user-management-api --predicate realizes

# Link from data model layer (the schema realizes the data object)
dr relationship add data-model.objectschema.user \
  application.dataobject.user --predicate realizes

# Link from APM layer
dr relationship add apm.metricinstrument.order-processing-latency \
  application.applicationservice.order-api --predicate monitors
```

### Step 9: Validate

```bash
dr validate --layers application
dr validate --relationships
```

---

## Application Architecture Patterns

### Pattern 1: Microservices Architecture

```
ApplicationCollaboration: "E-commerce Platform"
├── aggregates → ApplicationComponent: "UserService"
│   ├── realizes → ApplicationService: "User API"
│   └── ← serves — technology.node: "K8s Cluster"
├── aggregates → ApplicationComponent: "OrderService"
│   ├── realizes → ApplicationService: "Order API"
│   └── ← serves — technology.node: "K8s Cluster"
├── aggregates → ApplicationComponent: "PaymentService"
│   └── realizes → ApplicationService: "Payment API"
└── provides → ApplicationInterface: "API Gateway"
```

### Pattern 2: Event-Driven Architecture

```
ApplicationEvent: "OrderCreated"
├── triggers → ApplicationProcess: "Reserve Inventory" (assigned to "InventoryService")
├── triggers → ApplicationProcess: "Send Confirmation Email" (assigned to "EmailWorker")
├── ← depends-on — ApplicationFunction: "Analytics Ingest" (handler in "AnalyticsService")
└── ← triggers — ApplicationProcess: "Place Order" (assigned to "OrderService")
    └── "OrderService" provides → ApplicationInterface: "EventBus" (protocol: AMQP)
```

### Pattern 3: Saga Orchestration

```
ApplicationProcess: "Order Fulfillment Saga"
├── flows-to → ApplicationProcess: "Reserve Inventory"
│   ├── flows-to → ApplicationProcess: "Process Payment"
│   └── flows-to (on failure) → ApplicationProcess: "Release Inventory"
├── ApplicationProcess: "Process Payment"
│   ├── flows-to → ApplicationProcess: "Ship Order"
│   └── flows-to (on failure) → ApplicationProcess: "Refund Payment"
└── properties: orchestration-engine=temporal, pattern=saga
```

### Pattern 4: API Gateway Pattern

```
ApplicationInterface: "API Gateway"
├── protocol: REST
├── assigned-to → ApplicationService: "User API"
├── assigned-to → ApplicationService: "Order API"
├── assigned-to → ApplicationService: "Payment API"
├── depends-on → ApplicationFunction: "Authentication"
├── depends-on → ApplicationFunction: "Rate Limiting"
└── depends-on → ApplicationFunction: "Request Logging"
```

---

## Best Practices

1. **Components are Deployable Units** - One component = one deployment artifact
2. **Services are Contracts** - ApplicationService represents capability, not implementation
3. **Separate Read from Write** - Consider CQRS pattern for complex domains
4. **Model Events Explicitly** - Event-driven systems need first-class event entities
5. **Link to Business Layer** - Every application service should realize a business service
6. **Reference External Specs** - Link to OpenAPI, GraphQL schemas, Protobuf definitions
7. **Mark PII Explicitly** - DataObjects with PII need retention and security policies
8. **Use Orchestration for Sagas** - Model complex workflows as ApplicationProcess
9. **Distinguish Interface from Service** - Interface is access point; Service is capability
10. **Track Dependencies** - Model service-to-service dependencies clearly

---

## React / SPA Codebase Detection Patterns

These patterns cover the actual structure of React/TypeScript single-page applications. Apply the Type Decision Tree to each pattern.

### Pattern: React Component

```tsx
// src/core/components/GraphViewer.tsx
export function GraphViewer({ nodes, edges }: GraphViewerProps) {
  return <ReactFlow nodes={nodes} edges={edges} />;
}
```

→ `ApplicationComponent` (type: generic)
→ Cross-reference: `technology.systemsoftware.react` serves this component (a `technology.systemsoftware` → `serves` → `ApplicationComponent` relationship)
→ Also add `ux.component.graph-viewer` in the UX layer for rendering detail

### Pattern: Zustand Store

```typescript
// src/core/stores/modelStore.ts
export const useModelStore = create<ModelStoreState>((set) => ({
  layers: {}, elements: {},
  loadModel: (data) => set({ ... })
}));
```

→ `DataObject` "model-store" (a domain object: its actions only change or derive from its own state)
→ `data-model.objectschema` "ModelStoreState" `realizes` it; the components that call `useModelStore` `accesses` it
→ `ApplicationComponent` instead when the store's actions call services or do I/O, which includes
saving its state to browser storage (a `persist` middleware writing to localStorage)
→ NOT `ApplicationFunction` — a store is state that is held, not behavior that is performed

### Pattern: Stateless Service / Utility (parser, transformer)

```typescript
// src/core/services/yamlParser.ts
export function parseYAMLModel(yaml: string): ModelData { ... }
```

→ `ApplicationService` (serviceType: synchronous) if it orchestrates other services
→ OR `ApplicationFunction` if it is a purely stateless computation with no external contract

### Pattern: WebSocket Client

```typescript
// src/apps/embedded/services/websocketClient.ts
const ws = new WebSocket("ws://localhost:3000/ws");
ws.on("model.updated", handler);
```

→ `ApplicationInterface` (protocol: WebSocket) — the ws connection is the interface
→ `ApplicationEvent` for each event type: `model.updated`, `annotation.added`, `changeset.created`

### Pattern: Layout Engine Class (implements interface)

```typescript
// src/core/layout/engines/DagreLayoutEngine.ts
export class DagreLayoutEngine implements LayoutEngine {
  async layout(nodes: Node[], edges: Edge[]): Promise<PositionedGraph> { ... }
}
```

→ `ApplicationComponent` (type: internal) — it IS a deployable, replaceable module
→ NOT `ApplicationFunction` — it has class structure, implements an interface, has state

### Pattern: Layout Utility (pure function)

```typescript
// src/core/layout/verticalLayerLayout.ts
export function computeVerticalLayout(layers: Layer[]): LayoutResult { ... }
```

→ `ApplicationFunction` — stateless algorithm, no interface
→ Capture even if standalone (not in an engines/ directory)

### Pattern: Multi-step Loading Pipeline

```typescript
// src/core/services/dataLoader.ts
async function loadModel(source: DataSource): Promise<void> {
  const raw = await fetch(source.url);
  const parsed = parseYAMLModel(raw);
  const validated = validateSchema(parsed);
  const transformed = transformToReactFlow(validated);
  modelStore.setModel(transformed);
}
```

→ `ApplicationProcess` (orchestration pipeline: fetch → parse → validate → transform → store)

### Pattern: Fetch Interceptor

```typescript
// src/apps/embedded/utils/fetchInterceptor.ts
export function interceptFetch(token: string) {
  window.fetch = async (url, options = {}) => {
    return originalFetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` }
    });
  };
}
```

→ `ApplicationFunction`
→ source-provenance: extracted
→ Relationship: `security.securitypolicy.bearer-token-policy` (governed-by)

### Pattern: Data Transfer Object / Interface

```typescript
// src/core/types/model.ts
export interface ModelData {
  layers: Layer[];
  elements: Element[];
}
export interface Annotation {
  id: string;
  elementId: string;
  content: string;
}
```

→ `DataObject` for each significant data structure (`ModelData`, `Annotation`, `Changeset`, etc.)

---

## What Extraction by Rule Cannot See

`codebase_extract` hands you a card for each declaration the code graph reports. A file is never a
card: it is only where an element was found, recorded as the element's source reference. Four kinds
of content have no declaration in the graph, so no card arrives for them. In a bootstrap, read the
code for them and stage what you find, naming the file and, where there is one, the symbol.

- **Entry points.** A file of top-level statements that wires a service or an app together
  (`Program.cs`, `main.tsx`, `index.tsx`, a Python `__main__` block). Model the service or app it
  starts: an ApplicationComponent, or a `ux.uxapplication` for a UI app.
- **File-based routes.** A framework that routes by file path (a Next.js `app/**/page.tsx`, files
  under `routes/` or `pages/`). The path is the declaration: the route is a `navigation.route` and
  the page a `ux.view`. See the navigation and UX layer skills.
- **Top-level constants** that hold something modelled: a store, a validation schema, a route
  table, a declarative API contract. Model the thing by what it is (a store by the decision tree
  above, a schema as a `data-model.objectschema`), with the constant as its symbol.
- **Buildable projects.** A directory with a build manifest (`.csproj`, `package.json`, `go.mod`,
  `pyproject.toml`, `pom.xml`) is a module in the architectural sense, which a file is not. Model
  it as an ApplicationComponent, sourced at the manifest, when other code depends on it or it is
  built or deployed as a unit.

Never model a file as an element because it is a file. A module may be one file, part of a file or
many files.

## Coverage Completeness Checklist

Before declaring application layer extraction complete, verify ALL 9 entity types have been considered:

```
□ ApplicationComponent — deployable units, UI components, layout engine classes, stores whose actions call services or do I/O
□ ApplicationService — capabilities with a business contract (data loader, parser service)
□ ApplicationInterface — access points: WebSocket endpoint, REST interface, postMessage bridge
□ ApplicationFunction — stateless algorithms: parse, validate, transform, export, layout; fetch interceptors
□ ApplicationProcess — multi-step pipelines: loading pipeline, export pipeline
□ ApplicationEvent — state change notifications: model.updated, annotation.added, user events
□ DataObject — domain objects (value objects, in-memory aggregates, Zustand/Redux stores that only manage their own state) and data with no declared shape; an interface, record or DTO is a `data-model.objectschema` instead
□ ApplicationCollaboration — component groupings: layout engine suite (groups of deployable ApplicationComponents)
□ ApplicationInteraction — collective behaviors across multiple components (if applicable)

If any type has ZERO elements, explicitly decide:
  "This type doesn't apply to this codebase" with reasoning.
```

---

## Framework-Specific Patterns

### FastAPI / Flask (Python)

```python
# FastAPI application
from fastapi import FastAPI

app = FastAPI(title="User Service")  # ApplicationComponent + ApplicationService

@app.get("/users/{user_id}")  # ApplicationInterface (REST)
async def get_user(user_id: str) -> UserDTO:  # DataObject
    pass  # ApplicationFunction: "GetUser"
```

### NestJS / Express (TypeScript/Node.js)

```typescript
@Controller("orders") // ApplicationComponent
export class OrdersController {
  @Get(":id") // ApplicationInterface (REST)
  async getOrder(@Param("id") id: string): Promise<OrderDTO> {
    // DataObject
    // ApplicationFunction: "GetOrder"
  }
}
```

### Spring Boot (Java)

```java
@RestController  // ApplicationComponent
@RequestMapping("/api/products")
public class ProductController {

  @GetMapping("/{id}")  // ApplicationInterface (REST)
  public ProductDTO getProduct(@PathVariable String id) {  // DataObject
    // ApplicationFunction: "GetProduct"
  }
}
```

---

## Validation Tips

| Issue                        | Cause                                         | Fix                                                         |
| ---------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| Orphaned Component           | Component not assigned to function or service | Assign to ApplicationFunction or realize ApplicationService |
| Unrealized Service           | Service not realized by component/function    | Add realization link                                        |
| Missing Interface            | Service has no interface                      | Add ApplicationInterface                                    |
| No Cross-Layer Relationships | Application not linked to business/technology | Add realization and deployment relationships                |
| Undocumented Events          | Events exist in code but not modeled          | Add ApplicationEvent entities                               |
| Missing Data Objects         | Services access data not modeled              | Add DataObject entities                                     |
| No Orchestration             | Complex workflows not modeled as processes    | Add ApplicationProcess for sagas                            |

---

## Quick Reference

**Add Commands:**

```bash
dr add application component <name>
dr add application service <name>
dr add application interface <name>
dr add application function <name>
dr add application event <name>
dr add application data-object <name>
dr add application process <name>
```

**Relationship Commands:**

```bash
dr relationship add <component> <service> --predicate realizes
dr relationship add <interface> <service> --predicate assigned-to
dr relationship add <component> <interface> --predicate provides
dr relationship add <component> <function> --predicate assigned-to
dr relationship add <event> <process> --predicate triggers
dr relationship add <service> <data-object> --predicate accesses
dr relationship add <process-a> <process-b> --predicate flows-to
```

**Cross-Layer Commands:**

```bash
dr relationship add application.<service> business.<service> --predicate realizes
dr relationship add technology.<node> application.<component> --predicate serves
dr relationship add api.<openapi-doc> application.<service> --predicate realizes
dr relationship add data-model.<object-schema> application.<data-object> --predicate realizes
```
