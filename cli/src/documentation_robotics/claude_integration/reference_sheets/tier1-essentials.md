# Documentation Robotics - Quick Reference

## Element ID Format

```
{layer}.{type}.{kebab-case-name}
Example: business.service.order-management
```

## 11 Architecture Layers

1. **motivation** - Strategic goals, requirements, stakeholders (WHY)
2. **business** - Business processes, services, actors (WHAT)
3. **security** - Authentication, authorization, policies (WHO CAN)
4. **application** - Software components, services (HOW)
5. **technology** - Infrastructure, deployment (WITH WHAT)
6. **api** - REST/GraphQL endpoints, operations (INTERFACE)
7. **data_model** - Logical data structures (STRUCTURE)
8. **datastore** - Physical databases, tables (STORAGE)
9. **ux** - Views, components, experience states (PRESENTATION)
10. **navigation** - Routes, flows, guards (FLOW)
11. **apm** - Spans, logs, metrics (OBSERVE)

## Essential CLI Commands

```bash
# Query elements
dr find {element-id}                  # Get specific element
dr list {layer} {type}                # List all of type
dr search {pattern}                   # Search across layers

# Modify elements
dr add {layer} {type} --name "..." --property key=value
dr update {element-id} --property key=value

# Changesets (isolated changes)
dr changeset create "feature-name"    # Start new changeset
dr changeset status                   # View current changes
dr changeset apply                    # Merge to main model

# Validate & export
dr validate --strict                  # Full validation
dr validate --validate-links          # Include link validation
dr export --format {archimate|markdown|plantuml}

# Cross-layer links
dr links types --from {layer} --to {layer}  # Query link patterns
dr links find {element-id}            # Find element's links
dr validate --validate-links          # Validate all links

# Migration
dr migrate                            # Check migration needs
dr migrate --apply                    # Upgrade to latest spec

# Cross-layer operations
dr project {source-layer}→{target-layer} [--element-id id]
```

## Key Cross-Layer Patterns

**Traceability (bottom-up):**

```yaml
# Pattern: Dot-notation
motivation:
  supports-goals: [motivation.goal.improve-ux] # Upward to motivation
  governed-by-principles: [motivation.principle.api-first]
business:
  realizes-services: [business.service.order-mgmt] # App → Business
```

**API Layer (x-extensions):**

```yaml
# Pattern: X-extensions (OpenAPI)
x-archimate-ref: application.service.order-api
x-supports-goals: [motivation.goal.revenue]
x-required-permissions: [security.permission.create-order]
```

**Security (cross-cutting):**

```yaml
security:
  resourceRef: security.resource.order-data
  requiredRoles: [security.role.order-manager]
  requiredPermissions: [security.permission.create-order]
```

**Observability (cross-cutting):**

```yaml
apm:
  business-metrics: [apm.metric.order-rate]
  sla-target-latency: 200ms
  traced: true
```

## File Locations

- Model: `./documentation-robotics/model/{layer}/`
- Exported specs: `./documentation-robotics/specs/`
- Schemas: `./.dr/schemas/`
- Config: `./dr.config.yaml`

## Python API (for complex operations)

```python
from documentation_robotics.core import Model

model = Model.load("./")
element = model.get_element("business.service.orders")
elements = model.find_elements(layer="business", element_type="service")
model.add_element(layer, element_dict)
result = model.validate(strict=True)
```

## Complete Entity Types by Layer

**motivation** (10 types - Strategic):
assessment, constraint, driver, goal, meaning, outcome, principle, requirement, stakeholder, value

**business** (13 types - ArchiMate):
actor, collaboration, contract, event, function, interaction, interface, object, process, product, representation, role, service

**security** (15 types - STS-ml):
accountability, actor, authentication, dataclassification, delegation, informationentity, permission, policy, resource, role, securityconstraint, socialdependency, threat

**application** (9 types - ArchiMate):
collaboration, component, dataobject, event, function, interaction, interface, process, service

**technology** (13 types - ArchiMate):
artifact, collaboration, communicationnetwork, device, event, function, interaction, interface, node, path, process, service, systemsoftware

**api** (6 types - OpenAPI 3.0.3):
component, operation, path, schema, security-scheme, server

**data_model** (4 types - JSON Schema):
attribute, entity, relationship, schema

**datastore** (1 type):
database

**ux** (13 types - Multi-channel):
apispec, apm, channel, dataschema, experience, globalaction, security, state, title, view

**navigation** (7 types - Routing):
flow, guard, route, transition

**apm** (10 types - OpenTelemetry):
dataquality, log, logging, metric, motivationmapping, resource, span, tracing

## Cross-Layer Link Types (62 total)

**4 Reference Pattern Types:**

1. **X-Extensions** - `x-archimate-ref`, `x-supports-goals` (OpenAPI/JSON Schema)
2. **Dot-Notation** - `motivation.supports-goals`, `business.realizes-services` (Upward refs)
3. **Nested Objects** - `motivationAlignment: {supportsGoals, deliversValue}`
4. **Direct Fields** - `operationId`, `$ref`, `schemaRef` (Standard fields)

**Common Link Types:**

- `motivation.supports-goals` - Link to strategic goals (Array of UUIDs)
- `motivation.fulfills-requirements` - Link to requirements (Array)
- `motivation.governed-by-principles` - Link to principles (Array)
- `realizes` - Implementation realizes higher-level service (Single UUID)
- `x-archimate-ref` - API operation → ApplicationService (Single UUID)
- `security.requiredPermissions` - Required permissions (Array of strings)
- `apm.business-metrics` - Observability metrics (Array of strings)

**Query Available Links:**

```bash
dr links types --from api --to application     # Show API → App patterns
dr links registry                              # Complete catalog
```

## Link Validation

```bash
# Validate all cross-layer links
dr validate --validate-links

# Strict mode (warnings → errors)
dr validate --validate-links --strict-links

# Check what needs migration (v0.1.x → v0.2.0)
dr migrate
dr migrate --apply
```

**Common validation errors:**

- Broken references (target doesn't exist)
- Type mismatches (wrong target type)
- Cardinality errors (single vs array)
- Format errors (invalid UUID, path, etc.)

## Need Help?

**DR Helper Agent (NEW in v0.4.0):**

Ask questions and get expert guidance on DR concepts, modeling decisions, and workflows.

**Launch with:** Task tool, agent type: `dr-helper`

**The helper agent can:**

- Explain DR concepts and philosophy
- Guide you through modeling decisions
- Help with CLI commands and workflows
- Assist with upgrades and maintenance
- Explain cross-layer links and validation
- Share best practices and patterns

**DR Ideation Agent (NEW in v0.4.0):**

Explore architectural ideas safely in changesets with research-driven guidance.

**Launch with:** Task tool, agent type: `dr-ideator`

**The ideation agent can:**

- Create and manage exploration changesets
- Ask probing questions to refine ideas
- Research technologies using web search
- Use Context-7 for library/framework details
- Model ideas collaboratively across layers
- Compare multiple approaches side-by-side
- Guide merge or abandon decisions

## Need More Detail?

- Tier 2 Guide: `.claude/knowledge/dr-tier2-developer-guide.md`
- Full Reference: `.claude/knowledge/dr-tier3-complete-reference.md`
- Link Management: Run `dr links --help` or `/dr-links` slash command
- Documentation: Run `dr --help` or check `/cli/docs/`
