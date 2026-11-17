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
 * carry their fit record. They are `in-sample` (suggest mode) until the held-out corpora scored with
 * them meet `TIER1_TARGETS` under `HELD_OUT_RULE` and `HELD_OUT_POOLING`, band by band: a default whose
 * not-element band alone passes is marked `heldOutBands: ["not-element"]`, and Tier 1 hides that band
 * without the agent while the accept band stays a suggestion (hide mode); one whose bands both pass is
 * `held-out`, and Tier 1 also stages the accept band (stage mode). A model without thresholds has no
 * bands, so every card escalates with its hint.
 */
import { NONE_OPTION } from "./criteria.js";

export type Band = "accept" | "not-element" | "escalate";

/**
 * suggest: cards carry the hint, nothing is staged or hidden by Tier 1 alone. hide: the not-element
 * band is held-out verified, so Tier 1 hides it without the agent; the accept band stays a suggestion.
 * stage: both bands are held-out verified, so Tier 1 also stages the accept band.
 */
export type Tier1Mode = "suggest" | "hide" | "stage";

/** A band that can be verified on held-out labels on its own. */
export type HeldOutBand = "accept" | "not-element";

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
  /**
   * The in-sample gold scored against: `october` (the October 2026 labels, now
   * `gold@october.jsonl`), `2026-11-16` (relabelled with the held-out corpora's prompt, now
   * `gold@pre-declared-shape.jsonl`) or `2026-11-17` (that relabel with the "declared-shape"
   * revision, now `gold.jsonl`). Absent on records made before the relabel: October's.
   */
  gold?: string;
  /** Why the thresholds are what they are when they aren't simply the fit's pick. */
  note?: string;
}

