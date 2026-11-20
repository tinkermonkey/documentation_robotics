/**
 * codebase_verify's lists are pages, never cut-offs: each list that is not whole gives its true
 * total and next offset, the pages together are the whole list, and a layer's status, coverage and
 * summary are over everything whatever the page.
 */
import { describe, expect, it } from "bun:test";
import { pageLayerReport, VERIFY_PAGE_SIZE } from "../../../src/mcp/tools/codebase-verify.js";
import type { LayerVerifyEntry, LayerVerifyReport } from "../../../src/analyzers/types.js";

const entry = (i: number): LayerVerifyEntry => ({ id: `testing.testcasesketch.case-${i}`, type: "testing.testcasesketch", name: `case ${i}`, files: ["tests/a.test.ts"] });

function layer(inCode: number, notChecked: number, relationships: number): LayerVerifyReport {
  return {
    layer: "testing",
    status: "drifted",
    status_text: `Checked 3 of the model's ${3 + notChecked} test case sketches: drifted, ${inCode} test cases in the code only.`,
    coverage: { model_elements: 3 + notChecked, checked: 3, not_checked: notChecked, code_entries: inCode + 3 },
    not_checked: [{ reason: "no source reference", count: notChecked, ids: Array.from({ length: notChecked }, (_, i) => `testing.testcasesketch.unsourced-${i}`) }],
    checks: "test cases against test case sketches",
    buckets: { matched: [entry(-1), entry(-2), entry(-3)], in_graph_only: Array.from({ length: inCode }, (_, i) => entry(i)), in_model_only: [], not_indexed: [] },
    relationships: {
      matched: [],
      in_graph_only: Array.from({ length: relationships }, (_, i) => ({ source: `testing.testcasesketch.case-${i}`, predicate: "tests", target: "application.applicationfunction.f" })),
      in_model_only: [],
    },
    summary: {
      matched_count: 3,
      gap_count: inCode,
      drift_count: 0,
      not_indexed_count: 0,
      elements_without_source_ref: notChecked,
      elements_not_checked: 0,
      relationships: { matched_count: 0, gap_count: relationships, drift_count: 0 },
    },
  };
}

describe("pageLayerReport", () => {
  const whole = layer(130, 75, 60);

  it("returns the first page of each list, with the true total and the next offset of the ones that are not whole", () => {
    const { layer: paged, pager } = pageLayerReport(whole, {});
    expect(paged.buckets.in_graph_only).toHaveLength(VERIFY_PAGE_SIZE);
    expect(paged.not_checked![0].ids).toHaveLength(VERIFY_PAGE_SIZE);
    expect(paged.relationships!.in_graph_only).toHaveLength(VERIFY_PAGE_SIZE);
    expect(paged.lists).toEqual({
      in_graph_only: { total: 130, returned: VERIFY_PAGE_SIZE, offset: 0, nextOffset: VERIFY_PAGE_SIZE },
      "not_checked[0].ids": { total: 75, returned: VERIFY_PAGE_SIZE, offset: 0, nextOffset: VERIFY_PAGE_SIZE },
      "relationships.in_graph_only": { total: 60, returned: VERIFY_PAGE_SIZE, offset: 0, nextOffset: VERIFY_PAGE_SIZE },
    });
    // A list that came back whole is not named: its length is its total.
    expect(paged.buckets.matched).toHaveLength(3);
    expect(pager.nextOffset).toBe(VERIFY_PAGE_SIZE);
    // What the layer says about itself is over everything, not the page.
    expect(paged.status).toBe("drifted");
    expect(paged.coverage).toEqual(whole.coverage);
    expect(paged.summary).toEqual(whole.summary);
    expect(paged.not_checked![0].count).toBe(75);
  });

  it("pages to the end: the pages together are each whole list, and the last page has no next offset", () => {
    const inCode: LayerVerifyEntry[] = [];
    const ids: string[] = [];
    const rels: unknown[] = [];
    let offset: number | undefined = 0;
    let calls = 0;
    while (offset !== undefined) {
      const { layer: paged, pager } = pageLayerReport(whole, { offset });
      inCode.push(...paged.buckets.in_graph_only);
      ids.push(...paged.not_checked![0].ids);
      rels.push(...paged.relationships!.in_graph_only);
      // Past the end of a shorter list the page is empty, and says of how many.
      if (offset >= 100) expect(paged.lists!["relationships.in_graph_only"]).toEqual({ total: 60, returned: 0, offset: 60 });
      offset = pager.nextOffset;
      calls++;
    }
    expect(calls).toBe(3);
    expect(inCode).toEqual(whole.buckets.in_graph_only);
    expect(ids).toEqual(whole.not_checked![0].ids);
    expect(rels).toEqual(whole.relationships!.in_graph_only);
  });

  it("returns everything with a limit that covers it, and names no list", () => {
    const { layer: paged, pager } = pageLayerReport(whole, { limit: 1000 });
    expect(paged.buckets.in_graph_only).toHaveLength(130);
    expect(paged.not_checked![0].ids).toHaveLength(75);
    expect(paged.lists).toBeUndefined();
    expect(pager.nextOffset).toBeUndefined();
  });
});
