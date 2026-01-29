import type { Model } from "../core/model.js";
import type { Element } from "../core/element.js";
import type { Exporter, ExportOptions } from "./types.js";
import { ALL_LAYERS, LAYER_COLORS } from "./types.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";

/**
 * PlantUML element entry for diagram generation
 * Contains element metadata and reference for rendering
 */
interface PlantUMLElementEntry {
  id: string;
  name: string;
  type: string;
  element: Element;
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
    const span = isTelemetryEnabled ? startSpan('export.format.plantuml', {
      'export.layerCount': options.layers?.length || this.supportedLayers.length,
      'export.includeSources': options.includeSources === true,
    }) : null;

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

    // Collect elements by layer
    for (const layerName of layersToExport) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      const layerElements: PlantUMLElementEntry[] = [];
      for (const element of layer.listElements()) {
        layerElements.push({
          id: element.id,
          name: element.name,
          type: element.type,
          element: element,
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

      for (const { id, name, element } of elements) {
        lines.push(`  component "${this.escapeQuotes(name)}" as ${id}`);

        // Add source reference as note if includeSources option is enabled
        if (options.includeSources) {
          const sourceRef = element.getSourceReference();
          if (sourceRef && sourceRef.locations.length > 0) {
            const loc = sourceRef.locations[0];
            lines.push(`  note right of ${id}`);
            lines.push(`    Source: ${this.escapeQuotes(loc.file)}`);
            if (loc.symbol) {
              lines.push(`    Symbol: ${this.escapeQuotes(loc.symbol)}`);
            }
            lines.push(`  end note`);
          }
        }
      }

      lines.push("}");
      lines.push("");
    }

    // Add relationships
    for (const layerName of layersToExport) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      for (const element of layer.listElements()) {
        // Cross-layer references
        for (const ref of element.references) {
          const refType = ref.type || "references";
          lines.push(
            `${element.id} --> ${ref.target} : ${this.escapeQuotes(refType)}`
          );
        }

        // Intra-layer relationships
        for (const rel of element.relationships) {
          const predicate = rel.predicate || "relates-to";
          lines.push(
            `${element.id} ..> ${rel.target} : ${this.escapeQuotes(predicate)}`
          );
        }
      }
    }

    lines.push("");
    lines.push("@enduml");

      const result = lines.join("\n") + "\n";

      if (isTelemetryEnabled && span) {
        // Count total elements, references, and relationships
        let totalElements = 0;
        let totalReferences = 0;
        let totalRelationships = 0;

        for (const elements of elementsByLayer.values()) {
          totalElements += elements.length;
          for (const { element } of elements) {
            totalReferences += element.references.length;
            totalRelationships += element.relationships.length;
          }
        }

        (span as any).setAttribute('export.elementCount', totalElements);
        (span as any).setAttribute('export.referenceCount', totalReferences);
        (span as any).setAttribute('export.relationshipCount', totalRelationships);
        (span as any).setAttribute('export.size', result.length);
        (span as any).setStatus({ code: 0 });
      }

      return result;
    } catch (error) {
      if (isTelemetryEnabled && span) {
        (span as any).recordException(error as Error);
        (span as any).setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    } finally {
      endSpan(span);
    }
  }

  /**
   * Escape quotes for PlantUML syntax
   */
  private escapeQuotes(str: string): string {
    // Escape double quotes within strings for PlantUML
    return str.replace(/"/g, '\\"');
  }
}
