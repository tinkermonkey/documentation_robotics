# Validation Strategy

## Introduction

The federated architecture model uses a **multi-layer validation strategy** where each layer validates independently using specialized tools, followed by cross-layer reference validation.

## Validation Levels

### Level 1: Layer-Specific Validation

Each layer validates using its standard's native validator:

```javascript
// Multi-layer validation with specialized tools
const results = {
  // ArchiMate layers (01, 02, 04, 05): Use ArchiMate validators
  archimate: validateArchiMate("model.xml"),

  // Security layer (03): Custom validator
  security: validateSecurity("specs/security/security.yaml"),

  // API layer (06): OpenAPI validators
  openapi: validateOpenAPI("specs/api/*.yaml"),

  // Data Model layer (07): JSON Schema validators
  schemas: validateJSONSchema("specs/schemas/*.json"),

  // Data Store layer (08): DDL validators
  data_store: validateDDL("specs/data-store/*.sql"),

  // UX layer (09): Custom UX validator
  ux: validateUXSpec("specs/ux/*.yaml"),

  // Navigation layer (10): Custom navigation validator
  navigation: validateNavigation("specs/navigation/*.yaml"),

  // APM layer (11): OpenTelemetry validators
  apm: validateOTelConfig("specs/apm/*.yaml"),
};
```

### Level 2: Cross-Layer Reference Validation

Validate that references between layers are consistent using the Link Registry (see [Cross-Layer Reference Registry](06-cross-layer-reference-registry.md)):

```javascript
const crossLayerResults = {
  // Validate spec.* properties point to existing files
  fileReferences: validateFileReferences(model),

  // Validate operationId references exist in OpenAPI specs
  operationIds: validateOperationIds(model),

  // Validate schemaRef JSONPath expressions are valid
  schemaRefs: validateSchemaRefs(model),

  // Validate x-archimate-ref bidirectional consistency
  archiRefs: validateArchimateRefs(model),

  // Validate route references exist in navigation layer
  routes: validateRoutes(model),
};
```

### Level 3: Semantic Validation

Validate semantic consistency across layers:

```javascript
const semanticResults = {
  // Validate data types match across layers
  typeConsistency: validateTypeConsistency(model),

  // Validate security constraints align across layers
  securityAlignment: validateSecurityAlignment(model),

  // Detect circular dependencies
  circularDeps: detectCircularDependencies(model),

  // Validate requirement coverage
  requirementCoverage: validateRequirementCoverage(model),
};
```

### Level 4: Link Validation (v0.2.0+)

Validate cross-layer references using the comprehensive Link Registry:

```javascript
const linkValidationResults = {
  // Validate link existence - all targets must exist
  existence: validateLinkExistence(model, linkRegistry),

  // Validate type compatibility - targets must be correct element types
  typeCompatibility: validateLinkTypes(model, linkRegistry),

  // Validate cardinality - single vs array values match link definitions
  cardinality: validateLinkCardinality(model, linkRegistry),

  // Validate format - UUIDs, paths, durations match expected patterns
  format: validateLinkFormats(model, linkRegistry),

  // Detect broken links with typo suggestions
  brokenLinks: detectBrokenLinks(model, linkRegistry),
};
```

**Link Validation Strategy:**

1. **Existence Checking**: Verify all referenced element IDs exist in the model
2. **Type Compatibility**: Ensure targets match expected element types from link registry
3. **Cardinality Enforcement**: Validate single/array values match link definitions
4. **Format Validation**: Check UUID, path, duration, percentage formats using regex patterns
5. **Typo Detection**: Use Levenshtein distance to suggest corrections for broken references

**Validation Modes:**

- **Warning Mode** (default): Report link issues as warnings
- **Strict Mode** (CI/CD): Treat link warnings as errors, fail build on issues

**Implementation:**

Conformant implementations MUST:

- Load link definitions from `/spec/schemas/link-registry.json`
- Validate all 60+ link types across 9 categories
- Support both warning and strict validation modes
- Provide actionable error messages with suggestions

See [Cross-Layer Reference Registry](06-cross-layer-reference-registry.md) for complete link catalog.

## Validation Tools

