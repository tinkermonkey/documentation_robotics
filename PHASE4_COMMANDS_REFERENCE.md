# Phase 4: Trace and Project Commands Reference

## Overview
Phase 4 introduces two powerful commands for dependency analysis and cross-layer projection in the Documentation Robotics architecture model.

## Command 1: Trace

### Purpose
Displays the complete dependency trace for an element, showing:
- Elements that depend on this element (upward trace)
- Elements this element depends on (downward trace)
- Detected circular dependencies
- Impact metrics

### Usage

```bash
dr trace <element-id> [options]
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--direction` | up\|down\|both | both | Trace direction (up for dependents, down for dependencies) |
| `--depth` | number | - | Maximum depth to traverse |
| `--show-metrics` | boolean | false | Display graph and element metrics |

### Examples

#### Basic trace (all directions)
```bash
dr trace 01-motivation-goal-create-customer
```

**Output:**
```
Dependency Trace: 01-motivation-goal-create-customer
────────────────────────────────────────────────────────────────────────────

Dependents (2 direct, 5 transitive):
  Direct:
    ← 02-business-process-create-order
    ← 03-security-policy-access-control
  Transitive:
    ↖ 04-application-service-order
    ↖ 06-api-endpoint-create-customer
    ... and 1 more

Dependencies (3 direct, 8 transitive):
  Direct:
    → 02-business-process-create-order
    → 03-security-policy-access-control
    → 04-application-service-order
  Transitive:
    ↘ 05-technology-database-customer
    ↘ 07-datamodel-entity-customer
    ... and 2 more
```

#### Trace upward only (who depends on this?)
```bash
dr trace 01-motivation-goal-create-customer --direction up
```

#### Trace with metrics
```bash
dr trace 01-motivation-goal-create-customer --show-metrics
```

**Additional Output:**
```
Graph Metrics:
  Nodes:                48
  Edges:                156
  Connected Components: 1
  Cycles:               0

Element Metrics:
  Impact Radius:     7 elements
  Dependency Depth:  3
```

#### Detect issues
```bash
# Shows circular dependencies if they exist:
⚠️  Warning: 1 cycle(s) detected in the dependency graph
  02-process-test → 03-policy-test → 02-process-test
```

### Output Symbols

| Symbol | Meaning |
|--------|---------|
| `←` | Direct dependent (element that depends on target) |
| `↖` | Transitive dependent |
| `→` | Direct dependency (element that target depends on) |
| `↘` | Transitive dependency |
| `⚠️` | Circular dependency warning |

### Use Cases

1. **Impact Analysis**: Understand what breaks if you change this element
2. **Dependency Review**: Verify elements don't have unexpected dependencies
3. **Circular Detection**: Identify and fix circular dependencies
4. **Architecture Understanding**: Visualize layer interactions
5. **Risk Assessment**: Assess change impact before making modifications

---

## Command 2: Project

### Purpose
Projects dependencies from a source element to a target layer, showing:
- All elements in target layer that the source depends on
- Elements at different depths
- Reverse impact analysis

### Usage

```bash
dr project <element-id> <target-layer> [options]
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `element-id` | string | ID of source element (e.g., `01-motivation-goal-sales`) |
| `target-layer` | string | Target layer prefix (01-12 or full name) |

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--reverse` | boolean | false | Project in reverse (impact analysis) |
| `--max-depth` | number | 10 | Maximum traversal depth |
| `--show-reachability` | boolean | false | Show reachability with depth info |

### Examples

#### Basic projection to another layer
```bash
dr project 01-motivation-goal-sales 04-application
```

**Output:**
```
Dependency Projection: 01-motivation-goal-sales → 04-application
────────────────────────────────────────────────────────────────

Elements in layer 04 that 01-motivation-goal-sales depends on:
  ✓ 04-application-service-order
    Name: Order Service
    Description: Main service handling customer orders and fulfillment

Total: 1 element(s)
```

#### Projection with multiple results
```bash
dr project 01-motivation-goal-sales 12-testing
```

**Output:**
```
Dependency Projection: 01-motivation-goal-sales → 12-testing
────────────────────────────────────────────────────────────

Elements in layer 12 that 01-motivation-goal-sales depends on:
  ✓ 12-testing-testcase-order-creation
    Name: Order Creation Test Case
    Description: Tests the complete order creation flow

  ✓ 12-testing-testcase-payment-processing
    Name: Payment Processing Test Case

Total: 2 element(s)
```

#### Reverse projection (impact analysis)
```bash
dr project 07-datamodel-entity-customer 02-business --reverse
```

**Output:**
```
Elements in layer 02 that lead to 07-datamodel-entity-customer:
  ✓ 02-business-process-customer-management
  ✓ 02-business-process-order

Total: 2 element(s)
```

#### With reachability analysis
```bash
dr project 01-motivation-goal-sales 08-datastore --show-reachability
```

