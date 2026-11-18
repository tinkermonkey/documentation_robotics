# Held-out test: clef@cbm012-kind-tier0-qset2-spec013-domain on viewer, jaeger-ui, miniflux, eshop, umami

Generated 2026-11-18T18:33:35.582Z by `held-out.ts`. Question set dr-qset-2, model clef, served by cloudflare-workers-ai, spec 0.13.0. Held-out corpora `viewer` at 607ca095cd56ce9ef8435f2880bf8e6d3c709fa5, `jaeger-ui` at d6bbc16428e0e195f5e1e6bc7a2a400ef48a3c7b, `miniflux` at fb043227ef6ad98569c848e8cdade0d237dab87e, `eshop` at 913acea66708a59595351174cee9b29f37179d29, `umami` at b18d5144dfe7342edeeca6f61d13ba3baabed9ad. Thresholds T_layer 0.6, T_type 0.4, T_none 0.6 (the defaults in `bands.ts`). Intervals are Wilson 95%.

| scope                                                        | gold cards | layer accuracy    | type accuracy, end to end | model-asked | accept: cards (coverage) | type precision      | not-element: cards (coverage) | precision           |
| ------------------------------------------------------------ | ---------- | ----------------- | ------------------------- | ----------- | ------------------------ | ------------------- | ----------------------------- | ------------------- |
| viewer (held out)                                            | 215        | 85.6% (80.3-89.7) | 81.9% (76.2-86.4)         | 205         | 62 (30.2%)               | 93.5% (84.6-97.5)   | 45 (22.0%)                    | 93.3% (82.1-97.7)   |
| jaeger-ui (held out)                                         | 223        | 82.5% (77.0-86.9) | 78.5% (72.6-83.4)         | 217         | 3 (1.4%)                 | 33.3% (6.1-79.2)    | 53 (24.4%)                    | 100.0% (93.2-100.0) |
| miniflux (held out)                                          | 295        | 80.0% (75.1-84.2) | 78.3% (73.3-82.6)         | 212         | 4 (1.9%)                 | 75.0% (30.1-95.4)   | 48 (22.6%)                    | 97.9% (89.1-99.6)   |
| eshop (held out)                                             | 233        | 85.4% (80.3-89.4) | 78.1% (72.4-82.9)         | 233         | 54 (23.2%)               | 81.5% (69.2-89.6)   | 37 (15.9%)                    | 100.0% (90.6-100.0) |
| umami (held out)                                             | 202        | 89.6% (84.6-93.1) | 86.6% (81.3-90.6)         | 171         | 42 (24.6%)               | 100.0% (91.6-100.0) | 24 (14.0%)                    | 100.0% (86.2-100.0) |
| held out, pooled (viewer, jaeger-ui, miniflux, eshop, umami) | 1168       | 84.2% (82.0-86.2) | 80.4% (78.0-82.6)         | 1038        | 165 (15.9%)              | 89.7% (84.1-93.5)   | 207 (19.9%)                   | 98.1% (95.1-99.2)   |
| in-sample, pooled (dr-cli, fastapi, petclinic)               | 489        | 89.4% (86.3-91.8) | 83.8% (80.3-86.8)         | 404         | 95 (23.5%)               | 91.6% (84.3-95.7)   | 79 (19.6%)                    | 98.7% (93.2-99.8)   |
| dr-cli                                                       | 240        | 91.3% (87.0-94.2) | 81.7% (76.3-86.1)         | 240         | 58 (24.2%)               | 96.6% (88.3-99.0)   | 34 (14.2%)                    | 100.0% (89.8-100.0) |
| fastapi                                                      | 143        | 82.5% (75.5-87.9) | 81.1% (73.9-86.7)         | 91          | 35 (38.5%)               | 82.9% (67.3-91.9)   | 9 (9.9%)                      | 100.0% (70.1-100.0) |
| petclinic                                                    | 106        | 94.3% (88.2-97.4) | 92.5% (85.8-96.1)         | 73          | 2 (2.7%)                 | 100.0% (34.2-100.0) | 36 (49.3%)                    | 97.2% (85.8-99.5)   |

## Verdict

Each band is verified on its own (`verdictOf`). Rule `lower-bound` (`HELD_OUT_RULE`): the band's Wilson interval clears the target (lower bound >= target); `within-interval` (shown for comparison): the interval reaches it. Pooling `pooled-with-floor` (`HELD_OUT_POOLING`): the band pooled over the held-out corpora meets the rule and no corpus's point estimate is under the target; `pooled` drops the floor; `each-corpus` asks every corpus to meet the rule alone. A band of fewer than 30 cards (`HELD_OUT_MIN_CARDS`) fails: here accept 165, not-element 207 pooled. Both bands verified is stage mode; the not-element band alone is hide mode.

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
| 0.90 / 0.95                            | lower-bound     | pooled-with-floor | misses | misses      | suggest   |
| 0.90 / 0.95                            | lower-bound     | pooled            | misses | meets       | **hide**  |
| 0.90 / 0.95                            | lower-bound     | each-corpus       | misses | misses      | suggest   |
| 0.90 / 0.95                            | within-interval | pooled-with-floor | misses | misses      | suggest   |
| 0.90 / 0.95                            | within-interval | pooled            | meets  | meets       | **stage** |
| 0.90 / 0.95                            | within-interval | each-corpus       | misses | misses      | suggest   |

Under the targets (0.88 / 0.9, lower-bound, pooled-with-floor): **not-element verified**: `heldOutBands: ["not-element"]` (hide mode).

The `heldOut` record for `DEFAULT_THRESHOLDS["dr-qset-2"]["clef"]`:

```json
{
  "corpora": [
    {
      "corpus": "viewer",
      "sourceCommit": "607ca095cd56ce9ef8435f2880bf8e6d3c709fa5",
      "cards": 205,
      "accept": {
        "cards": 62,
        "correct": 58
      },
      "notElement": {
        "cards": 45,
        "correct": 42
      }
    },
    {
      "corpus": "jaeger-ui",
      "sourceCommit": "d6bbc16428e0e195f5e1e6bc7a2a400ef48a3c7b",
      "cards": 217,
      "accept": {
        "cards": 3,
        "correct": 1
      },
      "notElement": {
        "cards": 53,
        "correct": 53
      }
    },
    {
      "corpus": "miniflux",
      "sourceCommit": "fb043227ef6ad98569c848e8cdade0d237dab87e",
      "cards": 212,
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
      "corpus": "eshop",
      "sourceCommit": "913acea66708a59595351174cee9b29f37179d29",
      "cards": 233,
      "accept": {
        "cards": 54,
        "correct": 44
      },
      "notElement": {
        "cards": 37,
        "correct": 37
      }
    },
    {
      "corpus": "umami",
      "sourceCommit": "b18d5144dfe7342edeeca6f61d13ba3baabed9ad",
      "cards": 171,
      "accept": {
        "cards": 42,
        "correct": 42
      },
      "notElement": {
        "cards": 24,
        "correct": 24
      }
    }
  ],
  "run": "clef@cbm012-kind-tier0-qset2-spec013-domain",
  "cards": 1038,
  "specVersion": "0.13.0",
  "date": "2026-11-18",
  "serving": {
    "provider": "cloudflare-workers-ai",
    "upstream": null
  },
  "criteriaDigest": "669898936e41e287478f1f8349cc3e40118f9c8e245fd868c6157ac7256f312e",
  "accept": {
    "cards": 165,
    "correct": 148
  },
  "notElement": {
    "cards": 207,
    "correct": 203
  }
}
```
