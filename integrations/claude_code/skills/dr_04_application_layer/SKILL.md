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
| **DataObject**               | Data structured for automated processing               | Includes schema reference, PII marking, retention policies                       |

---

## Type Decision Tree

Use this decision tree **before assigning a type** to any code pattern. Follow the first matching branch.

```
IS this a deployed, executable unit (container, microservice, SPA app shell, module)?
  → ApplicationComponent (type: generic/internal/external)

IS this a React component, UI widget, or view?
  → ApplicationComponent (type: generic) — link to ux.component.* for UI detail

IS this a Zustand store, Redux slice, or other state container?
  → ApplicationFunction (performs automated state management behavior)
  NOT ApplicationComponent — stores are behavior, not deployable modules
  Cross-reference: assign the function to the parent ApplicationComponent that owns it

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

IS this a data structure, DTO, or typed payload
  (ModelData, Annotation, Changeset)?
  → DataObject

IS this a collection of components that together form a subsystem
  (all layout engines, all application services)?
  → ApplicationCollaboration
```

---

## Common Misclassifications

Explicit DO NOT rules with rationale:

| Misclassification                            | Correct Classification                                                                               | Why                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Zustand store as `ApplicationService`        | `ApplicationFunction` (performs automated state management behavior)                                 | Stores are behavior, not deployable modules — assign to parent ApplicationComponent                              |
| Zustand store as `ApplicationComponent`      | `ApplicationFunction` (performs automated state management behavior)                                 | ArchiMate `ApplicationFunction` = "automated behavior performed by a component" — maps exactly to Zustand stores |
| WebSocket client as `ApplicationService`     | `ApplicationInterface` (protocol: WebSocket)                                                         | A WebSocket connection is an interface/access point, not a service                                               |
| Layout algorithm as `ApplicationService`     | `ApplicationFunction`                                                                                | Stateless algorithm = function, not a service with a contract                                                    |
| Layout engine CLASS as `ApplicationFunction` | `ApplicationComponent` (type: internal)                                                              | A class implementing an interface IS a deployable, replaceable module — not a stateless function                 |
| Export function as `ApplicationService`      | `ApplicationFunction` if purely internal; `ApplicationService` only if it exposes an output contract | If purely internal algorithm: function. If it has an external contract (API, file): service                      |
| React UI component as `ApplicationService`   | `ApplicationComponent` (type: generic) with UX cross-reference                                       | UI components are components; link to UX layer for rendering details                                             |
| Fetch interceptor / auth header injector     | `ApplicationFunction`                                                                                | Stateless function that wraps fetch — NOT a service; cross-reference `security.securitypolicy.*`                 |

---

## Intra-Layer Relationships

### Structural Relationships

| Source Type              | Predicate   | Target Type            | Example                                                                                  |
| ------------------------ | ----------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| ApplicationCollaboration | aggregates  | ApplicationComponent   | "Payment Ecosystem" aggregates "PaymentService", "FraudDetection", "NotificationService" |
| ApplicationComponent     | composes    | ApplicationInterface   | Component exposes interface for external access                                          |
| ApplicationProcess       | composes    | ApplicationProcess     | Workflow composed of sub-processes (saga pattern)                                        |
| ApplicationComponent     | assigned-to | ApplicationFunction    | Component performs specific function                                                     |
| ApplicationCollaboration | assigned-to | ApplicationInteraction | Collaboration executes interaction pattern                                               |
| ApplicationComponent     | realizes    | ApplicationService     | "UserManagementAPI" realizes "User Management Service"                                   |
| ApplicationFunction      | realizes    | ApplicationService     | "Authentication Function" realizes "Auth Service"                                        |
| ApplicationProcess       | realizes    | ApplicationService     | "Order Processing Workflow" realizes "Order Service"                                     |
| ApplicationService       | realizes    | ApplicationInterface   | Service exposes interface                                                                |
| DataObject               | specializes | DataObject             | "CustomerOrder" specializes "Order"                                                      |

### Behavioral Relationships

