/**
 * A project's own extraction rules: decisions about what its code is, stated once and kept with
 * the model in `documentation-robotics/extraction-rules.yaml` (committed, so every checkout and
 * every later run applies them).
 *
 * A rule says which code it covers (`where`: files, label, visibility, nesting, a name or
 * declaration pattern, the type of the element that owns the symbol) and what that code is (`as`:
 * a `layer.type`, or `none` for "not a model element"), with the reason. A relationship rule
 * (`relationship`: source, predicate, target; `as: none`) says a relationship extraction would
 * stage is not one.
 *
 * Order (src/analyzers/extraction-plan.ts and docs/analyzers/CASCADE_DESIGN.md):
 * 1. an element that already names the symbol wins: rules never touch it;
 * 2. a decision recorded for that one card (codebase_extract `reject`);
 * 3. a project rule that says `none`: for a symbol Tier 0 decided as an element only when the rule
 *    says `overrideTier0: true` (a fixture folder's routes). Without it the symbol is held for Tier 0
 *    (#1424): staged when its add validates, and decided by the rule when it ends up a card instead
 *    (a needs-attributes or ambiguous card, {@link releaseHeldCards}). Either way the run counts it;
 * 4. Tier 0;
 * 5. a project rule that names a type, only for a symbol Tier 0 left open or narrowed, with the
 *    attributes the rule gives for what the code can't.
 * Every rule that says `none` is applied before any rule that names a type, whatever their order
 * and wherever they come from (the call's `decide` or the file): a typed rule never stages a symbol
 * some `none` rule excludes. Among `none` rules, and among typed rules, the first that matches wins
 * (the call's items first, then the file's, in order). A decision on one card (2) wins over every rule.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Minimatch } from "minimatch";
import { parse as parseYAML } from "yaml";
import { stringifyDrYaml } from "../core/dr-yaml.js";
import { isValidLayer } from "../generated/layer-registry.js";
import { isValidNodeType } from "../generated/node-types.js";
import { RELATIONSHIPS_BY_PREDICATE } from "../generated/relationship-index.js";
import { CLIError, ErrorCategory } from "../utils/errors.js";
import { extractedSymbolOf, type ExtractedSymbol, type ExtractionGraph } from "./cards/extract.js";
import type { Visibility } from "./cards/visibility.js";
import { declarationOf, type Tier0Outcome } from "./tier0-rules.js";

export const PROJECT_RULES_FILE = "extraction-rules.yaml";
/** The prefix of the rule name on a decision a project rule made (`project:not-product-code`). */
export const PROJECT_RULE_PREFIX = "project:";

const VISIBILITIES: readonly Visibility[] = ["exported", "local", "public", "private", "protected"];

/** Which symbols a rule covers. Every condition given must hold; at least one is needed. */
export interface RuleWhere {
  /** A file, a folder or a glob from the codebase root (`scripts/`, `src/**\/*.test.ts`), or several. */
  files?: string | string[];
  /** The card's label (`Function`, `Method`, `Class`, `Interface`, `Type`, `Enum`, `Route`, ...), or several. */
  label?: string | string[];
  visibility?: Visibility | Visibility[];
  /** true: only symbols declared inside another function; false: only those that are not. */
  nested?: boolean;
  /** A regular expression on the symbol's bare name, without its class (`_copy_grooves`). */
  name?: string;
  /**
   * A regular expression on the symbol as cards show it (`Assembly._copy_grooves` for a method,
   * `GET /owners/{ownerId}` for a route, else the name): codebase_extract's card `symbol` (#1333).
   */
  symbol?: string;
  /** A regular expression on the symbol's declaration (its first statement, without decorators). */
  declaration?: string;
  /**
   * The `layer.type` of the element the symbol's class is (`application.dataobject`), or `none`
   * for a member whose class has no element, or several. Only members have an owner.
   */
  ownerType?: string | string[];
}

