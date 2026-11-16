# Held-out test: clef@cbm012-kind-tier0-qset2-spec012-layercrit on viewer, jaeger-ui, miniflux, eshop

Generated 2026-11-16T18:45:38.788Z by `held-out.ts`. Question set dr-qset-2, model clef, served by cloudflare-workers-ai, spec 0.12.0. Held-out corpora `viewer` at 607ca095cd56ce9ef8435f2880bf8e6d3c709fa5, `jaeger-ui` at d6bbc16428e0e195f5e1e6bc7a2a400ef48a3c7b, `miniflux` at fb043227ef6ad98569c848e8cdade0d237dab87e, `eshop` at 913acea66708a59595351174cee9b29f37179d29. Thresholds T_layer 0.6, T_type 0.4, T_none 0.6 (the defaults in `bands.ts`). Intervals are Wilson 95%. In-sample rows score against `gold@relabel-full.jsonl`.

| scope                                                 | gold cards | layer accuracy    | type accuracy, end to end | model-asked | accept: cards (coverage) | type precision      | not-element: cards (coverage) | precision           |
| ----------------------------------------------------- | ---------- | ----------------- | ------------------------- | ----------- | ------------------------ | ------------------- | ----------------------------- | ------------------- |
| viewer (held out)                                     | 300        | 83.3% (78.7-87.1) | 74.0% (68.8-78.6)         | 290         | 55 (19.0%)               | 83.6% (71.7-91.1)   | 51 (17.6%)                    | 94.1% (84.1-98.0)   |
| jaeger-ui (held out)                                  | 300        | 83.7% (79.1-87.4) | 74.7% (69.5-79.3)         | 294         | 11 (3.7%)                | 72.7% (43.4-90.3)   | 86 (29.3%)                    | 100.0% (95.7-100.0) |
| miniflux (held out)                                   | 300        | 80.7% (75.8-84.7) | 79.0% (74.0-83.2)         | 217         | 4 (1.8%)                 | 100.0% (51.0-100.0) | 52 (24.0%)                    | 98.1% (89.9-99.7)   |
| eshop (held out)                                      | 300        | 79.3% (74.4-83.5) | 63.7% (58.1-68.9)         | 300         | 57 (19.0%)               | 43.9% (31.8-56.7)   | 44 (14.7%)                    | 100.0% (92.0-100.0) |
| held out, pooled (viewer, jaeger-ui, miniflux, eshop) | 1200       | 81.8% (79.5-83.8) | 72.8% (70.2-75.3)         | 1101        | 127 (11.5%)              | 65.4% (56.7-73.1)   | 233 (21.2%)                   | 98.3% (95.7-99.3)   |
| in-sample, pooled (dr-cli, fastapi, petclinic)        | 606        | 84.5% (81.4-87.2) | 75.7% (72.2-79.0)         | 521         | 103 (19.8%)              | 91.3% (84.2-95.3)   | 105 (20.2%)                   | 96.2% (90.6-98.5)   |
| dr-cli                                                | 300        | 87.7% (83.5-90.9) | 74.0% (68.8-78.6)         | 300         | 53 (17.7%)               | 94.3% (84.6-98.1)   | 45 (15.0%)                    | 97.8% (88.4-99.6)   |
| fastapi                                               | 200        | 79.0% (72.8-84.1) | 74.0% (67.5-79.6)         | 148         | 48 (32.4%)               | 87.5% (75.3-94.1)   | 22 (14.9%)                    | 90.9% (72.2-97.5)   |
| petclinic                                             | 106        | 85.8% (78.0-91.2) | 84.0% (75.8-89.7)         | 73          | 2 (2.7%)                 | 100.0% (34.2-100.0) | 38 (52.1%)                    | 97.4% (86.5-99.5)   |

## Verdict

