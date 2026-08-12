# CLI Changelog

All notable changes to the Documentation Robotics CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.8] - 2026-08-12

**Specification Support:** v0.8.4

### Fixed

- **`dr visualize` no longer requires Bun**: the visualization server had a hard runtime
  dependency on Bun-specific APIs (`Bun.serve()`, `hono/bun`, `Bun.spawn`/`Bun.spawnSync`,
  `Bun.watch`), so it needed a separate Bun install even though `dr` itself runs fine under
  plain Node.js — the actionable-error workaround shipped in 0.1.7 (#799) only softened the
  landing. Replaced with `@hono/node-server`, `@hono/node-ws`, `node:child_process`, and
  `chokidar`, and changed the CLI to spawn the server subprocess via `process.execPath`
  (whichever runtime is already running the CLI) instead of a literal `bun` binary. `dr
  visualize` now works end-to-end — HTTP, WebSocket, file watching, and the AI chat feature —
  on a machine with only Node.js installed. (#800)
- **Chat subprocess spawn failures no longer crash the whole server**: `launchClaudeCodeChat`/
  `launchCopilotChat` had no error handler on the newly-Node `child_process.spawn()` call.
  Node reports spawn failures (e.g. `claude`/`gh`/`copilot` missing from `PATH`) asynchronously
  via an `'error'` event rather than a synchronous throw, and an unhandled one crashed the
  entire `dr visualize` process — dropping every connected client — instead of failing just the
  one chat request that triggered it.
- **Hung chat subprocesses could never be force-killed**: the SIGTERM→SIGKILL escalation logic
  checked `proc.killed`, which under Node means "`kill()` was called," not "the process actually
  exited" (Bun's `Subprocess.killed`, which this code was originally written against, means the
  latter) — so a subprocess that ignored SIGTERM was never escalated to SIGKILL and leaked
  indefinitely instead of being cleaned up.
- **`dr visualize` crashed instead of showing a clean error when the port was already in use**:
  a bind failure (e.g. `EADDRINUSE` from a still-running previous instance) is reported
  asynchronously by Node's HTTP server; `start()` now waits for it and surfaces an actionable
  "port already in use" message instead of an unhandled exception.

(#803)

## [0.1.7] - 2026-08-12

cli-v0.1.6 was tagged but never published — CI's release gate failed on analyzer
integration tests that had always been running under a silently-broken timeout
config (see CI notes below). No npm package or GitHub release was ever created
for 0.1.6, so its entry is renamed to 0.1.7 rather than superseded by a new one.

**Specification Support:** v0.8.4

### Fixed

- **Fresh installs were broken**: `npm install -g @documentation-robotics/cli` failed with
  `Cannot find module '@opentelemetry/api-logs'`, then (once worked around) `Cannot find
  module 'glob'`. Both packages — along with the rest of the `@opentelemetry/*` family that's
  actually reachable at runtime — were misclassified as `devDependencies`, which npm does not
  install for consumers of a published package, even though they're imported unconditionally
  by core, always-loaded code (`telemetry/index.ts`, `core/relationship-catalog.ts`). Moved
  the reachable packages to `dependencies`; kept the rest (only ever loaded by an internal
  debug build variant that's never published) in `devDependencies` to avoid bloating installs.
  (#797)
- **`dr visualize` now fails elegantly when Bun isn't installed**: it spawns its server as a
  Bun subprocess, which previously crashed with a raw, unexplained `spawn bun ENOENT` on any
  machine without Bun (true for every fresh install, since Bun is devDependency-only). It now
  shows an actionable error with install instructions instead. `dr visualize` still requires
  Bun for now — removing that dependency entirely is tracked in #800. (#799)

### CI

- The release pipeline now packs the CLI and installs it globally with `--omit=dev` into an
  isolated prefix before every release — simulating a real `npm install -g` consumer install —
  then runs `dr --version`/`dr --help` as a release gate. This class of dependency-classification
  bug can no longer reach a publish.
- Fixed the analyzer MCP `initialize` handshake timeout (2000ms → 5000ms) and the test suite's
  real per-test timeout, which had silently been Bun's 5000ms default rather than the intended
  30s — `bunfig.toml`'s `timeoutMs` key was never a real Bun config option. Both issues surfaced
  together when `codebase-memory-mcp` (an external, unpinned CI dependency) got slower across
  three releases in 48 hours. Now set via an explicit `--timeout=30000` flag on every `bun test`
  invocation. See #802 for the full investigation.

## [0.1.5] - 2026-07-23

**Specification Support:** v0.8.4

### Added

- **Full `dr analyzer` subcommand suite** (CBM analyzer) — six new subcommands for
  querying an indexed project's code-behavior model:
  - `services` — infers services/components from indexed code using mapping-driven
    heuristics (no hardcoded labels), with `--layer` filtering
  - `datastores` — infers datastores/databases by cross-referencing `IMPORTS` edges
    and naming patterns against the analyzer mapping
  - `callers <qualified-name>` / `callees <qualified-name>` — traverses the call
    graph in either direction with configurable `--depth` (default 3, max 10)
  - `query <cypher>` — raw Cypher passthrough as an advanced escape hatch
  - All subcommands support `--json` output and respect the active analyzer session
- **`dr analyzer verify`** — compares graph-discovered API routes against modeled
  `api` layer endpoints and reports four buckets: `matched`, `in_graph_only` (gaps),
  `in_model_only` (drift), and `ignored`. Supports changeset-aware verification
  (transparently diffs against the active changeset's projected view), `.dr-verify-ignore.yaml`
  for suppressing known false positives (glob matching on `handler`/`path`, exact
  matching on `element_ids`), and `text`/`json`/`markdown` output formats
  (`--format`, or inferred from `--output` file extension)

### Changed

- **CBM analyzer error handling hardened** — silent `return []` / empty-catch
  fallbacks across `services()`, `datastores()`, `verify()`, and call-graph
  traversal replaced with explicit `CLIError`s and diagnostic warnings, so
  misconfiguration (missing heuristics, invalid graph responses, path resolution
  failures) surfaces as actionable errors instead of confusing empty results
- **Bundled viewer updated to v0.4.0** — `dr visualize` now serves the "Heimdall" UX
  rebuild of the `documentation_robotics_viewer` bundle, which replaces the previous
  React Flow / Flowbite React / Storybook front-end stack with `@tinkermonkey/heimdall-ui`.
  The REST/WebSocket API contract, JSON-RPC chat service, and `spec_node_id` format are
  unchanged, so no CLI server or client code changes were required.

## [0.1.3] - 2026-03-14

**Specification Support:** v0.8.3

### Added

- **Cross-layer relationship support** — model elements can now reference elements in
  lower layers via typed relationships; the relationship registry tracks and validates
  these cross-layer links at commit time
- **`/dr-relate` command** — new Claude Code integration command for creating and
  managing cross-layer relationships interactively
- **`/dr-audit-resolve` command** — new Claude Code integration command for walking
  through relationship and node audit findings and applying spec or model updates
  directly; supports `--auto` mode for non-interactive bulk resolution

### Changed

- **`/dr-ingest` renamed to `/dr-map`** across all integration files for improved
  clarity; `/dr-ingest` is no longer available
- **`dr validate --strict`** now counts intra-layer relationships in addition to
  cross-layer references, making the strict quality gate non-trivial to pass on a
  sparsely connected model
- **Bundled spec updated to v0.8.3** — 1,447 total relationships (up from 969),
  including 495 new inter-layer schemas and 2 new APM node types (`apm.alert`,
  `apm.dashboard`)

### Fixed

- **Changeset create** no longer fails to activate the newly created changeset as the
  active changeset
- **Changeset delete** guard now correctly warns when attempting to delete the active
  changeset instead of silently proceeding
- **False conflict detection** in drift detection: source and installed files that are
  already in sync no longer reported as conflicting
- **`/api/model`** server endpoint no longer returns an empty `links` array when the
  model contains relationships

## [0.1.2] - 2026-03-08

**Specification Support:** v0.8.2

### Added

#### Enhanced Delete Command

- **Cascade deletion** - `--cascade` flag removes dependent elements automatically to prevent orphaned references
- **Dry-run mode** - `--dry-run` flag previews what would be deleted without actually deleting
- **Dependency display** - Shows all elements that depend on the target element before deletion
- **Transitive dependency tracking** - Identifies both direct and transitive dependents
- **Safe deletion workflow** - Prevents deletion of elements with dependents unless explicitly cascaded

#### Relationship Catalog Command (Modern Link Registry Replacement)

- **`catalog types`** - List all relationship types from the catalog with filtering by category or layer
- **`catalog info`** - Display catalog metadata (version, total types, categories)
- **`catalog search`** - Search relationship types by keyword across ID, predicate, and description
- **`catalog validate`** - Validate model relationships against the catalog with strict mode support
- **`catalog docs`** - Generate comprehensive markdown or JSON documentation
- **Modern architecture** - Uses `relationship-catalog.json` v2.1.0 instead of deprecated `link-registry.json`
- **34 relationship types** - Covers structural, behavioral, dependency, flow, and other semantic relationships
- **ArchiMate alignment** - Maps relationships to ArchiMate 3.2 concepts where applicable
- **Multiple output formats** - Table, JSON, and Markdown for different use cases

#### Core Relationship Catalog System

- **RelationshipCatalog class** - Manages semantic relationship type definitions
- **Predicate validation** - Ensures relationships use valid predicates from the catalog
- **Layer-specific filtering** - Get relationship types applicable to specific layers
- **Category-based organization** - Group relationships by semantic category
- **Rich metadata** - Includes directionality, transitivity, symmetry for each relationship type

#### Improved Safety Features

- **Dependency checking** - Automatically detects and warns about dependent elements
- **Preview capability** - Combine `--cascade --dry-run` to see all elements that would be removed
- **Enhanced error messages** - Clear guidance on using `--cascade` or `--force` flags
- **Relationship validation** - Validates predicates and layer applicability

### Changed

- **`--force` flag behavior** - Now also skips dependency checks in addition to confirmation prompts
- **Delete command output** - More detailed information about dependencies and elements to be removed

#### Migration Tools & Documentation

- **Comprehensive migration guide** - Complete guide for migrating from Python CLI to TypeScript CLI (`docs/MIGRATION_FROM_PYTHON_CLI.md`)
- **Annotation export utility** - Tool to export Python CLI annotations to JSON/Markdown (`cli/src/utils/export-python-annotations.ts`)
- **Deprecation notice** - Formal deprecation announcement with timeline and FAQ (`docs/PYTHON_CLI_DEPRECATION.md`)
- **CI/CD migration examples** - GitHub Actions, GitLab CI, Jenkins, Docker examples
- **Command mapping table** - Complete mapping of all Python CLI commands to TypeScript CLI equivalents
- **Troubleshooting guide** - Common migration issues and solutions

### Deprecated

- **Python CLI (entire codebase)** - Deprecated as of January 2026
  - Final release: v0.8.0 (planned)
  - Removal: After 1-month transition period
  - Migration: See `docs/MIGRATION_FROM_PYTHON_CLI.md`
  - Reason: Uses deprecated link-registry.json, slower performance, divided development effort

- **Python CLI's `links` command** - Replaced by modern `catalog` command in TypeScript CLI
  - Old system used deprecated `link-registry.json` (removed in spec v0.8.0)
  - New system uses `relationship-catalog.json` v2.1.0+
  - Migration: Use `dr catalog types` instead of `dr links types`

### Fixed

- **UUID/path identifier separation** — Elements now carry two distinct identifiers: `id`
  (UUIDv4, schema-compliant) and `path` (`{layer}.{type}.{kebab-name}` slug, graph key and
  user-facing identifier). Resolves 241 schema validation errors caused by slug-format ids
  failing `format: uuid` validation and UUID ids failing naming convention checks.
  - Migration-on-load handles all existing model data automatically — no manual steps required
  - All CLI lookups, exports (ArchiMate, OpenAPI, PlantUML, GraphML, Markdown), display
    commands, and validators updated to use `path` as the human-readable identifier
  - Deterministic UUID derivation (SHA-256-based) ensures stable ids across repeated loads
    during migration
- **Changeset commit crash** — Fixed crash when relationships registry is missing from
  projected model during changeset commit
- **Visualize command port detection** — `dr visualize` now auto-detects an available port
  when the default port is already in use
- **Visualization server hang** — Fixed hang caused by incorrect `spec_node_id` derivation
  for elements in the viewer-compatible spec format
- **dr-viewer bundled** — Visualization UI updated to dr-viewer v0.3.0

## [0.1.1] - 2026-02-28

**Specification Support:** v0.8.1

### Added

- **Relationship Audit** (`dr audit`): Comprehensive analysis of relationship coverage,
  semantic duplicates, gap analysis, and balance across all 12 layers. Features:
  - Text, JSON, and Markdown output formats
  - Quality gate mode (`--threshold`, exits 1 if below thresholds)
  - AI-assisted evaluation (`--enable-ai`) for low-coverage elements
  - Before/after differential pipeline (`--pipeline`)
  - Per-layer filtering (`--layer <name>`)
  - Writes both JSON and Markdown reports by default
- **Node Audit**: Per-layer spec node type quality analysis (AI-assisted evaluation
  for alignment scoring)
- **Spec Reference Installation**: `dr init` now installs the complete specification
  reference to `.dr/spec/` for offline validation and introspection
- **Visualization Server OpenAPI spec**: Auto-generated via `npm run generate:openapi`;
  includes full bearer auth security scheme on all 13 protected `/api/*` routes

### Fixed

- **OpenAPI Exporter**: Fixed `TypeError: Cannot read properties of undefined (reading
  'schemas')` crash when exporting models with no schema definitions
- **Visualization Server API**: Aligned `ElementResponseSchema` with full
  `IElement.toJSON()` shape — added `spec_node_id`, `layer_id`, `attributes`,
  `source_reference`, `metadata`, `references`, and `relationships` fields; corrected
  `source_reference` nested structure and `id` field validator
- **Bundled schemas**: Pruned 148 stale node schemas from `cli/src/schemas/bundled/`
- **Upgrade conflicts**: Fixed missing baseline handling in integration upgrade conflict
  detection
- **Compatibility suite**: Updated test cases for renamed `data-store` node types
  (`table`→`collection`, `column`→`field`); all 141 steps pass

### Changed

- **Spec bundle format**: CLI now bundles spec as 14 compiled JSON files
  (manifest.json + base.json + 12 layer files) instead of individual schema files;
  schema validator, relationship schema validator, and relationship catalog updated
  to read the new flat format
- **Removed dead commands**: Deleted `migrate`, `chat-logs`, `graph-migrate`,
  `model-migrate`, `project`, and `element` subcommands; removed `ProjectionEngine`,
  `graph-migration`, `neo4j-migration`, `ladybug-migration`, `graph-mapping`
- **Predicate validation now active**: Semantic validator loads predicates from
  `base.json` (previously referenced a non-existent `relationship-catalog.json`)
- **Audit output**: `dr audit` writes both JSON and Markdown reports by default

## [0.1.0] - 2026-01-11

### 🎉 Initial Release

First stable release of the Documentation Robotics CLI - a TypeScript/Bun implementation providing fast, production-ready architecture modeling.

**Specification Support:** v0.7.1

### Added

#### Core Model Management

- **Initialize models** - Create new DR models with `dr init`
- **Element operations** - Add, update, delete, and show elements across all 12 layers
- **List and search** - Query elements by layer, type, or search term
- **Model info** - Display model metadata and statistics

#### Validation Pipeline

- **4-stage validation** - Schema, naming, reference, and semantic validation
- **Schema validation** - JSON Schema compliance (AJV)
- **Naming validation** - Element ID format enforcement (`{layer}.{type}.{kebab-case-name}`)
- **Reference validation** - Cross-layer reference integrity (higher → lower only)
- **Semantic validation** - Business rule validation
- **Validation commands** - `dr validate`, `dr validate-layer`, `dr validate-element`

#### Cross-Layer Integration

- **Reference registry** - Tracks 60+ cross-layer reference patterns
- **Relationship registry** - Manages intra-layer relationships with predicates
- **Dependency tracing** - `dr trace` for impact analysis
- **Projection** - `dr project` to project dependencies between layers
- **Link management** - Discover, validate, and document inter-layer links

#### Model Evolution

- **Changesets** - Track, apply, and revert model changes
- **Migration system** - Automated migration between specification versions
- **Upgrade command** - Unified `dr upgrade` for spec reference and model migration
- **Conformance checking** - `dr conformance` validates model completeness

#### Export Formats

- **ArchiMate** - Export layers 1, 2, 4, 5 (motivation, business, application, technology)
- **OpenAPI** - Export layer 6 (API) to OpenAPI 3.0 specs
- **JSON Schema** - Export layer 7 (Data Model) to JSON Schema
- **PlantUML** - Visual diagrams for all layers
- **Markdown** - Documentation export for all layers
- **GraphML** - Graph analysis format for all layers

#### Visualization Server

- **Interactive web interface** - `dr visualize` launches server at http://localhost:8080
- **WebSocket support** - Real-time model updates
- **Element annotations** - Add comments and notes to elements
- **Changeset tracking** - View and manage changesets
- **File watching** - Auto-reload on model changes
- **Authentication** - Token-based auth (enabled by default)

#### AI Integration

- **Claude Code client** - Chat about your model with Claude
- **GitHub Copilot client** - Chat about your model with Copilot
- **Multi-client support** - Auto-detect available AI CLI tools
- **Context provider** - Provides model context to AI conversations
- **Agent abstraction** - Unified interface for AI interactions
- **Preference storage** - Remembers your preferred AI client

#### Source Code Linking

- **Source references** - Link architecture elements to source code locations
- **Provenance tracking** - Track how references were created (extracted, manual, inferred, generated)
- **Repository context** - Optional Git remote URL and commit SHA
- **Symbol references** - Link to specific functions, classes, or variables
- **Search by source** - Find elements by source file path

#### Developer Experience

- **Fast startup** - ~150ms CLI startup time (8x faster than Python CLI)
- **Comprehensive help** - Detailed help for every command
- **Error messages** - Clear, actionable error messages with fix suggestions
- **Verbose and debug modes** - `--verbose` and `--debug` flags for troubleshooting
- **JSON output** - `--json` flag for machine-readable output

#### Testing & Compatibility

- **713 passing tests** - Comprehensive unit and integration test coverage
- **Python CLI compatibility** - Load and work with Python CLI models
- **Test fixtures** - Valid and invalid test cases for all validators
- **CI/CD ready** - GitHub Actions workflows included

### Standards Support

- **ArchiMate 3.2** - Layers 1, 2, 4, 5 (motivation, business, application, technology)
- **OpenAPI 3.0** - Layer 6 (API)
- **JSON Schema Draft 7** - Layer 7 (data model) and all schemas
- **OpenTelemetry** - Layer 11 (APM/observability)
- **SQL DDL** - Layer 8 (datastore)

### The 12 Layers

1. **Motivation** - Goals, requirements, stakeholders
2. **Business** - Business processes and services
3. **Security** - Authentication, authorization, threats
4. **Application** - Application services and components
5. **Technology** - Infrastructure and platforms
6. **API** - REST APIs and operations
7. **Data Model** - Entities and relationships
8. **Data Store** - Database schemas
9. **UX** - User interface components (3-tier architecture)
10. **Navigation** - Application routing
11. **APM** - Observability and monitoring
12. **Testing** - Test strategies and cases

### Performance

- **Startup time** - ~150ms (vs ~1.2s for Python CLI)
- **Build time** - Fast TypeScript + esbuild bundling
- **Test execution** - 713 tests in ~137 seconds
- **Package size** - 482.2 KB

### Requirements

- **Node.js 18+** - Required for running the CLI
- **Bun 1.3+** - Optional, used for development and testing

### Installation

```bash
npm install -g @documentation-robotics/cli
dr --version
```

### Documentation

- **README.md** - Installation and usage guide
- **NPM_PUBLISHING_SETUP.md** - npm publishing instructions
- **CONTRIBUTING.md** - Development guide
- **Specification** - Complete 12-layer specification in `../spec/`

### Known Issues

- **Build warnings** - Four non-critical warnings about require/esm conversion in test instrumentation
- **File watching** - May not work in some environments (Bun.watch not available)

### Notes

- This is the first public npm release
- Python CLI compatibility maintained for migration path
- Future releases will be published via GitHub Actions with provenance attestation

---

## Release Information

**Git Tag:** `cli-v0.1.0`
**npm Package:** `@documentation-robotics/cli@0.1.0`
**Specification Version:** v0.7.1
**Release Date:** January 11, 2026
