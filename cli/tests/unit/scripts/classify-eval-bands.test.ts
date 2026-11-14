/**
 * The classify-eval harness's band statistics (scripts/classify-eval/lib/bands.ts and
 * fit-thresholds.ts): Wilson intervals, the accept and not-element points, the layer-threshold
 * column, errored predictions, and the threshold fit. Synthetic cards, no corpus files.
 */
import { describe, expect, it } from "bun:test";
import {
  acceptPoint,
  askedCards,
  layerOnlyPoint,
  notElementPoint,
  wilson,
  type AskedCard,
} from "../../../scripts/classify-eval/lib/bands.js";
import { fit } from "../../../scripts/classify-eval/fit-thresholds.js";
import type { Gold, Prediction } from "../../../scripts/classify-eval/lib/types.js";

function card(over: Partial<AskedCard>): AskedCard {
  return {
    corpus: "c",
    cardId: Math.random().toString(36).slice(2),
    layer: "application",
    layerP: 0.7,
    type: "applicationfunction",
    typeP: 0.5,
    layerOk: true,
    typeOk: true,
    goldNone: false,
    error: false,
    ...over,
  };
}

describe("wilson", () => {
  it("matches the textbook interval and stays in [0, 1]", () => {
    const w = wilson(100, 110)!;
    expect(w.lo).toBeCloseTo(0.8412, 3);
    expect(w.hi).toBeCloseTo(0.9500, 3);
    const all = wilson(11, 11)!;
    expect(all.hi).toBe(1);
    expect(all.lo).toBeCloseTo(0.7412, 3);
    expect(wilson(0, 5)!.lo).toBe(0);
  });

  it("has no interval for no trials", () => {
    expect(wilson(0, 0)).toBeNull();
  });
});

describe("acceptPoint and notElementPoint", () => {
  const cards = [
    card({ layerP: 0.8, typeP: 0.6 }), // accepted, right
    card({ layerP: 0.65, typeP: 0.45, typeOk: false }), // accepted at (0.6, 0.4), wrong type
    card({ layerP: 0.65, typeP: 0.3 }), // type too low at 0.4
    card({ layerP: 0.55, typeP: 0.9 }), // layer too low at 0.6
    card({ layerP: 0.9, type: null, typeP: null }), // no chosen type: escalates
    card({ layer: "none", layerP: 0.7, type: null, typeP: null, layerOk: false, typeOk: false }), // not-element, wrong
    card({ layer: "none", layerP: 0.75, type: null, typeP: null, goldNone: true }), // not-element, right
    card({ layer: "none", layerP: 0.4, type: null, typeP: null, goldNone: true }), // below T_none
    card({ layer: "", layerP: NaN, type: null, typeP: null, layerOk: false, typeOk: false, error: true }), // errored
  ];

  it("counts the accept band by bandOf's rule, over every asked card", () => {
    expect(acceptPoint(cards, 0.6, 0.4)).toEqual({ tLayer: 0.6, tType: 0.4, asked: 9, accepted: 2, layerOk: 2, typeOk: 1 });
    expect(acceptPoint(cards, 0.5, 0)).toMatchObject({ accepted: 4, typeOk: 3 });
    expect(acceptPoint(cards, 0.85, 0)).toMatchObject({ accepted: 0 });
  });

  it("counts the not-element band, correct when gold says none", () => {
    expect(notElementPoint(cards, 0.6)).toEqual({ tNone: 0.6, asked: 9, hidden: 2, correct: 1 });
    expect(notElementPoint(cards, 0.72)).toMatchObject({ hidden: 1, correct: 1 });
  });

  it("the layer-threshold column keeps cards with no chosen type, unlike the accept band at T_type 0", () => {
    expect(layerOnlyPoint(cards, 0.6)).toMatchObject({ cards: 4, layerOk: 4, typeOk: 3 });
    expect(acceptPoint(cards, 0.6, 0)).toMatchObject({ accepted: 3 }); // 0.8 and the two 0.65s; not the typeless 0.9
  });
});

