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

### Layer 03: Security (STS-ml Security Model)

Complete Socio-Technical Security (STS-ml) model with role-based access control, security policies, and social relationships.

**Role-Based Access Control:**

| Type                   | Description                     | Required Fields | Key Properties                                               |
| ---------------------- | ------------------------------- | --------------- | ------------------------------------------------------------ |
| **Role**               | User role with permissions      | id, name        | permissions, inheritsFrom, assignedActors                    |
| **Permission**         | Specific access permission      | id, name        | scope: read\|write\|delete\|execute, resource, action        |
| **SecureResource**     | Protected resource              | id, name        | operations, fieldAccess, dataClassification                  |
| **ResourceOperation**  | Operation on secure resource    | id, name        | operation: create\|read\|update\|delete, requiredPermissions |
| **FieldAccessControl** | Fine-grained field-level access | id, name        | resource, field, permissions, conditions                     |

**Authentication & Authorization:**

| Type                     | Description                     | Required Fields | Key Properties                                       |
| ------------------------ | ------------------------------- | --------------- | ---------------------------------------------------- |
| **AuthenticationConfig** | Authentication configuration    | id, name        | methods, providers, mfaRequired, sessionTimeout      |
| **PasswordPolicy**       | Password requirements           | id, name        | minLength, requireUppercase, requireSymbols, maxAge  |
| **SecurityPolicy**       | Declarative security policy     | id, name        | rules, appliesTo, enforcement: strict\|permissive    |
| **PolicyRule**           | Individual policy rule          | id, name        | condition, action, priority                          |
| **PolicyAction**         | Action when rule matches        | id, name        | type: allow\|deny\|log\|alert, parameters            |
| **AccessCondition**      | Condition for policy evaluation | id, name        | type: time\|location\|device\|risk-score, parameters |

**STS-ml Social Actors:**

| Type                | Description                            | Required Fields | Key Properties                                           |
| ------------------- | -------------------------------------- | --------------- | -------------------------------------------------------- |
| **Actor**           | Security actor (role/agent/org/system) | id, name        | type: role\|agent\|organization\|system, objectives      |
| **ActorObjective**  | Security-related goal for actor        | id, name        | actor, objectiveType, priority                           |
| **ActorDependency** | One actor depends on another           | id, name        | depender, dependee, type: goal\|softgoal\|task\|resource |

**Information & Access Control:**

| Type                   | Description                   | Required Fields | Key Properties                                                        |
| ---------------------- | ----------------------------- | --------------- | --------------------------------------------------------------------- |
| **InformationEntity**  | Information asset             | id, name        | owner, classification, rights                                         |
| **InformationRight**   | Specific right on information | id, name        | type: read\|modify\|produce\|distribute, conditions                   |
| **DataClassification** | Data classification level     | id, name        | level: public\|internal\|confidential\|secret, protectionRequirements |

**Social Security Mechanisms:**

| Type                 | Description                        | Required Fields | Key Properties                                        |
| -------------------- | ---------------------------------- | --------------- | ----------------------------------------------------- |
| **Delegation**       | Permission/goal delegation         | id, name        | delegator, delegatee, delegatedPermission, conditions |
| **SeparationOfDuty** | Different actors for related tasks | id, name        | tasks, minimumActors, enforcement                     |
| **BindingOfDuty**    | Same actor for related tasks       | id, name        | tasks, enforcement                                    |
| **NeedToKnow**       | Access based on objective needs    | id, name        | actor, information, requiredForObjective              |
| **SocialDependency** | Social relationship for security   | id, name        | depender, dependee, type: trust\|authorization        |

**Threats & Countermeasures:**

| Type                    | Description                  | Required Fields | Key Properties                                                              |
| ----------------------- | ---------------------------- | --------------- | --------------------------------------------------------------------------- |
| **Threat**              | Security threat              | id, name        | targets, severity: low\|medium\|high\|critical, likelihood, countermeasures |
| **Countermeasure**      | Security countermeasure      | id, name        | mitigates, type: preventive\|detective\|corrective, effectiveness           |
| **SecurityConstraints** | Security-related constraints | id, name        | constrains, type: integrity\|confidentiality\|availability                  |

