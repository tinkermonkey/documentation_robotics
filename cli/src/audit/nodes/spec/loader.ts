/**
 * Node schema loader — file I/O only.
 * Reads spec/ schema files and layer definitions from disk.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import type { ParsedNodeSchema, LayerDefinition } from "../types.js";

export class NodeSchemaLoader {
  constructor(private readonly specDir: string) {}

  /**
   * Scan spec/schemas/nodes/{layer}/*.node.schema.json and parse each file.
   * Optionally filter to a single layer by canonical name.
   */
  async loadAllSchemas(layerFilter?: string): Promise<ParsedNodeSchema[]> {
    const nodesDir = join(this.specDir, "schemas", "nodes");
    const layerDirs = await readdir(nodesDir, { withFileTypes: true });
    const schemas: ParsedNodeSchema[] = [];

    for (const entry of layerDirs) {
      if (!entry.isDirectory()) continue;
      const layerName = entry.name;
      if (layerFilter && layerName !== layerFilter) continue;

      const layerDir = join(nodesDir, layerName);
      const files = await readdir(layerDir);

      for (const file of files) {
        if (!file.endsWith(".node.schema.json")) continue;
        const filePath = join(layerDir, file);
        const raw = await readFile(filePath, "utf-8");
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          // Skip unparseable files
          continue;
        }
        const parsed = this.parseSchema(json, filePath);
        if (parsed) schemas.push(parsed);
      }
    }

    return schemas;
  }

  /**
   * Read spec/layers/*.layer.json and return layer definitions.
   */
  async loadLayerDefinitions(): Promise<LayerDefinition[]> {
    const layersDir = join(this.specDir, "layers");
    const files = await readdir(layersDir);
    const defs: LayerDefinition[] = [];

    for (const file of files) {
      if (!file.endsWith(".layer.json")) continue;
      const filePath = join(layersDir, file);
      const raw = await readFile(filePath, "utf-8");
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(raw) as Record<string, unknown>;
      } catch (err) {
        process.stderr.write(`warn: skipping malformed layer file ${filePath}: ${err}\n`);
        continue;
      }
      defs.push(this.parseLayerDefinition(json));
    }

    // Sort by layer number
    defs.sort((a, b) => a.number - b.number);
    return defs;
  }

  /**
   * Read spec/VERSION
   */
  async loadSpecVersion(): Promise<string> {
    const versionPath = join(this.specDir, "VERSION");
    const content = await readFile(versionPath, "utf-8");
    return content.trim();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private parseSchema(
    json: Record<string, unknown>,
    filePath: string
  ): ParsedNodeSchema | null {
    // Extract spec_node_id, layer_id, type from properties.*.const
    const properties = json["properties"] as Record<string, unknown> | undefined;
    if (!properties) return null;

    const specNodeId = this.extractConst(properties, "spec_node_id");
    const layerId = this.extractConst(properties, "layer_id");
    const typeName = this.extractConst(properties, "type");

    if (!specNodeId || !layerId || !typeName) {
      // Fall back to deriving from file name
      const fileName = basename(filePath, ".node.schema.json");
      const dirName = basename(dirname(filePath));
      const derivedLayerId = layerId ?? dirName;
      const derivedTypeName = typeName ?? fileName;
      const derivedSpecNodeId = specNodeId ?? `${derivedLayerId}.${derivedTypeName}`;

      return this.buildParsedSchema(json, properties, filePath, derivedSpecNodeId, derivedLayerId, derivedTypeName);
    }

    return this.buildParsedSchema(json, properties, filePath, specNodeId, layerId, typeName);
  }

  private buildParsedSchema(
    json: Record<string, unknown>,
    properties: Record<string, unknown>,
    filePath: string,
    specNodeId: string,
    layerId: string,
    typeName: string
  ): ParsedNodeSchema {
    const attributesProp = properties["attributes"] as Record<string, unknown> | undefined;
    const attrProperties = (attributesProp?.["properties"] as Record<string, { type?: string; description?: string; format?: string; enum?: string[] }>) ?? {};
    const attrRequired = (attributesProp?.["required"] as string[]) ?? [];
    const attrAdditional = (attributesProp?.["additionalProperties"] as boolean) ?? false;

    return {
      specNodeId,
      layerId,
      typeName,
      title: (json["title"] as string) ?? "",
      description: (json["description"] as string) ?? "",
      filePath,
      attributes: {
        properties: attrProperties,
        required: attrRequired,
        additionalProperties: attrAdditional,
      },
    };
  }

  private extractConst(properties: Record<string, unknown>, key: string): string | undefined {
    const prop = properties[key] as Record<string, unknown> | undefined;
    if (!prop) return undefined;
    const constVal = prop["const"];
    return typeof constVal === "string" ? constVal : undefined;
  }

  private parseLayerDefinition(json: Record<string, unknown>): LayerDefinition {
    const inspiredBy = json["inspired_by"] as { standard: string; version: string; url?: string } | undefined;
    return {
      id: (json["id"] as string) ?? "",
      number: (json["number"] as number) ?? 0,
      name: (json["name"] as string) ?? "",
      nodeTypes: (json["node_types"] as string[]) ?? [],
      inspiredBy: inspiredBy
        ? { standard: inspiredBy.standard, version: inspiredBy.version, url: inspiredBy.url }
        : undefined,
    };
  }
}
