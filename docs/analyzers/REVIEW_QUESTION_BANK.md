# Review question bank

Track B of [SELF_ASSESSMENT_ROADMAP.md](SELF_ASSESSMENT_ROADMAP.md). Version 0.1, curated with the
maintainer on 2026-11-21. The bank itself is data, in `cli/scripts/assess-eval/questions.json`;
`witnesses.ts` checks it against the spec (`--check`) and computes its model witnesses, and the
agent follows `cli/scripts/assess-eval/RUNBOOK.md`. The JSON is the source of truth for the
witnesses. This page explains the bank.

## What a question is

A concern a complete model must be able to answer, asked the way an architect asks it in a review.
Each one has these parts:

- **Applies when:** a precondition read from the gap ledger. The agent skips a question that cannot
  apply, and records that it skipped it.
- **Witnesses:** deterministic queries that list what the answer is missing, computed before the
  agent reads any code. Two kinds:
  - _model witnesses_ (`has`, the form of today's review checks, and `trace`: does a chain of
    predicates from this element reach that type);
  - _code witnesses_: counts from the CBM index compared with the model, for example 12 `Route`
    nodes against 3 API operations.
- **Evidence:** where the agent looks to resolve each witness.
- **Answer:** what the agent may stage, and with which predicates. The predicates come from the
  layer's modelling rules (`spec/layers/*.layer.json`).
- **Verdict per witness:** each witness ends in one of these:
  - `wired`: links staged;
  - `added`: elements staged;
  - `expected-absent`: the system genuinely has none, with the reason;
  - `blind-spot`: the agent cannot tell from the code;
  - `spec-gap`: the spec has no type or triple for it, which becomes a candidate Context Studio
    proposal;
  - `unsure`.
- **Done when:** every witness has a verdict.

The ledger's empty pairs and open types are not separate questions. Each one is assigned to the
question that covers its layers, and any left over go to an "other" witness on the closest
question. That way nothing the ledger raises goes unasked, and it can be measured which question
answered it.

## The questions

Each question is ordered by the view it serves. "Today's checks" are the 14 in
`cli/scripts/assess-eval/checks.json` that become its witnesses.

### Context and purpose

**Q1. Who is the system for, and what do they use it for?**

