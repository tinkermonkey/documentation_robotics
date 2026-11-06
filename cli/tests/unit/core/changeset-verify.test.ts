/**
 * Unit tests for changeset verify: planned vs as-built changesets, hand-built.
 */

import { describe, it, expect } from "bun:test";
import { Changeset, type Change } from "../../../src/core/changeset.js";
import { ChangesetGraph } from "../../../src/core/changeset-graph.js";
import type { Model } from "../../../src/core/model.js";
import {
  builtFromGraph,
  builtFromSnapshot,
  normalizeName,
  planFromChangeset,
  verifyChangeset,
  type BuiltSide,
  LIFECYCLE_FIELDS,
} from "../../../src/core/changeset-verify.js";

/** An empty base model: enough for ChangesetGraph.build. */
const emptyModel = {
  getLayerNames: () => [],
  getBaseLayer: async () => undefined,
  relationships: { getAll: () => [] },
} as unknown as Model;

function changeset(name: string, changes: Change[]): Changeset {
  return new Changeset({
    id: `${name}-id`,
    name,
    created: "2026-11-01T00:00:00Z",
    modified: "2026-11-01T00:00:00Z",
    status: "staged",
    baseSnapshot: "x",
    changes: changes.map((c, i) => ({ ...c, sequenceNumber: i })),
  });
}

function addEl(
  id: string,
  extra: { name?: string; description?: string; attributes?: Record<string, unknown>; file?: string } = {}
): Change {
  const [layer, type, ...rest] = id.split(".");
  return {
    type: "add",
    elementId: id,
    layerName: layer,
    after: {
      id,
      path: id,
      layer_id: layer,
      type,
      name: extra.name ?? rest.join("."),
      ...(extra.description ? { description: extra.description } : {}),
      attributes: extra.attributes ?? {},
      ...(extra.file
        ? { source_reference: { provenance: "extracted", locations: [{ file: extra.file }] } }
        : {}),
    },
  };
}

function updEl(id: string, before: Record<string, unknown>, after: Record<string, unknown>): Change {
  const [layer, type, ...rest] = id.split(".");
  const base = { id, path: id, layer_id: layer, type, name: rest.join(".") };
  return { type: "update", elementId: id, layerName: layer, before: { ...base, ...before }, after: { ...base, ...after } };
}

function delEl(id: string): Change {
  const [layer, type, ...rest] = id.split(".");
  return {
    type: "delete",
    elementId: id,
    layerName: layer,
    before: { id, path: id, layer_id: layer, type, name: rest.join("."), attributes: {} },
  };
}

function addRel(source: string, predicate: string, target: string): Change {
  return {
    type: "relationship-add",
    elementId: `${source}::${predicate}::${target}`,
    layerName: source.split(".")[0],
    after: { source, predicate, target, layer: source.split(".")[0] },
  };
}

function delRel(source: string, predicate: string, target: string): Change {
  return {
    type: "relationship-delete",
    elementId: `${source}::${predicate}::${target}`,
    layerName: source.split(".")[0],
    before: { source, predicate, target },
  };
}

async function asBuilt(changes: Change[]): Promise<BuiltSide> {
  return builtFromGraph(await ChangesetGraph.build(emptyModel, changeset("as-built", changes)));
}

const FN = "application.applicationfunction.export-orders";
const OP = "api.operation.export-orders";
const SVC = "application.applicationservice.checkout";

describe("normalizeName", () => {
  it("ignores case, kebab, snake, camel and whitespace", () => {
    for (const name of ["Export Orders", "export-orders", "exportOrders", "export_orders", "  EXPORT orders "]) {
      expect(normalizeName(name)).toBe("exportorders");
    }
  });
});

