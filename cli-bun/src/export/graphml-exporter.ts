import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";
import { ALL_LAYERS, LAYER_COLORS, escapeXml } from "./types.js";

/**
 * GraphML Exporter - generates GraphML format for graph visualization tools
 * GraphML is an XML-based format supported by tools like yEd, Cytoscape, etc.
 */
export class GraphMLExporter implements Exporter {
  name = "GraphML";
  supportedLayers = ALL_LAYERS;

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
      `    <data key="name">${escapeXml(model.manifest.name)}</data>`
    );

    const layersToExport = options.layers || this.supportedLayers;
    const elementMap = new Map<string, { layer: string; type: string; description?: string }>();

    // Add all nodes (elements)
    for (const layerName of layersToExport) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      for (const element of layer.listElements()) {
        const color = LAYER_COLORS[layerName] || "#FFFFFF";

        lines.push(`    <node id="${element.id}">`);
        lines.push(`      <data key="name">${escapeXml(element.name)}</data>`);
        lines.push(`      <data key="node_layer">${layerName}</data>`);
        lines.push(`      <data key="node_type">${element.type}</data>`);

        if (element.description) {
          lines.push(
            `      <data key="node_description">${escapeXml(element.description)}</data>`
          );
        }

        // Add visualization hints using yEd extensions (optional)
        lines.push(`      <graphics x="0" y="0" w="150" h="50" fill="${color}" type="rectangle"/>`);
        lines.push(`      <data key="d6">`);
        lines.push(`        <y:ShapeNode>`);
        lines.push(`          <y:NodeLabel>${escapeXml(element.name)}</y:NodeLabel>`);
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
          if (!elementMap.has(ref.target)) {
            // Log warning for dangling reference (in verbose mode this could be extended)
            continue;
          }
          lines.push(
            `    <edge id="e${edgeCounter}" source="${element.id}" target="${ref.target}">`
          );
          lines.push(`      <data key="edge_type">${ref.type}</data>`);
          lines.push(`      <data key="name">${escapeXml(ref.type)}</data>`);

          if (ref.description) {
            lines.push(
              `      <data key="description">${escapeXml(ref.description)}</data>`
            );
          }

          lines.push(`    </edge>`);
          edgeCounter++;
        }

        // Intra-layer relationships
        for (const rel of element.relationships) {
          if (!elementMap.has(rel.target)) {
            // Skip relationships to non-existent targets
            continue;
          }
          lines.push(
            `    <edge id="e${edgeCounter}" source="${element.id}" target="${rel.target}">`
          );
          lines.push(`      <data key="edge_type">${rel.predicate}</data>`);
          lines.push(`      <data key="name">${escapeXml(rel.predicate)}</data>`);
          lines.push(`    </edge>`);
          edgeCounter++;
        }
      }
    }

    lines.push(`  </graph>`);
    lines.push(`</graphml>`);

    return lines.join("\n");
  }
}
