/**
 * The provider-agnostic decision-model interface Tier 1 talks to (docs/analyzers/TIER1_DESIGN.md,
 * section 3.1). The request is the Jev shape: one state and a set of named questions. Adapters
 * (`adapters/`) turn a provider's wire format into {@link Answer}s, so nothing outside
 * `decision-model/` sees one.
 */

export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string };

export type QuestionType = Question["type"];

/** What normalising an answer needs to know about its question: the type, and a score's level count. */
export interface QuestionShape {
  type: QuestionType;
  levels?: number;
}

export function shapeOf(question: Question): QuestionShape {
  return question.type === "score" ? { type: "score", levels: question.criteria.length } : { type: question.type };
}

export function shapesOf(questions: Record<string, Question>): Record<string, QuestionShape> {
  return Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, shapeOf(q)]));
}

/**
 * A normalised answer.
 *
 * `score` departs from the design's `{ distribution: number[] }`: Clef answers a score question
 * with the expected level only (no per-level distribution), so `score` is always there and
 * `distribution` only when the provider sends one.
 */
export type Answer =
  // over the criteria keys; `choice`: the option the provider named, else the most probable one
  | { type: "choice"; probabilities: Record<string, number>; choice?: string }
  | { type: "score"; score: number; distribution: number[] | null } // score on the 0..N-1 scale
  | { type: "noul"; probability: number } // P(yes)
  | { type: "refusal" };

/** An answer as the provider sent it, before normalisation (what the cache stores). */
export type RawAnswer = Record<string, unknown>;

export interface DecisionModelId {
  /** "cloudflare-workers-ai" (and, later, "openrouter"). */
  provider: string;
  /** The provider's model id: "@cf/cloudflare/clef". */
  model: string;
  /** What thresholds key on: "clef", "clef-flash". */
  canonicalModel: string;
  /** OpenRouter: the pinned upstream, when exactly one is allowed. */
  upstream?: string;
}

export interface AskOptions {
  /** The caller's deadline as a signal; the adapter adds its own per-request timeout. */
  signal?: AbortSignal;
  /**
   * The caller's deadline as a time (epoch ms). A retry wait that would end past it isn't started:
   * the adapter gives up with the last error instead.
   */
  deadlineAt?: number;
  /** Pin one request to an upstream (probes); providers without upstreams ignore it. */
  upstream?: string;
}

export interface AskResult {
  /** Normalised answers, one per question that had a readable answer. */
  answers: Record<string, Answer>;
  /** Question keys whose answer was missing or could not be read. */
  malformed: string[];
  /** The answers as the provider sent them, keyed like the questions (cached raw, section 4.1). */
  raw: Record<string, RawAnswer>;
  usage: { inputTokens: number; outputTokens?: number; costUsd?: number };
  servedBy: { upstream?: string; model?: string };
}

export interface DecisionModel {
  readonly id: DecisionModelId;
  readonly pricing: { inputPerM: number };
  ask(state: string, questions: Record<string, Question>, options?: AskOptions): Promise<AskResult>;
  /**
   * Normalise answers the way {@link ask} does, from raw answers (a cache entry) and the shapes of
   * the questions they answer, so a fix to an adapter's parsing applies to cached entries too.
   */
  normalise(raw: Record<string, RawAnswer>, shapes: Record<string, QuestionShape>): Pick<AskResult, "answers" | "malformed">;
}

export type DecisionModelErrorKind =
  | "auth"
  | "rate-limit"
  | "unavailable"
  | "bad-request"
  | "timeout"
  | "malformed"
  | "routing";

/** Usage a failed call was billed for anyway (a stage that answered before another failed, or a 200 that couldn't be read). */
export interface BilledUsage {
  inputTokens: number;
  costUsd: number;
}

export class DecisionModelError extends Error {
  readonly kind: DecisionModelErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  /** What the failed call was billed for, when the provider said: spend that must still be recorded. */
  billed?: BilledUsage;

  constructor(kind: DecisionModelErrorKind, message: string, options: { status?: number; retryAfterMs?: number; cause?: unknown; billed?: BilledUsage } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DecisionModelError";
    this.kind = kind;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    if (options.billed && (options.billed.inputTokens > 0 || options.billed.costUsd > 0)) this.billed = { ...options.billed };
  }
}

/** Add usage already billed to an error (kept on a DecisionModelError, wrapping anything else as `unavailable`). */
export function withBilled(e: unknown, billed: BilledUsage): DecisionModelError {
  const err = e instanceof DecisionModelError ? e : new DecisionModelError("unavailable", e instanceof Error ? e.message : String(e), { cause: e });
  if (billed.inputTokens > 0 || billed.costUsd > 0) {
    err.billed = { inputTokens: (err.billed?.inputTokens ?? 0) + billed.inputTokens, costUsd: (err.billed?.costUsd ?? 0) + billed.costUsd };
  }
  return err;
}
