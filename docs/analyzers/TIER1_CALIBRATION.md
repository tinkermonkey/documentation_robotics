# Tier 1 calibration: band curves, default thresholds and `dr-qset-2` (2026-11-14)

Results of rollout PR 2 of [TIER1_DESIGN.md](TIER1_DESIGN.md) (section 9, item 2): the band
measurement of section 6, the in-sample defaults for Clef, and the paired measurement of question set
`dr-qset-2` (the line-free state, section 3.3) against `dr-qset-1`. Rollout PR 8 (2026-11-16) added
section 6, the re-measure on the spec the CLI bundles (0.12.0) and Clef's refitted defaults, and
section 7, B5: the held-out viewer corpus, the held-out test and its verdict.

All numbers are from the classify-eval harness (`cli/scripts/classify-eval/`) against the committed
gold labels, **model-asked cards only** (no Tier-0 rule, or a narrowing one): dr-cli 300, fastapi
148, petclinic 73, 521 pooled. Every run used spec 0.10.0 (`spec/dist` at bf34d9b8, through
`classify.ts --spec-dist`) and the `cbm012-kind-tier0` configuration (`--backend cloudflare:clef
--kind-narrow --tier0`). Bands come from the CLI's `bandOf`; a prediction whose model call failed
would count as asked and escalate (these runs have none). Everything here is **in-sample**: the
thresholds are fitted and scored on the same three corpora, so Tier 1 stays in suggest mode until B5
(the held-out viewer corpus).

## Decisions

- **Clef's defaults are T_layer 0.6, T_type 0.4, T_none 0.6** for both `dr-qset-1` and `dr-qset-2`
  (`DEFAULT_THRESHOLDS` in `cli/src/analyzers/classifier/bands.ts`), keyed by canonical model, so Clef
  through any provider gets them; each carries its fit record and `fit: "in-sample"`, and `modeOf`
  returns `suggest` for both. (Measured on spec 0.10.0; `dr-qset-2`'s were refitted on 0.12.0 in
  rollout PR 8, below.)
- **`dr-qset-2` is the current question set.** It meets none of the blocking criteria: no corpus loses
  layer or end-to-end type accuracy significantly (smallest p = 0.359), and pooled accept-band type
  precision at the defaults rises from 90.9% to 93.3%. Refitting with the same targets gives the same
  thresholds. The cache misses once per card on the first run after the upgrade, as section 3.3 says.
- **The card builder sorts callers, callees and imports before capping them** (card version 2), so
  the 12 and 15 the state names don't depend on the order CBM returned its rows in, under either
  question set.
- **Rollout PR 8: Clef's `dr-qset-2` defaults are refitted on spec 0.12.0 to T_layer 0.7, T_type 0.5,
  T_none 0.7** (section 6). The bundled spec's layer criteria cost Clef 11 points of layer accuracy
  against spec 0.10.0, and at (0.6, 0.4, 0.6) both bands miss the targets; the same targets refit to
  (0.7, 0.5, 0.7), which accepts a quarter as many cards. `dr-qset-1 x clef` keeps its spec-0.10.0
  record.
- **B5 (section 7): Clef's defaults pass the held-out test under the provisional targets** (type
  precision 0.88, not-element 0.90, `within-interval`), on thin evidence: 4 accepted cards on the
  viewer (all right) and 23 hidden (22 right). Under the stricter `lower-bound` reading they fail
  under every target set shown. The targets are the maintainer's to fix; the verdict is recomputed
  from the recorded counts (`verdictOf`), so a change of targets is a one-line change.

## 1. The section 6 table reproduces

`report.ts --bands` over the committed `pred-clef@cbm012-kind-tier0.jsonl` gives exactly the table
in TIER1_DESIGN.md section 6, at (0.6, 0.4, 0.6): dr-cli 65 accepted at 92.3% type precision and 46
not-element at 97.8%; fastapi 43 at 88.4% and 21 at 90.5%; petclinic 2 at 100% and 36 at 100%;
pooled 110 accepted at 90.9% (Wilson 95% 84.1-95.0%). The layer-threshold column ("Layer >= 0.6"),
which the report gives as "layer >= 0.6 alone" in its table at the defaults, matches too: dr-cli 91
cards at 97.8% / 85.7%, fastapi 55 at 92.7% / 80.0%, petclinic 2 at 100% / 100%.