describe("planFromChangeset", () => {
  it("nets out add-then-delete, folds add-then-update into the add, and drops a restored relationship", () => {
    const plan = planFromChangeset(
      changeset("plan", [
        addEl(FN),
        updEl(FN, {}, { description: "Export as CSV", attributes: {} }),
        addEl("application.applicationfunction.scratch"),
        delEl("application.applicationfunction.scratch"),
        addRel(FN, "realizes", SVC),
        delRel(OP, "realizes", FN),
        addRel(OP, "realizes", FN),
      ])
    );
    expect(plan.elements).toHaveLength(1);
    expect(plan.elements[0]).toMatchObject({ id: FN, op: "add", description: "Export as CSV" });
    expect(plan.relationships).toEqual([{ source: FN, predicate: "realizes", target: SVC, op: "add" }]);
    expect(plan.notes).toEqual([]);
  });

  it("records the fields an update changes", () => {
    const plan = planFromChangeset(
      changeset("plan", [updEl(SVC, { attributes: { serviceType: "synchronous" } }, { attributes: { serviceType: "asynchronous" } })])
    );
    expect(plan.elements[0]).toMatchObject({ op: "update", changedFields: ["attributes.serviceType"] });
  });

  it("reports unreadable changes instead of dropping them silently", () => {
    const plan = planFromChangeset(
      changeset("plan", [
        { type: "add", elementId: FN, layerName: "application" },
        { type: "relationship-add", elementId: "garbage", layerName: "application" },
      ])
    );
    expect(plan.elements).toHaveLength(0);
    expect(plan.notes).toHaveLength(2);
    expect(plan.notes[0]).toContain("no element data");
    expect(plan.notes[1]).toContain("source, predicate and target");
  });
});

