/**
 * Retired attribute removal for `dr upgrade`.
 *
 * When the spec removes an attribute from a node type, an element that still carries it fails
 * schema validation: node `attributes` schemas set `additionalProperties: false`. The removal can
 * land between spec version bumps, so it runs as part of the catalog migration (see
 * catalog-migration.ts), which `dr upgrade` also applies to a model already at the current
 * version.
 *
 * RETIRED_ATTRIBUTES lists, per element type, the attributes the spec has removed; a later removal
 * adds a row. The migration drops them from every model element of that type, and from the element
 * payloads (`before` and `after`) of staged changesets, so a staged add or update doesn't bring
 * one back when it lands. The values are discarded: the spec has no replacement for them.
 *
 * Elements are changed on the loaded model and their layers left dirty for the upgrade's
 * saveDirtyLayers(); changesets are rewritten on disk. Only the listed attributes are removed, so
 * running it again on a migrated model changes nothing.
 */
import { readdir } from "fs/promises";
import type { Model } from "./model.js";
import type { Change } from "./changeset.js";
import { CANONICAL_LAYER_NAMES } from "./layers.js";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";
import { FileLock } from "../utils/file-lock.js";
import { getErrorMessage } from "../utils/errors.js";

/** Spec node id ("{layer}.{type}") -> attributes the spec no longer defines for that type */
export type RetiredAttributeTable = Record<string, readonly string[]>;

export const RETIRED_ATTRIBUTES: RetiredAttributeTable = {
  // #1091 (Context Studio proposal 6bfecdd1, spec 0.12.0): inputSelections repeated the sketch's
  // `composes inputselection` relationships; a partition is reusable across fields, and
  // testing.targetinputfield carries the field it is bound to
  "testing.testcasesketch": ["inputSelections"],
  "testing.inputspacepartition": ["fieldRef"],
};

export interface RetiredAttributeChange {
  /** The element's path (its id when it has none) */
  element: string;
  specNodeId: string;
  /** The retired attributes it carried, in table order */
  attributes: string[];
}

export interface StagedRetiredAttributeChange extends RetiredAttributeChange {
  /** The changeset's directory id */
  changeset: string;
  /** The staged change that carried them */
  stagedAs: Change["type"];
}

export interface AttributeMigrationResult {
  /** Layers whose elements changed (each is saved with the dirty layers) */
  layersModified: number;
  changes: RetiredAttributeChange[];
  changesetsModified: number;
  stagedChanges: StagedRetiredAttributeChange[];
  errors: string[];
}

const ELEMENT_CHANGE_TYPES = new Set<Change["type"]>(["add", "update", "delete"]);

