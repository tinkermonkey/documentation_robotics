import { describe, expect, test } from "bun:test";
import {
  bandOf,
  CURRENT_QSET_ID,
  DEFAULT_THRESHOLDS,
  HELD_OUT_RULE,
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

  test("Clef's dr-qset-2 defaults are refitted on the bundled spec: T_layer 0.7, T_type 0.5, T_none 0.7", () => {
    expect(thresholdsFor("dr-qset-2", "clef")).toEqual({ layer: 0.7, type: 0.5, none: 0.7 });
    expect(DEFAULT_THRESHOLDS["dr-qset-2"].clef.record?.specVersion).toBe("0.12.0");
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

  test("dr-qset-2 x clef carries its B5 result on the viewer corpus", () => {
    const h = DEFAULT_THRESHOLDS["dr-qset-2"].clef.heldOut!;
    expect(h).toMatchObject({ corpus: "viewer", run: "clef@cbm012-kind-tier0-qset2-spec012", specVersion: "0.12.0", accept: { cards: 4, correct: 4 }, notElement: { cards: 23, correct: 22 } });
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

  test("TIER1_TARGETS are the provisional targets that reproduce Clef's in-sample defaults; the rule is within-interval", () => {
    expect(TIER1_TARGETS).toEqual({ typePrecision: 0.88, nonePrecision: 0.9 });
    expect(HELD_OUT_RULE).toBe("within-interval");
  });

  test("within-interval: a band meets a target its interval reaches, even with the point estimate below it", () => {
    // 17 of 20 = 85%, Wilson 64.0-94.8: reaches 0.88 and 0.90, not 0.95.
    expect(meetsTarget({ cards: 20, correct: 17 }, 0.88, "within-interval")).toBe(true);
    expect(meetsTarget({ cards: 20, correct: 17 }, 0.95, "within-interval")).toBe(false);
    // 60 of 100 = 60%, Wilson 50.2-69.1: wholly below.
    expect(meetsTarget({ cards: 100, correct: 60 }, 0.88, "within-interval")).toBe(false);
  });

  test("lower-bound: the whole interval must clear the target", () => {
    expect(meetsTarget({ cards: 4, correct: 4 }, 0.88, "lower-bound")).toBe(false);
    expect(meetsTarget({ cards: 200, correct: 198 }, 0.9, "lower-bound")).toBe(true);
  });

  test("a band with no cards on the held-out corpus never meets a target", () => {
    for (const rule of ["within-interval", "lower-bound"] as const) expect(meetsTarget({ cards: 0, correct: 0 }, 0.5, rule)).toBe(false);
  });

  test("heldOutVerdict needs both bands, and moves with the targets and the rule", () => {
    const bands = { accept: { cards: 19, correct: 16 }, notElement: { cards: 50, correct: 44 } };
    expect(heldOutVerdict(bands, { typePrecision: 0.88, nonePrecision: 0.9 }, "within-interval")).toEqual({ pass: true, accept: true, notElement: true });
    expect(heldOutVerdict(bands, { typePrecision: 0.9, nonePrecision: 0.95 }, "within-interval")).toEqual({ pass: false, accept: true, notElement: false });
    expect(heldOutVerdict(bands, { typePrecision: 0.88, nonePrecision: 0.9 }, "lower-bound").pass).toBe(false);
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
      accept: { cards: 4, correct: 4 },
      notElement: { cards: 23, correct: 22 },
    };
    expect(verdictOf(record).pass).toBe(true);
    expect(verdictOf(record, TIER1_TARGETS, "lower-bound").pass).toBe(false);
  });

  test("modeOf stages only a held-out default", () => {
    const t = { layer: 0.7, type: 0.5, none: 0.7 };
    expect(modeOf("q", "m", { q: { m: { ...t, fit: "in-sample" } } })).toBe("suggest");
    expect(modeOf("q", "m", { q: { m: { ...t, fit: "held-out" } } })).toBe("stage");
    expect(modeOf("q", "other", { q: { m: { ...t, fit: "held-out" } } })).toBe("suggest");
  });
});
