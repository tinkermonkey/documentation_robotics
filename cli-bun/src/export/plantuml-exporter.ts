import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";
import { ALL_LAYERS, LAYER_COLORS } from "./types.js";

/**
 * PlantUML Exporter - generates PlantUML syntax for diagram visualization
 * Supports all 12 layers
 */
export class PlantUMLExporter implements Exporter {
  name = "PlantUML";
  supportedLayers = ALL_LAYERS;

  async export(model: Model, options: ExportOptions = {}): Promise<string> {
    const lines: string[] = [];

    lines.push("@startuml");
    lines.push(`title "${this.escapeQuotes(model.manifest.name)}"`);
    lines.push("");

    if (model.manifest.description) {
      lines.push(`note top : "${this.escapeQuotes(model.manifest.description)}"`);
      lines.push("");
    }

    const layersToExport = options.layers || this.supportedLayers;
    const elementsByLayer = new Map<string, Array<{ id: string; name: string; type: string }>>();

    // Collect elements by layer
    for (const layerName of layersToExport) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      const layerElements: Array<{ id: string; name: string; type: string }> = [];
      for (const element of layer.listElements()) {
        layerElements.push({
          id: element.id,
          name: element.name,
          type: element.type,
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

      for (const { id, name } of elements) {
        lines.push(`  component "${this.escapeQuotes(name)}" as ${id}`);
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

    return lines.join("\n") + "\n";
  }

  /**
   * Escape quotes for PlantUML syntax
   */
  private escapeQuotes(str: string): string {
    // Escape double quotes within strings for PlantUML
    return str.replace(/"/g, '\\"');
  }
}
