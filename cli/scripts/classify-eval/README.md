# Classification eval harness

Experimental tooling for Phase 0 of [docs/EXTRACTION_STRATEGY.md](../../../docs/EXTRACTION_STRATEGY.md):
can a decision model (Cloudflare Clef, Jev) or a small Claude model classify code symbols
into Documentation Robotics layers and element types from a graph-derived "state card",
and how well calibrated are its probabilities?

It is a self-contained package (own `package.json`, run with `bun`) so it can track the
current Anthropic SDK without touching the CLI's dependencies. It imports the CLI's
`StdioClient` to talk to codebase-memory-mcp (CBM), and builds cards and facts with the CLI's
card module (`cli/src/analyzers/cards/`), the code `dr analyzer classify` runs: `cards.ts` only
chooses which symbols get a card, and source is read from the corpus by line range (`--root`).
The committed card sets were sampled under CBM 0.10 and rebuilt for the same symbols on CBM 0.12.1
(2026-11-05) with `rebuild-cards.ts`, which keeps each card's id so the gold labels stay valid;
the 0.10 cards, facts and edges are kept beside them as `*@cbm010.jsonl`. dr-cli's cards were
rebuilt from a checkout of `cli/` at the commit they were sampled from (`meta.json` says which).

The decision-model backends run the CLI's Tier-1 code (`cli/src/analyzers/classifier/`,
[TIER1_DESIGN.md](../../../docs/analyzers/TIER1_DESIGN.md)): the provider adapters from its registry,
the question builders (`--qset`, default the CLI's current question set) and two-stage `askCard`, the criteria (`criteria.ts`, from the CLI's
bundled spec) and the state (`state.ts`). `lib/spec.ts` and `lib/state.ts` re-export them, and
`backends/clef.ts` is a thin adapter, so what the harness measures is what the CLI sends.

## Pipeline

```
cards.ts     CBM graph  ->  data/<corpus>/cards.jsonl      symbol state cards
label.ts     Claude     ->  data/<corpus>/gold.jsonl       gold labels (full context, Batch API)
classify.ts  backend    ->  data/<corpus>/pred-<b>.jsonl   predictions from a state card
report.ts               ->  data/<corpus>/report.md        accuracy, calibration, thresholds, cost
```

Cards and gold labels are committed: they are the dataset. Corpora are cloned under
`eval-corpus/` at the repo root (gitignored).

## Setup

```bash
cd cli/scripts/classify-eval && bun install
```

Credentials come from the repo-root `.env` (gitignored):

- `ANTHROPIC_API_KEY` for `label.ts` and the `claude-*` backends
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (Workers AI permission) for `cloudflare:clef` /
  `cloudflare:clef-flash` (aliases `clef` / `clef-flash`; their predictions keep the `pred-clef*.jsonl`
  names, and record `provider` and `qset`)
