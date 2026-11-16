/**
 * Tier 1's bands (TIER1_DESIGN.md section 1.3, decision 3): accept, not-element and escalate.
 * Nothing is dropped: a card Tier 1 is unsure of, or couldn't answer, escalates.
 *
 * | Band        | Rule                                                                       |
 * | ----------- | -------------------------------------------------------------------------- |
 * | accept      | top layer is not `none`, layer p >= T_layer, the chosen type's p >= T_type |
 * | not-element | top layer is `none` and its p >= T_none                                    |
 * | escalate    | everything else, and any card Tier 1 couldn't answer                       |
 *
 * Thresholds key on question set and canonical model, shared by every provider serving that model
 * (decision 12). The defaults are fitted with the classify-eval harness (`fit-thresholds.ts`) and
 * carry their fit record. They are `in-sample` (suggest mode) until the held-out corpus (B5, the viewer
 * codebase) scored with them meets `TIER1_TARGETS` under `HELD_OUT_RULE`; then `held-out`, and Tier 1
 * stages and hides without the agent (stage mode). A model without thresholds has no bands, so every card escalates
 * with its hint.
 */
import { NONE_OPTION } from "./criteria.js";

export type Band = "accept" | "not-element" | "escalate";

/** suggest: cards carry the hint, nothing is staged or hidden by Tier 1 alone; stage: held-out verified. */
export type Tier1Mode = "suggest" | "stage";

export interface Thresholds {
  layer: number;
  type: number;
  none: number;
}

/** Where a default came from: what `fit-thresholds.ts` prints beside the thresholds. */
export interface FitRecord {
  /** The harness run fitted on: its prediction file stem (`clef@cbm012-kind-tier0`). */
  run: string;
  /** Model-asked cards per corpus. */
  corpora: Readonly<Record<string, number>>;
  /** Model-asked cards in all. */
  cards: number;
  /** The spec version the run's criteria came from. */
  specVersion: string;
  /** Date of the fit (YYYY-MM-DD). */
  date: string;
  /** The precision targets the thresholds were picked to meet, with the most coverage. */
  targets: {
    typePrecision: number;
    nonePrecision: number;
    /** `pooled`: over all corpora; `each-corpus`: pooled and in every corpus. */
    scope: "pooled" | "each-corpus";
    /** Compared against the point estimate or the Wilson 95% lower bound. */
    bound: "point" | "wilson-lower";
  };
  /** Pooled, at these thresholds. */
  accept: { cards: number; typePrecision: number };
  notElement: { cards: number; precision: number };
}

export interface ThresholdRecord extends Thresholds {
  /** How they were fitted; only `held-out` thresholds put a model in stage mode. */
  fit: "in-sample" | "held-out";
  /** The fit behind a default. */
  record?: FitRecord;
  /** The defaults scored on the held-out corpus (B5), whatever the verdict. */
  heldOut?: HeldOutRecord;
}

// ---------------------------------------------------------------------------
// The held-out test (TIER1_DESIGN.md section 6, decision 4)
// ---------------------------------------------------------------------------

/** Precision targets for a model's bands: accept-band type precision and not-element precision. */
export interface Tier1Targets {
  typePrecision: number;
  nonePrecision: number;
}

/**
 * The targets a model's defaults must meet on the held-out corpus to count as `held-out` (decision
 * 4). **Provisional**: the maintainer hasn't fixed them; these are the ones that reproduce Clef's
 * in-sample defaults (TIER1_CALIBRATION.md section 3), so the held-out test asks whether the
 * defaults hold as well on code they weren't fitted on. TIER1_CALIBRATION.md section 6 shows the
 * verdict under alternatives.
 */
export const TIER1_TARGETS: Readonly<Tier1Targets> = { typePrecision: 0.88, nonePrecision: 0.9 };

/**
 * How "meets the targets within its interval" (section 6) is read (maintainer's decision on #1137):
 *
 * - `lower-bound` (the rule): the band's whole Wilson 95% interval on the held-out corpus clears
 *   the target (lower bound >= target). Stage mode stages and hides without anyone looking, so the
 *   held-out evidence has to show the precision is at least the target, not merely that it might be.
 * - `within-interval` (a documented alternative, for comparison in `held-out.ts`): the interval
 *   reaches the target (upper bound >= target), i.e. the held-out corpus is consistent with it. It
 *   passes small bands on almost no evidence (4 of 4 has an interval of 51-100%), which is why it is
 *   not the rule.
 *
 * Under either reading a band smaller than {@link HELD_OUT_MIN_CARDS} fails.
 */
export type HeldOutRule = "within-interval" | "lower-bound";
export const HELD_OUT_RULE: HeldOutRule = "lower-bound";

