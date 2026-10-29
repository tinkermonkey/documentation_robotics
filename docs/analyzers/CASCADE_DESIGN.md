# Classification cascade: production design (draft, 2026-10-29)

Status: **draft for maintainer review**. Phase 2 of [EXTRACTION_STRATEGY.md](../EXTRACTION_STRATEGY.md)
moves the classification cascade measured in `cli/scripts/classify-eval/` into the CLI. This
document fixes the shape of that move before the mapping work gets ahead of it: which pieces
exist, where each one lives, what it reads and writes, and which decisions are still open.
[CBM_MAPPING_INVENTORY.md](CBM_MAPPING_INVENTORY.md) is the companion list of what the mapping
covers.

## The pipeline in one paragraph

`dr analyzer classify` reads the codebase-memory-mcp (CBM) graph, builds one _card_ per
candidate symbol, and runs three tiers over the cards. Tier 0 applies deterministic rules from
`spec/analyzers/cbm/extraction-heuristics.json`: a rule either decides the element type outright
or narrows the choices. Tier 1 asks a decision model (Clef today, Jev when a key is available) the
remaining questions and gets calibrated probabilities. Cards above the acceptance threshold become
proposed elements, cards in the middle band go to Tier 2, the rest are dropped. Tier 2 is Claude:
it decides the escalated cards, names and describes every accepted element, and infers the
business, motivation and product layers that code symbols cannot show. Edges between accepted
elements are mapped from `edge-mapping.json`. The output is a changeset, never a direct write to
the model.

## What exists on 2026-10-29

| Piece                            | Where                                                                   | State                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Node, edge and heuristic mapping | `spec/analyzers/cbm/*.json`, compiled to `spec/dist/analyzers/cbm.json` | Made truthful (inventory step 1); `Interface` family mapped (step 2); `DEFINES_METHOD`, `IMPORTS` mapped (step 3)                              |
| Tier-0 rule engine               | `cli/src/analyzers/tier0-rules.ts`                                      | Built, unit-tested; 17 rules as data in `extraction-heuristics.json` (inventory steps 2 and 4); measured in the strategy doc's Phase 2 results |
| Catalog guard                    | `cli/tests/unit/analyzers/cbm-mapping-catalog.test.ts`                  | Every mapped type and every relationship-creating edge must exist in the catalog; every CBM label is mapped or listed                          |
| Card builder                     | `cli/scripts/classify-eval/cards.ts`, `facts.ts`                        | Harness only (bun script, sampled cards)                                                                                                       |
| Tier-1 questions and Clef client | `cli/scripts/classify-eval/backends/clef.ts`, `lib/spec.ts`             | Harness only                                                                                                                                   |
| Tier 2, edge mapping, changeset  | none                                                                    | Not built                                                                                                                                      |

## Components

### 1. Card builder (`cli/src/analyzers/cards/`)

Ports `cards.ts` and `facts.ts` from the harness, with three changes.

- **Every candidate, not a sample.** Candidates are the symbols whose CBM label has a node mapping,
  minus the analyzer's `filtering_rules` (test code is a separate pass, inventory step 7).
- **Bulk graph reads.** One Cypher pull per edge type into an in-memory adjacency index (the
  harness's `buildEdgeIndex`), because per-symbol `trace_path` calls do not scale (about 100 ms per
  bulk pull versus seconds per symbol).
