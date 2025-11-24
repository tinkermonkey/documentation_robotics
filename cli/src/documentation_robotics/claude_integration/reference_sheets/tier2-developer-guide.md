# Documentation Robotics - Developer Guide

_For active modeling work. See tier1-essentials.md for quick reference._

## Element Structure

```yaml
ElementID:
  id: {layer}.{type}.{kebab-name}
  name: "Human Readable Name"
  description: "Brief description"
  documentation: "Extended documentation (optional)"
  properties:
    # Layer-specific fields
    # Cross-layer references
```

## Layer Details & Top Entity Types

### 01. Motivation Layer (WHY)

**Purpose:** Strategic drivers, goals, and requirements

**Top Types:**

- `Goal` - Business objectives with KPIs
- `Requirement` - Functional/non-functional requirements
- `Stakeholder` - Internal/external stakeholders
- `Constraint` - Limitations and boundaries
- `Driver` - Market/regulatory/technology drivers

**Key Properties:**

- `priority`: critical | high | medium | low
- `category`: market | regulatory | technology | operational
- `measuredBy`: Reference to metrics

### 02. Business Layer (WHAT)

**Purpose:** Business capabilities and processes

**Top Types:**

- `BusinessService` - Business capabilities
- `BusinessProcess` - Workflows and procedures
- `BusinessActor` - Roles and departments
- `BusinessFunction` - Business activities
- `Product` - Offerings to customers

**Key Properties:**

- `supports-goals`: [motivation.goal.id, ...]
- `owner`: business.actor.id
- `criticality`: critical | high | medium | low

### 03. Security Layer (WHO CAN)

**Purpose:** Authentication, authorization, security controls

**Top Types:**

- `AuthenticationScheme` - How users authenticate (OAuth2, SAML, etc.)
- `AuthorizationPolicy` - Access control rules
- `SecurityControl` - Security measures
- `Threat` - Security threats
- `SecurityRequirement` - Security requirements

**Key Properties:**

- `applies_to`: [element.id, ...]
- `type`: authentication | authorization | encryption | monitoring

### 04. Application Layer (HOW)

**Purpose:** Software architecture and components

**Top Types:**

- `ApplicationService` - Software services
- `ApplicationComponent` - Software modules
- `ApplicationInterface` - Service interfaces
- `ApplicationFunction` - Software functions
- `DataObject` - Application data

**Key Properties:**

- `realizes`: business.service.id
- `securedBy`: [security.policy.id, ...]
- `deployedTo`: technology.node.id
- `exposes`: [api.operation.id, ...]

### 05. Technology Layer (WITH WHAT)

**Purpose:** Infrastructure and deployment

**Top Types:**

- `Node` - Servers, VMs, containers
- `Device` - Physical hardware
- `SystemSoftware` - OS, databases, middleware
- `TechnologyService` - Infrastructure services
- `Artifact` - Deployable units

**Key Properties:**

- `hosts`: [application.component.id, ...]
- `environment`: production | staging | development

### 06. API Layer (INTERFACE)

**Purpose:** Service contracts (OpenAPI)

**Top Types:**

- `Operation` - API endpoints (paths + methods)
- `Schema` - Request/response schemas
- `Parameter` - Query/path parameters

**Key Properties:**

- `path`: "/api/v1/resource"
- `method`: GET | POST | PUT | DELETE
- `securedBy`: [security.scheme.id, ...]
- `operationId`: Unique operation identifier

### 07. Data Model Layer (STRUCTURE)

**Purpose:** Logical data structures

**Top Types:**

- `Schema` - Entity definitions (JSON Schema)
- `Property` - Entity fields
- `Relationship` - Entity associations

**Key Properties:**

- `type`: object | array | string | number | boolean
- `required`: [field1, field2, ...]

### 08. Datastore Layer (STORAGE)

**Purpose:** Physical database design

**Top Types:**

- `Database` - Database instances
- `Schema` - Database schemas
- `Table` - Database tables
- `Column` - Table columns
- `Index` - Database indexes

**Key Properties:**

- `stores`: data_model.schema.id
- `type`: postgresql | mysql | mongodb | redis

### 09. UX Layer (PRESENTATION)

**Purpose:** User interfaces

**Top Types:**

- `Screen` - Application screens/pages
- `Component` - UI components
- `Layout` - Screen layouts
- `State` - UI state management

**Key Properties:**

