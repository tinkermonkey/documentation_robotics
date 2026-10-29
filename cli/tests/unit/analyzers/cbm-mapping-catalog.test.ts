/**
 * The cbm analyzer mapping must name only what the spec has: node types that exist, and for
 * every edge that creates DR relationships, a triple in the relationship catalog. See
 * docs/analyzers/CBM_MAPPING_INVENTORY.md for how the mapping was found to drift.
 */
import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tier0RulesFrom } from "@/analyzers/tier0-rules";
import { edgePreferences } from "@/analyzers/edge-relationships";
import type { AnalyzerEdgeMapping } from "@/analyzers/types";

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

/** Edge types documented by codebase-memory-mcp 0.10.2, plus those seen only in its binary or graph UI. */
const CBM_EDGES = [
  "CALLS", "HANDLES", "HTTP_CALLS", "DEFINES_METHOD", "IMPORTS", "CALL_REFERENCE", "DATA_FLOWS", "USAGE", "WRITES",
  "IMPLEMENTS", "TESTS", "TESTS_FILE", "ASYNC_CALLS", "LISTENS_ON", "SPAWNS", "DEPENDS_ON", "INFRA_MAPS", "DEPLOYS",
  "GRPC_CALLS", "GRAPHQL_CALLS", "TRPC_CALLS", "INHERITS", "EXTENDS", "OVERRIDE", "EMITS", "RAISES", "THROWS",
  "CONTAINS_FOLDER", "CONNECTS_TO", "DEFINES", "DECORATES", "CONFIGURES", "CONTAINS_FILE", "CONTAINS_PACKAGE",
  "MEMBER_OF", "RESOLVED_CALLS", "SEMANTICALLY_RELATED", "SIMILAR_TO", "FILE_CHANGES_WITH", "HAS_BRANCH",
  "REFERENCES_FILE", "MENTIONS", "CROSS_HTTP_CALLS", "CROSS_GRPC_CALLS", "CROSS_GRAPHQL_CALLS", "CROSS_TRPC_CALLS",
  "CROSS_ASYNC_CALLS", "CROSS_CHANNEL",
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

  it("gives every relationship-creating edge real predicates and a catalog example", () => {
    const predicates = new Set(Object.keys(JSON.parse(readFileSync(join(DIST, "base.json"), "utf-8")).predicates));
    for (const [edge, m] of Object.entries(cbm.edges_by_type) as Array<[string, AnalyzerEdgeMapping]>) {
      if (m.usage !== "verification_and_mapping") continue;
      const prefs = edgePreferences(m);
      expect({ edge, preferences: prefs.length > 0 }).toMatchObject({ preferences: true });
      for (const p of prefs) expect({ edge, predicate: p.predicate, ok: predicates.has(p.predicate) }).toMatchObject({ ok: true });
      expect(prefs.map((p) => p.predicate)).toContain(m.dr_relationship);
      const [src, dst] = (m.dr_pattern ?? "").split(/\s*→\s*/);
      const triple = `${src}.${m.dr_relationship}.${dst}`;
      expect({ edge, triple, ok: triples.has(triple) }).toMatchObject({ ok: true });
    }
  });

  it("accounts for every CBM edge type exactly once", () => {
    expect(Object.keys(cbm.edges_by_type).sort()).toEqual([...CBM_EDGES].sort());
  });

  it("says why every traversal-only edge creates no relationship", () => {
    for (const [edge, m] of Object.entries(cbm.edges_by_type) as Array<[string, { usage?: string; implementation_note?: string }]>) {
      if (m.usage === "traversal_only") expect({ edge, note: (m.implementation_note ?? "").length > 20 }).toMatchObject({ note: true });
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
