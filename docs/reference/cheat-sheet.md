# DR CLI Quick Reference Cheat Sheet

Fast lookup for common commands, syntax, and patterns.

## Command Quick Reference

### Project Initialization

```bash
dr init <project-name>              # Initialize new DR project
dr info                              # Show model information
dr validate                          # Validate entire model
```

### Adding Elements

```bash
# Basic syntax
dr add <layer> <type> <name> [--options]

# Examples
dr add motivation goal improve-quality
dr add business capability order-management
dr add application service user-service --criticality HIGH
dr add api operation create-user --method POST --path /api/v1/users
dr add data-model object-schema user-profile
dr add data-store database postgresql
dr add security authentication-policy oauth2
```

### Adding Relationships

```bash
# Syntax
dr add relationship --from <source-id> --to <target-id> --type <type>

# Example
dr add relationship \
  --from application.service.user-service \
  --to business.capability.user-management \
  --type realizes
```

### Searching & Viewing

```bash
dr search <query>                   # Search for elements
dr list <layer>                     # List all elements in layer
```

### Removing Elements

```bash
dr remove <element-id>              # Remove element
```

### Exporting

```bash
dr export openapi                   # Export to OpenAPI
dr export plantuml                  # Export to PlantUML diagram
dr export markdown                  # Export to Markdown docs
```

---

## Canonical Layer Names

**Always use these exact names:**

| Layer | Canonical Name | Example                                     |
| ----- | -------------- | ------------------------------------------- |
| 1     | `motivation`   | `dr add motivation goal ...`                |
| 2     | `business`     | `dr add business capability ...`            |
| 3     | `security`     | `dr add security authentication-policy ...` |
| 4     | `application`  | `dr add application service ...`            |
| 5     | `technology`   | `dr add technology platform ...`            |
| 6     | `api`          | `dr add api operation ...`                  |
| 7     | `data-model`   | `dr add data-model object-schema ...`       |
| 8     | `data-store`   | `dr add data-store database ...`            |
| 9     | `ux`           | `dr add ux component ...`                   |
| 10    | `navigation`   | `dr add navigation page ...`                |
| 11    | `apm`          | `dr add apm metric ...`                     |
| 12    | `testing`      | `dr add testing test-case ...`              |

**Key Rules:**

- ✅ Use hyphens for compound names: `data-model`, `data-store`
- ✅ Use lowercase
- ❌ Don't use underscores: `data_model` is wrong
- ❌ Don't use spaces

---

## Element ID Format

**Format:** `{layer}.{type}.{kebab-case-name}`

**Examples:**

```
motivation.goal.improve-customer-satisfaction
business.capability.order-management
application.service.payment-service
api.operation.create-user
data-model.object-schema.user-profile
data-store.database.postgresql
security.authentication-policy.oauth2
```

**Rules:**

- Layer: Canonical name (see above)
- Type: Element type (lowercase)
- Name: Kebab-case (words separated by hyphens)
- Must be unique across entire model

---

## Common Element Types by Layer

| Layer       | Types                                                        |
| ----------- | ------------------------------------------------------------ |
| motivation  | goal, requirement, constraint                                |
| business    | capability, service, process                                 |
| security    | authentication-policy, authorization-policy, data-protection |
| application | service, component                                           |
| technology  | platform, infrastructure, framework                          |
| api         | operation, endpoint                                          |
| data-model  | object-schema, field, constraint                             |
| data-store  | database, table, index                                       |
| ux          | page, component, flow                                        |
| navigation  | page, link, menu                                             |
| apm         | metric, trace, log                                           |
| testing     | test-case, test-plan, test-data                              |

---

## Relationship Types Quick Reference

### Common Relationships

| Relationship    | Valid Directions          | Meaning                            |
| --------------- | ------------------------- | ---------------------------------- |
| `realizes`      | application → business    | Services implement capabilities    |
| `satisfied-by`  | business → motivation     | Capabilities satisfy goals         |
| `exposes`       | application → api         | Services expose operations         |
| `uses`          | api → data-model          | Operations use data models         |
| `stores`        | data-store → data-model   | Databases store models             |
| `protected-by`  | application → security    | Services are protected by policies |
| `complies-with` | application → security    | Services comply with regulations   |
| `depends-on`    | application → application | Service dependencies               |
| `monitors`      | apm → application         | Metrics monitor services           |
| `validates`     | testing → application     | Tests validate services            |

### Relationship Direction Rule

- Always flows from implementation toward abstraction
- Cannot go backwards (no circular dependencies)
- API → Data Model → Database (never reverse)
- Application → Business → Motivation (never reverse)

---

## HTTP Methods (for API Operations)

```bash
GET     # Retrieve data
POST    # Create new resource
PUT     # Replace entire resource
PATCH   # Partial update
DELETE  # Remove resource
HEAD    # Like GET but no body
OPTIONS # Describe communication options
```

---

## Common Parameters

### Element Properties

```bash
--name "Human Readable Name"        # Display name
--description "What this does"      # Description
--criticality HIGH|MEDIUM|LOW|CRITICAL  # Importance level
```

### API Operation Properties

```bash
--method GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS
--path "/api/v1/resource"
--description "What this endpoint does"
```

### Data Model Field Properties

