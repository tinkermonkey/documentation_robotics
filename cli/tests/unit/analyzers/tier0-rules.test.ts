/**
 * Tier-0 rule engine (src/analyzers/tier0-rules.ts) and the cbm analyzer's rules.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { declarationOf, evaluateTier0, tier0RulesFrom } from "@/analyzers/tier0-rules";
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

  it("rejects unknown conditions and malformed targets", () => {
    expect(() => tier0RulesFrom([rule("r", { labels: ["Class"], when: { parent: "x" }, decide: "none" })])).toThrow(/unknown condition/);
    expect(() => tier0RulesFrom([rule("r", { labels: ["Class"], decide: "application" })])).toThrow(/layer.type/);
    expect(() => tier0RulesFrom([rule("r", { labels: ["Class"], decide: "application.*" })])).toThrow(/needs a type/);
  });
});

describe("evaluateTier0", () => {
  const rules = tier0RulesFrom([
    rule("specific", { labels: ["Method"], when: { decorator: "^GetMapping$" }, decide: "api.operation", confidence: "high" }),
    rule("fallback", { labels: ["Method", "Class"], narrow: ["application.applicationfunction", "testing.*"] }),
  ]);

  it("returns the first matching rule", () => {
    expect(evaluateTier0({ label: "Method", name: "list", decorator_names: ["GetMapping"] }, rules)).toEqual({
      kind: "decide", rule: "specific", layer: "api", type: "operation", confidence: "high",
    });
  });

  it("falls through to a narrowing rule and expands layer.*", () => {
    const o = evaluateTier0({ label: "Method", name: "list", decorator_names: ["Override"] }, rules);
    expect(o).toEqual({ kind: "narrow", rule: "fallback", confidence: "medium", candidates: [{ layer: "application", type: "applicationfunction" }, { layer: "testing", type: null }] });
  });

  it("returns null when no rule covers the label", () => {
    expect(evaluateTier0({ label: "Module", name: "m" }, rules)).toBeNull();
  });
});

describe("declarationOf", () => {
  it("skips annotations and comments", () => {
    expect(declarationOf("@Entity\n@Table(name = \"pets\")\n// a pet\npublic class Pet extends NamedEntity {")).toBe("public class Pet extends NamedEntity {");
  });
  it("falls back to the signature", () => {
    expect(declarationOf(null, "def f(x)")).toBe("def f(x)");
  });
});

describe("cbm Tier-0 rules", () => {
  const decide = (s: Parameters<typeof evaluateTier0>[0]) => {
    const o = evaluateTier0(s, cbmRules);
    return o?.kind === "decide" ? `${o.layer}${o.type ? "." + o.type : ""}` : o ? `narrow:${o.rule}` : null;
  };

  it("compile", () => {
    expect(cbmRules.length).toBeGreaterThan(5);
  });

  it("decide the framework cases the inventory names", () => {
    expect(decide({ label: "Method", name: "showVetList", decorator_names: ["GetMapping"] })).toBe("api.operation");
    expect(decide({ label: "Function", name: "update_item", decorator_names: ["router.put"] })).toBe("api.operation");
    expect(decide({ label: "Class", name: "VetController", decorator_names: ["Controller"] })).toBe("application.applicationinterface");
    expect(decide({ label: "Class", name: "Owner", decorator_names: ["Entity", "Table"] })).toBe("data-model.objectschema");
    expect(decide({ label: "Interface", name: "OwnerRepository", declaration: "public interface OwnerRepository extends JpaRepository<Owner, Integer> {" })).toBe("data-store.accesspattern");
    expect(decide({ label: "Class", name: "Item", declaration: "class Item(ItemBase, table=True):" })).toBe("data-store.collection");
    expect(decide({ label: "Class", name: "ItemBase", declaration: "class ItemBase(SQLModel):" })).toBe("data-model.objectschema");
    expect(decide({ label: "Interface", name: "Options", file_path: "frontend/src/client/core/types.gen.ts" })).toBe("none");
    expect(decide({ label: "Interface", name: "LogoProps", file_path: "frontend/src/components/Common/Logo.tsx" })).toBe("none");
  });

  it("narrow other interfaces and leave other classes to the classifier", () => {
    expect(decide({ label: "Interface", name: "SyncResult", file_path: "src/core/sync.ts" })).toBe("narrow:tier0_interface_default");
    expect(decide({ label: "Class", name: "Model", declaration: "export class Model {" })).toBeNull();
  });
});
