# Layering Philosophy

## Introduction

The 11-layer structure balances **abstraction hierarchy** with **pragmatic workflow**, following the natural flow from business intent through design constraints to technical implementation.

## Layer Ordering

| Layer | Name              | Focus        | Abstraction Level    | Design Phase         |
| ----- | ----------------- | ------------ | -------------------- | -------------------- |
| 01    | Motivation        | WHY          | Highest (Strategy)   | Discovery            |
| 02    | Business          | WHAT         | High (Business)      | Analysis             |
| 03    | Security          | WHO CAN      | Cross-cutting        | Design (Early)       |
| 04    | Application       | HOW          | Medium (Logical)     | Design               |
| 05    | Technology        | WITH WHAT    | Medium (Platform)    | Design (Constraints) |
| 06    | API               | INTERFACE    | Low (Specification)  | Design (Detail)      |
| 07    | Data Model        | STRUCTURE    | Low (Specification)  | Design (Detail)      |
| 08    | Datastore         | STORAGE      | Lower (Physical)     | Design (Detail)      |
| 09    | UX                | PRESENTATION | Low (Implementation) | Design (Detail)      |
| 10    | Navigation        | FLOW         | Low (Implementation) | Design (Detail)      |
| 11    | APM/Observability | OBSERVE      | Lowest (Runtime)     | Operations           |

## Ordering Principles

### 1. Motivation First (Layer 01)

**Rationale:** Everything must start with **WHY**

```
Stakeholders → Drivers → Goals → Requirements → Constraints
    │             │        │          │             │
    └─────────────┴────────┴──────────┴─────────────┘
                          │
                          ▼
              All other layers support these
```

**Key Concept:** Requirements drive design, not the reverse.

**Example Flow:**

```yaml
# Layer 01: WHY
Goal:
  id: "goal-improve-customer-satisfaction"
  description: "Increase customer satisfaction score by 20%"

Requirement:
  id: "req-fast-checkout"
  description: "Checkout process must complete in < 30 seconds"
  constrains: "goal-improve-customer-satisfaction"

# ↓ Drives

# Layer 02: WHAT
BusinessProcess:
  id: "bp-checkout"
  name: "Customer Checkout Process"
  fulfills: ["req-fast-checkout"]

# ↓ Drives

# Layer 04: HOW
ApplicationService:
  id: "app-checkout-service"
  name: "Fast Checkout Service"
  realizes: "bp-checkout"
  motivation.fulfillsRequirements: ["req-fast-checkout"]
```

### 2. Business Second (Layer 02)

**Rationale:** Define **WHAT** the business does before **HOW**

```
Business Services → Business Processes → Business Actors
         │                  │                   │
         └──────────────────┴───────────────────┘
                            │
                            ▼
              Application layer realizes these
```

**Technology-Agnostic:** Business layer should not mention technology choices.

**Example:**

```yaml
# ✅ Good: Technology-agnostic business definition
BusinessService:
  id: "bs-order-management"
  name: "Order Management"
  description: "Manage customer orders from creation to fulfillment"
  # No mention of REST APIs, databases, React, etc.

# ❌ Bad: Technology in business layer
BusinessService:
  id: "bs-order-api"
  name: "Order REST API Service"
  description: "RESTful microservice for order management using PostgreSQL"
  # Technology details don't belong here
```

### 3. Security Third (Layer 03)

**Rationale:** Security is a **cross-cutting concern** that constrains all subsequent layers

**Why Early?**

- Security decisions affect architecture fundamentally
- Cannot bolt on security later
- Influences API design, data models, UX flows

```
Security Policies → Roles → Permissions
        │            │          │
        └────────────┴──────────┘
                     │
          ┌──────────┼──────────┬──────────┐
          ▼          ▼          ▼          ▼
        APIs    Data Models    UX      Navigation
```

**Example:**

```yaml
# Layer 03: Security constraints defined early
Role:
  id: "role-customer"
  name: "Customer"
  permissions: ["read:own-orders", "create:own-orders"]

SecurityPolicy:
  id: "policy-data-isolation"
  name: "Customer Data Isolation"
  rule: "Customers can only access their own data"

# ↓ Constrains

# Layer 06: API design enforces security
Operation:
  operationId: "getOrder"
  path: "/orders/{orderId}"
  security:
    - resourceOwnerOnly: [] # Enforces policy-data-isolation

# Layer 07: Data model includes security metadata
Schema:
  name: "Order"
  x-security:
    dataClassification: "confidential"
    accessControl: "owner-only"

# Layer 09: UX respects security constraints
View:
  id: "order-detail"
  security:
    requiredPermissions: ["read:own-orders"]
```

