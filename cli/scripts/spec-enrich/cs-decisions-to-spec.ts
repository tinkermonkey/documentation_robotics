/**
 * Write a decided Context Studio proposal into the spec sources.
 *
 *   bun cs-decisions-to-spec.ts --changes <file> [--spec-dir <dir>] [--dry-run] [--allow-stale]
 *
 * `--changes` is Context Studio's `cs-dr-spec-changes/1` export of one decided change proposal
 * (`local-server/scripts/export_dr_spec_changes.py PROPOSAL_ID OUT.json`). It covers every
 * applied operation on a DR relationship type, node type (class) or node attribute, whatever
 * made the proposal (MCP, the review UI, a DR reflection plan):
 *
 *   {format: "cs-dr-spec-changes/1", proposal_id, title,
 *    source_revision?: {repo, commit, spec_version},   the spec the proposal was drafted against
 *    landed?: {repo, commit, spec_version, landed_at}, set once DR marked it landed (cs-landed.ts)
 *    changes: [{                      relationship types
 *     seq, op_id, op: create | update | delete,
 *     relationship_id,               the triple after the change (a delete: the one removed)
 *     previous_relationship_id?,     an update whose triple changed
 *     identifier, predicate, source_spec_node_id, destination_spec_node_id,
 *     set: {description?, cardinality?, strength?, evidence?},   only what the decision changed
 *     replacement_relationship_id?   a delete whose model relationships moved to another type
 *    }],
 *    node_changes?: [{                node types (context-studio#1462)
 *     seq, op_id, op: create | update | move | delete,
 *     spec_node_id,                  the id after the change (a delete: the one removed)
 *     previous_spec_node_id?,        a move, or an update that changed the DR id
 *     layer_id, identifier,
 *     set: {title?, description?, standard?, evidence?, distinguish?},   a create: title and
 *                                    description required; the last three are x-dr-standard,
 *                                    x-dr-evidence and x-dr-distinguish
 *     replacement_spec_node_id?      a delete whose elements become another type
 *    }],
 *    attribute_changes?: [{           node attributes (context-studio#1461)
 *     seq, op_id, op: create | update | delete, spec_node_id, attribute, identifier,
 *     set: {<JSON Schema keyword>: value | null, required?: boolean}   a create: the whole schema
 *    }],
 *    predicate_changes?: [{           the predicate catalog (context-studio#1481)
 *     seq, op_id, op: create | update, predicate,
 *     set: {description?, inverse?, category?, archimate_alignment?, semantics?}
 *    }],
 *    skipped: [...],
 *    records?: [{                     Context Studio's schema change records (context-studio#1417)
 *     action: rename | create | delete | rename-type | retire-predicate,
 *     kind, from, to, swap, p, proposal_id, operation_id, applied_at, note?
 *    }]}
 *
 * All changes apply in seq order, each building on the earlier ones, to spec/schemas and
 * spec/layers (never spec/dist or cli/src/schemas/bundled; the build regenerates those):
 *
 * Relationship types (spec/schemas/relationships):
 *   create   write a schema in the sibling files' shape: title "Source predicate Destination",
 *            `set` values, cardinality many-to-many and strength medium unless set, x-dr-evidence
 *            last when there is any
 *   update   same triple: change the `set` values in place (an empty evidence list removes
 *            x-dr-evidence). New triple: write the new schema derived from the old one, as
 *            apply-walk.ts does (a boilerplate description follows the triple; a reversal drops
 *            the old evidence), then the `set` values, and remove the old schema
 *   delete   remove the schema
 *
 * Node types (spec/schemas/nodes, the layer file's node_types):
 *   create   write a node schema with the title, description, x-dr-* values and no attributes;
 *            an x-dr-* value the create doesn't give is listed to write by hand
 *   update   set the values in place (null, or an empty evidence list, removes an x-dr-* key);
 *            x-dr-distinguish keys must name node types the export leaves
 *   move     (or an update with previous_spec_node_id) write the schema under its new id, and
 *            rename every relationship schema naming the type and every x-dr-distinguish key
 *            citing it. The export doesn't list those relationship renames; a relationship
 *            change that names the type by its old or new id is read as naming it now
 *   delete   remove the schema. No relationship schema may name the type once the export is
 *            applied, so the proposal must delete or retarget them too
 *
 * Attributes (the node schema's properties.attributes): create (the whole property schema),
 * update (the keywords given; null removes one) and delete; `required` is membership of the
 * node's required list.
 *
 * Predicates (schemas/base/predicates.json): create and update, checked against the predicate
 * catalog's schema. Relationship changes in the export may use a predicate it creates.
 *
 * A `retire-predicate` record removes the predicate from schemas/base/predicates.json, once no
 * relationship schema uses it after the export's changes.
 *
 * Every relationship rename, create and delete, node-type rename (a move, or a delete with a
 * replacement) and predicate retirement is recorded in data/cs-decisions/applied-cs-<proposal>.json,
 * in apply-walk.ts's record shape, which generate-relationship-migration.ts reads for `dr upgrade`.
 * Relationship actions name node types as they were before the export, and come first; the
 * rename-type actions follow them, then the predicate retirements, so the generator re-keys them.
 *
 * When the export carries relationship `records` (rename, create or delete), they are the
 * relationship actions: Context Studio read them from what each operation did as it applied, so a
 * retarget whose model relationships Context Studio moved to another type is a delete with `to:
 * <that type>` (plus a create), not a dropped one. They are checked against the changes (the same
 * triples removed and written), and a `to` must link the same pair or the reverse (the only kind
 * the generator migrates) and still be in the spec, or be removed by a later record of the export
 * (a chain the generator folds). `rename-type` records are checked the same way against the node
 * changes' moves and replaced deletes.
 *
 * Without those records (an older export, or Context Studio made no record for an operation
 * applied before it recorded type changes), the actions are derived from the changes: an update
 * that keeps the source and destination pair (or reverses it) is a rename; one that changes a type
 * is a retarget, recorded as a delete with `to: null` plus a create; a delete whose replacement
 * links the same pair carries it as `to`, otherwise `to: null` (dropped). Value-only updates need
 * no migration and are not recorded as actions.
 *
 * Every change is checked (node types, predicate, files, values) before anything is written, so
 * it never stops half-way. When the export names the spec revision it was drafted against, the
 * files it touches must not have changed since that commit (it is rebased onto the current spec
 * when they haven't); --allow-stale lands it anyway. The written JSON is formatted with the repo's
 * prettier, and the layer-skill lines citing a removed or renamed triple or node type are listed
 * (not edited). Afterwards: npm run build:spec (repo root), cd cli && npm run build, bun
 * scripts/generate-relationship-migration.ts (and --check), npm run check:skill-relationships.
 *
 * Same, reversed or different pair is lib/triples.ts's pairOf, the rule apply-walk.ts and
 * Context Studio's delete replacements (tinkermonkey/context-studio#1398) use.
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { flagStr, parseFlags } from "../classify-eval/lib/io.js";
import { harnessDir } from "./lib/paths.js";
import { specDir as defaultSpecDir } from "./lib/schemas.js";
import { pairOf, parts as tripleParts } from "./lib/triples.js";
import { predicateMap, SpecState, type Json } from "./lib/spec-state.js";
import { planPredicateChange, type PredicateChange } from "./lib/cs-predicate-changes.js";
import {
  currentNode,
  finalNodeIds,
  planAttributeChange,
  planNodeChange,
  type AttributeChange,
  type NodeChange,
  type NodeContext,
  type TypeAction,
} from "./lib/cs-node-changes.js";

export type { AttributeChange, NodeChange } from "./lib/cs-node-changes.js";
export type { PredicateChange } from "./lib/cs-predicate-changes.js";

export const FORMAT = "cs-dr-spec-changes/1";
const CARDINALITIES = ["one-to-one", "one-to-many", "many-to-one", "many-to-many"];
const STRENGTHS = ["critical", "high", "medium", "low"];
const RELATIONSHIP_ACTIONS = ["rename", "create", "delete"];

export interface SpecValues {
  description?: string;
  cardinality?: string | null;
  strength?: string | null;
  evidence?: string[];
}

export interface SpecChange {
  seq: number;
  op_id?: string;
  op: "create" | "update" | "delete";
  relationship_id: string;
  previous_relationship_id?: string;
  identifier?: string | null;
  predicate: string;
  source_spec_node_id: string;
  destination_spec_node_id: string;
  set: SpecValues;
  replacement_relationship_id?: string;
}

/** One of Context Studio's schema change records, as a change-record action. */
export interface CsRecord {
  action: "rename" | "create" | "delete" | "rename-type" | "retire-predicate";
  kind: string;
  from: string;
  to: string | null;
  swap?: boolean;
  p?: number;
  proposal_id?: string;
  operation_id?: string;
  applied_at?: string | null;
  note?: string;
}

