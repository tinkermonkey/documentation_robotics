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

Three corpora, gold labels from Opus 5.5 (high effort, full card context, with the design
charter in context since 2026-10-25; the pre-charter labels are kept as `gold@baseline`),
classifiers see a 40-line state card. Layer accuracy / end-to-end type accuracy against gold:

| corpus    | cards | clef          | clef-flash    | claude-sonnet | claude-haiku  |
| --------- | ----- | ------------- | ------------- | ------------- | ------------- |
| petclinic | 106   | 86.8% / 78.3% | 69.8% / 50.9% | 84.0% / 81.1% | 59.4% / 51.9% |
| fastapi   | 200   | 76.5% / 67.5% | 78.5% / 60.5% | 72.5% / 60.5% | 72.0% / 63.0% |
| dr-cli    | 300   | 77.3% / 53.0% | 60.3% / 46.7% | 77.7% / 66.7% | 59.0% / 50.7% |

Cost and latency per card: Clef about $0.001 and 650-700 ms median; Sonnet about $0.008 and
1.6 s; Haiku about $0.0005 and 1.6 s; Clef-flash about $0.0003 and 1.0-1.2 s.

What the numbers say:

- **Zero-shot Clef is at least as accurate as Sonnet on layer choice on all three corpora**
  (86.8 vs 84.0, 76.5 vs 72.5, 77.3 vs 77.7), at roughly a tenth of the cost and 2.4x the
  speed, with nothing but the spec's layer descriptions as criteria. Sonnet wins on end-to-end
  type accuracy on two of three (81.1 vs 78.3 on petclinic, 66.7 vs 53.0 on dr-cli); Clef
  wins it on fastapi (67.5 vs 60.5).
- **Clef's probabilities are underconfident but monotonic**, which is what a cascade needs:
  a layer threshold of 0.60 gives 92-97% precision on 36-41% of cards on every corpus, and
  0.50 gives 87-96% on about 65%. Sonnet's self-reported confidence is better calibrated on
  average (ECE 0.07-0.14) but discriminates less: on dr-cli precision only climbs from 79% at
  0.50 to 90% at 0.80, so there is no clean auto-accept band. Haiku's confidence is not usable
  as a gate.
- **Type selection is the weak link.** Given the correct layer, Clef picks the right element
  type 90% of the time on petclinic and 88% on fastapi but only 69% on dr-cli, where almost
  everything is `application` and the choice is among applicationfunction /
  applicationcomponent / applicationservice / dataobject (Sonnet manages 86% there). Those criteria are the node-schema
  descriptions, which are exactly the thin definitions Direction A is meant to fix.
  Type-given-layer accuracy is now the measurable target for the enrichment pass.
- **Systematic misses.** Clef recalled zero `technology` symbols on all three corpora
  (technology elements come from manifests and Dockerfiles, not code symbols, so symbol
  classification is the wrong extraction path for that layer). On dr-cli it sends borderline
  application code to `none` (22) or `data-model` (19); on fastapi it labels trivial UI helpers
  as `ux` (19). Sonnet errs the other way: it under-uses `none` (40% recall on fastapi, 51% on
  dr-cli, 73% on petclinic) and over-assigns `application`, `api` and `ux`. Haiku swings the
  opposite way on dr-cli, sending 55 application symbols to `none`.
- **"none" is a large class**: 30-48% of sampled symbols per corpus are not architecturally
  meaningful on their own. The significance score agrees with gold within one level on
  88-95% of cards for Clef.
- **Clef-flash is not a candidate on its own** (weaker layer accuracy except on fastapi, worse
  calibration); it may still serve as a cheap first gate once fine-tuned.

Implications: Tier 1 of the cascade is viable now with Clef at a 0.6 layer threshold; the
0.5-0.6 band and the rest escalate to Claude. The next experiments are the `none`-handling
variants, richer type criteria from the enrichment pass, and a non-symbol path for the
technology layer. Harness details and per-backend tables: `cli/scripts/classify-eval/data/*/report.md`.

## Phase 1 status (2026-10-25, updated 2026-10-28)

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
| dr-cli    | 68.5%                   | 78.9%            | 82.3%                             |
| fastapi   | 88.2%                   | 88.2%            | n/a                               |
| petclinic | 90.2%                   | 89.1%            | n/a                               |

