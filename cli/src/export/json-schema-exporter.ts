import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { getErrorMessage } from "../utils/errors.js";

/**
 * JSON Schema Draft 7 Exporter for layer 7 (Data Model)
 */
export class JsonSchemaExporter implements Exporter {
  name = "JSON Schema";
  supportedLayers = ["data-model"];

  async export(model: Model, _options: ExportOptions = {}): Promise<string> {
    const span = isTelemetryEnabled ? startSpan("export.format.json-schema") : null;

    try {
      // Query graph model for data-model layer nodes
      const nodes = model.graph.getNodesByLayer("data-model");
      if (nodes.length === 0) {
        throw new Error("No Data Model layer found in model");
      }

      // Create a root schema that references all entities
      const rootSchema: Record<string, unknown> = {
        $schema: "http://json-schema.org/draft-07/schema#",
        $id: `${model.manifest.name.toLowerCase().replace(/\s+/g, "-")}-schema`,
        title: model.manifest.name,
        description: model.manifest.description || "Data model schema",
        type: "object",
        definitions: {},
      };

      // Map from spec node type to JSON Schema type for cases where the type
      // is determined by the node kind rather than a stored attribute.
      const nodeTypeToSchemaType: Record<string, string> = {
        arrayschema: "array",
        stringschema: "string",
        numericschema: "number",
        objectschema: "object",
        entity: "object",
      };

      // Process all data-model nodes as JSON Schema definitions.
      // The spec uses types: jsonschema, schemadefinition, objectschema, arrayschema,
      // numericschema, stringschema, schemacomposition, schemaproperty, reference, entity.
      for (const node of nodes) {
        const entityName = node.name;
        // GraphNode stores element attributes as a direct field (node.attributes),
        // not nested under node.properties.
        const attrs = node.attributes as Record<string, unknown> | undefined;
        // 'properties' in JSON Schema context means the sub-schemas for object properties,
        // stored in the element's attributes.properties field.
        const properties = attrs?.properties as Record<string, unknown> | undefined;
        const required = (attrs?.required as string[] | undefined) ?? (node.properties?.required as string[] | undefined);
        const description = node.description;

        // Derive JSON Schema type: prefer the value stored in the element's attributes
        // (user-specified), then fall back to the node-type map, then "object".
        const schemaType =
          typeof attrs?.type === "string"
            ? attrs.type
            : (nodeTypeToSchemaType[node.type] ?? "object");

        const entitySchema: Record<string, unknown> = {
          title: entityName,
          ...(description && { description }),
          type: schemaType,
          ...(properties && { properties }),
          ...(required && { required }),
        };

        // Add additional metadata
        const additionalProperties = attrs?.additionalProperties as boolean;
        if (additionalProperties !== undefined) {
          entitySchema.additionalProperties = additionalProperties;
        }

        // Add constraints if present
        const constraints = attrs?.constraints as Record<string, unknown>;
        if (constraints) {
          Object.assign(entitySchema, constraints);
        }

        // Add source reference if present (check both naming conventions)
        const sourceRef =
          attrs?.["x-source-reference"] || attrs?.["source-reference"]
          || node.source_reference;
        if (sourceRef) {
          entitySchema["x-source-reference"] = sourceRef;
        }

        (rootSchema.definitions as Record<string, unknown>)[node.id] = entitySchema;
      }

      // Add relationships as references between entities - query graph edges
      const relationships: Record<string, unknown> = {};
      const edges = model.graph.getAllEdges();
      const nodeIds = new Set(nodes.map((n) => n.id));

      for (const edge of edges) {
        // Only include edges where source is an entity in the data-model layer
        if (nodeIds.has(edge.source) && nodeIds.has(edge.destination)) {
          const relKey = `${edge.source}-${edge.predicate}`;
          if (!relationships[relKey]) {
            relationships[relKey] = [];
          }
          (relationships[relKey] as Array<{ target: string }>).push({
            target: edge.destination,
          });
        }
      }

      if (Object.keys(relationships).length > 0) {
        rootSchema.relationships = relationships;
      }

      // Add metadata section
      const entityCount = nodes.length;
      const metadata: Record<string, unknown> = {
        version: model.manifest.version || "1.0.0",
        ...(model.manifest.author && { author: model.manifest.author }),
        ...(model.manifest.created && { created: model.manifest.created }),
        ...(model.manifest.modified && { modified: model.manifest.modified }),
        entityCount,
      };
      rootSchema.metadata = metadata;

      const result = JSON.stringify(rootSchema, null, 2) + "\n";

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute(
          "export.entityCount",
          Object.keys(rootSchema.definitions || {}).length
        );
        (span as any).setAttribute("export.relationshipCount", Object.keys(relationships).length);
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
}