**Accountability & Compliance:**

| Type                          | Description              | Required Fields | Key Properties                                                  |
| ----------------------------- | ------------------------ | --------------- | --------------------------------------------------------------- |
| **AccountabilityRequirement** | Non-repudiation & audit  | id, name        | type: non-repudiation\|audit-trail, appliesTo, evidenceRequired |
| **Evidence**                  | Proof for accountability | id, name        | type: signature\|timestamp\|log\|witness, format                |

**Common Properties:**

```yaml
# Role-Based Access Control Example
security.role.order-manager:
  id: security.role.order-manager
  name: "Order Manager"
  description: "Manages customer orders"
  properties:
    permissions:
      - security.permission.read-orders
      - security.permission.update-order-status
      - security.permission.refund-order
    inheritsFrom: [security.role.customer-service]
    assignedActors:
      - security.actor.operations-team

security.permission.update-order-status:
  id: security.permission.update-order-status
  name: "Update Order Status"
  properties:
    scope: write
    resource: security.resource.order
    action: update-status
    conditions:
      - security.condition.valid-status-transition

# Security Policy Example
security.policy.authenticated-access:
  id: security.policy.authenticated-access
  name: "Authenticated Access Policy"
  description: "Requires authentication for all API endpoints"
  properties:
    appliesTo:
      - application.service.order-api
      - application.service.payment-api
    enforcement: strict
    rules:
      - security.rule.require-jwt-token
      - security.rule.validate-token-expiry
      - security.rule.enforce-rate-limiting

# STS-ml Social Mechanism Example
security.separation-of-duty.financial-approval:
  id: security.separation-of-duty.financial-approval
  name: "Financial Approval Separation"
  description: "Refunds require approval from different person"
  properties:
    tasks:
      - business.process.initiate-refund
      - business.process.approve-refund
    minimumActors: 2
    enforcement: strict

security.delegation.vacation-coverage:
  id: security.delegation.vacation-coverage
  name: "Vacation Coverage Delegation"
  properties:
    delegator: security.actor.order-manager-alice
    delegatee: security.actor.order-manager-bob
    delegatedPermission: security.permission.approve-large-orders
    conditions:
      - startDate: 2025-12-01
      - endDate: 2025-12-15

# Threat & Countermeasure Example
security.threat.order-tampering:
  id: security.threat.order-tampering
  name: "Order Tampering"
  description: "Unauthorized modification of order details"
  properties:
    targets: [datastore.table.orders]
    severity: high
    likelihood: medium
    countermeasures:
      - security.countermeasure.field-access-control
      - security.countermeasure.audit-logging
      - security.countermeasure.digital-signatures

# Data Classification Example
security.data-classification.customer-pii:
  id: security.data-classification.customer-pii
  name: "Customer PII"
  properties:
    level: confidential
    protectionRequirements:
      - encryption-at-rest
      - encryption-in-transit
      - access-logging
      - data-masking
    appliesTo:
      - data_model.schema.customer
      - datastore.table.customers
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

Complete OpenAPI 3.0.3 specification for REST APIs.

**API Structure:**

| Type            | Description                | Required Fields | Key Properties                                                     |
| --------------- | -------------------------- | --------------- | ------------------------------------------------------------------ |
| **Info**        | API metadata               | id, name        | title, version, description, contact, license, termsOfService      |
| **Server**      | API server configuration   | id, name        | url, description, variables                                        |
| **PathItem**    | API path with operations   | id, path        | get, post, put, patch, delete, parameters, servers                 |
| **Operation**   | Single API operation       | id, name        | operationId, summary, parameters, requestBody, responses, security |
| **Parameter**   | Request parameter          | id, name        | in: path\|query\|header\|cookie, schema, required, deprecated      |
| **RequestBody** | Request body specification | id, name        | content, required, description                                     |
| **Response**    | Operation response         | id, name        | statusCode, description, content, headers, links                   |
| **MediaType**   | Content type specification | contentType     | schema, examples, encoding                                         |

**Reusable Components:**

| Type               | Description                         | Required Fields | Key Properties                                                 |
| ------------------ | ----------------------------------- | --------------- | -------------------------------------------------------------- |
| **Components**     | Reusable component collection       | id, name        | schemas, responses, parameters, requestBodies, securitySchemes |
| **SecurityScheme** | Authentication/authorization scheme | id, name        | type: apiKey\|http\|oauth2\|openIdConnect, scheme, flows       |
| **OAuth2Flows**    | OAuth2 flow configurations          | id, name        | implicit, authorizationCode, clientCredentials, password       |
| **Callback**       | Asynchronous callback operation     | id, name        | expression, pathItem                                           |
| **Link**           | Link between operations             | id, name        | operationRef, operationId, parameters                          |
| **Example**        | Example value                       | id, name        | summary, description, value, externalValue                     |
| **Header**         | Response header                     | id, name        | schema, required, deprecated                                   |
| **Tag**            | Operation grouping tag              | id, name        | name, description, externalDocs                                |
| **ExternalDocs**   | External documentation reference    | url             | description                                                    |

**Common Properties:**

```yaml
api.info.order-api:
  id: api.info.order-api
  name: "Order API Info"
  properties:
    title: "Order Management API"
    version: "2.1.0"
    description: "REST API for managing customer orders"
    contact:
      name: "API Support"
      email: "api-support@example.com"
      url: "https://support.example.com"
    license:
      name: "Apache 2.0"
      url: "https://www.apache.org/licenses/LICENSE-2.0.html"