That column is not a band, and it is not the accept curve's T_type 0 row: the curve gives dr-cli 90
and fastapi 54 there, because one card in each (dr-cli `712b957fb836`, fastapi `321d9bd6baef`) has
a layer p of 0.6 or more and no chosen type, which `bandOf` escalates.

## 2. Band curves (`dr-qset-1`, Clef)

Full curves, pooled and per corpus, with intervals and the consequences per 1,000 asked cards:
[`bands@clef@cbm012-kind-tier0.md`](../../cli/scripts/classify-eval/data/bands@clef@cbm012-kind-tier0.md).
The pooled accept band at T_type 0.4 and its neighbours (type precision is end to end; "wrong staged"
is accepted cards whose layer or type is wrong, per 1,000 asked):

| T_layer | T_type  | accepted | type precision (95%)  | per 1,000 asked: removed | wrong staged |
| ------- | ------- | -------- | --------------------- | ------------------------ | ------------ |
| 0.5     | 0.3     | 215      | 84.2% (78.7-88.5)     | 413                      | 65           |
| 0.5     | 0.4     | 169      | 90.5% (85.2-94.1)     | 324                      | 31           |
| 0.6     | 0.3     | 135      | 87.4% (80.8-92.0)     | 259                      | 33           |
| **0.6** | **0.4** | **110**  | **90.9% (84.1-95.0)** | **211**                  | **19**       |
| 0.6     | 0.5     | 75       | 90.7% (82.0-95.4)     | 144                      | 13           |
| 0.7     | 0.4     | 44       | 97.7% (88.2-99.6)     | 84                       | 2            |
| 0.8     | 0.4     | 11       | 100% (74.1-100)       | 21                       | 0            |

The pooled not-element band ("hidden" is real elements gold calls elements, per 1,000 asked):

| T_none  | not-element | precision (95%)       | per 1,000 asked: removed | real elements hidden |
| ------- | ----------- | --------------------- | ------------------------ | -------------------- |
| 0.5     | 164         | 92.7% (87.6-95.8)     | 315                      | 23                   |
| **0.6** | **103**     | **97.1% (91.8-99.0)** | **198**                  | **6**                |
| 0.7     | 53          | 100% (93.2-100)       | 102                      | 0                    |

What the curves say:

- **T_type 0.4 is the knee.** At T_layer 0.5 and 0.6, lowering T_type to 0.3 costs 3.5 to 6.3 points
  of type precision; raising it to 0.5 gains nothing while coverage keeps falling (0.6 / 0.5 accepts
  35 fewer cards at 90.7%).
- **T_layer 0.5 against 0.6 is a corpus question.** Pooled, (0.5, 0.4) accepts 54% more cards (169
  against 110) at about the same precision (90.5% against 90.9%, with a higher Wilson lower bound),
  but fastapi's type precision there is 87.7% against 88.4%. A pooled target picks 0.5; a per-corpus
  one picks 0.6 (section 3).
- **Petclinic barely reaches the accept band** (2 cards of 73 at 0.6, 11 at 0.5), while half its asked
  cards land in the not-element band, at 100%.

## 3. Fitting the defaults

`fit-thresholds.ts` picks, on the report's grid, the thresholds meeting the precision targets with the
most coverage. The defaults the design set, (0.6, 0.4, 0.6), are what these targets select:

```bash
bun fit-thresholds.ts --backend cloudflare:clef --tag cbm012-kind-tier0 --qset dr-qset-1 \
  --spec-version 0.10.0 --type-precision 0.88 --none-precision 0.9
# accept-band type precision >= 88% and not-element precision >= 90%, point estimates,
# pooled and in every corpus (--scope each-corpus, the default)
```

The targets were chosen to reproduce the design's defaults, not set independently (decision 4 leaves
targets to the maintainer after the measurement). How the choice moves with them:

