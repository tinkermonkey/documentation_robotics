/**
 * Asking one card: the two stages of the current question set against a {@link DecisionModel}.
 * This is the part of the run loop the classify-eval harness measures today; the loop itself
 * (cache, budget, pool, deadline, circuit breaker, spend) is rollout PR 3.
 *
 * Everything here reads answers normalised by the adapter (`AskResult.answers`, or a cache entry
 * through `normaliseEntry`), never a provider's raw shape.
 */
import { cacheKey } from "./cache.js";
import { criteriaDigest, NONE_OPTION, type SpecCriteria } from "./criteria.js";
import { shapesOf, type Answer, type AskOptions, type AskResult, type DecisionModel, type Question, type QuestionShape, type RawAnswer } from "./decision-model/types.js";
import type { BandInput } from "./bands.js";
import { CURRENT_QSET_ID, qsetById, qsetVariantId, type Narrowing } from "./qset/index.js";

export interface CardQuery {
  /** The question set (`dr-qset-2`); the current one when absent. */
  qset?: string;
  /** The rendered state: the same question set's `stateOf(card)`. */
  state: string;
  /** The CBM symbol kind (`Class`, `Function`, ...), for the kind rule. */
  kind?: string;
  /** Tier 0's narrowing, when a rule narrowed the card. */
  narrow?: Narrowing;
  /** The kind rule; on in every question set (default true). Off only for harness variants. */
  kindNarrow?: boolean;
}

export interface StageAsk {
  questions: Record<string, Question>;
  result: AskResult;
}

export interface CardAsk {
  /** The question set id for what was sent, variant included (derived from the query, not trusted from the caller). */
  qset: string;
  stage1: StageAsk;
  /** The layer stage 1 chose (the option the provider named, else the most probable), or null. */
  layer: string | null;
  /** Stage 2, when the layer isn't `none` and at least two type options remain. */
  stage2?: StageAsk & { layer: string };
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  servedBy: { upstream?: string; model?: string };
}

/**
 * The question set id for a query: its question set (the current one, `dr-qset-2`, when the query
 * names none), or a variant when the options change what is sent (`dr-qset-2+no-kind`,
 * `dr-qset-2+core`). Derived from the same inputs `askCard` builds the questions from, so a cache
 * key can't disagree with the request. The state is the caller's: it must be the same question
 * set's `stateOf(card)` (tying the two together in `askCard` is rollout PR 3).
 */
export function qsetOf(query: Pick<CardQuery, "kindNarrow" | "qset">, spec: Pick<SpecCriteria, "mode">): string {
  const base = qsetById(query.qset ?? CURRENT_QSET_ID).QSET_ID;
  return qsetVariantId({ noKindNarrow: query.kindNarrow === false, criteria: spec.mode }, base);
}

/** The cache key of a query: everything the model is sent (section 4.1), derived from the query itself. */
export function cardCacheKey(query: CardQuery, spec: SpecCriteria, model: { canonicalModel: string; host: string }): string {
  return cacheKey({
    qset: qsetOf(query, spec),
    canonicalModel: model.canonicalModel,
    host: model.host,
    criteriaDigest: criteriaDigest(spec),
    narrowing: qsetById(query.qset ?? CURRENT_QSET_ID).narrowingKey(query.narrow),
    state: query.state,
  });
}

/** The chosen option of a normalised choice answer: the named one, else the most probable. */
export function chosenOf(answer: Answer | undefined): string | null {
  if (!answer || answer.type !== "choice") return null;
  if (answer.choice) return answer.choice;
  let best: string | null = null;
  let bestP = -Infinity;
  for (const [option, p] of Object.entries(answer.probabilities)) {
    if (p > bestP) {
      best = option;
      bestP = p;
    }
  }
  return best;
}

/** Ask a card's two stages of the query's question set. Provider errors propagate as `DecisionModelError`s. */
export async function askCard(model: DecisionModel, spec: SpecCriteria, query: CardQuery, options: AskOptions = {}): Promise<CardAsk> {
  const kindNarrow = query.kindNarrow ?? true;
  const qset = qsetById(query.qset ?? CURRENT_QSET_ID);
  const q1 = qset.stage1Questions(spec, query.narrow);
  const r1 = await model.ask(query.state, q1, options);
  const layer = chosenOf(r1.answers.layer);
  const usage = { inputTokens: r1.usage.inputTokens, outputTokens: r1.usage.outputTokens ?? 0, costUsd: costOf(model, r1) };
  const out: CardAsk = { qset: qsetOf({ kindNarrow, qset: qset.QSET_ID }, spec), stage1: { questions: q1, result: r1 }, layer, usage, servedBy: { ...r1.servedBy } };
  if (layer && layer !== NONE_OPTION) {
    const q2 = qset.stage2Questions(spec, layer, query.kind, kindNarrow, query.narrow);
    if (qset.asksStage2(layer, q2)) {
      const r2 = await model.ask(query.state, q2, options);
      out.stage2 = { layer, questions: q2, result: r2 };
      usage.inputTokens += r2.usage.inputTokens;
      usage.outputTokens += r2.usage.outputTokens ?? 0;
      usage.costUsd += costOf(model, r2);
      out.servedBy = { ...out.servedBy, ...r2.servedBy };
    }
  }
  return out;
}

function costOf(model: DecisionModel, r: AskResult): number {
  return r.usage.costUsd ?? (r.usage.inputTokens * model.pricing.inputPerM) / 1e6;
}

/** The raw answers of a card's stages and the question shapes they answer: what the cache stores. */
export interface RawStage {
  shapes: Record<string, QuestionShape>;
  /** Stage 2's layer. */
  layer?: string;
  raw: Record<string, RawAnswer>;
}

/** A stage's normalised answers (from `AskResult.answers`, or a cache entry through `normaliseEntry`). */
export interface AnsweredStage {
  /** Stage 2's layer. */
  layer?: string;
  answers: Record<string, Answer>;
}

export function rawStagesOf(ask: CardAsk): RawStage[] {
  const stages: RawStage[] = [{ shapes: shapesOf(ask.stage1.questions), raw: ask.stage1.result.raw }];
  if (ask.stage2) stages.push({ shapes: shapesOf(ask.stage2.questions), layer: ask.stage2.layer, raw: ask.stage2.result.raw });
  return stages;
}

export function answeredStagesOf(ask: CardAsk): AnsweredStage[] {
  const stages: AnsweredStage[] = [{ answers: ask.stage1.result.answers }];
  if (ask.stage2) stages.push({ layer: ask.stage2.layer, answers: ask.stage2.result.answers });
  return stages;
}

/** What {@link bandOf} needs, from a card's normalised stage answers; null when the layer went unanswered. */
export function bandInputOf(stages: AnsweredStage[]): BandInput | null {
  const s1 = stages[0];
  if (!s1) return null;
  const layerAnswer = s1.answers.layer;
  const layer = chosenOf(layerAnswer);
  if (!layer || layerAnswer?.type !== "choice") return null;
  const layerP = layerAnswer.probabilities[layer];
  if (typeof layerP !== "number") return null;
  const s2 = stages.find((s) => s.layer !== undefined);
  if (!s2 || layer === NONE_OPTION) return { layer, layerP, type: null, typeP: null };
  const typeAnswer = s2.answers.element_type;
  const type = chosenOf(typeAnswer);
  const typeP = type && typeAnswer?.type === "choice" ? typeAnswer.probabilities[type] : undefined;
  return {
    layer,
    layerP,
    type: type && type !== NONE_OPTION ? type : null,
    typeP: typeof typeP === "number" ? typeP : null,
  };
}
