# CLAUDE.md - AI Assistant Guide

## Project Overview

**Documentation Robotics** is a toolkit for managing federated architecture data models across 12 interconnected layers.

**Components:**

1. **CLI Tool (`cli/`)** - TypeScript/Bun implementation (v0.1.0, ~8x faster)
2. **Metadata Model Specification** - Formal documentation defining the 12-layer model

**Current Versions:** Bun CLI v0.1.0, Spec v0.6.0

## Repository Structure

```
documentation_robotics/
├── spec/                        # SPECIFICATION (v0.6.0)
│   ├── VERSION                  # Spec version number
│   ├── layers/                  # 12 layer specifications
│   ├── schemas/                 # JSON Schema definitions
│   └── [CHANGELOG, guides, examples, test-fixtures]
│
└── cli/                         # TYPESCRIPT/BUN CLI (v0.1.0)
    ├── src/
    │   ├── cli.ts              # CLI entry point (Commander.js)
    │   ├── commands/           # 23+ command implementations
    │   ├── core/               # Domain models (Element, Layer, Model, Manifest)
    │   ├── validators/         # Validation pipeline (Schema, Naming, Reference, Semantic)
    │   ├── export/             # Export handlers (ArchiMate, OpenAPI, PlantUML, etc.)
    │   ├── server/             # Visualization server (Hono + WebSocket)
    │   ├── ai/                 # AI integration (Claude API)
    │   ├── schemas/            # Bundled JSON schemas
    │   ├── types/              # TypeScript type definitions
    │   └── utils/              # Utilities (file-io, errors, element-utils)
    ├── tests/
    │   ├── unit/               # Unit tests
    │   ├── integration/        # Integration tests
    │   └── compatibility/      # Compatibility tests
    ├── dist/                   # Compiled JavaScript
    ├── package.json            # Dependencies and build scripts
    ├── tsconfig.json           # TypeScript configuration
    └── README.md               # Installation and usage guide
```

## Quick Reference

### CLI Setup

```bash
# Install from source for development
cd cli
npm install
npm run build

# Test
npm run test                 # Run all tests with Bun
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests

# Run CLI locally
node dist/cli.js --help

# Install globally
npm install -g .
dr --help
```

### Key Dependencies

**Bun CLI:**

- Node.js 18+, TypeScript, Commander.js, AJV, Ansis, Graphology, Hono, @anthropic-ai/sdk

### Approved Commands

You have pre-approved access to:

- **Bun CLI:** `npm`, `node`, `bun`, `npm run build`, `npm run test`, `npm run format`, `node dist/cli.js`

### Pre-commit Checks

Run `pre-commit run --all-files` from the repo root before committing to ensure formatting and linters pass.

## Critical Rules

### 1. Spec vs. CLI Separation

- **Two separate version numbers**: Spec (`spec/VERSION`) and CLI (`cli/package.json`)
- **Schema synchronization**: Schema changes require updating BOTH:
  - `spec/schemas/{layer}.schema.json`
  - `cli/src/schemas/bundled/{layer}.schema.json`
- **Layer spec changes**: Must update both `spec/layers/{layer}.md` AND corresponding CLI validators/code

### 2. When to Ask First

- **ASK before proceeding:**
  - Modifying layer specifications or schemas
  - Breaking changes to CLI commands or public APIs
  - Version bumps (use `/dr-release-prep` command for releases)
  - Changes affecting backwards compatibility
- **PROCEED without asking:**
  - Bug fixes in CLI implementation
  - Internal refactoring (no API changes)
  - Adding tests or improving documentation
  - Code quality improvements (typing, linting)

### 3. Version Compatibility

- CLI version can be ahead of spec version
- CLI must remain compatible with current spec version
- Breaking spec changes require spec version bump
- Check `spec/CHANGELOG.md` and `cli/CHANGELOG.md` for version history

### 4. Element Naming Convention

- **Format**: `{layer}-{type}-{kebab-case-name}`
- **Example**: `api-endpoint-create-customer`
- Must be unique across entire model
- Use element utilities for consistency

### 5. Cross-Layer References

- **Direction**: Higher layers → lower layers only
- Always validate references exist before creating
- Use reference registry for lookups and validation

## The 12-Layer Architecture Model

Federated architecture model spanning 12 interconnected layers:

1. **Motivation** - Goals, requirements, stakeholders (ArchiMate)
2. **Business** - Business processes and services (ArchiMate)
3. **Security** - Authentication, authorization, threats
4. **Application** - Application services and components (ArchiMate)
5. **Technology** - Infrastructure and platforms (ArchiMate)
6. **API** - REST APIs and operations (OpenAPI)
7. **Data Model** - Entities and relationships (JSON Schema)
8. **Data Store** - Database schemas
9. **UX** - User interface components
10. **Navigation** - Application routing
11. **APM** - Observability and monitoring (OpenTelemetry)
12. **Testing** - Test strategies, test cases, test data

**Key Principle:** Elements in higher layers reference elements in lower layers, creating a dependency graph.

## Architecture Patterns

### Core Domain (`core/`)

- **Element** - Individual architecture items
- **Layer** - Container for elements within a layer
- **Model** - Complete architecture model across all layers
- **Manifest** - Model metadata (version, name, etc.)

### Reference & Dependency System (`core/`)

- **Reference Registry** - Tracks cross-layer references
- **Relationship Registry** - Tracks intra-layer relationships
- **Dependency Tracker** - Builds and analyzes dependency graphs
- **Projection Engine** - Projects dependencies across layers

