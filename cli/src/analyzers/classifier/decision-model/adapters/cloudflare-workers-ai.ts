/**
 * Cloudflare Workers AI adapter: Clef and Clef-flash (`@cf/cloudflare/clef`, `@cf/cloudflare/clef-flash`).
 *
 * The classify-eval harness's `callClef`, ported as is: the same URL, headers and body
 * (`{ model, state, questions }`, the Jev shape), the wrapped (`result.answers`) and unwrapped
 * (`answers`) responses, and four attempts with 1, 2, 4, 8 s backoff on 429 and 5xx. Added for
 * production use: `Retry-After` is honoured, 400/401/403 fail at once, a per-request timeout, typed
 * {@link DecisionModelError}s, and the API token never appears in an error message.
 *
 * `fetch` is injected: tests pass a fake and never reach the network.
 */
import { normaliseJevAnswers } from "../jev-answers.js";
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

export const CLOUDFLARE_WORKERS_AI = "cloudflare-workers-ai";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The models this adapter serves: provider id, the `model` field the API expects, price per million input tokens. */
export const WORKERS_AI_MODELS: Record<string, { id: string; wireModel: string; canonicalModel: string; inputPerM: number }> = {
  clef: { id: "@cf/cloudflare/clef", wireModel: "clef", canonicalModel: "clef", inputPerM: 0.24 },
  "clef-flash": { id: "@cf/cloudflare/clef-flash", wireModel: "clef-flash", canonicalModel: "clef-flash", inputPerM: 0.09 },
};

export interface WorkersAiCredentials {
  accountId: string;
  apiToken: string;
}

export interface WorkersAiOptions {
  /** `clef`, `clef-flash`, or the provider id (`@cf/cloudflare/clef`). */
  model: string;
  credentials: WorkersAiCredentials;
  fetch: FetchLike;
  /** Per request; default 20 s (TIER1_DESIGN.md section 4.5). */
  timeoutMs?: number;
  /** Attempts on 429 and 5xx; default 4, as the harness. */
  maxAttempts?: number;
  /** Backoff base: attempt n waits base * 2^n ms unless Retry-After says otherwise; default 1000. */
  backoffMs?: number;
  /** Longest Retry-After honoured; default 60 s. */
  maxRetryAfterMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

interface WorkersAiResponse {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: { model?: string; answers?: Record<string, RawAnswer>; usage?: { input_tokens?: number; output_tokens?: number } };
  // some deployments return the result unwrapped
  answers?: Record<string, RawAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
}

export function workersAiModelOf(model: string): (typeof WORKERS_AI_MODELS)[string] | undefined {
  return WORKERS_AI_MODELS[model] ?? Object.values(WORKERS_AI_MODELS).find((m) => m.id === model);
}

/** Milliseconds from a Retry-After header (seconds or an HTTP date), or undefined. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

export class CloudflareWorkersAiModel implements DecisionModel {
  readonly id: DecisionModelId;
  readonly pricing: { inputPerM: number };
  private readonly wireModel: string;
  private readonly url: string;
  // A true private field: not enumerable, so JSON.stringify and inspect never show it.
  readonly #token: string;
  readonly #accountId: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly maxRetryAfterMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: WorkersAiOptions) {
    const cfg = workersAiModelOf(options.model);
    if (!cfg) throw new Error(`Unknown Workers AI decision model "${options.model}" (known: ${Object.keys(WORKERS_AI_MODELS).join(", ")})`);
    if (!options.credentials.accountId || !options.credentials.apiToken) {
      throw new Error("Workers AI needs an account id and an API token");
    }
    this.id = { provider: CLOUDFLARE_WORKERS_AI, model: cfg.id, canonicalModel: cfg.canonicalModel };
    this.pricing = { inputPerM: cfg.inputPerM };
    this.wireModel = cfg.wireModel;
    this.url = `https://api.cloudflare.com/client/v4/accounts/${options.credentials.accountId}/ai/run/${cfg.id}`;
    this.#token = options.credentials.apiToken;
    this.#accountId = options.credentials.accountId;
    this.fetchImpl = options.fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxAttempts = options.maxAttempts ?? 4;
    this.backoffMs = options.backoffMs ?? 1000;
    this.maxRetryAfterMs = options.maxRetryAfterMs ?? 60_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** The exact request body sent for a state and questions (the Jev shape). */
  requestBody(state: string, questions: Record<string, Question>): string {
    return JSON.stringify({ model: this.wireModel, state, questions });
  }

  normalise(raw: Record<string, RawAnswer>, shapes: Record<string, QuestionShape>): Pick<AskResult, "answers" | "malformed"> {
    return normaliseJevAnswers(raw, shapes);
  }

