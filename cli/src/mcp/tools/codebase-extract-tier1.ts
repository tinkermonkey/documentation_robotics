/**
 * Tier 1 inside codebase_extract (docs/analyzers/TIER1_DESIGN.md sections 1.1, 1.3, 2.4, 4.5 and
 * 7): between the first planning pass and the final plan, the cards Tier 0 narrowed or left open
 * are asked of the decision model the checkout opted in to (cache first, then the provider within
 * the month's budget and the run's time).
 *
 * Suggest mode (a model whose defaults are in-sample, overridden thresholds, or `"mode": "suggest"`
 * in tier1.json): each card gets Tier 1's hint, the accept band sorted first and the not-element band
 * last. Tier 1 alone stages and hides nothing: the agent's `acceptTier1: true` stages the accept
 * band, from cached answers only, so exactly what it was shown, through the same planner path as
 * Tier-0 decisions.
 *
 * Stage mode (the model's defaults are held-out verified for both bands, `modeOf`): the accept band,
 * within the run's layers, is planned like Tier-0 decisions without the agent (validated, never
 * `retyped`, origin `confirmed: "auto"`); the not-element band is counted and its cards hidden;
 * escalated cards stay cards with their hint.
 *
 * Hide mode (the not-element band alone is held-out verified): the not-element band is hidden as in
 * stage mode, on every run, `acceptTier1` calls included; the accept band is a suggestion as in
 * suggest mode.
 *
 * Nothing here returns or logs a key: the block and the notice come from the classifier's session,
 * which names providers and the account id's last four characters only.
 */
import type { ChangeOrigin } from "../../core/changeset.js";
import type { ExtractedSymbol } from "../../analyzers/cards/extract.js";
import { tier1Rule, type Tier1Decided, type UndecidedCard } from "../../analyzers/extraction-plan.js";
import { loadSpecCriteria, type SpecCriteria } from "../../analyzers/classifier/criteria.js";
import { cardCacheKey, classifyTier1, hintOf, MEDIAN_CARD_MS, qsetOf, type Tier1Item } from "../../analyzers/classifier/run.js";
import { blockOfRun, openTier1, type OpenTier1Options, type ReadyTier1, type Tier1Session } from "../../analyzers/classifier/session.js";
import { monthLine } from "../../analyzers/classifier/spend.js";
import { fillProgress, warmingReason } from "../../analyzers/classifier/status.js";
import type { Tier1Block, Tier1Decision, Tier1Hint, Tier1Warming } from "../../analyzers/classifier/types.js";

/** Of codebase_extract's budget, what Tier 1 leaves for planning and staging: at least 20 s (at most a quarter of a smaller budget). */
export const TIER1_RESERVE_MS = 20_000;
/** The reserve is also at least this many times the run's measured first planning pass. */
export const TIER1_RESERVE_PLANNING_FACTOR = 4;

/**
 * When Tier 1 has to stop asking, for a run whose budget ends at `deadline`: what the rest of the
 * run needs is reserved, the larger of {@link TIER1_RESERVE_MS} (a quarter of a small budget) and
 * {@link TIER1_RESERVE_PLANNING_FACTOR} times the first planning pass (`planningMs`), since the
 * second pass, validation, relationships and staging follow. Never before `now`: a run with no
 * time left for Tier 1 asks nothing.
 */
export function tier1DeadlineAt(startedAt: number, deadline: number, planningMs = 0, now: number = Date.now()): number {
  const reserve = Math.max(Math.min(TIER1_RESERVE_MS, Math.floor((deadline - startedAt) / 4)), TIER1_RESERVE_PLANNING_FACTOR * planningMs);
  return Math.max(now, deadline - reserve);
}

/** Why an accept-band answer is not staged by acceptTier1. */
export const NOT_SHOWN_REASON =
  "not accepted: an earlier run without acceptTier1 didn't show this card in Tier 1's accept band with this layer and type; call codebase_extract without acceptTier1 to see it first";
export const OUTSIDE_LAYERS_REASON = (layer: string) => `escalated: Tier 1 placed it in ${layer}, outside this run's layers, so it can't be accepted here`;

/** The block of a run that skipped Tier 1 (`tier1: false`): no tier1.json read, nothing sent. */
export function skippedBlock(): Tier1Block {
  return {
    state: "off",
    reason: "tier1: false skipped Tier 1 for this run",
    notice: "Tier 1 was skipped for this run (tier1: false): Tier 0 only, nothing was sent.",
  };
}

