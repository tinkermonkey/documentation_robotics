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
  overrideTier0Advice,
  parseDecision,
  ruleNameFor,
  type CompiledRule,
  type ProjectRule,
} from "../../analyzers/project-rules.js";
import type { Tier0Outcome } from "../../analyzers/tier0-rules.js";
import { normFile } from "../../analyzers/triage.js";
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
  name: z
    .string()
    .min(1)
    .optional()
    .describe("A regular expression on the symbol's bare name, without its class: _copy_grooves, not Assembly._copy_grooves (Error$)."),
  symbol: z
    .string()
    .min(1)
    .optional()
    .describe(
      "A regular expression on the card's symbol as cards show it: Class.method for a method (^Assembly\\._copy_grooves$), METHOD /path for a route, else the name."
    ),
  declaration: z.string().min(1).optional().describe("A regular expression on the declaration (\\bextends\\s+\\w*Error\\b)."),
  ownerType: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional()
    .describe("For a member: the layer.type of the element its class is (application.dataobject), or none when the class has no element."),
});

export const decideItemSchema = strictItem("A decide[] item", {
  name: z.string().min(1).optional().describe("A name for the rule (kebab-case). Default: derived from what it decides."),
  where: whereSchema.optional().describe("Which cards: every condition given must hold. At least one condition."),
  card: z
    .string()
    .min(1)
    .optional()
    .describe("One card instead of where: its cardId, or a symbol (or file#symbol) only one card has, among the last run's cards or this run's symbols."),
  relationship: strictItem("A decide[] item's relationship", {
    source: z.string().min(1).optional().describe("The source element id."),
    predicate: z.string().min(1).describe("The predicate, e.g. realizes."),
    target: z.string().min(1).optional().describe("The target element id. Leave out for every target."),
  })
    .optional()
    .describe("Relationships instead of cards (as: none only): the predicate and a source, a target or both."),
  as: z.string().min(1).describe("What they are: a layer.type (application.applicationfunction), or none (not a model element; not a relationship)."),
  reason: z.string().min(1).describe("Why, in a few words. Kept with the rule."),
  attributes: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "With a layer.type: attributes for the elements it stages, what the type requires and the code can't give ({type: \"button\"}; spec_type lists them). The code's own facts win. Kept with the rule."
    ),
  overrideTier0: z
    .boolean()
    .optional()
    .describe(
      "With as: none on a where item: also take the symbols Tier 0 decided as elements (it would stage them). Default false: those stay Tier 0's and ruleWarnings says how many the item matched."
    ),
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
  /** A none item: symbols it matched that Tier 0 decided as elements and kept, since the item doesn't say overrideTier0. */
  tier0Kept?: number;
  /** A none item with overrideTier0: symbols Tier 0 decided as elements that it took. */
  tier0Overridden?: number;
  /** A kept none item: recorded rejections it covers, removed from decisions.json because the rule now holds them. */
  retired?: number;
}

export interface CompiledDecide {
  /** The where and relationship items as rules, in the order sent, each with its place in the call. */
  rules: Array<{ index: number; compiled: CompiledRule; keep: boolean }>;
  /** Card decisions, by cardId: planned under a rule name of their own ({@link cardRuleName}). */
  byCard: Map<
    string,
    { index: number; decision: CompiledRule["decision"]; rule: string; reason: string; card: CardRef; attributes?: Record<string, unknown> }
  >;
  /** Items that can't be applied as sent. */
  problems: DecideResult[];
}

/** What a card item resolves to: a card of the last run, or a symbol of this run. */
export type CardRef = Pick<UndecidedCard, "cardId" | "file" | "symbol" | "label" | "qualifiedName"> & Partial<UndecidedCard>;

/**
 * Whether a reference names a card's code: its symbol, its qualified name, or `file#symbol` (a ./
 * prefix or backslashes allowed). The whole `file#symbol` is compared, so a symbol with a `#` in it
 * (`Foo.#bar`) is read whole.
 */
export function namesCode(code: { file: string | null; symbol: string; qualifiedName?: string }, ref: string): boolean {
  return code.symbol === ref || code.qualifiedName === ref || normFile(`${code.file ?? ""}#${code.symbol}`) === normFile(ref);
}

/** The cards a card item names: by cardId, else by symbol, file#symbol or qualified name ({@link namesCode}). */
export function cardsNamed<T extends CardRef>(cards: readonly T[], ref: string): T[] {
  const byId = cards.filter((c) => c.cardId === ref);
  return byId.length ? byId : cards.filter((c) => namesCode(c, ref));
}

/**
 * Check the decide items and turn them into rules. A card item is resolved against the last run's
 * cards (`cards`), then against this run's symbols (`runCards`, #1394), so a symbol or file#symbol
 * the run has is found though the last run's record doesn't list it; a card nothing has, or that
 * several have, is a problem. An item that names none or several of where, card and relationship is
 * a problem; the other items still apply.
 */