  async ask(state: string, questions: Record<string, Question>, options: AskOptions = {}): Promise<AskResult> {
    const body = this.requestBody(state, questions);
    let last: DecisionModelError | null = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (options.signal?.aborted || (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt)) throw cancelled();
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      // Any failure once a signal fired is a timeout, whatever the fetch threw (a caller's custom
      // abort reason included).
      const timedOut = (): DecisionModelError =>
        options.signal?.aborted ? cancelled() : new DecisionModelError("timeout", `Workers AI request timed out: no answer within ${this.timeoutMs} ms`);
      let res: Response;
      try {
        res = await this.fetchImpl(this.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.#token}`, "Content-Type": "application/json" },
          body,
          signal,
        });
      } catch (e) {
        if (signal.aborted || isAbort(e)) throw timedOut();
        throw new DecisionModelError("unavailable", `Workers AI request failed: ${this.redact(messageOf(e))}`);
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        const text = await readBody(res, signal).catch(() => "");
        last = new DecisionModelError(res.status === 429 ? "rate-limit" : "unavailable", `Workers AI HTTP ${res.status}: ${this.redact(text.slice(0, 300))}`, {
          status: res.status,
          retryAfterMs,
        });
        if (attempt + 1 < this.maxAttempts) {
          const backoff = this.backoffMs * 2 ** attempt;
          const wait = retryAfterMs !== undefined ? Math.min(Math.max(retryAfterMs, 0), this.maxRetryAfterMs) : backoff;
          // A wait that would end past the deadline isn't started: the last error stands.
          if (options.deadlineAt !== undefined && Date.now() + wait >= options.deadlineAt) throw last;
          await this.wait(wait, options.signal);
        }
        continue;
      }

      let text: string;
      try {
        text = await readBody(res, signal);
      } catch (e) {
        if (signal.aborted || isAbort(e)) throw timedOut();
        throw new DecisionModelError("unavailable", `Workers AI response could not be read: ${this.redact(messageOf(e))}`, { status: res.status });
      }
      let json: WorkersAiResponse | null = null;
      try {
        json = JSON.parse(text) as WorkersAiResponse;
      } catch {
        json = null;
      }
      if (!res.ok) {
        const detail = this.redact(JSON.stringify(json?.errors ?? json ?? text).slice(0, 500));
        const kind = res.status === 401 || res.status === 403 ? "auth" : "bad-request";
        throw new DecisionModelError(kind, `Workers AI error HTTP ${res.status}: ${detail}`, { status: res.status });
      }
      if (!json || typeof json !== "object") {
        throw new DecisionModelError("malformed", `Workers AI answered HTTP ${res.status} with a body that is not JSON`, { status: res.status });
      }
      const usage = json.result?.usage ?? json.usage ?? {};
      const inputTokens = typeof usage.input_tokens === "number" && usage.input_tokens > 0 ? usage.input_tokens : 0;
      // A 200 that can't be used may still have been billed: carry what the response says it used.
      const billed = { inputTokens, costUsd: (inputTokens * this.pricing.inputPerM) / 1e6 };
      if (json.success === false) {
        throw new DecisionModelError("malformed", `Workers AI error HTTP ${res.status}: ${this.redact(JSON.stringify(json.errors ?? json).slice(0, 500))}`, {
          status: res.status,
          billed,
        });
      }
      const raw = json.result?.answers ?? json.answers ?? {};
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new DecisionModelError("malformed", "Workers AI answered without an answers object", { status: res.status, billed });
      }
      const { answers, malformed } = this.normalise(raw, shapesOf(questions));
      const servedModel = json.result?.model ?? json.model;
      return {
        answers,
        malformed,
        raw,
        usage: { inputTokens, outputTokens: usage.output_tokens ?? 0, costUsd: (inputTokens * this.pricing.inputPerM) / 1e6 },
        servedBy: servedModel ? { model: servedModel } : {},
      };
    }
    throw last ?? new DecisionModelError("unavailable", "Workers AI request failed");
  }

  /**
   * Strip the API token from text that may echo the request, and shorten the account id to its
   * last four characters (Cloudflare's errors echo the URL, `/accounts/<id>/`): these messages
   * reach run output, notices and probe flags.
   */
  private redact(text: string): string {
    let out = this.#token ? text.split(this.#token).join("[redacted]") : text;
    if (this.#accountId.length > 4) out = out.split(this.#accountId).join(`…${this.#accountId.slice(-4)}`);
    return out;
  }

  /** A retry wait the caller's signal cuts short (as a timeout error). */
  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return this.sleep(ms);
    if (signal.aborted) return Promise.reject(cancelled());
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(cancelled());
      signal.addEventListener("abort", onAbort, { once: true });
      this.sleep(ms).then(
        () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        },
        (e) => {
          signal.removeEventListener("abort", onAbort);
          reject(e);
        }
      );
    });
  }

  /** Never shows the token: not in JSON, not in inspect. */
  toJSON(): { id: DecisionModelId; pricing: { inputPerM: number } } {
    return { id: this.id, pricing: this.pricing };
  }
}

function cancelled(): DecisionModelError {
  return new DecisionModelError("timeout", "Workers AI request cancelled: the run's deadline passed");
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The body as text; rejects if the signal fires while it is read. */
function readBody(res: Response, signal: AbortSignal): Promise<string> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    res.text().then(
      (t) => {
        signal.removeEventListener("abort", onAbort);
        resolve(t);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}

export function createCloudflareWorkersAiModel(options: WorkersAiOptions): CloudflareWorkersAiModel {
  return new CloudflareWorkersAiModel(options);
}
