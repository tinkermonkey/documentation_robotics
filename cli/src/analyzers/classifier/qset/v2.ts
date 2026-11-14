/**
 * Question set dr-qset-2, the line-free state (TIER1_DESIGN.md section 3.3, decision 17): the
 * questions of dr-qset-1 unchanged, with a state that doesn't move when unrelated code moves.
 *
 * Two things differ from dr-qset-1, both in the state:
 *
 * - the `File:` line carries the path only, no line range;
 * - callers, callees and imports are sorted before the first 12 (15) are taken.
 *
 * So a card's state changes only when the symbol's own text, its file's imports or its neighbours
 * change. Everything else (stage-1 and stage-2 questions, the kind rule, concerns, significance, 40
 * source lines) is dr-qset-1's, re-exported from `v1.ts`.
 */
import type { StateCard, StateFacts, StateOptions } from "../state.js";
import { renderState } from "../state.js";
import { SOURCE_LINES } from "./v1.js";

export * from "./v1.js";

export const QSET_ID: string = "dr-qset-2";

/** How dr-qset-2 renders the state: no line range, sorted neighbour lists. */
export const STATE_OPTIONS: StateOptions = Object.freeze({ lineRange: false, sortNeighbours: true });

/** The state the model is sent for a card. `facts` is a harness experiment (`--facts`); dr-qset-2 sends none. */
export function stateOf(card: StateCard, facts?: StateFacts): string {
  return renderState(card, SOURCE_LINES, facts, STATE_OPTIONS);
}
