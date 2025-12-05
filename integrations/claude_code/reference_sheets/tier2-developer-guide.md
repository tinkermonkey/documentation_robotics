# Documentation Robotics - Developer Guide

_For active modeling work. See tier1-essentials.md for quick reference._

## Available Agents (NEW in v0.4.0)

Documentation Robotics includes specialized agents to help with different tasks:

### dr-helper (Expert Guidance)

**Purpose:** Answer questions, explain concepts, guide modeling decisions

**When to use:**

- Learning DR concepts
- Making modeling decisions ("How do I model X?")
- Understanding workflows
- Needing guidance on upgrades or maintenance
- Want to understand the "why" behind DR

**Launch:** Task tool, agent type: `dr-helper`

### dr-ideator (Collaborative Exploration)

**Purpose:** Explore architectural ideas safely in changesets with research-driven approach

**When to use:**

- Exploring "what if" architectural ideas
- Evaluating technology choices (GraphQL vs REST, MongoDB vs PostgreSQL)
- Comparing multiple approaches side-by-side
- Need research on technologies/patterns
- Want to model ideas before committing to main
- Deciding whether to merge, keep, or abandon explorations

**Key features:**

- Always works in changesets (safe exploration)
- Asks probing questions to understand context
- Researches using WebSearch and Context-7
- Models ideas collaboratively with you
- Guides merge/abandon decisions
- Manages multiple changesets intelligently

**Launch:** Task tool, agent type: `dr-ideator`

### dr-extractor (Model Extraction)

**Purpose:** Extract DR model from existing codebase

**When to use:**

- Creating initial model from code
- Re-ingesting code changes
- Analyzing new codebases

### dr-validator (Validation & Fixing)

**Purpose:** Validate model and suggest/apply fixes

**When to use:**

- Fixing validation errors
- Improving model quality
- Batch fixing similar issues

### dr-documenter (Documentation Generation)

**Purpose:** Generate comprehensive documentation

**When to use:**

- Creating architecture documentation
- Generating diagrams and matrices
- Preparing for reviews

---

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

### 12. Testing Layer (VERIFY)

**Purpose:** Test coverage modeling and requirements traceability (Custom specification)

**Top Types:**

- `CoverageTarget` - Artifact requiring test coverage (workflow, form, API, data transformation)
- `InputSpacePartition` - Partitioning of input dimensions into testable categories
- `ContextVariation` - Different contexts for invoking functionality (UI, API, event-triggered, scheduled)
- `CoverageRequirement` - Required test coverage with criteria (pairwise, boundary, exhaustive, risk-based)
- `TestCaseSketch` - Abstract test case selecting specific partition values

**Key Properties:**