api.server.production:
  id: api.server.production
  name: "Production Server"
  properties:
    url: "https://api.example.com/v1"
    description: "Production API server"
    variables:
      version:
        default: v1
        enum: [v1, v2]
        description: "API version"

api.path-item.orders:
  id: api.path-item.orders
  name: "/orders"
  properties:
    path: "/orders"
    get: api.operation.list-orders
    post: api.operation.create-order
    parameters:
      - api.parameter.page
      - api.parameter.limit

api.operation.create-order:
  id: api.operation.create-order
  name: "Create Order"
  properties:
    path: "/api/v1/orders"
    method: POST
    operationId: createOrder
    summary: "Create a new order"
    description: "Creates a new customer order with validation"
    tags: [orders]
    securedBy:
      - api.security-scheme.bearer-auth: []
    applicationServiceRef: application.service.order-api
    parameters:
      - api.parameter.idempotency-key
    requestBody:
      description: "Order creation request"
      required: true
      content:
        "application/json":
          schema: data_model.object-schema.order-create-request
          examples:
            standard-order: api.example.standard-order
    responses:
      "201":
        description: "Order created successfully"
        content:
          "application/json":
            schema: data_model.object-schema.order
        headers:
          Location: api.header.location
          X-Request-Id: api.header.request-id
      "400":
        description: "Invalid request"
        content:
          "application/json":
            schema: data_model.object-schema.error
      "401":
        description: "Unauthorized"
        content:
          "application/json":
            schema: data_model.object-schema.error
      "429":
        description: "Rate limit exceeded"
        content:
          "application/json":
            schema: data_model.object-schema.error

api.parameter.idempotency-key:
  id: api.parameter.idempotency-key
  name: "Idempotency-Key"
  properties:
    in: header
    required: false
    schema:
      type: string
      format: uuid
    description: "Unique key for idempotent requests"

api.security-scheme.bearer-auth:
  id: api.security-scheme.bearer-auth
  name: "Bearer Authentication"
  properties:
    type: http
    scheme: bearer
    bearerFormat: JWT
    description: "JWT bearer token authentication"

api.security-scheme.oauth2:
  id: api.security-scheme.oauth2
  name: "OAuth2 Authentication"
  properties:
    type: oauth2
    flows:
      authorizationCode:
        authorizationUrl: "https://auth.example.com/oauth/authorize"
        tokenUrl: "https://auth.example.com/oauth/token"
        scopes:
          "orders:read": "Read orders"
          "orders:write": "Create and update orders"
          "orders:delete": "Delete orders"

