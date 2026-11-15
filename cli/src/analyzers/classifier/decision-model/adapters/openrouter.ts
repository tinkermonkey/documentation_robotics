/**
 * OpenRouter adapter: the Decisions API (`POST https://openrouter.ai/api/alpha/decisions`, alpha:
 * "the shape may change"), TIER1_DESIGN.md sections 3.2 and 4.6.
 *
 * The request is the Jev shape the Workers AI adapter sends (`model`, `state`, `questions`), with
 * OpenRouter's routing object. Every request carries `provider.only` (the configured upstreams, or
 * the one a probe pins), `allow_fallbacks: false` and `data_collection: "deny"` (and `zdr: true`
 * when configured): those are fixed here, not settings.
 *
 * The response names the upstream that served (`provider`, a display name such as `DeepInfra`) and
 * the resolved model (`model`); both go into `servedBy`. An upstream outside the allowed ones is a
 * `routing` error, which stops the run. The fields read are pinned (`checkShape`): a response that
 * no longer matches them is an `api` error naming the fields, which stops the run too, rather than a
 * silent misread. A `refusal` answer is normalised as a refusal, so its card escalates. Cost is the
 * response's own `usage.cost` (USD), else input tokens times the catalog price.
 *
 * As the Workers AI adapter: `fetch` is injected (tests never reach the network), the key sits in a
 * `#` private field and is redacted from every error (with generation and user ids, which
 * OpenRouter's bodies can echo), four attempts with 1, 2, 4 s backoff on 429 and 5xx honouring
 * `Retry-After`, cut short by the caller's signal or deadline, and 20 s a request.
 */
import { toAnswer } from "../jev-answers.js";
import {
  DecisionModelError,
  shapesOf,
  type AskOptions,
  type AskResult,
  type DecisionModel,
  type DecisionModelId,
  type Question,
  type QuestionShape,
  type RawAnswer,
} from "../types.js";
import { abortableWait, isAbort, messageOf, parseRetryAfter, readBody, type FetchLike } from "./http.js";

export const OPENROUTER = "openrouter";
export const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

/** Said whenever OpenRouter is configured or used (decision 11). */
export const OPENROUTER_ALPHA_NOTICE = "OpenRouter's Decisions API is in alpha and may change.";

/**
 * The decision models this adapter serves, by OpenRouter id. `canonicalModel` is what thresholds
 * and the cache key on, so Clef through OpenRouter gets Clef's defaults (decision 12); Jev has no
 * defaults yet, so it runs suggest-only with no bands. `inputPerM` is the highest price an upstream
 * listed in OpenRouter's catalog (2026-11-15), used only to estimate: the ledger records the
 * response's own `usage.cost`. Versioned ids only: an alias (`~typesafe/jev-latest`) can move to
 * another model under the same id, and the cache, keyed on the id, would then serve the old one's
 * answers.
 */
export const OPENROUTER_MODELS: Record<string, { canonicalModel: string; inputPerM: number }> = {
  "cloudflare/clef": { canonicalModel: "clef", inputPerM: 0.24 },
  "cloudflare/clef-flash": { canonicalModel: "clef-flash", inputPerM: 0.038 },
  "typesafe/jev-1.14": { canonicalModel: "jev-1.14", inputPerM: 0.042 },
  "typesafe/jev-1.13": { canonicalModel: "jev-1.13", inputPerM: 0.042 },
};

/** Why an alias isn't accepted, for messages. */
export function openRouterAliasHint(model: string): string | undefined {
  if (!model.startsWith("~")) return undefined;
  return `"${model}" is an alias, which can move to another model under the same id: pin a versioned id (${Object.keys(OPENROUTER_MODELS).join(", ")})`;
}

/**
 * An OpenRouter provider slug as `provider.only` takes it: `cloudflare`, `deepinfra/fp8`
 * (`provider[/variant][/region][/tier]`, lowercase). A base slug allows every endpoint of that
 * provider; a variant only that one.
 */
export const UPSTREAM_SLUG = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9._-]+){0,3}$/;

export function isUpstreamSlug(s: string): boolean {
  return UPSTREAM_SLUG.test(s) && s.length <= 64;
}

/**
 * Whether the upstream a response names (`DeepInfra`, `PrimeIntellect`) is one of the allowed slugs
 * (`deepinfra/fp8`, `primeintellect`). The response names the provider, not the variant, so a
 * variant slug is matched on its provider: OpenRouter routes within the variant, and the check
 * guards against another provider answering.
 */
export function upstreamAllowed(served: string, allowed: readonly string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const s = norm(served);
  return !!s && allowed.some((slug) => norm(slug.split("/")[0]) === s);
}

export interface OpenRouterRouting {
  /** The upstreams allowed to receive card text (`tier1.json`'s `openrouter.only`). */
  only: string[];
  /** Zero-data-retention endpoints only. */
  zdr?: boolean;
}