describe("verifyChangeset against an as-built changeset", () => {
  it("matches an identical build exactly", async () => {
    const changes = [addEl(FN), addEl(OP), addRel(OP, "realizes", FN)];
    const report = verifyChangeset(planFromChangeset(changeset("plan", changes)), await asBuilt(changes));
    expect(report.verdict).toBe("match");
    expect(report.elements.matched.map((m) => m.match)).toEqual(["exact", "exact"]);
    expect(report.relationships.matched).toHaveLength(1);
    expect(report.summary.elements).toMatchObject({ planned: 2, matched: 2, missing: 0, unplanned: 0, probable: 0 });
  });

  it("reports missing, unplanned and divergent elements", async () => {
    const plan = planFromChangeset(
      changeset("plan", [
        addEl(FN, { description: "Export orders as CSV", attributes: { kind: "batch" } }),
        addEl(OP),
      ])
    );
    const built = await asBuilt([
      addEl(FN, { description: "Export orders as JSON", attributes: { kind: "batch", extra: 1 } }),
      addEl("data-model.objectschema.order-export"),
    ]);
    const report = verifyChangeset(plan, built);

    expect(report.verdict).toBe("incomplete");
    expect(report.elements.missing.map((m) => m.planned)).toEqual([OP]);
    expect(report.elements.unplanned.map((u) => u.id)).toEqual(["data-model.objectschema.order-export"]);
    expect(report.elements.divergent).toHaveLength(1);
    // Only what the plan states is compared: the build's extra attribute is not a divergence.
    expect(report.elements.divergent[0].fields).toEqual([
      { field: "description", planned: "Export orders as CSV", built: "Export orders as JSON" },
    ]);
    expect(report.verdictText).toContain("1 planned element missing");
  });

  it("reports a planned deletion the build did not do, and accepts one it did", async () => {
    const base = [addEl(SVC), addEl(FN)];
    const plan = planFromChangeset(changeset("plan", [delEl(SVC), delEl(FN)]));
    const built = await asBuilt([...base, delEl(FN)]);
    // The as-built changeset adds and deletes FN here, which nets to nothing: FN is absent.
    const report = verifyChangeset(plan, built);
    expect(report.elements.deletionsNotDone).toEqual([{ planned: SVC, built: SVC }]);
    expect(report.elements.matched).toEqual([{ planned: FN, built: FN, op: "delete", match: "exact" }]);
  });

  it("reports a planned update the build does not carry as missing, with the fields", async () => {
    const plan = planFromChangeset(
      changeset("plan", [updEl(SVC, { attributes: { serviceType: "synchronous" } }, { attributes: { serviceType: "asynchronous" } })])
    );
    const built = await asBuilt([addEl(SVC, { attributes: { serviceType: "synchronous" } })]);
    const report = verifyChangeset(plan, built);
    expect(report.elements.missing).toHaveLength(1);
    expect(report.elements.missing[0].reason).toContain("does not carry the planned update");
    expect(report.elements.missing[0].fields).toEqual([
      { field: "attributes.serviceType", planned: "asynchronous", built: "synchronous" },
    ]);
  });

  it("checks a planned update that removes an attribute or clears a description", async () => {
    const plan = planFromChangeset(
      changeset("plan", [
        updEl(SVC, { description: "Old text", attributes: { deprecated: true, kind: "x" } }, { attributes: { kind: "x" } }),
      ])
    );
    expect(plan.elements[0].changedFields?.sort()).toEqual(["attributes.deprecated", "description"]);

    const stale = await asBuilt([addEl(SVC, { description: "Old text", attributes: { deprecated: true, kind: "x" } })]);
    const report = verifyChangeset(plan, stale);
    expect(report.verdict).toBe("incomplete");
    expect(report.elements.missing).toHaveLength(1);
    expect(report.elements.missing[0].fields?.map((f) => f.field).sort()).toEqual(["attributes.deprecated", "description"]);
    expect(report.elements.missing[0].fields?.every((f) => f.planned === undefined)).toBe(true);

    const half = await asBuilt([addEl(SVC, { description: "Old text", attributes: { kind: "x" } })]);
    const partial = verifyChangeset(plan, half);
    expect(partial.elements.divergent).toHaveLength(1);
    expect(partial.elements.divergent[0].fields).toEqual([{ field: "description", planned: undefined, built: "Old text" }]);

    const done = await asBuilt([addEl(SVC, { attributes: { kind: "x" } })]);
    expect(verifyChangeset(plan, done).verdict).toBe("match");
  });

  it("matches a renamed element as probable, never exact, and says why", async () => {
    const plan = planFromChangeset(changeset("plan", [addEl(FN, { name: "Export Orders" })]));
    const built = await asBuilt([addEl("application.applicationfunction.exportorders", { name: "exportOrders" })]);
    const report = verifyChangeset(plan, built);
    expect(report.verdict).toBe("probable-match");
    expect(report.elements.matched).toHaveLength(1);
    expect(report.elements.matched[0]).toMatchObject({
      planned: FN,
      built: "application.applicationfunction.exportorders",
      match: "probable",
    });
    expect(report.elements.matched[0].reason).toContain("ignoring case and separators");
    expect(report.elements.unplanned).toHaveLength(0);
    expect(report.verdictText).toContain("probable");
  });

  it("matches the same name built as another type as probable, with the type as a divergence", async () => {
    const plan = planFromChangeset(changeset("plan", [addEl(FN)]));
    const built = await asBuilt([addEl("application.applicationprocess.export-orders")]);
    const report = verifyChangeset(plan, built);
    expect(report.elements.divergent).toHaveLength(1);
    expect(report.elements.divergent[0].match).toBe("probable");
    expect(report.elements.divergent[0].fields[0]).toEqual({
      field: "type",
      planned: "applicationfunction",
      built: "applicationprocess",
    });
  });

  it("matches by shared source file when names differ, and can be turned off", async () => {
    const plan = planFromChangeset(changeset("plan", [addEl(FN, { file: "src/orders/export.ts" })]));
    const built = await asBuilt([
      addEl("application.applicationfunction.csv-download", { file: "./src/orders/export.ts" }),
    ]);
    const report = verifyChangeset(plan, built);
    expect(report.elements.divergent).toHaveLength(1);
    expect(report.elements.divergent[0].reason).toContain("src/orders/export.ts");
    expect(report.elements.divergent[0].fields.map((f) => f.field)).toEqual(["name"]);

    const off = verifyChangeset(plan, built, { matchBySource: false });
    expect(off.elements.missing.map((m) => m.planned)).toEqual([FN]);
    expect(off.elements.unplanned.map((u) => u.id)).toEqual(["application.applicationfunction.csv-download"]);
  });

  it("does not guess between several fuzzy candidates; lists them instead", async () => {
    const plan = planFromChangeset(changeset("plan", [addEl(FN, { file: "src/orders/export.ts" })]));
    const built = await asBuilt([
      addEl("application.applicationfunction.csv-download", { file: "src/orders/export.ts" }),
      addEl("application.applicationfunction.json-download", { file: "src/orders/export.ts" }),
    ]);
    const report = verifyChangeset(plan, built);
    expect(report.elements.missing).toHaveLength(1);
    expect(report.elements.missing[0].candidates?.sort()).toEqual([
      "application.applicationfunction.csv-download",
      "application.applicationfunction.json-download",
    ]);
  });

  it("an exact id match is never taken by another planned element's fuzzy match", async () => {
    const plan = planFromChangeset(
      changeset("plan", [addEl("application.applicationfunction.exportorders"), addEl(FN)])
    );
    const built = await asBuilt([addEl(FN)]);
    const report = verifyChangeset(plan, built);
    expect(report.elements.matched).toEqual([{ planned: FN, built: FN, op: "add", match: "exact" }]);
    expect(report.elements.missing.map((m) => m.planned)).toEqual(["application.applicationfunction.exportorders"]);
  });
});