- Applies when: always.
- Witnesses:
  - no `product.persona`, `business.businessactor`, `business.businessrole` or
    `motivation.stakeholder`;
  - features with no `serves` to a persona (today's check `feature-persona`);
  - personas with no `references` to a stakeholder or role.
- Evidence: README, docs, CBM doc sections and `ADR` nodes, the UI's top-level views.
- Answer: personas, roles and stakeholders; `feature serves persona`;
  `persona references stakeholder`.
- Risk: everything here is inferred from documentation. Without docs, the answer is mostly
  `blind-spot`.

**Q2. Why does each part exist? Trace each service to a feature or capability, and on to a goal.**

- Applies when: the application layer is populated.
- Witnesses:
  - application services with no `realizes` to a feature, software capability, business service or
    goal (today's check `service-purpose`);
  - features with no `realizes` to a software capability (`feature-capability`);
  - capabilities with no `supports` to a goal;
  - goals that nothing supports or realizes.
- Evidence: docs, ADRs, names, the shape of the UI.
- Answer: `realizes` and `supports` along the intent chain. Product and motivation elements only
  where the evidence names them.
- Risk: the highest invention risk in the bank. Intent may be inferred with no document naming
  it (decision 1), staged with `inferred` provenance, so step C measures how good that inference
  is.

**Q3. Which decisions, principles and constraints shape the design?**

- Applies when: always.
- Witnesses:
  - CBM `ADR` nodes and decision sections in docs with no motivation element;
  - principles and constraints that nothing `satisfies`.
- Evidence: ADR files, docs, CLAUDE.md and contributing guides, lint and CI configuration as
  enforced constraints.
- Answer: principles, constraints, requirements; `satisfies` from the elements that follow them.

### Building blocks

**Q4. What are the main building blocks, and how do they depend on each other?**

- Applies when: the application layer is present, or the code has more than one package or module
  cluster.
- Witnesses:
  - components with no `assigned-to` to a function and no `realizes` to a service
    (`component-realizes-service`);
  - functions with no `realizes` (`function-realizes-service`);
  - CBM architecture clusters and packages with no component holding them;
  - components with no `uses` or `composes` to another component, and that no service `serves`.
- Evidence: CBM clusters, `IMPORTS`, package manifests, entry points.
- Answer: components, collaborations, functions; `assigned-to`, `realizes`, `serves`, `uses`,
  `composes`.

**Q5. What does each interface expose, what implements it, and who calls it?**

- Applies when: the API layer is present, or CBM has `Route` nodes.
- Witnesses:
  - operations with no `realizes` to an application function (`operation-realized`);
  - operations not composed by a path item (`operation-in-path`);
  - operations that nothing calls: no UX action component that `triggers` it, no navigation element
    it `serves`, no test that `tests` it;
  - the CBM `Route` count against the operation count.
- Evidence: routes, handlers, OpenAPI files, client code that calls the API.
- Answer: operations and path items; `realizes`, `composes`, `triggers`, `serves`.

### Runtime

**Q6. Show how the model represents the full stack: from each client entry point, through the API
and application logic, to the stores and data sources, including the schemas and types on the
way.**

- Applies when: at least two of the ux, navigation, api, application, data-model and data-store
  layers are present.
- Witnesses:
  - for each entry point (a route, a view, an operation, a CLI command), a `trace` along the
    predicates the modelling rules name. For example:
    - `route maps-to view`;
    - `view binds-to dataconfig`, then `dataconfig maps-to` an API response, request body or
      schema, or a data-model object schema;
    - `operation realizes function`;
    - `function accesses` an object schema or collection;
    - `objectschema maps-to collection`.

    The witness is each entry point whose trace stops before a store or an external source, and
    the last element the trace reached.

  - the schemas on a reached chain with no `maps-to` to the next layer.

- Evidence: CBM `trace_call_path` from each entry point's handler, `DATA_FLOWS`, the model's
  source references.
- Answer: the missing link or element at the point where the trace stopped.
- Note: this is the maintainer's original question, and it absorbs the path probe. It samples
  vertical slices, where Q4, Q5 and Q7 are exhaustive per type. The pilot will show whether both
  are needed.

**Q7. Where does each piece of persisted data live? What is its schema, and what reads and writes
it?**

- Applies when: the data-model or data-store layer is present, or CBM has `Table` nodes, ORM models
  or SQL files.
- Witnesses:
  - collections with no `maps-to` from a schema (`collection-schema`);
  - collections that nothing `accesses` (`collection-accessed`);
  - collections not composed by a database or namespace (`collection-in-database`);
  - ORM-shaped object schemas with no `maps-to` to a collection;
  - the data-store layer absent while the code has a store.
- Evidence: migrations, ORM models, connection setup, repository or DAO code, file and cache
  stores.
- Answer: databases, collections and fields; `maps-to`, `accesses`, `composes`.

**Q8. What happens asynchronously? Who produces and who consumes each event, message or job?**

- Applies when: CBM has `EMITS`, `LISTENS_ON`, `ASYNC_CALLS` or queue and pub-sub library use, or
  the model has application events or messages.
- Witnesses:
  - events nothing raises, or that trigger nothing;
  - messages with no sender or no handler;
  - async call sites in the code with no event or message.
- Evidence: event buses, queues, websockets, schedulers, cron, workers.
- Answer: events, messages, processes; `triggers`, `flows-to`, and `realizes` from object schemas.

**Q9. Where and how does it run, and what does it depend on outside itself?**

- Applies when: always.
- Witnesses:
  - the technology layer absent or thin while CBM has `Resource`, `Image`, `Chart` or `Process`
    nodes, Dockerfiles or compose files;
  - application components with nothing in technology serving or hosting them;
  - artifacts that `realizes` no component;
  - outbound `HTTP_CALLS` to external hosts, and major SDKs and frameworks in the manifests, with no
    modelled counterpart (system software or a technology service that `serves` the component,
    or an external node).
- Evidence: Dockerfiles, compose, k8s, CI workflows, environment variables, package manifests.
- Answer: nodes, system software, artifacts, technology services; `serves`, `depends-on`,
  `realizes`, `composes`.

### Cross-cutting

**Q10. How is a caller authenticated and authorised, what is the system protected against, and
which data is sensitive?**

- Applies when: CBM shows authentication code (middleware, decorators, token libraries, session
  handling), or the security layer or `api.securityscheme` is present.
- Witnesses: the full layer, by its modelling rules (decision 2), 17 in all. Among them:
  - no security model, no authentication configuration or security scheme;
  - authentication that `authenticates` no actor or `protects` no resource;
  - actors with no role, roles with no permissions, permissions that `authorizes` no resource
    operation, resources that compose no operations;
  - policies with no rules, rules that protect nothing, schemes that `realizes` no policy;
  - no threats, threats that no countermeasure `mitigates` or that `targets` nothing,
    countermeasures no policy `mandates`;
  - no data classification, classifications that `governs` nothing.
- Evidence: middleware, guards, identity-provider configuration, RBAC tables; input validation,
  rate limits and secrets handling as countermeasures.
- Answer: the security layer in full. Threats are inferred from what the code defends against.

**Q11. What does it record about itself in production, and what watches it?**

- Applies when: CBM shows logging, metrics or tracing libraries or `OTEL_*` variables, or the APM
  layer is present.
- Witnesses:
  - telemetry code with no APM element;
  - signals that `monitors` nothing;
  - components that produce telemetry but have no `resource` that `maps-to` them.
- Evidence: logger setup, OpenTelemetry configuration, metrics registries, dashboards and alert
  files.
- Answer: resources, scopes, instruments, log records; `monitors`, `maps-to`, `aggregates`.

**Q12. What screens and routes are there, and which user flows do they make up?**

- Applies when: the UX or navigation layer is present, or the code has a front end.
- Witnesses:
  - routes with no `maps-to` to a view (`route-view`);
  - views with no `realizes` to a feature (`view-feature`);
  - data configurations with no `maps-to`;
  - navigation flows with no `realizes` to a user workflow.
- Evidence: router configuration, page components, menus.
- Answer: views, routes, flows; `maps-to`, `realizes`, `binds-to`, `composes`.

**Q13. What is tested, at what level, by what reasoning about inputs and outcomes, and what is
not tested?**

- Applies when: the code has tests.
- Witnesses: the full layer, by its modelling rules (decision 2), 12 in all. Among them:
  - no coverage model;
  - services, components and operations that nothing `tests` or `covers`;
  - test case sketches that test nothing or sit in no coverage target;
  - targets that cover nothing, sit in no coverage model or compose no requirements;
  - requirements with no partition selections, partitions with no values, input fields with no
    partition.
- Evidence: test files, CBM `TESTS` and `TESTS_FILE`, parameterised tests and fixtures (the input
  partitions and values), coverage configuration and exclusions.
- Answer: the testing layer in full: coverage model, targets, requirements, partitions and values,
  selections, test case sketches; `tests` and `covers` to what they exercise. Partitions come from
  what the tests vary.
- Note: on models with many test cases this question floods. The viewer has 984 elements flagged
  and stagecraft 3,434, almost all sketches with no coverage target. The runbook has the agent work
  by file. The pilot will show whether that is affordable.

### Coverage

**P0. What significant code does the model not cover?** This is a pre-pass, not a question.

- How: re-run extraction (`codebase_extract`, tiers 0 and 1) against the model, and hand the agent
  the cards extraction would add that the model lacks, grouped by layer.
- Why it is here: it replaces the residual and frontier finders, which ranked the whole codebase
  and put a removed element's code in the top 100 in 14 of 129 trials.
- Its card groups become the "added" candidates that Q4 to Q13 work through.

## What is out, and why

- **One question per layer pair or relationship type.** That is the ledger, and its rows are
  assigned to these questions as witnesses.
- **Business layer processes, functions and capabilities as a question of their own.** Few of these
  systems automate an organisation's business process. Q2 reaches the business layer where the
  evidence names it.
- **API document detail** (headers, examples, encodings, media types). Extraction and OpenAPI
  import cover these mechanically. They are not review concerns.
- **Quality attributes as ATAM scenarios** (performance, availability). The spec has no home for
  them beyond requirements and constraints, and Q3 covers those.

## Decisions (maintainer, 2026-11-21)

1. **Intent from code.** The agent may propose goals, outcomes, capabilities, personas and
   threats with no document naming them, staged with `inferred` provenance and its reason logged.
2. **Depth in security and testing.** The full layer spec, not a subset.
3. **The full-stack trace (Q6) beside Q4, Q5 and Q7.** Both are kept for the pilot, and the
   set-cover curve decides.
4. **The extraction re-run (P0).** A pre-pass whose cards are worked through under the questions.

Still open: wording, additions and cuts for Q1 to Q13. Revise only between rounds (the roadmap's
held-out rule).

## First witness counts (2026-11-21)

`cli/scripts/assess-eval/data/witness-report.md` has the counts for the four models in the
harness. In brief:

- every ledger row is assigned to a question, and none is left over;
- Q5 and Q13 flag the most elements;
- Q1 fires nowhere except stagecraft, which has no product layer;
- Q8, Q10, Q11 and Q12 depend on a code precondition for at least one model.