```bash
--data-type string|number|boolean|object|array|etc
--is-required true|false
--is-key true|false
```

---

## Common Command Patterns

### Complete REST API Workflow

```bash
# 1. Create project
dr init my-api

# 2. Add motivation
dr add motivation goal improve-efficiency

# 3. Add business
dr add business capability order-management

# 4. Link: business satisfies motivation
dr add relationship \
  --from business.capability.order-management \
  --to motivation.goal.improve-efficiency \
  --type satisfied-by

# 5. Add application
dr add application service order-service

# 6. Link: application realizes business
dr add relationship \
  --from application.service.order-service \
  --to business.capability.order-management \
  --type realizes

# 7. Add API
dr add api operation create-order \
  --method POST --path /api/v1/orders

# 8. Link: application exposes API
dr add relationship \
  --from application.service.order-service \
  --to api.operation.create-order \
  --type exposes

# 9. Add data
dr add data-model object-schema order

# 10. Link: API uses data
dr add relationship \
  --from api.operation.create-order \
  --to data-model.object-schema.order \
  --type uses

# 11. Validate
dr validate
```

### Add Security Controls

```bash
# Create security policy
dr add security authentication-policy oauth2

# Link to service
dr add relationship \
  --from application.service.order-service \
  --to security.authentication-policy.oauth2 \
  --type protected-by
```

### Create Microservice

```bash
# Service
dr add application service inventory-service

# Link to capability
dr add relationship \
  --from application.service.inventory-service \
  --to business.capability.inventory-management \
  --type realizes

# Multiple endpoints
dr add api operation list-items --method GET --path /api/v1/items
dr add api operation create-item --method POST --path /api/v1/items

# Link to service
dr add relationship --from application.service.inventory-service --to api.operation.list-items --type exposes
dr add relationship --from application.service.inventory-service --to api.operation.create-item --type exposes

# Data model
dr add data-model object-schema item

# Link to API
dr add relationship --from api.operation.list-items --to data-model.object-schema.item --type uses
dr add relationship --from api.operation.create-item --to data-model.object-schema.item --type uses

# Database
dr add data-store database inventory-db

# Link to data
dr add relationship --from data-store.database.inventory-db --to data-model.object-schema.item --type stores
```

---

## Troubleshooting Quick Fix

| Problem                        | Solution                                                      |
| ------------------------------ | ------------------------------------------------------------- |
| "Invalid layer name"           | Check hyphens: use `data-model` and `data-store`              |
| "Invalid element ID format"    | Check format: `{layer}.{type}.{kebab-case}`                   |
| "Element not found"            | Create element before creating relationships to it            |
| "Invalid relationship type"    | Check relationship is allowed for these layers                |
| "Relationship direction wrong" | Remember: higher → lower layers, implementation → abstraction |
| "Element already exists"       | Use a different name or kebab-case format                     |

---

## File Structure

When you create a project, you get:

```
my-project/
├── .dr/
│   ├── manifest.json                # Project metadata
│   └── layers/                      # Layer data files
│       ├── motivation.json
│       ├── business.json
│       ├── security.json
│       ├── application.json
│       ├── technology.json
│       ├── api.json
│       ├── data-model.json
│       ├── data-store.json
│       ├── ux.json
│       ├── navigation.json
│       ├── apm.json
│       └── testing.json
└── documentation-robotics/          # Your documentation
```

---

## Criticality Levels

Use to mark importance of services and operations:

```
LOW         # Non-essential, can be unavailable
MEDIUM      # Important but not critical
HIGH        # Important, should be available
CRITICAL    # Essential, must always be available
```

**Example:**

```bash
dr add application service payment-service --criticality CRITICAL
dr add application service logging-service --criticality MEDIUM
```

---

## Common Mistakes & Fixes

**Mistake 1: Underscore instead of hyphen**

```bash
# ❌ Wrong
dr add data_model object-schema user

# ✅ Correct
dr add data-model object-schema user
```

**Mistake 2: Element name with spaces**

```bash
# ❌ Wrong
dr add motivation goal improve customer satisfaction

# ✅ Correct
dr add motivation goal improve-customer-satisfaction
```

**Mistake 3: Relationship in wrong direction**

```bash
# ❌ Wrong (backwards)
dr add relationship \
  --from business.capability.x \
  --to application.service.y \
  --type realizes

# ✅ Correct
dr add relationship \
  --from application.service.y \
  --to business.capability.x \
  --type realizes
```

**Mistake 4: Relationship to non-existent element**

```bash
# ❌ Wrong (element doesn't exist)
dr add relationship \
  --from application.service.x \
  --to api.operation.nonexistent \
  --type exposes

# ✅ Correct (create element first)
dr add api operation nonexistent --method GET --path /api/v1/test
dr add relationship \
  --from application.service.x \
  --to api.operation.nonexistent \
  --type exposes
```

---

## Next Steps

- **Full Tutorials:** See [Quick Start Guide](../quick-start/)
- **Detailed Help:** See [Troubleshooting Guide](../troubleshooting/common-errors.md)
- **Complete Examples:** See [Microservices Tutorial](../quick-start/02-microservices.md)

---

**Pro Tip:** Save this page as a bookmark for quick reference while working!
