/**
 * changeset_adopt_source_references' result: counts over everything, each list in full up to
 * `limit`, and past it every item still accounted for (a copied reference by its element id, a
 * skipped one under its reason). No limit drops an item or shrinks a count.
 */
import { describe, expect, it } from "bun:test";
import { ADOPT_LIST_LIMIT, adoptionResult } from "../../../src/mcp/tools/changeset-adopt-source-references.js";
import type { VerifiedAdoptionReport } from "../../../src/core/source-reference-adoption.js";
import type { SourceReferenceGap } from "../../../src/core/changeset-verify.js";

const gap = (i: number): SourceReferenceGap => ({
  planned: `application.applicationfunction.f-${i}`,
  built: `application.applicationfunction.f-${i}`,
  op: "add",
  match: "exact",
  plannedReference: null,
  missing: [{ file: `src/f${i}.ts`, symbol: `f${i}` }],
  adopt: { provenance: "extracted", locations: [{ file: `src/f${i}.ts`, symbol: `f${i}` }] },
});

function report(adopted: number, skippedProbable: number, skippedAgent: number): VerifiedAdoptionReport {
  const skipped = [
    ...Array.from({ length: skippedProbable }, (_, i) => ({
      planned: `application.applicationcomponent.p-${i}`,
      reason: `its match to application.applicationcomponent.P${i} is probable, not exact (same layer and type, name matches ignoring case and separators ("p-${i}" ~ "P${i}")): confirm in the code that it is the same element, then pass its planned id in ids`,
    })),
    ...Array.from({ length: skippedAgent }, (_, i) => ({
      planned: `application.applicationservice.a-${i}`,
      reason: `its as-built match application.applicationservice.a-${i} was not staged by extraction, so its source reference is no evidence: confirm it in the code`,
    })),
  ];
  return {
    plannedChangeset: { id: "cs-1", name: "plan" },
    adopted: Array.from({ length: adopted }, (_, i) => gap(i)),
    written: { copied: adopted, fromReferences: 0, elementsFromReferences: 0 },
    ...(skipped.length ? { skipped, missing: skipped.map((_, i) => gap(1000 + i)) } : {}),
    next: "Copied.",
  };
}

describe("adoptionResult", () => {
  it("gives one compact line of data per copied reference, with counts over everything", () => {
    const result = adoptionResult(report(3, 0, 0)) as any;
    expect(result.total).toBe(3);
    expect(result.counts).toEqual({ adopted: 3, confirmed: 0, written: 3, alreadyPresent: 0, skipped: 0, unknownIds: 0 });
    expect(result.adopted[0]).toEqual({ planned: "application.applicationfunction.f-0", op: "add", match: "exact", locations: ["src/f0.ts#f0"] });
    expect(result.adoptedNotListed).toBeUndefined();
    expect(result.skippedNotListed).toBeUndefined();
    expect(result.missing).toBeUndefined();
  });

  it("accounts for every item past the limit: copied ones by id, skipped ones under their reason", () => {
    const adopted = ADOPT_LIST_LIMIT + 20;
    const full = report(adopted, ADOPT_LIST_LIMIT + 5, 7);
    const result = adoptionResult(full) as any;
    const skippedTotal = ADOPT_LIST_LIMIT + 5 + 7;
    // Counts are the whole set's, not the listed part's.
    expect(result.total).toBe(adopted + skippedTotal);
    expect(result.counts).toMatchObject({ adopted, skipped: skippedTotal });
    expect(result.adopted).toHaveLength(ADOPT_LIST_LIMIT);
    expect(result.adoptedNotListed.count).toBe(20);
    // Listed and not listed together are every copied reference, once each.
    expect([...result.adopted.map((a: any) => a.planned), ...result.adoptedNotListed.ids]).toEqual(full.adopted.map((g) => g.planned));
    expect(result.adoptedNotListed.more).toContain("verbose: true");

    expect(result.skipped).toHaveLength(ADOPT_LIST_LIMIT);
    expect(result.skippedNotListed.count).toBe(12);
    // Items with one cause share a group, whatever ids and names their reasons carry.
    expect(result.skippedNotListed.groups.map((g: any) => g.count)).toEqual([7, 5]);
    expect(result.skippedNotListed.groups[0].reason).toContain("was not staged by extraction");
    expect(result.skippedNotListed.groups[0].reason).toContain("<element>");
    const everySkipped = [...result.skipped.map((k: any) => k.planned), ...result.skippedNotListed.groups.flatMap((g: any) => g.ids)];
    expect(everySkipped.sort()).toEqual(full.skipped!.map((k) => k.planned).sort());
  });

  it("returns every item in full with a limit that covers them, or with verbose", () => {
    const full = report(ADOPT_LIST_LIMIT + 20, ADOPT_LIST_LIMIT + 5, 0);
    const wide = adoptionResult(full, { limit: 500 }) as any;
    expect(wide.adopted).toHaveLength(ADOPT_LIST_LIMIT + 20);
    expect(wide.skipped).toHaveLength(ADOPT_LIST_LIMIT + 5);
    expect(wide.adoptedNotListed).toBeUndefined();
    expect(wide.skippedNotListed).toBeUndefined();

    const verbose = adoptionResult(full, { verbose: true }) as any;
    expect(verbose.adopted).toEqual(full.adopted);
    expect(verbose.missing).toEqual(full.missing);
    expect(verbose.counts).toMatchObject({ adopted: ADOPT_LIST_LIMIT + 20, skipped: ADOPT_LIST_LIMIT + 5 });
  });
});