/** Which relationships a relationship rule covers: the predicate and at least one end, by element id. */
export interface RelationshipWhere {
  source?: string;
  predicate: string;
  target?: string;
}

export interface ProjectRule {
  /** Unique in the file; names the rule in results and in a staged change's origin. */
  name: string;
  where?: RuleWhere;
  relationship?: RelationshipWhere;
  /** A `layer.type`, or `none`: not a model element (not a relationship). */
  as: string;
  reason: string;
  /**
   * For a rule that names a type: attributes for the elements it stages, what the type requires and
   * the code can't give (`{type: "button"}`). The code's own facts win over them.
   */
  attributes?: Record<string, unknown>;
  /**
   * For a rule that says `none`: also take symbols Tier 0 decided as elements (it would stage them).
   * Without it those stay Tier 0's, and the run says how many the rule matched.
   */
  overrideTier0?: boolean;
  /** When it was decided, and in which changeset. */
  decided?: { at?: string; changeset?: string };
}

export interface ProjectRulesFile {
  version: 1;
  rules: ProjectRule[];
}

/** What a rule is asked about one symbol. */
export interface RuleSubject {
  file: string | null;
  label: string;
  name: string;
  /** The symbol as cards show it (`Class.method`, `GET /path`); see {@link RuleWhere.symbol}. */
  symbol?: string;
  visibility?: Visibility;
  nested?: boolean;
  declaration?: string | null;
  /** The `layer.type` of the element its class is; `none` for a member whose class has none; undefined for a non-member. */
  ownerType?: string;
}

export interface CompiledRule {
  rule: ProjectRule;
  /** `none`, or the decided layer and type. */
  decision: { kind: "none" } | { kind: "type"; layer: string; type: string };
  matches: (subject: RuleSubject) => boolean;
  matchesRelationship: (r: { source: string; predicate: string; target: string }) => boolean;
}

export function projectRulesPath(projectRoot: string): string {
  return path.join(projectRoot, "documentation-robotics", PROJECT_RULES_FILE);
}

/**
 * Whether a codebase-relative file is the file, in the folder, or matches the glob. A pattern is
 * read as a path first, so a path with glob characters in it (`app/users/[id]/page.tsx`, as a kept
 * reject writes a card's file) still names itself.
 */
export function filesMatcher(pattern: string): (file: string) => boolean {
  const p = pattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (/[*?[\]{}]/.test(p)) {
    // Compiled once, and each file judged once: a run asks about every symbol of every file.
    const exact = new Minimatch(p, { dot: true });
    const folder = new Minimatch(`${p.replace(/\/+$/, "")}/**`, { dot: true });
    const dir = p.replace(/\/+$/, "");
    const seen = new Map<string, boolean>();
    return (file) => {
      let hit = seen.get(file);
      if (hit === undefined) seen.set(file, (hit = file === dir || file.startsWith(`${dir}/`) || exact.match(file) || folder.match(file)));
      return hit;
    };
  }
  const dir = p.replace(/\/+$/, "");
  return (file) => file === dir || file.startsWith(`${dir}/`);
}

function list<T>(v: T | T[] | undefined): T[] | undefined {
  return v === undefined ? undefined : Array.isArray(v) ? v : [v];
}

function regex(ruleName: string, key: string, source: string): RegExp {
  try {
    return new RegExp(source);
  } catch {
    throw new Error(`rule '${ruleName}': where.${key} is not a valid regular expression: ${source}`);
  }
}

/**
 * The card labels extraction makes: the code index's declarations, infrastructure, environment
 * variables and decision records, and DR's own test cards. A rule naming another label would match
 * nothing, so it is refused as a typo.
 */
export const RULE_LABELS: readonly string[] = [
  "Class",
  "Interface",
  "Function",
  "Method",
  "Route",
  "Type",
  "Enum",
  "Trait",
  "Struct",
  "Table",
  "Resource",
  "Image",
  "Chart",
  "Process",
  "EnvVar",
  "ADR",
  "TestCase",
  "TestSuite",
];
export const PROJECT_RULES_VERSION = 1;
const FILE_KEYS = ["version", "rules"] as const;

