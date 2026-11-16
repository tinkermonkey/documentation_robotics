/**
 * The classify-eval harness's agreement report (scripts/classify-eval/agreement-report.ts) and the
 * narrowing note a Claude baseline is sent (lib/tier0.ts). Synthetic cards, no corpus files.
 */
import { describe, expect, it } from "bun:test";
import { answerOf, gate, gatesOf, rightOf, sameAnswer, type Answer, type Row } from "../../../scripts/classify-eval/agreement-report.js";
import { narrowingNote } from "../../../scripts/classify-eval/lib/tier0.js";
import type { AskedCard } from "../../../scripts/classify-eval/lib/bands.js";
import type { Gold, Prediction } from "../../../scripts/classify-eval/lib/types.js";

const gold = (layer: string, type: string | null): Gold => ({ card_id: "c", layer, element_type: type }) as Gold;
const ans = (layer: string, type: string | null = null, confidence: number | null = null): Answer => ({ layer, type, layerConfidence: confidence, typeConfidence: confidence });

/** A row whose first answer is A's, with A's card scored against gold as `askedCards` would. */
function row(g: Gold, a: { answer: Answer; layerP: number; typeP: number | null }, ...others: Array<Answer | null>): Row {
  const right = rightOf(a.answer, g);
  const card: AskedCard = {
    corpus: "c",
    cardId: Math.random().toString(36).slice(2),
    layer: a.answer.layer,
    layerP: a.layerP,
    type: a.answer.type,
    typeP: a.typeP,
    layerOk: right.layer,
    typeOk: right.type,
    goldNone: g.layer === "none",
    error: false,
  };
  return { card, gold: g, answers: [a.answer, ...others] };
}

describe("answers", () => {
  const pred = (over: Partial<Prediction>): Prediction =>
    ({
      card_id: "c",
      backend: "b",
      layer: { choice: "application", probabilities: {}, confidence: 0.7 },
      element_type: { choice: "dataobject", probabilities: {}, confidence: 0.6 },
      error: null,
      ...over,
    }) as Prediction;

  it("reads a prediction's layer and type, and drops the type of a `none` answer", () => {
    expect(answerOf(pred({}))).toEqual({ layer: "application", type: "dataobject", layerConfidence: 0.7, typeConfidence: 0.6 });
    expect(answerOf(pred({ layer: { choice: "none", probabilities: {}, confidence: 0.9 } }))).toMatchObject({ layer: "none", type: null });
  });

  it("has no answer for a failed call or a missing card", () => {
    expect(answerOf(pred({ error: "timeout" }))).toBeNull();
    expect(answerOf(undefined)).toBeNull();
  });

  it("agrees only when both runs answered with the same layer and type", () => {
    expect(sameAnswer(ans("application", "dataobject"), ans("application", "dataobject"))).toBe(true);
    expect(sameAnswer(ans("application", "dataobject"), ans("application", "applicationevent"))).toBe(false);
    expect(sameAnswer(ans("none"), ans("none"))).toBe(true);
    expect(sameAnswer(ans("none"), null)).toBe(false);
    expect(sameAnswer(null, null)).toBe(false);
  });

  it("scores an answer against gold end to end", () => {
    expect(rightOf(ans("application", "dataobject"), gold("application", "dataobject"))).toEqual({ layer: true, type: true });
    expect(rightOf(ans("application", "applicationevent"), gold("application", "dataobject"))).toEqual({ layer: true, type: false });
    expect(rightOf(ans("none"), gold("none", null))).toEqual({ layer: true, type: true });
    expect(rightOf(ans("application", "dataobject"), gold("none", null))).toEqual({ layer: false, type: false });
    expect(rightOf(null, gold("none", null))).toEqual({ layer: false, type: false });
  });
});