/** The spec revision a proposal was drafted against (context-studio#1463). */
export interface SourceRevision {
  repo?: string | null;
  commit?: string | null;
  spec_version?: string | null;
}

export interface SpecChanges {
  format: string;
  proposal_id: string;
  title?: string;
  source_revision?: SourceRevision | null;
  /** where the proposal already landed, once marked (context-studio#1463) */
  landed?: (SourceRevision & { landed_at?: string | null }) | null;
  changes: SpecChange[];
  node_changes?: NodeChange[];
  attribute_changes?: AttributeChange[];
  predicate_changes?: PredicateChange[];
  skipped?: Array<Record<string, unknown>>;
  records?: CsRecord[];
}

export interface Action {
  action: "rename" | "create" | "delete" | "rename-type" | "retire-predicate";
  kind: string;
  from: string;
  to: string | null;
  p: number;
  claims: string[];
  note: string;
  file_removed?: string;
  file_written?: string;
}

export interface Plan {
  writes: Array<{ file: string; schema: Record<string, unknown> }>;
  removes: string[];
  actions: Action[];
  /** one line per change, for the console */
  summary: string[];
  /** what the person landing it still has to do or know */
  warnings: string[];
}

/** A triple's parts, refusing an id that is not a well-formed triple. */
const parts = (id: string) => {
  const p = id.split(".");
  if (p.length !== 5 || p.some((s) => !s)) throw new Error(`'${id}' is not a {source}.{predicate}.{destination} triple`);
  return tripleParts(id);
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const boilerplate = (id: string) => {
  const t = parts(id);
  return `Defines relationship: ${t.source} ${t.predicate} ${t.destination}`;
};

/** Where a new schema for `id` goes: <source layer>/<source type>.<predicate>.<destination type>. */
export function schemaPath(spec: string, id: string): string {
  const t = parts(id);
  return path.join(spec, "schemas", "relationships", t.sourceLayer, `${t.sourceType}.${t.predicate}.${t.destType}.relationship.schema.json`);
}

/** A new schema, keys in the sibling files' order. */
export function newSchema(id: string, values: SpecValues): Record<string, unknown> {
  const t = parts(id);
  const schema: Record<string, unknown> = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: `${cap(t.sourceType)} ${t.predicate} ${cap(t.destType)}`,
    description: values.description ?? boilerplate(id),
    allOf: [{ $ref: "../../base/spec-node-relationship.schema.json" }],
    properties: {
      id: { const: id },
      source_spec_node_id: { const: t.source },
      source_layer: { const: t.sourceLayer },
      destination_spec_node_id: { const: t.destination },
      destination_layer: { const: t.destLayer },
      predicate: { const: t.predicate },
      cardinality: { const: values.cardinality ?? "many-to-many" },
      strength: { const: values.strength ?? "medium" },
    },
  };
  if (values.evidence?.length) schema["x-dr-evidence"] = values.evidence;
  return schema;
}

