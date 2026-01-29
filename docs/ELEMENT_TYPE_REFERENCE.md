# Element Type Reference

This guide documents the element types available in Documentation Robotics and explains the naming conventions used across the 12-layer architecture model.

## Important: CLI Parameter vs Element ID Format

**When using the CLI**, element types use **lowercase** format:

```bash
dr add motivation goal customer-satisfaction
dr add business service order-management
dr add api endpoint create-order
```

**In generated element IDs and documentation**, element types use **lowercase** in the ID segment:

```
motivation.goal.customer-satisfaction
business.service.order-management
api.endpoint.create-order
```

**In formal documentation and specifications**, element types are referenced with **PascalCase** for clarity (e.g., `Goal`, `BusinessService`, `Endpoint`).

This reference uses PascalCase for formal names but provides the correct lowercase type names you'll use with the CLI.

## Overview

### Element ID Format

All elements in the Documentation Robotics model follow this naming convention:

```
{layer}.{elementType}.{kebab-case-name}
```

**Components:**

- **layer**: The layer abbreviation (e.g., `motivation`, `business`, `api`, `data-model`)
- **elementType**: The element type in lowercase (e.g., `goal`, `service`, `endpoint`) - this is what you pass to `dr add` commands
- **kebab-case-name**: A unique identifier for the element within the layer, using kebab-case

**Examples:**

- `motivation.goal.customer-satisfaction`
- `business.service.order-management`
- `api.endpoint.create-order`
- `data-model.entity.user-profile`

### Type Naming Conventions

#### Naming Format by Context

**In CLI commands and element IDs**, use **lowercase** format:

- ✅ CLI: `dr add motivation goal customer-satisfaction`
- ✅ ID: `motivation.goal.customer-satisfaction`
- ❌ CLI: `dr add motivation Goal customer-satisfaction`
- ❌ ID: `motivation.Goal.customer-satisfaction`

**In formal documentation and specifications**, types are referred to with **PascalCase**:

- ✅ Documentation: "The `Goal` element type"
- ✅ Schema references: `Goal`, `BusinessService`, `Endpoint`
- ℹ️ This reference uses PascalCase for clarity but shows lowercase equivalents for CLI usage

#### Layer-Specific Types

Some types include layer prefixes to clarify their scope:

- **Business Layer Types**: `BusinessActor`, `BusinessService`, `BusinessProcess`
- **Application Layer Types**: `ApplicationComponent`, `ApplicationService`, `ApplicationFunction`
- **Technology Layer Types**: `TechnologyService`, `Node`, `SystemSoftware`

Other types don't use layer prefixes because they're specific to one layer:

- **Motivation Types**: `Goal`, `Requirement`, `Constraint` (no prefix needed—only in motivation layer)
- **API Types**: `Endpoint`, `Parameter`, `Response` (only in API layer)
- **Data Model Types**: `Entity`, `Property`, `Relationship` (only in data model layer)

#### Generic Types Across Multiple Layers

Some types appear in multiple layers with consistent semantics:

- **Process**: Represents a sequence of activities
  - `BusinessProcess` (Layer 2)
  - `ApplicationProcess` (Layer 4)
  - `TechnologyProcess` (Layer 5)

- **Service**: Represents a cohesive unit of functionality
  - `BusinessService` (Layer 2)
  - `ApplicationService` (Layer 4)
  - `TechnologyService` (Layer 5)

- **Function**: Represents a specific capability
  - `BusinessFunction` (Layer 2)
  - `ApplicationFunction` (Layer 4)
  - `TechnologyFunction` (Layer 5)

---

## Layer-by-Layer Element Types

### Layer 1: Motivation

The Motivation layer captures business drivers, goals, and requirements using ArchiMate concepts.