- `CoverageTarget`: targetType (workflow | form | api-operation | data-transform), businessProcessRef, formRef, apiOperationRef
- `InputSpacePartition`: presenceRule (required | optional | conditional), partitions[] (typical | boundary | invalid | null | special)
- `ContextVariation`: contextType (ui-entry | api-entry | event-triggered | scheduled), securityRoleRef, entryPointRef
- `CoverageRequirement`: coverageCriteria (exhaustive | pairwise | each-choice | boundary | risk-based), targetRef, requirementRefs[]
- `TestCaseSketch`: status (planned | implemented | automated | manual), implementationRef (gherkin:// | postman:// | playwright://)

**Integration Points:**

- Links to Motivation layer for requirements traceability
- Links to Business layer for workflow coverage
- Links to UX layer for form coverage
- Links to API layer for endpoint coverage
- Links to Data Model layer for input constraints
- Links to Security layer for actor/role context
- Links to Navigation layer for route entry points

**Example Usage:**

```bash
# Create coverage target for workflow
dr add testing coverage-target \
  --name "Order Creation Coverage" \
  --set targetType=workflow \
  --set businessProcessRef=business.process.create-order

# Define input partition
dr add testing input-space-partition \
  --name "Line Items Count" \
  --set presenceRule=required

# Define context variation
dr add testing context-variation \
  --name "Customer UI Context" \
  --set contextType=ui-entry \
  --set securityRoleRef=security.role.customer

# Create coverage requirement
dr add testing coverage-requirement \
  --name "Order Primary Coverage" \
  --set coverageCriteria=pairwise \
  --set targetRef=testing.coverage-target.order-creation-coverage

# Define test case sketch
dr add testing test-case-sketch \
  --name "Single Item Order Test" \
  --set status=planned \
  --set expectedOutcome=order-created
```

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
dr validate
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

### Working with Cross-Layer Links

**Cross-layer links** connect elements across the 11 architectural layers, enabling traceability from strategic goals to implementation details. The link management system (spec v0.2.0+, CLI v0.4.0+) provides comprehensive tools for creating, validating, and documenting these connections.

**Key Concepts:**

- **Link Registry**: Catalog of 62+ standardized cross-layer reference patterns
- **Link Types**: 4 pattern categories (x-extensions, dot-notation, nested objects, direct fields)
- **Link Validation**: Automated checking of references, types, cardinality, and formats
- **Link Migration**: Tools to upgrade from v0.1.x to standardized v0.2.0 patterns

#### Understanding Link Patterns

**Pattern A: X-Extensions (OpenAPI/JSON Schema)**

Used in external standard specifications (OpenAPI 3.0, JSON Schema Draft 7):

```yaml
# In OpenAPI operation
paths:
  /orders:
    post:
      operationId: createOrder
      x-archimate-ref: application.service.order-api
      x-supports-goals: [motivation.goal.improve-revenue]
      x-required-permissions: [security.permission.create-order]

# In JSON Schema
properties:
  customer_id:
    type: string
    format: uuid
    x-archimate-ref: business.actor.customer
    x-security:
      classification: confidential
      pii: true
```

**Pattern B: Dot-Notation (Upward References)**

Used when implementation layers reference strategic/higher layers:

```yaml
# In Application Service
application.service.order-api:
  name: "Order Management API"
  properties:
    realizes: business.service.order-management
    motivation:
      supports-goals: [motivation.goal.improve-revenue]
      governed-by-principles: [motivation.principle.api-first]
      fulfills-requirements: [motivation.requirement.order-tracking]
    apm:
      business-metrics: [apm.metric.order-processing-time]
      sla-target-latency: 200ms
```

**Pattern C: Nested Objects (Complex Relationships)**

Used for grouping related references or channel-specific overrides:

```yaml
# In Navigation Route
navigation.route.order-history:
  name: "Order History Route"
  properties:
    motivationAlignment:
      supportsGoals: [motivation.goal.customer-satisfaction]
      deliversValue: [motivation.value.transparency]
      governedByPrinciples: [motivation.principle.user-centric]
    business:
      supportsProcesses: [business.process.order-inquiry]
      targetActors: [business.actor.customer]
    security:
      resourceRef: security.resource.order-data
      requiredRoles: [security.role.customer]
      requiredPermissions: [security.permission.view-own-orders]
    api:
      operationId: listOrders
      method: GET
      endpoint: /api/v1/orders
```

**Pattern D: Direct Fields (Standard References)**

Native specification fields:

```yaml
# OpenAPI operationId
api.operation.create-order:
  properties:
    operationId: createOrder # Native OpenAPI field

# JSON Schema $ref
data_model.object-schema.order-item:
  properties:
    items:
      $ref: "#/definitions/OrderItem" # Native JSON Schema $ref
```

#### Querying Link Types

Before creating cross-layer references, query available link types:

```bash
# List all link types
dr links types

# Filter by category
dr links types --category motivation  # Links to/from motivation layer
dr links types --category security    # Security-related links
dr links types --category api         # API layer links

# Filter by source/target layers
dr links types --layer application
dr links types --layer api
dr links types --layer business

# Get JSON for programmatic use
dr links types --format json
```

**Example workflow:**

```bash
User: How do I link my API operation to the application service it implements?

You: Query the relevant link type:
$ dr links types --layer api

Result shows:
📋 application-service-ref
   Field: x-archimate-ref (in x-extensions)
   Cardinality: Single (one application service per operation)
   Format: UUID (element ID)
   Description: Links API operation to implementing ApplicationService
   Example:
     x-archimate-ref: application.service.order-api
```

#### Discovering Links in Your Model

Find links for specific elements or search across the model:

```bash
# Find all links for an element (shows both incoming and outgoing)
dr links find business.service.order-management

# List all links in model
dr links list

# Filter by link type
dr links list --type motivation.supports-goals

# Filter by layer
dr links list --layer application
```

**Example:**

```bash
$ dr links find business.service.order-management

Links for business.service.order-management:

Outgoing Links (4):
→ motivation.goal.improve-revenue (via motivation.supports-goals)
→ motivation.principle.api-first (via motivation.governed-by-principles)
→ business.actor.operations-team (via owner)
→ apm.metric.order-processing-time (via apm.business-metrics)

Incoming Links (3):
← application.service.order-api (via realizes)
← application.service.order-worker (via realizes)
← navigation.flow.order-fulfillment (via realizesProcess)

Total: 7 links
```

#### Validating Cross-Layer Links

Link validation checks for:

1. **Existence**: Target elements exist in the model
2. **Type Compatibility**: Targets are the correct element type
3. **Cardinality**: Single vs array values match definition
4. **Format**: UUID, path, duration formats are valid

```bash
# Basic link validation
dr validate --validate-links

# Strict mode (warnings become errors)
dr validate --validate-links --strict-links

# Validate specific layer
dr validate --layer application --validate-links

# Get JSON report
dr validate --validate-links --output json > validation-report.json
```

**Common validation issues:**

```yaml
# Issue 1: Broken reference (target doesn't exist)
Error: business.service.orders
→ motivation.supports-goals references 'motivation.goal.missing' (not found)
Suggestion: Did you mean 'motivation.goal.improve-efficiency'?

# Issue 2: Type mismatch
Error: api.operation.create-order
→ x-archimate-ref expects ApplicationService, got BusinessService

# Issue 3: Cardinality error
Error: business.service.orders
→ motivation.supports-goals expects array, got single string
Fix: Use array syntax: supports-goals: ["motivation.goal.revenue"]

# Issue 4: Format error
Error: api.operation.create-order
→ x-archimate-ref expects UUID format, got 'app-service-123'
Fix: Use proper element ID: application.service.order-api
```

**Best practices:**

- Validate links during development
- Use `--strict-links` in CI/CD pipelines
- Validate before applying changesets
- Address warnings to maintain model quality

#### Tracing Paths Between Elements

Find how elements are connected through links:

```bash
# Find path between elements
dr links trace api.operation.create-order motivation.goal.revenue

# Limit depth
dr links trace api.operation.create-order motivation.goal.revenue --max-hops 5
```

**Example:**

```bash
$ dr links trace api.operation.create-order motivation.goal.improve-revenue

Path 1 (shortest - 3 hops):
api.operation.create-order
  → application.service.order-api (via x-archimate-ref)
  → business.service.order-management (via realizes)
  → motivation.goal.improve-revenue (via motivation.supports-goals)

Path 2 (4 hops):
api.operation.create-order
  → ux.view.checkout (via usedBy)
  → navigation.route.checkout (via route)
  → business.process.order-checkout (via realizesProcess)
  → motivation.goal.improve-revenue (via motivation.supports-goals)
```

#### Generating Link Documentation

Create comprehensive link documentation for reviews and onboarding:

```bash
# Generate documentation (Markdown, HTML, Mermaid)
dr links docs --formats markdown --formats html --formats mermaid --output-dir ./docs/

# Generate only Markdown
dr links docs --formats markdown --output-dir ./docs/
```

#### Migrating from v0.1.x to v0.2.0

If you have an existing model using non-standard link patterns, migrate to v0.2.0 standards:

```bash
# Check what needs migration
dr migrate

# Preview changes without applying
dr migrate --dry-run

# Apply all migrations
dr migrate --apply

# Validate migrated model
dr validate --validate-links
```

**What gets migrated:**

1. **Naming conventions**: camelCase → kebab-case
   - `supportGoals` → `supports-goals`
   - `realizesService` → `realizes-services`

2. **Cardinality fixes**: Single values → arrays where needed
   - `supports-goals: "goal-1"` → `supports-goals: ["goal-1"]`

3. **Format corrections**: Invalid UUIDs, paths, durations

**Migration workflow:**

```bash
# Create migration branch
git checkout -b migrate-to-v0.2.0

# Check and preview
dr migrate
dr migrate --dry-run

# Apply migration
dr migrate --apply

# Validate result
dr validate --validate-links --strict-links

# Review changes
git diff

# Commit if satisfied
git add .
git commit -m "Migrate cross-layer links to v0.2.0 standards"
git checkout main
git merge migrate-to-v0.2.0
```

#### Python API for Link Management

```python
from documentation_robotics.core import Model
from documentation_robotics.validation.link_registry import LinkRegistry
from documentation_robotics.validation.link_analyzer import LinkAnalyzer
from documentation_robotics.validation.link_validator import LinkValidator

# Load model
model = Model.load("./")

# Load link registry
registry = LinkRegistry()

# Get link types for a pattern
link_types = registry.get_link_types(
    category="motivation",
    source_layer="application"
)
for link_type in link_types:
    print(f"{link_type.name}: {link_type.field_path}")

# Analyze links in model
analyzer = LinkAnalyzer(model, registry)
links = analyzer.discover_all_links()
print(f"Found {len(links)} link instances")

# Build link graph
graph = analyzer.build_link_graph()
print(f"Nodes: {graph.number_of_nodes()}, Edges: {graph.number_of_edges()}")

# Find path between elements
path = analyzer.find_path(
    "api.operation.create-order",
    "motivation.goal.revenue"
)
if path:
    print(f"Path length: {len(path)}")
    print(" → ".join(path))

# Validate all links
validator = LinkValidator(model, registry)
result = validator.validate_all()

print(f"Total links validated: {result.total_links}")
print(f"Errors: {len(result.errors)}")
print(f"Warnings: {len(result.warnings)}")

for error in result.errors:
    print(f"Error in {error.element_id}: {error.message}")
    if error.suggestion:
        print(f"  Suggestion: {error.suggestion}")
```

#### Link Management Best Practices

1. **Query before creating**: Use `dr links types` to understand valid patterns
2. **Maintain traceability**: Link implementation to motivation layer
3. **Validate regularly**: Run `dr validate --validate-links` frequently
4. **Use strict mode in CI/CD**: `--strict-links` catches all issues
5. **Document connections**: Use `dr links docs` for stakeholder reviews
6. **Monitor link health**: Check `dr links stats` for model insights
7. **Follow naming conventions**: Use kebab-case, proper plurals
8. **Choose appropriate patterns**: X-extensions for OpenAPI, dot-notation for upward refs

### Working with Changesets

**Changesets** provide isolated workspaces for exploring ideas, building features, or testing changes without affecting the main model. Think of them like Git branches for your architecture.

**When to use changesets:**

- Exploring speculative designs or "what-if" scenarios
- Building new features incrementally
- Making experimental changes you might want to discard
- Working on multiple independent features in parallel
- Collaborating with agents to iterate on designs

**Basic workflow:**

```bash
# 1. Create and activate a changeset
dr changeset create "new-payment-feature" --type feature

# 2. Make changes (all commands work in changeset context)
dr add business service --name "Crypto Payments"
dr add application service --name "Blockchain Adapter"
dr update business.service.crypto-payments --set status=experimental

# 3. Review changes
dr changeset status              # See what changed
dr changeset diff                # Compare with main model

# 4. Apply or abandon
dr changeset apply --yes         # Merge to main model
# OR
dr changeset abandon changeset-id --yes  # Discard changes
```

**Managing multiple changesets:**

```bash
# List all changesets
dr changeset list                # See all changesets
dr changeset list --status active  # Filter by status

# Switch between changesets
dr changeset switch changeset-id  # Activate different changeset
dr changeset clear --yes          # Return to main model

# Compare changesets
dr changeset diff changeset-a changeset-b  # Compare two changesets
```

**Python API for changesets:**

```python
from documentation_robotics.core import Model
from documentation_robotics.core.changeset_manager import ChangesetManager

# Create changeset
manager = ChangesetManager("./")
changeset_id = manager.create(name="new-feature", changeset_type="feature")

# Load model in changeset context
model = Model.load("./", changeset=changeset_id)

# Make changes - all tracked automatically
model.add_element("business", {"id": "business.service.new", ...})
model.update_element("business.service.existing", {"status": "updated"})

# Changes are isolated to this changeset
# Main model remains unchanged until you apply
```

**Best practices:**

- Create descriptive changeset names: `feature-crypto-payments` not `test1`
- Review changes with `dr changeset status` before applying
- Use `--preview` flag when applying to see what will change
- Keep changesets focused on a single feature or experiment
- Delete or abandon changesets when done to keep workspace clean

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
