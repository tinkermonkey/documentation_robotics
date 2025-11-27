---
description: Automatically create architecture elements across layers using projection rules
argument-hint: "<source>→<target> [--element <id>] [--dry-run]"
---

# Automated Cross-Layer Projection

Automatically create architecture elements across layers using projection rules.

## What This Command Does

1. Loads projection rules from `projection-rules.yaml`
2. Finds matching source elements
3. Applies transformation rules
4. Creates projected elements in target layer(s)
5. Establishes cross-layer references
6. Validates projected elements
7. Reports results with summary

## Usage

```
/dr-project <source>→<target> [--element <id>] [--dry-run]
```

## Instructions for Claude Code

This command automates the creation of elements across layers based on defined projection rules.

### Step 1: Parse the Request

Extract projection parameters:

**Format patterns:**

- `business→application` - Project all business elements to application
- `business.service.orders→application` - Project specific element
- `business→application,api` - Project to multiple layers
- `application→*` - Project to all applicable layers

**Examples:**

```
/dr-project business→application
/dr-project business.service.payment→application
/dr-project application→api,data_model
/dr-project business→application --dry-run
```

### Step 2: Validate Prerequisites

Check that projection rules exist:

```bash
ls -la projection-rules.yaml 2>/dev/null
```

If not found:

```
Projection rules not found.

I can:
1. Create default projection rules
2. Show you an example rules file
3. Skip projection (use manual creation instead)

What would you prefer?
```

If user wants default rules, create them:

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
          description: "Implements {{source.name}}"

  - name: "application-to-api"
    from: application.service
    to: api.operation
    rules:
      - create_type: operation
        name_template: "{{source.name_kebab}}-api"
        properties:
          path: "/api/v1/{{source.name_kebab}}"
          applicationServiceRef: "{{source.id}}"
```

### Step 3: Find Source Elements

Determine what to project:

**If specific element ID provided:**

```bash
dr find <element-id>
```

**If projecting all elements:**

```bash
dr list <source-layer> <source-type>
```

Display what will be projected:

```
Source Elements:
================

Found 3 business services to project:
1. business.service.order-management
2. business.service.payment-processing
3. business.service.inventory-management

Target: application layer
```

### Step 4: Preview Projection (if --dry-run)

Show what would be created without actually creating:

```bash
dr project <source> --to <target> --dry-run
```

Present preview:

```
Projection Preview (Dry Run)
============================

business.service.order-management → application layer:
  Will create:
  ✓ application.service.order-management
    - realizes: business.service.order-management
    - description: "Implements Order Management"

business.service.payment-processing → application layer:
  Will create:
  ✓ application.service.payment-processing
    - realizes: business.service.payment-processing
    - description: "Implements Payment Processing"
    - criticality: critical (inherited)

business.service.inventory-management → application layer:
  Will create:
  ✓ application.service.inventory-management
    - realizes: business.service.inventory-management
    - description: "Implements Inventory Management"

Total: 3 elements will be created

Proceed with projection?
```

### Step 5: Execute Projection

Run the projection command:

**Single element:**

```bash
dr project <element-id> --to <target-layer>
```

**All matching elements:**

```bash
dr project-all --from <source-layer> --to <target-layer> --type <type>
```

Monitor and report progress:

```
Projecting Elements
===================

Progress: [▓▓▓▓▓▓▓░░░] 70% (7/10)

✓ business.service.order-management → application.service.order-management
✓ business.service.payment-processing → application.service.payment-processing
✓ business.service.inventory-management → application.service.inventory-management
...
```

### Step 6: Validate Projections

After projection, validate:

```bash
dr validate --layer <target-layer> --format json
```

Check for issues:

```
Validation Results
==================

✓ All projected elements valid

Cross-Layer References:
✓ 3 realizes references created
✓ All references validated

Element Quality:
✓ All have descriptions
✓ All have proper IDs
⚠ 1 missing security policy (non-critical)
```

### Step 7: Provide Summary

Show comprehensive summary:

```
Projection Complete!
====================