/** A schema for `newId` derived from `old`, as apply-reflect-plan.ts's writeDerived derives one. */
function derived(old: Json, newId: string, swapped: boolean): Json {
  const s = structuredClone(old);
  const t = parts(newId);
  s.title = `${cap(t.sourceType)} ${t.predicate} ${cap(t.destType)}`;
  if (typeof s.description !== "string" || /^Defines relationship: /.test(s.description) || swapped) s.description = boilerplate(newId);
  if (swapped) delete s["x-dr-evidence"];
  s.properties.id.const = newId;
  s.properties.source_spec_node_id.const = t.source;
  s.properties.source_layer.const = t.sourceLayer;
  s.properties.destination_spec_node_id.const = t.destination;
  s.properties.destination_layer.const = t.destLayer;
  s.properties.predicate.const = t.predicate;
  return s;
}

/** Set the decision's values on a schema, in place; existing keys keep their position. */
function withValues(s: Json, values: SpecValues): Json {
  if (values.description !== undefined) s.description = values.description;
  if (values.cardinality) s.properties.cardinality = { const: values.cardinality };
  if (values.strength) s.properties.strength = { const: values.strength };
  if (values.evidence !== undefined) {
    if (values.evidence.length) s["x-dr-evidence"] = values.evidence;
    else delete s["x-dr-evidence"];
  }
  return s;
}

function valueProblems(c: SpecChange): string[] {
  const problems: string[] = [];
  const v = c.set ?? {};
  if (v.cardinality === null || v.strength === null) problems.push("removes cardinality or strength, which every schema carries");
  if (v.cardinality && !CARDINALITIES.includes(v.cardinality)) problems.push(`cardinality '${v.cardinality}' is not one of ${CARDINALITIES.join(", ")}`);
  if (v.strength && !STRENGTHS.includes(v.strength)) problems.push(`strength '${v.strength}' is not one of ${STRENGTHS.join(", ")}`);
  if (v.evidence !== undefined && (!Array.isArray(v.evidence) || v.evidence.some((e) => typeof e !== "string"))) problems.push("evidence is not a list of strings");
  if (v.description !== undefined && typeof v.description !== "string") problems.push("description is not a string");
  return problems;
}

type Entry = { seq: number; order: number } & (
  | { entity: "relationship"; c: SpecChange }
  | { entity: "node"; c: NodeChange }
  | { entity: "attribute"; c: AttributeChange }
  | { entity: "predicate"; c: PredicateChange }
);

/**
 * Work out every file write, removal and migration action for the export, checking each first.
 *
 * @throws Error listing every problem, when any change cannot be applied (nothing is planned)
 */
