/**
 * codebase_extract `decide`: decisions in bulk, by a stated rule or for one card.
 *
 * Each item says which code (`where`: files, label, visibility, nested, name, declaration,
 * ownerType; or one `card`; or a `relationship`) and what it is (`as`: a `layer.type`, or `none`),
 * with a reason. In a run the items are applied as project rules ahead of the project's own file
 * (src/analyzers/project-rules.ts), so they go through the same planning as Tier 0's decisions:
 * naming, attributes, validation, relationships. `keep: true` writes the item to
 * `documentation-robotics/extraction-rules.yaml`; without it a `none` decision is recorded for each
 * symbol it covered (as `reject` records them) and a typed one is simply staged.
 *
 * With `preview: true` nothing is written: the result gives each item's count and a sample.
 */
import { z } from "zod";
import { strictItem } from "../strict-schema.js";
import type { ExtractionGraph } from "../../analyzers/cards/extract.js";
import type { ElementPlan, UndecidedCard } from "../../analyzers/extraction-plan.js";
import {
  PROJECT_RULE_PREFIX,
  compileRule,
  parseDecision,
  ruleNameFor,
  type CompiledRule,
  type ProjectRule,
} from "../../analyzers/project-rules.js";
import type { Tier0Outcome } from "../../analyzers/tier0-rules.js";
import type { BatchItemResult } from "./batch-result.js";

const whereSchema = strictItem("A decide[] item's where", {
  files: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional()
    .describe("A file, a folder or a glob from the codebase root (scripts/, src/**/*.stories.tsx), or a list of them."),
  label: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional()
    .describe("The card's label: Function, Method, Class, Interface, Type, Enum, Route, ... or a list."),
  visibility: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional()
    .describe("exported or local (a top-level declaration); public, private or protected (a member); or a list."),
  nested: z.boolean().optional().describe("true: declared inside another function. false: not."),
  name: z.string().min(1).optional().describe("A regular expression on the symbol's name (Error$)."),
  declaration: z.string().min(1).optional().describe("A regular expression on the declaration (\\bextends\\s+\\w*Error\\b)."),
  ownerType: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional()
    .describe("For a member: the layer.type of the element its class is (application.dataobject), or none when the class has no element."),
});

export const decideItemSchema = strictItem("A decide[] item", {
  name: z.string().min(1).optional().describe("A name for the rule (kebab-case). Default: derived from what it decides."),
  where: whereSchema.optional().describe("Which cards: every condition given must hold. At least one condition."),
  card: z.string().min(1).optional().describe("One card instead of where: its cardId, or a symbol (or file#symbol) only one card has."),
  relationship: strictItem("A decide[] item's relationship", {
    source: z.string().min(1).optional().describe("The source element id."),
    predicate: z.string().min(1).describe("The predicate, e.g. realizes."),
    target: z.string().min(1).optional().describe("The target element id. Leave out for every target."),
  })
    .optional()
    .describe("Relationships instead of cards (as: none only): the predicate and a source, a target or both."),
  as: z.string().min(1).describe("What they are: a layer.type (application.applicationfunction), or none (not a model element; not a relationship)."),
  reason: z.string().min(1).describe("Why, in a few words. Kept with the rule."),
  keep: z
    .boolean()
    .optional()
    .describe("true: also write it to documentation-robotics/extraction-rules.yaml (commit that file), so every later run and checkout applies it."),
});

export type DecideItem = z.infer<typeof decideItemSchema>;

/** How one decide item fared (the batch result shape of batch-result.ts). */
export interface DecideResult extends BatchItemResult {
  /** The rule's name (given or derived); absent for a card decision. */
  rule?: string;
  as?: string;
  /** Symbols it covered that had no element: those it staged and those it said are not elements. */
  matched?: number;
  staged?: number;
  notElements?: number;
  /** Relationships it covered (a relationship item). */
  relationships?: number;
  /** With a since run: symbols a typed item covers that the range did not change, so they were not staged. */
  untouched?: number;
  /** A sample of what it covered (symbols, or relationships as source::predicate::target). */
  sample?: string[];
  /** Whether it was written to the project's rules file. */
  kept?: boolean;
}

export interface CompiledDecide {
  /** The where and relationship items as rules, in the order sent, each with its place in the call. */
  rules: Array<{ index: number; compiled: CompiledRule; keep: boolean }>;
  /** Card decisions, by cardId: planned under a rule name of their own ({@link cardRuleName}). */
  byCard: Map<string, { index: number; decision: CompiledRule["decision"]; rule: string; reason: string; card: UndecidedCard }>;
  /** Items that can't be applied as sent. */
  problems: DecideResult[];
}

/**
 * Check the decide items and turn them into rules. A card item is resolved against the last run's
 * cards (`cards`); a card nothing has, or that several have, is a problem. An item that names none
 * or several of where, card and relationship is a problem; the other items still apply.
 */