const WHERE_KEYS = ["files", "label", "visibility", "nested", "name", "symbol", "declaration", "ownerType"] as const;
const RULE_KEYS = ["name", "where", "relationship", "as", "reason", "attributes", "overrideTier0", "decided"] as const;
const RELATIONSHIP_KEYS = ["source", "predicate", "target"] as const;

function strings(ruleName: string, key: string, v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  const items = Array.isArray(v) ? v : [v];
  if (!items.length || !items.every((x) => typeof x === "string" && x)) {
    throw new Error(`rule '${ruleName}': where.${key} must be a string or a list of strings`);
  }
  return items as string[];
}

/** `layer.type` as a decision, or an Error saying what is wrong with it. */
export function parseDecision(ruleName: string, as: unknown): CompiledRule["decision"] {
  if (as === "none") return { kind: "none" };
  const m = typeof as === "string" ? /^([a-z][a-z-]*)\.([a-z][a-z0-9-]*)$/.exec(as) : null;
  if (!m) throw new Error(`rule '${ruleName}': as must be 'none' or a 'layer.type' (application.applicationfunction), got ${JSON.stringify(as)}`);
  if (!isValidLayer(m[1])) throw new Error(`rule '${ruleName}': '${m[1]}' is not a layer`);
  if (!isValidNodeType(m[1], m[2])) throw new Error(`rule '${ruleName}': the ${m[1]} layer has no type '${m[2]}' (spec_type lists a layer's types)`);
  return { kind: "type", layer: m[1], type: m[2] };
}

