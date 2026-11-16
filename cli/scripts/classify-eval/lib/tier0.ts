/**
 * Harness side of Tier 0: the cbm analyzer's rules (analyzers/cbm.json in the CLI's bundled spec,
 * a copy of spec/dist) applied to a card plus its facts (facts.ts). The rule engine itself is the
 * CLI's (src/analyzers/tier0-rules.ts), and tier0ForCard (src/analyzers/cards/tier0.ts) is what
 * `dr analyzer classify` calls, so what is measured here is what the CLI runs.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { tier0RulesFrom, type Tier0Outcome, type Tier0Rule } from "../../../src/analyzers/tier0-rules.js";
import { tier0ForCard } from "../../../src/analyzers/cards/index.js";
import { v1, type Narrowing } from "../../../src/analyzers/classifier/index.js";
import type { AnalyzerHeuristic } from "../../../src/analyzers/types.js";
import { SpecDataLoader } from "../../../src/core/spec-loader.js";
import { corpusDir, readJsonl } from "./io.js";
import type { Card, Facts } from "./types.js";

export type { Tier0Outcome } from "../../../src/analyzers/tier0-rules.js";

/**
 * The cbm analyzer's Tier-0 rules from the CLI's bundled spec (the source `lib/spec.ts` reads by
 * default), or from another compiled spec directory (`--spec-dist`, via `specDir()`).
 */
export function loadTier0Rules(specDist: string = new SpecDataLoader().getBundledDir()): Tier0Rule[] {
  const f = path.join(specDist, "analyzers", "cbm.json");
  const cbm = JSON.parse(readFileSync(f, "utf8")) as { heuristics: { heuristics: AnalyzerHeuristic[] } };
  return tier0RulesFrom(cbm.heuristics.heuristics);
}

export function loadFacts(corpus: string): Map<string, Facts> {
  const f = path.join(corpusDir(corpus), "facts.jsonl");
  if (!existsSync(f)) throw new Error(`${f} not found; run \`bun facts.ts --corpus ${corpus}\` first`);
  return new Map(readJsonl<Facts>(f).map((x) => [x.card_id, x]));
}

export function tier0For(card: Card, facts: Facts | undefined, rules: Tier0Rule[]): Tier0Outcome | null {
  return tier0ForCard(card, facts, rules);
}

/**
 * The narrowing a decision model gets through its option lists, as text for a Claude baseline, which
 * has no option list to cut: Tier 0's candidates, and the kind rule's application types
 * (`--kind-narrow`; pass no `kind` without it). As in stage 2 of the question set, a Tier-0 rule
 * that names application types replaces the kind rule. Empty when neither applies.
 */
export function narrowingNote(narrow: Narrowing | undefined, kind: string | undefined): string {
  const lines: string[] = [];
  const allowed = v1.narrowingKey(narrow);
  if (allowed) lines.push(`Structural rules allow only these answers for this symbol (layer.type; layer.* is any type of that layer): ${allowed.join(", ")}, or none.`);
  const tier0NamesApplicationTypes = !!narrow?.some((n) => n.layer === "application") && !narrow.some((n) => n.layer === "application" && n.type === null);
  const kindTypes = kind ? v1.KIND_CANDIDATES.application?.[kind] : undefined;
  if (kindTypes && !tier0NamesApplicationTypes) lines.push(`The symbol is a ${kind}. If it belongs to the application layer, its element type is one of: ${kindTypes.join(", ")}.`);
  return lines.join("\n");
}
