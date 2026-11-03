/**
 * Harness side of Tier 0: the cbm analyzer's rules (spec/dist/analyzers/cbm.json) applied to a
 * card plus its facts (facts.ts). The rule engine itself is the CLI's (src/analyzers/tier0-rules.ts),
 * so what is measured here is what the production card builder will run.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { declarationOf, evaluateTier0, tier0RulesFrom, type Tier0Outcome, type Tier0Rule } from "../../../src/analyzers/tier0-rules.js";
import type { AnalyzerHeuristic } from "../../../src/analyzers/types.js";
import { repoRoot } from "./env.js";
import { corpusDir, readJsonl } from "./io.js";
import type { Card, Facts } from "./types.js";

export type { Tier0Outcome } from "../../../src/analyzers/tier0-rules.js";

export function loadTier0Rules(): Tier0Rule[] {
  const f = path.join(repoRoot(), "spec", "dist", "analyzers", "cbm.json");
  const cbm = JSON.parse(readFileSync(f, "utf8")) as { heuristics: { heuristics: AnalyzerHeuristic[] } };
  return tier0RulesFrom(cbm.heuristics.heuristics);
}

export function loadFacts(corpus: string): Map<string, Facts> {
  const f = path.join(corpusDir(corpus), "facts.jsonl");
  if (!existsSync(f)) throw new Error(`${f} not found; run \`bun facts.ts --corpus ${corpus}\` first`);
  return new Map(readJsonl<Facts>(f).map((x) => [x.card_id, x]));
}

export function tier0For(card: Card, facts: Facts | undefined, rules: Tier0Rule[]): Tier0Outcome | null {
  return evaluateTier0(
    {
      label: card.label,
      name: card.name,
      file_path: card.file_path,
      declaration: declarationOf(card.source, card.signature),
      decorator_names: facts?.decorator_names ?? [],
    },
    rules,
  );
}
