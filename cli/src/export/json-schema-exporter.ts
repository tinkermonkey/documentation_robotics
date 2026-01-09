import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";

/**
 * JSON Schema Draft 7 Exporter for layer 7 (Data Model)
 */
export class JsonSchemaExporter implements Exporter {
  name = "JSON Schema";
  supportedLayers = ["data-model", "data_model"];

  async export(model: Model, _options: ExportOptions = {}): Promise<string> {
    // Try both naming conventions for data model layer
    let layer = await model.getLayer("data-model");
    if (!layer) {
      layer = await model.getLayer("data_model");
    }
    if (!layer) {
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

    // Process each entity in the data model layer
    for (const element of layer.listElements()) {
      if (element.type === "entity") {
        const entityName = element.name;
        const properties = element.getProperty<Record<string, unknown>>(
          "properties"
        );
        const required = element.getProperty<string[]>("required");
        const description = element.description;

        const entitySchema: Record<string, unknown> = {
          title: entityName,
          ...(description && { description }),
          type: "object",
          ...(properties && { properties }),
          ...(required && { required }),
        };

        // Add additional metadata
        const additionalProperties = element.getProperty<boolean>(
          "additionalProperties"
        );
        if (additionalProperties !== undefined) {
          entitySchema.additionalProperties = additionalProperties;
        }

        // Add constraints if present
        const constraints = element.getProperty<Record<string, unknown>>(
          "constraints"
        );
        if (constraints) {
          Object.assign(entitySchema, constraints);
        }

        // Add source reference if present
        const sourceRef = element.getSourceReference();
        if (sourceRef) {
          entitySchema['x-source-reference'] = sourceRef;
        }

        (rootSchema.definitions as Record<string, unknown>)[element.id] = entitySchema;
      }
    }

    // Add relationships as references between entities
    const relationships: Record<string, unknown> = {};
    for (const element of layer.listElements()) {
      if (element.type === "entity") {
        for (const ref of element.references) {
          // Cross-layer reference - document it
          const refKey = `${element.id}-references`;
          if (!relationships[refKey]) {
            relationships[refKey] = [];
          }
          (relationships[refKey] as Array<{ target: string; type: string }>).push({
            target: ref.target,
            type: ref.type,
          });
        }

        for (const rel of element.relationships) {
          // Intra-layer relationship
          const relKey = `${element.id}-${rel.predicate}`;
          if (!relationships[relKey]) {
            relationships[relKey] = [];
          }
          (relationships[relKey] as Array<{ target: string }>).push({
            target: rel.target,
          });
        }
      }
    }

    if (Object.keys(relationships).length > 0) {
      rootSchema.relationships = relationships;
    }

    // Add metadata section
    const metadata: Record<string, unknown> = {
      version: model.manifest.version || "1.0.0",
      ...(model.manifest.author && { author: model.manifest.author }),
      ...(model.manifest.created && { created: model.manifest.created }),
      ...(model.manifest.modified && { modified: model.manifest.modified }),
      entityCount: Array.from(layer.listElements()).filter(
        (e) => e.type === "entity"
      ).length,
    };
    rootSchema.metadata = metadata;

    return JSON.stringify(rootSchema, null, 2);
  }
}