| Question set | Targets (type / none), scope              | T_layer | T_type | T_none | accepted (type precision) | not-element (precision) |
| ------------ | ----------------------------------------- | ------- | ------ | ------ | ------------------------- | ----------------------- |
| `dr-qset-1`  | 0.88 / 0.90, each corpus (shipped)        | 0.6     | 0.4    | 0.6    | 110 (90.9%)               | 103 (97.1%)             |
| `dr-qset-1`  | 0.90 / 0.95, pooled                       | 0.5     | 0.4    | 0.6    | 169 (90.5%)               | 103 (97.1%)             |
| `dr-qset-1`  | 0.90 / 0.90, each corpus                  | 0.7     | 0.2    | 0.6    | 47 (95.7%)                | 103 (97.1%)             |
| `dr-qset-1`  | Wilson lower bound >= 0.85 / 0.90, pooled | 0.5     | 0.4    | 0.6    | 169 (90.5%)               | 103 (97.1%)             |
| `dr-qset-2`  | 0.88 / 0.90, each corpus (shipped)        | 0.6     | 0.4    | 0.6    | 104 (93.3%)               | 96 (94.8%)              |
| `dr-qset-2`  | 0.90 / 0.95, pooled                       | 0.5     | 0.4    | 0.7    | 152 (92.1%)               | 54 (98.1%)              |
| `dr-qset-2`  | 0.90 / 0.90, each corpus                  | 0.7     | 0.4    | 0.6    | 41 (95.1%)                | 96 (94.8%)              |
| `dr-qset-2`  | Wilson lower bound >= 0.85 / 0.90, pooled | 0.5     | 0.4    | 0.7    | 152 (92.1%)               | 54 (98.1%)              |

For `dr-qset-1`, T_none 0.6 is stable across these targets; for `dr-qset-2` it is not: its
not-element precision at 0.6 (94.8%) misses a 0.95 target, so a pooled 0.95 target picks 0.7 and
hides about half as many cards. T_layer moves for both: if the maintainer prefers a pooled target,
0.5 accepts nearly a third of asked cards instead of a fifth at about the same pooled precision.

## 4. `dr-qset-2` against `dr-qset-1`

`dr-qset-2` sends the same questions with the state changed in two ways (section 3.3): the `File:`
line carries the path without the line range, and callers, callees and imports are sorted before the
first 12 (15) are taken. Run live on all three corpora:

```bash
bun classify.ts --corpus <corpus> --backend cloudflare:clef --kind-narrow --tier0 --qset dr-qset-2 \
  --spec-dist <bf34d9b8>/spec/dist --tag cbm012-kind-tier0-qset2
bun compare.ts --corpus <corpus> --a clef@cbm012-kind-tier0 --b clef@cbm012-kind-tier0-qset2
```

Tier 0 decided exactly the same cards in both runs (the spec was pinned), and the 15 petclinic cards
whose state didn't change (no line range, neighbours already sorted) got identical answers, as a
deterministic model should; every other asked card's state changed. Paired,
all gold cards (rule-decided cards agree by construction):

| Corpus    | Cards | Layer: qset-1 / qset-2 | lost / gained | p (exact McNemar) | Type, end to end: qset-1 / qset-2 | lost / gained | p     |
| --------- | ----- | ---------------------- | ------------- | ----------------- | --------------------------------- | ------------- | ----- |
| dr-cli    | 300   | 91.3% / 89.7%          | 12 / 7        | 0.359             | 78.3% / 77.3%                     | 11 / 8        | 0.648 |
| fastapi   | 200   | 86.5% / 87.5%          | 2 / 4         | 0.688             | 79.0% / 80.5%                     | 3 / 6         | 0.508 |
| petclinic | 106   | 96.2% / 96.2%          | 0 / 0         | 1.000             | 94.3% / 94.3%                     | 0 / 0         | 1.000 |
| Pooled    | 606   | 90.6% / 90.1%          | 14 / 11       | 0.690             | 81.4% / 81.4%                     | 14 / 14       | 1.000 |

Type where both runs got the layer: dr-cli 0 lost / 2 gained, fastapi 1 / 3, petclinic 0 / 0 (pooled
p = 0.219).

The bands at the defaults (0.6, 0.4, 0.6), pooled
([`bands@clef@cbm012-kind-tier0-qset2.md`](../../cli/scripts/classify-eval/data/bands@clef@cbm012-kind-tier0-qset2.md)):

