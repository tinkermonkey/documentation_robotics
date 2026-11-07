/**
 * Changeset base index — which elements and relationships the base model had when a changeset was
 * created, so later readers can tell what predates the plan and what changed in the base under it.
 *
 * The changeset's `baseSnapshot` is a single hash of the whole model: it says the base changed, not
 * what changed. The index records each base element's id with a short content hash, and each base
 * relationship's key, in `documentation-robotics/changesets/{id}/base-index.json`. It is written
 * when the changeset is created. Changesets created before it existed (or imported) have none, and
 * every reader falls back to what it can tell without one and says so.
 *
 * Readers:
 * - `changeset_verify` excludes elements that existed before the plan from the candidates for a
 *   planned add (they cannot be its built form).
 * - `changeset_brief` names what changed in the base since the plan was created (`describeDrift`).
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../utils/file-io.js";
import { getErrorMessage } from "../utils/errors.js";
import { Changeset } from "./changeset.js";
import { ChangesetGraph, relationshipKey, type GraphElement } from "./changeset-graph.js";
import type { Model } from "./model.js";

export const BASE_INDEX_FILE = "base-index.json";

export interface BaseIndex {
  version: 1;
  captured: string;
  /** Element id (dotted path) → short hash of its content. */
  elements: Record<string, string>;
  /** Relationship keys, `source::predicate::target`, endpoints as dotted paths. */
  relationships: string[];
}

export interface RelationshipRef {
  source: string;
  predicate: string;
  target: string;
}

/** How many ids each drift list carries before it is cut short (the counts stay exact). */
export const DRIFT_LIST_LIMIT = 50;

export interface ChangesetDrift {
  /** Kept for compatibility: true when the base changed since the changeset was created. */
  isDrifted: boolean;
  warnings: string[];
  baseSnapshotId?: string;
  currentSnapshotId?: string;
  /** Whether a base index was recorded for the changeset; without one, `baseChanges` is absent. */
  baseIndex: "recorded" | "not-recorded" | "unreadable";
  /**
   * Staged changes that the base now overlaps: adds whose element or relationship the base already
   * has, deletes of what the base no longer has, and (with a base index) elements the plan updates
   * or deletes whose base content changed since the plan was created.
   */
  overlapping: {
    elements: Array<{ id: string; reason: "already-in-base" | "already-removed" | "changed-in-base" }>;
    relationships: Array<RelationshipRef & { reason: "already-in-base" | "already-removed" }>;
  };
  /** What changed in the base since the changeset was created; needs a base index. */
  baseChanges?: {
    counts: {
      elementsAdded: number;
      elementsRemoved: number;
      elementsChanged: number;
      relationshipsAdded: number;
      relationshipsRemoved: number;
    };
    elementsAdded: string[];
    elementsRemoved: string[];
    elementsChanged: string[];
    relationshipsAdded: RelationshipRef[];
    relationshipsRemoved: RelationshipRef[];
    /** True when a list was cut at DRIFT_LIST_LIMIT entries. */
    truncated: boolean;
  };
}

function indexPath(rootPath: string, changesetId: string): string {
  return path.join(rootPath, "documentation-robotics", "changesets", changesetId, BASE_INDEX_FILE);
}

function contentHash(element: GraphElement): string {
  const content = {
    type: element.type,
    name: element.name,
    description: element.description ?? null,
    attributes: element.attributes ?? {},
    sourceReference: element.sourceReference ?? null,
  };
  return createHash("sha256").update(stableStringify(content)).digest("hex").slice(0, 16);
}

/** The base model (never an active changeset's projection) as a graph with no changes. */
async function baseGraph(model: Model): Promise<ChangesetGraph> {
  const now = new Date().toISOString();
  const empty = new Changeset({
    id: "base",
    name: "base model",
    created: now,
    modified: now,
    status: "committed",
    baseSnapshot: "",
    changes: [],
  });
  return ChangesetGraph.build(model, empty);
}

