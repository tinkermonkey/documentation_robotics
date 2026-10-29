/**
 * The cbm analyzer mapping must name only what the spec has: node types that exist, and for
 * every edge that creates DR relationships, a triple in the relationship catalog. See
 * docs/analyzers/CBM_MAPPING_INVENTORY.md for how the mapping was found to drift.
 */
import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tier0RulesFrom } from "@/analyzers/tier0-rules";

const DIST = resolve(import.meta.dir, "../../../../spec/dist");
const cbm = JSON.parse(readFileSync(join(DIST, "analyzers", "cbm.json"), "utf-8"));
// unmapped_labels is documentation and is not packed into the compiled artifact
const nodeMappingSource = JSON.parse(readFileSync(resolve(DIST, "../analyzers/cbm/node-mapping.json"), "utf-8"));

const types = new Set<string>();
const triples = new Set<string>();
const layers = new Set<string>();
for (const f of readdirSync(DIST).filter((f) => f.endsWith(".json") && f !== "base.json" && f !== "manifest.json")) {
  const layer = JSON.parse(readFileSync(join(DIST, f), "utf-8"));
  if (!layer.nodeSchemas) continue;
  layers.add(f.replace(/\.json$/, ""));
  for (const s of Object.values(layer.nodeSchemas) as Array<{ properties?: { spec_node_id?: { const?: string } } }>) {
    const id = s.properties?.spec_node_id?.const;
    if (id) types.add(id);
  }
  for (const id of Object.keys(layer.relationshipSchemas ?? {})) triples.add(id);
}

/** Node labels documented by codebase-memory-mcp 0.10.2 (README, binary and observed graphs). */
const CBM_LABELS = [
  "Project", "Package", "Folder", "File", "Module", "Class", "Function", "Method", "Interface", "Enum", "Type",
  "Struct", "Trait", "Field", "Variable", "Constant", "Macro", "Decorator", "Route", "Section", "Channel",
  "EnvVar", "Table", "Process", "Resource", "Chart", "Image", "Branch",
];

describe("cbm mapping names only what the spec has", () => {
  it("found the catalog", () => {
    expect(types.size).toBeGreaterThan(100);
    expect(triples.size).toBeGreaterThan(1000);
  });

  it("maps every node label to an existing type", () => {
    for (const [label, m] of Object.entries(cbm.nodes_by_label) as Array<[string, { dr_layer: string; dr_element_type: string; dr_element_type_promoted?: string }]>) {
      expect({ label, type: `${m.dr_layer}.${m.dr_element_type}`, ok: types.has(`${m.dr_layer}.${m.dr_element_type}`) }).toMatchObject({ ok: true });
      if (m.dr_element_type_promoted) expect(types.has(`${m.dr_layer}.${m.dr_element_type_promoted}`)).toBe(true);
    }
  });

  it("accounts for every documented CBM label exactly once", () => {
    const mapped = Object.keys(cbm.nodes_by_label);
    const unmapped: string[] = nodeMappingSource.unmapped_labels?.labels ?? [];
    expect(mapped.filter((l) => unmapped.includes(l))).toEqual([]);
    expect([...mapped, ...unmapped].sort()).toEqual([...CBM_LABELS].sort());
  });

  it("names a catalog triple for every edge that creates relationships", () => {
    for (const [edge, m] of Object.entries(cbm.edges_by_type) as Array<[string, { usage?: string; dr_relationship: string | null; dr_pattern?: string }]>) {
      if (m.usage !== "verification_and_mapping") continue;
      const [src, dst] = (m.dr_pattern ?? "").split(/\s*→\s*/);
      const triple = `${src}.${m.dr_relationship}.${dst}`;
      expect({ edge, triple, ok: triples.has(triple) }).toMatchObject({ ok: true });
    }
  });

  it("lists the call-graph default edge first", () => {
    expect(Object.keys(cbm.edges_by_type)[0]).toBe("CALLS");
  });

  it("names existing types in heuristics and Tier-0 rules", () => {
    for (const h of cbm.heuristics.heuristics as Array<{ name: string; applies_to?: string[] }>) {
      for (const t of h.applies_to ?? []) expect({ heuristic: h.name, t, ok: types.has(t) }).toMatchObject({ ok: true });
    }
    for (const r of tier0RulesFrom(cbm.heuristics.heuristics)) {
      for (const c of [...(r.decide && r.decide !== "none" ? [r.decide] : []), ...(r.narrow ?? [])]) {
        const ok = c.type === null ? layers.has(c.layer) : types.has(`${c.layer}.${c.type}`);
        expect({ rule: r.name, c, ok }).toMatchObject({ ok: true });
      }
      for (const l of r.labels) expect(CBM_LABELS).toContain(l);
    }
  });
});
