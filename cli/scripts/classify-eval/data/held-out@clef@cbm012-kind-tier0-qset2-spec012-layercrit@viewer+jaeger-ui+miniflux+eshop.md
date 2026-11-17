# Held-out test: clef@cbm012-kind-tier0-qset2-spec012-layercrit on viewer, jaeger-ui, miniflux, eshop

Generated 2026-11-17T17:17:54.055Z by `held-out.ts`. Question set dr-qset-2, model clef, served by cloudflare-workers-ai, spec 0.12.0. Held-out corpora `viewer` at 607ca095cd56ce9ef8435f2880bf8e6d3c709fa5, `jaeger-ui` at d6bbc16428e0e195f5e1e6bc7a2a400ef48a3c7b, `miniflux` at fb043227ef6ad98569c848e8cdade0d237dab87e, `eshop` at 913acea66708a59595351174cee9b29f37179d29. Thresholds T_layer 0.6, T_type 0.4, T_none 0.6 (the defaults in `bands.ts`). Intervals are Wilson 95%.

| scope                                                 | gold cards | layer accuracy    | type accuracy, end to end | model-asked | accept: cards (coverage) | type precision      | not-element: cards (coverage) | precision           |
| ----------------------------------------------------- | ---------- | ----------------- | ------------------------- | ----------- | ------------------------ | ------------------- | ----------------------------- | ------------------- |
| viewer (held out)                                     | 300        | 62.7% (57.1-67.9) | 53.3% (47.7-58.9)         | 290         | 55 (19.0%)               | 9.1% (3.9-19.6)     | 51 (17.6%)                    | 84.3% (72.0-91.8)   |
| jaeger-ui (held out)                                  | 300        | 72.7% (67.4-77.4) | 63.7% (58.1-68.9)         | 294         | 11 (3.7%)                | 0.0% (0.0-25.9)     | 86 (29.3%)                    | 87.2% (78.5-92.7)   |
| miniflux (held out)                                   | 300        | 80.7% (75.8-84.7) | 79.0% (74.0-83.2)         | 217         | 4 (1.8%)                 | 100.0% (51.0-100.0) | 52 (24.0%)                    | 98.1% (89.9-99.7)   |
| eshop (held out)                                      | 300        | 81.7% (76.9-85.6) | 60.0% (54.4-65.4)         | 300         | 57 (19.0%)               | 24.6% (15.2-37.1)   | 44 (14.7%)                    | 100.0% (92.0-100.0) |
| held out, pooled (viewer, jaeger-ui, miniflux, eshop) | 1200       | 74.4% (71.9-76.8) | 64.0% (61.2-66.7)         | 1101        | 127 (11.5%)              | 18.1% (12.4-25.7)   | 233 (21.2%)                   | 91.4% (87.1-94.4)   |
| in-sample, pooled (dr-cli, fastapi, petclinic)        | 606        | 79.4% (76.0-82.4) | 70.5% (66.7-74.0)         | 521         | 103 (19.8%)              | 65.0% (55.4-73.6)   | 105 (20.2%)                   | 90.5% (83.4-94.7)   |
| dr-cli                                                | 300        | 72.0% (66.7-76.8) | 58.0% (52.3-63.4)         | 300         | 53 (17.7%)               | 43.4% (31.0-56.7)   | 45 (15.0%)                    | 84.4% (71.2-92.3)   |
| fastapi                                               | 200        | 82.5% (76.6-87.1) | 77.5% (71.2-82.7)         | 148         | 48 (32.4%)               | 87.5% (75.3-94.1)   | 22 (14.9%)                    | 90.9% (72.2-97.5)   |
| petclinic                                             | 106        | 94.3% (88.2-97.4) | 92.5% (85.8-96.1)         | 73          | 2 (2.7%)                 | 100.0% (34.2-100.0) | 38 (52.1%)                    | 97.4% (86.5-99.5)   |

## Verdict

Each band is verified on its own (`verdictOf`). Rule `lower-bound` (`HELD_OUT_RULE`): the band's Wilson interval clears the target (lower bound >= target); `within-interval` (shown for comparison): the interval reaches it. Pooling `pooled-with-floor` (`HELD_OUT_POOLING`): the band pooled over the held-out corpora meets the rule and no corpus's point estimate is under the target; `pooled` drops the floor; `each-corpus` asks every corpus to meet the rule alone. A band of fewer than 30 cards (`HELD_OUT_MIN_CARDS`) fails: here accept 127, not-element 233 pooled. Both bands verified is stage mode; the not-element band alone is hide mode.

