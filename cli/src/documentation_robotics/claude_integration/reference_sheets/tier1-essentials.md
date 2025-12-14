# Documentation Robotics - Quick Reference

## Element ID Format

```
{layer}.{type}.{kebab-case-name}
Example: business.service.order-management
```

## 12 Architecture Layers

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
12. **testing** - Test coverage, input partitions, context variations (VERIFY)

## Essential CLI Commands

```bash
# Query elements
dr find {element-id}                  # Get specific element
dr list {layer} {type}                # List all of type
dr search {pattern}                   # Search across layers

# Modify elements
dr add {layer} {type} --name "..." --property key=value
dr update-element {element-id} --set key=value

# Changesets (isolated changes)
dr changeset create "feature-name"    # Start new changeset
dr changeset status                   # View current changes
dr changeset apply                    # Merge to main model

# Validate & export
dr validate --strict                  # Full validation
dr validate --validate-links          # Include link validation
dr export --format {archimate|markdown|plantuml}

# Cross-layer links
dr links types --layer {layer}  # Query link patterns
dr links find {element-id}            # Find element's links
dr validate --validate-links          # Validate all links

# Migration
dr migrate                            # Check migration needs
dr migrate                    # Upgrade to latest spec

# Cross-layer operations
dr project {element-id} --to {target-layer}
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

**motivation** (10 types - ArchiMate 3.2):
assessment, constraint, driver, goal, meaning, outcome, principle, requirement, stakeholder, value

**business** (13 types - ArchiMate 3.2):
actor, collaboration, contract, event, function, interaction, interface, object, process, product, representation, role, service

**security** (15 types - STS-ml):
accountability, actor, authentication, dataclassification, delegation, informationentity, permission, policy, resource, role, securityconstraint, socialdependency, threat

**application** (9 types - ArchiMate 3.2):
collaboration, component, dataobject, event, function, interaction, interface, process, service

**technology** (13 types - ArchiMate 3.2):
artifact, collaboration, communicationnetwork, device, event, function, interaction, interface, node, path, process, service, systemsoftware

**api** (26 types - OpenAPI 3.0.3):
callback, components, contact, encoding, example, external-documentation, header, info, license, link, media-type, oauth-flow, oauth-flows, open-api-document, operation, parameter, path-item, paths, request-body, response, responses, schema, security-scheme, server, server-variable, tag

**data_model** (17 types - JSON Schema Draft 7):
array-schema, data-governance, data-quality-metrics, database-mapping, json-schema, json-type, numeric-schema, object-schema, reference, schema-composition, schema-definition, schema-property, string-schema, x-apm-data-quality-metrics, x-business-object-ref, x-data-governance, x-database

**datastore** (10 types - SQL DDL):
column, constraint, database, database-schema, index, partition, sequence, table, trigger, view

**ux** (26 types - Three-Tier Architecture):
action-component, action-pattern, api-config, chart-series, component-instance, component-reference, condition, data-config, error-config, experience-state, layout-config, library-component, library-sub-view, performance-targets, state-action, state-action-template, state-pattern, state-transition, sub-view, table-column, transition-template, ux-application, ux-library, ux-spec, validation-rule, view

**navigation** (10 types - Multi-Modal):
context-variable, data-mapping, flow-analytics, flow-step, navigation-flow, navigation-guard, navigation-transition, notification-action, process-tracking, route

**apm** (14 types - OpenTelemetry 1.0+):
apm-configuration, attribute, data-quality-metric, data-quality-metrics, instrument-config, instrumentation-scope, log-configuration, log-record, meter-config, metric-configuration, resource, span, span-event, trace-configuration

**testing** (17 types - ISP Coverage Model):
context-variation, coverage-exclusion, coverage-gap, coverage-requirement, coverage-summary, environment-factor, input-partition-selection, input-selection, input-space-partition, outcome-category, partition-dependency, partition-value, target-coverage-summary, target-input-field, test-case-sketch, test-coverage-model, test-coverage-target

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
dr links types --layer api     # Show API → App patterns
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
dr migrate
```

**Common validation errors:**

- Broken references (target doesn't exist)
- Type mismatches (wrong target type)
- Cardinality errors (single vs array)
- Format errors (invalid UUID, path, etc.)

## Need Help?

**DR Helper Agent (v0.4.0+):**

Ask questions and get expert guidance on DR concepts, modeling decisions, and workflows.

**Launch with:** Task tool, agent type: `dr-helper`

**The helper agent can:**

- Explain DR concepts and philosophy
- Guide you through modeling decisions
- Help with CLI commands and workflows
- Assist with upgrades and maintenance
- Explain cross-layer links and validation
- Share best practices and patterns

**DR Ideation Agent (v0.4.0+):**

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
