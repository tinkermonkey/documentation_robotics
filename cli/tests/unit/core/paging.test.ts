/**
 * Unit tests for the paging convention the MCP tools share (core/paging.ts): a limit is a page
 * size, the total is always the true one, and the pages together are the whole list.
 */

import { describe, it, expect } from "bun:test";
import { checkedPageArgs, listsPager, nextPageCall, nextPageHint, pageOf, pagingFields, wholePage } from "../../../src/core/paging.js";

const numbers = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("pageOf", () => {
  it("returns the first page by default, with the true total and where the next page starts", () => {
    const { items, page } = pageOf(numbers(25), {}, 10);
    expect(items).toEqual(numbers(10));
    expect(page).toEqual({ total: 25, returned: 10, offset: 0, nextOffset: 10 });
  });

  it("has no nextOffset on the last page, or when the list fits one page", () => {
    expect(pageOf(numbers(25), { offset: 20 }, 10).page).toEqual({ total: 25, returned: 5, offset: 20 });
    expect(pageOf(numbers(10), {}, 10).page).toEqual({ total: 10, returned: 10, offset: 0 });
    expect(pageOf([], {}, 10)).toEqual({ items: [], page: { total: 0, returned: 0, offset: 0 } });
  });

  it("takes the caller's limit over the default", () => {
    expect(pageOf(numbers(25), { limit: 100 }, 10).page).toEqual({ total: 25, returned: 25, offset: 0 });
    expect(pageOf(numbers(25), { limit: 3, offset: 3 }, 10)).toEqual({
      items: [3, 4, 5],
      page: { total: 25, returned: 3, offset: 3, nextOffset: 6 },
    });
  });

  it("answers an offset past the end with an empty last page", () => {
    expect(pageOf(numbers(25), { offset: 400 }, 10)).toEqual({ items: [], page: { total: 25, returned: 0, offset: 25 } });
  });

  it("pages together into the whole list, each item once, whatever the page size", () => {
    for (const limit of [1, 7, 10, 25, 26]) {
      const seen: number[] = [];
      let offset: number | undefined = 0;
      let calls = 0;
      while (offset !== undefined) {
        const { items, page } = pageOf(numbers(25), { limit, offset }, 10);
        expect(page.total).toBe(25);
        seen.push(...items);
        offset = page.nextOffset;
        calls++;
      }
      expect(seen).toEqual(numbers(25));
      expect(calls).toBe(Math.ceil(25 / limit));
    }
  });
});

describe("wholePage", () => {
  it("is the whole list as one last page", () => {
    expect(wholePage(numbers(3))).toEqual({ items: [0, 1, 2], page: { total: 3, returned: 3, offset: 0 } });
  });
});

describe("nextPageHint", () => {
  it("names the call for the next page, and says nothing on the last page", () => {
    const { page } = pageOf(numbers(25), { offset: 10 }, 10);
    const hint = nextPageHint("model_validate", "errors", page)!;
    expect(hint).toContain("10 of 25 errors returned (from 10)");
    expect(hint).toContain("5 more");
    expect(hint).toContain("call model_validate again with the same arguments and offset: 20");
    expect(nextPageHint("model_validate", "errors", pageOf(numbers(25), { offset: 20 }, 10).page)).toBeUndefined();
  });
});

describe("listsPager", () => {
  it("pages several lists with one offset, keeps every true total, and ends when none has more", () => {
    const lists = { long: numbers(25), short: numbers(4), empty: [] as number[] };
    const seen: Record<string, number[]> = { long: [], short: [], empty: [] };
    let offset: number | undefined = 0;
    let calls = 0;
    while (offset !== undefined) {
      const pager = listsPager({ offset }, 10);
      for (const [name, list] of Object.entries(lists)) seen[name].push(...pager.cut(name, list));
      const page = pager.page();
      expect(page.totals).toEqual({ long: 25, short: 4, empty: 0 });
      expect(page.offset).toBe(offset);
      offset = page.nextOffset;
      calls++;
    }
    expect(calls).toBe(3);
    expect(seen).toEqual(lists);
  });

  it("has no nextOffset when every list fits the page", () => {
    const pager = listsPager({}, 10);
    pager.cut("a", numbers(10));
    pager.cut("b", numbers(2));
    expect(pager.page()).toEqual({ offset: 0, totals: { a: 10, b: 2 } });
  });
});

