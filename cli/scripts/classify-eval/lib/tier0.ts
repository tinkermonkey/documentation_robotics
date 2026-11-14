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
