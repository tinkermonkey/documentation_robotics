/**
 * The spec as the harness sees it: the CLI's Tier-1 criteria (src/analyzers/classifier/criteria.ts),
 * so what is measured here is what the CLI builds. Criteria come from the CLI's bundled spec
 * (cli/src/schemas/bundled/, the same files as spec/dist when the CLI is built), or from another
 * compiled spec (`initSpec({ specDist })`, e.g. the one a committed run was made with). Nothing is
 * read at import: a script calls `await initSpec(...)` first, so `--spec-dist` is applied before
 * any criteria exist, and Tier-0 rules read the same directory (`specDir()`).
 *
 * The experiment flags are builder options: `--criteria core` is `setCriteriaMode("core")`.
 */
import {
  coreDescription,
  findLayer as findLayerIn,
  layerCriteria as layerCriteriaOf,
  loadSpecCriteria,
  NONE_OPTION,
  NONE_SCOPE,
  specCriteriaFromLayers,
  typeCriteria as typeCriteriaOf,
  type CriteriaMode,
  type LayerInfo,
  type SpecCriteria,
  type TypeInfo,
} from "../../../src/analyzers/classifier/criteria.js";
import { SpecDataLoader } from "../../../src/core/spec-loader.js";
import { CONCERN_DEFINITIONS, CONCERNS, SIGNIFICANCE_LEVELS } from "../../../src/analyzers/classifier/qset/v1.js";

export { coreDescription, NONE_OPTION, NONE_SCOPE, CONCERN_DEFINITIONS, SIGNIFICANCE_LEVELS };
export type { CriteriaMode, LayerInfo, TypeInfo, SpecCriteria };

let loaded: { spec: SpecCriteria; dir: string } | null = null;

/**
 * Load the spec once per process, before anything reads it: from `specDist` when given, else the
 * CLI's bundled spec. Tier-0 rules come from the same directory (`specDir()`).
 */
export async function initSpec(options: { specDist?: string; mode?: CriteriaMode } = {}): Promise<void> {
  const dir = options.specDist ?? new SpecDataLoader().getBundledDir();
  loaded = { spec: await loadSpecCriteria({ bundledDir: dir, mode: options.mode ?? "full" }), dir };
}

function spec(): SpecCriteria {
  if (!loaded) throw new Error("lib/spec.ts: call `await initSpec()` before reading the spec");
  return loaded.spec;
}

/** The compiled spec directory the criteria were read from (and Tier-0 rules should be). */
export function specDir(): string {
  if (!loaded) throw new Error("lib/spec.ts: call `await initSpec()` before reading the spec");
  return loaded.dir;
}

/** The criteria input the question builders get. */
export function currentSpec(): SpecCriteria {
  return spec();
}

export function setCriteriaMode(mode: CriteriaMode): void {
  const s = spec();
  loaded = { spec: specCriteriaFromLayers(s.layers, mode, s.specVersion), dir: specDir() };
}

/** The 13 layers and their node types. */
export function loadLayers(): LayerInfo[] {
  return [...spec().layers];
}

export function layerIds(): string[] {
  return spec().layers.map((l) => l.id);
}

export function findLayer(id: string): LayerInfo | undefined {
  return findLayerIn(spec(), id);
}

export function isValidType(layerId: string, typeId: string | null): boolean {
  if (!typeId) return false;
  const layer = findLayer(layerId);
  return !!layer && layer.types.some((t) => t.id === typeId);
}

/** Criteria map for a layer-choice question (option id -> description). */
export function layerCriteria(): Record<string, string> {
  return layerCriteriaOf(spec());
}

/** Criteria map for a type-choice question within one layer. */
export function typeCriteria(layerId: string): Record<string, string> {
  return typeCriteriaOf(spec(), layerId);
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