export interface OpenRouterOptions {
  /** An id of {@link OPENROUTER_MODELS}. */
  model: string;
  credentials: { apiKey: string };
  routing: OpenRouterRouting;
  fetch: FetchLike;
  /** Per request; default 20 s. */
  timeoutMs?: number;
  /** Attempts on 429 and 5xx; default 4. */
  maxAttempts?: number;
  /** Backoff base: attempt n waits base * 2^n ms unless Retry-After says otherwise; default 1000. */
  backoffMs?: number;
  /** Longest Retry-After honoured; default 60 s. */
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** The routing object every request carries. */
export interface WireRouting {
  only: string[];
  allow_fallbacks: false;
  data_collection: "deny";
  zdr?: true;
}

const ANSWER_TYPES = new Set(["choice", "score", "noul", "box", "refusal"]);

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNumRecord = (v: unknown) => isObject(v) && Object.values(v).every(isNum);

/**
 * The fields of a 200 response the adapter reads, checked against what OpenRouter documents
 * (sources in the PR and TIER1_DESIGN.md): `provider` and `model` strings, an `answers` object,
 * `usage.input_tokens` a number (`usage.cost` a number when present), and per answer to a question
 * asked: its `type` that question's (or `refusal`), a choice's `choice` and numeric
 * `probabilities`, a score's numeric `score`, a noul's numeric `noul`. Returns the paths that don't
 * match; an answer that is missing altogether is the card's problem (`malformed`), not the API's.
 */
export function checkShape(json: unknown, questions: Record<string, Question>): string[] {
  if (!isObject(json)) return ["(body): expected an object"];
  const bad: string[] = [];
  if (typeof json.provider !== "string" || !json.provider) bad.push("provider: expected the serving upstream's name");
  if (typeof json.model !== "string" || !json.model) bad.push("model: expected the resolved model id");
  if (!isObject(json.usage) || !isNum(json.usage.input_tokens)) bad.push("usage.input_tokens: expected a number");
  else if (json.usage.cost !== undefined && json.usage.cost !== null && !isNum(json.usage.cost)) bad.push("usage.cost: expected a number");
  if (!isObject(json.answers)) {
    bad.push("answers: expected an object of answers by question");
    return bad;
  }
  for (const [key, q] of Object.entries(questions)) {
    const a = json.answers[key];
    if (a === undefined) continue;
    if (!isObject(a) || typeof a.type !== "string") {
      bad.push(`answers.${key}: expected an object with a type`);
      continue;
    }
    if (!ANSWER_TYPES.has(a.type) || (a.type !== "refusal" && a.type !== q.type)) {
      bad.push(`answers.${key}.type: expected ${q.type} or refusal, got ${JSON.stringify(a.type).slice(0, 20)}`);
      continue;
    }
    if (a.type === "choice") {
      if (typeof a.choice !== "string") bad.push(`answers.${key}.choice: expected a string`);
      if (!isNumRecord(a.probabilities)) bad.push(`answers.${key}.probabilities: expected numbers by option`);
    } else if (a.type === "score") {
      if (!isNum(a.score)) bad.push(`answers.${key}.score: expected a number`);
      if (a.probabilities !== undefined && !isNumRecord(a.probabilities) && !(Array.isArray(a.probabilities) && a.probabilities.every(isNum))) {
        bad.push(`answers.${key}.probabilities: expected numbers by level`);
      }
    } else if (a.type === "noul") {
      if (!isNum(a.noul)) bad.push(`answers.${key}.noul: expected a number`);
    }
  }
  return bad;
}

/**
 * Normalise OpenRouter's answers: they are Jev-shaped, except that a score's `probabilities` is an
 * object keyed by level index (`{"0": 0.01, ...}`), turned here into the per-level array a
 * normalised score's `distribution` is.
 */
export function normaliseOpenRouterAnswers(raw: Record<string, RawAnswer>, shapes: Record<string, QuestionShape>): Pick<AskResult, "answers" | "malformed"> {
  const answers: AskResult["answers"] = {};
  const malformed: string[] = [];
  for (const [key, shape] of Object.entries(shapes)) {
    let a = raw[key];
    if (shape.type === "score" && isObject(a) && isObject(a.probabilities) && shape.levels) {
      const byIndex = a.probabilities;
      const dist = Array.from({ length: shape.levels }, (_, i) => byIndex[String(i)]);
      a = { ...a, probabilities: dist.every(isNum) ? (dist as number[]) : undefined };
    }
    const answer = toAnswer(shape.type, a, shape.levels);
    if (answer) answers[key] = answer;
    else malformed.push(key);
  }
  return { answers, malformed };
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; metadata?: unknown };
}

