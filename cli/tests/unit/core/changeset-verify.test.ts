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
