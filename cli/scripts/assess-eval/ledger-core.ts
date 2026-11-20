/**
 * The gap ledger: what a model has against what the catalog allows, at layer-pair and at
 * relationship-type level. Deterministic, no model calls.
 */
import {
  isCrossLayer,
  layerOf,
  pairKey,
  type Catalog,
  type Triple
} from "./catalog.js";
import type { Model, ModelIndex } from "./model.js";

/** A relationship type is "low" when under this share of its source type's elements have it. */
export const LOW_PARTICIPATION = 0.2;
/** A populated pair is "thin" when it uses under this share of its instantiable types. */
export const THIN_PAIR = 1 / 3;

export type PairState = "layer-absent" | "empty" | "thin" | "populated";

export interface PairRow {
  /** The pair's layers in spec order, for display. */
  pair: string;
  /** `pairKey` of the two layers, for matching. */
  key: string;
  layers: [string, string];
  elements: [number, number];
  state: PairState;
  catalogTypes: number;
  instantiable: number;
  used: number;
  relationships: number;
  /** Instantiable types a mapped CBM edge can produce. */
  reachable: number;
}

export type TypeState = "unused" | "low" | "used";

export interface TypeRow {
  triple: Triple;
  crossLayer: boolean;
  state: TypeState;
  sources: number;
  destinations: number;
  relationships: number;
  /** Source elements with at least one such relationship. */
  participating: number;
  reachableBy: string[];
}

export interface Ledger {
  pairs: PairRow[];
  types: TypeRow[];
}

export function buildLedger(
  model: Model,
  idx: ModelIndex,
  catalog: Catalog
): Ledger {
  const count = (type: string) => idx.byType.get(type)?.length ?? 0;
  const types: TypeRow[] = [];
  for (const t of catalog.triples) {
    const sources = count(t.source);
    const destinations = count(t.destination);
    if (!sources || !destinations) continue;
    const rels = idx.usedTriples.get(t.id) ?? [];
    const participating = new Set(rels.map((r) => r.source)).size;
    const state: TypeState =
      rels.length === 0
        ? "unused"
        : participating / sources < LOW_PARTICIPATION
          ? "low"
          : "used";
    types.push({
      triple: t,
      crossLayer: isCrossLayer(t),
      state,
      sources,
      destinations,
      relationships: rels.length,
      participating,
      reachableBy: catalog.reachable.get(t.id) ?? []
    });
  }

  const byPair = new Map<
    string,
    { layers: [string, string]; catalogTypes: number }
  >();
  for (const t of catalog.triples.filter(isCrossLayer)) {
    const layers = [layerOf(t.source), layerOf(t.destination)].sort(
      (a, b) => catalog.layers.indexOf(a) - catalog.layers.indexOf(b)
    ) as [string, string];
    const key = pairKey(layers[0], layers[1]);
    const entry = byPair.get(key) ?? { layers, catalogTypes: 0 };
    entry.catalogTypes++;
    byPair.set(key, entry);
  }
  const pairs: PairRow[] = [];
  for (const [key, { layers, catalogTypes }] of byPair) {
    const elements: [number, number] = [
      idx.byLayer.get(layers[0])?.length ?? 0,
      idx.byLayer.get(layers[1])?.length ?? 0
    ];
    const rows = types.filter(
      (r) =>
        r.crossLayer &&
        pairKey(layerOf(r.triple.source), layerOf(r.triple.destination)) === key
    );
    const used = rows.filter((r) => r.relationships > 0).length;
    const relationships = rows.reduce((n, r) => n + r.relationships, 0);
    const state: PairState =
      !elements[0] || !elements[1]
        ? "layer-absent"
        : relationships === 0
          ? "empty"
          : rows.length && used / rows.length < THIN_PAIR
            ? "thin"
            : "populated";
    pairs.push({
      pair: `${layers[0]} ~ ${layers[1]}`,
      key,
      layers,
      elements,
      state,
      catalogTypes,
      instantiable: rows.length,
      used,
      relationships,
      reachable: rows.filter((r) => r.reachableBy.length > 0).length
    });
  }
  pairs.sort(
    (a, b) =>
      catalog.layers.indexOf(a.layers[0]) -
        catalog.layers.indexOf(b.layers[0]) ||
      catalog.layers.indexOf(a.layers[1]) - catalog.layers.indexOf(b.layers[1])
  );
  return { pairs, types };
}

/** Whole-model numbers for the baseline table. */
export function ledgerSummary(
  model: Model,
  idx: ModelIndex,
  ledger: Ledger,
  catalog: Catalog
) {
  const both = ledger.pairs.filter((p) => p.state !== "layer-absent");
  const cross = ledger.types.filter((t) => t.crossLayer);
  const open = cross.filter((t) => t.state !== "used");
  let unwired = 0;
  for (const row of ledger.types) {
    // Element-level entries: each source lacking the outgoing shape, each destination the incoming.
    const haveOut = new Set(
      (idx.usedTriples.get(row.triple.id) ?? []).map((r) => r.source)
    ).size;
    const haveIn = new Set(
      (idx.usedTriples.get(row.triple.id) ?? []).map((r) => r.target)
    ).size;
    unwired += row.sources - haveOut + (row.destinations - haveIn);
  }
  return {
    model: model.name,
    commit: model.commit,
    elements: model.elements.size,
    relationships: model.rels.length,
    dangling: model.dangling,
    layersPopulated: catalog.layers.filter((l) => idx.byLayer.has(l)).length,
    layersAbsent: catalog.layers.filter((l) => !idx.byLayer.has(l)),
    noRelationship: [...model.elements.keys()].filter(
      (id) => !idx.degree.get(id)
    ).length,
    withSource: [...model.elements.values()].filter(
      (e) => e.locations.length > 0
    ).length,
    pairsBothPopulated: both.length,
    pairsEmpty: both.filter((p) => p.state === "empty").length,
    pairsThin: both.filter((p) => p.state === "thin").length,
    crossTypesInstantiable: cross.length,
    crossTypesUnused: cross.filter((t) => t.state === "unused").length,
    crossTypesLow: cross.filter((t) => t.state === "low").length,
    openReachable: open.filter((t) => t.reachableBy.length > 0).length,
    openUnreachable: open.filter((t) => t.reachableBy.length === 0).length,
    unwiredEntries: unwired,
    unwiredPerElement: model.elements.size ? unwired / model.elements.size : 0
  };
}