Each band is verified on its own (`verdictOf`). Rule `lower-bound` (`HELD_OUT_RULE`): the band's Wilson interval clears the target (lower bound >= target); `within-interval` (shown for comparison): the interval reaches it. Pooling `pooled-with-floor` (`HELD_OUT_POOLING`): the band pooled over the held-out corpora meets the rule and no corpus's point estimate is under the target; `pooled` drops the floor; `each-corpus` asks every corpus to meet the rule alone. A band of fewer than 30 cards (`HELD_OUT_MIN_CARDS`) fails: here accept 127, not-element 233 pooled. Both bands verified is stage mode; the not-element band alone is hide mode.

| targets (type / none)                   | rule            | pooling           | accept | not-element | mode     |
| --------------------------------------- | --------------- | ----------------- | ------ | ----------- | -------- |
| 0.85 / 0.90                             | lower-bound     | pooled-with-floor | misses | meets       | **hide** |
| 0.85 / 0.90                             | lower-bound     | pooled            | misses | meets       | **hide** |
| 0.85 / 0.90                             | lower-bound     | each-corpus       | misses | misses      | suggest  |
| 0.85 / 0.90                             | within-interval | pooled-with-floor | misses | meets       | **hide** |
| 0.85 / 0.90                             | within-interval | pooled            | misses | meets       | **hide** |
| 0.85 / 0.90                             | within-interval | each-corpus       | misses | meets       | **hide** |
| 0.88 / 0.90 **(provisional, the rule)** | lower-bound     | pooled-with-floor | misses | meets       | **hide** |
| 0.88 / 0.90                             | lower-bound     | pooled            | misses | meets       | **hide** |
| 0.88 / 0.90                             | lower-bound     | each-corpus       | misses | misses      | suggest  |
| 0.88 / 0.90                             | within-interval | pooled-with-floor | misses | meets       | **hide** |
| 0.88 / 0.90                             | within-interval | pooled            | misses | meets       | **hide** |
| 0.88 / 0.90                             | within-interval | each-corpus       | misses | meets       | **hide** |
| 0.90 / 0.90                             | lower-bound     | pooled-with-floor | misses | meets       | **hide** |
| 0.90 / 0.90                             | lower-bound     | pooled            | misses | meets       | **hide** |
| 0.90 / 0.90                             | lower-bound     | each-corpus       | misses | misses      | suggest  |
| 0.90 / 0.90                             | within-interval | pooled-with-floor | misses | meets       | **hide** |
| 0.90 / 0.90                             | within-interval | pooled            | misses | meets       | **hide** |
| 0.90 / 0.90                             | within-interval | each-corpus       | misses | meets       | **hide** |
| 0.90 / 0.95                             | lower-bound     | pooled-with-floor | misses | misses      | suggest  |
| 0.90 / 0.95                             | lower-bound     | pooled            | misses | meets       | **hide** |
| 0.90 / 0.95                             | lower-bound     | each-corpus       | misses | misses      | suggest  |
| 0.90 / 0.95                             | within-interval | pooled-with-floor | misses | misses      | suggest  |
| 0.90 / 0.95                             | within-interval | pooled            | misses | meets       | **hide** |
| 0.90 / 0.95                             | within-interval | each-corpus       | misses | meets       | **hide** |

Under the provisional targets (0.88 / 0.9, lower-bound, pooled-with-floor): **not-element verified**: `heldOutBands: ["not-element"]` (hide mode).

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
        "correct": 46
      },
      "notElement": {
        "cards": 51,
        "correct": 48
      }
    },
    {
      "corpus": "jaeger-ui",
      "sourceCommit": "d6bbc16428e0e195f5e1e6bc7a2a400ef48a3c7b",
      "cards": 294,
      "accept": {
        "cards": 11,
        "correct": 8
      },
      "notElement": {
        "cards": 86,
        "correct": 86
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
        "correct": 25
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
  "date": "2026-11-16",
  "serving": {
    "provider": "cloudflare-workers-ai",
    "upstream": null
  },
  "criteriaDigest": "e069521f07beec91794678e268f9203d830b3a0dc1686eec718db82538f0dde5",
  "accept": {
    "cards": 127,
    "correct": 83
  },
  "notElement": {
    "cards": 233,
    "correct": 229
  }
}
```
