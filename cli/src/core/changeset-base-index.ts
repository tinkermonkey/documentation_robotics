/**
 * Changeset base index — which elements and relationships the base model had when a changeset was
 * created, so later readers can tell what predates the plan and what changed in the base under it.
 *
 * The changeset's `baseSnapshot` is a single hash of the base: it says the base changed, not what
 * changed. The index records each base element's id with a short content hash, and each base
 * relationship's key, in `documentation-robotics/changesets/{id}/base-index.json`. It is written
 * when the changeset is created, and again when it is re-baselined (`StagingAreaManager.rebaseline`).
 * Changesets created before it existed (or imported) have none, and every reader falls back to
 * what it can tell without one and says so. The base hash recorded since CLI 0.7.0 is the hash of
 * this index (`snapshotOfIndex`), so the two never disagree about whether the base changed.
 *
 * Readers:
 * - `changeset_verify` excludes elements that existed before the plan from the candidates for a
 *   planned add (they cannot be its built form).
 * - `changeset_brief` names what changed in the base since the plan was created (`describeDrift`).
 * - A landing reads `describeDrift`'s `overlapping` as its warning: drift never refuses a landing
 *   (#1200), so what overlaps is said where the person confirms, with what landing does about it.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../utils/file-io.js";
import { getErrorMessage } from "../utils/errors.js";
import { Changeset } from "./changeset.js";
import { BaseSnapshotManager, CONTENT_SNAPSHOT_PREFIX, isContentSnapshot } from "./base-snapshot-manager.js";
import { ChangesetGraph, elementFromRecord, relationshipKey, type GraphElement } from "./changeset-graph.js";
import type { Model } from "./model.js";

export const BASE_INDEX_FILE = "base-index.json";

export interface BaseIndex {
  version: 1;
  captured: string;
  /** Element id (dotted path) → short hash of its content. */
  elements: Record<string, string>;
  /** Relationship keys, `source::predicate::target`, endpoints as dotted paths. */
  relationships: string[];
  /**
   * Set when the changeset was re-baselined (`StagingAreaManager.rebaseline`): when it last was,
   * the base hash it had before, and how many times. The landing summary shows it, so the person
   * confirming knows the base changes before then are no longer listed.
   */
  rebaselined?: { at: string; from: string; times: number };
}

export interface RelationshipRef {
  source: string;
  predicate: string;
  target: string;
}

export type ElementOverlapReason =
  | "already-in-base"
  | "already-removed"
  | "changed-in-base"
  | "removed-in-base"
  | "linked-in-base";
export type RelationshipOverlapReason = "already-in-base" | "already-removed" | "endpoint-removed-in-base";

/**
 * What landing does about a staged change the base overlaps, as a sentence for the person
 * confirming, and how the plan resolves it. `lastOp` is the last operation the changeset stages
 * for the element (an element overlap) or relationship.
 */
