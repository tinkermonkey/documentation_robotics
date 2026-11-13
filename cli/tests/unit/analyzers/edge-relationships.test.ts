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
    // A workload or compose service referring to its image (#1107 follow-up): a scoped pair outside USAGE's data-object to_types.
    ["USAGE", "technology.node", "technology.artifact", "technology.node.composes.technology.artifact"],
    ["USAGE", "application.applicationfunction", "technology.artifact", null],
    ["USAGE", "technology.node", "technology.node", null],
    ["USAGE", "technology.artifact", "technology.node", null],
    ["WRITES", "application.applicationfunction", "data-model.objectschema", "application.applicationfunction.accesses.data-model.objectschema"],
    ["WRITES", "api.operation", "data-store.collection", null],
    ["IMPLEMENTS", "application.applicationcomponent", "application.applicationinterface", "application.applicationcomponent.provides.application.applicationinterface"],
    ["IMPLEMENTS", "application.dataobject", "application.dataobject", null],
    ["TESTS", "testing.testcasesketch", "api.operation", "testing.testcasesketch.tests.api.operation"],
    ["INFRA_MAPS", "technology.technologyservice", "technology.node", "technology.node.realizes.technology.technologyservice"],
    // DEPLOYS runs from what deploys to what it deploys (CBM 0.12.1: workflow -> manifest, chart -> image).
    ["DEPLOYS", "technology.artifact", "technology.artifact", "technology.artifact.aggregates.technology.artifact"],
    ["DEPLOYS", "technology.systemsoftware", "technology.artifact", "technology.systemsoftware.composes.technology.artifact"],
    // A CI workflow module or deploy-script function sits in the application layer: no relationship.
    ["DEPLOYS", "application.applicationcomponent", "technology.artifact", null],
    ["DEPLOYS", "application.applicationfunction", "technology.artifact", null],
    // DATA_FLOWS: the caller of a route to the route's handler.
    ["DATA_FLOWS", "application.applicationfunction", "application.applicationfunction", "application.applicationfunction.flows-to.application.applicationfunction"],
    ["DATA_FLOWS", "testing.testcasesketch", "application.applicationfunction", null],
    ["DATA_FLOWS", "application.applicationfunction", "api.operation", null],
  ];
  for (const [e, from, to, expected] of table) {
    it(`${e}: ${from} -> ${to}`, () => expect(pick(e, from, to)).toBe(expected));
  }
});

describe("DEPLOYS direction", () => {
  it("keeps CBM's direction: the deployer is the source", () => {
    expect(edgePreferences(edge("DEPLOYS")).every((p) => !p.invert)).toBe(true);
    // A chart (the deployer) and the image it deploys: the chart is the relationship's source.
    const r = relationshipFor(edge("DEPLOYS"), "technology.artifact", "technology.artifact", has)!;
    expect(r.inverted).toBe(false);
    expect(r.predicate).toBe("aggregates");
  });

  it("never runs from an artifact to a node, as the old inverted mapping did", () => {
    // CBM has no cluster node: technology.node is never the deployed end.
    expect(pick("DEPLOYS", "technology.artifact", "technology.node")).toBeNull();
  });
});

describe("inert messaging edges (#1080)", () => {
  it("ASYNC_CALLS and LISTENS_ON create no relationship: no rule makes an async route or channel an element", () => {
    expect(edgePreferences(edge("ASYNC_CALLS"))).toEqual([]);
    expect(edgePreferences(edge("LISTENS_ON"))).toEqual([]);
    expect(pick("ASYNC_CALLS", "application.applicationfunction", "application.applicationevent")).toBeNull();
  });
});

describe("edgeAllowed", () => {
  it("honours layer wildcards", () => {
    expect(edgeAllowed(edge("IMPORTS"), "application.applicationfunction", "application.dataobject")).toBe(true);
    expect(edgeAllowed(edge("IMPORTS"), "api.pathitem", "data-model.objectschema")).toBe(false);
  });

  it("allows a pair a scoped-pair preference names, outside the mapping-level types", () => {
    expect(edgeAllowed(edge("USAGE"), "technology.node", "technology.artifact")).toBe(true);
    expect(edgeAllowed(edge("USAGE"), "application.applicationfunction", "technology.artifact")).toBe(false);
  });
});

describe("scoped-pair preferences", () => {
  const triplesHere = new Set(["a.x.uses.b.data", "a.x.composes.c.img", "a.x.uses.c.img", "a.y.uses.b.data"]);
  const hasHere = (id: string) => triplesHere.has(id);
  const m = {
    cbm_edge: "X",
    dr_relationship: "uses",
    usage: "verification_and_mapping",
    confidence: "low",
    description: "",
    conditions: {
      predicates: [
        { predicate: "uses", invert: false },
        { predicate: "composes", invert: false, from_types: ["a.x"], to_types: ["c.img"] },
        { predicate: "uses", invert: false, from_types: ["a.y"] },
      ],
      to_types: ["b.data"],
    },
  } as unknown as AnalyzerEdgeMapping;

  it("keeps the mapping-level types for unscoped preferences", () => {
    expect(relationshipFor(m, "a.x", "b.data", hasHere)?.id).toBe("a.x.uses.b.data");
    // a.x.uses.c.img is in the catalog, but `uses` is not scoped to c.img: only the scoped pair applies.
    expect(relationshipFor(m, "a.x", "c.img", hasHere)?.id).toBe("a.x.composes.c.img");
  });

  it("treats a preference naming only one end's types as further restricted, not scoped", () => {
    // from_types alone narrows the preference; the mapping-level to_types still applies.
    expect(relationshipFor(m, "a.y", "c.img", hasHere)).toBeNull();
    expect(relationshipFor(m, "a.y", "b.data", hasHere)?.id).toBe("a.y.uses.b.data");
  });

  it("applies the scoped pair only between its own types", () => {
    expect(edgeAllowed(m, "a.x", "c.img")).toBe(true);
    expect(edgeAllowed(m, "a.y", "c.img")).toBe(false);
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
