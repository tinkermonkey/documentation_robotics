/**
 * The OpenRouter adapter (the Decisions API), against a scripted fetch: no test reaches the
 * network, and the key is a fake. TIER1_DESIGN.md section 8's `openrouter` bullet: the routing
 * object always carries `only`, `allow_fallbacks: false` and `data_collection: "deny"`; `provider`
 * is read into `servedBy`; an upstream outside `only` stops the run; a changed response shape is
 * `unavailable` (`api`); `refusal` answers escalate; probes pin one upstream each.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import {
  OpenRouterModel,
  checkShape,
  costOfUsage,
  isUpstreamSlug,
  normaliseOpenRouterAnswers,
  upstreamAllowed,
} from "../../../../src/analyzers/classifier/decision-model/adapters/openrouter.js";
import {
  classifyTier1,
  createDecisionModel,
  credentialsFromEnv,
  DEFAULT_THRESHOLDS,
  DecisionModelError,
  modeOf,
  openTier1,
  parseUpstreams,
  resolveModel,
  runProbes,
  sameModel,
  setTier1Value,
  specCriteriaFromLayers,
  thresholdsFor,
  tier1Paths,
  tier1Status,
  describeTier1Status,
  hostOf,
  type FetchLike,
  type LayerInfo,
  type Narrowing,
  type Question,
  type ReadyTier1,
  type StateCard,
  type Tier1Item,
  Tier1Cache,
  type Tier1RunStats,
} from "../../../../src/analyzers/classifier/index.js";
import { answeringFetch, jsonResponse } from "../../../helpers/fake-openrouter.js";

const KEY = "sk-or-v1-FAKE-SECRET-do-not-print-0123456789abcdef";

const FIXTURES = path.join(import.meta.dir, "../../../fixtures/classifier/dr-qset-1");
const snapshot = JSON.parse(readFileSync(path.join(FIXTURES, "spec-snapshot.json"), "utf8")) as { layers: LayerInfo[] };
const spec = specCriteriaFromLayers(snapshot.layers);
const fixtureCards = readFileSync(path.join(FIXTURES, "cards.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as { card: StateCard & { id: string }; narrow: Narrowing | null });
const items = (n: number): Tier1Item[] => fixtureCards.slice(0, n).map((c) => ({ id: c.card.id, card: c.card, ...(c.narrow ? { narrow: c.narrow } : {}) }));

const QUESTIONS: Record<string, Question> = {
  layer: { type: "choice", instructions: "Which layer?", criteria: { application: "App", none: "None" } },
  significance: { type: "score", instructions: "How significant?", criteria: ["0", "1", "2", "3", "4"] },
  concern_observability: { type: "noul", instructions: "Observability?" },
};

/** OpenRouter's documented answer shapes (score probabilities keyed by level index). */
const OR_ANSWERS = {
  layer: { type: "choice", choice: "application", confidence: 0.6, probabilities: { application: 0.8, none: 0.2 } },
  significance: { type: "score", score: 2.4, confidence: 0.5, probabilities: { "0": 0, "1": 0.1, "2": 0.4, "3": 0.5, "4": 0 }, legend: { "0": "0" } },
  concern_observability: { type: "noul", noul: 0.05 },
};

const json = jsonResponse;

const ok = (answers: unknown = OR_ANSWERS, extra: Record<string, unknown> = {}) =>
  json({ id: "gen-dec-1789738314-X5e5eKGQdvR9rblyX250", model: "cloudflare/clef", provider: "Cloudflare", answers, usage: { input_tokens: 1000, output_tokens: 0, cost: 0.00031 }, ...extra });

interface Sent {
  url: string;
  init: RequestInit;
  body: { model: string; state: string; questions: Record<string, Question>; provider: Record<string, unknown> };
}

function scriptedFetch(responses: Array<Response | (() => Response) | Error>): { fetch: FetchLike; sent: Sent[] } {
  const sent: Sent[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    sent.push({ url, init, body: JSON.parse(String(init.body)) });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r() : r.clone();
  };
  return { fetch, sent };
}

function model(fetch: FetchLike, only: string[] = ["cloudflare"], extra: Partial<ConstructorParameters<typeof OpenRouterModel>[0]> = {}) {
  const sleeps: number[] = [];
  const m = new OpenRouterModel({
    model: "cloudflare/clef",
    credentials: { apiKey: KEY },
    routing: { only },
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
  return { m, sleeps };
}

async function caught(p: Promise<unknown>): Promise<DecisionModelError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DecisionModelError);
    return e as DecisionModelError;
  }
  throw new Error("expected a DecisionModelError");
}

