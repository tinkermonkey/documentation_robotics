/**
 * Tier 1 inside codebase_extract (docs/analyzers/TIER1_DESIGN.md sections 1.1, 1.3, 2.4, 4.5 and
 * 7), suggest mode: between the first planning pass and the final plan, the cards Tier 0 narrowed
 * or left open are asked of the decision model the checkout opted in to (cache first, then the
 * provider within the month's budget and the run's time). Each card gets Tier 1's hint, the accept
 * band sorted first and the not-element band last. Tier 1 alone stages and hides nothing: the
 * agent's `acceptTier1: true` stages the accept band, from cached answers only, so exactly what it
 * was shown, through the same planner path as Tier-0 decisions.
 *
 * Nothing here returns or logs a key: the block and the notice come from the classifier's session,
 * which names providers and the account id's last four characters only.
 */
import type { ChangeOrigin } from "../../core/changeset.js";
import type { ExtractedSymbol } from "../../analyzers/cards/extract.js";
import { tier1Rule, type Tier1Decided, type UndecidedCard } from "../../analyzers/extraction-plan.js";
import { loadSpecCriteria, type SpecCriteria } from "../../analyzers/classifier/criteria.js";
import { classifyTier1, hintOf, type Tier1Item } from "../../analyzers/classifier/run.js";
import { blockOfRun, openTier1, type OpenTier1Options, type ReadyTier1, type Tier1Session } from "../../analyzers/classifier/session.js";
import type { Tier1Block, Tier1Decision, Tier1Hint } from "../../analyzers/classifier/types.js";

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
  /** With acceptTier1: the accept band's decisions to plan like Tier 0's, by card id, with their origin. */
  accepted: Map<string, Tier1Decided & { origin: ChangeOrigin }>;
  /** With acceptTier1 and `debug.applyNotElement`: the not-element band's cards to record as not elements. */
  notElement: Array<{ cardId: string; decision: Tier1Decision }>;
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
function originOf(session: ReadyTier1, decision: Tier1Decision): ChangeOrigin {
  return {
    by: "tier1",
    rule: tier1Rule(session.qset),
    provider: session.config.provider,
    model: decision.servedBy?.model ?? session.model.id.model,
    ...(decision.servedBy?.upstream ? { upstream: decision.servedBy.upstream } : {}),
    p: { layer: decision.p.layer ?? 0, type: decision.p.type },
    confirmed: "agent",
  };
}

/** Ask Tier 1 about the cards. Never throws for a provider's failure: the block says what happened. */
export async function runExtractTier1(session: ReadyTier1, options: RunExtractTier1Options): Promise<ExtractTier1Result> {
  const items: Tier1Item[] = [];
  for (const c of options.cards) {
    const s = options.symbols.get(c.cardId);
    if (!s) continue;
    const narrow = s.tier0?.kind === "narrow" ? s.tier0.candidates : undefined;
    items.push({ id: c.cardId, card: s.card, ...(narrow?.length ? { narrow } : {}) });
  }
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
  // Suggest mode is the only mode codebase_extract has (stage mode comes after held-out verification).
  block.mode = "suggest";
  const hints = new Map<string, Tier1Hint>();
  const accepted = new Map<string, Tier1Decided & { origin: ChangeOrigin }>();
  const notElement: ExtractTier1Result["notElement"] = [];
  const layers = options.layers?.length ? new Set(options.layers) : null;
  let notShown = 0;
  for (const [id, d] of result.decisions) {
    let hint = hintOf(d);
    // An accept answer the run can't stage (its layer is outside `layers`) is never offered as accept.
    if (hint.band === "accept" && layers && d.layer && !layers.has(d.layer)) hint = escalated(hint, OUTSIDE_LAYERS_REASON(d.layer));
    if (options.accept && d.status === "answered" && d.cached && (hint.band === "accept" || hint.band === "not-element")) {
      const seen = options.shown?.get(id);
      const sameAsShown = !!seen && seen.band === hint.band && seen.layer === d.layer && seen.type === d.type;
      if (hint.band === "accept") {
        if (sameAsShown && d.layer && d.type) {
          accepted.set(id, { layer: d.layer, type: d.type, rule: tier1Rule(session.qset), origin: originOf(session, d) });
        } else {
          hint = escalated(hint, NOT_SHOWN_REASON);
          notShown++;
        }
      } else if (session.config.debug?.applyNotElement && sameAsShown) {
        notElement.push({ cardId: id, decision: d });
      }
    }
    hints.set(id, hint);
  }
  block.bands = recount(hints);
  return { block, hints, accepted, notElement, notShown, uncached: options.accept ? result.stats.skippedFor.cacheOnly : 0 };
}

/** The hint at a card's `compact` detail: band, layer, type and p (section 1.3). */
export function compactHint(hint: Tier1Hint): Tier1Hint {
  return { band: hint.band, layer: hint.layer, type: hint.type, p: hint.p };
}
