# Assessment pass: design options and experiments

Status: **experiments under way** (2026-11-20). This page sets out the candidate designs for a
stage that runs after extraction's existing tiers and asks whether the model it produced is
complete, and the experiments that would show which designs earn a place. It is an experiment
design, not a build plan: the stage that wins gets planned as a changeset when the experiments
have picked it.

Results so far are in [SELF_ASSESSMENT_RESULTS.md](SELF_ASSESSMENT_RESULTS.md): the ledger and
the free finders are built (`cli/scripts/assess-eval/`) and experiments 1 and 3 have run, apart
from experiment 1's control. The headline: the ledger raises the right question every time, and
the free finders answer little of it between layers, so the model-call strategies below carry
more of the work than this page first assumed.

## What this is for

Extraction today is Tier 0 (rules), Tier 1 (a decision model, opt-in) and Tier 2 (the calling
agent places the cards the tiers left open). Nothing afterwards looks at the model as a whole.
The maintainer has been doing that by hand, with one question to the agent: "There are no
connections between the data model layer and the data store layer, is that expected?" That
question reliably produces an accurate review and real corrections.

The assessment pass makes that question a standard step. It has three jobs:

1. Find where the model is thinner than the code and the spec say it should be: missing
   relationships, missing elements, missing layers.
2. Tell a real gap from an absence that is correct for this codebase, and record which it was.
3. Do it within a stated token budget.

## What the existing models show

Measured on 2026-11-20 from the local checkouts, against the bundled spec 0.14.0 (194 node types,
1,004 relationship types, 393 of them between layers, linking 70 of the 78 layer pairs). No model
calls. "Instantiable" means the model has at least one element of each end type.

| Model          | Elements | Relationships | Layers | Linked layer pairs, both populated | of which empty | Cross-layer types instantiable | of which unused | Unwired entries per element |
| -------------- | -------- | ------------- | ------ | ---------------------------------- | -------------- | ------------------------------ | --------------- | --------------------------- |
| viewer         | 1,124    | 1,567         | 13     | 70                                 | 33             | 228                            | 163             | 25.9                        |
| context-studio | 1,313    | 2,807         | 13     | 70                                 | 31             | 180                            | 101             | 10.9                        |
| heimdall       | 131      | 185           | 9      | 33                                 | 25             | 56                             | 43              | 9.0                         |
| stagecraft     | 1,970    | 623           | 4      | 6                                  | 3              | 12                             | 5               | 6.9                         |

What follows from it:

- **The maintainer's question falls out of a table lookup.** In the viewer model, data-model
  (28 elements) and data-store (8) have two instantiable relationship types between them and no
  relationships. So does every other empty pair: 33 in the viewer. Finding the questions costs
  nothing. Answering them is the work.
- **Most empty pairs are probably correct absences.** `apm ~ ux` and `motivation ~ navigation`
  are empty in the viewer too. A stage that treats every empty pair as a gap will be mostly wrong,
  so "expected, and here is why" has to be a first-class answer.
- **Half of the cross-layer catalog cannot come from the code graph as mapped today.** Of the 393
  cross-layer relationship types, a mapped CBM edge can produce 183. None can produce `maps-to`
  (23 types), `satisfies` (70), `monitors` (32) or `requires` (14). The data-model to data-store
  example is this case: both `objectschema maps-to collection` and `schemadefinition maps-to
collection` have no edge route, so extraction creates the schemas and the tables and can never
  link them. That is a blind spot in the pipeline, not a judgement the agent got wrong, and the
  fix belongs in the mapping, once, not in each model.
- **Element-level gaps are far too many to read.** The viewer has 29,139 unwired entries whose
  other type exists in the model. Anything a language model reads must be at layer-pair level
  (at most 70 rows) or type level (a few hundred rows).
- **A fresh bootstrap and a curated model have different gaps.** Stagecraft, which is close to raw
  pipeline output, has 9 absent layers and 1,564 of its 1,970 elements with no relationship at all
  (mostly test cases). Its pair table has 6 rows. The curated models have every layer and long pair
  and type tables. A strategy has to be measured at both stages.
- **Peer patterns are already there to use.** Context Studio's model has 36 relationship patterns
  that at least 80% of a type's elements follow, leaving 141 elements that don't (8 operations
  lack the `composes responses` that 95% of operations have). The viewer has 6 patterns and 15
  outliers. The brief's peer-pattern check finds these today, but only for elements a changeset
  touches.

