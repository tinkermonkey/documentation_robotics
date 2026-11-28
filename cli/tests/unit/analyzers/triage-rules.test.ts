/**
 * Unit tests for extraction triage: the facts read from a declaration (cards/visibility.ts), a
 * project's own extraction rules (project-rules.ts) and the triage views (triage.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardFacts, exportedElsewhere, nestedCards, visibilityOf } from "../../../src/analyzers/cards/visibility.js";
import type { ExtractedSymbol, ExtractionGraph } from "../../../src/analyzers/cards/extract.js";
import {
  applyProjectRules,
  compileRule,
  compileRules,
  filesMatcher,
  loadProjectRules,
  projectRulesPath,
  overrideTier0Advice,
  relationshipRuleFor,
  releaseHeldCards,
  ruleNameFor,
  saveProjectRule,
} from "../../../src/analyzers/project-rules.js";
import { filterCards, groupCards, kindRows, pageOf, planCoverage, sharedHelperGroups } from "../../../src/analyzers/triage.js";
import type { UndecidedCard } from "../../../src/analyzers/extraction-plan.js";

function card(label: string, name: string, file: string, source: string, start = 1, end = 5) {
  return { label, name, file_path: file, source, signature: null, start_line: start, end_line: end };
}

describe("visibility read from the declaration", () => {
  it("tells an exported TypeScript declaration from a module-private one", () => {
    expect(visibilityOf(card("Function", "run", "src/a.ts", "export async function run() {}"))).toBe("exported");
    expect(visibilityOf(card("Function", "tally", "src/a.ts", "function tally() {}"))).toBe("local");
    expect(visibilityOf(card("Interface", "Options", "src/a.ts", "/** Options. */\nexport interface Options {\n}"))).toBe("exported");
    expect(visibilityOf(card("Type", "Row", "src/a.ts", "type Row = { id: string };"))).toBe("local");
    expect(visibilityOf(card("Class", "Model", "src/a.ts", "export default class Model {}"))).toBe("exported");
  });

  it("reads a member's modifier", () => {
    expect(visibilityOf(card("Method", "load", "src/a.ts", "  async load(): Promise<void> {"))).toBe("public");
    expect(visibilityOf(card("Method", "parse", "src/a.ts", "  private parse(text: string) {"))).toBe("private");
    expect(visibilityOf(card("Method", "hook", "src/a.ts", "  protected static hook() {"))).toBe("protected");
    expect(visibilityOf(card("Method", "#secret", "src/a.ts", "  #secret() {"))).toBe("private");
    expect(visibilityOf(card("Method", "find", "src/Repo.java", "    private Owner find(int id) {"))).toBe("private");
    expect(visibilityOf(card("Method", "_helper", "app/x.py", "    def _helper(self):"))).toBe("private");
    expect(visibilityOf(card("Method", "__init__", "app/x.py", "    def __init__(self):"))).toBe("public");
    expect(visibilityOf(card("Function", "parseRow", "pkg/x.go", "func parseRow() {}"))).toBe("local");
    expect(visibilityOf(card("Function", "ParseRow", "pkg/x.go", "func ParseRow() {}"))).toBe("exported");
  });

  it("gives none for a label or a language it has no rule for", () => {
    expect(visibilityOf(card("Route", "__route__GET__/x", "src/a.ts", "app.get('/x')"))).toBeUndefined();
    expect(visibilityOf(card("Function", "f", "lib/x.rb", "def f"))).toBeUndefined();
  });

  it("finds an export on another line of the file", () => {
    expect(exportedElsewhere("function a() {}\nexport { a, b as c };", "a")).toBe(true);
    expect(exportedElsewhere("function a() {}\nexport { a, b as c };", "b")).toBe(true);
    expect(exportedElsewhere("function ab() {}\nexport { a };", "ab")).toBe(false);
    expect(exportedElsewhere("const run = () => 1;\nexport default run;", "run")).toBe(true);
    expect(exportedElsewhere("function x() {}\nmodule.exports = { x };", "x")).toBe(true);
    const cards = [card("Function", "a", "src/a.ts", "function a() {}"), card("Function", "b", "src/a.ts", "function b() {}", 10, 12)];
    const facts = cardFacts(cards, () => "function a() {}\nfunction b() {}\nexport { a };");
    expect(facts.get(cards[0])).toEqual({ visibility: "exported" });
    expect(facts.get(cards[1])).toEqual({ visibility: "local" });
  });

  it("marks a function declared inside another function or method, and nothing else", () => {
    const outer = card("Function", "outer", "src/a.ts", "export function outer() {", 1, 20);
    const inner = card("Function", "inner", "src/a.ts", "  const inner = () => {", 5, 8);
    const sibling = card("Function", "sibling", "src/a.ts", "function sibling() {", 22, 30);
    const method = card("Method", "load", "src/a.ts", "  load() {", 40, 60);
    const closure = card("Function", "onRow", "src/a.ts", "    const onRow = (r) => {", 45, 47);
    const otherFile = card("Function", "inner", "src/b.ts", "function inner() {", 5, 8);
    const nested = nestedCards([outer, inner, sibling, method, closure, otherFile]);
    expect([...nested].map((c) => c.name).sort()).toEqual(["inner", "onRow"]);
    expect(nested.has(otherFile)).toBe(false);
    expect(cardFacts([outer, inner]).get(inner)).toEqual({ visibility: "local", nested: true });
  });
});

