# Validation Guide

## Overview

The Documentation Robotics CLI provides comprehensive validation capabilities to ensure your architecture model conforms to the Federated Architecture Metadata Model specification (v0.1.0).

## Validation Levels

### Basic Validation (Default)

Run basic validation with:

```bash
dr validate
```

This performs:

- ✅ Schema validation for each layer
- ✅ Cross-layer reference checking
- ✅ Semantic validation (11 rules)

### Strict Validation (Full Spec Compliance)

Run comprehensive validation with:

```bash
dr validate --strict
```

This performs all basic validation plus:

- ✅ Upward traceability validation
- ✅ Security integration checking
- ✅ Bidirectional consistency validation
- ✅ Goal-to-metric traceability

## Validators

### 1. Schema Validation

**What it checks**: Ensures each element conforms to its layer's JSON Schema.

**Example error**:

```
✗ [application] application.service.payment-service: Missing required property 'name'
   Fix: Add 'name' property to the element
```

**How to fix**: Add all required properties defined in the schema for that element type.

---

### 2. Cross-Layer Reference Validation

**What it checks**: Ensures all element ID references point to existing elements.

**Example error**:

```
✗ [application] application.service.order-service: References non-existent element 'business.service.invalid-id'
   Fix: Ensure referenced element exists or correct the reference
```

**How to fix**: Create the referenced element or update the reference to point to a valid element ID.

---

### 3. Semantic Validation (11 Rules)

**What it checks**: Validates that relationships between layers make semantic sense.

#### Rule 1: Business Service Realization

**Check**: Business services should be realized by application services.

**Example warning**:

```
⚠  [business] business.service.customer-management: Not realized by any application service
```

**How to fix**: Create an application service with `realizes: business.service.customer-management`.

#### Rule 2: API Operation Application Service

**Check**: API operations should reference application services.

**Example warning**:

```
⚠  [api] api.operation.get-users: Does not reference an application service
```

**How to fix**: Add `applicationServiceRef: application.service.user-service` property.

#### Rule 3: UX Screen API Operations

**Check**: UX screens should reference API operations.

**Example warning**:

```
⚠  [ux] ux.screen.dashboard: Does not reference any API operations
```

**How to fix**: Add API operation references in screen actions with `operationId` properties.

#### Rule 4: Security Resource Application Element

**Check**: Security resources should reference application elements.

**Example warning**:

```
⚠  [security] security.resource.user-api: Does not reference any application element
```

**How to fix**: Add `archimateRef: application.service.user-service`.

#### Rule 5: Data Flow Consistency

**Check**: Data model schemas should be implemented by datastore tables.

**Example warning**:

```
⚠  [data_model] data_model.schema.user: Not implemented by any datastore table
```

**How to fix**: Create a table with `x-json-schema: data_model.schema.user`.

#### Rule 6: Technology Stack Alignment

**Check**: Technology nodes should host application components.

**Example warning**:

```
⚠  [technology] technology.node.web-server: Does not host any application components
```

**How to fix**: Add `deployedTo: technology.node.web-server` to application components.

#### Rule 7: Navigation Completeness

**Check**: UX screens should have corresponding navigation routes.

**Example warning**:

```
⚠  [ux] ux.screen.profile: Lacks corresponding navigation route
```

**How to fix**: Create a route in the navigation layer with `uxRef: ux.screen.profile`.

#### Rule 8: APM Coverage

**Check**: Critical services should have observability traces.

**Example warning**:

```
⚠  [application] application.service.payment-service: Critical service lacks APM observability traces
```

**How to fix**: Create APM traces with `instruments: application.service.payment-service`.

#### Rule 9: Stakeholder Coverage

**Check**: Business goals should have assigned stakeholders.

**Example warning**:

```
⚠  [motivation] motivation.goal.increase-revenue: Lacks assigned stakeholder or owner
```

**How to fix**: Add `stakeholder: motivation.stakeholder.ceo` property.

#### Rule 10: Deployment Mapping

**Check**: Application components should be deployed to technology nodes.

**Example warning**:

```
⚠  [application] application.component.user-service: Lacks deployment mapping to technology layer
```

**How to fix**: Add `deployedTo: technology.node.app-server`.

#### Rule 11: Data Store Integrity

**Check**: Database tables should have primary keys.

**Example warning**:

```
⚠  [datastore] datastore.table.users: Lacks primary key definition
```

**How to fix**: Add a primary key constraint to the table definition.

---

### 4. Upward Traceability Validation (--strict only)

**What it checks**: Ensures implementation elements trace back to motivation layer (goals, requirements).

**Example warning**:

```
⚠  [application] application.service.user-service: Lacks traceability to motivation.goal
   Fix: Add 'supports-goals' property referencing a motivation.goal element
```

**How to fix**: Add upward references:

- Application elements → `supports-goals`, `fulfills-requirements`
- Business elements → `supports-goals`, `fulfills-requirements`
- API elements → via application service references

---

### 5. Security Integration Validation (--strict only)

**What it checks**: Ensures security policies are enforced across layers.

#### Public API Operations

**Check**: API operations should have authentication schemes.

**Example warning**:

```
⚠  [api] api.operation.create-order: Lacks security scheme
   Fix: Add 'security' or 'x-security-policy-refs' property
```

**How to fix**: Add security definition:

```yaml
security:
  - bearerAuth: []
```

#### UX Component Security

**Check**: Protected UX elements should reference security policies.

**Example warning**:

