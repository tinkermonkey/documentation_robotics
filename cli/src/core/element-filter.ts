/**
 * Which elements a read keeps, by layer and type: the one filter the paged read tools share
 * (changeset_show, changeset_brief's sections, model_search).
 *
 * `layers` and `types` narrow together: an element is kept when its layer is one of `layers` (when
 * given) and its type is one of `types` (when given). `excludeLayers` and `excludeTypes` then take
 * elements away. A type is written as the id's type segment (`applicationservice`) or with its
 * layer (`application.applicationservice`). Ids are `layer.type.name`, so the filter reads an id
 * alone, with no model lookup.
 *
 * A layer name that is not one keeps nothing, so the filter names it (`unknownLayers`): an empty
 * answer must never read as "nothing there".
 */

import { getAllLayerIds } from "../generated/layer-registry.js";

export interface ElementFilterSpec {
  layers?: readonly string[];
  types?: readonly string[];
  excludeLayers?: readonly string[];
  excludeTypes?: readonly string[];
}

export interface ElementFilter {
  /** Whether any of the four narrows anything. */
  readonly active: boolean;
  /** Whether the element with this id (`layer.type.name`) is kept. */
  keeps(id: string): boolean;
  /** Whether an element of this layer and type is kept (for a caller that has them apart from the id). */
  keepsLayerType(layer: string, type: string): boolean;
  /** Layer names given in `layers` or `excludeLayers` that are not layers. */
  readonly unknownLayers: string[];
  /** The filter as given, without the empty parts: for the answer to say what it applied. */
  readonly applied: ElementFilterSpec;
}

const nonEmpty = (list: readonly string[] | undefined): list is readonly string[] => !!list && list.length > 0;

/** A type matches as its bare name or as `layer.type`. */
function typeMatches(types: ReadonlySet<string>, layer: string, type: string): boolean {
  return types.has(type) || types.has(`${layer}.${type}`);
}

export function elementFilter(spec: ElementFilterSpec = {}): ElementFilter {
  const layers = nonEmpty(spec.layers) ? new Set(spec.layers) : undefined;
  const types = nonEmpty(spec.types) ? new Set(spec.types) : undefined;
  const excludeLayers = nonEmpty(spec.excludeLayers) ? new Set(spec.excludeLayers) : undefined;
  const excludeTypes = nonEmpty(spec.excludeTypes) ? new Set(spec.excludeTypes) : undefined;
  const known = new Set(getAllLayerIds());
  const unknownLayers = [...new Set([...(spec.layers ?? []), ...(spec.excludeLayers ?? [])])].filter((l) => !known.has(l));
  const applied: ElementFilterSpec = {
    ...(layers ? { layers: [...layers] } : {}),
    ...(types ? { types: [...types] } : {}),
    ...(excludeLayers ? { excludeLayers: [...excludeLayers] } : {}),
    ...(excludeTypes ? { excludeTypes: [...excludeTypes] } : {}),
  };
  const keepsLayerType = (layer: string, type: string): boolean => {
    if (layers && !layers.has(layer)) return false;
    if (types && !typeMatches(types, layer, type)) return false;
    if (excludeLayers?.has(layer)) return false;
    if (excludeTypes && typeMatches(excludeTypes, layer, type)) return false;
    return true;
  };
  return {
    active: !!(layers || types || excludeLayers || excludeTypes),
    keepsLayerType,
    keeps(id: string): boolean {
      const [layer = "", type = ""] = id.split(".");
      return keepsLayerType(layer, type);
    },
    unknownLayers,
    applied,
  };
}

/** The sentence an answer adds when the filter names a layer that is not one. */
export function unknownLayersNote(filter: ElementFilter): string | undefined {
  if (filter.unknownLayers.length === 0) return undefined;
  return `Not a layer: ${filter.unknownLayers.join(", ")} (it keeps nothing). The layers are ${getAllLayerIds().join(", ")}.`;
}
