/**
 * Tier-0 classification rules: deterministic decisions about a code symbol's DR element type,
 * made before any model is asked (docs/analyzers/CASCADE_DESIGN.md).
 *
 * Rules are data. They live in an analyzer's extraction-heuristics.json as heuristics whose
 * `parameters` carry a `tier0` block, with exactly these keys:
 *
 *   labels      CBM labels the rule applies to ("Class", "Method", ...)
 *   when        conditions, all of which must match; each is a regular expression:
 *                 decorator    matches any of the symbol's decorator names ("GetMapping", "router.get")
 *                 declaration  matches the symbol's declaration (see declarationOf)
 *                 file         matches the symbol's file path
 *                 name         matches the symbol's name
 *               an empty or missing `when` matches every symbol with one of the labels
 *   decide      "layer.type": the answer, no model asked; or "none": the symbol is not an element
 *   narrow      ["layer.type" | "layer.*", ...]: the only answers the classifier may choose from
 *               (besides "none")
 *   confidence  "high" | "medium" | "low" (default "medium")
 *
 * Exactly one of decide and narrow. Unknown keys are rejected, so a misspelt `when` cannot turn a
 * rule into one that matches every symbol. Rules are evaluated in file order and the first rule
 * that matches wins, so specific rules come before the fallbacks for a label.
 */
import type { AnalyzerHeuristic } from "./types.js";

export type Tier0Confidence = "high" | "medium" | "low";

/** A layer and, for narrowing, an optional type (null = any type of that layer). */
export interface Tier0Target {
  layer: string;
  type: string | null;
}

export type Tier0Action =
  | { kind: "decide"; layer: string; type: string }
  | { kind: "reject" }
  | { kind: "narrow"; candidates: Tier0Target[] };

export interface Tier0Rule {
  name: string;
  labels: string[];
  when: { decorator?: RegExp; declaration?: RegExp; file?: RegExp; name?: RegExp };
  action: Tier0Action;
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

/** The first matching rule's action, with the rule's name and confidence. */
export type Tier0Outcome = Tier0Action & { rule: string; confidence: Tier0Confidence };

const TIER0_KEYS = ["labels", "when", "decide", "narrow", "confidence"] as const;
const WHEN_KEYS = ["decorator", "declaration", "file", "name"] as const;

function parseTarget(ruleName: string, s: unknown, allowWildcard: boolean): Tier0Target {
  if (typeof s !== "string") throw new Error(`Tier-0 rule ${ruleName}: target must be a string, got ${JSON.stringify(s)}`);
  const m = /^([a-z][a-z-]*)\.([a-z][a-z0-9-]*|\*)$/.exec(s);
  if (!m) throw new Error(`Tier-0 rule ${ruleName}: '${s}' is not 'layer.type'${allowWildcard ? " or 'layer.*'" : ""}`);
  if (m[2] === "*" && !allowWildcard) throw new Error(`Tier-0 rule ${ruleName}: decide needs a type, not '${s}'`);
  return { layer: m[1], type: m[2] === "*" ? null : m[2] };
}

/** Compile the Tier-0 rules out of an analyzer's heuristics, in order. Throws on a malformed rule. */
export function tier0RulesFrom(heuristics: AnalyzerHeuristic[]): Tier0Rule[] {
  const rules: Tier0Rule[] = [];
  for (const h of heuristics) {
    const t = (h.parameters as Record<string, unknown> | undefined)?.tier0 as Record<string, unknown> | undefined;
    if (!t) continue;
    const unknown = Object.keys(t).filter((k) => !(TIER0_KEYS as readonly string[]).includes(k));
    if (unknown.length) throw new Error(`Tier-0 rule ${h.name}: unknown key ${unknown.map((k) => `'${k}'`).join(", ")} (known: ${TIER0_KEYS.join(", ")})`);
    const labels = t.labels;
    if (!Array.isArray(labels) || !labels.length || !labels.every((l) => typeof l === "string")) {
      throw new Error(`Tier-0 rule ${h.name}: labels must be a non-empty list of CBM labels`);
    }
    const when: Tier0Rule["when"] = {};
    for (const [k, v] of Object.entries((t.when ?? {}) as Record<string, unknown>)) {
      if (!(WHEN_KEYS as readonly string[]).includes(k)) throw new Error(`Tier-0 rule ${h.name}: unknown condition '${k}' (known: ${WHEN_KEYS.join(", ")})`);
      if (typeof v !== "string") throw new Error(`Tier-0 rule ${h.name}: condition '${k}' must be a regular expression string`);
      when[k as (typeof WHEN_KEYS)[number]] = new RegExp(v);
    }
    if ((t.decide === undefined) === (t.narrow === undefined)) throw new Error(`Tier-0 rule ${h.name}: give exactly one of decide or narrow`);
    const confidence = (t.confidence ?? "medium") as Tier0Confidence;
    if (!["high", "medium", "low"].includes(confidence)) throw new Error(`Tier-0 rule ${h.name}: confidence must be high, medium or low`);
    let action: Tier0Action;
    if (t.decide === "none") action = { kind: "reject" };
    else if (t.decide !== undefined) {
      const target = parseTarget(h.name, t.decide, false);
      action = { kind: "decide", layer: target.layer, type: target.type! };
    } else {
      if (!Array.isArray(t.narrow) || !t.narrow.length) throw new Error(`Tier-0 rule ${h.name}: narrow must be a non-empty list`);
      action = { kind: "narrow", candidates: t.narrow.map((n) => parseTarget(h.name, n, true)) };
    }
    rules.push({ name: h.name, labels: labels as string[], when, action, confidence });
  }
  return rules;
}

const MAX_DECLARATION_LINES = 8;

/**
 * Net change in open parentheses and square brackets on a line, ignoring string literals. Braces
 * are not counted: an opening brace starts a body, not a continuation of the declaration.
 */
function depthDelta(line: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
  }
  return depth;
}

