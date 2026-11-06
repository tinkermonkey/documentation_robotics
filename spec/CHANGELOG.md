# Specification Changelog

All notable changes to the Documentation Robotics specification will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this specification adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Connection expectations** (`spec/schemas/expectations/{layer}.expectations.json`, format in
  `spec/schemas/base/connection-expectations.schema.json`, compiled to
  `spec/dist/expectations.json`). An expectation names a source type, a one-line rationale and
  one or more alternative connections (direction, predicate, other end by type or layer), any one
  of which meets it. Softer than a relationship schema's `required` flag: an unmet expectation is a
  `missing-expected` gap in `changeset_brief` and, with `dr validate --expected`, a warning; never
  a validation error. Expectations live outside the relationship schemas so relationship refinement
  is not disturbed, and the build drops (with a warning) any connection whose triple the catalog no
  longer allows instead of failing. Seeded with 42 conservative expectations across the 13 layers,
  grounded in the layers' modelling rules.
- **Eight catalog additions from Context Studio** (`spec/schemas/relationships/application/`,
  `.../api/`, `.../technology/`). The codebase-memory-mcp catalog additions
  (`catalog-additions-cbm.json`) were accepted in Context Studio on 2026-10-30 (proposals
  `69642a4f`, `8b7c9a9c`) but never landed here. Added `applicationcomponent`, `dataobject` and
  `applicationfunction specializes` their own type; `applicationcomponent composes
applicationcomponent`; `api.operation serves applicationcomponent` and `serves
applicationfunction`; `technology.technologyservice serves node`; `technology.node depends-on
node`. Three were proposed the other way round and are reversed to follow the stated rules:
  `applicationcomponent` / `applicationfunction consumes api.operation` become `api.operation
serves` (services serve the behaviour and components that use them, and the api layer already
  links to application with `serves`), and `node depends-on technologyservice` becomes
  `technologyservice serves node` (depends-on is never used where another predicate says it).
  `dr upgrade` rewrites any model relationship already recorded with the proposed triples
  (`applied-cs-catalog-additions-review.json`). Descriptions come from the accepted proposals,
  evidence from the catalog additions, cardinality many-to-many and strength medium like every
  sibling. Not landed, because the application rules rule them out: `applicationcomponent
triggers applicationevent` (behaviour raises events, components do not) and
  `applicationinterface depends-on applicationevent`. `applicationfunction triggers
applicationevent` was already added.
- **Application collaborations can nest** (`spec/schemas/relationships/application/`). The
  `ApplicationCollaboration` definition already admits "nested collaborations", but the catalog
  had no triple to record one, so the CLI rejected that membership. Added
  `application.applicationcollaboration aggregates application.applicationcollaboration`
  (whole -> part, the inner collaboration keeps its own identity), mirroring
  `applicationcollaboration aggregates applicationcomponent`. Additive. Proposed over Context
  Studio's MCP endpoint and accepted in review (Context Studio proposal `e9d6ddaa`).

- **Tier-0 rules in the cbm analyzer** (`spec/analyzers/cbm/extraction-heuristics.json`): 17
  heuristics with a `parameters.tier0` block that decide or narrow a symbol's element type before
  any model is asked. Route handlers are application functions (the CBM Route is the operation), and
  ORM table classes are object schemas whatever the framework. No schema change; the format is
  documented in `cli/src/analyzers/tier0-rules.ts` and `docs/analyzers/CASCADE_DESIGN.md`.
- **cbm analyzer mapping corrected and widened** (`spec/analyzers/cbm/`): `HANDLES` realizes
  (inverted), `HTTP_CALLS` traversal-only, five phantom edges removed, `DEFINES_METHOD`,
  `IMPORTS` and `DEFINES` mapped, the `Interface` family mapped to `application.dataobject`,
  decorator and route fields added as evidence, `datastore_detection` names existing types, and
  every CBM label is mapped or listed. Every CBM edge type is listed too: 17 create relationships
  through an ordered list of predicates resolved against the catalog per type pair, and 31 are
  traversal-only with the reason (or the catalog addition they wait on). A Tier-0 rule for test
  files narrows them to the testing layer. See the CLI changelog for the detail.

- **UX library components reach the application layer** (closes #960). The catalog had eight
  relationships from UX views, subviews, action components and component instances to application
  types, but none from `ux.librarycomponent`, so a UI component library was stranded from the rest
  of the model at the type level. Added `ux.librarycomponent realizes application.applicationcomponent`
  (the library component is the presentation implementation of the component) and
  `ux.librarycomponent uses application.applicationfunction` (it invokes the function to load,
  validate or submit what it shows), the same shape as `ux.view realizes applicationinterface` and
  `ux.actioncomponent uses applicationfunction`. Additive; no model migration.
- **`product.workflowstep` node type** — UserWorkflow previously carried only a `complexity` enum and
  free-text documentation, so the steps of a workflow could not be modelled. WorkflowStep is a
  product-level, implementation-independent step (`sequence`, `action`, `outcome`, `optional`) that a
  UserWorkflow `composes`, that `flows-to` the next step, that `uses` the Feature it exercises and the
  Capability it relies on, and that a navigation FlowStep `realizes`.
- **Capability consumption** — `product.feature uses product.capability`,
  `product.userworkflow uses product.capability` and `product.capability depends-on product.capability`.
  Previously the only feature-to-capability predicate was `realizes`, so "the password-reset feature
  uses the email-sending capability" could only be expressed by misusing realization.
- **Realization of product elements from lower layers** — the catalog had no relationship with a
  product type as destination from any other layer, although the product skill documented four. Added:
  `application.applicationservice` / `application.applicationcomponent` / `technology.technologyservice`
  `realizes product.capability`; `application.applicationservice` / `application.applicationcomponent`
  / `ux.view realizes product.feature`; `api.operation exposes product.feature`;
  `navigation.navigationflow realizes product.userworkflow`; `navigation.flowstep realizes
product.workflowstep`; `testing.testcasesketch tests product.feature`;
  `testing.testcoveragetarget covers product.feature`.
- **Application-layer serving** — `application.applicationservice serves application.applicationprocess`,
  `application.applicationfunction` and `application.applicationcomponent` (ArchiMate 3.2 serving
  relationship). Previously an application service could serve a business process only, so "this
  process uses the email service" had no predicate inside the application layer.

### Fixed

- **`08-data-model.layer.json` listed no node types** (`node_types: []`) although nine data-model node
  schemas exist and compiled into `spec/dist/data-model.json`; the build read the schema directory
  and warned about the inconsistency. The layer file now lists all nine types.
- **18 relationship schemas carried a four-part `id`** (the destination layer segment was missing,
  e.g. `security.securitymodel.aggregates.role` for `security.securitymodel.aggregates.security.role`):
  `api.components aggregates callback / link / requestbody`, `apm.span aggregates spanlink`,
  `data-store.namespace composes storedlogic`, `security.securitymodel aggregates actor / delegation /
informationentity / permission / role / secureresource`, `security.threat aggregates countermeasure`,
  `testing.inputspacepartition depends-on inputspacepartition`, `testing.testcoveragemodel aggregates
contextvariation / inputspacepartition / testcasesketch`, `testing.testcoveragetarget aggregates
contextvariation`, `ux.view aggregates actioncomponent`. All ids are now the five-part
  `{layer}.{type}.{predicate}.{layer}.{type}` form; no other field changed.

### Changed

- **cbm analyzer: test pass.** One test-file pattern (`tests/` and `fixtures/` directories,
  `test_*.py`, `conftest.py`, `*_test.go`, `*.test.ts`, `*.spec.ts`, `*Tests.java`) now drives both
  the Tier-0 test rules and `test_code_exclusion`. The old exclusion pattern missed every Java test
  file and most pytest files. The test rules decide instead of narrowing:
  - test cases are `testing.testcasesketch` (`tier0_test_case_annotation` for `@Test` and pytest
    marks, `tier0_test_case_name` for Python, Go, Java and Kotlin `test_*` / `testX` / `TestX`);
  - setup, fixtures, test-context classes, helpers and test classes are no element
    (`tier0_test_support_annotation`, `tier0_test_file`).
    `HTTP_CALLS` creates `testing.testcasesketch tests api.operation` from a test case (production
    callers still wait on a catalog addition), and `TESTS` only from a test case. 19 Tier-0 rules.

- **cbm analyzer mapping follows codebase-memory-mcp 0.12.1.** `spec/analyzers/cbm/edge-mapping.json`
  drops `CONTAINS_PACKAGE`, `MEMBER_OF` and `RESOLVED_CALLS`, which 0.12.1 no longer has anywhere
  (45 edges: the 42 documented plus the binary-only `EXTENDS`, `GRAPHQL_CALLS` and `TRPC_CALLS`).
  All three were traversal-only, so no relationship changes. Notes on `SPAWNS`, `DEPENDS_ON`,
  `INFRA_MAPS`, `DEPLOYS` and `HTTP_CALLS` record what 0.12.1 emits on the eval corpora.
  `analyzer.json` sets `known_minimum_version` to 0.12.0, the JSON contract the analyzer speaks.
  The re-taken inventory is in `docs/analyzers/CBM_MAPPING_INVENTORY.md`.

- **`applicationcomponent assigned-to applicationinterface` now says when to use it**. Its
  description and evidence restated `applicationcomponent provides applicationinterface` (the
  charter's "one meaning, one predicate" defect). It now covers a component that handles the
  requests on an access point it does not itself declare, such as a member behind a
  collaboration's gateway route, and points to `provides` for the component's own access
  points. Existing uses for a component's own access point should switch to `provides`.
  Editorial; from Context Studio proposal `e9d6ddaa`.
- **Layer descriptions** — Every `spec/layers/*.layer.json` previously carried the placeholder
  description `Layer N: Name`. Each of the 13 layers now has a real purpose-and-scope definition:
  what the layer models, which standard it follows, what code or documents count as evidence for
  elements in it, and where neighbouring concerns belong instead. The compiled `spec/dist/*.json`
  and `manifest.json` carry the new text. Tooling that classifies code into layers (the
  classification eval harness in `cli/scripts/classify-eval`) reads these definitions directly.
- **Design charter** — `spec/DESIGN_CHARTER.md` (informative) states what the specification is for,
  what a node and a relationship model, and how a proposed change is judged (defect, working as
  designed, judgment call, scope). Tooling that reasons about the spec is given it as context.
- **Direction is defined by the predicate, not by layer order.** The informal "higher layers reference
  lower layers" rule is withdrawn: it had been read both ways (the CLI's reference validator enforced
  motivation → testing while the relationship catalog runs implementation → intent), and the 11
  catalog relationships that run "upward" (schema `maps-to` collection, process `constrained-by`
  policy) were always correct. Each predicate carries its own direction; the catalog is the authority
  on valid source/predicate/destination triples; traceability to motivation is a coverage property for
  audits, not a direction prohibition.
- **Application-layer definitions enriched** (first output of the Phase 1 enrichment pipeline,
  `cli/scripts/spec-enrich`). All nine application node types now carry an operational
  genus-and-differentia definition followed by "Use <sibling> instead when ..." distinctions,
  plus `x-dr-standard` (ArchiMate 3.2 section), `x-dr-evidence` (three observable code signals)
  and `x-dr-distinguish`; the previously undocumented `documentation` attributes are described.
  All 87 relationships whose source is an application type have a real `description` (what it
  means in the domain) and `x-dr-evidence` (what in code or configuration proves it), replacing
  `Defines relationship: ...`. The compiled `spec/dist` now carries relationship `description`
  and `evidence`; previously relationships compiled to flat data with no description.
- **API- and UX-layer definitions enriched** (second output of the Phase 1 enrichment pipeline,
  `cli/scripts/spec-enrich`, node schemas only). All 27 api node types and all 22 ux node types now
  carry an operational genus-and-differentia definition followed by "Use <sibling> instead when ..."
  distinctions, plus `x-dr-standard` (the OpenAPI 3.0 object for every api type; HTML 5.3, CSS,
  WAI-ARIA 1.2 or W3C SCXML sections for the 14 ux types that have a standard counterpart),
  `x-dr-evidence` (three observable code signals) and `x-dr-distinguish`; 55 api and 49 ux
  attributes that had no description are now described (existing attribute descriptions were not
  overwritten). Relationship schemas whose source is an api or ux type are unchanged; they are being
  reworked separately.
- **Remaining ten layers' definitions enriched** (third output of the Phase 1 enrichment pipeline,
  `cli/scripts/spec-enrich`, node schemas only). All 134 node types in motivation (10), business (13),
  product (6), security (29), technology (13), data-model (9), data-store (11), navigation (11), apm
  (15) and testing (17) now carry an operational genus-and-differentia definition followed by
  "Use <sibling> instead when ..." distinctions, plus `x-dr-evidence` (three observable code signals),
  `x-dr-distinguish` and, for 131 of them, `x-dr-standard` (ArchiMate 3.2, NIST SP 800-53 Rev. 5,
  XACML 3.0, JSON Schema draft-07, ISO/IEC 9075, OpenTelemetry, IEEE 829-2008 or the SPA navigation
  pattern; `data-store.retentionpolicy`, `apm.alert` and `apm.dashboard` have none). 229 attributes
  that had no description are now described (existing attribute descriptions were not overwritten).
  Section citations were checked against the standards' tables of contents before applying.
  Relationship schemas are unchanged; they are being reworked separately.
