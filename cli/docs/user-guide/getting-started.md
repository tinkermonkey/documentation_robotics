# Getting Started with Documentation Robotics CLI

## Quick Start (5 Minutes)

### Prerequisites

- **Python 3.10 or higher**
- **pip** (Python package manager)

### 1. Install

```bash
pip install documentation-robotics
```

### 2. Initialize a New Model

```bash
mkdir my-architecture
cd my-architecture
dr init --name "My Project"
```

This creates:

```
my-architecture/
├── model/              # Your architecture model (12 layers)
├── specs/              # Generated specifications
├── .dr/                # CLI configuration and schemas
├── dr.config.yaml      # Project configuration
└── projection-rules.yaml  # Cross-layer projection rules
```

### 3. Add Your First Elements

#### Add a Goal (Motivation Layer)

```bash
dr add motivation goal \
  --name "Improve Customer Satisfaction" \
  --property description="Increase NPS score to 8.5" \
  --property kpi="NPS >= 8.5"
```

#### Add a Business Service

```bash
dr add business service \
  --name "Order Management" \
  --property description="Manages customer orders" \
  --property supports-goals="motivation.goal.improve-customer-satisfaction"
```

#### Add an Application Service

```bash
dr add application service \
  --name "Order Service" \
  --property description="API for order management" \
  --property realizes="business.service.order-management"
```

### 4. Validate Your Model

```bash
dr validate
```

### 4a. Validate Cross-Layer Links

Ensure all references between layers are valid:

```bash
# Validate schema and links
dr validate --validate-links

# Strict mode (treat warnings as errors)
dr validate --validate-links --strict-links

# List all link types
dr links types

# Validate specific layer
dr links validate --layer 06-api
```

**Why validate links?**

- Ensures references point to valid elements
- Catches typos and broken references early
- Maintains model integrity across layers
- Required for reliable exports and documentation

See [Link Management Guide](link-management.md) for complete link validation documentation.

### 5. View Your Model

```bash
# List all business services
dr list business

# Search for elements
dr search --name "Order*"

# Find a specific element
dr find business.service.order-management
```

### 6. Export Specifications

```bash
# Export to ArchiMate
dr export archimate --output specs/archimate/

# Export to Markdown documentation
dr export markdown --output specs/docs/

# Export all formats
dr export all --output specs/
```

### 7. Working with Spec Versions

Migrate your model to the latest specification version:

```bash
# Check if migration is needed
dr migrate

# Preview migration changes
dr migrate --dry-run

# Apply migration to latest spec version
dr migrate --apply

# Re-validate after migration
dr validate --validate-links --strict-links
```

**When to migrate?**

