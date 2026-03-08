import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";
import { ALL_LAYERS, LAYER_COLORS } from "./types.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { getErrorMessage } from "../utils/errors.js";

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
      // Map from raw graph node ID → sanitized PlantUML ID for edge rendering
      const rawToPlantUMLId = new Map<string, string>();

      // Collect nodes by layer from graph model
      for (const layerName of layersToExport) {
        const nodes = model.graph.getNodesByLayer(layerName);
        if (nodes.length === 0) continue;

        const layerElements: PlantUMLElementEntry[] = [];
        nodesByLayer.set(layerName, nodes);

        for (const node of nodes) {
          const pumlId = this.toPlantUMLId(node.id);
          rawToPlantUMLId.set(node.id, pumlId);
          layerElements.push({
            id: pumlId,
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

        const nodes = nodesByLayer.get(layerName) || [];
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          lines.push(`  component "${this.escapeQuotes(element.name)}" as ${element.id}`);

          // Add source reference as note if includeSources option is enabled
          if (options.includeSources) {
            const node = nodes[i];
            const sourceRef = this.extractSourceReference(node);
            if (sourceRef) {
              lines.push(`  note right of ${element.id}`);
              lines.push(`    ${this.escapeQuotes(sourceRef)}`);
              lines.push(`  end note`);
            }
          }
        }

        lines.push("}");
        lines.push("");
      }

      // Add relationships from graph edges
      const edges = model.graph.getAllEdges();

      for (const edge of edges) {
        // Only include edges between exported nodes (check raw IDs)
        const srcPuml = rawToPlantUMLId.get(edge.source);
        const dstPuml = rawToPlantUMLId.get(edge.destination);
        if (srcPuml && dstPuml) {
          const arrow = this.getArrowType(edge.predicate);
          lines.push(
            `${srcPuml} ${arrow} ${dstPuml} : ${this.escapeQuotes(edge.predicate)}`
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
          if (rawToPlantUMLId.has(edge.source) && rawToPlantUMLId.has(edge.destination)) {
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
          message: getErrorMessage(error),
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
   * Extract and format source reference from node properties
   */
  private extractSourceReference(node: any): string | null {
    if (!node) return null;

    // Try node.source_reference first (primary field on GraphNode)
    let sourceRef = node.source_reference;

    // Fall back to x-source-reference in properties
    if (!sourceRef) {
      sourceRef = node.properties?.["x-source-reference"];
    }

    // Fall back to nested source.reference format
    if (!sourceRef && node.properties?.source?.reference) {
      sourceRef = node.properties.source.reference;
    }

    if (!sourceRef) return null;

    // Format source reference for display
    const parts: string[] = [];

    if (Array.isArray(sourceRef.locations) && sourceRef.locations.length > 0) {
      const location = sourceRef.locations[0];
      if (location.file) {
        parts.push(`Source: ${location.file}`);
      }
      if (location.symbol) {
        parts.push(`Symbol: ${location.symbol}`);
      }
    }

    if (sourceRef.repository?.url) {
      parts.push(`Repo: ${sourceRef.repository.url}`);
      if (sourceRef.repository.commit) {
        parts.push(`Commit: ${sourceRef.repository.commit.substring(0, 8)}`);
      }
    }

    return parts.length > 0 ? parts.join("\\n") : null;
  }

  /**
   * Escape quotes for PlantUML syntax
   */
  private escapeQuotes(str: string): string {
    // Escape double quotes within strings for PlantUML
    return str.replace(/"/g, '\\"');
  }

  /**
   * Convert a raw element ID (path or UUID) to a valid PlantUML identifier.
   * PlantUML identifiers cannot contain dots or hyphens, so replace with underscores.
   */
  private toPlantUMLId(id: string): string {
    return id.replace(/[.\-]/g, "_");
  }
}