- `calls`: [api.operation.id, ...]
- `displays`: [data_model.schema.id, ...]

### 10. Navigation Layer (FLOW)

**Purpose:** Application navigation

**Top Types:**

- `Route` - URL routes
- `NavigationMenu` - Menu structures
- `Guard` - Route guards
- `Breadcrumb` - Navigation breadcrumbs

**Key Properties:**

- `path`: "/app/feature"
- `rendersScreen`: ux.screen.id
- `requiresAuth`: boolean

### 11. APM/Observability Layer (OBSERVE)

**Purpose:** Monitoring and observability

**Top Types:**

- `Metric` - Performance metrics
- `Log` - Log configurations
- `Trace` - Distributed tracing
- `Alert` - Alert definitions

**Key Properties:**

- `instruments`: [application.service.id, ...]
- `type`: availability | latency | throughput | error_rate

## Python API

### Model Class

```python
from documentation_robotics.core import Model

# Load model
model = Model.load("./", enable_cache=True, lazy_load=False)

# Query elements
element = model.get_element("business.service.orders")
elements = model.find_elements(
    layer="business",
    element_type="service",
    name_pattern="Order*"
)

# Add element
element_dict = {
    "id": "business.service.new-service",
    "name": "New Service",
    "description": "...",
    "properties": {"criticality": "high"}
}
model.add_element("business", element_dict)

# Update element
model.update_element(
    "business.service.orders",
    {"properties": {"criticality": "critical"}}
)

# Validate
result = model.validate(strict=True)
if not result.is_valid():
    for error in result.errors:
        print(f"Error: {error.message}")

# Save changes (automatic with context manager)
model.save()
```

### Layer Class

```python
from documentation_robotics.core import Layer

# Load specific layer
layer = Layer.load(name="business", path="./model/02_business")

# Find elements in layer
services = layer.find_elements(element_type="service")
critical_services = layer.find_elements(
    element_type="service",
    properties={"criticality": "critical"}
)

# Get element from layer
service = layer.get_element("business.service.orders")
```

### Element Class

```python
from documentation_robotics.core import Element

# Access element properties
element_id = element.id
element_type = element.element_type
layer = element.layer
name = element.data["name"]
props = element.data.get("properties", {})

# Check properties
criticality = element.get("properties", {}).get("criticality")
goals = element.get("properties", {}).get("supports-goals", [])
```

### Projection Engine

```python
from documentation_robotics.core.projection_engine import ProjectionEngine

# Load engine with rules
engine = ProjectionEngine(model, "./projection-rules.yaml")

# Project single element
source = model.get_element("business.service.orders")
projected = engine.project_element(source, "application")

# Project all matching elements
results = engine.project_all(
    from_layer="business",
    to_layer="application"
)

# Preview projections (dry-run)
preview = engine.preview_projection(source, "application")
```

## Validation Levels

### Basic (Default)

```bash
dr validate
```

- Schema validation (JSON Schema compliance)
- Naming conventions (kebab-case, format)
- Reference existence (cross-layer refs valid)

### Standard (Recommended)

```bash
dr validate --standard
```

- All Basic checks, plus:
- Semantic validation (11 rules)
- Cross-layer consistency
- Common patterns

### Strict (Comprehensive)

```bash
dr validate --strict
```

- All Standard checks, plus:
- Upward traceability (implementation → goals)
- Security integration (critical services secured)
- Bidirectional consistency
- Goal-to-metric traceability

## Common Validation Errors

**Broken Reference:**

```
Error: business.service.orders references non-existent motivation.goal.missing
Fix: Remove reference or create the goal
```

**Missing Traceability:**

```
Warning: application.service.order-api has no 'realizes' reference
Fix: Add realizes: business.service.orders
```

**Naming Convention:**

```
Error: Invalid ID format: business.service.Order_Management
Fix: Use kebab-case: business.service.order-management
```

**Security Policy Missing:**

```
Warning: Critical service has no security policy
Fix: Add securedBy: [security.policy.authenticated-access]
```

## Cross-Layer Traceability Flows

### Goal → Implementation

