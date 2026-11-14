/**
 * The Workers AI adapter, against a scripted fetch: no test reaches the network.
 */
import { describe, expect, test } from "bun:test";
import {
  CloudflareWorkersAiModel,
  parseRetryAfter,
  type FetchLike,
} from "../../../../src/analyzers/classifier/decision-model/adapters/cloudflare-workers-ai.js";
import {
  choiceOf,
  createDecisionModel,
  credentialsFromEnv,
  DecisionModelError,
  noulOf,
  resolveModel,
  scoreOf,
  type Question,
} from "../../../../src/analyzers/classifier/index.js";

const TOKEN = "cf-secret-token-0123456789";
const ACCOUNT = "acct1234";

const QUESTIONS: Record<string, Question> = {
  layer: { type: "choice", instructions: "Which layer?", criteria: { application: "App", none: "None" } },
  significance: { type: "score", instructions: "How significant?", criteria: ["0", "1", "2", "3", "4"] },
  concern_observability: { type: "noul", instructions: "Observability?" },
};

const ANSWERS = {
  layer: { choice: "application", probabilities: { application: 0.8, none: 0.2 }, confidence: 0.6 },
  significance: { score: 2.4 },
  concern_observability: { noul: 0.05 },
};

interface Sent {
  url: string;
  init: RequestInit;
}

