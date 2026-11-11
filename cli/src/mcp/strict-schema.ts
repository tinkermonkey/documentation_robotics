/**
 * Strict argument schemas for the MCP tools. A tool refuses an argument it doesn't take, at the
 * top level and inside the objects its arrays carry: the SDK would strip an unknown key, so a
 * misnamed argument (`changeset` for `changesetId`, `sourceSymbl` for `sourceSymbol`) silently
 * changed what the call did.
 */

import { z, type ZodRawShape } from "zod";

/** Edit distance between two short strings (insertions, deletions, substitutions). */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/**
 * The accepted name an unknown key most likely meant: the same name with or without an `Id`
 * suffix, in any case; one cut short or run on (`extract`); or one a couple of letters away
 * (`sourceSymbl`).
 */
function meantName(key: string, accepted: string[]): string | undefined {
  const lower = key.toLowerCase();
  const exact = accepted.find(
    (name) => name.toLowerCase() === `${lower}id` || `${name.toLowerCase()}id` === lower || name.toLowerCase() === lower
  );
  if (exact) return exact;
  // A name cut short or run on (`extract` for `extracted`, `sections` for `section`).
  const truncated = accepted.find((name) => {
    const n = name.toLowerCase();
    return Math.min(n.length, lower.length) >= 4 && (n.startsWith(lower) || lower.startsWith(n));
  });
  if (truncated) return truncated;
  const allowed = Math.min(2, Math.floor(key.length / 4));
  let best: { name: string; distance: number } | undefined;
  for (const name of accepted) {
    const distance = editDistance(lower, name.toLowerCase());
    if (distance <= allowed && (!best || distance < best.distance)) best = { name, distance };
  }
  return best?.name;
}

/** " (did you mean 'x' for 'y'?)", or "" when no key has a likely match. */
function hintFor(accepted: string[], unknown: string[]): string {
  const hints = unknown
    .map((key) => {
      const meant = meantName(key, accepted);
      return meant ? `'${meant}' for '${key}'` : undefined;
    })
    .filter((hint): hint is string => hint !== undefined);
  return hints.length > 0 ? ` (did you mean ${hints.join(", ")}?)` : "";
}

/** The message for arguments a tool doesn't take, with the argument that was probably meant. */
export function unknownArgumentsMessage(toolName: string, accepted: string[], unknown: string[]): string {
  return `${toolName} doesn't take ${unknown.map((key) => `'${key}'`).join(", ")}${hintFor(accepted, unknown)}. It takes: ${accepted.join(", ")}.`;
}

/**
 * A strict object inside a tool's arguments (an `elements[]` item, `against`): a key it doesn't
 * take is refused, naming where it was (`what`), the likely match, and the keys it does take.
 */
export function strictItem<T extends ZodRawShape>(what: string, shape: T) {
  const accepted = Object.keys(shape);
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? `${what} doesn't take ${issue.keys.map((key) => `'${key}'`).join(", ")}${hintFor(accepted, issue.keys)}. It takes: ${accepted.join(", ")}.`
        : undefined,
  });
}