Layer accuracy was unchanged (layer criteria did not change). Numbers above are against the
charter-labelled gold. Against the original gold the enriched definitions had looked useless
(70.5% to 71.3% on dr-cli): Clef had started calling classes components and methods functions,
which the old labels, with 20 TypeScript interfaces filed under data-model.objectschema,
disagreed with. The charter-labelled gold files those interfaces as application.dataobject, as
the enriched definitions do, and the same predictions score 68.5% to 78.9%, 82.3% with kind
narrowing. The gold labels are strongly driven by symbol kind (classes are components, methods
are functions, interfaces are data objects), Sonnet uses that signal (80-100% per kind), and
Clef did not until the candidate set was narrowed by kind.

**Finding:** two levers matter for element-type choice: definitions that state the boundary
between siblings (worth about 10 points once the gold is consistent with the charter), and the
classifier's use of structural facts the card already states. A Tier-0 narrowing of the
candidate set by symbol kind (`classify.ts --kind-narrow`, map in `backends/clef.ts`) is worth
another 3-4 points; the next steps are making the kind rule part of the question framing for every
layer, and treating `Module` separately (gold splits modules across five types). Richer
definitions remain valuable for the spec itself and for Claude-tier reasoning, and the
proposal `notes` surfaced real spec issues: `applicationcomponent.type` conflates ownership
with style, `applicationprocess` has no attributes for trigger/steps/outcome,
`applicationinterface.protocol` mixes protocols with styles, and `applicationinterface
depends-on applicationservice` duplicates `serves`.

