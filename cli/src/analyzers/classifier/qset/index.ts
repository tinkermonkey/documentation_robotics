/**
 * Question sets. The current one is what Tier 1 asks; older ids stay importable for the harness,
 * which measures one against another before a new one becomes the default (TIER1_DESIGN.md 3.3).
 */
import * as v1 from "./v1.js";
import * as v2 from "./v2.js";

export { v1, v2 };
export type { Narrowing, Concern } from "./v1.js";

/** What every question set module provides. */
export type QsetModule = typeof v1;

/** Every question set by id. */
export const QSETS: Readonly<Record<string, QsetModule>> = Object.freeze({ [v1.QSET_ID]: v1, [v2.QSET_ID]: v2 });

/**
 * The question set Tier 1 asks: dr-qset-2 since it met dr-qset-1 on all three corpora
 * (docs/analyzers/TIER1_CALIBRATION.md, 2026-11-14).
 */
export const CURRENT_QSET: QsetModule = v2;
export const CURRENT_QSET_ID: string = CURRENT_QSET.QSET_ID;

/** The question set module for an id (`dr-qset-2`), or an error naming the known ids. */
export function qsetById(id: string): QsetModule {
  const qset = QSETS[id];
  if (!qset) throw new Error(`Unknown question set ${id}; known: ${Object.keys(QSETS).join(", ")}`);
  return qset;
}

/** Harness experiments that change what is sent, each a suffix of the question set id. */
export interface QsetVariant {
  /** `--criteria core`: type criteria without the "Use X instead when" sentences. */
  criteria?: "full" | "core";
  /** `--facts`: Tier-0 facts and a placement line in the state. */
  facts?: boolean;
  /** `--charter full|short`: the design charter prepended to the state. */
  charter?: "full" | "short" | null;
  /** Kind narrowing off (`classify.ts` without `--kind-narrow`); dr-qset-1 has it on. */
  noKindNarrow?: boolean;
}

/** `dr-qset-2`, or `dr-qset-2+core+facts` and so on for a harness variant. Production asks no variant. */
export function qsetVariantId(variant: QsetVariant = {}, base: string = CURRENT_QSET_ID): string {
  const parts = [base];
  if (variant.noKindNarrow) parts.push("no-kind");
  if (variant.criteria === "core") parts.push("core");
  if (variant.facts) parts.push("facts");
  if (variant.charter) parts.push(`charter-${variant.charter}`);
  return parts.join("+");
}

/** The question set a (possibly variant) id names: `dr-qset-1+core` is `dr-qset-1`. */
export function baseQsetOf(id: string): string {
  return id.split("+")[0];
}
