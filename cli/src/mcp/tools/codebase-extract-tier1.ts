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

/** Of codebase_extract's budget, what Tier 1 leaves for planning and staging: at most 20 s, at most a quarter. */
export const TIER1_RESERVE_MS = 20_000;

/** When Tier 1 has to stop asking, for a run whose budget ends at `deadline`. */
export function tier1DeadlineAt(startedAt: number, deadline: number): number {
  const reserve = Math.min(TIER1_RESERVE_MS, Math.floor((deadline - startedAt) / 4));
  return deadline - reserve;
}

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
  spec?: SpecCriteria;
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
  const hints = new Map<string, Tier1Hint>();
  const accepted = new Map<string, Tier1Decided & { origin: ChangeOrigin }>();
  const notElement: ExtractTier1Result["notElement"] = [];
  for (const [id, d] of result.decisions) {
    hints.set(id, hintOf(d));
    if (!options.accept || d.status !== "answered" || !d.cached) continue;
    if (d.band === "accept" && d.layer && d.type) {
      accepted.set(id, { layer: d.layer, type: d.type, rule: tier1Rule(session.qset), origin: originOf(session, d) });
    } else if (d.band === "not-element" && session.config.debug?.applyNotElement) {
      notElement.push({ cardId: id, decision: d });
    }
  }
  return { block, hints, accepted, notElement };
}

/** The hint at a card's `compact` detail: band, layer, type and p (section 1.3). */
export function compactHint(hint: Tier1Hint): Tier1Hint {
  return { band: hint.band, layer: hint.layer, type: hint.type, p: hint.p };
}