/** Check a rule and build its matchers. Throws an Error naming the rule and what is wrong. */
export function compileRule(raw: unknown, position?: number): CompiledRule {
  const at = position === undefined ? "a rule" : `rule ${position + 1}`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${at} must be an object with name, where (or relationship), as and reason`);
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : null;
  if (!name) throw new Error(`${at} needs a name`);
  const unknown = Object.keys(r).filter((k) => !(RULE_KEYS as readonly string[]).includes(k));
  if (unknown.length) throw new Error(`rule '${name}': unknown key ${unknown.map((k) => `'${k}'`).join(", ")} (known: ${RULE_KEYS.join(", ")})`);
  if (typeof r.reason !== "string" || !r.reason.trim()) throw new Error(`rule '${name}': reason is required (why this code is, or is not, that element)`);
  const decision = parseDecision(name, r.as);
  if ((r.where === undefined) === (r.relationship === undefined)) throw new Error(`rule '${name}': give exactly one of where (symbols) and relationship`);
  if (r.attributes !== undefined) {
    if (!r.attributes || typeof r.attributes !== "object" || Array.isArray(r.attributes)) {
      throw new Error(`rule '${name}': attributes must be an object ({type: "button"})`);
    }
    if (decision.kind !== "type") throw new Error(`rule '${name}': attributes go with a rule that names a type, not with as: none`);
  }
  if (r.overrideTier0 !== undefined) {
    if (typeof r.overrideTier0 !== "boolean") throw new Error(`rule '${name}': overrideTier0 must be true or false`);
    if (decision.kind !== "none" || r.relationship !== undefined) {
      throw new Error(`rule '${name}': overrideTier0 goes with a symbol rule that says none (a rule that names a type decides only what Tier 0 left open)`);
    }
  }

  let matches: CompiledRule["matches"] = () => false;
  let matchesRelationship: CompiledRule["matchesRelationship"] = () => false;
  let where: RuleWhere | undefined;
  let relationship: RelationshipWhere | undefined;

  if (r.relationship !== undefined) {
    const rel = r.relationship as Record<string, unknown>;
    if (!rel || typeof rel !== "object") throw new Error(`rule '${name}': relationship must be {source?, predicate, target?}`);
    const bad = Object.keys(rel).filter((k) => !(RELATIONSHIP_KEYS as readonly string[]).includes(k));
    if (bad.length) throw new Error(`rule '${name}': relationship has unknown key ${bad.map((k) => `'${k}'`).join(", ")} (known: ${RELATIONSHIP_KEYS.join(", ")})`);
    if (typeof rel.predicate !== "string" || !rel.predicate) throw new Error(`rule '${name}': relationship.predicate is required`);
    if (!RELATIONSHIPS_BY_PREDICATE.has(rel.predicate)) {
      throw new Error(`rule '${name}': '${rel.predicate}' is not a predicate the relationship catalog has (realizes, depends-on, accesses, uses, serves, composes, tests, ...)`);
    }
    for (const end of ["source", "target"] as const) {
      if (rel[end] !== undefined && (typeof rel[end] !== "string" || !rel[end])) throw new Error(`rule '${name}': relationship.${end} must be an element id`);
    }
    if (rel.source === undefined && rel.target === undefined) throw new Error(`rule '${name}': relationship needs a source or a target`);
    if (decision.kind !== "none") throw new Error(`rule '${name}': a relationship rule can only say as: none`);
    relationship = {
      predicate: rel.predicate,
      ...(rel.source !== undefined ? { source: rel.source as string } : {}),
      ...(rel.target !== undefined ? { target: rel.target as string } : {}),
    };
    const { source, predicate, target } = relationship;
    matchesRelationship = (x) => x.predicate === predicate && (source === undefined || x.source === source) && (target === undefined || x.target === target);
  } else {
    const w = r.where as Record<string, unknown>;
    if (!w || typeof w !== "object" || Array.isArray(w)) throw new Error(`rule '${name}': where must be an object`);
    const bad = Object.keys(w).filter((k) => !(WHERE_KEYS as readonly string[]).includes(k));
    if (bad.length) throw new Error(`rule '${name}': unknown condition ${bad.map((k) => `'${k}'`).join(", ")} (known: ${WHERE_KEYS.join(", ")})`);
    if (!Object.keys(w).length) throw new Error(`rule '${name}': where needs at least one condition, so a rule can't cover every symbol by accident`);
    const files = strings(name, "files", w.files);
    const labels = strings(name, "label", w.label);
    const visibility = strings(name, "visibility", w.visibility);
    const ownerType = strings(name, "ownerType", w.ownerType);
    for (const l of labels ?? []) {
      if (!RULE_LABELS.includes(l)) throw new Error(`rule '${name}': where.label '${l}' is not a card label (${RULE_LABELS.join(", ")})`);
    }
    for (const v of visibility ?? []) {
      if (!(VISIBILITIES as readonly string[]).includes(v)) throw new Error(`rule '${name}': where.visibility '${v}' is not one of ${VISIBILITIES.join(", ")}`);
    }
    if (w.nested !== undefined && typeof w.nested !== "boolean") throw new Error(`rule '${name}': where.nested must be true or false`);
    for (const k of ["name", "symbol", "declaration"] as const) {
      if (w[k] !== undefined && (typeof w[k] !== "string" || !w[k])) throw new Error(`rule '${name}': where.${k} must be a regular expression string`);
    }
    const nameRe = w.name !== undefined ? regex(name, "name", w.name as string) : null;
    const symbolRe = w.symbol !== undefined ? regex(name, "symbol", w.symbol as string) : null;
    const declarationRe = w.declaration !== undefined ? regex(name, "declaration", w.declaration as string) : null;
    const fileMatchers = files?.map(filesMatcher);
    const nested = w.nested as boolean | undefined;
    where = {
      ...(w.files !== undefined ? { files: w.files as string | string[] } : {}),
      ...(w.label !== undefined ? { label: w.label as string | string[] } : {}),
      ...(w.visibility !== undefined ? { visibility: w.visibility as Visibility | Visibility[] } : {}),
      ...(nested !== undefined ? { nested } : {}),
      ...(w.name !== undefined ? { name: w.name as string } : {}),
      ...(w.symbol !== undefined ? { symbol: w.symbol as string } : {}),
      ...(w.declaration !== undefined ? { declaration: w.declaration as string } : {}),
      ...(w.ownerType !== undefined ? { ownerType: w.ownerType as string | string[] } : {}),
    };
    matches = (s) => {
      if (fileMatchers && !(s.file && fileMatchers.some((m) => m(s.file!)))) return false;
      if (labels && !labels.includes(s.label)) return false;
      if (visibility && !(s.visibility && visibility.includes(s.visibility))) return false;
      if (nested !== undefined && !!s.nested !== nested) return false;
      if (nameRe && !nameRe.test(s.name)) return false;
      if (symbolRe && !symbolRe.test(s.symbol ?? s.name)) return false;
      if (declarationRe && !(s.declaration && declarationRe.test(s.declaration))) return false;
      if (ownerType && !(s.ownerType && ownerType.includes(s.ownerType))) return false;
      return true;
    };
  }
  const decided = r.decided && typeof r.decided === "object" ? (r.decided as { at?: unknown; changeset?: unknown }) : undefined;
  const rule: ProjectRule = {
    name,
    ...(where ? { where } : {}),
    ...(relationship ? { relationship } : {}),
    as: r.as as string,
    reason: (r.reason as string).trim(),
    ...(r.attributes !== undefined ? { attributes: structuredClone(r.attributes as Record<string, unknown>) } : {}),
    ...(r.overrideTier0 !== undefined ? { overrideTier0: r.overrideTier0 as boolean } : {}),
    ...(decided
      ? {
          decided: {
            ...(typeof decided.at === "string" ? { at: decided.at } : {}),
            ...(typeof decided.changeset === "string" ? { changeset: decided.changeset } : {}),
          },
        }
      : {}),
  };
  return { rule, decision, matches, matchesRelationship };
}