One limit on these numbers: the models are whatever the local checkouts held that day. The
harness reproduces the table (`cli/scripts/assess-eval/ledger.ts`).

## The shared contract

Every strategy below reads the same input and writes the same output, so they can be compared and
combined.

**The gap ledger.** A deterministic table computed from the model, the catalog and the edge
mapping, at three levels:

- pair rows: each catalog-linked layer pair, with its state (a layer absent, empty, thin,
  populated), counts per side and the instantiable types;
- type rows: each instantiable cross-layer relationship type the model does not use, or uses for
  under a fifth of the source type's elements, marked reachable or not by a mapped edge;
- element rows: unwired entries, computed on demand for one type row, never listed whole.

**A finding.** One row of output: the ledger row it answers, a verdict, the evidence (code
location, CBM path, peer count, document section), the proposed change, and what it cost. The
verdicts:

| Verdict           | Meaning                                               | Goes to                                 |
| ----------------- | ----------------------------------------------------- | --------------------------------------- |
| `wire`            | both ends exist, the relationship is missing          | staged relationship                     |
| `add`             | an element is missing, with its relationships         | staged element and relationships        |
| `expected-absent` | the absence is correct for this codebase, with reason | accepted gap                            |
| `blind-spot`      | the pipeline cannot see this class of link            | candidate mapping or Tier-0 rule issue  |
| `spec-gap`        | the code shows a link the catalog has no type for     | Context Studio proposal                 |
| `unsure`          | evidence does not settle it                           | a question to the person, in their form |

**The budget rule.** A run takes a token budget. Free checks run first. Model calls are spent in
ledger rank order until the budget ends. A row the budget did not reach is reported as "not
assessed" and never dropped silently. Every pair and type row ends in exactly one state, and the
share of rows decided is the pass's completion number.

**Staging.** Findings stage into a changeset with their strategy as origin, as Tier 0 and Tier 1
decisions do. Nothing lands without review.

## Strategies

S1 to S3 are the three from the request. S4 to S7 are additions.

### S1. Layer-pair review

The maintainer's question, asked for every pair. Variants, cheapest first:

- **S1-matrix.** One call. Input: the pair rows (about 120 tokens each: the two layers' type
  counts, the instantiable types with their one-sentence descriptions) and a few stack facts from
  the index (languages, frameworks, whether there are tables, routes, tests). Output: per empty or
  thin pair, expected or not, the relationship types that should exist, and the reason. About 12k
  tokens in and 3k out for a 13-layer model. It ranks; it does not fix.
- **S1-agent.** One agent investigation per pair that S1-matrix marks expected, with model and
  index tools. Estimated 20k to 50k tokens a pair, so it runs on the top few.
