# GitHub Copilot Instructions for Documentation Robotics

## Project Overview

Documentation Robotics is a **federated architecture modeling toolkit** that spans 12 interconnected layers from business goals to observability. It consists of:

1. **Specification** ([spec/](../spec/)) - Formal 12-layer model definition
2. **TypeScript CLI** ([cli/](../cli/)) - Fast implementation
3. **Python CLI** (legacy, deprecated) - Original implementation

**Key Principle:** Elements in higher layers reference lower layers only (motivation → business → security → application → technology → API → data model → data store → UX → navigation → APM → testing).

## Architecture Quick Reference

### The 12 Layers

1. **Motivation** - Goals, requirements, stakeholders (ArchiMate)
2. **Business** - Business processes and services (ArchiMate)
3. **Security** - Authentication, authorization, threats
4. **Application** - Application services and components (ArchiMate)
5. **Technology** - Infrastructure and platforms (ArchiMate)
6. **API** - REST APIs and operations (OpenAPI)
7. **Data Model** - Entities and relationships (JSON Schema)
8. **Data Store** - Database schemas
9. **UX** - User interface components (3-tier architecture)
10. **Navigation** - Application routing
11. **APM** - Observability and monitoring (OpenTelemetry)
12. **Testing** - Test strategies and cases

### Core Concepts

**Model Structure:** All models live in `.dr/` directory:

- `.dr/manifest.json` - Model metadata
- `.dr/layers/{layer-name}.json` - Layer data files

**Element Naming:** Format is `{layer}.{type}.{kebab-case-name}` (e.g., `api.endpoint.create-customer`)

- Must be unique across entire model
- Use dot-separated format consistently

**Validation Pipeline** (4 stages):

1. **Schema** - JSON Schema compliance (AJV)
2. **Naming** - Element ID format enforcement
3. **Reference** - Cross-layer reference integrity
4. **Semantic** - Business rule validation

## Critical Development Rules

### 1. Two Version Numbers

**NEVER confuse these:**

- **Specification:** `spec/VERSION` (currently v0.7.1)
- **CLI:** `cli/package.json` (currently v0.1.0)

CLI version can be ahead of spec version, but CLI must remain compatible with current spec.

### 2. Schema Synchronization

**CRITICAL:** Schema changes require updating BOTH:

- `spec/schemas/{layer}.schema.json` (source of truth)
- `cli/src/schemas/bundled/{layer}.schema.json` (bundled copy)

**NEVER manually edit bundled files** - they're copied during build. Use `npm run copy-schemas` after spec changes.

### 3. When to Ask vs. Proceed

**ASK before:**

- Modifying layer specifications or schemas
- Breaking changes to CLI commands or public APIs
- Version bumps (releases use specific process)
- Changes affecting backwards compatibility

**PROCEED without asking:**

- Bug fixes in CLI implementation
- Internal refactoring (no API changes)
- Adding tests or improving documentation
- Code quality improvements

### 4. Cross-Layer References

**Direction:** Higher layers → lower layers ONLY

- VALID: `application.service.orders` → `business.service.order-management`
- INVALID: `business.service.orders` → `application.service.order-app`

Always validate references exist before creating them.

## Common Development Workflows

### Running Tests

```bash
# CLI tests (TypeScript)
cd cli
npm test                    # All tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests
npm run test:validators    # Validator tests
```

### Building the CLI

```bash
cd cli
npm run build              # Production build
npm run build:debug        # Development build with telemetry
npm run copy-schemas       # Copy spec schemas to bundled/
```

### Adding a Command

1. Create in `cli/src/commands/{command-name}.ts`
2. Register in `cli/src/cli.ts`
3. Add tests in `cli/tests/integration/`
4. Run `npm test` to verify

### Modifying a Layer

1. Update `spec/layers/{layer}.md` (documentation)
2. Update `spec/schemas/{layer}.schema.json` (schema)
3. Run `cd cli && npm run copy-schemas` (sync to CLI)
4. Update validators if needed (`cli/src/validators/`)
5. Update tests