export function overlapConsequence(
  kind: "element" | "relationship",
  reason: ElementOverlapReason | RelationshipOverlapReason,
  lastOp?: string
): { consequence: string; resolve: string } {
  if (kind === "relationship") {
    switch (reason) {
      case "already-in-base":
        return {
          consequence: "The base already has this relationship; the staged add is skipped.",
          resolve: "Unstage the add, or leave it: nothing is written for it.",
        };
      case "already-removed":
        return lastOp === "add"
          ? {
              consequence: "The base removed this relationship; landing puts it back.",
              resolve: "Unstage the staged changes to it if the base's removal should stand.",
            }
          : {
              consequence: "The base already removed this relationship; the staged delete has nothing to remove.",
              resolve: "Unstage the delete, or leave it: nothing is written for it.",
            };
      default:
        return lastOp === "delete"
          ? {
              consequence: "The base removed an element at an end of this relationship; the staged delete has nothing to remove.",
              resolve: "Unstage the delete, or leave it: nothing is written for it.",
            }
          : {
              consequence:
                "The base removed an element at an end of this relationship; landing writes a relationship to an element that no longer exists, which validation may refuse.",
              resolve: "Unstage the relationship, or point it at the element that replaced the removed one.",
            };
    }
  }
  switch (reason) {
    case "already-in-base":
      return lastOp === "delete"
        ? {
            consequence: "The base gained this element after the plan was made; landing deletes the base's element.",
            resolve: "Unstage the staged changes to it if the base's element should stay.",
          }
        : {
            consequence:
              "The base already has this element; the staged add is skipped and the base's version stands (a later staged update of it still applies).",
            resolve: "Unstage the add, or restage it as an update of the base's element.",
          };
    case "already-removed":
      return {
        consequence: "The base already removed this element; the staged delete has nothing to delete and is skipped.",
        resolve: "Unstage the delete, or leave it: nothing is written for it.",
      };
    case "removed-in-base":
      return lastOp === "add"
        ? {
            consequence: "The base removed this element; landing puts it back.",
            resolve: "Unstage the staged changes to it if the base's removal should stand.",
          }
        : {
            consequence: "The base removed this element; the staged update has nothing to apply to and is reported as failed.",
            resolve: "Unstage the update, or restage the element as an add.",
          };
    case "linked-in-base":
      return {
        consequence: "The base gained a relationship on this element; landing deletes the element and that relationship with it.",
        resolve: "Stage the relationship's delete too if it should go, or unstage the element's delete.",
      };
    default:
      return lastOp === "delete"
        ? {
            consequence: "The base edited this element after the delete was staged; landing deletes it, the base's edit included.",
            resolve: "Unstage the delete and stage it again once the base's edit has been read, or drop it.",
          }
        : {
            consequence:
              "The base edited this element after the plan's change to it was staged; landing replaces the base's edit with the plan's version.",
            resolve: "Unstage the change and stage it again on the element as the base has it now (model_show, then model_update).",
          };
  }
}

/**
 * How many entries each `baseChanges` list carries by default. A default, not a cut-off: pass
 * `limit` and `offset` to `describeDrift` to read further or to read everything, and
 * `baseChanges.page` says what was returned of what there is. The counts are always exact, and the
 * overlaps (`overlapping`) are never shortened.
 */
export const DRIFT_LIST_LIMIT = 50;

/** The names of the `baseChanges` lists, as `baseChanges.page.totals` keys them. */
export type BaseChangeList =
  | "elementsAdded"
  | "elementsRemoved"
  | "elementsChanged"
  | "relationshipsAdded"
  | "relationshipsRemoved";

/**
 * One read of the base model, shared by the drift checks of several changesets: its index, and its
 * hash in each format, made once. Without it every check reads and hashes the base again, which
 * is the cost of a list of changesets (#1227).
 */
export class BaseRead {
  private fullSnapshot: Promise<string> | undefined;
  /** The base's content snapshot (`BaseSnapshotManager.captureSnapshot`). */
  readonly contentSnapshot: string;

  private constructor(
    private readonly model: Model,
    /** The base as it is now, indexed. */
    readonly index: BaseIndex
  ) {
    this.contentSnapshot = snapshotOfIndex(index);
  }

  static async of(model: Model): Promise<BaseRead> {
    return new BaseRead(model, await captureBaseIndex(model));
  }

  /** The base's hash in the format `recorded` was made in (`BaseSnapshotManager.captureSnapshotLike`). */
  async snapshotLike(recorded: string): Promise<string> {
    if (isContentSnapshot(recorded)) return this.contentSnapshot;
    this.fullSnapshot ??= new BaseSnapshotManager().captureFullSnapshot(this.model);
    return this.fullSnapshot;
  }
}

const NO_BASE_INDEX_WARNING =
  "No base index was recorded for this changeset (it predates them), so what changed in the base cannot be " +
  "listed beyond the staged changes it overlaps.";

/**
 * A description made before its reader knew the base had changed (`StagingAreaManager.detectDrift`
 * describes to decide), as it reads once the base is known to have: drifted, and saying that a
 * missing base index leaves the base changes unlisted, as `describeDrift` says when it is told.
 */
export function describedAsDrifted(described: ChangesetDrift): ChangesetDrift {
  const missing = described.baseIndex === "not-recorded" && !described.warnings.includes(NO_BASE_INDEX_WARNING);
  return {
    ...described,
    isDrifted: true,
    warnings: missing ? [...described.warnings, NO_BASE_INDEX_WARNING] : described.warnings,
  };
}

