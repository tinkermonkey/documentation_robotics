/**
 * Accepted gaps in validation: informational only (#1026).
 *
 * An accepted gap never makes validation fail, so nothing here is an error or a warning (`--strict`
 * turns warnings into errors). `dr validate` and `model_validate` report, beside the result, how many
 * accepted gaps the model records and notices about them: malformed entries, triples the catalog
 * doesn't define or marks required, the same triple twice, and gaps the model's own relationships
 * contradict.
 */

import { acceptedGapNotices, contradictedGaps, describeTriple, readAcceptedGaps } from "../core/accepted-gaps.js";
import type { Model } from "../core/model.js";
import { normalizeNodeType } from "../generated/node-types.js";

export interface AcceptedGapNotice {
  elementId: string;
  layer: string;
  message: string;
}

export interface AcceptedGapInfo {
  /** Well-formed accepted gaps in the validated layers. */
  total: number;
  notices: AcceptedGapNotice[];
}

/** Accepted gaps in the model's (validated) layers, with informational notices. */
export function acceptedGapInfo(model: Pick<Model, "layers" | "relationships">): AcceptedGapInfo {
  const info: AcceptedGapInfo = { total: 0, notices: [] };
  const typeOf = (id: string) => {
    const [layer, type] = id.split(".");
    return type ? `${layer}.${normalizeNodeType(layer, type)}` : id;
  };
  for (const [layerName, layer] of model.layers) {
    for (const element of layer.listElements()) {
      if (element.accepted_gaps === undefined) continue;
      const elementId = element.path || element.id;
      const specNodeId = `${layerName}.${normalizeNodeType(layerName, element.type)}`;
      for (const message of acceptedGapNotices(specNodeId, element.accepted_gaps)) {
        info.notices.push({ elementId, layer: layerName, message });
      }
      const gaps = readAcceptedGaps(element.accepted_gaps);
      info.total += gaps.length;
      const { outgoing, incoming } = model.relationships.getForElement(elementId);
      const edges = [
        ...outgoing.map((r) => ({ ...r, direction: "out" as const, otherType: typeOf(r.target) })),
        ...incoming.map((r) => ({ ...r, direction: "in" as const, otherType: typeOf(r.source) })),
      ];
      for (const { gap, edge } of contradictedGaps(gaps, edges)) {
        info.notices.push({
          elementId,
          layer: layerName,
          message:
            `accepted gap ${describeTriple(specNodeId, gap)} is contradicted by ${edge.source} --${edge.predicate}--> ` +
            `${edge.target}: reopen the gap or remove the relationship.`,
        });
      }
    }
  }
  return info;
}