export function compileDecide(items: readonly DecideItem[], cards: readonly UndecidedCard[], takenNames: ReadonlySet<string>): CompiledDecide {
  const out: CompiledDecide = { rules: [], byCard: new Map(), problems: [] };
  const taken = new Set(takenNames);
  items.forEach((item, index) => {
    const problem = (status: string, reason: string, suggestions?: string[]) =>
      out.problems.push({ index, status, reason, ...(suggestions ? { suggestions } : {}), ...(item.name ? { rule: item.name } : {}), as: item.as });
    const named = (["where", "card", "relationship"] as const).filter((k) => item[k] !== undefined);
    if (named.length !== 1) {
      problem("invalid", `names ${named.length ? named.join(" and ") : "none of where, card and relationship"}: each item names exactly one of them`);
      return;
    }
    if (item.card !== undefined) {
      if (item.keep) {
        problem("invalid", "keep applies to a rule (where or relationship), not to one card", ["Leave keep out: a decision on one card is recorded as it is"]);
        return;
      }
      const ref = item.card;
      const hits = cards.filter((c) => c.cardId === ref);
      const matches = hits.length ? hits : cards.filter((c) => c.symbol === ref || `${c.file ?? ""}#${c.symbol}` === ref || c.qualifiedName === ref);
      if (matches.length !== 1) {
        problem(
          matches.length ? "ambiguous" : "no-match",
          matches.length ? `'${ref}' names more than one card: ${matches.map((c) => c.cardId).join(", ")}` : `'${ref}' is not a card of the last run (or the last preview, when no run has been made)`,
          ["Pass the card's cardId, as the cards list it"]
        );
        return;
      }
      try {
        const decision = parseDecision(`card ${ref}`, item.as);
        out.byCard.set(matches[0].cardId, { index, decision, rule: `${PROJECT_RULE_PREFIX}${cardRuleName(index)}`, reason: item.reason, card: matches[0] });
      } catch (error) {
        problem("invalid", error instanceof Error ? error.message : String(error), ["spec_type lists a layer's types"]);
      }
      return;
    }
    const base: Pick<ProjectRule, "where" | "relationship" | "as"> = {
      ...(item.where ? { where: item.where as ProjectRule["where"] } : {}),
      ...(item.relationship ? { relationship: item.relationship } : {}),
      as: item.as,
    };
    const name = item.name ?? ruleNameFor(base, taken);
    try {
      const compiled = compileRule({ name, ...base, reason: item.reason });
      taken.add(name);
      out.rules.push({ index, compiled, keep: item.keep === true });
    } catch (error) {
      problem("invalid", error instanceof Error ? error.message : String(error));
    }
  });
  return out;
}

/** The rule name a decision on one card is planned and reported under. */
export function cardRuleName(index: number): string {
  return `decide-card-${index}`;
}

/** The extraction with card decisions in place of those symbols' outcome, planned like a Tier-0 decision. */
export function withCardDecisions(extraction: ExtractionGraph, byCard: CompiledDecide["byCard"]): ExtractionGraph {
  if (!byCard.size) return extraction;
  return {
    ...extraction,
    symbols: extraction.symbols.map((s) => {
      const d = byCard.get(s.card.id);
      if (!d) return s;
      const tier0: Tier0Outcome =
        d.decision.kind === "none"
          ? { kind: "reject", rule: d.rule, confidence: "high" }
          : { kind: "decide", layer: d.decision.layer, type: d.decision.type, rule: d.rule, confidence: "high" };
      return { ...s, tier0 };
    }),
  };
}

/** How many symbols a sample names. */
export const SAMPLE_SIZE = 5;

/** What a rule decided in a plan, as the response reports it. */
export interface RuleReport {
  rule: string;
  as: string;
  /** Symbols it said are not elements. */
  notElements: number;
  /** Elements it adds. */
  staged: number;
  /** Relationships it kept from being staged. */
  relationships?: number;
  /** With a since run: symbols a typed rule covers that the range did not change. */
  untouched?: number;
  /** Of its notElements, symbols Tier 0 (or the node mapping) had decided as elements, or rejected, that this rule overrode. */
  overrodeTier0?: { decided: number; rejected: number };
  /** The first few it decided: symbols as file#symbol, staged elements as ids. */
  sample: string[];
  /** How many the sample is taken from. */
  sampleOf: number;
}

/** A rule's part of a plan as a report line: every rule gets one, one that decided nothing included (with 0s). */
export function ruleReport(
  rule: ProjectRule,
  plan: Pick<ElementPlan, "byRule">,
  untouched: ReadonlyMap<string, number>,
  relationships: ReadonlyMap<string, string[]>,
  sampleSize = SAMPLE_SIZE,
  overrode?: ReadonlyMap<string, { decided: number; rejected: number }>
): RuleReport {
  const decided = plan.byRule.get(rule.name);
  const rels = relationships.get(rule.name) ?? [];
  const left = untouched.get(rule.name) ?? 0;
  const none = decided?.none ?? [];
  const staged = decided?.staged ?? [];

  const all = [...staged, ...none.map((n) => `${n.file ?? ""}#${n.symbol}`), ...rels];
  return {
    rule: rule.name,
    as: rule.as,
    notElements: none.length,
    staged: staged.length,
    ...(rels.length ? { relationships: rels.length } : {}),
    ...(left ? { untouched: left } : {}),
    ...(overrode?.get(rule.name) ? { overrodeTier0: overrode.get(rule.name)! } : {}),
    sample: all.slice(0, sampleSize),
    sampleOf: all.length,
  };
}
