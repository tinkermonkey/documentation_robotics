# Tier 1 calibration: band curves, default thresholds and `dr-qset-2` (2026-11-14)

Results of rollout PR 2 of [TIER1_DESIGN.md](TIER1_DESIGN.md) (section 9, item 2): the band
measurement of section 6, the in-sample defaults for Clef, and the paired measurement of question set
`dr-qset-2` (the line-free state, section 3.3) against `dr-qset-1`.

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
  returns `suggest` for both.
- **`dr-qset-2` is the current question set.** It meets none of the blocking criteria: no corpus loses
  layer or end-to-end type accuracy significantly (smallest p = 0.359), and pooled accept-band type
  precision at the defaults rises from 90.9% to 93.3%. Refitting with the same targets gives the same
  thresholds. The cache misses once per card on the first run after the upgrade, as section 3.3 says.
- **The card builder sorts callers, callees and imports before capping them** (card version 2), so
  the 12 and 15 the state names don't depend on the order CBM returned its rows in, under either
  question set.

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

## Limits

- **In-sample.** The thresholds are fitted and scored on the same corpora; B5 decides whether they
  hold.
- **Spec 0.10.0.** Every run here used the spec the gold-era runs used; the CLI's bundled spec is now
  0.12.0, whose layer and type descriptions (the criteria) differ. Tier 1 in production will send the
  bundled spec's criteria, so the thresholds should be re-measured on the current spec before stage
  mode, alongside B5.
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