api.components.order-api:
  id: api.components.order-api
  name: "Order API Components"
  properties:
    schemas:
      - data_model.object-schema.order
      - data_model.object-schema.order-create-request
      - data_model.object-schema.error
    responses:
      - api.response.not-found
      - api.response.unauthorized
    parameters:
      - api.parameter.page
      - api.parameter.limit
    securitySchemes:
      - api.security-scheme.bearer-auth
      - api.security-scheme.oauth2
```

### Layer 07: Data Model (JSON Schema Draft 7)

Complete JSON Schema Draft 7 with custom extensions for cross-layer integration.

**Core Schema Types:**

| Type              | Description                                      | Required Fields | Key Properties                                                     |
| ----------------- | ------------------------------------------------ | --------------- | ------------------------------------------------------------------ |
| **ObjectSchema**  | Defines object structure and required properties | id, name        | properties, required, additionalProperties, patternProperties      |
| **ArraySchema**   | Defines array items and constraints              | id, name        | items, minItems, maxItems, uniqueItems, contains                   |
| **StringSchema**  | String validation (length, pattern, format)      | id, name        | minLength, maxLength, pattern, format: email\|uuid\|date-time\|uri |
| **NumericSchema** | Number validation (min, max, multipleOf)         | id, name        | minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf   |
| **BooleanSchema** | Boolean type definition                          | id, name        | const, default                                                     |
| **NullSchema**    | Null type definition                             | id, name        | const                                                              |

**Schema Composition:**

| Type                  | Description                                 | Required Fields | Key Properties                            |
| --------------------- | ------------------------------------------- | --------------- | ----------------------------------------- |
| **SchemaComposition** | Combines schemas (allOf, anyOf, oneOf, not) | id, name        | allOf, anyOf, oneOf, not, discriminator   |
| **Reference**         | Links to other schemas ($ref)               | $ref            | $ref: "#/definitions/..." or external URL |

**Validation & Metadata:**

| Type                  | Description                           | Required Fields | Key Properties                  |
| --------------------- | ------------------------------------- | --------------- | ------------------------------- |
| **EnumSchema**        | Enumerated values                     | id, name        | enum, enumNames (display names) |
| **ConstSchema**       | Single constant value                 | id, name        | const                           |
| **ConditionalSchema** | Conditional validation (if/then/else) | id, name        | if, then, else                  |

**Custom Extensions (x-\*):**

| Extension                      | Description             | Example                                    |
| ------------------------------ | ----------------------- | ------------------------------------------ |
| **x-database**                 | Database mapping        | `table: orders, column: order_id`          |
| **x-ui**                       | UI rendering hints      | `widget: date-picker, label: "Order Date"` |
| **x-security**                 | Security annotations    | `classification: confidential, pii: true`  |
| **x-apm-data-quality-metrics** | Data quality monitoring | `[completeness, accuracy, freshness]`      |

**Common Properties:**

```yaml
# ObjectSchema Example
data_model.object-schema.order:
  id: data_model.object-schema.order
  name: "Order"
  description: "Customer order entity"
  properties:
    type: object
    required: [id, customer_id, items, total, status]
    properties:
      id:
        type: string
        format: uuid
        x-database: { table: orders, column: id, pk: true }
      customer_id:
        type: string
        format: uuid
        x-database: { table: orders, column: customer_id, fk: customers.id }
      items:
        type: array
        items: { $ref: "#/definitions/OrderItem" }
        minItems: 1
      total:
        type: number
        minimum: 0
        multipleOf: 0.01
        x-ui: { widget: currency, format: "$0,0.00" }
      status:
        type: string
        enum: [pending, confirmed, shipped, delivered, cancelled]
        x-ui: { widget: select, label: "Order Status" }
    additionalProperties: false
    x-security:
      classification: internal
      pii: false
    x-apm-data-quality-metrics:
      - apm.data-quality-metric.order-completeness
      - apm.data-quality-metric.order-accuracy
    usedBy:
      - api.operation.create-order
      - api.operation.get-order
    stored-in: datastore.table.orders

# StringSchema Example with Validation
data_model.string-schema.email:
  id: data_model.string-schema.email
  name: "Email Address"
  properties:
    type: string
    format: email
    minLength: 5
    maxLength: 255
    pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
    x-ui: { widget: email-input, placeholder: "user@example.com" }
    x-security: { pii: true, classification: confidential }