**Output:**
```
Dependency Projection: 01-motivation-goal-sales → 08-datastore
────────────────────────────────────────────────────────────────

Elements in layer 08 that 01-motivation-goal-sales depends on:
  ✓ 08-datastore-table-customers
  ✓ 08-datastore-table-orders

Total: 2 element(s)

Reachability Analysis:
  Depth 1 (2 element(s)):
    • 02-business-process-create-order
    • 03-security-policy-payment
  Depth 2 (1 element(s)):
    • 04-application-service-payment
  Depth 3 (2 element(s)):
    • 07-datamodel-entity-payment-transaction
    • 07-datamodel-entity-customer
```

### Layer Reference

| Number | Layer | Abbreviation |
|--------|-------|--------------|
| 01 | Motivation | mot, motivation |
| 02 | Business | bus, business |
| 03 | Security | sec, security |
| 04 | Application | app, application |
| 05 | Technology | tech, technology |
| 06 | API | api |
| 07 | Data Model | dm, datamodel |
| 08 | Data Store | ds, datastore |
| 09 | UX | ux |
| 10 | Navigation | nav, navigation |
| 11 | APM | apm |
| 12 | Testing | test, testing |

### Default Projection Rules

The system includes pre-configured projection rules for typical dependencies:

```
01 → 02 (Motivation realizes Business)
02 → 03 (Business requires Security)
02 → 04 (Business implements Application)
03 → 04 (Security enforces Application)
04 → 05 (Application uses Technology)
05 → 06 (Technology exposes API)
06 → 07 (API uses Data Model)
07 → 08 (Data Model stored in Data Store)
04 → 09 (Application has UX)
09 → 10 (UX navigates with Navigation)
04 → 11 (Application monitored by APM)
04 → 12 (Application tested by Testing)
05 → 12 (Technology tested by Testing)
06 → 12 (API tested by Testing)
08 → 12 (Data Store tested by Testing)
```

### Use Cases

1. **Impact Scope**: Determine what layers are affected by a requirement
2. **Test Planning**: Find all tests needed for a feature
3. **Architecture Validation**: Verify cross-layer dependencies align
4. **Dependency Mapping**: Create layer interaction diagrams
5. **Risk Assessment**: Understand change scope across layers

---

## Combined Workflow Example

### Scenario: Analyzing a Sales Feature Change

```bash
# Step 1: Understand what depends on the sales goal
dr trace 01-motivation-goal-increase-sales --show-metrics

# Step 2: Project impact to implementation layers
dr project 01-motivation-goal-increase-sales 04-application
dr project 01-motivation-goal-increase-sales 06-api
dr project 01-motivation-goal-increase-sales 08-datastore

# Step 3: Check what tests need updating
dr project 01-motivation-goal-increase-sales 12-testing --show-reachability

# Step 4: Verify no circular dependencies
dr trace 02-business-process-sales-order --show-metrics
```

### Expected Insights

- Understanding complete dependency tree
- Identifying all affected layers
- Finding all related tests
- Detecting problematic cycles
- Planning implementation scope

---

## Integration with Validation

Both commands can be used to enhance validation:

```bash
# Validate and check dependencies
dr validate
dr trace <problematic-element-id> --show-metrics
```

---

## Performance Characteristics

| Operation | Time Complexity | Notes |
|-----------|-----------------|-------|
| Direct dependencies | O(1) | Indexed lookup |
| Transitive dependencies | O(V+E) | DFS traversal |
| Cycle detection | O(V+E) | Full graph scan |
| Projection | O(V+E) | Follows rules |
| Graph construction | O(R) | R = total references |

**V** = vertices (elements), **E** = edges (references), **R** = references

For typical models (50-500 elements, 100-1000 references), all operations complete in <100ms.

---

## Troubleshooting

### No results found
```bash
# Verify element exists
dr show <element-id>

# Check if projection rules exist for this path
dr trace <element-id> --show-metrics  # Look at connected components
```

### Circular dependencies detected
```bash
# Trace problematic elements to see the cycle
dr trace <element-in-cycle> --direction both
```

### Unexpected dependencies
```bash
# Examine the full dependency chain with depth
dr project <element> <target-layer> --show-reachability
```

---

## Tips and Best Practices

1. **Start with Trace**: Use `trace` first to understand element relationships
2. **Use Metrics**: Enable `--show-metrics` to understand graph topology
3. **Verify Projection Rules**: Ensure projection rules match your architecture
4. **Regular Audits**: Run `trace` on key elements to maintain architecture integrity
5. **Document Exceptions**: Note any cross-layer violations for future reference

---

## See Also

- [Phase 4 Implementation Summary](./PHASE4_IMPLEMENTATION_SUMMARY.md)
- [Reference Registry Documentation](../cli-bun/src/core/reference-registry.ts)
- [DependencyTracker API](../cli-bun/src/core/dependency-tracker.ts)
- [ProjectionEngine API](../cli-bun/src/core/projection-engine.ts)
