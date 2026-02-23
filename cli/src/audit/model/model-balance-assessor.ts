/**
 * Model Balance Assessor - Assesses relationship density balance in model instances
 *
 * Groups relationship instances by source element's spec_node_id and applies
 * the same target-range logic as the spec-based BalanceAssessor.
 */

import type { Relationship } from "../../core/relationships.js";
import type { Element } from "../../core/element.js";
import type { BalanceAssessment } from "../types.js";

/**
 * Density targets for different node type categories (matches BalanceAssessor)
 */
const DENSITY_TARGETS: Record<string, [number, number]> = {
  structural: [2, 4],
  behavioral: [3, 5],
  enumeration: [1, 2],
  reference: [0, 1],
};

/**
 * Assess balance for a layer using model instances
 */
export function assessLayerBalance(
  layerId: string,
  elements: Element[],
  intraLayerRels: Relationship[]
): BalanceAssessment[] {
  const assessments: BalanceAssessment[] = [];

  // Build count of outgoing intra-layer rels per spec_node_id
  const elementById = new Map<string, Element>(
    elements.map((e) => [e.id, e])
  );

  const relCountBySpecNodeId = new Map<string, number>();
  for (const rel of intraLayerRels) {
    const srcEl = elementById.get(rel.source);
    if (!srcEl?.spec_node_id) continue;
    relCountBySpecNodeId.set(
      srcEl.spec_node_id,
      (relCountBySpecNodeId.get(srcEl.spec_node_id) ?? 0) + 1
    );
  }

  // Assess each distinct spec_node_id present in this layer
  const specNodeIds = new Set<string>(
    elements.map((e) => e.spec_node_id).filter(Boolean)
  );

  for (const specNodeId of specNodeIds) {
    const category = classifyNodeType(specNodeId);
    const currentCount = relCountBySpecNodeId.get(specNodeId) ?? 0;
    const targetRange = DENSITY_TARGETS[category];
    const [min, max] = targetRange;
    const status: "under" | "balanced" | "over" =
      currentCount < min ? "under" : currentCount > max ? "over" : "balanced";
    const recommendation = buildRecommendation(
      specNodeId,
      category,
      currentCount,
      targetRange,
      status
    );

    assessments.push({
      nodeType: specNodeId,
      layer: layerId,
      category,
      currentCount,
      targetRange,
      status,
      recommendation,
    });
  }

  return assessments;
}

function classifyNodeType(
  specNodeId: string
): "structural" | "behavioral" | "enumeration" | "reference" {
  const type = specNodeId.split(".")[1] ?? "";

  if (
    type.endsWith("level") ||
    type.endsWith("type") ||
    type.endsWith("status") ||
    type.endsWith("priority") ||
    type.endsWith("scope") ||
    type.endsWith("action") ||
    type.endsWith("category") ||
    type.endsWith("format")
  ) {
    return "enumeration";
  }

  if (
    type.includes("component") ||
    type.includes("container") ||
    type.includes("service") ||
    type.includes("module") ||
    type.includes("collaboration") ||
    type.includes("interface") ||
    type.includes("device") ||
    type.includes("node") ||
    type.includes("artifact")
  ) {
    return "structural";
  }

  if (
    type.includes("process") ||
    type.includes("operation") ||
    type.includes("event") ||
    type.includes("flow") ||
    type.includes("interaction") ||
    type.includes("function") ||
    type.includes("trigger")
  ) {
    return "behavioral";
  }

  return "reference";
}

function buildRecommendation(
  specNodeId: string,
  category: string,
  currentCount: number,
  targetRange: [number, number],
  status: "under" | "balanced" | "over"
): string | undefined {
  const [min, max] = targetRange;
  const typeName = specNodeId.split(".").pop() ?? specNodeId;

  if (status === "under") {
    const needed = min - currentCount;
    return `Add ${needed} relationship instance${needed > 1 ? "s" : ""} for ${typeName} (${category} type) to reach minimum target`;
  }
  if (status === "over") {
    const excess = currentCount - max;
    return `Consider removing ${excess} relationship instance${excess > 1 ? "s" : ""} from ${typeName} or reviewing ${category} type classification`;
  }
  return undefined;
}