| Question set | accepted (coverage) | type precision (95%) | wrong staged per 1,000 | not-element (coverage) | precision (95%)   | real elements hidden per 1,000 |
| ------------ | ------------------- | -------------------- | ---------------------- | ---------------------- | ----------------- | ------------------------------ |
| `dr-qset-1`  | 110 (21.1%)         | 90.9% (84.1-95.0)    | 19                     | 103 (19.8%)            | 97.1% (91.8-99.0) | 6                              |
| `dr-qset-2`  | 104 (20.0%)         | 93.3% (86.8-96.7)    | 13                     | 96 (18.4%)             | 94.8% (88.4-97.8) | 10                             |

**Decision by the blocking criteria (section 3.3): not blocked.** No corpus loses layer or end-to-end
type accuracy significantly (every p > 0.35), and pooled accept-band type precision at the defaults
rises 2.4 points instead of falling. `dr-qset-2` is the current question set (`qset/index.ts`).

Refitted with the same targets (`fit-thresholds.ts --tag cbm012-kind-tier0-qset2 --type-precision
0.88 --none-precision 0.9`), the thresholds are unchanged, (0.6, 0.4, 0.6): `dr-qset-2 x clef` ships
with them and its own fit record, and `dr-qset-1 x clef` stays for the harness.

Not a blocking criterion, but worth watching: the not-element band at T_none 0.6 lost 2.3 points of
precision (97.1% to 94.8%: 5 real elements hidden among 521 asked cards against 3, one of the new
ones in petclinic), inside both intervals. It matters only once the not-element band is applied, which is a
debug option until B5.

## 5. OpenRouter runs (rollout PR 6): pending an OpenRouter key

The `openrouter` adapter (the Decisions API) and the harness backend `openrouter:<model>@<upstream>`
are in place; the live runs of TIER1_DESIGN.md section 5 have not been made, because no
`OPENROUTER_API_KEY` was available when the adapter landed. Nothing below is measured yet, and
**Jev has no defaults**: `typesafe/jev-1.14` runs suggest-only with no bands until these runs
support some.

The runs to make, each on the three corpora and paired with the committed Workers AI run
`clef@cbm012-kind-tier0-qset2` (same configuration and spec, so differences are the serving):

```bash
git archive bf34d9b8 spec/dist | tar -x -C /tmp/spec-bf34d9b8      # spec 0.10.0, as the committed runs
for b in openrouter:cloudflare/clef@cloudflare openrouter:cloudflare/clef@deepinfra/fp8 openrouter:typesafe/jev-1.14@typesafe; do
  for c in dr-cli fastapi petclinic; do
    bun classify.ts --corpus $c --backend $b --kind-narrow --tier0 --qset dr-qset-2 \
      --spec-dist /tmp/spec-bf34d9b8/spec/dist --tag cbm012-kind-tier0-qset2
  done
done
bun compare.ts --corpus <corpus> --a clef@cbm012-kind-tier0-qset2 --b openrouter-cloudflare_clef-cloudflare@cbm012-kind-tier0-qset2
bun report.ts --bands --run openrouter-typesafe_jev-1.14-typesafe@cbm012-kind-tier0-qset2
bun fit-thresholds.ts --run openrouter-typesafe_jev-1.14-typesafe@cbm012-kind-tier0-qset2 \
  --spec-version 0.10.0 --type-precision 0.88 --none-precision 0.9
```

What they should show, and what follows:

- **Clef pinned to Cloudflare** is expected to match Workers AI card for card (0 lost, 0 gained in
  `compare.ts`): the same weights on the same host. A difference is a finding about OpenRouter's
  serving, not about Clef.
- **Clef pinned to DeepInfra** serves fp8 weights. Shared thresholds (decision 12) hold if no corpus
  differs significantly (exact McNemar p < 0.05) and the accept band at Clef's defaults keeps its
  precision within the Workers AI run's interval; otherwise the finding goes to the maintainer
  (per-upstream thresholds are not in the design).
- **Jev 1.14**: band curves, and defaults proposed with the same targets as Clef's only if they meet
  them (accept-band type precision >= 88% and not-element precision >= 90%, pooled and per corpus).

Cost, at the catalog prices of 2026-11-15 and the Workers AI qset-2 runs' measured $0.63 for the
521 asked cards (about 5,000 input tokens a card over both stages): about $0.63 on Cloudflare
($0.24 per million input tokens), $0.50 on DeepInfra ($0.192) and $0.11 for Jev ($0.042, if its
tokenizer counts alike), about $1.25 for all three.

## 6. Re-measured on the bundled spec, 0.12.0 (rollout PR 8)

