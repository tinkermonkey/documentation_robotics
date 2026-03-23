---
name: LAYER_12_TESTING
description: Expert knowledge for Testing Layer modeling in Documentation Robotics
triggers:
  [
    "testing",
    "test coverage",
    "test case",
    "input partition",
    "ISP",
    "test strategy",
    "coverage model"
  ]
version: 0.8.3
---

# Testing Layer Skill

**Layer Number:** 12
**Specification:** Metadata Model Spec v0.8.3
**Purpose:** Defines test coverage using ISP (Input Space Partitioning) Coverage Model, specifying coverage requirements, test cases, and input partitions.

---

## Layer Overview

The Testing Layer captures **test coverage strategy**:

- **COVERAGE MODELS** - Overall test coverage requirements
- **COVERAGE TARGETS** - What needs testing (APIs, features, data)
- **INPUT PARTITIONS** - Partition input space for systematic coverage
- **TEST CASES** - Concrete test case sketches
- **CONTEXT VARIATIONS** - Test strategy variation types (functional, load, security, regression, smoke, exploratory)
- **COVERAGE GAPS** - Identified gaps in coverage

This layer uses **ISP Coverage Model** (systematic input space partitioning).

**Central Entity:** The **TestCoverageModel** is the core modeling unit.

---

## Entity Types

> **CLI Introspection:** Run `dr schema types testing` for the authoritative, always-current list of node types.
> Run `dr schema node <type-id>` for full attribute details on any type.

### Core Testing Entities (17 types)

| Entity Type                 | Description                                                                    |
| --------------------------- | ------------------------------------------------------------------------------ |
| **TestCoverageModel**       | Root coverage model for system/component                                       |
| **TestCoverageTarget**      | What needs testing (API, feature, data)                                        |
| **InputSpacePartition**     | Partition of input space                                                       |
| **PartitionValue**          | Value/range within partition                                                   |
| **InputPartitionSelection** | Selected partition values for coverage                                         |
| **InputSelection**          | Concrete resolved input value chosen from a partition for a specific test case |
| **CoverageRequirement**     | Specific coverage requirement                                                  |
| **TestCaseSketch**          | High-level test case description                                               |
| **OutcomeCategory**         | Expected outcome categories                                                    |
| **ContextVariation**        | Environmental/contextual variation                                             |
| **EnvironmentFactor**       | Environment-specific factor                                                    |
| **PartitionDependency**     | Dependencies between partitions                                                |
| **CoverageGap**             | Identified gap in coverage                                                     |
| **CoverageExclusion**       | Explicitly excluded coverage                                                   |
| **CoverageSummary**         | Summary of coverage status                                                     |
| **TargetCoverageSummary**   | Coverage summary for target                                                    |
| **TargetInputField**        | Input field for target                                                         |

---

## Type Decision Tree

Use this decision tree **before assigning a type** to any testing concept.

```
IS this the root coverage plan for a system, service, or feature?
  → testing.testcoveragemodel

IS this a specific thing being tested (an API operation, feature, workflow, data field)?
  → testing.testcoveragetarget

IS this a division of an input field's possible values (valid/invalid/boundary ranges)?
  → testing.inputspacepartition

IS this one specific value or boundary within a partition?
  → testing.partitionvalue

IS this a constraint that links partition values to other partitions (e.g., field B depends on field A)?
  → testing.partitiondependency

IS this a declarative selection of which partition values to exercise in a test run?
  → testing.inputpartitionselection

IS this a single concrete resolved value chosen from a partition for a specific test case?
  → testing.inputselection

IS this an overall coverage requirement (criteria like "each-choice", "pairwise")?
  → testing.coveragerequirement

IS this a concrete high-level description of a single test case?
  → testing.testcasesketch

IS this a category of expected outcomes (success, error, edge-case)?
  → testing.outcomecategory

IS this a test strategy variation type — functional, load, security, regression, smoke, or exploratory testing?
  → testing.contextvariation

IS this a concrete environmental setting with a specific value (e.g., os=Linux, locale=en-US, network=low-bandwidth)?
  → testing.environmentfactor

IS this an input field on a target that is mapped to partitions?
  → testing.targetinputfield

IS this an identified gap — something that should be tested but is not?
  → testing.coveragegap

IS this a deliberate decision to NOT test something, with documented rationale?
  → testing.coverageexclusion

IS this a rollup of coverage metrics across all targets?
  → testing.coveragesummary

IS this a per-target rollup of sketch/implementation/automation counts?
  → testing.targetcoveragesummary
```

---

## When to Use This Skill

Activate when the user:

