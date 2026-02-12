import type { Model } from "../core/model.js";
import type { GraphNode } from "../core/graph-model.js";
import { formatLayerName } from "../utils/layer-name-formatter.js";
import { CANONICAL_LAYER_NAMES } from "../core/layers.js";
import {
  escapeMarkdown,
  valueToMarkdown,
  getLayerDescription,
} from "./markdown-utils.js";

/**
 * Maximum number of elements to show in element details section
 */
const MAX_DETAIL_ELEMENTS = 10;

/**
 * Options for markdown generation
 */
export interface MarkdownGeneratorOptions {
  includeMermaid?: boolean; // Include Mermaid diagrams
  includeTables?: boolean; // Include formatted tables
  maxTableRows?: number; // Maximum rows per table before truncating with overflow message
  diagramType?: "graph" | "flowchart"; // Type of Mermaid diagram
  includeSourceReferences?: boolean; // Include source code references
}

/**
 * MarkdownGenerator - generates enhanced markdown with Mermaid diagrams and tables
 *
 * Features:
 * - Mermaid diagram generation for architecture layers
 * - Formatted markdown tables with improved styling
 * - Layer-specific visualizations
 * - Cross-layer relationship diagrams
 * - Table row truncation with overflow message (tables capped at maxTableRows)
 */
export class MarkdownGenerator {
  private model: Model;
  private options: Required<MarkdownGeneratorOptions>;

  constructor(model: Model, options: MarkdownGeneratorOptions = {}) {
    this.model = model;
    this.options = {
      includeMermaid: options.includeMermaid ?? true,
      includeTables: options.includeTables ?? true,
      maxTableRows: options.maxTableRows ?? 50,
      diagramType: options.diagramType ?? "graph",
      includeSourceReferences: options.includeSourceReferences ?? false,
    };
  }