/** Open Tier 1 for a run: the session (ready or why not). Reads files only, never the network. */
export async function openExtractTier1(projectRoot: string, analyzer: string, codebaseRoot: string, options: OpenTier1Options = {}): Promise<Tier1Session> {
  return openTier1(projectRoot, analyzer, { codebaseRoot, ...options });
}

export interface ExtractTier1Result {
  block: Tier1Block;
  /** Every asked card's hint, by card id. */
  hints: Map<string, Tier1Hint>;
  /**
   * The accept band's decisions to plan like Tier 0's, by card id, with their origin: in stage mode
   * (confirmed "auto"), or with acceptTier1 (confirmed "agent").
   */
  accepted: Map<string, Tier1Decided & { origin: ChangeOrigin }>;
  /** With acceptTier1 and `debug.applyNotElement`: the not-element band's cards to record as not elements. */
  notElement: Array<{ cardId: string; decision: Tier1Decision }>;
  /** Stage mode: the not-element band's card ids, hidden from the agent's cards (counted, not recorded). */
  hidden: string[];
  /** With acceptTier1: accept-band answers not staged because no earlier run showed them so. */
  notShown: number;
  /** With acceptTier1: cards with no cached answer (nothing was asked). */
  uncached: number;
}

/** What an earlier run showed a card as: its Tier-1 band, layer and type, by card id. */
export type ShownHints = ReadonlyMap<string, Pick<Tier1Hint, "band" | "layer" | "type">>;

/** The hints the extraction record's cards carried (this run's and earlier runs' cards), by card id. */
export function shownHints(cards: ReadonlyArray<Pick<UndecidedCard, "cardId"> & { tier1?: Tier1Hint }>): Map<string, Pick<Tier1Hint, "band" | "layer" | "type">> {
  const out = new Map<string, Pick<Tier1Hint, "band" | "layer" | "type">>();
  for (const c of cards) if (c.tier1) out.set(c.cardId, { band: c.tier1.band, layer: c.tier1.layer, type: c.tier1.type });
  return out;
}

export interface RunExtractTier1Options {
  /** The cards Tier 1 is asked about (`tier1Askable` of the first pass). */
  cards: readonly UndecidedCard[];
  /** The extraction's symbols by card id. */
  symbols: ReadonlyMap<string, ExtractedSymbol>;
  /** Epoch ms after which nothing more is asked (the rest escalate). */
  deadlineAt: number;
  /** acceptTier1: answer from the cache only, and return the accept band to stage. */
  accept: boolean;
  /**
   * With `accept`: what the extraction record's cards showed. Only an answer the agent was shown in
   * the same band, layer and type is accepted (or, with the debug option, recorded as not an
   * element); the cache is shared with `dr analyzer classify`, and thresholds can change between
   * the calls, so the cache alone doesn't say what the agent saw.
   */
  shown?: ShownHints;
  /** The run's layers: an accept answer outside them escalates, since the run couldn't stage it. */
  layers?: readonly string[] | null;
  /** The MCP request's cancellation. */
  signal?: AbortSignal;
  spec?: SpecCriteria;
}

function recount(hints: ReadonlyMap<string, Tier1Hint>): { accept: number; notElement: number; escalate: number } {
  const bands = { accept: 0, notElement: 0, escalate: 0 };
  for (const h of hints.values()) {
    if (h.band === "accept") bands.accept++;
    else if (h.band === "not-element") bands.notElement++;
    else bands.escalate++;
  }
  return bands;
}

/** A hint moved to the escalate band, saying why. */
function escalated(hint: Tier1Hint, reason: string): Tier1Hint {
  return { ...hint, band: "escalate", reason };
}

/** The origin of an accepted decision's staged changes (section 7). */
function originOf(session: ReadyTier1, decision: Tier1Decision, confirmed: "auto" | "agent"): ChangeOrigin {
  return {
    by: "tier1",
    rule: tier1Rule(session.qset),
    provider: session.config.provider,
    model: decision.servedBy?.model ?? session.model.id.model,
    ...(decision.servedBy?.upstream ? { upstream: decision.servedBy.upstream } : {}),
    p: { layer: decision.p.layer ?? 0, type: decision.p.type },
    confirmed,
  };
}

