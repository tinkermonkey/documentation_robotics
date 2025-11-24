# DR + Claude Code Workflow Examples

This document provides practical examples of using Documentation Robotics with Claude Code for common architecture modeling scenarios.

## Table of Contents

1. [New Project Setup](#workflow-1-new-project-setup)
2. [Extracting Model from Existing Codebase](#workflow-2-extracting-model-from-existing-codebase)
3. [Adding a New Feature](#workflow-3-adding-a-new-feature)
4. [Microservices Documentation](#workflow-4-microservices-documentation)
5. [Security Audit & Remediation](#workflow-5-security-audit--remediation)
6. [API-First Development](#workflow-6-api-first-development)
7. [Goal-Driven Architecture](#workflow-7-goal-driven-architecture)
8. [Refactoring Documentation](#workflow-8-refactoring-documentation)
9. [Compliance Documentation](#workflow-9-compliance-documentation)
10. [Team Onboarding](#workflow-10-team-onboarding)

---

## Workflow 1: New Project Setup

**Scenario:** Starting a new project and want to document architecture from day one.

**Time:** 15-20 minutes

**Steps:**

### 1. Initialize DR Model

```bash
cd my-new-project
dr init
```

**Output:**

```
✓ Created documentation-robotics/ directory structure
✓ Initialized manifest.yaml
✓ Copied JSON schemas
```

### 2. Install Claude Integration

```bash
dr claude install
```

**Output:**

```
✓ Created .claude/ directory
✓ Installed reference sheets (3 files)
✓ Installed slash commands (5 files)
✓ Installed agents (3 files)
```

### 3. Define Business Goals

**In Claude Code:**

```
I'm starting a new e-commerce project. Let me define the business goals first.

/dr-model Add business goals:
1. Increase conversion rate by 20%
2. Reduce cart abandonment by 30%
3. Improve average order value by 15%
```

**Result:**

- Creates 3 goals in `documentation-robotics/model/01_motivation/goals.yaml`
- Each with ID like `motivation.goal.increase-conversion`
- Adds KPI properties

### 4. Model Core Business Services

```
/dr-model Design the core business services:
- Product catalog management
- Shopping cart
- Order processing
- Payment handling
- Inventory management
```

**Result:**

- Creates 5 business services
- Links to appropriate goals
- Sets criticality based on business impact

### 5. Project to Application Layer

```
/dr-project business→application
```

**Result:**

- Creates application services for each business service
- Establishes "realizes" references
- Suggests technology choices

### 6. Validate Model

```
/dr-validate --strict
```

**Result:**

```
✓ Schema validation: Passed
✓ Reference validation: Passed
⚠️  Semantic validation: 5 warnings
  - Consider adding security policies
  - Add monitoring for critical services
```

### 7. Generate Initial Documentation

```bash
dr export --format markdown --output docs/architecture/
```

**Outcome:**

- Complete architecture model with traceability
- Foundation for iterative development
- Documentation ready from day one

---

## Workflow 2: Extracting Model from Existing Codebase

**Scenario:** Legacy project with no architecture documentation. Need to reverse-engineer the model.

**Time:** 30-60 minutes (depending on codebase size)

**Steps:**

### 1. Install DR and Claude Integration

```bash
cd existing-project
dr init
dr claude install
```

### 2. Extract from Codebase

**In Claude Code:**

```
/dr-ingest ./src --layers business,application,api,data_model
```

**What happens:**

1. Claude launches the `dr-extractor` agent
2. Agent analyzes code structure:
   - Finds FastAPI routes
   - Identifies service classes
   - Extracts data models
   - Maps dependencies
3. Agent creates DR elements across layers
4. Agent validates the extracted model
5. Agent provides detailed report

**Sample Report:**

```
✓ Extraction completed in 2m 35s

Discovered:
- Technology: Python 3.11, FastAPI 0.104, PostgreSQL
- Structure: Monolithic with service layer pattern

Elements Created:
  Business Layer:
    ✓ 8 business services (high confidence)

  Application Layer:
    ✓ 12 application services
    ✓ 5 components (database, cache, auth, queue, storage)

  API Layer:
    ✓ 47 API operations (REST)

  Data Model:
    ✓ 15 schemas (from Pydantic models)

Confidence:
- High: 65 elements (90%)
- Medium: 6 elements (8%)
- Low: 1 element (2%)

Recommendations:
1. Review medium/low confidence elements
2. Add security policies (none found in code)
3. Add monitoring metrics
4. Link to business goals (requires manual input)
```

### 3. Review Extracted Model

```bash
# List all services
dr list business service
dr list application service

# Review specific service
dr find application.service.order-api
```

### 4. Enhance with Business Context

```
/dr-model Add business goals for the extracted services:
- Link order management to revenue growth goal
- Link user management to user acquisition goal
- Link payment processing to conversion optimization goal
```

### 5. Add Missing Elements

```
/dr-model Add security policies:
- OAuth2 for all public APIs
- API key authentication for internal services
- Rate limiting for public endpoints
```

### 6. Validate and Fix

```
/dr-validate --fix
```

**Result:**

```
Applied 15 automatic fixes:
  ✓ 8 missing descriptions (generated)
  ✓ 5 broken references (corrected)
  ✓ 2 naming convention fixes

Remaining issues: 3 (require manual review)
```

### 7. Generate Documentation

```bash
dr export --format markdown --output docs/architecture/
dr export --format plantuml --output docs/diagrams/
```

**Outcome:**

- Complete architecture documentation of existing system
- Visual diagrams of current state
- Foundation for future enhancements
- Knowledge captured and shareable

---

## Workflow 3: Adding a New Feature

**Scenario:** Need to add payment processing feature to existing e-commerce system.

**Time:** 10-15 minutes

**Steps:**

### 1. Define the Requirement

**In Claude Code:**

```
I need to add Stripe payment processing to our e-commerce platform.
It should:
- Handle credit card payments
- Support refunds
- Store payment history
- Be PCI-DSS compliant
- Have high availability (99.9% SLO)
```

### 2. Model the Feature

```
/dr-model Add payment processing feature with full traceability
```

**What Claude does:**

1. Creates business service: `business.service.payment-processing`
2. Adds properties: criticality=critical, domain=finance
3. Projects to application: `application.service.payment-api`
4. Defines API operations:
   - `POST /payments` (create payment)
   - `GET /payments/{id}` (get payment status)
   - `POST /payments/{id}/refund` (refund)
5. Creates data model: `data_model.schema.payment`
6. Adds security policy: `security.policy.pci-dss-compliance`
7. Adds monitoring:
   - `apm.metric.payment-availability` (99.9% target)
   - `apm.metric.payment-latency` (P95 < 200ms)
8. Links to business goal: supports-goals=increase-conversion

### 3. Validate Completeness

```
/dr-validate --strict
```

**Result:**

```
✓ All validations passed
✓ Payment processing feature is complete:
  - Business layer: ✓
  - Application layer: ✓
  - API layer: ✓
  - Data model: ✓
  - Security: ✓
  - Monitoring: ✓
  - Traceability: ✓
```

### 4. Generate Implementation Guide

```bash
# Generate feature documentation
dr export --format markdown \
  --filter "service=payment" \
  --output docs/features/payment-processing.md

# Generate sequence diagrams
dr export --format plantuml \
  --filter "service=payment" \
  --output docs/diagrams/payment-flow.puml
```

### 5. Review and Commit

```bash
git add documentation-robotics/ docs/
git commit -m "Add payment processing feature to architecture model

Includes:
- Business service definition
- Application service and API operations
- Data model for payments
- PCI-DSS security controls
- SLI/SLO monitoring setup

Supports goal: increase conversion rate
"
```

**Outcome:**

- Complete feature specification
- Security and monitoring planned
- Implementation guide generated
- Team aligned on architecture

---

## Workflow 4: Microservices Documentation

**Scenario:** Documenting a microservices architecture with 20+ services.

**Time:** 2-3 hours (initial), then incremental

**Strategy:** Service-by-service documentation

### 1. Extract Core Services

```
/dr-ingest ./services/order-service --layers business,application,api,data_model
/dr-ingest ./services/payment-service --layers business,application,api,data_model
/dr-ingest ./services/inventory-service --layers business,application,api,data_model
```

**Pro tip:** Run these in parallel if services are independent.

### 2. Document Service Dependencies

**In Claude Code:**

```
Map service dependencies:
- Order service depends on Payment service (sync)
- Order service depends on Inventory service (sync)
- Order service publishes to Notification service (async)
- Payment service depends on Stripe API (external)
```

**Result:**
Claude adds `dependsOn` relationships and creates integration elements.

### 3. Add Service-Level Concerns

For each service:

```
/dr-model Add deployment configuration for order-service:
- Kubernetes deployment (3 replicas)
- Service mesh: Istio
- Database: PostgreSQL
- Message queue: RabbitMQ
- Cache: Redis
```

### 4. Document Cross-Cutting Concerns

```
/dr-model Add API gateway configuration:
- Rate limiting: 1000 req/min per user
- Authentication: OAuth2 + JWT
- Observability: OpenTelemetry
- Resilience: Circuit breaker pattern
```

### 5. Generate Service Catalog

```bash
# Complete service catalog
dr export --format markdown \
  --template service-catalog \
  --output docs/services/catalog.md

# Per-service documentation
for service in order payment inventory; do
  dr export --format markdown \
    --filter "service=$service" \
    --output docs/services/$service.md
done
```

### 6. Generate Dependency Diagrams

```bash
# Service dependency graph
dr export --format plantuml \
  --type dependencies \
  --output docs/diagrams/service-dependencies.puml

# Deployment diagram
dr export --format plantuml \
  --layer technology \
  --output docs/diagrams/deployment.puml
```

**Outcome:**

- Complete microservices documentation
- Service catalog with ownership
- Dependency visualization
- Deployment documentation
- Per-service details

---

## Workflow 5: Security Audit & Remediation

**Scenario:** Security audit revealed gaps. Need to document and fix security controls.

**Time:** 1-2 hours

### 1. Run Security Validation

```
/dr-validate --strict --layer security
```

**Result:**

```
❌ 12 security issues found:

Critical (3):
1. payment-api: No encryption at rest
2. user-api: Missing authentication
3. admin-api: No MFA

High (5):
1. order-api: No rate limiting
2. inventory-api: Weak authentication (API key)
3. customer-data: No access controls
[...]

Medium (4):
[...]
```

### 2. Add Security Policies

```
/dr-model Add comprehensive security policies:

Authentication:
- OAuth2 for all public APIs
- JWT for service-to-service
- MFA for admin access

Authorization:
- RBAC for user endpoints
- ABAC for sensitive data

Encryption:
- TLS 1.3 for all traffic
- AES-256 for data at rest

Network Security:
- API Gateway with rate limiting
- Service mesh for internal traffic
- Network policies in Kubernetes
```

### 3. Map Security Controls to Services

```
/dr-model Apply security policies:
- payment-api: OAuth2 + MFA + encryption
- user-api: OAuth2 + RBAC
- admin-api: OAuth2 + MFA + IP whitelist
- All APIs: rate limiting (1000/min)
```

### 4. Validate Security Coverage

```
/dr-validate --strict --layer security
```

**Result:**

```
✓ Security validation passed

Applied controls:
  Authentication: 15/15 services ✓
  Authorization: 12/15 services ⚠️ (3 internal-only)
  Encryption: 15/15 services ✓
  Rate limiting: 8/15 services ⚠️ (public APIs only)
  Monitoring: 15/15 services ✓

Security score: 92/100 (Excellent)
```

### 5. Generate Security Documentation

```bash
# Security architecture document
dr export --format markdown \
  --layer security \
  --output docs/security/architecture.md

# Compliance matrix
dr export --format markdown \
  --template compliance-matrix \
  --output docs/security/compliance-matrix.md

# Threat model diagrams
dr export --format plantuml \
  --type security-zones \
  --output docs/diagrams/security-zones.puml
```

### 6. Create Remediation Tickets

```bash
# Generate tickets for remaining issues
dr validate --format json | \
  jq '.warnings[] | "JIRA-\(.severity): \(.message) [\(.element)]"'
```

**Outcome:**

- Security gaps identified and fixed
- Comprehensive security documentation
- Audit-ready compliance matrices
- Remediation tracking

---

## Workflow 6: API-First Development

**Scenario:** Designing APIs before implementation.

**Time:** 30-45 minutes

### 1. Define API Requirements

**In Claude Code:**

```
Design a RESTful API for our task management system:

Resources:
- Projects
- Tasks
- Users
- Comments

Operations needed:
- CRUD for projects and tasks
- Assign tasks to users
- Add comments to tasks
- Search tasks by status/assignee
- Bulk operations
```

### 2. Model API Layer

```
/dr-model Create API operations for task management

Following REST best practices:
- Use proper HTTP verbs
- Implement HATEOAS
- Support filtering and pagination
- Include rate limiting
- Add OpenAPI 3.0 specs
```

**Result:**
Claude creates 25+ API operations following RESTful conventions:

```
api.operation.list-projects (GET /projects)
api.operation.create-project (POST /projects)
api.operation.get-project (GET /projects/{id})
api.operation.update-project (PUT /projects/{id})
api.operation.delete-project (DELETE /projects/{id})
api.operation.list-project-tasks (GET /projects/{id}/tasks)
[...]
```

### 3. Define Request/Response Schemas

```
/dr-model Add data models for API:

Schemas:
- ProjectRequest, ProjectResponse
- TaskRequest, TaskResponse
- CommentRequest, CommentResponse
- ErrorResponse
- PaginationMetadata

Include validation rules and examples
```

### 4. Map to Application Services

```
/dr-model Link API operations to application services:
- Project operations → project-service
- Task operations → task-service
- User operations → user-service
- Comment operations → comment-service
```

### 5. Generate OpenAPI Specification

```bash
# Export OpenAPI 3.0 spec
dr export --format openapi \
  --layer api \
  --output api/openapi.yaml

# Generate API documentation
dr export --format markdown \
  --layer api \
  --template api-reference \
  --output docs/api/reference.md
```

### 6. Generate Mock Server Config

```bash
# Export for Prism mock server
dr export --format openapi --output api/openapi.yaml
npx @stoplight/prism-cli mock api/openapi.yaml

# Or generate Postman collection
dr export --format postman \
  --layer api \
  --output api/postman-collection.json
```

### 7. Review and Iterate

Share API documentation with stakeholders for feedback, then iterate:

```
/dr-model Update API based on feedback:
- Add bulk delete operation
- Change pagination to cursor-based
- Add webhook support for task updates
```

**Outcome:**

- Complete API specification before coding
- OpenAPI spec for tooling
- Mock server for frontend development
- Shared understanding across team

---

## Workflow 7: Goal-Driven Architecture

**Scenario:** Ensure architecture aligns with business goals.

**Time:** 20-30 minutes

### 1. Define Business Goals with KPIs

```
/dr-model Add strategic business goals:

Goal 1: Improve User Retention
- Current: 60% monthly retention
- Target: 80% monthly retention
- Timeline: 6 months
- Metric: monthly_active_users_returning

Goal 2: Reduce Infrastructure Costs
- Current: $50k/month
- Target: $35k/month (30% reduction)
- Timeline: 3 months
- Metric: monthly_infrastructure_spend

Goal 3: Increase API Reliability
- Current: 99.5% uptime
- Target: 99.95% uptime
- Timeline: 2 months
- Metric: api_availability_percent
```

### 2. Map Goals to Requirements

```
/dr-model Define requirements for each goal:

For "Improve User Retention":
- REQ-001: Add personalized notifications
- REQ-002: Implement user engagement analytics
- REQ-003: Add gamification features

For "Reduce Infrastructure Costs":
- REQ-004: Implement auto-scaling
- REQ-005: Optimize database queries
- REQ-006: Add caching layer

For "Increase API Reliability":
- REQ-007: Add circuit breakers
- REQ-008: Implement retry logic
- REQ-009: Add comprehensive monitoring
```

### 3. Design Services to Support Goals

```
/dr-model Create business services linked to goals:

Notification Service:
- Supports: Improve User Retention
- Realizes: REQ-001
- Criticality: High

Analytics Service:
- Supports: Improve User Retention
- Realizes: REQ-002
- Criticality: Medium

[...]
```

### 4. Validate Traceability

```bash
# Check goal coverage
dr validate --check traceability

# Generate traceability matrix
dr export --format markdown \
  --template traceability-matrix \
  --output docs/traceability-matrix.md
```

**Result:**

```
Goal Coverage Analysis:

Improve User Retention: 100% ✓
- 3/3 requirements mapped
- 5 services supporting
- 12 API operations
- 8 metrics tracking

Reduce Infrastructure Costs: 67% ⚠️
- 2/3 requirements mapped
- REQ-006 (caching) not implemented
- 3 services supporting

Increase API Reliability: 100% ✓
- 3/3 requirements mapped
- 7 services enhanced
- 21 metrics added
```

### 5. Track Progress with Metrics

```
/dr-model Add APM metrics for goal tracking:

For User Retention:
- engagement_score (target: >7)
- notification_engagement_rate (target: >40%)
- gamification_participation (target: >50%)

For Infrastructure Costs:
- auto_scaling_efficiency (target: >80%)
- cache_hit_rate (target: >90%)
- query_optimization_score (target: >85%)

For API Reliability:
- circuit_breaker_trips (target: <10/day)
- retry_success_rate (target: >95%)
- error_rate (target: <0.5%)
```

### 6. Generate Goal Dashboard

```bash
# Export goal tracking documentation
dr export --format markdown \
  --template goal-dashboard \
  --output docs/goals/dashboard.md
```

**Outcome:**

- Clear alignment between business goals and architecture
- Traceability from goals → requirements → services → metrics
- Progress tracking framework
- Data-driven architecture decisions

---

## Workflow 8: Refactoring Documentation

**Scenario:** Refactoring from monolith to microservices. Need to document both current and target state.

**Time:** 2-3 hours

### 1. Document Current State (Monolith)

```
/dr-ingest ./src --layers business,application,api
```

**Result:** Model of current monolithic architecture.

### 2. Create Target Architecture Branch

```bash
# Create a "target" version of the model
cp -r documentation-robotics/ documentation-robotics-target/

# Or use branching in manifest
dr init --version target-state
```

### 3. Design Microservices Decomposition

```
/dr-model Design microservices from monolith:

Extract these services:
1. User Service (authentication, profiles)
2. Order Service (order management)
3. Inventory Service (stock management)
4. Payment Service (payment processing)
5. Notification Service (emails, SMS)

For each service, define:
- Bounded context
- Data ownership
- API contracts
- Dependencies
- Deployment
```

### 4. Model Service Extraction

**For each service:**

```
/dr-model Extract User Service:

From monolith modules:
- auth.py → user-service
- user_profiles.py → user-service
- user_api.py → user-service

New boundaries:
- Database: users_db (PostgreSQL)
- Cache: user_cache (Redis)
- Events: UserCreated, UserUpdated, UserDeleted

API:
- POST /users (register)
- POST /users/login (authenticate)
- GET /users/{id} (get profile)
- PUT /users/{id} (update profile)
```

### 5. Define Migration Strategy

```
/dr-model Add migration phases:

Phase 1: User Service (Week 1-2)
- Extract user authentication
- Deploy parallel to monolith
- Gradually migrate traffic

Phase 2: Order Service (Week 3-4)
- Extract order management
- Implement saga pattern for distributed transactions
- Deploy with feature flags

Phase 3: [continue...]
```

### 6. Generate Comparison

```bash
# Compare current vs target
dr diff documentation-robotics/ documentation-robotics-target/ --output docs/refactoring/comparison.md

# Generate migration guide
dr export --format markdown \
  --version target-state \
  --template migration-guide \
  --output docs/refactoring/migration-guide.md
```

### 7. Track Refactoring Progress

```yaml
# In model-target/manifest.yaml
phases:
  phase1:
    status: complete
    services: [user-service]
    completed: 2025-01-15

  phase2:
    status: in-progress
    services: [order-service]
    started: 2025-01-20
    target: 2025-02-03

  phase3:
    status: planned
    services: [inventory-service, payment-service]
    target: 2025-02-17
```

**Outcome:**

- Documentation of current and target architecture
- Clear migration path
- Service boundaries defined
- Risk mitigation planned
- Progress tracking

---

## Workflow 9: Compliance Documentation

**Scenario:** Preparing for SOC2 audit. Need comprehensive compliance documentation.

**Time:** 3-4 hours

### 1. Map Compliance Requirements

```
/dr-model Add SOC2 compliance requirements:

Trust Service Criteria:

CC6.1 - Logical Access Controls:
- All systems require authentication
- Critical systems require MFA
- Access is role-based

CC7.2 - System Monitoring:
- All critical services have monitoring
- Availability SLO: 99.9%
- Incident response <15 minutes

CC8.1 - Change Management:
- All changes documented in model
- Changes require approval
- Deployment automation

[Continue with all criteria...]
```

### 2. Tag Compliance-Critical Elements

```
/dr-model Tag services with compliance scope:

In-scope for SOC2:
- All services handling customer data
- All authentication/authorization services
- All data storage systems
- All monitoring systems

Mark criticality for each.
```

### 3. Document Security Controls

```
/dr-model Add security controls for SOC2:

Authentication:
- OAuth2 + JWT for all APIs
- MFA for admin access
- Session management (1-hour timeout)

Encryption:
- TLS 1.3 for all external traffic
- TLS 1.2 minimum for internal traffic
- AES-256 for data at rest

Access Control:
- RBAC implemented
- Principle of least privilege
- Regular access reviews (quarterly)

Audit Logging:
- All access logged
- Logs retained 1 year
- Log integrity verified
```

### 4. Map Controls to Systems

```
/dr-validate --framework soc2
```

**Result:**

```
SOC2 Compliance Check:

CC6.1 (Logical Access): 95% ✓
- 19/20 services have authentication
- Missing: internal-metrics-api (low risk)

CC7.2 (Monitoring): 100% ✓
- All critical services monitored
- All SLOs defined and tracked

CC8.1 (Change Management): 90% ⚠️
- Model documents architecture
- Need: deployment approval workflow
```

### 5. Generate Compliance Evidence

```bash
# System description
dr export --format markdown \
  --template soc2-system-description \
  --output audit/system-description.md

# Control matrix
dr export --format markdown \
  --template soc2-control-matrix \
  --output audit/control-matrix.md

# Data flow diagrams
dr export --format plantuml \
  --type data-flows \
  --output audit/diagrams/data-flows.puml

# Access control matrix
dr export --format markdown \
  --template access-control-matrix \
  --output audit/access-control.md
```

### 6. Prepare Audit Package

```bash
# Generate complete audit package
dr export --format pdf \
  --template soc2-audit-package \
  --output audit/soc2-audit-package.pdf
```

**Package includes:**

- System description
- Network diagrams
- Data flow diagrams
- Control mappings
- Access control matrices
- Change management docs
- Incident response procedures
- Monitoring dashboards

**Outcome:**

- Complete SOC2 audit package
- Control evidence documented
- Gap analysis completed
- Audit-ready in days, not weeks

---

## Workflow 10: Team Onboarding

**Scenario:** New engineer joining the team. Need to get them up to speed on architecture quickly.

**Time:** 30 minutes

### 1. Generate Onboarding Documentation

```bash
# Executive summary
dr export --format markdown \
  --template executive-summary \
  --output docs/onboarding/architecture-overview.md

# Service catalog
dr export --format markdown \
  --template service-catalog \
  --output docs/onboarding/service-catalog.md

# Visual diagrams
dr export --format plantuml \
  --output docs/onboarding/diagrams/
```

### 2. Create Interactive Tour

**In Claude Code (with new team member):**

```
Give me an architecture tour of this project. Start with the business layer.
```

Claude walks through:

1. Business goals and drivers
2. Key business capabilities
3. Application services implementing each capability
4. API endpoints and how to use them
5. Data models and storage
6. Security and monitoring

### 3. Answer Questions Interactively

**New engineer asks:**

```
How does the order processing flow work end-to-end?
```

**Claude responds:**

```
Here's the order processing flow:

1. User initiates: POST /api/v1/orders
   → API: api.operation.create-order

2. Order API validates and calls application service:
   → Service: application.service.order-api
   → Realizes: business.service.order-management

3. Order service orchestrates:
   a. Checks inventory (→ inventory-service)
   b. Processes payment (→ payment-service)
   c. Updates order status
   d. Publishes OrderCreated event

4. Downstream services react:
   - Shipping service prepares shipment
   - Notification service emails customer
   - Analytics service updates metrics

5. Response returned to user with order ID

Diagram: docs/diagrams/order-flow.puml
Code: src/services/order_service.py

Security: OAuth2 required, rate limit: 100 req/min
Monitoring: order-processing-latency (P95: 200ms)
```

### 4. Highlight Critical Services

```
Which services should I be most careful with as I start contributing?
```

**Claude responds:**

```
Critical services (handle carefully):

1. payment-service (criticality: critical)
   - Handles financial transactions
   - PCI-DSS compliant
   - Requires MFA for deployment
   - Owner: @payments-team

2. user-auth-service (criticality: critical)
   - Manages authentication
   - Any downtime affects all users
   - Rate limiting crucial
   - Owner: @platform-team

3. inventory-service (criticality: high)
   - Real-time stock management
   - Race conditions possible
   - Uses distributed locks
   - Owner: @fulfillment-team

For these services:
- Always get code review from owners
- Test thoroughly in staging
- Deploy during low-traffic windows
- Monitor closely after deployment
```

### 5. Provide Development Context

```
I'm working on adding a wishlist feature. Where should I start?
```

**Claude responds:**

```
For wishlist feature, you'll work across these layers:

1. Business Layer:
   - Extend: business.service.product-catalog
   - Or create: business.service.wishlist-management

2. Application Layer:
   - Create: application.service.wishlist-api
   - Code location: src/services/wishlist_service.py

3. API Layer:
   - Add operations:
     - POST /users/{id}/wishlist (add item)
     - GET /users/{id}/wishlist (get wishlist)
     - DELETE /users/{id}/wishlist/{item} (remove item)
   - API module: src/api/wishlist/

4. Data Model:
   - Create: data_model.schema.wishlist-item
   - Database: Add table to users_db
   - Migration: migrations/add_wishlist_table.sql

5. Testing:
   - Unit tests: tests/services/test_wishlist.py
   - Integration: tests/api/test_wishlist_api.py

Similar patterns:
- See cart-service for reference (similar domain)
- Follow same auth pattern (OAuth2)
- Add standard monitoring metrics

Next steps:
1. Review cart-service implementation
2. Design wishlist data model
3. Create DR model: /dr-model Add wishlist feature
4. Implement and test
5. Update documentation
```

**Outcome:**

- New team member productive quickly
- Architecture knowledge accessible
- Common patterns clear
- Critical areas identified
- Interactive learning

---

## Best Practices Across All Workflows

1. **Validate frequently**: Run `/dr-validate` after significant changes
2. **Commit model with code**: Keep architecture docs in sync
3. **Use natural language**: Claude understands intent, not just commands
4. **Iterate incrementally**: Build model piece by piece
5. **Generate docs automatically**: Let DR create documentation
6. **Link to business value**: Always trace to goals
7. **Include security from start**: Don't bolt on later
8. **Plan monitoring**: Define SLIs/SLOs early
9. **Review with team**: Architecture is collaborative
10. **Keep it current**: Update model as system evolves

---

## Common Command Patterns

### Quick queries

```
dr list <layer> <type>
dr find <element-id>
dr search <keyword>
```

### Bulk operations

```
dr add <layer> <type> --batch-file elements.yaml
dr update <pattern> --property key=value
```

### Validation

```
dr validate                    # Basic
dr validate --strict           # Comprehensive
dr validate --fix              # Auto-fix issues
dr validate --layer security   # Focus on one layer
```

### Export

```
dr export --format markdown    # Documentation
dr export --format plantuml    # Diagrams
dr export --format archimate   # Tool import
dr export --format openapi     # API spec
```

### Claude Code commands

```
/dr-init           # Initialize new model
/dr-model          # Interactive modeling
/dr-ingest         # Extract from code
/dr-project        # Cross-layer projection
/dr-validate       # Validate + fix
```

---

## Getting Help

**In Claude Code:**

```
How do I... [question]
Show me an example of... [topic]
What's the best way to... [task]
```

**Documentation:**

- Design Document: `/cli/docs/04_claude_code_integration_design.md`
- User Guide: `/cli/docs/user-guide/`
- Reference Sheets: `.claude/knowledge/`

**Community:**

- GitHub: [github.com/yourusername/documentation-robotics](https://github.com)
- Issues: Report bugs and request features
- Discussions: Share workflows and best practices
