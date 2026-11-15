/**
 * Stopping a harness run on a failure that asking again can't fix, as the CLI's run loop does
 * (TIER1_DESIGN.md section 4.6): `routing` (an upstream outside the pinned one answered, or none
 * could), `api` (the provider's response changed shape), `auth` (the key was refused) and `payment`
 * (no credits, or a spent budget). Once one happens the rest of the pool is skipped and the run
 * exits non-zero naming it. Other failures (a timeout, a 5xx after retries, an unusable answer) are
 * recorded per card, as before.
 *
 * Dependency-free (no SDK), so the CLI's test suite can exercise it.
 */
import { DecisionModelError } from "../../../src/analyzers/classifier/decision-model/types.js";

export const FATAL_KINDS: ReadonlySet<string> = new Set(["routing", "api", "auth", "payment"]);

export class RunGuard {
  /** The failure that stopped the run, or null. */
  stopped: { kind: string; message: string; cardId: string } | null = null;
  /** Cards not started because the run had stopped. */
  skipped = 0;

  /** Whether to skip this card: the run has stopped (counted). */
  shouldSkip(): boolean {
    if (!this.stopped) return false;
    this.skipped++;
    return true;
  }

  /** Record a card's failure; true when it stops the run (the first fatal one is kept). */
  record(e: unknown, cardId: string): boolean {
    if (e instanceof DecisionModelError && FATAL_KINDS.has(e.kind)) {
      this.stopped ??= { kind: e.kind, message: e.message, cardId };
      return true;
    }
    return false;
  }

  /** The line to exit with, or null when the run didn't stop. */
  summary(): string | null {
    if (!this.stopped) return null;
    return `Stopped (${this.stopped.kind}) at card ${this.stopped.cardId}: ${this.stopped.message}. ${this.skipped} card(s) not asked; rerun to resume once fixed.`;
  }
}

/** What a failed call was billed for (a stage that answered, a 200 that couldn't be used, a response from the wrong upstream), or null. */
export function billedCostOf(e: unknown): number | null {
  return e instanceof DecisionModelError && e.billed ? e.billed.costUsd : null;
}