- **S1-generic.** The literal standing prompt ("review each layer, check it has the connections
  it should, say whether each absence is accurate or a gap") given to the agent with tools. This is
  today's manual practice and the control for every experiment. Its cost is not known and is the
  first thing to measure: reading a 1,100-element model once is about 45k tokens before any
  thinking.
- **S1-prior.** No model call. The share of other models in the farm, with both layers populated,
  that link the pair. Four models is thin evidence; it grows as more repositories get models.

Finds: missing links between layers, absent layers. Blind to: gaps inside a populated pair.
Risk: Claude models under-use "none" (Phase 0: Sonnet over-assigned on every corpus), so the
false-alarm rate on correct absences is the number to watch.

### S2. Connection probe per type

For each type row, go and look for the connection in the code. Five mechanisms, the first four
free:

- **Edge probe.** For a reachable type: CBM edges between the symbols of existing elements of the
  two types (1,062 of the viewer's 1,124 elements carry a source reference). An edge with no
  relationship is a `wire` candidate. No edge anywhere is evidence the absence is real.
- **Frontier probe.** Edges from a modelled symbol to an unmodelled one whose card could take the
  other end's type. This is how the probe finds missing nodes: the other end exists in the code
  and not in the model. It reads extraction's record first, since the symbol may be a card Tier 1
  hid or the agent passed over.
- **Path probe.** Extraction links only directly connected symbols. Many architecture links run
  through code that is rightly not an element (view, hook, client, HTTP call, route). A path of
  a few hops between two modelled symbols, through unmodelled ones, is a candidate with the path as
  evidence.
- **Name join.** For types no edge reaches but whose ends share an identifier: an ORM class's table
  name against a `Table` node, a route's component against a view. Each join is a rule kept as
  data, like the Tier-0 rules. A join that proves itself here moves into extraction.
- **Evidence probe (model call).** For the rest (80 of the viewer's 163 unused types): grouped by
  source type, the model gets the type rows, the relationship descriptions and prefetched
  candidates, and judges. Only 82 of 1,004 relationship types carry an `evidence` sentence today,
  so the probe needs a search template per predicate; there are 23 cross-layer predicates. With
  evidence prefetched, about 300 tokens a row; if an agent has to search, 3k to 5k a row.

Finds: missing relationships, missing elements, and blind spots (a type the name join or the
path probe fills on every model is a mapping rule waiting to be written). Blind to: the intent
layers, where 87 of 120 cross-layer types have no edge route and there is rarely an identifier to join on.

### S3. Review question bank

The questions an architect asks in a review, kept as data. Each has a scope (model, layer or
type), a precondition read from the ledger so it is asked only where it applies, a deterministic
check where one exists, and a model call only when the check fires. Examples:

| Question                                                      | Check                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| What realizes each API operation?                             | operations with no `realizes applicationfunction`       |
| Where is each stored collection's schema?                     | collections with no incoming `maps-to`                  |
| Which external systems does this call, and are they modelled? | external hosts in the index against technology elements |
| How does a request get authenticated?                         | security layer present; operations with no `protects`   |
| What follows data from a view to storage?                     | a trace from each view reaches a collection             |
| What is not tested?                                           | components with no `tests` or `covers`                  |
| What does each service exist for?                             | the brief's intent trace, run over the whole model      |

The first source for the bank is already written: the "Modelling rules" paragraph in each of the
13 layer files states which type plays which role and which predicate carries each link. About 30
questions is the starting size. Free where the check is deterministic; about 4k tokens for each
question that fires and needs a judgement.

Finds: violations of known-important patterns, including chains that no pair or type row can
express. Blind to: anything nobody wrote a question for. Its precision should be the highest of
the three and its coverage the narrowest.

### S4. Peer and fleet patterns

The brief's peer-pattern check, run over the whole model instead of a changeset's elements: where
at least 80% of a type's elements have a relationship shape, the rest are candidates. Free. It
needs populated patterns, so it works on what S1 cannot see (gaps inside a populated pair) and
finds nothing in an empty one. The fleet version is S1-prior.

### S5. Scenario threads

Pick a sample of entry points (routes, views, commands), take each one's call chain from CBM,
and lay it over the model through source references. Where the chain leaves the model at a
significant symbol, an element may be missing. Where two modelled elements are adjacent on the
chain with no relationship path between them, a link may be. Free, apart from judging whether an
unmodelled symbol matters, and Tier 1's cached significance score answers that when Tier 1 is on.
It overlaps S2's path probe; the difference is that S2 is exhaustive per type and S5 samples
vertical slices. The experiments will say whether both are needed.

### S6. Code-side residual

Everything above starts from the model. This starts from the code: unmodelled symbols ranked by
centrality in the index (fan-in, route handlers, tables, external hosts, environment variables).
The top of the list is the missing-element candidates. Free. It checks what the not-element band
and the agent left behind.

### S7. Documentation sketch

An agent reads only the README, the ADRs and the doc sections CBM indexes, and writes what it
expects the system to contain: which layers apply, the stores, the external systems, the main
flows, who it is for. The sketch is compared with the model at layer and type level. About 20k
to 40k tokens, once per model. It is the only strategy with something to say about absent layers
on a fresh bootstrap and about the intent layers.

### Considered and left out

- **A second model's agreement as a gate.** Measured for Tier 1 on 2026-11-16: Haiku agreement
  with Clef, Haiku self-agreement and self-reported confidence were all useless as gates.
- **Competency questions as a stage** ("what stores X?" answered from the model and from the
  code). Kept as a measure instead, below.

### At a glance

| Strategy                | Finds                          | Model tokens per model (estimate) | Works on a fresh bootstrap | Blind to                     |
| ----------------------- | ------------------------------ | --------------------------------- | -------------------------- | ---------------------------- |
| Ledger                  | where to look                  | 0                                 | yes                        | whether a gap is real        |
| S1-matrix               | expected links between layers  | 15k                               | few rows                   | gaps inside a populated pair |
| S1-generic (control)    | whatever the agent notices     | unknown, likely 300k or more      | yes                        | not known                    |
| S2 free probes          | links, elements, blind spots   | 0                                 | yes                        | intent layers                |
| S2 evidence probe       | links no edge reaches          | 30k prefetched, 300k searched     | yes                        | intent layers                |
| S3 question bank        | broken known patterns          | 0 to 100k                         | yes                        | unwritten questions          |
| S4 peer patterns        | outliers in populated patterns | 0                                 | no                         | empty pairs                  |
| S5 scenario threads     | breaks along real flows        | 0 to 20k                          | yes                        | code no entry point reaches  |
| S6 code-side residual   | missing elements               | 0                                 | yes                        | relationships                |
| S7 documentation sketch | absent layers, intent layers   | 20k to 40k                        | yes                        | undocumented systems         |

The estimates come from row counts and are to be replaced by measurements in experiment 1.

## Combining them

The strategies are complementary by construction: S1 sees empty pairs and S4 sees populated
ones; S2 starts from the model and S6 from the code; S3 knows what matters and the ledger knows
what is there. The proposed weave, in cost order, each step narrowing the next:

1. **Ledger.** Free.
2. **Free finders:** S2's three probes and name joins, S4, S6, S5, S3's deterministic checks.
   Their findings close ledger rows before any model reads them. A reachable type with no edge
   anywhere becomes a cheap `expected-absent`.
3. **One triage call:** S1-matrix over the pair rows still open, with S1-prior and what step 2
   found as context. It decides which pairs are expected and ranks the type rows under them.
4. **Targeted model calls, to the budget:** S2's evidence probe and S3's fired questions on the
   ranked rows; S7 when layers are absent or the intent layers are thin.
5. **Close.** Every row has a state. The person gets the `unsure` rows as a short list of
   questions in the form they have been asking by hand.
6. **Feed back.** A `blind-spot` that recurs across models becomes a mapping rule; a recurring
   `expected-absent` reason becomes a rule that answers the row for free next time; a `spec-gap`
   goes to Context Studio.

Step 6 is what keeps the budget falling: each model assessed should make the next one cheaper.

## Experiments

### Why this needs its own measures

The eval harness has gold labels for node types and none for relationships, so there is nothing
to score a gap-finder against yet. Four measures stand in, each with a known weakness.

- **M1, seeded gaps.** Take a curated model, remove relationships and elements that are known to
  belong (they are in the reviewed model), run a strategy, count what it recovers. Removals are
  stratified: a whole layer pair emptied (the maintainer's question, reproduced), one relationship
  type emptied, a random tenth of one type's links, elements removed with their links; each split
  by reachable and not. Automatic and repeatable. Weakness: a hole cut in a rich model is easier to
  see than a natural gap, which flatters S4, so half the runs remove 50% of a stratum.
- **M2, pooled adjudication.** On a fresh bootstrap, run every strategy from the same starting
  model, pool the distinct findings, and have each judged once, blind to its source, by Opus at
  high effort with the code in view. The maintainer judges a random 50 and every `unsure`. Per
  strategy this gives precision, valid findings, valid findings no other strategy made, and share
  of the pool. Weakness: recall is relative to the pool, and the judge shares a model family with
  the strategies, which is what the maintainer's sample is for.
- **M3, the pair and type labels.** The 64 empty pairs of the viewer and Context Studio models,
  each labelled expected-absent or gap by the maintainer. An hour's work, and the only direct
  gold for the question as asked. The 264 unused types of the same two models, labelled by the
  M2 judge with a maintainer sample.
- **M4, structure, free.** Share of ledger rows decided; empty pairs; elements with no
  relationship; share of elements that reach an intent element; and reachability agreement: for
  sampled pairs of modelled elements the code connects within a few hops, whether the model
  connects them too. Weakness: all of these rise if a strategy wires things wrongly, so they are
  read only beside M2's precision.

Cost is recorded for every run: tokens in and out, dollars, wall time, tool calls.

The conversations where the manual question was asked would be a fifth measure (did the stage
raise the same question, and cover what changed afterwards). They are not in the session
transcripts searched on 2026-11-20, so that set starts empty and grows as the maintainer reviews
models.

### The runs

Harness under `cli/scripts/assess-eval/`, beside `classify-eval`, not a `dr` command until the
numbers justify one. Model-call arms get three takes; one take is a lead, not a result. The
decision rule for each is fixed before its first paid run.

| #   | Experiment                                                                                                            | Measures | Model spend                      | Answers                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------- | --------------------------------------------------------------- |
| 1   | Ledger and baselines on the four models and one fresh bootstrap; S1-generic once on two models for its cost           | M4, cost | the control runs only            | What does today's manual practice cost? How big is each ledger? |
| 2   | Maintainer labels the 64 empty pairs                                                                                  | M3       | none                             | What share of empty pairs are real gaps?                        |
| 3   | Free finders (S2 probes and joins, S4, S5, S6, S3 checks) on seeded gaps                                              | M1, M4   | none                             | How much is found before any model call, per stratum?           |
| 4   | S1 variants: matrix, matrix with prior, generic                                                                       | M3, M1   | small, except the control        | Does one cheap call match the agent on pair verdicts?           |
| 5   | S2 evidence probe, prefetched against searched, on the rows experiment 3 left open                                    | M1, M3   | moderate                         | Is prefetching enough, or does the probe need an agent?         |
| 6   | S3 bank of about 30 questions from the layer rules                                                                    | M1, M3   | small                            | Fire rate, precision, overlap with S1 and S2                    |
| 7   | Every strategy on three fresh bootstraps, pooled and judged; combinations computed from the pool with no further runs | M2, cost | the judge: about $0.10 a finding | Which strategies earn a place; the cost curve of adding each    |
| 8   | The best two weaves from 7, run end to end, against S1-generic                                                        | M2, M4   | moderate                         | Does the weave beat the manual prompt at lower cost?            |
| 9   | S7 on the fresh bootstraps                                                                                            | M2       | small                            | Does a documentation sketch recover absent and intent layers?   |

Experiments 1 to 3 need no model spend beyond the two control runs and settle the most: if the
free finders recover most seeded gaps, the model calls only have to handle what is left. They
do not (results, section 2): between layers they name the removed relationship in 0% to 16% of
cases. Experiments 4 to 6 are therefore where the stage's value will be decided.

The combination question is answered in experiment 7 from one set of runs. Because every finding
is keyed to a ledger row and judged once, the value of any subset of strategies is a set union
over the pool: valid findings, precision and cost for each subset, and a greedy curve of valid
findings against cumulative tokens. Only the order-dependent effect (an S1 verdict unlocking S2
on that pair) needs the chained runs of experiment 8.

The judge's price is from the labelling harness, which measured about $0.10 a card for Opus at
high effort before batching.

### Decision rules

Provisional, the maintainer's to set, and fixed before experiment 4's first paid run.

- A strategy stays if, on experiment 7, its judged precision is at least 0.7, and it either
  contributes at least 10% of the pool's valid findings that no cheaper strategy found, or is the
  cheapest source of the ones it shares.
- A strategy's findings may be staged without a model reading them only where its precision's
  Wilson lower bound is at least 0.9 on held-out bootstraps, the same shape of rule as Tier 1's
  stage mode.
- A strategy is dropped below 0.5 precision, or when a valid finding costs more than three times
  the median.
- The weave is adopted if it reaches 80% of the pool's valid findings within the budget and beats
  S1-generic on valid findings per token.
- A difference between two model-call arms inside the spread of their three takes is not a result.

### What could mislead

- The curated models were built by agents reading the same code, so "known to belong" means
  reviewed, not proven.
- Rules written after reading a model are in-sample for it, as the Tier-0 rules were. Name joins
  and questions are written against the viewer and Context Studio and measured on the bootstraps.
- Experiment 7's repositories must not have been read while writing rules. The repositories
  waiting for their first model are the natural set, and they need bootstrapping anyway.

## In the product, as a sketch

Not designed here. The shape that follows from today's tools: the ledger is one deterministic
MCP tool that returns ranked rows and the free finders' findings under a budget parameter (never
the whole element list), `project_status` points to it after a bootstrap, and the calling agent
does the judging, as it is Tier 2 today. That would ship the manual question as a tool that asks
it. Whether any judging moves into the CLI depends on experiment 7.

## Decisions needed

1. **Where a correct absence is recorded.** Accepted gaps are per element and per triple. An
   answer of "this model has no links between these layers, and that is right" has no home. A
   model-level or type-level accepted gap is a spec question for Context Studio.
2. **Whether expectations become spec data.** S3's questions and S1's verdicts amount to a third
   strength between `required` (set on none of the 1,004 types) and allowed: "usually present".
   The experiments keep this as harness data. Making it part of the catalog is a Context Studio
   proposal, and worth deciding only after experiment 6.
3. **The budget.** A default per run, and whether it is absolute or a share of what the
   bootstrap cost. Experiment 1 gives the numbers to choose from.
4. **The held-out repositories** for experiment 7.
5. **The judge.** Whether Opus with a maintainer-checked sample of 50 is acceptable for M2.
6. **The decision rules above**, before the first paid arm.
