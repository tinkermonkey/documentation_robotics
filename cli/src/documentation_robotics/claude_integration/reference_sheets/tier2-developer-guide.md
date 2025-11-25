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

**Purpose:** Authentication, authorization, access control, and security governance using STS-ml inspired model

**Top Types:**

- `Role` - User role with permissions and inheritance
- `Permission` - Specific access permission (scope, resource, action)
- `SecureResource` - Protected resource with operations and field access
- `SecurityPolicy` - Declarative security policy with rules
- `Actor` - Security actor (role, agent, organization, system) with objectives
- `ActorObjective` - Security-related goals for actors
- `InformationEntity` - Information asset with fine-grained rights
- `Delegation` - Permission/goal delegation between actors
- `SeparationOfDuty` - Different actors must perform related tasks
- `BindingOfDuty` - Same actor must complete related tasks
- `NeedToKnow` - Access based on objective requirements
- `Threat` - Security threat with countermeasures
- `AccountabilityRequirement` - Non-repudiation and audit requirements
- `Evidence` - Proof for accountability (signatures, timestamps, etc.)
- `DataClassification` - Data classification levels and protection requirements

_Note: See tier3 for complete security model (28+ types)_

**Key Properties:**

- `Role`: name, displayName, inheritsFrom[], permissions[], isSystemRole
- `Permission`: name, scope (global | resource | attribute | owner), resource, action
- `SecureResource`: resource, type (api | screen | data | file | service), operations[]
- `Actor`: type (role | agent | organization | system), trustLevel, objectives[]
- `Threat`: threatens[], likelihood, impact, threatActors[], countermeasures[]

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

**Purpose:** Logical data structures using JSON Schema Draft 7

**Top Types:**

- `ObjectSchema` - Defines object structure and required properties
- `ArraySchema` - Defines array items and constraints (minItems, maxItems, uniqueItems)
- `StringSchema` - String validation (length, pattern, format like email/uuid/date-time)
- `NumericSchema` - Number validation (min, max, multipleOf)
- `SchemaComposition` - Combines schemas (allOf, anyOf, oneOf, not)
- `Reference` - Links to other schemas ($ref)

**Key Properties:**

- `type`: object | array | string | number | integer | boolean | null
- `required`: [field1, field2, ...]
- `properties`: {field definitions}
- Custom extensions: `x-database`, `x-ui`, `x-security`, `x-apm-data-quality-metrics`

### 08. Datastore Layer (STORAGE)

**Purpose:** Physical database design using SQL DDL

**Top Types:**

- `Database` - Database instance with schemas
- `DatabaseSchema` - Logical grouping of tables (distinct from JSON Schema)
- `Table` - Database table with columns and constraints
- `Column` - Table column with data type and constraints
- `Index` - Query optimization indexes (BTREE, HASH, GIN, etc.)
- `Constraint` - PRIMARY_KEY, UNIQUE, FOREIGN_KEY, CHECK, EXCLUSION
- `Trigger` - Database triggers (BEFORE/AFTER/INSTEAD OF on INSERT/UPDATE/DELETE)
- `View` - Database views (regular or materialized)

**Key Properties:**

- `Database`: type (PostgreSQL | MySQL | SQLite | etc.), version, charset
- `Table`: schema, columns[], constraints[], indexes[], triggers[]
- `Column`: dataType, nullable, defaultValue, x-pii, x-encrypted
- Custom extensions: `x-json-schema`, `x-governed-by-*`, `x-apm-performance-metrics`

### 09. UX Layer (PRESENTATION)

**Purpose:** User experience across multiple channels (visual, voice, chat, SMS)

**Top Types:**

- `View` - Routable screen/page with components (not "Screen")
- `ExperienceState` - Distinct state the experience can be in (not just "State")
- `Component` - Atomic UI element (form-field, table, chart, card, etc.)
- `SubView` - Reusable grouping of components within a view
- `ActionComponent` - Interactive element (button, menu-item, link, voice-command)
- `ValidationRule` - Client-side validation (required, minLength, pattern, email, etc.)
- `StateAction` - Action executed during state lifecycle (fetchData, saveData, validateForm, etc.)
- `StateTransition` - Transition between states (on success, failure, submit, etc.)

_Note: Layout is a property of View (LayoutStyle config), not a standalone entity_

**Key Properties:**

