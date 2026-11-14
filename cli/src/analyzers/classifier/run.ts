/**
 * Asking one card: the two stages of the current question set against a {@link DecisionModel}.
 * This is the part of the run loop the classify-eval harness measures today; the loop itself
 * (cache, budget, pool, deadline, circuit breaker, spend) is rollout PR 3.
 */
import { NONE_OPTION, type SpecCriteria } from "./criteria.js";
import { choiceOf } from "./decision-model/jev-answers.js";
import { shapesOf, type AskOptions, type AskResult, type DecisionModel, type Question, type QuestionShape, type RawAnswer } from "./decision-model/types.js";
import type { BandInput } from "./bands.js";
import { v1, type Narrowing } from "./qset/index.js";

export interface CardQuery {
  /** The rendered state (`v1.stateOf(card)`). */
  state: string;
  /** The CBM symbol kind (`Class`, `Function`, ...), for the kind rule. */
  kind?: string;
  /** Tier 0's narrowing, when a rule narrowed the card. */
  narrow?: Narrowing;
  /** The kind rule; on in dr-qset-1. Off only for harness variants. */
  kindNarrow?: boolean;
}

export interface StageAsk {
  questions: Record<string, Question>;
  result: AskResult;
}

export interface CardAsk {
  stage1: StageAsk;
  /** The layer stage 1 chose, read as the harness reads it (`choiceOf`), or null. */
  layer: string | null;
  /** Stage 2, when the layer isn't `none` and at least two type options remain. */
  stage2?: StageAsk & { layer: string };
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  servedBy: { upstream?: string; model?: string };
}

/** Ask a card's two stages (dr-qset-1). Provider errors propagate as `DecisionModelError`s. */
export async function askCard(model: DecisionModel, spec: SpecCriteria, query: CardQuery, options: AskOptions = {}): Promise<CardAsk> {
  const kindNarrow = query.kindNarrow ?? true;
  const q1 = v1.stage1Questions(spec, query.narrow);
  const r1 = await model.ask(query.state, q1, options);
  const layer = choiceOf(r1.raw.layer).choice;
  const usage = { inputTokens: r1.usage.inputTokens, outputTokens: r1.usage.outputTokens ?? 0, costUsd: costOf(model, r1) };
  const out: CardAsk = { stage1: { questions: q1, result: r1 }, layer, usage, servedBy: { ...r1.servedBy } };
  if (layer && layer !== NONE_OPTION) {
    const q2 = v1.stage2Questions(spec, layer, query.kind, kindNarrow, query.narrow);
    if (v1.asksStage2(layer, q2)) {
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

export function rawStagesOf(ask: CardAsk): RawStage[] {
  const stages: RawStage[] = [{ shapes: shapesOf(ask.stage1.questions), raw: ask.stage1.result.raw }];
  if (ask.stage2) stages.push({ shapes: shapesOf(ask.stage2.questions), layer: ask.stage2.layer, raw: ask.stage2.result.raw });
  return stages;
}

/** What {@link bandOf} needs, from a card's raw stage answers (read as the harness reads them). */
export function bandInputOf(stages: RawStage[]): BandInput | null {
  const s1 = stages[0];
  if (!s1) return null;
  const layer = choiceOf(s1.raw.layer);
  if (!layer.choice) return null;
  const layerP = layer.probabilities[layer.choice];
  if (typeof layerP !== "number") return null;
  const s2 = stages.find((s) => s.layer !== undefined);
  if (!s2 || layer.choice === NONE_OPTION) return { layer: layer.choice, layerP, type: null, typeP: null };
  const type = choiceOf(s2.raw.element_type);
  const typeP = type.choice ? type.probabilities[type.choice] : undefined;
  return {
    layer: layer.choice,
    layerP,
    type: type.choice && type.choice !== NONE_OPTION ? type.choice : null,
    typeP: typeof typeP === "number" ? typeP : null,
  };
}
