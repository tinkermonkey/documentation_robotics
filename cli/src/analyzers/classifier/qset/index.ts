/**
 * Question sets. The current one is what Tier 1 asks; older ids stay importable for the harness,
 * which measures one against another before a new one becomes the default (TIER1_DESIGN.md 3.3).
 */
import * as v1 from "./v1.js";

export { v1 };
export type { Narrowing, Concern } from "./v1.js";

/** Every question set by id. */
export const QSETS = { [v1.QSET_ID]: v1 } as const;

/** The question set Tier 1 asks. */
export const CURRENT_QSET = v1;
export const CURRENT_QSET_ID = v1.QSET_ID;

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

/** `dr-qset-1`, or `dr-qset-1+core+facts` and so on for a harness variant. Production asks no variant. */
export function qsetVariantId(variant: QsetVariant = {}, base: string = CURRENT_QSET_ID): string {
  const parts = [base];
  if (variant.noKindNarrow) parts.push("no-kind");
  if (variant.criteria === "core") parts.push("core");
  if (variant.facts) parts.push("facts");
  if (variant.charter) parts.push(`charter-${variant.charter}`);
  return parts.join("+");
}
