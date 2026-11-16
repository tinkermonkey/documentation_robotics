# Held-out test: clef@cbm012-kind-tier0-qset2-spec012-layercrit on viewer

Generated 2026-11-16T16:00:10.138Z by `held-out.ts`. Question set dr-qset-2, model clef, served by cloudflare-workers-ai, spec 0.12.0. Held-out corpus `viewer` at 607ca095cd56ce9ef8435f2880bf8e6d3c709fa5. Thresholds T_layer 0.6, T_type 0.4, T_none 0.6 (the defaults in `bands.ts`). Intervals are Wilson 95%.

| scope                                          | gold cards | layer accuracy    | type accuracy, end to end | model-asked | accept: cards (coverage) | type precision      | not-element: cards (coverage) | precision         |
| ---------------------------------------------- | ---------- | ----------------- | ------------------------- | ----------- | ------------------------ | ------------------- | ----------------------------- | ----------------- |
| viewer (held out)                              | 300        | 83.3% (78.7-87.1) | 74.0% (68.8-78.6)         | 290         | 55 (19.0%)               | 83.6% (71.7-91.1)   | 51 (17.6%)                    | 94.1% (84.1-98.0) |
| in-sample, pooled (dr-cli, fastapi, petclinic) | 606        | 88.9% (86.2-91.2) | 80.0% (76.7-83.0)         | 521         | 103 (19.8%)              | 94.2% (87.9-97.3)   | 105 (20.2%)                   | 95.2% (89.3-97.9) |
| dr-cli                                         | 300        | 88.0% (83.8-91.2) | 74.7% (69.5-79.3)         | 300         | 53 (17.7%)               | 98.1% (90.1-99.7)   | 45 (15.0%)                    | 95.6% (85.2-98.8) |
| fastapi                                        | 200        | 86.5% (81.1-90.6) | 80.5% (74.5-85.4)         | 148         | 48 (32.4%)               | 89.6% (77.8-95.5)   | 22 (14.9%)                    | 90.9% (72.2-97.5) |
| petclinic                                      | 106        | 96.2% (90.7-98.5) | 94.3% (88.2-97.4)         | 73          | 2 (2.7%)                 | 100.0% (34.2-100.0) | 38 (52.1%)                    | 97.4% (86.5-99.5) |

## Verdict

The defaults count as `held-out` when both bands on the held-out corpus meet their targets. Rule `lower-bound` (`HELD_OUT_RULE`): the band's whole Wilson interval clears the target (lower bound >= target). `within-interval` (an alternative, shown for comparison): the interval reaches it (upper bound >= target). Under both, a band of fewer than 30 cards (`HELD_OUT_MIN_CARDS`) fails: here accept 55, not-element 51.

| targets (type / none)         | rule            | accept            | not-element       | verdict      |
| ----------------------------- | --------------- | ----------------- | ----------------- | ------------ |
| 0.85 / 0.90                   | lower-bound     | misses (interval) | misses (interval) | in-sample    |
| 0.85 / 0.90                   | within-interval | meets             | meets             | **held-out** |
| 0.88 / 0.90 **(provisional)** | lower-bound     | misses (interval) | misses (interval) | in-sample    |
| 0.88 / 0.90                   | within-interval | meets             | meets             | **held-out** |
| 0.90 / 0.90                   | lower-bound     | misses (interval) | misses (interval) | in-sample    |
| 0.90 / 0.90                   | within-interval | meets             | meets             | **held-out** |
| 0.90 / 0.95                   | lower-bound     | misses (interval) | misses (interval) | in-sample    |
| 0.90 / 0.95                   | within-interval | meets             | meets             | **held-out** |

The predictions don't record their criteria digest (runs before 2026-11-16): the record takes the digest of the criteria this CLI builds from its bundled spec, e069521f07be…, which is right only if the run used them.

Under the provisional targets (0.88 / 0.9, lower-bound): **in-sample**.

The `heldOut` record for `DEFAULT_THRESHOLDS["dr-qset-2"]["clef"]`:

```json
{
  "corpus": "viewer",
  "sourceCommit": "607ca095cd56ce9ef8435f2880bf8e6d3c709fa5",
  "run": "clef@cbm012-kind-tier0-qset2-spec012-layercrit",
  "cards": 290,
  "specVersion": "0.12.0",
  "date": "2026-11-16",
  "serving": {
    "provider": "cloudflare-workers-ai",
    "upstream": null
  },
  "criteriaDigest": "e069521f07beec91794678e268f9203d830b3a0dc1686eec718db82538f0dde5",
  "accept": {
    "cards": 55,
    "correct": 46
  },
  "notElement": {
    "cards": 51,
    "correct": 48
  }
}
```