**Triage of the maintainer notes (2026-10-25).** The 376 notes split into 1,462 atomic claims
(`split-notes.ts`, Sonnet, about $3). Each claim is decided by a backend (`triage.ts`): validity
(real defect / works as designed / judgment call / out of scope), category, severity, fix scope,
and two yes/no questions. A ten-claim benchmark with hand-verified gold (`bench-gold.jsonl`,
drafted by Claude, pending the user's review) compares configurations:

| configuration          | validity agreement | category | cost / claim |
| ---------------------- | ------------------ | -------- | ------------ |
| clef                   | 40%                | 90%      | $0.0005      |
| clef + evidence pack   | 70%                | 80%      | $0.0005      |
| claude-haiku           | 30%                | 100%     | $0.0002      |
| claude-sonnet          | 70%                | 80%      | $0.0049      |
| claude-sonnet + evid.  | 70%                | 90%      | $0.0053      |
| claude-opus + evidence | 80%                | 90%      | $0.0138      |

Categorising a claim is easy for every backend; deciding whether it is true is not, because
the answer lives in facts the state did not show (how siblings declare an attribute, the exact
relationships between two types). A deterministic evidence pack built from the schema sources
closed most of that gap for Clef at no extra cost, and is the pattern to keep: give the decision
model the facts, let it decide. Across all 1,462 claims, Clef with evidence flags 593 as real
defects (250 with severity 2 or above), 685 as judgment calls, 178 as working as designed. One
split claim ("self-relationship listed twice") was an artifact of the proposer prompt listing
outgoing and incoming relationships separately; the benchmark includes it.

**Design charter (2026-10-25).** `spec/DESIGN_CHARTER.md` now states what the spec is for,
what nodes and relationships model, and how to judge a change; triage prepends it by default.
On the ten-claim benchmark it raised every backend's mean probability on the gold answer and
exposed one gold-versus-charter inconsistency (the `api.operation realizes applicationfunction`
claim, re-adjudicated as a real defect in predicate choice once the layer-direction rule was
withdrawn). **It must not be prepended to the symbol-classification state:** Clef's layer
accuracy on dr-cli fell from 81.3% to 34.3% with it (`clef@enriched-v1-kind-charter`), the
charter's layer and relationship prose swamping the card. A one-paragraph summary of the charter
is less damaging (56.7%) but still pushes Clef toward `none`: its granularity sentence
("implementation details are not elements") moves 96 application symbols to `none` on dr-cli.
The Phase 0 gold was then re-labelled with the full charter in the labeler's context
(`gold@charter.jsonl`, Opus 5.5, about $25): layer agreement with the original gold is 89.3%
(dr-cli), 95.0% (fastapi) and 89.6% (petclinic), and only 6, 4 and 5 symbols respectively
moved to `none`. So the charter's granularity rule is not what Clef made of it: Opus reading
the same sentence kept the same granularity, and the Clef-with-charter variants score as badly
against the new gold (37% and 57% on dr-cli) as against the old. The charter stays out of
classification; the Phase 0 gold stands. The relabelling did settle one boundary the triage
found: with the charter, Opus moved 20 TypeScript interfaces on dr-cli from
`data-model.objectschema` to `application.dataobject` (in-code data structures are application
data objects; published schemas are data-model), which is the precedence rule claim
`application.dataobject#4` asked for. The charter-labelled set is the reference gold from 2026-10-25 (`gold.jsonl`; the
pre-charter labels are `gold@baseline.jsonl`); all tables in this document use it. For triage
the summary is the better choice: it matches evidence-only accuracy, raises mean probability on
the gold answer for Clef and Sonnet, and costs a fifth more than no charter, where the full text
cost one claim of accuracy. `--charter short` is now the triage default.

**Proposals complete (2026-10-25):** definitions for all 192 node types and descriptions
for all 1,611 relationships are in `cli/scripts/spec-enrich/data/proposals/` as reviewable
files (about $5 via the Batch API), not yet applied beyond the application layer. Every type
came back with maintainer notes; `data/notes-digest.md` collects them per layer.

**Reflection: the sorting questions (2026-10-26).** The benchmark's one unresolved claim,
`api.operation realizes applicationfunction`, was adjudicated by the user as a fair fit
(works_as_designed), and their reasoning became a pipeline stage: if an operation does not
realize a function, then what does? `triage-reflect.ts` asks Clef three sorting questions per
relationship claim before judging it (best source of `pred dst`, best destination of
`src pred`, best predicate between the pair, each over the current answer, the catalog's other
answers, siblings of the current answer and `none`), then appends the answers to the state and
asks the normal triage questions. Over all 755 relationship claims (about $1), plus a second
pass over the 405 further relationships that 313 of those claims also name (`--extra-triples`,
$0.52, decisions under `clef@reflect2`): of 1,160 reflections, 274 reproduced the current
triple, 174 found no better answer, 712 named a concrete alternative. `reflect-plan.ts` groups
the alternatives per catalog triple and classifies the implied change: 526 triples, of which 79
are duplicate removals (the preferred predicate already exists between the pair), 62 predicate
renames, 96 reversals, 164 retargets, 65 compound changes and 60 conflicts between claims;
184 clear p >= 0.6 and 108 clear p >= 0.7. The user reviewed the first-pass summary, found
nothing wrong in a spot check, and accepted the findings in principle; applying them is a
breaking spec change (renames, removals), so the plan is applied in tiers with a migration to
follow once the changeset settles. One finding was applied at once: `implements` and `realizes`
had the same meaning, so `implements` is retired (18 schemas, spec changelog). The
alternatives are coherent where a reviewer can check them: in the application layer
`delivers-value` to a service is answered with `realizes` (p 0.75-0.82) on every pair it
appears, `depends-on` a data object with `accesses` (0.76-0.86), and each aggregates/composes
duplicate with `composes` (0.78-0.86); in the api layer `parameter references tag` is answered
with `operation` as the source (0.68, OpenAPI has no parameter tags). Validity agreement with
evidence-only Clef is 69.9%; the moves are mostly between judgment_call and real_defect in both
directions (92 up, 69 down), so the stage changes decisions rather than merely sharpening
them, and the outcome bucket is the signal a reviewer should sort by. On the three benchmark
claims that name a relationship it fixes `accesscondition composes policyrule` (reverse:uses at
0.81, now real_defect as gold says), keeps the self-relationship false claim right, and calls
the operation/function claim a judgment call (no candidate beat `none` or the current triple),
one step from the user's works_as_designed. `reflect-summary.ts` writes the outcome-by-validity
table, the transitions and every alternative per layer
(`data/triage/reflect/summary-clef.md`).

**Applying the plan (2026-10-26).** `apply-reflect-plan.ts` applied tier 1 (duplicate removals
at p >= 0.6, reversals and renames at p >= 0.7: 86 schemas removed, 5 renamed, 2 reversals
resolved to existing schemas), and the maintainer walked the 18 application rows the plan could
not apply automatically, one at a time with the claim, the catalog state and the sorting answers
in view (`walk-application.jsonl`, applied by `apply-walk.ts`; 6 deleted, 7 renamed, 1 reversed,
1 added, 4 kept). Two lessons from the walk. The sorting question had never offered the ArchiMate
structural predicates, and three rows needed `assigned-to`; the candidate list now leads with the
ArchiMate 3.2 core relationships. And when two claims about one pair each prefer the other's
predicate, the plan files them as two rows, and tier 1 applied whichever row's replacement
already existed, which once kept the wrong twin (`applicationcomponent composes
applicationfunction` over `assigned-to`); conflicts between rows about the same pair should be
detected across rows, not only within one. The model migration (`dr upgrade`, table generated
from every `applied-*.json` record) treats retargets as drops, since an existing relationship
cannot be moved to a different element type mechanically.

**Context Studio as the review queue (2026-10-27).** Context Studio's Workbench Phase B
(tinkermonkey/context-studio#1351) imports the DR spec as one property definition per
relationship schema and adds a change-proposal model: agents propose, people accept or reject
in a review queue, scope (editorial / additive / breaking) is computed by the system and
breaking changes never auto-apply. Its issue #1366 imports DR plan rows as proposals and
exports decisions back as `walk-<layer>.jsonl`; Gate B (#1370) scores one DR layer walk in that
queue against the spreadsheet walk. The DR side is built: `proposal-export.ts --layer <id>`
writes `reflect/clef/proposals/<layer>.json` (format `dr-reflection-plan/1`: one operation per
plan row, delete / update / create on the relationship's property definition, with the claims
and the sorting answers as evidence and the plan's p as probability; rows already decided carry
their decision so a round trip can be checked), and `proposal-import.ts` reads a decided
proposal back into the walk file. The api layer is the fixture: 63 operations, 11 deletes and
52 updates.

Manual baseline for Gate B, from the application walk (2026-10-26): 18 rows in 3 h 54 min of
wall-clock (tier-1 commit 09:41 to walk commit 13:35, including building the walk tooling and
one row per conversational turn); every row followed the reviewer's recommendation, and in all
18 the final replacement differed from the plan's mechanical replacement (6 deletes, 5 renames,
2 retargets, 1 reversal, 4 keeps). Tier 1's 87 automatic changes had one wrong twin, found in
the walk (`applicationcomponent composes applicationfunction`, restored to `assigned-to`). Two
consequences for the review-queue design (#1359): a reviewer must be able to choose a different
replacement than the one proposed, or the proposal must carry alternatives, because accept /
reject alone would have rejected every one of these 18 rows; and conflicts between claims about
the same pair should be shown together, since the plan's split rows are how tier 1 kept the wrong
twin. The spreadsheet remains the interim queue (`sheet-export.py`, `sheet-import.py`).

**API and UX layers applied (2026-10-28).** The node proposals for all 27 api and all 22 ux
types were applied with `apply.ts --layer api --nodes-only` and `--layer ux --nodes-only`
(definitions with sibling distinctions, `x-dr-standard`, `x-dr-evidence`, `x-dr-distinguish`,
and 55 api plus 49 ux attribute descriptions filled where missing); the relationship proposals
for both layers were deliberately left out because the relationship schemas are being reworked
separately. The spec and the CLI bundle were rebuilt and Clef rerun on all three corpora as
`clef@enriched-v2`, with the kind rule as `clef@enriched-v2-kind`:

```bash
cd cli/scripts/spec-enrich
bun apply.ts --layer api --nodes-only && bun apply.ts --layer ux --nodes-only
cd ../../.. && npm run build:spec && (cd cli && npm run build)
cd cli/scripts/classify-eval
for c in fastapi petclinic dr-cli; do
  bun classify.ts --corpus $c --backend clef --tag enriched-v2 --force
  bun classify.ts --corpus $c --backend clef --tag enriched-v2-kind --kind-narrow --force
  bun report.ts --corpus $c
done
```

Type-given-layer as `report.ts` defines it (layer-correct cards, `none` included):

| corpus    | before (clef) | application only (enriched-v1) | api + ux applied (enriched-v2) | enriched-v2 + kind narrowing |
| --------- | ------------- | ------------------------------ | ------------------------------ | ---------------------------- |
| dr-cli    | 68.5%         | 78.9%                          | 78.0%                          | 83.2%                        |
| fastapi   | 88.2%         | 88.2%                          | 88.9%                          | 89.5%                        |
| petclinic | 90.2%         | 89.1%                          | 89.1%                          | 88.0%                        |

The same runs restricted to the layers the change touched, counting only cards whose gold
layer is not `none` and whose layer Clef got right (so the denominator is the cards on which
the element-type question was actually asked):

| corpus / layer       | cards | before (clef) | enriched-v1 | enriched-v2 | enriched-v2 + kind |
| -------------------- | ----- | ------------- | ----------- | ----------- | ------------------ |
| fastapi / ux         | 44    | 72.7%         | 72.7%       | 72.7%       | 72.7%              |
| fastapi / api        | 29    | 86.2%         | 86.2%       | 89.7%       | 89.7%              |
| petclinic / api      | 23    | 100%          | 100%        | 100%        | 100%               |
| dr-cli / application | 135   | 47.4%         | 65.2%       | 63.7%       | 72.6%              |

Reading the numbers:

- **The application result reproduces.** The application criteria did not change between
  enriched-v1 and enriched-v2, so the dr-cli movement (78.9% to 78.0% plain, 82.3% to 83.2%
  with kind narrowing; two cards of 135 each way) is Clef's run-to-run variance. Treat about
  one point as the noise floor for every table in this section.
- **api was close to saturated already.** PetClinic's 23 api cards were all right before and
  after. On fastapi the four misses were all route modules filed as `paths` instead of
  `pathitem`; with the new definitions they become three misses spread over `operation` and
  `tag`, one card gained. The kind rule has no entries for api or ux (`KIND_CANDIDATES` in
  `backends/clef.ts` covers application only), so the "+ kind" columns differ from the plain
  ones only through application cards.
- **ux did not move, but the errors changed shape.** Twelve of 44 ux cards are wrong under
  every configuration, not the same twelve. Before enrichment the misses were concrete versus
  reusable (`actioncomponent` to `librarycomponent` three times, `subview` to
  `librarycomponent`); after it they are placement versus definition (`librarysubview` to
  `subview` or `view`, `subview` to `view`). The gold tells those apart by facts of routing
  and reuse (is the component the target of a route; is it embedded in one parent or imported
  from several), which the new definitions state as the boundary and the state card does not
  surface as a fact. Same conclusion as for application: once the definition names the
  boundary, the classifier needs the structural fact, which is a Tier-0 rule for the card
  builder (routed or not, reused or placed once), not more prose.
- **Longer criteria flatten Clef's type confidence.** The criteria text per layer went from
  about 16K characters for application's 10 options to 39K for api's 28 and 36K for ux's 23.
  Accuracy held, but the mean element-type probability on layer-correct cards fell from 0.46
  to 0.12 on fastapi ux, 0.31 to 0.17 on fastapi api, 0.33 to 0.23 on PetClinic api, and
  0.25 to 0.13 on dr-cli application (0.09 without the kind rule). A type-level auto-accept
  threshold is therefore meaningless under the enriched criteria. The sibling sentences are
  what grew the text; the harness could send Clef the definition and evidence only and keep the
  "Use X instead when ..." sentences for `x-dr-distinguish` and for Claude-tier reasoning. That
  is a harness experiment, not a spec change, and it is the next thing to measure. Cost per
  card rose with the text: $0.0010 to $0.0017 on fastapi, $0.0009 to $0.0014 on PetClinic.

## Sequencing

| Phase | Deliverable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| 0     | **Eval harness.** Three corpora (this repo's `cli/`, the FastAPI full-stack template, Spring PetClinic). Claude via the Batch API produced gold labels for 606 symbol cards. `cli/scripts/classify-eval/` builds cards from CBM, labels them, runs classify backends (Clef, Clef-flash, Claude), and reports accuracy and calibration. Results: "Phase 0 results" above.                                                                                                                                                                                                                                                                                                                                                                         | done 2026-10-25              |
| 1     | **Spec enrichment pass** (Direction A, stages 1-3). Pipeline built; proposals generated for all 192 node types and 1,611 relationships; node enrichment applied to the application, api and ux layers (58 of 192 types; type-given-layer with kind narrowing on dr-cli 68.5% to 83.2%, fastapi 88.2% to 89.5%, petclinic 90.2% to 88.0%); 1,462 maintainer-note claims triaged, reflected and planned; relationship catalog cleaned (`implements`, `supports-goals`, `fulfills-requirements` retired; tier 1 and the application walk applied; 1,611 to 1,526 schemas) with the `dr upgrade` model migration; the other eleven layers' walks pending (spreadsheet now, Context Studio's review queue next, Gate B on api). See "Phase 1 status". | in progress (2026-10-28)     |
| 2     | **Cascade wiring.** Widen `spec/analyzers/cbm` to the rest of CBM's vocabulary; wire the tiers into `/dr-map` and `dr analyzer`. Mapping inventory (CBM labels and edges against the current mappings) in progress.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | preconditions met 2026-10-28 |
| 3     | **Fine-tuning** Clef on accumulated approved changesets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | planned                      |
| -     | Gap/overlap sweep and the classifiability loop (Direction A, stages 4-5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | after phase 1                |

Preconditions, both met on 2026-10-28: PR #961 (the analyzer honours the configured codebase
root; farm-mode use of the pipeline) is merged, and #963 (`dr delete` leaves dangling
relationship rows; nothing automated may delete elements until fixed) is fixed by PR #976, which
also added `dr relationship prune` for models that already carry orphans.

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

- 2026-10-25: adopted `spec/DESIGN_CHARTER.md` and withdrew the layer-direction rule. The rule
  turned out to be two contradictory conventions (reference validator: motivation → testing;
  relationship catalog: implementation → intent) with no design record; direction now follows the
  predicate, and the reference validator's direction check was removed. Triage prepends the charter
  by default; classification can with `--charter`.
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
