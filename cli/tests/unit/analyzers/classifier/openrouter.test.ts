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
} from "../../../../src/analyzers/classifier/index.js";

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

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

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

/** A fetch that answers whatever it is asked, in OpenRouter's shape, from `provider`. */
function answeringFetch(provider: string | ((body: Sent["body"]) => string) = "Cloudflare", layers: Record<string, number> = { application: 0.8 }) {
  const sent: Sent[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init.body)) as Sent["body"];
    sent.push({ url, init, body });
    const answers: Record<string, unknown> = {};
    for (const [k, q] of Object.entries(body.questions)) {
      if (q.type === "choice") {
        const keys = Object.keys(q.criteria);
        const fixed = Object.fromEntries(keys.filter((o) => k === "layer" && o in layers).map((o) => [o, layers[o]]));
        const rest = keys.filter((o) => !(o in fixed));
        const left = Math.max(0, 1 - Object.values(fixed).reduce((a, b) => a + b, 0));
        const probabilities: Record<string, number> = { ...fixed };
        if (k === "layer") for (const o of rest) probabilities[o] = left / rest.length;
        else rest.forEach((o, i) => (probabilities[o] = i === 0 ? 0.7 : 0.3 / Math.max(1, rest.length - 1)));
        const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
        answers[k] = { type: "choice", choice, confidence: 0.5, probabilities };
      } else if (q.type === "score") answers[k] = { type: "score", score: 2, confidence: 0.5, probabilities: { "0": 0, "1": 0, "2": 1, "3": 0, "4": 0 } };
      else answers[k] = { type: "noul", noul: 0.1 };
    }
    const served = typeof provider === "function" ? provider(body) : provider;
    return json({ id: "gen-dec-123456789", model: body.model, provider: served, answers, usage: { input_tokens: 5000, output_tokens: 0, cost: 0.0012 } });
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
    expect(hostOf({ provider: "openrouter", openrouter: { only: ["cloudflare", "deepinfra/fp8"] } }, two)).toBe("any");
    expect(hostOf({ provider: "openrouter", openrouter: { only: ["deepinfra/fp8"] } }, model(fetch, ["deepinfra/fp8"]).m)).toBe("deepinfra/fp8");
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

describe("OpenRouter adapter: errors and retries", () => {
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
    [402, "auth"],
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
      if (status === 402) expect(e.message).toContain("insufficient credits");
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

  test("an upstream outside only stops the run at once (routing): the rest go unasked and the reason names it", async () => {
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
    expect(s.host).toBe("any");
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