/** Remove leading decorators/annotations ("@Entity", "@Table(name = \"x\")") from a line; returns the rest. */
function stripLeadingDecorators(line: string): { rest: string; open: number } {
  let s = line;
  for (;;) {
    const m = /^@[\w.$]+/.exec(s);
    if (!m) return { rest: s.trim(), open: 0 };
    s = s.slice(m[0].length);
    if (s.startsWith("(")) {
      // consume the argument list, which may continue on later lines
      let depth = 0;
      let i = 0;
      let quote: string | null = null;
      for (; i < s.length; i++) {
        const c = s[i];
        if (quote) {
          if (c === "\\") i++;
          else if (c === quote) quote = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "(") depth++;
        else if (c === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      if (depth > 0) return { rest: "", open: depth };
      s = s.slice(i + 1);
    }
    s = s.trimStart();
  }
}

/**
 * The declaration of a symbol: the first statement of its source that is not a blank line, a
 * comment, a docstring or a decorator/annotation, joined across lines while brackets are open
 * ("class Item(ItemBase, table=True):", "public interface OwnerRepository extends
 * JpaRepository<Owner, Integer> {"). Decorators with multi-line arguments are skipped whole, and
 * an annotation on the same line as the declaration is stripped from it. Falls back to the
 * signature.
 */
export function declarationOf(source: string | null | undefined, signature?: string | null): string | null {
  const lines = (source ?? "").split("\n");
  let i = 0;
  let decoratorDepth = 0;
  let docstring: string | null = null;
  for (; i < lines.length; i++) {
    let line = lines[i].trim();
    if (decoratorDepth > 0) {
      decoratorDepth += depthDelta(line);
      if (decoratorDepth > 0) continue;
      decoratorDepth = 0;
      continue;
    }
    if (docstring) {
      if (line.includes(docstring)) docstring = null;
      continue;
    }
    if (!line || line.startsWith("//") || line.startsWith("#") || line.startsWith("/*") || line.startsWith("*")) continue;
    const doc = /^[rRbBuU]?("""|''')/.exec(line);
    if (doc) {
      const rest = line.slice(doc[0].length);
      if (!rest.includes(doc[1])) docstring = doc[1];
      continue;
    }
    if (line.startsWith("@")) {
      const { rest, open } = stripLeadingDecorators(line);
      if (open > 0) {
        decoratorDepth = open;
        continue;
      }
      if (!rest) continue;
      line = rest;
    }
    // the declaration starts here; join continuation lines while brackets stay open
    const parts = [line];
    let depth = depthDelta(line);
    for (let j = i + 1; depth > 0 && j < lines.length && parts.length < MAX_DECLARATION_LINES; j++) {
      const next = lines[j].trim();
      parts.push(next);
      depth += depthDelta(next);
    }
    return parts.join(" ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s+/g, " ");
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

/** Apply the rules to one symbol: the first matching rule's action, or null when no rule matches. */
export function evaluateTier0(symbol: Tier0Symbol, rules: Tier0Rule[]): Tier0Outcome | null {
  for (const rule of rules) {
    if (matches(rule, symbol)) return { ...rule.action, rule: rule.name, confidence: rule.confidence };
  }
  return null;
}
