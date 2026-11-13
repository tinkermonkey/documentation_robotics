/**
 * The cbm analyzer mapping must name only what the spec has: node types that exist, and for
 * every edge that creates DR relationships, a triple in the relationship catalog. See
 * docs/analyzers/CBM_MAPPING_INVENTORY.md for how the mapping was found to drift.
 */
import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tier0RulesFrom } from "@/analyzers/tier0-rules";
import { edgePreferences, relationshipFor } from "@/analyzers/edge-relationships";
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

/**
 * Node labels codebase-memory-mcp 0.12.1 produces: the 28 its README documents (0.10.2's listed
 * 13; the 28 first appear at 0.12.0), plus ADR, Diagram and DiagramElement, which 0.12.x emits
 * but the README's label list leaves out.
 */
const CBM_LABELS = [
  "Project", "Package", "Folder", "File", "Module", "Class", "Function", "Method", "Interface", "Enum", "Type",
  "Struct", "Trait", "Field", "Variable", "Constant", "Macro", "Decorator", "Route", "Section", "Channel",
  "EnvVar", "Table", "Process", "Resource", "Chart", "Image", "Branch",
  "ADR", "Diagram", "DiagramElement",
];

/**
 * Edge types codebase-memory-mcp 0.12.1 documents, plus those its pipeline emits without
 * documenting (GRAPHQL_CALLS, TRPC_CALLS, READS, SUPERSEDES, DIAGRAM_ARROW) and EXTENDS, which is
 * in its binary only.
 */
const CBM_EDGES = [
  "CALLS", "HANDLES", "HTTP_CALLS", "DEFINES_METHOD", "IMPORTS", "CALL_REFERENCE", "DATA_FLOWS", "USAGE", "WRITES",
  "IMPLEMENTS", "TESTS", "TESTS_FILE", "ASYNC_CALLS", "LISTENS_ON", "SPAWNS", "DEPENDS_ON", "INFRA_MAPS", "DEPLOYS",
  "GRPC_CALLS", "GRAPHQL_CALLS", "TRPC_CALLS", "INHERITS", "EXTENDS", "OVERRIDE", "EMITS", "RAISES", "THROWS",
  "CONTAINS_FOLDER", "CONNECTS_TO", "DEFINES", "DECORATES", "CONFIGURES", "CONTAINS_FILE",
  "SEMANTICALLY_RELATED", "SIMILAR_TO", "FILE_CHANGES_WITH", "HAS_BRANCH",
  "REFERENCES_FILE", "MENTIONS", "CROSS_HTTP_CALLS", "CROSS_GRPC_CALLS", "CROSS_GRAPHQL_CALLS", "CROSS_TRPC_CALLS",
  "CROSS_ASYNC_CALLS", "CROSS_CHANNEL",
  "READS", "SUPERSEDES", "DIAGRAM_ARROW",
];

