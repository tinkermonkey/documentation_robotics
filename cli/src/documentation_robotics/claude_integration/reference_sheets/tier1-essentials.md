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
9. **ux** - Screens, components, flows (PRESENTATION)
10. **navigation** - Routes, menus, guards (FLOW)
11. **apm** - Metrics, logs, traces (OBSERVE)

## Essential CLI Commands

```bash
# Query elements
dr find {element-id}                  # Get specific element
dr list {layer} {type}                # List all of type
dr search {pattern}                   # Search across layers

# Modify elements
dr add {layer} {type} --name "..." --property key=value
dr update {element-id} --property key=value

# Validate & export
dr validate --strict                  # Full validation
dr export --format {archimate|markdown|plantuml}

# Cross-layer operations
dr project {source-layer}→{target-layer} [--element-id id]
```

## Key Cross-Layer Patterns

**Traceability (bottom-up):**

```yaml
properties:
  realizes: business.service.order-mgmt # App → Business
  supports-goals: [motivation.goal.improve-ux] # Business → Goals
```

**Security (cross-cutting):**

```yaml
properties:
  securedBy: [security.policy.authenticated-access]
```

**Observability (cross-cutting):**

```yaml
properties:
  instrumentedBy: [apm.metric.service-availability]
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

## Common Entity Types by Layer

- **motivation**: Goal, Requirement, Stakeholder
- **business**: BusinessService, BusinessProcess, BusinessActor
- **application**: ApplicationService, ApplicationComponent
- **api**: Operation (OpenAPI paths/operations)
- **data_model**: Schema (JSON Schema entities)
- **datastore**: Database, Table, Column

## Need More Detail?

- Tier 2 Guide: `.claude/knowledge/dr-tier2-developer-guide.md`
- Full Reference: `.claude/knowledge/dr-tier3-complete-reference.md`
- Documentation: Run `dr --help` or check `/cli/docs/`
