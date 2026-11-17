# Held-out test: clef@cbm012-kind-tier0-qset2-spec013-shape on jaeger-ui, miniflux, umami

Generated 2026-11-17T18:21:17.227Z by `held-out.ts`. Question set dr-qset-2, model clef, served by cloudflare-workers-ai, spec 0.13.0. Held-out corpora `jaeger-ui` at d6bbc16428e0e195f5e1e6bc7a2a400ef48a3c7b, `miniflux` at fb043227ef6ad98569c848e8cdade0d237dab87e, `umami` at b18d5144dfe7342edeeca6f61d13ba3baabed9ad. Thresholds T_layer 0.6, T_type 0.4, T_none 0.6 (the defaults in `bands.ts`). Intervals are Wilson 95%.

| scope                                          | gold cards | layer accuracy    | type accuracy, end to end | model-asked | accept: cards (coverage) | type precision      | not-element: cards (coverage) | precision           |
| ---------------------------------------------- | ---------- | ----------------- | ------------------------- | ----------- | ------------------------ | ------------------- | ----------------------------- | ------------------- |
| jaeger-ui (held out)                           | 300        | 79.3% (74.4-83.5) | 70.0% (64.6-74.9)         | 294         | 3 (1.0%)                 | 33.3% (6.1-79.2)    | 66 (22.4%)                    | 100.0% (94.5-100.0) |
| miniflux (held out)                            | 300        | 78.7% (73.7-82.9) | 77.0% (71.9-81.4)         | 217         | 4 (1.8%)                 | 75.0% (30.1-95.4)   | 48 (22.1%)                    | 97.9% (89.1-99.6)   |
| umami (held out)                               | 300        | 88.3% (84.2-91.5) | 79.0% (74.0-83.2)         | 269         | 42 (15.6%)               | 100.0% (91.6-100.0) | 25 (9.3%)                     | 100.0% (86.7-100.0) |
| held out, pooled (jaeger-ui, miniflux, umami)  | 900        | 82.1% (79.5-84.5) | 75.3% (72.4-78.0)         | 780         | 49 (6.3%)                | 93.9% (83.5-97.9)   | 139 (17.8%)                   | 99.3% (96.0-99.9)   |
| in-sample, pooled (dr-cli, fastapi, petclinic) | 606        | 87.6% (84.8-90.0) | 79.0% (75.6-82.1)         | 521         | 107 (20.5%)              | 92.5% (85.9-96.2)   | 93 (17.9%)                    | 95.7% (89.5-98.3)   |
| dr-cli                                         | 300        | 88.7% (84.6-91.8) | 75.7% (70.5-80.2)         | 300         | 57 (19.0%)               | 96.5% (88.1-99.0)   | 38 (12.7%)                    | 97.4% (86.5-99.5)   |
| fastapi                                        | 200        | 82.5% (76.6-87.1) | 77.0% (70.7-82.3)         | 148         | 48 (32.4%)               | 87.5% (75.3-94.1)   | 19 (12.8%)                    | 89.5% (68.6-97.1)   |
| petclinic                                      | 106        | 94.3% (88.2-97.4) | 92.5% (85.8-96.1)         | 73          | 2 (2.7%)                 | 100.0% (34.2-100.0) | 36 (49.3%)                    | 97.2% (85.8-99.5)   |

## Verdict

Each band is verified on its own (`verdictOf`). Rule `lower-bound` (`HELD_OUT_RULE`): the band's Wilson interval clears the target (lower bound >= target); `within-interval` (shown for comparison): the interval reaches it. Pooling `pooled-with-floor` (`HELD_OUT_POOLING`): the band pooled over the held-out corpora meets the rule and no corpus's point estimate is under the target; `pooled` drops the floor; `each-corpus` asks every corpus to meet the rule alone. A band of fewer than 30 cards (`HELD_OUT_MIN_CARDS`) fails: here accept 49, not-element 139 pooled. Both bands verified is stage mode; the not-element band alone is hide mode.