Everything above used spec 0.10.0 (`--spec-dist` at bf34d9b8). Production sends the criteria of the
spec the CLI bundles, 0.12.0, so the `dr-qset-2` run was repeated on it, with nothing else changed:

```bash
bun classify.ts --corpus <corpus> --backend cloudflare:clef --kind-narrow --tier0 --qset dr-qset-2 \
  --tag cbm012-kind-tier0-qset2-spec012          # no --spec-dist: the bundled spec
bun compare.ts --corpus <corpus> --a clef@cbm012-kind-tier0-qset2 --b clef@cbm012-kind-tier0-qset2-spec012
```

**The gold labels are still valid.** Every one of the 381 typed gold labels (dr-cli 208, fastapi 118,
petclinic 55) is a type of the current spec, as it was of 0.10.0; the 4 labels with a layer and no
type, and the 221 `none` labels, need nothing. The one type rename between the two specs
(`product.capability` to `product.softwarecapability`, in `RELATIONSHIP_REWRITE_TABLE.typeRenames`)
touches no gold label, and no gold label names a removed type, so nothing needed mapping. Tier 0
decided and narrowed exactly the same cards on both specs.

**Layer accuracy fell significantly.** Paired, all gold cards:

| Corpus    | Cards | Layer: 0.10.0 / 0.12.0 | lost / gained | p (exact McNemar) | Type, end to end: 0.10.0 / 0.12.0 | lost / gained | p       |
| --------- | ----- | ---------------------- | ------------- | ----------------- | --------------------------------- | ------------- | ------- |
| dr-cli    | 300   | 89.7% / 73.7%          | 51 / 3        | < 0.001           | 77.3% / 63.7%                     | 45 / 4        | < 0.001 |
| fastapi   | 200   | 87.5% / 79.5%          | 16 / 0        | < 0.001           | 80.5% / 74.5%                     | 12 / 0        | < 0.001 |
| petclinic | 106   | 96.2% / 93.4%          | 4 / 1         | 0.375             | 94.3% / 92.5%                     | 3 / 1         | 0.625   |
| Pooled    | 606   | 90.1% / 79.0%          | 71 / 4        | < 0.001           | 81.4% / 72.3%                     | 60 / 5        | < 0.001 |

Type where both runs got the layer is unchanged (dr-cli 4 lost / 1 gained, p = 0.375; fastapi 0 / 0).
44 of dr-cli's 51 lost cards are application symbols now answered `none`; fastapi loses 7 `ux` cards
to `none`.

**The cause is the layers' modelling rules.** Track A appended a "Modelling rules:" paragraph to every
layer's description (the relationship rules each layer follows), which tripled the layer criteria
Tier 1 sends (8,971 to 29,568 characters over the 13 layers); 18 of 191 type descriptions changed too.
A diagnostic run on spec 0.12.0 with each layer description cut before "Modelling rules:"
(`clef@diag-spec012-norules`, dr-cli and fastapi; a scratch copy of the spec, not a candidate
configuration) is back within noise of spec 0.10.0: dr-cli layer 88.0% (5 lost / 0 gained, p = 0.063),
fastapi 86.5% (3 / 1, p = 0.625). End-to-end type on dr-cli keeps a small loss (74.7%, 9 / 1,
p = 0.021), from the changed type descriptions. This is the charter effect of Phase 0 again (prose
about relationships swamping the card). **Not changed here**: dropping the modelling rules from the
layer criteria is a change to what Tier 1 sends (a criteria rule or a new question set, measured with
the section 3.3 criteria, and maybe a spec field of its own, which goes through Context Studio), and
it is the maintainer's call. The viewer corpus was not used for it.

**The defaults no longer meet the targets in-sample.** At (0.6, 0.4, 0.6) the spec-0.12.0 run
accepts 45 of 521 asked cards (8.6%) at 86.7% type precision (73.8-93.7) and hides 104 (20.0%) at
88.5% (80.9-93.3): both below the targets (0.88, 0.90). Refitted with the same targets
(`bun fit-thresholds.ts --run clef@cbm012-kind-tier0-qset2-spec012 --type-precision 0.88
--none-precision 0.9`), the defaults are **(0.7, 0.5, 0.7)**, now in `bands.ts` with their spec-0.12.0
fit record ([`bands@clef@cbm012-kind-tier0-qset2-spec012.md`](../../cli/scripts/classify-eval/data/bands@clef@cbm012-kind-tier0-qset2-spec012.md)):