# ArraySchema Example
data_model.array-schema.order-items:
  id: data_model.array-schema.order-items
  name: "Order Items"
  properties:
    type: array
    items: { $ref: "#/definitions/OrderItem" }
    minItems: 1
    maxItems: 100
    uniqueItems: false
    x-database: { table: order_items, fk: order_id }

# SchemaComposition Example (allOf)
data_model.composition.premium-customer:
  id: data_model.composition.premium-customer
  name: "Premium Customer"
  description: "Customer with premium features"
  properties:
    allOf:
      - $ref: "#/definitions/Customer"
      - type: object
        properties:
          premiumTier: { type: string, enum: [gold, platinum, diamond] }
          lifetimeValue: { type: number, minimum: 10000 }
        required: [premiumTier, lifetimeValue]

# ConditionalSchema Example (if/then/else)
data_model.conditional.shipping-address:
  id: data_model.conditional.shipping-address
  name: "Shipping Address"
  properties:
    type: object
    properties:
      country: { type: string }
      state: { type: string }
      zipCode: { type: string }
    if:
      properties:
        country: { const: "USA" }
    then:
      properties:
        state: { type: string, minLength: 2, maxLength: 2 }
        zipCode: { type: string, pattern: "^\\d{5}(-\\d{4})?$" }
      required: [state, zipCode]
    else:
      properties:
        state: { type: string }
        zipCode: { type: string }
```

### Layer 08: Datastore (Custom)

Physical database structures and storage mechanisms.

| Type               | Description                                 | Required Fields | Key Properties                                                        |
| ------------------ | ------------------------------------------- | --------------- | --------------------------------------------------------------------- |
| **Database**       | Database instance                           | id, name        | type: postgres\|mysql\|mongodb\|etc, version, stores                  |
| **DatabaseSchema** | Database schema (namespace within database) | id, name        | database, tables, views                                               |
| **Table**          | Database table                              | id, name        | stores, columns, indexes, constraints                                 |
| **Column**         | Table column                                | id, name        | type, nullable, default, references                                   |
| **Index**          | Database index                              | id, name        | table, columns, unique, type: btree\|hash\|gin                        |
| **Constraint**     | Data constraint                             | id, name        | type: pk\|fk\|unique\|check, definition                               |
| **View**           | Database view (virtual table)               | id, name        | query, baseTables, materialized                                       |
| **Trigger**        | Database trigger                            | id, name        | table, event: INSERT\|UPDATE\|DELETE, timing: BEFORE\|AFTER, function |
| **Partition**      | Table partition                             | id, name        | table, strategy: range\|list\|hash, key                               |
| **Sequence**       | Database sequence                           | id, name        | start, increment, usedBy                                              |

_Note: "DatabaseSchema" distinguishes from JSON Schema in data_model layer. "Trigger" is used instead of "Procedure"._

**Common Properties:**

```yaml
datastore.database.main-db:
  id: datastore.database.main-db
  name: "Main Database"
  description: "Primary PostgreSQL database"
  properties:
    type: postgres
    version: "15.3"
    host: db.example.com
    port: 5432
    stores:
      - data_model.schema.order
      - data_model.schema.customer
      - data_model.schema.product

datastore.database-schema.public:
  id: datastore.database-schema.public
  name: "public"
  description: "Default public schema"
  properties:
    database: datastore.database.main-db
    tables:
      - datastore.table.orders
      - datastore.table.customers
      - datastore.table.products

datastore.table.orders:
  id: datastore.table.orders
  name: "orders"
  description: "Stores customer orders"
  properties:
    stores: data_model.object-schema.order
    database: datastore.database.main-db
    schema: datastore.database-schema.public
    columns:
      - datastore.column.orders-id
      - datastore.column.orders-customer-id
      - datastore.column.orders-total
      - datastore.column.orders-status
      - datastore.column.orders-created-at
    indexes:
      - datastore.index.idx-orders-customer
      - datastore.index.idx-orders-status
    constraints:
      - datastore.constraint.orders-pk
      - datastore.constraint.orders-customer-fk
    triggers:
      - datastore.trigger.orders-audit