export function compileDecide(
  items: readonly DecideItem[],
  cards: readonly CardRef[],
  takenNames: ReadonlySet<string>,
  runCards: readonly CardRef[] = []
): CompiledDecide {
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
      const fromLast = cardsNamed(cards, ref);
      const matches = fromLast.length ? fromLast : cardsNamed(runCards, ref);
      if (matches.length !== 1) {
        problem(
          matches.length ? "ambiguous" : "no-match",
          matches.length
            ? `'${ref}' names more than one card: ${matches.map((c) => c.cardId).join(", ")}`
            : `'${ref}' is not a card of the last run (or the last preview, when no run has been made), nor a symbol this run read`,
          ["Pass the card's cardId, as the cards list it, or file#symbol with the card's file and symbol"]
        );
        return;
      }
      try {
        const decision = parseDecision(`card ${ref}`, item.as);
        if (item.attributes && decision.kind !== "type") throw new Error(`card ${ref}: attributes go with a layer.type, not with as: none`);
        out.byCard.set(matches[0].cardId, {
          index,
          decision,
          rule: `${PROJECT_RULE_PREFIX}${cardRuleName(index)}`,
          reason: item.reason,
          card: matches[0],
          ...(item.attributes ? { attributes: item.attributes } : {}),
        });
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
      const compiled = compileRule({
        name,
        ...base,
        reason: item.reason,
        ...(item.attributes !== undefined ? { attributes: item.attributes } : {}),
        ...(item.overrideTier0 !== undefined ? { overrideTier0: item.overrideTier0 } : {}),
      });
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
          : {
              kind: "decide",
              layer: d.decision.layer,
              type: d.decision.type,
              ...(d.attributes ? { attributes: d.attributes } : {}),
              rule: d.rule,
              confidence: "high",
            };
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
  overrodeTier0?: { decided: number; rejected: number; types?: Record<string, number> };
  /** A none rule without overrideTier0: symbols it matched that Tier 0 decided as elements and staged (#1424). */
  tier0Kept?: number;
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
  overrode?: ReadonlyMap<string, { decided: number; rejected: number; types?: Record<string, number> }>,
  tier0Kept?: ReadonlyMap<string, number>
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
    ...(tier0Kept?.get(rule.name) ? { tier0Kept: tier0Kept.get(rule.name)! } : {}),
    sample: all.slice(0, sampleSize),
    sampleOf: all.length,
  };
}

/** `type: n` for the first few types, largest first, and how many more. */
function typeCounts(types: Record<string, number> | undefined): string {
  const entries = Object.entries(types ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = entries.slice(0, 3).map(([t, n]) => `${t}: ${n}`);
  return entries.length > 3 ? `${shown.join(", ")}, and ${entries.length - 3} more type(s)` : shown.join(", ");
}

/**
 * The run's top-level warnings about rules and Tier 0 (#1424), one per rule: a `none` rule that
 * matched symbols Tier 0 decided as elements and left them to Tier 0 (they are staged), and one that
 * took them because it says `overrideTier0` (they are not). Never only a nested count: a rule that
 * removes Tier 0's deterministic results, or is kept from it, is said where the answer starts.
 * `keptTypes` gives, per rule, the types Tier 0 staged the kept symbols as; `inFile` names the rules
 * kept in documentation-robotics/extraction-rules.yaml, whose warning says where to add the key (a
 * kept rule that rejected these before CLI 0.9.0 needs it to go on doing so).
 */
export function ruleWarnings(
  reports: readonly RuleReport[],
  keptTypes: ReadonlyMap<string, Record<string, number>>,
  preview: boolean,
  inFile: ReadonlySet<string> = new Set()
): string[] {
  const out: string[] = [];
  for (const r of reports) {
    if (r.tier0Kept) {
      out.push(
        `Rule '${r.rule}' says none, but ${r.tier0Kept} symbol(s) it matches were decided by Tier 0 as elements (${typeCounts(keptTypes.get(r.rule))}): ` +
          `they stay Tier 0's and ${preview ? "would be" : "are"} staged. ${overrideTier0Advice(r.rule, r.tier0Kept, inFile.has(r.rule))} ` +
          "(a none rule takes what Tier 0 decided only with it, since CLI 0.9.0; preview: true first shows what it removes). " +
          "Otherwise narrow the rule's where so it covers only what Tier 0 left open."
      );
    }
    if (r.overrodeTier0?.decided) {
      out.push(
        `Rule '${r.rule}' says overrideTier0, so it takes ${r.overrodeTier0.decided} symbol(s) Tier 0 decided as elements (${typeCounts(r.overrodeTier0.types)}): ` +
          `they ${preview ? "would not be" : "are not"} staged.`
      );
    }
  }
  return out;
}
