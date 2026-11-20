/**
 * A DR model read straight from its YAML, as plain data the harness can cut holes in. Relationship
 * ends written as element UUIDs are resolved to element paths.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { layerOf } from "./catalog.js";

export interface Location {
  file: string;
  symbol?: string;
}

export interface El {
  id: string;
  /** Spec node id, `layer.type`. */
  type: string;
  layer: string;
  name: string;
  locations: Location[];
}

export interface Rel {
  source: string;
  predicate: string;
  target: string;
}

export interface Model {
  name: string;
  /** The model directory (…/documentation-robotics/model). */
  dir: string;
  /** The repository the model describes. */
  root: string;
  commit: string;
  elements: Map<string, El>;
  rels: Rel[];
  /** Relationships whose end is not an element of the model (not loaded into `rels`). */
  dangling: number;
}

export const relKey = (r: Rel): string =>
  `${r.source}|${r.predicate}|${r.target}`;

export function loadModel(name: string, dir: string): Model {
  const modelDir = path.resolve(
    dir.replace(/^~(?=\/)/, process.env.HOME ?? "~")
  );
  if (!existsSync(path.join(modelDir, "manifest.yaml")))
    throw new Error(`No manifest.yaml in ${modelDir}`);
  const elements = new Map<string, El>();
  const byUuid = new Map<string, string>();
  for (const layerDir of readdirSync(modelDir)) {
    const full = path.join(modelDir, layerDir);
    if (!statSync(full).isDirectory()) continue;
    for (const file of readdirSync(full).filter((f) => f.endsWith(".yaml"))) {
      const doc = (parse(readFileSync(path.join(full, file), "utf8")) ??
        {}) as Record<string, Record<string, unknown>>;
      for (const [id, raw] of Object.entries(doc)) {
        if (
          !raw ||
          typeof raw !== "object" ||
          typeof raw.spec_node_id !== "string"
        )
          continue;
        const ref = (raw.source_reference ?? {}) as {
          locations?: Array<{ file?: unknown; symbol?: unknown }>;
        };
        const locations = (ref.locations ?? [])
          .filter((l) => typeof l.file === "string" && l.file)
          .map((l) => ({
            file: l.file as string,
            ...(typeof l.symbol === "string" && l.symbol
              ? { symbol: l.symbol }
              : {})
          }));
        elements.set(id, {
          id,
          type: raw.spec_node_id,
          layer: layerOf(raw.spec_node_id),
          name: String(raw.name ?? id),
          locations
        });
        if (typeof raw.id === "string") byUuid.set(raw.id, id);
      }
    }
  }
  const relFile = path.join(modelDir, "relationships.yaml");
  const rawRels = existsSync(relFile)
    ? ((parse(readFileSync(relFile, "utf8")) ?? []) as Array<
        Record<string, unknown>
      >)
    : [];
  const rels: Rel[] = [];
  const seen = new Set<string>();
  let dangling = 0;
  for (const r of rawRels) {
    const source = byUuid.get(String(r.source)) ?? String(r.source);
    const target = byUuid.get(String(r.target)) ?? String(r.target);
    if (!elements.has(source) || !elements.has(target)) {
      dangling++;
      continue;
    }
    const rel = { source, predicate: String(r.predicate), target };
    if (seen.has(relKey(rel))) continue;
    seen.add(relKey(rel));
    rels.push(rel);
  }
  const root = path.resolve(modelDir, "../..");
  const git = (args: string[]) =>
    spawnSync("git", ["-C", root, ...args], { encoding: "utf8" }).stdout.trim();
  const dirty = git(["status", "--short", "--", "documentation-robotics"])
    ? "+dirty"
    : "";
  return {
    name,
    dir: modelDir,
    root,
    commit: `${git(["rev-parse", "--short", "HEAD"])}${dirty}`,
    elements,
    rels,
    dangling
  };
}

/** The model without some relationships and elements (an element takes its relationships with it). */
export function ablate(
  model: Model,
  removeRels: Set<string>,
  removeEls: Set<string> = new Set()
): Model {
  const elements = removeEls.size
    ? new Map([...model.elements].filter(([id]) => !removeEls.has(id)))
    : model.elements;
  const rels = model.rels.filter(
    (r) =>
      !removeRels.has(relKey(r)) &&
      !removeEls.has(r.source) &&
      !removeEls.has(r.target)
  );
  return { ...model, elements, rels };
}

export type Shape = string;
export const shapeKey = (
  element: string,
  direction: "out" | "in",
  predicate: string,
  otherType: string
): Shape => `${element}|${direction}|${predicate}|${otherType}`;

export interface ModelIndex {
  byType: Map<string, El[]>;
  byLayer: Map<string, El[]>;
  relKeys: Set<string>;
  /** Triple ids the model has at least one relationship of. */
  usedTriples: Map<string, Rel[]>;
  /** `${element}|${direction}|${predicate}|${otherType}` the model has. */
  shapes: Set<Shape>;
  degree: Map<string, number>;
  /** Unordered element pairs with any relationship: `a|b`, a < b. */
  linked: Set<string>;
}

export const unorderedKey = (a: string, b: string): string =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

export function indexModel(model: Model): ModelIndex {
  const byType = new Map<string, El[]>();
  const byLayer = new Map<string, El[]>();
  for (const el of model.elements.values()) {
    byType.set(el.type, [...(byType.get(el.type) ?? []), el]);
    byLayer.set(el.layer, [...(byLayer.get(el.layer) ?? []), el]);
  }
  const relKeys = new Set<string>();
  const usedTriples = new Map<string, Rel[]>();
  const shapes = new Set<Shape>();
  const degree = new Map<string, number>();
  const linked = new Set<string>();
  for (const r of model.rels) {
    const s = model.elements.get(r.source)!;
    const t = model.elements.get(r.target)!;
    relKeys.add(relKey(r));
    const id = `${s.type}.${r.predicate}.${t.type}`;
    const list = usedTriples.get(id);
    if (list) list.push(r);
    else usedTriples.set(id, [r]);
    shapes.add(shapeKey(s.id, "out", r.predicate, t.type));
    shapes.add(shapeKey(t.id, "in", r.predicate, s.type));
    degree.set(s.id, (degree.get(s.id) ?? 0) + 1);
    degree.set(t.id, (degree.get(t.id) ?? 0) + 1);
    linked.add(unorderedKey(s.id, t.id));
  }
  return { byType, byLayer, relKeys, usedTriples, shapes, degree, linked };
}

/** `name=path,name=path` (a path is a model directory or a repository root). */
export function parseModelsFlag(
  value: string
): Array<{ name: string; dir: string }> {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf("=");
      if (eq <= 0)
        throw new Error(`--models entry "${entry}" is not name=path`);
      const p = entry
        .slice(eq + 1)
        .replace(/^~(?=\/)/, process.env.HOME ?? "~");
      const dir = existsSync(path.join(p, "manifest.yaml"))
        ? p
        : path.join(p, "documentation-robotics/model");
      return { name: entry.slice(0, eq), dir };
    });
}