/** What `describeDrift` reads besides the changeset and the model. */
export interface DescribeDriftOptions {
  /** false leaves the one-line summary of `overlapping` out of `warnings`, for a reader that shows `overlapping` itself. */
  overlapWarning?: boolean;
  /** A read of the base to share with other changesets' checks; made here when absent. */
  base?: BaseRead;
  /** How many entries of each `baseChanges` list to return (default DRIFT_LIST_LIMIT; no upper bound). */
  limit?: number;
  /** Where in each `baseChanges` list to start (default 0). */
  offset?: number;
  /**
   * Compare the base with this index instead of the one recorded for the changeset: what the
   * drift would read if this were its base (a re-baseline's preview).
   */
  since?: BaseIndex;
}

export interface ChangesetDrift {
  /** Kept for compatibility: true when the base changed since the changeset was created. */
  isDrifted: boolean;
  warnings: string[];
  baseSnapshotId?: string;
  currentSnapshotId?: string;
  /** Whether a base index was recorded for the changeset; without one, `baseChanges` is absent. */
  baseIndex: "recorded" | "not-recorded" | "unreadable";
  /** Set when the changeset was re-baselined: `baseChanges` then counts from that base, not from its creation. */
  rebaselined?: BaseIndex["rebaselined"];
  /**
   * Staged changes that the base now overlaps, each with what landing does about it
   * (`consequence`) and how to resolve it in the plan (`resolve`):
   * - `already-in-base`: an add of an element or relationship the base already has.
   * - `already-removed`: a delete of what the base no longer has.
   * - `changed-in-base`: any staged change (an update, a delete, a delete then an add) of an
   *   element whose base content is not what that change was staged on. The change's own recorded
   *   `before` decides it, so an update restaged on the current base is not one (#1239), and one
   *   staged on older content still is after a re-baseline. A change that recorded no `before`
   *   falls back to the base index.
   * - `removed-in-base`: an update or recreate of an element the base removed.
   * - `linked-in-base`: a delete of an element the base has since linked (base index needed): the
   *   delete would purge a relationship the plan never saw.
   * - `endpoint-removed-in-base`: a relationship the plan adds or deletes with an end on a base
   *   element that was removed since (`endpoints` names those ends).
   *
   * An edit to an element at a link's end is not an overlap (#1208): the element keeps its id,
   * which carries its layer and type, so the link is as right as it was. `baseChanges` still lists
   * the edit.
   *
   * This is the whole of what a landing warns about for drift (`contentFreeDrift`): a base change
   * that is not listed here is one the changeset was not staged against.
   */
  overlapping: {
    elements: Array<{
      id: string;
      reason: ElementOverlapReason;
      consequence: string;
      resolve: string;
    }>;
    relationships: Array<
      RelationshipRef & {
        reason: RelationshipOverlapReason;
        /** For `endpoint-removed-in-base`: the ends the base removed. */
        endpoints?: string[];
        consequence: string;
        resolve: string;
      }
    >;
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
    /**
     * The layers the base changed in: those of every element added, removed or changed and of both
     * ends of every relationship added or removed. Never cut, so it is whole when the lists are not.
     */
    layers: string[];
    /** True when a list here is not the whole of it: read `page` for what there is and where to go on. */
    truncated: boolean;
    /**
     * What this page of the five lists holds. `totals` is each list's true length (as `counts`),
     * `returned` what this page carries of each, and `nextOffset` the `offset` that continues the
     * lists, absent when every list has been read to its end.
     */
    page: {
      offset: number;
      limit: number;
      totals: Record<BaseChangeList, number>;
      returned: Record<BaseChangeList, number>;
      nextOffset?: number;
    };
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

/**
 * The base hash an index stands for: the content snapshot `BaseSnapshotManager.captureSnapshot`
 * returns. It covers the elements' content hashes and the relationship keys, in a stable order,
 * and not when the index was captured or re-baselined.
 */
export function snapshotOfIndex(index: BaseIndex): string {
  const hash = createHash("sha256");
  for (const id of Object.keys(index.elements).sort()) hash.update(`${id}\t${index.elements[id]}\n`);
  hash.update("\n");
  for (const key of [...index.relationships].sort()) hash.update(`${key}\n`);
  return `${CONTENT_SNAPSHOT_PREFIX}${hash.digest("hex")}`;
}

/** Records the base index for a changeset that was just created or re-baselined. */
export async function writeBaseIndex(rootPath: string, changesetId: string, index: BaseIndex): Promise<void> {
  await writeFile(indexPath(rootPath, changesetId), formatIndex(index), "utf-8");
}

/**
 * The index as prettier and end-of-file-fixer leave JSON (#1155), so committing a changeset in a
 * repo with those hooks doesn't fail once: two-space indent, a final newline, and the relationship
 * list on one line when it fits in 80 columns (prettier keeps objects expanded, not arrays).
 */
export function formatIndex(index: BaseIndex): string {
  const text = JSON.stringify(index, null, 2);
  const inline = `  "relationships": [${index.relationships.map((key) => JSON.stringify(key)).join(", ")}]`;
  if (index.relationships.length > 0 && inline.length <= 80) {
    return text.replace(/ {2}"relationships": \[[\s\S]*\]\n\}$/, `${inline}\n}`) + "\n";
  }
  return text + "\n";
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

/** The layer of an element's dotted id (`{layer}.{type}.{name}`). */
function layerOf(id: string): string {
  return id.split(".")[0];
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
 * (`StagingAreaManager.detectDrift`), when it ran. `overlapping` is always whole. The `baseChanges`
 * lists are a page (`limit`, `offset`; see `baseChanges.page`), with exact counts whatever the page.
 */
export async function describeDrift(
  model: Model,
  graph: ChangesetGraph,
  hash?: { isDrifted: boolean; warnings: string[]; baseSnapshotId?: string; currentSnapshotId?: string },
  options: DescribeDriftOptions = {}
): Promise<ChangesetDrift> {
  const changeset = graph.changeset;
  const warnings = [...(hash?.warnings ?? [])];
  const overlapping: ChangesetDrift["overlapping"] = { elements: [], relationships: [] };

  // What the changeset stages, per element and per relationship. `elementOps` and `net` keep the
  // last op, `addedHere` what the changeset itself first adds, and `staged` every op: a delete
  // followed by an add (a recreate) leaves "add" as the last op, and still deletes the element.
  // `stagedOn` is the element as its first staged change found it (that change's `before`): what
  // the plan's change to the element was made on.
  const net = new Map<string, "add" | "delete">();
  const elementOps = new Map<string, string>();
  const addedHere = new Set<string>();
  const staged = { adds: new Set<string>(), deletes: new Set<string>() };
  const stagedOn = new Map<string, { before?: Record<string, unknown>; layer: string }>();
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
      if (!elementOps.has(id)) {
        if (change.type === "add") addedHere.add(id);
        else stagedOn.set(id, { ...(change.before ? { before: change.before } : {}), layer: change.layerName });
      }
      if (change.type === "add") staged.adds.add(id);
      if (change.type === "delete") staged.deletes.add(id);
      elementOps.set(id, change.type);
    }
  }

  // Each staged change is listed once, under the first reason found for it.
  const listedElements = new Set<string>();
  const flagElement = (id: string, reason: ElementOverlapReason): void => {
    if (listedElements.has(id)) return;
    listedElements.add(id);
    overlapping.elements.push({ id, reason, ...overlapConsequence("element", reason, elementOps.get(id)) });
  };
  const listedRelationships = new Set<string>();
  const flagRelationship = (key: string, reason: RelationshipOverlapReason, endpoints?: string[]): void => {
    if (listedRelationships.has(key)) return;
    listedRelationships.add(key);
    overlapping.relationships.push({
      ...parseKey(key),
      reason,
      ...(endpoints ? { endpoints } : {}),
      ...overlapConsequence("relationship", reason, net.get(key)),
    });
  };

  const inBase = graph.alreadyInBase();
  for (const element of inBase.elements) flagElement(element.id, "already-in-base");
  for (const rel of inBase.relationships) flagRelationship(relationshipKey(rel), "already-in-base");

  // Staged deletes of what the base no longer has.
  for (const [key, op] of net) {
    if (op !== "delete" || addedHere.has(key)) continue;
    const ref = parseKey(key);
    if (!graph.getRelationship(ref.source, ref.predicate, ref.target)) flagRelationship(key, "already-removed");
  }
  for (const [id, op] of elementOps) {
    if (op === "delete" && !addedHere.has(id) && !graph.getElement(id)) flagElement(id, "already-removed");
  }

  // The base as it is now, against what each staged element change was made on. This needs no base
  // index: the change recorded the element as it found it. A change made on the base's current
  // content is current, whatever the base did before it was staged (#1239); one made on other
  // content would replace an edit the plan never saw, also after a re-baseline.
  const now = options.base?.index ?? indexFromGraph(await baseGraph(model));
  const comparedWithBefore = new Set<string>();
  for (const [id, on] of stagedOn) {
    if (!(id in now.elements)) {
      flagElement(id, elementOps.get(id) === "delete" ? "already-removed" : "removed-in-base");
      continue;
    }
    if (!on.before) continue;
    comparedWithBefore.add(id);
    if (contentHash(elementFromRecord(on.before, on.layer, id)) !== now.elements[id]) flagElement(id, "changed-in-base");
  }

  const read: Awaited<ReturnType<typeof tryReadBaseIndex>> = options.since
    ? { index: options.since, status: "recorded" }
    : await tryReadBaseIndex(model.rootPath, changeset.id);
  if (read.warning) warnings.push(read.warning);

  let baseChanges: ChangesetDrift["baseChanges"];
  if (read.index) {
    const then = read.index;
    const elementsAdded = Object.keys(now.elements).filter((id) => !(id in then.elements)).sort();
    const elementsRemoved = Object.keys(then.elements).filter((id) => !(id in now.elements)).sort();
    const elementsChanged = Object.keys(now.elements)
      .filter((id) => id in then.elements && then.elements[id] !== now.elements[id])
      .sort();
    const thenRels = new Set(then.relationships);
    const nowRels = new Set(now.relationships);
    const relationshipsAdded = now.relationships.filter((k) => !thenRels.has(k));
    const relationshipsRemoved = then.relationships.filter((k) => !nowRels.has(k));

    // Elements the base changed, removed or gained since, that the changeset stages a change for.
    // Any staged op counts, in any order: after a delete and an add of the same element the last
    // op is "add", and landing it still replaces what the base has now. A change that recorded
    // what it was made on was already compared with the base above; the index decides the rest.
    for (const id of elementsChanged) {
      if (elementOps.has(id) && !comparedWithBefore.has(id)) flagElement(id, "changed-in-base");
    }
    for (const id of elementsRemoved) {
      if (elementOps.has(id)) flagElement(id, elementOps.get(id) === "delete" ? "already-removed" : "removed-in-base");
    }
    // An add of an element the base gained since, also one the changeset deletes again: landing
    // the delete would remove the base's element.
    for (const id of elementsAdded) {
      if (staged.adds.has(id)) flagElement(id, "already-in-base");
    }
    // A staged delete purges every relationship on the element when it lands, also one the base
    // gained since, which the changeset never saw (unless it stages that relationship's delete).
    for (const key of relationshipsAdded) {
      if (net.get(key) === "delete") continue;
      const ref = parseKey(key);
      for (const id of new Set([ref.source, ref.target])) {
        if (staged.deletes.has(id)) flagElement(id, "linked-in-base");
      }
    }

    // A relationship the changeset stages a change for that the base removed since, whatever the
    // last op: re-adding it after a delete would put back what the base took out.
    for (const key of net.keys()) {
      if (thenRels.has(key) && !nowRels.has(key)) flagRelationship(key, "already-removed");
    }

    // The plan's links into base elements that went away since. An end the base only edited is not
    // an overlap (#1208): it keeps its id, and with it its layer and type, so the link is as right
    // as it was when it was staged.
    const removedSet = new Set(elementsRemoved);
    for (const key of net.keys()) {
      if (listedRelationships.has(key)) continue;
      const ref = parseKey(key);
      const ends = [ref.source, ref.target].filter((id, i, all) => all.indexOf(id) === i);
      // An end the projection has no element for, on a relationship the changeset adds, while the
      // base lost elements: a row that names the removed element by an id only it could resolve.
      const dangling = (id: string): boolean =>
        net.get(key) === "add" && removedSet.size > 0 && !id.startsWith("@") && !graph.getElement(id);
      const removed = ends.filter((id) => (removedSet.has(id) && !addedHere.has(id)) || dangling(id));
      if (removed.length > 0) flagRelationship(key, "endpoint-removed-in-base", removed);
    }

    // The lists are a page of what changed; the counts, the layers and the overlaps above are
    // computed over all of it, whatever the page.
    const limit = options.limit !== undefined && options.limit > 0 ? Math.floor(options.limit) : DRIFT_LIST_LIMIT;
    const offset = options.offset !== undefined && options.offset > 0 ? Math.floor(options.offset) : 0;
    const cut = <T>(list: T[]): T[] => list.slice(offset, offset + limit);
    const lists = { elementsAdded, elementsRemoved, elementsChanged, relationshipsAdded, relationshipsRemoved };
    const names = Object.keys(lists) as BaseChangeList[];
    const totals = Object.fromEntries(names.map((name) => [name, lists[name].length])) as Record<BaseChangeList, number>;
    const returned = Object.fromEntries(names.map((name) => [name, cut(lists[name]).length])) as Record<BaseChangeList, number>;
    const more = names.some((name) => lists[name].length > offset + limit);
    const layers = new Set<string>();
    for (const id of [...elementsAdded, ...elementsRemoved, ...elementsChanged]) layers.add(layerOf(id));
    for (const key of [...relationshipsAdded, ...relationshipsRemoved]) {
      const ref = parseKey(key);
      layers.add(layerOf(ref.source));
      layers.add(layerOf(ref.target));
    }
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
      layers: [...layers].sort(),
      truncated: names.some((name) => returned[name] < totals[name]),
      page: { offset, limit, totals, returned, ...(more ? { nextOffset: offset + limit } : {}) },
    };
  } else if (read.status === "not-recorded" && (hash?.isDrifted || overlapping.elements.length + overlapping.relationships.length > 0)) {
    warnings.push(NO_BASE_INDEX_WARNING);
  }

