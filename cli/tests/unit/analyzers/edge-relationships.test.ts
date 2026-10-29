/**
 * Edge-to-relationship lookup (src/analyzers/edge-relationships.ts).
 */
import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { edgePreferences, relationshipFor } from "@/analyzers/edge-relationships";
import type { AnalyzerEdgeMapping } from "@/analyzers/types";

const DIST = resolve(import.meta.dir, "../../../../spec/dist");
const cbm = JSON.parse(readFileSync(join(DIST, "analyzers", "cbm.json"), "utf-8"));
const triples = new Set<string>();
for (const f of readdirSync(DIST).filter((f) => f.endsWith(".json"))) {
  for (const id of Object.keys(JSON.parse(readFileSync(join(DIST, f), "utf-8")).relationshipSchemas ?? {})) triples.add(id);
}
const has = (id: string) => triples.has(id);
const edge = (name: string) => cbm.edges_by_type[name] as AnalyzerEdgeMapping;

describe("edgePreferences", () => {
  it("falls back to dr_relationship and its direction", () => {
    const m = { cbm_edge: "X", dr_relationship: "realizes", directionality_transform: "invert", usage: "verification_and_mapping", confidence: "high", description: "" } as AnalyzerEdgeMapping;
    expect(edgePreferences(m)).toEqual([{ predicate: "realizes", invert: true }]);
  });
  it("is empty for traversal-only edges", () => {
    expect(edgePreferences(edge("DECORATES"))).toEqual([]);
  });
});

describe("relationshipFor (cbm mapping, live catalog)", () => {
  it("takes the first preferred predicate the catalog has for the pair", () => {
    expect(relationshipFor(edge("CALLS"), "application.applicationprocess", "application.applicationfunction", has)?.id).toBe(
      "application.applicationprocess.depends-on.application.applicationfunction"
    );
    expect(relationshipFor(edge("CALLS"), "application.applicationservice", "application.dataobject", has)?.id).toBe(
      "application.applicationservice.accesses.application.dataobject"
    );
  });
  it("inverts where the catalog runs against the CBM edge", () => {
    const r = relationshipFor(edge("HANDLES"), "application.applicationfunction", "api.operation", has);
    expect(r).toMatchObject({ id: "api.operation.realizes.application.applicationfunction", inverted: true });
  });
  it("returns null when no preferred triple exists", () => {
    expect(relationshipFor(edge("IMPORTS"), "ux.view", "ux.librarycomponent", has)).toBeNull();
  });
});