function indexFromGraph(graph: ChangesetGraph): BaseIndex {
  const elements: Record<string, string> = {};
  for (const element of graph.elements.values()) {
    if (element.status !== "deleted") elements[element.id] = contentHash(element);
  }
  return {
    version: 1,
    captured: new Date().toISOString(),
    elements,
    relationships: graph
      .relationships()
      .filter((r) => r.status !== "deleted")
      .map((r) => relationshipKey(r))
      .sort(),
  };
}

/** Indexes the base model as it is now. */
export async function captureBaseIndex(model: Model): Promise<BaseIndex> {
  return indexFromGraph(await baseGraph(model));
}

/** Records the base index for a changeset that was just created. */
export async function writeBaseIndex(rootPath: string, changesetId: string, index: BaseIndex): Promise<void> {
  await writeFile(indexPath(rootPath, changesetId), JSON.stringify(index), "utf-8");
}

/**
 * Reads a changeset's base index. `undefined` when none was recorded; throws when the file exists
 * but cannot be read, so callers can report it rather than mistake it for "not recorded".
 */
export async function readBaseIndex(rootPath: string, changesetId: string): Promise<BaseIndex | undefined> {
  const file = indexPath(rootPath, changesetId);
  if (!(await fileExists(file))) return undefined;
  const parsed = JSON.parse(await readFile(file, "utf-8")) as Partial<BaseIndex>;
  if (parsed.version !== 1 || typeof parsed.elements !== "object" || !Array.isArray(parsed.relationships)) {
    throw new Error(`${file} is not a base index this version of dr can read`);
  }
  return parsed as BaseIndex;
}

/** Like `readBaseIndex`, but reports an unreadable index as a warning instead of throwing. */
export async function tryReadBaseIndex(
  rootPath: string,
  changesetId: string
): Promise<{ index?: BaseIndex; status: ChangesetDrift["baseIndex"]; warning?: string }> {
  try {
    const index = await readBaseIndex(rootPath, changesetId);
    return index ? { index, status: "recorded" } : { status: "not-recorded" };
  } catch (error) {
    return {
      status: "unreadable",
      warning: `The changeset's base index could not be read (${getErrorMessage(error)}); treating it as not recorded.`,
    };
  }
}

function parseKey(key: string): RelationshipRef {
  const [source, predicate, target] = key.split("::");
  return { source, predicate, target };
}

/**
 * Names how the base model changed under a changeset: staged changes the base now overlaps and,
 * with a base index, what was added, removed or changed in the base since the changeset was created.
 *
 * `graph` is the changeset's projected graph; `hash` is the hash-based drift check
 * (`StagingAreaManager.detectDrift`), when it ran.
 */
