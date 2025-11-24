# Documentation Robotics - Complete Reference

_Comprehensive reference for all layers, entity types, and advanced features._

## Table of Contents

1. [Complete Entity Type Catalog](#complete-entity-type-catalog)
2. [Advanced CLI Commands](#advanced-cli-commands)
3. [Projection Rules Reference](#projection-rules-reference)
4. [Validation Rules](#validation-rules)
5. [Export Formats](#export-formats)
6. [Troubleshooting](#troubleshooting)

---

## Complete Entity Type Catalog

### Layer 01: Motivation (ArchiMate 3.2)

| Type            | Description                        | Required Fields | Key Properties                                         |
| --------------- | ---------------------------------- | --------------- | ------------------------------------------------------ |
| **Stakeholder** | Person/organization with interest  | id, name        | type: internal\|external\|customer\|partner\|regulator |
| **Driver**      | External/internal force for change | id, name        | category: market\|regulatory\|technology\|competitive  |
| **Assessment**  | Outcome of analysis                | id, name        | analysisDate, findings                                 |
| **Goal**        | High-level desired outcome         | id, name        | priority: critical\|high\|medium\|low, measuredBy      |
| **Outcome**     | End result                         | id, name        | targetDate, successCriteria                            |
| **Principle**   | Guiding rule/constraint            | id, name        | type: business\|technical\|governance                  |
| **Requirement** | Statement of need                  | id, name        | type: functional\|non-functional, traces-to            |
| **Constraint**  | Restriction/limitation             | id, name        | type: time\|budget\|resource\|technical                |
| **Meaning**     | Knowledge/expertise                | id, name        | domain, applicability                                  |
| **Value**       | Relative worth/importance          | id, name        | category: financial\|customer\|operational             |

**Common Properties:**

```yaml
motivation.goal.example:
  id: motivation.goal.improve-conversion
  name: "Improve Conversion Rate"
  description: "Increase e-commerce conversion rate"
  properties:
    priority: critical
    target: "15% increase in 6 months"
    measuredBy: [apm.metric.conversion-rate]
    owner: motivation.stakeholder.ceo
```

### Layer 02: Business (ArchiMate 3.2)

| Type                      | Description                | Required Fields | Key Properties                           |
| ------------------------- | -------------------------- | --------------- | ---------------------------------------- |
| **BusinessActor**         | Entity performing behavior | id, name        | type: person\|organization\|system, role |
| **BusinessRole**          | Responsibility             | id, name        | assignedTo, capabilities                 |
| **BusinessCollaboration** | Aggregate of actors        | id, name        | participants                             |
| **BusinessInterface**     | External access point      | id, name        | protocol, format                         |
| **BusinessProcess**       | Sequence of activities     | id, name        | owner, frequency, duration               |
| **BusinessFunction**      | Collection of behaviors    | id, name        | capabilities, supports-goals             |
| **BusinessInteraction**   | Behavior by 2+ actors      | id, name        | participants                             |
| **BusinessEvent**         | State change               | id, name        | triggers, frequency                      |
| **BusinessService**       | Consistent behavior        | id, name        | criticality, owner, supports-goals       |
| **BusinessObject**        | Passive element            | id, name        | lifecycle, owner                         |
| **Contract**              | Formal agreement           | id, name        | parties, effective-date, term            |
| **Representation**        | Perceptible form           | id, name        | format, medium                           |
| **Product**               | Offering                   | id, name        | price, target-market                     |

**Common Properties:**

```yaml
business.service.order-management:
  id: business.service.order-management
  name: "Order Management"
  description: "Manages customer orders lifecycle"
  properties:
    criticality: high
    owner: business.actor.operations-team
    supports-goals: [motivation.goal.improve-conversion]
    sla: "99.9% availability"
```

### Layer 03: Security (Custom)

| Type                     | Description            | Required Fields | Key Properties                           |
| ------------------------ | ---------------------- | --------------- | ---------------------------------------- |
| **AuthenticationScheme** | How users authenticate | id, name        | type: oauth2\|saml\|jwt\|basic, provider |
| **AuthorizationPolicy**  | Access control rules   | id, name        | rules, applies_to                        |
| **SecurityControl**      | Security measure       | id, name        | type: preventive\|detective\|corrective  |
| **Threat**               | Potential harm         | id, name        | severity, likelihood, mitigation         |
| **Vulnerability**        | Weakness               | id, name        | cvss-score, affected-components          |
| **SecurityRequirement**  | Security need          | id, name        | compliance-standard, applies_to          |

**Common Properties:**

```yaml
security.policy.authenticated-access:
  id: security.policy.authenticated-access
  name: "Authenticated Access Policy"
  description: "Requires authentication for all API endpoints"
  properties:
    type: authorization
    applies_to:
      - application.service.order-api
      - application.service.payment-api
    rules:
      - require: jwt-token
      - validate: token-expiry
      - enforce: rate-limiting
```

### Layer 04: Application (ArchiMate 3.2)

| Type                         | Description                  | Required Fields | Key Properties                           |
| ---------------------------- | ---------------------------- | --------------- | ---------------------------------------- |
| **ApplicationComponent**     | Modular part                 | id, name        | technology, version, realizes            |
| **ApplicationCollaboration** | Aggregate of components      | id, name        | participants                             |
| **ApplicationInterface**     | External access              | id, name        | protocol, port                           |
| **ApplicationFunction**      | Automated behavior           | id, name        | input, output, processing                |
| **ApplicationInteraction**   | Interaction of 2+ components | id, name        | protocol, pattern                        |
| **ApplicationProcess**       | Sequence of behaviors        | id, name        | orchestrates                             |
| **ApplicationEvent**         | State change                 | id, name        | triggers, payload                        |
| **ApplicationService**       | Exposed functionality        | id, name        | realizes, securedBy, deployedTo, exposes |
| **DataObject**               | Data structure               | id, name        | schema, lifecycle                        |

**Common Properties:**

```yaml
application.service.order-api:
  id: application.service.order-api
  name: "Order Management API"
  description: "REST API for order operations"
  properties:
    realizes: business.service.order-management
    securedBy: [security.policy.authenticated-access]
    deployedTo: technology.node.k8s-cluster
    exposes: [api.operation.create-order, api.operation.get-order]
    technology: "Node.js + Express"
    version: "2.1.0"
    instrumentedBy: [apm.metric.order-api-latency]
```

### Layer 05: Technology (ArchiMate 3.2)

| Type                        | Description                   | Required Fields | Key Properties                                  |
| --------------------------- | ----------------------------- | --------------- | ----------------------------------------------- |
| **Node**                    | Computational resource        | id, name        | type: server\|vm\|container, hosts, environment |
| **Device**                  | Physical machine              | id, name        | model, location                                 |
| **SystemSoftware**          | Software environment          | id, name        | type: os\|database\|middleware, version         |
| **TechnologyCollaboration** | Aggregate of nodes            | id, name        | participants                                    |
| **TechnologyInterface**     | Network interface             | id, name        | protocol, port, ip-address                      |
| **Path**                    | Link between nodes            | id, name        | bandwidth, latency                              |
| **CommunicationNetwork**    | Set of connections            | id, name        | topology, protocol                              |
| **TechnologyFunction**      | Internal behavior             | id, name        | purpose                                         |
| **TechnologyProcess**       | Sequence of functions         | id, name        | automation-level                                |
| **TechnologyInteraction**   | Interaction of infrastructure | id, name        | protocol                                        |
| **TechnologyEvent**         | Infrastructure state change   | id, name        | triggers                                        |
| **TechnologyService**       | Infrastructure capability     | id, name        | sla, capacity                                   |
| **Artifact**                | Physical piece of data        | id, name        | format, size, storage                           |

**Common Properties:**

```yaml
technology.node.k8s-cluster:
  id: technology.node.k8s-cluster
  name: "Production Kubernetes Cluster"
  description: "Main production cluster for microservices"
  properties:
    type: container-orchestration
    environment: production
    hosts:
      - application.service.order-api
      - application.service.payment-api
    region: us-east-1
    capacity: "100 pods"
    version: "1.28"
```

### Layer 06: API (OpenAPI 3.0.3)

| Type               | Description        | Required Fields  | Key Properties                                |
| ------------------ | ------------------ | ---------------- | --------------------------------------------- |
| **Operation**      | API endpoint       | id, path, method | operationId, securedBy, applicationServiceRef |
| **Parameter**      | Request parameter  | id, name         | in: path\|query\|header\|body, type, required |
| **Schema**         | Data structure     | id, name         | type, properties, required                    |
| **Response**       | Operation response | id, status       | content-type, schema                          |
| **SecurityScheme** | API security       | id, name         | type: http\|apiKey\|oauth2                    |

**Common Properties:**

```yaml
api.operation.create-order:
  id: api.operation.create-order
  name: "Create Order"
  properties:
    path: "/api/v1/orders"
    method: POST
    operationId: createOrder
    securedBy: [security.scheme.bearer-auth]
    applicationServiceRef: application.service.order-api
    requestBody:
      schema: data_model.schema.order-create-request
    responses:
      "201": data_model.schema.order
      "400": data_model.schema.error
```

### Layer 07: Data Model (JSON Schema Draft 7)

| Type             | Description       | Required Fields | Key Properties                     |
| ---------------- | ----------------- | --------------- | ---------------------------------- |
| **Schema**       | Entity definition | id, name        | type, properties, required, usedBy |
| **Property**     | Field definition  | name, type      | format, constraints                |
| **Relationship** | Association       | id, name        | from, to, cardinality              |

**Common Properties:**

```yaml
data_model.schema.order:
  id: data_model.schema.order
  name: "Order"
  description: "Customer order entity"
  properties:
    type: object
    required: [id, customer_id, items, total, status]
    properties:
      id: { type: string, format: uuid }
      customer_id: { type: string, format: uuid }
      items: { type: array, items: { $ref: "#/OrderItem" } }
      total: { type: number, format: currency }
      status: { type: string, enum: [pending, confirmed, shipped, delivered] }
    usedBy:
      - api.operation.create-order
      - api.operation.get-order
    stored-in: datastore.table.orders
```

### Layer 08: Datastore (Custom)

| Type           | Description       | Required Fields | Key Properties              |
| -------------- | ----------------- | --------------- | --------------------------- |
| **Database**   | Database instance | id, name        | type, version, stores       |
| **Schema**     | Database schema   | id, name        | database                    |
| **Table**      | Database table    | id, name        | stores, columns             |
| **Column**     | Table column      | id, name        | type, nullable, default     |
| **Index**      | Database index    | id, name        | columns, unique             |
| **Constraint** | Data constraint   | id, name        | type: pk\|fk\|unique\|check |
| **View**       | Database view     | id, name        | query, base-tables          |
| **Procedure**  | Stored procedure  | id, name        | parameters, returns         |

**Common Properties:**

```yaml
datastore.table.orders:
  id: datastore.table.orders
  name: "orders"
  description: "Stores customer orders"
  properties:
    stores: data_model.schema.order
    database: datastore.database.main-db
    columns:
      - { name: id, type: uuid, pk: true }
      - { name: customer_id, type: uuid, fk: customers.id }
      - { name: total, type: decimal(10, 2) }
      - { name: status, type: varchar(20) }
      - { name: created_at, type: timestamp }
    indexes:
      - { name: idx_customer, columns: [customer_id] }
      - { name: idx_status, columns: [status] }
```

### Layer 09: UX (Custom)

| Type                  | Description       | Required Fields | Key Properties                 |
| --------------------- | ----------------- | --------------- | ------------------------------ |
| **Screen**            | Application page  | id, name        | route, layout, calls, displays |
| **Component**         | UI component      | id, name        | type, props                    |
| **Layout**            | Screen structure  | id, name        | regions, responsive            |
| **State**             | UI state          | id, name        | scope, lifecycle               |
| **Transition**        | Screen transition | id, name        | from, to, trigger              |
| **Theme**             | Visual styling    | id, name        | colors, fonts, spacing         |
| **AccessibilitySpec** | A11y requirements | id, name        | wcag-level, requirements       |

**Common Properties:**

```yaml
ux.screen.order-history:
  id: ux.screen.order-history
  name: "Order History"
  description: "Customer order history view"
  properties:
    route: navigation.route.order-history
    layout: ux.layout.dashboard
    calls:
      - api.operation.list-orders
      - api.operation.get-order-details
    displays: [data_model.schema.order]
    components:
      - ux.component.order-list
      - ux.component.order-filters
      - ux.component.pagination
    accessibility: ux.accessibility.wcag-aa
```

### Layer 10: Navigation (Custom)

| Type               | Description      | Required Fields | Key Properties                            |
| ------------------ | ---------------- | --------------- | ----------------------------------------- |
| **Route**          | URL route        | id, path        | rendersScreen, guard, params              |
| **Guard**          | Route guard      | id, name        | type: auth\|role\|subscription, validates |
| **NavigationMenu** | Menu structure   | id, name        | items, layout                             |
| **Breadcrumb**     | Breadcrumb trail | id, name        | path, dynamic                             |
| **Sitemap**        | Site structure   | id, name        | pages, hierarchy                          |

**Common Properties:**

```yaml
navigation.route.order-history:
  id: navigation.route.order-history
  name: "Order History Route"
  properties:
    path: "/app/orders/history"
    rendersScreen: ux.screen.order-history
    guard: navigation.guard.authenticated
    params: []
    meta:
      title: "Order History"
      requiresAuth: true
```

### Layer 11: APM/Observability (OpenTelemetry 1.0+)

| Type          | Description          | Required Fields | Key Properties                 |
| ------------- | -------------------- | --------------- | ------------------------------ |
| **Metric**    | Performance metric   | id, name        | type, instruments, threshold   |
| **Log**       | Log configuration    | id, name        | level, format, instruments     |
| **Trace**     | Distributed trace    | id, name        | spans, instruments             |
| **Span**      | Trace segment        | id, name        | operation, duration            |
| **Alert**     | Alert definition     | id, name        | condition, threshold, notifies |
| **Dashboard** | Monitoring dashboard | id, name        | widgets, metrics               |

**Common Properties:**

```yaml
apm.metric.order-api-latency:
  id: apm.metric.order-api-latency
  name: "Order API Latency"
  description: "P95 latency for order API operations"
  properties:
    type: latency
    instruments: [application.service.order-api]
    aggregation: p95
    threshold: "200ms"
    unit: milliseconds
    alerts: [apm.alert.high-latency]
```

---

## Advanced CLI Commands

### Search with Filters

```bash
# Search by name pattern
dr search "Order*" --layer business

# Search by property
dr search --property criticality=high

# Search with multiple filters
dr search --layer application --type service --property environment=production

# Output formats
dr search "API" --format json
dr search "API" --format yaml
dr search "API" --format table
```

### Projection Options

```bash
# Project single element
dr project business.service.orders --to application

# Project with rules file
dr project business.service.orders --to application --rules custom-rules.yaml

# Project all matching elements
dr project-all --from business --to application --type service

# Preview projection (dry-run)
dr project business.service.orders --to application --dry-run

# Project to multiple layers
dr project business.service.orders --to application,api,data_model
```

### Trace Dependencies

```bash
# Trace downstream (what depends on this)
dr trace business.service.orders --direction downstream

# Trace upstream (what this depends on)
dr trace application.service.order-api --direction upstream

# Trace both directions
dr trace business.service.orders --direction both

# Trace to specific depth
dr trace business.service.orders --depth 3

# Output as graph
dr trace business.service.orders --format graphml
```

### Export Options

```bash
# Export specific layer
dr export --format archimate --layer business

# Export with filter
dr export --format markdown --type service

# Export to custom path
dr export --format openapi --output ./docs/api-specs/

# Export all formats
dr export --format all

# Validate export before generating
dr export --format archimate --validate
```

### Validation Options

```bash
# Validate specific layer
dr validate --layer business

# Validate with specific rules
dr validate --rules semantic,references,traceability

# Output validation report
dr validate --output validation-report.json --format json

# Fix common issues automatically
dr validate --auto-fix

# Validate and show warnings only
dr validate --warnings-only
```

---

## Projection Rules Reference

### Rule Structure

```yaml
projections:
  - name: "projection-name"
    from: source.layer.type
    to: target.layer.type
    conditions:
      - field: property.path
        operator: equals | not_equals | contains | matches | exists | gt | lt
        value: comparison-value
    rules:
      - create_type: target-type
        name_template: "{{template}}"
        properties:
          key: "{{value}}"
        create_bidirectional: true | false
```

### Template Variables

```yaml
# Source element access
{{source.id}}               # business.service.orders
{{source.name}}             # Order Management
{{source.name_kebab}}       # order-management
{{source.name_pascal}}      # OrderManagement
{{source.name_snake}}       # order_management
{{source.name_upper}}       # ORDER MANAGEMENT
{{source.layer}}            # business
{{source.type}}             # service
{{source.description}}      # Description text
{{source.properties.key}}   # Property value

# Transformations
{{source.name | uppercase}}
{{source.name | lowercase}}
{{source.name | kebab}}
{{source.name | pascal}}
{{source.name | snake}}
```

### Example Rules

```yaml
# Business → Application
projections:
  - name: "business-to-application"
    from: business.service
    to: application.service
    conditions:
      - field: properties.criticality
        operator: equals
        value: critical
    rules:
      - create_type: service
        name_template: "{{source.name}}"
        properties:
          realizes: "{{source.id}}"
          description: "Implements {{source.name}}"
          criticality: "{{source.properties.criticality}}"
        create_bidirectional: true

  # Application → API
  - name: "application-to-api"
    from: application.service
    to: api.operation
    rules:
      - create_type: operation
        name_template: "{{source.name_kebab}}-api"
        properties:
          path: "/api/v1/{{source.name_kebab}}"
          method: "POST"
          applicationServiceRef: "{{source.id}}"

  # Conditional projection
  - name: "critical-services-to-monitoring"
    from: application.service
    to: apm.metric
    conditions:
      - field: properties.criticality
        operator: equals
        value: critical
    rules:
      - create_type: metric
        name_template: "{{source.name_kebab}}-availability"
        properties:
          type: availability
          instruments: ["{{source.id}}"]
          threshold: "99.9%"
```

---

## Validation Rules

### Semantic Validation Rules (11 Rules)

1. **Security Controls Applied**: Critical services must have security policies
2. **Critical Services Monitored**: Critical services must have APM metrics
3. **Public APIs Authenticated**: Public APIs must have authentication schemes
4. **Personal Data Encrypted**: Data with PII must have encryption controls
5. **Business Processes Have Owners**: Processes must have assigned business actors
6. **Goals Have KPIs**: Goals must reference measurable metrics
7. **Requirements Traced**: Requirements must trace to implementation
8. **Services Deployed**: Application services must reference deployment nodes
9. **APIs Rate Limited**: Public APIs should have rate limiting
10. **Data Has Backup**: Critical data must have backup policies
11. **UX Meets Accessibility**: UX components must meet WCAG standards

### Custom Validation

```python
from documentation_robotics.validators import BaseValidator

class CustomValidator(BaseValidator):
    def validate(self, model):
        errors = []
        warnings = []

        # Custom validation logic
        for element in model.find_elements(layer="business"):
            if element.get("properties", {}).get("criticality") == "critical":
                if not element.get("properties", {}).get("owner"):
                    errors.append(
                        self.create_error(
                            element_id=element.id,
                            message="Critical service missing owner"
                        )
                    )

        return self.create_result(errors=errors, warnings=warnings)
```

---

## Export Formats

### ArchiMate (.archimate)

- Full ArchiMate 3.2 model
- Compatible with Archi, Enterprise Architect
- Includes elements, relationships, views
- Supports all 11 layers

### OpenAPI (.yaml)

- OpenAPI 3.0.3 specifications
- One spec per application service
- Includes paths, operations, schemas, security
- Compatible with Swagger UI, Postman

### JSON Schema (.schema.json)

- JSON Schema Draft 7 format
- Exports data model layer
- Supports $ref and composition
- Compatible with validation tools

### PlantUML (.puml)

- Component diagrams
- Class diagrams
- Deployment diagrams
- Sequence diagrams

### Markdown (.md)

- Layer-by-layer documentation
- Element catalogs
- Relationship matrices
- Traceability reports

### GraphML (.graphml)

- Network graph format
- Compatible with yEd, Gephi, Cytoscape
- Node and edge attributes
- Layout hints

---

## Troubleshooting

### Common Issues

**Issue: "Element not found"**

```bash
# Check if element exists
dr find business.service.orders

# List all elements in layer
dr list business service

# Search for similar names
dr search "order" --layer business
```

**Issue: "Validation failed - broken reference"**

```yaml
# Check reference target exists
dr find motivation.goal.missing-goal

# Fix by creating target or removing reference
dr add motivation goal --name "Missing Goal"
# OR
dr update business.service.orders --remove-property supports-goals
```

**Issue: "Projection failed"**

```bash
# Check projection rules syntax
dr project business.service.orders --to application --dry-run

# Verify source element has required properties
dr find business.service.orders

# Check projection rules file
cat projection-rules.yaml
```

**Issue: "Export failed"**

```bash
# Validate model first
dr validate --strict

# Fix validation errors
dr validate --auto-fix

# Export specific layer
dr export --format archimate --layer business

# Check export output directory permissions
ls -la ./specs/
```

### Debug Mode

```bash
# Enable verbose output
dr --verbose validate

# Check log files
cat .dr/logs/dr.log

# Validate specific element
dr find business.service.orders --validate
```

### Performance Issues

```bash
# Enable caching
export DR_ENABLE_CACHE=true

# Use lazy loading for large models
export DR_LAZY_LOAD=true

# Validate specific layers only
dr validate --layer business,application
```

---

## Additional Resources

- **User Guide**: `/cli/docs/user-guide/`
- **Design Documents**: `/cli/docs/`
- **Examples**: `/spec/examples/`
- **Schemas**: `.dr/schemas/`
- **API Documentation**: Run `dr --help` for command details
- **GitHub**: https://github.com/anthropics/documentation-robotics
