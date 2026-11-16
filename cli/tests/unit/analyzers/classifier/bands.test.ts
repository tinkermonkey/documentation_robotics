import { describe, expect, test } from "bun:test";
import {
  bandOf,
  CURRENT_QSET_ID,
  DEFAULT_THRESHOLDS,
  HELD_OUT_MIN_CARDS,
  HELD_OUT_RULE,
  criteriaDigest,
  loadSpecCriteria,
  heldOutVerdict,
  meetsTarget,
  modeOf,
  resolveModel,
  thresholdsFor,
  TIER1_TARGETS,
  topOf,
  verdictOf,
  wilson,
  type HeldOutRecord,
  type ThresholdRecord,
} from "../../../../src/analyzers/classifier/index.js";

const T = { layer: 0.6, type: 0.4, none: 0.6 };

describe("bandOf", () => {
  test("accept: a real layer at or above T_layer and a type at or above T_type", () => {
    expect(bandOf({ layer: "application", layerP: 0.71, type: "applicationfunction", typeP: 0.46 }, T)).toBe("accept");
    expect(bandOf({ layer: "application", layerP: 0.6, type: "applicationfunction", typeP: 0.4 }, T)).toBe("accept");
  });

  test("not-element: top layer none at or above T_none", () => {
    expect(bandOf({ layer: "none", layerP: 0.72, type: null, typeP: null }, T)).toBe("not-element");
  });

  test("escalate: an accept-level layer with a low type p, no type, or type none", () => {
    expect(bandOf({ layer: "application", layerP: 0.9, type: "dataobject", typeP: 0.39 }, T)).toBe("escalate");
    expect(bandOf({ layer: "application", layerP: 0.9, type: null, typeP: null }, T)).toBe("escalate");
    expect(bandOf({ layer: "application", layerP: 0.9, type: "none", typeP: 0.9 }, T)).toBe("escalate");
  });

  test("a low-confidence card escalates; nothing is dropped", () => {
    expect(bandOf({ layer: "application", layerP: 0.3, type: "dataobject", typeP: 0.9 }, T)).toBe("escalate");
    expect(bandOf({ layer: "none", layerP: 0.3, type: null, typeP: null }, T)).toBe("escalate");
    expect(bandOf({ layer: "none", layerP: 0.05, type: null, typeP: null }, T)).toBe("escalate");
  });

  test("a card Tier 1 couldn't answer escalates", () => {
    expect(bandOf(null, T)).toBe("escalate");
    expect(bandOf({ layer: "application", layerP: NaN, type: "x", typeP: 1 }, T)).toBe("escalate");
  });

  test("no thresholds, no bands: every card escalates", () => {
    expect(bandOf({ layer: "application", layerP: 0.99, type: "dataobject", typeP: 0.99 }, null)).toBe("escalate");
    expect(bandOf({ layer: "none", layerP: 0.99, type: null, typeP: null }, null)).toBe("escalate");
  });
});

