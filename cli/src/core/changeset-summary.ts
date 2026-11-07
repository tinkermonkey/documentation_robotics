/**
 * A compact view of a changeset's staged changes: one entry per change with its operation and what
 * it names, and for updates the fields it changed, without the before/after snapshots.
 *
 * Used by the MCP `changeset_show` tool's `detail: "summary"` mode, where an agent iterating on a
 * plan wants to see the plan's shape each pass without paying for every element snapshot.
 * See docs/CHANGE_MODELING.md ("Iterating on a plan").
 */

import type { Change, StagedChange } from "./changeset.js";
import { stagedRelationshipTriple } from "./relationship-staging.js";

export type ChangeOperation = Change["type"];

export interface ChangeSummaryEntry {
  sequence: number;
  operation: ChangeOperation;
  layer: string;
  /** Element changes: the element's id. */
  elementId?: string;
  /** Element changes: the element's type (from its snapshot). */
  elementType?: string;
  /** Updates: the fields that differ between before and after (`name`, `attributes.summary`, ...). */
  changedFields?: string[];
  /** Relationship changes: the relationship's ends and predicate. */
  source?: string;
  predicate?: string;
  target?: string;
}

export interface ChangesetSummary {
  totals: Record<ChangeOperation, number> & { total: number };
  changes: ChangeSummaryEntry[];
}

/** Snapshot keys that name the same field. The legacy camelCase key is reported as `source_reference`. */
const FIELD_ALIASES: Record<string, string> = { sourceReference: "source_reference" };

/** Keys whose nested keys are reported one level down (`attributes.summary`). */
const NESTED_FIELDS = new Set(["attributes", "metadata"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Stable JSON for comparing snapshot values regardless of key order. */
function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** `null` and absent both mean "not set" in a snapshot (a cleared source reference is written as null). */
function isUnset(value: unknown): boolean {
  return value === undefined || value === null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isUnset(a) && isUnset(b)) return true;
  return canonical(a) === canonical(b);
}

function normalizeSnapshot(snapshot: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!snapshot) return out;
  for (const [key, value] of Object.entries(snapshot)) {
    const name = FIELD_ALIASES[key] ?? key;
    // The legacy key carries the intended value; it wins over a stale snake_case copy.
    if (name !== key || !(name in out)) out[name] = value;
  }
  return out;
}

/**
 * The fields an update changes: top-level snapshot keys whose values differ, with `attributes`
 * and `metadata` broken down by key. Sorted for a stable result.
 */
export function changedFields(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined
): string[] {
  const a = normalizeSnapshot(before);
  const b = normalizeSnapshot(after);
  const fields: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (sameValue(a[key], b[key])) continue;
    if (NESTED_FIELDS.has(key) && (isRecord(a[key]) || isUnset(a[key])) && (isRecord(b[key]) || isUnset(b[key]))) {
      const inner = { before: (a[key] ?? {}) as Record<string, unknown>, after: (b[key] ?? {}) as Record<string, unknown> };
      for (const sub of new Set([...Object.keys(inner.before), ...Object.keys(inner.after)])) {
        if (!sameValue(inner.before[sub], inner.after[sub])) fields.push(`${key}.${sub}`);
      }
      continue;
    }
    fields.push(key);
  }
  return fields.sort();
}

function elementType(change: Change): string | undefined {
  const snapshot = (change.after ?? change.before) as Record<string, unknown> | undefined;
  const type = snapshot?.type;
  return typeof type === "string" ? type : undefined;
}

export function summarizeChange(change: Change | StagedChange, index: number): ChangeSummaryEntry {
  const sequence = (change as StagedChange).sequenceNumber ?? index;
  const base = { sequence, operation: change.type, layer: change.layerName };
  if (change.type === "relationship-add" || change.type === "relationship-delete") {
    const triple = stagedRelationshipTriple(change as StagedChange);
    // A malformed row still gets an entry, named by its key, rather than vanishing from the view.
    return triple ? { ...base, ...triple } : { ...base, elementId: change.elementId };
  }
  const entry: ChangeSummaryEntry = { ...base, elementId: change.elementId };
  const type = elementType(change);
  if (type) entry.elementType = type;
  if (change.type === "update") {
    entry.changedFields = changedFields(
      change.before as Record<string, unknown> | undefined,
      change.after as Record<string, unknown> | undefined
    );
  }
  return entry;
}

export function summarizeChangeset(changes: ReadonlyArray<Change | StagedChange>): ChangesetSummary {
  const totals = {
    add: 0,
    update: 0,
    delete: 0,
    "relationship-add": 0,
    "relationship-delete": 0,
    total: changes.length,
  } as ChangesetSummary["totals"];
  const entries = changes.map((change, index) => {
    totals[change.type] = (totals[change.type] ?? 0) + 1;
    return summarizeChange(change, index);
  });
  entries.sort((x, y) => x.sequence - y.sequence);
  return { totals, changes: entries };
}
