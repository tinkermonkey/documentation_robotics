/**
 * Unit tests for what changeset_verify says it did not check: a subset's own verdict (#1346), a plan
 * applied before its build (#1307) and a plan that changes only descriptions (#1383).
 */

import { describe, it, expect } from "bun:test";
import { adoptVerifiedSourceReferences } from "../../../src/core/source-reference-adoption.js";
import { Changeset } from "../../../src/core/changeset.js";
import {
  checkDescriptionOnlyPlan,
  compactVerifyReport,
  isDescriptionOnlyPlan,
  narrowVerifyReport,
  verifyChangeset,
  type BuiltElement,
  type BuiltSide,
  type CompactVerifyReport,
  type Plan,
  type PlannedElementChange,
  unreferencedPlannedAdds,
  type VerifySectionsReport,
} from "../../../src/core/changeset-verify.js";

function planned(id: string, extra: Partial<PlannedElementChange> = {}): PlannedElementChange {
  const [layer, type, ...rest] = id.split(".");
  return { id, layer, type, name: rest.join("."), attributes: {}, op: "add", ...extra };
}

function built(id: string, extra: Partial<BuiltElement> = {}): BuiltElement {
  const [layer, type, ...rest] = id.split(".");
  return { id, layer, type, name: rest.join("."), attributes: {}, ...extra };
}

function changesetSide(elements: BuiltElement[], rels: BuiltSide["relationships"] = []): BuiltSide {
  return {
    label: "as-built",
    kind: "changeset",
    elements,
    relationships: rels,
    changedElements: elements.filter((e) => e.change),
    changedRelationships: rels.filter((r) => r.change),
    notes: [],
  };
}

describe("a subset's verdict (#1346)", () => {
  // Three slices: the api slice is built, the data-model slice is not.
  const plan: Plan = {
    label: "plan",
    elements: [planned("api.operation.a"), planned("api.operation.b"), planned("data-model.objectschema.c"), planned("data-model.objectschema.d")],
    relationships: [],
    notes: [],
  };
  const side = changesetSide([built("api.operation.a", { change: "added" }), built("api.operation.b", { change: "added" })]);
  const report = verifyChangeset(plan, side);

  it("the whole plan is incomplete", () => {
    expect(report.verdict).toBe("incomplete");
    expect(report.summary.elements.missing).toBe(2);
  });

  it("with ids, the verdict and counts cover the subset and the whole plan's sit beside them", () => {
    const narrowed = narrowVerifyReport(report, { ids: ["api.operation.a", "api.operation.b"] });
    expect(narrowed.verdict).toBe("match");
    expect(narrowed.summary.elements).toMatchObject({ planned: 2, matched: 2, missing: 0 });
    expect(narrowed.verdictText).toContain("For the 2 ids given");
    expect(narrowed.subset?.planned.elements).toBe(2);
    expect(narrowed.wholePlan?.verdict).toBe("incomplete");
    expect(narrowed.wholePlan?.summary.elements.missing).toBe(2);
  });

  it("with layers, a slice that is not built reads as incomplete", () => {
    const narrowed = narrowVerifyReport(report, { layers: ["data-model"] });
    expect(narrowed.verdict).toBe("incomplete");
    expect(narrowed.summary.elements).toMatchObject({ planned: 2, missing: 2 });
  });

  it("every planned element is in one list, so the subset counts add up to the whole", () => {
    const parts = ["api", "data-model"].map((layer) => narrowVerifyReport(report, { layers: [layer] }).summary.elements.planned);
    expect(parts[0] + parts[1]).toBe(report.summary.elements.planned);
  });

  it("ids that name nothing planned say so, not that the plan is empty", () => {
    const narrowed = narrowVerifyReport(report, { ids: ["api.operation.nope"] });
    expect(narrowed.verdict).toBe("empty-plan");
    expect(narrowed.verdictText).toContain("No planned change touches");
    expect(narrowed.verdictText).toContain("wholePlan");
  });

  it("both entry points narrow: the compact report and sections", () => {
    const compact = compactVerifyReport(report, { ids: ["api.operation.a"] }) as CompactVerifyReport;
    expect(compact.verdict).toBe("match");
    expect(compact.wholePlan?.verdict).toBe("incomplete");
    const sections = compactVerifyReport(report, { sections: ["missing"], layers: ["api"] }) as VerifySectionsReport;
    expect(sections.verdict).toBe("match");
    expect(sections.wholePlan?.summary.elements.planned).toBe(4);
    const whole = compactVerifyReport(report, {}) as CompactVerifyReport;
    expect(whole.subset).toBeUndefined();
    expect(whole.verdict).toBe("incomplete");
  });
});