| targets (type / none)                  | rule            | pooling           | accept | not-element | mode     |
| -------------------------------------- | --------------- | ----------------- | ------ | ----------- | -------- |
| 0.85 / 0.90                            | lower-bound     | pooled-with-floor | misses | misses      | suggest  |
| 0.85 / 0.90                            | lower-bound     | pooled            | misses | misses      | suggest  |
| 0.85 / 0.90                            | lower-bound     | each-corpus       | misses | misses      | suggest  |
| 0.85 / 0.90                            | within-interval | pooled-with-floor | misses | misses      | suggest  |
| 0.85 / 0.90                            | within-interval | pooled            | misses | meets       | **hide** |
| 0.85 / 0.90                            | within-interval | each-corpus       | misses | meets       | **hide** |
| 0.88 / 0.90 **(the targets and rule)** | lower-bound     | pooled-with-floor | misses | misses      | suggest  |
| 0.88 / 0.90                            | lower-bound     | pooled            | misses | misses      | suggest  |
| 0.88 / 0.90                            | lower-bound     | each-corpus       | misses | misses      | suggest  |
| 0.88 / 0.90                            | within-interval | pooled-with-floor | misses | misses      | suggest  |
| 0.88 / 0.90                            | within-interval | pooled            | misses | meets       | **hide** |
| 0.88 / 0.90                            | within-interval | each-corpus       | misses | meets       | **hide** |
| 0.90 / 0.90                            | lower-bound     | pooled-with-floor | misses | misses      | suggest  |
| 0.90 / 0.90                            | lower-bound     | pooled            | misses | misses      | suggest  |
| 0.90 / 0.90                            | lower-bound     | each-corpus       | misses | misses      | suggest  |
| 0.90 / 0.90                            | within-interval | pooled-with-floor | misses | misses      | suggest  |
| 0.90 / 0.90                            | within-interval | pooled            | misses | meets       | **hide** |
| 0.90 / 0.90                            | within-interval | each-corpus       | misses | meets       | **hide** |
| 0.90 / 0.95                            | lower-bound     | pooled-with-floor | misses | misses      | suggest  |
| 0.90 / 0.95                            | lower-bound     | pooled            | misses | misses      | suggest  |
| 0.90 / 0.95                            | lower-bound     | each-corpus       | misses | misses      | suggest  |
| 0.90 / 0.95                            | within-interval | pooled-with-floor | misses | misses      | suggest  |
| 0.90 / 0.95                            | within-interval | pooled            | misses | misses      | suggest  |
| 0.90 / 0.95                            | within-interval | each-corpus       | misses | misses      | suggest  |

Under the targets (0.88 / 0.9, lower-bound, pooled-with-floor): **neither band verified**: `in-sample` (suggest mode).

The `heldOut` record for `DEFAULT_THRESHOLDS["dr-qset-2"]["clef"]`:

```json
{
  "corpora": [
    {
      "corpus": "viewer",
      "sourceCommit": "607ca095cd56ce9ef8435f2880bf8e6d3c709fa5",
      "cards": 290,
      "accept": {
        "cards": 55,
        "correct": 5
      },
      "notElement": {
        "cards": 51,
        "correct": 43
      }
    },
    {
      "corpus": "jaeger-ui",
      "sourceCommit": "d6bbc16428e0e195f5e1e6bc7a2a400ef48a3c7b",
      "cards": 294,
      "accept": {
        "cards": 11,
        "correct": 0
      },
      "notElement": {
        "cards": 86,
        "correct": 75
      }
    },
    {
      "corpus": "miniflux",
      "sourceCommit": "fb043227ef6ad98569c848e8cdade0d237dab87e",
      "cards": 217,
      "accept": {
        "cards": 4,
        "correct": 4
      },
      "notElement": {
        "cards": 52,
        "correct": 51
      }
    },
    {
      "corpus": "eshop",
      "sourceCommit": "913acea66708a59595351174cee9b29f37179d29",
      "cards": 300,
      "accept": {
        "cards": 57,
        "correct": 14
      },
      "notElement": {
        "cards": 44,
        "correct": 44
      }
    }
  ],
  "run": "clef@cbm012-kind-tier0-qset2-spec012-layercrit",
  "cards": 1101,
  "specVersion": "0.12.0",
  "date": "2026-11-17",
  "serving": {
    "provider": "cloudflare-workers-ai",
    "upstream": null
  },
  "criteriaDigest": "e069521f07beec91794678e268f9203d830b3a0dc1686eec718db82538f0dde5",
  "accept": {
    "cards": 127,
    "correct": 23
  },
  "notElement": {
    "cards": 233,
    "correct": 213
  }
}
```
