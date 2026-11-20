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

## Intra-Layer Relationships

Each testing type has one composing parent. The model composes targets, partitions, context
variations, environment factors, exclusions and the summary; a target composes its input fields,
outcome categories, coverage requirements and test case sketches. A sketch `validates` the one
requirement it exercises and `references` its context variation and outcome category. Only target
input fields reference the field under test, so partitions stay reusable. Summaries report with
`references` and `aggregates`; they never `validates`.

| Source Type             | Predicate  | Target Type             | Example                                                                   |
| ----------------------- | ---------- | ----------------------- | ------------------------------------------------------------------------- |
| TestCoverageModel       | composes   | TestCoverageTarget      | "Login API Coverage Model" composes "Login Endpoint Coverage"             |
| TestCoverageModel       | composes   | ContextVariation        | "Login API Coverage Model" composes "Security Testing"                    |
| TestCoverageModel       | composes   | EnvironmentFactor       | "Login API Coverage Model" composes "Rate Limiter Enabled"                |
| TestCoverageModel       | composes   | InputSpacePartition     | "Login API Coverage Model" composes "Email Format Partition"              |
| TestCoverageModel       | composes   | CoverageExclusion       | "Login API Coverage Model" composes "SSO Login Out Of Scope"              |
| TestCoverageModel       | composes   | CoverageSummary         | "Login API Coverage Model" composes "Login Coverage Summary"              |
| TestCoverageTarget      | composes   | TargetInputField        | "Login Endpoint Coverage" composes "email field"                          |
| TestCoverageTarget      | composes   | OutcomeCategory         | "Login Endpoint Coverage" composes "Invalid Credentials (401)"            |
| TestCoverageTarget      | composes   | CoverageRequirement     | "Login Endpoint Coverage" composes "Pairwise Credentials"                 |
| TestCoverageTarget      | composes   | TestCaseSketch          | "Login Endpoint Coverage" composes "Valid Login Test Case"                |
| TargetInputField        | references | InputSpacePartition     | "email field" references "Email Format Partition"                         |
| InputSpacePartition     | composes   | PartitionValue          | "Email Format Partition" composes "Malformed Email"                       |
| PartitionDependency     | references | PartitionValue          | "Locked Account Requires Valid Email" references "Locked Account"         |
| PartitionDependency     | references | InputSpacePartition     | "Locked Account Requires Valid Email" references "Email Format Partition" |
| CoverageRequirement     | composes   | InputPartitionSelection | "Pairwise Credentials" composes "Email x Password Selection"              |
| CoverageRequirement     | references | OutcomeCategory         | "Pairwise Credentials" references "Invalid Credentials (401)"             |
| CoverageRequirement     | references | ContextVariation        | "Pairwise Credentials" references "Security Testing"                      |
| InputPartitionSelection | references | PartitionValue          | "Email x Password Selection" references "Malformed Email"                 |
| TestCaseSketch          | validates  | CoverageRequirement     | "Valid Login Test Case" validates "Pairwise Credentials"                  |
| TestCaseSketch          | composes   | InputSelection          | "Valid Login Test Case" composes "Valid Email + Valid Password"           |
| InputSelection          | references | PartitionValue          | "Valid Email + Valid Password" references "Well-Formed Email"             |
| TestCaseSketch          | references | OutcomeCategory         | "Valid Login Test Case" references "Success (200 + JWT)"                  |
| TestCaseSketch          | references | ContextVariation        | "Brute Force Lockout Test" references "Security Testing"                  |
| ContextVariation        | references | EnvironmentFactor       | "Security Testing" references "Rate Limiter Enabled"                      |
| CoverageGap             | references | CoverageRequirement     | "No MFA Cases" references "Pairwise Credentials"                          |
| CoverageExclusion       | references | TestCoverageTarget      | "SSO Login Out Of Scope" references "Login Endpoint Coverage"             |
| CoverageExclusion       | references | CoverageGap             | "SSO Login Out Of Scope" references "No SSO Cases"                        |
| TargetCoverageSummary   | references | TestCoverageTarget      | "Login Endpoint Rollup" references "Login Endpoint Coverage"              |
| TargetCoverageSummary   | references | CoverageGap             | "Login Endpoint Rollup" references "No MFA Cases"                         |
| CoverageSummary         | aggregates | TargetCoverageSummary   | "Login Coverage Summary" aggregates "Login Endpoint Rollup"               |

---

## Cross-Layer References

