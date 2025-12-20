import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";

/**
 * GraphML Exporter - generates GraphML format for graph visualization tools
 * GraphML is an XML-based format supported by tools like yEd, Cytoscape, etc.
 */
export class GraphMLExporter implements Exporter {
  name = "GraphML";
  supportedLayers = [
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

  private readonly layerColors: Record<string, string> = {
    motivation: "#FFE4E1",
    business: "#E6F3FF",
    security: "#FFE6E6",
    application: "#E6FFE6",
    technology: "#FFFFE6",
    api: "#F0E6FF",
    "data-model": "#E6F0FF",
    "data-store": "#FFE6F0",
    ux: "#FFCCCC",
    navigation: "#CCFFCC",
    apm: "#CCFFFF",
    testing: "#FFCCFF",
  };

  async export(model: Model, options: ExportOptions = {}): Promise<string> {
    const lines: string[] = [];

    // XML declaration
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');

    // GraphML root element
    lines.push(
      '<graphml xmlns="http://graphml.graphdrawing.org/xmlns"'
    );
    lines.push(
      '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
    );
    lines.push(
      '         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd"'
    );
    lines.push('         edgedefault="directed">');

    // Define graph attributes
    lines.push('  <key id="node_description" for="node" attr.name="description" attr.type="string"/>');
    lines.push('  <key id="node_layer" for="node" attr.name="layer" attr.type="string"/>');
    lines.push('  <key id="node_type" for="node" attr.name="type" attr.type="string"/>');
    lines.push('  <key id="edge_type" for="edge" attr.name="type" attr.type="string"/>');

    // Create main graph
    lines.push(
      `  <graph id="model" edgedefault="directed">`
    );
    lines.push(
      `    <data key="name">${this.escapeXml(model.manifest.name)}</data>`
    );

    const layersToExport = options.layers || this.supportedLayers;
    const elementMap = new Map<string, { layer: string; type: string; description?: string }>();

    // Add all nodes (elements)
    for (const layerName of layersToExport) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      for (const element of layer.listElements()) {
        const color = this.layerColors[layerName] || "#FFFFFF";

        lines.push(`    <node id="${element.id}">`);
        lines.push(`      <data key="name">${this.escapeXml(element.name)}</data>`);
        lines.push(`      <data key="node_layer">${layerName}</data>`);
        lines.push(`      <data key="node_type">${element.type}</data>`);

        if (element.description) {
          lines.push(
            `      <data key="node_description">${this.escapeXml(element.description)}</data>`
          );
        }

        // Add visualization hints using yEd extensions (optional)
        lines.push(`      <graphics x="0" y="0" w="150" h="50" fill="${color}" type="rectangle"/>`);
        lines.push(`      <data key="d6">`);
        lines.push(`        <y:ShapeNode>`);
        lines.push(`          <y:NodeLabel>${this.escapeXml(element.name)}</y:NodeLabel>`);
        lines.push(`        </y:ShapeNode>`);
        lines.push(`      </data>`);

        lines.push(`    </node>`);

        elementMap.set(element.id, {
          layer: layerName,
          type: element.type,
          description: element.description,
        });
      }
    }

    // Add all edges (relationships and references)
    let edgeCounter = 0;

    for (const layerName of layersToExport) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      for (const element of layer.listElements()) {
        // Cross-layer references
        for (const ref of element.references) {
          if (elementMap.has(ref.target)) {
            lines.push(
              `    <edge id="e${edgeCounter}" source="${element.id}" target="${ref.target}">`
            );
            lines.push(`      <data key="edge_type">${ref.type}</data>`);
            lines.push(`      <data key="name">${this.escapeXml(ref.type)}</data>`);

            if (ref.description) {
              lines.push(
                `      <data key="description">${this.escapeXml(ref.description)}</data>`
              );
            }

            lines.push(`    </edge>`);
            edgeCounter++;
          }
        }

        // Intra-layer relationships
        for (const rel of element.relationships) {
          if (elementMap.has(rel.target)) {
            lines.push(
              `    <edge id="e${edgeCounter}" source="${element.id}" target="${rel.target}">`
            );
            lines.push(`      <data key="edge_type">${rel.predicate}</data>`);
            lines.push(`      <data key="name">${this.escapeXml(rel.predicate)}</data>`);
            lines.push(`    </edge>`);
            edgeCounter++;
          }
        }
      }
    }

    lines.push(`  </graph>`);
    lines.push(`</graphml>`);

    return lines.join("\n");
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