function normalizedTable(table: RetiredAttributeTable): Map<string, readonly string[]> {
  return new Map(Object.entries(table).map(([type, attributes]) => [type.toLowerCase(), attributes]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The retired attributes present in an attributes object, in table order */
function retiredIn(attributes: unknown, retired: readonly string[] | undefined): string[] {
  if (!retired || !isRecord(attributes)) return [];
  return retired.filter((name) => Object.prototype.hasOwnProperty.call(attributes, name));
}

function without(attributes: Record<string, unknown>, names: string[]): Record<string, unknown> {
  const out = { ...attributes };
  for (const name of names) delete out[name];
  return out;
}

/** The spec node id an element payload of a staged change stands for, if it names one */
function payloadSpecNodeId(payload: Record<string, unknown>, change: Change): string | undefined {
  if (typeof payload.spec_node_id === "string" && payload.spec_node_id) return payload.spec_node_id;
  if (typeof payload.type === "string" && payload.type) {
    const layer = typeof payload.layer_id === "string" && payload.layer_id ? payload.layer_id : change.layerName;
    return `${layer}.${payload.type}`;
  }
  return undefined;
}

/**
 * Remove the retired attributes from the model's elements and from staged changesets.
 *
 * @param table - spec node id -> retired attribute names; defaults to RETIRED_ATTRIBUTES
 * @param options.dryRun - report what would be removed, and change nothing
 */
export async function migrateRetiredAttributes(
  model: Model,
  table: RetiredAttributeTable = RETIRED_ATTRIBUTES,
  options: { dryRun?: boolean } = {}
): Promise<AttributeMigrationResult> {
  const result: AttributeMigrationResult = {
    layersModified: 0,
    changes: [],
    changesetsModified: 0,
    stagedChanges: [],
    errors: [],
  };
  const retired = normalizedTable(table);
  if (retired.size === 0) return result;

  for (const layerName of CANONICAL_LAYER_NAMES) {
    if (!model.layers.has(layerName)) {
      await model.loadLayer(layerName);
    }
  }

  // 1. Model elements. Element ids and paths -> spec node id, for staged updates whose payload
  // names no type.
  const elementTypes = new Map<string, string>();
  for (const layer of model.layers.values()) {
    let changed = false;
    for (const element of layer.listElements()) {
      const specNodeId = (element.spec_node_id || `${layer.name}.${element.type}`).toLowerCase();
      elementTypes.set(element.id, specNodeId);
      if (element.path) elementTypes.set(element.path, specNodeId);

      const found = retiredIn(element.attributes, retired.get(specNodeId));
      if (found.length === 0) continue;
      result.changes.push({ element: element.path || element.id, specNodeId, attributes: found });
      if (options.dryRun) continue;
      element.attributes = without(element.attributes, found);
      if (!layer.updateElement(element)) {
        result.errors.push(`${element.path || element.id}: could not remove retired attributes ${found.join(", ")}`);
        continue;
      }
      changed = true;
    }
    if (changed) result.layersModified++;
  }

  // 2. Staged changesets: element payloads of adds, updates and deletes
  const storage = new StagedChangesetStorage(model.rootPath);
  let entries: string[] = [];
  try {
    entries = (await readdir(storage.getChangesetsDir(), { withFileTypes: true }))
      // FileLock keeps "<changeset>.lock" directories beside the changesets
      .filter((entry) => entry.isDirectory() && !entry.name.endsWith(".lock"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }

  for (const id of entries) {
    try {
      await new FileLock(storage.getChangesetPath(id)).withLock(async () => {
        const changeset = await storage.load(id);
        if (!changeset || changeset.status !== "staged") return;

        const report: StagedRetiredAttributeChange[] = [];
        const rewritten = changeset.changes.map((change) => {
          if (!ELEMENT_CHANGE_TYPES.has(change.type)) return change;
          const out = { ...change };
          let specNodeId: string | undefined;
          const found = new Set<string>();
          for (const key of ["before", "after"] as const) {
            const payload = change[key];
            if (!isRecord(payload)) continue;
            const type = (payloadSpecNodeId(payload, change) ?? elementTypes.get(change.elementId))?.toLowerCase();
            const names = retiredIn(payload.attributes, type ? retired.get(type) : undefined);
            if (names.length === 0) continue;
            specNodeId = type;
            names.forEach((name) => found.add(name));
            out[key] = { ...payload, attributes: without(payload.attributes as Record<string, unknown>, names) };
          }
          if (found.size === 0 || !specNodeId) return change;
          report.push({
            changeset: id,
            stagedAs: change.type,
            element: change.elementId,
            specNodeId,
            attributes: (retired.get(specNodeId) ?? []).filter((name) => found.has(name)),
          });
          return out;
        });
        if (report.length === 0) return;
        result.stagedChanges.push(...report);
        if (options.dryRun) return;
        changeset.changes = rewritten as typeof changeset.changes;
        changeset.updateModified();
        await storage.save(changeset);
        result.changesetsModified++;
      });
    } catch (error) {
      result.errors.push(
        `Failed to remove retired attributes from staged changeset '${id}': ${getErrorMessage(error)}; fix or delete the changeset and run the upgrade again`
      );
    }
  }

  // Changed layers are dirty; the upgrade saves them
  return result;
}

/**
 * One phrase per retired attribute:
 * "testing.inputspacepartition.fieldRef (3 elements); testing.testcasesketch.inputSelections (1 element)"
 */
export function summarizeRetiredAttributeChanges(changes: RetiredAttributeChange[], noun = "element"): string {
  const counts = new Map<string, number>();
  for (const change of changes) {
    for (const name of change.attributes) {
      const key = `${change.specNodeId}.${name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts].map(([key, n]) => `${key} (${n} ${noun}${n === 1 ? "" : "s"})`).join("; ");
}