### Outgoing References (Testing → Other Layers)

A target `covers` the production artifact it names; a sketch `tests` what it exercises. The model
covers only the application component, UX application or API document it is for. Requirements and
summaries reach no other layer. Only the model and test case sketches link to motivation.

| Source Type        | Predicate        | Target Type                        | Example                                                               |
| ------------------ | ---------------- | ---------------------------------- | --------------------------------------------------------------------- |
| TestCoverageModel  | covers           | `application.applicationcomponent` | "Login API Coverage Model" covers "Auth Service"                      |
| TestCoverageModel  | covers           | `api.openapidocument`              | "Login API Coverage Model" covers "Auth API"                          |
| TestCoverageModel  | supports         | `motivation.goal`                  | "Login API Coverage Model" supports "Secure Customer Access"          |
| TestCoverageModel  | satisfies        | `motivation.requirement`           | "Login API Coverage Model" satisfies "Auth Must Be Regression Tested" |
| TestCoverageModel  | measures-outcome | `motivation.outcome`               | "Login API Coverage Model" measures-outcome "Fewer Auth Incidents"    |
| TestCoverageTarget | covers           | `api.operation`                    | "Login Endpoint Coverage" covers "POST /auth/login"                   |
| TestCoverageTarget | covers           | `product.feature`                  | "Password Reset Coverage" covers "Self-Service Password Reset"        |
| TestCoverageTarget | covers           | `ux.view`                          | "Login Screen Coverage" covers "Login View"                           |
| TestCoverageTarget | covers           | `data-store.storedlogic`           | "Order Total Trigger Coverage" covers "recalc_order_total"            |
| TestCaseSketch     | tests            | `api.operation`                    | "Valid Login Test Case" tests "POST /auth/login"                      |
| TestCaseSketch     | tests            | `api.response`                     | "Invalid Password Test" tests "401 Unauthorized"                      |
| TestCaseSketch     | tests            | `business.businessprocess`         | "Complete Checkout E2E" tests "Order Checkout"                        |
| TestCaseSketch     | tests            | `ux.view`                          | "Login Form Renders Errors" tests "Login View"                        |
| TestCaseSketch     | tests            | `navigation.route`                 | "Deep Link To Profile" tests "User Profile Route"                     |
| TestCaseSketch     | tests            | `security.threat`                  | "Brute Force Lockout Test" tests "Credential Stuffing"                |
| TestCaseSketch     | tests            | `data-model.schemadefinition`      | "Reject Unknown Order Fields" tests "Order Schema"                    |
| TestCaseSketch     | tests            | `data-model.objectschema`          | "Order Total Is Never Negative" tests "Order"                         |
| TestCaseSketch     | tests            | `data-store.accesspattern`         | "Find Owners By Last Name" tests "findByLastName"                     |
| TestCaseSketch     | tests            | `application.applicationcomponent` | "Pet Type Formatter Parses Names" tests "PetTypeFormatter"            |
| TestCaseSketch     | satisfies        | `motivation.requirement`           | "Brute Force Lockout Test" satisfies "Lock After 5 Failures"          |
| TestCaseSketch     | accesses         | `data-store.collection`            | "Order History Test" accesses `orders`                                |
| TargetInputField   | references       | `api.parameter`                    | "email field" references "email parameter"                            |
| TargetInputField   | references       | `data-model.schemaproperty`        | "email field" references "User.email"                                 |
| EnvironmentFactor  | references       | `technology.systemsoftware`        | "PostgreSQL 16" references "PostgreSQL"                               |

### Incoming References (Other Layers → Testing)

None. Testing is a leaf layer: other layers do not hold relationships pointing into it. Record traceability from the testing side (e.g. `TestCaseSketch tests api.operation`).

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
  description: "ISP coverage model for the Login API"
```

```bash
dr relationship add testing.testcoveragemodel.login-api application.applicationcomponent.auth-service --predicate covers
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

```bash
dr relationship add testing.testcoveragemodel.login-api testing.testcoveragetarget.login-endpoint --predicate composes
dr relationship add testing.testcoveragetarget.login-endpoint api.operation.login --predicate covers
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

```bash
dr relationship add testing.testcoveragetarget.login-endpoint testing.testcasesketch.valid-login --predicate composes
dr relationship add testing.testcasesketch.valid-login testing.coveragerequirement.pairwise-credentials --predicate validates
dr relationship add testing.testcasesketch.valid-login api.operation.login --predicate tests
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