| Targets (type / none), scope              | T_layer | T_type  | T_none  | accepted (type precision, 95%)  | not-element (precision, 95%)  |
| ----------------------------------------- | ------- | ------- | ------- | ------------------------------- | ----------------------------- |
| 0.85 / 0.90, each corpus                  | 0.7     | 0.5     | 0.7     | 26, 5.0% (88.5%, 71.0-96.0)     | 50, 9.6% (100%, 92.9-100)     |
| **0.88 / 0.90, each corpus (shipped)**    | **0.7** | **0.5** | **0.7** | **26, 5.0% (88.5%, 71.0-96.0)** | **50, 9.6% (100%, 92.9-100)** |
| 0.88 / 0.90, pooled                       | 0.7     | 0.5     | 0.7     | 26, 5.0% (88.5%)                | 50, 9.6% (100%)               |
| 0.90 / 0.90, each corpus                  | 0.8     | 0.5     | 0.7     | 11, 2.1% (100%, 74.1-100)       | 50, 9.6% (100%)               |
| 0.90 / 0.95, each corpus or pooled        | 0.8     | 0.5     | 0.7     | 11, 2.1% (100%)                 | 50, 9.6% (100%)               |
| Wilson lower bound >= 0.85 / 0.90, pooled | -       | -       | -       | none on the grid meets it       | -                             |

The accept band shrinks to a quarter of its spec-0.10.0 size (26 cards against 104), almost all of
it fastapi (25): on dr-cli it accepts 1 card. The not-element band is smaller and exact. If the
modelling rules leave the criteria, the curves should come back to section 4's, and the defaults with
them.

## 7. B5: the held-out corpus, the viewer codebase (rollout PR 8)

Decision 8: B5 is tinkermonkey/documentation_robotics_viewer, labelled with `label.ts` and not read
while writing rules, question sets, criteria or thresholds.

**The corpus** (`cli/scripts/classify-eval/data/viewer/`): 300 cards from a clone of the viewer at
`607ca095cd56ce9ef8435f2880bf8e6d3c709fa5` (origin/main on 2026-11-16), `src/**`, built by `cards.ts`
on CBM 0.12.1 like the others (seed 42, the default exclusions, card version 2): 89 interfaces, 88
functions, 85 modules, 28 methods, 10 classes; no routes (a React client). Facts by `facts.ts`.

**Gold labels**: `label.ts --charter`, the prompt of the other gold sets (Opus 5.5, effort high, the
full design charter, the spec reference text), on spec 0.12.0 and today's charter. 117 `application`,
117 `none`, 51 `ux`, 5 `api`, 3 `data-model`, 3 `navigation`, 2 `apm`, 2 `security`; every typed label
is a valid type. Labelled with direct calls (`--sync`), not the Batch API: `label.ts --estimate` put
a batch at $35.36 at the committed sets' 40% cache-hit rate ($5.37 to $55.44 from all hits to none),
over the $15 budget, because the system prompt is now 72,562 tokens (spec 0.12.0's enriched
reference text and the charter); direct calls one after another keep the cache warm, estimated at
$11.08. The run used `--max-usd`, every request after the first read the cache, and it cost $11.16 at
the harness's prices (which bill cache reads at 0.1x input; at Opus 5.5's published $0.20 per million
cached tokens it is about $6.80). Same labels a batch would give: only the transport and the price
differ.

