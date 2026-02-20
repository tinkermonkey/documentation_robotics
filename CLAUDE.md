# CLAUDE.md - AI Assistant Guide

## Project Overview

**Documentation Robotics** is a toolkit for managing federated architecture data models across 12 interconnected layers.

**Components:**

1. **CLI Tool (`cli/`)** - TypeScript implementation for managing architecture models
2. **Metadata Model Specification** - Formal documentation defining the 12-layer model

**Current Versions:** CLI v0.1.0, Spec v0.8.0

## Repository Structure

```
documentation_robotics/
├── spec/                        # SPECIFICATION (source of truth)
│   ├── VERSION                  # Spec version number
│   ├── layers/                  # 12 SpecLayer instance files (.layer.json)
│   └── schemas/                 # All JSON Schema definitions
│       ├── base/                #   Core schemas: spec-node, spec-layer, spec-node-relationship,
│       │                        #   attribute-spec, source-references, predicates.json
│       ├── nodes/               #   354 per-type node schemas (.node.schema.json)
│       │   ├── motivation/      #     Organized by layer
│       │   ├── business/        #     Defines valid model element types
│       │   └── ...              #     Hand-maintained
│       ├── relationships/       #   252 per-type relationship schemas
│       │   ├── motivation/      #     (.relationship.schema.json)
│       │   └── ...              #     Hand-maintained
│       └── relationship-catalog.json  # Semantic relationship type catalog
│
└── cli/                         # TYPESCRIPT CLI
    ├── src/
    │   ├── commands/           # 30 command implementations
    │   ├── core/               # Domain models & registries
    │   ├── validators/         # Validation pipeline (uses spec node schemas)
    │   ├── export/             # Export handlers
    │   └── schemas/bundled/    # Bundled schemas (synced from spec/)
    │       ├── base/           #   Base and common schemas
    │       └── nodes/          #   354 spec node schemas for validation
    └── tests/                  # Unit & integration tests (~114 test files)
```

## Quick Start

```bash
cd cli && npm install && npm run build
npm run test              # Run all tests
node dist/cli.js --help   # CLI usage

# Pre-commit checks
pre-commit run --all-files
```

See `cli/README.md` for complete setup and usage documentation.

## Critical Rules

### 1. Spec vs. CLI Separation

- **Two separate version numbers**: Spec (`spec/VERSION`) and CLI (`cli/package.json`)
- **Schema synchronization**: Schema changes require updating BOTH locations:
  - Base schemas: `spec/schemas/base/` → `cli/src/schemas/bundled/base/`
  - Base schemas: `spec/schemas/base/` → `cli/src/schemas/bundled/base/`
  - Node schemas: `spec/schemas/nodes/` → `cli/src/schemas/bundled/nodes/`
  - Run `npm run build` in CLI (triggers `scripts/sync-spec-schemas.sh`)
- **Sources of truth (hand-maintained)**:
  - Spec node schemas: `spec/schemas/nodes/{layer}/*.node.schema.json` (extend `spec-node.schema.json` via `allOf`)
  - Spec relationship schemas: `spec/schemas/relationships/{layer}/*.relationship.schema.json` (extend `spec-node-relationship.schema.json` via `allOf`)
  - Layer instances: `spec/layers/*.layer.json`

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

- **Format**: `{layer}.{elementType}.{kebab-case-name}`
- **Example**: `api.endpoint.create-customer`
- **Element ID Type Segment**: Lowercase format (e.g., `endpoint`, `service`, `goal`) - this is what appears in the element ID
- **CLI Type Parameter**: Use lowercase form when running `dr add <layer> <type> <name>` (e.g., `dr add api endpoint create-customer`)
- **Conceptual Type Name**: Documentation uses PascalCase (e.g., `Endpoint`, `BusinessService`, `Goal`) for formal reference
- Must be unique across entire model
- Use element utilities for consistency
- **See Also**: [Element Type Reference](docs/ELEMENT_TYPE_REFERENCE.md) for comprehensive type documentation with correct CLI usage
- See Section 4.1 for canonical layer name requirements in element IDs

### 4.1 Canonical Layer Naming Format