function symbol(label: string, name: string, file: string, source: string, extra: Partial<ExtractedSymbol> = {}): ExtractedSymbol {
  const c = card(label, name, file, source);
  const base = {
    qualifiedName: `p.${file.replace(/\.\w+$/, "").replace(/\//g, ".")}.${name}`,
    card: { ...c, id: `${file}#${name}`, qualified_name: name } as unknown as ExtractedSymbol["card"],
    facts: { decorators: [], decorator_names: [], file_importers: 0, methods: 0, usage_files: 0 },
    tier0: null,
  } as ExtractedSymbol;
  const v = visibilityOf(c);
  return { ...base, ...(v ? { triage: { visibility: v } } : {}), ...extra };
}

function graphOf(symbols: ExtractedSymbol[]): ExtractionGraph {
  return { analyzer: "cbm", project: "p", symbols, edges: [], fileSymbols: {}, routes: [], summary: { cards: 0, decided: 0, rejected: 0, narrowed: 0, undecided: 0, no_source: 0 } } as unknown as ExtractionGraph;
}

describe("project rules", () => {
  it("matches a path, a folder and a glob", () => {
    expect(filesMatcher("scripts/")("scripts/a/b.ts")).toBe(true);
    expect(filesMatcher("scripts")("scripts2/a.ts")).toBe(false);
    expect(filesMatcher("src/**/*.test.ts")("src/a/b.test.ts")).toBe(true);
    expect(filesMatcher("design/**")("design/x/y.js")).toBe(true);
    expect(filesMatcher("src/a.ts")("src/a.ts")).toBe(true);
    // A path with glob characters names itself (a kept reject writes a card's file as the pattern).
    expect(filesMatcher("app/users/[id]/page.tsx")("app/users/[id]/page.tsx")).toBe(true);
    expect(filesMatcher("app/users/[id]/")("app/users/[id]/page.tsx")).toBe(true);
    expect(filesMatcher("app/users/[id]/page.tsx")("app/users/i/page.tsx")).toBe(true);
    expect(filesMatcher("app/users/[id]/page.tsx")("app/users/x/page.tsx")).toBe(false);
  });

  it("matches where.file exactly: a path with glob characters names only itself", () => {
    const page = (file: string) => symbol("Function", "UserPage", file, "export function UserPage() {}");
    const rules = compileRules([{ name: "user-page", where: { file: "app/users/[id]/page.tsx", symbol: "^UserPage$" }, as: "none", reason: "x", overrideTier0: true }]);
    const out = applyProjectRules(graphOf([page("app/users/[id]/page.tsx"), page("app/users/i/page.tsx")]), rules).extraction.symbols;
    expect(out.map((s) => s.tier0?.rule ?? null)).toEqual(["project:user-page", null]);
  });

  it("says what to add, and where, for symbols a none rule left to Tier 0", () => {
    expect(overrideTier0Advice("not-tests", 3, true)).toBe(
      "To keep rejecting these 3 symbol(s), add overrideTier0: true to rule 'not-tests' in documentation-robotics/extraction-rules.yaml"
    );
    expect(overrideTier0Advice("not-tests", 1, false)).toBe("To keep rejecting these 1 symbol(s), add overrideTier0: true to the decide item 'not-tests'");
  });

  it("refuses a rule that is malformed, naming it and what is wrong", () => {
    expect(() => compileRule({ where: { label: "Function" }, as: "none", reason: "x" })).toThrow("needs a name");
    expect(() => compileRule({ name: "r", where: {}, as: "none", reason: "x" })).toThrow("at least one condition");
    expect(() => compileRule({ name: "r", where: { labels: "Function" }, as: "none", reason: "x" })).toThrow("unknown condition 'labels'");
    expect(() => compileRule({ name: "r", where: { label: "Function" }, as: "application.widget", reason: "x" })).toThrow("has no type 'widget'");
    expect(() => compileRule({ name: "r", where: { label: "Function" }, as: "nowhere.thing", reason: "x" })).toThrow("'nowhere' is not a layer");
    expect(() => compileRule({ name: "r", where: { label: "Function" }, as: "none" })).toThrow("reason is required");
    expect(() => compileRule({ name: "r", where: { name: "(" }, as: "none", reason: "x" })).toThrow("not a valid regular expression");
    expect(() => compileRule({ name: "r", where: { visibility: "hidden" }, as: "none", reason: "x" })).toThrow("is not one of");
    expect(() => compileRule({ name: "r", where: { label: "Function" }, relationship: { predicate: "uses", source: "a.b.c" }, as: "none", reason: "x" })).toThrow("exactly one of where");
    expect(() => compileRule({ name: "r", relationship: { predicate: "realizes" }, as: "none", reason: "x" })).toThrow("needs a source or a target");
    expect(() => compileRule({ name: "r", relationship: { predicate: "realizes", source: "a.b.c" }, as: "application.applicationfunction", reason: "x" })).toThrow("can only say as: none");
    expect(() => compileRules([{ name: "r", where: { label: "Class" }, as: "none", reason: "x" }, { name: "r", where: { label: "Type" }, as: "none", reason: "y" }])).toThrow("twice");
  });

  it("applies a none rule that overrides Tier 0 over it, and a typed rule only to what Tier 0 left open", () => {
    const fixtureRoute = symbol("Route", "__route__GET__/todos", "fixtures/app/main.py", "@app.get('/todos')", {
      tier0: { kind: "decide", layer: "api", type: "operation", rule: "node-mapping:Route", confidence: "high" },
    });
    const exported = symbol("Function", "buildPlan", "src/plan.ts", "export function buildPlan() {}");
    const local = symbol("Function", "tally", "src/plan.ts", "function tally() {}");
    const narrowed = symbol("Interface", "Options", "src/plan.ts", "export interface Options {}", {
      tier0: { kind: "narrow", candidates: [{ layer: "data-model", type: "objectschema" }], rule: "tier0_interface_default", confidence: "low" },
    });
    const testCase = symbol("Function", "test_plan", "src/plan.ts", "export function test_plan() {}", {
      tier0: { kind: "decide", layer: "testing", type: "testcasesketch", rule: "tier0_test_case_name", confidence: "high" },
    });
    const rules = compileRules([
      { name: "fixtures", where: { files: "fixtures/**" }, as: "none", reason: "test fixtures are not product code", overrideTier0: true },
      { name: "local-functions", where: { label: "Function", visibility: "local" }, as: "none", reason: "module-private helpers" },
      { name: "exported-functions", where: { files: "src/**", label: "Function", visibility: "exported" }, as: "application.applicationfunction", reason: "the public behaviour of a module" },
      { name: "exported-types", where: { label: ["Interface", "Type"], visibility: "exported" }, as: "data-model.objectschema", reason: "an interface is a schema" },
    ]);
    const out = applyProjectRules(graphOf([fixtureRoute, exported, local, narrowed, testCase]), rules).extraction.symbols;
    expect(out.map((s) => s.tier0)).toEqual([
      { kind: "reject", rule: "project:fixtures", confidence: "high" },
      { kind: "decide", layer: "application", type: "applicationfunction", rule: "project:exported-functions", confidence: "high" },
      { kind: "reject", rule: "project:local-functions", confidence: "high" },
      { kind: "decide", layer: "data-model", type: "objectschema", rule: "project:exported-types", confidence: "high" },
      // Tier 0 decided it: a typed rule does not replace that.
      { kind: "decide", layer: "testing", type: "testcasesketch", rule: "tier0_test_case_name", confidence: "high" },
    ]);
  });

  it("holds a symbol Tier 0 decided as an element for Tier 0 unless the none rule says overrideTier0 (#1424)", () => {
    const testCase = (n: number) =>
      symbol("Function", `test_case_${n}`, "cli/tests/plan.test.ts", `export function test_case_${n}() {}`, {
        tier0: { kind: "decide", layer: "testing", type: "testcasesketch", rule: "tier0_test_case_name", confidence: "high" },
      });
    const helper = symbol("Interface", "Fixture", "cli/tests/helpers.ts", "export interface Fixture {}");
    const rejected = symbol("Function", "noise", "cli/tests/x.ts", "function noise() {}", { tier0: { kind: "reject", rule: "tier0_noise", confidence: "high" } });
    const tests = { name: "not-in-tests", where: { files: "cli/tests/" }, as: "none", reason: "test helpers are not product code" };
    const symbols = [testCase(1), testCase(2), helper, rejected];

    // Without overrideTier0 the test cases stay Tier 0's, held under the rule; the helper and the
    // symbol Tier 0 rejected are the rule's.
    const held = applyProjectRules(graphOf(symbols), compileRules([tests]));
    expect(held.extraction.symbols.map((s) => s.tier0?.rule)).toEqual(["tier0_test_case_name", "tier0_test_case_name", "project:not-in-tests", "project:not-in-tests"]);
    expect([...held.held.values()]).toEqual([
      { rule: "not-in-tests", type: "testing.testcasesketch" },
      { rule: "not-in-tests", type: "testing.testcasesketch" },
    ]);
    expect(held.overrode.get("not-in-tests")).toEqual({ decided: 0, rejected: 1 });

    // With it the rule takes them, counted by the type Tier 0 gave them.
    const taken = applyProjectRules(graphOf(symbols), compileRules([{ ...tests, overrideTier0: true }]));
    expect(taken.extraction.symbols.every((s) => s.tier0?.rule === "project:not-in-tests")).toBe(true);
    expect(taken.held.size).toBe(0);
    expect(taken.overrode.get("not-in-tests")).toEqual({ decided: 2, rejected: 1, types: { "testing.testcasesketch": 2 } });

    // A held symbol that ends up a card (Tier 0 could not stage it) goes back to its rule.
    const cards = [{ cardId: symbols[0].card.id }, { cardId: "other" }];
    const released = releaseHeldCards(cards, held.held);
    expect(released.cards).toEqual([{ cardId: "other" }]);
    expect(released.released).toEqual([{ rule: "not-in-tests", card: { cardId: symbols[0].card.id } }]);
  });

  it("matches where.symbol on the card's Class.method while where.name sees the bare name (#1333)", () => {
    const method = symbol("Method", "_copy_grooves", "sheets/assembly.py", "def _copy_grooves(self):", {
      card: { ...card("Method", "_copy_grooves", "sheets/assembly.py", "def _copy_grooves(self):"), id: "m", qualified_name: "_copy_grooves", parent_class: "p.sheets.assembly.Assembly" } as unknown as ExtractedSymbol["card"],
    });
    const byName = compileRules([{ name: "by-name", where: { name: "^Assembly\\._copy_grooves$" }, as: "none", reason: "x" }]);
    expect(applyProjectRules(graphOf([method]), byName).extraction.symbols[0].tier0).toBeNull();
    const bySymbol = compileRules([{ name: "by-symbol", where: { symbol: "^Assembly\\._copy_grooves$" }, as: "none", reason: "x" }]);
    expect(applyProjectRules(graphOf([method]), bySymbol).extraction.symbols[0].tier0?.rule).toBe("project:by-symbol");
    const bare = compileRules([{ name: "bare", where: { name: "^_copy_grooves$" }, as: "none", reason: "x" }]);
    expect(applyProjectRules(graphOf([method]), bare).extraction.symbols[0].tier0?.rule).toBe("project:bare");
  });

  it("carries a typed rule's attributes on its decision, and refuses attributes and overrideTier0 where they don't apply (#1380, #1424)", () => {
    const button = symbol("Function", "SaveButton", "src/ui/save.tsx", "export function SaveButton() {}");
    const rules = compileRules([{ name: "buttons", where: { name: "Button$" }, as: "ux.actioncomponent", reason: "a button", attributes: { type: "button" } }]);
    expect(applyProjectRules(graphOf([button]), rules).extraction.symbols[0].tier0).toEqual({
      kind: "decide",
      layer: "ux",
      type: "actioncomponent",
      attributes: { type: "button" },
      rule: "project:buttons",
      confidence: "high",
    });
    expect(() => compileRule({ name: "r", where: { label: "Function" }, as: "none", reason: "x", attributes: { type: "button" } })).toThrow("attributes go with a rule that names a type");
    expect(() => compileRule({ name: "r", where: { label: "Function" }, as: "ux.actioncomponent", reason: "x", attributes: ["button"] })).toThrow("attributes must be an object");
    expect(() => compileRule({ name: "r", where: { label: "Function" }, as: "ux.actioncomponent", reason: "x", overrideTier0: true })).toThrow("overrideTier0 goes with a symbol rule that says none");
    expect(() => compileRule({ name: "r", where: { label: "Function" }, as: "none", reason: "x", overrideTier0: "yes" })).toThrow("must be true or false");
    expect(() => compileRule({ name: "r", where: { symbol: "(" }, as: "none", reason: "x" })).toThrow("where.symbol is not a valid regular expression");
  });

  it("applies every none rule before any typed rule, whatever their order", () => {
    const inFixture = symbol("Function", "seed", "fixtures/seed.ts", "export function seed() {}");
    const inSrc = symbol("Function", "plan", "src/plan.ts", "export function plan() {}");
    // A typed rule listed above a none rule that also matches: the none rule still wins.
    const rules = compileRules([
      { name: "exported-functions", where: { label: "Function", visibility: "exported" }, as: "application.applicationfunction", reason: "public behaviour" },
      { name: "fixtures", where: { files: "fixtures/**" }, as: "none", reason: "not product code" },
    ]);
    const out = applyProjectRules(graphOf([inFixture, inSrc]), rules).extraction.symbols;
    expect(out.map((s) => (s.tier0 as { rule?: string } | null)?.rule)).toEqual(["project:fixtures", "project:exported-functions"]);
  });

  it("leaves a card someone decided one at a time to that decision, whatever the rules say", () => {
    const decided = symbol("Class", "CardBuilder", "src/cards/build.ts", "export class CardBuilder {", {
      tier0: { kind: "decide", layer: "application", type: "applicationcomponent", rule: "project:decide-card-0", confidence: "high" },
    });
    const rules = compileRules([{ name: "no-classes", where: { label: "Class" }, as: "none", reason: "classes are decided one by one" }]);
    const out = applyProjectRules(graphOf([decided]), rules, { decidedCards: new Set([decided.card.id]) }).extraction.symbols;
    expect(out[0].tier0).toEqual(decided.tier0);
  });

  it("in a since run, a typed rule leaves symbols the range did not change, and counts them", () => {
    const changed = symbol("Function", "added", "src/plan.ts", "export function added() {}");
    const untouched = symbol("Function", "old", "src/plan.ts", "export function old() {}");
    const helper = symbol("Function", "tally", "src/plan.ts", "function tally() {}");
    const rules = compileRules([
      { name: "exported-functions", where: { label: "Function", visibility: "exported" }, as: "application.applicationfunction", reason: "public behaviour" },
      { name: "local-functions", where: { label: "Function", visibility: "local" }, as: "none", reason: "helpers" },
    ]);
    const applied = applyProjectRules(graphOf([changed, untouched, helper]), rules, { changed: (s) => s.card.name === "added" });
    expect(applied.extraction.symbols.map((s) => s.tier0?.kind ?? null)).toEqual(["decide", null, "reject"]);
    expect([...applied.untouched]).toEqual([["exported-functions", 1]]);
  });

  it("matches on nesting, name, declaration and the owner's type", () => {
    const method = symbol("Method", "getName", "src/core/element.ts", "  getName(): string {");
    const errorClass = symbol("Class", "ParseError", "src/errors.ts", "export class ParseError extends Error {");
    const closure = symbol("Function", "onRow", "src/plan.ts", "const onRow = () => {", { triage: { visibility: "local", nested: true } });
    const rules = compileRules([
      { name: "closures", where: { nested: true }, as: "none", reason: "closures" },
      { name: "domain-object-methods", where: { label: "Method", ownerType: "application.dataobject" }, as: "none", reason: "a data object's methods are not modelled" },
      { name: "errors", where: { label: "Class", declaration: "\\bextends\\s+\\w*Error\\b" }, as: "none", reason: "error classes" },
    ]);
    const out = applyProjectRules(graphOf([method, errorClass, closure]), rules, {
      ownerTypeOf: (s) => (s.card.label === "Method" ? "application.dataobject" : undefined),
    }).extraction.symbols;
    expect(out.map((s) => (s.tier0 as { rule?: string } | null)?.rule)).toEqual(["project:domain-object-methods", "project:errors", "project:closures"]);
    // A member whose class has no element is not a data object's method.
    const none = applyProjectRules(graphOf([method]), rules, { ownerTypeOf: () => "none" }).extraction.symbols;
    expect(none[0].tier0).toBeNull();
  });

  it("finds the relationship rule that covers a relationship", () => {
    const rules = compileRules([
      { name: "helper-links", relationship: { source: "application.applicationfunction.json-result", predicate: "realizes" }, as: "none", reason: "a shared helper" },
    ]);
    const hit = { source: "application.applicationfunction.json-result", predicate: "realizes", target: "application.applicationservice.model-add" };
    expect(relationshipRuleFor(rules, hit)?.rule.name).toBe("helper-links");
    expect(relationshipRuleFor(rules, { ...hit, predicate: "depends-on" })).toBeUndefined();
    expect(relationshipRuleFor(rules, { ...hit, source: "application.applicationfunction.other" })).toBeUndefined();
  });

  it("names an unnamed rule from what it decides, and keeps names unique", () => {
    const rule = { where: { label: "Function", visibility: "local" as const, files: "cli/src/**" }, as: "none" };
    expect(ruleNameFor(rule, new Set())).toBe("not-local-function-in-cli-src");
    expect(ruleNameFor(rule, new Set(["not-local-function-in-cli-src"]))).toBe("not-local-function-in-cli-src-2");
    expect(ruleNameFor({ where: { label: "Interface" }, as: "data-model.objectschema" }, new Set())).toBe("objectschema-interface");
  });

  describe("the rules file", () => {
    let root: string;
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "dr-project-rules-"));
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("has no rules when there is no file, and round-trips a kept rule", async () => {
      expect(await loadProjectRules(root)).toEqual([]);
      const first = await saveProjectRule(root, {
        name: "fixtures",
        where: { files: ["fixtures/**", "docs/samples/**"] },
        as: "none",
        reason: "not product code",
        decided: { at: "2026-11-20T12:00:00.000Z", changeset: "bootstrap" },
      });
      expect(first).toEqual({ replaced: false, file: projectRulesPath(root) });
      await saveProjectRule(root, { name: "exported-functions", where: { label: "Function", visibility: "exported" }, as: "application.applicationfunction", reason: "public behaviour" });
      // The same name replaces, in place.
      expect((await saveProjectRule(root, { name: "fixtures", where: { files: "fixtures/**" }, as: "none", reason: "only the fixtures" })).replaced).toBe(true);
      const loaded = await loadProjectRules(root);
      expect(loaded.map((r) => r.rule.name)).toEqual(["fixtures", "exported-functions"]);
      expect(loaded[0].rule).toEqual({ name: "fixtures", where: { files: "fixtures/**" }, as: "none", reason: "only the fixtures" });
      const text = await readFile(projectRulesPath(root), "utf-8");
      expect(text.startsWith("# Extraction rules for this project")).toBe(true);
      expect(text).toContain("version: 1");
    });

    it("doesn't write a rule the file already holds under another name", async () => {
      const rule = { name: "not-in-design", where: { files: "design/**" }, as: "none", reason: "prototypes" };
      await saveProjectRule(root, rule);
      const again = await saveProjectRule(root, { ...rule, name: "not-in-design-2", reason: "said again" });
      expect(again).toEqual({ replaced: false, file: projectRulesPath(root), duplicateOf: "not-in-design" });
      expect((await loadProjectRules(root)).map((r) => r.rule.name)).toEqual(["not-in-design"]);
      // One that decides more (it overrides Tier 0) is another rule.
      expect((await saveProjectRule(root, { ...rule, name: "not-in-design-2", overrideTier0: true })).duplicateOf).toBeUndefined();
    });

    it("refuses a file it cannot read as rules, saying which rule and why", async () => {
      await mkdir(join(root, "documentation-robotics"), { recursive: true });
      await writeFile(projectRulesPath(root), "version: 1\nrules:\n  - name: bad\n    where: { label: Function }\n    as: application.nothing\n    reason: x\n", "utf-8");
      await expect(loadProjectRules(root)).rejects.toThrow("rule 'bad': the application layer has no type 'nothing'");
      await writeFile(projectRulesPath(root), "version: 1\nrules: nope\n", "utf-8");
      await expect(loadProjectRules(root)).rejects.toThrow("'rules' must be a list");
      await writeFile(projectRulesPath(root), "rules: []\n", "utf-8");
      await expect(loadProjectRules(root)).rejects.toThrow("has no version");
      // A top-level typo, another version, an unknown label or predicate: refused, not silently ignored.
      await writeFile(projectRulesPath(root), "version: 1\nrule:\n  - name: x\n", "utf-8");
      await expect(loadProjectRules(root)).rejects.toThrow("unknown key 'rule'");
      await writeFile(projectRulesPath(root), "version: 9\nrules: []\n", "utf-8");
      await expect(loadProjectRules(root)).rejects.toThrow("is version 9");
      await writeFile(projectRulesPath(root), "version: 1\nrules:\n  - name: x\n    where: { label: Funktion }\n    as: none\n    reason: y\n", "utf-8");
      await expect(loadProjectRules(root)).rejects.toThrow("'Funktion' is not a card label");
      await writeFile(projectRulesPath(root), "version: 1\nrules:\n  - name: x\n    relationship: { source: a.b.c, predicate: realises }\n    as: none\n    reason: y\n", "utf-8");
      await expect(loadProjectRules(root)).rejects.toThrow("'realises' is not a predicate");
    });
  });
});

