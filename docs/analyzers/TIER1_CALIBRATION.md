# Tier 1 calibration: band curves, default thresholds and `dr-qset-2` (2026-11-14)

Results of rollout PR 2 of [TIER1_DESIGN.md](TIER1_DESIGN.md) (section 9, item 2): the band
measurement of section 6, the in-sample defaults for Clef, and the paired measurement of question set
`dr-qset-2` (the line-free state, section 3.3) against `dr-qset-1`. Rollout PR 8 (2026-11-16) added
section 6, the re-measure on the spec the CLI bundles (0.12.0) and Clef's refitted defaults, and
section 7, B5: the held-out viewer corpus, the held-out test and its verdict. Section 8 (2026-11-16,
after rollout PR 8) splits the viewer gap between corpus, fit and labelling, and costs the next held-out
corpora; it ends with the maintainer's decision points.

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
- **Section 8: the viewer gap is UI client code.** In-sample, fastapi's React `frontend/` already ran
  at 84.4% (27 of 32 accepted), the viewer at 83.6%, every other in-sample code 98.6% (70 of 71). The
  fit adds about 3 points of optimism to any in-sample figure; the labelling change shows no sign of
  costing Clef. More held-out corpora alone won't put Clef in stage mode at these criteria and
  thresholds; the costed proposal (about $58) and the decision points are in section 8. Nothing was
  labelled or run for it.

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

## Limits

- **In-sample, fragile, and one held-out corpus.** The thresholds are fitted on three corpora, where
  fastapi alone decides them (section 6), and checked on one more of 290 asked cards (section 7).
- **Spec 0.12.0.** Sections 6 and 7 use the bundled spec 0.12.0, sections 1-5 spec 0.10.0. A spec or
  criteria change makes a held-out verdict stale (the criteria digest), and needs a re-fit and a B5
  re-run.
- **Labels from two prompts.** The in-sample gold is October's prompt, the viewer's today's; about
  one label in six differs between them (section 7). Section 8 finds no sign it costs Clef, on 15
  band cards.
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
