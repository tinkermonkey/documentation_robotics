/**
 * Utilities for call graph analysis
 */

import { relative } from "node:path";
import type { CallGraphNode } from "./types.js";

/**
 * Clamp depth to valid range (default 3, max 10)
 */
export function clampDepth(depth: number | undefined): number {
  return Math.min(depth ?? 3, 10);
}

/**
 * Shape raw response node to CallGraphNode
 */
export function shapeCallGraphNode(
  responseNode: any,
  projectRoot?: string
): CallGraphNode {
  // Extract source file and compute relative path if projectRoot provided
  let sourceFile = responseNode.file_path || responseNode.source_file || "";
  if (sourceFile && projectRoot) {
    try {
      sourceFile = relative(projectRoot, sourceFile);
    } catch {
      // Keep original if path.relative fails
    }
  }

  return {
    qualified_name: responseNode.qualified_name || responseNode.id,
    source_file: sourceFile,
    source_symbol: responseNode.source_symbol || responseNode.id || "",
    depth: typeof responseNode.depth === "number" ? responseNode.depth : 0,
    edge_type: "CALLS",
  };
}

/**
 * Determine edge type based on node depth and edges list
 */
export function determineEdgeType(
  nodeDepth: number,
  edges: Array<{ from_node: string; to_node: string; type?: string }>,
  targetNodeQualifiedName: string,
  validEdgeTypes: string[] = ["CALLS", "HTTP_CALLS", "HANDLES"]
): "CALLS" | "HTTP_CALLS" | "HANDLES" {
  const defaultEdgeType = validEdgeTypes[0] || "CALLS";

  // For root nodes (depth 0), always use default
  if (nodeDepth === 0) {
    return defaultEdgeType as any;
  }

  // For non-root nodes, find incoming edge
  const incomingEdge = edges.find(
    (edge) => edge.to_node === targetNodeQualifiedName
  );
  if (incomingEdge && incomingEdge.type && validEdgeTypes.includes(incomingEdge.type)) {
    return incomingEdge.type as any;
  }

  return defaultEdgeType as any;
}