```yaml
# Motivation (Goal)
motivation.goal.improve-conversion:
  name: "Improve Conversion Rate"
  properties:
    target: "15% increase"
    measuredBy: [apm.metric.conversion-rate]

# Business (Service)
business.service.checkout:
  name: "Checkout Service"
  properties:
    supports-goals: [motivation.goal.improve-conversion]

# Application (Service)
application.service.checkout-api:
  name: "Checkout API"
  properties:
    realizes: business.service.checkout
    securedBy: [security.policy.pci-dss]
    instrumentedBy: [apm.metric.checkout-latency]

# API (Operations)
api.operation.create-order:
  name: "Create Order"
  properties:
    applicationServiceRef: application.service.checkout-api

# Data Model (Schema)
data_model.schema.order:
  name: "Order"
  properties:
    usedBy: [api.operation.create-order]

# Datastore (Table)
datastore.table.orders:
  name: "orders"
  properties:
    stores: data_model.schema.order
```

### Security (Cross-Cutting)

```yaml
# Security Policy
security.policy.authenticated-access:
  type: authorization
  applies_to:
    - application.service.checkout-api
    - api.operation.create-order
```

### Observability (Cross-Cutting)

```yaml
# Metric
apm.metric.checkout-latency:
  type: latency
  instruments: [application.service.checkout-api]
  threshold: "200ms"
```

## Common Operations

### Add New Feature (Manual)

```bash
# 1. Create business service
dr add business service \
  --name "Payment Processing" \
  --property criticality=critical \
  --property supports-goals=motivation.goal.revenue

# 2. Project to application
dr project business.service.payment-processing --to application

# 3. Add security
dr add security policy \
  --name "PCI DSS Compliance" \
  --property applies_to=application.service.payment-processing

# 4. Add monitoring
dr add apm metric \
  --name "payment-availability" \
  --property instruments=application.service.payment-processing

# 5. Validate
dr validate --strict
```

### Add New Feature (Python Script)

```python
from documentation_robotics.core import Model
from documentation_robotics.core.projection_engine import ProjectionEngine

model = Model.load("./")

# Create business service
bus_svc = {
    "id": "business.service.payment",
    "name": "Payment Processing",
    "properties": {
        "criticality": "critical",
        "supports-goals": ["motivation.goal.revenue"]
    }
}
model.add_element("business", bus_svc)

# Project to application
engine = ProjectionEngine(model, "./projection-rules.yaml")
app_svc = engine.project_element(
    model.get_element("business.service.payment"),
    "application"
)

# Add security
sec_policy = {
    "id": "security.policy.pci-dss",
    "name": "PCI DSS Compliance",
    "properties": {"applies_to": [app_svc.id]}
}
model.add_element("security", sec_policy)

# Validate
result = model.validate(strict=True)
if result.is_valid():
    model.save()
    print("✓ Feature added successfully")
else:
    print("✗ Validation failed")
    for error in result.errors:
        print(f"  - {error.message}")
```

## File Locations

```
project-root/
├── model/                      # Architecture model
│   ├── manifest.yaml          # Model metadata
│   ├── 01_motivation/         # Goals, requirements
│   ├── 02_business/           # Services, processes
│   ├── 03_security/           # Policies, controls
│   ├── 04_application/        # Components, services
│   ├── 05_technology/         # Infrastructure
│   ├── 06_api/                # API specs
│   ├── 07_data_model/         # Data schemas
│   ├── 08_datastore/          # Database design
│   ├── 09_ux/                 # UI components
│   ├── 10_navigation/         # Routes, menus
│   └── 11_apm/                # Metrics, logs
├── dr.config.yaml             # DR configuration
├── projection-rules.yaml      # Projection rules
├── .dr/                       # Tool files
│   └── schemas/               # JSON Schemas
└── specs/                     # Generated specs
    ├── archimate/             # ArchiMate exports
    ├── openapi/               # OpenAPI specs
    └── markdown/              # Documentation
```

## Export Formats

```bash
# ArchiMate (for Archi, Enterprise Architect)
dr export --format archimate --output ./specs/archimate/

# OpenAPI (for Swagger UI, Postman)
dr export --format openapi --output ./specs/openapi/

# Markdown documentation
dr export --format markdown --output ./specs/docs/

# PlantUML diagrams
dr export --format plantuml --output ./specs/diagrams/

# All formats
dr export --format all --output ./specs/
```

## Next Steps

- **Full Reference:** See tier3-complete-reference.md for complete entity catalog
- **Slash Commands:** Use `/dr-init`, `/dr-model`, `/dr-validate` for common workflows
- **CLI Help:** Run `dr <command> --help` for detailed command documentation
- **Documentation:** Check `/cli/docs/user-guide/` for tutorials
