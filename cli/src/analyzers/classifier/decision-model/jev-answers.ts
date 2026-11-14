/**
 * Reading Jev-shaped answers (Clef on Workers AI answers in this shape). `choiceOf`, `noulOf` and
 * `scoreOf` are the classify-eval harness's parsers, ported as is: the harness keeps using them on
 * raw answers so its predictions stay comparable with the committed ones. `toAnswer` builds the
 * normalised {@link Answer} from them.
 */
import type { Answer, AskResult, QuestionShape, QuestionType, RawAnswer } from "./types.js";

/** The fields a Jev-shaped answer may carry; providers differ in which they fill. */
export interface JevAnswer {
  type?: string;
  choice?: string;
  answer?: string;
  probabilities?: Record<string, number> | number[];
  distribution?: number[];
  confidence?: number;
  score?: number;
  noul?: number;
  probability?: number;
  value?: unknown;
  [k: string]: unknown;
}

export function choiceOf(a: JevAnswer | undefined): { choice: string | null; probabilities: Record<string, number>; confidence: number | null } {
  if (!a) return { choice: null, probabilities: {}, confidence: null };
  const probs = a.probabilities && !Array.isArray(a.probabilities) ? a.probabilities : {};
  let choice = typeof a.choice === "string" ? a.choice : typeof a.answer === "string" ? a.answer : typeof a.value === "string" ? a.value : null;
  if (!choice && Object.keys(probs).length) choice = Object.entries(probs).sort((x, y) => y[1] - x[1])[0][0];
  return { choice, probabilities: probs, confidence: typeof a.confidence === "number" ? a.confidence : null };
}

export function noulOf(a: JevAnswer | undefined): number {
  if (!a) return NaN;
  for (const k of ["noul", "probability", "value", "score"]) {
    const v = a[k];
    if (typeof v === "number") return v;
  }
  return NaN;
}

export function scoreOf(a: JevAnswer | undefined, levels: number): { score: number; probabilities: number[] | null } {
  if (!a) return { score: NaN, probabilities: null };
  const dist = Array.isArray(a.probabilities) ? a.probabilities : Array.isArray(a.distribution) ? a.distribution : null;
  let score = typeof a.score === "number" ? a.score : typeof a.value === "number" ? a.value : NaN;
  if (Number.isNaN(score) && dist) score = dist.reduce((acc, p, i) => acc + p * i, 0);
  // If the model reports an index on a 1..N scale, normalize to 0..N-1
  if (!Number.isNaN(score) && dist == null && score >= levels) score = levels - 1;
  return { score, probabilities: dist };
}

/** True when the provider marked the answer as a refusal rather than an answer. */
export function isRefusal(a: JevAnswer | undefined): boolean {
  return !!a && (a.type === "refusal" || typeof a.refusal === "string" || a.refusal === true);
}

/**
 * The normalised answer to a question of type `type`, or null when the raw answer is missing or
 * can't be read. `levels` is the number of levels of a score question (to clamp a 1..N score).
 */
export function toAnswer(type: QuestionType, raw: RawAnswer | undefined, levels?: number): Answer | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as JevAnswer;
  if (isRefusal(a)) return { type: "refusal" };
  switch (type) {
    case "choice": {
      const { probabilities } = choiceOf(a);
      const entries = Object.entries(probabilities);
      if (!entries.length || entries.some(([, p]) => typeof p !== "number" || !Number.isFinite(p))) return null;
      return { type: "choice", probabilities: { ...probabilities } };
    }
    case "score": {
      const { score, probabilities } = scoreOf(a, levels ?? Number.POSITIVE_INFINITY);
      if (!Number.isFinite(score)) return null;
      return { type: "score", score, distribution: probabilities ? [...probabilities] : null };
    }
    case "noul": {
      const p = noulOf(a);
      if (!Number.isFinite(p)) return null;
      return { type: "noul", probability: p };
    }
  }
}

/**
 * Normalise a set of raw answers given the shape of each question. Questions without a readable
 * answer are listed in `malformed`.
 */
export function normaliseJevAnswers(raw: Record<string, RawAnswer>, shapes: Record<string, QuestionShape>): Pick<AskResult, "answers" | "malformed"> {
  const answers: AskResult["answers"] = {};
  const malformed: string[] = [];
  for (const [key, shape] of Object.entries(shapes)) {
    const a = toAnswer(shape.type, raw[key], shape.levels);
    if (a) answers[key] = a;
    else malformed.push(key);
  }
  return { answers, malformed };
}
