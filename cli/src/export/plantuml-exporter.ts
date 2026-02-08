import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";
import { ALL_LAYERS, LAYER_COLORS } from "./types.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";

/**
 * PlantUML element entry for diagram generation
 * Contains element metadata for rendering from graph nodes
 */
interface PlantUMLElementEntry {
  id: string;
  name: string;
  type: string;
  description?: string;
}

/**
 * PlantUML Exporter - generates PlantUML syntax for diagram visualization
 * Supports all 12 layers
 *
 * Exports the model as PlantUML component diagram syntax with layers,
 * elements, relationships, and optional source references.
 */
export class PlantUMLExporter implements Exporter {
  name = "PlantUML";
  supportedLayers = ALL_LAYERS;

  async export(model: Model, options: ExportOptions = {}): Promise<string> {
    const span = isTelemetryEnabled
      ? startSpan("export.format.plantuml", {
          "export.layerCount": options.layers?.length || this.supportedLayers.length,
          "export.includeSources": options.includeSources === true,
        })
      : null;

    try {
      const lines: string[] = [];

      lines.push("@startuml");
      lines.push(`title "${this.escapeQuotes(model.manifest.name)}"`);
      lines.push("");

      if (model.manifest.description) {
        lines.push(`note top : "${this.escapeQuotes(model.manifest.description)}"`);
        lines.push("");
      }

      const layersToExport = options.layers || this.supportedLayers;
      const elementsByLayer = new Map<string, PlantUMLElementEntry[]>();
      const nodesByLayer = new Map<string, any[]>();

      // Collect nodes by layer from graph model
      for (const layerName of layersToExport) {
        const nodes = model.graph.getNodesByLayer(layerName);
        if (nodes.length === 0) continue;

        const layerElements: PlantUMLElementEntry[] = [];
        nodesByLayer.set(layerName, nodes);

        for (const node of nodes) {
          layerElements.push({
            id: node.id,
            name: node.name,
            type: node.type,
            description: node.description,
          });
        }
        elementsByLayer.set(layerName, layerElements);
      }

      // Create packages for each layer
      for (const layerName of layersToExport) {
        const elements = elementsByLayer.get(layerName);
        if (!elements || elements.length === 0) continue;

        const color = LAYER_COLORS[layerName] || "FFFFFF";
        lines.push(`package "${layerName}" #${color} {`);

        for (const { id, name, description } of elements) {
          lines.push(`  component "${this.escapeQuotes(name)}" as ${id}`);

          // Add source reference as note if includeSources option is enabled
          if (options.includeSources && description) {
            lines.push(`  note right of ${id}`);
            lines.push(`    ${this.escapeQuotes(description)}`);
            lines.push(`  end note`);
          }
        }

        lines.push("}");
        lines.push("");
      }

      // Add relationships from graph edges
      const edges = model.graph.getAllEdges();
      const exportedNodeIds = new Set<string>();
      for (const elements of elementsByLayer.values()) {
        for (const elem of elements) {
          exportedNodeIds.add(elem.id);
        }
      }

      for (const edge of edges) {
        // Only include edges between exported nodes
        if (exportedNodeIds.has(edge.source) && exportedNodeIds.has(edge.destination)) {
          const arrow = this.getArrowType(edge.predicate);
          lines.push(
            `${edge.source} ${arrow} ${edge.destination} : ${this.escapeQuotes(edge.predicate)}`
          );
        }
      }

      lines.push("");
      lines.push("@enduml");

      const result = lines.join("\n") + "\n";

      if (isTelemetryEnabled && span) {
        // Count total elements and relationships
        let totalElements = 0;
        let totalEdges = 0;

        for (const elements of elementsByLayer.values()) {
          totalElements += elements.length;
        }

        for (const edge of edges) {
          if (exportedNodeIds.has(edge.source) && exportedNodeIds.has(edge.destination)) {
            totalEdges++;
          }
        }

        (span as any).setAttribute("export.elementCount", totalElements);
        (span as any).setAttribute("export.relationshipCount", totalEdges);
        (span as any).setAttribute("export.size", result.length);
        (span as any).setStatus({ code: 0 });
      }

      return result;
    } catch (error) {
      if (isTelemetryEnabled && span) {
        (span as any).recordException(error as Error);
        (span as any).setStatus({
          code: 2,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      endSpan(span);
    }
  }

  /**
   * Get PlantUML arrow type based on predicate
   */
  private getArrowType(predicate: string): string {
    const arrowMap: Record<string, string> = {
      composes: "*--",
      aggregates: "o--",
      supports: "-->",
      realizes: "..|>",
      "flows-to": "-->",
      "refers-to": "..>",
    };
    return arrowMap[predicate] || "-->";
  }

  /**
   * Escape quotes for PlantUML syntax
   */
  private escapeQuotes(str: string): string {
    // Escape double quotes within strings for PlantUML
    return str.replace(/"/g, '\\"');
  }
}
