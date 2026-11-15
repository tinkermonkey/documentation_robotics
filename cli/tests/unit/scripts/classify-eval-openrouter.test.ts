/**
 * The classify-eval harness with OpenRouter: backend ids (`openrouter:<model>@<upstream>`), keeping
 * runs from different adapters apart (`servingOf`), and stopping a run on a failure that asking
 * again can't fix (`RunGuard`, as classify.ts uses it). No network, no corpus files.
 */
import { describe, expect, it } from "bun:test";
import { decisionBackendOf } from "../../../scripts/classify-eval/backends/clef.js";
import { servingLabel, servingOf } from "../../../scripts/classify-eval/lib/serving.js";
import { billedCostOf, RunGuard } from "../../../scripts/classify-eval/lib/run-guard.js";
import type { Prediction } from "../../../scripts/classify-eval/lib/types.js";
import { DecisionModelError } from "../../../src/analyzers/classifier/index.js";

function pred(over: Partial<Prediction>): Prediction {
  return {
    card_id: Math.random().toString(36).slice(2),
    backend: "b",
    layer: { choice: "application", probabilities: { application: 0.8 }, confidence: null },
    element_type: { choice: null, probabilities: {}, confidence: null },
    significance: { score: 2, probabilities: null },
    concerns: {},
    latency_ms: 1,
    usage: null,
    cost_usd: 0,
    error: null,
    ...over,
  };
}

describe("decisionBackendOf with OpenRouter", () => {
  it("pins one upstream; the file stem names provider, model and upstream", () => {
    expect(decisionBackendOf("openrouter:cloudflare/clef@deepinfra/fp8")).toEqual({
      id: "openrouter:cloudflare/clef@deepinfra/fp8",
      name: "openrouter-cloudflare_clef-deepinfra_fp8",
      provider: "openrouter",
      model: "cloudflare/clef",
      upstream: "deepinfra/fp8",
    });
    expect(decisionBackendOf("openrouter:typesafe/jev-1.14@typesafe")?.name).toBe("openrouter-typesafe_jev-1.14-typesafe");
    // Workers AI keeps the committed names
    expect(decisionBackendOf("clef")).toMatchObject({ name: "clef", provider: "cloudflare-workers-ai" });
  });

  it("refuses an OpenRouter backend without an upstream, a bad slug, an @upstream elsewhere; unknown models are undefined", () => {
    expect(() => decisionBackendOf("openrouter:cloudflare/clef")).toThrow("pins one upstream");
    expect(() => decisionBackendOf("openrouter:cloudflare/clef@Deep Infra")).toThrow("not an OpenRouter provider slug");
    expect(() => decisionBackendOf("cloudflare:clef@cloudflare")).toThrow("only OpenRouter backends");
    expect(decisionBackendOf("openrouter:~typesafe/jev-latest@typesafe")).toBeUndefined();
  });
});

describe("servingOf keeps adapters apart", () => {
  it("names the provider, the pinned upstream and who served", () => {
    const s = servingOf([pred({ provider: "openrouter", upstream: "cloudflare", served_by: { upstream: "Cloudflare", model: "cloudflare/clef" } }), pred({ provider: "openrouter", upstream: "cloudflare", tier0: { rule: "r", kind: "decide" } })]);
    expect(s).toEqual({ provider: "openrouter", upstream: "cloudflare", servedBy: { Cloudflare: 1 } });
    expect(servingLabel(s)).toBe("openrouter via cloudflare (served by Cloudflare 1)");
    expect(servingLabel(servingOf([pred({ provider: "cloudflare-workers-ai" })]))).toBe("cloudflare-workers-ai");
    expect(servingLabel(servingOf([pred({})]))).toBe("-");
  });

  it("refuses a file mixing providers, upstreams, or pinned and unpinned runs; errors don't count", () => {
    expect(() => servingOf([pred({ provider: "openrouter", upstream: "cloudflare" }), pred({ provider: "cloudflare-workers-ai" })], "f")).toThrow("f mixes providers");
    expect(() => servingOf([pred({ provider: "openrouter", upstream: "cloudflare" }), pred({ provider: "openrouter", upstream: "deepinfra/fp8" })])).toThrow("mixes upstreams");
    expect(() => servingOf([pred({ provider: "openrouter", upstream: "cloudflare" }), pred({ provider: "openrouter" })])).toThrow("pinned to cloudflare with unpinned");
    expect(servingOf([pred({ provider: "openrouter", upstream: "cloudflare" }), pred({ provider: "cloudflare-workers-ai", error: "x" })]).provider).toBe("openrouter");
  });
});

describe("RunGuard: a harness run stops on routing, api, auth and payment", () => {
  /** classify.ts's loop: a pool of `concurrency`, each card skipped once the guard stopped, failures recorded. */
  async function run(cards: string[], fail: Record<string, unknown>, concurrency = 2) {
    const guard = new RunGuard();
    const asked: string[] = [];
    let cost = 0;
    const queue = [...cards];
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          if (guard.shouldSkip()) continue;
          asked.push(id);
          await Promise.resolve();
          try {
            if (fail[id]) throw fail[id];
          } catch (e) {
            cost += billedCostOf(e) ?? 0;
            guard.record(e, id);
          }
        }
      })
    );
    return { guard, asked, cost };
  }

  for (const kind of ["routing", "api", "auth", "payment"] as const) {
    it(`${kind} stops the pool and names the reason; billed spend counts`, async () => {
      const err = new DecisionModelError(kind, `${kind} failure`, { billed: { inputTokens: 10, costUsd: 0.002 } });
      const { guard, asked, cost } = await run(["a", "b", "c", "d", "e", "f"], { b: err });
      expect(guard.stopped).toMatchObject({ kind, cardId: "b" });
      expect(asked.length).toBeLessThan(6);
      expect(guard.skipped).toBe(6 - asked.length);
      expect(guard.summary()).toContain(`Stopped (${kind}) at card b: ${kind} failure`);
      expect(cost).toBe(0.002);
    });
  }

  it("other failures (timeout, unavailable, malformed, refused, plain errors) are per card: the run goes on", async () => {
    const { guard, asked } = await run(["a", "b", "c", "d"], {
      a: new DecisionModelError("timeout", "slow"),
      b: new DecisionModelError("unavailable", "5xx"),
      c: new DecisionModelError("refused", "flagged"),
      d: new Error("boom"),
    });
    expect(guard.stopped).toBeNull();
    expect(guard.summary()).toBeNull();
    expect(asked).toHaveLength(4);
    expect(billedCostOf(new Error("x"))).toBeNull();
  });
});
