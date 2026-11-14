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
 * (decision 12). No defaults ship yet: rollout PR 2 fits them. A model without thresholds has no
 * bands, so every card escalates with its hint, and Tier 1 runs in suggest mode.
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

export interface ThresholdRecord extends Thresholds {
  /** How they were fitted; only `held-out` thresholds put a model in stage mode. */
  fit: "in-sample" | "held-out";
}

/**
 * DR's recommended defaults per question set and canonical model. Empty until rollout PR 2 fits
 * them with the harness (`fit-thresholds.ts`).
 */
export const DEFAULT_THRESHOLDS: Readonly<Record<string, Readonly<Record<string, ThresholdRecord>>>> = {};

/** The thresholds for a question set and canonical model: an override, else the default, else null (no bands). */
export function thresholdsFor(
  qset: string,
  canonicalModel: string,
  override?: Partial<Thresholds> | null,
  defaults: Readonly<Record<string, Readonly<Record<string, ThresholdRecord>>>> = DEFAULT_THRESHOLDS
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
  defaults: Readonly<Record<string, Readonly<Record<string, ThresholdRecord>>>> = DEFAULT_THRESHOLDS
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