**Internal Layer Names** - The CLI uses canonical **hyphenated, lowercase layer names** for all internal references:

| Layer | Canonical Name | Layer Instance              | Notes                                               |
| ----- | -------------- | --------------------------- | --------------------------------------------------- |
| 1     | `motivation`   | `01-motivation.layer.json`  | Single word, no hyphen                              |
| 2     | `business`     | `02-business.layer.json`    | Single word, no hyphen                              |
| 3     | `security`     | `03-security.layer.json`    | Single word, no hyphen                              |
| 4     | `application`  | `04-application.layer.json` | Single word, no hyphen                              |
| 5     | `technology`   | `05-technology.layer.json`  | Single word, no hyphen                              |
| 6     | `api`          | `06-api.layer.json`         | Single word, no hyphen                              |
| 7     | `data-model`   | `07-data-model.layer.json`  | **Hyphenated** - use `data-model`, not `data_model` |
| 8     | `data-store`   | `08-data-store.layer.json`  | **Hyphenated** - use `data-store`, not `datastore`  |
| 9     | `ux`           | `09-ux.layer.json`          | Single word, no hyphen                              |
| 10    | `navigation`   | `10-navigation.layer.json`  | Single word, no hyphen                              |
| 11    | `apm`          | `11-apm.layer.json`         | **Short form internally** - schema uses full name   |
| 12    | `testing`      | `12-testing.layer.json`     | Single word, no hyphen                              |

**Key Rules**:

- Always use the canonical name in CLI commands and code (e.g., `--layer data-store` not `--layer datastore`)
- Accept only canonical names in validators (no underscore variants)

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

## Architecture Overview

### Core Domain (`core/`)

- **Model** - Complete architecture model across all layers
- **Layer** - Container for elements within a layer
- **Element** - Individual architecture items
- **Reference Registry** - Tracks cross-layer references
- **Relationship Registry** - Tracks intra-layer relationships

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

### Data Storage

- **Filesystem-based** (no database)
- **Base model** in `documentation-robotics/model/` directory
  - Manifest: `documentation-robotics/model/manifest.yaml`
  - Layers: `documentation-robotics/model/{layer-number}_{layer-name}/`
- **Changesets** in `documentation-robotics/changesets/` directory
  - Each changeset: `{changeset-id}/metadata.yaml` and `changes.yaml`
  - Migration: Old `.dr/changesets/` auto-migrates to new location on first use
  - Backup: `.dr.backup/changesets/` created during migration for rollback

## Common Pitfalls

### 1. Schema Synchronization

**CRITICAL**: Schema changes require updating BOTH `spec/schemas/` and `cli/src/schemas/bundled/`.

This applies to:

- **Base schemas** in `base/` (e.g., `spec-node.schema.json`)
- **Common schemas** in `common/` (e.g., `attribute-spec.schema.json`, `source-references.schema.json`)
- **Layer schemas** (e.g., `01-motivation-layer.schema.json`)
- **Relationship catalog** (`relationship-catalog.json`)

### 2. Cross-Layer References

- **Never** violate the "higher → lower" rule
- Always validate references exist before creating
- Use the reference registry, don't manually check

### 3. Element IDs

- **Must** follow `{layer}.{elementType}.{kebab-case}` convention
- Element type segment uses **lowercase**: `goal`, `service`, `endpoint`, `component`, etc. (not PascalCase in the ID itself)
- In CLI commands, use **lowercase** for the type parameter: `dr add motivation goal customer-satisfaction`
- Element names are **kebab-case**: `customer-satisfaction`, `order-management`
- Must be unique across entire model
- Use element utilities, don't manually construct IDs
- Example: `motivation.goal.customer-satisfaction` (✅ Correct)
- Example: `api.endpoint.create-order` (✅ Correct)
- Example: `api-endpoint-create-order` (❌ Incorrect - wrong format)
- Example: `motivation.Goal.customer-satisfaction` (❌ Incorrect - type segment should be lowercase)

### 4. Export Format Compatibility

- ArchiMate only supports layers 1, 2, 4, 5
- OpenAPI only supports layer 6
- JSON Schema only supports layer 7
- Check format compatibility before exporting

