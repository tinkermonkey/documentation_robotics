# Federated Architecture Metadata Schemas

This directory contains comprehensive JSON Schema definitions for all 11 layers of the federated architecture metadata model.

## Overview

The metadata model defines a **federated architecture approach** using ArchiMate as the architectural spine with specialized standards for different concerns. These schemas provide machine-readable, validatable definitions for each layer.

## Schema Files

### Master Schema

- **`federated-architecture.schema.json`** - The master schema that ties all 11 layers together with cross-layer references and traceability

### Layer Schemas

1. **`01-motivation-layer.schema.json`** - WHY: Goals, requirements, stakeholders, constraints
   - Standard: ArchiMate 3.2 Motivation Layer
   - Entities: Stakeholder, Driver, Assessment, Goal, Outcome, Principle, Requirement, Constraint, Meaning, Value

2. **`02-business-layer.schema.json`** - WHAT: Business services, processes, actors
   - Standard: ArchiMate 3.2 Business Layer
   - Entities: BusinessActor, BusinessRole, BusinessCollaboration, BusinessProcess, BusinessFunction, BusinessService, BusinessObject, Product

3. **`03-security-layer.schema.json`** - WHO CAN: Cross-cutting access control and policies
   - Standard: Custom Security Model (RBAC, ABAC, Policy-Based)
   - Entities: AuthenticationConfig, Role, Permission, SecureResource, SecurityPolicy, DataClassification

4. **`04-application-layer.schema.json`** - HOW: Software applications and services
   - Standard: ArchiMate 3.2 Application Layer
   - Entities: ApplicationComponent, ApplicationInterface, ApplicationFunction, ApplicationService, DataObject

5. **`05-technology-layer.schema.json`** - WITH WHAT: Platforms, frameworks, design constraints
   - Standard: ArchiMate 3.2 Technology Layer
   - Entities: Node, Device, SystemSoftware, TechnologyInterface, TechnologyService, Artifact

6. **`06-api-layer.schema.json`** - INTERFACE: Service contracts and protocols
   - Standard: OpenAPI 3.0 with custom extensions
   - Entities: OpenAPI specification elements with x-archimate-ref, x-rate-limit, x-apm-trace extensions

7. **`07-data-model-layer.schema.json`** - STRUCTURE: Logical data definitions
   - Standard: JSON Schema Draft 7 with custom extensions
   - Extensions: x-database (mapping), x-ui (hints), x-security (metadata)

8. **`08-datastore-layer.schema.json`** - STORAGE: Physical database schemas
   - Standard: SQL DDL + Extensions
   - Entities: Database, Table, Column, Constraint, Index, View, Trigger

9. **`09-ux-layer.schema.json`** - PRESENTATION: User interface specifications
   - Standard: Custom UX Specification
   - Entities: UXSpec, ScreenState, StateAction, ScreenLayout, FieldDefinition, ActionButton

10. **`10-navigation-layer.schema.json`** - FLOW: User navigation and routing
    - Standard: Custom Navigation Specification
    - Entities: NavigationGraph, Route, NavigationGuard, NavigationTransition, NavigationMenu

11. **`11-apm-observability-layer.schema.json`** - OBSERVE: Monitoring and tracing
    - Standard: OpenTelemetry 1.0+
    - Entities: TraceConfiguration, LogConfiguration, MetricConfiguration

## Usage

### Validating Architecture Metadata

Use any JSON Schema validator to validate your architecture metadata:

```bash
# Using ajv-cli
npm install -g ajv-cli
ajv validate -s federated-architecture.schema.json -d your-architecture.json

# Using jsonschema (Python)
pip install jsonschema
jsonschema -i your-architecture.json federated-architecture.schema.json
```

### Validating Individual Layers

Each layer can be validated independently:

```bash
# Validate a UX specification
ajv validate -s 09-ux-layer.schema.json -d specs/ux/product-edit.ux.yaml

# Validate a security model
ajv validate -s 03-security-layer.schema.json -d specs/security/security-model.yaml

# Validate a navigation spec
ajv validate -s 10-navigation-layer.schema.json -d specs/navigation/product-navigation.yaml
```

### Code Generation

These schemas can be used to generate:

- **TypeScript interfaces** - For type-safe metadata manipulation
- **Validation code** - Runtime validators for each layer
- **Documentation** - Auto-generated API documentation
- **Editor support** - JSON Schema-based autocomplete and validation in IDEs

```bash
# Generate TypeScript types
npm install -g json-schema-to-typescript
json2ts -i federated-architecture.schema.json -o types/architecture.d.ts

# Generate Python dataclasses
pip install datamodel-code-generator
datamodel-codegen --input federated-architecture.schema.json --output models.py
```