datastore.column.orders-customer-id:
  id: datastore.column.orders-customer-id
  name: "customer_id"
  properties:
    table: datastore.table.orders
    type: uuid
    nullable: false
    references:
      table: datastore.table.customers
      column: datastore.column.customers-id
      onDelete: CASCADE

datastore.index.idx-orders-customer:
  id: datastore.index.idx-orders-customer
  name: "idx_orders_customer"
  properties:
    table: datastore.table.orders
    columns: [customer_id]
    type: btree
    unique: false

datastore.constraint.orders-customer-fk:
  id: datastore.constraint.orders-customer-fk
  name: "orders_customer_fk"
  properties:
    type: fk
    table: datastore.table.orders
    columns: [customer_id]
    referencesTable: datastore.table.customers
    referencesColumns: [id]
    onDelete: CASCADE
    onUpdate: RESTRICT

datastore.trigger.orders-audit:
  id: datastore.trigger.orders-audit
  name: "orders_audit_trigger"
  description: "Audit trail for order changes"
  properties:
    table: datastore.table.orders
    event: UPDATE
    timing: AFTER
    function: audit_order_changes()
    enabled: true

datastore.view.customer-orders-summary:
  id: datastore.view.customer-orders-summary
  name: "customer_orders_summary"
  properties:
    baseTables:
      - datastore.table.orders
      - datastore.table.customers
    query: |
      SELECT c.id, c.name, COUNT(o.id) as order_count, SUM(o.total) as lifetime_value
      FROM customers c
      LEFT JOIN orders o ON c.id = o.customer_id
      GROUP BY c.id, c.name
    materialized: false
```

### Layer 09: UX (Custom)

| Type                  | Description                                                       | Required Fields | Key Properties                                                          |
| --------------------- | ----------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------- |
| **View**              | Routable screen/page with components                              | id, name        | route, layout: LayoutStyle, calls, displays, components, accessibility  |
| **SubView**           | Reusable grouping of components within a view                     | id, name        | components, props, usedInViews                                          |
| **Component**         | Atomic UI element (form-field, table, chart, card, etc.)          | id, name        | type, props, validators, dataBindings                                   |
| **ActionComponent**   | Interactive element (button, menu-item, link, voice-command)      | id, name        | type, trigger, action, confirmation, successTransition, errorTransition |
| **ValidationRule**    | Client-side validation rule                                       | id, name        | type: required\|minLength\|maxLength\|pattern\|email\|custom, params    |
| **ExperienceState**   | Distinct state the experience can be in                           | id, name        | scope: global\|view\|component, onEnter, onExit, allowedTransitions     |
| **StateAction**       | Action executed during state lifecycle                            | id, name        | trigger: onEnter\|onExit, type: fetchData\|saveData\|validateForm, etc. |
| **StateTransition**   | Transition between states                                         | id, name        | from, to, trigger: success\|failure\|submit\|cancel, guard              |
| **LayoutStyle**       | Layout configuration for a view (property, not standalone entity) | -               | type: single-column\|two-column\|dashboard\|master-detail, responsive   |
| **Theme**             | Visual styling                                                    | id, name        | colors, fonts, spacing, breakpoints                                     |
| **AccessibilitySpec** | A11y requirements                                                 | id, name        | wcag-level: A\|AA\|AAA, requirements, ariaLabels                        |
| **LocalizationSpec**  | i18n configuration                                                | id, name        | supportedLocales, defaultLocale, translationKeys                        |
| **ResponsiveConfig**  | Responsive behavior configuration                                 | id, name        | breakpoints, layoutChanges, componentVisibility                         |

_Note: Layout is a property of View (LayoutStyle config), not a standalone entity type._

**Common Properties:**

```yaml
ux.view.order-history:
  id: ux.view.order-history
  name: "Order History"
  description: "Customer order history view"
  properties:
    route: navigation.route.order-history
    layout:
      type: dashboard
      responsive: true
      regions: [header, filters, content, pagination]
    calls:
      - api.operation.list-orders
      - api.operation.get-order-details
    displays: [data_model.schema.order]
    components:
      - ux.component.order-list
      - ux.component.order-filters
      - ux.component.pagination
    state: ux.state.order-history-loaded
    accessibility: ux.accessibility.wcag-aa

