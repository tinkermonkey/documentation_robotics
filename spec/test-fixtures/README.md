# Test Fixtures

This directory contains test fixtures for validating conformance to the Federated Architecture Metadata Model specification.

## Purpose

Test fixtures serve two purposes:

1. **Specification Compliance** - Define what conformant tools must accept/reject
2. **Implementation Testing** - Provide test data for validator development

## Directory Structure

```
test-fixtures/
├── README.md                   # This file
├── valid/                      # MUST pass validation
│   ├── motivation/             # Layer 01 valid fixtures
│   ├── business/               # Layer 02 valid fixtures
│   ├── security/               # Layer 03 valid fixtures
│   ├── application/            # Layer 04 valid fixtures
│   ├── technology/             # Layer 05 valid fixtures
│   ├── api/                    # Layer 06 valid fixtures
│   ├── data-model/             # Layer 07 valid fixtures
│   ├── datastore/              # Layer 08 valid fixtures
│   ├── ux/                     # Layer 09 valid fixtures
│   ├── navigation/             # Layer 10 valid fixtures
│   └── apm/                    # Layer 11 valid fixtures
├── invalid/                    # MUST fail validation
│   ├── missing-required/       # Missing required fields
│   ├── invalid-types/          # Wrong data types
│   ├── broken-references/      # Invalid cross-layer references
│   └── circular-deps/          # Circular dependencies
└── cross-layer/                # Cross-layer validation tests
```

## Test Fixture Format

All test fixtures follow this format:

```yaml
---
metadata:
  testId: "unique-test-id"
  description: "Human-readable description"
  layer: "motivation" | "business" | ...
  entityType: "Goal" | "Requirement" | ...
  expectation: "pass" | "fail"
  conformanceLevel: "basic" | "standard" | "full"
  # For invalid tests:
  expectedError: "ERROR_CODE"
  expectedMessage: "Expected error message"

data:
  # The actual test data
  id: "entity-id"
  name: "Entity Name"
  # ... other attributes
```

## Running Tests

### Using `dr` CLI

```bash
# Run all conformance tests
dr validate --conformance

# Run only valid tests
dr validate --conformance --category valid

# Run only invalid tests (expect failures)
dr validate --conformance --category invalid

# Run cross-layer tests
dr validate --conformance --category cross-layer

# Run tests for specific layer
dr validate --conformance --layer motivation
```

### Expected Results

**Valid Tests:**

- All fixtures MUST be accepted as valid
- No validation errors
- All attributes correctly stored

**Invalid Tests:**

- All fixtures MUST be rejected
- Appropriate error codes returned
- Helpful error messages provided

## Test Coverage

### Level 1: Basic Conformance (Layers 01-04)

**Valid Tests:**

- Minimum: 10 tests per layer
- Coverage: All entity types, all required attributes, edge cases

**Invalid Tests:**

- Minimum: 5 tests per layer
- Coverage: Missing required, wrong types, invalid references

### Level 2: Standard Conformance (Layers 05-08)

Additional tests for:

- Technology constraints
- API-Schema references
- Schema-Database consistency
- Data type alignment

### Level 3: Full Conformance (Layers 09-11)

Additional tests for:

- UX state machines
- Navigation graphs
- Observability configurations
- End-to-end traceability

## Creating Test Fixtures

### Valid Test Fixture Template

```yaml
---
metadata:
  testId: "valid-[layer]-[entity]-[variant]"
  description: "[Description of what this tests]"
  layer: "[layer-name]"
  entityType: "[EntityType]"
  expectation: "pass"
  conformanceLevel: "[basic|standard|full]"

data:
  id: "test-entity-id"
  name: "Test Entity"
  type: "EntityType"
  # Include all required attributes
  # Optionally include optional attributes
```

### Invalid Test Fixture Template

```yaml
---
metadata:
  testId: "invalid-[layer]-[entity]-[error-type]"
  description: "[What's wrong with this test]"
  layer: "[layer-name]"
  entityType: "[EntityType]"
  expectation: "fail"
  expectedError: "ERROR_CODE"
  expectedMessage: "Expected error message pattern"

data:
  # Missing required field, wrong type, etc.
  name: "Test Entity"
  # 'id' missing - should cause error
```

## Contributing Test Fixtures

To add test fixtures:

1. Identify gap in coverage
2. Create fixture following format above
3. Test with reference implementation (`dr` CLI)
4. Document what the fixture tests
5. Submit pull request

See [../CONTRIBUTING.md](../CONTRIBUTING.md#contributing-to-test-fixtures) for details.

## Test Fixture Guidelines

### Good Test Fixtures

✅ **Focused** - Test one thing clearly
✅ **Documented** - Clear description in metadata
✅ **Minimal** - No unnecessary complexity
✅ **Realistic** - Based on real-world scenarios
✅ **Independent** - Don't depend on other fixtures

### Poor Test Fixtures

❌ **Complex** - Testing multiple things at once
❌ **Undocumented** - Unclear what's being tested
❌ **Redundant** - Duplicate of existing test
❌ **Artificial** - Unrealistic scenarios
❌ **Coupled** - Depends on other fixtures

## Maintenance

Test fixtures are maintained as part of the specification:

- Updated when specification changes
- Expanded when gaps identified
- Reviewed with each spec release
- Versioned alongside specification

## Questions

For questions about test fixtures:

- See [../conformance/test-suite.md](../conformance/test-suite.md)
- Review existing fixtures as examples
- Open GitHub issue

---

**Get Started:** Browse [valid/motivation/](valid/motivation/) for examples
