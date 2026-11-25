/**
 * Reads a batch result's causes (batch-result.ts, #1295) back into items: each listed item with its
 * index, status, id when it has one, and its own reason and suggestions, rebuilt from its cause's
 * text and the item's values. Sorted by index.
 */

export interface ListedItem {
  index: number;
  status: string;
  id?: string;
  reason: string;
  suggestions?: string[];
}

/** A cause's text with an item's values put back for its placeholders, in order. */
export function fill(text: string, values: Array<string | number>, at: { i: number }): string {
  return text.replace(/<id>|"<name>"|\[n\]/g, (token) => {
    const value = values[at.i++];
    return token === "<id>" ? String(value) : token === "[n]" ? `[${value}]` : `"${value}"`;
  });
}

export function listed(report: { causes?: any[] }): ListedItem[] {
  const items: ListedItem[] = [];
  for (const cause of report.causes ?? []) {
    for (const item of cause.items) {
      const at = { i: 0 };
      const values = cause.literal ? [] : (item.values ?? []);
      items.push({
        index: item.index,
        status: cause.status,
        ...(item.id ? { id: item.id } : {}),
        reason: fill(cause.reason, values, at),
        ...(cause.suggestions ? { suggestions: cause.suggestions.map((text: string) => fill(text, values, at)) } : {}),
      });
    }
  }
  return items.sort((a, b) => a.index - b.index);
}
