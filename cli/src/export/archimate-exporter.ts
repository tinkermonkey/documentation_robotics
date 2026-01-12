import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";
import type { SourceLocation } from "../types/index.js";
import { escapeXml } from "./types.js";

/**
 * ArchiMate XML Exporter for layers 1, 2, 4, 5
 * Generates valid ArchiMate 3.2 XML format
 */
export class ArchiMateExporter implements Exporter {
  name = "ArchiMate";
  supportedLayers = ["motivation", "business", "application", "technology"];

  async export(model: Model, options: ExportOptions = {}): Promise<string> {
    const lines: string[] = [];

    // XML declaration
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');

    // Root element with namespaces
    lines.push(
      '<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"'
    );
    lines.push(
      '       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
    );
    lines.push(
      '       xsi:schemaLocation="http://www.opengroup.org/xsd/archimate/3.0/ http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd">'
    );

    // Model metadata
    lines.push(`  <name>${escapeXml(model.manifest.name)}</name>`);
    if (model.manifest.description) {
      lines.push(
        `  <documentation>${escapeXml(model.manifest.description)}</documentation>`
      );
    }

    // Export elements
    lines.push("  <elements>");

    const layersToExport = options.layers || this.supportedLayers;
    const elements: Array<{ layer: string; element: any }> = [];

    for (const layerName of layersToExport) {
      if (!this.supportedLayers.includes(layerName)) continue;

      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      for (const element of layer.listElements()) {
        elements.push({ layer: layerName, element });
      }
    }

    for (const { layer, element } of elements) {
      const archiType = this.mapToArchiMateType(element.type, layer);
      lines.push(`    <element identifier="${element.id}" xsi:type="${archiType}">`);
      lines.push(`      <name>${escapeXml(element.name)}</name>`);

      if (element.description) {
        lines.push(
          `      <documentation>${escapeXml(element.description)}</documentation>`
        );
      }

      // Add properties section
      lines.push("      <properties>");

      // Add source reference as properties if present
      const sourceRef = element.getSourceReference();
      if (sourceRef) {
        lines.push(`        <property key="source.provenance" value="${escapeXml(sourceRef.provenance)}" />`);

        sourceRef.locations.forEach((loc: SourceLocation, idx: number) => {
          lines.push(`        <property key="source.file.${idx}" value="${escapeXml(loc.file)}" />`);
          if (loc.symbol) {
            lines.push(`        <property key="source.symbol.${idx}" value="${escapeXml(loc.symbol)}" />`);
          }
        });

        if (sourceRef.repository) {
          if (sourceRef.repository.url) {
            lines.push(`        <property key="source.repository.url" value="${escapeXml(sourceRef.repository.url)}" />`);
          }
          if (sourceRef.repository.commit) {
            lines.push(`        <property key="source.repository.commit" value="${escapeXml(sourceRef.repository.commit)}" />`);
          }
        }
      }

      // Add other properties
      const propKeys = Object.keys(element.properties);
      if (propKeys.length > 0) {
        for (const key of propKeys) {
          const val = element.properties[key];
          const strValue = this.valueToString(val);
          lines.push(`        <property key="${escapeXml(key)}" value="${escapeXml(strValue)}" />`);
        }
      }

      lines.push("      </properties>");
      lines.push("    </element>");
    }

    lines.push("  </elements>");

    // Export relationships and references
    lines.push("  <relationships>");

    for (const { element } of elements) {
      // Handle cross-layer references
      for (const ref of element.references) {
        lines.push(
          `    <relationship identifier="${this.escapeId(element.id)}-ref-${this.escapeId(ref.target)}" `
        );
        lines.push(`                  source="${element.id}" target="${ref.target}" `);
        lines.push(`                  xsi:type="Association">`);
        if (ref.description) {
          lines.push(
            `      <documentation>${escapeXml(ref.description)}</documentation>`
          );
        }
        lines.push(`      <name>${ref.type}</name>`);
        lines.push(`    </relationship>`);
      }

      // Handle intra-layer relationships
      for (const rel of element.relationships) {
        lines.push(
          `    <relationship identifier="${this.escapeId(element.id)}-${this.escapeId(rel.predicate)}-${this.escapeId(rel.target)}" `
        );
        lines.push(`                  source="${element.id}" target="${rel.target}" `);
        lines.push(`                  xsi:type="Association">`);
        lines.push(`      <name>${rel.predicate}</name>`);
        lines.push(`    </relationship>`);
      }
    }

    lines.push("  </relationships>");
    lines.push("</model>");

    return lines.join("\n");
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
}
