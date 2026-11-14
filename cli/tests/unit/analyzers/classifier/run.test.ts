import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  answeredStagesOf,
  askCard,
  bandInputOf,
  bandOf,
  cardCacheKey,
  DecisionModelError,
  normaliseEntry,
  qsetOf,
  rawStagesOf,
  specCriteriaFromLayers,
  Tier1Cache,
  type LayerInfo,
} from "../../../../src/analyzers/classifier/index.js";
import { choiceAnswer, FakeDecisionModel } from "../../../helpers/fake-decision-model.js";

const FIXTURES = path.join(import.meta.dir, "../../../fixtures/classifier/dr-qset-1");
const snapshot = JSON.parse(readFileSync(path.join(FIXTURES, "spec-snapshot.json"), "utf8")) as { layers: LayerInfo[] };
const spec = specCriteriaFromLayers(snapshot.layers);

const stage1 = (layer: string, p = 0.8) => ({
  layer: choiceAnswer(layer, p),
  significance: { score: 2 },
  concern_authentication: { noul: 0.01 },
  concern_authorization: { noul: 0.01 },
  concern_data_persistence: { noul: 0.4 },
  concern_external_integration: { noul: 0.01 },
  concern_observability: { noul: 0.01 },
  concern_user_interface: { noul: 0.01 },
});

describe("askCard (dr-qset-1, two stages)", () => {
  test("a real layer asks stage 2 within the layer, kind-narrowed", async () => {
    const fake = new FakeDecisionModel().answer("*", { ...stage1("application"), element_type: choiceAnswer("applicationfunction", 0.6) });
    const ask = await askCard(fake, spec, { state: "S", kind: "Function" });
    expect(fake.calls).toHaveLength(2);
    expect(Object.keys(fake.calls[0].questions)).toContain("layer");
    const q2 = fake.calls[1].questions.element_type;
    expect(q2.type === "choice" && Object.keys(q2.criteria)).toEqual(["applicationevent", "applicationfunction", "applicationinterface", "applicationprocess", "applicationservice", "none"]);
    expect(ask.layer).toBe("application");
    expect(ask.stage2?.layer).toBe("application");
    expect(ask.usage.inputTokens).toBe(2000);
    expect(bandInputOf(answeredStagesOf(ask))).toEqual({ layer: "application", layerP: 0.8, type: "applicationfunction", typeP: 0.6 });
    expect(bandOf(bandInputOf(answeredStagesOf(ask)), { layer: 0.6, type: 0.4, none: 0.6 })).toBe("accept");
    expect(ask.qset).toBe("dr-qset-1");
  });

  test("band input from a cache entry goes through the adapter's normalise, not the raw shape", async () => {
    const fake = new FakeDecisionModel().answer("*", { ...stage1("application"), element_type: choiceAnswer("applicationfunction", 0.6) });
    const ask = await askCard(fake, spec, { state: "S", kind: "Function" });
    const entry = new Tier1Cache("/nonexistent").entry("k".repeat(64), { qset: ask.qset, host: "fake", model: "clef" }, { criteriaDigest: "c", stages: rawStagesOf(ask), usage: { inputTokens: 1 } });
    expect(bandInputOf(normaliseEntry(entry, fake))).toEqual(bandInputOf(answeredStagesOf(ask)));
    // an adapter whose raw shape isn't Jev's still works: band input reads only normalised answers
    const foreign = {
      normalise: () => ({ answers: { layer: { type: "choice" as const, probabilities: { application: 0.7, none: 0.3 } } }, malformed: [] }),
    };
    expect(bandInputOf(normaliseEntry({ ...entry, stages: [{ shapes: {}, raw: { layer: { label: "application", score: 0.7 } } }] }, foreign))).toEqual({
      layer: "application",
      layerP: 0.7,
      type: null,
      typeP: null,
    });
  });

  test("the question set id and cache key follow what is sent: kindNarrow false is a variant", () => {
    const ctx = { canonicalModel: "clef", host: "cloudflare-workers-ai" };
    expect(qsetOf({}, spec)).toBe("dr-qset-1");
    expect(qsetOf({ kindNarrow: true }, spec)).toBe("dr-qset-1");
    expect(qsetOf({ kindNarrow: false }, spec)).toBe("dr-qset-1+no-kind");
    expect(qsetOf({}, specCriteriaFromLayers(snapshot.layers, "core"))).toBe("dr-qset-1+core");
    const q = { state: "S", kind: "Function" };
    expect(cardCacheKey(q, spec, ctx)).toBe(cardCacheKey({ ...q, kindNarrow: true }, spec, ctx));
    expect(cardCacheKey({ ...q, kindNarrow: false }, spec, ctx)).not.toBe(cardCacheKey(q, spec, ctx));
    expect(cardCacheKey({ ...q, narrow: [{ layer: "application", type: null }] }, spec, ctx)).not.toBe(cardCacheKey(q, spec, ctx));
  });

  test("layer none asks no stage 2", async () => {
    const fake = new FakeDecisionModel().answer("*", stage1("none", 0.9));
    const ask = await askCard(fake, spec, { state: "S", kind: "Function" });
    expect(fake.calls).toHaveLength(1);
    expect(ask.stage2).toBeUndefined();
    expect(bandInputOf(answeredStagesOf(ask))).toEqual({ layer: "none", layerP: 0.9, type: null, typeP: null });
  });

  test("Tier-0 narrowing reaches both stages", async () => {
    const fake = new FakeDecisionModel().answer("*", { ...stage1("application"), element_type: choiceAnswer("dataobject") });
    await askCard(fake, spec, { state: "S", kind: "Interface", narrow: [{ layer: "application", type: "dataobject" }, { layer: "application", type: "applicationinterface" }] });
    const q1 = fake.calls[0].questions.layer;
    const q2 = fake.calls[1].questions.element_type;
    expect(q1.type === "choice" && Object.keys(q1.criteria)).toEqual(["application", "none"]);
    expect(q2.type === "choice" && Object.keys(q2.criteria)).toEqual(["applicationinterface", "dataobject", "none"]);
  });

  test("an unanswered layer gives no band input (escalates)", async () => {
    const fake = new FakeDecisionModel().answer("*", { significance: { score: 1 } });
    const ask = await askCard(fake, spec, { state: "S" });
    expect(ask.layer).toBeNull();
    expect(ask.stage1.result.malformed).toContain("layer");
    expect(bandInputOf(answeredStagesOf(ask))).toBeNull();
  });

  test("provider errors propagate typed", async () => {
    const fake = new FakeDecisionModel().failNext("auth");
    await expect(askCard(fake, spec, { state: "S" })).rejects.toBeInstanceOf(DecisionModelError);
  });
});