- After updating the DR CLI to a new version
- When spec introduces new standards or link patterns
- To use new link registry features
- See [Link Management Guide - Migration](link-management.md#migration-from-existing-models)

---

## Core Concepts

### The 11 Layers

Your model is organized into 12 layers, each representing a different architectural concern:

1. **Motivation** (WHY) - Goals, requirements, stakeholders
2. **Business** (WHAT) - Business processes and services
3. **Security** (WHO CAN) - Policies, roles, permissions
4. **Application** (HOW) - Software components and services
5. **Technology** (WITH WHAT) - Infrastructure, platforms, frameworks
6. **API** (INTERFACE) - Service contracts and operations
7. **Data Model** (STRUCTURE) - Logical data structures
8. **Data Store** (STORAGE) - Physical database schemas
9. **UX** (PRESENTATION) - User interfaces and experiences
10. **Navigation** (FLOW) - Navigation between screens
11. **APM/Observability** (OBSERVE) - Metrics, traces, logs

### Element IDs

All elements have unique IDs in the format:

```
{layer}.{type}.{kebab-case-name}
```

Examples:

- `motivation.goal.improve-customer-satisfaction`
- `business.service.order-management`
- `application.service.order-service`

### Relationships

Elements reference each other to show relationships:

```yaml
# Application service realizes business service
id: application.service.order-service
type: service
realizes: business.service.order-management
supports-goals:
  - motivation.goal.improve-customer-satisfaction
```

### Cross-Layer Links

Elements can reference elements in other layers, creating a traceable architecture:

```yaml
# Business service references motivation layer
business:
  service:
    order-management:
      name: "Order Management"
      motivation:
        supports-goals: ["goal.improve-customer-satisfaction"]

# Application service references business layer
application:
  service:
    order-service:
      name: "Order Service"
      business:
        realizes-services: ["business.service.order-management"]
```

**Link Types:**

- **Upward Traceability**: Implementation → Goals (realizes, supports)
- **Security Integration**: Any layer → Security (securedBy, requiredRoles)
- **Observability**: Any layer → APM (instrumentedBy, traces)
- **Data Flow**: API → Data Model (uses, returns)

See [Link Management Guide](link-management.md) for complete reference of 60+ link types.

---

## Common Workflows

### Workflow 0: Using Changesets for Exploration

Work on isolated changes before committing to the main model:

```bash
# 1. Create a changeset for exploration
dr changeset create "api-redesign" --type exploration

# 2. Make changes (all tracked in changeset)
dr add api operation --name "GetOrders"
dr update api.operation.get-orders --set description="Retrieve order list"

# 3. Review changes
dr changeset status --verbose

# 4. Compare with main model
dr changeset diff

# 5. Validate before applying
dr validate

# 6. Apply to main model when satisfied
dr changeset apply --yes

# Or abandon if not satisfied
dr changeset abandon --yes
```

### Workflow 1: Top-Down Design

Start from strategic goals and work down:

```bash
# 1. Define goals
dr add motivation goal --name "Reduce Operational Costs"

# 2. Define business capabilities
dr add business service --name "Automated Fulfillment" \
  --property supports-goals="motivation.goal.reduce-operational-costs"

# 3. Define application services
dr add application service --name "Fulfillment Service" \
  --property realizes="business.service.automated-fulfillment"

# 4. Define APIs
dr add api operation --name "ProcessOrder" \
  --property applicationServiceRef="application.service.fulfillment-service"

# 5. Validate traceability
dr validate --strict
```

### Workflow 2: Bottom-Up Documentation

Document existing systems:

```bash
# 1. Document technology stack
dr add technology system-software --name "PostgreSQL" --property type="database"
dr add technology node --name "App Server" --property type="container"

# 2. Document application components
dr add application component --name "User Service" \
  --property deployedTo="technology.node.app-server"

# 3. Document APIs
dr add api operation --name "GetUser"

# 4. Link to business
dr add business service --name "User Management"
dr update application.component.user-service \
  --set realizes="business.service.user-management"

# 5. Add strategic context
dr add motivation goal --name "Improve User Experience"
dr update business.service.user-management \
  --set supports-goals="motivation.goal.improve-user-experience"
```

### Workflow 3: Cross-Layer Projection

Automatically generate elements across layers:

```bash
# Define projection rules in projection-rules.yaml
# Then project a business service to application layer
dr project business.service.order-management --to application

# Project all business services
dr project-all --from business --to application
```

---

## File Structure

### Model Directory Structure

```
model/
├── 01_motivation/
│   ├── goals.yaml
│   ├── requirements.yaml
│   └── stakeholders.yaml
├── 02_business/
│   ├── services.yaml
│   └── processes.yaml
├── 03_security/
│   ├── policies.yaml
│   └── roles.yaml
└── ...
```

### Element File Format (YAML)

```yaml
# model/02_business/services.yaml
- id: business.service.order-management
  type: service
  name: Order Management
  description: Manages customer orders from creation to fulfillment
  properties:
    supports-goals:
      - motivation.goal.improve-customer-satisfaction
    criticality: high
  documentation: "Full service documentation here..."

- id: business.service.payment-processing
  type: service
  name: Payment Processing
  ...
```

---

## Configuration

### Project Configuration (dr.config.yaml)

```yaml
version: "0.1.0"

paths:
  model: "./model"
  specs: "./specs"
  templates: "./.dr/templates"
  schemas: "./.dr/schemas"

defaults:
  output_format: "yaml"
  validation_mode: "standard"
  auto_project: false

validation:
  strict_naming: true
  require_documentation: false
  check_cross_refs: true
  fail_on_warning: false
```

### Projection Rules (projection-rules.yaml)

```yaml
version: "0.1.0"

projections:
  - name: "business-to-application"
    from: business.service
    to: application.service
    rules:
      - create_type: service
        name_template: "{{source.name}}"
        properties:
          realizes: "{{source.id}}"
          description: "Realizes {{source.name}}"
```

---

## Validation

### Basic Validation

```bash
# Validate entire model
dr validate

# Validate specific layer
dr validate --layer application

# Validate specific element
dr validate --element application.service.order-service
```

### Strict Validation (Spec Conformance)

```bash
dr validate --strict
```

This enables:

- ✅ Upward traceability checking
- ✅ Security integration validation
- ✅ Bidirectional consistency
- ✅ Goal-to-metric traceability

See [Validation Guide](validation.md) for details.

---

## Export Formats

### ArchiMate

```bash
dr export archimate --output specs/archimate/
```

Generates `.archimate` file for tools like Archi, Enterprise Architect.

### OpenAPI

```bash
dr export openapi --output specs/openapi/
```

Generates OpenAPI 3.0 specifications for each service.

### JSON Schema

```bash
dr export json-schema --output specs/schemas/
```

Generates JSON Schema Draft 7 files for data models.

### PlantUML

```bash
dr export plantuml --output specs/diagrams/
```

Generates UML diagrams for visualization.

### Markdown Documentation

```bash
dr export markdown --output specs/docs/
```

Generates comprehensive documentation with traceability matrices.

### GraphML

```bash
dr export graphml --output specs/graph/
```

Generates graph files for tools like yEd, Gephi, Cytoscape.

---

## Tips & Best Practices

### 1. Use Version Control

```bash
git init
git add .
git commit -m "Initial architecture model"
```

### 2. Validate Before Committing

```bash
# Add to .git/hooks/pre-commit
#!/bin/bash
dr validate --strict
if [ $? -ne 0 ]; then
  echo "Validation failed. Commit aborted."
  exit 1
fi
```

### 3. Keep Elements Focused

- One concern per element
- Clear, descriptive names
- Comprehensive descriptions
- Document assumptions

### 4. Maintain Traceability

- Always link implementation to business
- Link business to goals
- Link goals to metrics
- Use `supports-goals`, `fulfills-requirements`, `realizes`

### 5. Use Consistent Naming

- Follow layer conventions
- Use kebab-case for IDs
- Be descriptive but concise
- Avoid abbreviations

### 6. Document as You Go

- Add descriptions to all elements
- Document decisions and rationale
- Link to external documentation
- Keep documentation up-to-date

---

## Next Steps

- [Validation Guide](validation.md) - Deep dive into validation
- [Command Reference](../api-reference/commands.md) - All available commands
- [Examples](../examples/) - See real-world models
- [Spec Reference](../../spec/README.md) - Full spec documentation

---

## Getting Help

### View Command Help

```bash
dr --help
dr add --help
dr validate --help
```

### Check Conformance

```bash
dr conformance
```

### Troubleshooting

See [Troubleshooting Guide](troubleshooting.md) for common issues and solutions.

### Community

- GitHub: https://github.com/tinkermonkey/documentation_robotics
- Issues: https://github.com/tinkermonkey/documentation_robotics/issues
- Discussions: https://github.com/tinkermonkey/documentation_robotics/discussions
