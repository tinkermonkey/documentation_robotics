/**
 * Asking cards: the two stages of a question set against a {@link DecisionModel} (`askCard`), and
 * the run loop around it (`classifyTier1`, TIER1_DESIGN.md sections 4.1-4.6): the cache first,
 * then the provider within the month's remaining budget, in a pool of `concurrency` with a
 * deadline, a circuit breaker, and the pool halved on a 429. Spend goes to the ledger in batches.
 *
 * Everything here reads answers normalised by the adapter (`AskResult.answers`, or a cache entry
 * through `normaliseEntry`), never a provider's raw shape.
 */
import { cacheKey, normaliseEntry, type CacheEntry, type CacheScope, type Tier1Cache } from "./cache.js";
import { criteriaDigest, NONE_OPTION, type SpecCriteria } from "./criteria.js";
import {
  DecisionModelError,
  shapesOf,
  type Answer,
  type AskOptions,
  type AskResult,
  type BilledUsage,
  type DecisionModel,
  type Question,
  type QuestionShape,
  type RawAnswer,
  withBilled,
} from "./decision-model/types.js";
import { bandOf, type BandInput, type Thresholds } from "./bands.js";
import { CURRENT_QSET_ID, qsetById, qsetVariantId, type Narrowing } from "./qset/index.js";
import { DEFAULT_CARD_COST_USD, type SpendLedger, type SpendSource } from "./spend.js";
import type { StateCard } from "./state.js";
import type { Tier1Decision, Tier1Hint, Tier1RunStats, Tier1Unavailable } from "./types.js";

export interface CardQuery {
  /** The question set (`dr-qset-2`); the current one when absent. */
  qset?: string;
  /**
   * The card. `askCard` renders the state with the query's own question set (`stateOf`), so a
   * state can't be sent, or cached, under another question set's id. Production always passes it.
   */
  card?: StateCard;
  /**
   * A state rendered by the caller, for harness variants only (`--charter`, `--facts`, another
   * source-line count), whose ids say so. Not both `card` and `state`.
   */
  state?: string;
  /** The CBM symbol kind (`Class`, `Function`, ...), for the kind rule; the card's label by default. */
  kind?: string;
  /** Tier 0's narrowing, when a rule narrowed the card. */
  narrow?: Narrowing;
  /** The kind rule; on in every question set (default true). Off only for harness variants. */
  kindNarrow?: boolean;
}

/** The state a query sends: its question set's rendering of the card, or the harness's own. */
export function stateOfQuery(query: CardQuery): string {
  if (query.card && query.state !== undefined) throw new Error("A card query takes a card or a rendered state, not both");
  if (query.card) return qsetById(query.qset ?? CURRENT_QSET_ID).stateOf(query.card);
  if (query.state !== undefined) return query.state;
  throw new Error("A card query needs a card (or, for a harness variant, a rendered state)");
}

export interface StageAsk {
  questions: Record<string, Question>;
  result: AskResult;
}

