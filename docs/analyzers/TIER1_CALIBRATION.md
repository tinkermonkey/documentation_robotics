# Tier 1 calibration: band curves, default thresholds and `dr-qset-2` (2026-11-14)

Results of rollout PR 2 of [TIER1_DESIGN.md](TIER1_DESIGN.md) (section 9, item 2): the band
measurement of section 6, the in-sample defaults for Clef, and the paired measurement of question set
`dr-qset-2` (the line-free state, section 3.3) against `dr-qset-1`. Rollout PR 8 (2026-11-16) added
section 6, the re-measure on the spec the CLI bundles (0.12.0) and Clef's refitted defaults, and
section 7, B5: the held-out viewer corpus, the held-out test and its verdict. Section 8 (2026-11-16,
after rollout PR 8) splits the viewer gap between corpus, fit and labelling, and costs the next held-out
corpora; section 9 (the same day, after the maintainer approved that plan) gives the results: the
in-sample corpora relabelled with today's prompt, and three more held-out corpora labelled and
scored. Section 10 records the maintainer's decisions on the gold, the thresholds and the targets,
and the criteria proposal sent to Context Studio. Section 11 (2026-11-16) measures Claude Haiku 5.5
beside Clef on today's conditions, and agreement between the two as a gate. Section 12 (2026-11-17)
records the maintainer's rulings on the cards section 11 left open, and the re-measurement after
they landed in the spec: the Tier-0 interface rule rewritten, the gold revised, Clef re-run. Section
13 (the same day) labels and scores umami, the one corpus nothing had read.

