# Fit stability: clef@cbm012-kind-tier0-qset2-spec012-layercrit

Output of `bun fit-stability.ts --run clef@cbm012-kind-tier0-qset2-spec012-layercrit --type-precision 0.88 --none-precision 0.9` (bootstrap seed 1, 1,000 resamples). A margin is how many more wrong cards a band can take before it misses its target; the threshold ranges are printed to three decimals.

```text
Fit on clef@cbm012-kind-tier0-qset2-spec012-layercrit: T_layer 0.6, T_type 0.4, T_none 0.6 (targets 0.88 / 0.9, each-corpus, point).

Margins at the fit (more wrong cards each band can take before missing its target):
  pooled: accept 97/103 (margin 6), not-element 100/105 (margin 5)
  dr-cli: accept 52/53 (margin 5), not-element 43/45 (margin 2)
  fastapi: accept 43/48 (margin 0), not-element 20/22 (margin 0)
  petclinic: accept 2/2 (margin 0), not-element 37/38 (margin 2)

Same accept band (103 cards) for T_type in (0.399, 0.410] and T_layer in (0.598, 0.601].
Same not-element band (105 cards) for T_none in (0.600, 0.600].

Leave one corpus out:
  without dr-cli: (0.6, 0.3), T_none 0.6
  without fastapi: (0.5, 0.4), T_none 0.6
  without petclinic: (0.6, 0.4), T_none 0.6

Bootstrap (1000 resamples within each corpus): accept (T_layer, T_type) / T_none
  (0.5, 0.4) / 0.6: 17.4%
  (0.5, 0.4) / 0.7: 14.5%
  (0.6, 0.4) / 0.6: 11.5%
  (0.6, 0.4) / 0.7: 8.9%
  (0.8, 0.5) / 0.6: 5.1%
  (0.6, 0.3) / 0.6: 4.6%
  (0.8, 0.5) / 0.7: 3.8%
  (0.7, 0.1) / 0.6: 3.8%
  (0.6, 0.3) / 0.7: 3.4%
  (0.8, 0.6) / 0.6: 3.3%
```
