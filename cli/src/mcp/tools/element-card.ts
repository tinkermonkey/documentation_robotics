/**
 * An element in a few lines: what a read that names several elements returns for each
 * (model_show with ids, the unchanged elements changeset_brief's ids name).
 *
 * Its id, name and the first sentence of its description, its change status when a changeset is
 * read, and its connections as `predicate → id` (from it) and `predicate ← id` (into it) lines,
 * marked `(added)` or `(deleted)` when the changeset stages them. At most `maxConnections` lines per
 * predicate and direction, the ones the changeset stages first; the rest are counted per
 * `predicate → layer` in `connectionCounts`, so the lines and the counts together are all of them.
 */

import type { ChangesetGraph } from "../../core/changeset-graph.js";
import { shortDescription } from "./model-list.js";

/** Connections listed per predicate and direction on a card by default; the rest are counted. */
export const CARD_CONNECTIONS = 5;

export interface CardConnection {
  direction: "out" | "in";
  predicate: string;
  other: string;
  /** The relationship's standing in the changeset read (`added`, `deleted`, `unchanged`), when one is. */
  status?: string;
}

export interface ElementCard {
  id: string;
  name: string;
  /** The first sentence of the description, at most 160 characters. */
  description?: string;
  /** The element's standing in the changeset read: added, updated, deleted or unchanged. */
  status?: string;
  /** How many connections it has in all, listed or counted. */
  connectionTotal: number;
  connections: string[];
  /** Connections not listed, per `predicate → layer` (`←` for one into it). */
  connectionCounts?: Record<string, number>;
}

const STAGED = new Set(["added", "deleted"]);

/**
 * An element's connections in a changeset's projection, as a card lists them: every relationship
 * at either end, the ones the changeset deletes included, each with its standing.
 */
export function graphConnections(graph: ChangesetGraph, id: string): CardConnection[] {
  return graph
    .neighbors(id, { includeDeleted: true })
    .map((n) => ({ direction: n.direction, predicate: n.relationship.predicate, other: n.other, status: n.relationship.status }));
}

export function elementCard(
  element: { id: string; name: string; description?: string },
  connections: readonly CardConnection[],
  options: { status?: string; maxConnections?: number } = {}
): ElementCard {
  const max = options.maxConnections ?? CARD_CONNECTIONS;
  // What the changeset stages comes first, then what the base has, each in the order given.
  const ordered = [
    ...connections.filter((c) => c.status && STAGED.has(c.status)),
    ...connections.filter((c) => !c.status || !STAGED.has(c.status)),
  ];
  const lines: string[] = [];
  const counts: Record<string, number> = {};
  const listed = new Map<string, number>();
  for (const c of ordered) {
    const arrow = c.direction === "out" ? "→" : "←";
    const group = `${c.predicate} ${arrow}`;
    const seen = listed.get(group) ?? 0;
    if (seen < max) {
      const mark = c.status && STAGED.has(c.status) ? ` (${c.status})` : "";
      lines.push(`${c.predicate} ${arrow} ${c.other}${mark}`);
      listed.set(group, seen + 1);
    } else {
      const key = `${group} ${c.other.split(".")[0]}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  const description = shortDescription(element.description);
  return {
    id: element.id,
    name: element.name,
    ...(description ? { description } : {}),
    ...(options.status ? { status: options.status } : {}),
    connectionTotal: connections.length,
    connections: lines,
    ...(Object.keys(counts).length > 0 ? { connectionCounts: counts } : {}),
  };
}