- **Product skill "Incoming References"** — the section listed Application, UX, Testing and API links to
  Feature that did not exist in the catalog; it now matches the relationship schemas added above.

### Breaking Changes

- **BREAKING: `supports-goals` and `fulfills-requirements` predicates retired.** Each was a
  traceability-category twin of a motivation-category predicate with the same meaning and the same
  inverse (`supports` / `supported-by`, `fulfills` / `fulfilled-by`), which the charter forbids. The
  nine testing-layer schemas that used them now use `supports` (coveragerequirement, testcasesketch,
  testcoveragemodel, testcoveragetarget `supports motivation.goal`) and `fulfills` (the same four
  plus coveragesummary `fulfills motivation.requirement`); both predicates are removed from
  `predicates.json` (69 predicates). Models that recorded either predicate are rewritten to the
  surviving one on the same pair by `dr upgrade` (`cli/scripts/spec-enrich/data/applied-synonyms.json`).
  The OpenAPI `x-supports-goals` / `x-fulfills-requirements` extension attributes on API operations
  are unchanged.

- **BREAKING: security layer on stated modelling rules, and the deferred security links**
  (maintainer decisions, 2026-11-06; `cli/scripts/spec-enrich/data/applied-security-principles.json`).
  The layer description now states the rules (NIST SP 800-53 with XACML-style policies), and the
  catalog follows them. The changes settle Context Studio's 54 security proposals (about 40
  accepted or accepted in intent, the rest rejected) and the security proposals earlier layers
  deferred (6 accepted, 3 declined).
  - **Containment:** a policy composes its rules (`securitypolicy aggregates policyrule` becomes
    `composes`, and the inverted `policyrule composes securitypolicy` folds onto it), and a secure
    resource composes its operations and field access controls. The model aggregates its
    accountability requirements and classifications instead of constraining or governing them.
    The operations' and field controls' own links back to their resource are removed.
  - **Access chain:** actors are assigned to roles, roles aggregate permissions, and permissions
    authorize operations. `role` and `actor accesses secureresource` are removed, and
    `actor requires authenticationconfig` folds onto `authenticationconfig authenticates actor`.
  - **Policy:** a rule uses its conditions and triggers its actions. The conditions' and actions'
    own `constrains`, `governs` and `triggers` links are removed, and `condition composes
accesscondition` becomes `aggregates`.
  - **Countermeasures:** policies `mandates` the countermeasures they call for. The 5 `requires
countermeasure` duplicates and the rule and action `mandates` links are removed, and
    `dataclassification requires countermeasure` becomes `mandates`.
  - **Threats:** only countermeasures mitigate threats. 5 security and 2 other-layer `mitigates`
    types are removed (application component and system software). The inverted `threat
aggregates countermeasure` and `threat accesses`, `constrains` and `maps-to` are removed;
    `threat realizes driver` becomes `references`.
  - **Audit and evidence:**
    - `auditconfig triggers evidence` and `delegation triggers evidence` become `generates`, and
      `auditconfig governs secureresource` folds onto `monitors`.
    - A retention policy governs what it keeps: `retentionpolicy constrains informationentity`
      becomes `governs`. The audit, evidence and retention links that ran both ways are removed.
  - **Classification:** a classification governs information entities, secure resources and
    retention policies. Data-model and data-store elements `references` it instead of
    `satisfies` (4 types).
  - **Duty rules:** the constraints container only groups the duty rules. Its `constrains`,
    `governs` and `enforces` links are removed. `navigationflow satisfies securityconstraints`
    is replaced by `navigationflow satisfies bindingofduty`, and the business process, object
    schema and log processor links to the container are removed.
  - **Other fixes:** `role maps-to businessrole` becomes `references`, and `securitypolicy
constrains businessprocess` becomes `governs`. `data-store.accesspattern satisfies
accesscondition` and the validation rules' access and policy links are removed.
  - **Predicates retired:** `enforces` (to `realizes`) and `enforces-requirement` (to
    `satisfies`), 60 → 58 predicates.
  - **Descriptions and docs:**
    - Every security relationship type is described.
    - Skill rows are fixed in five skills and all three copies, and `dr-relate`'s tables are
      regenerated.
    - The audit's security gap template and prompt type lists now name real types.
  - **Counts:** security goes from 172 to 103 relationship types; the catalog goes from 1,219 to
    1,144.
  - **Migration:** `dr upgrade` migrates 25 of the 97 retired types and drops 72. The navigation
    flow's link is dropped, not moved, because a migration cannot move it to a different rule.

- **BREAKING: testing layer on stated modelling rules** (maintainer decisions, 2026-11-06;
  `cli/scripts/spec-enrich/data/applied-testing-principles.json`). The layer description now
  states the rules (IEEE 829-2008 test documentation), and the catalog follows them. The changes
  settle Context Studio's 53 testing proposals: about 30 accepted or accepted in intent, the rest
  rejected, mostly retargets that kept a duplicate link.
  - **One owner per type:** the model composes targets, partitions, context variations,
    environment factors, exclusions and the summary; a target composes its input fields, outcome
    categories, requirements and test case sketches.
    - `testcoveragemodel aggregates` contextvariation and inputspacepartition become `composes`,
      and `environmentfactor serves testcoveragemodel` is reversed into
      `testcoveragemodel composes environmentfactor`.
    - `testcoveragetarget flows-to testcasesketch` becomes `composes`, and `testcasesketch
validates testcoveragetarget` folds onto it.
    - The summary's `aggregates`, `references` and `serves` links to the model fold onto
      `testcoveragemodel composes coveragesummary`.
    - Removed: the second parents (the model composing requirements, outcome categories and
      selections, the target composing selections and itself) and the inverted
      `coveragerequirement composes testcoveragetarget`.
  - **Test cases:** a sketch `validates` its one requirement and references its context
    variation and outcome category; its `depends-on` links to them become `references`, and the
    outcome category's `aggregates testcasesketch` folds onto the sketch's reference.
    `coveragerequirement flows-to testcasesketch` folds onto `validates`.
  - **Requirements** reference their context variations and outcome categories (`depends-on`
    becomes `references`; `outcomecategory serves coveragerequirement` folds onto it). Their
    direct value, partition and selection-access links are removed.
  - **Input space:** only target input fields reference the field under test; the 4
    partition-to-field types are removed. `targetinputfield maps-to actioncomponent`,
    `inputpartitionselection aggregates partitionvalue` and `partitiondependency triggers
partitionvalue` become `references`.
  - **Summaries** never validate: `targetcoveragesummary validates testcoveragetarget` becomes
    `references`, and the other `validates`, sketch-counting `aggregates` and `flows-to`
    summary links are removed.
  - **Governance:** gaps and exclusions keep their references; the `flows-to` and `triggers`
    links between gaps, exclusions and partition values are removed.
  - **Other layers:** a target `covers` its production artifact. Its 4 remaining `tests` types and 5
    artifact `references` become `covers`. `testcoveragetarget tests data-store.view` is
    removed, because the renamed file would collide with `covers ux.view`. A sketch `tests` what
    it exercises: `validates api.response` and `securitypolicy` become `tests`. The model covers
    only its application component, UX application or API document. Requirements and summaries
    reach no other layer, and the apm references are removed.
  - **Motivation:** only the model and test case sketches link to motivation. Targets,
    requirements and summaries lose theirs, and sketches lose `supports goal` and `satisfies
constraint`.
  - **Descriptions and docs:**
    - Every testing relationship type is described.
    - Skill rows are fixed in nine skills and all three copies, and `dr-relate`'s tables are
      regenerated.
    - The audit's testing gap templates now name real types and predicates.
    - The CBM `TESTS_FILE` edge now maps to `testcoveragetarget covers applicationcomponent`.
  - **Counts:** testing goes from 198 to 89 relationship types; the catalog goes from 1,328 to
    1,219.
  - **Migration:** `dr upgrade` migrates 32 of the 133 retired types and drops 101.

- **BREAKING: apm layer on stated modelling rules** (maintainer decisions, 2026-11-06;
  `cli/scripts/spec-enrich/data/applied-apm-principles.json`). The layer description now states
  the rules (the OpenTelemetry data model), and the catalog follows them. The changes settle
  Context Studio's 39 apm proposals: about 20 accepted or accepted in intent, 4 deferred to the
  security pass, the rest rejected.
  - **Producer identity:** a resource aggregates the scopes running in it (new), and a scope
    aggregates the spans, metric instruments and log records emitted under it.
    - `span` / `metricinstrument depends-on scope` fold onto the scope's `aggregates`, and
      `logrecord depends-on scope` is reversed into a new one.
    - Removed: the per-signal `depends-on resource` types (4), `resource aggregates span`,
      `metricinstrument` and `exporterconfig`, and the span event's `depends-on` types.
    - `resource monitors systemsoftware` becomes `references`.
  - **Providers** depend on their resource (`traceconfiguration depends-on resource` is new) and
    aggregate their processors and exporters. `logconfiguration flows-to exporter` folds onto
    `aggregates`.
    - Removed: the configuration-to-configuration `serves` types, `traceconfiguration aggregates
span` and `metricinstrument`, the inverted `span composes traceconfiguration`, `scope
aggregates exporter` and `instrumentationconfig references exporter`.
    - `instrumentationconfig serves scope` becomes `references`.
  - **Pipeline:** each signal flows through its own processors to exporters. The 5 cross-signal
    flows are removed, along with `span composes metricinstrument` and `spanevent triggers
metricinstrument`.
  - **Exporters:** `exporterconfig serves database` becomes `accesses`, and the log and trace
    configurations' `depends-on database` types are removed.
  - **Alerts and dashboards:** `dashboard monitors alert` becomes `references`.
  - **Who monitors other layers:** only signals and instrumentation configurations. The 10
    `monitors` types from providers, scopes, alerts and dashboards are removed, and so is `span
monitors objectschema`.
  - **Business:** only metric KPIs remain (`metricinstrument monitors` business process and
    service). `resource serves businessprocess` and `span maps-to businessprocess` are removed.
  - **Motivation:** `metricinstrument maps-to outcome` becomes `measures-outcome`, and
    `metricinstrument realizes goal` is removed.
  - **Other fixes:** `span accesses collection` becomes `monitors`, and `metricinstrument monitors
pathitem` is removed.
  - **Deferred:** security links.
  - **Descriptions and docs:** every apm relationship type is described. Skill rows are fixed in
    six skills and all three copies, and `dr-relate`'s tables are regenerated.
  - **Counts:** apm goes from 134 to 90 relationship types; the catalog goes from 1,372 to 1,328.
  - **Migration:** `dr upgrade` migrates 10 of the 53 retired types and drops 43.