| Type            | Description                                                   | Example                                                           |
| --------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Stakeholder** | Person, organization, or group interested in the architecture | `stakeholder-cto`, `stakeholder-finance-team`                     |
| **Driver**      | External or internal factors motivating change                | `driver-market-expansion`, `driver-cost-reduction`                |
| **Assessment**  | Evaluation of current state or risks                          | `assessment-security-posture`, `assessment-technical-debt`        |
| **Goal**        | Desired outcome the organization wants to achieve             | `goal-customer-satisfaction`, `goal-revenue-growth`               |
| **Outcome**     | Result of achieving a goal                                    | `outcome-reduced-churn`, `outcome-faster-deployments`             |
| **Principle**   | Fundamental rule governing how the organization operates      | `principle-api-first`, `principle-data-driven-decisions`          |
| **Requirement** | Specific need or constraint the system must satisfy           | `requirement-gdpr-compliance`, `requirement-sub-100ms-latency`    |
| **Constraint**  | Limitation or boundary on the solution                        | `constraint-legacy-mainframe-dependency`, `constraint-budget-cap` |
| **Meaning**     | Definition or interpretation of a concept                     | `meaning-customer-lifetime-value`, `meaning-system-reliability`   |
| **Value**       | Delivered benefit or worth                                    | `value-faster-time-to-market`, `value-improved-security`          |

**Relationships:**

- Goals can be refined into Outcomes
- Requirements can be derived from Goals
- Constraints limit what Principles can be applied

---

### Layer 2: Business

The Business layer defines business processes, services, and roles using ArchiMate concepts.

| Type                      | Description                                             | Example                                                        |
| ------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| **BusinessActor**         | Person or organization unit performing business actions | `actor-sales-team`, `actor-customer-service`                   |
| **BusinessRole**          | Role performed in a business context                    | `role-order-processor`, `role-product-manager`                 |
| **BusinessCollaboration** | Interaction between business actors                     | `collaboration-sales-and-fulfillment`                          |
| **BusinessInterface**     | Access point to a business service                      | `interface-order-portal`, `interface-customer-support`         |
| **BusinessProcess**       | Sequence of business activities                         | `process-order-fulfillment`, `process-customer-onboarding`     |
| **BusinessFunction**      | Specific capability in the business domain              | `function-payment-processing`, `function-inventory-management` |
| **BusinessInteraction**   | Communication between business elements                 | `interaction-order-notification`, `interaction-status-update`  |
| **BusinessEvent**         | Significant occurrence in a business process            | `event-order-placed`, `event-payment-failed`                   |
| **BusinessService**       | Cohesive unit of business functionality                 | `service-order-management`, `service-customer-support`         |
| **BusinessObject**        | Business entity or data element                         | `object-order`, `object-customer-account`                      |

**Relationships:**

- Processes are composed of Functions
- Services deliver business Interfaces
- Actors perform Roles in Processes

---

### Layer 3: Security

The Security layer defines security policies, threats, and controls.

| Type                        | Description                            | Example                                                        |
| --------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| **AuthenticationPolicy**    | Rules for verifying user identity      | `policy-mfa-required`, `policy-password-complexity`            |
| **AuthorizationPolicy**     | Rules for access control               | `policy-role-based-access`, `policy-data-classification`       |
| **CryptographyPolicy**      | Encryption and cryptographic standards | `policy-aes-256-for-data-at-rest`, `policy-tls-1-3-minimum`    |
| **ThreatModel**             | Identified security threat             | `threat-sql-injection`, `threat-data-breach`                   |
| **SecurityControl**         | Measure to mitigate security risks     | `control-input-validation`, `control-audit-logging`            |
| **ComplianceRequirement**   | Regulatory or standard requirement     | `requirement-gdpr-article-32`, `requirement-pci-dss-v3`        |
| **SecurityEvent**           | Significant security occurrence        | `event-failed-login-attempts`, `event-unauthorized-access`     |
| **VulnerabilityAssessment** | Evaluation of security weaknesses      | `assessment-penetration-test-q1`, `assessment-dependency-scan` |

**Relationships:**

- Policies control access to resources
- SecurityControls mitigate Threats
- ComplianceRequirements drive Policies

---

### Layer 4: Application

The Application layer defines application components, services, and interfaces using ArchiMate concepts.

| Type                         | Description                                    | Example                                                        |
| ---------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| **ApplicationComponent**     | Software module or subsystem                   | `component-order-service`, `component-auth-module`             |
| **ApplicationCollaboration** | Interaction between application components     | `collaboration-api-and-database`                               |
| **ApplicationService**       | Reusable application functionality             | `service-order-validation`, `service-user-authentication`      |
| **ApplicationInterface**     | Access point to an application service         | `interface-order-api`, `interface-user-management`             |
| **ApplicationFunction**      | Specific capability provided by an application | `function-create-order`, `function-send-email`                 |
| **ApplicationInteraction**   | Communication between application elements     | `interaction-service-to-service`, `interaction-component-call` |
| **ApplicationProcess**       | Sequence of application operations             | `process-order-creation`, `process-data-transformation`        |
| **ApplicationEvent**         | Significant application occurrence             | `event-order-submitted`, `event-error-occurred`                |
| **DataObject**               | Data structure used by applications            | `object-order-payload`, `object-customer-dto`                  |