describe("cbm mapping names only what the spec has", () => {
  it("found the catalog", () => {
    expect(types.size).toBeGreaterThan(100);
    expect(triples.size).toBeGreaterThan(900);
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

  it("restricts edge ends only to types and layers that exist", () => {
    for (const [edge, m] of Object.entries(cbm.edges_by_type) as Array<[string, AnalyzerEdgeMapping]>) {
      const c = (m.conditions ?? {}) as { from_types?: string[]; to_types?: string[] };
      const prefTypes = edgePreferences(m).flatMap((p) => [...(p.from_types ?? []), ...(p.to_types ?? [])]);
      for (const t of [...(c.from_types ?? []), ...(c.to_types ?? []), ...prefTypes]) {
        const ok = t.endsWith(".*") ? layers.has(t.slice(0, -2)) : types.has(t);
        expect({ edge, t, ok }).toMatchObject({ ok: true });
      }
    }
  });

  it("maps USAGE from a node to its image as composes, keeping the data-object targets (#1107 follow-up)", () => {
    const usage = cbm.edges_by_type.USAGE as AnalyzerEdgeMapping;
    expect((usage.conditions as { to_types?: string[] }).to_types).toEqual(["application.dataobject", "data-model.objectschema", "api.schema"]);
    const scoped = edgePreferences(usage).filter((p) => p.from_types?.length && p.to_types?.length);
    expect(scoped).toEqual([{ predicate: "composes", invert: false, from_types: ["technology.node"], to_types: ["technology.artifact"] }]);
    expect(triples.has("technology.node.composes.technology.artifact")).toBe(true);
  });

  it("accounts for every CBM edge type exactly once", () => {
    expect(Object.keys(cbm.edges_by_type).sort()).toEqual([...CBM_EDGES].sort());
  });

  it("says why every traversal-only edge creates no relationship", () => {
    for (const [edge, m] of Object.entries(cbm.edges_by_type) as Array<[string, { usage?: string; implementation_note?: string }]>) {
      if (m.usage === "traversal_only") expect({ edge, note: (m.implementation_note ?? "").length > 20 }).toMatchObject({ note: true });
    }
  });

  it("names existing types in heuristics and Tier-0 rules", () => {
    for (const h of cbm.heuristics.heuristics as Array<{ name: string; applies_to?: string[] }>) {
      for (const t of h.applies_to ?? []) expect({ heuristic: h.name, t, ok: types.has(t) }).toMatchObject({ ok: true });
    }
    for (const r of tier0RulesFrom(cbm.heuristics.heuristics)) {
      const targets = r.action.kind === "decide" ? [{ layer: r.action.layer, type: r.action.type as string | null }] : r.action.kind === "narrow" ? r.action.candidates : [];
      for (const c of targets) {
        const ok = c.type === null ? layers.has(c.layer) : types.has(`${c.layer}.${c.type}`);
        expect({ rule: r.name, c, ok }).toMatchObject({ ok: true });
      }
      for (const l of r.labels) expect(CBM_LABELS).toContain(l);
    }
  });
});

describe("cbm infrastructure mapping (#1081)", () => {
  it("maps the infrastructure labels CBM extracts", () => {
    const type = (label: string) => `${cbm.nodes_by_label[label]?.dr_layer}.${cbm.nodes_by_label[label]?.dr_element_type}`;
    expect(type("Table")).toBe("data-store.collection");
    expect(type("Image")).toBe("technology.artifact");
    expect(type("Chart")).toBe("technology.artifact");
    expect(type("Resource")).toBe("technology.node");
    expect(type("Process")).toBe("technology.systemsoftware");
    // Table, Image and Chart are decided by label; Resource by kind and Process by Tier-0 rules.
    expect(["Table", "Image", "Chart"].map((l) => cbm.nodes_by_label[l].confidence)).toEqual(["high", "high", "high"]);
  });

  it("turns the infrastructure edges into catalog relationships between infrastructure types", () => {
    const hasTriple = (id: string) => triples.has(id);
    const rel = (edge: string, from: string, to: string) => relationshipFor(cbm.edges_by_type[edge], from, to, hasTriple)?.id ?? null;
    // INFRA_MAPS runs Service -> workload in CBM; the workload realizes the service.
    expect(rel("INFRA_MAPS", "technology.technologyservice", "technology.node")).toBe("technology.node.realizes.technology.technologyservice");
    // compose depends_on between services, and an image on an image.
    expect(rel("DEPENDS_ON", "technology.node", "technology.node")).toBe("technology.node.depends-on.technology.node");
    expect(rel("DEPENDS_ON", "technology.artifact", "technology.artifact")).toBe("technology.artifact.depends-on.technology.artifact");
    // A component that launches a program is served by it.
    expect(rel("SPAWNS", "application.applicationcomponent", "technology.systemsoftware")).toBe("technology.systemsoftware.serves.application.applicationcomponent");
    // DEPLOYS from a chart to the image it deploys; never from application code.
    expect(rel("DEPLOYS", "technology.artifact", "technology.artifact")).toBe("technology.artifact.aggregates.technology.artifact");
    expect(rel("DEPLOYS", "application.applicationcomponent", "technology.artifact")).toBeNull();
  });
});