### 4. Application Fourth (Layer 04)

**Rationale:** Define **HOW** software realizes business capabilities

**ArchiMate Standard:** Natural ArchiMate layer progression (Business → Application → Technology)

```
Application Components → Services → Interfaces
            │                │            │
            └────────────────┴────────────┘
                            │
            Realized by Technology layer
            Detailed in API/Data/UX layers
```

### 5. Technology Fifth (Layer 05) - Key Design Decision

**Rationale:** Technology choices are **design constraints**, not just deployment details

**Why Layer 5 (Before API/Data/UX)?**

In practice, teams select technology stacks **early** in the design process:

```
Week 1-2: Architecture Design
├─ "We'll use Node.js and React"
├─ "PostgreSQL for the database"
├─ "Kubernetes for orchestration"
└─ "REST APIs, not GraphQL"
     │
     └─→ These choices CONSTRAIN subsequent layers:
           - API design (REST patterns, Node.js frameworks)
           - Data models (PostgreSQL capabilities, JSON types)
           - UX implementation (React patterns, SPA architecture)
           - Navigation (React Router, client-side routing)
```

**Technology as Constraint:**

```yaml
# Layer 05: Technology choices
SystemSoftware:
  id: "tech-nodejs"
  name: "Node.js Runtime"
  type: "runtime"
  version: "20.x"

SystemSoftware:
  id: "tech-react"
  name: "React Framework"
  type: "frontend-framework"
  version: "18.x"

SystemSoftware:
  id: "tech-postgresql"
  name: "PostgreSQL"
  type: "database"
  version: "15.x"

# ↓ Constrains

# Layer 06: API design reflects Node.js/Express patterns
openapi: 3.0.0
# Express middleware patterns, Node.js conventions

# Layer 07: Data models use PostgreSQL types
{
  "type": "object",
  "x-database": {
    "type": "postgresql",
    "nativeType": "jsonb"  # PostgreSQL-specific
  }
}

# Layer 09: UX uses React patterns
Component:
  type: "react-component"
  framework: "react"  # From Layer 05
```

**Alternative Considered:** Technology at Layer 8+ (after API/Data)

**Rejected Because:**

- ❌ Teams don't actually work this way
- ❌ API design depends on technology capabilities
- ❌ Data models depend on database features
- ❌ Creates artificial "technology-agnostic" phase that's immediately violated

**Accepted Tradeoff:**

- ⚠️ Technology layer is more "concrete" than pure abstraction hierarchy suggests
- ✅ Reflects real-world design workflow
- ✅ Makes technology constraints explicit early
- ✅ Prevents "surprise" incompatibilities later

### 6-8. API, Data Model, Datastore (Layers 06-08)

**Rationale:** Detailed specifications **within** technology constraints

```
Technology Stack (Layer 05)
          │
          ├─→ API Layer (06): Service contracts
          ├─→ Data Model (07): Logical data structures
          └─→ Datastore (08): Physical database schemas
```

**Progressive Detail:**

```yaml
# Layer 05: Technology constraint
SystemSoftware:
  id: "tech-postgresql"
  name: "PostgreSQL 15"

# ↓

# Layer 06: API operations (technology-aware)
Operation:
  operationId: "createProduct"
  requestBody:
    content:
      application/json: # REST/JSON chosen in Layer 05
        schema:
          $ref: "#/components/schemas/Product"

# ↓

# Layer 07: Logical data model
Schema:
  name: "Product"
  properties:
    id: { type: "string", format: "uuid" }
    metadata: { type: "object" } # Generic

# ↓

# Layer 08: Physical database schema
Table:
  name: "products"
  columns:
    - name: "id"
      type: "uuid" # PostgreSQL-specific type
    - name: "metadata"
      type: "jsonb" # PostgreSQL-specific type
```

### 9-10. UX and Navigation (Layers 09-10)

**Rationale:** User-facing implementation details

**Why UX before Navigation?**

- UX defines screens/states
- Navigation defines how to move between them
- Natural dependency: Navigation needs to know what UX states exist

```
# Layer 09: Define UX states
UXState:
  id: "product-list"
  view: "ProductListView"

UXState:
  id: "product-detail"
  view: "ProductDetailView"

# ↓

# Layer 10: Define navigation between states
Route:
  path: "/products"
  experience: "product-list"

Route:
  path: "/products/:id"
  experience: "product-detail"

NavigationTransition:
  from: "product-list"
  to: "product-detail"
  trigger: "click-product"
```