/** Compile a list of rules; a duplicate name or a malformed rule throws, naming it. */
export function compileRules(raw: unknown[]): CompiledRule[] {
  const out: CompiledRule[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const compiled = compileRule(r, i);
    if (seen.has(compiled.rule.name)) throw new Error(`rule '${compiled.rule.name}' is in the file twice: rule names are unique`);
    seen.add(compiled.rule.name);
    out.push(compiled);
  });
  return out;
}

/**
 * The project's rules, compiled, in file order; none when the file doesn't exist. A file that
 * can't be read as rules is an error that names the file and what is wrong: rules silently not
 * applied would bring back every card they decided.
 */
export async function loadProjectRules(projectRoot: string): Promise<CompiledRule[]> {
  const file = projectRulesPath(projectRoot);
  if (!existsSync(file)) return [];
  const fail = (what: string) =>
    new CLIError(`The project's extraction rules can't be used: ${what}`, ErrorCategory.USER, [
      `Fix ${path.relative(projectRoot, file)} (each rule: name, where or relationship, as, reason), or remove the rule`,
    ]);
  let parsed: unknown;
  try {
    parsed = parseYAML(await readFile(file, "utf-8"));
  } catch (error) {
    throw fail(`${path.relative(projectRoot, file)} is not valid YAML (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`);
  }
  if (parsed === null || parsed === undefined) return [];
  const rel = path.relative(projectRoot, file);
  if (typeof parsed !== "object" || Array.isArray(parsed)) throw fail(`${rel} must be an object with version: ${PROJECT_RULES_VERSION} and a 'rules' list`);
  const body = parsed as Record<string, unknown>;
  const unknownKeys = Object.keys(body).filter((k) => !(FILE_KEYS as readonly string[]).includes(k));
  if (unknownKeys.length) throw fail(`${rel} has unknown key ${unknownKeys.map((k) => `'${k}'`).join(", ")} (it takes ${FILE_KEYS.join(" and ")})`);
  if (body.version === undefined) throw fail(`${rel} has no version: add version: ${PROJECT_RULES_VERSION} at the top`);
  if (body.version !== PROJECT_RULES_VERSION) {
    throw fail(`${rel} is version ${JSON.stringify(body.version)}; this dr reads version ${PROJECT_RULES_VERSION}`);
  }
  const rules = body.rules;
  if (rules !== undefined && !Array.isArray(rules)) throw fail(`${rel}: 'rules' must be a list`);
  try {
    return compileRules((rules as unknown[] | undefined) ?? []);
  } catch (error) {
    throw fail(error instanceof Error ? error.message : String(error));
  }
}