### 5. Version Bumps

- **Never** manually edit version numbers
- Use `/dr-release-prep` command for proper release preparation
- Maintains consistency across changelogs and versions

## Development Quick Reference

### Adding a Command

1. Create in `cli/src/commands/`
2. Register in `cli/src/cli.ts`
3. Add tests in `cli/tests/integration/`
4. Run `npm run test`

### Modifying a Layer

1. **ASK FIRST** - Layer changes affect spec
2. Update `spec/layers/{NN}-{layer}.layer.json`
3. Update node schemas in `spec/schemas/nodes/{layer}/*.node.schema.json` if adding/changing types
4. Update `spec/schemas/{NN}-{layer}-layer.schema.json` if schema structure changes
5. Sync changed schemas to `cli/src/schemas/bundled/`
6. Update validators and tests as needed

### Key Files

- `cli/src/cli.ts` - CLI entry point, command routing
- `cli/src/core/model.ts` - Central model management
- `cli/src/core/reference-registry.ts` - Reference tracking
- `cli/src/core/relationship-registry.ts` - Relationship tracking
- `cli/src/validators/semantic.ts` - Business rule validation
- `cli/src/core/virtual-projection.ts` - Virtual projection engine
- `cli/src/core/staged-changeset-storage.ts` - Changeset persistence
- `cli/src/core/drift-detector.ts` - Drift detection logic
- `spec/schemas/base/spec-node.schema.json` - Base schema for all node types
- `cli/scripts/generate-spec-instances.ts` - Generates spec layer/node/predicate instances
- `scripts/generate-layer-docs.ts` - Generates markdown docs from spec instances

### Schema and Validation Commands

Introspect and validate architecture specifications:

```bash
dr schema layers                                  # List all layers with node type counts
dr schema types <layer>                          # List valid node types for a layer
dr schema node <spec_node_id>                    # Show node schema details
dr schema relationship <source_type> [predicate] # Show valid relationships
dr conformance [--layers layer1,layer2]          # Validate model against layer specs
```

Key files: `cli/src/commands/schema.ts`, `cli/src/commands/conformance.ts`

### Relationship Audit

Audit intra-layer relationships for coverage, duplicates, gaps, and balance:

```bash
# Full audit with text output
npm run audit:relationships

# JSON output for CI/CD integration
npm run audit:relationships -- --format json --output audit.json

# Quality gate mode (exit 1 if issues found)
npm run audit:relationships -- --threshold

# Layer-specific audit
npm run audit:relationships -- --layer api --verbose

# Markdown report generation
npm run audit:relationships -- --format markdown --output report.md

# Direct script execution
cd cli
tsx scripts/relationship-audit.ts --help
```

**Output Formats:**

- **text** - Human-readable colored output (default)
- **json** - Machine-parseable for automation
- **markdown** - Documentation-ready reports

**Quality Thresholds:**

- Isolation: ≤ 20% isolated node types
- Density: ≥ 1.5 relationships per node type
- High-Priority Gaps: ≤ 10 gaps
- Duplicates: ≤ 5 duplicate candidates

**Exit Codes:**

- `0` - Success (no issues or below thresholds)
- `1` - Quality issues detected (with `--threshold` flag)
- `2` - Script execution error

Key files: `cli/scripts/relationship-audit.ts`, `cli/scripts/README.md`

### Element Migration

Migrate elements to spec-node aligned format:

```bash
dr migrate elements [--source dir] [--target dir] [--dry-run] [--no-backup]
```

This transforms elements from legacy format to the spec-node aligned structure with proper metadata and source references.

Key files: `cli/src/commands/model-migrate.ts`, `cli/src/export/model-migration.ts`

### Staging Workflow

Changesets provide a safe way to prepare model changes before committing:

```bash
dr changeset create my-feature                              # Create
dr changeset stage my-feature add --element-id ... --layer ...  # Stage changes
dr changeset preview my-feature                             # Preview merged view
dr changeset commit my-feature                              # Commit (with drift detection)
```

Key files: `cli/src/commands/changeset.ts`, `cli/src/core/changeset-migration.ts`
See `docs/STAGING_GUIDE.md` for full documentation.

