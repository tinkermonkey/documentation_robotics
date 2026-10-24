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

## Sequencing

| Phase | Deliverable                                                                                                                                                                                                                                                                                                                                 | Status                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 0     | **Eval harness.** Three corpora (this repo's `cli/`, a cli-validation project, one framework-heavy OSS app). Claude via the Batch API produces gold labels for ~500 symbol cards. `cli/scripts/classify-eval/` builds cards from CBM, labels them, runs classify backends (Clef, Clef-flash, Claude), and reports accuracy and calibration. | in progress (2026-10-24) |
| 1     | **Spec enrichment pass** (Direction A, stages 1-3), because its definitions are literally the classifier criteria.                                                                                                                                                                                                                          | planned                  |
| 2     | **Cascade wiring.** Widen `spec/analyzers/cbm` to the rest of CBM's vocabulary; wire the tiers into `/dr-map` and `dr analyzer`.                                                                                                                                                                                                            | planned                  |
| 3     | **Fine-tuning** Clef on accumulated approved changesets.                                                                                                                                                                                                                                                                                    | planned                  |
| -     | Gap/overlap sweep and the classifiability loop (Direction A, stages 4-5).                                                                                                                                                                                                                                                                   | after phase 1            |

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
