/**
 * Tier-0 classification rules: deterministic decisions about a code symbol's DR element type,
 * made before any model is asked (docs/analyzers/CASCADE_DESIGN.md).
 *
 * Rules are data. They live in an analyzer's extraction-heuristics.json as heuristics whose
 * `parameters` carry a `tier0` block:
 *
 *   labels      CBM labels the rule applies to ("Class", "Method", ...)
 *   when        conditions, all of which must match; each is a regular expression:
 *                 decorator    matches any of the symbol's decorator names ("GetMapping", "router.get")
 *                 declaration  matches the symbol's declaration line ("class Item(ItemBase, table=True):")
 *                 file         matches the symbol's file path
 *                 name         matches the symbol's name
 *               an empty `when` matches every symbol with one of the labels
 *   decide      "none" (not an element) or "layer.type": the answer, no model asked
 *   narrow      ["layer.type" | "layer.*", ...]: the only answers the classifier may choose from
 *               (besides "none")
 *   confidence  "high" | "medium" | "low"
 *
 * Rules are evaluated in file order and the first rule that matches wins, so specific rules
 * come before the fallbacks for a label.
 */
import type { AnalyzerHeuristic } from "./types.js";

export type Tier0Confidence = "high" | "medium" | "low";

export interface Tier0Rule {
  name: string;
  labels: string[];
  when: { decorator?: RegExp; declaration?: RegExp; file?: RegExp; name?: RegExp };
  decide?: { layer: string; type: string | null } | "none";
  narrow?: Array<{ layer: string; type: string | null }>;
  confidence: Tier0Confidence;
}

/** What a Tier-0 rule needs to know about a symbol. */
export interface Tier0Symbol {
  label: string;
  name: string;
  file_path?: string | null;
  declaration?: string | null;
  decorator_names?: string[];
}

export type Tier0Outcome =
  | { kind: "decide"; rule: string; layer: string; type: string | null; confidence: Tier0Confidence }
  | { kind: "narrow"; rule: string; candidates: Array<{ layer: string; type: string | null }>; confidence: Tier0Confidence };

const WHEN_KEYS = ["decorator", "declaration", "file", "name"] as const;

function parseTarget(ruleName: string, s: unknown): { layer: string; type: string | null } {
  if (typeof s !== "string") throw new Error(`Tier-0 rule ${ruleName}: target must be a string, got ${JSON.stringify(s)}`);
  const m = /^([a-z][a-z-]*)\.([a-z][a-z0-9-]*|\*)$/.exec(s);
  if (!m) throw new Error(`Tier-0 rule ${ruleName}: '${s}' is not 'layer.type' or 'layer.*'`);
  return { layer: m[1], type: m[2] === "*" ? null : m[2] };
}

/** Compile the Tier-0 rules out of an analyzer's heuristics, in order. Throws on a malformed rule. */
export function tier0RulesFrom(heuristics: AnalyzerHeuristic[]): Tier0Rule[] {
  const rules: Tier0Rule[] = [];
  for (const h of heuristics) {
    const t = (h.parameters as Record<string, unknown> | undefined)?.tier0 as Record<string, unknown> | undefined;
    if (!t) continue;
    const labels = t.labels;
    if (!Array.isArray(labels) || !labels.length || !labels.every((l) => typeof l === "string")) {
      throw new Error(`Tier-0 rule ${h.name}: labels must be a non-empty list of CBM labels`);
    }
    const whenRaw = (t.when ?? {}) as Record<string, unknown>;
    const when: Tier0Rule["when"] = {};
    for (const [k, v] of Object.entries(whenRaw)) {
      if (!(WHEN_KEYS as readonly string[]).includes(k)) throw new Error(`Tier-0 rule ${h.name}: unknown condition '${k}' (known: ${WHEN_KEYS.join(", ")})`);
      if (typeof v !== "string") throw new Error(`Tier-0 rule ${h.name}: condition '${k}' must be a regular expression string`);
      when[k as (typeof WHEN_KEYS)[number]] = new RegExp(v);
    }
    if ((t.decide === undefined) === (t.narrow === undefined)) throw new Error(`Tier-0 rule ${h.name}: give exactly one of decide or narrow`);
    const confidence = (t.confidence ?? "medium") as Tier0Confidence;
    if (!["high", "medium", "low"].includes(confidence)) throw new Error(`Tier-0 rule ${h.name}: confidence must be high, medium or low`);
    const rule: Tier0Rule = { name: h.name, labels: labels as string[], when, confidence };
    if (t.decide !== undefined) {
      rule.decide = t.decide === "none" ? "none" : parseTarget(h.name, t.decide);
      if (rule.decide !== "none" && rule.decide.type === null) throw new Error(`Tier-0 rule ${h.name}: decide needs a type, not 'layer.*'`);
    } else {
      if (!Array.isArray(t.narrow) || !t.narrow.length) throw new Error(`Tier-0 rule ${h.name}: narrow must be a non-empty list`);
      rule.narrow = t.narrow.map((n) => parseTarget(h.name, n));
    }
    rules.push(rule);
  }
  return rules;
}

/**
 * The declaration line of a symbol: the first line of its source that is not blank, a comment or
 * a decorator/annotation ("class Item(ItemBase, table=True):", "public interface OwnerRepository
 * extends JpaRepository<Owner, Integer> {"). Falls back to the signature.
 */
export function declarationOf(source: string | null | undefined, signature?: string | null): string | null {
  for (const raw of (source ?? "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("@") || line.startsWith("//") || line.startsWith("#") || line.startsWith("/*") || line.startsWith("*")) continue;
    return line;
  }
  return signature?.trim() || null;
}

function matches(rule: Tier0Rule, s: Tier0Symbol): boolean {
  if (!rule.labels.includes(s.label)) return false;
  const { decorator, declaration, file, name } = rule.when;
  if (decorator && !(s.decorator_names ?? []).some((d) => decorator.test(d))) return false;
  if (declaration && !(s.declaration && declaration.test(s.declaration))) return false;
  if (file && !(s.file_path && file.test(s.file_path))) return false;
  if (name && !name.test(s.name)) return false;
  return true;
}

/** Apply the rules to one symbol: the first matching rule's decision or narrowing, or null. */
export function evaluateTier0(symbol: Tier0Symbol, rules: Tier0Rule[]): Tier0Outcome | null {
  for (const rule of rules) {
    if (!matches(rule, symbol)) continue;
    if (rule.decide === "none") return { kind: "decide", rule: rule.name, layer: "none", type: null, confidence: rule.confidence };
    if (rule.decide) return { kind: "decide", rule: rule.name, layer: rule.decide.layer, type: rule.decide.type, confidence: rule.confidence };
    return { kind: "narrow", rule: rule.name, candidates: rule.narrow!, confidence: rule.confidence };
  }
  return null;
}