export interface CardAsk {
  /** The question set id for what was sent, variant included (derived from the query, not trusted from the caller). */
  qset: string;
  /** The state sent, exactly. */
  state: string;
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
 * `dr-qset-2+core`). Derived from the same inputs `askCard` builds the questions and the state
 * from, so a cache key can't disagree with the request.
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
    state: stateOfQuery(query),
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
  const state = stateOfQuery(query);
  const kind = query.kind ?? query.card?.label;
  const q1 = qset.stage1Questions(spec, query.narrow);
  const r1 = await model.ask(state, q1, options);
  const layer = chosenOf(r1.answers.layer);
  const usage = { inputTokens: r1.usage.inputTokens, outputTokens: r1.usage.outputTokens ?? 0, costUsd: costOf(model, r1) };
  const out: CardAsk = { qset: qsetOf({ kindNarrow, qset: qset.QSET_ID }, spec), state, stage1: { questions: q1, result: r1 }, layer, usage, servedBy: { ...r1.servedBy } };
  if (layer && layer !== NONE_OPTION) {
    const q2 = qset.stage2Questions(spec, layer, kind, kindNarrow, query.narrow);
    if (qset.asksStage2(layer, q2)) {
      let r2: AskResult;
      try {
        r2 = await model.ask(state, q2, options);
      } catch (e) {
        // Stage 1 was answered, and billed: the error carries it, so the spend is still recorded.
        throw withBilled(e, { inputTokens: usage.inputTokens, costUsd: usage.costUsd });
      }
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

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Options other than `skip` sorted by probability, highest first. */
function runnersUp(answer: Answer | undefined, skip: ReadonlySet<string>): Array<[string, number]> {
  if (!answer || answer.type !== "choice") return [];
  return Object.entries(answer.probabilities)
    .filter(([o, p]) => !skip.has(o) && typeof p === "number" && Number.isFinite(p))
    .sort((a, b) => b[1] - a[1]);
}

/** A card's decision from its normalised stage answers (section 1.3's hint, plus status). */
export function decisionOf(stages: AnsweredStage[], thresholds: Thresholds | null, cached: boolean, servedBy?: { upstream?: string; model?: string }): Tier1Decision {
  const input = bandInputOf(stages);
  const band = bandOf(input, thresholds);
  const by = servedBy && (servedBy.model || servedBy.upstream) ? { servedBy: { ...servedBy } } : {};
  if (!input) {
    return { band, status: "failed", layer: null, type: null, p: { layer: null, type: null }, cached, reason: "the layer question went unanswered", ...by };
  }
  const s1 = stages[0].answers;
  const s2 = stages.find((s) => s.layer !== undefined);
  const alt: string[] = [];
  if (s2 && input.layer !== NONE_OPTION) {
    const t = runnersUp(s2.answers.element_type, new Set([input.type ?? "", NONE_OPTION]))[0];
    if (t && t[1] >= 0.05) alt.push(`${input.layer}.${t[0]} ${t[1].toFixed(2)}`);
  }
  const l = runnersUp(s1.layer, new Set([input.layer]))[0];
  if (l && l[1] >= 0.05) alt.push(`${l[0]} ${l[1].toFixed(2)}`);
  const sig = s1.significance;
  const concerns = Object.entries(s1)
    .filter(([k, a]) => k.startsWith("concern_") && a.type === "noul" && a.probability >= 0.5)
    .map(([k]) => k.slice("concern_".length));
  return {
    band,
    status: "answered",
    layer: input.layer,
    type: input.type,
    p: { layer: round3(input.layerP), type: input.typeP === null ? null : round3(input.typeP) },
    ...(alt.length ? { alt: alt.slice(0, 2) } : {}),
    ...(sig?.type === "score" ? { significance: Math.round(sig.score * 100) / 100 } : {}),
    ...(concerns.length ? { concerns } : {}),
    cached,
    ...by,
  };
}

/** One card for {@link classifyTier1}. */
export interface Tier1Item {
  /** The caller's id for the card (its card id). */
  id: string;
  card: StateCard;
  /** Tier 0's narrowing, when a rule narrowed the card. */
  narrow?: Narrowing;
}

export interface ClassifyTier1Options {
  model: DecisionModel;
  spec: SpecCriteria;
  /** The serving host the cache keys on: the provider for Workers AI, an upstream or `any` for OpenRouter. */
  host: string;
  /** The question set; the current one by default. */
  qset?: string;
  /** Null: no cache (the probe). */
  cache: Tier1Cache | null;
  /** Null: no bands for this model, every card escalates with its hint. */
  thresholds: Thresholds | null;
  /** Cards in flight; default 4, at most 16. A 429 halves it for the rest of the run. */
  concurrency?: number;
  /** Epoch ms after which nothing more is asked; in-flight requests are cancelled and skipped. */
  deadlineAt?: number;
  /** What the month has left; absent: no cap (the harness). 0 sends nothing. */
  remainingUsd?: number;
  /**
   * Answer from the cache only and ask nothing (`codebase_extract` with `acceptTier1`, which
   * accepts exactly what the agent was shown). The misses are skipped as `cacheOnly`.
   */
  cacheOnly?: boolean;
  /** The caller's cancellation: once aborted nothing more is asked, in-flight requests are cancelled and the rest skipped. */
  signal?: AbortSignal;
  /** The monthly cap, so the remainder can be re-read from the ledger as other processes spend. */
  capUsd?: number;
  /** A card's estimated cost; default the mean of this scope's cached entries, else {@link DEFAULT_CARD_COST_USD}. */
  estimatePerCardUsd?: number;
  /** Where spend is recorded, one line per card as it finishes. */
  ledger?: SpendLedger | null;
  source?: SpendSource;
  /** Consecutive failed cards that stop the run (circuit breaker); default 5. */
  breakerAfter?: number;
  /** Cards between cache flushes and re-reads of the month's spend; default 20. */
  flushEvery?: number;
  specVersion?: string;
  /** Called once, before the first request, with how many cards will be asked at most. */
  onBeforeSend?: (cards: number) => void;
  onProgress?: (done: number, total: number) => void;
}

export interface ClassifyTier1Result {
  /** Every item's decision, in the items' order. */
  decisions: Map<string, Tier1Decision>;
  stats: Tier1RunStats;
  /** Every cache key the run used, for compaction. */
  usedKeys: string[];
  /** Spend that couldn't be recorded, and similar notes for the user. */
  warnings: string[];
}

interface Pending {
  key: string;
  query: CardQuery;
  ids: string[];
}

/**
 * Classify cards with Tier 1. Never throws for a provider's failure: the cards it couldn't answer
 * escalate, and the stats say why (section 4.6).
 *
 * - Cache hits are used first; cards with the same key are asked once.
 * - Misses are asked in the items' order while `committed + commit <= remainingUsd`, where an
 *   in-flight card commits the larger of the estimate and the most a card has cost so far, so a
 *   run never knowingly passes the cap; the rest are `skipped` (cap) and the state is `capped`.
 *   Every card's spend, failed ones' billed stages included, goes to the ledger as it finishes; the
 *   month is re-read every `flushEvery` cards, so another process's spend lowers the remainder.
 * - 401/403 stops at the first (`auth`); `routing` stops at once; `breakerAfter` cards failing in
 *   a row stops the run (`provider`, or `api` when the answers were unreadable); a run in which
 *   every asked card failed is `unavailable` too.
 * - A 429 that outlasts the adapter's retries halves the pool and puts the card back once; it is
 *   always asked again (one worker drains what the others left).
 * - At the deadline nothing more is asked; in-flight requests are cancelled and their cards skipped.
 */
export async function classifyTier1(items: readonly Tier1Item[], options: ClassifyTier1Options): Promise<ClassifyTier1Result> {
  const t0 = Date.now();
  const { model, spec, cache, thresholds } = options;
  const qset = options.qset ?? CURRENT_QSET_ID;
  const canonicalModel = model.id.canonicalModel;
  const scope: CacheScope = { qset: qsetOf({ qset }, spec), host: options.host, model: canonicalModel };
  const digest = criteriaDigest(spec);
  const breakerAfter = options.breakerAfter ?? 5;
  const flushEvery = Math.max(1, options.flushEvery ?? 20);
  let limit = Math.max(1, Math.min(Math.floor(options.concurrency ?? 4), 16));
  const startLimit = limit;
  const warnings: string[] = [];

  const stats: Tier1RunStats = {
    state: "on",
    cards: items.length,
    cached: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    skippedFor: { cap: 0, deadline: 0, unavailable: 0, cacheOnly: 0 },
    bands: { accept: 0, notElement: 0, escalate: 0 },
    costUsd: 0,
    inputTokens: 0,
    servedBy: {},
    durationMs: 0,
    concurrency: { start: startLimit, end: startLimit },
    cache: { repaired: 0, errors: 0 },
  };

  const decisions = new Map<string, Tier1Decision>();
  const byKey = new Map<string, Pending>();
  const usedKeys = new Set<string>();
  for (const item of items) {
    const query: CardQuery = { qset, card: item.card, ...(item.narrow?.length ? { narrow: item.narrow } : {}) };
    const key = cardCacheKey(query, spec, { canonicalModel, host: options.host });
    usedKeys.add(key);
    const pending = byKey.get(key);
    if (pending) pending.ids.push(item.id);
    else byKey.set(key, { key, query, ids: [item.id] });
  }

  let done = 0;
  const total = items.length;
  const settle = (p: Pending, decision: Tier1Decision) => {
    for (const id of p.ids) decisions.set(id, decision);
    done += p.ids.length;
    options.onProgress?.(done, total);
  };

  const queue: Pending[] = [];
  for (const p of byKey.values()) {
    const hit = cache ? await cache.get(scope, p.key) : undefined;
    if (hit) {
      stats.cached += p.ids.length;
      settle(p, decisionOf(normaliseEntry(hit, model), thresholds, true, hit.servedBy));
    } else queue.push(p);
  }

  let estimate = options.estimatePerCardUsd ?? DEFAULT_CARD_COST_USD;
  if (options.estimatePerCardUsd === undefined && cache) {
    const costs = [...(await cache.load(scope)).values()].map((e) => e.usage.costUsd).filter((c): c is number => typeof c === "number" && c > 0);
    if (costs.length) estimate = costs.reduce((a, b) => a + b, 0) / costs.length;
  }
  // This run's allowance: the month's remainder when it started, lowered as other processes spend.
  let remaining = options.remainingUsd ?? Infinity;
  // The most one card has cost in this run: an in-flight card commits at least this much, so cards
  // in flight can't take spend far past the cap when the estimate is low.
  let maxCardCost = 0;
  const commitOf = () => Math.max(estimate, maxCardCost);

  let committed = 0; // the spend of finished cards plus the commitments of those in flight
  let recorded = 0; // spend this run wrote to the ledger
  let stop: { kind: Tier1Unavailable; reason: string } | null = null;
  let capHit = false;
  let consecutive = 0;
  const requeued = new Set<string>();
  const deadlineAt = options.deadlineAt;
  // A cancelled caller (an MCP request the client cancelled) ends the run as its deadline would.
  const cancelled = () => !!options.signal?.aborted;
  const deadlinePassed = () => cancelled() || (deadlineAt !== undefined && Date.now() >= deadlineAt);
  const signals = [
    ...(deadlineAt !== undefined ? [AbortSignal.timeout(Math.max(0, deadlineAt - Date.now()))] : []),
    ...(options.signal ? [options.signal] : []),
  ];
  const runSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

  // Cache entries go out in batches (a lost batch is only asked again); spend goes to the ledger
  // card by card as each finishes, so an interrupted run leaves at most its in-flight cards out.
  let pendingEntries: CacheEntry[] = [];
  const flushCache = async () => {
    const entries = pendingEntries;
    pendingEntries = [];
    if (cache && entries.length) await cache.append(scope, entries);
  };
  // Every `flushEvery` cards the month is read again: spend another process recorded meanwhile
  // (a second classify, later the index job's fill) lowers what this run may still ask.
  const refreshBudget = async () => {
    if (!options.ledger || options.capUsd === undefined || !Number.isFinite(remaining)) return;
    try {
      const month = await options.ledger.month(options.capUsd);
      remaining = Math.min(remaining, month.remainingUsd + recorded);
    } catch {
      // the ledger can't be read right now: keep the budget as it was
    }
  };
  let sinceRefresh = 0;
  const account = async (commit: number, usage: BilledUsage, upstream?: string) => {
    committed += usage.costUsd - commit;
    if (usage.costUsd > maxCardCost) maxCardCost = usage.costUsd;
    stats.costUsd += usage.costUsd;
    stats.inputTokens += usage.inputTokens;
    if (options.ledger && (usage.costUsd > 0 || usage.inputTokens > 0)) {
      try {
        await options.ledger.record({
          source: options.source ?? "classify",
          provider: model.id.provider,
          model: model.id.model,
          ...(upstream ? { upstream } : {}),
          cards: 1,
          inputTokens: usage.inputTokens,
          costUsd: usage.costUsd,
        });
        recorded += usage.costUsd;
      } catch (e) {
        // Unrecorded spend could let later runs pass the cap: stop asking.
        warnings.push(`Spend of $${usage.costUsd.toFixed(4)} could not be recorded in ${options.ledger.file}: ${e instanceof Error ? e.message : String(e)}`);
        stop ??= { kind: "provider", reason: "the spend ledger could not be written, so Tier 1 stopped asking" };
      }
    }
    if (++sinceRefresh >= flushEvery) {
      sinceRefresh = 0;
      await flushCache();
      await refreshBudget();
    }
  };

  // The last failure's reason, and whether any failure was a provider error (not an unreadable answer).
  let lastFailure: { kind: string; message: string } | null = null;
  let thrown = 0;
  const fail = (p: Pending, reason: string) => {
    stats.failed += p.ids.length;
    settle(p, { band: "escalate", status: "failed", layer: null, type: null, p: { layer: null, type: null }, cached: false, reason });
  };

  let announced = false;
  const worker = async (slot: number): Promise<void> => {
    for (;;) {
      if (stop || slot >= limit || deadlinePassed()) return;
      const next = queue[0];
      if (!next) return;
      const commit = commitOf();
      if (committed + commit > remaining + 1e-12) {
        capHit = true;
        return;
      }
      if (!announced) {
        announced = true;
        options.onBeforeSend?.(Number.isFinite(remaining) ? Math.min(queue.length, Math.floor(remaining / commit)) : queue.length);
      }
      queue.shift();
      committed += commit;
      let ask: CardAsk;
      try {
        ask = await askCard(model, spec, next.query, { ...(runSignal ? { signal: runSignal } : {}), ...(deadlineAt !== undefined ? { deadlineAt } : {}) });
      } catch (e) {
        const err = e instanceof DecisionModelError ? e : new DecisionModelError("unavailable", e instanceof Error ? e.message : String(e));
        // Whatever was billed before the failure (a stage that answered, a 200 that couldn't be read) still counts.
        await account(commit, err.billed ?? { inputTokens: 0, costUsd: 0 });
        if (err.kind === "timeout" && (deadlinePassed() || runSignal?.aborted)) {
          stats.skipped += next.ids.length;
          stats.skippedFor.deadline += next.ids.length;
          settle(next, skippedDecision("the run's time ran out"));
          continue;
        }
        if (err.kind === "auth") {
          stop ??= { kind: "auth", reason: `the provider refused the credentials: ${err.message}` };
          fail(next, err.message);
          continue;
        }
        if (err.kind === "routing") {
          stop ??= { kind: "routing", reason: err.message };
          fail(next, err.message);
          continue;
        }
        consecutive++;
        lastFailure = { kind: err.kind, message: err.message };
        if (err.kind === "rate-limit") {
          limit = Math.max(1, Math.floor(limit / 2));
          stats.concurrency.end = limit;
          if (!requeued.has(next.key)) {
            requeued.add(next.key);
            queue.unshift(next);
            if (consecutive >= breakerAfter) stop ??= { kind: "provider", reason: `${breakerAfter} requests in a row failed; the last: ${err.message}` };
            continue;
          }
        }
        fail(next, `${err.kind}: ${err.message}`);
        thrown += next.ids.length;
        if (consecutive >= breakerAfter) {
          stop ??= { kind: err.kind === "malformed" ? "api" : "provider", reason: `${breakerAfter} cards in a row failed; the last: ${err.message}` };
        }
        continue;
      }
      await account(commit, { inputTokens: ask.usage.inputTokens, costUsd: ask.usage.costUsd }, ask.servedBy.upstream);
      const served = ask.servedBy.upstream ?? ask.servedBy.model ?? model.id.model;
      stats.servedBy[served] = (stats.servedBy[served] ?? 0) + 1;
      const decision = decisionOf(answeredStagesOf(ask), thresholds, false, ask.servedBy);
      if (decision.status === "failed") {
        // A readable response without a usable answer: not cached, asked again next time.
        stats.failed += next.ids.length;
        settle(next, decision);
        lastFailure = { kind: "malformed", message: decision.reason ?? "no usable answer" };
        if (++consecutive >= breakerAfter) stop ??= { kind: "api", reason: `${breakerAfter} cards in a row came back without a usable answer` };
        continue;
      }
      consecutive = 0;
      stats.sent += next.ids.length;
      settle(next, decision);
      if (cache) {
        pendingEntries.push(
          cache.entry(next.key, scope, {
            criteriaDigest: digest,
            stages: rawStagesOf(ask),
            usage: ask.usage,
            ...(options.specVersion ? { specVersion: options.specVersion } : {}),
            servedBy: ask.servedBy,
          })
        );
      }
    }
  };

  try {
    if (queue.length && !options.cacheOnly) await Promise.all(Array.from({ length: limit }, (_, slot) => worker(slot)));
    // A 429 can put a card back after every other worker has finished, and the worker that put it
    // back may have lost its slot to the halving: one worker drains what is left.
    while (queue.length && !options.cacheOnly && !stop && !capHit && !deadlinePassed()) await worker(0);
  } finally {
    await flushCache();
  }

  // Nothing asked succeeded, and every asked card failed (provider errors, unreadable answers or
  // both): the provider is down, whatever the run's size.
  const last = lastFailure as { kind: string; message: string } | null;
  if (!stop && stats.sent === 0 && stats.failed > 0 && last) {
    stop = { kind: thrown === 0 || last.kind === "malformed" ? "api" : "provider", reason: `every card asked failed; the last: ${last.message}` };
  }

  // What was never asked. (`stop` is set inside the workers, which the compiler doesn't follow.)
  const stopped = stop as { kind: Tier1Unavailable; reason: string } | null;
  const why: { key: keyof Tier1RunStats["skippedFor"]; reason: string } = options.cacheOnly
    ? { key: "cacheOnly", reason: "not asked: this run used cached answers only" }
    : stopped
    ? { key: "unavailable", reason: `not asked: Tier 1 stopped (${stopped.kind})` }
    : capHit
      ? { key: "cap", reason: "not asked: the monthly cap is reached" }
      : { key: "deadline", reason: "the run's time ran out" }; // the drain above leaves nothing otherwise
  for (const p of queue) {
    stats.skipped += p.ids.length;
    stats.skippedFor[why.key] += p.ids.length;
    settle(p, skippedDecision(why.reason));
  }

  const ordered = new Map<string, Tier1Decision>();
  for (const item of items) {
    const d = decisions.get(item.id);
    if (!d) continue;
    ordered.set(item.id, d);
    if (d.band === "accept") stats.bands.accept++;
    else if (d.band === "not-element") stats.bands.notElement++;
    else stats.bands.escalate++;
  }
  stats.costUsd = Math.round(stats.costUsd * 1e6) / 1e6;
  stats.state = stopped ? "unavailable" : stats.skippedFor.cap > 0 ? "capped" : "on";
  if (stopped) stats.unavailable = stopped;
  stats.concurrency.end = limit;
  if (cache) stats.cache = { repaired: cache.stats.repaired, errors: cache.stats.errors };
  stats.durationMs = Date.now() - t0;
  return { decisions: ordered, stats, usedKeys: [...usedKeys], warnings };
}

function skippedDecision(reason: string): Tier1Decision {
  return { band: "escalate", status: "skipped", layer: null, type: null, p: { layer: null, type: null }, cached: false, reason };
}

/** The hint an agent is shown for a decision (section 1.3). */
export function hintOf(d: Tier1Decision): Tier1Hint {
  return {
    band: d.band,
    layer: d.layer,
    type: d.type,
    p: d.p,
    ...(d.alt ? { alt: d.alt } : {}),
    ...(d.significance !== undefined ? { significance: d.significance } : {}),
    ...(d.concerns ? { concerns: d.concerns } : {}),
    ...(d.status !== "answered" && d.reason ? { reason: d.reason } : {}),
  };
}