export async function describeDrift(
  model: Model,
  graph: ChangesetGraph,
  hash?: { isDrifted: boolean; warnings: string[]; baseSnapshotId?: string; currentSnapshotId?: string }
): Promise<ChangesetDrift> {
  const changeset = graph.changeset;
  const warnings = [...(hash?.warnings ?? [])];
  const overlapping: ChangesetDrift["overlapping"] = { elements: [], relationships: [] };

  const inBase = graph.alreadyInBase();
  for (const element of inBase.elements) overlapping.elements.push({ id: element.id, reason: "already-in-base" });
  for (const rel of inBase.relationships) {
    overlapping.relationships.push({ source: rel.source, predicate: rel.predicate, target: rel.target, reason: "already-in-base" });
  }

  // Staged deletes of what the base no longer has.
  const net = new Map<string, "add" | "delete">();
  const elementOps = new Map<string, string>();
  const addedHere = new Set<string>();
  for (const change of changeset.changes) {
    if (change.type === "relationship-add" || change.type === "relationship-delete") {
      const data = (change.type === "relationship-delete" ? (change.before ?? change.after) : change.after) as
        | Partial<RelationshipRef>
        | undefined;
      const [source, predicate, target] =
        data?.source && data.predicate && data.target
          ? [data.source, data.predicate, data.target]
          : change.elementId.split("::");
      if (!source || !predicate || !target) continue;
      const key = relationshipKey({ source: graph.resolve(source), predicate, target: graph.resolve(target) });
      if (change.type === "relationship-add" && !net.has(key)) addedHere.add(key);
      net.set(key, change.type === "relationship-add" ? "add" : "delete");
    } else {
      const id = graph.resolve(change.elementId);
      if (change.type === "add" && !elementOps.has(id)) addedHere.add(id);
      elementOps.set(id, change.type);
    }
  }
  for (const [key, op] of net) {
    if (op !== "delete" || addedHere.has(key)) continue;
    const ref = parseKey(key);
    if (!graph.getRelationship(ref.source, ref.predicate, ref.target)) {
      overlapping.relationships.push({ ...ref, reason: "already-removed" });
    }
  }
  for (const [id, op] of elementOps) {
    if (op === "delete" && !addedHere.has(id) && !graph.getElement(id)) overlapping.elements.push({ id, reason: "already-removed" });
  }

  const read = await tryReadBaseIndex(model.rootPath, changeset.id);
  if (read.warning) warnings.push(read.warning);

  let baseChanges: ChangesetDrift["baseChanges"];
  if (read.index) {
    const then = read.index;
    const now = indexFromGraph(await baseGraph(model));
    const elementsAdded = Object.keys(now.elements).filter((id) => !(id in then.elements)).sort();
    const elementsRemoved = Object.keys(then.elements).filter((id) => !(id in now.elements)).sort();
    const elementsChanged = Object.keys(now.elements)
      .filter((id) => id in then.elements && then.elements[id] !== now.elements[id])
      .sort();
    const thenRels = new Set(then.relationships);
    const nowRels = new Set(now.relationships);
    const relationshipsAdded = now.relationships.filter((k) => !thenRels.has(k));
    const relationshipsRemoved = then.relationships.filter((k) => !nowRels.has(k));

    for (const id of elementsChanged) {
      const op = elementOps.get(id);
      if (op === "update" || op === "delete") overlapping.elements.push({ id, reason: "changed-in-base" });
    }

    const cut = <T>(list: T[]): T[] => list.slice(0, DRIFT_LIST_LIMIT);
    baseChanges = {
      counts: {
        elementsAdded: elementsAdded.length,
        elementsRemoved: elementsRemoved.length,
        elementsChanged: elementsChanged.length,
        relationshipsAdded: relationshipsAdded.length,
        relationshipsRemoved: relationshipsRemoved.length,
      },
      elementsAdded: cut(elementsAdded),
      elementsRemoved: cut(elementsRemoved),
      elementsChanged: cut(elementsChanged),
      relationshipsAdded: cut(relationshipsAdded).map(parseKey),
      relationshipsRemoved: cut(relationshipsRemoved).map(parseKey),
      truncated: [elementsAdded, elementsRemoved, elementsChanged, relationshipsAdded, relationshipsRemoved].some(
        (l) => l.length > DRIFT_LIST_LIMIT
      ),
    };
  } else if (read.status === "not-recorded" && (hash?.isDrifted || overlapping.elements.length + overlapping.relationships.length > 0)) {
    warnings.push(
      "No base index was recorded for this changeset (it predates them), so what changed in the base cannot be " +
        "listed beyond the staged changes it overlaps."
    );
  }

  const baseChanged =
    !!baseChanges &&
    Object.values(baseChanges.counts).some((n) => n > 0);
  const overlapCount = overlapping.elements.length + overlapping.relationships.length;
  const isDrifted = (hash?.isDrifted ?? false) || baseChanged || overlapCount > 0;
  if (overlapCount > 0) {
    warnings.push(
      `The base now overlaps ${overlapCount} staged change(s): ` +
        [
          ...overlapping.elements.map((e) => `${e.id} (${e.reason})`),
          ...overlapping.relationships.map((r) => `${r.source} --${r.predicate}--> ${r.target} (${r.reason})`),
        ]
          .slice(0, 10)
          .join(", ") +
        (overlapCount > 10 ? ", ..." : "")
    );
  }

  return {
    isDrifted,
    warnings,
    ...(hash?.baseSnapshotId ? { baseSnapshotId: hash.baseSnapshotId } : {}),
    ...(hash?.currentSnapshotId ? { currentSnapshotId: hash.currentSnapshotId } : {}),
    baseIndex: read.status,
    overlapping,
    ...(baseChanges ? { baseChanges } : {}),
  };
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}