**Spot check** of 20 labels drawn at random (seed 7): all 20 follow the labelling instructions. Two
are borderline rather than wrong: `NavigationError` (a store's error-record interface) is `none` where
similar interfaces (`ModelLink`, `BaseChatContent`, `Reference`) are `application.dataobject`, and
`Credentials` (a small sub-component rendering status chips) is `ux.componentinstance` where `none`
would also fit. Neither is clearly wrong, so no label was revised and there is no `gold-diff.md`.

**Results** (`bun held-out.ts --run clef@cbm012-kind-tier0-qset2-spec012`,
[`held-out@clef@cbm012-kind-tier0-qset2-spec012.md`](../../cli/scripts/classify-eval/data/held-out@clef@cbm012-kind-tier0-qset2-spec012.md);
Clef, `dr-qset-2`, spec 0.12.0, the configuration of section 6; Wilson 95% intervals):

| Scope                 | Gold cards | Layer accuracy    | Type accuracy, end to end | Asked | Accept: cards (coverage) | Type precision    | Not-element: cards (coverage) | Precision         |
| --------------------- | ---------- | ----------------- | ------------------------- | ----- | ------------------------ | ----------------- | ----------------------------- | ----------------- |
| **viewer (held out)** | 300        | 80.0% (75.1-84.1) | 73.0% (67.7-77.7)         | 290   | 4 (1.4%)                 | 100% (51.0-100)   | 23 (7.9%)                     | 95.7% (79.0-99.2) |
| in-sample, pooled     | 606        | 79.0% (75.6-82.1) | 72.3% (68.6-75.7)         | 521   | 26 (5.0%)                | 88.5% (71.0-96.0) | 50 (9.6%)                     | 100% (92.9-100)   |
| dr-cli                | 300        | 73.7% (68.4-78.3) | 63.7% (58.1-68.9)         | 300   | 1 (0.3%)                 | 100% (20.7-100)   | 23 (7.7%)                     | 100% (85.7-100)   |
| fastapi               | 200        | 79.5% (73.4-84.5) | 74.5% (68.0-80.0)         | 148   | 25 (16.9%)               | 88.0% (70.0-95.8) | 5 (3.4%)                      | 100% (56.6-100)   |
| petclinic             | 106        | 93.4% (87.0-96.8) | 92.5% (85.8-96.1)         | 73    | 0                        | n/a               | 22 (30.1%)                    | 100% (85.1-100)   |

At the spec-0.10.0 defaults (0.6, 0.4, 0.6), for comparison
([`held-out@...@0.6-0.4-0.6.md`](../../cli/scripts/classify-eval/data/held-out@clef@cbm012-kind-tier0-qset2-spec012@0.6-0.4-0.6.md)):
the viewer's accept band is 19 cards (6.6%) at 84.2% (62.4-94.5) and its not-element band 50 (17.2%)
at 88.0% (76.2-94.4), against 45 at 86.7% and 104 at 88.5% in-sample.

What it says:

- **Clef generalises as far as these corpora can tell.** On code it was never fitted on, layer and
  end-to-end type accuracy match the in-sample pool within a point, and both bands are at least as
  precise as in-sample at either set of thresholds.
- **The evidence for the accept band is thin.** At the refitted defaults it is 4 cards of 290; its
  interval (51-100%) says little. The not-element band (23 cards, one real element hidden: an
  interface gold calls `application.dataobject`) says more.
- **Coverage is what the spec-0.12.0 criteria cost**, held out as in-sample: the agent's list loses
  about a tenth of the asked cards (1.4% accepted, 7.9% hidden), against two fifths on spec 0.10.0.

**Tier 0 on B5** (`tier0-report@viewer.md`): rules decide 10 cards (3.3%), 9 matching gold (the miss:
a props interface `tier0_component_props` rejects, gold `ux.librarycomponent`), and narrow 81 (27.0%)
with gold still reachable for 77 (95.1%; misses: `ErrorLogEntry` gold `apm.logrecord`, `Annotation`
and `Layer` gold `data-model.objectschema`, `paths` gold `api.paths`). In-sample, deciding rules match
gold 100% and narrowing keeps 95-100% reachable: Tier 0 holds up held out, a little below its
in-sample decide precision.

### The held-out test

`bands.ts` implements section 6's rule as a function of explicit targets:

- `TIER1_TARGETS = { typePrecision: 0.88, nonePrecision: 0.90 }`, **provisional**: the targets that
  reproduce the in-sample defaults (section 3). Decision 4 leaves them to the maintainer.
- `HELD_OUT_RULE = "within-interval"`: a band meets its target when the band's Wilson 95% interval
  on the viewer reaches it (upper bound >= target). Section 6 says the defaults count as held-out
  when the viewer corpus "meets the targets within its interval": the target is met if it lies
  within what the held-out sample allows, so a point estimate a little under the target passes when
  the shortfall is sampling error, and only a band whose whole interval is below the target fails.
  Requiring the lower bound to clear the target (`lower-bound`) would test something stronger, that
  the held-out precision is significantly above the target, which a band of a few dozen cards can
  hardly show at these targets (on 40 cards, 40 right gives a lower bound of 91.2%, 39 right 87.1%).
  Both are implemented; a band with no
  cards fails either way, since there is nothing to verify.
- `heldOutVerdict` and `verdictOf` take the targets and the rule; a default's `heldOut` record keeps
  the counts (cards and correct per band), not a verdict, so changing `TIER1_TARGETS` or the rule
  re-decides it, and a unit test fails if a default marked `held-out` no longer passes.

**Verdict** for Clef's `dr-qset-2` defaults (0.7, 0.5, 0.7) on the viewer (accept 4 of 4, not-element
22 of 23):

