# Certification Process

This document describes how implementations claim conformance to the Federated Architecture Metadata Model specification.

## Overview

Conformance certification is a **self-certification process** with optional third-party verification. Implementations claim conformance by:

1. Meeting all requirements for a conformance level
2. Passing the conformance test suite
3. Creating a conformance statement
4. Publishing the conformance claim

## Self-Certification Process

### Step 1: Choose Conformance Level

Select the appropriate level:

- **Basic** - Layers 01-04
- **Standard** - Layers 01-08
- **Full** - Layers 01-11

See [conformance-levels.md](conformance-levels.md) for details.

### Step 2: Implement Requirements

Implement all required capabilities for your chosen level:

- Entity management for required layers
- Validation against JSON Schemas
- Cross-layer reference validation
- Required export formats

### Step 3: Run Conformance Tests

Run the complete test suite:

```bash
# Run all tests for your conformance level
dr validate --conformance --level basic
# or
dr validate --conformance --level standard
# or
dr validate --conformance --level full

# Generate conformance report
dr validate --conformance --level full --output conformance-report.yaml
```

### Step 4: Create Conformance Statement

Create a conformance statement file:

```yaml
# conformance-statement.yaml
conformanceStatement:
  implementation:
    name: "Your Tool Name"
    version: "1.0.0"
    vendor: "Your Organization"
    website: "https://yourtool.com"
    documentation: "https://docs.yourtool.com"
    repository: "https://github.com/yourorg/yourtool"
    license: "MIT"

  specification:
    name: "Federated Architecture Metadata Model"
    version: "1.0.0"
    conformanceLevel: "full" # basic, standard, or full
    url: "https://github.com/yourorg/documentation_robotics/tree/main/spec"

  layers:
    01_motivation: { implemented: true, standard: "ArchiMate 3.2" }
    02_business: { implemented: true, standard: "ArchiMate 3.2" }
    03_security: { implemented: true, standard: "Custom" }
    04_application: { implemented: true, standard: "ArchiMate 3.2" }
    05_technology: { implemented: true, standard: "ArchiMate 3.2" }
    06_api: { implemented: true, standard: "OpenAPI 3.0" }
    07_data_model: { implemented: true, standard: "JSON Schema Draft 7" }
    08_datastore: { implemented: true, standard: "SQL DDL" }
    09_ux: { implemented: true, standard: "Custom" }
    10_navigation: { implemented: true, standard: "Custom" }
    11_apm: { implemented: true, standard: "OpenTelemetry 1.0+" }

  capabilities:
    entityManagement: true
    schemaValidation: true
    crossLayerReferences: true
    semanticValidation: true
    exportFormats: ["archimate", "openapi", "json-schema", "plantuml", "markdown"]

  testResults:
    testSuiteVersion: "1.0.0"
    date: "2025-11-23"
    validTestsPassed: 150
    validTestsTotal: 150
    invalidTestsPassed: 45
    invalidTestsTotal: 45
    crossLayerTestsPassed: 30
    crossLayerTestsTotal: 30
    overallPassRate: "100%"
    status: "PASS"

  attestation:
    date: "2025-11-23"
    attestedBy: "Your Name, Position"
    statement: "We certify that this implementation conforms to the Federated Architecture Metadata Model specification version 1.0.0 at the Full conformance level."

  additionalNotes: |
    Any additional information about your implementation,
    known limitations, or planned features.
```

### Step 5: Publish Conformance Claim

Publish your conformance statement:

1. **In Your README:**

   ```markdown
   ## Conformance

   This tool conforms to the [Federated Architecture Metadata Model Specification v1.0.0]
   (https://github.com/yourorg/documentation_robotics/tree/main/spec)
   at the **Full Conformance** level.

   See [conformance-statement.yaml](conformance-statement.yaml) for details.
   ```

2. **On Your Website:**
   Display conformance badge and link to statement

3. **In Documentation:**
   Include conformance information in user documentation

### Step 6: Register (Optional)

Optionally register your conformance claim:

1. Fork the specification repository
2. Add your implementation to `spec/conformance/certified-implementations.md`
3. Submit pull request

## Third-Party Verification (Optional)

For official recognition, request third-party verification:

### Verification Process

1. **Submit Request**
   - Email specification maintainers
   - Include conformance statement
   - Include test results

2. **Review**
   - Maintainers review implementation
   - Run conformance tests
   - Verify claims

3. **Verification**
   - If conformant: Issue verification certificate
   - If issues found: Provide feedback for improvement

4. **Recognition**
   - Add to official certified implementations list
   - Receive conformance badge
   - Announced in specification updates

### Verification Criteria

Implementations are verified against:

- ✅ All conformance test pass
- ✅ Documentation is accurate
- ✅ Claims match actual capabilities
- ✅ No known significant bugs
- ✅ Reasonable user experience

## Maintaining Conformance

### When Specification Updates

When a new specification version is released:

1. **Review Changes**
   - Read CHANGELOG for changes
   - Identify breaking changes
   - Assess impact on implementation

2. **Update Implementation**
   - Implement new requirements (if any)
   - Fix any issues
   - Re-run test suite

3. **Update Conformance Statement**
   - Update `specification.version`
   - Update `testResults`
   - Update `attestation.date`

4. **Re-publish**
   - Update README
   - Update website
   - Update registry entry

### When Implementation Updates

When you release a new version:

1. **Re-test**
   - Run full conformance test suite
   - Verify no regressions

2. **Update Statement**
   - Update `implementation.version`
   - Update `testResults.date`

3. **Publish**
   - Include updated statement in release

## Partial Conformance

If you implement only some layers:

1. **Do Not Claim a Conformance Level**
2. **Document Supported Layers:**

   ```yaml
   implementation:
     supportedLayers: [motivation, business, application, api, data-model]
     note: "Partial implementation - no conformance level claimed"
   ```

3. **Pass Tests for Supported Layers**

## Conformance Badges

Once conformant, use badges:

**Markdown:**

```markdown
![Conformance: Full](https://img.shields.io/badge/Federated%20Architecture%20Spec-Full%20Conformance-green)
```

**HTML:**

```html
<img
  src="https://img.shields.io/badge/Federated%20Architecture%20Spec-Full%20Conformance-green"
  alt="Conformance: Full"
/>
```

**Badge Levels:**

- `Basic Conformance` - Blue badge
- `Standard Conformance` - Yellow badge
- `Full Conformance` - Green badge

## Questions

For certification questions:

- Review this document
- Check [conformance-levels.md](conformance-levels.md)
- See [test-suite.md](test-suite.md)
- Open GitHub issue
- Email spec maintainers

## Contact

- **GitHub Issues:** Technical questions
- **Email:** [spec-maintainers@example.com]
- **Verification Requests:** [conformance@example.com]

---

**Ready to certify?** Start with [conformance-levels.md](conformance-levels.md)