/** A fetch that answers from a list of responses (the last one repeats) and records requests. */
function scriptedFetch(responses: Array<Response | (() => Response) | Error>): { fetch: FetchLike; sent: Sent[] } {
  const sent: Sent[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    sent.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r() : r.clone();
  };
  return { fetch, sent };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function model(fetch: FetchLike, extra: Partial<ConstructorParameters<typeof CloudflareWorkersAiModel>[0]> = {}) {
  const sleeps: number[] = [];
  const m = new CloudflareWorkersAiModel({
    model: "clef",
    credentials: { accountId: ACCOUNT, apiToken: TOKEN },
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

describe("request", () => {
  test("URL, headers and the Jev-shaped body, as the harness sent them", async () => {
    const { fetch, sent } = scriptedFetch([json({ success: true, result: { answers: ANSWERS, usage: { input_tokens: 3000 } } })]);
    const { m } = model(fetch);
    await m.ask("STATE", QUESTIONS);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/cloudflare/clef`);
    expect(sent[0].init.method).toBe("POST");
    expect(sent[0].init.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" });
    expect(sent[0].init.body).toBe(JSON.stringify({ model: "clef", state: "STATE", questions: QUESTIONS }));
    expect(sent[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  test("clef-flash by short name or provider id", () => {
    const { fetch } = scriptedFetch([json({})]);
    for (const name of ["clef-flash", "@cf/cloudflare/clef-flash"]) {
      const { m } = model(fetch, { model: name });
      expect(m.id).toEqual({ provider: "cloudflare-workers-ai", model: "@cf/cloudflare/clef-flash", canonicalModel: "clef-flash" });
      expect(m.pricing.inputPerM).toBe(0.09);
      expect(m.requestBody("S", {})).toBe('{"model":"clef-flash","state":"S","questions":{}}');
    }
  });
});

describe("responses", () => {
  test("wrapped (result.answers) answers are normalised and kept raw", async () => {
    const { fetch } = scriptedFetch([json({ success: true, result: { model: "@cf/cloudflare/clef", answers: ANSWERS, usage: { input_tokens: 3000, output_tokens: 0 } } })]);
    const { m } = model(fetch);
    const r = await m.ask("S", QUESTIONS);
    expect(r.answers).toEqual({
      layer: { type: "choice", probabilities: { application: 0.8, none: 0.2 } },
      significance: { type: "score", score: 2.4, distribution: null },
      concern_observability: { type: "noul", probability: 0.05 },
    });
    expect(r.malformed).toEqual([]);
    expect(r.raw).toEqual(ANSWERS);
    expect(r.usage.inputTokens).toBe(3000);
    expect(r.usage.costUsd).toBeCloseTo((3000 * 0.24) / 1e6, 12);
    expect(r.servedBy).toEqual({ model: "@cf/cloudflare/clef" });
  });

  test("unwrapped answers (some deployments) are read too", async () => {
    const { fetch } = scriptedFetch([json({ answers: ANSWERS, usage: { input_tokens: 10 } })]);
    const r = await model(fetch).m.ask("S", QUESTIONS);
    expect(r.raw).toEqual(ANSWERS);
    expect(r.usage.inputTokens).toBe(10);
  });

  test("an unreadable answer is listed as malformed, not thrown", async () => {
    const { fetch } = scriptedFetch([json({ result: { answers: { layer: { probabilities: {} }, significance: { score: 1 } } } })]);
    const r = await model(fetch).m.ask("S", QUESTIONS);
    expect(r.malformed.sort()).toEqual(["concern_observability", "layer"]);
    expect(r.answers.significance).toEqual({ type: "score", score: 1, distribution: null });
  });

  test("a refusal answer is normalised as a refusal", async () => {
    const { fetch } = scriptedFetch([json({ result: { answers: { layer: { type: "refusal" } } } })]);
    const r = await model(fetch).m.ask("S", { layer: QUESTIONS.layer });
    expect(r.answers.layer).toEqual({ type: "refusal" });
  });

  test("success: false and a body that isn't JSON are malformed", async () => {
    const e1 = await caught(model(scriptedFetch([json({ success: false, errors: [{ message: "nope" }] })]).fetch).m.ask("S", QUESTIONS));
    expect(e1.kind).toBe("malformed");
    const e2 = await caught(model(scriptedFetch([new Response("<html>", { status: 200 })]).fetch).m.ask("S", QUESTIONS));
    expect(e2.kind).toBe("malformed");
  });
});

describe("retries", () => {
  test("429 and 5xx are retried with 1, 2, 4 s backoff, four attempts", async () => {
    const { fetch, sent } = scriptedFetch([json({}, 429), json({}, 502), json({}, 500), json({ result: { answers: ANSWERS } })]);
    const { m, sleeps } = model(fetch);
    const r = await m.ask("S", QUESTIONS);
    expect(sent).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(r.raw).toEqual(ANSWERS);
  });

  test("Retry-After is honoured (seconds and HTTP dates), capped", async () => {
    const { fetch } = scriptedFetch([json({}, 429, { "Retry-After": "3" }), json({}, 503, { "Retry-After": "600" }), json({ result: { answers: ANSWERS } })]);
    const { m, sleeps } = model(fetch);
    await m.ask("S", QUESTIONS);
    expect(sleeps).toEqual([3000, 60_000]);
    expect(parseRetryAfter("2.5")).toBe(2500);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  test("after the last attempt the error says rate-limit or unavailable, with status and Retry-After", async () => {
    const e = await caught(model(scriptedFetch([json({ errors: [] }, 429, { "Retry-After": "7" })]).fetch).m.ask("S", QUESTIONS));
    expect(e.kind).toBe("rate-limit");
    expect(e.status).toBe(429);
    expect(e.retryAfterMs).toBe(7000);
    const { fetch, sent } = scriptedFetch([json({}, 503)]);
    const { m, sleeps } = model(fetch);
    const e2 = await caught(m.ask("S", QUESTIONS));
    expect(e2.kind).toBe("unavailable");
    expect(sent).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  for (const [status, kind] of [
    [400, "bad-request"],
    [401, "auth"],
    [403, "auth"],
  ] as const) {
    test(`${status} is not retried (${kind})`, async () => {
      const { fetch, sent } = scriptedFetch([json({ success: false, errors: [{ code: 10000, message: "denied" }] }, status)]);
      const { m, sleeps } = model(fetch);
      const e = await caught(m.ask("S", QUESTIONS));
      expect(e.kind).toBe(kind);
      expect(e.status).toBe(status);
      expect(sent).toHaveLength(1);
      expect(sleeps).toEqual([]);
    });
  }
});

describe("timeouts and failures", () => {
  test("a request past the timeout is a timeout error", async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
      });
    const e = await caught(model(hanging, { timeoutMs: 20 }).m.ask("S", QUESTIONS));
    expect(e.kind).toBe("timeout");
  });

  test("the caller's signal cancels the request", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { fetch, sent } = scriptedFetch([json({ result: { answers: ANSWERS } })]);
    const e = await caught(model(fetch).m.ask("S", QUESTIONS, { signal: ctl.signal }));
    expect(e.kind).toBe("timeout");
    expect(sent).toHaveLength(0);
  });

  test("a network failure is unavailable", async () => {
    const e = await caught(model(scriptedFetch([new TypeError("fetch failed")]).fetch).m.ask("S", QUESTIONS));
    expect(e.kind).toBe("unavailable");
  });

  test("the token never appears in an error message, even when the provider echoes it", async () => {
    const echo = `Authorization: Bearer ${TOKEN} is invalid`;
    for (const r of [json({ errors: [{ message: echo }] }, 401), json({ errors: [{ message: echo }] }, 500), new Response(echo, { status: 200 })]) {
      const e = await caught(model(scriptedFetch([r]).fetch).m.ask("S", QUESTIONS));
      expect(e.message).not.toContain(TOKEN);
      expect(String(e.stack)).not.toContain(TOKEN);
    }
    const e = await caught(model(scriptedFetch([new TypeError(`connect failed ${TOKEN}`)]).fetch).m.ask("S", QUESTIONS));
    expect(e.message).not.toContain(TOKEN);
  });
});

describe("registry", () => {
  test("resolves names and ids to the canonical model and price", () => {
    expect(resolveModel("cloudflare-workers-ai", "clef")).toEqual({
      provider: "cloudflare-workers-ai",
      name: "clef",
      id: "@cf/cloudflare/clef",
      requestModel: "clef",
      canonicalModel: "clef",
      inputPerM: 0.24,
    });
    expect(resolveModel("cloudflare-workers-ai", "@cf/cloudflare/clef-flash")?.canonicalModel).toBe("clef-flash");
    expect(resolveModel("cloudflare-workers-ai", "jev")).toBeUndefined();
    expect(resolveModel("openrouter", "cloudflare/clef")).toBeUndefined();
  });

  test("creates an adapter with injected fetch; refuses unknown providers, models and missing credentials", async () => {
    const { fetch, sent } = scriptedFetch([json({ result: { answers: ANSWERS } })]);
    const m = createDecisionModel({ provider: "cloudflare-workers-ai", model: "clef", credentials: { accountId: ACCOUNT, apiToken: TOKEN }, fetch });
    await m.ask("S", QUESTIONS);
    expect(sent).toHaveLength(1);
    expect(() => createDecisionModel({ provider: "nope", model: "clef", credentials: {} })).toThrow(/Unknown decision-model provider/);
    expect(() => createDecisionModel({ provider: "cloudflare-workers-ai", model: "gpt", credentials: {} })).toThrow(/Unknown model/);
    expect(() => createDecisionModel({ provider: "cloudflare-workers-ai", model: "clef", credentials: { accountId: ACCOUNT } })).toThrow(/needs credentials/);
  });

  test("credentials from an environment use the harness's variable names", () => {
    expect(credentialsFromEnv("cloudflare-workers-ai", { CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" })).toEqual({ accountId: "a", apiToken: "t" });
  });
});

describe("the harness's parsers, ported as is", () => {
  test("choiceOf: the named choice, else the most probable option", () => {
    expect(choiceOf({ choice: "a", probabilities: { a: 0.1, b: 0.9 } }).choice).toBe("a");
    expect(choiceOf({ answer: "b" }).choice).toBe("b");
    expect(choiceOf({ probabilities: { a: 0.1, b: 0.9 } })).toEqual({ choice: "b", probabilities: { a: 0.1, b: 0.9 }, confidence: null });
    expect(choiceOf(undefined)).toEqual({ choice: null, probabilities: {}, confidence: null });
  });

  test("noulOf reads noul, probability, value or score", () => {
    expect(noulOf({ noul: 0.2 })).toBe(0.2);
    expect(noulOf({ probability: 0.3 })).toBe(0.3);
    expect(noulOf({ score: 0.4 })).toBe(0.4);
    expect(Number.isNaN(noulOf({}))).toBe(true);
  });

  test("scoreOf: the score, else the expected level of a distribution; a 1..N score is clamped", () => {
    expect(scoreOf({ score: 2.5 }, 5)).toEqual({ score: 2.5, probabilities: null });
    expect(scoreOf({ distribution: [0, 0, 1, 0, 0] }, 5)).toEqual({ score: 2, probabilities: [0, 0, 1, 0, 0] });
    expect(scoreOf({ score: 5 }, 5).score).toBe(4);
  });
});
