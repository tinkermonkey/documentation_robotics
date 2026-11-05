/**
 * Element type renames for `dr upgrade`.
 *
 * When the spec renames an element type ("product.capability" -> "product.softwarecapability",
 * recorded as a rename-type action and generated into RELATIONSHIP_REWRITE_TABLE.typeRenames),
 * every model element of the old type takes the new type, and its semantic path follows
 * ("product.capability.search" -> "product.softwarecapability.search"). Anything that names the
 * old path is rewritten with it: other elements' references, relationships.yaml, and the
 * element and relationship changes of staged changesets.
 *
 * The rename runs before the relationship rewrite of the same migration, on the loaded model, so
 * the relationship rules (keyed by the new type names) resolve the renamed elements. Renamed
 * layers are left dirty for the upgrade's saveDirtyLayers(); relationships.yaml and changesets
 * are rewritten on disk.
 */
import { readdir, readFile, writeFile } from "fs/promises";
import type { Model } from "./model.js";
import { Element } from "./element.js";
import type { Change } from "./changeset.js";
import { CANONICAL_LAYER_NAMES } from "./layers.js";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";
import { FileLock } from "../utils/file-lock.js";
import { getErrorMessage } from "../utils/errors.js";
import { RELATIONSHIP_REWRITE_TABLE } from "./relationship-migration-table.js";

export interface ElementTypeRenameChange {
  /** Element path before and after (the UUID does not change) */
  from: string;
  to: string;
  fromType: string;
  toType: string;
}

export interface ElementTypeMigrationResult {
  filesModified: number;
  changes: ElementTypeRenameChange[];
  /** Changesets whose staged changes named a renamed element or type */
  changesetsModified: number;
  errors: string[];
}

function splitType(specNodeId: string): { layer: string; type: string } {
  const dot = specNodeId.indexOf(".");
  return { layer: specNodeId.slice(0, dot), type: specNodeId.slice(dot + 1) };
}

/**
 * The renamed form of an element id: a renamed element's path, or any "{old type}.{name}" path,
 * which covers elements that exist only in a staged changeset. Other ids are returned unchanged.
 */
function mapId(id: string, ids: Map<string, string>, types: Record<string, string>): string {
  const known = ids.get(id);
  if (known) return known;
  for (const [from, to] of Object.entries(types)) {
    const rest = id.startsWith(`${from}.`) ? id.slice(from.length + 1) : undefined;
    if (rest && !rest.includes(".") && !rest.includes(":")) return `${to}.${rest}`;
  }
  return id;
}

/** Replace every string in a JSON-like value that is a renamed element id (or a composite of them) */
function rewriteValue(value: unknown, ids: Map<string, string>, types: Record<string, string>): unknown {
  if (typeof value === "string") {
    // Relationship change ids are "source::predicate::target"
    if (value.includes("::")) {
      const parts = value.split("::");
      const mapped = parts.map((p) => mapId(p, ids, types));
      return mapped.some((p, i) => p !== parts[i]) ? mapped.join("::") : value;
    }
    return mapId(value, ids, types);
  }
  if (Array.isArray(value)) return value.map((v) => rewriteValue(v, ids, types));
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = rewriteValue(v, ids, types);
    // An element payload of a renamed type: spec_node_id and type follow the rename
    const layerId = typeof obj.layer_id === "string" ? obj.layer_id : undefined;
    const specNodeId =
      typeof obj.spec_node_id === "string"
        ? obj.spec_node_id
        : layerId && typeof obj.type === "string"
          ? `${layerId}.${obj.type}`
          : undefined;
    const renamed = specNodeId ? types[specNodeId] : undefined;
    if (renamed) {
      if ("spec_node_id" in obj) out.spec_node_id = renamed;
      if ("type" in obj) out.type = splitType(renamed).type;
    }
    return out;
  }
  return value;
}

/** The new semantic path for an element of a renamed type, or the path unchanged */
function renamedPath(path: string, from: string, to: string): string {
  return path.startsWith(`${from}.`) ? `${to}.${path.slice(from.length + 1)}` : path;
}

/**
 * Rename the elements of every renamed type in the loaded model, and rewrite what names them.
 *
 * @param renames - old spec node id -> new spec node id; defaults to the generated table's
 */