## Key Files to Know

### CLI Architecture

- `cli/src/cli.ts` - Entry point, command routing
- `cli/src/core/model.ts` - Central model management
- `cli/src/core/element.ts` - Element abstraction
- `cli/src/core/reference-registry.ts` - Cross-layer reference tracking
- `cli/src/core/relationship-registry.ts` - Intra-layer relationship tracking
- `cli/src/validators/validator.ts` - Unified validation orchestrator
- `cli/src/export/` - Export format handlers (ArchiMate, OpenAPI, PlantUML, Markdown)
- `cli/src/server/server.ts` - Visualization server with WebSocket support

### Specification

- `spec/core/06-cross-layer-reference-registry.md` - Complete link catalog (60+ patterns)
- `spec/schemas/link-registry.json` - Machine-readable link definitions
- `spec/schemas/relationship-catalog.json` - Relationship type definitions
- `spec/schemas/common/` - Shared schemas (predicates, source refs, layer extensions)

## Export Formats

**Supported exports:**

- **ArchiMate** - Layers 1, 2, 4, 5 only (business, motivation, application, technology)
- **OpenAPI** - Layer 6 (API) only
- **JSON Schema** - Layer 7 (Data Model) only
- **PlantUML** - Visual diagrams (all layers)
- **Markdown** - Documentation (all layers)
- **GraphML** - Graph analysis (all layers)

**Export commands:**

```bash
dr export archimate --output model.archimate
dr export openapi --output api-spec.yaml
dr export plantuml --output diagram.puml
```

## Visualization Server

Interactive web interface with real-time updates:

```bash
dr visualize                    # Start with auth
dr visualize --port 3000        # Custom port
dr visualize --no-auth          # Disable auth (dev only)
dr visualize --token my-token   # Custom token
```

**Features:**

- WebSocket support for live model updates
- Element annotations and comments
- Changeset tracking
- File watching for auto-reload

## Standards Used

- **ArchiMate 3.2** - Layers 1, 2, 4, 5
- **OpenAPI 3.0** - Layer 6
- **JSON Schema Draft 7** - Layer 7 and all schemas
- **OpenTelemetry** - Layer 11

## Common Pitfalls

1. **Schema out of sync** - Always run `copy-schemas` after spec changes
2. **Reversed references** - Higher layers must reference lower, never reverse
3. **Manual ID construction** - Use element utilities, don't manually build IDs
4. **Export format mismatch** - Check format compatibility before exporting
5. **Editing bundled files** - Never edit `cli/src/schemas/bundled/` directly

## Testing Philosophy

- **Comprehensive coverage** - Unit + integration tests for all commands
- **Validation coverage** - Test all 4 validation stages
- **Compatibility tests** - Ensure CLI parity with legacy Python implementation
- **Test fixtures** - Use `spec/test-fixtures/valid/` and `spec/test-fixtures/invalid/`

## Pre-commit Hooks

**Required** before contributing:

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
```

Hooks check: markdown formatting, YAML syntax, JSON validity, trailing whitespace.

## Design Philosophy

1. **Standards-first** - Leverage existing standards (ArchiMate, OpenAPI, JSON Schema) before inventing
2. **Separation of concerns** - Clear boundaries between commands, core logic, validators
3. **Federated approach** - ArchiMate spine + specialized standards for each layer
4. **Testability** - Comprehensive test coverage across all components

## Documentation References

- [Main README](../README.md) - Project overview
- [Specification](../spec/README.md) - Complete spec documentation
- [CLI README](../cli/README.md) - CLI installation and usage
- [CLAUDE.md](../CLAUDE.md) - Additional AI agent guidance
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines
- [RELEASE_PROCESS.md](../RELEASE_PROCESS.md) - Release workflow

## Need Help?

- Check existing `dr-architect` and `dr-advisor` agents in `.github/agents/`
- Read layer specifications in `spec/layers/`
- Browse examples in `spec/examples/`
- Review test fixtures in `spec/test-fixtures/`