  /**
   * Generate complete markdown documentation with diagrams and tables
   */
  async generate(): Promise<string> {
    const lines: string[] = [];

    // Header
    lines.push(`# ${this.escapeMarkdownLocal(this.model.manifest.name)}`);
    lines.push("");

    if (this.model.manifest.description) {
      lines.push(this.model.manifest.description);
      lines.push("");
    }

    // Table of Contents
    lines.push("## Table of Contents");
    lines.push("");
    lines.push("- [Architecture Overview](#architecture-overview)");
    lines.push("- [Layer Summary](#layer-summary)");
    lines.push("- [Detailed Layer Documentation](#detailed-layer-documentation)");
    lines.push("");

    // Architecture Overview Section
    lines.push("## Architecture Overview");
    lines.push("");

    if (this.options.includeMermaid) {
      lines.push(this.generateArchitectureOverviewDiagram());
      lines.push("");
    }

    // Model metadata
    lines.push("### Model Information");
    lines.push("");
    lines.push(this.generateModelMetadataTable());
    lines.push("");

    // Layer Summary
    lines.push("## Layer Summary");
    lines.push("");
    lines.push(this.generateLayerSummaryTable());
    lines.push("");

    // Detailed Layer Documentation
    lines.push("## Detailed Layer Documentation");
    lines.push("");

    const layers = Array.from(this.model.graph.nodes.values())
      .reduce((acc, node) => {
        if (!acc.includes(node.layer)) {
          acc.push(node.layer);
        }
        return acc;
      }, [] as string[])
      .sort();

    for (const layerName of layers) {
      const layerNodes = this.model.graph.getNodesByLayer(layerName);
      if (layerNodes.length === 0) continue;

      lines.push(`### ${this.formatLayerName(layerName)}`);
      lines.push("");

      lines.push(this.getLayerDescriptionText(layerName));
      lines.push("");

      // Layer diagram
      if (this.options.includeMermaid) {
        lines.push(this.generateLayerDiagram(layerNodes));
        lines.push("");
      }

      // Elements table
      if (this.options.includeTables) {
        lines.push(this.generateLayerElementsTable(layerNodes));
        lines.push("");
      }

      // Element details
      lines.push("#### Element Details");
      lines.push("");
      lines.push(this.generateElementDetailsMarkdown(layerNodes));
      lines.push("");
    }

    // Architecture Statistics
    lines.push("## Architecture Statistics");
    lines.push("");
    lines.push(this.generateStatisticsTable());
    lines.push("");

    // Relationships Summary
    lines.push("## Relationships Summary");
    lines.push("");
    lines.push(this.generateRelationshipsSummaryTable());
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Generate architecture overview diagram
   */
  private generateArchitectureOverviewDiagram(): string {
    const lines: string[] = [];
    lines.push("```mermaid");
    lines.push("graph TD");

    const layerNodeCounts = new Map<string, number>();

    // Count nodes per layer
    for (const node of this.model.graph.nodes.values()) {
      const count = layerNodeCounts.get(node.layer) || 0;
      layerNodeCounts.set(node.layer, count + 1);
    }

    // Create layer nodes in diagram
    for (const layer of CANONICAL_LAYER_NAMES) {
      const count = layerNodeCounts.get(layer) || 0;
      if (count > 0) {
        const displayName = `${this.formatLayerName(layer)}<br/>(${count} elements)`;
        lines.push(`  ${this.sanitizeId(layer)}["${displayName}"]`);
      }
    }

    // Add connections between consecutive non-empty layers
    let lastLayer: string | null = null;
    for (const layer of CANONICAL_LAYER_NAMES) {
      if ((layerNodeCounts.get(layer) || 0) > 0) {
        if (lastLayer) {
          lines.push(
            `  ${this.sanitizeId(lastLayer)} --> ${this.sanitizeId(layer)}`
          );
        }
        lastLayer = layer;
      }
    }

    lines.push("```");
    return lines.join("\n");
  }

  /**
   * Generate diagram for a specific layer
   */
  private generateLayerDiagram(nodes: GraphNode[]): string {
    if (nodes.length === 0) return "";

    const lines: string[] = [];
    lines.push("```mermaid");

    switch (this.options.diagramType) {
      case "flowchart":
        lines.push(this.generateLayerFlowchart(nodes));
        break;
      default:
        lines.push(this.generateLayerGraph(nodes));
    }

    lines.push("```");
    return lines.join("\n");
  }

  /**
   * Generate layer graph diagram
   */
  private generateLayerGraph(nodes: GraphNode[]): string {
    const lines: string[] = [];
    lines.push("graph LR");

    // Add nodes
    for (const node of nodes) {
      const nodeId = this.sanitizeId(node.id);
      const label = `${node.name}<br/>(${node.type})`;
      lines.push(`  ${nodeId}["${this.escapeMarkdownLocal(label)}"]`);
    }

    // Add edges between nodes in the same layer
    const edges = this.model.graph.getAllEdges();
    const nodeIds = new Set(nodes.map((n) => n.id));

    for (const edge of edges) {
      if (nodeIds.has(edge.source) && nodeIds.has(edge.destination)) {
        const sourceId = this.sanitizeId(edge.source);
        const destId = this.sanitizeId(edge.destination);
        const label = edge.predicate;
        lines.push(`  ${sourceId} -->|"${label}"| ${destId}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Generate flowchart for a layer
   */
  private generateLayerFlowchart(nodes: GraphNode[]): string {
    const lines: string[] = [];
    lines.push("flowchart TD");

    // Add nodes
    for (const node of nodes) {
      const nodeId = this.sanitizeId(node.id);
      const label = `${node.name}`;
      lines.push(`  ${nodeId}["${this.escapeMarkdownLocal(label)}"]`);
    }

    // Add edges
    const edges = this.model.graph.getAllEdges();
    const nodeIds = new Set(nodes.map((n) => n.id));

    for (const edge of edges) {
      if (nodeIds.has(edge.source) && nodeIds.has(edge.destination)) {
        const sourceId = this.sanitizeId(edge.source);
        const destId = this.sanitizeId(edge.destination);
        lines.push(`  ${sourceId} -->|"${edge.predicate}"| ${destId}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Generate model metadata table
   */
  private generateModelMetadataTable(): string {
    const rows: string[] = [];
    rows.push("| Property | Value |");
    rows.push("|----------|-------|");

    rows.push(`| Name | ${this.escapeMarkdownLocal(this.model.manifest.name)} |`);
    rows.push(`| Version | ${this.model.manifest.version || "1.0.0"} |`);

    if (this.model.manifest.author) {
      rows.push(`| Author | ${this.escapeMarkdownLocal(this.model.manifest.author)} |`);
    }

    if (this.model.manifest.created) {
      rows.push(`| Created | ${this.model.manifest.created} |`);
    }

    if (this.model.manifest.modified) {
      rows.push(`| Modified | ${this.model.manifest.modified} |`);
    }

    return rows.join("\n");
  }

  /**
   * Generate layer summary table
   */
  private generateLayerSummaryTable(): string {
    const rows: string[] = [];
    rows.push("| Layer | Elements | Relationships | Description |");
    rows.push("|-------|----------|----------------|-------------|");

    const layerOrder = [
      "motivation",
      "business",
      "security",
      "application",
      "technology",
      "api",
      "data-model",
      "data-store",
      "ux",
      "navigation",
      "apm",
      "testing",
    ];

    for (const layer of layerOrder) {
      const nodes = this.model.graph.getNodesByLayer(layer);
      if (nodes.length === 0) continue;

      const edges = this.model.graph.getAllEdges();
      const nodeIds = new Set(nodes.map((n) => n.id));
      const layerRelationships = edges.filter(
        (e) => nodeIds.has(e.source) && nodeIds.has(e.destination)
      ).length;

      const description = this.getLayerDescriptionText(layer).split("\n")[0];

      rows.push(
        `| ${this.formatLayerName(layer)} | ${nodes.length} | ${layerRelationships} | ${description} |`
      );
    }

    return rows.join("\n");
  }

  /**
   * Generate elements table for a layer
   */
  private generateLayerElementsTable(nodes: GraphNode[]): string {
    const rows: string[] = [];
    rows.push("| Element ID | Name | Type | Description |");
    rows.push("|-----------|------|------|-------------|");

    for (const node of nodes.slice(0, this.options.maxTableRows)) {
      const id = this.escapeMarkdownLocal(node.id);
      const name = this.escapeMarkdownLocal(node.name);
      const type = this.escapeMarkdownLocal(node.type);
      // Truncate description to 100 characters and escape markdown
      const desc = node.description
        ? this.escapeMarkdownLocal(node.description.substring(0, 100))
        : "";

      rows.push(`| \`${id}\` | ${name} | ${type} | ${desc} |`);
    }

    if (nodes.length > this.options.maxTableRows) {
      rows.push(
        `| ... | ... | ... | ${nodes.length - this.options.maxTableRows} more elements |`
      );
    }

    return rows.join("\n");
  }

  /**
   * Generate element details markdown
   */
  private generateElementDetailsMarkdown(nodes: GraphNode[]): string {
    const details: string[] = [];

    for (const node of nodes.slice(0, MAX_DETAIL_ELEMENTS)) {
      // Limit to first MAX_DETAIL_ELEMENTS for readability
      details.push(`##### ${this.escapeMarkdownLocal(node.name)} (\`${node.id}\`)`);
      details.push("");

      if (node.description) {
        details.push(`${node.description}`);
        details.push("");
      }

      details.push(`**Type:** \`${node.type}\``);
      details.push("");

      // Properties
      if (Object.keys(node.properties).length > 0) {
        details.push("**Properties:**");
        details.push("");

        const propRows: string[] = [];
        propRows.push("| Property | Value |");
        propRows.push("|----------|-------|");

        for (const [key, value] of Object.entries(node.properties)) {
          const displayValue = this.valueToString(value);
          propRows.push(`| \`${key}\` | ${displayValue} |`);
        }

        details.push(propRows.join("\n"));
        details.push("");
      }

      // Outgoing relationships
      const outgoing = this.model.graph.getEdgesFrom(node.id);
      if (outgoing.length > 0) {
        details.push("**Outgoing Relationships:**");
        details.push("");

        for (const edge of outgoing) {
          const targetNode = this.model.graph.getNode(edge.destination);
          const targetName = targetNode?.name || edge.destination;
          details.push(
            `- **${edge.predicate}**: \`${edge.destination}\` (${targetName})`
          );
        }
        details.push("");
      }

      // Incoming relationships
      const incoming = this.model.graph.getEdgesTo(node.id);
      if (incoming.length > 0) {
        details.push("**Incoming Relationships:**");
        details.push("");

        for (const edge of incoming) {
          const sourceNode = this.model.graph.getNode(edge.source);
          const sourceName = sourceNode?.name || edge.source;
          details.push(
            `- **${edge.predicate}** from: \`${edge.source}\` (${sourceName})`
          );
        }
        details.push("");
      }
    }

    if (nodes.length > MAX_DETAIL_ELEMENTS) {
      details.push(`*... and ${nodes.length - MAX_DETAIL_ELEMENTS} more elements*`);
      details.push("");
    }

    return details.join("\n");
  }

  /**
   * Generate statistics table
   */
  private generateStatisticsTable(): string {
    let totalElements = 0;
    let totalEdges = 0;
    const layerCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();

    // Count statistics
    for (const node of this.model.graph.nodes.values()) {
      totalElements++;
      layerCounts.set(node.layer, (layerCounts.get(node.layer) || 0) + 1);
      typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1);
    }

    totalEdges = this.model.graph.getAllEdges().length;

    const rows: string[] = [];
    rows.push("| Metric | Value |");
    rows.push("|--------|-------|");
    rows.push(`| Total Elements | ${totalElements} |`);
    rows.push(`| Total Relationships | ${totalEdges} |`);
    rows.push(`| Layers with Content | ${layerCounts.size} |`);
    rows.push(`| Element Types | ${typeCounts.size} |`);

    return rows.join("\n");
  }

  /**
   * Generate relationships summary table
   */
  private generateRelationshipsSummaryTable(): string {
    const predicateCounts = new Map<string, number>();
    const edges = this.model.graph.getAllEdges();

    for (const edge of edges) {
      predicateCounts.set(edge.predicate, (predicateCounts.get(edge.predicate) || 0) + 1);
    }

    const rows: string[] = [];
    rows.push("| Relationship Type | Count |");
    rows.push("|-------------------|-------|");

    // Sort by count descending
    const sorted = Array.from(predicateCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20); // Top 20

    for (const [predicate, count] of sorted) {
      rows.push(`| \`${predicate}\` | ${count} |`);
    }

    if (predicateCounts.size > 20) {
      rows.push(`| ... | ${predicateCounts.size - 20} more types |`);
    }

    return rows.join("\n");
  }

  /**
   * Get description for a layer (delegates to shared utility)
   */
  private getLayerDescriptionText(layer: string): string {
    return getLayerDescription(layer);
  }

  /**
   * Format layer name for display (delegates to centralized formatter)
   */
  private formatLayerName(layer: string): string {
    return formatLayerName(layer);
  }

  /**
   * Sanitize ID for use in Mermaid diagrams
   */
  private sanitizeId(id: string): string {
    return id
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/^[0-9]/, "_$&")
      .substring(0, 100);
  }

  /**
   * Escape markdown special characters (delegates to shared utility)
   */
  private escapeMarkdownLocal(str: string): string {
    return escapeMarkdown(str);
  }

  /**
   * Convert value to string for display (delegates to shared utility)
   */
  private valueToString(value: unknown): string {
    return valueToMarkdown(value);
  }
}