describe("gates", () => {
  const data = gold("application", "dataobject");
  const none = gold("none", null);
  const rows: Row[] = [
    // A in its accept band and right; B agrees, B2 doesn't
    row(data, { answer: ans("application", "dataobject"), layerP: 0.8, typeP: 0.6 }, ans("application", "dataobject", 0.9), ans("none")),
    // A in its accept band and wrong (gold none); B and B2 agree with A
    row(none, { answer: ans("application", "dataobject"), layerP: 0.7, typeP: 0.5 }, ans("application", "dataobject", 0.5), ans("application", "dataobject")),
    // A below its thresholds and right; B agrees
    row(data, { answer: ans("application", "dataobject"), layerP: 0.5, typeP: 0.9 }, ans("application", "dataobject", 0.85), ans("application", "dataobject")),
    // A in its not-element band and right; B says an element, B2 failed
    row(none, { answer: ans("none"), layerP: 0.7, typeP: null }, ans("ux", "view", 0.9), null),
    // A answers none below T_none, wrong; B agrees
    row(data, { answer: ans("none"), layerP: 0.4, typeP: null }, ans("none", null, 0.9), ans("none")),
  ];
  const t = { layer: 0.6, type: 0.4, none: 0.6 };
  const byName = (hasB2: boolean) => new Map(gatesOf(rows, t, hasB2, 0.8).map((g) => [g.name, g.count]));

  it("counts a gate's element and none answers and how many gold agrees with", () => {
    expect(gate(rows, () => 0)).toEqual({ asked: 5, element: { cards: 3, correct: 2 }, none: { cards: 2, correct: 1 } });
    expect(gate(rows, () => null)).toEqual({ asked: 5, element: { cards: 0, correct: 0 }, none: { cards: 0, correct: 0 } });
    // a run with no answer for a card passes nothing for it
    expect(gate(rows, () => 2)).toMatchObject({ element: { cards: 2, correct: 1 }, none: { cards: 2, correct: 0 } });
  });

  it("reports A's bands by the CLI's rule, and agreement beside them", () => {
    const g = byName(true);
    expect(g.get("A's bands (0.6 / 0.4 / 0.6)")).toMatchObject({ element: { cards: 2, correct: 1 }, none: { cards: 1, correct: 1 } });
    expect(g.get("A and B agree")).toMatchObject({ element: { cards: 3, correct: 2 }, none: { cards: 1, correct: 0 } });
    expect(g.get("A and B2 agree")).toMatchObject({ element: { cards: 2, correct: 1 }, none: { cards: 1, correct: 0 } });
    expect(g.get("B and B2 agree")).toMatchObject({ element: { cards: 2, correct: 1 }, none: { cards: 1, correct: 0 } });
    expect(g.get("A, B and B2 agree")).toMatchObject({ element: { cards: 2, correct: 1 }, none: { cards: 1, correct: 0 } });
    expect(g.get("A's bands, where B agrees")).toMatchObject({ element: { cards: 2, correct: 1 }, none: { cards: 0, correct: 0 } });
    expect(g.get("B, every answer")).toMatchObject({ element: { cards: 4, correct: 2 }, none: { cards: 1, correct: 0 } });
    expect(g.get("B, self-reported confidence >= 0.8")).toMatchObject({ element: { cards: 3, correct: 2 }, none: { cards: 1, correct: 0 } });
  });

  it("leaves out the B2 gates without a second take, and A's bands without thresholds", () => {
    expect([...byName(false).keys()]).toEqual(["A's bands (0.6 / 0.4 / 0.6)", "A and B agree", "A's bands, where B agrees", "B, every answer", "B, self-reported confidence >= 0.8"]);
    expect(gatesOf(rows, null, false, 0.8).map((g) => g.name)).toEqual(["A and B agree", "B, every answer", "B, self-reported confidence >= 0.8"]);
  });
});

describe("narrowingNote", () => {
  it("is empty when no rule narrows and the kind has no candidates", () => {
    expect(narrowingNote(undefined, undefined)).toBe("");
    expect(narrowingNote(undefined, "Route")).toBe("");
  });

  it("lists the kind rule's application types", () => {
    expect(narrowingNote(undefined, "Method")).toBe(
      "The symbol is a Method. If it belongs to the application layer, its element type is one of: applicationfunction, applicationprocess, applicationservice, applicationinterface."
    );
  });

  it("lists Tier 0's candidates, and keeps the kind rule when Tier 0 leaves the application types open", () => {
    const note = narrowingNote(
      [
        { layer: "ux", type: "view" },
        { layer: "application", type: null },
      ],
      "Function"
    );
    expect(note.split("\n")).toHaveLength(2);
    expect(note).toContain("application.*, ux.view, or none.");
    expect(note).toContain("The symbol is a Function.");
  });

  it("drops the kind rule when Tier 0 names the application types", () => {
    const note = narrowingNote([{ layer: "application", type: "dataobject" }], "Interface");
    expect(note).toBe("Structural rules allow only these answers for this symbol (layer.type; layer.* is any type of that layer): application.dataobject, or none.");
  });
});