export interface ThresholdRecord extends Thresholds {
  /** How they were fitted; `held-out` (both bands verified) puts a model in stage mode. */
  fit: "in-sample" | "held-out";
  /**
   * The bands verified on held-out labels when not both are (`fit` stays `in-sample`):
   * `["not-element"]` puts the model in hide mode. `fit: "held-out"` means both bands. Each band named
   * must pass `verdictOf(heldOut)`, which a unit test checks.
   */
  heldOutBands?: readonly HeldOutBand[];
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
 * 4). First chosen to reproduce Clef's in-sample defaults (TIER1_CALIBRATION.md section 3); the
 * maintainer kept them after the held-out results (section 10: "keep it reasonable", not raised to
 * 0.95, which would end hide mode on the viewer's 94.1%). TIER1_CALIBRATION.md section 6 shows the
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
 * the smallest band that can clear the 0.88 type-precision target under the lower-bound
 * rule even with every card right is 29 (Wilson lower bound of 29/29 = 0.883, of 28/28 = 0.879), so
 * below 30 the verdict would rest on a perfect score alone; at 30 one wrong card already fails 0.88
 * (29/30 lower bound 0.833), and a band of 30 has a Wilson half-width of about 9-11 points around
 * precisions of 0.90-0.95. It is the top of the 20-30 the review suggested; under the lower-bound
 * rule the not-element target (0.90) needs at least 35 cards, all right, in any case.
 */
export const HELD_OUT_MIN_CARDS = 30;

/**
 * How a verdict reads several held-out corpora (maintainer's decision, TIER1_CALIBRATION.md section 9):
 *
 * - `pooled-with-floor` (the rule): the band pooled over the corpora meets its target under
 *   {@link HELD_OUT_RULE}, and no corpus's point estimate for the band is under the target (a corpus
 *   with no cards in the band doesn't count). Pooling gives the interval its size; the floor keeps a
 *   corpus where the band does badly from hiding inside a pooled pass.
 * - `pooled`: the pooled band alone.
 * - `each-corpus`: every corpus's own band meets the target under the rule (each needs
 *   {@link HELD_OUT_MIN_CARDS} cards and its own lower bound), which a few hundred cards a corpus rarely
 *   allow.
 */
export type HeldOutPooling = "pooled-with-floor" | "pooled" | "each-corpus";
export const HELD_OUT_POOLING: HeldOutPooling = "pooled-with-floor";

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

/** One held-out corpus in a record: where its cards came from, and its bands. */
export interface HeldOutCorpus {
  corpus: string;
  /** The commit its cards were built from. */
  sourceCommit: string;
  /** Model-asked cards. */
  cards: number;
  accept: BandCount;
  notElement: BandCount;
}

/** A default's thresholds scored on the held-out corpora: what `held-out.ts` prints. */
export interface HeldOutRecord {
  /** The held-out corpora, each with its bands; `accept` and `notElement` below are their sums. */
  corpora: readonly HeldOutCorpus[];
  /** The harness run scored: its prediction file stem. */
  run: string;
  /** Model-asked cards, over the corpora. */
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
  /** Accept band, pooled: cards, and those whose layer and type match gold. */
  accept: BandCount;
  /** Not-element band, pooled: cards, and those gold calls `none`. */
  notElement: BandCount;
}

/** Whether one band of a record meets its target under a rule and a pooling. */
function bandMeets(
  pooled: BandCount,
  perCorpus: readonly BandCount[],
  target: number,
  rule: HeldOutRule,
  pooling: HeldOutPooling,
  minCards: number
): boolean {
  if (pooling === "each-corpus") return perCorpus.length > 0 && perCorpus.every((b) => meetsTarget(b, target, rule, minCards));
  if (!meetsTarget(pooled, target, rule, minCards)) return false;
  return pooling === "pooled" || perCorpus.every((b) => b.cards === 0 || b.correct / b.cards >= target - 1e-12);
}

/**
 * A held-out record's verdict under targets, a rule and a pooling, band by band (the record keeps
 * counts, so all three can change in review without a re-run).
 */
export function verdictOf(
  record: HeldOutRecord,
  targets: Tier1Targets = TIER1_TARGETS,
  rule: HeldOutRule = HELD_OUT_RULE,
  minCards: number = HELD_OUT_MIN_CARDS,
  pooling: HeldOutPooling = HELD_OUT_POOLING
): HeldOutVerdict {
  const accept = bandMeets(record.accept, record.corpora.map((c) => c.accept), targets.typePrecision, rule, pooling, minCards);
  const notElement = bandMeets(record.notElement, record.corpora.map((c) => c.notElement), targets.nonePrecision, rule, pooling, minCards);
  return { pass: accept && notElement, accept, notElement };
}

/** The bands of a default verified on held-out labels: both for `fit: "held-out"`, else `heldOutBands`. */
export function heldOutBandsOf(record: Pick<ThresholdRecord, "fit" | "heldOutBands"> | undefined): HeldOutBand[] {
  if (!record) return [];
  if (record.fit === "held-out") return ["accept", "not-element"];
  return [...new Set(record.heldOutBands ?? [])];
}

/** Thresholds by question set, then canonical model. */
export type ThresholdDefaults = Readonly<Record<string, Readonly<Record<string, ThresholdRecord>>>>;

/**
 * DR's recommended defaults per question set and canonical model, fitted with the classify-eval
 * harness (`fit-thresholds.ts`, docs/analyzers/TIER1_CALIBRATION.md) on the three in-sample corpora.
 * `heldOut` is the default scored on the held-out corpora (`held-out.ts`); `fit` is `held-out` only
 * when that record passes the targets for both bands, and `heldOutBands` names only bands it passes
 * for (`verdictOf`), which a unit test checks.
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
    // "Modelling rules:" paragraph (criteria.ts, layerScopeCriterion), as production sends them,
    // first on October's gold (TIER1_CALIBRATION.md section 6), then scored on the gold relabelled
    // 2026-11-16 and kept (section 10): on that gold the each-corpus fit is a tie on 11 cards at
    // T_layer 0.8 and the pooled fit (0.5, 0.4) at 88.9%, while (0.6, 0.4) holds 91.3% pooled.
    // Re-measured 2026-11-17 on spec 0.13.0 with the maintainer's rulings of that day (a declared
    // shape is an object schema, application.message), the rewritten Tier-0 interface rule and the
    // gold's "declared-shape" revision (section 12), and kept again.
    // bun fit-thresholds.ts --run clef@cbm012-kind-tier0-qset2-spec013-shape --type-precision 0.88 --none-precision 0.9 --scope pooled
    clef: {
      layer: 0.6,
      type: 0.4,
      none: 0.6,
      fit: "in-sample",
      record: {
        run: "clef@cbm012-kind-tier0-qset2-spec013-shape",
        corpora: { "dr-cli": 300, fastapi: 148, petclinic: 73 },
        cards: 521,
        specVersion: "0.13.0",
        date: "2026-11-17",
        targets: { typePrecision: 0.88, nonePrecision: 0.9, scope: "pooled", bound: "point" },
        accept: { cards: 107, typePrecision: 0.925 },
        notElement: { cards: 93, precision: 0.957 },
        gold: "2026-11-17",
        note:
          "Kept at (0.6, 0.4, 0.6), not refitted, as on 2026-11-16: with the 2026-11-17 definitions and gold revision the pooled fit is " +
          "(0.5, 0.4, 0.5), which accepts 155 cards at 88.4% and hides 151 at 90.1%, both at the edge of the targets (fastapi's hidden band " +
          "68.6% there). (0.6, 0.4, 0.6) meets the targets pooled with margin: 92.5% accepted, 95.7% hidden.",
      },
      // Held out on four corpora (TIER1_CALIBRATION.md sections 7, 9 and 12):
      //   bun held-out.ts --run clef@cbm012-kind-tier0-qset2-spec013-shape --corpus viewer,jaeger-ui,miniflux,eshop
      // Not-element: 202 of 206 (98.1%, Wilson lower bound 95.1%), every corpus at 93.6% or more, so
      // that band is verified and Clef hides it (hide mode). Accept: 112 of 138 (81.2%, lower bound
      // 73.8%), eshop 70.1%: not verified, so the accept band stays a suggestion. The rulings behind
      // these criteria came from viewer and eshop cards, so those two corpora are no longer unseen;
      // jaeger-ui and miniflux alone give 113 of 114 hidden.
      heldOutBands: ["not-element"],
      heldOut: {
        corpora: [
          { corpus: "viewer", sourceCommit: "607ca095cd56ce9ef8435f2880bf8e6d3c709fa5", cards: 290, accept: { cards: 64, correct: 61 }, notElement: { cards: 47, correct: 44 } },
          { corpus: "jaeger-ui", sourceCommit: "d6bbc16428e0e195f5e1e6bc7a2a400ef48a3c7b", cards: 294, accept: { cards: 3, correct: 1 }, notElement: { cards: 66, correct: 66 } },
          { corpus: "miniflux", sourceCommit: "fb043227ef6ad98569c848e8cdade0d237dab87e", cards: 217, accept: { cards: 4, correct: 3 }, notElement: { cards: 48, correct: 47 } },
          { corpus: "eshop", sourceCommit: "913acea66708a59595351174cee9b29f37179d29", cards: 300, accept: { cards: 67, correct: 47 }, notElement: { cards: 45, correct: 45 } },
        ],
        run: "clef@cbm012-kind-tier0-qset2-spec013-shape",
        cards: 1101,
        specVersion: "0.13.0",
        date: "2026-11-17",
        serving: { provider: "cloudflare-workers-ai", upstream: null },
        criteriaDigest: "78797e453b54d523caad8151d67982692c26a0a649ceed6c50db6f37fcbaf319",
        accept: { cards: 138, correct: 112 },
        notElement: { cards: 206, correct: 202 },
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

/**
 * The mode DR's defaults allow a model, from the bands verified on held-out labels: stage for both,
 * hide for the not-element band alone, suggest otherwise (an accept band verified alone stages
 * nothing: there is no stage-only mode).
 */
export function modeOf(
  qset: string,
  canonicalModel: string,
  defaults: ThresholdDefaults = DEFAULT_THRESHOLDS
): Tier1Mode {
  const bands = heldOutBandsOf(defaults[qset]?.[canonicalModel]);
  if (bands.includes("accept") && bands.includes("not-element")) return "stage";
  return bands.includes("not-element") ? "hide" : "suggest";
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