```
⚠  [ux] ux.screen.admin-panel: Requires authentication but lacks specific security policy
   Fix: Add 'requiredRoles' or 'securityPolicy' property
```

**How to fix**: Add security requirements:

```yaml
requiredRoles:
  - admin
  - superuser
```

#### Data Security Classification

**Check**: Sensitive data should have security classifications.

**Example warning**:

```
⚠  [data_model] data_model.schema.user: Contains PII fields but lacks security classification
   Fix: Add 'x-security-classification' with value like 'pii', 'confidential', 'public'
```

**How to fix**: Add classification:

```yaml
x-security-classification: pii
```

---

### 6. Bidirectional Consistency Validation (--strict only)

**What it checks**: Ensures relationships are consistent in both directions.

**Example warning**:

```
⚠  Inconsistent realization relationship:
   'application.service.user-service' realizes 'business.service.user-management',
   but 'business.service.user-management' does not list 'application.service.user-service' in realizedBy
   Fix: Add 'application.service.user-service' to realizedBy property
```

**How to fix**: Add the reverse reference:

```yaml
# In business.service.user-management
realizedBy:
  - application.service.user-service
```

**Supported Relationship Pairs**:

- `realizes` ⟷ `realizedBy`
- `serves` ⟷ `servedBy`
- `accesses` ⟷ `accessedBy`
- `uses` ⟷ `usedBy`
- `implements` ⟷ `implementedBy`
- `deployedTo` ⟷ `hosts`
- `instruments` ⟷ `instrumentedBy`

---

### 7. Goal-to-Metric Traceability (--strict only)

**What it checks**: Ensures strategic goals are measurable through APM metrics.

#### Goals with KPIs

**Check**: Goals should have measurable outcomes defined.

**Example warning**:

```
⚠  [motivation] motivation.goal.improve-performance: Lacks KPI or outcome definition
   Fix: Add 'kpi', 'outcome', or 'measurableOutcome' property
```

**How to fix**: Add KPI definition:

```yaml
kpi:
  metric: "Response time"
  target: "< 200ms"
  unit: "milliseconds"
```

#### Goals with Metrics

**Check**: Goals should be measured by APM metrics.

**Example warning**:

```
⚠  [motivation] motivation.goal.reduce-costs: Not measured by any APM metrics
   Fix: Create APM metric with 'measures-goal' property referencing this goal
```

**How to fix**: Create metric:

```yaml
# In APM layer
id: apm.metric.cost-savings
type: metric
name: Cost Savings
measures-goal: motivation.goal.reduce-costs
```

---

## Validation Output

### Text Format (Default)

```
Validating model...

Validation Summary
┌─────────────┬──────────┬────────┬──────────┬────────┐
│ Layer       │ Elements │ Errors │ Warnings │ Status │
├─────────────┼──────────┼────────┼──────────┼────────┤
│ motivation  │        5 │      0 │        2 │   ✓    │
│ business    │        8 │      0 │        1 │   ✓    │
│ application │       12 │      0 │        3 │   ✓    │
└─────────────┴──────────┴────────┴──────────┴────────┘

Warnings:
  ⚠  [motivation] motivation.goal.g1: Lacks assigned stakeholder or owner
  ⚠  [business] business.service.bs1: Not realized by any application service
  ⚠  [application] application.service.as1: Lacks traceability to motivation.goal

✓ Validation passed
```

### JSON Format

```bash
dr validate --output json
```

```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    {
      "layer": "motivation",
      "element_id": "motivation.goal.g1",
      "message": "Lacks assigned stakeholder or owner",
      "suggestion": "Add 'stakeholder' property"
    }
  ]
}
```

---

## Best Practices

### 1. Validate Early and Often

Run validation after every significant change:

```bash
# After adding elements
dr add business service --name "User Management"
dr validate

# After updating
dr update business.service.user-management --set description="Manages users"
dr validate
```

### 2. Start with Basic, Move to Strict

- Use basic validation during development
- Use strict validation before commits/releases
- Use strict validation for CI/CD pipelines

### 3. Fix Errors First, Then Warnings

- **Errors** prevent spec conformance - fix immediately
- **Warnings** are recommendations - fix when feasible

### 4. Use Validation in CI/CD

```yaml
# .github/workflows/validate.yml
steps:
  - name: Validate Model
    run: |
      dr validate --strict
      if [ $? -ne 0 ]; then
        echo "Model validation failed"
        exit 1
      fi
```

### 5. Layer-Specific Validation

Validate a single layer:

```bash
dr validate --layer application
```

### 6. Element-Specific Validation

Validate a specific element:

```bash
dr validate --element application.service.user-service
```

---

## Troubleshooting

### "Schema file not found"

**Problem**: Schema files missing from `.dr/schemas/`

**Solution**: Schemas should auto-copy during `dr init`. If missing:

1. Re-run `dr init` in a new directory
2. Copy schemas from another project
3. Copy from spec repository

### "Too many warnings"

**Problem**: Strict validation produces many warnings

**Solution**: This is expected for new/partial models. Focus on:

1. Fix critical errors first
2. Establish traceability paths
3. Add security policies
4. Incrementally improve quality

### "Circular dependency detected"

**Problem**: Elements reference each other in a loop

**Solution**: Review your architecture:

1. Identify the circular path
2. Determine if it's a design issue
3. Break the cycle with proper layering
4. Use projection/realization instead

---

## Next Steps

- [Schema Guide](schemas.md) - Understanding layer schemas
- [Examples](../examples/) - See validation in action
- [API Reference](../api-reference/validators.md) - Validator details