describe("thresholds and mode", () => {
  test("Clef's dr-qset-1 defaults are T_layer 0.6, T_type 0.4, T_none 0.6 (spec 0.10.0), in-sample, in suggest mode", () => {
    expect(thresholdsFor("dr-qset-1", "clef")).toEqual(T);
    expect(DEFAULT_THRESHOLDS["dr-qset-1"].clef.fit).toBe("in-sample");
    expect(DEFAULT_THRESHOLDS["dr-qset-1"].clef.record?.specVersion).toBe("0.10.0");
    expect(modeOf("dr-qset-1", "clef")).toBe("suggest");
  });

  test("Clef's dr-qset-2 defaults are fitted on the bundled spec with the layer criteria rule: T_layer 0.6, T_type 0.4, T_none 0.6, in-sample", () => {
    expect(thresholdsFor("dr-qset-2", "clef")).toEqual({ layer: 0.6, type: 0.4, none: 0.6 });
    expect(DEFAULT_THRESHOLDS["dr-qset-2"].clef.record).toMatchObject({ run: "clef@cbm012-kind-tier0-qset2-spec012-layercrit", specVersion: "0.12.0" });
    expect(DEFAULT_THRESHOLDS["dr-qset-2"].clef.fit).toBe("in-sample");
    expect(modeOf("dr-qset-2", "clef")).toBe("suggest");
  });

  test("the current question set has Clef defaults", () => {
    expect(thresholdsFor(CURRENT_QSET_ID, "clef")).not.toBeNull();
  });

  test("Clef on Workers AI gets them through its canonical model", () => {
    const clef = resolveModel("cloudflare-workers-ai", "clef");
    expect(clef?.canonicalModel).toBe("clef");
    expect(thresholdsFor("dr-qset-1", clef!.canonicalModel)).toEqual(T);
    const flash = resolveModel("cloudflare-workers-ai", "clef-flash");
    expect(thresholdsFor("dr-qset-1", flash!.canonicalModel)).toBeNull();
  });

  test("every default carries its fit record; only one whose held-out record passes the targets is held-out, and only that one stages", () => {
    for (const [qset, models] of Object.entries(DEFAULT_THRESHOLDS)) {
      for (const [model, d] of Object.entries(models)) {
        if (d.fit === "held-out") {
          // Changing TIER1_TARGETS or HELD_OUT_RULE so that the B5 result no longer passes fails here.
          expect(d.heldOut).toBeDefined();
          expect(verdictOf(d.heldOut!).pass).toBe(true);
          expect(modeOf(qset, model)).toBe("stage");
        } else {
          expect(d.fit).toBe("in-sample");
          expect(modeOf(qset, model)).toBe("suggest");
        }
        if (d.heldOut) {
          expect(d.heldOut.corpus).toBe("viewer");
          expect(d.heldOut.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
          expect(d.heldOut.accept.correct).toBeLessThanOrEqual(d.heldOut.accept.cards);
          expect(d.heldOut.notElement.correct).toBeLessThanOrEqual(d.heldOut.notElement.cards);
        }
        const r = d.record!;
        expect(r).toBeDefined();
        expect(r.cards).toBe(Object.values(r.corpora).reduce((a, b) => a + b, 0));
        expect(r.specVersion).toMatch(/^\d+\.\d+\.\d+$/);
        expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.accept.cards).toBeGreaterThan(0);
        expect(r.accept.typePrecision).toBeGreaterThanOrEqual(r.targets.typePrecision);
        expect(r.notElement.precision).toBeGreaterThanOrEqual(r.targets.nonePrecision);
      }
    }
  });

  test("defaults key on canonical model, so every provider serving Clef gets the same", () => {
    const defaults: Record<string, Record<string, ThresholdRecord>> = { "dr-qset-1": { clef: { ...T, fit: "in-sample" } } };
    expect(thresholdsFor("dr-qset-1", "clef", undefined, defaults)).toEqual(T);
    expect(thresholdsFor("dr-qset-1", "clef-flash", undefined, defaults)).toBeNull();
    expect(thresholdsFor("dr-qset-2", "clef", undefined, defaults)).toBeNull();
    expect(modeOf("dr-qset-1", "clef", defaults)).toBe("suggest");
    expect(modeOf("dr-qset-1", "clef", { "dr-qset-1": { clef: { ...T, fit: "held-out" } } })).toBe("stage");
  });

  test("overrides: a full override needs no default; a partial one adjusts a default", () => {
    expect(thresholdsFor("dr-qset-1", "jev-1.14", { layer: 0.7, type: 0.5, none: 0.8 })).toEqual({ layer: 0.7, type: 0.5, none: 0.8 });
    expect(thresholdsFor("dr-qset-1", "jev-1.14", { layer: 0.7 })).toBeNull();
    expect(thresholdsFor("dr-qset-1", "clef", { layer: 0.7 })).toEqual({ layer: 0.7, type: 0.4, none: 0.6 });
    const defaults: Record<string, Record<string, ThresholdRecord>> = { "dr-qset-1": { clef: { ...T, fit: "in-sample" } } };
    expect(thresholdsFor("dr-qset-1", "clef", { layer: 0.7 }, defaults)).toEqual({ layer: 0.7, type: 0.4, none: 0.6 });
  });

  test("dr-qset-2 x clef carries its B5 result on the viewer corpus, which doesn't pass the rule", async () => {
    const h = DEFAULT_THRESHOLDS["dr-qset-2"].clef.heldOut!;
    expect(h).toMatchObject({
      corpus: "viewer",
      run: "clef@cbm012-kind-tier0-qset2-spec012-layercrit",
      specVersion: "0.12.0",
      serving: { provider: "cloudflare-workers-ai", upstream: null },
      accept: { cards: 55, correct: 46 },
      notElement: { cards: 51, correct: 48 },
    });
    // The record's criteria are the ones this CLI sends.
    expect(h.criteriaDigest).toBe(criteriaDigest(await loadSpecCriteria()));
    expect(verdictOf(h)).toEqual({ pass: false, accept: false, notElement: false });
    // Under the alternative reading it would pass: the reason the rule is lower-bound.
    expect(verdictOf(h, TIER1_TARGETS, "within-interval").pass).toBe(true);
  });

  test("topOf: the most probable option, the first on a tie", () => {
    expect(topOf({ a: 0.2, b: 0.5, c: 0.5 })).toEqual({ option: "b", p: 0.5 });
    expect(topOf({})).toBeNull();
  });
});