**Relationships:**

- Components implement Services
- Services provide Interfaces
- DataObjects flow through Processes

---

### Layer 5: Technology

The Technology layer defines technology components, platforms, and infrastructure using ArchiMate concepts.

| Type                     | Description                         | Example                                                   |
| ------------------------ | ----------------------------------- | --------------------------------------------------------- |
| **Node**                 | Computing or network device         | `node-web-server`, `node-database-cluster`                |
| **CommunicationNetwork** | Network connecting nodes            | `network-internal-lan`, `network-cloud-backbone`          |
| **SystemSoftware**       | Operating system or system software | `software-linux-ubuntu-20`, `software-kubernetes-cluster` |
| **TechnologyService**    | Infrastructure service              | `service-load-balancing`, `service-message-queue`         |
| **Artifact**             | Deployable software component       | `artifact-api-container`, `artifact-database-image`       |
| **TechnologyInterface**  | Access point to technology services | `interface-rest-api-gateway`, `interface-message-broker`  |
| **TechnologyFunction**   | Specific technical capability       | `function-auto-scaling`, `function-failover`              |
| **TechnologyProcess**    | Sequence of technology operations   | `process-deployment-pipeline`, `process-backup-restore`   |
| **TechnologyEvent**      | Significant technology occurrence   | `event-server-failure`, `event-maintenance-window`        |

**Relationships:**

- Artifacts deploy to Nodes
- Services run on SystemSoftware
- CommunicationNetworks connect Nodes

---

### Layer 6: API

The API layer defines REST API operations and contracts using OpenAPI concepts.

| Type                | Description                      | Example                                                    |
| ------------------- | -------------------------------- | ---------------------------------------------------------- |
| **OpenAPIDocument** | Complete API specification       | `document-order-api-v1`, `document-user-service-api`       |
| **Info**            | Metadata about the API           | `info-version-1-0-0`, `info-contact-support`               |
| **Server**          | API endpoint location            | `server-production`, `server-staging`                      |
| **PathItem**        | URL path in the API              | `path-api-orders`, `path-api-users-userid`                 |
| **Operation**       | HTTP operation on a path         | `operation-post-create-order`, `operation-get-list-orders` |
| **Parameter**       | Query, path, or header parameter | `parameter-order-id`, `parameter-limit`                    |
| **RequestBody**     | Request payload specification    | `request-create-order-body`, `request-update-user-body`    |
| **Response**        | Response specification           | `response-200-order-created`, `response-400-invalid-input` |
| **Schema**          | Data structure schema            | `schema-order-object`, `schema-error-response`             |
| **SecurityScheme**  | Security requirement for API     | `security-api-key`, `security-oauth2-bearer`               |
| **Tag**             | Logical grouping of operations   | `tag-orders`, `tag-authentication`                         |

**Relationships:**

- Operations are defined on PathItems
- Operations accept RequestBodies and return Responses
- Operations may require SecuritySchemes

---

### Layer 7: Data Model

The Data Model layer defines entities, properties, and their relationships using JSON Schema concepts.

| Type                 | Description                      | Example                                                        |
| -------------------- | -------------------------------- | -------------------------------------------------------------- |
| **Entity**           | Business entity or domain object | `entity-customer`, `entity-product`                            |
| **Property**         | Attribute of an entity           | `property-customer-email`, `property-product-price`            |
| **Relationship**     | Connection between entities      | `relationship-customer-orders`, `relationship-product-reviews` |
| **JSONSchema**       | Schema definition                | `schema-customer-schema`, `schema-order-schema`                |
| **SchemaDefinition** | Detailed schema specification    | `definition-address-object`, `definition-error-details`        |
| **SchemaProperty**   | Property definition in schema    | `prop-name-string`, `prop-age-integer`                         |

**Relationships:**

- Entities have Properties
- Entities have Relationships to other Entities
- JSONSchemas validate Entities

---

### Layer 8: Data Store

The Data Store layer defines database schemas, tables, and columns.

