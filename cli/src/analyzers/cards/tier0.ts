/**
 * Tier 0 on cards: the analyzer's rules (src/analyzers/tier0-rules.ts) applied to a card and its
 * facts. Used by `dr analyzer classify` and by the classify-eval harness.
 */
import { declarationOf, evaluateTier0, type Tier0Outcome, type Tier0Rule, type Tier0Symbol } from "../tier0-rules.js";
import type { CardFacts } from "./types.js";

/** The card fields Tier 0 reads (a harness card, with its corpus field, also fits). */
export type Tier0Card = { label: string; name: string; file_path: string | null; source: string | null; signature: string | null };

export function tier0SymbolOf(card: Tier0Card, facts: CardFacts | undefined): Tier0Symbol {
  return {
    label: card.label,
    name: card.name,
    file_path: card.file_path,
    declaration: declarationOf(card.source, card.signature),
    decorator_names: facts?.decorator_names ?? [],
  };
}

export function tier0ForCard(card: Tier0Card, facts: CardFacts | undefined, rules: Tier0Rule[]): Tier0Outcome | null {
  return evaluateTier0(tier0SymbolOf(card, facts), rules);
}
