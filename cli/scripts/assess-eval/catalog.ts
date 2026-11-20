/**
 * The relationship catalog as the assessment harness reads it: every relationship type of the
 * compiled spec (spec/dist), and which of them a mapped codebase-memory edge can produce.
 *
 * "Reachable" is decided by the production lookup (`relationshipFor`), so it follows the mapping's
 * preference order: a type is reachable when some mapped edge between its two end types becomes
 * exactly that type.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { relationshipFor } from "../../src/analyzers/edge-relationships.js";
import type { AnalyzerEdgeMapping } from "../../src/analyzers/types.js";

export const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HARNESS_DIR, "../../..");

export interface Triple {
  id: string;
  source: string;
  predicate: string;
  destination: string;
  description?: string;
}

export interface Catalog {
  specVersion: string;
  /** Layer ids in spec order. */
  layers: string[];
  nodeTypes: string[];
  triples: Triple[];
  byId: Map<string, Triple>;
  /** `${sourceType}|${destinationType}` -> triples in that direction. */
  byTypePair: Map<string, Triple[]>;
  edgeMappings: AnalyzerEdgeMapping[];
  /** Triple id -> the CBM edge types that become it. */
  reachable: Map<string, string[]>;
}

export const layerOf = (specNodeId: string): string => specNodeId.split(".")[0];
export const tripleId = (
  source: string,
  predicate: string,
  destination: string
): string => `${source}.${predicate}.${destination}`;
export const isCrossLayer = (t: Triple): boolean =>
  layerOf(t.source) !== layerOf(t.destination);
export const pairKey = (a: string, b: string): string =>
  [a, b].sort().join(" ~ ");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function loadCatalog(
  specDist = path.join(REPO_ROOT, "spec/dist"),
  analyzerDir = path.join(REPO_ROOT, "spec/analyzers/cbm")
): Catalog {
  const manifest = readJson<{
    specVersion?: string;
    layers: Array<string | { id: string }>;
  }>(path.join(specDist, "manifest.json"));
  const layers = manifest.layers.map((l) => (typeof l === "string" ? l : l.id));
  const triples: Triple[] = [];
  const byId = new Map<string, Triple>();
  const nodeTypes = new Set<string>();
  let specVersion = manifest.specVersion ?? "";
  for (const layer of layers) {
    const file = readJson<{
      specVersion?: string;
      nodeSchemas: Record<string, unknown>;
      relationshipSchemas: Record<
        string,
        {
          source_spec_node_id: string;
          predicate: string;
          destination_spec_node_id: string;
          description?: string;
        }
      >;
    }>(path.join(specDist, `${layer}.json`));
    specVersion ||= file.specVersion ?? "";
    for (const key of Object.keys(file.nodeSchemas))
      nodeTypes.add(key.includes(".") ? key : `${layer}.${key}`);
    for (const r of Object.values(file.relationshipSchemas)) {
      const id = tripleId(
        r.source_spec_node_id,
        r.predicate,
        r.destination_spec_node_id
      );
      if (byId.has(id)) continue;
      const t: Triple = {
        id,
        source: r.source_spec_node_id,
        predicate: r.predicate,
        destination: r.destination_spec_node_id,
        description: r.description
      };
      byId.set(id, t);
      triples.push(t);
      nodeTypes.add(t.source);
      nodeTypes.add(t.destination);
    }
  }
  const byTypePair = new Map<string, Triple[]>();
  for (const t of triples) {
    const key = `${t.source}|${t.destination}`;
    byTypePair.set(key, [...(byTypePair.get(key) ?? []), t]);
  }

  const edgeMappings = readJson<{ mappings: AnalyzerEdgeMapping[] }>(
    path.join(analyzerDir, "edge-mapping.json")
  ).mappings;
  const reachable = new Map<string, string[]>();
  const types = [...nodeTypes];
  for (const m of edgeMappings) {
    if (m.usage !== "verification_and_mapping") continue;
    for (const from of types) {
      for (const to of types) {
        const r = relationshipFor(m, from, to, (id) => byId.has(id));
        if (!r) continue;
        const list = reachable.get(r.id) ?? [];
        if (!list.includes(m.cbm_edge)) list.push(m.cbm_edge);
        reachable.set(r.id, list);
      }
    }
  }
  return {
    specVersion,
    layers,
    nodeTypes: types,
    triples,
    byId,
    byTypePair,
    edgeMappings,
    reachable
  };
}

/** Catalog triples between two element types, in either direction. */
export function triplesBetween(
  catalog: Catalog,
  a: string,
  b: string
): Triple[] {
  return [
    ...(catalog.byTypePair.get(`${a}|${b}`) ?? []),
    ...(a === b ? [] : (catalog.byTypePair.get(`${b}|${a}`) ?? []))
  ];
}
