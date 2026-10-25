import { readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./env.js";
import { CONCERNS, type Concern } from "./types.js";

export interface LayerInfo {
  id: string;
  number: number;
  name: string;
  scope: string;
  standard: string | null;
  types: TypeInfo[];
}

export interface TypeInfo {
  id: string; // e.g. "applicationservice"
  specNodeId: string; // e.g. "application.applicationservice"
  title: string;
  description: string;
  evidence: string[]; // x-dr-evidence, when the spec has been enriched
}

const PLACEHOLDER_DESCRIPTION = /^Layer \d+: /;

export const NONE_OPTION = "none";
export const NONE_SCOPE =
  "Not an architecturally meaningful element on its own: a trivial helper, formatting utility, boilerplate, generated code, test scaffolding, or an implementation detail below the level a 13-layer architecture model would record.";

export const SIGNIFICANCE_LEVELS = [
  "0: implementation detail (private helper, formatter, trivial wrapper, constant)",
  "1: minor internal unit that only its file cares about",
  "2: notable internal unit a maintainer would name when explaining the module",
  "3: architecturally significant (a service, component, contract, store, policy or integration point)",
  "4: core architectural element: an entry point, system boundary, or central abstraction",
];

export const CONCERN_DEFINITIONS: Record<Concern, string> = {
  authentication: "verifies identity: login, tokens, API keys, sessions, credentials",
  authorization: "decides what an identity may do: roles, permissions, policies, access checks",
  data_persistence: "reads or writes durable storage: files, databases, caches, manifests on disk",
  external_integration: "calls or serves an external system or process: HTTP clients, MCP servers, subprocesses, third-party APIs",
  observability: "telemetry, logging, metrics, tracing, spans",
  user_interface: "renders or drives a user-facing interface: CLI output, web UI, TUI, prompts",
};

let cached: LayerInfo[] | null = null;

/** Load the 13 layers and their node types from spec/dist. */
export function loadLayers(): LayerInfo[] {
  if (cached) return cached;
  const dist = path.join(repoRoot(), "spec", "dist");
  const manifest = JSON.parse(readFileSync(path.join(dist, "manifest.json"), "utf8")) as {
    layers: Array<{ id: string; number: number; name: string }>;
  };
  const layers: LayerInfo[] = [];
  for (const l of manifest.layers) {
    const file = JSON.parse(readFileSync(path.join(dist, `${l.id}.json`), "utf8")) as {
      layer: { description?: string; inspired_by?: { standard?: string } };
      nodeSchemas: Record<string, { title?: string; description?: string; "x-dr-evidence"?: string[]; properties?: { spec_node_id?: { const?: string } } }>;
    };
    const types: TypeInfo[] = Object.entries(file.nodeSchemas).map(([id, s]) => ({
      id,
      specNodeId: s.properties?.spec_node_id?.const ?? `${l.id}.${id}`,
      title: s.title ?? id,
      description: (s.description ?? "").trim(),
      evidence: Array.isArray(s["x-dr-evidence"]) ? s["x-dr-evidence"] : [],
    }));
    types.sort((a, b) => a.id.localeCompare(b.id));
    const scope = (file.layer.description ?? "").trim();
    if (!scope || PLACEHOLDER_DESCRIPTION.test(scope)) {
      throw new Error(`Layer ${l.id} has no real description in spec/dist (got "${scope}"). Run \`npm run build:spec\` at the repo root.`);
    }
    layers.push({
      id: l.id,
      number: l.number,
      name: l.name,
      scope,
      standard: file.layer.inspired_by?.standard ?? null,
      types,
    });
  }
  layers.sort((a, b) => a.number - b.number);
  cached = layers;
  return layers;
}

export function layerIds(): string[] {
  return loadLayers().map((l) => l.id);
}

export function findLayer(id: string): LayerInfo | undefined {
  return loadLayers().find((l) => l.id === id);
}

export function isValidType(layerId: string, typeId: string | null): boolean {
  if (!typeId) return false;
  const layer = findLayer(layerId);
  return !!layer && layer.types.some((t) => t.id === typeId);
}

/** Criteria map for a layer-choice question (option id -> description). */
export function layerCriteria(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of loadLayers()) {
    const examples = l.types.slice(0, 8).map((t) => t.title).join(", ");
    out[l.id] = `${l.name}${l.standard ? ` (${l.standard})` : ""}: ${l.scope} Example element types: ${examples}.`;
  }
  out[NONE_OPTION] = NONE_SCOPE;
  return out;
}

/** Criteria map for a type-choice question within one layer. */
export function typeCriteria(layerId: string): Record<string, string> {
  const layer = findLayer(layerId);
  const out: Record<string, string> = {};
  if (!layer) return out;
  for (const t of layer.types) {
    const evidence = t.evidence.length ? ` Evidence: ${t.evidence.join("; ")}.` : "";
    out[t.id] = `${t.title}: ${t.description || "(no description in spec)"}${evidence}`;
  }
  out[NONE_OPTION] = "None of the listed types fits this element well.";
  return out;
}

/** Full reference text of all layers and types (for Claude system prompts). */
export function specReferenceText(): string {
  const parts: string[] = [];
  parts.push("# Documentation Robotics 13-layer architecture model: layers and element types\n");
  for (const l of loadLayers()) {
    parts.push(`## Layer ${l.number}: ${l.id} (${l.name}${l.standard ? `, ${l.standard}` : ""})`);
    parts.push(l.scope);
    parts.push("Element types:");
    for (const t of l.types) parts.push(`- ${t.id} (${t.title}): ${t.description || "(no description)"}`);
    parts.push("");
  }
  parts.push(`## ${NONE_OPTION}`);
  parts.push(NONE_SCOPE);
  parts.push("");
  parts.push("# Architectural significance scale");
  for (const s of SIGNIFICANCE_LEVELS) parts.push(`- ${s}`);
  parts.push("");
  parts.push("# Cross-cutting concerns");
  for (const c of CONCERNS) parts.push(`- ${c}: ${CONCERN_DEFINITIONS[c]}`);
  return parts.join("\n");
}
