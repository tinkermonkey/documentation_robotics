/**
 * Unit tests for the compact verify report (`compactVerifyReport`, `verifySections`): what
 * changeset_verify returns by default (#1152).
 */

import { describe, it, expect } from "bun:test";
import {
  compactVerifyReport,
  verifyChangeset,
  VERIFY_LIST_LIMIT,
  type BuiltElement,
  type BuiltRelationship,
  type BuiltSide,
  type CompactVerifyReport,
  type Plan,
  type PlannedElementChange,
  type VerifySectionsReport,
} from "../../../src/core/changeset-verify.js";
import { compactJson } from "../../../src/mcp/tools/shared.js";

const PROSE =
  "Planned behaviour, written before the code existed: what the element does, why it exists, the decisions " +
  "taken while planning it and the constraints it has to respect once it is built.";
const DOCSTRING = "Extracted from the code: the docstring above the symbol, which says something else entirely.";

function element(id: string, description = PROSE, attributes: Record<string, unknown> = {}): PlannedElementChange {
  const [layer, type, ...rest] = id.split(".");
  return { id, layer, type, name: rest.join("."), description, attributes, op: "add" };
}

function built(id: string, extra: Partial<BuiltElement> = {}): BuiltElement {
  const [layer, type, ...rest] = id.split(".");
  return { id, layer, type, name: rest.join("."), description: DOCSTRING, attributes: {}, change: "added", ...extra };
}

/**
 * A modest plan against an as-built changeset dominated by test cases, the shape of #1152: 16
 * planned elements and 38 relationships; the build matches most of them (one by a renamed id, one
 * with a different attribute, one missing) and carries 129 test cases with 127 relationships.
 */
function fixture(): { plan: Plan; builtSide: BuiltSide } {
  const plannedIds = [
    ...Array.from({ length: 8 }, (_, i) => `application.applicationfunction.function-${i}`),
    ...Array.from({ length: 8 }, (_, i) => `api.operation.operation-${i}`),
  ];
  const plan: Plan = {
    label: "plan",
    elements: plannedIds.map((id) => element(id, PROSE, id.startsWith("api.") ? { method: "GET" } : {})),
    relationships: [],
    notes: [],
  };
  for (let i = 0; i < 8; i++) {
    plan.relationships.push({
      source: `api.operation.operation-${i}`,
      predicate: "realizes",
      target: `application.applicationfunction.function-${i}`,
      op: "add",
    });
  }
  for (let i = 0; i < 30; i++) {
    plan.relationships.push({
      source: `application.applicationfunction.function-${i % 8}`,
      predicate: "depends-on",
      target: `application.applicationfunction.function-${(i + 1 + Math.floor(i / 8)) % 8}`,
      op: "add",
    });
  }
  // Dedupe (a few depends-on pairs repeat) and drop self-loops.
  const seen = new Set<string>();
  plan.relationships = plan.relationships.filter((r) => {
    const key = `${r.source}|${r.predicate}|${r.target}`;
    if (seen.has(key) || r.source === r.target) return false;
    seen.add(key);
    return true;
  });

  const elements: BuiltElement[] = plannedIds
    .filter((id) => id !== "api.operation.operation-7") // missing
    .map((id) =>
      id === "application.applicationfunction.function-7"
        ? built("application.applicationfunction.Function7") // renamed: a probable match
        : built(id, id === "api.operation.operation-6" ? { attributes: { method: "POST" } } : id.startsWith("api.") ? { attributes: { method: "GET" } } : {})
    );
  const rename = (id: string) =>
    id === "application.applicationfunction.function-7" ? "application.applicationfunction.Function7" : id;
  const relationships: BuiltRelationship[] = plan.relationships
    .filter((r) => r.source !== "api.operation.operation-7")
    .map((r) => ({ source: rename(r.source), predicate: r.predicate, target: rename(r.target), change: "added" }));
  for (let i = 0; i < 129; i++) {
    elements.push(built(`testing.testcase.case-${i}`, { description: `${DOCSTRING} Test case ${i}.` }));
    if (i < 127) {
      relationships.push({
        source: `testing.testcase.case-${i}`,
        predicate: "tests",
        target: `api.operation.operation-${i % 7}`,
        change: "added",
      });
    }
  }
  const builtSide: BuiltSide = {
    label: "as-built",
    kind: "changeset",
    elements,
    relationships,
    changedElements: elements,
    changedRelationships: relationships,
    notes: [],
  };
  return { plan, builtSide };
}

