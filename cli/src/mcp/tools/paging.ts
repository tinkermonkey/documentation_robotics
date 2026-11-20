/**
 * Paging for the read tools' lists.
 *
 * A limit here is a default and a size target, never a cut-off: a list longer than its limit is
 * returned a page at a time, with the true total, how many came back, and the offset of the next
 * page. Repeating the same call with that offset returns the rest, and the pages together are the
 * whole list. Counts, summaries and verdicts are always computed over the whole list, not the page.
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

/** The page of `all` the arguments ask for (`defaultLimit` items from the start when they don't say). */
export function pageOf<T>(all: readonly T[], args: PageArgs, defaultLimit: number): { items: T[]; page: Page } {
  const offset = Math.min(args.offset ?? 0, all.length);
  const limit = args.limit ?? defaultLimit;
  const items = all.slice(offset, offset + limit);
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
