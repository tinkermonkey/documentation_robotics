import type { Model } from "../core/model.js";
import type { Importer, ImportOptions, ImportResult } from "./types.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";

/**
 * ArchiMate XML Importer for layers 1, 2, 4, 5
 * Parses ArchiMate 3.2 XML and creates graph nodes/edges
 */
export class ArchiMateImporter implements Importer {
  name = "ArchiMate";
  supportedFormats = ["xml"];

  async import(data: string, model: Model, _options: ImportOptions = {}): Promise<ImportResult> {
    const span = isTelemetryEnabled ? startSpan('import.format.archimate') : null;
    const result: ImportResult = {
      success: false,
      nodesAdded: 0,
      edgesAdded: 0,
      errorsCount: 0,
      errors: [],
    };

    try {
      // Parse XML
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(data, "application/xml");

      if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
        result.errors.push({ message: "Failed to parse XML: Invalid XML structure" });
        result.errorsCount++;
        return result;
      }

      const modelElement = xmlDoc.documentElement;
      if (modelElement.tagName !== "model") {
        result.errors.push({ message: "Root element must be 'model'" });
        result.errorsCount++;
        return result;
      }

      // Parse elements
      const elementsElement = modelElement.getElementsByTagName("elements")[0];
      if (!elementsElement) {
        result.errors.push({ message: "No elements section found" });
        result.errorsCount++;
        return result;
      }

      const elementNodes = elementsElement.getElementsByTagName("element");
      const layerMap = new Map<string, string>();  // id -> layer mapping

      for (let i = 0; i < elementNodes.length; i++) {
        const elem = elementNodes[i];
        const id = elem.getAttribute("identifier");
        const type = elem.getAttribute("xsi:type") || "Element";
        const nameElement = elem.getElementsByTagName("name")[0];
        const name = nameElement?.textContent || id || "Unnamed";
        const docElement = elem.getElementsByTagName("documentation")[0];
        const description = docElement?.textContent || undefined;

        if (!id) {
          result.errors.push({ message: "Element missing identifier attribute" });
          result.errorsCount++;
          continue;
        }

        // Infer layer from ArchiMate type
        const layer = this.inferLayerFromType(type);
        if (!layer) {
          result.errors.push({
            message: `Unable to infer layer for ArchiMate type: ${type}`,
            element: id,
          });
          result.errorsCount++;
          continue;
        }

        // Extract properties
        const properties: Record<string, unknown> = {};
        const propsElement = elem.getElementsByTagName("properties")[0];
        if (propsElement) {
          const propElements = propsElement.getElementsByTagName("property");
          for (let j = 0; j < propElements.length; j++) {
            const prop = propElements[j];
            const key = prop.getAttribute("key");
            const value = prop.getAttribute("value");
            if (key && value !== null) {
              properties[key] = value;
            }
          }
        }

        // Create graph node
        const graphNode = {
          id,
          layer,
          type: this.mapArchiMateTypeToElementType(type, layer),
          name,
          description,
          properties,
        };

        model.graph.addNode(graphNode);
        layerMap.set(id, layer);
        result.nodesAdded++;
      }

      // Parse relationships
      const relationshipsElement = modelElement.getElementsByTagName("relationships")[0];
      if (relationshipsElement) {
        const relElements = relationshipsElement.getElementsByTagName("relationship");

        for (let i = 0; i < relElements.length; i++) {
          const rel = relElements[i];
          const id = rel.getAttribute("identifier");
          const source = rel.getAttribute("source");
          const target = rel.getAttribute("target");
          const nameElement = rel.getElementsByTagName("name")[0];
          const predicate = nameElement?.textContent || "Association";

          if (!id || !source || !target) {
            result.errors.push({
              message: "Relationship missing required attributes (identifier, source, target)",
            });
            result.errorsCount++;
            continue;
          }

          // Verify both nodes exist
          if (!model.graph.getNode(source) || !model.graph.getNode(target)) {
            result.errors.push({
              message: `Relationship references non-existent nodes: ${source} -> ${target}`,
              element: id,
            });
            result.errorsCount++;
            continue;
          }

          // Create graph edge
          const graphEdge = {
            id,
            source,
            destination: target,
            predicate,
            properties: {},
          };

          model.graph.addEdge(graphEdge);
          result.edgesAdded++;
        }
      }

      result.success = result.errorsCount === 0;

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute('import.nodesAdded', result.nodesAdded);
        (span as any).setAttribute('import.edgesAdded', result.edgesAdded);
        (span as any).setAttribute('import.errors', result.errorsCount);
        (span as any).setStatus({ code: result.success ? 0 : 1 });
      }

      return result;
    } catch (error) {
      result.errors.push({
        message: error instanceof Error ? error.message : String(error),
      });
      result.errorsCount++;

      if (isTelemetryEnabled && span) {
        (span as any).recordException(error as Error);
        (span as any).setStatus({ code: 2, message: String(error) });
      }

      return result;
    } finally {
      endSpan(span);
    }
  }

  /**
   * Infer layer from ArchiMate element type
   */
  private inferLayerFromType(
    archimateType: string
  ): string | undefined {
    // Motivation layer types
    const motivationTypes = [
      "Stakeholder", "Driver", "Assessment", "Goal", "Outcome",
      "Principle", "Requirement", "Constraint"
    ];
    if (motivationTypes.includes(archimateType)) return "motivation";

    // Business layer types
    const businessTypes = [
      "BusinessActor", "BusinessRole", "BusinessCollaboration",
      "BusinessInterface", "BusinessProcess", "BusinessFunction",
      "BusinessInteraction", "BusinessEvent", "BusinessService",
      "BusinessObject"
    ];
    if (businessTypes.includes(archimateType)) return "business";

    // Application layer types
    const applicationTypes = [
      "ApplicationComponent", "ApplicationCollaboration",
      "ApplicationInterface", "ApplicationFunction",
      "ApplicationInteraction", "ApplicationProcess",
      "ApplicationEvent", "ApplicationService", "DataObject"
    ];
    if (applicationTypes.includes(archimateType)) return "application";

    // Technology layer types
    const technologyTypes = [
      "Node", "Device", "SystemSoftware", "TechnologyCollaboration",
      "TechnologyInterface", "Path", "CommunicationNetwork",
      "TechnologyFunction", "TechnologyProcess", "TechnologyInteraction",
      "TechnologyEvent", "TechnologyService", "Artifact"
    ];
    if (technologyTypes.includes(archimateType)) return "technology";

    return undefined;
  }

  /**
   * Map ArchiMate type to element type (lowercase format)
   */
  private mapArchiMateTypeToElementType(archimateType: string, _layer: string): string {
    // Convert PascalCase to kebab-case
    const kebabCase = archimateType
      .replace(/([A-Z])/g, "-$1")
      .toLowerCase()
      .replace(/^-/, "");

    return kebabCase;
  }
}