export async function migrateElementTypes(
  model: Model,
  renames: Record<string, string> = RELATIONSHIP_REWRITE_TABLE.typeRenames ?? {}
): Promise<ElementTypeMigrationResult> {
  const result: ElementTypeMigrationResult = { filesModified: 0, changes: [], changesetsModified: 0, errors: [] };
  if (Object.keys(renames).length === 0) return result;

  for (const layerName of CANONICAL_LAYER_NAMES) {
    if (!model.layers.has(layerName)) {
      await model.loadLayer(layerName);
    }
  }

  // 1. Elements of a renamed type: new type, new path. A move to another layer is not supported.
  const ids = new Map<string, string>();
  for (const layer of model.layers.values()) {
    for (const element of layer.listElements()) {
      const oldSpec = element.spec_node_id || `${layer.name}.${element.type}`;
      const newSpec = renames[oldSpec];
      if (!newSpec) continue;
      const target = splitType(newSpec);
      if (target.layer !== layer.name) {
        result.errors.push(`${element.path}: renaming ${oldSpec} to ${newSpec} would move it to another layer, which the upgrade cannot do`);
        continue;
      }
      const json = element.toJSON();
      const newPath = renamedPath(element.path, oldSpec, newSpec);
      layer.deleteElement(element.id);
      layer.addElement(
        new Element({
          ...json,
          // A legacy element whose id is its semantic path keeps the two equal
          id: json.id === element.path ? newPath : json.id,
          path: newPath,
          spec_node_id: newSpec,
          type: target.type,
          layer_id: layer.name,
        })
      );
      if (newPath !== element.path) ids.set(element.path, newPath);
      result.changes.push({ from: element.path, to: newPath, fromType: oldSpec, toType: newSpec });
    }
  }
  if (result.changes.length === 0) return result;

  // 2. References from any element to a renamed path
  if (ids.size > 0) {
    for (const layer of model.layers.values()) {
      for (const element of layer.listElements()) {
        if (!element.references?.some((r) => ids.has(r.target) || ids.has(r.source))) continue;
        element.references = element.references.map((r) => ({
          ...r,
          source: ids.get(r.source) ?? r.source,
          target: ids.get(r.target) ?? r.target,
        }));
        layer.updateElement(element);
      }
    }
  }

  // 3. relationships.yaml names elements by path (or a legacy id)
  if (ids.size > 0) {
    const YAML = await import("yaml");
    const relationshipsPath = `${model.rootPath}/documentation-robotics/model/relationships.yaml`;
    let content: string | undefined;
    try {
      content = await readFile(relationshipsPath, "utf-8");
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
    const data = content ? (YAML.parse(content) ?? []) : [];
    if (Array.isArray(data)) {
      let changed = false;
      const rewritten = data.map((rel: Record<string, unknown>) => {
        const map = (v: unknown) => (typeof v === "string" && mapId(v, ids, renames) !== v ? mapId(v, ids, renames) : undefined);
        const source = map(rel.source);
        const target = map(rel.target);
        if (!source && !target) return rel;
        changed = true;
        return { ...rel, ...(source && { source }), ...(target && { target }) };
      });
      if (changed) {
        const header = `# Intra-layer relationships
# Format: source_id -> predicate -> target_id
# Last updated: ${new Date().toISOString()}

`;
        await writeFile(relationshipsPath, header + YAML.stringify(rewritten), "utf-8");
        result.filesModified++;
      }
    }
  }

  // 4. Staged changesets: element and relationship changes naming a renamed element or type
  const storage = new StagedChangesetStorage(model.rootPath);
  let entries: string[] = [];
  try {
    entries = (await readdir(storage.getChangesetsDir(), { withFileTypes: true }))
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
        const before = JSON.stringify(changeset.changes);
        changeset.changes = changeset.changes.map((change) => rewriteValue(change, ids, renames) as Change) as typeof changeset.changes;
        if (JSON.stringify(changeset.changes) === before) return;
        changeset.updateModified();
        await storage.save(changeset);
        result.changesetsModified++;
      });
    } catch (error) {
      result.errors.push(
        `Failed to rename element types in staged changeset '${id}': ${getErrorMessage(error)}; fix or delete the changeset and run the upgrade again`
      );
    }
  }

  // Renamed layers are dirty; the upgrade saves them
  return result;
}

/** One line per renamed type: "product.capability -> product.softwarecapability (3 elements)" */
export function summarizeElementTypeChanges(changes: ElementTypeRenameChange[]): string {
  const byType = new Map<string, number>();
  for (const c of changes) byType.set(`${c.fromType} -> ${c.toType}`, (byType.get(`${c.fromType} -> ${c.toType}`) ?? 0) + 1);
  return [...byType].map(([k, n]) => `${k} (${n} element${n === 1 ? "" : "s"})`).join("; ");
}
