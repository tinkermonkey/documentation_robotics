# Tier 1 calibration: band curves, default thresholds and `dr-qset-2` (2026-11-14)

Results of rollout PR 2 of [TIER1_DESIGN.md](TIER1_DESIGN.md) (section 9, item 2): the band
measurement of section 6, the in-sample defaults for Clef, and the paired measurement of question set
`dr-qset-2` (the line-free state, section 3.3) against `dr-qset-1`. Rollout PR 8 (2026-11-16) added
section 6, the re-measure on the spec the CLI bundles (0.12.0) and Clef's refitted defaults, and
section 7, B5: the held-out viewer corpus, the held-out test and its verdict. Section 8 (2026-11-16)
measures Claude Haiku 5.5 beside Clef on today's conditions, and agreement between the two as a gate.

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
- **Decision models only stands, and no agreement gate** (section 8). Claude Haiku 5.5 with Tier 0
  and the kind rule is 17-19 points below Clef on end-to-end type accuracy on the viewer (54.7-57.0%
  against 74.0%) and 15-17 in-sample, mostly by placing `none` cards as elements. Clef and Haiku
  agreeing covers 2.5 times the accept band at lower precision (75-78% against 83.6% on the viewer).
- **Open, for the maintainer** (section 8): all 9 of the viewer's accept-band misses are TypeScript
  interfaces, and 7 are labelling questions (granularity, in-code interface against object schema)
  rather than clear model errors. Rulings on them say whether the held-out gap is Clef's or the
  gold's.

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

## 8. A Claude baseline on today's conditions, and agreement as a gate (2026-11-16)

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
- **Failed calls**: `toggleSection` (take 2) and `NavTree` (the control) failed to parse on the
  viewer, twice for the first; they count as wrong and are 1 card in 300 each.
- **Sonnet and Opus were not re-run**: at 20 and 40 times Haiku's input price they are not Tier 1
  candidates.

## Limits

- **In-sample, fragile, and one held-out corpus.** The thresholds are fitted on three corpora, where
  fastapi alone decides them (section 6), and checked on one more of 290 asked cards (section 7).
- **Spec 0.12.0.** Sections 6 and 7 use the bundled spec 0.12.0, sections 1-5 spec 0.10.0. A spec or
  criteria change makes a held-out verdict stale (the criteria digest), and needs a re-fit and a B5
  re-run.
- **Labels from two prompts.** The in-sample gold is October's prompt, the viewer's today's; about
  one label in six differs between them (section 7).
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

Section 8: Haiku 5.5, two takes on the four corpora $1.50 ($0.75 a take: viewer $0.27, dr-cli $0.27,
fastapi $0.14, petclinic $0.07), the control on the viewer $0.26 and an 8-card trial $0.02, $1.78 in
all at the harness's prices; three failed calls are not in that figure.
