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
 * How "meets the targets within its interval" (section 6) is read:
 *
 * - `within-interval` (the rule): the band's Wilson 95% interval reaches the target (upper bound >=
 *   target), so the held-out corpus is consistent with the target. A point estimate below the
 *   target passes when the shortfall is within sampling error; one whose whole interval is below
 *   the target fails.
 * - `lower-bound`: the whole interval clears the target (lower bound >= target), the stricter
 *   reading, for comparison.
 *
 * Either way a band with no cards on the held-out corpus fails: there is nothing to verify.
 */
export type HeldOutRule = "within-interval" | "lower-bound";
export const HELD_OUT_RULE: HeldOutRule = "within-interval";

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

/** Whether a band's precision meets a target under a rule; a band with no cards never does. */
export function meetsTarget(band: BandCount, target: number, rule: HeldOutRule = HELD_OUT_RULE): boolean {
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
  rule: HeldOutRule = HELD_OUT_RULE
): HeldOutVerdict {
  const accept = meetsTarget(bands.accept, targets.typePrecision, rule);
  const notElement = meetsTarget(bands.notElement, targets.nonePrecision, rule);
  return { pass: accept && notElement, accept, notElement };
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
  /** Accept band: cards, and those whose layer and type match gold. */
  accept: BandCount;
  /** Not-element band: cards, and those gold calls `none`. */
  notElement: BandCount;
}

/** A held-out record's verdict under targets and a rule (the record keeps counts, so targets can change in review). */
export function verdictOf(record: HeldOutRecord, targets: Tier1Targets = TIER1_TARGETS, rule: HeldOutRule = HELD_OUT_RULE): HeldOutVerdict {
  return heldOutVerdict({ accept: record.accept, notElement: record.notElement }, targets, rule);
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
    // Refitted on the spec the CLI bundles (0.12.0), whose criteria production sends; on spec 0.10.0
    // (clef@cbm012-kind-tier0-qset2, 2026-11-14) the same targets gave (0.6, 0.4, 0.6).
    // bun fit-thresholds.ts --run clef@cbm012-kind-tier0-qset2-spec012 --type-precision 0.88 --none-precision 0.9
    clef: {
      layer: 0.7,
      type: 0.5,
      none: 0.7,
      // Held-out: the viewer corpus (heldOut below) meets TIER1_TARGETS under HELD_OUT_RULE, so
      // codebase_extract runs in stage mode for Clef. Its own commit: drop it to stay in suggest mode.
      fit: "held-out",
      record: {
        run: "clef@cbm012-kind-tier0-qset2-spec012",
        corpora: { "dr-cli": 300, fastapi: 148, petclinic: 73 },
        cards: 521,
        specVersion: "0.12.0",
        date: "2026-11-16",
        targets: { typePrecision: 0.88, nonePrecision: 0.9, scope: "each-corpus", bound: "point" },
        accept: { cards: 26, typePrecision: 0.885 },
        notElement: { cards: 50, precision: 1 },
      },
      // B5: bun held-out.ts --run clef@cbm012-kind-tier0-qset2-spec012 (TIER1_CALIBRATION.md section 6)
      heldOut: {
        corpus: "viewer",
        sourceCommit: "607ca095cd56ce9ef8435f2880bf8e6d3c709fa5",
        run: "clef@cbm012-kind-tier0-qset2-spec012",
        cards: 290,
        specVersion: "0.12.0",
        date: "2026-11-16",
        accept: { cards: 4, correct: 4 },
        notElement: { cards: 23, correct: 22 },
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