describe("a plan applied before its build (#1307)", () => {
  const plan: Plan = {
    label: "plan",
    elements: [planned("application.applicationservice.exporter", { description: "Exports." })],
    relationships: [{ source: "application.applicationservice.exporter", predicate: "serves", target: "product.feature.export", op: "add" }],
    notes: [],
  };
  const base = [built("application.applicationservice.exporter"), built("product.feature.export")];

  it("does not match a planned add with itself in the base: it is unverifiable, and the verdict says why", () => {
    const side = changesetSide(base, [{ source: "application.applicationservice.exporter", predicate: "serves", target: "product.feature.export" }]);
    const report = verifyChangeset(plan, side);
    expect(report.elements.matched).toHaveLength(0);
    expect(report.elements.missing).toHaveLength(0);
    expect(report.elements.unverifiable[0].reason).toContain("already in the base model");
    expect(report.relationships.matched).toHaveLength(0);
    expect(report.relationships.unverifiable[0].reason).toContain("already in the base model");
    expect(report.verdict).toBe("unverifiable");
    expect(report.alreadyInBase).toEqual({ elements: 1, relationships: 1, planCommitted: false });
  });

  it("matches it against the as-built changeset's new element by its source symbol", () => {
    const withReference = planned("application.applicationservice.exporter", {
      sourceReference: { provenance: "manual", locations: [{ file: "src/export.ts", symbol: "runExport" }] },
    });
    const side = changesetSide([
      ...base,
      built("application.applicationservice.run-export", {
        change: "added",
        sourceReference: { provenance: "extracted", locations: [{ file: "src/export.ts", symbol: "runExport" }] },
      }),
    ]);
    const report = verifyChangeset({ ...plan, elements: [withReference], relationships: [] }, side);
    expect(report.elements.matched).toHaveLength(1);
    expect(report.elements.matched[0].built).toBe("application.applicationservice.run-export");
    expect(report.alreadyInBase).toBeUndefined();
  });

  it("still matches by id when the as-built changeset itself adds the element", () => {
    const side = changesetSide([built("application.applicationservice.exporter", { change: "added" })]);
    const report = verifyChangeset({ ...plan, relationships: [] }, side);
    expect(report.elements.matched).toHaveLength(1);
    expect(report.alreadyInBase).toBeUndefined();
  });

  it("lists a planned add with no source reference anywhere as unreferenced, and adopt counts it apart from 'nothing to copy'", async () => {
    const only = { ...plan, relationships: [] };
    const side = changesetSide(base);
    const report = verifyChangeset(only, side);
    const unreferenced = unreferencedPlannedAdds(only, report, side);
    expect(unreferenced).toEqual([{ planned: "application.applicationservice.exporter", result: "unverifiable" }]);
    // A match with no reference on either side is unreferenced too.
    const matched = changesetSide([built("application.applicationservice.exporter", { change: "added" })]);
    expect(unreferencedPlannedAdds(only, verifyChangeset(only, matched), matched)).toEqual([
      { planned: "application.applicationservice.exporter", result: "matched" },
    ]);

    const result = await adoptVerifiedSourceReferences({} as any, {} as any, {
      planned: new Changeset({ id: "p", name: "plan", created: "", modified: "", status: "staged", baseSnapshot: "x", changes: [] }),
      report: { sourceReferences: { missing: [], unreferenced, next: "" } },
      sameChangesetHint: "",
    });
    expect(result.adopted).toHaveLength(0);
    expect(result.unreferenced).toEqual({ count: 1, ids: ["application.applicationservice.exporter"] });
    expect(result.next).toContain("nothing to copy");
    expect(result.next).toContain("1 planned element(s) have no source reference anywhere");
  });
});

describe("a plan that changes only descriptions (#1383)", () => {
  const update = (id: string, ref?: { file: string; symbol?: string }): PlannedElementChange =>
    planned(id, {
      op: "update",
      description: "new text",
      changedFields: ["description"],
      ...(ref ? { sourceReference: { provenance: "extracted" as const, locations: [ref] } } : {}),
    });

  it("is recognised only when every change is a description update", () => {
    expect(isDescriptionOnlyPlan({ label: "p", elements: [update("a.b.c")], relationships: [], notes: [] })).toBe(true);
    expect(isDescriptionOnlyPlan({ label: "p", elements: [planned("a.b.c")], relationships: [], notes: [] })).toBe(false);
    expect(isDescriptionOnlyPlan({ label: "p", elements: [{ ...update("a.b.c"), changedFields: ["description", "name"] }], relationships: [], notes: [] })).toBe(false);
    expect(isDescriptionOnlyPlan({ label: "p", elements: [], relationships: [], notes: [] })).toBe(false);
  });

  it("checks that source files changed and symbols are still declared, and lists what is off", () => {
    const plan: Plan = {
      label: "p",
      elements: [
        update("application.applicationservice.ok", { file: "src/a.ts", symbol: "doIt" }),
        update("application.applicationservice.stale", { file: "src/b.ts", symbol: "gone" }),
        update("application.applicationservice.bare"),
      ],
      relationships: [],
      notes: [],
    };
    const check = checkDescriptionOnlyPlan(plan, {
      buildFiles: [
        { file: "src/a.ts", text: "export function doIt() {\n  return 1;\n}\n" },
        { file: "src/b.ts", text: "export const other = 1;\n" },
      ],
      changedFiles: new Set(["src/a.ts"]),
      rangeKnown: true,
    });
    expect(check.counts).toMatchObject({ filesChanged: 1, filesUnchanged: 1, symbolsFound: 1, symbolsNotFound: 1 });
    expect(check.withoutSourceReference).toEqual(["application.applicationservice.bare"]);
    expect(check.attention).toHaveLength(1);
    expect(check.attention[0]).toContain("application.applicationservice.stale");
  });
});