### 11. APM/Observability Last (Layer 11)

**Rationale:** Observability is a **runtime concern** that spans all layers

**Why Last?**

- Observes the behavior of all other layers
- Requires all layers to be defined first
- Cross-layer correlation (trace business process → API call → database query)

```
Layer 01-10: Architecture Definition
      │
      ▼
Layer 11: How do we observe this at runtime?

Goal → Business Process → Application Service → API Operation → Database Query
  │          │                    │                  │               │
  └──────────┴────────────────────┴──────────────────┴───────────────┘
                                  │
                                  ▼
                          OpenTelemetry Trace
                    (Correlates all layers)
```

**Example:**

```yaml
# Layer 11: APM configuration
TraceConfiguration:
  serviceName: "product-service"
  spans:
    - name: "business.checkout" # Traces Layer 02
      attributes:
        businessProcess: "bp-checkout"

    - name: "app.checkout-service" # Traces Layer 04
      attributes:
        applicationService: "app-checkout-service"

    - name: "api.POST./orders" # Traces Layer 06
      attributes:
        operationId: "createOrder"

    - name: "db.orders.insert" # Traces Layer 08
      attributes:
        table: "orders"

MetricConfiguration:
  metrics:
    - name: "goal.customer-satisfaction.score" # Measures Layer 01
      type: "gauge"
      labels:
        goal: "goal-improve-customer-satisfaction"
```

## Design Workflow Alignment

The layer ordering matches how teams actually work:

### Phase 1: Discovery & Analysis (Weeks 1-2)

```
Layer 01: Motivation    → Gather requirements, define goals
Layer 02: Business      → Model business processes
Layer 03: Security      → Define security requirements
```

### Phase 2: Architecture & Design (Weeks 3-4)

```
Layer 04: Application   → Design application architecture
Layer 05: Technology    → Select technology stack ← CONSTRAINT POINT
```

### Phase 3: Detailed Design (Weeks 5-8)

```
Layer 06: API           → Design service contracts (within tech constraints)
Layer 07: Data Model    → Design data structures (within tech constraints)
Layer 08: Datastore     → Design physical schemas (within tech constraints)
Layer 09: UX            → Design user interfaces (within tech constraints)
Layer 10: Navigation    → Design navigation flows (within tech constraints)
```

### Phase 4: Operations (Ongoing)

```
Layer 11: APM           → Configure observability and monitoring
```

## Abstraction vs. Pragmatism

### Pure Abstraction Hierarchy Would Be

```
01 Motivation (Why)
02 Business (What)
03 Application (How - Logical)
04 API (Interface)
05 Data Model (Structure)
06 UX (Presentation)
07 Navigation (Flow)
08 Technology (Platform)  ← Would be here in pure abstraction
09 Datastore (Physical)
10 Security (Cross-cutting)
11 APM (Runtime)
```

### Pragmatic Hierarchy Is

```
01 Motivation (Why)
02 Business (What)
03 Security (Constrain early)      ← Moved up
04 Application (How - Logical)
05 Technology (Constraint point)    ← Moved up significantly
06 API (Interface)
07 Data Model (Structure)
08 Datastore (Physical)
09 UX (Presentation)
10 Navigation (Flow)
11 APM (Runtime)
```

### Rationale for Pragmatism

**Security (Layer 03 vs. 10):**

- ✅ Early: Security constraints influence all design
- ❌ Late: Retrofitting security is expensive and error-prone

**Technology (Layer 05 vs. 08):**

- ✅ Early: Technology choices are design constraints
- ❌ Late: Pretends technology doesn't influence API/Data design (it does)

## Summary: Ordering Principles

1. **Motivation First** - Requirements drive everything
2. **Business Second** - What before how
3. **Security Third** - Cross-cutting constraints defined early
4. **Application Fourth** - Logical architecture
5. **Technology Fifth** - Technology as constraint, not implementation detail
6. **Specifications Sixth (API/Data/Datastore)** - Detailed specs within constraints
7. **User Experience (UX/Navigation)** - User-facing implementation
8. **Observability Last** - Runtime observation of all layers

**Result:** Balances theoretical purity with practical workflow and explicit constraint management.

---

**Next:** [03-cross-layer-integration.md](03-cross-layer-integration.md) - How layers reference each other
