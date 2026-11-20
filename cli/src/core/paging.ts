/**
 * Paging for lists a tool or command returns: the convention the MCP tools share.
 *
 * A limit is a default and a size target, never a cut-off. A list longer than its limit is returned
 * a page at a time, with its true total, how many came back, and the offset of the next page.
 * Repeating the same call with that offset returns the rest, and the pages together are the whole
 * list, each item once. Counts, summaries and verdicts are always computed over the whole list,
 * never over the page.
 *
 * In: `limit` (the most items in one result; each tool states its default in its description) and
 * `offset` (how many to skip). {@link pagingFields} gives a tool both arguments.
 *
 * Out, for a result with one paged list ({@link pageOf}):
 *
 *     "page": { "total": 362, "returned": 150, "offset": 0, "nextOffset": 150 }
 *
 * `total` is the list's true length, `nextOffset` is absent on the last page, and an offset past
 * the end is an empty last page, not an error. The fields are nested under `page` because results
 * also carry counts of other things. A tool that pages one of several possible lists names it
 * (`"of": "errors"`). The result's `more` names the exact call for the next page
 * ({@link nextPageHint}).
 *
 * Out, for a result with several lists paged together ({@link listsPager}), as `model_trace` has:
 *
 *     "page": { "offset": 0, "totals": { "dependents.direct": 231, "dependents.transitive": 0 }, "nextOffset": 200 }
 *
 * One `offset` and `limit` apply to every list, `totals` has each list's true length by name, and
 * `nextOffset` is present while any list has more, so repeating the call pages them all.
 *
 * Arguments are checked here, not only at a tool's zod schema, so a caller that builds them itself
 * cannot loop or skip: `limit` must be an integer of at least 1 and `offset` an integer of at least
 * 0 (either may be left out), and anything else throws a RangeError naming the argument. The
 * default limit a tool passes is checked the same way. An offset past the end of a list is an
 * empty last page at the list's end, in both forms; in the multi-list form `page.offset` is the
 * offset asked for, since each list may end at a different place. `nextOffset`, when present, is
 * always greater than `offset`, so following it always moves on.
 */

import { z } from "zod";

export interface PageArgs {
  limit?: number;
  offset?: number;
}

/** Where a page sits in its list. `nextOffset` is absent when nothing is left. */
export interface Page {
  /** How many items the whole list has. */
  total: number;
  /** How many of them this result holds. */
  returned: number;
  offset: number;
  nextOffset?: number;
}

/** The `limit` and `offset` arguments of a tool that pages `what` (e.g. "errors"). */
export function pagingFields(what: string, defaultLimit: string) {
  return {
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        `The most ${what} to return in one call (default ${defaultLimit}). A page size, not a cut-off: the result ` +
          "gives the true total, and nextOffset when there are more."
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        `Skip this many ${what}: repeat the call with the same arguments and the previous result's nextOffset for ` +
          "the next page."
      ),
  };
}

/**
 * The limit and offset the arguments ask for, checked: a limit is an integer of at least 1, an
 * offset an integer of at least 0. Throws a RangeError for anything else.
 */
export function checkedPageArgs(args: PageArgs, defaultLimit: number): { limit: number; offset: number } {
  const limit = args.limit ?? defaultLimit;
  const offset = args.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      `${args.limit === undefined ? "default limit" : "limit"} must be an integer of at least 1, got ${String(limit)}`
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError(`offset must be an integer of at least 0, got ${String(offset)}`);
  }
  return { limit, offset };
}

/**
 * The page of `all` the arguments ask for (`defaultLimit` items from the start when they don't
 * say). Throws a RangeError for a limit or offset that is not a valid one (see the file's header).
 */
export function pageOf<T>(all: readonly T[], args: PageArgs, defaultLimit: number): { items: T[]; page: Page } {
  const checked = checkedPageArgs(args, defaultLimit);
  const offset = Math.min(checked.offset, all.length);
  const items = all.slice(offset, offset + checked.limit);
  const end = offset + items.length;
  return {
    items,
    page: { total: all.length, returned: items.length, offset, ...(end < all.length ? { nextOffset: end } : {}) },
  };
}

/** The whole list as one page: for a caller that asked for everything. */
export function wholePage<T>(all: readonly T[]): { items: T[]; page: Page } {
  return { items: [...all], page: { total: all.length, returned: all.length, offset: 0 } };
}

/** One line naming the call that returns the next page, or undefined when this page is the last. */
export function nextPageHint(tool: string, noun: string, page: Page): string | undefined {
  if (page.nextOffset === undefined) return undefined;
  const left = page.total - page.nextOffset;
  return (
    `${page.returned} of ${page.total} ${noun} returned (from ${page.offset}); ${left} more: call ${tool} again with ` +
    `the same arguments and offset: ${page.nextOffset}.`
  );
}

/** Where a page sits in several lists paged together. `nextOffset` is absent when none has more. */
export interface ListsPage {
  offset: number;
  /** Each list's true length, by the name it was cut under. */
  totals: Record<string, number>;
  nextOffset?: number;
}

/**
 * Pages several lists of one result with the same limit and offset: `cut` returns a list's page and
 * records its total, and `page` describes them all once every list has been cut.
 */
export function listsPager(
  args: PageArgs,
  defaultLimit: number
): { cut<T>(name: string, list: readonly T[]): T[]; page(): ListsPage } {
  // Checked once, up front, so a bad argument throws even when no list is cut.
  const checked = checkedPageArgs(args, defaultLimit);
  const totals: Record<string, number> = {};
  let nextOffset: number | undefined;
  return {
    cut<T>(name: string, list: readonly T[]): T[] {
      const { items, page } = pageOf(list, checked, defaultLimit);
      totals[name] = page.total;
      if (page.nextOffset !== undefined) nextOffset = page.nextOffset;
      return items;
    },
    page: () => ({ offset: checked.offset, totals, ...(nextOffset !== undefined ? { nextOffset } : {}) }),
  };
}