describe("the held-out test (section 6)", () => {
  test("wilson: the 95% score interval, null with no trials", () => {
    expect(wilson(0, 0)).toBeNull();
    const w = wilson(4, 4)!;
    expect(w.hi).toBe(1);
    expect(w.lo).toBeCloseTo(0.51, 2);
    const x = wilson(22, 23)!;
    expect(x.lo).toBeCloseTo(0.79, 2);
    expect(x.hi).toBeCloseTo(0.992, 3);
  });

  test("TIER1_TARGETS are provisional (0.88 / 0.90); the rule is lower-bound with at least 30 cards a band", () => {
    expect(TIER1_TARGETS).toEqual({ typePrecision: 0.88, nonePrecision: 0.9 });
    expect(HELD_OUT_RULE).toBe("lower-bound");
    expect(HELD_OUT_MIN_CARDS).toBe(30);
    // 29 all right is the smallest band whose lower bound clears 0.88, so the minimum is no stricter than the rule for a perfect band.
    expect(wilson(29, 29)!.lo).toBeGreaterThanOrEqual(0.88);
    expect(wilson(28, 28)!.lo).toBeLessThan(0.88);
  });

  test("minimum band size: a band under HELD_OUT_MIN_CARDS fails under either rule, however precise", () => {
    expect(meetsTarget({ cards: 4, correct: 4 }, 0.5, "within-interval")).toBe(false);
    expect(meetsTarget({ cards: 29, correct: 29 }, 0.5, "lower-bound")).toBe(false);
    expect(meetsTarget({ cards: 30, correct: 30 }, 0.88, "lower-bound")).toBe(true);
    // An explicit minimum overrides it.
    expect(meetsTarget({ cards: 29, correct: 29 }, 0.88, "lower-bound", 20)).toBe(true);
    expect(meetsTarget({ cards: 0, correct: 0 }, 0.5, "within-interval", 0)).toBe(false);
  });

  test("lower bound: the whole interval must clear the target", () => {
    // 55 cards, 46 right (83.6%, Wilson 71.7-91.1): within reach of 0.88, but not clear of it.
    expect(meetsTarget({ cards: 55, correct: 46 }, 0.88)).toBe(false);
    expect(meetsTarget({ cards: 55, correct: 46 }, 0.88, "within-interval")).toBe(true);
    expect(meetsTarget({ cards: 200, correct: 198 }, 0.9)).toBe(true);
    expect(meetsTarget({ cards: 40, correct: 39 }, 0.88)).toBe(false); // lower bound 87.1%
    expect(meetsTarget({ cards: 40, correct: 40 }, 0.88)).toBe(true); // 91.2%
  });

  test("within-interval, the alternative: the interval reaches the target", () => {
    // 34 of 40 = 85%, Wilson 70.9-92.9: reaches 0.88 and 0.90, not 0.95.
    expect(meetsTarget({ cards: 40, correct: 34 }, 0.88, "within-interval")).toBe(true);
    expect(meetsTarget({ cards: 40, correct: 34 }, 0.95, "within-interval")).toBe(false);
    expect(meetsTarget({ cards: 100, correct: 60 }, 0.88, "within-interval")).toBe(false);
  });

  test("heldOutVerdict needs both bands, and moves with the targets, the rule and the minimum", () => {
    const bands = { accept: { cards: 150, correct: 147 }, notElement: { cards: 60, correct: 60 } };
    expect(heldOutVerdict(bands)).toEqual({ pass: true, accept: true, notElement: true });
    expect(heldOutVerdict(bands, { typePrecision: 0.9, nonePrecision: 0.95 })).toEqual({ pass: false, accept: true, notElement: false });
    expect(heldOutVerdict(bands, TIER1_TARGETS, "lower-bound", 100)).toEqual({ pass: false, accept: true, notElement: false });
    expect(heldOutVerdict({ accept: { cards: 0, correct: 0 }, notElement: { cards: 50, correct: 50 } }).pass).toBe(false);
  });

  test("verdictOf reads a record's counts, so the targets can change without rescoring", () => {
    const record: HeldOutRecord = {
      corpus: "viewer",
      sourceCommit: "0".repeat(40),
      run: "clef@x",
      cards: 290,
      specVersion: "0.12.0",
      date: "2026-11-16",
      serving: { provider: "cloudflare-workers-ai", upstream: null },
      criteriaDigest: "d".repeat(64),
      accept: { cards: 4, correct: 4 },
      notElement: { cards: 23, correct: 22 },
    };
    // The B5 counts of the earlier (spec-0.12.0, modelling-rules) defaults: too small to pass now.
    expect(verdictOf(record).pass).toBe(false);
    expect(verdictOf(record, TIER1_TARGETS, "within-interval").pass).toBe(false);
    expect(verdictOf(record, TIER1_TARGETS, "within-interval", 0).pass).toBe(true);
  });

  test("modeOf stages only a held-out default", () => {
    const t = { layer: 0.7, type: 0.5, none: 0.7 };
    expect(modeOf("q", "m", { q: { m: { ...t, fit: "in-sample" } } })).toBe("suggest");
    expect(modeOf("q", "m", { q: { m: { ...t, fit: "held-out" } } })).toBe("stage");
    expect(modeOf("q", "other", { q: { m: { ...t, fit: "held-out" } } })).toBe("suggest");
  });
});