Summary:
✓ Projected 3 business services → application layer
✓ Created 3 new application services
✓ Established 3 cross-layer references
✓ Validation passed

Created Elements:
1. application.service.order-management
   - realizes: business.service.order-management
   - Location: documentation-robotics/model/04_application/services.yaml:15

2. application.service.payment-processing
   - realizes: business.service.payment-processing
   - Properties inherited: criticality=critical
   - Location: documentation-robotics/model/04_application/services.yaml:28

3. application.service.inventory-management
   - realizes: business.service.inventory-management
   - Location: documentation-robotics/model/04_application/services.yaml:41

Next Steps:
1. Review projected elements: dr find application.service.*
2. Add deployment info: /dr-model Add deployment nodes
3. Create API layer: /dr-project application→api
4. Add security: /dr-model Add security policies
```

## Advanced Projection Scenarios

### Scenario 1: Conditional Projection

Project only elements meeting conditions:

```
User: /dr-project business→application (critical only)

You:
Checking projection rules for conditions...

Found rule with condition:
  - field: properties.criticality
  - operator: equals
  - value: critical

Matching elements:
✓ business.service.payment-processing (critical)
✓ business.service.order-management (critical)
✗ business.service.reporting (medium) - skipped

Projecting 2 critical services...
```

### Scenario 2: Multi-Layer Projection

Project to multiple target layers:

```
User: /dr-project business.service.payment→application,api,data_model

You:
Multi-layer projection:

business.service.payment-processing →
  1. application.service.payment-processing
  2. api.operation.payment-api
  3. data_model.schema.payment

Checking projection rules for each layer...

Found rules:
✓ business→application (standard rule)
✓ application→api (will chain)
⚠ application→data_model (no direct rule, will infer)

Proceed with 3-layer projection?
```

### Scenario 3: Chained Projection

Project through multiple layers:

```
User: /dr-project business.service.orders→application→api

You:
Chained projection:

Step 1: business → application
  ✓ Created application.service.order-management

Step 2: application → api
  ✓ Created api.operation.order-management-api

Result: 2 new elements with full traceability:
business.service.order-management
  ↓ realizes
application.service.order-management
  ↓ exposes
api.operation.order-management-api
```

### Scenario 4: Custom Property Mapping

Handle complex property transformations:

```
Projection includes property mapping:

Source: business.service.payment-processing
  - criticality: critical
  - owner: business.actor.finance-team
  - sla: "99.9%"

Projection rule transforms:
  ✓ criticality: critical → critical (pass through)
  ✓ owner: → deployed_by: devops.team.platform (mapped)
  ✓ sla: "99.9%" → availability_target: 0.999 (transformed)

Result: application.service.payment-processing
  - criticality: critical
  - deployed_by: devops.team.platform
  - availability_target: 0.999
```

## Handling Edge Cases

### Case 1: Target Already Exists

```
Warning: Projection target already exists

Target: application.service.order-management
Status: Already exists in model

Options:
1. Skip (keep existing)
2. Update (merge properties)
3. Replace (overwrite)
4. Rename (create as order-management-2)

What should I do?
```

### Case 2: Missing Referenced Elements

```
Error: Projection references non-existent element

Rule tries to reference:
  security.policy.default-auth

But it doesn't exist in the model.

Options:
1. Create the missing element first
2. Skip this reference
3. Use alternative reference
4. Abort projection

Your choice?
```

### Case 3: Conflicting Rules

```
Warning: Multiple projection rules match

Source: business.service.orders
Matching rules:
  1. business-to-application (standard)
  2. critical-business-to-application (for critical services)

Both rules apply. Which should I use?
  - Rule 1: Standard projection
  - Rule 2: Enhanced projection with extra properties
  - Both: Create 2 elements (not recommended)
```

### Case 4: Invalid Projection Rule

```
Error: Projection rule has invalid template

Rule: business-to-application
Template: "{{source.nonexistent_field}}"
Issue: Field 'nonexistent_field' doesn't exist

Available fields:
- source.id
- source.name
- source.description
- source.layer
- source.type
- source.properties.*

