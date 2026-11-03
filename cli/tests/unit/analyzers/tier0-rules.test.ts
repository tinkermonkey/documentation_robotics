/**
 * Tier-0 rule engine (src/analyzers/tier0-rules.ts) and the cbm analyzer's rules.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { declarationOf, evaluateTier0, tier0RulesFrom, type Tier0Symbol } from "@/analyzers/tier0-rules";
import type { AnalyzerHeuristic } from "@/analyzers/types";

const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/dist/analyzers/cbm.json"), "utf-8"));
const cbmRules = tier0RulesFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]);

const rule = (name: string, tier0: Record<string, unknown>): AnalyzerHeuristic => ({ name, description: name, parameters: { tier0 } as never });

describe("tier0RulesFrom", () => {
  it("ignores heuristics without a tier0 block", () => {
    expect(tier0RulesFrom([{ name: "min_fan_in", description: "x", parameters: { threshold: 5 } }])).toEqual([]);
  });

  it("rejects a rule with both or neither of decide and narrow", () => {
    expect(() => tier0RulesFrom([rule("r", { labels: ["Class"], decide: "none", narrow: ["application.*"] })])).toThrow(/exactly one/);
    expect(() => tier0RulesFrom([rule("r", { labels: ["Class"] })])).toThrow(/exactly one/);
  });

  it("rejects unknown keys, so a misspelt 'when' cannot match everything", () => {
    expect(() => tier0RulesFrom([rule("r", { labels: ["Class"], whne: { name: "^X$" }, decide: "none" })])).toThrow(/unknown key 'whne'/);
    expect(() => tier0RulesFrom([rule("r", { labels: ["Class"], when: { parent: "x" }, decide: "none" })])).toThrow(/unknown condition/);
  });

  it("rejects malformed targets", () => {
    expect(() => tier0RulesFrom([rule("r", { labels: ["Class"], decide: "application" })])).toThrow(/layer.type/);
    expect(() => tier0RulesFrom([rule("r", { labels: ["Class"], decide: "application.*" })])).toThrow(/needs a type/);
  });

  it("compiles decide 'none' to a reject action", () => {
    expect(tier0RulesFrom([rule("r", { labels: ["Class"], decide: "none" })])[0].action).toEqual({ kind: "reject" });
  });
});

describe("evaluateTier0", () => {
  const rules = tier0RulesFrom([
    rule("specific", { labels: ["Method"], when: { decorator: "^GetMapping$" }, decide: "api.operation", confidence: "high" }),
    rule("drop", { labels: ["Method"], when: { name: "^toString$" }, decide: "none" }),
    rule("fallback", { labels: ["Method", "Class"], narrow: ["application.applicationfunction", "testing.*"] }),
  ]);

  it("returns the first matching rule", () => {
    expect(evaluateTier0({ label: "Method", name: "list", decorator_names: ["GetMapping"] }, rules)).toEqual({
      kind: "decide", layer: "api", type: "operation", rule: "specific", confidence: "high",
    });
  });

  it("returns a reject without a layer", () => {
    expect(evaluateTier0({ label: "Method", name: "toString" }, rules)).toEqual({ kind: "reject", rule: "drop", confidence: "medium" });
  });

  it("falls through to a narrowing rule and keeps layer.* as a null type", () => {
    expect(evaluateTier0({ label: "Method", name: "list", decorator_names: ["Override"] }, rules)).toEqual({
      kind: "narrow", rule: "fallback", confidence: "medium",
      candidates: [{ layer: "application", type: "applicationfunction" }, { layer: "testing", type: null }],
    });
  });

  it("returns null when no rule covers the label", () => {
    expect(evaluateTier0({ label: "Module", name: "m" }, rules)).toBeNull();
  });
});

describe("declarationOf", () => {
  const cases: Array<[string, string, string]> = [
    ["skips annotations and comments", '@Entity\n@Table(name = "pets")\n// a pet\npublic class Pet extends NamedEntity {', "public class Pet extends NamedEntity {"],
    ["skips a decorator whose arguments span lines", '@router.get(\n    "/items/{id}",\n    response_model=Item,\n)\ndef read_item(id): ...', "def read_item(id): ..."],
    ["joins a declaration whose brackets span lines", "class Item(\n    ItemBase, table=True\n):\n    id: int", "class Item(ItemBase, table=True):"],
    ["strips an annotation on the declaration line", "@Repository public interface OwnerRepository extends JpaRepository<Owner, Integer> {\n  Owner findById(Integer id);", "public interface OwnerRepository extends JpaRepository<Owner, Integer> {"],
    ["skips a one-line docstring", '"""Module docstring."""\nclass Foo:', "class Foo:"],
    ["skips a multi-line docstring", '"""\nA module.\n"""\nclass Foo(Base):', "class Foo(Base):"],
    ["ignores parentheses inside strings", '@GetMapping("/owners/new)")\npublic String initCreationForm(Owner owner) {', "public String initCreationForm(Owner owner) {"],
  ];
  for (const [what, source, expected] of cases) {
    it(what, () => expect(declarationOf(source)).toBe(expected));
  }
  it("falls back to the signature", () => {
    expect(declarationOf(null, "def f(x)")).toBe("def f(x)");
  });
});

describe("cbm Tier-0 rules", () => {
  const answer = (s: Tier0Symbol) => {
    const o = evaluateTier0(s, cbmRules);
    if (!o) return null;
    if (o.kind === "decide") return `${o.layer}.${o.type}`;
    if (o.kind === "reject") return "none";
    return `narrow:${o.rule}`;
  };

  it("compile", () => {
    expect(cbmRules.length).toBeGreaterThan(10);
  });

  it("decide the framework cases the inventory names", () => {
    expect(answer({ label: "Class", name: "VetController", decorator_names: ["Controller"] })).toBe("application.applicationinterface");
    expect(answer({ label: "Class", name: "Owner", decorator_names: ["Entity", "Table"] })).toBe("data-model.objectschema");
    expect(answer({ label: "Interface", name: "OwnerRepository", declaration: "public interface OwnerRepository extends JpaRepository<Owner, Integer> {" })).toBe("data-store.accesspattern");
    expect(answer({ label: "Class", name: "ItemBase", declaration: "class ItemBase(SQLModel):" })).toBe("data-model.objectschema");
    expect(answer({ label: "Interface", name: "Options", file_path: "frontend/src/client/core/types.gen.ts" })).toBe("none");
    expect(answer({ label: "Interface", name: "LogoProps", file_path: "frontend/src/components/Common/Logo.tsx" })).toBe("none");
  });

  it("file a route handler as the application function the route's operation realizes", () => {
    for (const d of ["GetMapping", "router.put", "items_router.get", "app.post", "Get", "GET"]) {
      expect({ d, a: answer({ label: "Method", name: "h", decorator_names: [d] }) }).toEqual({ d, a: "application.applicationfunction" });
    }
  });

  it("give ORM table classes the same layer whatever the framework", () => {
    expect(answer({ label: "Class", name: "Item", declaration: "class Item(ItemBase, table=True):" })).toBe(answer({ label: "Class", name: "Pet", decorator_names: ["Entity"] }));
  });

  it("let test-file rules win over framework rules", () => {
    expect(answer({ label: "Class", name: "Fixture", file_path: "backend/tests/conftest_models.py", declaration: "class Fixture(SQLModel, table=True):" })).toBe("narrow:tier0_test_file");
  });

  it("narrow other interfaces but not structs, and leave other classes to the classifier", () => {
    expect(answer({ label: "Interface", name: "SyncResult", file_path: "src/core/sync.ts" })).toBe("narrow:tier0_interface_default");
    expect(answer({ label: "Struct", name: "OrderService", file_path: "internal/order/service.go" })).toBeNull();
    expect(answer({ label: "Class", name: "Model", declaration: "export class Model {" })).toBeNull();
  });

  it("narrow routing files only where file-based routing puts them", () => {
    expect(answer({ label: "Module", name: "items", file_path: "frontend/src/routes/_layout/items.tsx" })).toBe("narrow:tier0_file_route");
    expect(answer({ label: "Module", name: "page", file_path: "web/app/items/page.tsx" })).toBe("narrow:tier0_file_route");
    expect(answer({ label: "Module", name: "useItems", file_path: "web/app/hooks/useItems.tsx" })).toBeNull();
  });
});