const FILE_HEADER =
  "# Extraction rules for this project, applied by codebase_extract before it makes cards.\n" +
  "# Each rule: name, where (files, label, visibility, nested, name, symbol, declaration, ownerType) or\n" +
  "# relationship (source, predicate, target), as (a layer.type, or none) and reason; attributes for a\n" +
  "# typed rule; overrideTier0: true for a none rule that also takes what Tier 0 decided as elements.\n" +
  "# The first rule that matches a symbol wins. Written by codebase_extract (decide with keep: true);\n" +
  "# edit by hand as you like.\n";

/** What a rule decides, without its name, reason or record: two rules alike here are the same rule. */
function ruleDecides(rule: ProjectRule): string {
  const { where, relationship, as, attributes, overrideTier0 } = rule;
  const sorted = (v: unknown): unknown =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;
  return JSON.stringify(sorted({ where, relationship, as, attributes, overrideTier0: overrideTier0 === true }));
}

/**
 * Add a rule to the project's file, or replace the one of the same name. Returns whether it
 * replaced one. The rule is compiled first, so a malformed one is never written. A rule the file
 * already holds under another name (the same where or relationship, as, attributes and
 * overrideTier0) is not written again: `duplicateOf` names the one that holds it.
 */
export async function saveProjectRule(projectRoot: string, rule: ProjectRule): Promise<{ replaced: boolean; file: string; duplicateOf?: string }> {
  compileRule(rule);
  const existing = (await loadProjectRules(projectRoot)).map((c) => c.rule);
  const same = existing.find((r) => r.name !== rule.name && ruleDecides(r) === ruleDecides(rule));
  if (same) return { replaced: false, file: projectRulesPath(projectRoot), duplicateOf: same.name };
  const at = existing.findIndex((r) => r.name === rule.name);
  const rules = at >= 0 ? existing.map((r, i) => (i === at ? rule : r)) : [...existing, rule];
  const file = projectRulesPath(projectRoot);
  await mkdir(path.dirname(file), { recursive: true });
  const body: ProjectRulesFile = { version: 1, rules };
  await writeFile(file, `${FILE_HEADER}${stringifyDrYaml(body)}`, "utf-8");
  return { replaced: at >= 0, file };
}

/** A name for a rule nobody named: what it decides and which symbols, short and stable. */
export function ruleNameFor(rule: Pick<ProjectRule, "where" | "relationship" | "as">, taken: ReadonlySet<string>): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const parts: string[] = [];
  const w = rule.where;
  if (w) {
    if (w.nested) parts.push("nested");
    for (const v of list(w.visibility) ?? []) parts.push(v);
    for (const l of list(w.label) ?? []) parts.push(l);
    if (w.ownerType) parts.push("of", ...(list(w.ownerType) ?? []).map((o) => o.split(".").pop()!));
    if (w.name) parts.push("named", w.name);
    if (w.symbol) parts.push("symbol", w.symbol);
    const files = list(w.files);
    if (files?.length) parts.push("in", files[0].replace(/\*+/g, ""), ...(files.length > 1 ? [`and-${files.length - 1}-more`] : []));
  } else if (rule.relationship) {
    parts.push(rule.relationship.predicate, (rule.relationship.source ?? rule.relationship.target ?? "").split(".").pop() ?? "");
  }
  const decision = rule.as === "none" ? "not" : (rule.as.split(".").pop() ?? rule.as);
  const base = slug([decision, ...parts].join(" ")).slice(0, 60) || "rule";
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