- **BREAKING: technology layer on stated modelling rules, and the deferred technology links
  settled** (maintainer decisions, 2026-11-06;
  `cli/scripts/spec-enrich/data/applied-technology-principles.json`). The layer description now
  states the rules (ArchiMate 3.2, mirroring the application layer), and the catalog follows them.
  The changes settle Context Studio's 28 technology proposals: 13 accepted, 4 partly accepted, 1
  deferred to the security pass, 10 rejected.
  - **Active structure:**
    - nodes compose their devices, system software, interfaces and deployed artifacts;
    - nodes and system software are `assigned-to` their behaviour;
    - collaborations aggregate their nodes, system software and nested collaborations, and are
      `assigned-to` their interactions (`performs` is retired, 61 → 60 predicates);
    - system software `provides` its interfaces, and an interface is `assigned-to` the services it
      offers and `serves` the behaviour that uses it.

    Inverted twins are reversed onto these types: `device composes node`, `interface assigned-to
systemsoftware`, `technologyservice provides interface` and the `uses interface` types.

  - **Behaviour:** a hand-off is `flows-to`, so `function triggers process` folds onto it.
    Structure no longer triggers events. Removed: `interaction realizes collaboration`, `event
flows-to artifact` and `event associated-with service`.
  - **Artifacts are passive:** `artifact flows-to process` is reversed into `process accesses
artifact`; `artifact associated-with systemsoftware` becomes `realizes`; `artifact realizes
technologyservice` is removed; `artifact realizes application.applicationcomponent` is added.
  - **Networks:** `network aggregates path` becomes `realizes`, and network / path `serves`
    node / device become `connects`. Removed: the 7 "uses network/path" types and the network's
    `assigned-to`, `provides` and `associated-with` types.
  - **Services:**
    - `service flows-to service` folds onto `serves`, and `service uses systemsoftware` is reversed
      onto `systemsoftware realizes service`;
    - `technologyservice serves applicationfunction` is added;
    - removed: `service depends-on node` / `network` and `associated-with collaboration`;
    - system software no longer realizes goals or application services.
  - **Business through application:** the 8 direct links from infrastructure to the business
    layer are removed.
  - **Deferred technology links from other layers are settled:**
    - 13 `uses` / `depends-on` / `requires technologyservice` types (api, ux, apm, data-store,
      navigation) are reversed into `technologyservice serves` them;
    - `uses systemsoftware` from the API server, rate limit, security scheme and navigation graph
      becomes `depends-on`;
    - navigation's route, flow and guard links to system software and the route's technology
      function link are removed.
  - **Deferred:** security links.
  - **Descriptions:** every technology relationship type is described.
  - **Docs and tooling:**
    - skill rows are fixed in all three copies (technology, api, apm);
    - `dr-relate`'s tables are regenerated;
    - the audit's gap templates no longer expect `role performs process`, `service realizes
process` or a non-existent `hosts` predicate.
  - **Counts:** technology's own types go from 122 to 80, plus 13 reversed inbound types; the
    catalog goes from 1,418 to 1,372.
  - **Migration:** `dr upgrade` migrates 37 of the 78 retired types and drops 41.

- **BREAKING: navigation layer on stated modelling rules, and four one-use predicates retired**
  (maintainer decisions, 2026-11-06; `cli/scripts/spec-enrich/data/applied-navigation-principles.json`).
  The layer description now states the rules, and the catalog follows them. The changes settle
  Context Studio's 24 navigation proposals: 9 accepted, 3 partly accepted, 2 deferred to the
  security pass, 10 rejected.
  - **Structure:** `route associated-with routemeta` folds onto `composes`.
  - **Moving between routes:** a transition leaves its source route (`route flows-to
transition`) and `navigates-to` its destination route.
    - `route triggers transition` folds onto `flows-to`.
    - `flowstep realizes route` folds onto `flowstep navigates-to route`.
    - Removed: `contextvariable triggers transition` and `navigationflow flows-to transition`.
  - **Guards** `evaluates` their condition, `triggers` their action and `protects` what they guard.
    - `guard constrains transition` and `guard intercepts flow` become `protects`.
    - `transition` / `flow` / `flowstep requires guard` are reversed onto `protects`.
    - Removed: the condition↔action links, `guardcondition constrains route`, `transition
triggers guardaction` and `routemeta references guard`.
  - **Context variables are passive state.** The `consumes` and `uses` types toward them become
    `accesses` (two fold into one), `contextvariable flows-to flowstep` is reversed onto the
    step's `accesses`, and `contextvariable consumes route` is removed.
  - **Breadcrumbs and route meta:**
    - `breadcrumbconfig provides routemeta` (it was inverted) and `tracks navigationflow` become
      `references`, and `routemeta references breadcrumbconfig` folds onto it;
    - `routemeta uses transition` is removed, because that was the animation, not a route change.
  - **Across layers:**
    - **UX:** `route uses layoutconfig`, `flowstep maps-to view` and `navigationflow accesses
view` are removed.
    - **Application:** `route resolves-with applicationservice` folds onto `uses`, and
      `flowstep accesses applicationservice` becomes `uses`.
    - **Data model:** `guard uses objectschema` becomes `accesses`.
    - **API:** `route` / `flowstep` / `guard accesses api.operation` are reversed into
      `api.operation serves` them.
    - **Data store:** the 6 links to tables, views and access patterns are removed, because a
      client router never reaches the physical store.
    - **Business and motivation:** the 8 direct links are removed. Navigation reaches them
      through the product user workflows and steps it realizes.
  - **Predicates retired:** `consumes`, `intercepts`, `tracks` and `resolves-with` (65 → 61).
  - **Deferred:** security and technology links.
  - **Descriptions and docs:** every navigation relationship type is described. Skill rows are
    fixed in all three copies, and `dr-relate`'s tables are regenerated.
  - **Counts:** navigation goes from 116 to 78 relationship types; the catalog goes from 1,453 to
    1,418.
  - **Migration:** `dr upgrade` migrates 24 of the 50 retired types and drops 26.

- **BREAKING: data-store layer on stated modelling rules** (maintainer decisions, 2026-11-06;
  `cli/scripts/spec-enrich/data/applied-data-store-principles.json`). The layer description now
  states the rules, and the catalog follows them. The changes settle Context Studio's 24
  data-store proposals: 13 accepted (8 of them as renames rather than deletes), 3 deferred to the
  security pass, 8 rejected.
  - **Containment is one level at a time** (database → namespace → collection → fields, indexes,
    validation rules, event handlers):
    - `database` and `namespace composes` field, index and validation rule are removed (6 types);
    - `collection composes namespace` is reversed onto `namespace composes collection`.
  - **Stored data is passive:** collections, views, fields and databases never serve or trigger.
    - `collection serves applicationcomponent` / `applicationservice` and `view serves
applicationservice` are reversed into the new application `accesses` types. Application
      functions also get `accesses collection` and `accesses view`. The application rules say
      code may access collections and views directly.
    - The other 5 `serves` types are removed.
    - `field triggers validationrule` and `field triggers eventhandler` become `validationrule` and
      `eventhandler references field`, and `field triggers storedlogic` is removed.
  - **Behaviour in the store** is stored logic, event handlers and access patterns. Duplicates
    fold onto one type:
    - `storedlogic validates collection` becomes `accesses`;
    - `eventhandler monitors collection` becomes `collection composes eventhandler`;
    - `index optimizes accesspattern` and `accesspattern aggregates index` become `accesspattern
uses index`. The `optimizes` predicate, used only here, is retired (66 → 65 predicates).
    - `accesspattern aggregates field` and `validationrule aggregates field` become `references`.
    - Removed: `storedlogic aggregates field`, `storedlogic composes validationrule` and
      `accesspattern triggers eventhandler`.
  - **Across layers:** the store reaches the business through the application layer and the data
    model.
    - Removed: `database realizes businessservice`, `storedlogic realizes businessfunction`,
      `accesspattern serves businessfunction`, `eventhandler triggers businessevent` and
      `collection maps-to api.requestbody`.
    - `view realizes api.response` becomes `maps-to`.
    - `collection realizes businessobject` stays as a shortcut.
  - **Deferred:** technology and security links wait for those layers' passes.
  - **Descriptions and definitions:** every data-store relationship type and the 5 new application
    types are described. The Collection definition states its boundary with data-model
    ObjectSchema.
  - **Docs:** skill rows are fixed in all three copies, and `dr-relate`'s inter-layer table is
    regenerated.
  - **Counts:** data-store goes from 100 to 71 relationship types and application from 71 to 76;
    the catalog goes from 1,477 to 1,453.
  - **Migration:** `dr upgrade` migrates 13 of the 33 retired types and drops 20.

- **BREAKING: motivation layer on stated modelling rules, and three synonym predicates retired**
  (maintainer decisions, 2026-11-06; `cli/scripts/spec-enrich/data/applied-motivation-principles.json`).
  The layer description now states the rules (ArchiMate 3.2), and the catalog follows them. The
  changes settle Context Studio's 24 motivation proposals: 6 accepted, 3 partly accepted, 15
  rejected.
  - **Realization chain:** requirements realize the outcomes, goals and principles they make
    concrete, and outcomes realize goals.
    - `requirement associated-with` and `aggregates goal`, `goal aggregates requirement`
      (reversed) and `outcome influence goal` fold into the existing `realizes` types.
    - `requirement associated-with outcome` becomes `realizes`.
    - `requirement realizes principle` is added.
  - **Decomposition is same-type only:** `goal realizes goal` becomes `aggregates`, and the
    same-type associations of stakeholders, values and outcomes become `aggregates`.
  - **Influence vs. association:** `influence` is one motivation element shaping another, and
    association is kept for concerns and interpretation.
    - These become `influence`: `driver associated-with constraint`, `assessment associated-with