| Targets (type / none)         | `within-interval` | `lower-bound`               |
| ----------------------------- | ----------------- | --------------------------- |
| 0.85 / 0.90                   | held-out          | in-sample (both bands miss) |
| **0.88 / 0.90 (provisional)** | **held-out**      | in-sample (both bands miss) |
| 0.90 / 0.90                   | held-out          | in-sample (both bands miss) |
| 0.90 / 0.95                   | held-out          | in-sample (both bands miss) |

If the maintainer picks other targets, the thresholds would be refitted for them first (section 6's
table): 0.90 / 0.90 and 0.90 / 0.95 give (0.8, 0.5, 0.7), whose viewer accept band is 2 cards (both
right) and not-element band the same 23: `held-out` under `within-interval` again, `in-sample` under
`lower-bound`. With the spec-0.10.0 thresholds (0.6, 0.4, 0.6) the viewer gives `held-out` for
0.85-0.90 / 0.90 and `in-sample` for 0.90 / 0.95 (not-element 88.0%, upper bound 94.4%).

**So under the provisional targets Clef's defaults pass**, and they are marked `held-out` in a commit
of their own (rollout PR 8), which puts Clef in stage mode. Points for the maintainer before keeping
it:

- The accept band passes on 4 cards. A minimum number of band cards, or the `lower-bound` reading,
  would turn the verdict to `in-sample`; both are one-line changes (`HELD_OUT_RULE`, or a minimum in
  `meetsTarget`).
- Stage mode with these thresholds stages little (1.4% of asked cards on the viewer) and hides little
  (7.9%). Restoring the spec-0.10.0 curves (section 6, the modelling rules) is what would make it
  useful, and would need a new fit and a new B5 run (about $0.50 of Clef, no new labels).
- Dropping the marking commit keeps Clef in suggest mode with the refitted thresholds; nothing else
  in PR 8 depends on it.

## Limits

- **In-sample, and one held-out corpus.** The thresholds are fitted on three corpora and checked on
  one more of 290 asked cards; its accept band is a handful of cards (section 7).
- **Spec 0.12.0, and the modelling rules.** The runs since section 6 use the bundled spec 0.12.0;
  the earlier sections use 0.10.0. The layer criteria with the layers' modelling rules cost about 11
  points of layer accuracy (section 6); a change there needs a re-fit and a B5 re-run.
- **Neighbour lists in the committed cards.** The cards were built before the builder sorted, so a card
  with more than 12 callers or callees, or 15 imports, holds CBM's first 12 (15), and the measured
  `dr-qset-2` state sorts those rather than the alphabetically first of all. That affects 16 of the 521
  asked cards (dr-cli 10, fastapi 2, petclinic 4); every other card's measured state is exactly what
  production sends.
- **Other row-ordered lists.** Environment variables, routes handled, HTTP calls, inherits and
  implements keep CBM's row order in the card and the state, as the design specifies; a CBM reindex
  that reorders those rows still changes the state. Rare in the corpora, but a candidate for the next
  question set or card version.

## Spend

The `dr-qset-2` runs: dr-cli $0.33, fastapi $0.20, petclinic $0.09, $0.63 in all (Workers AI list
price for Clef). Everything else here reads committed predictions.

Rollout PR 8: the spec-0.12.0 re-measure $0.96 (dr-cli $0.53, fastapi $0.27, petclinic $0.16; the
longer layer criteria cost more per card), the modelling-rules diagnostic $0.52 (dr-cli $0.33,
fastapi $0.19), the viewer run $0.52: Clef $1.99 in all. Labelling the viewer: $11.16 at the
harness's prices (about $6.80 at Opus 5.5's cached-token price); the estimate's token counts are free.