- `View`: type (form | list | detail | dashboard | wizard | conversational), layout, subViews[], components[]
- `ExperienceState`: initial, onEnter[], onExit[], transitions[]
- `Component`: type, dataBinding (schemaRef, defaultValue), security (fieldAccess, visibleToRoles)
- `StateAction`: action (fetchData | saveData | callAPI | navigateTo), api.operationId

### 10. Navigation Layer (FLOW)

**Purpose:** Application routing, flows, and business process orchestration

**Top Types:**

- `Route` - Single destination (url for visual, intent for voice, event for chat, keyword for SMS)
- `NavigationGuard` - Access control (authentication, authorization, validation, data-loaded)
- `NavigationTransition` - Transition between routes (trigger: user-action, submit, success, failure, etc.)
- `NavigationFlow` - Sequence of routes realizing business process
- `FlowStep` - One step in navigation flow with data transfer and compensation
- `ContextVariable` - Shared variable across flow steps (scope: flow | session | user)

_Note: NavigationMenu, Breadcrumb, and Sitemap are NOT entity types in the schema_

**Key Properties:**

- `Route`: type (experience | redirect | external), meta (requiresAuth, roles[], permissions[])
- `NavigationGuard`: type (authentication | authorization | validation | custom), condition, onDeny
- `NavigationFlow`: steps[], sharedContext[], processTracking, analytics
- `FlowStep`: sequence, route, experience (entryState, exitTrigger), dataTransfer (inputs[], outputs[])
- `ContextVariable`: schemaRef, scope, persistedIn (memory | session-storage | database)

### 11. APM/Observability Layer (OBSERVE)

**Purpose:** Monitoring and observability using OpenTelemetry 1.0+ standard

**Top Types:**

- `Span` - Unit of work in distributed tracing (spanKind: INTERNAL, SERVER, CLIENT, PRODUCER, CONSUMER)
- `SpanEvent` - Timestamped event during span execution
- `LogRecord` - OpenTelemetry log entry (severityNumber, severityText, body)
- `InstrumentConfig` - Metric instrument (type: counter, updowncounter, gauge, histogram)
- `TraceConfiguration` - Distributed tracing config (serviceName, sampler, propagators, exporters)
- `LogConfiguration` - Logging config (serviceName, logLevel, processors, exporters)
- `MetricConfiguration` - Metrics config (serviceName, meters, exporters)
- `DataQualityMetric` - Data quality monitoring (type: completeness, accuracy, freshness, consistency, etc.)

_Note: "Alert" and "Dashboard" are NOT entity types in the OpenTelemetry schema_

**Key Properties:**

- `Span`: traceId, spanId, name, startTimeUnixNano, endTimeUnixNano, attributes[], events[], status
- `LogRecord`: timeUnixNano, severityNumber, severityText (TRACE | DEBUG | INFO | WARN | ERROR | FATAL), body
- `InstrumentConfig`: type, name, unit, description, motivationMapping (contributesToGoal, measuresOutcome)
- Custom extensions: operationId, archimateService, businessProcess for cross-layer integration

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
layer = Layer.load(name="business", path="./documentation-robotics/model/02_business")

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
├── .dr/                           # Tool configuration and schemas
│   ├── schemas/                   # JSON Schema definitions for each layer
│   ├── examples/                  # Example elements
│   └── README.md                  # Model documentation
├── documentation-robotics/        # Main project directory
│   ├── model/                     # The canonical architecture model
│   │   ├── manifest.yaml          # Model metadata and registry
│   │   ├── 01_motivation/         # Motivation layer elements
│   │   ├── 02_business/           # Business layer elements
│   │   ├── 03_security/           # Security layer elements
│   │   ├── 04_application/        # Application layer elements
│   │   ├── 05_technology/         # Technology layer elements
│   │   ├── 06_api/                # API layer elements
│   │   ├── 07_data_model/         # Data model layer elements
│   │   ├── 08_datastore/          # Datastore layer elements
│   │   ├── 09_ux/                 # UX layer elements
│   │   ├── 10_navigation/         # Navigation layer elements
│   │   └── 11_apm/                # APM layer elements
│   ├── specs/                     # Generated/exported specifications
│   │   ├── archimate/             # ArchiMate XML exports
│   │   ├── openapi/               # OpenAPI 3.0 specs
│   │   ├── schemas/               # JSON Schema files
│   │   ├── diagrams/              # PlantUML diagrams
│   │   └── docs/                  # Markdown documentation
│   └── projection-rules.yaml      # Cross-layer projection rules
└── dr.config.yaml                 # Configuration
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
