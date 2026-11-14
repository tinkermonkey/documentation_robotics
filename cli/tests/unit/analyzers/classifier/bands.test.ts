import { describe, expect, test } from "bun:test";
import { bandOf, DEFAULT_THRESHOLDS, modeOf, thresholdsFor, topOf, type ThresholdRecord } from "../../../../src/analyzers/classifier/index.js";

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
  test("no defaults ship yet: Clef has no thresholds and runs in suggest mode", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({});
    expect(thresholdsFor("dr-qset-1", "clef")).toBeNull();
    expect(modeOf("dr-qset-1", "clef")).toBe("suggest");
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
    expect(thresholdsFor("dr-qset-1", "clef", { layer: 0.7, type: 0.5, none: 0.8 })).toEqual({ layer: 0.7, type: 0.5, none: 0.8 });
    expect(thresholdsFor("dr-qset-1", "clef", { layer: 0.7 })).toBeNull();
    const defaults: Record<string, Record<string, ThresholdRecord>> = { "dr-qset-1": { clef: { ...T, fit: "in-sample" } } };
    expect(thresholdsFor("dr-qset-1", "clef", { layer: 0.7 }, defaults)).toEqual({ layer: 0.7, type: 0.4, none: 0.6 });
  });

  test("topOf: the most probable option, the first on a tie", () => {
    expect(topOf({ a: 0.2, b: 0.5, c: 0.5 })).toEqual({ option: "b", p: 0.5 });
    expect(topOf({})).toBeNull();
  });
});