// ---------------------------------------------------------------------------
// Applying rules to an extraction
// ---------------------------------------------------------------------------

export function isProjectRule(rule: string | undefined): boolean {
  return !!rule && rule.startsWith(PROJECT_RULE_PREFIX);
}

/** The name of the project rule behind a decision's rule (`project:x` -> `x`). */
export function projectRuleName(rule: string): string {
  return rule.slice(PROJECT_RULE_PREFIX.length);
}

export interface ApplyRulesContext {
  /** Card ids someone decided one at a time (`decide: [{card}]`): no rule touches them. */
  decidedCards?: ReadonlySet<string>;
  /** The `layer.type` of the element a member's class is, `none` when it has none; undefined for a non-member. */
  ownerTypeOf?: (s: ExtractedSymbol) => string | undefined;
  /**
   * With a `since` range: whether the range changed the symbol. A rule that names a type stages
   * only changed symbols (the range didn't build the others); a rule that says `none` applies to all.
   * Absent for a whole-codebase run.
   */
  changed?: (s: ExtractedSymbol) => boolean;
}

/** What applying the rules found, beside the outcomes it set: symbols a typed rule covers that the range didn't touch. */
export interface AppliedRules {
  extraction: ExtractionGraph;
  /** Per rule: symbols it matched that a typed rule left alone because the range didn't change them. */
  untouched: Map<string, number>;
  /**
   * Per `none` rule: symbols Tier 0 (or the node mapping) had decided as an element (with
   * `overrideTier0`), or rejected, that the rule overrode; `types` counts the decided ones by the
   * `layer.type` Tier 0 gave them.
   */
  overrode: Map<string, { decided: number; rejected: number; types?: Record<string, number> }>;
  /**
   * Symbols a `none` rule matched that Tier 0 decided as elements, held for Tier 0 because the rule
   * doesn't say `overrideTier0` (#1424): by card id, the rule's name and the type Tier 0 gave. Tier
   * 0 stages them; one that ends up a card is the rule's ({@link releaseHeldCards}).
   */
  held: Map<string, { rule: string; type: string }>;
}

/** What a rule is asked about a symbol. */
export function subjectOf(s: ExtractedSymbol, ownerType?: string): RuleSubject {
  return {
    file: s.card.file_path,
    label: s.card.label,
    name: s.card.name,
    symbol: extractedSymbolOf(s),
    ...(s.triage?.visibility ? { visibility: s.triage.visibility } : {}),
    nested: !!s.triage?.nested,
    declaration: declarationOf(s.card.source, s.card.signature),
    ...(ownerType !== undefined ? { ownerType } : {}),
  };
}

/**
 * The extraction with the project's rules applied to its symbols' outcomes, for planning: a rule
 * that says `none` replaces what Tier 0 said, except that a symbol Tier 0 decided as an element is
 * held for Tier 0 unless the rule says `overrideTier0` (`held`); a rule that names a type decides a
 * symbol Tier 0 left open or narrowed, with the rule's attributes. Planning then treats them as it
 * treats Tier 0's (an element that already names a symbol still wins, and so does a decision
 * recorded for that one card). The outcome's rule is `project:<name>`.
 */