ux.experience-state.order-history-loaded:
  id: ux.experience-state.order-history-loaded
  name: "Order History Loaded"
  properties:
    scope: view
    onEnter:
      - ux.state-action.fetch-order-history
      - ux.state-action.initialize-filters
    allowedTransitions:
      - ux.state.order-history-loading
      - ux.state.order-detail-view
```

### Layer 10: Navigation (Custom - Multi-Modal)

Supports visual (URL), voice (intent), chat (event), SMS (keyword), and API (operation) navigation modes.

| Type                     | Description                                | Required Fields | Key Properties                                                                |
| ------------------------ | ------------------------------------------ | --------------- | ----------------------------------------------------------------------------- |
| **Route**                | Destination in any modality                | id, name        | url, intent, event, keyword, operation, rendersView, guards                   |
| **NavigationTransition** | Transition between routes                  | id, name        | from, to, trigger, dataMapping, compensationRoute                             |
| **NavigationGuard**      | Access control for routes                  | id, name        | type: authentication\|authorization\|validation\|data-loaded, validationRules |
| **NavigationFlow**       | Sequence of routes realizing process       | id, name        | steps, realizesProcess, startRoute, errorHandling                             |
| **FlowStep**             | One step in navigation flow                | id, name        | route, order, requiredData, compensation                                      |
| **ContextVariable**      | Shared variable across flow steps          | id, name        | scope: flow\|session\|user, type, defaultValue                                |
| **DataMapping**          | Maps data between routes/steps             | id, name        | sourceRoute, targetRoute, mappingRules                                        |
| **ProcessTracking**      | Links navigation to business process steps | id, name        | navigationFlow, businessProcess, stepMappings                                 |
| **FlowAnalytics**        | Analytics for navigation flows             | id, name        | flow, metrics: completion-rate\|drop-off\|time, instruments                   |
| **NotificationAction**   | Triggered notification during flow         | id, name        | trigger, type: email\|sms\|push\|webhook, template, recipients                |

**Common Properties:**

```yaml
navigation.route.order-history:
  id: navigation.route.order-history
  name: "Order History Route"
  properties:
    # Multi-modal support
    url: "/app/orders/history" # Visual (web/mobile)
    intent: "show order history" # Voice
    event: "order_history_requested" # Chat
    keyword: "ORDERS" # SMS

    # Route configuration
    rendersView: ux.view.order-history
    guards:
      - navigation.guard.authenticated
      - navigation.guard.customer-role
    params: []
    meta:
      title: "Order History"
      requiresAuth: true

navigation.flow.checkout-flow:
  id: navigation.flow.checkout-flow
  name: "Checkout Flow"
  description: "Multi-step checkout process"
  properties:
    realizesProcess: business.process.order-checkout
    steps:
      - navigation.step.cart-review
      - navigation.step.shipping-info
      - navigation.step.payment
      - navigation.step.confirmation
    errorHandling:
      compensation: navigation.route.cart
      notification: navigation.notification.checkout-failed