| Type               | Description                  | Example                                                     |
| ------------------ | ---------------------------- | ----------------------------------------------------------- |
| **Database**       | Database instance or cluster | `database-production`, `database-analytics`                 |
| **DatabaseSchema** | Logical schema or namespace  | `schema-customer-data`, `schema-transactional`              |
| **Table**          | Database table               | `table-customers`, `table-orders`                           |
| **Column**         | Table column                 | `column-customer-id`, `column-email`                        |
| **Index**          | Database index               | `index-customer-email-idx`, `index-order-date-idx`          |
| **Constraint**     | Database constraint          | `constraint-customer-id-pk`, `constraint-order-customer-fk` |

**Relationships:**

- Tables belong to Schemas
- Columns belong to Tables
- Constraints enforce data integrity

---

### Layer 9: UX

The UX layer defines user interface components and screens.

| Type            | Description                   | Example                                                 |
| --------------- | ----------------------------- | ------------------------------------------------------- |
| **Screen**      | User interface screen or page | `screen-order-form`, `screen-dashboard`                 |
| **Component**   | Reusable UI component         | `component-button-primary`, `component-card-product`    |
| **Form**        | Data entry interface          | `form-order-checkout`, `form-customer-registration`     |
| **Navigation**  | Navigation structure          | `navigation-main-menu`, `navigation-breadcrumb`         |
| **Interaction** | User interaction element      | `interaction-submit-button`, `interaction-modal-dialog` |
| **Widget**      | Interactive UI element        | `widget-date-picker`, `widget-autocomplete`             |

**Relationships:**

- Screens are composed of Components
- Forms contain Interactions
- Navigation connects Screens

---

### Layer 10: Navigation

The Navigation layer defines application routing and navigation flows.

| Type               | Description                | Example                                                  |
| ------------------ | -------------------------- | -------------------------------------------------------- |
| **Route**          | Application URL route      | `route-orders-list`, `route-customer-detail`             |
| **RouteGroup**     | Logical grouping of routes | `group-admin-routes`, `group-auth-routes`                |
| **NavigationFlow** | User navigation path       | `flow-checkout-sequence`, `flow-login-flow`              |
| **Redirect**       | Route redirection rule     | `redirect-login-to-dashboard`, `redirect-old-url-to-new` |
| **Guard**          | Route access control       | `guard-admin-only`, `guard-authenticated-users`          |

**Relationships:**

- Routes map to Screens
- NavigationFlows connect Routes
- Guards protect Routes

---

### Layer 11: APM

The APM (Application Performance Monitoring) layer defines observability, metrics, and monitoring using OpenTelemetry concepts.

| Type                | Description                  | Example                                                   |
| ------------------- | ---------------------------- | --------------------------------------------------------- |
| **Metric**          | Quantitative measurement     | `metric-response-time`, `metric-error-rate`               |
| **Span**            | Unit of distributed trace    | `span-database-query`, `span-api-call`                    |
| **Log**             | Event logging configuration  | `log-application-errors`, `log-audit-trail`               |
| **Trace**           | Distributed trace definition | `trace-order-processing`, `trace-user-login`              |
| **Alert**           | Alert or notification rule   | `alert-high-error-rate`, `alert-slow-response`            |
| **Dashboard**       | Monitoring dashboard         | `dashboard-system-health`, `dashboard-user-activity`      |
| **SLO**             | Service Level Objective      | `slo-99-9-availability`, `slo-p95-latency`                |
| **Instrumentation** | Code instrumentation point   | `instrumentation-db-queries`, `instrumentation-api-calls` |

**Relationships:**

- Traces are composed of Spans
- Metrics feed into Alerts and Dashboards
- SLOs define success criteria for Traces

---

### Layer 12: Testing

The Testing layer defines test strategies, test cases, and test data.

| Type             | Description                 | Example                                                            |
| ---------------- | --------------------------- | ------------------------------------------------------------------ |
| **TestStrategy** | Overall testing approach    | `strategy-e2e-testing`, `strategy-performance-testing`             |
| **TestSuite**    | Collection of related tests | `suite-order-flow-tests`, `suite-authentication-tests`             |
| **TestCase**     | Individual test             | `case-successful-order-creation`, `case-invalid-email-validation`  |
| **TestScenario** | Use case for testing        | `scenario-happy-path-order`, `scenario-payment-failure`            |
| **TestData**     | Test data definition        | `data-sample-customers`, `data-invalid-orders`                     |
| **Assertion**    | Expected result in test     | `assertion-status-code-200`, `assertion-response-time-under-100ms` |
| **Mock**         | Mock or stub object         | `mock-payment-gateway`, `mock-email-service`                       |
| **Fixture**      | Test setup or teardown      | `fixture-database-reset`, `fixture-sample-data-load`               |