- **A stable card.** The card is a typed record (the harness's `CardSchema` plus `Facts`) with a
  `card_version`. Its rendered state is a pure function of the card, so the same symbol at the same
  commit yields byte-identical text, which is what makes probabilities comparable across runs.

The card carries raw CBM fields (signature, docstring, decorators, base classes, callers, callees,
imports, env vars, routes, HTTP calls) and derived facts: decorator names, how many other files
import the symbol's file, how many use the symbol, method count, and _placement_, the
framework-convention location of the file (shared UI library, file-based routing directory,
generated code, test code). Placement and decorators are what the ux and Spring/FastAPI results
showed the classifier cannot infer reliably from source text alone. Measured on 2026-10-29, these
facts help when Tier 0 turns them into decisions or narrowings and do nothing when they are only
rendered into the state, so the card carries them mainly for the rules, for Tier 2, and for review.

### 2. Tier 0: rules (`cli/src/analyzers/tier0-rules.ts`)

Built. A rule is a heuristic whose `parameters.tier0` names CBM labels, `when` conditions (regular
expressions over decorator names, the declaration line, the file path and the symbol name) and
either `decide` (`none` or `layer.type`) or `narrow` (a list of `layer.type` or `layer.*`). First
match wins. A decided card costs nothing and skips Tier 1; a narrowed card goes to Tier 1 with only
those layers and types offered (plus `none`).

The existing kind rule (`KIND_CANDIDATES` in the harness's Clef backend: classes to structural
types, methods to behavioural types within the application layer) is the same idea expressed in
code; it moves into the rule file as per-label narrowing when the card builder is ported.

Rules encode framework conventions (a `@GetMapping` method is an operation; a `table=True`
SQLModel class is a table), not patterns read off one corpus. The catalog guard test fails the
build if a rule names a type the spec does not have.

### 3. Tier 1: decision model (`cli/src/analyzers/classifier/`)

- **Backend interface.** `DecisionBackend.ask(state, questions) -> answers with probabilities`.
  Clef over the Workers AI REST API first (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`), Jev
  when a TypeSafe key is available. Both take the same request shape.
- **Questions.** Stage 1: layer (choice), significance (score), six concern flags (yes/no). Stage 2:
  element type within the chosen layer (choice). Criteria text comes from `spec/dist`: the layer
  definitions, and per type the definition plus its evidence lines. Whether the sibling sentences
  ("Use X instead when ...") belong in the criteria was measured on 2026-10-29: without them type
  confidence rises (0.42 to 0.51 on dr-cli) but dr-cli type accuracy falls 3.5 points, so they stay
  for now; they also go to Tier 2 from `x-dr-distinguish`.
- **The question set is versioned** (`qset` id in the output), like a model. Changing a question's
  wording, the criteria mode or the rule file is a new version.
- **Bands.** Accept when the layer probability is at least 0.6 (Phase 0: 92-97% precision on
  36-41% of cards), escalate between 0.5 and 0.6, drop below 0.5 unless a concern flag fires.
  Thresholds are per question-set version and re-fit on held-out labels when the version changes.
  A type-level threshold is not usable with the current enriched criteria (mean type probability
  fell to 0.12-0.23); revisit once the criteria experiment settles.

### 4. Tier 2: Claude (`cli/src/analyzers/classifier/claude.ts`)

Messages API with the Batch API for bulk runs and prompt caching for the spec reference; not the
`claude` CLI shell-out the audit uses. Three jobs, each its own prompt:

1. **Decide escalated cards**, given the card, the Tier-1 probabilities and the full criteria
   including the sibling distinctions.
2. **Name and describe** every accepted element (kebab-case id fragment, name, one-sentence
   description), in batches grouped by file so related symbols are named consistently.
3. **Infer the upper layers** (business, motivation, product) from the accepted lower-layer
   elements and the repository's README and docs, with the evidence each inference rests on.

### 5. Edges

After nodes are accepted, each CBM edge between two accepted elements is looked up, not
hard-coded: its mapping lists the predicates that can express it in order of preference
(`conditions.predicates`, each optionally inverted), and the relationship is the first catalog
triple that exists between the two element types (`cli/src/analyzers/edge-relationships.ts`). A
call from an application process to a function becomes `depends-on`; a call from a service to a
data object becomes `accesses`; a function using an entity class becomes `data-model.objectschema
serves` the function, the catalog's provider-to-consumer reading. One predicate per edge type did
not work: with gold types on both ends, only 18 of the edges between labelled cards fitted the
single mapped triple, against 77 of 191 with the lookup (strategy doc, Phase 2 results).

All 48 CBM edge types are accounted for: 17 create relationships (`CALLS`, `HANDLES`,
`DEFINES_METHOD`, `IMPORTS`, `CALL_REFERENCE`, `DATA_FLOWS`, `USAGE`, `WRITES`, `IMPLEMENTS`,
`TESTS`, `TESTS_FILE`, `ASYNC_CALLS`, `LISTENS_ON`, `SPAWNS`, `DEPENDS_ON`, `INFRA_MAPS`, `DEPLOYS`),
and every traversal-only edge says why, including the catalog addition it waits on. Eleven
additions (`specializes` for `INHERITS` and `OVERRIDE`, `triggers` for `EMITS` and `ASYNC_CALLS`,
`consumes` for `HTTP_CALLS` and its siblings, and the interface, composition and infrastructure
gaps) are create proposals for Context Studio's review queue
(`cli/scripts/spec-enrich/catalog-additions.ts`); the lookup picks them up as soon as they are in the
catalog, with no mapping change.

Some pairs are linked through an intermediate element by design, and a CBM edge between them implies
that element: a view importing a library component means a `ux.componentinstance` the view renders
and that realizes the component; an operation using an object schema goes through its request body
or response. These _two-hop_ cases are a card-builder rule still to write, not catalog gaps.

### 6. Output and changesets

A run writes `documentation-robotics/.analyzer/classify/<run-id>/`:

- `cards.jsonl` (the cards and their rendered-state hash),
- `decisions.jsonl` (per card: tier, rule or question-set version, layer, type, probabilities,
  band),
- `summary.json` (counts per tier and band, cost, spec version, CBM version, model ids).

`--changeset <name>` stages the accepted elements and relationships into a changeset through the
existing staging area (`StagingAreaManager`), with each element's `source_reference` taken from the
card (file from `DEFINES`, symbol, line range). The base model is never written directly; review
and apply are the existing `dr changeset` flow.

### 7. Determinism, caching and drift

Each decision is keyed by `(rendered-state hash, qset, spec version, model id)` and cached under
`.analyzer/cache/`. A rerun at a new commit only asks about cards whose hash changed. `dr farm sync`
and `dr verify` compare a symbol's decision across runs: a changed layer or type, or a probability
moving across a band boundary, is drift worth reporting; a change in the last digit is not.

### 8. `/dr-map` and `/dr-sync`

The skills keep their role as the conversational front end. Step 3 of `/dr-map`, which today
collects `dr analyzer endpoints/services/datastores` pre-briefs, calls `dr analyzer classify --json`
instead and treats accepted elements as given, so Claude Code spends its effort on the escalated
band, naming review and the upper layers. `/dr-sync` uses the cache to classify only changed
symbols.

### 9. Learning from review

Every element a reviewer accepts, edits or rejects in a changeset is a labelled card. Those labels,
and Context Studio's review-queue decisions on the spec itself, are the training set for Phase 3
(fine-tuning Clef) and the held-out set for re-fitting thresholds.

## Cost (from the harness, per card)

| Path                    | Cost     | Latency (median) |
| ----------------------- | -------- | ---------------- |
| Tier 0 decided          | $0       | 0                |
| Tier 1 Clef, two stages | ~$0.0015 | ~0.7-1.3 s       |
| Tier 2 Sonnet, per card | ~$0.008  | ~1.6 s           |

A 3,000-symbol repository with a quarter of its cards decided by rules and a tenth escalated
costs on the order of $3 in Clef plus $2-3 in Claude, before naming and upper-layer inference.

## Decisions (maintainer, 2026-10-29)

1. **Sending code to a third-party model is opt-in per project.** Without a configured
   decision-model backend, `dr analyzer classify` runs Tier 0 only and escalates everything else.
   Enabling a backend is an explicit project setting that names the provider which will receive
   card text, and the command says so when it runs. Cloudflare credentials in the environment are
   not enough on their own.
2. **The question set lives in code** (`cli/src/analyzers/classifier/`) with a version id recorded
   in every decision. The questions are generic to DR rather than to CBM, they are coupled to the
   backend's request shape, and thresholds are fitted per version; the spec stays model-agnostic.
3. **One new command, `dr analyzer classify`**, with `--tier0-only`, `--changeset <name>` and
   `--json`. `/dr-map` Step 3 calls it instead of collecting `endpoints`, `services` and
   `datastores` pre-briefs; those commands stay as they are.
4. **Phase 2 maps every CBM edge the catalog can hold.** The edges whose triples exist are mapped
   on this branch (inventory steps 5 to 7). The ten catalog additions the remaining edges need go
   to Context Studio's review queue as create proposals, and their edges are mapped once accepted.

## Later: CBM capabilities beyond the mapping

Not in this work set, recorded so they are not lost: `get_architecture` clusters (component
boundaries and `Module` handling), `detect_changes` (incremental `/dr-sync`), the cross-repository
edges (`CROSS_HTTP_CALLS` and siblings, which correspond to DR's `@model/...` references),
similarity edges (duplicate detection), documentation `Section` and `MENTIONS` edges (evidence for
Tier 2's upper layers), and the infrastructure pass (`Resource`, `Image`, `Chart`; needs a corpus
with manifests and a re-index).

## Build order

1. Port the card builder and facts into `cli/src/analyzers/cards/`, with the harness switched to
   import it, so harness numbers keep measuring production code.
2. `dr analyzer classify --tier0-only --json`: cards plus rule decisions, no network.
3. Clef backend and Tier-1 bands behind the per-project opt-in (decision 1).
4. Changeset staging and the three mapped edges.
5. Tier 2 (escalation, naming, upper layers) and the `/dr-map` switch.
6. Cache and drift comparison for `dr farm sync` and `dr verify`.
