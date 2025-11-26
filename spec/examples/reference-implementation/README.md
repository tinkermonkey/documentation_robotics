# Reference Implementation Example

**Conformance Level:** Full (All 11 Layers)
**Status:** Complete - Used for testing the `dr` CLI tool

## Overview

This is a complete architecture model used as the reference implementation for testing the `dr` CLI tool. It demonstrates all 11 layers and includes examples of all entity types and cross-layer references.

## Purpose

This model serves as:

- **Reference Implementation** - Demonstrates all specification features
- **Test Suite** - Used for testing the `dr` CLI tool
- **Learning Resource** - Shows realistic usage patterns
- **Validation Baseline** - Known-good model for comparison

## Model Contents

### All 11 Layers

- **01 - Motivation:** Goals, stakeholders, requirements
- **02 - Business:** Business processes and services
- **03 - Security:** Roles, permissions, policies
- **04 - Application:** Application components and services
- **05 - Technology:** System software, platforms
- **06 - API:** OpenAPI operations
- **07 - Data Model:** Schema definitions
- **08 - Datastore:** Database tables and schemas
- **09 - UX:** User experience specifications
- **10 - Navigation:** Routes and navigation
- **11 - APM:** Metrics and traces

## Cross-Layer Integration

This model demonstrates:

- Requirements traceability (Goal → Requirement → Component → API → Metric)
- Technology constraints (Technology → API → Data Model → Database)
- User experience flow (UX → API → Data Model)
- Observability (APM traces across all layers)

## Validation

This model is guaranteed to validate successfully:

```bash
cd spec/examples/reference-implementation

# Basic validation
dr validate

# With link validation (recommended)
dr validate --validate-links

# Full strict validation
dr validate --strict --validate-links --strict-links
```

Expected result:

```
✓ All layers valid
✓ All cross-layer references valid
✓ All 60+ link types validated
✓ No validation errors
✓ Full conformance level
```

## Using This Example

### As a Learning Resource

Study this model to see:

- How to structure a complete model
- Patterns for cross-layer references
- Naming conventions
- Documentation practices

### As a Testing Baseline

Use this model to test your implementation:

```bash
# Your tool should validate this successfully
your-tool validate spec/examples/reference-implementation
```

### As a Template

While comprehensive, this model can be simplified for smaller projects. See [../minimal/](../minimal/) for a simpler starting point.

## Files

- **`model/`** - Complete 11-layer model
- **`specs/`** - Generated specifications (OpenAPI, schemas, etc.)
- **`dr.config.yaml`** - Configuration
- **`projection-rules.yaml`** - Cross-layer projection rules

## Maintenance

This model is maintained alongside the `dr` CLI tool and is updated when new features are added to the specification.

---

**Spec Version**: 0.2.0
**Conformance Level**: Full
**Last Updated**: 2025-11-26

**Note:** This is a comprehensive example. For learning, start with [../minimal/](../minimal/)