function undecided(symbol: string, file: string | null, label = "Function", extra: Partial<UndecidedCard> = {}): UndecidedCard {
  return { cardId: `${file}#${symbol}`, kind: "no-rule", label, symbol, file, lines: "1-2", qualifiedName: symbol, candidates: [], reason: "", ...extra };
}

describe("triage views", () => {
  const cards = [
    undecided("a", "cli/src/core/a.ts", "Function", { visibility: "exported", changedInRange: true }),
    undecided("b", "cli/src/core/a.ts", "Function", { visibility: "local" }),
    undecided("c", "cli/src/mcp/c.ts", "Method", { visibility: "private" }),
    undecided("d", "cli/src/mcp/c.ts", "Function", { visibility: "local", nested: true }),
    undecided("e", "design/proto/e.js", "Function", { visibility: "local" }),
    undecided("f", "design/proto/f.js", "Class", { visibility: "exported" }),
    undecided("g", "main.ts", "Function"),
    undecided("GET /x", null, "Route", { kind: "unhandled-route" }),
  ];

  it("groups by folder with counts over all the cards, and marks folders no element names", () => {
    const groups = groupCards(cards, new Map([["cli/src/core/a.ts", 3]]), { since: true });
    expect(groups.map((g) => [g.path, g.cards])).toEqual([
      ["cli/src/", 4],
      ["design/proto/", 2],
      ["(no file)", 1],
      ["main.ts", 1],
    ]);
    expect(groups[0]).toEqual({
      path: "cli/src/",
      cards: 4,
      files: 2,
      changed: 1,
      labels: { Function: 3, Method: 1 },
      visibility: { exported: 1, local: 1, private: 1, nested: 1 },
      elements: 3,
    });
    expect(groups[1]).toMatchObject({ path: "design/proto/", elements: 0, noElement: true });
    expect(groups.reduce((n, g) => n + g.cards, 0)).toBe(cards.length);
    // A deeper depth opens the folder.
    expect(groupCards(cards, new Map(), { depth: 3 }).map((g) => g.path)).toContain("cli/src/core/a.ts");
    // With a model that names no file, no group is marked.
    expect(groupCards(cards, new Map()).some((g) => g.noElement)).toBe(false);
  });

  it("counts by label and visibility", () => {
    expect(kindRows(cards).slice(0, 3)).toEqual([
      { label: "Function", visibility: "local", cards: 2 },
      { label: "Class", visibility: "exported", cards: 1 },
      { label: "Function", visibility: "-", cards: 1 },
    ]);
    expect(kindRows(cards).reduce((n, r) => n + r.cards, 0)).toBe(cards.length);
  });

  it("filters cards by files, label, visibility, kind, nesting and change", () => {
    expect(filterCards(cards, {}).length).toBe(cards.length);
    expect(filterCards(cards, { files: "design/**" }).map((c) => c.symbol)).toEqual(["e", "f"]);
    expect(filterCards(cards, { files: ["cli/src/core/", "main.ts"], label: "Function" }).map((c) => c.symbol)).toEqual(["a", "b", "g"]);
    expect(filterCards(cards, { visibility: ["private", "exported"] }).map((c) => c.symbol)).toEqual(["a", "c", "f"]);
    expect(filterCards(cards, { nested: true }).map((c) => c.symbol)).toEqual(["d"]);
    expect(filterCards(cards, { changed: true }).map((c) => c.symbol)).toEqual(["a"]);
    expect(filterCards(cards, { changed: false }).length).toBe(cards.length - 1);
    expect(filterCards(cards, { kind: "unhandled-route" }).map((c) => c.symbol)).toEqual(["GET /x"]);
  });

  it("pages a list so the pages together are the whole list", () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    const more = (next: number) => `offset ${next}`;
    const first = pageOf(items, 10, 0, more);
    expect(first).toEqual({ total: 23, returned: 10, items: items.slice(0, 10), nextOffset: 10, more: "offset 10" });
    const second = pageOf(items, 10, first.nextOffset, more);
    const third = pageOf(items, 10, second.nextOffset, more);
    expect(third).toEqual({ total: 23, returned: 3, offset: 20, items: [20, 21, 22] });
    expect([...first.items, ...second.items, ...third.items]).toEqual(items);
    // A limit of 0 is the total and the call for the items.
    expect(pageOf(items, 0, 0, more)).toEqual({ total: 23, returned: 0, items: [], nextOffset: 0, more: "offset 0" });
    expect(pageOf(items, 50)).toEqual({ total: 23, returned: 23, items });
  });

  it("lists the functions more services share than the line, with totals over every link", () => {
    const S = (n: number) => `application.applicationservice.s${n}`;
    const link = (source: string, n: number) => ({ source: `application.applicationfunction.${source}`, predicate: "realizes", target: S(n) });
    const all = [
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => link("json-result", n)),
      ...[1, 2, 3].map((n) => link("load-model", n)),
      link("build-plan", 1),
      { source: "application.applicationfunction.json-result", predicate: "depends-on", target: S(9) },
      { source: "application.applicationfunction.json-result", predicate: "realizes", target: "product.feature.x" },
    ];
    const staging = all.slice(0, 4);
    const isService = (id: string) => id.startsWith("application.applicationservice.");
    expect(sharedHelperGroups(all, staging, isService)).toEqual({
      sharedBy: 5,
      links: 7,
      staging: 4,
      helpers: [{ id: "application.applicationfunction.json-result", services: 7, staging: 4 }],
    });
    // The line is the caller's to move.
    expect(sharedHelperGroups(all, staging, isService, 2).helpers.map((h) => [h.id.split(".").pop(), h.services])).toEqual([
      ["json-result", 7],
      ["load-model", 3],
    ]);
    expect(sharedHelperGroups(all, staging, isService, 10).helpers).toEqual([]);
  });

  it("says which planned elements the as-built side has, and which cards could be the others", () => {
    const planned = [
      { id: "application.applicationcomponent.change-inspector", layer: "application", type: "applicationcomponent", name: "ChangeInspector", locations: [{ file: "src/ui/ChangeInspector.tsx" }] },
      { id: "ux.subview.change-inspector-panel", layer: "ux", type: "subview", name: "Change inspector panel", locations: [{ file: "src/ui/ChangeInspector.tsx" }] },
      { id: "application.applicationfunction.build-review-model", layer: "application", type: "applicationfunction", name: "buildReviewModel", locations: [] },
      { id: "application.applicationfunction.not-built", layer: "application", type: "applicationfunction", name: "notBuilt", locations: [] },
    ];
    const run = [
      undecided("ChangeInspector", "src/ui/ChangeInspector.tsx", "Function", { changedInRange: true }),
      undecided("OpChip", "src/ui/ChangeInspector.tsx"),
      undecided("buildReviewModel", "src/data/changesetReview.ts", "Function", { changedInRange: true }),
    ];
    const coverage = planCoverage(planned, new Map(), run);
    // An as-built element named after one symbol of the file does not cover the planned component.
    expect(coverage[0]).toMatchObject({ planned: "application.applicationcomponent.change-inspector", status: "candidates" });
    expect(coverage[0].candidates!.map((c) => c.symbol)).toEqual(["ChangeInspector", "OpChip"]);
    // The same file backs a ux sub-view too: staging the component would not cover it.
    expect(coverage[1]).toMatchObject({ planned: "ux.subview.change-inspector-panel", type: "ux.subview", status: "candidates" });
    // No source reference: matched by name.
    expect(coverage[2]).toMatchObject({ status: "candidates", candidates: [{ symbol: "buildReviewModel", changedInRange: true }] });
    expect(coverage[3]).toEqual({ planned: "application.applicationfunction.not-built", type: "application.applicationfunction", status: "none" });
    // Once staged, by id or by its source location with the planned type.
    const staged = planCoverage(planned, new Map([["application.applicationcomponent.change-inspector", { built: "application.applicationcomponent.change-inspector", match: "exact" as const }]]), run);
    expect(staged[0]).toEqual({ planned: "application.applicationcomponent.change-inspector", type: "application.applicationcomponent", status: "staged", asBuilt: "application.applicationcomponent.change-inspector" });
  });
});