/** Ask Tier 1 about the cards. Never throws for a provider's failure: the block says what happened. */
export async function runExtractTier1(session: ReadyTier1, options: RunExtractTier1Options): Promise<ExtractTier1Result> {
  const items = itemsOf(options.cards, options.symbols);
  const spec = options.spec ?? (await loadSpecCriteria());
  const result = await classifyTier1(items, {
    model: session.model,
    spec,
    host: session.host,
    qset: session.qset,
    cache: session.cache,
    thresholds: session.thresholds,
    concurrency: session.config.concurrency,
    remainingUsd: session.month.remainingUsd,
    capUsd: session.config.monthlyCapUsd,
    ledger: session.ledger,
    source: "extract",
    deadlineAt: options.deadlineAt,
    cacheOnly: options.accept,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(spec.specVersion ? { specVersion: spec.specVersion } : {}),
  });
  let month = session.month;
  const warnings = [...result.warnings];
  try {
    month = await session.ledger.month(session.config.monthlyCapUsd);
  } catch (e) {
    warnings.push(`The month's spend could not be read again: ${e instanceof Error ? e.message : String(e)}`);
  }
  const block = blockOfRun(session, result.stats, month, warnings);
  // Stage mode stages and hides without the agent; acceptTier1 is the agent's yes in suggest and hide
  // mode (in stage mode codebase_extract runs an acceptTier1 call as a normal run, and says so).
  // Hide mode hides the not-element band on every run and leaves the accept band to the agent.
  const stage = session.mode === "stage" && !options.accept;
  const hide = stage || session.mode === "hide";
  const hints = new Map<string, Tier1Hint>();
  const accepted = new Map<string, Tier1Decided & { origin: ChangeOrigin }>();
  const notElement: ExtractTier1Result["notElement"] = [];
  const hidden: string[] = [];
  const layers = options.layers?.length ? new Set(options.layers) : null;
  let notShown = 0;
  for (const [id, d] of result.decisions) {
    let hint = hintOf(d);
    // An accept answer the run can't stage (its layer is outside `layers`) is never offered as accept.
    if (hint.band === "accept" && layers && d.layer && !layers.has(d.layer)) hint = escalated(hint, OUTSIDE_LAYERS_REASON(d.layer));
    if (stage && d.status === "answered" && hint.band === "accept" && d.layer && d.type) {
      // Planned like a Tier-0 decision: validated (an add that doesn't validate comes back as a
      // needs-attributes card), never retyping a modelled element.
      accepted.set(id, { layer: d.layer, type: d.type, rule: tier1Rule(session.qset), origin: originOf(session, d, "auto") });
    }
    if (hide && d.status === "answered" && hint.band === "not-element") hidden.push(id);
    if (options.accept && d.status === "answered" && d.cached && (hint.band === "accept" || hint.band === "not-element")) {
      const seen = options.shown?.get(id);
      const sameAsShown = !!seen && seen.band === hint.band && seen.layer === d.layer && seen.type === d.type;
      if (hint.band === "accept") {
        if (sameAsShown && d.layer && d.type) {
          accepted.set(id, { layer: d.layer, type: d.type, rule: tier1Rule(session.qset), origin: originOf(session, d, "agent") });
        } else {
          hint = escalated(hint, NOT_SHOWN_REASON);
          notShown++;
        }
      } else if (!hide && session.config.debug?.applyNotElement && sameAsShown) {
        notElement.push({ cardId: id, decision: d });
      }
    }
    hints.set(id, hint);
  }
  block.bands = recount(hints);
  return { block, hints, accepted, notElement, hidden, notShown, uncached: options.accept ? result.stats.skippedFor.cacheOnly : 0 };
}

/** The items Tier 1 is asked about, from the cards and the extraction's symbols. */
function itemsOf(cards: readonly UndecidedCard[], symbols: ReadonlyMap<string, ExtractedSymbol>): Tier1Item[] {
  const items: Tier1Item[] = [];
  for (const c of cards) {
    const s = symbols.get(c.cardId);
    if (!s) continue;
    const narrow = s.tier0?.kind === "narrow" ? s.tier0.candidates : undefined;
    items.push({ id: c.cardId, card: s.card, ...(narrow?.length ? { narrow } : {}) });
  }
  return items;
}

/**
 * The cards without a cached answer: how many (`cards`, the unit of a run's counts) and how many
 * distinct requests they would need (`requests`: cards with the same key are asked once). Reads
 * the cache only (its file once, memoised for the run that follows); asks nothing.
 */
