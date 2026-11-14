/**
 * A scripted {@link DecisionModel} for Tier-1 tests: answers by state hash and question key, a
 * call log, and injectable failures (429, 5xx, timeout, auth, malformed, routing). No network.
 */
import { createHash } from "node:crypto";
import {
  DecisionModelError,
  normaliseJevAnswers,
  shapesOf,
  type AskOptions,
  type AskResult,
  type DecisionModel,
  type DecisionModelErrorKind,
  type DecisionModelId,
  type Question,
  type QuestionShape,
  type RawAnswer,
} from "../../src/analyzers/classifier/index.js";

export type FakeFailure = "rate-limit" | "unavailable" | "timeout" | "auth" | "malformed" | "routing" | "bad-request";

export interface FakeCall {
  state: string;
  stateHash: string;
  questions: Record<string, Question>;
  options: AskOptions;
}

/** A raw (Jev-shaped) answer for a question, or a function of the question computing one. */
export type ScriptedAnswer = RawAnswer | ((question: Question, key: string) => RawAnswer);

export function stateHashOf(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/** A choice answer putting `p` on `choice` and spreading the rest over the other options. */
export function choiceAnswer(choice: string, p = 0.9): (q: Question) => RawAnswer {
  return (q) => {
    const keys = q.type === "choice" ? Object.keys(q.criteria) : [choice];
    const others = keys.filter((k) => k !== choice);
    const rest = others.length ? (1 - p) / others.length : 0;
    return { choice, probabilities: Object.fromEntries(keys.map((k) => [k, k === choice ? p : rest])) };
  };
}

export class FakeDecisionModel implements DecisionModel {
  readonly id: DecisionModelId;
  readonly pricing = { inputPerM: 0.24 };
  readonly calls: FakeCall[] = [];
  /** Answers by state hash, then question key; `*` matches any state. */
  private readonly script = new Map<string, Record<string, ScriptedAnswer>>();
  private readonly failures: FakeFailure[] = [];
  inputTokensPerCall = 1000;

  constructor(id: Partial<DecisionModelId> = {}) {
    this.id = { provider: "fake", model: "fake/clef", canonicalModel: "clef", ...id };
  }

  /** Script answers for a state (or `*` for every state). */
  answer(state: string | "*", answers: Record<string, ScriptedAnswer>): this {
    const k = state === "*" ? "*" : stateHashOf(state);
    this.script.set(k, { ...(this.script.get(k) ?? {}), ...answers });
    return this;
  }

  /** The next calls fail, one failure each, in order. */
  failNext(...failures: FakeFailure[]): this {
    this.failures.push(...failures);
    return this;
  }

  normalise(raw: Record<string, RawAnswer>, shapes: Record<string, QuestionShape>): Pick<AskResult, "answers" | "malformed"> {
    return normaliseJevAnswers(raw, shapes);
  }

  async ask(state: string, questions: Record<string, Question>, options: AskOptions = {}): Promise<AskResult> {
    const stateHash = stateHashOf(state);
    this.calls.push({ state, stateHash, questions, options });
    const failure = this.failures.shift();
    if (failure) throw failureError(failure);
    const scripted = { ...(this.script.get("*") ?? {}), ...(this.script.get(stateHash) ?? {}) };
    const raw: Record<string, RawAnswer> = {};
    for (const [key, q] of Object.entries(questions)) {
      const s = scripted[key];
      if (s === undefined) continue;
      raw[key] = typeof s === "function" ? s(q, key) : s;
    }
    if (this.malformedNext) {
      this.malformedNext = false;
      for (const k of Object.keys(raw)) raw[k] = { garbage: true };
    }
    const { answers, malformed } = this.normalise(raw, shapesOf(questions));
    return {
      answers,
      malformed,
      raw,
      usage: { inputTokens: this.inputTokensPerCall, outputTokens: 0, costUsd: (this.inputTokensPerCall * this.pricing.inputPerM) / 1e6 },
      servedBy: this.id.upstream ? { upstream: this.id.upstream, model: this.id.model } : { model: this.id.model },
    };
  }

  /** The next call returns unreadable answers (every question malformed) instead of throwing. */
  malformedNext = false;
}

function failureError(kind: FakeFailure): DecisionModelError {
  const status: Partial<Record<DecisionModelErrorKind, number>> = { "rate-limit": 429, unavailable: 503, auth: 401, "bad-request": 400 };
  return new DecisionModelError(kind, `fake ${kind}`, { status: status[kind], retryAfterMs: kind === "rate-limit" ? 1000 : undefined });
}