| Source Type            | Predicate | Target Type          | Example                                         |
| ---------------------- | --------- | -------------------- | ----------------------------------------------- |
| ApplicationEvent       | triggers  | ApplicationComponent | "OrderCreated" triggers "InventoryService"      |
| ApplicationEvent       | triggers  | ApplicationFunction  | "UserLoggedIn" triggers "AuditLogging" function |
| ApplicationEvent       | triggers  | ApplicationProcess   | "PaymentFailed" triggers "RefundProcess"        |
| ApplicationProcess     | triggers  | ApplicationEvent     | Workflow completion triggers event              |
| ApplicationService     | flows-to  | ApplicationService   | Synchronous service-to-service call             |
| ApplicationProcess     | flows-to  | ApplicationProcess   | Sequential process orchestration                |
| ApplicationService     | accesses  | DataObject           | Service reads/writes data                       |
| ApplicationFunction    | accesses  | DataObject           | Function operates on data                       |
| ApplicationProcess     | accesses  | DataObject           | Workflow manipulates data                       |
| ApplicationInteraction | accesses  | DataObject           | Interaction pattern involves data exchange      |
| ApplicationInterface   | serves    | ApplicationComponent | Interface provides access to component          |

---

## Cross-Layer References

### Outgoing References (Application → Other Layers)

| Target Layer             | Reference Type                                          | Example                                    |
| ------------------------ | ------------------------------------------------------- | ------------------------------------------ |
| **Layer 1 (Motivation)** | ApplicationService supports **Goal**                    | Service achieves business goals            |
| **Layer 1 (Motivation)** | ApplicationService delivers **Value**                   | Service delivers business value            |
| **Layer 1 (Motivation)** | ApplicationService governed by **Principle**            | Service follows architectural principles   |
| **Layer 1 (Motivation)** | ApplicationFunction fulfills **Requirement**            | Function implements functional requirement |
| **Layer 2 (Business)**   | ApplicationService realizes **BusinessService**         | Tech realizes business capability          |
| **Layer 2 (Business)**   | ApplicationProcess supports **BusinessProcess**         | Automates business workflow                |
| **Layer 2 (Business)**   | DataObject represents **BusinessObject**                | Technical data represents business concept |
| **Layer 5 (Technology)** | ApplicationComponent deployed-on **Node**               | Service deployed to Kubernetes cluster     |
| **Layer 5 (Technology)** | ApplicationService uses **TechnologyService**           | Application uses database service          |
| **Layer 5 (Technology)** | DataObject stored-in **Artifact**                       | Data persisted in database                 |
| **Layer 6 (API)**        | ApplicationService defined-by **OpenAPI Specification** | Service has OpenAPI contract               |
| **Layer 7 (Data Model)** | DataObject defined-by **JSON Schema**                   | Data structure defined as schema           |
| **Layer 11 (APM)**       | ApplicationService tracked-by **BusinessMetric**        | Service performance monitored              |
| **Layer 11 (APM)**       | ApplicationService has-sla **SLA Target**               | Latency, availability targets              |
| **Layer 11 (APM)**       | ApplicationService traced-by **APM**                    | Distributed tracing enabled                |

### Incoming References (Lower Layers → Application)

Lower layers reference Application layer to show:

- **Technology supports Application** - Infrastructure hosts application components
- **APIs implement Application Services** - OpenAPI specs define service contracts
- **Data schemas define DataObjects** - JSON schemas provide data structure

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
- Composes sub-processes (reserve, pay, ship)

### Pattern 5: Data Transfer Object (DTO)

```typescript
// Data object definitions
export interface UserDTO {
  /**
   * User data object
   * Schema: schemas/user.schema.json
   * PII: true (contains email, name)
   * Retention: 7 years
   */
  userId: string;
  email: string;
  name: string;
  createdAt: Date;
}
```

**Maps to:**

- DataObject: "User"
- Properties: schema-ref=user.schema.json, pii=true, retention-period=7y

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

# Link service to interface
dr relationship add application.applicationservice.user-management-api \
  application.applicationinterface.user-api-rest --predicate realizes
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

# Event triggering
dr relationship add application.applicationevent.order-created \
  application.applicationcomponent.inventory-service --predicate triggers

dr relationship add application.applicationevent.order-created \
  application.applicationcomponent.email-worker --predicate triggers
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

# Process composition
dr relationship add application.applicationprocess.order-fulfillment-saga \
  application.applicationprocess.reserve-inventory --predicate composes

dr relationship add application.applicationprocess.order-fulfillment-saga \
  application.applicationprocess.process-payment --predicate composes

dr relationship add application.applicationprocess.order-fulfillment-saga \
  application.applicationprocess.ship-order --predicate composes

# Process flows
dr relationship add application.applicationprocess.reserve-inventory \
  application.applicationprocess.process-payment --predicate flows-to

dr relationship add application.applicationprocess.process-payment \
  application.applicationprocess.ship-order --predicate flows-to
```

### Step 8: Cross-Layer Integration

```bash
# Link to business layer
dr relationship add application.applicationservice.order-api \
  business.service.order-management --predicate realizes