outcome`, `goal supports principle`, and `goal associated-with constraint` (reversed onto
      `constraint influence goal`).
    - These become association: `assessment influence driver` and `stakeholder influence driver`.
    - Requirement-sourced associations are reversed onto `driver influence requirement`,
      `constraint constrains requirement` and `stakeholder associated-with requirement`.
    - `goal influence assessment` is removed.
  - **Meaning and value are always the source** of their associations: five types are reversed,
    `goal realizes value` among them. Meaning gains links to requirements and principles.
  - **Predicates retired spec-wide:**
    - `fulfills` becomes `satisfies` (8 types, 3 of them in security);
    - `delivers-value` becomes `delivers` (3 types);
    - `governed-by-principles` becomes `satisfies` (1 type).

    `predicates.json` goes from 69 to 66 predicates, and `dr upgrade` rewrites every relationship
    recorded with a retired predicate onto the same pair.

  - **Other layers satisfy** the requirements, constraints and principles they meet:
    - `realizes principle` (navigation guard, security policy, system software) and
      `securityconstraints realizes constraint` become `satisfies`;
    - testing's `constrained-by constraint` (3 types) becomes `satisfies`.
  - **Goals and outcomes keep both predicates, now defined:** an element `realizes` a goal or
    outcome it exists to achieve, and `supports` one it contributes to alongside others.
  - **Stakeholders are not served:**
    - `businessactor` and `businessrole serves stakeholder` become `references`, as personas do;
    - `serves stakeholder` from the OpenAPI document, application service, technology service
      and ux view is removed.
  - **Definitions:** requirement and meaning say a system satisfies a requirement, and stakeholder
    states its boundary with business actors and roles.
  - **Counts:** every motivation relationship type, and every renamed type that had no
    description, is described. Motivation goes from 72 to 61 relationship types; the catalog goes
    from 1,492 to 1,477.
  - **Migration:** `dr upgrade` handles all 49 retired types; only the 4 `serves stakeholder`
    types drop. The `dr-relate` command's inter-layer predicate table is regenerated from the
    catalog.

- **BREAKING: data-model layer on stated modelling rules** (maintainer decisions, 2026-11-06;
  `cli/scripts/spec-enrich/data/applied-data-model-principles.json`). The layer description now
  states the rules, and the catalog follows them. The changes settle Context Studio's 15
  data-model proposals: 4 accepted, 9 rejected, 2 deferred.
  - **Passive structure:** schemas are realized, accessed, referenced and mapped to. They never
    serve, trigger or perform behaviour. Five `serves` types are reversed into the new
    `application.applicationfunction` / `applicationcomponent accesses data-model.objectschema`
    and `applicationfunction` / `applicationcomponent` / `applicationevent accesses
data-model.schemadefinition`. The application layer's rules say behaviour may access these
    schemas directly. The other four `serves` types are removed.
  - **Inline vs. named:** a subschema written in place is part of what declares it (`composes`). A
    type reached by `$ref` or by name is referenced (`references`).
    - `jsonschema aggregates` becomes `composes` for its root schema and definitions (4 types).
    - `objectschema aggregates schemaproperty` becomes `composes`.
    - `arrayschema aggregates` becomes `composes` for inline item schemas (4 types) and
      `references` for a named definition.
    - `schemaproperty references` string, numeric and array schemas becomes `composes`.
    - `schemacomposition composes schemadefinition` becomes `references`.
  - **One predicate per meaning:**
    - `objectschema extends objectschema` becomes `specializes`, the spec's only subtyping
      predicate (it was the catalog's only use of `extends`).
    - `jsonschema realizes api.schema` becomes `maps-to`.
  - **Removed:**
    - `realizes goal` for JSON schemas and object schemas;
    - schemas referencing business functions and processes;
    - `jsonschema references businessobject` and `references applicationservice`;
    - `reference maps-to api.schema` and `maps-to applicationservice`;
    - the technology dependencies (`depends-on systemsoftware` ×3, `uses technologyservice`). The
      logical model is technology-independent.
  - **Added:** `schemacomposition composes reference`, and `reference references objectschema` and
    `jsonschema`.
  - **Definitions:** ObjectSchema and DataObject now state their boundary: entities, ORM models and
    published shapes are object schemas, and in-code carriers are data objects. The property and
    value-schema definitions follow the inline rule. Security links wait for the security layer's
    pass.
  - Every data-model relationship type is described. Data-model goes from 74 to 55 relationship
    types and application from 66 to 71; the catalog goes from 1,498 to 1,484. `dr upgrade`
    migrates 21 of the 38 retired types and drops 17. The cbm `USAGE` mapping now yields `accesses`
    for an object schema, and so does `WRITES`.

- **BREAKING: capability split into Software Capability and Business Capability, and the product
  layer on stated modelling rules** (maintainer decisions, 2026-11-05; records
  `cli/scripts/spec-enrich/data/applied-capability-split.json` and `applied-product-principles.json`).
  - **`product.capability` is renamed `product.softwarecapability`**: an ability of the software
    platform ("Save documents to files"), which features realize and which realizes the business
    functions it carries out. `dr upgrade` renames every capability element: its type, its path
    (`product.capability.x` becomes `product.softwarecapability.x`), and every relationship,
    reference and staged change that names it. The rename is a new `rename-type` record action;
    the migration table now carries `typeRenames`, and `cli/src/core/element-type-migration.ts`
    applies them before the relationship rewrite.
  - **New `business.businesscapability`**: ArchiMate's Capability, an ability the organization has
    ("Share data with partners"), in the business layer because DR has no strategy layer. Business
    functions and processes realize it; it aggregates narrower capabilities, supports goals and
    realizes outcomes. The ArchiMate exporter writes it as `Capability`. The two capability
    definitions, and the business function's, say when to use which.
  - **Product rules**, stated in the layer description: realization runs upward through product (a
    software capability realizes the business function it carries out, a user workflow the
    business process the user performs). Personas reference the stakeholder and business role
    they stand for. A workflow reaches features and software capabilities only through its steps.
    The changes, which settle Context Studio's 8 product proposals:
    - **Renamed:**
      - `userworkflow aggregates businessprocess` becomes `realizes`;
      - `persona realizes stakeholder` and `persona serves businessrole` become `references`;
      - `softwarecapability fulfills requirement` becomes `satisfies`.
    - **Removed:** `feature realizes businessservice`, `userworkflow composes feature`,
      `userworkflow uses softwarecapability`, `workflowstep uses softwarecapability` and
      `workflowstep serves persona`.
  - Every product and business-capability relationship type is described. Product goes from 26 to
    21 relationship types and business from 52 to 57; the catalog stays at 1,498 with 193 node
    types.

- **BREAKING: application layer on stated modelling rules** (maintainer decisions, 2026-11-05;
  `cli/scripts/spec-enrich/data/applied-application-principles.json`). The layer description now
  states the rules, in the shape of the business layer's, with three deliberate differences:
  - a component may realize an application service directly, as a shortcut through its behaviour;
  - components may access data objects (interfaces and collaborations may not);
  - an application function can be an event handler.
    Changes:
  - **`depends-on` where another predicate says it:**
    - `applicationinteraction depends-on dataobject` becomes `accesses`;
    - `applicationcollaboration depends-on applicationinterface` becomes `provides`;
    - `applicationinteraction depends-on applicationservice` becomes `applicationservice serves
applicationinteraction` (new);
    - `applicationfunction depends-on applicationevent` becomes `applicationevent triggers
applicationfunction` (new);
    - interaction `depends-on` collaboration and event, and interface `depends-on` component, move
      onto the existing assigned-to, triggers and provides types (reversed);
    - `applicationprocess depends-on applicationinterface` is removed.
  - **Removed: active structure accessing data.** Collaboration and interface `depends-on
dataobject`.
  - **Removed: component shortcuts to other layers** (application services carry them). Component
    realizes `business.businessservice`, `product.feature`, `product.capability`, and serves
    `business.businessrole`.
  - **Motivation links come from services and behaviour.** Removed component realizes
    `motivation.goal` and `motivation.principle`, and satisfies `motivation.requirement`.
    `applicationservice realizes motivation.requirement` becomes `satisfies`.
  - **Added: behaviour raises events.** `applicationfunction triggers applicationevent`, which was
    also a queued CBM catalog addition, and `applicationinteraction triggers applicationevent`.
    The cbm `LISTENS_ON` mapping now creates `applicationevent triggers applicationfunction`.
    Application goes from 78 to 66 relationship types, the catalog from 1,510 to 1,498. `dr upgrade`
    migrates 8 of the 18 retired types (renamed or reversed) and drops the other 10.

- **BREAKING: business layer rebuilt on stated modelling rules** (Context Studio's 22 decisions,
  `cli/scripts/spec-enrich/data/triage/reflect/clef/walk-business.jsonl`, then a maintainer pass,
  `cli/scripts/spec-enrich/data/applied-business-principles.json`). The layer description now
  states the rules, and every business relationship schema says what it means:
  - **Assignment** is `assigned-to`, as in the application layer. Actors fill roles, and
    roles and collaborations are assigned to the processes, functions and interactions they
    perform; behaviour is never assigned to an actor directly. Interfaces are assigned to the
    services they offer. `performs` and `provides` no longer appear in the layer: `businessrole
performs businessfunction`, `businesscollaboration performs businessinteraction` and
    `businessinterface provides businessservice` become `assigned-to`, and `businessfunction
serves businessrole` becomes `businessrole assigned-to businessfunction`.
  - **Composition**: a collaboration `aggregates` its roles (was `composes`).
  - **Services** are realized by internal behaviour (`businessinteraction realizes
businessservice`, was serves; `businessservice realizes businessprocess` is reversed), and
    serve actors, roles and processes (`businessservice serves businessrole` and `serves
businessprocess` added). Services carry the main link to motivation: `businessservice
realizes motivation.outcome` added, `businessprocess realizes motivation.goal` and
    `businessfunction realizes motivation.goal` removed.
  - **Access**: only behaviour accesses business objects and contracts. Removed the accesses
    edges from actor, collaboration, interface, role and contract, `businessinterface flows-to
businessobject` and `contract serves businessrole`; added `businessfunction accesses
contract`. `businessrole assigned-to businessinterface` becomes `businessinterface serves
businessrole`.
  - **Events and sequence**: events trigger processes and interactions, and behaviour raises
    events; a hand-off between behaviours is `flows-to`. `businessprocess triggers
businessprocess` and `triggers businessfunction` become `flows-to`. A function has no start,
    so `businessevent triggers businessfunction` is removed. Removed the triggers edges from
    interface, role and contract.

  Business goes from 69 to 52 relationship schemas, the catalog from 1,526 to 1,509. `dr upgrade`
  migrates 10 of the 26 retired types to their replacement (reversing the source and target
  where needed). It drops relationships of the other 16, which link element types the rules no
  longer connect.

- **BREAKING: application-layer walk of the remaining reflection rows (18 rows adjudicated by the
  maintainer, `cli/scripts/spec-enrich/data/triage/reflect/clef/walk-application.jsonl`).** Six
  schemas deleted as duplicates of an existing edge (`applicationfunction delivers-value
applicationprocess`; `applicationservice` and `applicationfunction depends-on dataobject`, covered by
  `accesses`; `applicationinterface delivers-value applicationcollaboration`, covered by `collaboration
provides interface`; `applicationcollaboration depends-on applicationinteraction` and
  `applicationinterface depends-on applicationservice`, covered by the edges below). Seven renamed to
  the ArchiMate 3.2 relationship: `applicationcollaboration` _assigned-to_ `applicationinteraction`
  (was delivers-value); `applicationcollaboration realizes applicationservice` (was delivers-value);
  `applicationevent accesses dataobject` (was depends-on); `applicationcomponent` _assigned-to_
  `applicationfunction` (was composes; tier 1 had kept the wrong twin); `applicationinterface`
  _assigned-to_ `applicationservice` (was serves); `applicationevent triggers applicationinteraction`
  (was triggers applicationcollaboration); `applicationservice constrained-by security.securitypolicy`
  (was accesscondition, one clause of a rule). One reversed: `applicationcollaboration assigned-to
