/**
 * Layer and element-type criteria for Tier 1's choice questions, built from the CLI's bundled spec
 * (`cli/src/schemas/bundled/`, through {@link SpecDataLoader}) so an installed CLI needs no
 * repository. Ported from the classify-eval harness's `lib/spec.ts`, which read `spec/dist`; the
 * text produced is the same, and a placeholder layer description is still refused.
 *
 * Criteria are an input to the question set, not part of its id: {@link criteriaDigest} goes into
 * the cache key and is recorded with each decision (TIER1_DESIGN.md sections 3.3 and 4.1).
 */
import { createHash } from "node:crypto";
import { SpecDataLoader } from "../../core/spec-loader.js";

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
  distinguish: Record<string, string>; // x-dr-distinguish: sibling spec node id -> "when ..." clause
}

/**
 * How much of an enriched definition goes into element-type criteria:
 * "full" (default, and what dr-qset-1 uses) sends the description as written, sibling sentences
 * included; "core" (a harness experiment) removes the "Use X instead when ..." sentences (they stay
 * in x-dr-distinguish), leaving the definition and the evidence lines.
 */
export type CriteriaMode = "full" | "core";

/** The spec input to the question builders: the layers and their types, and the criteria mode. */
export interface SpecCriteria {
  readonly layers: readonly LayerInfo[];
  readonly mode: CriteriaMode;
  /** The spec version the layers were read from, when known (recorded, not keyed). */
  readonly specVersion?: string;
}

export const NONE_OPTION = "none";
export const NONE_SCOPE =
  "Not an architecturally meaningful element on its own: a trivial helper, formatting utility, boilerplate, generated code, test scaffolding, or an implementation detail below the level a 13-layer architecture model would record.";
export const NONE_TYPE_CRITERION = "None of the listed types fits this element well.";

const PLACEHOLDER_DESCRIPTION = /^Layer \d+: /;

/** The description without its "Use X instead when <clause>" sentences. */
export function coreDescription(t: TypeInfo): string {
  let d = t.description;
  for (const clause of Object.values(t.distinguish)) {
    const i = d.indexOf(clause);
    if (i < 0) continue;
    const start = d.lastIndexOf(" Use ", i);
    if (start >= 0) d = d.slice(0, start) + d.slice(i + clause.length);
  }
  return d.replace(/\s+/g, " ").trim();
}

export interface LoadSpecCriteriaOptions {
  /** A compiled spec directory (`manifest.json` and `{layer}.json`); default: the CLI's bundled spec. */
  bundledDir?: string;
  mode?: CriteriaMode;
}

/** Read the 13 layers and their node types from the bundled spec. */
export async function loadSpecLayers(bundledDir?: string): Promise<{ layers: LayerInfo[]; specVersion?: string }> {
  const loader = new SpecDataLoader({ bundledDir, includeSchemas: true, cache: false });
  const data = await loader.load();
  const layers: LayerInfo[] = [];
  for (const l of data.layers) {
    const types: TypeInfo[] = data.nodeTypes
      .filter((t) => t.layer_id === l.id)
      .map((t) => {
        const s = (t.schema ?? {}) as { title?: string; description?: string; "x-dr-evidence"?: unknown; "x-dr-distinguish"?: unknown };
        const distinguish = s["x-dr-distinguish"];
        return {
          id: t.type,
          specNodeId: t.spec_node_id,
          title: s.title ?? t.type,
          description: (s.description ?? "").trim(),
          evidence: Array.isArray(s["x-dr-evidence"]) ? (s["x-dr-evidence"] as string[]) : [],
          distinguish: distinguish && typeof distinguish === "object" ? (distinguish as Record<string, string>) : {},
        };
      });
    types.sort((a, b) => a.id.localeCompare(b.id));
    const scope = (l.description ?? "").trim();
    if (!scope || PLACEHOLDER_DESCRIPTION.test(scope)) {
      throw new Error(`Layer ${l.id} has no real description in the bundled spec (got "${scope}"). Rebuild the spec (npm run build:spec, then npm run build in cli/).`);
    }
    layers.push({ id: l.id, number: l.number, name: l.name, scope, standard: l.inspired_by?.standard ?? null, types });
  }
  layers.sort((a, b) => a.number - b.number);
  const specVersion = await loader.getSpecVersion();
  return specVersion ? { layers, specVersion } : { layers };
}

/** The criteria input for the question builders, from the bundled spec. */
export async function loadSpecCriteria(options: LoadSpecCriteriaOptions = {}): Promise<SpecCriteria> {
  const { layers, specVersion } = await loadSpecLayers(options.bundledDir);
  return specCriteriaFromLayers(layers, options.mode ?? "full", specVersion);
}

export function specCriteriaFromLayers(layers: readonly LayerInfo[], mode: CriteriaMode = "full", specVersion?: string): SpecCriteria {
  return specVersion === undefined ? { layers, mode } : { layers, mode, specVersion };
}

export function findLayer(spec: SpecCriteria, id: string): LayerInfo | undefined {
  return spec.layers.find((l) => l.id === id);
}

/** Criteria map for a layer-choice question (option id -> description), `none` last. */
export function layerCriteria(spec: SpecCriteria): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of spec.layers) {
    const examples = l.types
      .slice(0, 8)
      .map((t) => t.title)
      .join(", ");
    out[l.id] = `${l.name}${l.standard ? ` (${l.standard})` : ""}: ${l.scope} Example element types: ${examples}.`;
  }
  out[NONE_OPTION] = NONE_SCOPE;
  return out;
}

/** Criteria map for a type-choice question within one layer, `none` last; empty for an unknown layer. */
export function typeCriteria(spec: SpecCriteria, layerId: string): Record<string, string> {
  const layer = findLayer(spec, layerId);
  const out: Record<string, string> = {};
  if (!layer) return out;
  for (const t of layer.types) {
    const evidence = t.evidence.length ? ` Evidence: ${t.evidence.join("; ")}.` : "";
    const description = spec.mode === "core" ? coreDescription(t) : t.description;
    out[t.id] = `${t.title}: ${description || "(no description in spec)"}${evidence}`;
  }
  out[NONE_OPTION] = NONE_TYPE_CRITERION;
  return out;
}

/**
 * SHA-256 of the exact criteria text the model can be shown: the layer criteria and every layer's
 * type criteria, in order. Changes when any definition the model sees changes, and not otherwise.
 */
export function criteriaDigest(spec: SpecCriteria): string {
  const types = spec.layers.map((l) => [l.id, typeCriteria(spec, l.id)]);
  const text = JSON.stringify({ layer: Object.entries(layerCriteria(spec)), types: types.map(([id, c]) => [id, Object.entries(c)]) });
  return createHash("sha256").update(text).digest("hex");
}