# Link to motivation layer
dr relationship add application.applicationservice.user-management-api \
  motivation.goal.improve-user-experience --predicate supports

# Link to technology layer
dr relationship add application.applicationcomponent.user-service \
  technology.node.k8s-cluster-prod --predicate deployed-on

# Link to API layer
dr relationship add application.applicationservice.user-management-api \
  api.openapi-document.user-api --predicate defined-by

# Link to data model layer
dr relationship add application.dataobject.user \
  data-model.schema.user --predicate defined-by

# Link to APM layer
dr relationship add application.applicationservice.order-api \
  apm.metric.order-processing-latency --predicate tracked-by
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
│   └── deployed-on → Node: "K8s Cluster"
├── aggregates → ApplicationComponent: "OrderService"
│   ├── realizes → ApplicationService: "Order API"
│   └── deployed-on → Node: "K8s Cluster"
├── aggregates → ApplicationComponent: "PaymentService"
│   └── realizes → ApplicationService: "Payment API"
└── uses → ApplicationInterface: "API Gateway"
```

### Pattern 2: Event-Driven Architecture

```
ApplicationEvent: "OrderCreated"
├── triggers → ApplicationComponent: "InventoryService"
├── triggers → ApplicationComponent: "EmailWorker"
├── triggers → ApplicationComponent: "AnalyticsService"
└── published-by → ApplicationComponent: "OrderService"
    └── uses → ApplicationInterface: "EventBus" (protocol: AMQP)
```

### Pattern 3: Saga Orchestration

```
ApplicationProcess: "Order Fulfillment Saga"
├── composes → ApplicationProcess: "Reserve Inventory"
│   ├── flows-to → ApplicationProcess: "Process Payment"
│   └── compensation → ApplicationProcess: "Release Inventory"
├── composes → ApplicationProcess: "Process Payment"
│   ├── flows-to → ApplicationProcess: "Ship Order"
│   └── compensation → ApplicationProcess: "Refund Payment"
└── properties: orchestration-engine=temporal, pattern=saga
```

### Pattern 4: API Gateway Pattern

```
ApplicationInterface: "API Gateway"
├── protocol: REST
├── routes-to → ApplicationService: "User API"
├── routes-to → ApplicationService: "Order API"
├── routes-to → ApplicationService: "Payment API"
├── applies → ApplicationFunction: "Authentication"
├── applies → ApplicationFunction: "Rate Limiting"
└── applies → ApplicationFunction: "Request Logging"
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
→ Cross-reference: `x-uses: [technology.systemsoftware.react, technology.artifact.react-flow]`
→ Also add `ux.component.graph-viewer` in the UX layer for rendering detail

### Pattern: Zustand Store

```typescript
// src/core/stores/modelStore.ts
export const useModelStore = create<ModelStoreState>((set) => ({
  layers: {}, elements: {},
  loadModel: (data) => set({ ... })
}));
```

→ `ApplicationFunction` (performs automated state management behavior)
→ NOT `ApplicationComponent` — stores are behavior, not deployable modules
→ Cross-reference: assign to the parent `ApplicationComponent` that owns the store

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

## Coverage Completeness Checklist

Before declaring application layer extraction complete, verify ALL 9 entity types have been considered:

```
□ ApplicationComponent — deployable units, UI components, layout engine classes (NOT Zustand stores — those are ApplicationFunction)
□ ApplicationService — capabilities with a business contract (data loader, parser service)
□ ApplicationInterface — access points: WebSocket endpoint, REST interface, postMessage bridge
□ ApplicationFunction — stateless algorithms: parse, validate, transform, export, layout; Zustand/Redux stores (state management behavior); fetch interceptors
□ ApplicationProcess — multi-step pipelines: loading pipeline, export pipeline
□ ApplicationEvent — state change notifications: model.updated, annotation.added, user events
□ DataObject — key data structures: ModelData, Annotation, Changeset, GraphNode, LayoutPreset
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
dr relationship add <service> <interface> --predicate realizes
dr relationship add <component> <function> --predicate assigned-to
dr relationship add <event> <component> --predicate triggers
dr relationship add <service> <data-object> --predicate accesses
dr relationship add <process> <sub-process> --predicate composes
dr relationship add <process-a> <process-b> --predicate flows-to
```

**Cross-Layer Commands:**

```bash
dr relationship add application.<service> business.<service> --predicate realizes
dr relationship add application.<component> technology.<node> --predicate deployed-on
dr relationship add application.<service> api.<openapi-doc> --predicate defined-by
dr relationship add application.<data-object> data-model.<schema> --predicate defined-by
```