applicationprocess` (was process depends-on collaboration). One added: `applicationcomponent
assigned-to applicationprocess`, which the layer lacked. `delivers-value` no longer appears in the
  application layer, and application behaviour reaches data objects through `accesses` only. The
  `applicationinterface` definition now says an interface is owned by a component or collaboration.
  1,529 to 1,524 relationship schemas; actions recorded in `applied-walk-application.json` for the
  model migration.

- **BREAKING: 86 relationship schemas removed, 5 renamed, 2 reversed (reflection plan, tier 1).** The
  relationship catalog carried pairs of schemas that said the same thing twice (`aggregates` beside
  `composes`, `delivers-value` beside `realizes`, a `serves` or `associated-with` edge beside its
  reverse `composes`/`aggregates`/`triggers`), and a few predicates that did not match their meaning
  (`depends-on` a data object for `accesses`, `monitors` a node for `references`). Each change was
  found by the maintainer-note triage, confirmed by the sorting-question reflection
  (`cli/scripts/spec-enrich/triage-reflect.ts`) at p >= 0.6 for duplicate removals and p >= 0.7
  for reversals and renames, and accepted after review. Removed: 79 duplicate or reverse-direction
  schemas (api 14, security 11, ux 10, navigation 9, technology 8, motivation 8, application 7,
  testing 6, data-store 6, business 4, apm 2, product 1). Renamed: `apm.resource monitors
technology.node` to `references`; `application.applicationprocess depends-on dataobject` to
  `accesses`; `applicationprocess delivers-value applicationservice` to `realizes`;
  `navigation.routemeta governs navigationguard` to `references`; `ux.stateaction specializes
stateactiontemplate` to `realizes`. Reversed: `api.oauthflows serves securityscheme` becomes
  `api.securityscheme composes api.oauthflows`; `testing.partitionvalue composes
inputspacepartition` becomes `testing.inputspacepartition composes partitionvalue`. 1,610 to
  1,529 relationship schemas. The full old-id to new-id list is
  `cli/scripts/spec-enrich/data/triage/reflect/clef/applied-tier1.json`, the input for the model
  migration that rewrites or drops affected relationships.

- **BREAKING: `implements` predicate retired in favour of `realizes`.** The two predicates had the same
  meaning ("provides concrete implementation of" versus "implements or makes concrete") and the same
  ArchiMate alignment (Realization), violating the charter's one-meaning-one-predicate rule. The 18
  relationship schemas that used `implements` are now `realizes` (17 renamed; `ux.componentinstance