```

### Layer 11: APM/Observability (OpenTelemetry 1.0+)

Full OpenTelemetry specification for distributed tracing, logging, and metrics.

**Tracing Types:**

| Type           | Description                             | Required Fields | Key Properties                                                                         |
| -------------- | --------------------------------------- | --------------- | -------------------------------------------------------------------------------------- |
| **Span**       | Unit of work in distributed trace       | id, name        | spanKind: INTERNAL\|SERVER\|CLIENT\|PRODUCER\|CONSUMER, startTime, endTime, attributes |
| **SpanEvent**  | Timestamped event during span execution | id, name        | timestamp, attributes, attachedToSpan                                                  |
| **SpanLink**   | Link between spans (causality)          | id, name        | sourceSpan, targetSpan, attributes                                                     |
| **SpanStatus** | Status of span execution                | -               | code: UNSET\|OK\|ERROR, message                                                        |

**Logging Types:**

| Type          | Description             | Required Fields | Key Properties                                            |
| ------------- | ----------------------- | --------------- | --------------------------------------------------------- |
| **LogRecord** | OpenTelemetry log entry | id, name        | timestamp, severityNumber, severityText, body, attributes |

**Resource & Context Types:**

| Type                     | Description                           | Required Fields | Key Properties                  |
| ------------------------ | ------------------------------------- | --------------- | ------------------------------- |
| **Resource**             | Describes source of telemetry         | id, name        | attributes: service.name, etc.  |
| **InstrumentationScope** | Identifies instrumentation library    | id, name        | name, version, schemaUrl        |
| **Attribute**            | Key-value pair for telemetry metadata | key, value      | type: string\|int\|double\|bool |

**Configuration Types:**

| Type                    | Description                       | Required Fields | Key Properties                               |
| ----------------------- | --------------------------------- | --------------- | -------------------------------------------- |
| **APMConfiguration**    | Top-level APM configuration       | id, name        | tracing, logging, metrics, resource          |
| **TraceConfiguration**  | Distributed tracing configuration | id, name        | serviceName, sampler, propagators, exporters |
| **LogConfiguration**    | Logging configuration             | id, name        | serviceName, logLevel, processors, exporters |
| **MetricConfiguration** | Metrics collection configuration  | id, name        | serviceName, readers, exporters, meters      |

**Metrics Types:**

| Type                 | Description         | Required Fields | Key Properties                                                    |
| -------------------- | ------------------- | --------------- | ----------------------------------------------------------------- |
| **MeterConfig**      | Meter configuration | id, name        | name, version, instruments                                        |
| **InstrumentConfig** | Metric instrument   | id, name        | type: counter\|updowncounter\|gauge\|histogram, unit, description |

**Data Quality Types:**

| Type                   | Description                    | Required Fields | Key Properties                                                                        |
| ---------------------- | ------------------------------ | --------------- | ------------------------------------------------------------------------------------- |
| **DataQualityMetrics** | Collection of DQ metrics       | id, name        | appliesTo: data_model element, metrics                                                |
| **DataQualityMetric**  | Individual data quality metric | id, name        | type: completeness\|accuracy\|consistency\|timeliness\|validity\|freshness, threshold |

_Note: "Alert" and "Dashboard" are NOT entity types in the OpenTelemetry schema. Use external tools or custom extensions._

**Common Properties:**

```yaml
# Distributed Tracing Example
apm.span.order-api-request:
  id: apm.span.order-api-request
  name: "POST /api/v1/orders"
  properties:
    spanKind: SERVER
    startTime: 1634567890123
    endTime: 1634567890456
    duration: 333 # milliseconds
    attributes:
      http.method: POST
      http.route: "/api/v1/orders"
      http.status_code: 201
    events:
      - apm.span-event.validation-completed
      - apm.span-event.database-write
    status:
      code: OK
    resource: apm.resource.order-service

# Logging Example
apm.log-record.order-created:
  id: apm.log-record.order-created
  name: "Order Created"
  properties:
    timestamp: 1634567890456
    severityNumber: 9 # INFO
    severityText: "INFO"
    body: "Order created successfully"
    attributes:
      order.id: "123e4567-e89b-12d3-a456-426614174000"
      customer.id: "customer-789"
    resource: apm.resource.order-service

# Metrics Example
apm.instrument-config.order-api-latency:
  id: apm.instrument-config.order-api-latency
  name: "Order API Latency"
  description: "Histogram of order API response times"
  properties:
    type: histogram
    unit: milliseconds
    buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000]
    instruments: [application.service.order-api]
    meter: apm.meter.order-service

# Data Quality Example
apm.data-quality-metric.order-completeness:
  id: apm.data-quality-metric.order-completeness
  name: "Order Data Completeness"
  properties:
    type: completeness
    appliesTo: data_model.schema.order
    threshold: 0.95 # 95% completeness required
    checkFields: [customer_id, items, total, status]
    alertOn: below-threshold
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
