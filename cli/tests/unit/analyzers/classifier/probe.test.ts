/**
 * The probe (TIER1_DESIGN.md section 2.4): a synthetic card through the configured adapter. The
 * Workers AI adapter is driven by an injected fetch: no network.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createDecisionModel,
  PROBE_CARD,
  probeTier1,
  specCriteriaFromLayers,
  v2,
  type LayerInfo,
} from "../../../../src/analyzers/classifier/index.js";
import { choiceAnswer, FakeDecisionModel } from "../../../helpers/fake-decision-model.js";

const FIXTURES = path.join(import.meta.dir, "../../../fixtures/classifier/dr-qset-1");
const snapshot = JSON.parse(readFileSync(path.join(FIXTURES, "spec-snapshot.json"), "utf8")) as { layers: LayerInfo[] };
const spec = specCriteriaFromLayers(snapshot.layers);
const TOKEN = "tok-SECRET-probe-0123456789";

const answers = {
  layer: choiceAnswer("data-store", 0.7),
  significance: { score: 2 },
  element_type: choiceAnswer("table", 0.5),
};

describe("probeTier1", () => {
  test("the probe card is synthetic and line-free under dr-qset-2", () => {
    expect(v2.stateOf(PROBE_CARD)).toContain("Name: InvoiceRepository");
    expect(v2.stateOf(PROBE_CARD)).not.toMatch(/\(lines \d+-/);
  });

  test("reports layer probabilities, cost and latency; ok without an expectation", async () => {
    const fake = new FakeDecisionModel().answer("*", answers);
    const r = await probeTier1(fake, spec, { expected: {} });
    expect(r.ok).toBe(true);
    expect(r.layer?.top).toBe("data-store");
    expect(r.layer?.p).toBe(0.7);
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.flags).toEqual([]);
    expect(fake.calls[0].state).toBe(v2.stateOf(PROBE_CARD));
  });

  test("flags an answer off the expectation, and another model answering", async () => {
    const fake = new FakeDecisionModel().answer("*", answers);
    // the shipped expectation for Clef: 0.7 on data-store is far from the measured 0.33
    const off = await probeTier1(fake, spec);
    expect(off.ok).toBe(false);
    expect(off.flags[0]).toContain("differ by more than 0.1 from the expected answer");
    expect(off.flags[0]).toContain("data-store 0.70 (expected 0.33)");
    // what Clef answered live passes, even though the top two layers are a near tie
    const live = new FakeDecisionModel().answer("*", {
      ...answers,
      layer: { choice: "application", probabilities: { "data-store": 0.31, application: 0.33, "data-model": 0.14, none: 0.22 } },
    });
    expect((await probeTier1(live, spec)).flags).toEqual([]);
    // another question set has no expectation
    expect((await probeTier1(new FakeDecisionModel().answer("*", answers), spec, { qset: "dr-qset-1" })).ok).toBe(true);

    const other = new FakeDecisionModel().answer("*", answers);
    other.ask = (async (...args: Parameters<FakeDecisionModel["ask"]>) => {
      const r = await FakeDecisionModel.prototype.ask.apply(other, args);
      return { ...r, servedBy: { model: "@cf/meta/llama" } };
    }) as FakeDecisionModel["ask"];
    const named = await probeTier1(other, spec, { expected: {} });
    expect(named.flags[0]).toContain("named model @cf/meta/llama");
  });

  test("a failing provider is a flagged result, never a throw, and never shows the token", async () => {
    const model = createDecisionModel({
      provider: "cloudflare-workers-ai",
      model: "clef",
      credentials: { accountId: "acct", apiToken: TOKEN },
      fetch: async () => new Response(JSON.stringify({ errors: [{ message: `bad token ${TOKEN}` }] }), { status: 401 }),
    });
    const r = await probeTier1(model, spec);
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe("auth");
    expect(r.costUsd).toBe(0);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  test("through the Workers AI adapter with a scripted fetch: what Clef answers is read", async () => {
    const bodies: unknown[] = [];
    const model = createDecisionModel({
      provider: "cloudflare-workers-ai",
      model: "clef",
      credentials: { accountId: "acct", apiToken: TOKEN },
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init.body));
        bodies.push(body);
        const keys = Object.keys(body.questions);
        const raw = Object.fromEntries(keys.map((k) => [k, k === "layer" ? { choice: "data-store", probabilities: { "data-store": 0.66, application: 0.3, none: 0.04 } } : k === "element_type" ? { choice: "table", probabilities: { table: 0.6, none: 0.4 } } : k === "significance" ? { score: 2 } : { noul: 0.1 }]));
        return new Response(JSON.stringify({ success: true, result: { model: "@cf/cloudflare/clef", answers: raw, usage: { input_tokens: 3000 } } }), { status: 200 });
      },
    });
    const r = await probeTier1(model, spec, { expected: {} });
    expect(r).toMatchObject({ ok: true, provider: "cloudflare-workers-ai", model: "@cf/cloudflare/clef", servedModel: "@cf/cloudflare/clef", inputTokens: 6000 });
    expect(r.layer?.probabilities).toEqual({ "data-store": 0.66, application: 0.3, none: 0.04 });
    expect(r.type).toEqual({ top: "table", p: 0.6 });
    expect(r.costUsd).toBeCloseTo(0.00144, 6);
    expect(bodies).toHaveLength(2);
  });
});
