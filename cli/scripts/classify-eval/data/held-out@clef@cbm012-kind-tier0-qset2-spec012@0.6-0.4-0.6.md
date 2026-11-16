# Held-out test: clef@cbm012-kind-tier0-qset2-spec012 on viewer

Generated 2026-11-16T14:32:32.743Z by `held-out.ts`. Question set dr-qset-2, model clef, served by cloudflare-workers-ai, spec 0.12.0. Held-out corpus `viewer` at 607ca095cd56ce9ef8435f2880bf8e6d3c709fa5. Thresholds T_layer 0.6, T_type 0.4, T_none 0.6 (--thresholds). Intervals are Wilson 95%.

| scope                                          | gold cards | layer accuracy    | type accuracy, end to end | model-asked | accept: cards (coverage) | type precision      | not-element: cards (coverage) | precision           |
| ---------------------------------------------- | ---------- | ----------------- | ------------------------- | ----------- | ------------------------ | ------------------- | ----------------------------- | ------------------- |
| viewer (held out)                              | 300        | 80.0% (75.1-84.1) | 73.0% (67.7-77.7)         | 290         | 19 (6.6%)                | 84.2% (62.4-94.5)   | 50 (17.2%)                    | 88.0% (76.2-94.4)   |
| in-sample, pooled (dr-cli, fastapi, petclinic) | 606        | 79.0% (75.6-82.1) | 72.3% (68.6-75.7)         | 521         | 45 (8.6%)                | 86.7% (73.8-93.7)   | 104 (20.0%)                   | 88.5% (80.9-93.3)   |
| dr-cli                                         | 300        | 73.7% (68.4-78.3) | 63.7% (58.1-68.9)         | 300         | 6 (2.0%)                 | 100.0% (61.0-100.0) | 59 (19.7%)                    | 83.1% (71.5-90.5)   |
| fastapi                                        | 200        | 79.5% (73.4-84.5) | 74.5% (68.0-80.0)         | 148         | 39 (26.4%)               | 84.6% (70.3-92.8)   | 16 (10.8%)                    | 87.5% (64.0-96.5)   |
| petclinic                                      | 106        | 93.4% (87.0-96.8) | 92.5% (85.8-96.1)         | 73          | 0 (0.0%)                 | n/a                 | 29 (39.7%)                    | 100.0% (88.3-100.0) |

## Verdict

The defaults count as `held-out` when both bands on the held-out corpus meet their targets. Rule `within-interval` (section 6, `HELD_OUT_RULE`): the band's Wilson interval reaches the target (upper bound >= target). `lower-bound`: the whole interval clears it. A band with no cards fails.

| targets (type / none)         | rule            | accept | not-element | verdict      |
| ----------------------------- | --------------- | ------ | ----------- | ------------ |
| 0.85 / 0.90                   | within-interval | meets  | meets       | **held-out** |
| 0.85 / 0.90                   | lower-bound     | misses | misses      | in-sample    |
| 0.88 / 0.90 **(provisional)** | within-interval | meets  | meets       | **held-out** |
| 0.88 / 0.90                   | lower-bound     | misses | misses      | in-sample    |
| 0.90 / 0.90                   | within-interval | meets  | meets       | **held-out** |
| 0.90 / 0.90                   | lower-bound     | misses | misses      | in-sample    |
| 0.90 / 0.95                   | within-interval | meets  | misses      | in-sample    |
| 0.90 / 0.95                   | lower-bound     | misses | misses      | in-sample    |

Under the provisional targets (0.88 / 0.9, within-interval): **held-out**.

The `heldOut` record for `DEFAULT_THRESHOLDS["dr-qset-2"]["clef"]`:

```json
{
  "corpus": "viewer",
  "sourceCommit": "607ca095cd56ce9ef8435f2880bf8e6d3c709fa5",
  "run": "clef@cbm012-kind-tier0-qset2-spec012",
  "cards": 290,
  "specVersion": "0.12.0",
  "date": "2026-11-16",
  "accept": {
    "cards": 19,
    "correct": 16
  },
  "notElement": {
    "cards": 50,
    "correct": 44
  }
}
```