### Testing

**Standard Test Commands:**

```bash
npm run test              # All tests (authoritative for daily development)
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests only
npm run test:performance  # Performance benchmarks
```

**Parallel Test Execution (Matching CI Pipeline):**

```bash
npm run test:parallel           # 4 parallel shards (same as CI)
npm run test:parallel:coverage  # With coverage
npm run test:fast-track         # Quick PR validation (sequential)
npm run test:shard2             # Debug specific CI shard failure
```

- `npm test` is authoritative for daily development
- Parallel scripts are primarily for debugging CI shard failures
- See `cli/scripts/README.md` for full parallel testing documentation

### Golden Copy Test Initialization

Tests use a shared golden copy pattern for fast, isolated test directories:

```typescript
import { createTestWorkdir } from "../helpers/golden-copy.js";

const workdir = await createTestWorkdir(); // Cloned from golden copy
// ... use workdir.path, call workdir.cleanup in afterEach
```

- **Baseline source**: `cli-validation/test-project/baseline/` — edit this to add test data
- **Golden copy helper**: `cli/tests/helpers/golden-copy.ts`
- **Auto-initialized**: Via `cli/tests/setup.ts` (preloaded by Bun)

### Specification Validation Strategy

**Validation Layers** (Pre-commit + CI):

1. **Pre-commit Hooks** (Local Developer Workflow)
   - **Markdown Linting**: Pre-commit lints all layer documentation and schema-related markdown files
   - **TypeScript Type Checking**: Pre-commit validates CLI TypeScript code for type safety
   - **File Integrity**: Pre-commit checks for trailing whitespace, CRLF line endings, and other basic file hygiene
   - **Purpose**: Catch structural issues early before committing broken specs
   - **Note**: JSON Schema syntax validation is performed in CI (see below) rather than pre-commit for reliability

2. **CI Pipeline Validation** (`.github/workflows/cli-tests.yml` - `spec-validation` job)
   - **Schema Syntax Validation**: All 354 node schemas + 252 relationship schemas validated for valid JSON
   - **Markdown Validation**: Layer specifications markdown linting
   - **Cross-validation**: CLI schema bundling checked against spec schema source via `dr validate --schemas`
   - **Purpose**: Ensure specs remain valid throughout development, prevent broken commits from reaching main

3. **CLI Validation Commands** (Runtime)
   - `dr validate --schemas`: Cross-validates spec schemas with CLI bundled schemas
   - Provides immediate feedback when working with models

**Key Points**:

- **Pre-commit prevents broken local commits** — catches file format/syntax errors
- **CI validates spec correctness** — runs comprehensive schema validation on all PRs/merges
- **Removed hooks**: `validate-markdown-specs`, `validate-relationship-catalog`, and `check-jsonschema` were pre-commit hooks that had reliability issues; their validation is now performed by the CI pipeline's `spec-validation` job for more comprehensive and maintainable validation
- **Why moved to CI**:
  - Custom validation logic is fragile when maintained in pre-commit hooks
  - Schema validation needs to check 606 files; better suited for CI where it runs on all PRs
  - Single source of truth (CI) is easier to debug and maintain
  - Developers get better feedback with CI logs than pre-commit errors
- **If you modify specs**: Changes are validated automatically when you push to PR; no need for manual validation
- **If validation fails**: Check the CI logs in the `spec-validation` job for detailed error messages

## Standards

- **ArchiMate 3.2** - Layers 1, 2, 4, 5
- **OpenAPI 3.0** - Layer 6
- **JSON Schema Draft 7** - Layer 7
- **OpenTelemetry** - Layer 11

## Design Philosophy

1. **Separation of Concerns** - Clear boundaries between commands, core logic, validators
2. **Standards Compliance** - Leverage industry standards (ArchiMate, OpenAPI, JSON Schema)
3. **Testability** - Comprehensive test coverage
4. **User Experience** - Clear errors, helpful output

## Documentation References

- Main README: `/README.md`
- Specification: `/spec/` (especially `spec/layers/` and `spec/CHANGELOG.md`)
- CLI README: `/cli/README.md`
- Release preparation: Use `/dr-release-prep` command
