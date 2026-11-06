/**
 * Source references inside staged element snapshots.
 *
 * A staged change's `before`/`after` is an element snapshot in the on-disk shape
 * (`Element.toJSON()`), so its source reference lives under the snake_case key
 * `source_reference`. A cleared reference is written as `source_reference: null`:
 * an update's `after` starts as a copy of `before`, so leaving the key out would
 * keep the old reference instead of clearing it.
 *
 * Earlier builds of `dr update` and the MCP `model_update` tool wrote the new
 * reference under a camelCase `sourceReference` key instead, next to the stale
 * snake_case copy. Those changes.yaml files exist, so readers go through
 * {@link readStagedSourceReference}, which honours the camelCase key when present.
 */
import type { SourceReference } from "../types/source-reference.js";

const LEGACY_KEY = "sourceReference";
const KEY = "source_reference";

/**
 * Record a source-reference change on a staged element snapshot.
 * `undefined` clears the reference.
 */
export function setStagedSourceReference(
  snapshot: Record<string, unknown>,
  ref: SourceReference | undefined
): void {
  delete snapshot[LEGACY_KEY];
  snapshot[KEY] = ref ?? null;
}

/**
 * Read a staged snapshot's source reference.
 *
 * `present` is false when the snapshot says nothing about the reference (neither
 * key is set), so a caller can keep whatever the element already has; when it is
 * true, `value` is the reference to use, `undefined` meaning cleared.
 */
export function readStagedSourceReference(
  snapshot: Record<string, unknown> | undefined | null
): { present: boolean; value: SourceReference | undefined } {
  if (!snapshot) return { present: false, value: undefined };
  // The legacy camelCase key carries the intended new value; its snake_case
  // neighbour in such files is the stale copy of `before`.
  for (const key of [LEGACY_KEY, KEY]) {
    if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
      const raw = snapshot[key];
      const value = raw && typeof raw === "object" ? (raw as SourceReference) : undefined;
      return { present: true, value };
    }
  }
  return { present: false, value: undefined };
}

/** The snapshot's source reference, or undefined when it has none or it is cleared. */
export function stagedSourceReference(
  snapshot: Record<string, unknown> | undefined | null
): SourceReference | undefined {
  return readStagedSourceReference(snapshot).value;
}

/**
 * A copy of the snapshot in the canonical shape: the legacy camelCase key folded
 * into `source_reference`, and a cleared reference left out. Used where a
 * snapshot becomes an element (commit), so no stray keys reach the model.
 */
export function canonicalStagedSnapshot(snapshot: Record<string, unknown>): {
  data: Record<string, unknown>;
  sourceReference: { present: boolean; value: SourceReference | undefined };
} {
  const sourceReference = readStagedSourceReference(snapshot);
  const data = { ...snapshot };
  delete data[LEGACY_KEY];
  delete data[KEY];
  if (sourceReference.value) data[KEY] = sourceReference.value;
  return { data, sourceReference };
}
