/**
 * Context Studio's class (node type) and attribute operations from a cs-dr-spec-changes/1
 * export, planned onto a SpecState. cs-decisions-to-spec.ts calls these in seq order, between
 * the relationship-type changes; the shapes were agreed with Context Studio on
 * tinkermonkey/context-studio#1462 (node_changes) and #1461 (attribute_changes).
 */
import path from "node:path";
import { NODE_ID, SpecState, splitNode, type Json } from "./spec-state.js";

export interface NodeValues {
  title?: string;
  description?: string;
}

/** One class operation (`node_changes`). */
export interface NodeChange {
  seq: number;
  op_id?: string;
  op: "create" | "update" | "move" | "delete";
  /** the id after the operation; for a delete, the one removed */
  spec_node_id: string;
  /** a move, or an update that changed the class's DR id */
  previous_spec_node_id?: string | null;
  /** the layer after the operation */
  layer_id?: string;
  identifier?: string | null;
  set?: NodeValues;
  /** delete only: the type whose elements take over the deleted type's */
  replacement_spec_node_id?: string | null;
  note?: string;
  decided_at?: string | null;
  decided_by?: string | null;
}

export interface AttributeValues {
  /** a JSON Schema type */
  datatype?: string;
  is_required?: boolean;
  /** the enum; null or [] removes it */
  allowed_values?: Array<string | number | boolean> | null;
  description?: string;
}

/** One attribute operation (`attribute_changes`), keyed by DR attribute name. */
export interface AttributeChange {
  seq: number;
  op_id?: string;
  op: "create" | "update" | "delete";
  spec_node_id: string;
  attribute: string;
  /** an update that renamed the attribute */
  previous_attribute?: string | null;
  set?: AttributeValues;
  decided_at?: string | null;
  decided_by?: string | null;
}

export const DATATYPES = ["string", "boolean", "integer", "number", "array", "object"];
const ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A node-type migration action: elements of `from` become `to` at `dr upgrade`. */
export interface TypeAction {
  action: "rename-type";
  kind: string;
  from: string;
  to: string;
  p: number;
  claims: string[];
  note: string;
  file_removed?: string;
  file_written?: string;
}

/** What node and attribute planning shares with the rest of the plan. */
export interface NodeContext {
  state: SpecState;
  /** node ids as the whole export leaves them, for checks on relationship changes */
  finalNodes: Set<string>;
  /** node id -> the id a move or rename in this export gave it */
  renamed: Map<string, string>;
  /** current node id -> the id it had before the export */
  origin: Map<string, string>;
  typeActions: TypeAction[];
  summary: string[];
  warnings: string[];
  /** "Context Studio proposal P seq N (what)" */
  note: (seq: number, what: string) => string;
  /** the file a relationship id's schema goes in */
  relationshipPath: (id: string) => string;
  /** a relationship schema for a new id derived from an old one (title, consts, boilerplate) */
  deriveRelationship: (schema: Json, newId: string) => Json;
}

/** Follow a node id through the export's moves and renames so far. */
export function currentNode(ctx: Pick<NodeContext, "renamed">, id: string): string {
  const seen = new Set<string>();
  while (ctx.renamed.has(id) && !seen.has(id)) {
    seen.add(id);
    id = ctx.renamed.get(id)!;
  }
  return id;
}

/** The node ids the export leaves, without checking anything. */
export function finalNodeIds(start: Iterable<string>, changes: NodeChange[]): Set<string> {
  const nodes = new Set(start);
  for (const c of [...changes].sort((a, b) => a.seq - b.seq)) {
    if (c.op === "create") nodes.add(c.spec_node_id);
    else if (c.op === "delete") nodes.delete(c.spec_node_id);
    else if (c.previous_spec_node_id && c.previous_spec_node_id !== c.spec_node_id) {
      nodes.delete(c.previous_spec_node_id);
      nodes.add(c.spec_node_id);
    }
  }
  return nodes;
}

export function nodeSchemaPath(spec: string, id: string): string {
  const { layer, type } = splitNode(id);
  return path.join(spec, "schemas", "nodes", layer, `${type}.node.schema.json`);
}

/** A new node schema, keys in the sibling files' order. */
export function newNodeSchema(id: string, values: NodeValues): Json {
  const { layer, type } = splitNode(id);
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: values.title,
    description: values.description,
    allOf: [{ $ref: "../../base/spec-node.schema.json" }],
    properties: {
      spec_node_id: { const: id },
      layer_id: { const: layer },
      type: { const: type },
      attributes: { type: "object", properties: {}, additionalProperties: false },
    },
  };
}