- `OPENROUTER_API_KEY` for `openrouter:<model>@<upstream>` (OpenRouter's Decisions API, alpha)

`codebase-memory-mcp` must be on `PATH`.

## Usage

```bash
# 1. Build cards (indexes the repo with CBM if needed); rebuild-cards.ts redoes the same symbols
#    after a CBM upgrade: bun rebuild-cards.ts --corpus fastapi --out cards@rebuilt.jsonl
bun cards.ts --corpus dr-cli --root /abs/path/to/documentation_robotics/cli --include "src/**" --limit 300
bun cards.ts --corpus fastapi --root /abs/path/to/eval-corpus/full-stack-fastapi-template --limit 200

# 2. Gold labels (Opus, high effort, Batch API at half price)
bun label.ts --corpus dr-cli --submit
bun label.ts --corpus dr-cli --status
bun label.ts --corpus dr-cli --fetch
bun label.ts --corpus dr-cli --sync --limit 5     # direct calls, for testing prompts
bun label.ts --corpus viewer --estimate --charter  # cost before labelling (free token counts): Batch API
                                                  # best / expected / worst case, and --sync with a warm cache
bun label.ts --corpus viewer --sync --charter --max-usd 14   # direct calls, the first alone to write the
                                                  # cache; stops starting requests at --max-usd

# 3. Classify with each backend (only cards that have gold labels, resumable)
bun classify.ts --corpus dr-cli --backend cloudflare:clef-flash
bun classify.ts --corpus dr-cli --backend cloudflare:clef
bun classify.ts --corpus dr-cli --backend claude-haiku --effort low

# 4. Report
bun report.ts --corpus dr-cli

# Tier 0 (Phase 2): structural facts per card, the cbm analyzer's rules against gold, rules in the run
bun facts.ts --corpus fastapi                     # decorators, importers, methods, usage -> facts.jsonl
bun tier0-report.ts                               # free: each rule's agreement with gold -> data/tier0-report.md
bun classify.ts --corpus fastapi --backend clef --kind-narrow --tier0 --tag v2-kind-tier0
bun compare.ts --corpus fastapi --a clef@v2-kind-base --b clef@v2-kind-tier0 [--exclude-revised]   # paired test
bun classify.ts --corpus viewer --backend claude-haiku --effort medium --kind-narrow --tier0 --tag <tag> --max-usd 0.40
                                                  # a Claude baseline on Clef's terms: rules decide, narrowing is a note after the state
bun agreement-report.ts --a clef@<tag> --b claude-haiku@<tag> [--b2 claude-haiku@<second take>]
                                                  # free: B's accuracy beside A's, and "A and B agree" as a gate beside A's bands
                                                  #   -> data/agreement@<b>.md (TIER1_CALIBRATION.md section 11)
bun edges-cache.ts                                # CBM edges between cards -> data/<corpus>/edges.jsonl (reads the index read-only)
bun edges-report.ts --pred clef@v2-kind-tier0     # free: what the edge mapping produces -> data/edges-report.md
                                                  #   (--gate: with the call-edge evidence gate, as codebase_extract runs)
bun call-gate-report.ts                           # free: the call-edge evidence gate on hand-checked CALLS edges (data/call-edges-truth.jsonl)
bun clusters.ts --fetch --corpus fastapi          # get_architecture clusters per card -> data/<corpus>/clusters.jsonl (dr-cli: --root <checkout>)
bun clusters.ts                                   # free: cluster evidence against gold -> data/clusters-report.md
bun gold-revise.ts --corpus fastapi --dry-run     # labelling-policy revision of gold (keeps gold@pre-handlers.jsonl)
bun gold-revise.ts --corpus viewer --revision declared-shape --dry-run
                                                  # the 2026-11-17 rulings, from data/gold-revision@declared-shape.json
                                                  #   (keeps gold@pre-declared-shape.jsonl; TIER1_CALIBRATION.md section 12)
bun gold-revise.ts --corpus viewer --revision store --dry-run
                                                  # the 2026-11-18 store ruling, from data/gold-revision@store.json
                                                  #   (keeps gold@pre-store.jsonl; TIER1_CALIBRATION.md section 14)

# Infrastructure (inventory step 9): CBM Table/Resource/Image/Chart/Process nodes against hand-labelled
# data/<corpus>/infra-gold.json, through the CLI's extraction over the live index -> data/infra-report@<tag>.md
bun infra-report.ts                               # current spec/dist/analyzers/cbm.json, tag "after"
bun infra-report.ts --mapping /path/to/old/cbm.json --tag before
```

Compare configurations with `compare.ts`, not by eyeballing accuracy: Clef is deterministic, and at
a few hundred cards a difference of a few cards is sampling error (binomial standard error about 2.3
points at 300 cards). Rule-decided cards are not asked significance or concerns; `report.ts` counts
them separately and scores those columns on model-asked cards only.

Further `classify.ts` flags: `--tier0` applies the Tier-0 rules from `spec/dist/analyzers/cbm.json`
(engine: `cli/src/analyzers/tier0-rules.ts`), so a deciding rule answers without a model call and a
narrowing rule restricts the layer and type choices (a Claude backend, which has no option list, is
sent the narrowing and `--kind-narrow`'s types as a note after the state); `--max-usd n` stops
starting requests once the run has cost that much (rerun to resume); `--facts` adds the `facts.jsonl` facts and a
placement line to the state; `--criteria core` drops the "Use X instead when" sentences from the
element-type criteria (they remain in `x-dr-distinguish`). Facts live beside the cards, not in
them, so adding facts never resamples cards and the gold labels stay valid. These flags are
builder options of the CLI's question set; a decision-model prediction records the variant as
`qset` (`dr-qset-2` is `--kind-narrow`, full criteria, no facts, no charter; `dr-qset-2+core`, and
so on).

`--qset <id>` picks the question set; the default is the CLI's current one, `dr-qset-2` (the
line-free, sorted-neighbour state of TIER1_DESIGN.md section 3.3, current since 2026-11-14, see
[TIER1_CALIBRATION.md](../../../docs/analyzers/TIER1_CALIBRATION.md)). `dr-qset-1`, with the line
range and the card's neighbour order, is the configuration of the committed `*@cbm012-kind-tier0`
runs: rerun it with `--qset dr-qset-1`. The flag only changes what a decision model is sent: the
`claude-*` baselines always get the `dr-qset-1` state (line range, the card's neighbour order), so
their runs stay comparable with the committed ones, and they refuse `--qset`.
Predictions made since record `spec_version`, the version of the spec the criteria came from.

`--spec-dist <dir>` builds criteria and Tier-0 rules from another compiled spec, to rerun a
committed configuration against the spec it was measured on (bf34d9b8's `spec/dist` is spec 0.10.0,
which every `cbm012` run used):

```bash
git archive bf34d9b8 spec/dist | tar -x -C /tmp/spec-bf34d9b8
bun classify.ts --corpus dr-cli --backend cloudflare:clef --kind-narrow --tier0 --qset dr-qset-1 \
  --spec-dist /tmp/spec-bf34d9b8/spec/dist --tag cbm012-kind-tier0-port
bun compare.ts --corpus dr-cli --a clef@cbm012-kind-tier0 --b clef@cbm012-kind-tier0-port

# dr-qset-2 against dr-qset-1, paired (the measurement behind the switch)
bun classify.ts --corpus dr-cli --backend cloudflare:clef --kind-narrow --tier0 --qset dr-qset-2 \
  --spec-dist /tmp/spec-bf34d9b8/spec/dist --tag cbm012-kind-tier0-qset2
bun compare.ts --corpus dr-cli --a clef@cbm012-kind-tier0 --b clef@cbm012-kind-tier0-qset2
```

## OpenRouter runs

`--backend openrouter:<model>@<upstream>` asks OpenRouter's Decisions API through the CLI's
`openrouter` adapter, pinned to one upstream: every request carries `provider.only: [<upstream>]`,
`allow_fallbacks: false` and `data_collection: "deny"`. A response from another upstream (`routing`),
a changed response shape (`api`), a refused key (`auth`) or no credits (`payment`) stops the run:
the rest of the pool is skipped and `classify.ts` exits 3 naming the reason (rerun to resume once
fixed); other failures are recorded per card as before, and what a failed call was billed counts in
`cost_usd` and the total. The upstream is an OpenRouter provider slug (the model's page on openrouter.ai lists them):
`cloudflare`, `primeintellect`, `deepinfra/fp8` for Clef, `typesafe` for Jev. Predictions go to
`pred-openrouter-<model>-<upstream>[@<tag>].jsonl` with `/` as `_`, and record `provider`
(`openrouter`), `upstream` (the pinned slug), `model`, and `served_by` (the upstream and model each
response named); `cost_usd` is OpenRouter's own `usage.cost`. `compare.ts`, `report.ts` and
`fit-thresholds.ts` print each run's serving and refuse a file that mixes providers or upstreams, so
runs from different adapters stay apart: compare them as two files.

```bash
# The design's OpenRouter runs (TIER1_DESIGN.md section 5), on the committed qset-2 configuration
# (spec 0.10.0 pinned as for the Workers AI run). Smoke-test with --limit 3 and --dry-run first.
bun classify.ts --corpus dr-cli --backend openrouter:cloudflare/clef@cloudflare --kind-narrow --tier0 --qset dr-qset-2 \
  --spec-dist /tmp/spec-bf34d9b8/spec/dist --tag cbm012-kind-tier0-qset2
bun compare.ts --corpus dr-cli --a clef@cbm012-kind-tier0-qset2 --b openrouter-cloudflare_clef-cloudflare@cbm012-kind-tier0-qset2
bun classify.ts --corpus dr-cli --backend openrouter:cloudflare/clef@deepinfra/fp8 ...   # fp8
bun classify.ts --corpus dr-cli --backend openrouter:typesafe/jev-1.14@typesafe ...       # Jev
bun report.ts --bands --run openrouter-typesafe_jev-1.14-typesafe@cbm012-kind-tier0-qset2
bun fit-thresholds.ts --run openrouter-typesafe_jev-1.14-typesafe@cbm012-kind-tier0-qset2 \
  --spec-version 0.10.0 --type-precision 0.88 --none-precision 0.9
```

## Bands and default thresholds

Tier 1 sorts each asked card into a band (accept, not-element, escalate) by thresholds per question
set and model; `DEFAULT_THRESHOLDS` in `cli/src/analyzers/classifier/bands.ts` holds DR's defaults
([TIER1_DESIGN.md](../../../docs/analyzers/TIER1_DESIGN.md) section 6; the measurements are in
[TIER1_CALIBRATION.md](../../../docs/analyzers/TIER1_CALIBRATION.md)). Both scripts read a run's
predictions across the corpora, model-asked cards only, and band them with the CLI's `bandOf`:

```bash
# Band report: precision and coverage curves over each band's threshold (accept: T_layer 0.5-0.8 by
# T_type 0-0.6; not-element: T_none 0.3-0.9), Wilson 95% intervals, and per 1,000 asked cards the
# cards removed, wrong elements staged and real elements hidden; pooled and per corpus, the default
# thresholds marked. --qset for runs made before predictions recorded it. -> data/bands@<run>.md
bun report.ts --bands --backend cloudflare:clef --tag cbm012-kind-tier0 --qset dr-qset-1

# Proposed defaults: the grid point meeting the precision targets with the most coverage, printed
# with its fit record (run, corpora and card counts, spec version, date, targets, fit "in-sample").
# --scope each-corpus (default: pooled and in every corpus) or pooled; --bound point (default) or
# wilson-lower; --spec-version for runs that don't record it. It never edits bands.ts.
bun fit-thresholds.ts --backend cloudflare:clef --tag cbm012-kind-tier0 --qset dr-qset-1 \
  --spec-version 0.10.0 --type-precision 0.88 --none-precision 0.9
```

Both also take `--run <backend@tag>` (a prediction file stem, as `compare.ts` does) instead of
`--backend` and `--tag`, and `--corpora a,b` to limit the corpora. A prediction whose model call
failed counts as asked and escalated (a resumed run's later answer replaces it). A run of a harness
variant (`+no-kind`, `+core`, `+facts`, `+charter-*`) is flagged in the report, and
`fit-thresholds.ts` refuses it unless `--force`: production never sends a variant.

The band statistics (`wilson`, the band points, `fit`) have unit tests in the CLI's suite,
`cli/tests/unit/scripts/classify-eval-bands.test.ts` (`npm run test:unit` in `cli/`, or
`bun test tests/unit/scripts/classify-eval-bands.test.ts`).

## The held-out corpus (B5)

`data/viewer` is the viewer codebase (tinkermonkey/documentation_robotics_viewer, `src/**`, at the
commit in its `meta.json`), the held-out corpus of TIER1_DESIGN.md section 6: labelled with
`label.ts` like the others, and **not read while writing Tier-0 rules, question sets, criteria or
thresholds**. Fit on the three in-sample corpora only (`report.ts` and `fit-thresholds.ts` default to
them); then score the defaults on the viewer:

```bash
bun classify.ts --corpus viewer --backend cloudflare:clef --kind-narrow --tier0 --qset dr-qset-2 --tag <tag>
bun held-out.ts --run clef@<tag>                       # -> data/held-out@clef@<tag>.md
bun held-out.ts --run clef@<tag> --thresholds 0.6,0.4,0.6   # other thresholds, for comparison
bun report.ts --bands --run clef@<tag> --corpora viewer     # its curves -> data/bands@clef@<tag>@viewer.md
bun tier0-report.ts --corpus viewer --out data/tier0-report@viewer.md
```

`held-out.ts` reports layer and end-to-end type accuracy and both bands with Wilson intervals, beside
the in-sample corpora, and the verdict of the CLI's `heldOutVerdict` (`bands.ts`) under
`TIER1_TARGETS` and `HELD_OUT_RULE` (`lower-bound`, each band at least `HELD_OUT_MIN_CARDS`), and
under alternative targets and the `within-interval` alternative. It prints the `heldOut` record for
`DEFAULT_THRESHOLDS` (counts, serving, criteria digest; predictions record `criteria_digest` since
2026-11-16); marking a default `held-out` (stage mode) is a separate, deliberate edit of `bands.ts`.

`bun gap-analysis.ts --run clef@<tag>` (`--held-out viewer`, `--ui-corpora viewer`) breaks the bands
at the defaults down by symbol kind, predicted layer and code part (fastapi's `frontend/` and the
`--ui-corpora` as UI client code), re-weights in-sample precision to the held-out band's mix, measures
the fit's optimism in-sample (leave one corpus out, out-of-bag bootstrap), scores the held-out corpus
across the in-sample fit's bootstrap distribution, and compares the relabelled in-sample cards against
both golds -> `data/gap-analysis@<run>@<held-out>.md` (TIER1_CALIBRATION.md section 8). Analysis only.

More held-out corpora (TIER1_CALIBRATION.md section 9): `data/jaeger-ui`, `data/miniflux` and
`data/eshop`, labelled with today's prompt and scored with `bun held-out.ts --run clef@<tag> --corpus <c>`
(-> `data/held-out@<run>@<corpus>.md`), or together, `--corpus viewer,jaeger-ui,miniflux,eshop`: one
record over the corpora, verdicts per band under `HELD_OUT_POOLING` (`pooled-with-floor`) and the
alternatives, and the mode each gives (stage, hide or suggest). `data/umami` was a candidate (cards and facts
only) until 2026-11-17, when it was labelled and scored after the rules, criteria and thresholds of that day were
merged (TIER1_CALIBRATION.md section 13); the shipped record is over all five:
`--corpus viewer,jaeger-ui,miniflux,eshop,umami`. None is read while writing rules, question sets, criteria
or thresholds. `bun label.ts --corpus <c> --estimate --charter` costs labelling one.

The in-sample corpora's `gold.jsonl` is the 2026-11-16 relabel, made with today's prompt (the held-out
corpora's) and then given the "handlers" revision (`gold-revise.ts`); October's labels are
`gold@october.jsonl` (TIER1_CALIBRATION.md section 10). `report.ts --bands`, `fit-thresholds.ts`,
`fit-stability.ts`, `held-out.ts` and `gap-analysis.ts` take `--gold october` to score the in-sample
cards against them, which reproduces sections 1-8 (their output files get `@gold-october`; section 9's
files carry `@gold-relabel-full`, the relabel's name before it became `gold.jsonl`). `label.ts
--estimate` calibrates the Batch API cache-hit rate on `gold@october.jsonl`, the Batch-labelled sets.

Since 2026-11-17 every corpus's `gold.jsonl` also carries the "declared-shape" revision
(`gold-revise.ts --revision declared-shape`): the maintainer's rulings that a declared shape is an
object schema, a service's contract is the service, and a message is an `application.message`
(TIER1_CALIBRATION.md section 12). The labels before it are `gold@pre-declared-shape.jsonl` in the
five corpora it changed, and `data/gold-revision@declared-shape.json` lists each changed card with
the clause that moved it, and the interfaces it deliberately left as not-elements. The list was
drawn up by reading the held-out corpora's cards too: the viewer and eshop are no longer unseen.
umami's entries were added before Clef was run on it, and its figures are the same against its
unrevised labels. The current run is `clef@cbm012-kind-tier0-qset2-spec013-domain`: the same rules, gold and
thresholds on the definitions as reworded on 2026-11-18 (TIER1_CALIBRATION.md section 14).

Since 2026-11-18 the viewer's `gold.jsonl` also carries the "store" revision (`gold-revise.ts --revision
store`, list in `data/gold-revision@store.json`, previous labels `gold@pre-store.jsonl`): a state container
whose actions only manage its own state is an `application.dataobject`, and one whose actions call services
or do I/O stays an `application.applicationcomponent`. Ten viewer cards change; the list's `kept` entries
say which stores were left and why. No other corpus has a card it changes.

Two more checks of a fit or a configuration: `bun fit-stability.ts --run clef@<tag> --type-precision
0.88 --none-precision 0.9` (each corpus's margin at the fit, the threshold range that gives the same
bands, leave-one-corpus-out fits and a bootstrap), and `bun compare.ts --corpus dr-cli,fastapi,petclinic
--a ... --b ...` (one paired test pooled over the corpora).

## What a card contains

Symbol kind, name, qualified name, file and lines, signature, docstring, flags (exported,
entry point, complexity), inheritance, callers and callees (from CALLS edges), the file's
imports, environment variables read, routes handled, HTTP calls made, and a source excerpt.
`renderState()` (the CLI's `src/analyzers/classifier/state.ts`, re-exported by `lib/state.ts`)
turns a card into the text every backend sees, capped at
`--source-lines` (40 for classifiers, the full stored excerpt for gold labeling).

## Questions asked

- **layer** (choice over the 13 layers plus `none`), criteria from the CLI's
  `src/analyzers/classifier/criteria.ts` (re-exported by `lib/spec.ts`)
- **element_type** (choice over the predicted layer's types plus `none`), criteria from the
  spec node-schema descriptions
- **significance** (score, 5 levels)
- six **concern** yes/no questions: authentication, authorization, data_persistence,
  external_integration, observability, user_interface

Layer criteria are the `description` of each layer in the CLI's bundled spec
(`cli/src/schemas/bundled/*.json`, copied from `spec/dist` by `npm run build` in `cli/`; the layer
definitions added to `spec/layers/*.layer.json` in October 2026); the harness refuses to run
against a placeholder description. Element-type criteria are the node-schema descriptions.

## Notes

- CBM 0.10.x returns text tables from `query_graph` unless `format: "json"` is passed, and
  its Cypher dialect ignores `LIMIT` and aggregations, so the harness pulls whole edge sets
  and joins in memory.
- Gold labels come from Claude, so "accuracy" measures agreement with a strong model that
  saw more context, not ground truth. Spot-check `report.md`'s disagreement table.
- `gold.jsonl` is the charter-labelled set (Opus 5.5 with `spec/DESIGN_CHARTER.md` in context,
  October 2026). The earlier set without the charter is kept as `gold@baseline.jsonl`;
  `gold-diff.md` per corpus compares them, and `report.ts --gold baseline` scores against it.