export async function countUncached(
  session: ReadyTier1,
  cards: readonly UndecidedCard[],
  symbols: ReadonlyMap<string, ExtractedSymbol>,
  spec: SpecCriteria
): Promise<{ cards: number; requests: number }> {
  const canonicalModel = session.model.id.canonicalModel;
  const scope = { qset: qsetOf({ qset: session.qset }, spec), host: session.host, model: canonicalModel };
  const cached = await session.cache.load(scope);
  const misses = new Set<string>();
  let uncachedCards = 0;
  for (const item of itemsOf(cards, symbols)) {
    const key = cardCacheKey({ qset: session.qset, card: item.card, ...(item.narrow ? { narrow: item.narrow } : {}) }, spec, { canonicalModel, host: session.host });
    if (cached.has(key)) continue;
    uncachedCards++;
    misses.add(key);
  }
  return { cards: uncachedCards, requests: misses.size };
}

/** About how many cards Tier 1 can ask before `deadlineAt`, `concurrency` at a time (section 4.4's median card time). */
export function askCapacity(deadlineAt: number, concurrency: number, now: number = Date.now()): number {
  return Math.floor(Math.max(0, deadlineAt - now) / MEDIAN_CARD_MS) * Math.max(1, concurrency);
}

/**
 * The share of {@link askCapacity} a run counts on while the index job fills the cache: the fill
 * and the run share the provider (and its rate limits), so cards may take longer than the median.
 */
export const WARMING_CAPACITY_FACTOR = 0.5;

/** How many uncached requests a run asks itself while the fill runs, rather than return `warming`. */
export function warmingCapacity(deadlineAt: number, concurrency: number, now: number = Date.now()): number {
  return Math.floor(WARMING_CAPACITY_FACTOR * askCapacity(deadlineAt, concurrency, now));
}

/**
 * The warming policy (TIER1_DESIGN.md sections 4.1 and 4.4), while the `codebase_index` job fills
 * the cache: a run whose uncached cards fit what its own time lets Tier 1 ask goes ahead and asks
 * them (a few cents at most may be paid twice, if the fill reaches the same cards first; both
 * processes' cache appends and ledger lines are safe, and both re-read the month's spend, so the
 * cap holds). A run with more stages nothing and sends nothing (`warming`): asking would pay for
 * cards the fill is about to ask, and would still leave most of them without an answer, while
 * after the fill a rerun answers every card from the cache for nothing. `acceptTier1` reads the
 * cache only, so it is never held.
 */
export function holdsForWarming(uncached: number, capacity: number): boolean {
  return uncached > capacity;
}

/**
 * The block of a run held for warming: nothing asked, nothing staged, the fill's progress. `cards`
 * and `uncached` count cards (as `cached` and `skipped` do); `capacity` counts requests.
 */
export function warmingBlock(session: ReadyTier1, warming: Tier1Warming, ctx: { cards: number; uncached: number; capacity: number }): Tier1Block {
  return {
    state: "warming",
    reason: warmingReason(warming),
    provider: session.config.provider,
    model: session.model.id.model,
    ...(session.routing ? { routing: session.routing } : {}),
    qset: session.qset,
    mode: session.mode,
    modeReason: session.modeReason,
    thresholds: session.thresholdsSource,
    cards: ctx.cards,
    cached: ctx.cards - ctx.uncached,
    sent: 0,
    failed: 0,
    skipped: ctx.uncached,
    costUsd: 0,
    month: session.month,
    warming,
    notice:
      `Tier 1's answer cache is being filled by the codebase_index job (${fillProgress(warming)}). ` +
      `${ctx.uncached.toLocaleString("en-US")} of this run's ${ctx.cards.toLocaleString("en-US")} Tier-1 cards have no cached answer yet, more than this run could ask in its time (about ${ctx.capacity.toLocaleString("en-US")} requests), ` +
      `so nothing was sent to Tier 1 and nothing was staged: after the fill, the same call answers every card from the cache at no cost. ${monthLine(session.month)}`,
    ...(session.warnings.length ? { warnings: [...session.warnings] } : {}),
  };
}

/** The hint at a card's `compact` detail: band, layer, type and p (section 1.3). */
export function compactHint(hint: Tier1Hint): Tier1Hint {
  return { band: hint.band, layer: hint.layer, type: hint.type, p: hint.p };
}