All numbers are from the classify-eval harness (`cli/scripts/classify-eval/`) against the committed
gold labels, **model-asked cards only** (no Tier-0 rule, or a narrowing one): dr-cli 300, fastapi
148, petclinic 73, 521 pooled. Every run in sections 1-5 used spec 0.10.0 (`spec/dist` at bf34d9b8, through
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
- **Rollout PR 8: layer criteria leave out each layer's "Modelling rules:" paragraph**
  (`layerScopeCriterion` in `criteria.ts`; section 6). Since spec 0.11.0 those paragraphs tripled the
  layer criteria and cost Clef 11 points of layer accuracy; without them it is back to 88.9% pooled
  (90.1% on spec 0.10.0, a residual 8 lost / 1 gained, p = 0.039). Type criteria are unchanged: they
  carry no such paragraph.
- **Clef's `dr-qset-2` defaults are fitted on spec 0.12.0 with that rule: T_layer 0.6, T_type 0.4,
  T_none 0.6**, `in-sample` (section 6): 103 of 521 asked cards accepted at 94.2%, 105 hidden at
  95.2%. The fit is fragile: fastapi is one wrong card from missing each target, and a bootstrap
  picks these thresholds in 20% of resamples. `dr-qset-1 x clef` keeps its spec-0.10.0 record.
- **B5 (section 7): Clef stays `in-sample`.** On the viewer the defaults accept 55 of 290 asked cards
  at 83.6% (71.7-91.1) and hide 51 at 94.1% (84.1-98.0): under the held-out rule (both bands at least
  30 cards, Wilson lower bound at or above the targets) neither band passes, under any target set
  shown. Stage mode is built but no model is in it.
- **The held-out rule** (maintainer's decision on #1137): `HELD_OUT_RULE = "lower-bound"`,
  `HELD_OUT_MIN_CARDS = 30` per band, provisional `TIER1_TARGETS` 0.88 / 0.90; a `held-out` default
  also stages only for the serving and the criteria its held-out run had.
- **Section 8: the viewer gap matches UI client code in-sample.** fastapi's React `frontend/` ran at
  84.4% (27 of 32 accepted), the viewer at 83.6%, every other in-sample code 98.6% (70 of 71); the fit
  adds about 3 points of optimism to any in-sample figure.
- **Section 9: the accept band fails held out; the not-element band passes.** On four held-out
  corpora (viewer, jaeger-ui, miniflux, eshop; 1,101 asked cards) the defaults hide 233 cards at 98.3%
  (95.7-99.3), every corpus at 94% or more, and accept 127 at 65.4% (56.7-73.1), from 100% (miniflux, 4
  cards) to 43.9% (eshop, 57). Relabelled with today's prompt, the in-sample accept band falls from
  94.2% to 91.3% (the labelling confound is real, about 3 points), and the in-sample fit moves to (0.8,
  0.5, 0.6). Clef's accept band stays `in-sample`.
- **Hide mode (the maintainer's decision after section 9): Clef's not-element band is held-out
  verified.** Held-out status is per band, read over several corpora as `pooled-with-floor` (pooled
  lower bound at or above the target, no corpus's point estimate under it). Clef's `dr-qset-2`
  defaults carry the four-corpus record and `heldOutBands: ["not-element"]`, so Clef on Workers AI
  hides its not-element band without the agent and suggests its accept band (`modeOf` = `hide`).
- **Section 10 (the maintainer's decisions on section 9's open points).** The relabelled gold, with
  the "handlers" policy applied, is the in-sample `gold.jsonl` (October's is `gold@october.jsonl`).
  The refit to (0.8, 0.5, 0.6) is **not** adopted: it is a tie on 11 cards, and no case for it
  survives. Clef keeps (0.6, 0.4, 0.6), and its fit record is re-scored on the new gold (91.3% / 96.2%
  pooled). The targets stay 0.88 / 0.90. The type-boundary criteria changes went to Context Studio
  (proposal c2972281), pending review.
- **Decision models only stands, and no agreement gate** (section 11). Claude Haiku 5.5 with Tier 0
  and the kind rule is 17-19 points below Clef on end-to-end type accuracy on the viewer (54.7-57.0%
  against 74.0%) and 15-17 in-sample, mostly by placing `none` cards as elements. Clef and Haiku
  agreeing covers 2.5 times the accept band at lower precision (75-78% against 83.6% on the viewer).
- **Open, for the maintainer** (section 11): all 9 of the viewer's accept-band misses are TypeScript
  interfaces, and 7 are labelling questions (granularity, in-code interface against object schema)
  rather than clear model errors. Rulings on them say whether the held-out gap is Clef's or the
  gold's. Ruled 2026-11-17 (section 12).
- **Section 12 (the maintainer's rulings, 2026-11-17, and the re-measurement).** A declared shape is
  a `data-model.objectschema` whether or not it is persisted or published (every typed interface,
  and records, structs and dataclasses that only declare fields); a kept log is still an
  `apm.logrecord`; a language-level interface that declares a service's operations is the
  `application.applicationservice`; a message is one generic type, `application.message`. They
  landed in the spec through Context Studio (spec 0.13.0 plus, PR 1142). Tier 0's interface rule now
  narrows to those types, the gold carries the "declared-shape" revision (210 labels), and Clef was
  re-run on all seven corpora at the unchanged thresholds (0.6, 0.4, 0.6).
- **Hide mode stands on the new criteria.** The not-element band is 202 of 206 held out (98.1%,
  95.1-99.2), every corpus at 93.6% or more, so `heldOutBands: ["not-element"]` stays with the new
  record and criteria digest. **The accept band is still not verified**: 112 of 138 held out (81.2%,
  73.8-86.8), up from 83 of 127 (65.4%); eshop is 47 of 67 (70.1%). In-sample it is 99 of 107 (92.5%).
- **Section 13: umami, unread until the rules and criteria were fixed, accepts 42 of 42 and hides 25
  of 25**, the same against Opus's raw labels. The held-out record is now five corpora: not-element
  227 of 231 (98.3%, 95.6-99.3), verified; accept 154 of 180 (85.6%, 79.7-89.9), not verified, with
  eshop under the floor. umami's accepted cards are interfaces and route handlers, so it does not
  speak to eshop's service-side misses.

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

## 6. The bundled spec, 0.12.0, and the layer criteria rule (rollout PR 8)

Sections 1-5 used spec 0.10.0 (`--spec-dist` at bf34d9b8). Production sends the criteria of the
spec the CLI bundles, 0.12.0, so the `dr-qset-2` run was repeated on it (`--backend cloudflare:clef
--kind-narrow --tier0 --qset dr-qset-2`, no `--spec-dist`).

**The gold labels are still valid.** Every one of the 381 typed gold labels (dr-cli 208, fastapi 118,
petclinic 55) is a type of the current spec, as it was of 0.10.0; the 4 labels with a layer and no
type, and the 221 `none` labels, need nothing. The one type rename between the two specs
(`product.capability` to `product.softwarecapability`, in `RELATIONSHIP_REWRITE_TABLE.typeRenames`)
touches no gold label, and no gold label names a removed type. Tier 0 decided and narrowed exactly
the same cards on both specs.

### The regression, and its cause

On spec 0.12.0 as bundled (`clef@cbm012-kind-tier0-qset2-spec012`), paired against spec 0.10.0
(`clef@cbm012-kind-tier0-qset2`), all gold cards:

| Corpus    | Cards | Layer: 0.10.0 / 0.12.0 | lost / gained | p       | Type, end to end: 0.10.0 / 0.12.0 | lost / gained | p       |
| --------- | ----- | ---------------------- | ------------- | ------- | --------------------------------- | ------------- | ------- |
| dr-cli    | 300   | 89.7% / 73.7%          | 51 / 3        | < 0.001 | 77.3% / 63.7%                     | 45 / 4        | < 0.001 |
| fastapi   | 200   | 87.5% / 79.5%          | 16 / 0        | < 0.001 | 80.5% / 74.5%                     | 12 / 0        | < 0.001 |
| petclinic | 106   | 96.2% / 93.4%          | 4 / 1         | 0.375   | 94.3% / 92.5%                     | 3 / 1         | 0.625   |
| Pooled    | 606   | 90.1% / 79.0%          | 71 / 4        | < 0.001 | 81.4% / 72.3%                     | 60 / 5        | < 0.001 |

(Exact McNemar on the discordant cards; pooled with `compare.ts --corpus dr-cli,fastapi,petclinic`.)
44 of dr-cli's 51 lost cards are application symbols answered `none`. Track A appended a "Modelling
rules:" paragraph to every layer's description: which predicates the layer's elements use with
which others. It says how to connect elements, not which layer a symbol is in, and it tripled the
layer criteria Tier 1 sends (8,971 to 29,568 characters over the 13 layers): the charter effect of
Phase 0 again, relationship prose swamping the card.

**The fix (`criteria.ts`):** layer criteria are each layer's description up to its "Modelling rules:"
paragraph (`LAYER_RULES_MARKER`, `layerScopeCriterion`). A deliberate criteria rule, not a spec
change: the spec keeps the paragraphs, and the labelling prompt (`label.ts`'s spec reference) still
shows them whole. A description without the paragraph (spec 0.10.0 and earlier) is unchanged, so
the committed spec-0.10.0 runs still reproduce. `SpecCriteria.layerRules: "keep"` builds the old
criteria, for the `dr-qset-1` parity fixture captured from the harness. The criteria digest changes,
so every card misses Tier 1's cache once after the upgrade.

**Type criteria are left whole**: no type description carries a modelling-rules paragraph, the type
criteria grew 1.2% between the two specs (307,322 to 310,997 characters), and the 18 changed type
descriptions add "Use X instead when" sentences that tell siblings apart (for example
`application.dataobject` against `data-model.objectschema`), which is what type criteria are for.
Type-given-layer accuracy didn't move (pooled 474 cards, 0 lost / 0 gained against the regressed
run), so the evidence doesn't support cutting them.

**With the fix** (`clef@cbm012-kind-tier0-qset2-spec012-layercrit`; on dr-cli and fastapi it is card
for card the earlier diagnostic `clef@diag-spec012-norules`, as a deterministic model should be):

| Corpus    | Layer: 0.10.0 / fixed | lost / gained | p     | Type e2e: 0.10.0 / fixed | lost / gained | p     | Layer: 0.12.0 / fixed | lost / gained | p       | Type e2e: 0.12.0 / fixed | lost / gained | p       |
| --------- | --------------------- | ------------- | ----- | ------------------------ | ------------- | ----- | --------------------- | ------------- | ------- | ------------------------ | ------------- | ------- |
| dr-cli    | 89.7% / 88.0%         | 5 / 0         | 0.063 | 77.3% / 74.7%            | 9 / 1         | 0.021 | 73.7% / 88.0%         | 4 / 47        | < 0.001 | 63.7% / 74.7%            | 4 / 37        | < 0.001 |
| fastapi   | 87.5% / 86.5%         | 3 / 1         | 0.625 | 80.5% / 80.5%            | 1 / 1         | 1.000 | 79.5% / 86.5%         | 0 / 14        | < 0.001 | 74.5% / 80.5%            | 0 / 12        | < 0.001 |
| petclinic | 96.2% / 96.2%         | 0 / 0         | 1.000 | 94.3% / 94.3%            | 0 / 0         | 1.000 | 93.4% / 96.2%         | 1 / 4         | 0.375   | 92.5% / 94.3%            | 1 / 3         | 0.625   |
| Pooled    | 90.1% / 88.9%         | 8 / 1         | 0.039 | 81.4% / 80.0%            | 10 / 2        | 0.039 | 79.0% / 88.9%         | 5 / 65        | < 0.001 | 72.3% / 80.0%            | 5 / 52        | < 0.001 |

The fix recovers most of the loss (65 layer cards gained against 5 lost). Against spec 0.10.0 a
small pooled loss remains (8 / 1, p = 0.039; type 10 / 2, p = 0.039): 3 application symbols and 2
`ux` symbols still answered `none`, and 3 others. The layer criteria are now the same as 0.10.0's
except business and product, reworded for the capability split, so the residual is those two
layers, the 18 changed type descriptions, or both: a change to any text in the request can move a
few cards either way. Not chased further here.

### The fit

At the provisional targets (`fit-thresholds.ts --run clef@cbm012-kind-tier0-qset2-spec012-layercrit
--type-precision 0.88 --none-precision 0.9`, in-sample only), the defaults are **(0.6, 0.4, 0.6)**:

| Scope     | Accept: cards (coverage) | Type precision (95%) | Not-element: cards (coverage) | Precision (95%)   |
| --------- | ------------------------ | -------------------- | ----------------------------- | ----------------- |
| pooled    | 103 (19.8%)              | 94.2% (87.9-97.3)    | 105 (20.2%)                   | 95.2% (89.3-97.9) |
| dr-cli    | 53 (17.7%)               | 98.1% (90.1-99.7)    | 45 (15.0%)                    | 95.6% (85.2-98.8) |
| fastapi   | 48 (32.4%)               | 89.6% (77.8-95.5)    | 22 (14.9%)                    | 90.9% (72.2-97.5) |
| petclinic | 2 (2.7%)                 | 100% (34.2-100)      | 38 (52.1%)                    | 97.4% (86.5-99.5) |

**Tie-break.** No other grid point accepts the same 103 cards (`fit-thresholds.ts` now prints any
tie), so nothing was chosen by the tie-break here. The same band holds for any T_type in (0.399,
0.410] and T_layer in (0.598, 0.601]: the grid value 0.4 sits at the low edge of its range, and both
thresholds sit on a card's probability. The tie-break matters elsewhere: at 0.90 / 0.90 on the
uncorrected spec, (0.8, 0) to (0.8, 0.5) all accept the same 11 cards and the fit takes (0.8, 0.5),
the highest; a lower T_type there would accept the same cards on these corpora and more on new code,
so a tie there is a choice to make deliberately, not a measurement.

**Fragility** (`fit-stability.ts`,
[`fit-stability@...-layercrit.md`](../../cli/scripts/classify-eval/data/fit-stability@clef@cbm012-kind-tier0-qset2-spec012-layercrit.md)):

- fastapi decides it: its accept band (43 of 48) and not-element band (20 of 22) are each **0 wrong
  cards from missing** the target (one more wrong card in either and the fit moves); dr-cli has a
  margin of 5 and 2, the pool 6 and 5.
- Leaving a corpus out moves the accept thresholds: without dr-cli (0.6, 0.3), without fastapi
  (0.5, 0.4), without petclinic (0.6, 0.4).
- Over 1,000 bootstrap resamples (cards resampled within each corpus) the fit lands on (0.5, 0.4)
  in 32% (T_none 0.6 or 0.7), (0.6, 0.4) in 20%, (0.8, 0.5) in 9%, and T_none splits between 0.6
  and 0.7 about 60 / 40 among the common outcomes.

So (0.6, 0.4, 0.6) is a reasonable point, not a stable one: with three corpora and these targets,
the defaults are as much a property of which fastapi cards were sampled as of Clef.

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
over the $15 budget, because the system prompt is now 72,562 tokens; direct calls one after another
keep the cache warm, estimated at $11.08. The run used `--max-usd`, every request after the first
read the cache, and it cost $11.16 at the harness's prices (about $6.80 at Opus 5.5's cached-token
price). Only the transport and the price differ from a batch.

**Spot check** of 20 labels drawn at random (seed 7): all 20 follow the labelling instructions. Two
are borderline rather than wrong: `NavigationError` (a store's error-record interface) is `none` where
similar interfaces are `application.dataobject`, and `Credentials` (a small sub-component rendering
status chips) is `ux.componentinstance` where `none` would also fit. No label was revised.

**The labelling-process confound.** The viewer's gold comes from today's prompt (spec 0.12.0's
reference text, today's charter); the in-sample gold from October's. 50 in-sample cards (the first 17,
17 and 16 of each corpus's cards) relabelled with today's prompt (`gold@relabel-1116.jsonl`,
`gold-diff@relabel-1116.md` per corpus, $2.15) agree with the committed gold on layer for 42 (84.0%,
71.5-91.7) and on layer and type for 41 (82.0%). That is about one label in six moving, more than
October's baseline-to-charter relabelling (89-95% layer agreement), and it includes Opus's own
run-to-run variation, which was not measured separately. It doesn't favour Clef either way on these
cards: the fixed run gets 44 of the 50 layers right against either gold, and the type of 40 against
the old gold and 42 against the new. So held-out and in-sample accuracy are measured against labels
with roughly this much disagreement between them, and a few points of difference between them is
within it.

**Results** (`bun held-out.ts --run clef@cbm012-kind-tier0-qset2-spec012-layercrit`,
[`held-out@...-layercrit.md`](../../cli/scripts/classify-eval/data/held-out@clef@cbm012-kind-tier0-qset2-spec012-layercrit.md);
Clef, `dr-qset-2`, spec 0.12.0 with the layer criteria rule, defaults (0.6, 0.4, 0.6); Wilson 95%):

| Scope                 | Gold cards | Layer accuracy    | Type accuracy, end to end | Asked | Accept: cards (coverage) | Type precision    | Not-element: cards (coverage) | Precision         |
| --------------------- | ---------- | ----------------- | ------------------------- | ----- | ------------------------ | ----------------- | ----------------------------- | ----------------- |
| **viewer (held out)** | 300        | 83.3% (78.7-87.1) | 74.0% (68.8-78.6)         | 290   | 55 (19.0%)               | 83.6% (71.7-91.1) | 51 (17.6%)                    | 94.1% (84.1-98.0) |
| in-sample, pooled     | 606        | 88.9% (86.2-91.2) | 80.0% (76.7-83.0)         | 521   | 103 (19.8%)              | 94.2% (87.9-97.3) | 105 (20.2%)                   | 95.2% (89.3-97.9) |

The viewer run was made once, at these defaults, after the fit; nothing was tuned on it. What it says:

- **Layer and type accuracy are 5-6 points below the in-sample pool**, and the accept band's type
  precision is 10 points below it (83.6% against 94.2%), under the 0.88 target even as a point
  estimate. The not-element band holds (94.1%). Coverage is the same as in-sample, about a fifth of
  asked cards in each band.
- How much of the gap is the corpus (a React client, unlike the three in-sample codebases), the
  fragile fit (section 6) or the labelling confound (above) this one corpus can't separate.

The earlier B5 figures in this PR's history (at (0.7, 0.5, 0.7) on the uncorrected spec: 4 accepted,
all right; 23 hidden, 22 right) are superseded. The one real element hidden there was `paths` (an
interface gold labels `api.paths`, answered `none` at 0.81; also one of the four Tier-0 narrowing
misses below), not an application data object as an earlier draft said.

**Tier 0 on B5** (`tier0-report@viewer.md`): rules decide 10 cards (3.3%), 9 matching gold (the miss:
a props interface `tier0_component_props` rejects, gold `ux.librarycomponent`), and narrow 81 (27.0%)
with gold still reachable for 77 (95.1%; misses: `ErrorLogEntry` gold `apm.logrecord`, `Annotation`
and `Layer` gold `data-model.objectschema`, `paths` gold `api.paths`). In-sample, deciding rules match
gold 100% and narrowing keeps 95-100% reachable.

### The held-out test

`bands.ts` implements section 6 of the design as a function of explicit targets and a rule, settled
by the maintainer's decision on #1137:

- `TIER1_TARGETS = { typePrecision: 0.88, nonePrecision: 0.90 }`, still **provisional** (the targets
  that reproduce the in-sample defaults).
- `HELD_OUT_RULE = "lower-bound"`: a band meets its target when the whole Wilson 95% interval on the
  held-out corpus clears it (lower bound >= target). Stage mode stages and hides with no one looking,
  so the held-out corpus must show the precision is at least the target, not just that it might be.
  `within-interval` (upper bound >= target) stays as a documented alternative, shown by
  `held-out.ts` for comparison; it passed 4 cards of 4 in this PR's first draft, which is why it isn't
  the rule.
- `HELD_OUT_MIN_CARDS = 30` per band, under either reading. Why 30: under the lower-bound rule the
  smallest band that can clear 0.88 even with every card right is 29 (29/29 gives a lower bound of
  88.3%, 28/28 87.9%), so below 30 a verdict would rest on a perfect score alone; at 30 one wrong card
  already fails 0.88 (29/30: 83.3%); and a band of 30 has a Wilson half-width of about 9-11 points
  around 90-95%. It is the top of the 20-30 the review suggested; the not-element target (0.90)
  needs 35 cards, all right, in any case.
- A default's `heldOut` record keeps the counts (cards and correct per band), the **serving**
  (`provider`, `upstream`) and the **criteria digest** of the held-out run. `verdictOf` re-decides it
  from the counts, so the targets and the rule can change without a re-run. `tier1ModeFor`
  (`session.ts`) stages a `held-out` default only for the same serving (Clef on Workers AI is not
  Clef through OpenRouter's DeepInfra, at fp8) and while the criteria the CLI sends have the same
  digest; any other serving, a spec or criteria change, or a missing record gives suggest mode with
  a `modeReason`. A unit test fails if a default marked `held-out` no longer passes, or its digest is
  not the bundled criteria's.

**Verdict for Clef's `dr-qset-2` defaults on the viewer** (accept 46 of 55, not-element 48 of 51):

| Targets (type / none)         | `lower-bound` (the rule)                        | `within-interval` (alternative) |
| ----------------------------- | ----------------------------------------------- | ------------------------------- |
| 0.85 / 0.90                   | in-sample (both bands' bounds below)            | held-out                        |
| **0.88 / 0.90 (provisional)** | **in-sample** (accept 71.7%, not-element 84.1%) | held-out                        |
| 0.90 / 0.90                   | in-sample                                       | held-out                        |
| 0.90 / 0.95                   | in-sample                                       | held-out                        |

Both bands clear the 30-card minimum (55 and 51); both fail on the lower bound. **Clef stays
`in-sample`, and is not marked.** Stage mode is built, tested and documented, and no shipped model
is in it.

### What stage mode will need

A larger held-out corpus, or a second one, and a model whose held-out precision is clearly above the
targets. At Clef's held-out coverage (accept 19.0% and not-element 17.6% of asked cards):

- **The minimum size** needs few cards: 30 accepted cards at 19% coverage is about 160 asked cards,
  which the viewer already has (55).
- **The lower bound** is the real requirement. If Clef's held-out precision were what it is in-sample
  (accept 94.2%, not-element 95.2%), the accept band would need about 93 cards to clear 0.88 (about 490
  asked cards) and the not-element band about 113 to clear 0.90 (about 640 asked cards): **roughly 650
  asked cards, about two more viewer-sized corpora** beside this one. At 93% the accept band needs
  148 cards (about 780 asked); at 95%, 70 (about 370). At the viewer's measured 83.6%, no size passes.
- So the next held-out evidence should come with the criteria or question-set work that raises
  precision on code like the viewer's, and a corpus that size, labelled with today's prompt (so the
  labelling confound is gone), never read before it is scored.

## 8. Where the viewer gap comes from, and the next held-out corpora (2026-11-16)

Analysis of the committed predictions and labels only, no model calls:
`bun gap-analysis.ts --run clef@cbm012-kind-tier0-qset2-spec012-layercrit`
([`gap-analysis@...@viewer.md`](../../cli/scripts/classify-eval/data/gap-analysis@clef@cbm012-kind-tier0-qset2-spec012-layercrit@viewer.md)).
It reads the viewer's predictions and gold, so it looks at the held-out corpus, but nothing here
changes a Tier-0 rule, question set, criterion or threshold, and the decision points below keep it that
way.

The gap to explain, at the defaults (0.6, 0.4, 0.6): accept-band type precision 83.6% (46 of 55) on the
viewer against 94.2% (97 of 103) in-sample, Fisher exact p = 0.045. The not-element band is level
(94.1% against 95.2%), so this section is about the accept band.

### (a) The corpus: UI client code, which was in-sample already

fastapi is the full-stack template: its `frontend/` is a TypeScript/React client, 96 of fastapi's 148
asked cards. Split by code part:

| Code                  | Corpora                               | Accept (correct) | Type precision (95%) | Not-element (correct) | Precision (95%)   |
| --------------------- | ------------------------------------- | ---------------- | -------------------- | --------------------- | ----------------- |
| UI client, held out   | viewer                                | 55 (46)          | 83.6% (71.7-91.1)    | 51 (48)               | 94.1% (84.1-98.0) |
| UI client, in-sample  | fastapi `frontend/`                   | 32 (27)          | 84.4% (68.2-93.1)    | 18 (16)               | 88.9% (67.2-96.9) |
| Other code, in-sample | dr-cli, fastapi `backend/`, petclinic | 71 (70)          | 98.6% (92.4-99.8)    | 87 (84)               | 96.6% (90.3-98.8) |

- **UI client code runs at about 84% on two unrelated codebases**, one fitted on and one held out
  (together 73 of 87, 83.9%, 74.8-90.2); every other in-sample code at 98.6%. UI against other: p =
  0.002; viewer against fastapi's frontend: p = 1.0.
- **Re-weighting the in-sample precision to the viewer's accept band** by code part gives 84.4%, the
  observed 83.6%. By symbol kind it gives 96.5%, by predicted layer 98.1%, by predicted type 96.8%: the
  viewer doesn't accept different kinds of symbols, layers or types from the in-sample corpora; the
  same kinds are wrong more often in UI client code.
- **The in-sample 94.2% is a mix**: 31% of the in-sample accept band is UI client code at about 84%,
  69% other code at about 99%. Under the each-corpus scope fastapi passes at 89.6% because its backend
  half is 16 of 16; a corpus that is all UI client code measures the UI figure alone.
- **The two UI codebases fail differently.** fastapi's 5 wrong accepts are shadcn/ui wrappers
  (`TooltipProvider`, `DialogDescription`, `DropdownMenuShortcut`, `DropdownMenuSubContent`,
  `SidebarGroupAction`) accepted as `ux.librarycomponent`, gold `none` for 4. The viewer's 9 are all
  interfaces: 4 UI-local state and view types (`NavigationError`, `PageRow`, `ParsedViewportParam`,
  `ScopedViewport`) accepted as `application.dataobject`, gold `none`; 2 domain types (`Annotation`,
  `Layer`) as `application.dataobject`, gold `data-model.objectschema`, the boundary of dr-cli's one
  wrong accept (`BackupManifest`); `ErrorLogEntry`, gold `apm.logrecord`; 2 WebSocket messages as
  `application.applicationevent`, gold `application.dataobject`. Interfaces in UI client code hardly
  reach the model in-sample (1 of fastapi's 34 frontend interfaces; Tier 0 rejects the rest as
  generated code or component props), so
  the viewer's main error mode has no in-sample counterpart; dr-cli's interfaces are accepted at 96.6%
  (28 of 29).

"UI client" was the hypothesis the task named (a React client against Python, Java and CLI code), not
a split searched for on the viewer. It is defined by path here (the viewer whole, fastapi's
`frontend/`); production has no such flag.

### (b) The fit: about 3 points of optimism; the threshold point itself, under 1

- **Out-of-bag bootstrap** (1,000 resamples within each corpus): thresholds fitted on a resample
  score 93.4% on it and 90.3% on the in-sample cards it left out, **3.1 points** of optimism
  (not-element 2.0). Leaving a corpus out: fitted without dr-cli, dr-cli scores 86.1% at (0.6, 0.3);
  without fastapi, fastapi scores 86.2% at (0.5, 0.4).
- **The viewer across the in-sample fit's bootstrap distribution** (the thresholds the bootstrap
  picks, not a search on the viewer): 83.6-83.8% at the four commonest fits, (0.5 or 0.6) by (0.3 or
  0.4), 46% of resamples; 86.8-87.8% only at the rarer T_layer 0.7 and 0.8 fits; 84.2% weighted over
  all resamples. Which point the fragile fit landed on explains about 0.6 points.
- So a fair expectation for code like the in-sample corpora, at thresholds fitted this way, is about
  90-91%, not 94%. The optimism applies to every new corpus; on the viewer it is inside (a)'s
  interval, so this one corpus can't separate it from (a).

### (c) The labelling process: not detected, and if anything the other way

> **Superseded by section 9.** Relabelling all 606 in-sample cards shows the confound is real: the
> in-sample accept band falls from 94.2% to 91.3% against today's gold. The 50-card sample below was
> too small to see it.

- Of the 50 relabelled in-sample cards (section 7), 36 are model-asked: 7 land in the accept band and
  8 in the not-element band. Against October's gold Clef has 5 of 7 and 7 of 8 right; against today's,
  7 of 7 and 8 of 8. Fifteen cards measure nothing precisely, but the direction is the opposite of a
  confound that would explain the gap: today's prompt agrees with Clef more, not less.
- Where it could still matter: 4 of the viewer's 9 wrong accepts are `none` labels on UI-local types,
  the charter's granularity rule. If today's charter applies that rule more strictly than October's,
  the in-sample gold is more lenient there. The 50 cards hold no such case.
- The 1 label in 6 that moves between the two processes includes Opus's own run-to-run variation,
  which was never measured.

| Component             | Share of the 10.6-point accept gap                               | Evidence                                                    |
| --------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| (a) UI client code    | all of it, within the intervals: 84.4% predicted, 83.6% observed | fastapi's frontend, in-sample; p = 0.002 against other code |
| (b) Fit optimism      | about 3 points for any new corpus; the fit's point, about 0.6    | in-sample bootstrap and leave-one-out                       |
| (c) Labelling process | not detected; 15 band cards favour Clef under today's prompt     | 50 relabelled in-sample cards                               |

The three don't add: (a) accounts for the gap on its own; (b) is how much any in-sample figure
overstates out-of-sample precision, and would show on a held-out corpus of non-UI code.

**Relabelling the in-sample corpora with today's prompt** removes (c) for every later fit: `label.ts
--sync --charter --tag relabel-full`, estimated with `--estimate` at dr-cli $11.23, fastapi $7.29,
petclinic $3.99, **$22.51** at the harness's prices. The thresholds would then be re-fitted, in-sample,
on the new gold; the viewer's verdict doesn't change (its gold is already today's prompt). Labelling the
same 50 cards a second time with today's prompt (about $2.15) separates the prompt change from Opus's
run-to-run noise.

### What the held-out evidence needs, recomputed

Section 7's 650 asked cards assumed in-sample precision (94.2% accept, 95.2% not-element). The cards a
band needs for its Wilson lower bound to reach the target, by the band's true precision:

| Accept precision        | 94.2% | 93% | 92% | 91.1% | 90.3% | 84% (UI client) |
| ----------------------- | ----- | --- | --- | ----- | ----- | --------------- |
| Accepted cards for 0.88 | 93    | 148 | 231 | 398   | 736   | none passes     |

| Not-element precision | 95.2% | 94.8% | 94.1% |
| --------------------- | ----- | ----- | ----- |
| Hidden cards for 0.90 | 113   | 140   | 192   |

- At the optimism-corrected 90-91%, the accept band needs 400-740 accepted cards, 2,000 to 3,900
  asked: far more than 650.
- **Pooled held-out corpora won't pass while UI code is a fifth or more of them.** The viewer, one
  more UI client corpus at 84%, and two other-code corpora (about 517 asked) at in-sample other-code
  precision (98.6%) pool to about 178 of 197 accepted, 90.4%, lower bound 85.4%: a fail. At 95% on the
  other code, 83.7%.
- Other code alone could pass: about 86 accepted cards at 98.6% give a lower bound of 93.7%; at 95%,
  88.6%. Its not-element band (about 106 cards at 96.6%) reaches 90.7%, just over 0.90.

So more corpora answer "how precise is Clef, by kind of code" precisely, but stage mode for Clef needs
one of: precision on UI client code raised by criteria or question-set work (judged in-sample, and the
in-sample set has only 32 UI accepted cards); a stage mode scoped away from UI client code by a
structural signal fitted in-sample; or other targets. Those are the maintainer's decisions below.

### Candidate corpora

(jaeger-ui, miniflux and eshop were then labelled and scored: section 9. umami stays a candidate.)

Four candidates are built (cards and facts by `cards.ts` and `facts.ts`, card version 2, seed 42, the
default exclusions, CBM 0.12.1, shallow clones on 2026-11-16) and committed **unlabelled and
unclassified**, `held_out: true` and `candidate: true` in their `meta.json`, so the sample is fixed
before anything is scored. None was read. All are under permissive licenses (the cards hold source
excerpts). Model-asked counts are under today's Tier-0 rules (free; the in-sample and viewer counts
reproduce):

| Corpus    | Repository @ commit, scope                                   | Stack                                                               | License    | Cards: class / interface / function / method / module / route | Tier 0 decides / narrows | Model-asked | Labelling (sync est.) | Clef (est.) |
| --------- | ------------------------------------------------------------ | ------------------------------------------------------------------- | ---------- | ------------------------------------------------------------- | ------------------------ | ----------- | --------------------- | ----------- |
| jaeger-ui | jaegertracing/jaeger-ui @ d6bbc164, `packages/jaeger-ui/src` | React SPA (TypeScript, some JS), Redux: a UI client like the viewer | Apache-2.0 | 17 / 56 / 78 / 72 / 77 / 0                                    | 6 / 50                   | 294         | $10.99                | $0.35       |
| miniflux  | miniflux/v2 @ fb043227, `internal`                           | Go: HTTP handlers, PostgreSQL storage, API, server-rendered UI      | Apache-2.0 | 33 / 4 / 129 / 129 / 5 / 0                                    | 83 / 4                   | 217         | $10.82                | $0.26       |
| eshop     | dotnet/eShop @ 913acea6, `src`                               | C#/.NET: microservices, minimal APIs, EF Core, gRPC, Blazor         | MIT        | 68 / 42 / 40 / 67 / 67 / 16                                   | 0 / 42                   | 300         | $10.71                | $0.36       |
| umami     | umami-software/umami @ b18d5144, `src`                       | Next.js full stack in TypeScript: React UI, API routes, Prisma      | MIT        | 1 / 98 / 98 / 5 / 98 / 0                                      | 31 / 68                  | 269         | $10.81                | $0.32       |

- **Labelling** is `label.ts --estimate --charter`'s `--sync` figure at the harness's prices (the
  system prompt is 72,562 tokens; a Batch API run is about $35 a corpus at the committed sets'
  cache-hit rate, so direct calls stay cheaper). The viewer came in within 1% of its estimate ($11.16
  against $11.08) and was billed at about 60% of it (Opus 5.5's cached-token price). Run with
  `--max-usd` per corpus.
- **Clef** at the layercrit runs' $0.0012 per asked card (the viewer's 290 cost $0.35).
- **Recommended: jaeger-ui, miniflux and eshop**: a second UI client to test (a) on fresh code, and two
  stacks no corpus has (Go, C#) for code outside a UI. 811 asked cards; $32.52 labelling and about
  $0.97 Clef. umami is the alternate or a fourth ($11.13): it mixes UI and server code in one corpus,
  so a by-code-part reading needs a path rule, as fastapi's `frontend/` did.
- **With the in-sample relabel** ($22.51) and the 50-card repeat ($2.15), the whole proposal is about
  **$58** at the harness's prices (about $35 billed), plus $11 with umami.

### Decision points for the maintainer

1. **Relabel the in-sample corpora with today's prompt** ($22.51, and $2.15 for the 50-card repeat),
   then re-fit the defaults in-sample on the new gold? It removes the labelling confound for good.
2. **Which held-out corpora, and the budget**: jaeger-ui, miniflux and eshop recommended ($33.49 with
   Clef), umami optional; keep the candidates not chosen committed (a fixed sample) or drop them.
3. **How a verdict reads several held-out corpora**: pooled (a UI-heavy failure can hide inside a
   pass, or sink one), each corpus on its own (each then needs 400 or more accepted cards at realistic
   precision), or pooled with no corpus's point estimate under the target. The rule today speaks of
   one held-out corpus.
4. **What to do about UI client code**: criteria or question-set work for it, a stage mode scoped away
   from it (by a structural signal fitted in-sample), or suggest mode there. The viewer's 9 wrong
   accepts are now known, so work aimed at UI interfaces should be judged on a fresh UI corpus
   (jaeger-ui, or one not yet sampled), with the viewer counted as seen for that purpose.
5. **The targets**, still provisional at 0.88 type precision and 0.90 not-element precision: a point
   of target moves the cards needed by hundreds (the table above).

## 9. Results: the in-sample relabel and three more held-out corpora (2026-11-16)

The maintainer approved section 8's plan (about $58). It cost **$57.16** at the harness's prices,
with no failed request: labelling $56.23 and Clef $0.94 (itemised under Spend). The labelling prompt
is the viewer's: `label.ts --sync --charter`, Opus 5.5 at effort high, the spec 0.12.0 reference
text and today's charter. Clef runs are the viewer's configuration (`--backend cloudflare:clef
--kind-narrow --tier0 --qset dr-qset-2`, spec 0.12.0 with the layer criteria rule, criteria digest
`e069521f…`), tag `cbm012-kind-tier0-qset2-spec012-layercrit`. `bands.ts` is unchanged.

### The in-sample relabel

`gold@relabel-full.jsonl` in each in-sample corpus, beside October's `gold.jsonl`, which stays (the
committed fits and fit records refer to it). Every harness script that scores in-sample cards takes
`--gold relabel-full` (`report.ts --bands`, `fit-thresholds.ts`, `fit-stability.ts`, `held-out.ts`,
`gap-analysis.ts`).

- **Agreement with October's gold**: layer 563 of 606 (92.9%, 90.6-94.7), layer and type 536 (88.4%);
  dr-cli 95.7% / 90.7%, fastapi 91.5% / 85.5%, petclinic 87.7% / 87.7% (`gold-diff@relabel-full.md`
  per corpus). The 50 cards of section 7 (84% layer agreement) were a volatile sample, not a typical
  one.
- **Opus repeats itself**: the same 50 cards labelled again with today's prompt agree on 50 layers and
  49 types (`gold-diff@relabel-1116b.md`). The differences are the prompt, not run-to-run noise.
- **What moved**: 25 cards to `api` (17 from `application`, 8 from `none`: route handlers and
  generated API-client methods, now `api.operation` under spec 0.12.0's API layer text), 9
  `application` to `none`, 4 `application` to `data-model`.
- **Clef against the new gold** at the defaults: pooled layer accuracy 84.5% (88.9% against
  October's), accept band 103 cards at **91.3%** (84.2-95.3; was 94.2%), not-element 105 at 96.2%
  (was 95.2%). fastapi's accept band is 42 of 48, **87.5%, under the 0.88 target by one card**, the
  fragility section 6 measured. So section 8's (c) was wrong: the labelling process is worth about 3
  points of in-sample accept precision, of the 10.6-point viewer gap.
- **On the new gold**, UI client code in-sample is 81.3% (26 of 32), other in-sample code 95.8% (68 of
  71); the viewer's 83.6% is still the UI figure. The out-of-bag optimism grows to 5.1 points (92.7%
  in-bag, 87.6% out-of-bag; [`gap-analysis@...@viewer@gold-relabel-full.md`](../../cli/scripts/classify-eval/data/gap-analysis@clef@cbm012-kind-tier0-qset2-spec012-layercrit@viewer@gold-relabel-full.md)).
- **Refitted on the new gold** at the same targets (`fit-thresholds.ts --gold relabel-full`):
  **(0.8, 0.5, 0.6)**, accepting 11 cards (2.1% of asked; the tie from (0.8, 0) to (0.8, 0.5)), all
  right; not-element unchanged. Bootstrap: (0.8, 0.5) in 29% of resamples, (0.6, 0.4) in 27%, (0.8,
  0.6) in 17%, (0.5, 0.4) in 14%. Band curves:
  [`bands@...@gold-relabel-full.md`](../../cli/scripts/classify-eval/data/bands@clef@cbm012-kind-tier0-qset2-spec012-layercrit@gold-relabel-full.md).

### Three more held-out corpora

jaeger-ui, miniflux and eshop (section 8's table): labelled, classified once at the defaults, scored
with `held-out.ts --corpus <c> --gold relabel-full` (`held-out@...@<corpus>@gold-relabel-full.md`).
Nothing was tuned on them. At the defaults (0.6, 0.4, 0.6), Wilson 95%:

| Corpus     | Stack        | Model-asked | Layer accuracy (gold cards) | Type, end to end | Accept: cards (coverage) | Type precision        | Not-element: cards (coverage) | Precision             |
| ---------- | ------------ | ----------- | --------------------------- | ---------------- | ------------------------ | --------------------- | ----------------------------- | --------------------- |
| viewer     | React client | 290         | 83.3% (78.7-87.1)           | 74.0%            | 55 (19.0%)               | 83.6% (71.7-91.1)     | 51 (17.6%)                    | 94.1% (84.1-98.0)     |
| jaeger-ui  | React SPA    | 294         | 83.7% (79.1-87.4)           | 74.7%            | 11 (3.7%)                | 72.7% (43.4-90.3)     | 86 (29.3%)                    | 100% (95.7-100)       |
| miniflux   | Go           | 217         | 80.7% (75.8-84.7)           | 79.0%            | 4 (1.8%)                 | 100% (51.0-100)       | 52 (24.0%)                    | 98.1% (89.9-99.7)     |
| eshop      | C#/.NET      | 300         | 79.3% (74.4-83.5)           | 63.7%            | 57 (19.0%)               | 43.9% (31.8-56.7)     | 44 (14.7%)                    | 100% (92.0-100)       |
| **pooled** |              | **1,101**   |                             |                  | **127 (11.5%)**          | **65.4% (56.7-73.1)** | **233 (21.2%)**               | **98.3% (95.7-99.3)** |

- **The not-element band holds on every stack.** 229 of the 233 hidden cards are `none` in gold:
  lower bound 95.7%, clear of 0.90 and of 0.95, about 4 real elements hidden per 1,000 asked cards.
  Every corpus's point estimate is 94.1% or more; on its own, the viewer's lower bound (84.1%) and
  miniflux's (89.9%) are under 0.90, jaeger-ui's (95.7%) and eshop's (92.0%) over.
- **The accept band fails, and section 8's forecast for non-UI code was wrong.** eshop, C# with no UI
  client in the accepted cards' kinds, accepts 57 cards at 43.9%. Its errors are mostly type choices
  inside the right layer (layer precision 78.9%, 45 of 57): 12 answered `application.applicationinterface`
  where gold says `application.applicationservice`, 6 `data-model.objectschema` where gold says
  `application.dataobject`, 4 `application.dataobject` where gold says `application.applicationevent`;
  16 of its 31 accepted interfaces are wrong. These are counts by type, from the predictions and gold;
  the cards themselves weren't read.
- UI client code held out (viewer and jaeger-ui) is 81.8% (54 of 66), other code held out (miniflux and
  eshop) 47.5% (29 of 61). "UI client code" explained the viewer; it doesn't explain the accept band
  in general. Accept precision depends on a codebase's conventions (here, how C# declares service
  contracts) more than on whether it is a UI.
- jaeger-ui and miniflux rarely reach the accept band (3.7% and 1.8% of asked cards): Clef is seldom
  confident about their types, so they say little about it.
- **Higher accept thresholds don't rescue it.** At the relabelled in-sample fit, (0.8, 0.5, 0.6), the
  pooled held-out accept band is 14 of 26 (53.8%), eshop 7 of 18.

**Verdict, band by band.** Pooled over the four held-out corpora under `HELD_OUT_RULE` and the
provisional targets: accept fails (lower bound 56.7%), not-element passes (95.7%). With both bands
required (the rule when this section was first written) Clef would stay `in-sample`.

### Hide mode (the maintainer's decision, 2026-11-16)

The maintainer chose decision points 1 and 2 below: held-out status is per band, and several
held-out corpora are read **pooled with a per-corpus floor** (`HELD_OUT_POOLING =
"pooled-with-floor"` in `bands.ts`): the band pooled over the corpora meets the lower-bound rule, and
no corpus's point estimate for it is under the target. Clef's not-element band passes that (pooled
229 of 233, lower bound 95.7%; the lowest corpus, the viewer, at 94.1%), so its `dr-qset-2` defaults
carry `heldOutBands: ["not-element"]` and the four-corpus record, and Clef on Workers AI, with the
criteria this CLI sends, is in **hide mode**: `codebase_extract` hides the not-element band without the
agent, and the accept band stays a suggestion for `acceptTier1`. `dr analyzer tier1 set mode suggest`
turns the hiding off; another serving (OpenRouter) or a criteria change returns suggest mode, as for
stage mode.

`bun held-out.ts --run clef@cbm012-kind-tier0-qset2-spec012-layercrit --corpus viewer,jaeger-ui,miniflux,eshop --gold relabel-full`
([`held-out@...@viewer+jaeger-ui+miniflux+eshop@gold-relabel-full.md`](../../cli/scripts/classify-eval/data/held-out@clef@cbm012-kind-tier0-qset2-spec012-layercrit@viewer+jaeger-ui+miniflux+eshop@gold-relabel-full.md))
prints the record and the mode under each target set, rule and pooling. The not-element band gives
hide mode under every combination shown except `each-corpus` with the lower bound (the viewer and
miniflux miss 0.90 alone) and, under `pooled-with-floor`, a 0.95 target (the viewer's 94.1%).

What hiding costs: at T_none 0.6, about a fifth of asked cards leave the agent's list (21.2% held
out), and about 4 per 1,000 asked cards are real elements gold would have kept (4 of 1,101: the viewer's
`postapichangesetschangesetIddiscard`, `DeleteAnnotationInput` and `paths`, and one miniflux card).
`unchanged.tier1NotElementCards` names every hidden card, and `tier1: false` shows them as cards.

### Decision points

Decided: 1 and 2 (hide mode, `pooled-with-floor`). Open:

3. **The in-sample gold**: make `gold@relabel-full.jsonl` the in-sample gold, so fits and held-out
   corpora share one labelling process, and adopt its refit (0.8, 0.5, 0.6), which accepts about 2% of
   asked cards; or keep (0.6, 0.4, 0.6), which only ranks suggestions while the accept band is in
   suggest mode, with its record as it is. T_none is 0.6 under both, so hide mode is unaffected.
4. **The accept band's type boundaries** (`applicationinterface` against `applicationservice`,
   `objectschema` against `dataobject`, `dataobject` against `applicationevent`): type criteria are the
   spec's descriptions, so work on them goes through Context Studio. Judge it in-sample and on a
   held-out corpus not used yet; the error counts of the viewer and eshop are now known.
5. **The targets**, still provisional at 0.88 / 0.90. Under `pooled-with-floor` a not-element target
   of 0.95 would end hide mode (the viewer's point estimate is 94.1%).
6. **umami** stays an unlabelled candidate, unread, for that later check.

## 10. The in-sample gold, the thresholds, the targets and the criteria proposal (2026-11-16)

The maintainer's answers to section 9's open points: replace the in-sample gold and adopt its refit
"as long as there is a compelling case and no blockers"; send the type-boundary proposal to Context
Studio; and don't set the targets too high, "keep it reasonable".

### The gold: replaced

The case holds. One labelling process now produces the in-sample and the held-out gold. The
difference between the two prompts is measured (the repeat agrees 50 of 50), and nothing depends on
October's labels except the records that say so.

One blocker was found and cleared on the way. Today's prompt files route handlers as `api.operation`
(15 in-sample cards), which the "handlers" labelling policy (maintainer, 2026-11-03; `gold-revise.ts`)
reverses: the Route is the API operation, and the handler is the application function it realizes.
The revision was applied to the relabel before it became `gold.jsonl`. It changes Tier-0-decided
cards only, so no band moves. None of the four held-out corpora needed it.

- `gold.jsonl` in dr-cli, fastapi and petclinic: the relabel with the handlers revision.
  `gold@october.jsonl`: October's labels. `gold-diff@october.md` per corpus. Agreement with October:
  layer 578 of 606 (95.4%), layer and type 551 (90.9%).
- At (0.6, 0.4, 0.6): pooled layer accuracy 87.0%; accept 103 at 91.3% (84.2-95.3); not-element 105 at
  96.2% (90.6-98.5); fastapi's accept band 42 of 48 (87.5%).
- `--gold october` reproduces sections 1-8. `label.ts --estimate` keeps calibrating on October's
  Batch-labelled usage, since the direct-call relabel reads the cache on nearly every request.

### The thresholds: kept at (0.6, 0.4, 0.6), not refitted

The each-corpus fit on the new gold, (0.8, 0.5, 0.6), has no compelling case:

- **It is a tie, not a measurement.** (0.8, 0) through (0.8, 0.5) accept the same 11 cards, and the
  fit takes the highest T_type by its tie-break (the case section 6 warned about).
- **It moves for one card.** At (0.6, 0.4) fastapi's band is 42 of 48, 87.5%, one card under 0.88.
  That one card is what moves T_layer to 0.8, the fragility section 6 measured.
- **It nearly empties the band.** Coverage falls from 19.8% to 2.1% of asked cards. While the accept
  band is in suggest mode, the threshold only decides which suggestions the agent sees first and can
  confirm together with `acceptTier1`; at 0.8 there would be almost none.
- **The resamples don't prefer it.** It is the bootstrap's pick in 29% of resamples, against 27% for
  (0.6, 0.4).
- **The curve is not monotone above T_layer 0.6.** (0.6, 0.4) holds 91.3%; every other point at
  T_layer 0.6 or 0.7 is 84-89%; T_layer 0.8 jumps to 100% on 11 cards. Clef's type probabilities
  separate right from wrong poorly in this range, so a higher threshold buys coverage loss, not
  reliable precision.

The pooled fit, (0.5, 0.4), accepts 153 cards at 88.9%, which just meets 0.88 pooled while fastapi
falls to 82.8%. Clef's `dr-qset-2` defaults therefore stay (0.6, 0.4, 0.6). Their fit record is
re-scored on the new gold (`gold: "2026-11-16"`, `targets.scope: "pooled"`, accept 0.913, not-element
0.962) with a `note` saying why they were kept rather than refitted. T_none is 0.6 under every fit, so
hide mode and the held-out record are unaffected. For transparency, not as a reason: on the held-out
corpora the refit accepts 14 of 26 (53.8%) against 83 of 127 (65.4%) at the defaults.

### The targets: 0.88 / 0.90, not raised

`TIER1_TARGETS` stays at 0.88 type precision and 0.90 not-element precision. Its comment now records the
maintainer's choice instead of "provisional". At 0.95 under `pooled-with-floor` the not-element band
would fail on the viewer's 94.1%, and hide mode would end.

### The criteria proposal: in Context Studio for review

Proposal **c2972281-618a-43e7-8d59-8215b7c558cd** on the Documentation Robotics taxonomy, drafted
against spec 0.12.0 at 159a5013. It has five editorial operations (descriptions, `distinguish_from`,
evidence signals) and no type, attribute or relationship changes:

| Class                | Boundary                                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ApplicationInterface | a language-level interface or DI contract declaring a service's operations is not an access point "because of the keyword"; the ApplicationService clause names it                                                                                     |
| ApplicationService   | "in code a service is often declared as a language-level interface or dependency-injection contract ... that declaration is the service"                                                                                                               |
| DataObject           | "method contract" no longer listed as an access point; an occurrence record published to a bus is an event even with fields only; a client's copy of a remote response type stays a data object; adds the ObjectSchema entry to `distinguish_from`     |
| ApplicationEvent     | publication, not behaviour, makes it an event; an `...IntegrationEvent` evidence signal                                                                                                                                                                |
| ObjectSchema         | fixes a contradiction: an evidence line filed any "DTO or request/response payload" as an object schema against its own description and DataObject's; it now names an API this codebase serves, or a type generated from or validated against a schema |

These target eshop's errors (12 interface-for-service, 6 objectschema-for-dataobject, 4
dataobject-for-event) and the viewer's two objectschema cards. **Before it lands, review should
know:**

- **It changes the criteria digest.** Clef's held-out verdict goes stale, and hide mode returns to
  suggest mode until the held-out runs are repeated: about $1.40 of Clef calls on the four corpora and
  $0.60 in-sample.
- **It can't be judged on eshop or the viewer**, whose errors shaped it. Judge it in-sample and on a
  held-out corpus not used yet: umami is built, unread and unlabelled (about $11 to label).
- **It lands through the usual export** (`cs-dr-spec-changes`), then `npm run build:spec` and the
  CLI build.

## 11. A Claude baseline on today's conditions, and agreement as a gate (2026-11-16)

**Why.** Context Studio, which extracts individuals of the same DR types from text, measured Claude
Haiku 5.5 typing a given mention better than Clef (about 80% against 75%), and found that where the
two agreed (63-64% of mentions) they were about 90% right
(`documentation/extraction/experiments/2026-11-13-typing-and-decision-model-probes.md` in
tinkermonkey/context-studio). DR's only Claude runs were Phase 0's (2026-10-24: spec 0.10.0, no Tier 0,
no kind narrowing, effort low), and decision 9 of TIER1_DESIGN.md (decision models only) rests on
them. Two questions: is Haiku 5.5 at least as good as Clef on code cards today, and is "Clef and a
second model agree" a better accept gate than Clef's own bands?

**Decision rule**, set before the paid runs:

- _Haiku against Clef_: end-to-end type accuracy on every gold card, paired (exact McNemar), the
  viewer deciding and the in-sample pool beside it. Haiku is "at least as good" unless it is
  significantly worse.
- _Agreement as a gate_: worth building if, on the viewer, the cards both models place as the same
  element cover at least 1.5 times Clef's accept band (83 of 290 asked cards) at a type precision
  no lower than the band's (83.6%); it passes outright only under the held-out rule of section 7.

**Method.** `claude-haiku-5-5` through the harness's Claude backend: one structured-output call per
card (layer, type, significance, concerns, self-reported confidences), effort medium, the bundled
spec 0.12.0's reference text as a cached system prompt (about 71,000 tokens), the `dr-qset-1` state.
So the comparison is on Clef's terms, `classify.ts` now gives a Claude backend the same structural
help: `--tier0` lets deciding rules answer and sends a narrowing rule's candidates as a note after
the state, and `--kind-narrow` sends the kind rule's application types the same way
(`narrowingNote` in `lib/tier0.ts`). Two takes on all four corpora, and a control on the viewer
without the kind note. Clef is the run of section 7.

```bash
for c in viewer dr-cli fastapi petclinic; do for t in t1 t2; do
  bun classify.ts --corpus $c --backend claude-haiku --effort medium --kind-narrow --tier0 \
    --tag cbm012-kind-tier0-spec012-$t --max-usd 0.40
done; done
bun classify.ts --corpus viewer --backend claude-haiku --effort medium --tier0 \
  --tag cbm012-tier0-spec012-nokindnote --max-usd 0.40        # the control
bun agreement-report.ts --a clef@cbm012-kind-tier0-qset2-spec012-layercrit \
  --b claude-haiku@cbm012-kind-tier0-spec012-t1 --b2 claude-haiku@cbm012-kind-tier0-spec012-t2
bun agreement-report.ts --a clef@cbm012-kind-tier0-qset2-spec012-layercrit \
  --b claude-haiku@cbm012-tier0-spec012-nokindnote
```

`agreement-report.ts` reads the committed predictions (no model calls) and writes
[`agreement@claude-haiku@cbm012-kind-tier0-spec012-t1.md`](../../cli/scripts/classify-eval/data/agreement@claude-haiku@cbm012-kind-tier0-spec012-t1.md)
and
[`agreement@claude-haiku@cbm012-tier0-spec012-nokindnote.md`](../../cli/scripts/classify-eval/data/agreement@claude-haiku@cbm012-tier0-spec012-nokindnote.md),
with every corpus's tables.

### Accuracy

Every gold card, rule-decided cards included; a failed call counts as wrong (Wilson 95%):

| Scope             | Cards | Run          | Layer             | Type, end to end  | Type against Clef: lost / gained | p       |
| ----------------- | ----- | ------------ | ----------------- | ----------------- | -------------------------------- | ------- |
| viewer (held out) | 300   | Clef         | 83.3% (78.7-87.1) | 74.0% (68.8-78.6) |                                  |         |
|                   |       | Haiku take 1 | 66.3% (60.8-71.4) | 54.7% (49.0-60.2) | 85 / 27                          | < 0.001 |
|                   |       | Haiku take 2 | 68.3% (62.9-73.3) | 57.0% (51.3-62.5) | 79 / 28                          | < 0.001 |
| in-sample, pooled | 606   | Clef         | 88.9% (86.2-91.2) | 80.0% (76.7-83.0) |                                  |         |
|                   |       | Haiku take 1 | 70.5% (66.7-74.0) | 63.0% (59.1-66.8) | 152 / 49                         | < 0.001 |
|                   |       | Haiku take 2 | 72.4% (68.8-75.8) | 65.3% (61.5-69.0) | 136 / 47                         | < 0.001 |

Haiku is significantly worse on every corpus (dr-cli and petclinic p < 0.001; fastapi p < 0.001 and
0.008 for the two takes). What it gets wrong is `none`: it places 81 of the viewer's 108 gold `none`
cards as elements (Clef 20) and 134 of the in-sample 182 (Clef 9), while answering `none` for few
real elements (6 of 182 on the viewer; Clef 17). Between its two takes 15.2% of the viewer's asked
cards and 13.1% of the in-sample ones change layer or type.

**The control.** Without the kind note Haiku scores the same on the viewer (layer 64.3%, end-to-end
type 56.0%; against Clef 79 lost / 25 gained, p < 0.001) and still places 59 of the 108 gold `none`
cards as elements, so the note explains part of the over-labelling and none of the gap.

### Gates on the viewer's 290 asked cards

| Gate                                    | Placed as an element (coverage) | Right             | Placed as none (coverage) | Right             |
| --------------------------------------- | ------------------------------- | ----------------- | ------------------------- | ----------------- |
| Clef's bands (0.6 / 0.4 / 0.6)          | 55 (19.0%)                      | 83.6% (71.7-91.1) | 51 (17.6%)                | 94.1% (84.1-98.0) |
| Clef and Haiku take 1 agree             | 137 (47.2%)                     | 75.2% (67.3-81.7) | 29 (10.0%)                | 86.2% (69.4-94.5) |
| Clef and Haiku take 2 agree             | 134 (46.2%)                     | 78.4% (70.6-84.5) | 31 (10.7%)                | 93.5% (79.3-98.2) |
| Clef and both takes agree               | 122 (42.1%)                     | 78.7% (70.6-85.0) | 26 (9.0%)                 | 92.3% (75.9-97.9) |
| Clef's bands, where Haiku take 1 agrees | 52 (17.9%)                      | 84.6% (72.5-92.0) | 22 (7.6%)                 | 95.5% (78.2-99.2) |
| The two Haiku takes agree               | 216 (74.5%)                     | 55.1% (48.4-61.6) | 29 (10.0%)                | 89.7% (73.6-96.4) |
| Haiku's own confidence >= 0.8           | 28 (9.7%)                       | 60.7% (42.4-76.4) | 22 (7.6%)                 | 90.9% (72.2-97.5) |
| Control: Clef and Haiku agree           | 106 (36.6%)                     | 80.2% (71.6-86.7) | 52 (17.9%)                | 94.2% (84.4-98.0) |

- **Agreement more than doubles the accept band's coverage and lowers its precision**: 75-80% against
  83.6% on the viewer, and 86.6% against 94.2% in-sample (231 cards against 103). It fails the rule
  on precision, and no agreement gate comes near the held-out rule's 0.88 lower bound.
- **A second opinion doesn't clean Clef's accept band**: of its 9 wrong cards Haiku gives the same
  answer on 8, so requiring agreement drops 3 cards and 1 error.
- **Haiku's agreement with itself is no signal** (three quarters of the cards, 55% right: it is
  consistently wrong), and its self-reported confidence is no gate, as Phase 0 found.
- Where the two disagree on the viewer (124 cards), Clef is right on 85, Haiku on 27, neither on 12.

### Verdict

By the rule: Haiku 5.5 is not at least as good as Clef, and agreement with it is not worth
building. Nothing in Tier 1 changes, and decision 9 now rests on a measurement on the bundled spec
with Tier 0 in place. Context Studio's result doesn't carry over: there the mention is given and
`none` is rare, while 30-48% of code cards are `none`, which is the question Haiku gets wrong. Cost
is no argument either way: about $0.0009 per asked card for Haiku with the reference cached, against
about $0.0012 for Clef on the viewer.

### The cards that decide the held-out accept band

All 9 accept-band misses on the viewer are TypeScript interfaces
(`agreement@...-t1.md` lists them, and the 3 not-element misses, with every run's answer):

| Interface                                                  | Clef                           | Gold                      | Haiku (take 1 / take 2) |
| ---------------------------------------------------------- | ------------------------------ | ------------------------- | ----------------------- |
| `NavigationError`, `ParsedViewportParam`, `ScopedViewport` | `application.dataobject`       | `none`                    | as Clef / as Clef       |
| `PageRow`                                                  | `application.dataobject`       | `none`                    | as Clef / `ux`, no type |
| `Annotation`, `Layer`                                      | `application.dataobject`       | `data-model.objectschema` | as Clef / as Clef       |
| `ErrorLogEntry`                                            | `application.dataobject`       | `apm.logrecord`           | as Clef / as Clef       |
| `WebSocketEventMap`                                        | `application.applicationevent` | `application.dataobject`  | as Clef / as Clef       |
| `UnsubscribeMessage`                                       | `application.applicationevent` | `application.dataobject`  | as gold / as gold       |

Seven of the nine are a labelling question more than a model one: whether a small interface is
below the granularity of an element (four cards; section 7's spot check already called
`NavigationError` borderline), whether an in-code interface is an object schema (two cards, where
the gold goes against the boundary the charter relabelling settled on 2026-10-25: in-code TypeScript
interfaces are `application.dataobject`), and whether an error-log record type is an APM log record
(one). A model from another family answers as Clef does on all seven in its first take and on six in its second. That is not proof the gold is
wrong (Haiku is wrong far more often than Clef), but these are the cards a maintainer's ruling would
settle, and the gold has one label per card with no accepted alternative. If the two object-schema
cards count as right the band is 48 of 55 (87.3%, 76.0-93.7); if the four granularity cards also do,
52 of 55 (94.5%, 85.1-98.1), the in-sample figure. Neither clears the lower-bound rule at 55 cards,
so the rulings decide whether the held-out gap is Clef's or the labels', not whether stage mode
opens. No label was changed here.

### Limits of this measurement

- **One prompt shape for Haiku**: six fields in one structured-output call, at effort medium. Asking
  layer and type as separate questions, or other efforts, were not tried.
- **Haiku's reference text keeps each layer's "Modelling rules:" paragraph**, which Clef's layer
  criteria leave out (section 6). Whether they hurt Haiku was not measured.
- **The gold is Opus-made**, which should favour a Claude model if it favours either.
- **In-sample gold**: the in-sample figures here were scored against October's gold, which section 10
  replaced (it is now `gold@october.jsonl`); they were not re-scored, and `agreement-report.ts` re-run
  today reads the new `gold.jsonl`. The viewer's gold is unchanged, so the viewer figures stand.
- **Failed calls**: `toggleSection` (take 2) and `NavTree` (the control) failed to parse on the
  viewer, twice for the first; they count as wrong and are 1 card in 300 each.
- **Sonnet and Opus were not re-run**: at 20 and 40 times Haiku's input price they are not Tier 1
  candidates.

## 12. The maintainer's rulings and the re-measurement (2026-11-17)

Section 11 ended on nine viewer cards whose labels were in question. The maintainer ruled on them
the next day, and the rulings are modelling policy, wider than the nine cards:

1. **A declared shape is a schema.** An interface is a schema and an object is an instance of one;
   that a value is held to a declared shape is material, so every typed interface is a
   `data-model.objectschema`, small ones included, and records, structs and dataclasses that only
   declare fields follow. `application.dataobject` is what is left: a class with logic of its own
   over its state, or data with no declared shape. This replaces the 2026-10-25 boundary, which
   filed in-code interfaces as data objects.
2. **Persistence does not make a log not a log.** A type that declares the fields of an entry the
   system writes to a log is an `apm.logrecord`, wherever the entries are kept.
3. **Types are generic concepts that hold across stacks.** A WebSocket unsubscribe frame is a
   message, and the spec gets one `application.message` type with a `messageType`, not a type per
   kind of message.
4. **A service's contract is the service.** A language-level interface that declares the
   operations other components call is an `application.applicationservice`, not an
   `applicationinterface` (Context Studio proposal c2972281, of section 10, decided the same day).

Asked afterwards, he also confirmed three limits of ruling 1: interfaces in generated client code
and component props stay not-elements (the Tier-0 rules `tier0_generated_code` and
`tier0_component_props`: "knowing the source is more important than tracking a generated
output"); interfaces that declare only operations or that type a framework, global or third-party
object stay not-elements; type modules and Go named slices are left as they were.

The rulings went to Context Studio as proposals 96a0a30f, 8836f9cb, ce4bfe6b, c2972281 and
5cd62ebe, were decided there, and landed in the spec in PR 1142 (after spec 0.13.0 was tagged). That
changed the criteria digest, so the 2026-11-16 held-out verdict went stale and Clef fell back to
suggest mode, as section 9 says a criteria change does.

### What changed for the re-measurement

- **Tier 0.** `tier0_interface_default` narrowed an interface no earlier rule decides to three
  application types (data object, application interface, application event), so an object schema or
  a log record was unreachable for it. It now narrows to `data-model.objectschema`,
  `data-model.schemadefinition`, `data-model.schemacomposition`,
  `application.applicationservice`, `application.applicationevent`, `application.message` and
  `apm.logrecord`. The rule is written from the rulings, not fitted.
- **Gold.** `gold-revise.ts --revision declared-shape` applies the list in
  [`gold-revision@declared-shape.json`](../../cli/scripts/classify-eval/data/gold-revision@declared-shape.json):
  210 labels in five corpora, each with the clause that moved it. The previous labels are
  `gold@pre-declared-shape.jsonl`.

  | clause           | cards | change                                                                                                                                                  |
  | ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | declared-shape   | 165   | an interface the default rule reaches, with at least one data field: `application.dataobject` (108) or not-an-element (57) to `data-model.objectschema` |
  | service-contract | 24    | an interface labelled `application.applicationinterface` to `application.applicationservice` (eshop 22, dr-cli 1, jaeger-ui 1)                          |
  | record           | 14    | a class that only declares fields: `application.dataobject` to `data-model.objectschema` (eshop 13, fastapi 1)                                          |
  | message          | 7     | WebSocket frames, a JSON-RPC request and notification, two mediator commands to `application.message`                                                   |

  Fifteen interfaces the rule reaches stay not-elements and are listed with why: nine declare only
  operations or nothing, six type a framework, global or third-party object. The list was drawn up
  by reading the cards of all seven corpora, so it is labelling policy, not evidence, and the
  revised interface labels agree with the rewritten rule's candidates by construction.

- **Clef.** `bun classify.ts --corpus <c> --backend cloudflare:clef --kind-narrow --tier0 --qset
dr-qset-2 --tag cbm012-kind-tier0-qset2-spec013-shape` on the seven corpora, with the bundled spec
  of main after PR 1142 (0.13.0 plus the rulings; criteria digest `78797e45…`). No call failed.
  The question set and the thresholds are unchanged.

### Results at (0.6, 0.4, 0.6)

`bun held-out.ts --run clef@cbm012-kind-tier0-qset2-spec013-shape --corpus viewer,jaeger-ui,miniflux,eshop`
([`held-out@...-shape@viewer+jaeger-ui+miniflux+eshop.md`](../../cli/scripts/classify-eval/data/held-out@clef@cbm012-kind-tier0-qset2-spec013-shape@viewer+jaeger-ui+miniflux+eshop.md);
curves in [`bands@...-shape.md`](../../cli/scripts/classify-eval/data/bands@clef@cbm012-kind-tier0-qset2-spec013-shape.md)).
Model-asked cards; "before" is section 9's run on section 10's gold.

| scope                 | asked | accept, before    | accept, now                       | not-element, before | not-element, now                  |
| --------------------- | ----- | ----------------- | --------------------------------- | ------------------- | --------------------------------- |
| dr-cli                | 300   | 50 of 53 (94.3%)  | 55 of 57 (96.5%)                  | 44 of 45            | 37 of 38 (97.4%)                  |
| fastapi               | 148   | 42 of 48 (87.5%)  | 42 of 48 (87.5%)                  | 20 of 22            | 17 of 19 (89.5%)                  |
| petclinic             | 73    | 2 of 2            | 2 of 2                            | 37 of 38            | 35 of 36 (97.2%)                  |
| **in-sample, pooled** | 521   | 94 of 103 (91.3%) | **99 of 107 (92.5%, 85.9-96.2)**  | 101 of 105 (96.2%)  | **89 of 93 (95.7%, 89.5-98.3)**   |
| viewer                | 290   | 46 of 55 (83.6%)  | 61 of 64 (95.3%)                  | 48 of 51 (94.1%)    | 44 of 47 (93.6%)                  |
| jaeger-ui             | 294   | 8 of 11           | 1 of 3                            | 86 of 86            | 66 of 66                          |
| miniflux              | 217   | 4 of 4            | 3 of 4                            | 51 of 52            | 47 of 48 (97.9%)                  |
| eshop                 | 300   | 25 of 57 (43.9%)  | 47 of 67 (70.1%)                  | 44 of 44            | 45 of 45                          |
| **held out, pooled**  | 1,101 | 83 of 127 (65.4%) | **112 of 138 (81.2%, 73.8-86.8)** | 229 of 233 (98.3%)  | **202 of 206 (98.1%, 95.1-99.2)** |

Over every gold card, end-to-end type accuracy goes from 75.7% to 79.0% in-sample and from 72.8% to
73.8% held out; layer accuracy from 84.5% to 87.6% and from 81.8% to 81.5%.

**The not-element band is verified again.** Pooled lower bound 95.1% against 0.90, and no corpus
under the target (the viewer is lowest at 93.6%), so it passes `pooled-with-floor` under the
targets and rule of section 9. The four hidden cards gold keeps are two of the viewer's generated
client methods, its `paths` interface, and one miniflux function. `bands.ts` carries
the new record and digest with `heldOutBands: ["not-element"]`: Clef on Workers AI is in hide mode
on the criteria main sends.

**The accept band is not verified.** 81.2% pooled with a lower bound of 73.8% misses 0.88, and
eshop's point estimate (70.1%) is under it. It stays a suggestion.

Of the 113 held-out interfaces the default rule reaches whose gold is now an object schema, Clef
answers object schema for 88, not-an-element for 9 (none of them with enough confidence to be
hidden), application service for 6, an application type it cannot name for 8, and something else
for 2. In-sample it is 54 of 58.

### How much of this is the gold

Most of the accept band's gain is by construction: the same rulings wrote the gold revision, the
type definitions Clef reads and the rule's candidates. Three checks on that.

- **The old answers on the new gold** score 23 of 127 accepted and 213 of 233 hidden held out
  ([`held-out@...-layercrit@viewer+jaeger-ui+miniflux+eshop.md`](../../cli/scripts/classify-eval/data/held-out@clef@cbm012-kind-tier0-qset2-spec012-layercrit@viewer+jaeger-ui+miniflux+eshop.md)):
  the gold moved a long way, and the re-run was needed for either band to mean anything.
- **If the 59 interfaces that were not-elements had stayed so** (the reading of ruling 1 that keeps
  small interfaces out), the held-out accept band would be 105 of 138 (76.1%) and in-sample 95 of
  107 (88.8%); the not-element band does not change, because Clef hides none of them.
- **If the fifteen interfaces kept as not-elements were elements instead**, the held-out
  not-element band would be 198 of 206 (96.1%, lower bound 92.5%), every corpus at 93.6% or more:
  it still passes.

The viewer and eshop are no longer unseen: the rulings came from the viewer's cards, and proposal
c2972281 from both corpora's errors. jaeger-ui and miniflux shaped nothing, and alone they hide 113
of 114 (99.1%, lower bound 95.2%). For the accept band no unseen corpus has enough accepted cards
to judge (7 between them). **umami is still unlabelled and unread, and is where the accept band
should be judged next.**

### What still goes wrong in the accept band

eshop has 20 of the 26 held-out misses:

- **8 are file modules that hold one declaration.** Five `I...Service.cs` modules are labelled
  `application.applicationinterface` and Clef answers application service; three DTO files
  (`OrderItem`, `CatalogRoot`, `UserInfo`) are labelled `application.dataobject` and Clef answers
  object schema. The revision covered Interface and Class cards, not Module cards. With the same
  clauses applied to them eshop would be 55 of 67 (82.1%) and the held-out band 120 of 138 (87.0%,
  lower bound 80.3%), which still misses. The gold was not changed: a label moved because a model
  missed it is not policy.
- **4 are interfaces whose gold is outside the rule's candidates** (`security.authenticationconfig`
  twice, `data-store.accesspattern`, a data-store seeder), answered application service.
- **2 are integration-event modules** answered data object, and the other 6 are four methods and a
  handler class answered as services or processes, and `IEventBusBuilder`, an object schema under
  the revision's field test and an application service to Clef.

Elsewhere, four interfaces that declare data fields beside callbacks (two stores, a mutation step
and a React context value) are object schemas in the gold and application services to Clef; both
readings of the definitions are defensible.

**Messages and log records are not recognised yet.** Of the five interfaces now labelled
`application.message`, Clef answers message for two and object schema for three, and accepts one of
those (`JsonRpcRequest`). `ErrorLogEntry` is answered object schema. All but one escalate to the
agent, so nothing wrong is staged or hidden, but the two rulings do not show in Clef's answers. And
**a class can never be answered as a message**: `dr-qset-2`'s kind rule offers a class six
application types, and `message` is not among them, so eshop's two mediator commands cannot be
right. Adding it changes what is sent, which is a new question set.

### The nine cards of section 11

| card                         | gold now      | Clef now             | band          |
| ---------------------------- | ------------- | -------------------- | ------------- |
| `Annotation`, `Layer`        | object schema | object schema        | accept, right |
| `NavigationError`, `PageRow` | object schema | object schema        | accept, right |
| `ParsedViewportParam`        | object schema | object schema        | escalate      |
| `ScopedViewport`             | object schema | application, no type | escalate      |
| `ErrorLogEntry`              | log record    | object schema        | escalate      |
| `WebSocketEventMap`          | object schema | application event    | escalate      |
| `UnsubscribeMessage`         | message       | message              | escalate      |

### The thresholds: kept

`bun fit-thresholds.ts --run clef@cbm012-kind-tier0-qset2-spec013-shape --type-precision 0.88
--none-precision 0.9 --scope pooled` proposes (0.5, 0.4, 0.5): 155 accepted at 88.4% and 151 hidden
at 90.1%, both at the edge of the targets, with fastapi's hidden band at 68.6%. As in section 10,
that is the fit taking all the coverage the targets allow, not evidence for looser thresholds, and
T_none 0.5 would change the band hide mode acts on. (0.6, 0.4, 0.6) is kept, and its fit record is
re-scored on the new run and gold (92.5% / 95.7% pooled).

### Open, for the maintainer

1. **umami**: label it (about $11 at section 9's prices) and judge the accept band, and the
   rulings' effect, on a corpus that shaped nothing.
2. **Single-declaration file modules**: whether a module that holds one interface or one record
   takes that declaration's type, which would move eight eshop labels as policy.
3. **Interfaces with state and actions** (stores, context values): object schema or application
   service.
4. **`message` for classes**: a new question set, with its own paired measurement.

## 13. umami: the corpus nothing had read (2026-11-17)

Section 12 left the accept band without clean evidence: the viewer and eshop had shaped the
rulings, and jaeger-ui and miniflux accept 7 cards between them. umami (umami-software/umami,
`src/**`, 300 cards built on 2026-11-16 and left unlabelled) was labelled and scored after PR 1145
merged, with the Tier-0 rules, the criteria and the thresholds fixed.

**Method.** `bun label.ts --corpus umami --sync --charter` (Opus 5.5, effort high, the spec of main):
the prompt of the other held-out corpora, reading the type definitions the rulings changed. Those
labels are `gold@pre-declared-shape.jsonl`. Then, before Clef was run, the "handlers" revision
(no card) and the "declared-shape" revision: of the 67 interfaces the default rule reaches, Opus
labelled 46 object schemas, 19 not-elements and 2 apm configurations, and none a data object. The
revision's field test moved 15 of the 19 to object schema; `RawQueryExecutor` (operations only),
`Window` and two typings of a third-party library in a `.d.ts` file stay not-elements, a choice
made from their source before any prediction existed. Then `classify.ts` with section 12's
configuration: 269 cards asked (Tier 0 rejects 31 component-props interfaces, and Opus labelled 30
of those not-elements), no failed call.

**Result at (0.6, 0.4, 0.6)**
([`held-out@...-shape@umami.md`](../../cli/scripts/classify-eval/data/held-out@clef@cbm012-kind-tier0-qset2-spec013-shape@umami.md)):

| scope                                       | asked | accept                        | not-element                   |
| ------------------------------------------- | ----- | ----------------------------- | ----------------------------- |
| umami                                       | 269   | 42 of 42 (100%, 91.6-100)     | 25 of 25 (100%, 86.7-100)     |
| unseen corpora (jaeger-ui, miniflux, umami) | 780   | 46 of 49 (93.9%, 83.5-97.9)   | 138 of 139 (99.3%, 96.0-99.9) |
| all five held-out corpora                   | 1,370 | 154 of 180 (85.6%, 79.7-89.9) | 227 of 231 (98.3%, 95.6-99.3) |

Layer accuracy over umami's 300 gold cards is 88.3% and end-to-end type accuracy 79.0%, the
in-sample level (87.6% and 79.0%).

**The figures are the same against Opus's raw labels**: 42 of 42 and 25 of 25. Every interface Clef
accepted was an object schema to Opus too, so the revision decides nothing here. The 15 small interfaces it moved all escalate: Clef answers object schema for 10 and not-an-element for 5, each under its threshold.

**What the accept band is on umami**: 35 interfaces accepted as object schemas and 7 functions as
API operations. Of the 61 interfaces now labelled object schema, Clef accepts 35, answers object
schema below the thresholds for 21 and not-an-element for 5 (none confidently enough to hide). The
not-element band is 24 functions and a module.

**What it shows, and what it does not.**

- On a corpus nothing had read, the rulings' central case holds: a typed interface is accepted as
  an object schema, and none of the 42 accepted cards is wrong. umami alone clears the accept
  target (lower bound 91.6% against 0.88, on 42 cards).
- **The accept band is still not verified.** Over the five corpora it is 85.6% with a lower bound
  of 79.7%, and eshop's 70.1% is under the floor. Over the three unseen corpora it is 46 of 49,
  with a lower bound of 83.5% on too few cards. `bands.ts` carries the five-corpus record and
  `heldOutBands: ["not-element"]`, as before: hide mode, the accept band a suggestion.
- **umami is a TypeScript React and SQL codebase like the viewer.** It has one class and no
  C# or Java service contracts, so it says nothing about eshop's misses (file modules, repository
  and security interfaces), which are where the accept band fails. Nor does it have a message or a
  log record to test those rulings.
- The not-element band gains 25 cards, all right.

Section 12's open points stand; the first is now done. What would move the accept band is on the
service side: the module question (point 2) and a held-out corpus with service contracts that
nothing has read.

## Limits

- **In-sample and fragile.** The thresholds are fitted on three corpora, where fastapi alone decides
  them (section 6), and checked on four held-out corpora, 1,101 asked cards (sections 7 and 9).
- **Spec 0.12.0, then 0.13.0.** Sections 6 to 11 use the bundled spec 0.12.0, sections 1-5 spec
  0.10.0, section 12 the spec of main after PR 1142 (0.13.0 plus the 2026-11-17 rulings). A spec or
  criteria change makes a held-out verdict stale (the criteria digest), and needs a re-fit and a B5
  re-run, as section 12 did.
- **The viewer and eshop are seen.** The 2026-11-17 rulings came from their cards and errors, and
  the gold revision was drawn up by reading all seven corpora (section 12). jaeger-ui and miniflux
  shaped nothing, and umami was labelled only after the rules and criteria were fixed (section 13).
  No unread corpus is left.
- **Labels from two prompts.** The in-sample gold is October's prompt, the viewer's today's; about
  one label in six differs between them (section 7). Section 8 finds no sign it costs Clef, on 15
  band cards.
- **Held-out results by band.** The not-element band passes pooled over four held-out corpora; the
  accept band's precision ranges from 44% to 100% by codebase (section 9).
- **Precision depends on the kind of code.** UI client code runs at about 84% in the accept band,
  in-sample and held out, other code at about 99% (section 8); a pooled figure is a property of the
  mix as much as of the model.
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
After review: the in-sample corpora with the layer criteria rule $0.61 (dr-cli $0.33, fastapi
$0.19, petclinic $0.09) and the viewer at the new defaults $0.35, Clef $0.97; relabelling 50
in-sample cards $2.15 at the harness's prices (estimated $2.77).

Section 8: no model calls. Token counts for `label.ts --estimate` are free; the four candidate corpora
were cloned, indexed and carded locally.

Section 9 (approved, about $58): labelling $56.23 at the harness's prices (in-sample relabel: dr-cli
$11.33, fastapi $7.10, petclinic $3.72; the 50-card repeat $1.81; jaeger-ui $11.07, miniflux $10.63,
eshop $10.57; every request after each run's first read the cache), Clef $0.94 (jaeger-ui $0.30,
miniflux $0.26, eshop $0.37): **$57.16**.

Section 10: no model calls (the handlers revision and the re-scoring read committed predictions; the
proposal is text).
Section 11: Haiku 5.5, two takes on the four corpora $1.50 ($0.75 a take: viewer $0.27, dr-cli $0.27,
fastapi $0.14, petclinic $0.07), the control on the viewer $0.26 and an 8-card trial $0.02, $1.78 in
all at the harness's prices; three failed calls are not in that figure.
Section 12 (approved, about $2): the Clef re-run on the seven corpora, **$1.99** (dr-cli $0.35,
fastapi $0.20, petclinic $0.09, viewer $0.37, jaeger-ui $0.32, miniflux $0.27, eshop $0.39). The gold
revision, the Tier-0 rule and the scoring made no model calls.
Section 13 (approved, about $11 and $0.35): labelling umami**$11.12** at the harness's prices
(estimated $11.01), Clef on umami **$0.41**.