describe("askedCards", () => {
  const gold = new Map<string, Gold>(
    ["a", "b", "c", "d"].map((id) => [
      id,
      { card_id: id, layer: id === "d" ? "none" : "application", element_type: id === "d" ? null : "applicationfunction" } as Gold,
    ])
  );
  const pred = (id: string, over: Partial<Prediction> = {}): Prediction =>
    ({
      card_id: id,
      backend: "clef",
      layer: { choice: "application", probabilities: { application: 0.7, none: 0.3 }, confidence: null },
      element_type: { choice: "applicationfunction", probabilities: { applicationfunction: 0.5 }, confidence: null },
      significance: { score: 2, probabilities: null },
      concerns: {},
      latency_ms: 1,
      usage: null,
      cost_usd: 0,
      error: null,
      ...over,
    }) as Prediction;
  const failed = (id: string) => pred(id, { error: "timeout", layer: { choice: "none", probabilities: {}, confidence: null }, element_type: { choice: null, probabilities: {}, confidence: null } });

  it("keeps an errored card as asked and escalated, and lets a resumed answer replace its error", () => {
    const cards = askedCards("c", [pred("a"), failed("b"), failed("c"), pred("c"), pred("d", { tier0: { rule: "r", kind: "reject" } })], gold);
    expect(cards.map((c) => c.cardId).sort()).toEqual(["a", "b", "c"]);
    const b = cards.find((c) => c.cardId === "b")!;
    expect(b).toMatchObject({ error: true, layerOk: false, typeOk: false });
    expect(acceptPoint(cards, 0.6, 0.4)).toMatchObject({ asked: 3, accepted: 2, typeOk: 2 });
    expect(notElementPoint([b], 0)).toMatchObject({ hidden: 0 });
    expect(layerOnlyPoint([b], 0)).toMatchObject({ cards: 0 });
  });
});

describe("fit", () => {
  // corpus x: precision falls as T_layer drops; corpus y is weaker at T_layer 0.5
  const x = [
    ...Array.from({ length: 10 }, () => card({ corpus: "x", layerP: 0.75, typeP: 0.5 })),
    ...Array.from({ length: 9 }, () => card({ corpus: "x", layerP: 0.55, typeP: 0.5 })),
    card({ corpus: "x", layerP: 0.55, typeP: 0.5, typeOk: false }),
    ...Array.from({ length: 10 }, () => card({ corpus: "x", layer: "none", layerP: 0.65, type: null, typeP: null, goldNone: true })),
  ];
  const y = [
    ...Array.from({ length: 4 }, () => card({ corpus: "y", layerP: 0.65, typeP: 0.5 })),
    ...Array.from({ length: 2 }, () => card({ corpus: "y", layerP: 0.55, typeP: 0.5 })),
    ...Array.from({ length: 2 }, () => card({ corpus: "y", layerP: 0.55, typeP: 0.5, typeOk: false })),
    card({ corpus: "y", layer: "none", layerP: 0.55, type: null, typeP: null, goldNone: false }),
  ];
  const corpora = [
    { corpus: "x", cards: x },
    { corpus: "y", cards: y },
  ];

  it("pooled: the most coverage meeting the target, ties to the higher precision then thresholds", () => {
    const f = fit(corpora, { typePrecision: 0.85, nonePrecision: 0.95, scope: "pooled", bound: "point" });
    // T_layer 0.5 accepts 28 at 25/28 = 89%; 0.6 accepts 14 at 100%
    expect(f.accept).toMatchObject({ tLayer: 0.5, accepted: 28, typeOk: 25 });
    expect(f.accept!.tType).toBe(0.5); // every T_type up to 0.5 accepts the same cards: the highest wins
    // T_none 0.5 hides 11 at 10/11; 0.6 hides 10 at 100%
    expect(f.notElement).toMatchObject({ tNone: 0.6, hidden: 10 });
  });

  it("each corpus: a corpus missing the target rules the point out", () => {
    const f = fit(corpora, { typePrecision: 0.85, nonePrecision: 0.9, scope: "each-corpus", bound: "point" });
    // at T_layer 0.5 corpus y is 6/8 = 75%
    expect(f.accept).toMatchObject({ tLayer: 0.6, accepted: 14 });
  });

  it("the Wilson lower bound is stricter than the point estimate", () => {
    const f = fit(corpora, { typePrecision: 0.75, nonePrecision: 0.7, scope: "pooled", bound: "wilson-lower" });
    expect(f.accept).toMatchObject({ tLayer: 0.6 }); // 25/28 has a lower bound of 0.73; 14/14 of 0.78
    expect(f.notElement).toMatchObject({ tNone: 0.6 }); // 10/11 has 0.62; 10/10 has 0.72
  });

  it("no grid point meeting the target is no fit", () => {
    expect(fit(corpora, { typePrecision: 1, nonePrecision: 1, scope: "each-corpus", bound: "wilson-lower" })).toEqual({ accept: null, notElement: null });
  });
});