export function applyProjectRules(extraction: ExtractionGraph, rules: readonly CompiledRule[], context: ApplyRulesContext = {}): AppliedRules {
  const symbolRules = rules.filter((r) => r.rule.where);
  const noneRules = symbolRules.filter((r) => r.decision.kind === "none");
  const typedRules = symbolRules.filter((r) => r.decision.kind === "type");
  const untouched = new Map<string, number>();
  const overrode = new Map<string, { decided: number; rejected: number; types?: Record<string, number> }>();
  const held = new Map<string, { rule: string; type: string }>();
  if (!symbolRules.length) return { extraction, untouched, overrode, held };
  const symbols = extraction.symbols.map((s) => {
    // A decision on this one card wins over every rule.
    if (context.decidedCards?.has(s.card.id)) return s;
    const subject = subjectOf(s, context.ownerTypeOf?.(s));
    // Any none rule, ahead of Tier 0 and of every typed rule.
    const none = noneRules.find((r) => r.matches(subject));
    if (none) {
      // Tier 0 decided it is an element: the rule takes it only when it says so; else Tier 0 keeps it, counted.
      if (s.tier0?.kind === "decide" && !none.rule.overrideTier0) {
        held.set(s.card.id, { rule: none.rule.name, type: `${s.tier0.layer}.${s.tier0.type}` });
        return s;
      }
      if (s.tier0?.kind === "decide" || s.tier0?.kind === "reject") {
        const o = overrode.get(none.rule.name) ?? overrode.set(none.rule.name, { decided: 0, rejected: 0 }).get(none.rule.name)!;
        if (s.tier0.kind === "decide") {
          o.decided++;
          const type = `${s.tier0.layer}.${s.tier0.type}`;
          o.types = { ...o.types, [type]: (o.types?.[type] ?? 0) + 1 };
        } else o.rejected++;
      }
      return { ...s, tier0: { kind: "reject", rule: `${PROJECT_RULE_PREFIX}${none.rule.name}`, confidence: "high" } satisfies Tier0Outcome };
    }
    // A typed rule decides only what Tier 0 left open; a route nothing handles is never typed by rule.
    if ((s.tier0 && s.tier0.kind !== "narrow") || s.unhandled) return s;
    const typed = typedRules.find((r) => r.matches(subject));
    if (!typed || typed.decision.kind !== "type") return s;
    if (context.changed && !context.changed(s)) {
      untouched.set(typed.rule.name, (untouched.get(typed.rule.name) ?? 0) + 1);
      return s;
    }
    return {
      ...s,
      tier0: {
        kind: "decide",
        layer: typed.decision.layer,
        type: typed.decision.type,
        ...(typed.rule.attributes ? { attributes: typed.rule.attributes } : {}),
        rule: `${PROJECT_RULE_PREFIX}${typed.rule.name}`,
        confidence: "high",
      } satisfies Tier0Outcome,
    };
  });
  return { extraction: { ...extraction, symbols }, untouched, overrode, held };
}

/**
 * What to do about symbols a `none` rule matched and left to Tier 0 (#1424), in the words
 * codebase_extract's ruleWarnings and codebase_verify's rules block both use: the key, and where.
 * `inFile`: the rule is kept in the rules file (else it is a decide item of the call).
 */
export function overrideTier0Advice(rule: string, symbols: number, inFile: boolean): string {
  const where = inFile ? `to rule '${rule}' in documentation-robotics/${PROJECT_RULES_FILE}` : `to the decide item '${rule}'`;
  return `To keep rejecting these ${symbols} symbol(s), add overrideTier0: true ${where}`;
}

/**
 * Cards whose symbol a `none` rule held for Tier 0 ({@link AppliedRules.held}) and that Tier 0
 * could not stage after all (a needs-attributes or ambiguous card): those are decided by the rule,
 * as a card no Tier-0 rule covers would be. Returns the cards left, and the ones the rules took
 * with the rule's name.
 */
export function releaseHeldCards<T extends { cardId: string }>(
  cards: readonly T[],
  held: ReadonlyMap<string, { rule: string }>
): { cards: T[]; released: Array<{ rule: string; card: T }> } {
  if (!held.size) return { cards: [...cards], released: [] };
  const kept: T[] = [];
  const released: Array<{ rule: string; card: T }> = [];
  for (const card of cards) {
    const h = held.get(card.cardId);
    if (h) released.push({ rule: h.rule, card });
    else kept.push(card);
  }
  return { cards: kept, released };
}

/** The first relationship rule that covers a relationship, when one does. */
export function relationshipRuleFor(rules: readonly CompiledRule[], r: { source: string; predicate: string; target: string }): CompiledRule | undefined {
  return rules.find((c) => c.rule.relationship && c.matchesRelationship(r));
}