function nodeValueProblems(v: NodeValues | undefined, creating: boolean): string[] {
  const problems: string[] = [];
  const set = v ?? {};
  for (const key of Object.keys(set)) if (key !== "title" && key !== "description") problems.push(`sets '${key}', which DR has no slot for yet`);
  if (set.title !== undefined && (typeof set.title !== "string" || !set.title.trim())) problems.push("its title is empty or not a string");
  if (set.description !== undefined && (typeof set.description !== "string" || !set.description.trim())) problems.push("its description is empty or not a string");
  if (creating && set.title === undefined) problems.push("a create needs a title");
  if (creating && set.description === undefined) problems.push("a create needs a description");
  return problems;
}

/** Plan one class operation; problems are returned and nothing is planned for it. */
export function planNodeChange(ctx: NodeContext, c: NodeChange): string[] {
  const { state } = ctx;
  const problems: string[] = [];
  const id = c.spec_node_id;
  const previous = c.previous_spec_node_id && c.previous_spec_node_id !== id ? c.previous_spec_node_id : null;
  if (!["create", "update", "move", "delete"].includes(c.op)) return [`'${c.op}' is not create, update, move or delete`];
  for (const n of [id, previous]) if (n && !NODE_ID.test(n)) problems.push(`'${n}' is not a {layer}.{type} spec node id (lowercase letters, a hyphenated layer)`);
  if (problems.length) return problems;
  const layer = splitNode(id).layer;
  if (c.layer_id !== undefined && c.layer_id !== layer) problems.push(`its layer_id '${c.layer_id}' is not the layer of ${id}`);
  if (c.op === "move" && !previous) problems.push("a move needs a previous_spec_node_id other than its spec_node_id");
  if (c.op !== "delete" && c.op !== "update" || previous) {
    if (!state.layerFiles.has(layer)) problems.push(`layer '${layer}' has no spec/layers file`);
  }
  if (c.op !== "delete") problems.push(...nodeValueProblems(c.set, c.op === "create"));

  if (c.op === "create") {
    if (state.nodeFiles.has(id)) problems.push(`${id} is already in the spec (${state.rel(state.nodeFiles.get(id)!)})`);
    else if (state.occupied(nodeSchemaPath(state.spec, id))) problems.push(`${state.rel(nodeSchemaPath(state.spec, id))} already exists`);
    if (problems.length) return problems;
    const file = nodeSchemaPath(state.spec, id);
    state.putNode(id, file, newNodeSchema(id, c.set!));
    state.editLayerNodeTypes(layer, id, null);
    ctx.summary.push(`create node type ${id}`);
    ctx.warnings.push(`${id}: x-dr-standard, x-dr-evidence and x-dr-distinguish are not set (Context Studio has no slot for them yet, context-studio#1467); write them before the spec build`);
    return [];
  }

  if (c.op === "delete") {
    const file = state.nodeFiles.get(id);
    if (!file) problems.push(`${id} is not in the spec`);
    const replacement = c.replacement_spec_node_id ?? null;
    if (replacement && (replacement === id || !ctx.finalNodes.has(replacement))) problems.push(`its replacement ${replacement} is not in the spec once this export is applied`);
    if (problems.length) return problems;
    state.dropNode(id, file!);
    state.editLayerNodeTypes(layer, null, id);
    for (const [other, otherFile] of state.nodeFiles) {
      const distinguish = state.read(otherFile)["x-dr-distinguish"];
      if (distinguish && typeof distinguish === "object" && id in distinguish) {
        ctx.warnings.push(`${state.rel(otherFile)}: x-dr-distinguish (and the description's "Use ... instead" sentence) still names ${id}, which is deleted; edit ${other} by hand`);
      }
    }
    if (replacement) {
      const crossLayer = splitNode(replacement).layer !== layer;
      ctx.typeActions.push({
        action: "rename-type",
        kind: "cs:delete",
        from: id,
        to: replacement,
        p: 1,
        claims: [],
        note: `${ctx.note(c.seq, "delete")}; elements of ${id} become ${replacement}`,
        file_removed: state.rel(file!),
      });
      if (crossLayer) ctx.warnings.push(`${id} -> ${replacement}: dr upgrade cannot move elements to another layer yet, so models with ${id} elements need them moved by hand`);
    }
    ctx.summary.push(`delete node type ${id}${replacement ? ` (elements become ${replacement})` : ""}`);
    return [];
  }

  // update or move
  const from = previous ?? id;
  const file = state.nodeFiles.get(from);
  if (!file) problems.push(`${from} is not in the spec`);
  if (previous) {
    if (state.nodeFiles.has(id)) problems.push(`${id} is already in the spec`);
    else if (state.occupied(nodeSchemaPath(state.spec, id))) problems.push(`${state.rel(nodeSchemaPath(state.spec, id))} already exists`);
  }
  if (problems.length) return problems;
  const schema = state.read(file!);
  if (c.set?.title !== undefined) schema.title = c.set.title;
  if (c.set?.description !== undefined) schema.description = c.set.description;
  if (!previous) {
    state.putNode(id, file!, schema);
    ctx.summary.push(`update node type ${id}: ${Object.keys(c.set ?? {}).join(", ") || "no spec values changed"}`);
    return [];
  }
  return renameNode(ctx, c, from, id, file!, schema);
}