describe("relationship matching", () => {
  it("matches relationships through renamed elements, as probable", async () => {
    const plan = planFromChangeset(
      changeset("plan", [addEl(FN), addEl(OP), addRel(OP, "realizes", FN), addRel(FN, "realizes", SVC)])
    );
    const RENAMED_FN = "application.applicationfunction.order-export-fn";
    const built = await asBuilt([
      addEl(SVC),
      addEl(RENAMED_FN, { name: "export orders" }),
      addEl(OP),
      addRel(OP, "realizes", RENAMED_FN),
      addRel(RENAMED_FN, "realizes", SVC),
    ]);
    const report = verifyChangeset(plan, built);
    expect(report.relationships.missing).toHaveLength(0);
    expect(report.relationships.unplanned).toHaveLength(0);
    expect(report.relationships.matched).toHaveLength(2);
    for (const m of report.relationships.matched) {
      expect(m.match).toBe("probable");
      expect(m.reason).toContain(`${FN} → ${RENAMED_FN}`);
    }
    // The service existed already from the build's point of view only; it is unplanned.
    expect(report.elements.unplanned.map((u) => u.id)).toEqual([SVC]);
  });

  it("reports a different predicate or a reversed direction as divergent", async () => {
    const plan = planFromChangeset(
      changeset("plan", [addEl(FN), addEl(OP), addRel(OP, "realizes", FN), addRel(FN, "serves", SVC)])
    );
    const built = await asBuilt([
      addEl(FN),
      addEl(OP),
      addRel(OP, "serves", FN),
      addRel(SVC, "serves", FN),
    ]);
    const report = verifyChangeset(plan, built);
    expect(report.relationships.divergent.map((d) => d.fields[0].field).sort()).toEqual(["direction", "predicate"]);
    expect(report.relationships.unplanned).toHaveLength(0);
    expect(report.verdict).toBe("diverges");
  });

  it("never lets the fallback take a built relationship another planned one matches exactly", async () => {
    const plan = planFromChangeset(
      changeset("plan", [addEl(FN), addEl(SVC), addRel(FN, "serves", SVC), addRel(FN, "uses", SVC)])
    );
    const built = await asBuilt([addEl(FN), addEl(SVC), addRel(FN, "uses", SVC)]);
    const report = verifyChangeset(plan, built);
    expect(report.relationships.matched.map((m) => m.planned.predicate)).toEqual(["uses"]);
    expect(report.relationships.divergent).toHaveLength(0);
    expect(report.relationships.missing.map((m) => m.planned.predicate)).toEqual(["serves"]);
    expect(report.verdict).toBe("incomplete");
  });

  it("without the build's changes, a pre-existing relationship is a candidate, not the build's version", () => {
    const plan = planFromChangeset(changeset("plan", [addRel(FN, "serves", SVC)]));
    const elements = [
      { id: FN, layer: "application", type: "applicationfunction", name: "export-orders", attributes: {} },
      { id: SVC, layer: "application", type: "applicationservice", name: "checkout", attributes: {} },
    ];
    const report = verifyChangeset(
      plan,
      builtFromSnapshot({ label: "base-like", elements, relationships: [{ source: FN, predicate: "uses", target: SVC }] })
    );
    expect(report.verdict).toBe("incomplete");
    expect(report.relationships.divergent).toHaveLength(0);
    expect(report.relationships.missing).toHaveLength(1);
    expect(report.relationships.missing[0].candidates).toEqual([{ source: FN, predicate: "uses", target: SVC }]);
    expect(report.relationships.missing[0].reason).toContain("may predate");

    // When the plan adds an endpoint, a relationship on it can only come from the build: divergent.
    const planAdding = planFromChangeset(changeset("plan", [addEl(FN), addRel(FN, "serves", SVC)]));
    const withAdd = verifyChangeset(
      planAdding,
      builtFromSnapshot({ label: "base-like", elements, relationships: [{ source: FN, predicate: "uses", target: SVC }] })
    );
    expect(withAdd.relationships.divergent.map((d) => d.fields[0])).toEqual([
      { field: "predicate", planned: "serves", built: "uses" },
    ]);
  });

  it("reports missing and unplanned relationships, with absent endpoints named", async () => {
    const plan = planFromChangeset(changeset("plan", [addEl(FN), addEl(OP), addRel(OP, "realizes", FN)]));
    const built = await asBuilt([addEl(FN), addRel(FN, "realizes", SVC)]);
    const report = verifyChangeset(plan, built);
    expect(report.relationships.missing).toHaveLength(1);
    expect(report.relationships.missing[0].reason).toContain(OP);
    expect(report.relationships.unplanned).toEqual([{ source: FN, predicate: "realizes", target: SVC, change: "added" }]);
  });

  it("reports a planned relationship deletion that still exists", async () => {
    const plan = planFromChangeset(changeset("plan", [delRel(FN, "realizes", SVC), delRel(OP, "realizes", FN)]));
    const built = await asBuilt([addEl(FN), addEl(SVC), addRel(FN, "realizes", SVC)]);
    const report = verifyChangeset(plan, built);
    expect(report.relationships.deletionsNotDone).toEqual([
      {
        planned: { source: FN, predicate: "realizes", target: SVC },
        built: { source: FN, predicate: "realizes", target: SVC },
      },
    ]);
    expect(report.relationships.matched.map((m) => m.op)).toEqual(["delete"]);
  });
});