describe("OpenRouter adapter: the request", () => {
  test("POST to the Decisions API with a bearer key and the Jev-shaped body", async () => {
    const { fetch, sent } = scriptedFetch([ok()]);
    await model(fetch).m.ask("STATE", QUESTIONS);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(sent[0].init.method).toBe("POST");
    expect((sent[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(sent[0].body.model).toBe("cloudflare/clef");
    expect(sent[0].body.state).toBe("STATE");
    expect(sent[0].body.questions).toEqual(QUESTIONS);
  });

  test("the routing object always carries only, allow_fallbacks: false and data_collection: deny", async () => {
    for (const only of [["cloudflare"], ["cloudflare", "deepinfra/fp8", "primeintellect"]]) {
      const { fetch, sent } = scriptedFetch([ok()]);
      await model(fetch, only).m.ask("S", QUESTIONS);
      expect(sent[0].body.provider).toEqual({ only, allow_fallbacks: false, data_collection: "deny" });
    }
    const { fetch, sent } = scriptedFetch([ok()]);
    await model(fetch, ["cloudflare"], { routing: { only: ["cloudflare"], zdr: true } }).m.ask("S", QUESTIONS);
    expect(sent[0].body.provider).toEqual({ only: ["cloudflare"], allow_fallbacks: false, data_collection: "deny", zdr: true });
  });

  test("a probe pins one configured upstream; an upstream outside the configured ones is refused before sending", async () => {
    const { fetch, sent } = scriptedFetch([ok(OR_ANSWERS, { provider: "DeepInfra" })]);
    const { m } = model(fetch, ["cloudflare", "deepinfra/fp8"]);
    const r = await m.ask("S", QUESTIONS, { upstream: "deepinfra/fp8" });
    expect(sent[0].body.provider.only).toEqual(["deepinfra/fp8"]);
    expect(r.servedBy).toEqual({ upstream: "DeepInfra", model: "cloudflare/clef" });
    const e = await caught(m.ask("S", QUESTIONS, { upstream: "together" }));
    expect(e.kind).toBe("routing");
    expect(sent).toHaveLength(1);
  });

  test("ids: one upstream pins the model's upstream (the cache host); several don't", () => {
    const { fetch } = scriptedFetch([ok()]);
    expect(model(fetch).m.id).toEqual({ provider: "openrouter", model: "cloudflare/clef", canonicalModel: "clef", upstream: "cloudflare" });
    const two = model(fetch, ["cloudflare", "deepinfra/fp8"]).m;
    expect(two.id.upstream).toBeUndefined();
    // Namespaced, so no OpenRouter host collides with another provider's; several upstreams sorted.
    expect(hostOf({ provider: "openrouter", openrouter: { only: ["deepinfra/fp8", "cloudflare"] } }, two)).toBe("openrouter/any:cloudflare,deepinfra/fp8");
    expect(hostOf({ provider: "openrouter", openrouter: { only: ["cloudflare"] } }, two)).toBe("openrouter/cloudflare");
    expect(hostOf({ provider: "openrouter", openrouter: { only: ["deepinfra/fp8"] } }, model(fetch, ["deepinfra/fp8"]).m)).toBe("openrouter/deepinfra/fp8");
    expect(hostOf({ provider: "cloudflare-workers-ai" }, { id: { provider: "cloudflare-workers-ai", model: "@cf/cloudflare/clef", canonicalModel: "clef" } })).toBe("cloudflare-workers-ai");
  });

  test("refuses no upstreams, a bad slug, an alias and a missing key", () => {
    const { fetch } = scriptedFetch([ok()]);
    expect(() => model(fetch, [])).toThrow("at least one upstream");
    expect(() => model(fetch, ["Cloud Flare"])).toThrow("not an OpenRouter provider slug");
    expect(() => new OpenRouterModel({ model: "~typesafe/jev-latest", credentials: { apiKey: KEY }, routing: { only: ["typesafe"] }, fetch })).toThrow("is an alias");
    expect(() => new OpenRouterModel({ model: "cloudflare/clef", credentials: { apiKey: "" }, routing: { only: ["cloudflare"] }, fetch })).toThrow("API key");
  });
});

describe("OpenRouter adapter: the response", () => {
  test("answers normalised (score probabilities by level index become a distribution), kept raw; servedBy and cost from the response", async () => {
    const { fetch } = scriptedFetch([ok()]);
    const r = await model(fetch).m.ask("S", QUESTIONS);
    expect(r.answers.layer).toEqual({ type: "choice", probabilities: { application: 0.8, none: 0.2 }, choice: "application" });
    expect(r.answers.significance).toEqual({ type: "score", score: 2.4, distribution: [0, 0.1, 0.4, 0.5, 0] });
    expect(r.answers.concern_observability).toEqual({ type: "noul", probability: 0.05 });
    expect(r.raw.layer).toEqual(OR_ANSWERS.layer);
    expect(r.malformed).toEqual([]);
    expect(r.servedBy).toEqual({ upstream: "Cloudflare", model: "cloudflare/clef" });
    expect(r.usage).toEqual({ inputTokens: 1000, outputTokens: 0, costUsd: 0.00031 });
  });

  test("without usage.cost, the cost is input tokens at the catalog price", async () => {
    const { fetch } = scriptedFetch([json({ model: "cloudflare/clef", provider: "Cloudflare", answers: OR_ANSWERS, usage: { input_tokens: 1_000_000, output_tokens: 0 } })]);
    const r = await model(fetch).m.ask("S", QUESTIONS);
    expect(r.usage.costUsd).toBeCloseTo(0.24, 9);
  });

  test("a dated model in the response is the configured one (the probe's check)", () => {
    const jev = { id: { provider: "openrouter", model: "typesafe/jev-1.14", canonicalModel: "jev-1.14" } };
    expect(sameModel("typesafe/jev-1.14-20261014", jev)).toBe(true);
    expect(sameModel("typesafe/jev-1.13-20260917", jev)).toBe(false);
    expect(sameModel("typesafe/jev-1.14-preview", jev)).toBe(false);
  });

  test("an upstream outside only stops with routing, carrying what it was billed", async () => {
    const { fetch } = scriptedFetch([ok(OR_ANSWERS, { provider: "Together" })]);
    const e = await caught(model(fetch, ["cloudflare", "deepinfra/fp8"]).m.ask("S", QUESTIONS));
    expect(e.kind).toBe("routing");
    expect(e.message).toContain('"Together"');
    expect(e.message).toContain("cloudflare, deepinfra/fp8");
    expect(e.billed).toEqual({ inputTokens: 1000, costUsd: 0.00031 });
  });

  test("upstreamAllowed matches the response's display name to slugs, variants on their provider", () => {
    expect(upstreamAllowed("DeepInfra", ["deepinfra/fp8"])).toBe(true);
    expect(upstreamAllowed("PrimeIntellect", ["primeintellect"])).toBe(true);
    expect(upstreamAllowed("Cloudflare", ["deepinfra/fp8"])).toBe(false);
    expect(upstreamAllowed("", ["cloudflare"])).toBe(false);
    expect(isUpstreamSlug("deepinfra/fp8")).toBe(true);
    expect(isUpstreamSlug("DeepInfra")).toBe(false);
  });

  test("a changed response shape is an api error naming the fields, with what it was billed", async () => {
    const cases: Array<[unknown, string]> = [
      [{ model: "cloudflare/clef", answers: OR_ANSWERS, usage: { input_tokens: 10, cost: 0.001 } }, "provider"],
      [{ model: "cloudflare/clef", provider: "Cloudflare", results: OR_ANSWERS, usage: { input_tokens: 10, cost: 0.001 } }, "answers"],
      [{ model: "cloudflare/clef", provider: "Cloudflare", answers: OR_ANSWERS, usage: { tokens: 10 } }, "usage.input_tokens"],
      [{ model: "cloudflare/clef", provider: "Cloudflare", answers: { ...OR_ANSWERS, layer: { type: "choice", answer: "application", probabilities: { application: 1 } } }, usage: { input_tokens: 10, cost: 0.001 } }, "answers.layer.choice"],
      [{ model: "cloudflare/clef", provider: "Cloudflare", answers: { ...OR_ANSWERS, layer: { type: "choice", choice: "application", probabilities: [0.8, 0.2] } }, usage: { input_tokens: 10, cost: 0.001 } }, "answers.layer.probabilities"],
      [{ model: "cloudflare/clef", provider: "Cloudflare", answers: { ...OR_ANSWERS, layer: { type: "label", value: "application" } }, usage: { input_tokens: 10, cost: 0.001 } }, "answers.layer.type"],
      [{ model: "cloudflare/clef", provider: "Cloudflare", answers: { ...OR_ANSWERS, concern_observability: { type: "noul", probability: 0.1 } }, usage: { input_tokens: 10, cost: 0.001 } }, "answers.concern_observability.noul"],
    ];
    for (const [body, field] of cases) {
      const { fetch } = scriptedFetch([json(body)]);
      const e = await caught(model(fetch).m.ask("S", QUESTIONS));
      expect(e.kind).toBe("api");
      expect(e.message).toContain(field);
      expect(e.message).toContain("alpha");
    }
    const { fetch } = scriptedFetch([json({ model: "cloudflare/clef", answers: OR_ANSWERS, usage: { input_tokens: 10, cost: 0.001 } })]);
    expect((await caught(model(fetch).m.ask("S", QUESTIONS))).billed).toEqual({ inputTokens: 10, costUsd: 0.001 });
    expect(checkShape(JSON.parse(await ok().text()), QUESTIONS)).toEqual([]);
  });

  test("a missing answer is that card's malformed answer, not an api change; a refusal is a refusal", async () => {
    const { fetch } = scriptedFetch([ok({ layer: { type: "refusal" }, significance: OR_ANSWERS.significance })]);
    const r = await model(fetch).m.ask("S", QUESTIONS);
    expect(r.answers.layer).toEqual({ type: "refusal" });
    expect(r.malformed).toEqual(["concern_observability"]);
  });

  test("normalise reads cached raw answers the same way", () => {
    const shapes = { significance: { type: "score" as const, levels: 5 } };
    expect(normaliseOpenRouterAnswers({ significance: OR_ANSWERS.significance }, shapes).answers.significance).toEqual({ type: "score", score: 2.4, distribution: [0, 0.1, 0.4, 0.5, 0] });
  });
});

describe("OpenRouter adapter: who served, redaction and cost", () => {
  test("the provider check runs first: a reshaped response from an outside upstream is routing, naming it", async () => {
    const { fetch } = scriptedFetch([json({ model: "cloudflare/clef", provider: "Together", results: {}, usage: { input_tokens: 10, cost: 0.001 } })]);
    const e = await caught(model(fetch).m.ask("S", QUESTIONS));
    expect(e.kind).toBe("routing");
    expect(e.upstream).toBe("Together");
    expect(e.message).toContain('"Together"');
  });

  test("a shape change from an allowed upstream carries who served it", async () => {
    const { fetch } = scriptedFetch([json({ model: "cloudflare/clef", provider: "Cloudflare", results: {}, usage: { input_tokens: 10 } })]);
    const e = await caught(model(fetch).m.ask("S", QUESTIONS));
    expect(e.kind).toBe("api");
    expect(e.upstream).toBe("Cloudflare");
  });

  test("a provider or model naming the key is redacted in the routing error and in servedBy", async () => {
    const outside = scriptedFetch([ok(OR_ANSWERS, { provider: `Evil ${KEY}` })]);
    const e = await caught(model(outside.fetch).m.ask("S", QUESTIONS));
    expect(e.kind).toBe("routing");
    expect(e.message).not.toContain(KEY);
    expect(e.upstream).not.toContain(KEY);
    // an allowed upstream whose name or model echoes the key: matched on the raw name, stored redacted
    const echo = scriptedFetch([ok(OR_ANSWERS, { provider: `Cloudflare`, model: `cloudflare/clef ${KEY}` })]);
    const r = await model(echo.fetch).m.ask("S", QUESTIONS);
    expect(JSON.stringify(r.servedBy)).not.toContain(KEY);
    expect(r.servedBy.model).toContain("[redacted]");
  });

  test("bring-your-own-key: OpenRouter's fee plus the upstream's inference cost count against the cap", () => {
    expect(costOfUsage({ cost: 0.0001, is_byok: true, cost_details: { upstream_inference_cost: 0.0024 } }, 10_000, 0.24)).toBeCloseTo(0.0025, 9);
    // without the upstream figure, the inference is estimated at the catalog price
    expect(costOfUsage({ cost: 0.0001, is_byok: true, cost_details: { upstream_inference_cost: null } }, 10_000, 0.24)).toBeCloseTo(0.0025, 9);
    expect(costOfUsage({ cost: 0.0031 }, 10_000, 0.24)).toBe(0.0031);
    expect(costOfUsage({}, 10_000, 0.24)).toBeCloseTo(0.0024, 9);
  });
});

describe("OpenRouter adapter: errors and retries", () => {
  test("403: a spent budget stops (payment), a moderation flag or guardrail block escalates the card (refused), never quoting the flagged input", async () => {
    const budget = scriptedFetch([json({ error: { code: 403, message: "Budget exceeded: $52.00 of $50.00 used; resets 2026-12-01T00:00:00.000Z.", metadata: { limit_source: "openrouter_key_limit", limit_usd: 50 } } }, 403)]);
    const b = await caught(model(budget.fetch).m.ask("S", QUESTIONS));
    expect(b.kind).toBe("payment");
    expect(b.message).toContain("openrouter_key_limit");
    const flagged = scriptedFetch([json({ error: { code: 403, message: "Your input was flagged", metadata: { reasons: ["violence"], flagged_input: "class InvoiceRepository SECRET-CARD-TEXT", provider_name: "Cloudflare" } } }, 403)]);
    const f = await caught(model(flagged.fetch).m.ask("S", QUESTIONS));
    expect(f.kind).toBe("refused");
    expect(f.message).toContain("violence");
    expect(f.message).not.toContain("SECRET-CARD-TEXT");
    const guard = scriptedFetch([json({ error: { code: 403, message: "Request blocked: prompt injection patterns detected", metadata: { patterns: ["ignore previous"] } } }, 403)]);
    expect((await caught(model(guard.fetch).m.ask("S", QUESTIONS))).kind).toBe("refused");
  });

  test("503 'no available model provider meets your routing requirements' is routing, not retried; other 503s are retried", async () => {
    const none = scriptedFetch([json({ error: { code: 503, message: "There is no available model provider that meets your routing requirements" } }, 503)]);
    const e = await caught(model(none.fetch, ["deepinfra/fp8"]).m.ask("S", QUESTIONS));
    expect(e.kind).toBe("routing");
    expect(e.message).toContain('only deepinfra/fp8, no fallbacks, data_collection "deny"');
    expect(none.sent).toHaveLength(1);
    const busy = scriptedFetch([json({ error: { code: 503, message: "Service temporarily unavailable" } }, 503), ok()]);
    expect((await model(busy.fetch).m.ask("S", QUESTIONS)).servedBy.upstream).toBe("Cloudflare");
    expect(busy.sent).toHaveLength(2);
  });

  test("429 and 5xx (502, 524, 529) are retried with backoff and Retry-After; four attempts", async () => {
    const { fetch, sent } = scriptedFetch([json({ error: { code: 429, message: "slow down" } }, 429, { "Retry-After": "3" }), json({}, 502), json({}, 524), ok()]);
    const { m, sleeps } = model(fetch);
    const r = await m.ask("S", QUESTIONS);
    expect(r.servedBy.upstream).toBe("Cloudflare");
    expect(sent).toHaveLength(4);
    expect(sleeps).toEqual([3000, 2000, 4000]);
    const down = scriptedFetch([json({ error: { code: 529, message: "overloaded" } }, 529)]);
    const e = await caught(model(down.fetch).m.ask("S", QUESTIONS));
    expect(e.kind).toBe("unavailable");
    expect(e.status).toBe(529);
    expect(down.sent).toHaveLength(4);
  });

  for (const [status, kind] of [
    [400, "bad-request"],
    [401, "auth"],
    [402, "payment"],
    [403, "auth"],
    [404, "routing"],
    [413, "bad-request"],
  ] as const) {
    test(`${status} is not retried (${kind})`, async () => {
      const { fetch, sent } = scriptedFetch([json({ error: { code: status, message: "nope" } }, status)]);
      const e = await caught(model(fetch).m.ask("S", QUESTIONS));
      expect(e.kind).toBe(kind);
      expect(e.status).toBe(status);
      expect(sent).toHaveLength(1);
      if (status === 404) expect(e.message).toContain('data_collection "deny"');
      if (status === 402) expect(e.message).toContain("OpenRouter account has insufficient credits");
      if (status === 403) expect(e.message).toContain("not permitted");
    });
  }

  test("a request past the timeout is a timeout error", async () => {
    const fetch: FetchLike = (_u, init) =>
      new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const e = await caught(model(fetch, ["cloudflare"], { timeoutMs: 20 }).m.ask("S", QUESTIONS));
    expect(e.kind).toBe("timeout");
  });

  test("the key, other keys, generation ids and user ids never appear in an error, even when echoed", async () => {
    const echo = `bad key ${KEY}; also sk-or-v1-another0123456789abcdef; generation gen-dec-1789738314-X5e5eKGQ; user_id: user_2abcDEF`;
    for (const status of [400, 401, 500]) {
      const { fetch } = scriptedFetch([json({ error: { code: status, message: echo, metadata: { provider_name: "Cloudflare" } }, user_id: "user_2abcDEF" }, status)]);
      const e = await caught(model(fetch, ["cloudflare"], { maxAttempts: 1 }).m.ask("S", QUESTIONS));
      expect(e.message).not.toContain(KEY);
      expect(e.message).not.toContain("sk-or-v1-another");
      expect(e.message).not.toContain("gen-dec-1789738314");
      expect(e.message).not.toContain("user_2abcDEF");
      expect(e.message).toContain("upstream Cloudflare");
    }
    const net = scriptedFetch([new Error(`connect failed for ${KEY}`)]);
    expect((await caught(model(net.fetch).m.ask("S", QUESTIONS))).message).not.toContain(KEY);
  });

  test("serialising or inspecting the model never shows the key", () => {
    const { m } = model(scriptedFetch([ok()]).fetch);
    expect(JSON.stringify(m)).not.toContain(KEY);
    expect(JSON.stringify(m)).toContain("cloudflare");
    expect(inspect(m, { depth: 5, showHidden: true })).not.toContain(KEY);
  });
});

describe("OpenRouter in the registry", () => {
  test("canonical models: cloudflare/clef is clef (Clef's defaults), typesafe/jev-1.14 is jev-1.14 (none: suggest-only, no bands)", () => {
    expect(resolveModel("openrouter", "cloudflare/clef")).toMatchObject({ canonicalModel: "clef", requestModel: "cloudflare/clef" });
    expect(resolveModel("openrouter", "cloudflare/clef-flash")?.canonicalModel).toBe("clef-flash");
    expect(resolveModel("openrouter", "typesafe/jev-1.14")).toMatchObject({ canonicalModel: "jev-1.14", inputPerM: 0.042 });
    expect(resolveModel("openrouter", "~typesafe/jev-latest")).toBeUndefined();
    expect(resolveModel("openrouter", "clef")).toBeUndefined();
    const workers = resolveModel("cloudflare-workers-ai", "clef")!;
    expect(thresholdsFor("dr-qset-2", resolveModel("openrouter", "cloudflare/clef")!.canonicalModel)).toEqual(thresholdsFor("dr-qset-2", workers.canonicalModel));
    expect(thresholdsFor("dr-qset-2", "clef")).not.toBeNull();
    expect(DEFAULT_THRESHOLDS["dr-qset-2"]["jev-1.14"]).toBeUndefined();
    expect(thresholdsFor("dr-qset-2", "jev-1.14")).toBeNull();
    expect(modeOf("dr-qset-2", "jev-1.14")).toBe("suggest");
  });

  test("createDecisionModel needs the key and the upstreams, and never the global fetch", () => {
    const { fetch } = scriptedFetch([ok()]);
    expect(() => createDecisionModel({ provider: "openrouter", model: "cloudflare/clef", credentials: {}, fetch, openrouter: { only: ["cloudflare"] } })).toThrow("OPENROUTER_API_KEY");
    expect(() => createDecisionModel({ provider: "openrouter", model: "cloudflare/clef", credentials: { apiKey: KEY }, fetch })).toThrow("openrouter.only");
    const m = createDecisionModel({ provider: "openrouter", model: "typesafe/jev-1.14", credentials: { apiKey: KEY }, fetch, openrouter: { only: ["typesafe"] } });
    expect(m.id).toEqual({ provider: "openrouter", model: "typesafe/jev-1.14", canonicalModel: "jev-1.14", upstream: "typesafe" });
    expect(credentialsFromEnv("openrouter", { OPENROUTER_API_KEY: KEY })).toEqual({ apiKey: KEY });
  });

  test("parseUpstreams: comma-separated slugs, lowercased, de-duplicated; a bad one is refused without echoing a key", () => {
    expect(parseUpstreams(" Cloudflare, deepinfra/fp8,cloudflare ")).toEqual(["cloudflare", "deepinfra/fp8"]);
    expect(() => parseUpstreams(" , ")).toThrow("at least one");
    expect(() => parseUpstreams("cloudflare,not a slug")).toThrow("not an OpenRouter provider slug");
    try {
      parseUpstreams(KEY.toLowerCase() + "!");
    } catch (e) {
      expect((e as Error).message).not.toContain(KEY.toLowerCase());
    }
  });
});

describe("OpenRouter in the run loop", () => {
  test("cards served by the allowed upstream are answered; servedBy counts the upstream the responses named", async () => {
    const { fetch, sent } = answeringFetch("Cloudflare");
    const { m } = model(fetch);
    const r = await classifyTier1(items(4), { model: m, spec, host: "cloudflare", cache: null, thresholds: thresholdsFor("dr-qset-2", "clef"), concurrency: 2 });
    expect(r.stats.state).toBe("on");
    expect(r.stats.sent).toBe(4);
    expect(Object.keys(r.stats.servedBy)).toEqual(["Cloudflare"]);
    expect(sent.every((s) => JSON.stringify(s.body.provider) === JSON.stringify({ only: ["cloudflare"], allow_fallbacks: false, data_collection: "deny" }))).toBe(true);
    for (const d of r.decisions.values()) expect(d.servedBy).toEqual({ upstream: "Cloudflare", model: "cloudflare/clef" });
  });

  test("an upstream outside only stops the run at once (routing): the rest go unasked, the reason names it, nothing from it is cached", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-tier1-or-cache-"));
    try {
      const cache = new Tier1Cache(dir);
      const { fetch } = answeringFetch("Together");
      const r = await classifyTier1(items(6), { model: model(fetch).m, spec, host: "openrouter/cloudflare", cache, thresholds: null, concurrency: 1 });
      expect(r.stats.unavailable?.kind).toBe("routing");
      expect(r.stats.outside).toEqual({ Together: 1 });
      const fresh = new Tier1Cache(dir);
      expect((await fresh.status()).entries).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    let n = 0;
    const { fetch } = answeringFetch(() => (++n >= 3 ? "Together" : "Cloudflare"));
    const r = await classifyTier1(items(10), { model: model(fetch).m, spec, host: "cloudflare", cache: null, thresholds: null, concurrency: 1 });
    expect(r.stats.state).toBe("unavailable");
    expect(r.stats.unavailable?.kind).toBe("routing");
    expect(r.stats.unavailable?.reason).toContain('"Together"');
    expect(r.stats.skippedFor.unavailable).toBeGreaterThan(0);
    // what the outside upstream answered was billed and is counted, but never used
    expect(r.stats.costUsd).toBeGreaterThan(0);
    expect([...r.decisions.values()].filter((d) => d.status === "answered").every((d) => d.servedBy?.upstream === "Cloudflare")).toBe(true);
  });

  test("with cards in flight, every outside upstream that received one is recorded and named in the notice", async () => {
    // Four cards in flight at once: two come back from Together and one from Mancer, after one allowed answer.
    const order = ["Cloudflare", "Together", "Mancer", "Together"];
    let i = 0;
    const gate: Array<() => void> = [];
    const base = answeringFetch(() => order[i++ % order.length]).fetch;
    let released = false;
    const fetch: FetchLike = async (url, init) => {
      // hold the first four requests until all four are in flight, so the stop can't prevent the others
      if (!released) {
        await new Promise<void>((resolve) => {
          gate.push(resolve);
          if (gate.length >= 4) {
            released = true;
            gate.splice(0).forEach((g) => g());
          }
        });
      }
      return base(url, init);
    };
    const r = await classifyTier1(items(8), { model: model(fetch, ["cloudflare"]).m, spec, host: "openrouter/cloudflare", cache: null, thresholds: null, concurrency: 4 });
    expect(r.stats.unavailable?.kind).toBe("routing");
    expect(r.stats.outside).toEqual({ Together: 2, Mancer: 1 });
    expect(r.stats.receivedBy).toEqual({ Cloudflare: 1, Together: 2, Mancer: 1 });
    const root = mkdtempSync(path.join(tmpdir(), "dr-tier1-or-notice-"));
    try {
      const file = tier1Paths(root, "cbm").config;
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ version: 1, provider: "openrouter", model: "cloudflare/clef", openrouter: { only: ["cloudflare"] } }));
      chmodSync(file, 0o600);
      const s = (await openTier1(root, "cbm", { env: { OPENROUTER_API_KEY: KEY }, git: () => null, fetch })) as ReadyTier1;
      const { runNotice } = await import("../../../../src/analyzers/classifier/session.js");
      const notice = runNotice(s, r.stats, s.month);
      expect(notice).toContain("which forwarded them to Cloudflare (1); and to Together (2), Mancer (1), outside the allowed upstreams");
      expect(notice).toContain("Tier 1 stopped (routing)");
      // never a party that didn't receive anything
      expect(notice).not.toContain("deepinfra");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("cards whose request got no response naming an upstream are said as such, never attributed", async () => {
    const { runNotice } = await import("../../../../src/analyzers/classifier/session.js");
    const root = mkdtempSync(path.join(tmpdir(), "dr-tier1-or-notice2-"));
    try {
      const file = tier1Paths(root, "cbm").config;
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ version: 1, provider: "openrouter", model: "cloudflare/clef", openrouter: { only: ["cloudflare", "deepinfra/fp8"] } }));
      chmodSync(file, 0o600);
      const s = (await openTier1(root, "cbm", { env: { OPENROUTER_API_KEY: KEY }, git: () => null, fetch: answeringFetch().fetch })) as ReadyTier1;
      const stats = { state: "on", cards: 5, cached: 0, sent: 3, failed: 2, skipped: 0, skippedFor: { cap: 0, deadline: 0, unavailable: 0, cacheOnly: 0 }, bands: { accept: 0, notElement: 0, escalate: 5 }, costUsd: 0.01, inputTokens: 1, servedBy: { DeepInfra: 3 }, receivedBy: { DeepInfra: 3 }, durationMs: 1, concurrency: { start: 1, end: 1 }, cache: { repaired: 0, errors: 0 } } satisfies Tier1RunStats;
      const notice = runNotice(s, stats, s.month);
      expect(notice).toContain("which forwarded them to DeepInfra (3) (2 more got no response naming an upstream; the routing allows only cloudflare or deepinfra/fp8)");
      expect(notice).not.toContain("Cloudflare (");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a changed response shape stops the run at the first card (api), not after five", async () => {
    const { fetch, sent } = scriptedFetch([json({ model: "cloudflare/clef", answers: {}, usage: { input_tokens: 10, cost: 0.001 } })]);
    const r = await classifyTier1(items(8), { model: model(fetch).m, spec, host: "cloudflare", cache: null, thresholds: null, concurrency: 1 });
    expect(r.stats.state).toBe("unavailable");
    expect(r.stats.unavailable?.kind).toBe("api");
    expect(r.stats.unavailable?.reason).toContain("provider");
    expect(sent).toHaveLength(1);
    expect(r.stats.failed).toBe(1);
    expect(r.stats.skippedFor.unavailable).toBe(7);
  });

  test("refusals escalate with a reason, and don't trip the circuit breaker", async () => {
    const { fetch } = scriptedFetch([
      () => json({ model: "cloudflare/clef", provider: "Cloudflare", answers: { layer: { type: "refusal" } }, usage: { input_tokens: 10, cost: 0.00001 } }),
    ]);
    const r = await classifyTier1(items(8), { model: model(fetch).m, spec, host: "cloudflare", cache: null, thresholds: thresholdsFor("dr-qset-2", "clef"), concurrency: 1, breakerAfter: 3 });
    expect(r.stats.state).toBe("on");
    expect(r.stats.failed).toBe(8);
    for (const d of r.decisions.values()) {
      expect(d.band).toBe("escalate");
      expect(d.reason).toContain("refusal");
    }
  });

  test("refusals are cached like answers: a second run pays nothing for them, and they still escalate", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-tier1-or-refusal-"));
    try {
      const { fetch, sent } = scriptedFetch([
        () => json({ model: "cloudflare/clef", provider: "Cloudflare", answers: { layer: { type: "refusal" } }, usage: { input_tokens: 10, cost: 0.00001 } }),
      ]);
      const run = () => classifyTier1(items(3), { model: model(fetch).m, spec, host: "openrouter/cloudflare", cache: new Tier1Cache(dir), thresholds: thresholdsFor("dr-qset-2", "clef"), concurrency: 1 });
      const first = await run();
      expect(first.stats.failed).toBe(3);
      const asked = sent.length;
      const second = await run();
      expect(sent.length).toBe(asked);
      expect(second.stats.cached).toBe(3);
      for (const d of second.decisions.values()) {
        expect(d.band).toBe("escalate");
        expect(d.cached).toBe(true);
        expect(d.reason).toContain("refusal");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a 403 moderation flag escalates that card only; the run goes on", async () => {
    let n = 0;
    const flagged = () => json({ error: { code: 403, message: "Your input was flagged", metadata: { reasons: ["x"] } } }, 403);
    const { fetch: answer } = answeringFetch("Cloudflare");
    const fetch: FetchLike = async (u, init) => (++n <= 2 ? flagged() : answer(u, init));
    const r = await classifyTier1(items(8), { model: model(fetch).m, spec, host: "openrouter/cloudflare", cache: null, thresholds: null, concurrency: 1, breakerAfter: 2 });
    expect(r.stats.state).toBe("on");
    // two flagged cards in a row with breakerAfter 2 don't trip the breaker
    expect([...r.decisions.values()].filter((d) => d.status === "failed" && d.reason?.includes("moderation")).length).toBe(2);
    expect(r.stats.sent).toBeGreaterThan(0);
  });

  test("402 stops the run (payment)", async () => {
    const { fetch } = scriptedFetch([json({ error: { code: 402, message: "Insufficient credits" } }, 402)]);
    const r = await classifyTier1(items(4), { model: model(fetch).m, spec, host: "openrouter/cloudflare", cache: null, thresholds: null, concurrency: 1 });
    expect(r.stats.unavailable?.kind).toBe("payment");
    expect(r.stats.unavailable?.reason).toContain("insufficient credits");
    expect(r.stats.skippedFor.unavailable).toBe(3);
  });

  test("a fresh answer from another model than the cached answers' is said in the notice", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-tier1-or-drift-"));
    try {
      const cache = new Tier1Cache(dir);
      const old = answeringFetch("TypeSafe", { application: 0.8 }, { model: "typesafe/jev-1.14-20261014" });
      const jev = (fetch: FetchLike) => new OpenRouterModel({ model: "typesafe/jev-1.14", credentials: { apiKey: KEY }, routing: { only: ["typesafe"] }, fetch });
      await classifyTier1(items(2), { model: jev(old.fetch), spec, host: "openrouter/typesafe", cache, thresholds: null, concurrency: 1 });
      const fresh = answeringFetch("TypeSafe", { application: 0.8 }, { model: "typesafe/jev-1.14-20261201" });
      const r = await classifyTier1(items(4), { model: jev(fresh.fetch), spec, host: "openrouter/typesafe", cache: new Tier1Cache(dir), thresholds: null, concurrency: 1 });
      expect(r.stats.cached).toBe(2);
      expect(r.stats.modelChange).toEqual({ cached: ["typesafe/jev-1.14-20261014"], fresh: ["typesafe/jev-1.14-20261201"] });
      const root = mkdtempSync(path.join(tmpdir(), "dr-tier1-or-drift-root-"));
      try {
        const file = tier1Paths(root, "cbm").config;
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ version: 1, provider: "openrouter", model: "typesafe/jev-1.14", openrouter: { only: ["typesafe"] } }));
        chmodSync(file, 0o600);
        const s = (await openTier1(root, "cbm", { env: { OPENROUTER_API_KEY: KEY }, git: () => null, fetch: fresh.fetch })) as ReadyTier1;
        const { runNotice } = await import("../../../../src/analyzers/classifier/session.js");
        expect(runNotice(s, r.stats, s.month)).toContain("The provider now serves typesafe/jev-1.14-20261201, while cached answers came from typesafe/jev-1.14-20261014");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("OpenRouter in a session: notice, probes per upstream, status", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function project(only: string[], model = "cloudflare/clef"): string {
    const d = mkdtempSync(path.join(tmpdir(), "dr-tier1-openrouter-"));
    dirs.push(d);
    const file = tier1Paths(d, "cbm").config;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 1, provider: "openrouter", model, openrouter: { only } }));
    chmodSync(file, 0o600);
    return d;
  }
  const noGit = () => null;

  async function ready(root: string, fetch: FetchLike): Promise<ReadyTier1> {
    const s = await openTier1(root, "cbm", { env: { OPENROUTER_API_KEY: KEY }, git: noGit, fetch });
    expect(s.state).toBe("ready");
    return s as ReadyTier1;
  }

  test("the party and the notices name OpenRouter, the upstreams and the alpha status; never the key", async () => {
    const root = project(["cloudflare", "deepinfra/fp8"]);
    const s = await ready(root, answeringFetch().fetch);
    expect(s.party).toBe("OpenRouter (cloudflare/clef), to be forwarded only to cloudflare or deepinfra/fp8");
    expect(s.routing).toEqual({ only: ["cloudflare", "deepinfra/fp8"], allowFallbacks: false, dataCollection: "deny" });
    expect(s.host).toBe("openrouter/any:cloudflare,deepinfra/fp8");
    expect(JSON.stringify(s.model)).not.toContain(KEY);
  });

  test("probes: one per upstream, each pinned, recorded in the ledger with its upstream", async () => {
    const root = project(["cloudflare", "deepinfra/fp8"]);
    const pinned: string[] = [];
    const { fetch } = answeringFetch((body) => {
      const only = body.provider.only as string[];
      pinned.push(only.join(","));
      return only[0] === "cloudflare" ? "Cloudflare" : "DeepInfra";
    }, { "data-store": 0.33, application: 0.31, "data-model": 0.13 });
    const s = await ready(root, fetch);
    const probes = await runProbes(s, spec);
    expect(probes.map((p) => p.pinned)).toEqual(["cloudflare", "deepinfra/fp8"]);
    expect(probes.map((p) => p.upstream)).toEqual(["Cloudflare", "DeepInfra"]);
    expect(new Set(pinned)).toEqual(new Set(["cloudflare", "deepinfra/fp8"]));
    expect(probes.every((p) => p.ok)).toBe(true);
    const ledger = readFileSync(tier1Paths(root, "cbm").ledger, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(ledger.map((e) => [e.source, e.upstream])).toEqual([
      ["probe", "Cloudflare"],
      ["probe", "DeepInfra"],
    ]);
    expect(readFileSync(tier1Paths(root, "cbm").ledger, "utf8")).not.toContain(KEY);
  });

  test("a probe answered by another upstream is flagged (routing), not trusted", async () => {
    const root = project(["deepinfra/fp8"]);
    const s = await ready(root, answeringFetch("Cloudflare").fetch);
    const [probe] = await runProbes(s, spec);
    expect(probe.ok).toBe(false);
    expect(probe.error?.kind).toBe("routing");
    expect(probe.flags[0]).toContain("Cloudflare");
    // the ledger names who served, as the response named it (as for every other line), never the pinned slug
    expect(probe.upstream).toBe("Cloudflare");
    expect(probe.pinned).toBe("deepinfra/fp8");
    const ledger = readFileSync(tier1Paths(root, "cbm").ledger, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(ledger.map((e) => e.upstream)).toEqual(["Cloudflare"]);
  });

  test("status, its summary and the run notice show the routing and the alpha sentence; set upstreams keeps the routing fixed", async () => {
    const root = project(["cloudflare"]);
    const st = await tier1Status(root, "cbm", { env: { OPENROUTER_API_KEY: KEY }, git: noGit });
    expect(st.state).toBe("on");
    expect(st.routing).toEqual({ only: ["cloudflare"], allowFallbacks: false, dataCollection: "deny" });
    expect(st.credentials).toEqual({ apiKey: { set: true, from: "OPENROUTER_API_KEY" } });
    const d = describeTier1Status(st);
    expect(d.summary).toContain("forwarded only to cloudflare");
    expect(d.summary).toContain("alpha");
    expect(JSON.stringify({ ...st, ...d })).not.toContain(KEY);

    const s = await ready(root, answeringFetch("Cloudflare").fetch);
    const r = await classifyTier1(items(3), { model: s.model, spec, host: s.host, cache: null, thresholds: s.thresholds, concurrency: 1 });
    const { blockOfRun } = await import("../../../../src/analyzers/classifier/session.js");
    const block = blockOfRun(s, r.stats, s.month);
    expect(block.routing).toEqual({ only: ["cloudflare"], allowFallbacks: false, dataCollection: "deny" });
    expect(block.notice).toContain("to OpenRouter (cloudflare/clef), which forwarded them to Cloudflare (3)");
    expect(block.notice).toContain("OpenRouter's Decisions API is in alpha and may change.");
    expect(JSON.stringify(block)).not.toContain(KEY);

    expect(await setTier1Value(tier1Paths(root, "cbm"), "upstreams", "deepinfra/fp8,primeintellect")).toContain("deepinfra/fp8, primeintellect");
    const after = JSON.parse(readFileSync(tier1Paths(root, "cbm").config, "utf8"));
    expect(after.openrouter.only).toEqual(["deepinfra/fp8", "primeintellect"]);
  });

  test("Jev through OpenRouter: no thresholds, so no bands; the notice says every card escalates", async () => {
    const root = project(["typesafe"], "typesafe/jev-1.14");
    const s = await ready(root, answeringFetch("TypeSafe").fetch);
    expect(s.thresholds).toBeNull();
    expect(s.mode).toBe("suggest");
    const r = await classifyTier1(items(2), { model: s.model, spec, host: s.host, cache: null, thresholds: s.thresholds, concurrency: 1 });
    expect([...r.decisions.values()].every((d) => d.band === "escalate")).toBe(true);
    const { runNotice } = await import("../../../../src/analyzers/classifier/session.js");
    expect(runNotice(s, r.stats, s.month)).toContain("jev-1.14 has no thresholds");
  });
});