/** Move or rename a node type, and every relationship schema and x-dr-distinguish key naming it. */
function renameNode(ctx: NodeContext, c: NodeChange, from: string, id: string, file: string, schema: Json): string[] {
  const { state } = ctx;
  // Relationship schemas naming the type follow it: check their new files first.
  const moves: Array<{ rid: string; file: string; nid: string; nfile: string }> = [];
  for (const [rid, rfile] of state.relFiles) {
    const [sl, st, pred, dl, dt] = rid.split(".");
    const s = `${sl}.${st}`;
    const d = `${dl}.${dt}`;
    if (s !== from && d !== from) continue;
    const nid = `${s === from ? id : s}.${pred}.${d === from ? id : d}`;
    moves.push({ rid, file: rfile, nid, nfile: ctx.relationshipPath(nid) });
  }
  const leaving = new Set(moves.map((m) => m.file));
  const problems: string[] = [];
  for (const m of moves) {
    if (state.relFiles.has(m.nid)) problems.push(`renaming ${from} turns ${m.rid} into ${m.nid}, which is already in the spec`);
    else if (state.occupied(m.nfile) && !leaving.has(m.nfile)) problems.push(`renaming ${from} turns ${m.rid} into ${m.nid}, but ${state.rel(m.nfile)} already exists`);
  }
  if (problems.length) return problems;

  const { layer, type } = splitNode(id);
  const oldLayer = splitNode(from).layer;
  schema.properties.spec_node_id = { const: id };
  schema.properties.layer_id = { const: layer };
  schema.properties.type = { const: type };
  const newFile = nodeSchemaPath(state.spec, id);
  state.dropNode(from, file);
  state.putNode(id, newFile, schema);
  state.editLayerNodeTypes(oldLayer, null, from);
  state.editLayerNodeTypes(layer, id, null);

  const derived = moves.map((m) => ({ ...m, schema: ctx.deriveRelationship(state.read(m.file), m.nid) }));
  for (const m of derived) state.dropRelationship(m.rid, m.file);
  for (const m of derived) state.putRelationship(m.nid, m.nfile, m.schema);

  for (const [, otherFile] of state.nodeFiles) {
    const other = state.read(otherFile);
    const distinguish = other["x-dr-distinguish"];
    if (!distinguish || typeof distinguish !== "object" || !(from in distinguish)) continue;
    other["x-dr-distinguish"] = Object.fromEntries(Object.entries(distinguish).map(([k, v]) => [k === from ? id : k, v]));
    state.write(otherFile, other);
  }

  ctx.renamed.set(from, id);
  ctx.origin.set(id, ctx.origin.get(from) ?? from);
  const kind = c.op === "move" || oldLayer !== layer ? "move" : "rename";
  ctx.typeActions.push({
    action: "rename-type",
    kind: `cs:${kind}`,
    from,
    to: id,
    p: 1,
    claims: [],
    note: `${ctx.note(c.seq, kind)}; elements of ${from} become ${id}`,
    file_removed: state.rel(file),
    file_written: state.rel(newFile),
  });
  if (oldLayer !== layer) ctx.warnings.push(`${from} -> ${id}: dr upgrade cannot move elements to another layer yet, so models with ${from} elements need them moved by hand`);
  const extra = Object.keys(c.set ?? {});
  ctx.summary.push(`${kind} node type ${from} -> ${id}${moves.length ? ` (${moves.length} relationship schemas follow)` : ""}${extra.length ? `; ${extra.join(", ")}` : ""}`);
  return [];
}

function attributeValueProblems(v: AttributeValues | undefined, creating: boolean): string[] {
  const problems: string[] = [];
  const set = v ?? {};
  for (const key of Object.keys(set)) if (!["datatype", "is_required", "allowed_values", "description"].includes(key)) problems.push(`sets '${key}', which DR has no slot for`);
  if (set.datatype !== undefined && !DATATYPES.includes(set.datatype)) problems.push(`datatype '${set.datatype}' is not one of ${DATATYPES.join(", ")}`);
  if (set.is_required !== undefined && typeof set.is_required !== "boolean") problems.push("is_required is not true or false");
  if (set.allowed_values != null && (!Array.isArray(set.allowed_values) || set.allowed_values.some((x) => !["string", "number", "boolean"].includes(typeof x)))) problems.push("allowed_values is not a list of strings, numbers or booleans");
  if (set.description !== undefined && (typeof set.description !== "string" || !set.description.trim())) problems.push("its description is empty or not a string");
  if (creating && set.datatype === undefined) problems.push("a create needs a datatype");
  if (creating && set.description === undefined) problems.push("a create needs a description");
  return problems;
}