  const baseChanged =
    !!baseChanges &&
    Object.values(baseChanges.counts).some((n) => n > 0);
  const overlapCount = overlapping.elements.length + overlapping.relationships.length;
  const isDrifted = (hash?.isDrifted ?? false) || baseChanged || overlapCount > 0;
  if (overlapCount > 0 && options.overlapWarning !== false) {
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
    ...(read.index?.rebaselined ? { rebaselined: read.index.rebaselined } : {}),
    overlapping,
    ...(baseChanges ? { baseChanges } : {}),
  };
}

/**
 * Whether a changeset whose base hash no longer matches drifted only in content it wasn't staged
 * against: landing one changeset changes every other one's base hash, whether or not it touched
 * anything they stage (#1169).
 *
 * Content-free means the changeset's base index is recorded and the base overlaps none of its
 * staged changes (`describeDrift`'s `overlapping`). Any other change to the base since (another
 * plan landing that adds, edits or removes other elements and relationships, an edit to an element
 * the changeset only links to) doesn't count: it is not what this changeset was staged against.
 * Returns the sentence to report when content-free, otherwise undefined (without a base index, the
 * change can't be told apart from an overlapping one).
 */
export async function contentFreeDrift(model: Model, changeset: Changeset): Promise<string | undefined> {
  return contentFreeSentence(await describeDrift(model, await ChangesetGraph.build(model, changeset)));
}

/** `contentFreeDrift`'s answer for a drift already described. */
export function contentFreeSentence(drift: ChangesetDrift): string | undefined {
  if (drift.baseIndex !== "recorded" || !drift.baseChanges) return undefined;
  if (drift.overlapping.elements.length + drift.overlapping.relationships.length > 0) return undefined;
  const { counts } = drift.baseChanges;
  const parts = (
    [
      [counts.elementsAdded, "element(s) added"],
      [counts.elementsChanged, "element(s) changed"],
      [counts.elementsRemoved, "element(s) removed"],
      [counts.relationshipsAdded, "relationship(s) added"],
      [counts.relationshipsRemoved, "relationship(s) removed"],
    ] as Array<[number, string]>
  )
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`);
  const since =
    parts.length > 0
      ? ` In the base since: ${parts.join(", ")}, none of them overlapping a staged change.`
      : " No element or relationship in the base changed.";
  return (
    "The base model changed since this changeset was created, but nothing it stages overlaps the change, so " +
    `landing it raises no drift warning.${since}`
  );
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
