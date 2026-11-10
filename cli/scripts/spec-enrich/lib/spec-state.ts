/**
 * The spec sources as a set of planned edits leaves them: which relationship schema, node schema
 * and layer file holds what, with every planned write and removal held in memory until the plan
 * is applied. cs-decisions-to-spec.ts builds one per export so later changes build on earlier ones.
 */
import path from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";

export type Json = Record<string, any>;

/** {layer}.{type}, the shape of every spec node id (no digits, no further dots). */
export const NODE_ID = /^[a-z-]+\.[a-z]+$/;

export const splitNode = (id: string) => {
  const dot = id.indexOf(".");
  return { layer: id.slice(0, dot), type: id.slice(dot + 1) };
};

export class SpecState {
  /** relationship id -> schema file */
  readonly relFiles = new Map<string, string>();
  /** spec node id -> schema file */
  readonly nodeFiles = new Map<string, string>();
  /** layer id -> spec/layers/NN-layer.layer.json */
  readonly layerFiles = new Map<string, string>();
  readonly predicates: Set<string>;
  readonly predicatesFile: string;
  /** planned content by file, in planning order */
  readonly pending = new Map<string, Json>();
  readonly toRemove = new Set<string>();

  constructor(readonly spec: string) {
    const relRoot = path.join(spec, "schemas", "relationships");
    for (const layer of readdirSync(relRoot, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const fn of readdirSync(path.join(relRoot, layer.name)).filter((f) => f.endsWith(".relationship.schema.json"))) {
        const file = path.join(relRoot, layer.name, fn);
        const raw = JSON.parse(readFileSync(file, "utf8")) as { properties?: { id?: { const?: string } } };
        if (raw.properties?.id?.const) this.relFiles.set(raw.properties.id.const, file);
      }
    }
    const nodeRoot = path.join(spec, "schemas", "nodes");
    for (const layer of readdirSync(nodeRoot, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const fn of readdirSync(path.join(nodeRoot, layer.name)).filter((f) => f.endsWith(".node.schema.json"))) {
        const file = path.join(nodeRoot, layer.name, fn);
        const raw = JSON.parse(readFileSync(file, "utf8")) as { properties?: { spec_node_id?: { const?: string } } };
        if (raw.properties?.spec_node_id?.const) this.nodeFiles.set(raw.properties.spec_node_id.const, file);
      }
    }
    const layerRoot = path.join(spec, "layers");
    if (existsSync(layerRoot)) {
      for (const fn of readdirSync(layerRoot).filter((f) => f.endsWith(".layer.json"))) {
        const file = path.join(layerRoot, fn);
        const raw = JSON.parse(readFileSync(file, "utf8")) as { id?: string };
        if (raw.id) this.layerFiles.set(raw.id, file);
      }
    }
    this.predicatesFile = path.join(spec, "schemas", "base", "predicates.json");
    this.predicates = new Set(Object.keys(predicateMap(JSON.parse(readFileSync(this.predicatesFile, "utf8")))));
  }

  /** A path relative to the repository root, for messages and change records. */
  rel(file: string): string {
    return path.relative(path.dirname(this.spec), file);
  }

  /** Whether a file exists once the planned edits are made. */
  occupied(file: string): boolean {
    return this.pending.has(file) || (existsSync(file) && !this.toRemove.has(file));
  }

  /** A file's content as planned so far (a copy of the disk content on first read). */
  read(file: string): Json {
    const planned = this.pending.get(file);
    if (planned) return planned;
    return JSON.parse(readFileSync(file, "utf8"));
  }

  write(file: string, content: Json): void {
    this.pending.set(file, content);
    this.toRemove.delete(file);
  }

  remove(file: string): void {
    this.pending.delete(file);
    if (existsSync(file)) this.toRemove.add(file);
  }

  putRelationship(id: string, file: string, schema: Json): void {
    this.relFiles.set(id, file);
    this.write(file, schema);
  }

  dropRelationship(id: string, file: string): void {
    this.relFiles.delete(id);
    this.remove(file);
  }

  putNode(id: string, file: string, schema: Json): void {
    this.nodeFiles.set(id, file);
    this.write(file, schema);
  }

  dropNode(id: string, file: string): void {
    this.nodeFiles.delete(id);
    this.remove(file);
  }

  /** Add or remove a node id in its layer file's node_types, keeping a sorted list sorted. */
  editLayerNodeTypes(layer: string, add: string | null, removeId: string | null): void {
    const file = this.layerFiles.get(layer);
    if (!file) return;
    const content = this.read(file);
    const list: string[] = Array.isArray(content.node_types) ? [...content.node_types] : [];
    const sorted = list.every((v, i) => i === 0 || list[i - 1] <= v);
    let next = removeId ? list.filter((v) => v !== removeId) : list;
    if (add && !next.includes(add)) next = sorted ? [...next, add].sort() : [...next, add];
    content.node_types = next;
    this.write(file, content);
  }
}

/** predicates.json holds {predicates: {...}}; an older shape is the map itself. */
export function predicateMap(catalog: Json): Json {
  return (catalog.predicates ?? catalog) as Json;
}