Fix the rule in projection-rules.yaml
```

## Projection Rule Patterns

### Pattern 1: Simple Projection

```yaml
- name: "business-to-application"
  from: business.service
  to: application.service
  rules:
    - create_type: service
      name_template: "{{source.name}}"
      properties:
        realizes: "{{source.id}}"
```

Usage: `/dr-project business→application`

### Pattern 2: Conditional Projection

```yaml
- name: "critical-services-monitoring"
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

Usage: `/dr-project application→apm` (only critical services)

### Pattern 3: Property Transformation

```yaml
- name: "app-to-api-with-security"
  from: application.service
  to: api.operation
  rules:
    - create_type: operation
      name_template: "{{source.name_kebab}}-api"
      properties:
        path: "/api/v1/{{source.name_kebab}}"
        method: "POST"
        securedBy: ["security.scheme.oauth2"]
        applicationServiceRef: "{{source.id}}"
```

Usage: `/dr-project application→api`

### Pattern 4: Bidirectional References

```yaml
- name: "business-to-app-bidirectional"
  from: business.service
  to: application.service
  rules:
    - create_type: service
      name_template: "{{source.name}}"
      properties:
        realizes: "{{source.id}}"
      create_bidirectional: true # Also updates business service
```

Creates references in both directions automatically.

## Testing Projections

### Test Pattern 1: Dry Run First

```
User: /dr-project business→application --dry-run

You: [Shows preview without changes]

User: Looks good, let's do it

You: /dr-project business→application
```

### Test Pattern 2: Single Element Test

```
User: /dr-project business.service.test-service→application

You: Testing projection with single element...

✓ Success! Created application.service.test-service

Looks good? I can now project all business services.
```

### Test Pattern 3: Validate After Each

```
Projecting with validation checkpoints...

✓ Projected business.service.orders
  └─ Validating... ✓

✓ Projected business.service.payments
  └─ Validating... ✓

✓ Projected business.service.shipping
  └─ Validating... ✓

All projections validated successfully!
```

## Error Recovery

### Error: Projection Failed Midway

```
Error: Projection failed after 5/10 elements

Completed:
✓ business.service.orders → application.service.orders
✓ business.service.payments → application.service.payments
✓ business.service.shipping → application.service.shipping
✓ business.service.inventory → application.service.inventory
✓ business.service.returns → application.service.returns

Failed at:
✗ business.service.pricing
  Error: Invalid property reference

Remaining: 4 elements not projected

Options:
1. Fix the error and retry remaining
2. Skip failed element and continue
3. Rollback all changes
```

### Error: Validation Failed

```
Projection completed but validation failed:

Created 10 elements, but found issues:
❌ 2 elements have broken references
⚠️  3 elements missing required properties

Options:
1. Auto-fix issues: /dr-validate --fix
2. Manual review and fix
3. Rollback projection

Recommendation: Try auto-fix first
```

## Example Interactions

### Example 1: Simple Projection

```
User: /dr-project business→application

You:
Loading projection rules...

Found 5 business services:
1. order-management
2. payment-processing
3. inventory-management
4. shipping-service
5. customer-service

Projecting to application layer...

✓ Complete! Created 5 application services.
✓ All references validated.

View results: dr list application service
```

### Example 2: With Preview

```
User: /dr-project business→application --dry-run

You:
Projection Preview:

Will create 5 application services:
1. application.service.order-management
   - realizes: business.service.order-management
2. application.service.payment-processing
   - realizes: business.service.payment-processing
   - criticality: critical (inherited)
[... 3 more ...]

No changes made (dry run).

Run without --dry-run to apply changes.
```

### Example 3: Multi-Target

```
User: /dr-project application→api,data_model

You:
Multi-layer projection:

Step 1: Application → API
  ✓ Created 5 API operations

Step 2: Application → Data Model
  ✓ Created 5 data schemas

Total: 10 new elements with full traceability

Next: Add security to APIs
/dr-model Add authentication to API operations
```

## Related Commands

- `/dr-init` - Initialize model with projection rules
- `/dr-model` - Manually create elements
- `/dr-validate` - Validate projections
- `dr project --help` - CLI projection options
