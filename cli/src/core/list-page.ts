/**
 * Pages of a list a tool result shortens.
 *
 * A limit is a default and a size target, never a cut-off: a list longer than its limit comes back
 * a page at a time, with the true total, how many came back, and the offset of the next page.
 * Repeating the same call with that offset returns the rest, and the pages together are the whole
 * list. Counts, summaries, statuses and verdicts are computed over the whole list, never the page.
 *
 * The shape (`total`, `returned`, `offset`, `nextOffset`) is the one the read tools share
 * (`mcp/tools/paging.ts` on the model-reads branch); this copy lives in core because the verify
 * reports are shaped here, below the MCP layer.
 */

export interface PageArgs {
  limit?: number;
  offset?: number;
}

/** Where a page sits in its list. `nextOffset` is absent when nothing is left. */
export interface ListPage {
  /** How many items the whole list has. */
  total: number;
  /** How many of them this result holds. */
  returned: number;
  offset: number;
  nextOffset?: number;
}

/** The page of `all` the arguments ask for (`defaultLimit` items from the start when they don't say). */
export function pageOf<T>(all: readonly T[], args: PageArgs, defaultLimit: number): { items: T[]; page: ListPage } {
  const offset = Math.min(Math.max(args.offset ?? 0, 0), all.length);
  const limit = Math.max(args.limit ?? defaultLimit, 1);
  const items = all.slice(offset, offset + limit);
  const end = offset + items.length;
  return { items, page: { total: all.length, returned: items.length, offset, ...(end < all.length ? { nextOffset: end } : {}) } };
}

/** Whether a page is the whole of its list. */
export function isWhole(page: ListPage): boolean {
  return page.returned === page.total;
}

/**
 * Pages every list of a result through one window, and remembers the ones that did not come back
 * whole. One `limit` and `offset` apply to all the lists, so the next call is the same for each:
 * the same arguments with `offset` set to {@link PagedLists.nextOffset}.
 */
export class PagedLists {
  /** The lists that are not whole in this result, by name. */
  readonly pages: Record<string, ListPage> = {};

  constructor(
    private readonly args: PageArgs,
    private readonly defaultLimit: number
  ) {}

  /** The page of `all`, recorded under `name` when it is not the whole list. */
  list<T>(name: string, all: readonly T[]): T[] {
    const { items, page } = pageOf(all, this.args, this.defaultLimit);
    if (!isWhole(page)) this.pages[name] = page;
    return items;
  }

  get limit(): number {
    return Math.max(this.args.limit ?? this.defaultLimit, 1);
  }

  get offset(): number {
    return Math.max(this.args.offset ?? 0, 0);
  }

  /** The offset of the next page, when some list has more; absent when every list is done. */
  get nextOffset(): number | undefined {
    return Object.values(this.pages).some((p) => p.nextOffset !== undefined) ? this.offset + this.limit : undefined;
  }

  /** `name 50 of 6,434` for each list that is not whole, the longest first. */
  describe(): string {
    return Object.entries(this.pages)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, p]) => `${name} ${p.returned} of ${p.total}`)
      .join(", ");
  }
}