/** Set an attribute's values on its property schema, in place; existing keys keep their position. */
function withAttributeValues(prop: Json, v: AttributeValues): Json {
  if (v.datatype !== undefined) {
    prop.type = v.datatype;
    if (v.datatype !== "array") delete prop.items;
  }
  if (v.description !== undefined) prop.description = v.description;
  if (v.allowed_values !== undefined) {
    if (v.allowed_values?.length) prop.enum = v.allowed_values;
    else delete prop.enum;
  }
  return prop;
}

/** The attributes object with `required` placed after `properties`, removed when empty. */
function withRequired(attributes: Json, required: string[]): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (k === "required") continue;
    out[k] = v;
    if (k === "properties" && required.length) out.required = required;
  }
  return out;
}

/** Plan one attribute operation; problems are returned and nothing is planned for it. */
export function planAttributeChange(ctx: NodeContext, c: AttributeChange): string[] {
  const { state } = ctx;
  if (!["create", "update", "delete"].includes(c.op)) return [`'${c.op}' is not create, update or delete`];
  const node = currentNode(ctx, c.spec_node_id);
  const file = state.nodeFiles.get(node);
  const problems: string[] = [];
  if (!file) problems.push(`node type ${c.spec_node_id} is not in the spec`);
  const name = c.attribute;
  const previous = c.previous_attribute && c.previous_attribute !== name ? c.previous_attribute : null;
  for (const n of [name, previous]) if (n && !ATTRIBUTE_NAME.test(n)) problems.push(`'${n}' is not an attribute name`);
  if (c.op !== "delete") problems.push(...attributeValueProblems(c.set, c.op === "create"));
  if (problems.length) return problems;

  const schema = state.read(file!);
  schema.properties ??= {};
  const attributes: Json = schema.properties.attributes ?? { type: "object", properties: {}, additionalProperties: false };
  const props: Json = attributes.properties ?? {};
  let required: string[] = Array.isArray(attributes.required) ? [...attributes.required] : [];
  const from = previous ?? name;
  if (c.op === "create" && name in props) problems.push(`${node} already has attribute '${name}'`);
  if (c.op !== "create" && !(from in props)) problems.push(`${node} has no attribute '${from}'`);
  if (previous && name in props) problems.push(`${node} already has attribute '${name}'`);
  if (problems.length) return problems;

  let next: Json;
  if (c.op === "create") {
    const v = c.set!;
    const prop: Json = { type: v.datatype, description: v.description };
    if (v.allowed_values?.length) prop.enum = v.allowed_values;
    next = { ...props, [name]: prop };
    if (v.is_required) required.push(name);
    ctx.summary.push(`create attribute ${node}.${name}${v.is_required ? " (required)" : ""}`);
    if (v.is_required) ctx.warnings.push(`${node}.${name} is a new required attribute: existing ${node} elements fail validation until they carry it`);
  } else if (c.op === "delete") {
    next = Object.fromEntries(Object.entries(props).filter(([k]) => k !== from));
    required = required.filter((r) => r !== from);
    ctx.summary.push(`delete attribute ${node}.${from}`);
  } else {
    const prop = withAttributeValues(structuredClone(props[from]), c.set ?? {});
    next = Object.fromEntries(Object.entries(props).map(([k, v]) => (k === from ? [name, prop] : [k, v])));
    if (previous) required = required.map((r) => (r === from ? name : r));
    if (c.set?.is_required === true && !required.includes(name)) {
      required.push(name);
      ctx.warnings.push(`${node}.${name} is now required: existing ${node} elements fail validation until they carry it`);
    }
    if (c.set?.is_required === false) required = required.filter((r) => r !== name);
    if (previous) ctx.warnings.push(`${node}.${from} is renamed to ${name}: dr upgrade does not rename element attributes, so models keep the old name until edited`);
    ctx.summary.push(`update attribute ${node}.${previous ? `${from} -> ${name}` : name}: ${Object.keys(c.set ?? {}).join(", ") || "renamed"}`);
  }
  attributes.properties = next;
  schema.properties.attributes = withRequired(attributes, required);
  state.putNode(node, file!, schema);
  return [];
}