### Validation Pipeline (`validators/`)

1. **Schema Validation** - JSON schema compliance
2. **Naming Validation** - Naming convention enforcement
3. **Reference Validation** - Cross-layer reference integrity
4. **Semantic Validation** - Business rule validation

### Export System (`export/`)

- **ArchiMate** - Layers 1, 2, 4, 5
- **OpenAPI** - Layer 6 (API)
- **JSON Schema** - Layer 7 (Data Model)
- **PlantUML** - Visual diagrams
- **Markdown** - Documentation
- **GraphML** - Graph visualization

## Standards and Conventions

### Industry Standards

- **ArchiMate 3.2** - Layers 1, 2, 4, 5
- **OpenAPI 3.0** - Layer 6
- **JSON Schema Draft 7** - Layer 7
- **OpenTelemetry** - Layer 11
- **PlantUML, GraphML** - Visualizations

### Coding Conventions

- Follow TypeScript best practices
- Type annotations throughout
- JSDoc comments for public functions/classes
- Commands in `commands/`, core logic in `core/`, validators in `validators/`
- Tests: `tests/unit/` and `tests/integration/`

### Data Storage

- Filesystem-based (no database)
- Models in `.dr/` directory
- Manifest: `.dr/manifest.json`
- Layers: `.dr/layers/{layer-name}.json`

## Development Workflow

### Adding a New Command

1. Create command file in `commands/`
2. Implement command class (inherit from base)
3. Register in `cli.ts`
4. Add integration tests in `tests/integration/`
5. Run `npm run test` to verify

### Adding/Modifying a Layer

1. **ASK FIRST** - Layer changes affect spec
2. Update `spec/layers/{layer}.md`
3. Update `spec/schemas/{layer}.schema.json`
4. Copy schema to `cli/src/schemas/bundled/`
5. Update validators if needed
6. Add export support if applicable
7. Update tests

### Adding an Export Format

1. Create exporter in `export/`
2. Inherit from base exporter pattern
3. Register in export manager
4. Add tests in `tests/unit/`

### Testing

```bash
# Run all tests
npm run test

# Run specific test file
npm run test -- tests/unit/test-reference-registry.test.ts

# Run integration tests only
npm run test:integration
```

**Testing Strategy:**

- **Unit tests**: Test components in isolation, mock dependencies, focus on edge cases
- **Integration tests**: Test complete workflows using temporary directories
- **Fixtures**: Common test data in test files

## Key Files to Understand

1. **cli.ts** - CLI entry point, command routing
2. **core/model.ts** - Central model management
3. **core/reference-registry.ts** - Reference tracking system
4. **core/relationship-registry.ts** - Intra-layer relationship tracking
5. **validators/semantic.ts** - Business rule validation
6. **export/export-manager.ts** - Export orchestration

## Common Pitfalls

1. **Schema Synchronization**
   - Schema changes require updating BOTH spec and CLI schemas
   - Layer schemas include relationship metadata:
     - `layerMetadata` - layer identifier and catalog version
     - `intraLayerRelationships` - relationships within the layer
     - `crossLayerRelationships` - outgoing/incoming relationships to/from other layers
   - Relationship catalog (`relationship-catalog.json`) bundled with CLI
   - Always update both spec and CLI or validation will fail

2. **Cross-Layer References**
   - Violating the "higher → lower" rule
   - Not validating references exist before creating
   - Forgetting to use reference registry

3. **Element IDs**
   - Not following `{layer}-{type}-{kebab-case}` convention
   - Creating duplicate IDs across layers
   - Manually constructing IDs instead of using utilities

4. **Export Format Compatibility**
   - Attempting to export layers to unsupported formats
   - Not checking format compatibility before exporting

5. **Version Bumps**
   - Manually editing version numbers
   - Use `/dr-release-prep` command for proper release preparation

## CLI Implementation

The Bun CLI is a TypeScript/Bun implementation providing:

| Aspect           | Bun CLI                    |
| ---------------- | -------------------------- |
| **Status**       | Production-ready           |
| **Performance**  | ~200ms startup (8x faster) |
| **Installation** | `npm install -g`           |
| **Environment**  | Node.js 18+                |
| **Version**      | v0.1.0                     |
| **Development**  | Modern TS, Bun test        |
| **Package Mgmt** | npm/Bun                    |

### Using the Bun CLI

All commands follow intuitive patterns:

```bash
# Basic operations
dr init --name "My Model"
dr add business service my-service --name "My Service"
dr list api
dr validate

# Advanced features
dr trace element-id
dr export archimate --output model.xml
dr visualize
dr chat
```

For complete command documentation:

```bash
dr --help                    # Show all commands
dr <command> --help          # Show command-specific help
```

## Design Philosophy

1. **Separation of Concerns** - Clear boundaries between commands, core logic, validators
2. **Extensibility** - Easy to add layers, validators, export formats
3. **Standards Compliance** - Leverage industry standards (ArchiMate, OpenAPI, etc.)
4. **Testability** - Comprehensive unit and integration test coverage
5. **User Experience** - Clear errors, helpful output, intuitive commands

## Documentation

- Main README: `/README.md`
- Specification: `/spec/` (especially `spec/layers/` and `spec/CHANGELOG.md`)
- CLI README: `/cli/README.md`
- CLI design docs: `/cli/docs/`
- Release command: `/dr-release-prep` for version management
