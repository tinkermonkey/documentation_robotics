# Held-out test: clef@cbm012-kind-tier0-qset2-spec012-layercrit on jaeger-ui

Generated 2026-11-16T18:24:42.103Z by `held-out.ts`. Question set dr-qset-2, model clef, served by cloudflare-workers-ai, spec 0.12.0. Held-out corpus `jaeger-ui` at d6bbc16428e0e195f5e1e6bc7a2a400ef48a3c7b. Thresholds T_layer 0.6, T_type 0.4, T_none 0.6 (the defaults in `bands.ts`). Intervals are Wilson 95%. In-sample rows score against `gold@relabel-full.jsonl`.

| scope                                          | gold cards | layer accuracy    | type accuracy, end to end | model-asked | accept: cards (coverage) | type precision      | not-element: cards (coverage) | precision           |
| ---------------------------------------------- | ---------- | ----------------- | ------------------------- | ----------- | ------------------------ | ------------------- | ----------------------------- | ------------------- |
| jaeger-ui (held out)                           | 300        | 83.7% (79.1-87.4) | 74.7% (69.5-79.3)         | 294         | 11 (3.7%)                | 72.7% (43.4-90.3)   | 86 (29.3%)                    | 100.0% (95.7-100.0) |
| in-sample, pooled (dr-cli, fastapi, petclinic) | 606        | 84.5% (81.4-87.2) | 75.7% (72.2-79.0)         | 521         | 103 (19.8%)              | 91.3% (84.2-95.3)   | 105 (20.2%)                   | 96.2% (90.6-98.5)   |
| dr-cli                                         | 300        | 87.7% (83.5-90.9) | 74.0% (68.8-78.6)         | 300         | 53 (17.7%)               | 94.3% (84.6-98.1)   | 45 (15.0%)                    | 97.8% (88.4-99.6)   |
| fastapi                                        | 200        | 79.0% (72.8-84.1) | 74.0% (67.5-79.6)         | 148         | 48 (32.4%)               | 87.5% (75.3-94.1)   | 22 (14.9%)                    | 90.9% (72.2-97.5)   |
| petclinic                                      | 106        | 85.8% (78.0-91.2) | 84.0% (75.8-89.7)         | 73          | 2 (2.7%)                 | 100.0% (34.2-100.0) | 38 (52.1%)                    | 97.4% (86.5-99.5)   |

## Verdict

The defaults count as `held-out` when both bands on the held-out corpus meet their targets. Rule `lower-bound` (`HELD_OUT_RULE`): the band's whole Wilson interval clears the target (lower bound >= target). `within-interval` (an alternative, shown for comparison): the interval reaches it (upper bound >= target). Under both, a band of fewer than 30 cards (`HELD_OUT_MIN_CARDS`) fails: here accept 11, not-element 86.

| targets (type / none)         | rule            | accept                 | not-element | verdict   |
| ----------------------------- | --------------- | ---------------------- | ----------- | --------- |
| 0.85 / 0.90                   | lower-bound     | misses (11 < 30 cards) | meets       | in-sample |
| 0.85 / 0.90                   | within-interval | misses (11 < 30 cards) | meets       | in-sample |
| 0.88 / 0.90 **(provisional)** | lower-bound     | misses (11 < 30 cards) | meets       | in-sample |
| 0.88 / 0.90                   | within-interval | misses (11 < 30 cards) | meets       | in-sample |
| 0.90 / 0.90                   | lower-bound     | misses (11 < 30 cards) | meets       | in-sample |
| 0.90 / 0.90                   | within-interval | misses (11 < 30 cards) | meets       | in-sample |
| 0.90 / 0.95                   | lower-bound     | misses (11 < 30 cards) | meets       | in-sample |
| 0.90 / 0.95                   | within-interval | misses (11 < 30 cards) | meets       | in-sample |

Under the provisional targets (0.88 / 0.9, lower-bound): **in-sample**.

The `heldOut` record for `DEFAULT_THRESHOLDS["dr-qset-2"]["clef"]`:

```json
{
  "corpus": "jaeger-ui",
  "sourceCommit": "d6bbc16428e0e195f5e1e6bc7a2a400ef48a3c7b",
  "run": "clef@cbm012-kind-tier0-qset2-spec012-layercrit",
  "cards": 294,
  "specVersion": "0.12.0",
  "date": "2026-11-16",
  "serving": {
    "provider": "cloudflare-workers-ai",
    "upstream": null
  },
  "criteriaDigest": "e069521f07beec91794678e268f9203d830b3a0dc1686eec718db82538f0dde5",
  "accept": {
    "cards": 11,
    "correct": 8
  },
  "notElement": {
    "cards": 86,
    "correct": 86
  }
}
```