describe("compactVerifyReport", () => {
  const { plan, builtSide } = fixture();
  const report = verifyChangeset(plan, builtSide);

  it("keeps the verdict and counts, and lists missing, divergent and probable matches one line each", () => {
    const compact = compactVerifyReport(report) as CompactVerifyReport;
    expect(compact.detail).toBe("compact");
    expect(compact.verdict).toBe(report.verdict);
    expect(compact.summary).toEqual(report.summary);
    expect((compact as any).elements).toBeUndefined();
    expect((compact as any).relationships).toBeUndefined();

    expect(compact.missing[0]).toBe("api.operation.operation-7 (add): not found in the build by id, name or source file");
    expect(compact.missing.some((line) => line.startsWith("api.operation.operation-7 --realizes--> "))).toBe(true);
    expect(compact.divergent).toEqual(['api.operation.operation-6: attributes.method planned "GET", built "POST"']);
    expect(compact.probable).toHaveLength(1);
    expect(compact.probable[0]).toMatch(
      /^application\.applicationfunction\.function-7 → application\.applicationfunction\.Function7: /
    );
    expect(compact.more).toContain('detail: "full"');
  });

  it("counts unplanned changes per type instead of listing them", () => {
    const compact = compactVerifyReport(report) as CompactVerifyReport;
    expect(compact.unplanned.elements).toEqual({
      total: 129,
      byChange: { added: 129 },
      byType: { "testing.testcase": 129 },
    });
    expect(compact.unplanned.relationships).toEqual({
      total: 127,
      byChange: { added: 127 },
      byType: { "testing.testcase --tests--> api.operation": 127 },
    });
  });

  it("is a small fraction of the full report", () => {
    const full = JSON.stringify(report, null, 2).length;
    const compact = compactJson(compactVerifyReport(report)).length;
    expect(full).toBeGreaterThan(60_000);
    expect(compact).toBeLessThan(8_000);
  });

  it("cuts a long list at the limit and keeps its length in counts", () => {
    const many: Plan = {
      label: "plan",
      elements: Array.from({ length: VERIFY_LIST_LIMIT + 5 }, (_, i) => element(`application.applicationfunction.f-${i}`)),
      relationships: [],
      notes: [],
    };
    const empty: BuiltSide = { label: "as-built", kind: "changeset", elements: [], relationships: [], changedElements: [], changedRelationships: [], notes: [] };
    const compact = compactVerifyReport(verifyChangeset(many, empty)) as CompactVerifyReport;
    expect(compact.missing).toHaveLength(VERIFY_LIST_LIMIT);
    expect(compact.counts).toEqual({ missing: VERIFY_LIST_LIMIT + 5 });
    expect(compact.more).toContain(`cut at ${VERIFY_LIST_LIMIT}`);
  });

  it("caps sourceReferences.unreferenced with its length in counts", () => {
    const withRefs = {
      ...report,
      sourceReferences: {
        missing: [],
        unreferenced: Array.from({ length: VERIFY_LIST_LIMIT + 3 }, (_, i) => ({
          planned: `product.feature.f-${i}`,
          result: "unverifiable" as const,
        })),
        next: "Set sourceFile and sourceSymbol.",
      },
    };
    const compact = compactVerifyReport(withRefs) as CompactVerifyReport;
    expect(compact.sourceReferences!.unreferenced).toHaveLength(VERIFY_LIST_LIMIT);
    expect(compact.sourceReferences!.unreferenced![0]).toBe("product.feature.f-0 (unverifiable)");
    expect(compact.counts!["sourceReferences.unreferenced"]).toBe(VERIFY_LIST_LIMIT + 3);
    expect(compact.sourceReferences!.next).toBe("Set sourceFile and sourceSymbol.");
  });

  it("returns the report unchanged with detail: full", () => {
    expect(compactVerifyReport(report, { detail: "full" })).toBe(report);
  });

  it("returns only the named sections, narrowed by layers or ids", () => {
    const unplanned = compactVerifyReport(report, { sections: ["unplanned"] }) as VerifySectionsReport;
    expect(unplanned.sections).toEqual(["unplanned"]);
    expect(unplanned.verdict).toBe(report.verdict);
    expect(unplanned.unplanned!.elements).toHaveLength(129);
    expect((unplanned as any).missing).toBeUndefined();

    const api = compactVerifyReport(report, { sections: ["missing", "matched"], layers: ["api"] }) as VerifySectionsReport;
    expect(api.filter).toEqual({ layers: ["api"] });
    expect(api.missing!.elements.map((m) => m.planned)).toEqual(["api.operation.operation-7"]);
    expect(api.matched!.elements.every((m) => m.planned.startsWith("api."))).toBe(true);
    // A relationship is kept when either end is in the layer.
    expect(api.matched!.relationships.length).toBeGreaterThan(0);
    expect(api.matched!.relationships.every((r) => r.planned.source.startsWith("api."))).toBe(true);

    const one = compactVerifyReport(report, {
      sections: ["probable"],
      ids: ["application.applicationfunction.function-7"],
    }) as VerifySectionsReport;
    expect(one.probable!.elements.map((m) => m.built)).toEqual(["application.applicationfunction.Function7"]);
  });

  it("notes that layers and ids narrow sections only", () => {
    const compact = compactVerifyReport(report, { layers: ["api"] }) as CompactVerifyReport;
    expect(compact.detail).toBe("compact");
    expect(compact.note).toContain("sections");
    expect(compact.unplanned.elements.total).toBe(129);
  });
});
