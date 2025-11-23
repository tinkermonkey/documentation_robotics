# Conformance Levels

Implementations of the Federated Architecture Metadata Model can claim conformance at three levels, each building on the previous level.

## Level 1: Basic Conformance

**Scope:** Layers 01-04 (Motivation, Business, Security, Application)

**Use Case:** Small projects, basic architecture modeling, requirements traceability

### Required Layers

| Layer            | Standard      | Required |
| ---------------- | ------------- | -------- |
| 01 - Motivation  | ArchiMate 3.2 | ✅ Yes   |
| 02 - Business    | ArchiMate 3.2 | ✅ Yes   |
| 03 - Security    | Custom        | ✅ Yes   |
| 04 - Application | ArchiMate 3.2 | ✅ Yes   |

### Required Capabilities

Implementations MUST:

1. **Entity Management**
   - Create, read, update, delete entities for layers 01-04
   - Validate entity attributes against JSON Schemas
   - Enforce required attributes
   - Support optional attributes

2. **Relationship Management**
   - Support ArchiMate relationships (realizes, uses, serves, etc.)
   - Validate relationship source/target compatibility
   - Prevent invalid relationship types

3. **Cross-Layer References**
   - Support upward references (Application → Motivation)
   - Support upward references (Application → Business)
   - Validate reference targets exist
   - Support `x-archimate-ref` bidirectional references

4. **Validation**
   - Validate against JSON Schemas for layers 01-04
   - Validate cross-layer reference existence
   - Validate unique IDs within layers
   - Report validation errors with location information

5. **Export**
   - Export to ArchiMate XML (layers 01, 02, 04)
   - Export security model to YAML/JSON

### Test Requirements

MUST pass:

- All valid test fixtures for layers 01-04
- All invalid test fixtures for layers 01-04
- Cross-layer reference tests for layers 01-04
- Basic semantic validation tests

### Conformance Statement

```yaml
conformanceLevel: "basic"
layers: [motivation, business, security, application]
specVersion: "0.1.0"
```

---

## Level 2: Standard Conformance

**Scope:** Layers 01-08 (through Datastore)

**Use Case:** Most software projects, API and data modeling, database design

### Required Layers

All Basic layers, plus:

| Layer           | Standard            | Required |
| --------------- | ------------------- | -------- |
| 05 - Technology | ArchiMate 3.2       | ✅ Yes   |
| 06 - API        | OpenAPI 3.0         | ✅ Yes   |
| 07 - Data Model | JSON Schema Draft 7 | ✅ Yes   |
| 08 - Datastore  | SQL DDL             | ✅ Yes   |

### Additional Capabilities

Beyond Basic level, implementations MUST:

1. **Technology Layer**
   - Model technology stack (SystemSoftware, Node, Device, etc.)
   - Link technology choices to application components
   - Validate technology constraints

2. **API Layer**
   - Parse and validate OpenAPI 3.0 specifications
   - Link API operations to application services
   - Support `operationId` references from other layers
   - Validate OpenAPI specs using standard validators

3. **Data Model Layer**
   - Parse and validate JSON Schema Draft 7
   - Support `$ref` cross-references
   - Link schemas to data objects
   - Support custom extensions (`x-database`, `x-security`, etc.)

4. **Datastore Layer**
   - Model databases, tables, columns, constraints
   - Link to data model schemas
   - Validate DDL syntax
   - Support multiple database types

5. **Enhanced Validation**
   - Validate API-to-Schema references (`$ref`)
   - Validate data type consistency (API ↔ Schema ↔ Database)
   - Validate technology constraints are respected
   - Detect schema compatibility issues

6. **Enhanced Export**
   - Export to OpenAPI 3.0 specifications
   - Export to JSON Schema files
   - Export to DDL scripts (PostgreSQL, MySQL, etc.)
   - Generate API documentation

### Test Requirements

MUST pass:

- All Basic level tests
- All valid test fixtures for layers 05-08
- All invalid test fixtures for layers 05-08
- Cross-layer reference tests for API-Schema-Database chain
- Data type consistency tests

### Conformance Statement

```yaml
conformanceLevel: "standard"
layers: [motivation, business, security, application, technology, api, data-model, datastore]
specVersion: "0.1.0"
```

---

## Level 3: Full Conformance

**Scope:** All 11 layers

**Use Case:** Enterprise projects, complete traceability, multi-channel UX, observability

### Required Layers

All Standard layers, plus:

| Layer                  | Standard           | Required |
| ---------------------- | ------------------ | -------- |
| 09 - UX                | Custom             | ✅ Yes   |
| 10 - Navigation        | Custom             | ✅ Yes   |
| 11 - APM/Observability | OpenTelemetry 1.0+ | ✅ Yes   |

### Additional Capabilities

Beyond Standard level, implementations MUST:

1. **UX Layer**
   - Model multi-channel user experiences
   - Support UX state machines
   - Link UX states to API operations
   - Link UX views to data schemas
   - Validate UX specifications

2. **Navigation Layer**
   - Model channel-agnostic navigation
   - Define routes, guards, transitions
   - Link routes to UX experiences
   - Validate navigation graphs

3. **APM/Observability Layer**
   - Model OpenTelemetry configurations
   - Define traces, logs, metrics
   - Link observability to all layers
   - Support distributed tracing correlation

4. **Complete Traceability**
   - Trace from goals to UX implementations
   - Trace from business processes to metrics
   - Generate complete traceability matrices
   - Support bidirectional traceability queries

5. **Complete Validation**
   - Validate all 11 layers
   - Validate complete reference chains
   - Validate end-to-end consistency
   - Validate observability coverage

6. **Complete Export**
   - Export UX specifications
   - Export navigation configurations
   - Export OpenTelemetry configurations
   - Generate comprehensive documentation
   - Export to all supported formats

### Test Requirements

MUST pass:

- All Standard level tests
- All valid test fixtures for layers 09-11
- All invalid test fixtures for layers 09-11
- End-to-end traceability tests
- Complete semantic validation tests
- Observability correlation tests

### Conformance Statement

```yaml
conformanceLevel: "full"
layers:
  [
    motivation,
    business,
    security,
    application,
    technology,
    api,
    data-model,
    datastore,
    ux,
    navigation,
    apm,
  ]
specVersion: "0.1.0"
```

---

## Conformance Comparison

| Capability             | Basic   | Standard | Full     |
| ---------------------- | ------- | -------- | -------- |
| **Layers**             | 4       | 8        | 11       |
| **ArchiMate**          | ✅      | ✅       | ✅       |
| **Security**           | ✅      | ✅       | ✅       |
| **API (OpenAPI)**      | ❌      | ✅       | ✅       |
| **Data (JSON Schema)** | ❌      | ✅       | ✅       |
| **Database**           | ❌      | ✅       | ✅       |
| **UX**                 | ❌      | ❌       | ✅       |
| **Navigation**         | ❌      | ❌       | ✅       |
| **Observability**      | ❌      | ❌       | ✅       |
| **Traceability**       | Partial | Good     | Complete |
| **Export Formats**     | 2       | 5+       | 8+       |

## Choosing a Conformance Level

### Choose Basic If

- ✅ Small to medium projects
- ✅ Focus on requirements and architecture
- ✅ Don't need API/data modeling
- ✅ Need basic traceability (goals → components)

### Choose Standard If

- ✅ Software development projects
- ✅ Need API specifications
- ✅ Need data modeling
- ✅ Need database design
- ✅ Most common use case

### Choose Full If

- ✅ Enterprise projects
- ✅ Multi-channel experiences (web, mobile, voice, etc.)
- ✅ Need complete traceability (goal → UX → API → DB → metrics)
- ✅ Need observability integration
- ✅ Comprehensive architecture governance

## Partial Conformance

Implementations MAY support layers selectively (e.g., layers 01, 02, 04, 06, 07) but:

- MUST NOT claim a conformance level
- SHOULD document which layers are supported
- SHOULD pass tests for supported layers

## Upgrading Conformance Levels

Implementations can upgrade conformance levels:

1. **Basic → Standard**
   - Add layers 05-08
   - Add API and data model support
   - Pass Standard test suite

2. **Standard → Full**
   - Add layers 09-11
   - Add UX and navigation support
   - Add observability support
   - Pass Full test suite

## Conformance Maintenance

To maintain conformance:

1. **Track Specification Updates**
   - Monitor specification releases
   - Review CHANGELOG for breaking changes
   - Update implementation as needed

2. **Re-test After Changes**
   - Run conformance test suite after updates
   - Verify no regressions
   - Update conformance statement if spec version changes

3. **Report Issues**
   - Report ambiguities or errors in specification
   - Contribute test cases for edge cases
   - Help improve specification

## Claiming Conformance

To claim conformance:

1. Implement required layers
2. Pass all required tests
3. Create conformance statement
4. Document in README or website
5. (Optional) Submit for official recognition

See [certification-process.md](certification-process.md) for details.

---

**Next:** [test-suite.md](test-suite.md) - Understanding the conformance test suite
