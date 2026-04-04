/**
 * Mermaid diagram utilities
 */

/**
 * Sanitize text for use as a Mermaid diagram node ID
 * Replaces all non-alphanumeric characters with underscores
 * @param text The text to sanitize
 * @returns Sanitized ID safe for use in Mermaid diagrams
 */
export function sanitizeMermaidId(text: string): string {
  return text.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Build a Mermaid left-to-right flowchart with a subgraph
 * @param subgraphId The ID of the subgraph (will be sanitized)
 * @param nodes Array of nodes with id and label
 * @param edges Array of edges with from, to, and optional label
 * @returns Mermaid flowchart code as a string
 */
export function buildMermaidFlowchartLR(
  subgraphId: string,
  nodes: Array<{ id: string; label: string }>,
  edges: Array<{ from: string; to: string; label?: string }>
): string {
  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("flowchart LR");
  lines.push(`  subgraph ${sanitizeMermaidId(subgraphId)}`);

  // Add nodes
  for (const node of nodes) {
    const nodeId = sanitizeMermaidId(node.id);
    lines.push(`    ${nodeId}["${node.label}"]`);
  }

  // Add edges
  for (const edge of edges) {
    const fromId = sanitizeMermaidId(edge.from);
    const toId = sanitizeMermaidId(edge.to);
    if (edge.label) {
      lines.push(`    ${fromId} -->|${edge.label}| ${toId}`);
    } else {
      lines.push(`    ${fromId} --> ${toId}`);
    }
  }

  lines.push("  end");
  lines.push("```");
  return lines.join("\n");
}

/**
 * Build a Mermaid top-to-bottom flowchart for inter-layer dependencies
 * @param layers Array of layer objects with id and label
 * @param edges Array of edges with from and to layer IDs
 * @param currentLayerId The ID of the current layer to highlight (optional)
 * @returns Mermaid flowchart code as a string
 */
export function buildMermaidFlowchartTB(
  layers: Array<{ id: string; label: string }>,
  edges: Array<{ from: string; to: string }>,
  currentLayerId?: string
): string {
  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("flowchart TB");
  lines.push('  classDef current fill:#f9f,stroke:#333,stroke-width:2px');

  // Add layer nodes
  for (const layer of layers) {
    const layerId = sanitizeMermaidId(layer.id);
    lines.push(`  ${layerId}["${layer.label}"]`);
  }

  // Add edges
  for (const edge of edges) {
    const fromId = sanitizeMermaidId(edge.from);
    const toId = sanitizeMermaidId(edge.to);
    lines.push(`  ${fromId} --> ${toId}`);
  }

  // Apply current layer styling if provided
  if (currentLayerId) {
    const currentId = sanitizeMermaidId(currentLayerId);
    lines.push(`  class ${currentId} current`);
  }

  lines.push("```");
  return lines.join("\n");
}