describe("snapshot built side (extraction-shaped input)", () => {
  it("treats a snapshot as the built world, optionally as the build's changes", () => {
    const plan = planFromChangeset(changeset("plan", [addEl(FN), addRel(FN, "realizes", SVC)]));
    const elements = [
      { id: FN, layer: "application", type: "applicationfunction", name: "export-orders", attributes: {} },
      { id: OP, layer: "api", type: "operation", name: "export-orders", attributes: {} },
    ];
    const relationships = [{ source: FN, predicate: "realizes", target: SVC }];

    const world = verifyChangeset(plan, builtFromSnapshot({ label: "extraction", elements, relationships }));
    expect(world.verdict).toBe("match");
    expect(world.elements.unplanned).toHaveLength(0);

    const diff = verifyChangeset(
      plan,
      builtFromSnapshot({ label: "extraction", elements, relationships, allChanged: true })
    );
    expect(diff.elements.unplanned.map((u) => u.id)).toEqual([OP]);
    expect(diff.against.kind).toBe("snapshot");
  });

  it("returns an empty-plan verdict for a plan with no changes", () => {
    const report = verifyChangeset(
      planFromChangeset(changeset("plan", [])),
      builtFromSnapshot({ label: "x", elements: [], relationships: [] })
    );
    expect(report.verdict).toBe("empty-plan");
  });
});