- Mentions "testing", "test coverage", "test cases", "ISP"
- Wants to define test strategy or coverage requirements
- Asks about input partitioning or systematic testing
- Needs to model test cases for APIs, features, or data
- Wants to link testing to requirements or business goals

---

## Cross-Layer Relationships

**Outgoing (Testing → Other Layers):**

- `motivation.supports-goals` → Motivation Layer (quality goals)
- `motivation.fulfills-requirements` → Motivation Layer (test requirements)
- `business.covers-process` → Business Layer (process coverage)
- `api.tests-operation` → API Layer (API endpoint testing)
- `data.validates-schema` → Data Model Layer (data validation)
- `ux.tests-view` → UX Layer (UI testing)

**Incoming (Other Layers → Testing):**

- Motivation Layer → Testing (requirements drive coverage)
- API Layer → Testing (operations need test coverage)
- Business Layer → Testing (processes need testing)

---

## Testing Best Practices

1. **Systematic partitioning** - Use ISP to partition input space
2. **Coverage criteria** - Define clear coverage criteria
3. **Context variations** - Test across different contexts
4. **Traceability** - Link tests to requirements and features
5. **Gap analysis** - Identify and document coverage gaps
6. **Exclusions** - Explicitly document what's not tested
7. **Outcome categories** - Define expected outcomes clearly

---

## Common Commands

```bash
# Add coverage model
dr add testing testcoveragemodel "API Coverage Model"

# Add coverage target
dr add testing testcoveragetarget "Login API Coverage"

# Add test case sketch
dr add testing testcasesketch "Valid Login Test"

# List coverage models
dr list testing --type testcoveragemodel

# Validate testing layer
dr validate --layers testing

# Export coverage report
dr export markdown --layers testing
```

---

## Example: Login API Coverage Model

```yaml
id: testing.testcoveragemodel.login-api
name: "Login API Coverage Model"
type: testcoveragemodel
properties:
  version: "1.0"
  application: application.service.auth-service
  description: "ISP coverage model for the Login API"
```

---

## Example: Login Test Coverage Target

```yaml
id: testing.testcoveragetarget.login-endpoint
name: "Login Endpoint Coverage"
type: testcoveragetarget
properties:
  targetType: api-endpoint
  description: "POST /auth/login — validates credentials and returns a JWT"
  priority: critical
```

---

## Example: Test Case Sketch

```yaml
id: testing.testcasesketch.valid-login
name: "Valid Login Test Case"
type: testcasesketch
properties:
  status: draft
  description: "Successful login with valid email and password returns 200 with JWT"
  implementationFormat: automated
```

---

## Coverage Completeness Checklist

Before declaring testing layer extraction complete, verify each type was considered:

- [ ] **testcoveragemodel** — Root coverage model exists for each major system or component under test
- [ ] **testcoveragetarget** — All APIs, features, workflows, and data paths being tested are captured
- [ ] **inputspacepartition** — Input fields on each target have their value space partitioned
- [ ] **partitionvalue** — Each partition has concrete representative values and boundary cases
- [ ] **partitiondependency** — Cross-field constraints between partitions are documented
- [ ] **inputpartitionselection** — Coverage selections specify which partition values are exercised
- [ ] **inputselection** — Concrete resolved inputs are selected for each test case sketch
- [ ] **coveragerequirement** — Coverage criteria (each-choice, pairwise, etc.) are specified
- [ ] **testcasesketch** — High-level test case sketches cover the required combinations
- [ ] **outcomecategory** — Expected outcome categories (success, error, edge) are defined per target
- [ ] **contextvariation** — Test strategy variation types (functional, load, security, regression, smoke, exploratory) are captured
- [ ] **environmentfactor** — Specific factor values for each context variation are recorded
- [ ] **targetinputfield** — Input fields on coverage targets are explicitly mapped to partitions
- [ ] **coveragegap** — Known gaps in coverage are documented with severity and affected requirements
- [ ] **coverageexclusion** — Deliberate out-of-scope decisions are recorded with rationale and approver
- [ ] **coveragesummary** — An overall coverage summary exists if aggregated metrics are needed
- [ ] **targetcoveragesummary** — Per-target coverage rollups exist for targets with tracked implementation

If any type has ZERO elements, explicitly decide:
"This type doesn't apply to this codebase" with reasoning.

---

## Pitfalls to Avoid

- ❌ Ad-hoc testing without systematic partitioning
- ❌ Missing context variations (only testing happy path)
- ❌ Not documenting coverage gaps
- ❌ No traceability to requirements
- ❌ Missing cross-layer links to tested elements
- ❌ Incomplete outcome categories