| targets (type / none)                  | rule            | pooling           | accept | not-element | mode      |
| -------------------------------------- | --------------- | ----------------- | ------ | ----------- | --------- |
| 0.85 / 0.90                            | lower-bound     | pooled-with-floor | misses | meets       | **hide**  |
| 0.85 / 0.90                            | lower-bound     | pooled            | misses | meets       | **hide**  |
| 0.85 / 0.90                            | lower-bound     | each-corpus       | misses | misses      | suggest   |
| 0.85 / 0.90                            | within-interval | pooled-with-floor | misses | meets       | **hide**  |
| 0.85 / 0.90                            | within-interval | pooled            | meets  | meets       | **stage** |
| 0.85 / 0.90                            | within-interval | each-corpus       | misses | misses      | suggest   |
| 0.88 / 0.90 **(the targets and rule)** | lower-bound     | pooled-with-floor | misses | meets       | **hide**  |
| 0.88 / 0.90                            | lower-bound     | pooled            | misses | meets       | **hide**  |
| 0.88 / 0.90                            | lower-bound     | each-corpus       | misses | misses      | suggest   |
| 0.88 / 0.90                            | within-interval | pooled-with-floor | misses | meets       | **hide**  |
| 0.88 / 0.90                            | within-interval | pooled            | meets  | meets       | **stage** |
| 0.88 / 0.90                            | within-interval | each-corpus       | misses | misses      | suggest   |
| 0.90 / 0.90                            | lower-bound     | pooled-with-floor | misses | meets       | **hide**  |
| 0.90 / 0.90                            | lower-bound     | pooled            | misses | meets       | **hide**  |
| 0.90 / 0.90                            | lower-bound     | each-corpus       | misses | misses      | suggest   |
| 0.90 / 0.90                            | within-interval | pooled-with-floor | misses | meets       | **hide**  |
| 0.90 / 0.90                            | within-interval | pooled            | meets  | meets       | **stage** |
| 0.90 / 0.90                            | within-interval | each-corpus       | misses | misses      | suggest   |
| 0.90 / 0.95                            | lower-bound     | pooled-with-floor | misses | meets       | **hide**  |
| 0.90 / 0.95                            | lower-bound     | pooled            | misses | meets       | **hide**  |
| 0.90 / 0.95                            | lower-bound     | each-corpus       | misses | misses      | suggest   |
| 0.90 / 0.95                            | within-interval | pooled-with-floor | misses | meets       | **hide**  |
| 0.90 / 0.95                            | within-interval | pooled            | meets  | meets       | **stage** |
| 0.90 / 0.95                            | within-interval | each-corpus       | misses | misses      | suggest   |

Under the targets (0.88 / 0.9, lower-bound, pooled-with-floor): **not-element verified**: `heldOutBands: ["not-element"]` (hide mode).

The `heldOut` record for `DEFAULT_THRESHOLDS["dr-qset-2"]["clef"]`:

```json
{
  "corpora": [
    {
      "corpus": "jaeger-ui",
      "sourceCommit": "d6bbc16428e0e195f5e1e6bc7a2a400ef48a3c7b",
      "cards": 294,
      "accept": {
        "cards": 3,
        "correct": 1
      },
      "notElement": {
        "cards": 66,
        "correct": 66
      }
    },
    {
      "corpus": "miniflux",
      "sourceCommit": "fb043227ef6ad98569c848e8cdade0d237dab87e",
      "cards": 217,
      "accept": {
        "cards": 4,
        "correct": 3
      },
      "notElement": {
        "cards": 48,
        "correct": 47
      }
    },
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
  "cards": 780,
  "specVersion": "0.13.0",
  "date": "2026-11-17",
  "serving": {
    "provider": "cloudflare-workers-ai",
    "upstream": null
  },
  "criteriaDigest": "78797e453b54d523caad8151d67982692c26a0a649ceed6c50db6f37fcbaf319",
  "accept": {
    "cards": 49,
    "correct": 46
  },
  "notElement": {
    "cards": 139,
    "correct": 138
  }
}
```
