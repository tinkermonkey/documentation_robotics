# Held-out test: clef@cbm012-kind-tier0-qset2-spec013-shape on umami

Generated 2026-11-17T18:20:59.645Z by `held-out.ts`. Question set dr-qset-2, model clef, served by cloudflare-workers-ai, spec 0.13.0. Held-out corpus `umami` at b18d5144dfe7342edeeca6f61d13ba3baabed9ad. Thresholds T_layer 0.6, T_type 0.4, T_none 0.6 (the defaults in `bands.ts`). Intervals are Wilson 95%.

| scope                                          | gold cards | layer accuracy    | type accuracy, end to end | model-asked | accept: cards (coverage) | type precision      | not-element: cards (coverage) | precision           |
| ---------------------------------------------- | ---------- | ----------------- | ------------------------- | ----------- | ------------------------ | ------------------- | ----------------------------- | ------------------- |
| umami (held out)                               | 300        | 88.3% (84.2-91.5) | 79.0% (74.0-83.2)         | 269         | 42 (15.6%)               | 100.0% (91.6-100.0) | 25 (9.3%)                     | 100.0% (86.7-100.0) |
| in-sample, pooled (dr-cli, fastapi, petclinic) | 606        | 87.6% (84.8-90.0) | 79.0% (75.6-82.1)         | 521         | 107 (20.5%)              | 92.5% (85.9-96.2)   | 93 (17.9%)                    | 95.7% (89.5-98.3)   |
| dr-cli                                         | 300        | 88.7% (84.6-91.8) | 75.7% (70.5-80.2)         | 300         | 57 (19.0%)               | 96.5% (88.1-99.0)   | 38 (12.7%)                    | 97.4% (86.5-99.5)   |
| fastapi                                        | 200        | 82.5% (76.6-87.1) | 77.0% (70.7-82.3)         | 148         | 48 (32.4%)               | 87.5% (75.3-94.1)   | 19 (12.8%)                    | 89.5% (68.6-97.1)   |
| petclinic                                      | 106        | 94.3% (88.2-97.4) | 92.5% (85.8-96.1)         | 73          | 2 (2.7%)                 | 100.0% (34.2-100.0) | 36 (49.3%)                    | 97.2% (85.8-99.5)   |

## Verdict

Each band is verified on its own (`verdictOf`). Rule `lower-bound` (`HELD_OUT_RULE`): the band's Wilson interval clears the target (lower bound >= target); `within-interval` (shown for comparison): the interval reaches it. Pooling `pooled-with-floor` (`HELD_OUT_POOLING`): the band pooled over the held-out corpora meets the rule and no corpus's point estimate is under the target; `pooled` drops the floor; `each-corpus` asks every corpus to meet the rule alone. A band of fewer than 30 cards (`HELD_OUT_MIN_CARDS`) fails: here accept 42, not-element 25 pooled. Both bands verified is stage mode; the not-element band alone is hide mode.

| targets (type / none)                  | rule            | pooling           | accept | not-element | mode    |
| -------------------------------------- | --------------- | ----------------- | ------ | ----------- | ------- |
| 0.85 / 0.90                            | lower-bound     | pooled-with-floor | meets  | misses      | suggest |
| 0.85 / 0.90                            | within-interval | pooled-with-floor | meets  | misses      | suggest |
| 0.88 / 0.90 **(the targets and rule)** | lower-bound     | pooled-with-floor | meets  | misses      | suggest |
| 0.88 / 0.90                            | within-interval | pooled-with-floor | meets  | misses      | suggest |
| 0.90 / 0.90                            | lower-bound     | pooled-with-floor | meets  | misses      | suggest |
| 0.90 / 0.90                            | within-interval | pooled-with-floor | meets  | misses      | suggest |
| 0.90 / 0.95                            | lower-bound     | pooled-with-floor | meets  | misses      | suggest |
| 0.90 / 0.95                            | within-interval | pooled-with-floor | meets  | misses      | suggest |

Under the targets (0.88 / 0.9, lower-bound, pooled-with-floor): **accept verified**: `heldOutBands: ["accept"]`.

The `heldOut` record for `DEFAULT_THRESHOLDS["dr-qset-2"]["clef"]`:

```json
{
  "corpora": [
    {
      "corpus": "umami",
      "sourceCommit": "b18d5144dfe7342edeeca6f61d13ba3baabed9ad",
      "cards": 269,
      "accept": {
        "cards": 42,
        "correct": 42
      },
      "notElement": {
        "cards": 25,
        "correct": 25
      }
    }
  ],
  "run": "clef@cbm012-kind-tier0-qset2-spec013-shape",
  "cards": 269,
  "specVersion": "0.13.0",
  "date": "2026-11-17",
  "serving": {
    "provider": "cloudflare-workers-ai",
    "upstream": null
  },
  "criteriaDigest": "78797e453b54d523caad8151d67982692c26a0a649ceed6c50db6f37fcbaf319",
  "accept": {
    "cards": 42,
    "correct": 42
  },
  "notElement": {
    "cards": 25,
    "correct": 25
  }
}
```