describe("pagingFields", () => {
  it("gives a tool optional limit and offset, stating the default and that it is a page size", () => {
    const fields = pagingFields("errors", "100");
    expect(fields.limit.description).toContain("default 100");
    expect(fields.limit.description).toContain("not a cut-off");
    expect(fields.offset.description).toContain("nextOffset");
    expect(fields.limit.safeParse(undefined).success).toBe(true);
    expect(fields.limit.safeParse(0).success).toBe(false);
    expect(fields.offset.safeParse(-1).success).toBe(false);
    expect(fields.offset.safeParse(0).success).toBe(true);
  });
});

describe("arguments are checked, whoever builds them", () => {
  const list = numbers(10);

  it("refuses a limit that is not an integer of at least 1", () => {
    for (const limit of [0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => pageOf(list, { limit }, 4)).toThrow(RangeError);
      expect(() => pageOf(list, { limit }, 4)).toThrow("limit must be an integer of at least 1");
      expect(() => listsPager({ limit }, 4)).toThrow(RangeError);
    }
  });

  it("refuses an offset that is not an integer of at least 0", () => {
    for (const offset of [-3, -1, 2.5, Number.NaN]) {
      expect(() => pageOf(list, { offset }, 4)).toThrow(RangeError);
      expect(() => pageOf(list, { offset }, 4)).toThrow("offset must be an integer of at least 0");
      expect(() => listsPager({ offset }, 4)).toThrow(RangeError);
    }
  });

  it("refuses a bad default limit, saying it is the default", () => {
    expect(() => pageOf(list, {}, 0)).toThrow("default limit must be an integer of at least 1");
    expect(() => listsPager({}, -1)).toThrow("default limit");
    // A caller's valid limit stands in for a bad default.
    expect(pageOf(list, { limit: 4 }, 0).page.returned).toBe(4);
  });

  it("checks both arguments in one place", () => {
    expect(checkedPageArgs({}, 4)).toEqual({ limit: 4, offset: 0 });
    expect(checkedPageArgs({ limit: 1, offset: 0 }, 4)).toEqual({ limit: 1, offset: 0 });
  });

  it("clamps an offset past the end the same way in both forms", () => {
    expect(pageOf(list, { offset: 99 }, 4).page).toEqual({ total: 10, returned: 0, offset: 10 });
    const pager = listsPager({ offset: 99 }, 4);
    expect(pager.cut("a", list)).toEqual([]);
    expect(pager.cut("b", numbers(3))).toEqual([]);
    // Each list ends at a different place, so the multi-list page reports the offset asked for.
    expect(pager.page()).toEqual({ offset: 99, totals: { a: 10, b: 3 } });
  });

  it("only ever gives a nextOffset greater than the offset", () => {
    for (let total = 0; total <= 12; total++) {
      for (let limit = 1; limit <= 5; limit++) {
        for (let offset = 0; offset <= total + 2; offset++) {
          const { page } = pageOf(numbers(total), { limit, offset }, 4);
          if (page.nextOffset !== undefined) {
            expect(page.nextOffset).toBeGreaterThan(page.offset);
            expect(page.nextOffset).toBeLessThan(total);
          }
          const pager = listsPager({ limit, offset }, 4);
          pager.cut("x", numbers(total));
          const lists = pager.page();
          if (lists.nextOffset !== undefined) expect(lists.nextOffset).toBeGreaterThan(lists.offset);
        }
      }
    }
  });
});

describe("nextPageHint with the caller's arguments", () => {
  it("names the exact next call, and nothing on the last page", () => {
    const { page } = pageOf(numbers(25), { limit: 10 }, 10);
    expect(nextPageHint("model_search", "results", page, { query: "x", limit: 10 })).toBe(
      '10 of 25 results returned (from 0); 15 more: next page: model_search {"query":"x","limit":10,"offset":10}.'
    );
    expect(nextPageHint("model_search", "results", pageOf(numbers(5), {}, 10).page, { query: "x" })).toBeUndefined();
  });
});

describe("nextPageCall", () => {
  it("names the tool with the caller's own arguments and the next offset", () => {
    expect(nextPageCall("model_search", { query: "orders", limit: 3, offset: 0, rootPath: "/p" }, 3)).toBe(
      'model_search {"query":"orders","limit":3,"rootPath":"/p","offset":3}'
    );
  });

  it("leaves out undefined arguments and the ones named in omit", () => {
    expect(nextPageCall("changeset_show", { changeset: "plan", layers: undefined, page: 2 }, 50, ["page"])).toBe(
      'changeset_show {"changeset":"plan","offset":50}'
    );
  });
});