/**
 * The fewest cards a band needs on the held-out corpus before its precision counts at all. 30:
 * the smallest band that can clear the provisional 0.88 type-precision target under the lower-bound
 * rule even with every card right is 29 (Wilson lower bound of 29/29 = 0.883, of 28/28 = 0.879), so
 * below 30 the verdict would rest on a perfect score alone; at 30 one wrong card already fails 0.88
 * (29/30 lower bound 0.833), and a band of 30 has a Wilson half-width of about 9-11 points around
 * precisions of 0.90-0.95. It is the top of the 20-30 the review suggested; under the lower-bound
 * rule the not-element target (0.90) needs at least 35 cards, all right, in any case.
 */
export const HELD_OUT_MIN_CARDS = 30;

/** Wilson score interval for k successes in n trials (95% by default); null for n = 0. */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } | null {
  if (n === 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** A band on the held-out corpus: its cards and how many of them gold agrees with. */
export interface BandCount {
  cards: number;
  correct: number;
}

/** Whether a band's precision meets a target under a rule; a band under `minCards` (default {@link HELD_OUT_MIN_CARDS}) never does. */
export function meetsTarget(band: BandCount, target: number, rule: HeldOutRule = HELD_OUT_RULE, minCards: number = HELD_OUT_MIN_CARDS): boolean {
  if (band.cards < Math.max(1, minCards)) return false;
  const w = wilson(band.correct, band.cards);
  if (!w) return false;
  return (rule === "within-interval" ? w.hi : w.lo) >= target - 1e-12;
}

export interface HeldOutVerdict {
  pass: boolean;
  accept: boolean;
  notElement: boolean;
}

/** Both bands against the targets: the defaults are `held-out` when both meet theirs. */
export function heldOutVerdict(
  bands: { accept: BandCount; notElement: BandCount },
  targets: Tier1Targets = TIER1_TARGETS,
  rule: HeldOutRule = HELD_OUT_RULE,
  minCards: number = HELD_OUT_MIN_CARDS
): HeldOutVerdict {
  const accept = meetsTarget(bands.accept, targets.typePrecision, rule, minCards);
  const notElement = meetsTarget(bands.notElement, targets.nonePrecision, rule, minCards);
  return { pass: accept && notElement, accept, notElement };
}

/**
 * Who served a held-out run: the provider and, behind a router, the one pinned upstream (null for a
 * provider that serves the model itself). Stage mode applies only to the same serving: another
 * provider or upstream (OpenRouter's DeepInfra serves Clef at fp8) may answer differently.
 */
export interface HeldOutServing {
  provider: string;
  upstream: string | null;
}

/** A default's thresholds scored on the held-out corpus: what `held-out.ts` prints. */
export interface HeldOutRecord {
  /** The held-out corpus and the commit its cards were built from. */
  corpus: string;
  sourceCommit: string;
  /** The harness run scored: its prediction file stem. */
  run: string;
  /** Model-asked cards. */
  cards: number;
  specVersion: string;
  date: string;
  /** Who served the run; stage mode needs the same serving. */
  serving: HeldOutServing;
  /**
   * `criteriaDigest` of the criteria the run sent (criteria.ts). Stage mode needs the criteria the
   * CLI sends now to be these: a spec or criteria change makes the verdict stale.
   */
  criteriaDigest: string;
  /** Accept band: cards, and those whose layer and type match gold. */
  accept: BandCount;
  /** Not-element band: cards, and those gold calls `none`. */
  notElement: BandCount;
}

/** A held-out record's verdict under targets and a rule (the record keeps counts, so targets can change in review). */
export function verdictOf(
  record: HeldOutRecord,
  targets: Tier1Targets = TIER1_TARGETS,
  rule: HeldOutRule = HELD_OUT_RULE,
  minCards: number = HELD_OUT_MIN_CARDS
): HeldOutVerdict {
  return heldOutVerdict({ accept: record.accept, notElement: record.notElement }, targets, rule, minCards);
}

/** Thresholds by question set, then canonical model. */
export type ThresholdDefaults = Readonly<Record<string, Readonly<Record<string, ThresholdRecord>>>>;

/**
 * DR's recommended defaults per question set and canonical model, fitted with the classify-eval
 * harness (`fit-thresholds.ts`, docs/analyzers/TIER1_CALIBRATION.md) on the three in-sample corpora.
 * `heldOut` is the default scored on B5 (`held-out.ts`); `fit` is `held-out` only when that record
 * passes the targets (`verdictOf`), which a unit test checks.
 */
export const DEFAULT_THRESHOLDS: ThresholdDefaults = {
  "dr-qset-1": {
    // bun fit-thresholds.ts --backend cloudflare:clef --tag cbm012-kind-tier0 --qset dr-qset-1 \
    //   --spec-version 0.10.0 --type-precision 0.88 --none-precision 0.9
    clef: {
      layer: 0.6,
      type: 0.4,
      none: 0.6,
      fit: "in-sample",
      record: {
        run: "clef@cbm012-kind-tier0",
        corpora: { "dr-cli": 300, fastapi: 148, petclinic: 73 },
        cards: 521,
        specVersion: "0.10.0",
        date: "2026-11-14",
        targets: { typePrecision: 0.88, nonePrecision: 0.9, scope: "each-corpus", bound: "point" },
        accept: { cards: 110, typePrecision: 0.909 },
        notElement: { cards: 103, precision: 0.971 },
      },
    },
  },
  "dr-qset-2": {
    // Fitted on the bundled spec (0.12.0) with the layer criteria leaving out each layer's
    // "Modelling rules:" paragraph (criteria.ts, layerScopeCriterion), as production sends them.
    // Fragile: fastapi's accept band (43 of 48) and not-element band (20 of 22) are each one wrong
    // card from missing their targets (TIER1_CALIBRATION.md section 6).
    // bun fit-thresholds.ts --run clef@cbm012-kind-tier0-qset2-spec012-layercrit --type-precision 0.88 --none-precision 0.9
    clef: {
      layer: 0.6,
      type: 0.4,
      none: 0.6,
      fit: "in-sample",
      record: {
        run: "clef@cbm012-kind-tier0-qset2-spec012-layercrit",
        corpora: { "dr-cli": 300, fastapi: 148, petclinic: 73 },
        cards: 521,
        specVersion: "0.12.0",
        date: "2026-11-16",
        targets: { typePrecision: 0.88, nonePrecision: 0.9, scope: "each-corpus", bound: "point" },
        accept: { cards: 103, typePrecision: 0.942 },
        notElement: { cards: 105, precision: 0.952 },
      },
      // B5: bun held-out.ts --run clef@cbm012-kind-tier0-qset2-spec012-layercrit (TIER1_CALIBRATION.md
      // section 7). In-sample under the rule: neither band's lower bound clears its target.
      heldOut: {
        corpus: "viewer",
        sourceCommit: "607ca095cd56ce9ef8435f2880bf8e6d3c709fa5",
        run: "clef@cbm012-kind-tier0-qset2-spec012-layercrit",
        cards: 290,
        specVersion: "0.12.0",
        date: "2026-11-16",
        serving: { provider: "cloudflare-workers-ai", upstream: null },
        criteriaDigest: "e069521f07beec91794678e268f9203d830b3a0dc1686eec718db82538f0dde5",
        accept: { cards: 55, correct: 46 },
        notElement: { cards: 51, correct: 48 },
      },
    },
  },
};

/** The thresholds for a question set and canonical model: an override, else the default, else null (no bands). */
export function thresholdsFor(
  qset: string,
  canonicalModel: string,
  override?: Partial<Thresholds> | null,
  defaults: ThresholdDefaults = DEFAULT_THRESHOLDS
): Thresholds | null {
  const base = defaults[qset]?.[canonicalModel];
  if (override && typeof override.layer === "number" && typeof override.type === "number" && typeof override.none === "number") {
    return { layer: override.layer, type: override.type, none: override.none };
  }
  if (!base) return null;
  return { layer: override?.layer ?? base.layer, type: override?.type ?? base.type, none: override?.none ?? base.none };
}

/** Stage mode only for a model whose default thresholds were verified on held-out labels. */
export function modeOf(
  qset: string,
  canonicalModel: string,
  defaults: ThresholdDefaults = DEFAULT_THRESHOLDS
): Tier1Mode {
  return defaults[qset]?.[canonicalModel]?.fit === "held-out" ? "stage" : "suggest";
}

/** What a band needs from a decision: the top layer and its p, and the chosen type and its p. */
export interface BandInput {
  layer: string;
  layerP: number;
  /** The chosen element type; null when stage 2 wasn't asked or answered `none`. */
  type: string | null;
  typeP: number | null;
}

/** The option with the highest probability (the first on a tie), or null for an empty map. */
export function topOf(probabilities: Record<string, number>): { option: string; p: number } | null {
  let best: { option: string; p: number } | null = null;
  for (const [option, p] of Object.entries(probabilities)) {
    if (typeof p !== "number" || Number.isNaN(p)) continue;
    if (!best || p > best.p) best = { option, p };
  }
  return best;
}

/**
 * A card's band. `input` null (Tier 1 couldn't answer) and `thresholds` null (no bands for this
 * model) both escalate.
 */
export function bandOf(input: BandInput | null, thresholds: Thresholds | null): Band {
  if (!input || !thresholds || !Number.isFinite(input.layerP)) return "escalate";
  if (input.layer === NONE_OPTION) return input.layerP >= thresholds.none ? "not-element" : "escalate";
  if (input.layerP < thresholds.layer) return "escalate";
  if (!input.type || input.type === NONE_OPTION || input.typeP == null || !Number.isFinite(input.typeP)) return "escalate";
  return input.typeP >= thresholds.type ? "accept" : "escalate";
}