export class OpenRouterModel implements DecisionModel {
  readonly id: DecisionModelId;
  readonly pricing: { inputPerM: number };
  /** The upstreams allowed (`only`), as configured. Not secret. */
  readonly routing: Readonly<OpenRouterRouting>;
  // A true private field: not enumerable, so JSON.stringify and inspect never show it.
  readonly #key: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly maxRetryAfterMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: OpenRouterOptions) {
    const cfg = OPENROUTER_MODELS[options.model];
    if (!cfg) {
      throw new Error(openRouterAliasHint(options.model) ?? `Unknown OpenRouter decision model "${options.model}" (known: ${Object.keys(OPENROUTER_MODELS).join(", ")})`);
    }
    if (!options.credentials.apiKey) throw new Error("OpenRouter needs an API key");
    const only = [...new Set(options.routing.only)];
    if (!only.length) throw new Error("OpenRouter needs at least one upstream in only: the upstreams allowed to receive card text");
    const badSlug = only.find((s) => !isUpstreamSlug(s));
    if (badSlug !== undefined) throw new Error(`"${badSlug.slice(0, 64)}" is not an OpenRouter provider slug (lowercase, e.g. cloudflare or deepinfra/fp8)`);
    this.routing = Object.freeze({ only, ...(options.routing.zdr ? { zdr: true } : {}) });
    this.id = { provider: OPENROUTER, model: options.model, canonicalModel: cfg.canonicalModel, ...(only.length === 1 ? { upstream: only[0] } : {}) };
    this.pricing = { inputPerM: cfg.inputPerM };
    this.#key = options.credentials.apiKey;
    this.fetchImpl = options.fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxAttempts = options.maxAttempts ?? 4;
    this.backoffMs = options.backoffMs ?? 1000;
    this.maxRetryAfterMs = options.maxRetryAfterMs ?? 60_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** The routing object for a request: the configured upstreams, or the one pinned. */
  wireRouting(upstream?: string): WireRouting {
    return {
      only: upstream ? [upstream] : [...this.routing.only],
      allow_fallbacks: false,
      data_collection: "deny",
      ...(this.routing.zdr ? { zdr: true as const } : {}),
    };
  }

  /** The exact request body sent for a state and questions. */
  requestBody(state: string, questions: Record<string, Question>, upstream?: string): string {
    return JSON.stringify({ model: this.id.model, state, questions, provider: this.wireRouting(upstream) });
  }

  normalise(raw: Record<string, RawAnswer>, shapes: Record<string, QuestionShape>): Pick<AskResult, "answers" | "malformed"> {
    return normaliseOpenRouterAnswers(raw, shapes);
  }

  async ask(state: string, questions: Record<string, Question>, options: AskOptions = {}): Promise<AskResult> {
    if (options.upstream !== undefined && !this.routing.only.includes(options.upstream)) {
      // Never widen the allowed upstreams, not even for a probe.
      throw new DecisionModelError("routing", `the upstream "${options.upstream.slice(0, 64)}" is not one of the configured upstreams (${this.routing.only.join(", ")})`);
    }
    const allowed = options.upstream ? [options.upstream] : this.routing.only;
    const body = this.requestBody(state, questions, options.upstream);
    let last: DecisionModelError | null = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (options.signal?.aborted || (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt)) throw cancelled();
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      const timedOut = (): DecisionModelError =>
        options.signal?.aborted ? cancelled() : new DecisionModelError("timeout", `OpenRouter request timed out: no answer within ${this.timeoutMs} ms`);
      let res: Response;
      try {
        res = await this.fetchImpl(OPENROUTER_DECISIONS_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.#key}`, "Content-Type": "application/json" },
          body,
          signal,
        });
      } catch (e) {
        if (signal.aborted || isAbort(e)) throw timedOut();
        throw new DecisionModelError("unavailable", `OpenRouter request failed: ${this.redact(messageOf(e))}`);
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        const text = await readBody(res, signal).catch(() => "");
        last = new DecisionModelError(res.status === 429 ? "rate-limit" : "unavailable", `OpenRouter HTTP ${res.status}: ${this.errorDetail(text)}`, {
          status: res.status,
          retryAfterMs,
        });
        if (attempt + 1 < this.maxAttempts) {
          const backoff = this.backoffMs * 2 ** attempt;
          const wait = retryAfterMs !== undefined ? Math.min(Math.max(retryAfterMs, 0), this.maxRetryAfterMs) : backoff;
          if (options.deadlineAt !== undefined && Date.now() + wait >= options.deadlineAt) throw last;
          await abortableWait(this.sleep, wait, options.signal, cancelled);
        }
        continue;
      }