**Relationships:**

- TestSuites contain TestCases
- TestCases use TestData
- TestScenarios define Assertions

---

## Best Practices

### 1. Naming Consistency

- Always use PascalCase for element types: `Goal`, `BusinessService`, `Endpoint`
- Use kebab-case for element identifiers: `customer-satisfaction`, `order-management`, `create-order`
- Use dots to separate layer, type, and name: `motivation.goal.customer-satisfaction`

### 2. Type Selection

- Choose the most specific type that accurately describes the element
- Avoid generic types when more specific alternatives exist
- Use layer prefixes for types that have variants across layers

### 3. Related Types

When creating an element, consider related types:

- If you create a `Goal`, consider related `Outcomes`, `Requirements`, `Constraints`
- If you create an `Endpoint`, consider related `Parameters`, `RequestBodies`, `Responses`
- If you create an `Entity`, consider related `Properties` and `Relationships`

### 4. Cross-Layer Relationships

- Refer to elements from higher layers only (never reference upward)
- Use element IDs in full format: `layer.type.name`
- Validate that referenced elements exist before creating relationships

---

## Quick Reference

### Finding the Right Type

**Question: "What layer is this element in?"**

Start by identifying which layer your element belongs to, then select from that layer's type list.

**Question: "What's the difference between similar types?"**

Review the descriptions in the layer sections above. Each type has a distinct purpose within its layer.

**Question: "Should I use a layer prefix?"**

Yes, if the type appears in multiple layers with variants (e.g., `BusinessService`, `ApplicationService`, `TechnologyService`).
No, if the type is unique to one layer (e.g., `Goal` is only in Motivation layer).

---

## CLI Usage Examples

### Adding Elements with Correct Types

```bash
# Layer 1 - Motivation
dr add motivation goal customer-satisfaction \
  --name "Ensure customer satisfaction"

# Layer 2 - Business
dr add business service order-management \
  --name "Order Management Service"

# Layer 4 - Application
dr add application component order-service \
  --name "Order Service Component"

# Layer 6 - API
dr add api endpoint create-order \
  --name "Create Order" \
  --properties '{"method":"POST","path":"/api/orders"}'

# Layer 7 - Data Model
dr add data-model entity customer \
  --name "Customer Entity"

# Layer 8 - Data Store
dr add data-store table customers \
  --name "Customers Table"
```

### Discovering Available Types

The CLI validates element types against the specification. If you use an invalid type, you'll receive an error message suggesting valid types for that layer.

```bash
# This will show an error for invalid type
dr add motivation invalid-type my-element

# Valid types for motivation layer: Stakeholder, Driver, Assessment, Goal, ...
```

---

## Property Schema Examples

Elements can include custom properties defined as JSON. Here are common property schemas by element type:

### API Endpoint Properties

```json
{
  "method": "POST",
  "path": "/api/customers",
  "consumes": "application/json",
  "produces": "application/json",
  "requires_auth": true,
  "rate_limit": "1000 requests per hour",
  "timeout_ms": 5000
}
```

**Fields:**

- `method` - HTTP method (GET, POST, PUT, DELETE, PATCH)
- `path` - URL path
- `consumes` - Request content type
- `produces` - Response content type
- `requires_auth` - Whether authentication is required
- `rate_limit` - Rate limiting policy
- `timeout_ms` - Request timeout in milliseconds

### Application Component Properties

```json
{
  "technology_stack": ["TypeScript", "Node.js", "Express"],
  "deployment_unit": "order-service-container",
  "team_owned_by": "platform-team",
  "status": "production",
  "availability_requirement": "99.9%",
  "supports_scaling": true
}
```

**Fields:**

- `technology_stack` - Technologies used
- `deployment_unit` - Deployment identifier
- `team_owned_by` - Responsible team
- `status` - Current status (production, beta, development)
- `availability_requirement` - Uptime SLA
- `supports_scaling` - Whether horizontally scalable

### Database Table Properties

```json
{
  "columns": 12,
  "estimated_rows": "10M+",
  "primary_key": "customer_id",
  "partitioned": true,
  "partition_strategy": "by_date",
  "indexes": ["email", "created_at"],
  "backup_strategy": "daily",
  "retention_days": 2555
}
```

