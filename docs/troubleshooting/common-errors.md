# Troubleshooting Guide: Common Errors & Solutions

This guide helps you resolve the most common issues when using the DR CLI.

## Quick Navigation

- [Element ID Format Issues](#element-id-format-issues)
- [Layer Naming Issues](#layer-naming-issues)
- [Relationship Direction Issues](#relationship-direction-issues)
- [Validation Failures](#validation-failures)
- [CLI Command Issues](#cli-command-issues)
- [Data Consistency Issues](#data-consistency-issues)

---

## Element ID Format Issues

### Issue: "Invalid element ID format"

**Error Message:**
```
✗ Invalid element ID format: user-api.goal.increase-sales
  Expected format: {layer}.{type}.{kebab-case-name}
```

**What Went Wrong:**
You used an invalid layer name in the element ID. Layer names must be one of the 12 canonical names.

**Solution:**

Check your element ID format carefully. It should be:
```
{canonical-layer-name}.{element-type}.{kebab-case-name}
```

Valid layer names are:
- `motivation`, `business`, `security`, `application`, `technology`, `api`
- `data-model` (hyphenated!), `data-store` (hyphenated!)
- `ux`, `navigation`, `apm`, `testing`

**Example:**

Wrong:
```bash
dr add user-api goal increase-sales  # ✗ "user-api" is not a valid layer
dr add api-operation create-user     # ✗ "api-operation" is not a valid layer
```

Correct:
```bash
dr add motivation goal increase-sales         # ✓
dr add api operation create-user               # ✓
dr add data-model object-schema user-profile   # ✓
```

---

### Issue: "Element ID already exists"

**Error Message:**
```
✗ Element with ID 'motivation.goal.increase-sales' already exists
```

**What Went Wrong:**
You're trying to create an element with an ID that already exists in your model.

**Solution:**

Element IDs must be unique across your entire model. Use a different name:

```bash
# Wrong:
dr add motivation goal increase-sales  # Already exists
dr add motivation goal increase-sales  # ✗ Duplicate

# Correct:
dr add motivation goal increase-sales      # ✓
dr add motivation goal improve-user-satisfaction  # ✓ Different name
```

**Finding Duplicates:**
```bash
dr search increase-sales  # Find all elements with this name
```

---

### Issue: "Invalid element type"

**Error Message:**
```
✗ Invalid element type 'operation' for layer 'api'
  Valid types for 'api' layer: operation, endpoint
```

**What Went Wrong:**
You used an element type that doesn't exist for that layer.

**Solution:**

Each layer has specific element types. Check the [Element Type Reference](../ELEMENT_TYPE_REFERENCE.md) for valid types:

**API Layer types:**
- `operation` (REST API operations)
- `endpoint` (API endpoints)

**Application Layer types:**
- `service` (application services)
- `component` (application components)

**Correct usage:**
```bash
dr add api operation create-user           # ✓
dr add application service user-service    # ✓
dr add business capability payment        # ✓
```

---

## Layer Naming Issues

### Issue: "Invalid layer name: data_model"

**Error Message:**
```
✗ Invalid layer name 'data_model'
  Did you mean 'data-model'? (use hyphens, not underscores)
```

**What Went Wrong:**
You used underscores instead of hyphens in the layer name. DR uses **hyphens** for compound layer names.

**Solution:**

Use the correct canonical layer names. Remember:
- **Compound layers use hyphens:** `data-model`, `data-store`
- **Single-word layers:** no hyphens

**Wrong:**
```bash
dr add data_model object-schema user      # ✗ underscore
dr add datastore database postgresql      # ✗ no hyphen, no space
```

**Correct:**
```bash
dr add data-model object-schema user      # ✓
dr add data-store database postgresql     # ✓
```

---

### Issue: "Invalid layer name: data_store"

**Error Message:**
```
✗ Invalid layer name 'data_store'
  Did you mean 'data-store'? (use hyphens, not underscores)
```

**Solution:**

The data storage layer is `data-store`, not `data_store`.

**Correct:**
```bash
dr add data-store database postgresql  # ✓
dr add data-store table users          # ✓
```

---

## Relationship Direction Issues

### Issue: "Invalid relationship direction"

**Error Message:**
```
✗ Invalid relationship: business.capability.x realizes application.service.y
  The 'realizes' relationship requires: application → business
  (services realize capabilities, not the other way around)
```

**What Went Wrong:**
You created a relationship in the wrong direction. Each relationship type has specific allowed directions based on architecture rules.

**Solution:**

Understand the relationship direction rules. Key ones:

| Relationship | Correct Direction | Meaning |
|--------------|-------------------|---------|
| `realizes` | application → business | Services **realize** (implement) business capabilities |
| `satisfied-by` | business → motivation | Capabilities **satisfy** business goals |
| `exposes` | application → api | Services **expose** API operations |
| `uses` | api → data-model | API operations **use** data models |
| `stores` | data-store → data-model | Databases **store** data models |
| `protected-by` | application → security | Services are **protected-by** security policies |
| `complies-with` | application → security | Services **comply-with** regulations |

**Wrong:**
```bash
# Backwards
dr add relationship \
  --from business.capability.order-management \
  --to application.service.order-service \
  --type realizes  # ✗ Wrong direction
```

**Correct:**
```bash
# Correct direction
dr add relationship \
  --from application.service.order-service \
  --to business.capability.order-management \
  --type realizes  # ✓
```

---

### Issue: "Cross-layer reference not found"

**Error Message:**
```
✗ Cannot create relationship: target element 'api.operation.create-user' not found
  Create this element before creating the relationship
```

**What Went Wrong:**
You're trying to create a relationship to an element that doesn't exist.

**Solution:**

Always create elements before creating relationships to them. Check that:
1. The element exists: `dr search create-user`
2. The element ID is correct (matches case, hyphens, etc.)
3. You created it in the correct layer

**Process:**
```bash
# Step 1: Create the element first
dr add api operation create-user \
  --name "Create User" \
  --method "POST" \
  --path "/api/v1/users"

# Step 2: Then create the relationship
dr add relationship \
  --from application.service.user-service \
  --to api.operation.create-user \
  --type exposes
```

---

### Issue: "Relationship type not allowed between layers"

**Error Message:**
```
✗ Relationship type 'exposes' not allowed between 'data-model' and 'api' layers
  Valid relationships for this combination: uses
```

**What Went Wrong:**
You're using a relationship type that's not valid between these two layers.

**Solution:**

Check the valid relationship types for the layer combination. Refer to the relationship types listed below in this guide.

**Common valid relationships:**
- **motivation → business:** `satisfied-by`
- **business → application:** `realizes`
- **application → api:** `exposes`
- **api → data-model:** `uses`
- **data-model → data-store:** `stores`
- **application → security:** `protected-by`

**Wrong:**
```bash
dr add relationship \
  --from api.operation.create-user \
  --to data-model.object-schema.user \
  --type exposes  # ✗ Wrong type for this direction
```

**Correct:**
```bash
dr add relationship \
  --from api.operation.create-user \
  --to data-model.object-schema.user \
  --type uses  # ✓
```

---

## Validation Failures

### Issue: "Model validation failed"

**Error Message:**
```
✗ Model validation failed
  • Element 'api.operation.create-user' references 'data-model.nonexistent' which doesn't exist
  • Relationship 'motivation.goal.x realizes business.capability.y' uses invalid relationship type
  • 3 more issues found
```

**Solution:**

The validation output shows you what's wrong. Address each issue:

1. **Missing references:** Create missing elements
2. **Invalid relationships:** Fix direction or type
3. **Naming issues:** Check element ID format

**Fix process:**
```bash
# 1. Run validation to see all issues
dr validate

# 2. Read the error messages carefully
# 3. Fix each issue one by one
# 4. Run validate again to confirm

# When all issues are fixed:
dr validate
# Output: ✓ Model is valid
```

---

### Issue: "Element has incomplete properties"

**Error Message:**
```
✗ Element 'api.operation.create-user' is missing required properties
  Required: method, path
  Provided: name, description
```

**What Went Wrong:**
You created an element without providing required properties.

**Solution:**

Different element types require different properties. Check what's required:

**API Operation properties:**
- `name` - Human-readable name
- `method` - HTTP method (GET, POST, PUT, DELETE, etc.)
- `path` - URL path (e.g., `/api/v1/users`)
- `description` (optional) - What the operation does

**Correct creation:**
```bash
dr add api operation create-user \
  --name "Create User" \
  --method "POST" \
  --path "/api/v1/users" \
  --description "Creates a new user account"
```

---

## CLI Command Issues

### Issue: "Command not found"

**Error Message:**
```
✗ Unknown command: 'dr create'
  Did you mean 'dr add'?
```

**What Went Wrong:**
You used an invalid command name.

**Solution:**

Check the valid commands:

```bash
dr --help  # Show all available commands

# Common commands:
dr init              # Initialize a new project
dr add               # Add elements or relationships
dr remove            # Remove elements or relationships
dr search            # Search for elements
dr validate          # Validate the model
dr export            # Export the model to different formats
dr info              # Show model information
dr changeset         # Manage changesets for staging
```

---

### Issue: "Missing required parameter"

**Error Message:**
```
✗ Missing required parameter: --from
  Usage: dr add relationship --from <id> --to <id> --type <type>
```

**What Went Wrong:**
You didn't provide all required parameters for the command.

**Solution:**

Check the command syntax. Each command has required parameters:

**Adding elements:**
```bash
dr add <layer> <type> <name> [options]
# Required: layer, type, name
# Optional: --description, --criticality, etc.
```

**Adding relationships:**
```bash
dr add relationship --from <id> --to <id> --type <type>
# Required: --from, --to, --type
```

**Correct usage:**
```bash
# With all required parameters
dr add api operation create-user \
  --name "Create User" \
  --method "POST" \
  --path "/api/v1/users"
```

---

### Issue: "Invalid parameter value"

**Error Message:**
```
✗ Invalid value for parameter --method: 'GETT'
  Valid values: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
```

**What Went Wrong:**
You provided an invalid value for a parameter. In this case, `GETT` is not a valid HTTP method.

**Solution:**

Check the valid values for the parameter:

**HTTP Methods:**
- `GET` - Retrieve data
- `POST` - Create data
- `PUT` - Update entire resource
- `PATCH` - Partial update
- `DELETE` - Remove data
- `HEAD` - Like GET but no body
- `OPTIONS` - Describe communication options

**Criticality levels:**
- `LOW`
- `MEDIUM`
- `HIGH`
- `CRITICAL`

**Correct usage:**
```bash
dr add api operation create-user \
  --method "POST"  # ✓ Valid HTTP method

dr add application service payment-service \
  --criticality "CRITICAL"  # ✓ Valid criticality level
```

---

## Data Consistency Issues

### Issue: "Orphaned element"

**Warning Message:**
```
⚠ Element 'api.operation.old-endpoint' has no incoming or outgoing relationships
  This element is not connected to the rest of the model
```

**What Went Wrong:**
You created an element but didn't create any relationships for it.

**Solution:**

All elements should be connected to the model via relationships. Either:

1. **Create relationships to connect it:**
```bash
dr add relationship \
  --from application.service.user-service \
  --to api.operation.old-endpoint \
  --type exposes
```

2. **Or remove it if not needed:**
```bash
dr remove api.operation.old-endpoint
```

---

### Issue: "Circular dependency detected"

**Error Message:**
```
✗ Circular relationship detected:
  application.service.A → business.capability.B → application.service.A

  Services cannot form circular dependencies with business capabilities
```

**What Went Wrong:**
You created relationships that form a cycle. The architecture should flow from high level (goals) to low level (databases), never circling back.

**Solution:**

Review your relationships and remove the cycle. The correct flow is:
```
Motivation → Business → Security → Application → API → Data Model → Data Store
```

**Example fix:**

Wrong:
```bash
# This creates a cycle:
dr add relationship --from application.service.A --to business.capability.B --type realizes
dr add relationship --from business.capability.B --to application.service.A --type realizes  # ✗ Cycle!
```

Correct:
```bash
# Only goes one direction:
dr add relationship --from application.service.A --to business.capability.B --type realizes  # ✓
# No relationship going back
```

---

## Getting More Help

If you can't find your issue here:

1. **Check the logs:** `dr validate --verbose` for detailed error messages
2. **Review examples:** See the [Quick Start Tutorials](../quick-start/)
3. **Search the docs:** Look for similar issues in guides
4. **Check GitHub:** https://github.com/tinkermonkey/documentation_robotics/issues

---

## Quick Problem-Solving Checklist

Having issues? Work through this checklist:

- [ ] Is the layer name correct? (use hyphens: `data-model`, `data-store`)
- [ ] Is the element ID format correct? (`{layer}.{type}.{name}`)
- [ ] Is the element type valid for that layer?
- [ ] Does the element exist before creating relationships to it?
- [ ] Is the relationship direction correct?
- [ ] Does the relationship type match the layers?
- [ ] Have you run `dr validate` to check for errors?
- [ ] Did you read the error message carefully?

---

Still stuck? Check the [Quick Reference Cheat Sheet](../reference/cheat-sheet.md) for quick syntax reminders.