// Regressions from the heimdall dogfood run (planning a layered DAG layout over `dr mcp`).
describe("dogfood regressions", () => {
  it("bug 4: a planned update whose field the build changed to other text is divergent, not missing", async () => {
    const plan = planFromChangeset(
      changeset("plan", [updEl(OP, { description: "Renders the graph" }, { description: "Renders the graph, with a layered layout" })])
    );
    const built = await asBuilt([updEl(OP, { description: "Renders the graph" }, { description: "Renders the graph in layers" })]);
    const report = verifyChangeset(plan, built);
    expect(report.elements.missing).toEqual([]);
    expect(report.elements.divergent).toHaveLength(1);
    expect(report.elements.divergent[0]).toMatchObject({ planned: OP, built: OP, op: "update", match: "exact" });
    expect(report.elements.divergent[0].fields).toEqual([
      { field: "description", planned: "Renders the graph, with a layered layout", built: "Renders the graph in layers" },
    ]);
    expect(report.verdict).toBe("diverges");

    // The build did not touch the field at all: that is still missing.
    const untouched = await asBuilt([updEl(OP, {}, { description: "Renders the graph" })]);
    const missing = verifyChangeset(plan, untouched);
    expect(missing.elements.missing.map((m) => m.planned)).toEqual([OP]);
  });

  it("counts an exact id match with field differences as matched (with divergence)", async () => {
    const plan = planFromChangeset(changeset("plan", [addEl(FN, { description: "Export as CSV" }), addEl(OP)]));
    const built = await asBuilt([addEl(FN, { description: "Export as JSON" }), addEl(OP)]);
    const report = verifyChangeset(plan, built);
    expect(report.summary.elements).toMatchObject({ planned: 2, matched: 2, divergent: 1, missing: 0 });
  });

  it("treats lifecycle progress as a note, not a divergence; a move off the lifecycle still diverges", async () => {
    const TC = "testing.testcasesketch.layout";
    const plan = planFromChangeset(
      changeset("plan", [
        addEl(FN, { attributes: { status: "planned" } }),
        addEl(TC, { attributes: { status: "draft" } }),
        addEl(OP, { attributes: { status: "planned" } }),
      ])
    );
    const built = await asBuilt([
      addEl(FN, { attributes: { status: "delivered" } }),
      addEl(TC, { attributes: { status: "automated" } }),
      addEl(OP, { attributes: { status: "deprecated" } }),
    ]);
    const report = verifyChangeset(plan, built);
    expect(LIFECYCLE_FIELDS).toContain("attributes.status");
    expect(report.elements.matched.map((m) => m.planned).sort()).toEqual([FN, TC].sort());
    expect(report.elements.matched.find((m) => m.planned === FN)?.lifecycle).toEqual([
      { field: "attributes.status", planned: "planned", built: "delivered" },
    ]);
    expect(report.elements.divergent.map((d) => d.planned)).toEqual([OP]);
    expect(report.notes.join(" ")).toContain("Lifecycle progress");
    expect(report.notes.join(" ")).toContain(`${TC} attributes.status draft → automated`);
    // Going back a stage is a divergence too.
    const back = verifyChangeset(
      planFromChangeset(changeset("plan", [addEl(FN, { attributes: { status: "delivered" } })])),
      await asBuilt([addEl(FN, { attributes: { status: "planned" } })])
    );
    expect(back.elements.divergent).toHaveLength(1);
  });

  describe("bug 5: elements that existed before the plan are not candidates for a planned add", () => {
    const NEW_OP = "api.operation.layered-dag-layout";
    const existing = ["radial-tree-layout", "force-layout", "grid-layout"].map((name) => ({
      id: `api.operation.${name}`,
      layer: "api",
      type: "operation",
      name,
      attributes: {},
      sourceReference: { provenance: "extracted" as const, locations: [{ file: "src/index.ts" }] },
    }));
    const plan = () =>
      planFromChangeset(changeset("plan", [addEl(NEW_OP, { file: "src/index.ts" }), addEl(FN), addRel(NEW_OP, "realizes", FN)]));
    const base = (extra: typeof existing = [], rels: Array<{ source: string; predicate: string; target: string }> = []) =>
      builtFromSnapshot({
        label: "base model",
        elements: [
          ...existing,
          ...extra,
          { id: FN, layer: "application", type: "applicationfunction", name: "export-orders", attributes: {} },
        ],
        relationships: [{ source: "api.operation.radial-tree-layout", predicate: "realizes", target: SVC }, ...rels],
      });

    it("excludes elements in the plan's base index", () => {
      const p = plan();
      p.baseElementIds = [...existing.map((e) => e.id), SVC];
      const report = verifyChangeset(p, base());
      const missing = report.elements.missing.find((m) => m.planned === NEW_OP);
      expect(missing?.candidates).toBeUndefined();
      expect(missing?.reason).toBe("not found in the build by id, name or source file");
    });

    it("still finds the renamed build of the add, which the base index does not have", () => {
      const p = plan();
      p.baseElementIds = [...existing.map((e) => e.id), SVC];
      const renamed = { ...existing[0], id: "api.operation.sugiyama-layout", name: "sugiyama-layout" };
      const report = verifyChangeset(p, base([renamed]));
      expect(report.elements.divergent.find((d) => d.planned === NEW_OP)).toMatchObject({
        built: "api.operation.sugiyama-layout",
        match: "probable",
      });
    });

    it("without a base index, leaves out unchanged elements unrelated to the plan and says so", () => {
      const renamed = { ...existing[0], id: "api.operation.sugiyama-layout", name: "sugiyama-layout" };
      const report = verifyChangeset(
        plan(),
        base([renamed], [{ source: "api.operation.sugiyama-layout", predicate: "realizes", target: FN }])
      );
      expect(report.elements.divergent.find((d) => d.planned === NEW_OP)?.built).toBe("api.operation.sugiyama-layout");
      expect(report.notes.join(" ")).toContain("No base index was recorded");

      const none = verifyChangeset(plan(), base());
      const missing = none.elements.missing.find((m) => m.planned === NEW_OP);
      expect(missing?.candidates).toBeUndefined();
    });
  });
});
