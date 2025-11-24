# Conformance Test Suite

The conformance test suite validates that implementations correctly enforce the specification.

## Test Structure

```
spec/test-fixtures/
├── valid/                     # MUST pass validation
│   ├── motivation/
│   │   ├── goal-basic.yaml
│   │   ├── stakeholder-complete.yaml
│   │   └── ...
│   ├── business/
│   ├── security/
│   └── ...
├── invalid/                   # MUST fail validation
│   ├── missing-required/
│   │   ├── goal-no-id.yaml
│   │   └── ...
│   ├── invalid-types/
│   ├── broken-references/
│   └── ...
└── cross-layer/               # Cross-layer validation
    ├── api-to-schema.yaml
    ├── ux-to-api.yaml
    └── ...
```

## Test Categories

### 1. Valid Test Fixtures

**Location:** `spec/test-fixtures/valid/[layer]/`

**Requirement:** Implementations MUST accept these as valid and store/retrieve them correctly.

**Coverage:**

- Minimal valid examples (only required fields)
- Complete valid examples (all fields)
- Edge cases within valid range
- Various enum values
- Optional attributes present/absent

### 2. Invalid Test Fixtures

**Location:** `spec/test-fixtures/invalid/[category]/`

**Requirement:** Implementations MUST reject these with appropriate errors.

**Categories:**

- `missing-required/` - Missing required attributes
- `invalid-types/` - Wrong data types
- `invalid-enums/` - Invalid enum values
- `broken-references/` - References to non-existent elements
- `circular-deps/` - Circular dependencies
- `schema-violations/` - JSON Schema violations

### 3. Cross-Layer Tests

**Location:** `spec/test-fixtures/cross-layer/`

**Requirement:** Implementations MUST validate references between layers.

**Tests:**

- API operations reference valid schemas
- UX states reference valid API operations
- Navigation routes reference valid UX experiences
- All `x-archimate-ref` attributes point to valid elements

## Running Tests

### Command Line

```bash
# Run all conformance tests
dr validate --conformance

# Run specific category
dr validate --conformance --category valid
dr validate --conformance --category invalid
dr validate --conformance --category cross-layer

# Run tests for specific layer
dr validate --conformance --layer motivation
dr validate --conformance --layer api

# Run with detailed output
dr validate --conformance --verbose
```

### Expected Behavior

#### Valid Tests

```bash
$ dr validate --conformance --category valid

Running conformance tests: valid fixtures
✓ motivation/goal-basic.yaml - PASS
✓ motivation/goal-complete.yaml - PASS
✓ motivation/stakeholder-basic.yaml - PASS
...
Results: 150/150 passed

Status: PASS
```

#### Invalid Tests

```bash
$ dr validate --conformance --category invalid

Running conformance tests: invalid fixtures (expect failures)
✓ missing-required/goal-no-id.yaml - CORRECTLY REJECTED
✓ invalid-types/goal-wrong-type.yaml - CORRECTLY REJECTED
✓ broken-references/ux-invalid-operationId.yaml - CORRECTLY REJECTED
...
Results: 45/45 correctly rejected

Status: PASS
```

## Test Fixture Format

### Valid Test Fixture

```yaml
# test-fixtures/valid/motivation/goal-basic.yaml
---
metadata:
  testId: "valid-goal-basic"
  description: "Minimal valid goal with only required attributes"
  layer: "motivation"
  entityType: "Goal"
  expectation: "pass"
  conformanceLevel: "basic"

data:
  id: "goal-customer-satisfaction"
  name: "Improve Customer Satisfaction"
  type: "Goal"
```

### Invalid Test Fixture

```yaml
# test-fixtures/invalid/missing-required/goal-no-id.yaml
---
metadata:
  testId: "invalid-goal-missing-id"
  description: "Goal missing required 'id' attribute"
  layer: "motivation"
  entityType: "Goal"
  expectation: "fail"
  expectedError: "MISSING_REQUIRED_FIELD"
  expectedMessage: "Required field 'id' is missing"

data:
  name: "Improve Customer Satisfaction"
  type: "Goal"
  # 'id' is missing - should fail validation
```

### Cross-Layer Test Fixture

```yaml
# test-fixtures/cross-layer/ux-to-api-valid.yaml
---
metadata:
  testId: "cross-layer-ux-api-valid"
  description: "UX state correctly references API operation"
  layers: ["application", "api", "ux"]
  expectation: "pass"

data:
  # Layer 04: Application
  application:
    - id: "app-product-api"
      type: "ApplicationService"
      name: "Product API"
      properties:
        spec.openapi: "product-api.yaml"

  # Layer 06: API (OpenAPI)
  api:
    - file: "product-api.yaml"
      content:
        openapi: "3.0.0"
        info:
          title: "Product API"
          x-archimate-ref: "app-product-api"
        paths:
          /products:
            get:
              operationId: "listProducts"

  # Layer 09: UX
  ux:
    - specVersion: "1.0"
      experienceId: "product-list"
      states:
        - id: "products-loaded"
          api:
            operationId: "listProducts" # References API operation above
```

## Test Coverage Requirements

### Level 1: Basic Conformance

MUST pass:

- ✅ All valid fixtures for layers 01-04 (minimum 10 per layer)
- ✅ All invalid fixtures for layers 01-04 (minimum 5 per layer)
- ✅ Cross-layer tests: Application → Motivation
- ✅ Cross-layer tests: Application → Business

### Level 2: Standard Conformance

MUST pass:

- ✅ All Basic tests
- ✅ All valid fixtures for layers 05-08
- ✅ All invalid fixtures for layers 05-08
- ✅ Cross-layer tests: API → Schema
- ✅ Cross-layer tests: Schema → Database
- ✅ Data type consistency tests

### Level 3: Full Conformance

MUST pass:

- ✅ All Standard tests
- ✅ All valid fixtures for layers 09-11
- ✅ All invalid fixtures for layers 09-11
- ✅ Cross-layer tests: UX → API
- ✅ Cross-layer tests: Navigation → UX
- ✅ Cross-layer tests: APM → All layers
- ✅ End-to-end traceability tests

## Reporting Results

### Conformance Report Format

```yaml
conformanceReport:
  implementation:
    name: "Your Tool"
    version: "0.1.1"
  specification:
    version: "0.1.1"
  testSuiteVersion: "0.1.1"
  date: "2025-11-23"

  results:
    valid:
      total: 150
      passed: 150
      failed: 0
      passRate: 100%

    invalid:
      total: 45
      passed: 45 # Correctly rejected
      failed: 0
      passRate: 100%

    crossLayer:
      total: 30
      passed: 30
      failed: 0
      passRate: 100%

  status: "PASS"
  conformanceLevel: "full"
```

## Contributing Test Cases

To contribute test cases:

1. Identify a gap in coverage
2. Create test fixture following format above
3. Add to appropriate directory
4. Document in test fixture metadata
5. Submit pull request

See [../CONTRIBUTING.md](../CONTRIBUTING.md#adding-test-fixtures) for details.

---

**Next:** [certification-process.md](certification-process.md) - How to claim conformance