implements ux.librarycomponent` deleted because the `realizes` schema already existed), and
  `implements` is removed from `spec/schemas/base/predicates.json` (72 to 71 predicates, 1,611 to
  1,610 relationship schemas). Models that recorded `implements` relationships need a migration that
  rewrites the predicate to `realizes`.

- **BREAKING: `objectschema.required` Type Change** — The `required` field on `data-model.objectschema` nodes changed from `{"type": "string"}` to `{"type": "array", "items": {"type": "string"}}` in `spec/schemas/nodes/data-model/objectschema.node.schema.json`:
  - **Rationale**: JSON Schema Draft 7 standard specifies `required` as an array of property names. The string format was non-standard and prevented accurate schema validation.
  - **Impact**: Existing `objectschema` elements with string-typed `required` values will fail schema validation after upgrade.
  - **Migration**: Automatic upgrade path provided via CLI migration 0.9.0→0.10.0. Comma-separated string values (e.g., `"id,name,email"`) are automatically converted to array format (e.g., `["id", "name", "email"]`). No manual migration steps required; migration runs transparently on next CLI use.

### Added

- **Analyzer Mappings Framework** — Introduced `spec/analyzers/` as the canonical home for analyzer
  mappings that bridge external code analysis tools to the architecture model:
  - New directory structure at `spec/analyzers/{analyzer-name}/` containing analyzer definitions
  - Four new base schemas for analyzer compilation: `analyzer-spec.schema.json`,
    `analyzer-node-mapping.schema.json`, `analyzer-edge-mapping.schema.json`, and
    `analyzer-heuristics.schema.json` — all validated during spec build
- **Codebase Memory (CBM) Analyzer Mapping** — First analyzer mapping (`cbm`) covering semantic
  code structures from the Codebase Memory MCP:
  - Node label mappings: **Route** → `api.operation`, **Function** → `application.applicationfunction`,
    **Method** → `application.applicationfunction`, **Class** → `application.applicationcomponent`,
    **Module** → `application.applicationcomponent`
  - Edge type mappings: HTTP calls → `consumes`, request handlers → `provides`, with unmappable
    edges (function calls, imports, inheritance) marked with `null` dr_relationship
  - Extraction heuristics for guiding semantic graph generation from source code
- **Build Pipeline Enhancements** — Extended `spec/scripts/build-spec.ts` with analyzer
  compilation and validation that compiles all analyzer directories into `spec/dist/analyzers/`:
  - Validates required files exist: `analyzer.json`, `node-mapping.json`, `edge-mapping.json`,
    `extraction-heuristics.json`
  - Validates all `dr_layer` values use canonical layer names and `dr_relationship` values exist in `predicates.json` (null allowed for unmappable edges)
  - Generates packed analyzer artifacts with indexed node mappings and edge types
  - Creates `spec/dist/analyzers/manifest.json` listing all compiled analyzers with versions

### Changed

- **Spec Build Output** now includes `spec/dist/analyzers/` subtree alongside layer and base schema
  files, expanding the compiled specification to cover analyzer-to-model mappings

## [0.9.0] - 2026-08-21

### Breaking Changes

- **BREAKING: 13-Layer Architecture Model** — Added Product layer at position 3, shifting Security through Testing to positions 4–13:
  - **Layer Renumbering**: All existing layer files renamed and number fields updated (10 layer instances affected)
    - Security: 3 → 4
    - Application: 4 → 5
    - Technology: 5 → 6
    - API: 6 → 7
    - Data Model: 7 → 8
    - Data Store: 8 → 9
    - UX: 9 → 10
    - Navigation: 10 → 11
    - APM: 11 → 12
    - Testing: 12 → 13
  - **Impact**: Layer filesystem prefixes and archive paths update (e.g., `03_security/` → `04_security/`). Cross-layer references remain stable (use layer names not numbers). Filesystem-based models are migrated automatically by running `dr upgrade` (CLI v0.1.8+), which renames the affected layer directories and updates `manifest.yaml` in place — no manual steps required.

### Added

- **Product Layer (Layer 3)** — New layer modeling product planning and management concerns, positioned between Business (2) and Security (4):
  - **Five v1 node types**: `product.persona` (user archetypes with behavioral attributes), `product.capability` (externally-facing product abilities), `product.feature` (user-visible functionality units), `product.userworkflow` (user-facing task sequences), `product.milestone` (time-bound delivery targets)
  - **Full layer instance** at `spec/layers/03-product.layer.json` with all node type registrations
  - **Five node type schemas** in `spec/schemas/nodes/product/` extending base `spec-node.schema.json`, each with layer-specific attributes (e.g., persona category/proficiency, feature priority/size/status, capability status, workflow complexity, milestone status)
- **Product Layer Predicates** — Two new predicates in `spec/schemas/base/predicates.json`:
  - `scheduled-for` (inverse: `schedules`) — Feature/Capability assignment to Milestone (bidirectional, non-transitive, non-symmetric, non-reflexive)
  - `precedes` (inverse: `follows`) — Milestone sequencing (bidirectional, transitive, non-symmetric, non-reflexive)
- **~19 Product Layer Relationship Schemas** in `spec/schemas/relationships/product/`:
  - **9 intra-layer**: `capability→capability` (aggregates), `feature→capability` (realizes), `feature→persona` (serves), `feature→milestone` (scheduled-for), `capability→milestone` (scheduled-for), `workflow→persona` (serves), `workflow→feature` (composes), `milestone→milestone` (precedes), `feature→feature` (depends-on)
  - **6 cross-layer to Motivation**: `persona→stakeholder` (realizes), `feature→requirement` (satisfies), `capability→goal` (supports), `workflow→outcome` (delivers), `feature→value` (delivers-value), `capability→requirement` (fulfills)
  - **4 cross-layer to Business**: `feature→businessservice` (realizes), `workflow→businessprocess` (aggregates), `capability→businessfunction` (realizes), `persona→businessrole` (serves)
- **Build Pipeline Updates** — Extended `spec/scripts/build-spec.ts` with Product layer support:
  - Added `product` to `LAYER_ORDER` array at index 2
  - Added `03-product` to `LAYER_FILE_PREFIX_MAP`
  - Updated all shifted layer prefixes (04-security through 13-testing)
  - Added `product` to `NODE_FOLDER_TO_LAYER` mapping and `dr_layer` TypeScript union type
- **Spec Distribution** — Compiled `spec/dist/` now includes `product.json` (product layer node/relationship schemas) alongside updated manifest and renumbered layer files (14 → 15 total files)
- **Analyzer Mappings Framework** — Introduced `spec/analyzers/` as the canonical home for analyzer
  mappings that bridge external code analysis tools to the architecture model:
  - New directory structure at `spec/analyzers/{analyzer-name}/` containing analyzer definitions
  - Four new base schemas for analyzer compilation: `analyzer-spec.schema.json`,
    `analyzer-node-mapping.schema.json`, `analyzer-edge-mapping.schema.json`, and
    `analyzer-heuristics.schema.json` — all validated during spec build
- **Codebase Memory (CBM) Analyzer Mapping** — First analyzer mapping (`cbm`) covering semantic
  code structures from the Codebase Memory MCP:
  - Node label mappings: **Route** → `api.operation`, **Function** → `application.applicationfunction`,
    **Method** → `application.applicationfunction`, **Class** → `application.applicationcomponent`,
    **Module** → `application.applicationcomponent`
  - Edge type mappings: HTTP calls → `consumes`, request handlers → `provides`, with unmappable
    edges (function calls, imports, inheritance) marked with `null` dr_relationship
  - Extraction heuristics for guiding semantic graph generation from source code
- **Analyzer Build Pipeline** — Extended `spec/scripts/build-spec.ts` with analyzer
  compilation and validation that compiles all analyzer directories into `spec/dist/analyzers/`:
  - Validates required files exist: `analyzer.json`, `node-mapping.json`, `edge-mapping.json`,
    `extraction-heuristics.json`
  - Validates all `dr_layer` values use canonical layer names and `dr_relationship` values exist in `predicates.json` (null allowed for unmappable edges)
  - Generates packed analyzer artifacts with indexed node mappings and edge types
  - Creates `spec/dist/analyzers/manifest.json` listing all compiled analyzers with versions

### Changed

- **Layer Numbering Schema** — All 12 existing layers renumbered to accommodate Product layer insertion (affects layer instance files, archive paths, layer-specific documentation, but not cross-layer references which use layer names)
- **Spec Build Output** now includes `spec/dist/analyzers/` subtree alongside layer and base schema
  files, expanding the compiled specification to cover analyzer-to-model mappings

### Compatibility

- **Cross-Layer References**: Remain stable — all reference resolution uses layer _names_ (motivation, business, product, security, …, testing), not numbers
- **Element IDs**: Unchanged — follow `{layer}.{type}.{kebab-case}` format with layer names, not numbers
- **CLI Compatibility**: CLI v0.1.8+ supports all 13 layers. No CLI version bump required for this spec release; CLI already updated in parallel phases.

## [0.8.3] - 2026-03-14

### Added

- **495 inter-layer relationship schemas** added across all 12 layers via AI-assisted
  audit pipeline (`/dr-audit-resolve`), expanding cross-layer traceability coverage:
  - 478 schemas generated from AI gap analysis across all 65 layer-pair combinations
  - 10 schemas added using best-fit substitutions where audit-recommended node names
    differed from spec names (e.g. `apm.metric` → `metricinstrument`, `security.control`
    → `countermeasure`, `security.identitysubject` → `actor`,
    `security.accesscontrol` → `securitypolicy`)
  - 7 additional schemas covering relationships to `security.countermeasure`,
    `security.securitypolicy`, `security.actor`, and `apm.metricinstrument`
- **`apm.alert` node type** — alerting rule with `severity`, `condition`,
  `evaluationInterval`, and `notificationChannels` attributes; represents alert
  definitions in monitoring backends (Prometheus alertmanager, Grafana alerting,
  Datadog monitors)
- **`apm.dashboard` node type** — monitoring dashboard with `tool`
  (grafana/datadog/newrelic/cloudwatch/dynatrace/custom), `description`, and
  `panels[]` attributes; represents dashboard definitions grouping APM signal
  visualizations

### Changed

- **APM layer** now contains 15 node types (up from 13), with `apm.alert` and
  `apm.dashboard` added to `spec/layers/11-apm.layer.json`
- **Total relationship count** increased from 969 to **1,447** across 186 node types
  (12 layers), reflecting comprehensive inter-layer coverage from the audit

## [0.8.2] - 2026-03-08

### Changed

- **`path` field added to `spec-node` base schema** — All spec nodes now carry a `path`
  field (`{layer}.{type}.{kebab-name}` format) alongside the UUID `id` field. `path` is the
  human-readable element identifier and graph key; `id` is strictly UUIDv4 for schema
  compliance and global uniqueness. The `path` field is required and must match pattern
  `^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$`.

### Migration

Existing model elements that carry a slug-format `id` (e.g., `motivation.goal.my-goal`) are
automatically migrated on load: the slug is moved to `path` and a deterministic UUID is
assigned to `id`. Elements with a UUID `id` and no `path` have `path` derived from their
`layer_id`, `type`, and `name` fields. No manual migration steps are required.

## [0.8.1] - 2026-02-28

### Added

- **733 Relationship Schemas**: AI-assisted generation of relationship schemas across all
  12 layers, dramatically expanding inter-layer relationship coverage; normalized to
  catalog predicates and validated against spec-node-relationship schema
- **`build:spec` pipeline enhancements**: Script now auto-generates browser layer reports
  (`spec/browser/`) and Neo4j CSV/Cypher exports (`spec/neo4j/`) as part of the standard
  spec build
- **20 missing relationship schemas** added to fill gaps identified in relationship audit

### Changed

- **Node type improvements (all 12 layers)**: Improved descriptions and attribute
  consistency across all 12 layers aligned to industry standards:
  - Motivation: ArchiMate 3.2 alignment
  - Business: ArchiMate 3.2 precision
  - API: OpenAPI 3.0 precision; corrected required fields and missing attributes
  - Application: ArchiMate-aligned descriptions
  - Technology: Attribute consistency improvements
  - Security: NIST SP 800-53 alignment
  - Data Model: JSON Schema Draft 7 alignment
  - Data Store: Generalized to cover all database paradigms (SQL, NoSQL, graph,
    document, key-value); renamed `schemas` → `namespaces` on `data-store.database`
  - UX: HTML 5.3 alignment; anti-pattern resolution
  - Navigation: Attribute documentation improvements
  - APM: Missing OpenTelemetry attributes added
  - Testing: IEEE 829-2008 alignment
- **Enum-masquerader consolidation**: Collapsed redundant enum-masquerader node types
  into parent node attributes across all 12 layers, reducing node type count and
  simplifying the model
- **Removed `id` and `name` from `attributes.properties`** in 175 node schemas — these
  are universal top-level properties in `spec-node.schema.json`, not type-specific
  attributes
- **41 relationship stubs removed** (deferred/redundant stubs cleaned up in 3 phases)
- **Spec dist format**: Compiled distribution files now use pretty-printed JSON for
  better readability and diffs

### Fixed

- Removed 58 redundant "Contains relationship" attribute stubs from node schemas
- Removed 4 deferred "Contains relationship" relationship stubs
- Fixed 8 mislabeled inline/primitive attribute stubs (type corrections)
- Normalized 118 relationship schemas to use catalog predicates
- Removed redundant `associated-with` relationships on `motivation.outcome`
- Removed cross-layer annotation node types from `data-model` layer
- Added `sortKey` attribute to `data-store.accesspattern`

## [0.8.0] - 2026-02-09

### Breaking Changes

- **BREAKING: Spec Architecture Refactored to JSON Schema-Only Model**:
  - All spec metadata now defined as JSON Schemas instead of data instances
  - **212 Node Type Schemas**: `spec/schemas/nodes/{layer}/*.node.schema.json`
    - Each extends `spec-node.schema.json` via `allOf`
    - Uses `const` constraints for `spec_node_id`, `layer_id`, `type`
    - Type-specific attributes defined as JSON Schema properties
    - Old `.node.json` data instance format removed (backed up in tar.gz)
  - **252 Relationship Type Schemas**: `spec/schemas/relationships/{layer}/*.relationship.schema.json`
    - Each extends `spec-node-relationship.schema.json` via `allOf`
    - Uses `const` constraints for `id`, `source_spec_node_id`, `destination_spec_node_id`, `predicate`
    - Generated by conversion script (one-time migration)
    - Old `.relationship.json` data instance format removed (backed up in tar.gz)
  - **Schema-First Design**: All spec metadata is now hand-maintained JSON Schemas
  - **Validation Simplification**: Model elements validate against per-type node schemas (not layer schemas)
  - **CLI Impact**: Schema validator refactored to validate each element individually with improved error messages

- **Predicates Relocated and Enhanced**:
  - Moved from `spec/schemas/relationship-catalog.json` to `spec/schemas/base/predicates.json`
  - Now part of base schema definitions (semantic core)
  - Contains intrinsic properties only: `predicate`, `inverse`, `category`, `description`, `archimate_alignment`, `semantics`
  - Derived metadata (`applicableLayers`) computed dynamically by scanning relationship schemas
  - 47 predicates across 12 categories: structural, behavioral, dependency, traceability, governance, apm, security, ux, data, testing, motivation, business

### Added

- **Neo4j Export for Spec Metadata**:
  - New script `scripts/export-spec-to-neo4j.ts` exports spec structure to Neo4j graph database
  - Generates both Cypher and CSV import formats
  - Exports complete spec metadata graph:
    - 354 SpecNode types (element type definitions)
    - 252 SpecRelationship types (allowed relationship schemas)
    - 47 Predicate nodes (semantic relationship types)
    - 12 Layer nodes (12-layer architecture)
    - 1,192 AttributeSpec nodes (type-specific attributes with validation rules)
    - 12 PredicateCategory nodes (synthetic categories)
  - Graph relationships:
    - BELONGS_TO_LAYER (SpecNode → Layer)
    - HAS_SOURCE (SpecRelationship → SpecNode)
    - HAS_TARGET (SpecRelationship → SpecNode)
    - USES_PREDICATE (SpecRelationship → Predicate)
    - HAS_ATTRIBUTE (SpecNode → AttributeSpec)
    - IN_CATEGORY (Predicate → PredicateCategory)
  - Includes verification and example analysis queries
  - Comprehensive documentation in `spec/neo4j/README.md`
  - Run via: `npm run export:spec-neo4j`
  - Enables visual exploration and analysis of spec structure in Neo4j Browser

- **Spec Node Schema Bundling**: CLI now bundles all 354 spec node schemas for runtime validation
- **Dynamic Relationship Catalog**: `cli/src/core/relationship-catalog.ts` computes relationship metadata at runtime

- **Changeset Storage Migration**:
  - Changesets migrated from legacy `.dr/changesets/` format to new `documentation-robotics/changesets/` structure
  - Auto-migration triggers on first CLI invocation after upgrade
  - Status mapping: `draft` → `staged`, `applied` → `committed`
  - Preserves changeset IDs, timestamps, and change arrays
  - Base snapshot capture for drift detection

- **Staging Feature Schema**:
  - `StagedChangeset` schema with changeset metadata (id, name, description, created, modified, status)
  - `StagedChange` schema with operation type (add, update, delete), element ID, layer name, sequence number
  - Base snapshot format for drift detection across model snapshots
  - Status enum: `staged`, `committed`, `discarded`

### Removed

- **Layer-Specific Schemas**: Removed 24 redundant `{NN}-{layer}-layer.schema.json` files (12 from spec/, 12 from CLI bundled/)
- **Generation Script**: Removed `cli/scripts/generate-spec-instances.ts` (one-time conversion complete)
- **Static Relationship Catalog**: Removed `spec/schemas/relationship-catalog.json` (replaced by dynamic computation)
- **Spec Data Instances**: Removed all `.node.json` and `.relationship.json` files (now JSON Schemas)

### Changed

- **Architecture Principle**: Predicates contain intrinsic semantic properties only; derived metadata computed from usage patterns
- **Manifest Simplification**: No longer includes schema path references (validators discover schemas automatically)
- **Schema Organization**: Clear separation between base schemas (core types) and per-type schemas (specific definitions)

- **Changeset Format Evolution**:
  - Old format: Single `{name}.json` file in `.dr/changesets/`
  - New format: Structured directory per changeset: `documentation-robotics/changesets/{id}/metadata.yaml + changes.yaml`
  - Maintains full backward compatibility during migration period

- **Layer 8 Canonical Naming**: Layer 8 renamed from `datastore` to `data-store` throughout specification
  - Specification files renamed: `08-datastore-layer.md` → `08-data-store-layer.md`
  - Schema files renamed: `08-datastore-layer.schema.json` → `08-data-store-layer.schema.json`
  - All element IDs must use `data-store.` prefix (e.g., `data-store.table.users`)
  - Manifests must use `data-store:` as the layer key
  - Layer directories must be named `08_data-store/`
  - All cross-layer references updated to use `08-data-store` identifier
  - Users with existing projects must manually migrate their models

### Migration Path

This is a **breaking change** for spec-aware tooling:

- **CLI Impact**: Requires CLI v0.1.0+ (includes schema validator refactoring)
- **Model Data**: No impact on user model data (validation behavior unchanged)
- **Spec Tooling**: Tools reading spec structure must adapt to schema-only format
- **Validation**: Improved error messages with per-element validation context

**For CLI Users**: Update to CLI v0.1.0+ (no model migration required)

**For Spec-Aware Tools**:

- Replace `.node.json` / `.relationship.json` parsing with JSON Schema parsing
- Read from `spec/schemas/nodes/` and `spec/schemas/relationships/` directories
- Parse `predicates.json` for relationship semantics
- Compute `applicableLayers` dynamically by scanning relationship schemas

### Statistics

- **Total Spec Metadata**: 1,869 nodes, 2,349 relationships in graph
- **Schema Files**:
  - 212 node type schemas (one per element type)
  - 252 relationship type schemas (one per allowed relationship)
  - 47 predicates with full semantic definitions
  - 12 layer definitions
- **Export Formats**: Cypher (747 KB), CSV (626 KB)

## [0.7.1] - 2026-01-07

### Added

- **Source Code Reference Infrastructure Formalization**:
  - Documented `spec/schemas/common/` as canonical location for cross-layer schemas
  - Formalized source reference integration across 10 layers (03, 04, 05, 06, 07, 08, 09, 10, 11, 12)
  - Common schema definitions:
    - `source-references.schema.json` - Defines ProvenanceType, SourceLocation, RepositoryContext, SourceReference
    - `layer-extensions.schema.json` - Layer metadata and relationship catalog structures
    - `relationships.schema.json` - Relationship type definitions
    - `predicates.schema.json` - Predicate definitions for relationship semantics

- **Source Reference Layer Integration**:
  - **ArchiMate Layers** (04-application, 05-technology, 09-ux, 10-navigation, 11-apm, 12-testing): Use nested `properties.source.reference` pattern for compatibility with architecture description format
  - **Custom Security Layer** (03-security): Uses nested `properties.source.reference` pattern consistent with ArchiMate-style layers
  - **OpenAPI Layers** (06-api, 07-data-model, 08-datastore): Use `x-source-reference` extension pattern for compatibility with OpenAPI tooling
  - All 10 layers reference common schema definitions via `$ref: "common/source-references.schema.json#/definitions/SourceReference"`

- **Source Reference Schema Definition**:
  - **ProvenanceType**: Four-value enum tracking how references were created
    - `extracted` - Automated tooling ingestion
    - `manual` - Human entry
    - `inferred` - Pattern matching analysis
    - `generated` - Code generated from model
  - **SourceLocation**: File path and optional symbol for precise code location
  - **RepositoryContext**: Optional Git remote URL and 40-character commit SHA
  - **SourceReference**: Complete reference linking elements to one or more source code locations

- **Layer 03-Security Source Reference Support**:
  - **10 entity types** with source reference integration:
    - AuthenticationConfig - Auth provider implementations (JWT validation, session handlers)
    - SecurityPolicy - Policy-as-code implementations (OPA, RBAC middleware)
    - PolicyRule - Authorization logic functions
    - PolicyAction - Security action handlers (MFA, rate limiting)
    - RateLimit - Rate limiting middleware
    - AuditConfig - Audit logging implementations
    - Condition - ABAC condition evaluators
    - ValidationRule - Field validation code
    - Countermeasure - Security control implementations
    - Threat - Security test code, vulnerability scanners
  - Enables traceability from security policies to actual implementation code

- **Layer 05-Technology Source Reference Support**:
  - **7 entity types** with source reference integration:
    - Node - Terraform/CloudFormation/Pulumi infrastructure definitions
    - SystemSoftware - Dockerfiles, Ansible playbooks, Helm charts
    - TechnologyProcess - Automation scripts, CI/CD pipeline definitions
    - CommunicationNetwork - Network IaC (VPC definitions, networking configs)
    - Artifact - SQL migrations, configuration files
    - TechnologyInterface - API gateway configs, load balancer configs, ingress definitions
    - TechnologyService - Kubernetes manifests, Docker Compose files
  - Supports linking infrastructure elements to infrastructure-as-code definitions

### Changed

- **All Common Schemas**: Updated to reside in `spec/schemas/common/` as canonical location
- **10 Layer Schemas**: All schemas with source reference support verified and documented (03, 04, 05, 06, 07, 08, 09, 10, 11, 12)

### Backward Compatibility

- No breaking changes - source references remain optional properties
- All existing models remain valid under v0.7.1
- New source reference definitions are purely additive enhancements

## [0.7.0] - 2025-12-19

### Added

- **Layer Schema Relationship Sections**:
  - All 12 layer schemas now include `layerMetadata` section with layer ID, name, and relationship catalog version
  - `intraLayerRelationships.allowed[]` arrays define valid relationships within each layer (5-19 relationship types per layer)
  - `crossLayerRelationships.outgoing[]` arrays define relationships to other layers (0-19 relationships per layer)
  - `crossLayerRelationships.incoming[]` arrays define relationships from other layers (0-29 relationships per layer)
  - Total: 143 intra-layer relationships and 103 cross-layer relationships migrated from catalog and link registry

- **Common Schema Extensions**:
  - `common/layer-extensions.schema.json` - Definitions for layerMetadata, intraLayerRelationships, and crossLayerRelationships sections
  - Relationship catalog and common schemas now bundled with specification

- **Migration Tools**:
  - `scripts/extract-relationship-data.py` - Extracts relationship data from catalog, link registry, and markdown
  - `scripts/update-layer-schemas.py` - Programmatically updates layer schemas with relationship metadata

### Deprecated

- **link-registry.json** (deprecated in v0.7.0, will be removed in v0.8.0):
  - Cross-layer relationships now defined in layer schemas using `crossLayerRelationships` section
  - See layer schema `crossLayerRelationships` sections for migration
  - Deprecation notice added to file with migration guidance

- **link-registry.schema.json** (deprecated in v0.7.0, will be removed in v0.8.0):
  - Schema for validating link registry structure
  - Deprecated in favor of layer schema relationship sections

### Changed

- **Terminology Update**:
  - "Cross-layer links" → "cross-layer relationships" throughout specification
  - Consistent use of "relationship" terminology for semantic connections between elements
- **Layer Schemas**: All 12 layer schemas updated with comprehensive relationship metadata
- **Documentation**: Updated layer specification markdown files to reference schema-defined relationships

## [0.6.0] - 2025-12-14

### Added

- **Relationship Taxonomy**
  - Comprehensive formalization of 6 relationship categories with 60+ distinct predicates
  - **Categories**: Structural, Behavioral, Dependency, Traceability, Governance, Domain-Specific
  - ArchiMate 3.2 alignment with software-specific extensions
  - Bidirectional navigation support (every relationship has an inverse predicate)
  - Formal semantics for transitivity, symmetry, and cardinality
  - Traceability-first design for upward-flowing requirement chains

- **Enhanced Cross-Layer Reference Registry**
  - Catalog of 60+ cross-layer reference patterns across all 12 layers
  - **4 Reference Pattern Types**:
    - Pattern A: X-Extensions (OpenAPI/JSON Schema compatibility)
    - Pattern B: Dot-Notation Properties (upward references)
    - Pattern C: Nested Objects (complex relationships)
    - Pattern D: Direct Field Names (standard references)
  - Naming conventions and best practices for cross-layer integration
  - Examples for each pattern with rationale

- **Common Schema Infrastructure**:
  - `common/predicates.schema.json` (493 lines) - Predicate definitions for relationship types
  - `common/relationships.schema.json` (791 lines) - Relationship type schemas
  - `link-registry.schema.json` (339 lines) - Schema for link registry validation
  - `relationship-catalog.json` (855 lines) - Catalog of all available relationship types
  - `relationship-type.schema.json` (227 lines) - Schema for relationship type definitions

- **Layer Template**
  - Standardized template for layer specification documents
  - Ensures consistency across all 12 layer specifications
  - Includes sections for: Overview, Entities, Relationships, Cross-Layer Integration, Examples

### Changed

- **All 12 Layer Specifications Enhanced with Relationship Modeling**:
  - **Motivation Layer** (+173 lines):
    - Expanded relationship sections with structural, influence, and association relationships
    - Added sub-goal and sub-requirement aggregation examples
    - Enhanced with Meaning entity relationships to Value and Outcome
  - **Business Layer** (+466 lines):
    - Comprehensive relationship catalog: composition, aggregation, assignment, triggering, flow, serving
    - Cross-layer integration patterns with all 11 other layers
    - Enhanced example models with relationship instances
  - **Security Layer** (+794 lines):
    - Major expansion of security relationship modeling
    - Enhanced threat modeling with attack patterns and vulnerabilities
    - Comprehensive permission and role assignment relationships
  - **Application Layer** (+294 lines):
    - Enhanced composition, aggregation, and serving relationships
    - Deployment and interaction relationship patterns
  - **Technology Layer** (+99 lines):
    - Infrastructure relationship modeling improvements
  - **API Layer** (+157 lines):
    - Enhanced operation and endpoint relationship patterns
  - **Data Model Layer** (+162 lines):
    - Entity relationship and schema composition enhancements
  - **Datastore Layer** (+156 lines):
    - Storage and persistence relationship patterns
  - **UX Layer** (+186 lines):
    - Component composition and library reference relationships
  - **Navigation Layer** (+171 lines):
    - Route and flow relationship enhancements
  - **APM/Observability Layer** (+209 lines):
    - Metric and tracing relationship patterns
  - **Testing Layer** (+144 lines):
    - Test coverage and traceability relationship patterns

- **All 12 Layer Schemas Regenerated with Enhanced Relationship Definitions**:
  - Motivation Layer Schema (+235 lines): Enhanced relationship properties
  - Business Layer Schema (+44 lines): Updated entity relationships
  - Security Layer Schema (767 line restructuring): Major relationship enhancements
  - Application Layer Schema (+118 lines): Deployment relationships
  - Technology Layer Schema (+228 lines): Infrastructure relationships
  - API Layer Schema (+123 lines): Operation relationships
  - Data Model Layer Schema (358 line restructuring): Entity relationships
  - Datastore Layer Schema (364 line restructuring): Storage relationships
  - UX Layer Schema (750 line restructuring): Component relationships
  - Navigation Layer Schema (+244 lines): Route relationships
  - APM Layer Schema (538 line restructuring): Metric relationships
  - Testing Layer Schema (298 line restructuring): Coverage relationships

- **Link Registry Significantly Expanded** ([spec/schemas/link-registry.json](schemas/link-registry.json))
  - +1,745 lines of relationship and link definitions
  - Comprehensive catalog of all cross-layer reference patterns
  - Enhanced with bidirectional link tracking
  - Formal validation rules for relationship integrity

### Fixed

- **Testing Layer Schema Title** - Removed duplicate "Layer" in title
  - Was: "Testing Layer Layer Schema"
  - Now: "Testing Layer Schema"

### Known Limitations

- **Wave 2 Planned Enhancements**:
  - Structural relationship examples in Business and Application layers marked as TBD (8 placeholders total)
  - Cross-layer upward reference examples marked as TBD (44 placeholders referencing Motivation layer entities)
  - These are non-blocking documentation placeholders - core relationship infrastructure and taxonomy are complete
  - Wave 2 will provide concrete examples for all relationship patterns
  - All schemas validate successfully; TBD markers do not affect model validation

### Removed

- **Conformance Documentation** (moved to separate repository):
  - `conformance/README.md` (124 lines)
  - `conformance/certification-process.md` (279 lines)
  - `conformance/test-suite.md` (296 lines)
  - Total: 699 lines removed

- **Layer Integration Guide** - Superseded by enhanced layer specifications
  - `guides/LAYER_INTEGRATION_GUIDE.md` (526 lines)
  - Content integrated into individual layer specifications

### Migration Path

Models on v0.5.0 can use spec v0.6.0 without changes:

```bash
# Update CLI to use spec v0.6.0 (requires CLI v0.7.3+)
# No model migration required - backward compatible
```

**What Changed**:

- Enhanced relationship definitions (additive only)
- New common schemas (tools can leverage for validation)
- Improved documentation (no structural changes)

**Backward Compatibility**:

- All v0.5.0 models remain valid under v0.6.0
- New relationship types are optional enhancements
- Existing validation rules preserved

**Taking Advantage of New Features**:

1. **Enhanced Relationship Modeling**: Use new predicate types from taxonomy
2. **Cross-Layer References**: Leverage documented reference patterns
3. **Common Schemas**: Validate relationships using new common schemas
4. **Link Registry**: Use expanded link catalog for relationship validation

See individual layer specifications for detailed relationship examples and usage patterns.

---

### Technical Details

**Schema Generation**: All schemas regenerated using `scripts/generate_schemas.py --all`

**Documentation**:

- Total spec size: ~50,000 lines
- Net additions: +6,296 lines
- 40 files modified

**Validation**: All layer schemas validate successfully against JSON Schema Draft 7

**Tools Support**:

- CLI v0.7.3+ required for full spec v0.6.0 support
- Enhanced relationship validation in `dr validate --strict`
- Link registry validation in `dr validate`

## [0.5.0] - 2025-12-09

### Changed

- **UX Layer - Three-Tier Architecture** ([spec/layers/09-ux-layer.md](layers/09-ux-layer.md))
  - MAJOR architectural redesign from flat, self-contained UXSpecs to three-tier component library architecture
  - **Tier 1: UXLibrary** - Reusable design system components, sub-views, and patterns
    - `LibraryComponent` - Atomic UI elements with variants, slots, and data contracts
    - `LibrarySubView` - Composed component groupings (e.g., AddressForm, ProductCard)
    - `StatePattern` - Reusable state machine templates (CRUD, Wizard, Search patterns)
    - `ActionPattern` - Reusable action configurations with confirmation support
  - **Tier 2: UXApplication** - Application-level organization and shared configuration
    - Theme/design tokens, shared layouts, global state, library imports
    - Groups UXSpecs into coherent applications with consistent styling
  - **Tier 3: UXSpec** - Simplified experience-specific configuration
    - References library components instead of inline definitions
    - Pattern binding mechanism for state machines and actions
    - ~73% reduction in YAML lines per experience (300 → 80 lines typical)
  - **Benefits**:
    - Design system alignment - Maps naturally to Figma/Storybook workflows
    - DRY principle - Define components once, reuse across applications
    - Consistency - Single source of truth for component behavior
    - Enterprise scale - Multiple applications share design libraries
    - Versioning - Library versioning enables controlled evolution

- **UX Layer Schema** ([spec/schemas/09-ux-layer.schema.json](schemas/09-ux-layer.schema.json))
  - Complete JSON Schema regenerated with new entity structure
  - 16 entity types (6 new, 3 modified, 7 supporting entities)
  - File size increased from 18KB to 20KB reflecting richer structure
  - New top-level properties: `ux-libraries`, `library-components`, `library-sub-views`, `state-patterns`, `action-patterns`, `ux-applications`

### Added

- **Component Instance Pattern** - New pattern for instantiating library components with overrides
- **Pattern Extension Binding** - Mechanism for binding concrete implementations to pattern extension points
- **Slot-based Composition** - Components and sub-views support slots for customization
- **Library Inheritance** - Libraries can extend other libraries via `extendsLibrary`
- **Migration Guide** - Comprehensive before/after examples in layer specification

### Migration Path

The new three-tier architecture is **additive** - existing flat UXSpecs remain valid:

```bash
# No migration required - both patterns supported
dr validate  # Existing UXSpecs continue to work
```

**Migration to new architecture is optional but recommended:**

1. **Extract common components to UXLibrary** - For components used 3+ times
2. **Create UXApplication** - Group related UXSpecs with shared theme/layouts
3. **Simplify UXSpecs** - Replace inline definitions with library references

See [09-ux-layer.md Migration Guide](layers/09-ux-layer.md#migration-guide) for detailed conversion examples.

**Backward Compatibility**: Both inline and reference patterns are supported. Tools validate both formats during transition period.

## [0.4.0] - 2025-12-07

### Changed

- **Architecture Refactoring - Entity Standardization**:
  - ALL entity types across all 12 layers now have explicit `id` and `name` fields
  - `id` field: UUID format, required, serves as primary key
  - `name` field: Human-readable string, required, for display
  - Affects 165 entity types across all layers
  - Standardizes entity structure for improved tooling

- **Schema Updates**:
  - All 12 layer schemas regenerated with consistent entity structure
  - Link registry expanded from ~520 to 968 lines
  - Auto-generated with `generate_schemas.py --all`

### Migration Path

Models on v0.3.0 can migrate to v0.4.0 using CLI v0.7.0+:

```bash
dr migrate --apply
```

**What Gets Migrated**:

- `id` field: UUID auto-generated deterministically (preserves existing UUIDs)
- `name` field: Derived from existing name/id/description
- Backward compatible: existing fields preserved

## [0.3.0] - 2025-11-29

### Added

- **Testing Layer** ([spec/layers/12-testing-layer.md](layers/12-testing-layer.md))
  - NEW Layer 12: Test Coverage Modeling for requirements traceability
  - Test coverage targets (workflows, forms, APIs, data models)
  - Input space partitioning for systematic test input variation modeling
  - Context variations (UI, API, event-triggered, scheduled, integration)
  - Coverage requirements (pairwise, boundary, exhaustive, risk-based criteria)
  - Test case sketches (abstract test definitions)
  - Outcome categories for expected result partitions
  - Complete traceability from requirements through coverage to test implementations
  - Integration with Motivation, Business, UX, API, Data Model, Security, and Navigation layers
  - Optional references to test implementations (Gherkin, Postman, Playwright, etc.)

- **Testing Layer Schema** ([spec/schemas/12-testing-layer.schema.json](schemas/12-testing-layer.schema.json))
  - Complete JSON Schema for testing layer validation
  - Entity types: TestCoverageModel, TestCoverageTarget, InputSpacePartition, ContextVariation, CoverageRequirement, TestCaseSketch
  - Cross-layer reference patterns for test-to-requirement traceability

### Changed

- **Conformance Levels**:
  - Full conformance now requires all 12 layers (previously 11)
  - Updated conformance documentation to reflect Testing Layer
  - All conformance tests and validation rules updated

- **Documentation**:
  - Updated all references from "11 layers" to "12 layers" throughout specification
  - Updated layer ordering documentation to include Testing Layer
  - Updated standards mapping (33% custom vs 67% established standards)

### Migration Path

Models on specification v0.2.x can migrate to v0.3.0 using the Documentation Robotics CLI:

```bash
# Check what migrations are needed
dr migrate

# Preview changes without applying
dr migrate --dry-run

# Apply migrations to latest specification
dr migrate --apply

# Re-validate with link checking
dr validate
```

**What Gets Migrated**:

- Layer 12 (Testing) schema will be added to `.dr/schemas/`
- Manifest will be updated with Testing layer configuration
- No breaking changes to existing layers

## [0.2.0] - 2025-01-15

### Added

- **Cross-Layer Reference Registry**
  - Complete catalog of 60+ cross-layer reference patterns
  - 4 reference pattern types: x-extensions, dot-notation, nested objects, direct fields
  - 9 categories: motivation, business, security, application, api, data, ux, navigation, apm
  - Comprehensive naming conventions and validation rules
  - Migration guide from organic patterns to standardized patterns

- **Machine-Readable Registry** ([spec/schemas/link-registry.json](schemas/link-registry.json))
  - Auto-generated JSON catalog of all valid link types
  - Queryable by category, source layer, target layer, field path
  - Enables automated validation and tooling
  - Each link type includes: ID, name, category, layers, field paths, cardinality, format, validation rules
  - Generated from markdown layer specifications using `generate_schemas.py --all`

### Changed

- **Navigation Layer Schema** (`10-navigation-layer.schema.json`):
  - Added `experience` field to Route for UX layer references
  - Added `motivationAlignment.fulfillsRequirements` to Route for tracing navigation to requirements
  - Added `motivationAlignment.enforcesRequirement` to NavigationGuard for requirement enforcement
  - Added `api.operationId` and `api.method` to NavigationGuard for API operation references
  - Enhanced NavigationFlow with motivation alignment

- **APM Layer Schema** (`11-apm-observability-layer.schema.json`):
  - Added `dataModelSchemaId` field to distinguish JSON Schema `$id` from file path
  - Clarified distinction between schema reference (file path) and schema identifier (JSON Schema $id)
  - Improves accuracy when referencing data model schemas in observability context

### Migration Path

Models on specification v0.1.x can migrate to v0.2.0 using the Documentation Robotics CLI:

```bash
# Check what migrations are needed
dr migrate

# Preview changes without applying
dr migrate --dry-run

# Apply migrations to latest specification
dr migrate --apply

# Re-validate with link checking
dr validate
```

**What Gets Migrated**:

- Naming conventions: camelCase → kebab-case in relationship fields
- Cardinality: Single values → arrays where specification requires arrays
- Format: Validation of UUID, path, duration, and percentage formats

See [CLI Link Management Guide](../cli/docs/user-guide/link-management.md) for detailed migration documentation.

## [0.1.1] - 2024-12-15

### Fixed

- Updated README.md to more accurately reflect the vision
- Normalized the name for the spec (Documentation Robotics) used throughout
- Cleaned up documentation links and references in prep for making repo public

## [0.1.0] - 2024-11-23

### Added

- Initial stable release of the Federated Architecture Metadata Model specification
- Core specification documents (overview, federated approach, layering philosophy, cross-layer integration, reference directionality, validation strategy)

- Complete layer specifications for all 11 layers:
  - 01-motivation-layer.md (ArchiMate)
  - 02-business-layer.md (ArchiMate)
  - 03-security-layer.md (Custom)
  - 04-application-layer.md (ArchiMate)
  - 05-technology-layer.md (ArchiMate)
  - 06-api-layer.md (OpenAPI)
  - 07-data-model-layer.md (JSON Schema)
  - 08-datastore-layer.md (SQL DDL)
  - 09-ux-layer.md (Custom)
  - 10-navigation-layer.md (Custom)
  - 11-apm-observability-layer.md (OpenTelemetry)
- JSON Schema definitions for all layers
- Conformance requirements and test suite
- Implementation guides
- Reference materials (glossary, entity index, standards mapping)
- Governance model and contribution guidelines

### Standards Integrated

- ArchiMate 3.2 (Layers 01, 02, 04, 05)
- OpenAPI 3.0 (Layer 06)
- JSON Schema Draft 7 (Layer 07)
- OpenTelemetry 1.0+ (Layer 11)
- W3C Trace Context (Layer 11)

### Custom Specifications

- Security Model (Layer 03) - RBAC/ABAC/Policy-based access control
- UX Specification (Layer 09) - Multi-channel experience state machines
- Navigation Specification (Layer 10) - Channel-agnostic routing

### Statistics

- 11 layers
- 70+ entity types
- 430+ attributes
- 35+ enums
- 65+ cross-layer reference types
- 5 standards leveraged
- 3 custom specifications

---

## Version Numbering

The specification uses [Semantic Versioning 2.0.0](https://semver.org/):

- **MAJOR** version for breaking changes to layer definitions, entity schemas, or reference types
- **MINOR** version for new layers, entities, or backward-compatible additions
- **PATCH** version for clarifications, typo fixes, and non-normative changes

Examples:

- `2.0.0` - Breaking change (e.g., rename entity type, remove required attribute)
- `1.1.0` - New feature (e.g., add new entity type, new optional attribute)
- `1.0.1` - Clarification (e.g., fix typo, clarify documentation)

[0.1.0]: https://github.com/tinkermonkey/documentation_robotics/releases/tag/v0.1.0