      let text: string;
      try {
        text = await readBody(res, signal);
      } catch (e) {
        if (signal.aborted || isAbort(e)) throw timedOut();
        throw new DecisionModelError("unavailable", `OpenRouter response could not be read: ${this.redact(messageOf(e))}`, { status: res.status });
      }
      if (!res.ok) throw this.httpError(res.status, text, allowed);

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new DecisionModelError("malformed", `OpenRouter answered HTTP ${res.status} with a body that is not JSON`, { status: res.status });
      }
      const usage = isObject(json) && isObject(json.usage) ? json.usage : {};
      const inputTokens = isNum(usage.input_tokens) && usage.input_tokens > 0 ? usage.input_tokens : 0;
      const costUsd = isNum(usage.cost) && usage.cost >= 0 ? usage.cost : (inputTokens * this.pricing.inputPerM) / 1e6;
      // A 200 that can't be used was billed all the same: carry what it says it cost.
      const billed = { inputTokens, costUsd };
      const bad = checkShape(json, questions);
      if (bad.length) {
        throw new DecisionModelError("api", `OpenRouter's Decisions API answered in a shape this version of DR doesn't read (it is in alpha and may have changed): ${this.redact(bad.slice(0, 5).join("; "))}`, {
          status: res.status,
          billed,
        });
      }
      const ok = json as { provider: string; model: string; answers: Record<string, RawAnswer>; usage: { output_tokens?: unknown } };
      if (!upstreamAllowed(ok.provider, allowed)) {
        throw new DecisionModelError(
          "routing",
          `OpenRouter served the request from ${JSON.stringify(ok.provider.slice(0, 64))}, which is not among the allowed upstreams (${allowed.join(", ")}); Tier 1 stopped`,
          { status: res.status, billed }
        );
      }
      const raw: Record<string, RawAnswer> = {};
      for (const key of Object.keys(questions)) if (ok.answers[key] !== undefined) raw[key] = ok.answers[key];
      const { answers, malformed } = this.normalise(raw, shapesOf(questions));
      return {
        answers,
        malformed,
        raw,
        usage: { inputTokens, outputTokens: isNum(ok.usage.output_tokens) ? ok.usage.output_tokens : 0, costUsd },
        servedBy: { upstream: ok.provider, model: ok.model },
      };
    }
    throw last ?? new DecisionModelError("unavailable", "OpenRouter request failed");
  }

  /** A typed error for a 4xx (other than 429). */
  private httpError(status: number, text: string, allowed: readonly string[]): DecisionModelError {
    const detail = this.errorDetail(text);
    if (status === 401 || status === 403) return new DecisionModelError("auth", `OpenRouter refused the key (HTTP ${status}): ${detail}`, { status });
    if (status === 402) return new DecisionModelError("auth", `OpenRouter HTTP 402, insufficient credits: ${detail}`, { status });
    if (status === 404) {
      return new DecisionModelError(
        "routing",
        `OpenRouter HTTP 404: no allowed upstream (${allowed.join(", ")}) serves ${this.id.model} with data_collection "deny"${this.routing.zdr ? " and zdr" : ""}: ${detail}`,
        { status }
      );
    }
    return new DecisionModelError("bad-request", `OpenRouter error HTTP ${status}: ${detail}`, { status });
  }

  /** OpenRouter's error message (and the upstream it names), redacted and shortened; never the whole body. */
  private errorDetail(text: string): string {
    let body: ErrorBody | null = null;
    try {
      body = JSON.parse(text) as ErrorBody;
    } catch {
      body = null;
    }
    const err = body && isObject(body.error) ? body.error : null;
    if (err) {
      const message = typeof err.message === "string" ? err.message : "(no message)";
      const upstream = isObject(err.metadata) && typeof err.metadata.provider_name === "string" ? ` (upstream ${err.metadata.provider_name})` : "";
      return this.redact(`${message}${upstream}`).slice(0, 300);
    }
    return this.redact(text).slice(0, 300);
  }

  /**
   * Strip the API key, any other OpenRouter key, generation ids and user ids from text that can
   * reach run output, notices and probe flags.
   */
  redact(text: string): string {
    let out = this.#key ? text.split(this.#key).join("[redacted]") : text;
    out = out.replace(/sk-or-[A-Za-z0-9_-]{8,}/g, "[redacted key]");
    out = out.replace(/\bgen-[A-Za-z0-9_-]{6,}/g, "[generation id]");
    out = out.replace(/("?user_id"?\s*[:=]\s*"?)[^",}\s]+/g, "$1[redacted]");
    return out;
  }

  /** Never shows the key: not in JSON, not in inspect. */
  toJSON(): { id: DecisionModelId; pricing: { inputPerM: number }; routing: Readonly<OpenRouterRouting> } {
    return { id: this.id, pricing: this.pricing, routing: this.routing };
  }
}

function cancelled(): DecisionModelError {
  return new DecisionModelError("timeout", "OpenRouter request cancelled: the run's deadline passed");
}

export function createOpenRouterModel(options: OpenRouterOptions): OpenRouterModel {
  return new OpenRouterModel(options);
}
