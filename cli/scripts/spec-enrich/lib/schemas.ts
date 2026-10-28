import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../../classify-eval/lib/env.js";

/**
 * Loaders for the hand-maintained spec sources (not spec/dist): node schemas,
 * relationship schemas, layer files, predicates. These are what apply.ts edits.
 */

export interface AttributeSpec {
  type?: string;
  enum?: unknown[];
  description?: string;
  [k: string]: unknown;
}

export interface NodeSchema {
  file: string; // absolute path
  layer: string;
  type: string; // e.g. applicationservice
  specNodeId: string; // e.g. application.applicationservice
  title: string;
  description: string;
  attributes: Record<string, AttributeSpec>;
  requiredAttributes: string[];
  evidence: string[]; // x-dr-evidence
  distinguish: Record<string, string>; // x-dr-distinguish: sibling type id -> "use X instead when ..."
  raw: Record<string, unknown>;
}

export interface RelationshipSchema {
  file: string;
  id: string;
  source: string;
  predicate: string;
  destination: string;
  sourceLayer: string;
  destinationLayer: string;
  description: string;
  evidence: string[]; // x-dr-evidence
  raw: Record<string, unknown>;
}

export interface Predicate {
  predicate: string;
  inverse?: string;
  category?: string;
  description?: string;
  archimate_alignment?: string;
}

export const BOILERPLATE_REL = /^Defines relationship: /;

export function specDir(): string {
  return path.join(repoRoot(), "spec");
}

export function loadLayerIds(): string[] {
  const manifest = JSON.parse(readFileSync(path.join(specDir(), "dist", "manifest.json"), "utf8")) as { layers: Array<{ id: string; number: number }> };
  return manifest.layers.sort((a, b) => a.number - b.number).map((l) => l.id);
}

export function loadLayerDescription(layerId: string): string {
  const f = JSON.parse(readFileSync(path.join(specDir(), "dist", `${layerId}.json`), "utf8")) as { layer: { description?: string; inspired_by?: { standard?: string } } };
  const std = f.layer.inspired_by?.standard;
  return `${f.layer.description ?? ""}${std ? ` Standard: ${std}.` : ""}`;
}

export function loadPredicates(): Record<string, Predicate> {
  const d = JSON.parse(readFileSync(path.join(specDir(), "schemas", "base", "predicates.json"), "utf8")) as Record<string, unknown>;
  const p = (d.predicates ?? d) as Record<string, Predicate>;
  return p;
}

export function loadNodeSchemas(layerFilter?: string): NodeSchema[] {
  const root = path.join(specDir(), "schemas", "nodes");
  const out: NodeSchema[] = [];
  for (const layer of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    if (layerFilter && layer !== layerFilter) continue;
    const dir = path.join(root, layer);
    for (const fn of readdirSync(dir).filter((f) => f.endsWith(".node.schema.json")).sort()) {
      const file = path.join(dir, fn);
      const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const props = (raw.properties ?? {}) as Record<string, { const?: string; properties?: Record<string, AttributeSpec>; required?: string[] }>;
      const specNodeId = props.spec_node_id?.const ?? `${layer}.${fn.replace(".node.schema.json", "")}`;
      out.push({
        file,
        layer,
        type: specNodeId.split(".")[1],
        specNodeId,
        title: String(raw.title ?? specNodeId),
        description: String(raw.description ?? ""),
        attributes: props.attributes?.properties ?? {},
        requiredAttributes: props.attributes?.required ?? [],
        evidence: Array.isArray(raw["x-dr-evidence"]) ? (raw["x-dr-evidence"] as string[]) : [],
        distinguish: (raw["x-dr-distinguish"] as Record<string, string>) ?? {},
        raw,
      });
    }
  }
  return out;
}

export function loadRelationshipSchemas(sourceLayerFilter?: string): RelationshipSchema[] {
  const root = path.join(specDir(), "schemas", "relationships");
  const out: RelationshipSchema[] = [];
  for (const layer of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    if (sourceLayerFilter && layer !== sourceLayerFilter) continue;
    const dir = path.join(root, layer);
    for (const fn of readdirSync(dir).filter((f) => f.endsWith(".relationship.schema.json")).sort()) {
      const file = path.join(dir, fn);
      const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const p = (raw.properties ?? {}) as Record<string, { const?: string }>;
      const source = p.source_spec_node_id?.const ?? "";
      const destination = p.destination_spec_node_id?.const ?? "";
      out.push({
        file,
        id: p.id?.const ?? fn,
        source,
        predicate: p.predicate?.const ?? "",
        destination,
        sourceLayer: p.source_layer?.const ?? source.split(".")[0],
        destinationLayer: p.destination_layer?.const ?? destination.split(".")[0],
        description: String(raw.description ?? ""),
        evidence: Array.isArray(raw["x-dr-evidence"]) ? (raw["x-dr-evidence"] as string[]) : [],
        raw,
      });
    }
  }
  return out;
}

/** Write a schema file back with 2-space indentation and a trailing newline (prettier-compatible). */
export function writeSchemaFile(file: string, raw: Record<string, unknown>): void {
  writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
}

/** Short, stable summary of a node schema for prompts. */
export function describeNodeForPrompt(n: NodeSchema): string {
  const attrs = Object.entries(n.attributes)
    .map(([k, v]) => `  - ${k}${n.requiredAttributes.includes(k) ? " (required)" : ""}: ${v.type ?? "any"}${v.enum ? ` enum[${(v.enum as unknown[]).join("|")}]` : ""}${v.description ? ` — ${v.description}` : ""}`)
    .join("\n");
  return `${n.specNodeId} (${n.title}): ${n.description || "(no description)"}\n${attrs || "  (no attributes)"}`;
}