| Layer        | Standard            | Validator Tool                 |
| ------------ | ------------------- | ------------------------------ |
| 01-02, 04-05 | ArchiMate 3.2       | ArchiMate XSD, Archi validator |
| 03           | Custom Security     | Custom JSON Schema validator   |
| 06           | OpenAPI 3.0         | Swagger Validator, Spectral    |
| 07           | JSON Schema Draft 7 | AJV, JSON Schema Validator     |
| 08           | SQL DDL             | Database-specific linters      |
| 09           | Custom UX           | Custom JSON Schema validator   |
| 10           | Custom Navigation   | Custom JSON Schema validator   |
| 11           | OpenTelemetry       | OTel Collector validator       |
| Cross-layer  | All                 | Custom reference checker       |

## Validation Workflow

### Development Time

```bash
# 1. Validate individual layers as you work
dr validate --layer motivation
dr validate --layer api
dr validate --layer ux

# 2. Validate cross-layer references
dr validate --cross-layer

# 3. Run full validation
dr validate --all
```

### CI/CD Pipeline

```yaml
# .github/workflows/validate.yml
name: Validate Architecture Model

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Validate Layer Schemas
        run: |
          dr validate --layer motivation
          dr validate --layer business
          dr validate --layer security
          dr validate --layer application
          dr validate --layer technology
          dr validate --layer api
          dr validate --layer data-model
          dr validate --layer data-store
          dr validate --layer ux
          dr validate --layer navigation
          dr validate --layer apm

      - name: Validate Cross-Layer References
        run: dr validate --cross-layer

      - name: Validate Semantic Consistency
        run: dr validate --semantic

      - name: Generate Validation Report
        run: dr validate --all --format html --output validation-report.html

      - name: Upload Report
        uses: actions/upload-artifact@v2
        with:
          name: validation-report
          path: validation-report.html
```

## Validation Rules

### Required Validations

All conformant implementations MUST validate:

1. **Schema Compliance** - Each layer element conforms to its JSON Schema
2. **Reference Existence** - All references point to existing elements
3. **Reference Type Consistency** - Referenced elements have compatible types
4. **Bidirectional Consistency** - Bidirectional references are consistent
5. **No Circular Dependencies** - No circular reference chains
6. **Unique IDs** - All element IDs are unique within their namespace

### Recommended Validations

Implementations SHOULD validate:

1. **Naming Conventions** - Element names follow conventions
2. **Requirement Coverage** - All requirements are implemented
3. **Goal Traceability** - All goals have implementations
4. **Security Completeness** - All resources have security definitions
5. **API Completeness** - All services have API specifications
6. **Data Completeness** - All data objects have schemas

## Error Reporting

Validation errors should be reported with:

```json
{
  "severity": "error" | "warning" | "info",
  "layer": "motivation" | "business" | ...,
  "elementId": "goal-123",
  "errorCode": "MISSING_REFERENCE",
  "message": "Reference to 'req-456' not found",
  "location": {
    "file": "model/01_motivation/goals.yaml",
    "line": 42,
    "column": 15
  },
  "suggestion": "Check that requirement 'req-456' exists in requirements.yaml"
}
```

## Conformance Testing

### Conformance Test Suite

The specification provides a conformance test suite in `spec/test-fixtures/`:

```
spec/test-fixtures/
├── valid/              # Must pass validation
│   ├── minimal/        # Minimal valid model
│   ├── complete/       # Complete valid model
│   └── ...
├── invalid/            # Must fail validation
│   ├── missing-refs/
│   ├── type-errors/
│   ├── circular-deps/
│   └── ...
└── README.md
```

### Running Conformance Tests

```bash
# Run all conformance tests
dr validate --conformance

# Run specific test category
dr validate --conformance --category valid
dr validate --conformance --category invalid

# Verify invalid cases properly fail
dr validate --conformance --expect-failures invalid/
```

## Best Practices

1. **Validate Early** - Run validation during development, not just at deployment
2. **Fix Errors Promptly** - Don't accumulate validation errors
3. **Use CI/CD** - Automate validation in continuous integration
4. **Generate Reports** - Create validation reports for stakeholders
5. **Track Metrics** - Monitor validation error trends over time
6. **Educate Teams** - Ensure teams understand validation rules

## Validation Performance

For large models, validation can be optimized:

```bash
# Incremental validation (only changed files)
dr validate --incremental

# Parallel validation (multiple layers simultaneously)
dr validate --parallel

# Cache validation results
dr validate --cache

# Validate specific subtree
dr validate --path model/04_application/
```

---

**Complete:** Core specification documents
**Next:** See [../conformance/README.md](../conformance/README.md) for conformance requirements
