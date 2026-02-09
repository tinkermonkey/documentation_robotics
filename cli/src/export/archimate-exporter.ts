import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";
import { escapeXml } from "./types.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";

/**
 * ArchiMate XML Exporter for layers 1, 2, 4, 5
 * Generates valid ArchiMate 3.2 XML format
 */
export class ArchiMateExporter implements Exporter {
  name = "ArchiMate";
  supportedLayers = ["motivation", "business", "application", "technology"];

  async export(model: Model, options: ExportOptions = {}): Promise<string> {
    const span = isTelemetryEnabled
      ? startSpan("export.format.archimate", {
          "export.layerCount": options.layers?.length || this.supportedLayers.length,
        })
      : null;

    try {
      const lines: string[] = [];

      // XML declaration
      lines.push('<?xml version="1.0" encoding="UTF-8"?>');

      // Root element with namespaces
      lines.push('<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"');
      lines.push('       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
      lines.push(
        '       xsi:schemaLocation="http://www.opengroup.org/xsd/archimate/3.0/ http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd">'
      );

      // Model metadata
      lines.push(`  <name>${escapeXml(model.manifest.name)}</name>`);
      if (model.manifest.description) {
        lines.push(`  <documentation>${escapeXml(model.manifest.description)}</documentation>`);
      }

      // Export elements - query graph model directly
      lines.push("  <elements>");

      const layersToExport = options.layers || this.supportedLayers;
      const nodesByLayer: Array<{ layer: string; node: any }> = [];

      // Query graph model for nodes in supported layers
      for (const layerName of layersToExport) {
        if (!this.supportedLayers.includes(layerName)) continue;

        const nodes = model.graph.getNodesByLayer(layerName);
        for (const node of nodes) {
          nodesByLayer.push({ layer: layerName, node });
        }
      }

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("export.elementCount", nodesByLayer.length);
      }

      for (const { layer, node } of nodesByLayer) {
        const archiType = this.mapToArchiMateType(node.type, layer);
        lines.push(`    <element identifier="${node.id}" xsi:type="${archiType}">`);
        lines.push(`      <name>${escapeXml(node.name)}</name>`);

        if (node.description) {
          lines.push(`      <documentation>${escapeXml(node.description)}</documentation>`);
        }

        // Add properties section
        lines.push("      <properties>");

        // Add node properties
        const propKeys = Object.keys(node.properties || {});
        if (propKeys.length > 0) {
          for (const key of propKeys) {
            const val = node.properties[key];

            // Special handling for source reference structure
            if (key === "source" && val && typeof val === "object" && "reference" in val) {
              const flattenedProps = this.flattenSourceReference(val.reference);
              for (const [flatKey, flatValue] of Object.entries(flattenedProps)) {
                lines.push(
                  `        <property key="${escapeXml(flatKey)}" value="${escapeXml(String(flatValue))}" />`
                );
              }
            } else {
              const strValue = this.valueToString(val);
              lines.push(
                `        <property key="${escapeXml(key)}" value="${escapeXml(strValue)}" />`
              );
            }
          }
        }

        lines.push("      </properties>");
        lines.push("    </element>");
      }

      lines.push("  </elements>");

      // Export relationships - query graph model edges
      lines.push("  <relationships>");

      let relationshipCount = 0;
      const nodeIds = new Set(nodesByLayer.map((n) => n.node.id));
      const edges = model.graph.getAllEdges();

      // Filter edges to include only those between exported nodes
      for (const edge of edges) {
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.destination)) {
          continue;
        }

        lines.push(`    <relationship identifier="${this.escapeId(edge.id)}" `);
        lines.push(`                  source="${edge.source}" target="${edge.destination}" `);
        lines.push(`                  xsi:type="Association">`);
        lines.push(`      <name>${edge.predicate}</name>`);
        lines.push(`    </relationship>`);
        relationshipCount++;
      }

      lines.push("  </relationships>");
      lines.push("</model>");

      const result = lines.join("\n");

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("export.relationshipCount", relationshipCount);
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
   * Map element type and layer to ArchiMate type
   */
  private mapToArchiMateType(type: string, layer: string): string {
    const mapping: Record<string, Record<string, string>> = {
      motivation: {
        stakeholder: "Stakeholder",
        driver: "Driver",
        assessment: "Assessment",
        goal: "Goal",
        outcome: "Outcome",
        principle: "Principle",
        requirement: "Requirement",
        constraint: "Constraint",
      },
      business: {
        "business-actor": "BusinessActor",
        "business-role": "BusinessRole",
        "business-collaboration": "BusinessCollaboration",
        "business-interface": "BusinessInterface",
        "business-process": "BusinessProcess",
        "business-function": "BusinessFunction",
        "business-interaction": "BusinessInteraction",
        "business-event": "BusinessEvent",
        "business-service": "BusinessService",
        "business-object": "BusinessObject",
      },
      application: {
        "application-component": "ApplicationComponent",
        "application-collaboration": "ApplicationCollaboration",
        "application-interface": "ApplicationInterface",
        "application-function": "ApplicationFunction",
        "application-interaction": "ApplicationInteraction",
        "application-process": "ApplicationProcess",
        "application-event": "ApplicationEvent",
        "application-service": "ApplicationService",
        "data-object": "DataObject",
      },
      technology: {
        node: "Node",
        device: "Device",
        "system-software": "SystemSoftware",
        "technology-collaboration": "TechnologyCollaboration",
        "technology-interface": "TechnologyInterface",
        path: "Path",
        "communication-network": "CommunicationNetwork",
        "technology-function": "TechnologyFunction",
        "technology-process": "TechnologyProcess",
        "technology-interaction": "TechnologyInteraction",
        "technology-event": "TechnologyEvent",
        "technology-service": "TechnologyService",
        artifact: "Artifact",
      },
    };

    return mapping[layer]?.[type] || "Element";
  }

  /**
   * Escape ID characters for use in identifiers
   */
  private escapeId(str: string): string {
    return str.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  /**
   * Convert value to string representation
   */
  private valueToString(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return `[${value.map((v) => this.valueToString(v)).join(", ")}]`;
    if (value && typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  }

  /**
   * Flatten source reference structure into ArchiMate properties
   * Converts nested structure like { provenance: "extracted", locations: [...] }
   * into flat properties like "source.provenance", "source.file.0", etc.
   */
  private flattenSourceReference(sourceRef: any): Record<string, string> {
    const props: Record<string, string> = {};

    if (!sourceRef || typeof sourceRef !== "object") {
      return props;
    }

    // Add provenance
    if (sourceRef.provenance) {
      props["source.provenance"] = sourceRef.provenance;
    }

    // Add locations
    if (Array.isArray(sourceRef.locations)) {
      sourceRef.locations.forEach((location: any, index: number) => {
        if (location.file) {
          props[`source.file.${index}`] = location.file;
        }
        if (location.symbol) {
          props[`source.symbol.${index}`] = location.symbol;
        }
        if (location.line !== undefined) {
          props[`source.line.${index}`] = String(location.line);
        }
        if (location.column !== undefined) {
          props[`source.column.${index}`] = String(location.column);
        }
      });
    }

    // Add repository info
    if (sourceRef.repository) {
      if (sourceRef.repository.url) {
        props["source.repository.url"] = sourceRef.repository.url;
      }
      if (sourceRef.repository.commit) {
        props["source.repository.commit"] = sourceRef.repository.commit;
      }
      if (sourceRef.repository.branch) {
        props["source.repository.branch"] = sourceRef.repository.branch;
      }
    }

    return props;
  }
}
