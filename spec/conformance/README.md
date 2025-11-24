# Conformance Requirements

This directory contains the conformance requirements for implementations of the Documentation Robotics specification.

## Overview

Conformance ensures that implementations correctly interpret and enforce the specification, enabling interoperability between different tools and consistency across models.

## Conformance Levels

Implementations can claim conformance at three levels:

- **[Level 1: Basic](conformance-levels.md#level-1-basic)** - Layers 01-04 (Motivation through Application)
- **[Level 2: Standard](conformance-levels.md#level-2-standard)** - Layers 01-08 (through Datastore)
- **[Level 3: Full](conformance-levels.md#level-3-full)** - All 11 layers

See [conformance-levels.md](conformance-levels.md) for detailed requirements for each level.

## Conformance Process

1. **Implement** - Build your tool according to the specification
2. **Validate** - Run the [conformance test suite](test-suite.md)
3. **Document** - Create conformance statement
4. **Claim** - Follow the [certification process](certification-process.md)

## Required Components

To claim conformance, an implementation MUST:

1. **Support Required Layers** - Implement all layers for the claimed conformance level
2. **Validate Schemas** - Enforce JSON Schema validation for all entity types
3. **Validate References** - Verify cross-layer reference integrity
4. **Pass Test Suite** - Pass all tests in the conformance test suite
5. **Document Compliance** - Provide conformance statement

## Test Suite

The conformance test suite includes:

- **Valid Test Fixtures** - MUST accept and validate correctly
- **Invalid Test Fixtures** - MUST reject with appropriate errors
- **Cross-Layer Tests** - MUST validate references correctly
- **Semantic Tests** - MUST detect inconsistencies

See [test-suite.md](test-suite.md) for details.

## Certification

Organizations can claim certification by:

1. Passing all conformance tests
2. Documenting conformance level
3. Submitting conformance statement
4. (Optional) Requesting official review

See [certification-process.md](certification-process.md) for the process.

## Conformance Statement Template

```yaml
implementation:
  name: "Your Tool Name"
  version: "0.1.1"
  organization: "Your Organization"
  url: "https://yourtool.com"

specification:
  version: "0.1.1"
  conformanceLevel: "full" # basic, standard, or full

layers:
  motivation: true
  business: true
  security: true
  application: true
  technology: true
  api: true
  data-model: true
  datastore: true
  ux: true
  navigation: true
  apm: true

validation:
  schemaValidation: true
  crossLayerReferences: true
  semanticValidation: true

testSuite:
  validTestsPassed: 150
  validTestsTotal: 150
  invalidTestsPassed: 45
  invalidTestsTotal: 45
  crossLayerTestsPassed: 30
  crossLayerTestsTotal: 30

date: "2025-11-23"
attestation: "We certify that this implementation conforms to the specification."
```

## Known Conformant Implementations

| Implementation   | Version | Conformance Level | Spec Version |
| ---------------- | ------- | ----------------- | ------------ |
| dr CLI           | 0.3.1   | Full              | 0.1.1        |
| (Add yours here) | -       | -                 | -            |

## Questions

For questions about conformance:

- Review [conformance-levels.md](conformance-levels.md)
- Check [test-suite.md](test-suite.md)
- See [certification-process.md](certification-process.md)
- Open a GitHub issue

---

**Next Steps:**

1. Read [conformance-levels.md](conformance-levels.md) to choose a level
2. Review [test-suite.md](test-suite.md) to understand requirements
3. Follow [certification-process.md](certification-process.md) to claim conformance