## Cross-Layer Integration

The metadata model defines how layers reference each other:

| Source Layer | Target Layer | Reference Type | Example |
|--------------|--------------|----------------|---------|
| ArchiMate | All Specs | `x-archimate-ref` | `"x-archimate-ref": "app-comp-product-ui"` |
| OpenAPI | JSON Schema | `$ref` | `"$ref": "schemas/product.json#/definitions/Product"` |
| UX | API | `operationId` | `"api": {"operationId": "getProduct"}` |
| UX | Data | `schemaRef` | `"dataBinding": {"schemaRef": "product.json#/properties/name"}` |
| Navigation | UX | `screen` | `"screen": "product-edit.ux.yaml"` |
| APM | All | Trace context | Traces and logs correlate across all layers |

## Validation Strategy

Each layer has independent validation:

```javascript
const results = {
  archimate: validateArchiMate('model.xml'),           // XSD validation
  openapi: validateOpenAPI('api.yaml'),                // Swagger validator
  schemas: validateJSONSchema('schema.json'),          // AJV validator
  ux: validateUXSpec('ux.yaml'),                       // Custom validator
  security: validateSecurity('security.yaml'),         // Custom validator
  navigation: validateNavigation('navigation.yaml'),   // Custom validator
  apm: validateOTelConfig('apm.yaml'),                // OTel validator
  crossRefs: validateCrossReferences(all)              // Reference checker
};
```

## Standards Leveraged

This metadata model minimizes custom invention by leveraging established standards:

- **ArchiMate 3.2** - Motivation, Business, Application, Technology layers
- **OpenAPI 3.0** - API specifications
- **JSON Schema Draft 7** - Data model definitions
- **OpenTelemetry 1.0+** - Observability and tracing
- **W3C Trace Context** - Distributed tracing correlation

## Custom Specifications

Only 3 custom specifications were created for gaps not covered by existing standards:

1. **Security Model** (Layer 03) - Comprehensive RBAC/ABAC/Policy-based access control
2. **UX Specification** (Layer 09) - State machines, layouts, and UI behavior
3. **Navigation Specification** (Layer 10) - Routing, guards, and navigation flows

## Statistics

```yaml
Total Schemas: 12 (11 layers + 1 master)
Total Entity Types: 70+
Total Attributes: ~400
Total Enums: 35+
Cross-Layer References: 55+

Standards Leveraged: 5
- ArchiMate 3.2
- OpenAPI 3.0
- JSON Schema Draft 7
- OpenTelemetry 1.0
- W3C Trace Context

Custom Specifications: 3
- Security Model
- UX Specification
- Navigation Specification
```

## Implementation Guidance

Follow the layer ordering for systematic implementation:

1. **Define Motivation** (Layer 01) - Goals, requirements, stakeholders
2. **Model Business** (Layer 02) - Business services, processes
3. **Design Security** (Layer 03) - Roles, permissions, policies
4. **Architect Application** (Layer 04) - Application components, services
5. **Select Technology** (Layer 05) - Technology stack and constraints
6. **Specify APIs** (Layer 06) - OpenAPI specifications
7. **Define Data Model** (Layer 07) - JSON Schemas
8. **Design Data Store** (Layer 08) - Database schemas
9. **Specify UX** (Layer 09) - User interface specs
10. **Map Navigation** (Layer 10) - Routes and flows
11. **Configure APM** (Layer 11) - Observability setup

## Benefits

✅ **Minimal invention** - Only 3 custom specs instead of reinventing everything
✅ **Tool ecosystem** - Each standard has mature tooling
✅ **Independent evolution** - Standards can be updated independently
✅ **Validation at each layer** - Specialized validators per standard
✅ **Interoperability** - Other tools can consume standard formats
✅ **Clear separation of concerns** - Each layer has focused responsibility
✅ **Type safety** - Generate type-safe code from schemas
✅ **Documentation** - Schemas serve as living documentation

## Version History

- **1.0.0** (2025-01-22) - Initial comprehensive schema set
  - Created 11 layer schemas
  - Created federated architecture master schema
  - Defined cross-layer reference types
  - Added validation examples

## References

- [ArchiMate 3.2 Specification](https://pubs.opengroup.org/architecture/archimate3-doc/)
- [OpenAPI 3.0 Specification](https://swagger.io/specification/)
- [JSON Schema Draft 7](https://json-schema.org/draft-07/schema)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)

---

For detailed documentation of each layer, see the individual markdown files in the `../layers/` directory.
