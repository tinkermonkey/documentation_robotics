/**
 * Edge-to-relationship lookup (src/analyzers/edge-relationships.ts), against the live catalog.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { dedupeRelationships, edgeAllowed, edgePreferences, relationshipFor } from "@/analyzers/edge-relationships";
import type { AnalyzerEdgeMapping } from "@/analyzers/types";

const DIST = resolve(import.meta.dir, "../../../../spec/dist");
const cbm = JSON.parse(readFileSync(join(DIST, "analyzers", "cbm.json"), "utf-8"));
const triples = new Set<string>();
for (const f of readdirSync(DIST).filter((f) => f.endsWith(".json"))) {
  for (const id of Object.keys(JSON.parse(readFileSync(join(DIST, f), "utf-8")).relationshipSchemas ?? {})) triples.add(id);
}
const has = (id: string) => triples.has(id);
const edge = (name: string) => cbm.edges_by_type[name] as AnalyzerEdgeMapping;
const pick = (name: string, from: string, to: string) => relationshipFor(edge(name), from, to, has)?.id ?? null;

describe("edgePreferences", () => {
  it("falls back to dr_relationship and its direction", () => {
    const m = { cbm_edge: "X", dr_relationship: "realizes", directionality_transform: "invert", usage: "verification_and_mapping", confidence: "high", description: "" } as AnalyzerEdgeMapping;
    expect(edgePreferences(m)).toEqual([{ predicate: "realizes", invert: true }]);
  });
  it("is empty for traversal-only edges", () => {
    expect(edgePreferences(edge("DECORATES"))).toEqual([]);
  });
});

describe("relationshipFor picks the triple with the right meaning for common pairs", () => {
  // [edge, CBM source type, CBM target type, expected relationship id or null]
  const table: Array<[string, string, string, string | null]> = [
    ["HANDLES", "application.applicationfunction", "api.operation", "api.operation.realizes.application.applicationfunction"],
    ["CALLS", "application.applicationfunction", "application.applicationfunction", "application.applicationfunction.depends-on.application.applicationfunction"],
    ["CALLS", "application.applicationservice", "application.dataobject", "application.applicationservice.accesses.application.dataobject"],
    ["DEFINES_METHOD", "application.applicationcomponent", "application.applicationfunction", "application.applicationcomponent.assigned-to.application.applicationfunction"],
    ["DEFINES_METHOD", "application.applicationinterface", "api.operation", null],
    ["IMPORTS", "application.applicationcomponent", "application.applicationcomponent", "application.applicationcomponent.uses.application.applicationcomponent"],
    ["IMPORTS", "application.applicationcomponent", "application.dataobject", "application.applicationcomponent.accesses.application.dataobject"],
    ["IMPORTS", "ux.view", "application.applicationcomponent", null],
    // A test case calling code tests it; the preference applies only from a test case.
    ["CALLS", "testing.testcasesketch", "application.applicationfunction", "testing.testcasesketch.tests.application.applicationfunction"],
    ["CALLS", "testing.testcasesketch", "api.operation", "testing.testcasesketch.tests.api.operation"],
    ["CALLS", "testing.testcasesketch", "data-model.objectschema", "testing.testcasesketch.tests.data-model.objectschema"],
    ["CALLS", "testing.testcasesketch", "data-model.jsonschema", null],
    ["INHERITS", "data-model.objectschema", "data-model.objectschema", "data-model.objectschema.specializes.data-model.objectschema"],
    ["INHERITS", "application.applicationcomponent", "application.applicationcomponent", "application.applicationcomponent.specializes.application.applicationcomponent"],
    ["INHERITS", "application.applicationcomponent", "data-model.objectschema", null],
    ["USAGE", "application.applicationfunction", "application.dataobject", "application.applicationfunction.accesses.application.dataobject"],
    ["USAGE", "application.applicationfunction", "data-model.objectschema", "application.applicationfunction.accesses.data-model.objectschema"],
    ["USAGE", "application.applicationfunction", "application.applicationfunction", null],
    ["WRITES", "application.applicationfunction", "data-model.objectschema", "application.applicationfunction.accesses.data-model.objectschema"],
    ["WRITES", "api.operation", "data-store.collection", null],
    ["IMPLEMENTS", "application.applicationcomponent", "application.applicationinterface", "application.applicationcomponent.provides.application.applicationinterface"],
    ["IMPLEMENTS", "application.dataobject", "application.dataobject", null],
    ["TESTS", "testing.testcasesketch", "api.operation", "testing.testcasesketch.tests.api.operation"],
    ["INFRA_MAPS", "technology.technologyservice", "technology.node", "technology.node.realizes.technology.technologyservice"],
  ];
  for (const [e, from, to, expected] of table) {
    it(`${e}: ${from} -> ${to}`, () => expect(pick(e, from, to)).toBe(expected));
  }
});

describe("edgeAllowed", () => {
  it("honours layer wildcards", () => {
    expect(edgeAllowed(edge("IMPORTS"), "application.applicationfunction", "application.dataobject")).toBe(true);
    expect(edgeAllowed(edge("IMPORTS"), "api.pathitem", "data-model.objectschema")).toBe(false);
  });
});

describe("dedupeRelationships", () => {
  it("drops self-loops and repeats of the same relationship between the same elements", () => {
    const r = relationshipFor(edge("CALLS"), "application.applicationfunction", "application.applicationfunction", has)!;
    const items = [
      { sourceId: "a", destinationId: "b", relationship: r, via: "CALLS" },
      { sourceId: "a", destinationId: "b", relationship: r, via: "CALL_REFERENCE" },
      { sourceId: "a", destinationId: "a", relationship: r, via: "CALLS" },
      { sourceId: "b", destinationId: "a", relationship: r, via: "CALLS" },
    ];
    expect(dedupeRelationships(items).map((x) => `${x.sourceId}>${x.destinationId}:${x.via}`)).toEqual(["a>b:CALLS", "b>a:CALLS"]);
  });
});
