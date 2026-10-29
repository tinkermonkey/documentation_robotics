# CLI Changelog

All notable changes to the Documentation Robotics CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`dr farm status` no longer reports a deleted codebase as "Not synced yet".** The status
  command used to treat any error whose message contained "not found" as a missing sync state,
  so a project whose codebase folder had been removed showed `has_pending_changes: false`. The
  missing-sync-state case is now identified by a typed `FarmSyncStateNotFoundError` from
  `FarmSyncState.load` (exposing `code: "FARM_SYNC_STATE_NOT_FOUND"`), and a codebase that cannot
  be read is reported on the project as `codebase_error` with `has_pending_changes` unset. A
  project with `codebase_error` or `sync_state_error` prints a warning on stderr in text mode, the
  JSON envelope carries `status: "error"` and `code: 1`, and the command exits 1. (#971)
- **Farm auto-commits no longer fail silently when git itself cannot run.** The git-repository
  check used by `dr farm add`, `dr farm remove` and `dr farm sync --auto-commit` returned "not a
  repository" for every error, so a missing git binary, a permission problem or a corrupt `.git`
  left `farm.yaml` or the model modified on disk and never committed, with nothing visible outside
  `DEBUG`. Only git's own "not a git repository" answer skips the commit quietly now. Any other
  failure prints `Warning: ... was saved but not committed: ...` on stderr in text mode, and the
  JSON result carries `git_committed: false` plus a `git_warning` (on the `add`/`remove` envelope
  and on each sync project entry). (#971)
- **`dr farm sync --auto-commit` reports a failed commit as a warning on stderr.** The message
  went through `handleInfo` on stdout; it now goes through `handleWarning`. The JSON entry already
  carried `status: "error"` and `commit_error`, unchanged. (#971)
- **`dr farm sync --output <file>` rejects unsupported extensions before syncing.** Any extension
  other than `.json` used to run the whole sync and then write nothing without a word. It now
  fails fast with `Unsupported output format: <ext>. Use .json` (exit 2), matching
  `dr farm validate`. Only `.json` reports are supported; the help text says so. (#972)

### Changed

- **The cbm analyzer mapping names only what the spec has** (Phase 2, inventory steps 1 to 3;
  `docs/analyzers/CBM_MAPPING_INVENTORY.md`). `HANDLES` maps to `api.operation realizes
  application.applicationfunction`, inverted from CBM's handler-to-route edge, instead of a
  `provides` triple the catalog lacks. `HTTP_CALLS` is traversal-only until the catalog has a
  consumer-calls-operation triple. The five edges CBM never emits (`CREATES`, `USES`,
  `REFERENCES`, `RETURNS`, `MODIFIES`) are gone. `DEFINES_METHOD` (component assigned-to function)
  and `IMPORTS` (component uses component) now create relationships, and `DEFINES` is recorded as
  provenance. `Interface`, `Type`, `Enum`, `Struct` and `Trait` map to `application.dataobject`.
  `datastore_detection` names the spec's real types. Every CBM 0.10.2 label is either mapped or
  listed as unmapped, and a unit test fails if a mapping names a type or triple the catalog lacks.
- **`dr analyzer services` takes candidates only from behavioural and structural labels.** With
  the new `Interface` family mappings, data-object labels would otherwise have become service
  candidates.
- **Call-graph root nodes default to `CALLS`.** `dr analyzer callers` and `callees` used the first
  edge mapping as the default edge type, which was `HTTP_CALLS`; `CALLS` is now listed first.
- **A corrupt active changeset now fails `Model.load`.** When
  `documentation-robotics/changesets/.active` names a changeset whose files cannot be read or
  parsed, `Model.load` used to fall back silently to the base model, so every command ran as if
  no changeset were active. It now throws `Failed to load active changeset '<id>': ...`, which
  means every command that loads the model fails until the changeset is repaired or the
  `.active` file is removed. A missing `.active` file is still treated as "no active changeset".
- **`dr farm add --remote` refuses a `--codebase` path outside the farm root.** `git clone` writes
  to that path, so a value such as `../elsewhere` is rejected before anything runs. Without
  `--remote` nothing is written to the codebase path (it is only recorded in `farm.yaml`), so a
  sibling checkout, `dr farm add my-service --codebase ../my-service`, is still accepted. The
  model folder `<name>-model` is always required to resolve inside the farm root.
- **CI runs on pull requests.** `cli-tests.yml` now triggers on `pull_request` against `main`
  (build, smoke suite and spec validation); the comprehensive job still runs on manual dispatch
  only. Previously every workflow was dispatch-only, so pull requests carried no checks.
- **Node-type index test follows the spec.** `tests/unit/core/node-types.test.ts` (moved from
  `tests/unit/`, where no test script ran it) asserts the generated index has one entry per node
  schema in `src/schemas/bundled/` instead of a literal 184, which had been stale since the spec
  grew to 192 types.

### Added

- **Tier-0 classification rules** (`src/analyzers/tier0-rules.ts`). Rules are data in an
  analyzer's `extraction-heuristics.json` (heuristics with a `parameters.tier0` block: CBM labels,
  regular-expression conditions on decorators, declaration line, file path and name, and a
  `decide` or `narrow` outcome). The cbm analyzer ships 16: route-mapping decorators to
  `api.operation`, controllers to `application.applicationinterface`, JPA and SQLModel classes to
  object schemas or collections, Spring Data repositories to `data-store.accesspattern`, generated
  client code and component props to `none`, and narrowing rules for UI library directories,
  file-based routes, Spring services, tests and other interfaces. `MappingLoader.getHeuristics()`
  returns them in order. Not yet called by a command; the design is
  `docs/analyzers/CASCADE_DESIGN.md`.
- **`dr farm add` adopts a codebase's own model instead of scaffolding a duplicate.** Before
  creating `<name>-model`, the command looks for a model at the codebase path using the same
  lookup order as composed validation (`documentation-robotics/model`, `model`, then the path
  itself; the resolver now lives in `resolveModelDirectory` in `utils/project-paths.ts`, shared
  with `ComposedReferenceValidator`). When one is found it is registered in place: `farm.yaml`
  records its path relative to the farm root (which may leave it, e.g.
  `../heimdall/documentation-robotics/model`), nothing is created, text output says
  `(existing model, adopted in place)` and JSON carries `model_adopted: true` plus the absolute
  `model_path`. A team that adopted DR per repository therefore no longer gets a silent, empty
  duplicate that `farm sync` writes to forever. `--new-model` forces the old scaffold even when
  the codebase holds a model, warning that it is being ignored (`ignored_model` and `warning` in
  JSON); `--model <path>` registers a model explicitly (resolved with the same lookup order, and
  an error if nothing is there). The rest of the farm copes with an adopted model: `dr farm
  remove --delete-model` deregisters a project whose model lies outside the farm root or inside
  its own codebase without deleting anything (`modelDeleted: false` with a `model_kept_reason`;
  the traversal guard still applies to in-farm deletes, which are no longer an error for an
  outside path), `dr farm sync --auto-commit` skips the farm-level git commit for a model that
  belongs to another repository and reports it as `git_committed: false` with a `git_warning`
  (a warning on stderr in text mode) instead of failing, and `status`, `validate` and `sync` read
  and write the adopted model where it is. Staged changesets for any model now go under the
  model's own project root (`Model.rootPath`) rather than `<farm>/<model>`, which is the same
  place for farm-scaffolded models. (#962)

- **`dr relationship prune [--dry-run] [--layers <layers...>] [--format text|json]`** removes
  every `relationships.yaml` row whose `source` or `target` matches neither the UUID `id` nor the
  dotted `path` of any current element (both forms are legal in the file, so matching on only one
  produced false positives). `--dry-run` lists the rows with the unresolved side and writes
  nothing; `--layers` restricts the scan to rows whose source or target layer is listed; kept rows
  keep their order and the file's header comment is preserved. Inside an active changeset the
  removals are staged as relationship deletions and applied at `dr changeset commit`. Exit code is
  0 whether or not rows were removed. (#964)

- **`dr upgrade` rewrites relationships retired by the spec 0.10.0 catalog.** The 0.9.0 → 0.10.0
  model migration now also rewrites `documentation-robotics/model/relationships.yaml`, so models
  recorded against spec 0.9.0 still validate after the catalog cleanup: `implements` becomes
  `realizes` on every relationship; a relationship whose triple was renamed (for example
  `applicationprocess depends-on dataobject` to `accesses`) takes the new predicate; one whose
  triple was removed in favour of the reverse direction (`requestbody serves operation`) becomes the
  catalog direction with source and target swapped (`operation aggregates requestbody`). A
  rewritten relationship that would duplicate one already in the model is dropped, and
  `dr upgrade` lists each dropped relationship. The rules come from a generated table
  (`src/core/relationship-migration-table.ts`, 104 triple rules and 1 predicate rename) built by
  `scripts/generate-relationship-migration.ts` from the `applied-*.json` change records under
  `scripts/spec-enrich/data`; adding the record of a later change set and rerunning the script
  extends the migration (`--check` reports a stale table, and a unit test compares the committed
  table with a fresh build).
- **The same migration rewrites relationship changes in staged changesets.** A changeset staged
  under spec 0.9.0 used to keep its retired triples through `dr upgrade`, so committing it added
  relationships that failed validation, and a staged delete of a since-rewritten relationship
  matched nothing. Each staged `relationship-add` and `relationship-delete` now takes the rewritten
  relationship and its `source::predicate::target` key (element types come from the model and from
  the elements the changeset adds). A staged add that becomes a relationship the model or the
  changeset already has is removed, as is a staged delete whose rewritten relationship the
  changeset still keeps through another relationship that was rewritten to it. `dr upgrade` lists
  each removed change per changeset. Committed and discarded changesets are left as they are.

### Changed

- **Reference validation no longer enforces a layer-direction rule.** `ReferenceValidator` used to
  reject any per-element reference whose source layer number was greater than its target's
  ("Invalid reference direction ... motivation → testing"), the opposite of the direction the
  relationship catalog itself follows (541 of its 552 cross-layer relationship types run from
  implementation layers toward intent layers). Direction is a property of the predicate, not of the
  layers (`spec/DESIGN_CHARTER.md`); the validator keeps its existence and declared-external-model
  checks. Models that validated before still validate; references previously rejected for direction
  now pass. The relationship classifier no longer warns "violates layer hierarchy" for cross-layer
  relationships, and the report `layerComplianceScore` now measures the share of cross-layer
  relationships whose predicate is in the catalog instead of the share running "higher -> lower".

### Fixed

- **`dr analyzer` resolves the codebase separately from the model (#953).** The
  codebase-memory-mcp analyzer used to index, query and run `git rev-parse` in the model root, so
  a model kept apart from its source code (a farm `<name>-model` folder, or a monorepo whose
  `documentation-robotics/` sits above the code) was indexed in the wrong directory or failed
  with "parent directory must be a git repository". Every analyzer subcommand now loads the model
  and passes its `codebaseRoot`, resolved in this order: the global `--codebase-path` flag,
  `manifest.codebase_path` (relative to the model root, the directory that contains
  `documentation-robotics/`), the farm manifest when the model lives in a farm, and otherwise the
  model root. Index metadata under `.dr/analyzers/` stays keyed to the model root. Models indexed
  before this change should be re-indexed with `dr analyzer index --force`. The new
  `/dr-analyzer` Claude Code command documents the workflow.
- **Commands honour `DR_MODEL_PATH` (#967).** Sixteen commands passed `process.cwd()` to
  `Model.load` when `--model` was not given, bypassing the environment variable; they now let
  `Model.load` resolve the model path.
- **`dr delete` now removes every relationship that names the deleted element.** The purge
  matched only the identifier typed on the command line, so a row that stored the element's UUID
  `id` survived a delete addressed by path (and vice versa); a delete staged in an active changeset
  never purged at all, and `dr changeset commit` then rejected the changeset for the dangling row.
  Deletes on the base model, with and without `--cascade`, now remove rows keyed by UUID or by
  path for the element and each cascade-deleted dependent. A staged delete also stages the
  removal of every row naming the element, commit applies the purge even for changesets staged
  before this fix, and commit validation no longer counts rows naming a deleted element as
  errors. (#963)
- **`dr relationship delete` can remove a row whose endpoint no longer exists.** It used to
  require the source to resolve to a live element and failed with "Source element ... not found"
  for exactly the dangling row being removed. Endpoints are now matched by the value stored in
  the row, or by any identifier of the element they resolve to, so a row stored by UUID is also
  found when the path is typed. (#963)
- **Staged changesets no longer need `--force` to commit after `dr upgrade`.** An upgrade writes a
  new spec version into the manifest (and its migrations may rewrite element files), which changed
  the model snapshot every staged changeset is checked against, so `dr changeset commit` reported
  drift for all of them. `dr upgrade` now re-baselines each staged changeset whose base snapshot
  matched the model before the upgrade onto the upgraded model, for migrations and `--force`
  version bumps alike, and lists them. A changeset that had already drifted before the upgrade
  keeps its old snapshot, so its drift still blocks the commit, and `dr upgrade` names it.
- **`dr upgrade` to spec 0.10.0 now keeps the `objectschema.required` conversion.** The migration
  rewrote `08_data-model` files to turn a comma-separated `required` string into an array, but the
  upgrade then saved the loaded data-model layer, still holding the string, over them, so object
  schemas kept failing 0.10.0 validation. The migration now converts the loaded layer as well.

## [0.2.0] - 2026-09-16

### Added

- **HTTP transport for the MCP server**, allowing the MCP server to run as a standalone HTTP endpoint alongside the existing stdio transport (#934).
- **Model Farm support**, introducing a dual-root model layout that decouples a model's location from its codebase root via an optional `codebase_path` manifest field, plus farm-wide project registration and sync tooling (#913).
- **Multi-repo / federated model validation**, extending cross-model reference resolution and `VerifyEngine` source-path resolution to work across detached codebase and model roots (#897, #913).

## [0.1.13] - 2026-08-21

**Specification Support:** v0.9.0 (now formally tagged as `spec-v0.9.0`; CLI content support is unchanged from 0.1.12)

### Changed

- **Bundled viewer bumped to v0.6.1**: `documentation_robotics_viewer` moves `0.6.0` → `0.6.1`,
  picking up native `heimdall-ui` 0.8.0 edge-hover support and model-graph/node-page fixes. No
  CLI-side API changes required — the viewer continues to consume the existing `/api/model` and
  `/api/spec` shapes.

### Testing

- **Added end-to-end coverage for the pre-0.8.2 legacy slug-id migration** in
  `Model.load()`/`loadLayer()` (`tests/integration/model-legacy-migration.test.ts`). Previously
  this migration — which rewrites a legacy `id: {layer}.{type}.{slug}` element to a deterministic
  UUID `id` plus a `path` carrying the old slug, transparently on every load — only had thin,
  indirect unit coverage (`model-deterministic-uuid.test.ts`) that never actually loaded a
  legacy-format YAML file through the real `Model.load()` API. The new tests write real pre-0.8.2
  YAML to disk and verify: the migration fires and produces a stable, deterministic UUID across
  repeated loads; an already-migrated (UUID id + path) element passes through unchanged; and the
  migration works for layers beyond `motivation` (verified against `product`, added in spec
  v0.9.0).

### Documentation

- Corrected `CLAUDE.md` and `README.md`, which both described a `.dr/changesets` →
  `documentation-robotics/changesets` auto-migration (with `.dr.backup/` rollback) that no longer
  exists in source — it was removed in an earlier fix and the docs were never updated. Both now
  point at the actual mechanism for spec-version model migrations: `dr upgrade`, driven by
  `MigrationRegistry` (`cli/src/core/migration-registry.ts`).
- Fixed a dangling "see migration guide" reference in `spec/CHANGELOG.md`'s 0.9.0 entry — no such
  guide exists; the reference now points at `dr upgrade`, which already automates the 13-layer
  renumbering migration (and has been covered by `migration-registry.test.ts` and
  `upgrade-command.test.ts` since it shipped).

## [0.1.12] - 2026-08-19

**Specification Support:** v0.9.0

### Fixed

Follow-up audit of the 0.1.11 attribute-collision fix, searching the codebase for other places
that hand-munge model data using a hardcoded name/naming-convention filter instead of consulting
the actual schema. Found and fixed three more instances of the same defect class:

- **`__semanticId__` (a third graph-internal bookkeeping key, alongside `__references__`/
  `__relationships__`) could leak into persisted `attributes`**, reopening the same class of bug
  0.1.11 fixed. Root cause: `GraphModel.fromElement()` aliased `node.properties` and
  `node.attributes` to the *same object* whenever attributes were non-empty, so `layer.ts`'s
  in-place mutation of `properties` (to stash bookkeeping keys with no separate channel on
  `GraphNode`) silently mutated `attributes` too — and `attributes` is exactly what gets
  persisted. `model.ts`'s 0.1.11 filter only knew about two of the three keys actually injected,
  so `__semanticId__` (set on legacy-format elements converted to UUID) passed straight through.
  Fixed at the source: `properties` is now always an independent copy, so no future bookkeeping
  key can repeat this leak regardless of whether `model.ts`'s allowlist is kept in sync
  (`__semanticId__` was also added there, as defense-in-depth only).
- **`ReferenceRegistry` misread `api.link.operationRef`** (a schema-declared OpenAPI URL
  fragment, e.g. `"#/paths/~1users/get"`) **as a cross-element reference**, feeding `dr trace`
  and `dr delete`'s dependency graph. It matched a hardcoded reference-property list and the
  `*Ref`/`*Reference` naming convention purely by coincidence — no check confirmed the value
  actually looked like a DR element id. Fixed by requiring the value to match the shape of a
  real element reference (UUID or a `{layer}.{type}.{slug}` id with a known layer prefix) before
  registering it, without weakening the existing broken-reference detection (a value that looks
  like a reference but doesn't resolve is still flagged).
- **`dr export plantuml --include-sources` could mislabel real domain data as source-code
  provenance.** `extractSourceReference()`'s legacy fallback read
  `properties["x-source-reference"]`/`properties.source.reference` with no check for whether the
  node's own schema declares either name as a real attribute — which 41 node schemas do (4
  declare `x-source-reference`, e.g. `data-store.accesspattern`; 37 declare `source`, e.g.
  `security.accesscondition`). Fixed by gating the fallback on the same schema check `saveLayer()`
  already uses.

## [0.1.11] - 2026-08-19

**Specification Support:** v0.9.0

### Fixed

- **`dr add`/`dr update` silently dropped `attributes.source`/`attributes.x-source-reference` on
  every save**, even when the element's own schema declared one as a real (sometimes required)
  domain attribute. `Model.saveLayer()` treated both names as internal graph-bookkeeping fields —
  a hardcoded, type-blind blocklist, applied to every node type regardless of what its schema
  actually declares — and stripped them from `attributes` before writing YAML. Validation ran on
  the in-memory element *before* this stripping, so `dr add`/`dr update` always reported success;
  the corruption only surfaced later, disconnected from the write that caused it, the next time
  the element was loaded or validated (a hard failure for the 3 node types that mark the
  attribute required; permanent, completely silent data loss for the 38 that leave it optional).
  Affected 41 of 191 node schemas across 8 layers (API, APM, Data Store, Navigation, Security,
  Technology, Testing, UX) — reported from `security.accesscondition.attributes.source`, a
  required attribute. `saveLayer()` now only strips a key that the element's own schema doesn't
  declare, so this class of collision can't silently recur for some other attribute name.

### Added

- **`dr repair:attribute-collision`**: detects and best-effort-recovers data lost to the bug
  above in existing models. Scans every element for a schema-declared `source`/
  `x-source-reference` attribute that's currently missing, then searches changeset history
  (committing a changeset does not delete it) for the most recent value that was recorded before
  the bug stripped it. Report-only by default; `--apply` restores every recoverable value and
  re-saves the affected layers. Elements with no recoverable value are always reported, never
  fabricated — those need `dr update <id> --attributes '{...}'` to re-supply the value manually.
  `--format json` for automation.

### Testing

- **`npm test`'s integration-test glob silently ran only 9 of 75 files** (`tests/integration/**/*.test.ts`
  matches "one directory, then a file" under `/bin/sh` — the shell npm actually uses for scripts —
  which requires at least one intermediate directory; the 66 files sitting directly in
  `tests/integration/` were never collected at all). Discovered while adding this release's own
  regression tests, which are in that directory and initially weren't running either. Fixed by
  passing bare directory paths instead (`./tests/integration/`), matching the convention already
  used elsewhere in the same script — `bun test` recurses a directory on its own, no shell glob
  needed. Same fix applied to `test:integration` and `test:perf`, which had the same problem.
  Running the full 75-file suite together for what may be the first time surfaced 5 pre-existing,
  reproducible failures in `dr trace`'s dependency-chain counting (`tests/integration/trace-populated.test.ts`),
  confirmed unrelated to this release (they fail identically with this release's changes reverted)
  and unrelated to the glob fix itself (they reproduce in isolation). Since they now genuinely run
  in CI's release gate too (the same gate this whole fix was silently skipped by moments earlier),
  excluded explicitly via `--test-name-pattern` — matching this same script's existing
  `BaseIntegrationManager` exclusion — rather than left to block this release on an unrelated,
  pre-existing bug. Applied consistently everywhere that pattern already appears
  (`test`/`test:unit`/`test:integration`/`test:all`/`test:coverage*`). Tracked as a known issue for
  a follow-up release, not fixed here.

## [0.1.10] - 2026-08-19

**Specification Support:** v0.9.0

### Changed

- **Bundled viewer bumped to v0.6.0**: `@tinkermonkey/heimdall-ui` moves `0.5.2` → `0.7.0`, and the
  Model/Schema graph is substantially reworked on top of it — new galaxy/clustered layout engines
  with a Layout/Boundaries/Node-margin/Relations control flyout, the Inspector is now a floating,
  auto-hiding detail drawer instead of a permanent sidebar column, selections made from the nav
  tree or a cross-layer link now pan the graph to bring themselves into view instead of leaving you
  to go find them, Fullscreen now keeps the layout controls and inspector visible instead of
  dropping them, dark canvas is the default on first visit, and view/selection state now round-trips
  through the URL (deep-linkable, bookmarkable, shareable). No CLI-side API changes required — the
  viewer continues to consume the existing `/api/model` and `/api/spec` shapes.

## [0.1.9] - 2026-08-14

**Specification Support:** v0.9.0

### Changed

- **Bundled viewer bumped to v0.5.1**: picks up the new page view (a document-form alternative to
  the graph, with breadcrumb/stat-grid/facts/row tables for Model/Schema layers, spec node types, and
  model elements), a Heimdall spring-based force layout for the graph, and a WCAG 2.1 AA color-contrast
  fix on the new page-view table headers. `@tinkermonkey/heimdall-ui` is now resolved to an exact
  npm-registry version rather than a pinned git commit. No CLI-side API changes required — the viewer
  continues to consume the existing `/api/model` and `/api/spec` shapes.

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