export function planSpecChanges(doc: SpecChanges, spec: string): Plan {
  if (doc.format !== FORMAT) throw new Error(`not a ${FORMAT} file (format ${JSON.stringify(doc.format)})`);
  const state = new SpecState(spec);
  const rel = (f: string) => state.rel(f);
  const plan: Plan = { writes: [], removes: [], actions: [], summary: [], warnings: [] };
  const errors: string[] = [];
  const nodeChanges = doc.node_changes ?? [];
  const note = (seq: number, what: string) => `Context Studio proposal ${doc.proposal_id} seq ${seq} (${what})`;
  // Every node rename in the export, for checking a type as the export leaves it.
  const allRenames = new Map(nodeChanges.filter((c) => c.previous_spec_node_id && c.previous_spec_node_id !== c.spec_node_id).map((c) => [c.previous_spec_node_id!, c.spec_node_id]));
  const finalNode = (n: string) => currentNode({ renamed: allRenames }, n);
  const finalNodes = finalNodeIds(state.nodeFiles.keys(), nodeChanges);
  // Predicates the export creates may be used by any of its relationship changes.
  const predicateChanges = doc.predicate_changes ?? [];
  const finalPredicates = new Set([...state.predicates, ...predicateChanges.filter((c) => c.op === "create").map((c) => c.predicate)]);
  const ctx: NodeContext = {
    state,
    finalNodes,
    knownNode: (n) => finalNodes.has(finalNode(n)),
    renamed: new Map(),
    origin: new Map(),
    typeActions: [],
    summary: plan.summary,
    warnings: plan.warnings,
    note,
    relationshipPath: (id) => schemaPath(spec, id),
    deriveRelationship: (schema, id) => derived(schema, id, false),
  };
  /** A relationship id with both node types as the export has left them so far. */
  const mapRel = (id: string) => {
    const t = parts(id);
    return `${currentNode(ctx, t.source)}.${t.predicate}.${currentNode(ctx, t.destination)}`;
  };
  const relActions: Action[] = [];

  /**
   * Why the file for `id` can't be written: a schema with that name holds another triple.
   */
  const taken = (id: string, file: string): string => {
    const holder = [...state.relFiles].find(([, f]) => f === file)?.[0];
    if (!holder || holder === id) return `${rel(file)} already exists`;
    const a = parts(holder),
      b = parts(id);
    return (
      `${rel(file)} already holds ${holder}: the file name leaves out the destination layer, ` +
      `and ${a.destType} is in both ${a.destLayer} and ${b.destLayer}`
    );
  };

  const planRelationship = (c: SpecChange) => {
    const label = `seq ${c.seq} ${c.op} ${c.relationship_id}`;
    const problems = valueProblems(c);
    let t;
    try {
      t = parts(c.relationship_id);
      if (c.previous_relationship_id) parts(c.previous_relationship_id);
      if (c.replacement_relationship_id) parts(c.replacement_relationship_id);
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
      return;
    }
    if (t.source !== c.source_spec_node_id || t.predicate !== c.predicate || t.destination !== c.destination_spec_node_id) {
      problems.push("its predicate, source and destination don't match its relationship id");
    }
    if (c.op !== "delete") {
      for (const node of [t.source, t.destination]) if (!ctx.finalNodes.has(finalNode(node))) problems.push(`node type ${node} is not in the spec`);
      if (!finalPredicates.has(t.predicate)) problems.push(`predicate '${t.predicate}' is not in the predicate catalog`);
    }
    const id = mapRel(c.relationship_id);
    const old = c.op === "update" && c.previous_relationship_id ? mapRel(c.previous_relationship_id) : id;
    const replacement = c.replacement_relationship_id ? mapRel(c.replacement_relationship_id) : undefined;
    const oldFile = state.relFiles.get(old);
    if (c.op === "create") {
      if (oldFile) problems.push(`already in the spec (${rel(oldFile)})`);
    } else if (!oldFile) {
      problems.push(`${old} is not in the spec`);
    }
    const renamed = c.op === "update" && old !== id;
    const newFile = c.op === "create" || renamed ? schemaPath(spec, id) : undefined;
    if (renamed && state.relFiles.has(id)) problems.push(`${id} is already in the spec`);
    else if (newFile && state.occupied(newFile)) problems.push(taken(id, newFile));
    if (c.op === "delete" && replacement && !state.relFiles.has(replacement)) {
      problems.push(`its replacement ${c.replacement_relationship_id} is not in the spec`);
    }
    if (problems.length) {
      errors.push(...problems.map((p) => `${label}: ${p}`));
      return;
    }

    if (c.op === "create") {
      state.putRelationship(id, newFile!, newSchema(id, c.set ?? {}));
      relActions.push({ action: "create", kind: "cs:create", from: id, to: id, p: 1, claims: [], note: note(c.seq, "create"), file_written: rel(newFile!) });
      plan.summary.push(`create ${id}`);
    } else if (c.op === "delete") {
      state.dropRelationship(id, oldFile!);
      const to = replacement && pairOf(id, replacement) !== "different" ? replacement : null;
      const why = replacement && !to ? `; replaced by ${replacement}, a different element pair, which a migration cannot apply mechanically, so model relationships of this triple are dropped` : "";
      relActions.push({ action: "delete", kind: "cs:delete", from: id, to, p: 1, claims: [], note: note(c.seq, "delete") + why, file_removed: rel(oldFile!) });
      plan.summary.push(`delete ${id}${to ? ` (relationships move to ${to})` : ""}`);
    } else if (!renamed) {
      state.putRelationship(id, oldFile!, withValues(state.read(oldFile!), c.set ?? {}));
      plan.summary.push(`update ${id}: ${Object.keys(c.set ?? {}).join(", ") || "no spec values changed"}`);
    } else {
      const pair = pairOf(old, id);
      const swapped = pair === "reversed";
      const schema = withValues(derived(state.read(oldFile!), id, swapped), c.set ?? {});
      state.dropRelationship(old, oldFile!);
      state.putRelationship(id, newFile!, schema);
      const files_ = { file_removed: rel(oldFile!), file_written: rel(newFile!) };
      if (pair !== "different") {
        relActions.push({ action: "rename", kind: swapped ? "cs:reverse" : "cs:rename", from: old, to: id, p: 1, claims: [], note: note(c.seq, swapped ? "reverse" : "rename"), ...files_ });
      } else {
        relActions.push({ action: "delete", kind: "cs:retarget", from: old, to: null, p: 1, claims: [], note: `${note(c.seq, "retarget")}; retargeted to ${id}, which a migration cannot apply mechanically, so model relationships of this triple are dropped`, file_removed: files_.file_removed });
        relActions.push({ action: "create", kind: "cs:retarget", from: id, to: id, p: 1, claims: [], note: `retarget of ${old} (${note(c.seq, "retarget")})`, file_written: files_.file_written });
      }
      plan.summary.push(`${swapped ? "reverse" : pair === "same" ? "rename" : "retarget"} ${old} -> ${id}`);
    }
  };

  const entries: Entry[] = [
    ...doc.changes.map((c, order) => ({ seq: c.seq, order, entity: "relationship" as const, c })),
    ...nodeChanges.map((c, order) => ({ seq: c.seq, order, entity: "node" as const, c })),
    ...(doc.attribute_changes ?? []).map((c, order) => ({ seq: c.seq, order, entity: "attribute" as const, c })),
    ...predicateChanges.map((c, order) => ({ seq: c.seq, order, entity: "predicate" as const, c })),
  ].sort((a, b) => a.seq - b.seq || a.order - b.order);
  for (const e of entries) {
    if (e.entity === "relationship") planRelationship(e.c);
    else if (e.entity === "node") {
      const label = `seq ${e.c.seq} ${e.c.op} node type ${e.c.spec_node_id}`;
      errors.push(...planNodeChange(ctx, e.c).map((p) => `${label}: ${p}`));
    } else if (e.entity === "attribute") {
      const label = `seq ${e.c.seq} ${e.c.op} attribute ${e.c.spec_node_id}.${e.c.attribute}`;
      errors.push(...planAttributeChange(ctx, e.c).map((p) => `${label}: ${p}`));
    } else {
      const label = `seq ${e.c.seq} ${e.c.op} predicate ${e.c.predicate}`;
      errors.push(...planPredicateChange(state, e.c, plan.summary).map((p) => `${label}: ${p}`));
    }
  }

  // No relationship schema may name a node type the export removed.
  if (!errors.length) {
    for (const rid of state.relFiles.keys()) {
      const t = parts(rid);
      for (const n of new Set([t.source, t.destination])) {
        if (!state.nodeFiles.has(n)) errors.push(`${rid} names node type ${n}, which is not in the spec once this export is applied; the proposal must delete or retarget it too`);
      }
    }
  }

  // Name relationship actions' node types as they were before the export: the rename-type
  // actions after them re-key them for the migration generator.
  const finalRel = (id: string) => {
    const t = parts(id);
    return `${currentNode(ctx, t.source)}.${t.predicate}.${currentNode(ctx, t.destination)}`;
  };
  const before = (id: string) => {
    const t = parts(finalRel(id));
    return `${ctx.origin.get(t.source) ?? t.source}.${t.predicate}.${ctx.origin.get(t.destination) ?? t.destination}`;
  };
  const normalized = (a: { from: string; to: string | null }) => ({ from: before(a.from), to: a.to === null ? null : before(a.to) });

  const records = doc.records ?? [];
  const relRecords = records.filter((r) => RELATIONSHIP_ACTIONS.includes(r.action));
  const typeRecords = records.filter((r) => r.action === "rename-type");
  const retireRecords = records.filter((r) => r.action === "retire-predicate");
  const unknown = records.filter((r) => ![...RELATIONSHIP_ACTIONS, "rename-type", "retire-predicate"].includes(r.action));
  for (const r of unknown) errors.push(`records: '${r.action}' (${r.from}) is not rename, create, delete, rename-type or retire-predicate`);

  let finalRelActions = relActions.map((a) => ({ ...a, ...normalized(a) }));
  if (!errors.length && relRecords.length) {
    try {
      finalRelActions = recordActions(
        doc,
        relRecords.map((r) => {
          try {
            return { ...r, ...normalized(r) };
          } catch {
            return r; // recordActions reports the malformed id
          }
        }),
        finalRelActions,
        (id) => state.relFiles.has(finalRel(id)),
        plan.summary,
      );
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  let typeActions: Action[] = ctx.typeActions;
  if (!errors.length && typeRecords.length) {
    try {
      typeActions = typeRecordActions(doc, typeRecords, ctx.typeActions);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  const retireActions = errors.length ? [] : planRetirements(doc, retireRecords, state, errors);

  if (errors.length) throw new Error(`nothing written; these changes cannot be applied:\n  ${errors.join("\n  ")}`);
  plan.actions = [...finalRelActions, ...typeActions, ...retireActions];
  plan.writes = [...state.pending].map(([file, schema]) => ({ file, schema }));
  plan.removes = [...state.toRemove];
  return plan;
}

/**
 * `retire-predicate` records: drop each predicate from predicates.json, once no relationship
 * schema uses it. Problems are pushed onto `errors`.
 */
function planRetirements(doc: SpecChanges, records: CsRecord[], state: SpecState, errors: string[]): Action[] {
  const actions: Action[] = [];
  const retired = new Set(records.map((r) => r.from));
  const seqs = opSeqs(doc);
  for (const r of records) {
    const label = `retire-predicate ${r.from}`;
    const problems: string[] = [];
    if (!state.predicates.has(r.from)) problems.push(`'${r.from}' is not in the predicate catalog`);
    if (!r.to) problems.push("it names no replacement predicate");
    else if (!state.predicates.has(r.to) || retired.has(r.to)) problems.push(`its replacement '${r.to}' is not in the predicate catalog once this export is applied`);
    const users = [...state.relFiles.keys()].filter((id) => parts(id).predicate === r.from);
    if (users.length) problems.push(`${users.length} relationship schemas still use it: ${users.slice(0, 10).join(", ")}${users.length > 10 ? ", ..." : ""}`);
    if (problems.length) {
      errors.push(...problems.map((p) => `${label}: ${p}`));
      continue;
    }
    const catalog = state.read(state.predicatesFile);
    delete predicateMap(catalog)[r.from];
    state.write(state.predicatesFile, catalog);
    state.predicates.delete(r.from);
    actions.push({ action: "retire-predicate", kind: r.kind ?? "cs:retire-predicate", from: r.from, to: r.to, p: r.p ?? 1, claims: [], note: recordNote(doc, r, seqs) });
  }
  return actions;
}

const opSeqs = (doc: SpecChanges) =>
  new Map([...doc.changes, ...(doc.node_changes ?? []), ...(doc.attribute_changes ?? []), ...(doc.predicate_changes ?? [])].filter((c) => c.op_id).map((c) => [c.op_id!, c.seq]));

function recordNote(doc: SpecChanges, r: CsRecord, seqs: Map<string, number>): string {
  const seq = r.operation_id ? seqs.get(r.operation_id) : undefined;
  const kind = String(r.kind ?? r.action).replace(/^cs:/, "");
  const where = seq !== undefined ? ` seq ${seq}` : r.operation_id ? ` operation ${r.operation_id}` : "";
  return `Context Studio proposal ${doc.proposal_id}${where} (${kind})${r.note ? `; ${r.note}` : ""}`;
}

/**
 * The export's rename-type records as actions, checked against the node changes' own (the same
 * renames, each from and to), whose files they carry.
 */
function typeRecordActions(doc: SpecChanges, records: CsRecord[], derivedActions: TypeAction[]): Action[] {
  const key = (a: { from: string; to: string | null }) => `${a.from} -> ${a.to}`;
  const want = new Set(derivedActions.map(key));
  const got = new Set(records.map(key));
  if (!sameSet(want, got)) {
    throw new Error(`records: the rename-type records don't match the node changes: the changes rename ${listed(want)}; the records rename ${listed(got)}`);
  }
  const files = new Map(derivedActions.map((a) => [key(a), a]));
  const seqs = opSeqs(doc);
  return records.map((r) => {
    const d = files.get(key(r))!;
    const action: Action = { action: "rename-type", kind: r.kind ?? d.kind, from: r.from, to: r.to, p: r.p ?? 1, claims: [], note: recordNote(doc, r, seqs) };
    if (d.file_removed) action.file_removed = d.file_removed;
    if (d.file_written) action.file_written = d.file_written;
    return action;
  });
}

/** The triples a list of actions removes from the spec and writes to it. */
function triplesOf(actions: Array<Pick<Action, "action" | "from" | "to">>): { removed: Set<string>; written: Set<string> } {
  const removed = new Set<string>();
  const written = new Set<string>();
  for (const a of actions) {
    if (a.action === "create") written.add(a.from);
    else removed.add(a.from);
    if (a.action === "rename" && a.to) written.add(a.to);
  }
  return { removed, written };
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
const listed = (s: Set<string>) => [...s].sort().join(", ") || "none";

/**
 * The export's relationship `records` as change-record actions, checked against the actions
 * derived from its changes, whose files they carry. `inSpec` says whether a triple is in the spec
 * as the changes leave it.
 *
 * @throws Error listing every problem with the records
 */
function recordActions(doc: SpecChanges, records: CsRecord[], derivedActions: Action[], inSpec: (id: string) => boolean, summary: string[]): Action[] {
  const problems: string[] = [];
  const derivedTriples = triplesOf(derivedActions);
  const fromRecords = triplesOf(records);
  if (!sameSet(derivedTriples.removed, fromRecords.removed) || !sameSet(derivedTriples.written, fromRecords.written)) {
    problems.push(
      `they don't match the changes: the changes remove ${listed(derivedTriples.removed)} and write ${listed(derivedTriples.written)}; ` +
        `the records remove ${listed(fromRecords.removed)} and write ${listed(fromRecords.written)}`,
    );
  }
  const seqs = opSeqs(doc);
  const removedFile = new Map(derivedActions.filter((a) => a.file_removed).map((a) => [a.from, a.file_removed!]));
  const writtenFile = new Map<string, string>();
  for (const a of derivedActions) if (a.file_written) writtenFile.set(a.action === "rename" ? a.to! : a.from, a.file_written);

  const actions = records.map((r, i): Action => {
    const label = `record ${i + 1} (${r.action} ${r.from})`;
    let wellFormed = true;
    try {
      parts(r.from);
      if (r.to !== null) parts(r.to);
    } catch (e) {
      problems.push(`${label}: ${(e as Error).message}`);
      wellFormed = false;
    }
    if (typeof r.kind !== "string") problems.push(`${label}: it has no kind`);
    if (r.action === "create" && r.to !== r.from) problems.push(`${label}: a create's to must be its from`);
    else if (r.action === "rename" && !r.to) problems.push(`${label}: a rename needs a to`);
    else if (r.action !== "create" && r.to && wellFormed) {
      if (pairOf(r.from, r.to) === "different") {
        problems.push(`${label}: ${r.to} links a different element pair, which a migration cannot apply mechanically`);
      } else if (r.action === "delete" && !inSpec(r.to) && !records.slice(i + 1).some((later) => later.action !== "create" && later.from === r.to)) {
        problems.push(`${label}: its model relationships move to ${r.to}, which is not in the spec`);
      }
    }
    const action: Action = { action: r.action, kind: r.kind, from: r.from, to: r.to, p: r.p ?? 1, claims: [], note: recordNote(doc, r, seqs) };
    const removed = r.action === "create" ? undefined : removedFile.get(r.from);
    const written = r.action === "create" ? writtenFile.get(r.from) : r.action === "rename" ? writtenFile.get(r.to!) : undefined;
    if (removed) action.file_removed = removed;
    if (written) action.file_written = written;
    return action;
  });
  if (problems.length) throw new Error(`records: ${problems.join("\n  records: ")}`);

  for (const a of actions) {
    if (a.action !== "delete" || !a.to || a.kind !== "cs:retarget") continue;
    const i = summary.findIndex((line) => line.startsWith(`retarget ${a.from} -> `));
    if (i >= 0) summary[i] += ` (relationships move to ${a.to})`;
  }
  return actions;
}

/** Why an export must not land again: Context Studio says it already landed. Null when it hasn't. */
export function alreadyLanded(doc: SpecChanges): string | null {
  const l = doc.landed;
  if (!l?.commit) return null;
  return `proposal ${doc.proposal_id} already landed at ${l.commit.slice(0, 12)}${l.spec_version ? ` (spec ${l.spec_version})` : ""}${l.landed_at ? ` on ${l.landed_at}` : ""}; landing it again would apply it twice. If that landing was wrong, clear it in Context Studio (DELETE /api/proposals/{id}/landed) and export again`;
}

/**
 * Whether the export may land on the spec as it is now. An export names the commit and spec
 * version it was drafted against (context-studio#1463); it is refused when a file it touches
 * changed since that commit, and rebased (landed as it is) when none did.
 */
export function revisionCheck(doc: SpecChanges, plan: Plan, repo: string): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const rev = doc.source_revision;
  const versionFile = path.join(repo, "spec", "VERSION");
  const version = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null;
  if (!rev || (!rev.commit && !rev.spec_version)) {
    notes.push("the export names no source revision, so it is not checked against the spec it was drafted on");
    return { problems, notes };
  }
  if (!rev.commit) {
    if (rev.spec_version && version && rev.spec_version !== version) problems.push(`drafted against spec ${rev.spec_version}, but the spec is ${version}, and the export names no commit to compare files against`);
    return { problems, notes };
  }
  const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (git("cat-file", "-e", `${rev.commit}^{commit}`).status !== 0) {
    problems.push(`drafted against commit ${rev.commit}, which this repository doesn't have (fetch it, or re-export from Context Studio)`);
    return { problems, notes };
  }
  const diff = git("diff", "--name-only", rev.commit, "--", "spec/schemas", "spec/layers");
  if (diff.status !== 0) {
    problems.push(`git diff against ${rev.commit} failed: ${diff.stderr.trim()}`);
    return { problems, notes };
  }
  const changed = new Set(diff.stdout.split("\n").filter(Boolean));
  const untracked = git("ls-files", "--others", "--exclude-standard", "--", "spec/schemas", "spec/layers");
  for (const f of untracked.stdout.split("\n").filter(Boolean)) changed.add(f);
  const touched = [...plan.writes.map((w) => w.file), ...plan.removes].map((f) => path.relative(repo, f));
  const stale = touched.filter((f) => changed.has(f)).sort();
  if (stale.length) {
    problems.push(
      `drafted against ${rev.commit.slice(0, 12)}${rev.spec_version ? ` (spec ${rev.spec_version})` : ""}, and ${stale.length} files it changes have changed since: ${stale.slice(0, 10).join(", ")}${stale.length > 10 ? ", ..." : ""}. Re-export it from Context Studio against the current spec, or check the files and land with --allow-stale`,
    );
  } else if (changed.size) {
    notes.push(`drafted against ${rev.commit.slice(0, 12)}; ${changed.size} spec files changed since, none of them ones this export changes, so it lands on the current spec`);
  }
  return { problems, notes };
}

/** Write a schema with 2-space indentation and a trailing newline, like the sibling files. */
export function schemaText(schema: Record<string, unknown>): string {
  return JSON.stringify(schema, null, 2) + "\n";
}

/** The change record generate-relationship-migration.ts reads (apply-walk.ts's shape). */
export function changeRecord(doc: SpecChanges, plan: Plan, appliedAt: string): Record<string, unknown> {
  const counts: Record<string, number> = { rename: 0, create: 0, delete: 0 };
  for (const a of plan.actions) counts[a.action] = (counts[a.action] ?? 0) + 1;
  const record: Record<string, unknown> = { backend: "context-studio", record: `cs-${doc.proposal_id}`, select: { proposal_id: doc.proposal_id, title: doc.title ?? null }, applied_at: appliedAt, counts, actions: plan.actions };
  if (doc.source_revision) record.source_revision = doc.source_revision;
  return record;
}

export function recordPath(doc: SpecChanges, recordsDir: string = path.join(harnessDir(), "data", "cs-decisions")): string {
  return path.join(recordsDir, `applied-cs-${doc.proposal_id}.json`);
}

/**
 * Apply a plan: writes, then removals, then the change record. The plan was checked whole, but
 * the file I/O is not atomic: a failing write leaves the earlier ones in place, and git is the
 * way back (`git checkout -- spec && git clean -fd spec`).
 */
export function applyPlan(doc: SpecChanges, plan: Plan, recordFile: string, appliedAt = new Date().toISOString()): void {
  for (const w of plan.writes) {
    mkdirSync(path.dirname(w.file), { recursive: true });
    writeFileSync(w.file, schemaText(w.schema));
  }
  for (const f of plan.removes) unlinkSync(f);
  mkdirSync(path.dirname(recordFile), { recursive: true });
  writeFileSync(recordFile, JSON.stringify(changeRecord(doc, plan, appliedAt), null, 2) + "\n");
}

/** Format written JSON with the repo's own prettier, as pre-commit does; a problem, or null. */
export function formatWritten(repo: string, files: string[]): string | null {
  const bin = path.join(repo, "node_modules", ".bin", "prettier");
  if (!existsSync(bin)) return `prettier not found at ${bin}: run it on the written files before committing`;
  const run = spawnSync(bin, ["--write", "--log-level", "warn", ...files], { cwd: repo, encoding: "utf8" });
  return run.status === 0 ? null : `prettier failed: ${run.stderr || run.stdout}`;
}

function skillFiles(repo: string): string[] {
  const root = path.join(repo, "integrations", "claude_code", "skills");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .map((dir) => path.join(root, dir, "SKILL.md"))
    .filter((f) => existsSync(f));
}

/**
 * Lines of the layer skills (integrations/claude_code/skills/<skill>/SKILL.md) that cite one of
 * these triples: a line naming its predicate and both its types (a table row or a
 * `dr relationship add` command). For the person to edit; nothing is changed.
 */
export function skillCitations(repo: string, triples: string[]): string[] {
  const found: string[] = [];
  for (const file of skillFiles(repo)) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (const id of triples) {
      const t = parts(id);
      const predicate = new RegExp(`(^|[^a-z-])${t.predicate}([^a-z-]|$)`);
      lines.forEach((line, i) => {
        const lower = line.toLowerCase();
        if (predicate.test(lower) && lower.includes(t.sourceType) && lower.includes(t.destType)) {
          found.push(`${path.relative(repo, file)}:${i + 1} cites ${id}`);
        }
      });
    }
  }
  return found;
}

/** Lines of the layer skills that name one of these node type ids. For the person to edit. */
export function nodeCitations(repo: string, nodeIds: string[]): string[] {
  const found: string[] = [];
  for (const file of skillFiles(repo)) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (const id of nodeIds) {
      const pattern = new RegExp(`(^|[^a-z.-])${id.replace(/[.-]/g, (c) => `\\${c}`)}([^a-z]|$)`);
      lines.forEach((line, i) => {
        if (pattern.test(line)) found.push(`${path.relative(repo, file)}:${i + 1} cites ${id}`);
      });
    }
  }
  return found;
}

/** One of the export's `skipped` entries, for the console: an operation, or a retirement CS held back. */
export function skippedLine(s: Record<string, unknown>): string {
  const ids = Array.isArray(s.relationship_ids) ? s.relationship_ids : [];
  const what = s.retire_predicate ? `retire-predicate ${s.retire_predicate}` : s.seq != null ? `seq ${s.seq}` : String(s.op_id ?? "?");
  return `${what}: ${s.why ?? JSON.stringify(s)}${ids.length ? ` (${ids.join(", ")})` : ""}`;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const changesFile = flagStr(flags, "changes");
  if (!changesFile) {
    console.error("Usage: bun cs-decisions-to-spec.ts --changes <cs-dr-spec-changes file> [--spec-dir <dir>] [--dry-run] [--allow-stale]");
    process.exit(2);
  }
  const spec = path.resolve(flagStr(flags, "spec-dir") ?? defaultSpecDir());
  const dry = !!flags["dry-run"];
  const doc = JSON.parse(readFileSync(changesFile, "utf8")) as SpecChanges;
  const landedAlready = alreadyLanded(doc);
  if (landedAlready) {
    console.error(`nothing written: ${landedAlready}`);
    process.exit(1);
  }
  let plan: Plan;
  try {
    plan = planSpecChanges(doc, spec);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const repo = path.dirname(spec);
  const revision = revisionCheck(doc, plan, repo);
  for (const line of revision.notes) console.log(`source revision: ${line}`);
  if (revision.problems.length) {
    const lines = revision.problems.map((p) => `  ${p}`).join("\n");
    if (!flags["allow-stale"]) {
      console.error(`nothing written; the export may be stale:\n${lines}`);
      process.exit(1);
    }
    console.error(`landing a possibly stale export (--allow-stale):\n${lines}`);
  }
  const record = recordPath(doc, path.join(repo, "cli", "scripts", "spec-enrich", "data", "cs-decisions"));
  if (existsSync(record) && !dry) {
    console.error(`not written: ${path.relative(process.cwd(), record)} exists, so proposal ${doc.proposal_id} was already applied`);
    process.exit(1);
  }
  if (!dry) {
    applyPlan(doc, plan, record);
    const problem = formatWritten(repo, [...plan.writes.map((w) => w.file), record]);
    if (problem) console.error(problem);
  }
  const total = doc.changes.length + (doc.node_changes?.length ?? 0) + (doc.attribute_changes?.length ?? 0) + (doc.predicate_changes?.length ?? 0);
  console.log(`${dry ? "[dry run] " : ""}${total} changes from Context Studio proposal ${doc.proposal_id}:`);
  for (const line of plan.summary) console.log(`  ${line}`);
  for (const r of plan.actions.filter((a) => a.action === "retire-predicate")) console.log(`  retire predicate ${r.from} (relationships move to ${r.to})`);
  if (doc.skipped?.length) {
    console.log(`not exported by Context Studio (${doc.skipped.length}):`);
    for (const s of doc.skipped) console.log(`  ${skippedLine(s)}`);
  }
  if (plan.warnings.length) {
    console.log("to do by hand:");
    for (const line of plan.warnings) console.log(`  ${line}`);
  }
  const gone = plan.actions.filter((a) => a.action === "rename" || (a.action === "delete" && a.from !== a.to)).map((a) => a.from);
  const typesGone = plan.actions.filter((a) => a.action === "rename-type").map((a) => a.from);
  const citations = [...skillCitations(repo, gone), ...nodeCitations(repo, typesGone)];
  if (citations.length) {
    console.log("layer skill lines citing a removed or renamed triple or node type (edit them; npm run check:skill-relationships checks after the build):");
    for (const line of citations) console.log(`  ${line}`);
  }
  if (!dry) console.log(`recorded ${plan.actions.length} migration actions in ${path.relative(process.cwd(), record)}. Rebuild the spec next.`);
}

if (import.meta.main) main();