**Fields:**

- `columns` - Number of columns
- `estimated_rows` - Expected row count
- `primary_key` - Primary key column
- `partitioned` - Whether table is partitioned
- `partition_strategy` - Partitioning method
- `indexes` - List of indexed columns
- `backup_strategy` - Backup frequency
- `retention_days` - Data retention period

### Business Service Properties

```json
{
  "owner": "finance-team",
  "slicing": "vertical",
  "domain": "payment-processing",
  "maturity": "mature",
  "cost_center": "IT-0042",
  "business_hours": "24/7",
  "recovery_time_objective": "1 hour"
}
```

**Fields:**

- `owner` - Service owner team
- `slicing` - Service slicing model
- `domain` - Business domain
- `maturity` - Service maturity level
- `cost_center` - Cost allocation
- `business_hours` - Operational hours
- `recovery_time_objective` - RTO for disaster recovery

### Entity Properties (Data Model)

```json
{
  "aggregate_root": true,
  "lifecycle": "temporal",
  "uniqueness_constraint": "email",
  "soft_delete": true,
  "audit_enabled": true,
  "cache_strategy": "redis",
  "cache_ttl_seconds": 3600
}
```

**Fields:**

- `aggregate_root` - Whether this is an aggregate root
- `lifecycle` - Entity lifecycle type
- `uniqueness_constraint` - Unique field(s)
- `soft_delete` - Whether soft deletes are used
- `audit_enabled` - Whether to audit changes
- `cache_strategy` - Caching strategy
- `cache_ttl_seconds` - Cache time-to-live

### Test Case Properties

```json
{
  "test_type": "unit",
  "priority": "high",
  "estimated_duration_seconds": 5,
  "flaky": false,
  "requires_database": false,
  "requires_external_api": true,
  "tags": ["regression", "critical-path"]
}
```

**Fields:**

- `test_type` - Type of test (unit, integration, e2e, performance)
- `priority` - Test priority (low, medium, high, critical)
- `estimated_duration_seconds` - Expected execution time
- `flaky` - Whether test is known to be flaky
- `requires_database` - Whether test needs database
- `requires_external_api` - Whether test needs external APIs
- `tags` - Categorization tags

### Security Policy Properties

```json
{
  "policy_type": "authentication",
  "enforcement": "mandatory",
  "framework": "OAuth2",
  "provider": "Okta",
  "mfa_required": true,
  "password_rules": "minimum 12 chars, mixed case, special char",
  "token_expiry_hours": 24,
  "audit_logging": true
}
```

**Fields:**

- `policy_type` - Type of policy
- `enforcement` - Enforcement level
- `framework` - Security framework used
- `provider` - Identity provider
- `mfa_required` - Multi-factor authentication requirement
- `password_rules` - Password complexity rules
- `token_expiry_hours` - Token time-to-live
- `audit_logging` - Whether to audit policy usage

### Navigation Route Properties

```json
{
  "url_pattern": "/dashboard/:userId/orders",
  "component": "dashboard-orders-page",
  "requires_auth": true,
  "roles_allowed": ["admin", "manager"],
  "lazy_load": true,
  "preload": false,
  "page_title": "My Orders",
  "icon": "shopping-bag"
}
```

**Fields:**

- `url_pattern` - URL pattern with parameters
- `component` - Component to render
- `requires_auth` - Authentication requirement
- `roles_allowed` - Allowed user roles
- `lazy_load` - Whether to lazy load component
- `preload` - Whether to preload component
- `page_title` - Browser page title
- `icon` - Icon identifier

### Adding Custom Properties

When creating elements via CLI, pass properties as JSON:

```bash
dr add api endpoint create-customer \
  --name "Create Customer" \
  --properties '{
    "method": "POST",
    "path": "/api/customers",
    "requires_auth": true,
    "timeout_ms": 10000
  }'
```

**Guidelines:**

- Properties are optional
- Use clear, descriptive key names
- Keep property values as simple types (string, number, boolean, array)
- Document custom properties in your architecture guide
- Use consistent property naming across similar elements

---

## See Also

- [CLAUDE.md](../CLAUDE.md) - AI Assistant guide with element naming overview
- [CLI README](../cli/README.md) - Command-line usage and examples
- [Specification Layers](../spec/layers/) - Detailed layer specifications
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Internal architecture and design patterns
