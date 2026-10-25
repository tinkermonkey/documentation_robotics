# Extraction and Spec Refinement Strategy (October 2026)

Status: **active plan**. Set on 2026-10-24 after a month-long pause. This document is
the reference for _why_ the eval harness, the spec enrichment pass, and the
decision-model cascade exist, and in what order they are meant to land. Update it when
a phase completes or the plan changes.

## Where the project stood on 2026-10-24

- CLI 0.2.0, spec 0.10.0, `main` at `749a455e`.
- Shipped in the month before the pause: MCP server over stdio and HTTP (#772, #934),
  model hierarchy and Model Farm (#897, #913), field-reported CLI fixes and `--json` on
  mutating commands (#849, #889), DrBot read permissions and the maintained
  `documentation-robotics/README.md` (#868, #882).
- Open at the time: PR #961 (codebase-memory indexing must honor `codebase_path`,
  blocks farm mode), PR #965 (agent image fixes), issues #960 (no UX to application
  predicate path), #962 (`dr farm add` duplicates a self-hosted model), #963/#964
  (dangling relationship rows after `dr delete`).
- Extraction today: `/dr-map` and `/dr-sync` are Claude Code skills that read files.
  `dr analyzer` wraps codebase-memory-mcp (CBM) and `spec/analyzers/cbm` maps 5 node
  labels and 2 edge types; promotion heuristics are regex and fan-in thresholds.

### Spec quality baseline (measured 2026-10-24)

| Measure                                                                        | Value            |
| ------------------------------------------------------------------------------ | ---------------- |
| Node types / relationship schemas                                              | 191 / 1,589      |
| Relationship descriptions that are boilerplate (`Defines relationship: X p Y`) | 1,589 of 1,589   |
| Attributes with no description                                                 | 342 of 823 (42%) |
| Node types with a description under 80 characters                              | 16               |

The thinnest definitions are the core application-layer types
(ApplicationService, ApplicationComponent, ApplicationInterface), which are exactly
the types the CBM mapping targets. The existing `dr audit` AI path shells out to the
`claude` CLI serially (`cli/src/audit/ai/runner.ts`); it was never built for bulk
token spend.

## The two directions

### Direction A: spend bulk Claude API tokens refining the spec

Run through the Messages API with the Batch API and prompt caching. Output is
changesets against `spec/schemas/`, reviewed per layer as PRs. Stages:

1. **Operational definitions for every node type.** Fixed template: genus-and-
   differentia definition; the standard it aligns to with a section reference
   (ArchiMate 3.2, OpenAPI, OTel, XACML); inclusion and exclusion rules ("use this
   rather than ApplicationFunction when..."); two or three concrete code-level
   signatures of what the type looks like in a repository. The last field doubles as
   classifier criteria text (Direction B).
2. **Attribute descriptions** for the blanks, generated with the node definition and
   sibling attributes in context.
3. **Relationship semantics.** Replace every boilerplate description with a sentence of
   meaning plus an _evidence_ line: what in code, config or infrastructure would prove
   the relationship holds. Generate from the predicate definition and both node
   definitions so wording is uniform.
4. **Gap and overlap sweep.** For every pair of types in adjacent layers ask "should a
   relationship exist, with which predicate, or none?" (~36k pairs; a decision-model
   task, a few dollars). Would have caught #960. Pair with a Claude judge on a sample
   for "could these two types be confused?" to find semantic duplicates.
5. **Measurable quality loop.** Claude writes the definition; a decision model
   classifies held-out labelled examples using only that definition as criteria. Low
   accuracy means a weak definition. _Zero-shot classifiability_ becomes the spec's
   quality score.

### Direction B: AST-first extraction with decision models

**Decision models** (Jev from TypeSafe AI; Cloudflare's Jev-compatible open-weight
Clef and Clef-flash on Workers AI, launched 2026-10-01): send a `state` plus named
questions of type `choice`, `score` or `noul` (yes/no); get calibrated probabilities,
no generated text. Clef is Apache 2.0, 27B (Clef) and 9B (Clef-flash), 64k context,
roughly $0.24 and $0.09 per million input tokens, ~200ms and ~40ms median latency.
Cloudflare also offers an RL fine-tuning platform (forward-deployed as of Oct 2026).
Cisco's independent evaluation: zero-shot Jev beat a prompted 31B LLM judge on AUC on
7 of 8 benchmarks with usable calibration, but a fine-tuned 1B classifier beat both at
strict false-positive budgets. Plan accordingly: start zero-shot with rich criteria,
measure, fine-tune later.

Operating rules from the field: one specific question per evaluation and combine in
code; always include a `none`/`other` option; set thresholds on held-out validation
data; version the question set like a model; keep an LLM before (build the state) and
after (act on the answer).

CBM offers far more than the current mapping uses: Process, Package, Image, Chart,
Resource and EnvVar nodes; EMITS, LISTENS_ON, ASYNC_CALLS, DATA_FLOWS, CONNECTS_TO,
DEPLOYS and CONFIGURES edges; embedded semantic search; `get_architecture` clusters;
`trace_path` in topology mode; runtime trace ingestion. These reach technology,
data-store, APM and security, not only application and API.

**Target architecture: a three-tier cascade.**

- **Tier 0, deterministic.** CBM graph plus mapping produces candidate symbols and
  clusters. Each candidate gets a _state card_: signature, docstring, decorators,
  file path, package, one-hop callers and callees, referenced env vars and string
  literals, cluster from `get_architecture`.
- **Tier 1, decision model.** Per card: `choice` for layer (criteria = the enriched
  layer definitions); `choice` for element type within the layer; `score` for
  architectural significance (replaces fan-in and naming-suffix promotion heuristics);
  a bank of `noul` questions for cross-cutting concerns (authentication,
  authorization, persistence boundary, external integration, observability). Per graph
  edge between modelled candidates, a `noul` per candidate predicate. Probabilities
  above a threshold go straight into a changeset, a middle band escalates, the rest is
  dropped.
- **Tier 2, Claude.** Only for the escalated band, for naming and describing elements,
  for writing the changeset, and for the layers the AST cannot see (business,
  motivation, product), inferred from the classified lower layers.

Example: "which parts of this codebase are authentication?" becomes: run the concern
questions over every cluster and path, aggregate positives structurally, and have
Claude assemble AuthenticationConfig, Roles and AccessConditions from that subgraph
with evidence attached.

Why rebuild: decisions are reproducible (so `dr farm sync` and `dr verify` can compare
probabilities across runs and detect real drift), every human-approved changeset
becomes a labelled example, and the question bank gives cheap gates elsewhere ("does
this diff change architecture?" per changed symbol lets a cron farm skip the Claude
pass on most commits).

## Phase 0 results (2026-10-24)

Three corpora, gold labels from Opus 5.5 (high effort, full card context), classifiers see a
40-line state card. Layer accuracy / end-to-end type accuracy against gold:

| corpus    | cards | clef          | clef-flash    | claude-sonnet | claude-haiku  |
| --------- | ----- | ------------- | ------------- | ------------- | ------------- |
| petclinic | 106   | 84.0% / 73.6% | 65.1% / 45.3% | 84.0% / 82.1% | 59.4% / 52.8% |
| fastapi   | 200   | 78.5% / 69.5% | 78.5% / 59.5% | 71.5% / 62.0% | 72.0% / 63.5% |
| dr-cli    | 300   | 81.3% / 57.3% | 61.7% / 50.3% | 78.3% / 68.3% | 60.3% / 49.3% |

Cost and latency per card: Clef about $0.001 and 650-700 ms median; Sonnet about $0.008 and
1.6 s; Haiku about $0.0005 and 1.6 s; Clef-flash about $0.0003 and 1.0-1.2 s.

What the numbers say:

- **Zero-shot Clef is at least as accurate as Sonnet on layer choice on all three corpora**
  (84.0 vs 84.0, 78.5 vs 71.5, 81.3 vs 78.3), at roughly a tenth of the cost and 2.4x the
  speed, with nothing but the spec's layer descriptions as criteria. Sonnet wins on end-to-end
  type accuracy on two of three (82.1 vs 73.6 on petclinic, 68.3 vs 57.3 on dr-cli).
- **Clef's probabilities are underconfident but monotonic**, which is what a cascade needs:
  a layer threshold of 0.60 gives 96-97% precision on 36-37% of cards on every corpus, and
  0.50 gives about 92% on 65%. Sonnet's self-reported confidence is better calibrated on
  average (ECE 0.07-0.14) but discriminates less: on dr-cli precision only climbs from 79% at
  0.50 to 90% at 0.80, so there is no clean auto-accept band. Haiku's confidence is not usable
  as a gate.
- **Type selection is the weak link.** Given the correct layer, Clef picks the right element
  type 88% of the time on petclinic and fastapi but only 70% on dr-cli, where almost everything
  is `application` and the choice is among applicationfunction / applicationcomponent /
  applicationservice / dataobject (Sonnet manages 87% there). Those criteria are the node-schema
  descriptions, which are exactly the thin definitions Direction A is meant to fix.
  Type-given-layer accuracy is now the measurable target for the enrichment pass.
- **Systematic misses.** Clef recalled zero `technology` symbols on all three corpora
  (technology elements come from manifests and Dockerfiles, not code symbols, so symbol
  classification is the wrong extraction path for that layer). On dr-cli it sends borderline
  application code to `none` (22) or `data-model` (19); on fastapi it labels trivial UI helpers
  as `ux` (16). Sonnet errs the other way: it under-uses `none` (40% recall on fastapi, 54% on
  dr-cli, 78% on petclinic) and over-assigns `application`, `api` and `ux`. Haiku swings the
  opposite way on dr-cli, sending 55 application symbols to `none`.
- **"none" is a large class**: 27-43% of sampled symbols per corpus are not architecturally
  meaningful on their own. The significance score agrees with gold within one level on
  91-97% of cards for Clef.
- **Clef-flash is not a candidate on its own** (weaker layer accuracy except on fastapi, worse
  calibration); it may still serve as a cheap first gate once fine-tuned.

Implications: Tier 1 of the cascade is viable now with Clef at a 0.6 layer threshold; the
0.5-0.6 band and the rest escalate to Claude. The next experiments are the `none`-handling
variants, richer type criteria from the enrichment pass, and a non-symbol path for the
technology layer. Harness details and per-backend tables: `cli/scripts/classify-eval/data/*/report.md`.

## Phase 1 status (2026-10-25)

The enrichment pipeline exists at `cli/scripts/spec-enrich/` (README there): `inventory.ts`
measures coverage; `propose-nodes.ts` asks Opus 5.5 for an operational definition, sibling
distinctions, a standard reference, three code-evidence signals and missing attribute
descriptions per type; `propose-relationships.ts` asks for a meaning and an evidence sentence
per relationship, grouped per source type; `apply.ts` writes proposals into `spec/schemas/**`
(`description`, `x-dr-standard`, `x-dr-evidence`, `x-dr-distinguish`, attribute descriptions).
`spec/scripts/build-spec.ts` now passes relationship `description` and `evidence` through to
`spec/dist`, which previously carried no relationship descriptions at all.

**Pilot: application layer, measured on the Phase 0 gold labels.** Nine type definitions and
87 relationship descriptions were proposed (about $0.70 synchronously), applied, and the spec
rebuilt. Clef was rerun with the enriched criteria (`clef@enriched-v1`):

| corpus    | type-given-layer before | after enrichment | after enrichment + kind narrowing |
| --------- | ----------------------- | ---------------- | --------------------------------- |
| dr-cli    | 70.5%                   | 71.3%            | 74.6%                             |
| fastapi   | 88.5%                   | 88.5%            | n/a                               |
| petclinic | 87.6%                   | 86.5%            | n/a                               |

Layer accuracy was unchanged (layer criteria did not change). The definitions alone did not
move the target metric. The confusion matrix explains why: before, Clef called 28 of 48
classes `applicationfunction`; after, it called 9 of 18 methods `applicationcomponent`. The
boundary moved, it did not sharpen. The gold labels themselves are strongly driven by symbol
kind (classes are components 37/50, methods are functions 27/29, interfaces are data objects
25/27), Sonnet uses that signal (80-100% per kind) and Clef does not, and a plain
kind-to-type rule scores 71%, the same as Clef.

**Finding:** for element-type choice the limiting factor is not definition quality but the
classifier's use of structural facts the card already states. A Tier-0 narrowing of the
candidate set by symbol kind (`classify.ts --kind-narrow`, map in `backends/clef.ts`) is worth
+4 points; the next steps are making the kind rule part of the question framing for every
layer, and treating `Module` separately (gold splits modules across five types). Richer
definitions remain valuable for the spec itself and for Claude-tier reasoning, and the
proposal `notes` surfaced real spec issues: `applicationcomponent.type` conflates ownership
with style, `applicationprocess` has no attributes for trigger/steps/outcome,
`applicationinterface.protocol` mixes protocols with styles, and `applicationinterface
depends-on applicationservice` duplicates `serves`.

**Proposals complete (2026-10-25):** definitions for all 192 node types and descriptions
for all 1,611 relationships are in `cli/scripts/spec-enrich/data/proposals/` as reviewable
files (about $5 via the Batch API), not yet applied beyond the application layer. Every type
came back with maintainer notes; `data/notes-digest.md` collects them per layer.

## Sequencing

| Phase | Deliverable                                                                                                                                                                                                                                                                                                                                                              | Status                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| 0     | **Eval harness.** Three corpora (this repo's `cli/`, the FastAPI full-stack template, Spring PetClinic). Claude via the Batch API produced gold labels for 606 symbol cards. `cli/scripts/classify-eval/` builds cards from CBM, labels them, runs classify backends (Clef, Clef-flash, Claude), and reports accuracy and calibration. Results: "Phase 0 results" above. | done 2026-10-25          |
| 1     | **Spec enrichment pass** (Direction A, stages 1-3). Pipeline built and piloted on the application layer; proposals for all other layers in flight. See "Phase 1 status".                                                                                                                                                                                                 | in progress (2026-10-25) |
| 2     | **Cascade wiring.** Widen `spec/analyzers/cbm` to the rest of CBM's vocabulary; wire the tiers into `/dr-map` and `dr analyzer`.                                                                                                                                                                                                                                         | planned                  |
| 3     | **Fine-tuning** Clef on accumulated approved changesets.                                                                                                                                                                                                                                                                                                                 | planned                  |
| -     | Gap/overlap sweep and the classifiability loop (Direction A, stages 4-5).                                                                                                                                                                                                                                                                                                | after phase 1            |

Preconditions: land PR #961 before any farm-mode use of the pipeline; fix #963 before
any automated pipeline is allowed to delete elements.

## What Phase 0 has taught us so far (2026-10-24)

- **The spec had no layer definitions.** Every `*.layer.json` description was literally
  `Layer N: Name`. Fixed the same day: all 13 layer files now carry purpose-and-scope
  definitions (spec changelog, Unreleased), and the harness reads its layer criteria from
  `spec/dist`. Element-type criteria still come from the node-schema descriptions, which is
  where Direction A's enrichment matters next.
- **`08-data-model.layer.json` lists no node types** (`node_types: []`) although nine
  data-model node schemas exist and compile into `spec/dist/data-model.json`. The build reads
  the schema directory, so nothing breaks, but the layer file is wrong. Not fixed yet (spec
  change; needs a decision).
- **CBM 0.10.x surface.** `query_graph` returns text tables unless `format: "json"` is
  passed (not in its advertised schema); its Cypher ignores `LIMIT` and aggregations;
  `search_graph` and `trace_path` have a `format: "json"` mode with per-field columns;
  `get_code_snippet` returns the source. Bulk edge pulls (CALLS, IMPORTS, CONFIGURES,
  HANDLES, HTTP_CALLS, INHERITS/IMPLEMENTS) take ~100ms each, so building an in-memory
  adjacency map is the right pattern for whole-repo work.
- **Route identity.** CBM Route nodes are named `__route__METHOD__/path/{}`; HANDLES
  edges reference them by path only. FastAPI decorator handlers are not always linked by
  HANDLES, so the card builder falls back to "the function in a referencing file whose
  source contains the path".
- **`dr analyzer index` indexes the cwd**, not `codebase_path` (issue #953 / PR #961);
  running it from `cli/` produced a project rooted at `cli/`.
- **Gold labeling cost.** Opus 5.5 at high effort with the full spec reference as a cached
  system prompt runs about $0.10 per card uncached and far less with cache hits; the Batch
  API halves it. A 500-card gold set is a few tens of dollars.

## Decisions log

- 2026-10-24: eval harness lives in `cli/scripts/classify-eval/` (experimental tooling),
  not a public `dr` command, until the measurements justify promoting it.
- 2026-10-24: eval corpora cloned under `eval-corpus/` (gitignored); cards and gold
  labels are committed under `cli/scripts/classify-eval/data/` because they are the
  dataset.
- 2026-10-24: Clef backend is built first (API shape known, pricing known); Jev added
  when a TypeSafe key is available.
- 2026-10-24: three corpora for Phase 0: `dr-cli` (this repo's `cli/src`, TypeScript),
  `fastapi` (full-stack-fastapi-template: Python API + React frontend), `petclinic`
  (Spring PetClinic: Java, JPA, controllers, Thymeleaf). The cli-validation projects are
  too small (3 source files) to serve as a corpus.

## Sources

- Cloudflare, "Introducing Clef": https://blog.cloudflare.com/clef-decision-models
- Clef on Workers AI changelog: https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/
- Hands-on with Clef (request/response shapes, limits): https://dev.to/akari_iku/hands-on-with-cloudflares-decision-model-clef-on-workers-ai-del
- Cisco, "Jev: decision models on trial": https://blogs.cisco.com/ai/jev-decision-models-on-trial
- TypeSafe Jev docs: https://docs.typesafe.ai/
- LangChain, "Building a harness with Jev": https://www.langchain.com/blog/building-a-harness-with-jev
- codebase-memory-mcp: https://github.com/DeusData/codebase-memory-mcp
