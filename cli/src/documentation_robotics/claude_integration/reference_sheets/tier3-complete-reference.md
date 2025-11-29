# Documentation Robotics - Complete Reference

_Comprehensive reference for all layers, entity types, and advanced features._

## Table of Contents

1. [Available Agents](#available-agents-v040)
2. [Complete Entity Type Catalog](#complete-entity-type-catalog)
3. [Advanced CLI Commands](#advanced-cli-commands)
4. [Projection Rules Reference](#projection-rules-reference)
5. [Validation Rules](#validation-rules)
6. [Export Formats](#export-formats)
7. [Troubleshooting](#troubleshooting)

---

## Available Agents (v0.4.0+)

Documentation Robotics provides specialized agents for different workflows. Each agent has deep expertise in its domain and can work autonomously or with guidance.

### dr-helper - Expert Guidance & Education

**Agent Type:** `dr-helper`
**Autonomy:** Low (advisory, explains and guides)
**Purpose:** Expert companion for understanding and working with DR

**Capabilities:**

- Explains DR philosophy, concepts, and principles
- Guides modeling decisions ("How do I model microservices?")
- Helps navigate CLI commands and workflows
- Assists with upgrades, migrations, and maintenance
- Teaches cross-layer links and validation
- Shares best practices and anti-patterns
- Adapts explanations to user's expertise level

**When to use:**

- New to DR and learning concepts
- Making architectural/modeling decisions
- Understanding how to map your system to DR
- Need workflow guidance (changesets, validation, links)
- Troubleshooting issues
- Want to understand the "why" behind recommendations

**Example questions:**

- "What is Documentation Robotics and why use it?"
- "How do I model microservices in DR?"
- "Should I use a changeset for this?"
- "How do I upgrade from v0.1.x to v0.2.0?"
- "What are cross-layer links?"
- "Where does my React component go?"

**Launch:** Task tool, agent type: `dr-helper`

---

### dr-ideator - Collaborative Architectural Exploration

**Agent Type:** `dr-ideator`
**Autonomy:** Medium (asks questions, proposes, executes with guidance)
**Purpose:** Explore architectural ideas safely in changesets with research-driven approach

**Capabilities:**

- Changeset orchestration (creates, manages, merges, abandons)
- Multi-changeset awareness (tracks which is active, what's in each)
- Socratic questioning (probing questions to clarify goals)
- Technology research (WebSearch for frameworks, patterns, best practices)
- Dependency analysis (Context-7 for library/framework details)
- Model exploration (helps model ideas across all 11 layers)
- Comparative analysis (compares multiple approaches side-by-side)
- Impact assessment (analyzes implications of decisions)
- Merge guidance (knows when ideas are ready vs should be abandoned)

**When to use:**

- Exploring "what if" scenarios ("What if we use GraphQL instead of REST?")
- Evaluating technology choices (MongoDB vs PostgreSQL, React vs Vue)
- Comparing architectural patterns (microservices vs modular monolith)
- Researching unfamiliar technologies before committing
- Want to model multiple approaches and compare
- Need guidance on whether to merge or abandon an exploration
- Managing multiple concurrent explorations

**Key characteristics:**

- **Question-driven**: Asks clarifying questions before making assumptions
- **Research-oriented**: Uses WebSearch and Context-7 to inform decisions
- **Changeset-first**: ALWAYS works in changesets, never modifies main directly
- **Collaborative**: Models WITH you, not FOR you
- **Thorough**: Validates incrementally, researches deeply
- **Honest**: Says "I don't know, let me research" rather than guessing

**Example scenarios:**

- "Should we migrate to microservices?" → Creates exploration changeset, asks about scale/team/pain points, researches patterns, models approach, compares with current
- "GraphQL vs REST for our API?" → Creates two changesets, models each, researches pros/cons, compares impact, guides decision
- "Should we upgrade to Next.js 14?" → Uses Context-7 for migration docs, analyzes breaking changes, models impact, recommends timing

**Workflow:**

1. Understanding (20%) - Ask questions, check context
2. Research (30%) - WebSearch, Context-7 for libraries
3. Modeling (30%) - Collaborative modeling in changeset
4. Evaluation (15%) - Compare, analyze, validate
5. Decision (5%) - Guide merge/keep/abandon choice

**Launch:** Task tool, agent type: `dr-ideator`

---

### dr-extractor - Model Extraction from Code

**Agent Type:** `dr-extractor`
**Autonomy:** High (makes element creation decisions)
**Purpose:** Extract DR model from existing codebase

**When to use:** Code extraction, re-ingestion

**Launch:** Task tool, agent type: `dr-extractor`

---

### dr-validator - Validation & Intelligent Fixing

**Agent Type:** `dr-validator`
**Autonomy:** Medium (suggests fixes, applies with confirmation)
**Purpose:** Validate model and fix issues

**When to use:** Validation, error fixing, quality improvement

**Launch:** Task tool, agent type: `dr-validator`

---

### dr-documenter - Documentation Generation

**Agent Type:** `dr-documenter`
**Autonomy:** High (generates complete documentation)
**Purpose:** Create comprehensive architecture documentation

**When to use:** Documentation generation, diagrams, matrices

**Launch:** Task tool, agent type: `dr-documenter`

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

### Layer 12: Testing (Custom)

Custom specification for test coverage modeling and requirements traceability. Models **what should be tested** (coverage space) rather than concrete test instances.

**Coverage Planning Types:**

| Type                      | Description                               | Required Fields | Key Properties                                                                                            |
| ------------------------- | ----------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| **coverage-target**       | Artifact that requires test coverage      | id, name        | targetType: workflow\|form\|api-operation\|navigation-path, priority: critical\|high\|medium\|low         |
| **input-space-partition** | Partitioning of input dimension           | id, name        | fieldRef, presenceRule: required\|optional\|conditional, partitions: PartitionValue[]                     |
| **context-variation**     | Different contexts for same functionality | id, name        | contextType: ui-entry\|api-entry\|event-triggered\|scheduled\|integration, entryPointRef, securityRoleRef |
| **coverage-requirement**  | Coverage requirement for target           | id, name        | targetRef, coverageCriteria: exhaustive\|pairwise\|boundary\|risk-based\|each-choice, priority            |
| **test-case-sketch**      | Abstract test case specification          | id, name        | status: planned\|implemented\|automated\|manual\|blocked, implementationRef, implementationFormat         |

**Nested Types:**

| Type                        | Description                     | Key Properties                                                             |
| --------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| **TargetInputField**        | Input field for coverage target | fieldRef, partitionRef, relevance: primary\|secondary\|contextual          |
| **PartitionValue**          | Specific partition value        | id, label, constraint, category: typical\|boundary\|invalid\|null\|special |
| **OutcomeCategory**         | Expected outcome category       | id, outcomeType: success\|validation-error\|authorization-denied\|error    |
| **InputPartitionSelection** | Partition values to cover       | partitionRef, coverValues[], excludeValues[]                               |
| **CoverageExclusion**       | Explicit coverage exclusion     | description, reason, riskAccepted                                          |
| **InputSelection**          | Specific value for test case    | partitionRef, selectedValue                                                |
| **EnvironmentFactor**       | Environmental condition         | factor, value, description                                                 |

**Integration Points:**

```yaml
# Cross-layer references
coverage-target:
  businessProcessRef: business.process.{id}           # Link to Business Layer
  formRef: ux.form.{id}                               # Link to UX Layer
  apiOperationRef: api.operation.{id}                 # Link to API Layer
  navigationRouteRef: navigation.route.{id}           # Link to Navigation Layer

context-variation:
  actorRef: security.actor.{id}                       # Link to Security Layer
  securityRoleRef: security.role.{id}                 # Link to Security Layer

coverage-requirement:
  requirementRefs: [motivation.requirement.{id}]      # Link to Motivation Layer
  riskAssessmentRef: motivation.assessment.{id}       # Link to Motivation Layer

input-space-partition:
  dataModelFieldRef: data_model.attribute.{id}        # Link to Data Model
  formFieldRef: ux.field.{id}                         # Link to UX Layer
  apiParameterRef: api.parameter.{id}                 # Link to API Layer
```

**Common Properties:**

```yaml
# Coverage Target Example (Workflow)
testing.coverage-target.order-creation:
  id: testing.coverage-target.order-creation
  name: "Order Creation Coverage"
  description: "Test coverage for end-to-end order creation"
  properties:
    targetType: workflow
    priority: critical
    targetRef: "business://process/create-order"
    businessProcessRef: business.process.create-order
    applicableContexts:
      - testing.context-variation.customer-ui
      - testing.context-variation.admin-ui
      - testing.context-variation.api
    inputFields:
      - fieldRef: "order.lineItems"
        partitionRef: testing.input-space-partition.line-items-count
        relevance: primary
      - fieldRef: "order.shippingAddress"
        partitionRef: testing.input-space-partition.shipping-address
        relevance: primary
    outcomeCategories:
      - id: "success"
        outcomeType: success
        httpStatusRange: "201"
      - id: "validation-error"
        outcomeType: validation-error
        httpStatusRange: "400"

# Input Space Partition Example (Value Range)
testing.input-space-partition.line-items-count:
  id: testing.input-space-partition.line-items-count
  name: "Line Items Count Partition"
  description: "Partitioning of order line item count"
  properties:
    fieldRef: "order.lineItems"
    presenceRule: required
    dataModelFieldRef: data_model.attribute.order-line-items
    partitions:
      - id: "single"
        label: "Single Item"
        constraint: "length = 1"
        category: typical
        representativeValue: [{"sku": "ABC123", "qty": 1}]
      - id: "multiple"
        label: "Multiple Items (2-10)"
        constraint: "length in [2, 10]"
        category: typical
      - id: "boundary-max"
        label: "Maximum Items"
        constraint: "length = 100"
        category: boundary
      - id: "empty"
        label: "No Items"
        constraint: "length = 0"
        category: invalid

# Context Variation Example (UI Entry)
testing.context-variation.customer-ui:
  id: testing.context-variation.customer-ui
  name: "Customer Self-Service UI"
  description: "Customer entering orders through web portal"
  properties:
    contextType: ui-entry
    entryPointRef: "navigation://customer-portal#new-order"
    actorRef: security.actor.customer
    securityRoleRef: security.role.customer
    preconditions:
      - "user is authenticated"
      - "user has active account"
    environmentFactors:
      - factor: "user-experience-level"
        value: "novice"
        description: "First-time order placement"

# Coverage Requirement Example (Pairwise)
testing.coverage-requirement.order-pairwise:
  id: testing.coverage-requirement.order-pairwise
  name: "Order Creation Pairwise Coverage"
  description: "Cover all pairs of input partition values"
  properties:
    coverageCriteria: pairwise
    priority: critical
    targetRef: testing.coverage-target.order-creation
    requirementRefs:
      - motivation.requirement.order-validation
      - motivation.requirement.multi-channel-support
    inputPartitionSelections:
      - partitionRef: testing.input-space-partition.line-items-count
        coverValues: ["single", "multiple", "boundary-max"]
      - partitionRef: testing.input-space-partition.shipping-address
        coverValues: ["present", "absent"]
      - partitionRef: testing.input-space-partition.payment-method
        coverValues: ["credit-card", "invoice", "prepaid"]
    contextSelections:
      - testing.context-variation.customer-ui
      - testing.context-variation.api
    outcomeSelections:
      - "success"
      - "validation-error"

# Test Case Sketch Example (Automated)
testing.test-case-sketch.order-single-item-customer:
  id: testing.test-case-sketch.order-single-item-customer
  name: "Customer creates single-item order"
  description: "Happy path: customer orders one item with shipping"
  properties:
    status: automated
    coverageReqRef: testing.coverage-requirement.order-pairwise
    inputSelections:
      - partitionRef: testing.input-space-partition.line-items-count
        selectedValue: "single"
      - partitionRef: testing.input-space-partition.shipping-address
        selectedValue: "present"
      - partitionRef: testing.input-space-partition.payment-method
        selectedValue: "credit-card"
    contextSelection: testing.context-variation.customer-ui
    expectedOutcome: "success"
    implementationRef: "gherkin://features/orders.feature#customer-single-item"
    implementationFormat: gherkin
    notes: "Validates end-to-end flow with payment gateway integration"

# CLI Examples
# Add coverage target for a workflow
dr add testing coverage-target \
  --name "Order Creation Coverage" \
  --set targetType=workflow \
  --set businessProcessRef=business.process.create-order

# Add input space partition
dr add testing input-space-partition \
  --name "Line Items Count" \
  --set fieldRef=order.lineItems \
  --set presenceRule=required

# Add context variation
dr add testing context-variation \
  --name "Customer UI Context" \
  --set contextType=ui-entry \
  --set securityRoleRef=security.role.customer

# List all test coverage targets
dr list testing coverage-target

# Find coverage for specific business process
dr search --layer testing --property businessProcessRef=business.process.create-order
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
dr search "API" --output json
dr search "API" --output yaml
dr search "API" --output table
```

### Projection Options

```bash
# Project single element
dr project business.service.orders --to application

# Project with rules file
dr project business.service.orders --to application --rule custom-rules.yaml

# Project all matching elements
dr project-all --from business --to application

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
dr trace business.service.orders --max-depth 3

# Output as graph
dr trace business.service.orders --output tree
```

### Export Options

```bash
# Export specific layer
dr export --format archimate --layer business

# Export with filter
dr export --format markdown --filter "type=service"

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

# Output validation report
dr validate --output json > validation-report.json
```

### Changeset Management

**Changesets** provide isolated workspaces for architecture changes, similar to Git branches. They enable safe experimentation, incremental feature development, and collaborative design exploration.

#### Core Concepts

**Changeset Types:**

- `feature` - New functionality or capabilities
- `bugfix` - Corrections to existing elements
- `exploration` - Speculative designs and experiments

**Changeset Lifecycle:**

1. **active** - Currently being worked on
2. **applied** - Merged to main model (historical record)
3. **abandoned** - Discarded changes (kept for reference)

**Change Operations:**

- `add` - New elements created
- `update` - Existing elements modified
- `delete` - Elements removed

#### Basic Commands

```bash
# Create new changeset
dr changeset create "feature-name" \
  --type feature \
  --description "Add payment processing"

# Create without auto-activating
dr changeset create "experiment" --type exploration --no-activate

# List all changesets
dr changeset list
dr changeset list --status active     # Filter by status
dr changeset list --json              # JSON output

# Check current status
dr changeset status                   # Active changeset
dr changeset status changeset-id      # Specific changeset
dr changeset status --verbose         # Detailed view

# Switch between changesets
dr changeset switch changeset-id      # Activate different changeset
dr changeset clear --yes              # Return to main model

# Apply changeset to main
dr changeset apply --preview          # Preview changes
dr changeset apply --yes              # Apply to main model
dr changeset apply changeset-id --yes # Apply specific changeset

# Discard changes
dr changeset abandon changeset-id --yes    # Mark as abandoned
dr changeset delete changeset-id --yes     # Permanent deletion
```

#### Advanced Operations

```bash
# Compare changesets
dr changeset diff                     # Current vs main
dr changeset diff changeset-a changeset-b  # Compare two changesets
dr changeset diff --json              # JSON output for parsing

# Query and statistics
dr changeset list --status applied    # History of applied changesets
dr changeset list --status abandoned  # Discarded work

# Changeset summary
dr changeset status changeset-id
# Shows:
# - Metadata (name, type, created date)
# - Change counts (added, updated, deleted)
# - Affected layers
# - Recent change history
```

#### Working in Changeset Context

**All commands work transparently in changeset context:**

```bash
# Activate changeset
dr changeset create "new-api-layer"

# Standard commands work normally - changes tracked in changeset
dr add api operation --name "Create Order" \
  --property method=POST \
  --property path=/orders

dr update api.operation.create-order \
  --set authenticated=true

dr list api operation
# Shows both main model + changeset elements

# Return to main model
dr changeset clear --yes
```

**Automatic change tracking:**

- All `dr add` operations tracked as "add" changes
- All `dr update` operations tracked as "update" changes with before/after snapshots
- All `dr remove` operations tracked as "delete" changes with element backup
- Changes persist across sessions (saved to `.dr/changesets/`)

#### Python API

```python
from documentation_robotics.core import Model
from documentation_robotics.core.changeset_manager import ChangesetManager
from documentation_robotics.core.changeset import Change

# Initialize manager
manager = ChangesetManager("./")

# Create changeset
changeset_id = manager.create(
    name="feature-api-redesign",
    changeset_type="feature",
    description="Redesign REST API structure",
    set_active=True
)

# Load model in changeset context
model = Model.load("./", changeset=changeset_id)

# Make changes - automatically tracked
element = {
    "id": "api.operation.get-orders",
    "name": "Get Orders",
    "properties": {"method": "GET", "path": "/orders"}
}
model.add_element("api", element)

# Changes isolated to changeset
main_model = Model.load("./")  # No changeset param
# Won't see api.operation.get-orders

# Query changeset
changeset = manager.load_changeset(changeset_id)
print(f"Changes: {changeset.get_element_count()}")
print(f"Affected layers: {changeset.get_affected_layers()}")

# Get detailed change list
for change in changeset.get_changes():
    print(f"{change.operation}: {change.element_id}")

# Compare changesets
diff = manager.diff_changesets(changeset_id, None)  # None = main
if diff['has_conflicts']:
    print("Conflicts detected!")
    for conflict in diff['modified_in_both']:
        print(f"  {conflict['element_id']}")

# Apply to main model (programmatic)
main_model = Model.load("./")
for change in changeset.get_changes():
    if change.operation == "add":
        main_model.add_element(change.layer, change.data)
    elif change.operation == "update":
        main_model.update_element(change.element_id, change.after)
    elif change.operation == "delete":
        main_model.remove_element(change.element_id)
main_model.save()

# Update status
manager.update_changeset_status(changeset_id, "applied")
```

#### Use Cases

**1. Feature Development**

```bash
# Start feature work
dr changeset create "feature-payment-gateway"

# Incrementally build feature
dr add business service --name "Payment Processing"
dr add application service --name "Payment Gateway"
dr add api operation --name "Process Payment"

# Review and refine
dr changeset status --verbose
dr validate

# Apply when ready
dr changeset apply --yes
```

**2. Speculative Design**

```bash
# Explore alternative approaches
dr changeset create "explore-microservices" --type exploration

# Try microservices approach
dr add application service --name "Order Service"
dr add application service --name "Payment Service"
dr add application service --name "Inventory Service"

# Compare with current monolith
dr changeset diff

# Decide: apply or abandon
dr changeset abandon explore-microservices --yes  # Not adopting
```

**3. Parallel Development**

```bash
# Feature A team
dr changeset create "feature-a"
# ... work on feature A ...

# Feature B team
dr changeset switch feature-b  # Or create new
# ... work on feature B ...

# Compare approaches
dr changeset diff feature-a feature-b

# Apply both in sequence
dr changeset apply feature-a --yes
dr changeset apply feature-b --yes
```

**4. Safe Experimentation**

```bash
# Try potentially breaking change
dr changeset create "experiment-api-v2"

# Make aggressive changes
dr remove api.path.legacy-endpoint
dr add api.path.new-endpoint

# Validate impact
dr validate
dr trace api.path.legacy-endpoint --direction downstream

# If problems found
dr changeset abandon experiment-api-v2 --yes  # No harm done
```

#### Best Practices

**When to use changesets:**

- ✓ Building new features incrementally
- ✓ Exploring design alternatives
- ✓ Making experimental changes
- ✓ Working on multiple features in parallel
- ✓ Collaborative design sessions
- ✓ Large refactoring efforts
- ✓ Extracting models from external sources

**When NOT to use changesets:**

- ✗ Simple, obvious corrections
- ✗ Fixing typos
- ✗ Single, atomic changes
- ✗ Emergency hotfixes (unless review needed)

**Workflow recommendations:**

1. **Create descriptive names**: `feature-oauth-integration` not `test1`
2. **One feature per changeset**: Focused, reviewable changes
3. **Review before applying**: Use `--preview` and `diff`
4. **Validate before applying**: Catch issues early
5. **Keep changesets short-lived**: Apply or abandon promptly
6. **Document in description**: Explain intent and context
7. **Clean up regularly**: Delete applied/abandoned changesets

**Integration with version control:**

- Changesets are **separate from Git**
- Complement Git with architecture-specific versioning
- Commit applied changesets to Git for team sharing
- Use `.gitignore` to exclude active exploration changesets

#### File Structure

```
project-root/
└── .dr/
    └── changesets/
        ├── active                    # Current active changeset ID
        ├── registry.yaml             # Changeset metadata registry
        └── feature-payment-2024-01-15-001/
            ├── metadata.yaml         # Changeset info
            ├── changes.yaml          # Change log
            └── elements/             # Changeset-specific elements (optional)
```

**Registry format:**

```yaml
version: "1.0"
changesets:
  feature-payment-2024-01-15-001:
    name: "Payment Gateway"
    status: active
    type: feature
    created_at: "2024-01-15T10:30:00Z"
    elements_count: 5
```

**Metadata format:**

```yaml
id: feature-payment-2024-01-15-001
name: "Payment Gateway"
description: "Add Stripe payment gateway integration"
type: feature
status: active
workflow: direct-cli
created_at: "2024-01-15T10:30:00Z"
updated_at: "2024-01-15T11:45:00Z"
summary:
  elements_added: 3
  elements_updated: 1
  elements_deleted: 0
```

**Changes log format:**

```yaml
- timestamp: "2024-01-15T10:31:00Z"
  operation: add
  element_id: business.service.payment-processing
  layer: business
  element_type: service
  data:
    name: "Payment Processing"
    description: "Handles payment transactions"

- timestamp: "2024-01-15T10:35:00Z"
  operation: update
  element_id: application.service.order-management
  layer: application
  element_type: service
  before:
    dependencies: []
  after:
    dependencies: [business.service.payment-processing]
```

#### Troubleshooting

**Issue: Changes not tracked**

```bash
# Verify active changeset
cat .dr/changesets/active

# If empty, create or activate changeset
dr changeset create "my-feature"
```

**Issue: Can't apply changeset**

```bash
# Check for validation errors
dr validate

# Check for conflicts
dr changeset diff

# Resolve conflicts manually, then reapply
```

**Issue: Lost changeset**

```bash
# List all changesets (including abandoned)
dr changeset list

# Changeset files location
ls -la .dr/changesets/

# Restore from backup if needed
```

**Issue: Changeset merge conflicts**

```bash
# View conflicting changes
dr changeset diff

# Options:
# 1. Apply anyway (overwrites main)
dr changeset apply --yes

# 2. Manually resolve in changeset
dr changeset switch conflicting-changeset
# Edit elements to resolve
dr changeset apply --yes

# 3. Abandon conflicting changeset
dr changeset abandon changeset-id --yes
```

---

## Cross-Layer Link Management

Complete reference for managing and validating cross-layer references in your Documentation Robotics models (spec v0.2.0+, CLI v0.4.0+).

### Overview

Cross-layer links connect elements across the 11 architectural layers, enabling traceability from strategic goals to implementation details. The link management system provides:

- **Link Registry**: Machine-readable catalog of 62+ standardized cross-layer reference patterns
- **Link Discovery**: Automatic detection and analysis of link instances in models
- **Link Validation**: Comprehensive checking of references, types, cardinality, and formats
- **Link Navigation**: Query and trace paths between elements through the link graph
- **Link Documentation**: Auto-generate comprehensive link catalogs and diagrams
- **Migration Tools**: Upgrade from v0.1.x organic patterns to standardized v0.2.0 patterns

### Link Pattern Types

The specification uses four distinct reference patterns, each optimized for different contexts:

#### Pattern A: X-Extensions (OpenAPI/JSON Schema)

**Format:** `x-{target-layer}-{type}-ref` or `x-archimate-ref`

**Used in:** External standard specifications (OpenAPI 3.0, JSON Schema Draft 7)

**Rationale:** Follows OpenAPI extension conventions (`x-` prefix), doesn't conflict with standard fields

**Examples:**

```yaml
# OpenAPI Operation (Layer 06)
api.operation.create-order:
  path: /api/v1/orders
  method: POST
  operationId: createOrder
  # Cross-layer links via x-extensions
  x-archimate-ref: application.service.order-api
  x-business-service-ref: business.service.order-management
  x-supports-goals: [motivation.goal.improve-revenue]
  x-required-permissions: [security.permission.create-order]
  x-apm-sla-target-latency: 200ms
  x-apm-business-metrics: [apm.metric.order-creation-rate]

# JSON Schema (Layer 07)
data_model.object-schema.customer:
  type: object
  properties:
    customer_id:
      type: string
      format: uuid
      x-archimate-ref: business.actor.customer
      x-security:
        classification: confidential
        pii: true
        governed-by: [security.policy.gdpr-compliance]
```

#### Pattern B: Dot-Notation Properties (Upward References)

**Format:** `{target-layer}.{relationship-type}`

**Used in:** Implementation layers referencing strategic/higher layers

**Rationale:** Clear namespace separation, maintains separation of concerns

**Examples:**

```yaml
# Application Service (Layer 04)
application.service.order-api:
  name: "Order Management API"
  properties:
    realizes: business.service.order-management # Horizontal reference

    # Upward references to motivation layer
    motivation:
      supports-goals: [motivation.goal.improve-revenue, motivation.goal.reduce-costs]
      governed-by-principles:
        [motivation.principle.api-first, motivation.principle.security-by-design]
      fulfills-requirements:
        [motivation.requirement.order-tracking, motivation.requirement.real-time-status]
      constrained-by: [motivation.constraint.budget-limit]

    # Cross-cutting concerns
    security:
      resourceRef: security.resource.order-api
      requiredRoles: [security.role.order-manager]
      requiredPermissions: [security.permission.manage-orders]

    apm:
      business-metrics: [apm.metric.order-processing-time, apm.metric.order-success-rate]
      sla-target-latency: 200ms
      sla-target-availability: 99.9%
      traced: true

# Business Service (Layer 02)
business.service.customer-management:
  name: "Customer Management"
  properties:
    # Upward to motivation
    motivation:
      supports-goals: [motivation.goal.customer-satisfaction]
      delivers-value: [motivation.value.personalization]
      governed-by-principles: [motivation.principle.customer-centric]
```

#### Pattern C: Nested Objects (Complex Relationships)

**Format:** `{target-layer}: { field1, field2, ... }`

**Used in:** Multiple related references need grouping OR channel-specific overrides

**Rationale:** Groups related references, reduces top-level clutter, allows for additional metadata

**Examples:**

```yaml
# Navigation Route (Layer 10)
navigation.route.order-history:
  name: "Order History Route"
  properties:
    # Multi-modal routing
    url: /app/orders/history # Visual (web/mobile)
    intent: show order history # Voice
    event: order_history_requested # Chat
    keyword: ORDERS # SMS

    # Grouped motivation alignment
    motivationAlignment:
      supportsGoals: [motivation.goal.customer-satisfaction]
      deliversValue: [motivation.value.transparency]
      governedByPrinciples: [motivation.principle.user-centric]
      fulfillsRequirements: [motivation.requirement.order-visibility]

    # Grouped business alignment
    business:
      supportsProcesses: [business.process.order-inquiry]
      realizesServices: [business.service.customer-self-service]
      targetActors: [business.actor.customer]

    # Grouped security context
    security:
      resourceRef: security.resource.order-data
      requiredRoles: [security.role.customer]
      requiredPermissions: [security.permission.view-own-orders]
      enforcesRequirement: motivation.requirement.secure-access

    # Grouped API integration
    api:
      operationId: listOrders
      method: GET
      endpoint: /api/v1/orders

    # View and experience
    rendersView: ux.view.order-history
    experience: ux.experience.customer-portal
```

#### Pattern D: Direct Field Names (Standard References)

**Format:** Standard field name from the spec

**Used in:** Native specification features (like OpenAPI's `operationId`, JSON Schema's `$ref`)

**Rationale:** Leverages existing standards, no need to reinvent

**Examples:**

```yaml
# OpenAPI Operation (Layer 06)
api.operation.create-order:
  operationId: createOrder # Native OpenAPI field (direct reference)
  path: /api/v1/orders
  method: POST

# JSON Schema (Layer 07)
data_model.object-schema.order-item:
  type: object
  properties:
    items:
      $ref: "#/definitions/OrderItem" # Native JSON Schema $ref

# UX Component (Layer 09)
ux.component.order-form:
  type: form
  properties:
    schemaRef: data_model.object-schema.order-create-request # Direct field
    validationRules: [ux.validation.required-fields]

# Navigation Route (Layer 10)
navigation.route.checkout:
  url: /checkout
  properties:
    experience: ux.experience.checkout-flow # Direct field
    rendersView: ux.view.checkout
```

### Naming Conventions

#### General Rules

1. **Kebab-case for relationships**: `supports-goals`, `realizes-services`, `governed-by-principles`
2. **camelCase for nested object keys**: `motivationAlignment`, `businessAlignment`, `securityContext`
3. **Suffix ID references**: Use `Ref` or `Id` suffix for explicit ID references
   - `businessActorRef` - Reference to a BusinessActor element
   - `dataModelSchemaId` - JSON Schema $id value (not file path)
4. **Plural for arrays**: `supportsGoals` (array), `realizesServices` (array), `requiredPermissions` (array)
5. **Singular for single refs**: `securityModel` (single string), `dataSchemaRef` (single path)

#### Layer Prefixes

Consistent prefixes in property names:

- `motivation.*` - Motivation Layer (Goals, Requirements, Principles, Constraints, Values, Outcomes)
- `business.*` - Business Layer (Actors, Processes, Services, Functions, Objects)
- `security.*` - Security Layer (Models, Resources, Roles, Permissions, Policies, Threats)
- `api.*` - API Layer (Operations, Endpoints, Schemas, Security Schemes)
- `apm.*` - APM/Observability Layer (Metrics, Traces, Logs, SLAs, Data Quality)
- `application.*` - Application Layer (Components, Services, Interfaces)

### Link Registry Commands

#### List Link Types

Query available link types before creating cross-layer references:

```bash
# List all 62+ link types
dr links types

# Filter by category
dr links types --category motivation     # To/from motivation layer
dr links types --category business       # To/from business layer
dr links types --category security       # Security-related links
dr links types --category application    # Application layer links
dr links types --category api            # API layer links
dr links types --category data           # Data model links
dr links types --category ux             # UX layer links
dr links types --category navigation     # Navigation layer links
dr links types --category apm            # APM/observability links

# JSON output for programmatic use
dr links types --format json
```

**Example output:**

```
╭─ Link Types ─────────────────────────────────────────────────────────────╮
│ Showing 3 link type(s): API Layer → Application Layer                   │
╰──────────────────────────────────────────────────────────────────────────╯

📋 application-service-ref
   Category: api
   Source: API Layer (06) → Target: Application Layer (04)
   Field: x-archimate-ref (Pattern: x-extensions)
   Cardinality: Single (one application service per operation)
   Format: UUID (element ID format)
   Description: Links OpenAPI operation to the ApplicationService that implements it
   Example:
     x-archimate-ref: application.service.order-api

📋 supports-goals
   Category: motivation
   Source: API Layer (06) → Target: Motivation Layer (01)
   Field: x-supports-goals (Pattern: x-extensions)
   Cardinality: Array (multiple goals)
   Format: UUID (element ID format)
   Description: Links API operation to business goals it supports
   Example:
     x-supports-goals: [motivation.goal.improve-revenue, motivation.goal.reduce-costs]
```

#### Display Complete Registry

View or export the complete link registry:

```bash
# Display as table
dr links registry

# Export as JSON
dr links registry --format json > link-registry.json

# Export as Markdown
dr links registry --format markdown > link-registry.md
```

#### Get Link Statistics

View statistics about the link registry and model:

```bash
# Get comprehensive stats
dr links stats

```

**Example output:**

```
╭─ Link Registry Statistics ───────────────────────────────────────────────╮
│                                                                           │
│ Total Link Types: 62                                                     │
│ Categories: 9 (motivation, business, security, application,              │
│                api, data, ux, navigation, apm)                           │
│ Pattern Types: 4 (x-extensions, dot-notation, nested, direct)            │
│                                                                           │
╰───────────────────────────────────────────────────────────────────────────╯

╭─ Model Link Statistics ──────────────────────────────────────────────────╮
│                                                                           │
│ Total Link Instances: 147                                                │
│ Broken Links: 0                                                          │
│ Layers With Links: 9/11                                                  │
│ Average Links per Element: 3.8                                           │
│                                                                           │
╰───────────────────────────────────────────────────────────────────────────╯

Top Connected Layers:
┌────────────────┬───────────┬────────────┐
│ Layer          │ Links     │ Percentage │
├────────────────┼───────────┼────────────┤
│ Application    │ 48        │ 32.7%      │
│ Business       │ 32        │ 21.8%      │
│ API            │ 28        │ 19.0%      │
│ Navigation     │ 18        │ 12.2%      │
│ Security       │ 12        │ 8.2%       │
│ UX             │ 9         │ 6.1%       │
└────────────────┴───────────┴────────────┘

Most Used Link Types:
┌─────────────────────────────┬───────────┐
│ Link Type                   │ Instances │
├─────────────────────────────┼───────────┤
│ motivation.supports-goals   │ 34        │
│ realizes                    │ 22        │
│ x-archimate-ref             │ 18        │
│ motivation.fulfills-requirements │ 14   │
│ security.requiredPermissions│ 12        │
└─────────────────────────────┴───────────┘
```

### Link Discovery and Navigation

#### Find Links for Element

Discover all links (incoming and outgoing) for a specific element:

```bash
# Find all links for element
dr links find business.service.order-management

# JSON output
dr links find business.service.order-management --format json
```

**Example output:**

```
╭─ Links for business.service.order-management ────────────────────────────╮
│                                                                           │
│ Outgoing Links (5):                                                      │
│ → motivation.goal.improve-revenue (via motivation.supports-goals)        │
│ → motivation.goal.reduce-costs (via motivation.supports-goals)           │
│ → motivation.principle.api-first (via motivation.governed-by-principles) │
│ → business.actor.operations-team (via owner)                             │
│ → apm.metric.order-processing-time (via apm.business-metrics)            │
│                                                                           │
│ Incoming Links (4):                                                      │
│ ← application.service.order-api (via realizes)                           │
│ ← application.service.order-worker (via realizes)                        │
│ ← navigation.flow.order-fulfillment (via realizesProcess)                │
│ ← api.operation.create-order (via x-business-service-ref)                │
│                                                                           │
│ Total: 9 links                                                           │
│                                                                           │
╰───────────────────────────────────────────────────────────────────────────╯
```

#### List All Link Instances

Query all link instances in the model:

```bash
# List all links
dr links list

# Filter by link type
dr links list --type motivation.supports-goals
dr links list --type realizes

# Filter by source layer
dr links list --layer application
dr links list --layer api

# Export as JSON
dr links list --format json > links.json
```

**Example output:**

```
╭─ Link Instances in Model ────────────────────────────────────────────────╮
│ Showing 34 instances of 'motivation.supports-goals'                      │
╰───────────────────────────────────────────────────────────────────────────╯

Source Element                            Target Element
────────────────────────────────────────  ─────────────────────────────────
business.service.order-management      → motivation.goal.improve-revenue
business.service.payment-processing    → motivation.goal.improve-revenue
business.service.customer-support      → motivation.goal.customer-satisfaction
application.service.checkout-api       → motivation.goal.improve-ux
application.service.search-service     → motivation.goal.fast-discovery
... (29 more)
```

#### Trace Paths Between Elements

Find connectivity paths through the link graph:

```bash
# Find shortest path
dr links trace api.operation.create-order motivation.goal.improve-revenue

# Custom depth limit
dr links trace api.operation.create-order motivation.goal.improve-revenue \
  --max-hops 3
```

**Example output:**

```
╭─ Tracing Paths ──────────────────────────────────────────────────────────╮
│ From: api.operation.create-order                                         │
│ To: motivation.goal.improve-revenue                                      │
│ Found: 3 path(s)                                                         │
╰───────────────────────────────────────────────────────────────────────────╯

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

Path 3 (4 hops):
  api.operation.create-order
    → data_model.object-schema.order (via requestBody.schema)
    → datastore.table.orders (via stored-in)
    → business.object.order (via represents)
    → motivation.goal.improve-revenue (via motivation.supports-goals)

Insights:
✓ Strong traceability: 3 independent paths to goal
✓ Multi-layer coverage: API → Application → Business → Motivation
✓ Data flow traced: API → Schema → Datastore → Business
```

### Link Validation

Comprehensive validation of all cross-layer references.

#### Basic Link Validation

```bash
# Validate all links in model
dr validate --validate-links

# Strict mode (warnings become errors)
dr validate --validate-links --strict-links

# Validate specific layer
dr validate --layer application --validate-links

# Validate in changeset context
dr changeset switch feature-new-api
dr validate --validate-links

# JSON output
dr validate --validate-links --output json > validation-report.json
```

#### Validation Checks

Link validation performs four categories of checks:

1. **Existence Check**: Verifies target elements exist in the model
2. **Type Compatibility Check**: Ensures targets are the correct element type
3. **Cardinality Check**: Validates single vs array values match definition
4. **Format Check**: Verifies UUID, path, duration, percentage formats

**Example validation output:**

```
╭─ Link Validation Results ────────────────────────────────────────────────╮
│ Total Links Validated: 147                                               │
│ Errors: 3                                                                │
│ Warnings: 2                                                              │
╰───────────────────────────────────────────────────────────────────────────╯

Errors (3):

❌ business.service.order-mgmt (02_business/services.yaml:15)
   motivation.supports-goals references non-existent element
   → Target: 'motivation.goal.missing-goal' (not found)
   Suggestion: Did you mean 'motivation.goal.improve-efficiency'?
   Fix: Create the goal or correct the reference

❌ api.operation.create-order (06_api/operations.yaml:42)
   x-archimate-ref has type mismatch
   → Expected: ApplicationService
   → Got: BusinessService ('business.service.orders')
   Fix: Reference application.service.order-api instead

❌ navigation.route.checkout (10_navigation/routes.yaml:28)
   experience field has cardinality mismatch
   → Expected: Single value
   → Got: Array [ux.view.cart, ux.view.payment]
   Fix: Use single value: experience: ux.view.checkout

Warnings (2):

⚠️  application.service.payment-api (04_application/services.yaml:67)
    Critical service missing motivation traceability
    → No links to motivation layer (supports-goals, fulfills-requirements)
    Recommendation: Add motivation.supports-goals for traceability

⚠️  api.operation.legacy-endpoint (06_api/operations.yaml:156)
    Uses deprecated link type 'x-deprecated-link'
    → Migrate to standard pattern
    Recommendation: Use 'x-archimate-ref' instead
```

#### Common Validation Errors and Fixes

**Error 1: Broken Reference (Target doesn't exist)**

```yaml
# ERROR
business.service.orders:
  motivation:
    supports-goals: [motivation.goal.missing]  # ❌ Target doesn't exist

# FIX Option 1: Create the target
dr add motivation goal --name "Missing Goal"

# FIX Option 2: Remove invalid reference
dr update business.service.orders --set motivation.supports-goals=

# FIX Option 3: Correct typo (get suggestions)
dr links types --category motivation  # See valid targets
```

**Error 2: Type Mismatch**

```yaml
# ERROR
api.operation.create-order:
  x-archimate-ref: business.service.orders  # ❌ Wrong type (BusinessService, not ApplicationService)

# FIX: Reference correct type
api.operation.create-order:
  x-archimate-ref: application.service.order-api  # ✓ Correct (ApplicationService)
```

**Error 3: Cardinality Error**

```yaml
# ERROR
business.service.orders:
  motivation:
    supports-goals: motivation.goal.revenue  # ❌ Single value, expects array

# FIX: Use array
business.service.orders:
  motivation:
    supports-goals: [motivation.goal.revenue]  # ✓ Array
```

**Error 4: Format Error**

```yaml
# ERROR
api.operation.create-order:
  x-archimate-ref: app-service-123  # ❌ Invalid format (not element ID)

# FIX: Use proper element ID
api.operation.create-order:
  x-archimate-ref: application.service.order-api  # ✓ Valid UUID format
```

### Link Documentation Generation

Generate comprehensive documentation for cross-layer links.

#### Generate Documentation

```bash
# Markdown summary (quick overview)
dr links docs --formats markdown --output-dir ./docs/

# Interactive HTML documentation
dr links docs --formats html --output-dir ./docs/

# Mermaid diagram (layer connectivity)
dr links docs --formats mermaid --output-dir ./docs/

# All formats
dr links docs --formats all --output-dir ./docs/
```

**Generated documentation includes:**

- Complete link type catalog (62 types)
- Link instances in your model
- Layer connectivity matrix
- Cross-layer traceability paths
- Usage examples for each pattern
- Validation status and issues
- Statistics and insights

### Migration from v0.1.x to v0.2.0

Upgrade existing models to standardized link patterns.

#### Migration Commands

```bash
# Check what migrations are needed (default)
dr migrate

# Preview changes (dry run)
dr migrate --dry-run

# Apply all migrations to latest version
dr migrate --apply

# Migrate to specific version
dr migrate --apply --to-version 0.2.0

# Validate migrated model
dr validate --validate-links
```

#### What Gets Migrated

**1. Naming Convention Fixes (camelCase → kebab-case)**

```yaml
# BEFORE (v0.1.x)
properties:
  supportGoals: [goal-1]              # ❌ camelCase
  realizesService: service-1          # ❌ camelCase
  governedByPrinciples: [principle-1] # ❌ camelCase

# AFTER (v0.2.0)
properties:
  supports-goals: [goal-1]            # ✓ kebab-case
  realizes-services: [service-1]       # ✓ kebab-case + plural
  governed-by-principles: [principle-1] # ✓ kebab-case
```

**2. Cardinality Fixes (Single → Array where needed)**

```yaml
# BEFORE (v0.1.x)
properties:
  supports-goals: motivation.goal.revenue  # ❌ Single value

# AFTER (v0.2.0)
properties:
  supports-goals: [motivation.goal.revenue]  # ✓ Array
```

**3. Format Corrections**

```yaml
# BEFORE (v0.1.x)
properties:
  x-archimate-ref: app-service-123    # ❌ Invalid format

# AFTER (v0.2.0)
properties:
  x-archimate-ref: application.service.order-api  # ✓ Valid element ID
```

#### Migration Workflow

```bash
# Step 1: Create migration branch
git checkout -b migrate-links-to-v0.2.0

# Step 2: Check what's needed
dr migrate

# Output shows:
# Current Model Version: 0.1.1
# Latest Available Version: 0.2.0
# 1 migration(s) needed

# Step 3: Preview changes
dr migrate --dry-run

# Output shows:
# Found 23 changes across 12 files:
# - 15 naming convention fixes
# - 6 cardinality fixes
# - 2 format corrections

# Step 4: Apply migration
dr migrate --apply

# Step 5: Validate result
dr validate --validate-links --strict-links

# Step 6: Review and commit
git diff
git add .
git commit -m "Migrate cross-layer links to v0.2.0 standards

- Fixed 15 naming convention issues
- Fixed 6 cardinality mismatches
- Fixed 2 format errors
- All links now valid per v0.2.0 spec"

git checkout main
git merge migrate-links-to-v0.2.0
```

### Python API for Link Management

Advanced programmatic link management.

```python
from documentation_robotics.core import Model
from documentation_robotics.validation.link_registry import LinkRegistry
from documentation_robotics.validation.link_analyzer import LinkAnalyzer
from documentation_robotics.validation.link_validator import LinkValidator
from documentation_robotics.validation.link_doc_generator import LinkDocGenerator

# Load model
model = Model.load("./")

# === LINK REGISTRY ===

# Load registry
registry = LinkRegistry()

# Query link types
all_types = registry.get_all_link_types()
print(f"Total link types: {len(all_types)}")

# Filter by category
motivation_types = registry.get_link_types(category="motivation")
security_types = registry.get_link_types(category="security")

# Filter by layers
api_to_app = registry.get_link_types(
    source_layer="api",
    target_layer="application"
)

# Get specific link type
link_type = registry.get_link_type("motivation.supports-goals")
print(f"Field: {link_type.field_path}")
print(f"Cardinality: {link_type.cardinality}")
print(f"Format: {link_type.format}")

# Export registry
registry_json = registry.export_json()
registry_markdown = registry.export_markdown()

# === LINK ANALYZER ===

# Create analyzer
analyzer = LinkAnalyzer(model, registry)

# Discover all links in model
links = analyzer.discover_all_links()
print(f"Found {len(links)} link instances")

# Build link graph
graph = analyzer.build_link_graph()
print(f"Graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges")

# Find element links
element_links = analyzer.get_element_links("business.service.orders")
print(f"Outgoing: {len(element_links.outgoing)}")
print(f"Incoming: {len(element_links.incoming)}")

# Find path between elements
path = analyzer.find_path(
    "api.operation.create-order",
    "motivation.goal.revenue"
)
if path:
    print(f"Path ({len(path)} hops): {' → '.join(path)}")

# Find all paths
all_paths = analyzer.find_all_paths(
    "api.operation.create-order",
    "motivation.goal.revenue",
    max_depth=5
)
print(f"Found {len(all_paths)} paths")

# Get orphaned elements (no links)
orphans = analyzer.find_orphaned_elements()
print(f"Orphaned elements: {len(orphans)}")

# Get link statistics
stats = analyzer.get_statistics()
print(f"Total links: {stats.total_links}")
print(f"Layers with links: {stats.layers_with_links}/{stats.total_layers}")
print(f"Avg links per element: {stats.avg_links_per_element:.2f}")

# === LINK VALIDATOR ===

# Create validator
validator = LinkValidator(model, registry)

# Validate all links
result = validator.validate_all()

print(f"Validated: {result.total_links} links")
print(f"Errors: {len(result.errors)}")
print(f"Warnings: {len(result.warnings)}")

# Process errors
for error in result.errors:
    print(f"\nError in {error.element_id}:")
    print(f"  {error.message}")
    if error.suggestion:
        print(f"  Suggestion: {error.suggestion}")
    print(f"  Link type: {error.link_type}")
    print(f"  File: {error.file_path}:{error.line_number}")

# Process warnings
for warning in result.warnings:
    print(f"\nWarning in {warning.element_id}:")
    print(f"  {warning.message}")

# Validate specific element
element_result = validator.validate_element("business.service.orders")

# Validate specific layer
layer_result = validator.validate_layer("application")

# Strict mode (warnings as errors)
strict_result = validator.validate_all(strict=True)

# === LINK DOCUMENTATION GENERATOR ===

# Create generator
doc_gen = LinkDocGenerator(model, registry, analyzer)

# Generate summary
summary_md = doc_gen.generate_summary_markdown()
with open("./docs/link-summary.md", "w") as f:
    f.write(summary_md)

# Generate detailed reference
reference_md = doc_gen.generate_detailed_reference_markdown()
with open("./docs/link-reference.md", "w") as f:
    f.write(reference_md)

# Generate Mermaid diagram
mermaid_diagram = doc_gen.generate_mermaid_diagram()
with open("./docs/link-diagram.mmd", "w") as f:
    f.write(mermaid_diagram)

# Generate HTML documentation
html_doc = doc_gen.generate_interactive_html()
with open("./docs/links.html", "w") as f:
    f.write(html_doc)
```

### Best Practices

#### 1. Query Before Creating

Always query available link types before creating references:

```bash
# Before adding a link, check what's available
dr links types --layer application

# This shows valid patterns, cardinality, and format
```

#### 2. Maintain Traceability

Ensure implementation elements trace to strategic goals:

```yaml
# Every critical service should link to motivation layer
application.service.payment-api:
  motivation:
    supports-goals: [motivation.goal.revenue, motivation.goal.security]
    fulfills-requirements: [motivation.requirement.pci-compliance]
```

#### 3. Validate Regularly

Run link validation frequently during development:

```bash
# During development
dr validate --validate-links

# Before committing
dr validate --validate-links --strict-links

# In CI/CD
dr validate --validate-links --strict-links --output json
```

#### 4. Use Strict Mode in CI/CD

Treat warnings as errors in automated pipelines:

```yaml
# .github/workflows/validate.yml
- name: Validate Links
  run: dr validate --validate-links --strict-links
```

#### 5. Document Connections

Generate link documentation for reviews:

```bash
# For architecture reviews
dr links docs --formats markdown --output-dir ./review/

# For diagrams in presentations
dr links docs --formats mermaid --output-dir ./diagrams/
```

#### 6. Monitor Link Health

Check link statistics regularly:

```bash
# Weekly health check
dr links stats

# Look for:
# - Broken links (should be 0)
# - Orphaned elements
# - Layers with low connectivity
```

#### 7. Follow Naming Conventions

Use standardized naming:

```yaml
# ✓ CORRECT
motivation:
  supports-goals: [goal-1, goal-2]       # kebab-case, plural
  governed-by-principles: [principle-1]  # kebab-case

# ❌ WRONG
motivation:
  supportGoals: [goal-1, goal-2]         # camelCase
  governedByPrinciple: principle-1        # camelCase, singular when should be array
```

#### 8. Choose Appropriate Patterns

Use the right pattern for the context:

- **X-Extensions**: OpenAPI operations, JSON Schema properties
- **Dot-Notation**: Upward references from implementation to strategy
- **Nested Objects**: Grouping related references, channel-specific overrides
- **Direct Fields**: Native spec fields like `operationId`, `$ref`

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
dr update business.service.orders --set supports-goals=
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
dr validate --element business.service.orders
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
