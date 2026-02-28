/**
 * SpecDataLoader - Loads specification metadata from compiled bundled dist files
 *
 * Reads directly from the 14 compiled JSON files in cli/src/schemas/bundled/:
 *   manifest.json, base.json, {layer}.json (x12)
 *
 * Never reads from .dr/ or expanded individual schema files.
 */

import path from "node:path";
import { fileURLToPath } from "url";
import fs from "node:fs/promises";
import { existsSync } from "fs";
import { getErrorMessage } from "../utils/errors.js";
import { logDebug } from "../utils/globals.js";
import {
  LayerSpec,
  NodeTypeSpec,
  RelationshipTypeSpec,
  PredicateSpec,
  SpecData,
  SpecStatistics,
  SpecLoaderOptions,
  NodeTypeQueryFilter,
  RelationshipTypeQueryFilter,
  AttributeSpec,
} from "./spec-loader-types.js";

// Bundled dist format types (matches spec/dist/ output)
interface CompiledManifest {
  specVersion: string;
  builtAt: string;
  layers: Array<{ id: string; number: number; name: string; nodeTypeCount: number; relationshipCount: number }>;
}

interface CompiledBase {
  specVersion: string;
  schemas: Record<string, unknown>;
  predicates: Record<string, unknown>;
}

interface CompiledRelationshipFlat {
  id: string;
  source_spec_node_id: string;
  source_layer: string;
  destination_spec_node_id: string;
  destination_layer: string;
  predicate: string;
  cardinality?: string;
  strength?: string;
  required?: boolean;
}

interface CompiledLayer {
  layer: Record<string, unknown>;
  nodeSchemas: Record<string, Record<string, unknown>>;
  relationshipSchemas: Record<string, CompiledRelationshipFlat>;
}

/**
 * SpecDataLoader loads specification metadata from the compiled bundled dist files
 */
export class SpecDataLoader {
  private bundledDir: string;
  private options: SpecLoaderOptions;
  private cachedData: SpecData | null = null;
  private loadedAt: Date | null = null;

  constructor(options: SpecLoaderOptions = {}) {
    this.options = {
      cache: true,
      includeSchemas: false,
      ...options,
    };

    this.bundledDir = this.options.bundledDir || this.getDefaultBundledDir();
  }

  /**
   * Resolve the bundled dist directory.
   *
   * Priority:
   * 1. Explicit override via options.bundledDir
   * 2. CLI installation: schemas/bundled/ next to compiled source
   * 3. Development monorepo: spec/dist/
   */
  private getDefaultBundledDir(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));

    // Try 1: CLI installation (dist/core → dist/schemas/bundled)
    const installPath = path.join(currentDir, "..", "schemas", "bundled");
    if (existsSync(path.join(installPath, "manifest.json"))) {
      logDebug(`SpecDataLoader using bundled schemas: ${installPath}`);
      return installPath;
    }

    // Try 2: Development path — spec/dist/ in monorepo
    const devDistPath = path.join(currentDir, "../../../spec/dist");
    if (existsSync(path.join(devDistPath, "manifest.json"))) {
      logDebug(`SpecDataLoader using bundled schemas: ${devDistPath}`);
      return devDistPath;
    }

    throw new Error(
      "Cannot find compiled spec schemas. Tried:\n" +
      `  1. CLI installation: ${installPath}\n` +
      `  2. Development monorepo: ${devDistPath}\n\n` +
      "Ensure you have built the spec (npm run build:spec) or installed the CLI."
    );
  }

  /**
   * Load all specification data
   */
  async load(): Promise<SpecData> {
    if (this.options.cache && this.cachedData) {
      return this.cachedData;
    }

    try {
      const [layers, nodeTypes, relationshipTypes, predicates] = await Promise.all([
        this.loadLayers(),
        this.loadNodeTypes(),
        this.loadRelationshipTypes(),
        this.loadPredicates(),
      ]);

      const data: SpecData = { layers, nodeTypes, relationshipTypes, predicates };

      if (this.options.cache) {
        this.cachedData = data;
        this.loadedAt = new Date();
      }

      return data;
    } catch (error) {
      throw new Error(
        `Failed to load specification data from ${this.bundledDir}: ${getErrorMessage(error)}`
      );
    }
  }

  /**
   * Load layer specifications from manifest.json + per-layer files
   */
  private async loadLayers(): Promise<LayerSpec[]> {
    const manifest = await this.readManifest();
    const layers: LayerSpec[] = [];

    for (const entry of manifest.layers) {
      const layerFile = path.join(this.bundledDir, `${entry.id}.json`);
      const content = await fs.readFile(layerFile, "utf-8");
      const layerData = JSON.parse(content) as CompiledLayer;
      const layer = layerData.layer as unknown as LayerSpec;
      layers.push(layer);
    }

    return layers.sort((a, b) => a.number - b.number);
  }

  /**
   * Load node type specifications from nodeSchemas in each layer file
   */
  private async loadNodeTypes(): Promise<NodeTypeSpec[]> {
    const manifest = await this.readManifest();
    const nodeTypes: NodeTypeSpec[] = [];

    for (const entry of manifest.layers) {
      const layerFile = path.join(this.bundledDir, `${entry.id}.json`);
      const content = await fs.readFile(layerFile, "utf-8");
      const layerData = JSON.parse(content) as CompiledLayer;

      for (const [, schema] of Object.entries(layerData.nodeSchemas)) {
        const spec_node_id = (schema.properties as Record<string, Record<string, unknown>>)?.spec_node_id?.const as string;
        const layer_id = (schema.properties as Record<string, Record<string, unknown>>)?.layer_id?.const as string;
        const type = (schema.properties as Record<string, Record<string, unknown>>)?.type?.const as string;

        if (!spec_node_id || !layer_id || !type) {
          throw new Error(
            `Node schema in ${entry.id}.json missing required const values: spec_node_id=${spec_node_id}, layer_id=${layer_id}, type=${type}`
          );
        }

        nodeTypes.push({
          spec_node_id,
          layer_id,
          type,
          title: (schema.title as string) || "",
          description: (schema.description as string) || "",
          attributes: this.extractAttributes((schema.properties as Record<string, unknown>)?.attributes as Record<string, unknown>),
          ...(this.options.includeSchemas && { schema: schema as Record<string, unknown> }),
        });
      }
    }

    return nodeTypes;
  }

  /**
   * Extract attribute specifications from node schema
   */
  private extractAttributes(attributesSchema: Record<string, unknown>): AttributeSpec[] {
    if (!attributesSchema || !attributesSchema.properties) {
      return [];
    }

    const props = attributesSchema.properties as Record<string, Record<string, unknown>>;
    const required = new Set((attributesSchema.required as string[]) || []);

    return Object.entries(props).map(([name, schema]) => ({
      name,
      type: (schema.type as string) || "unknown",
      format: schema.format as string | undefined,
      required: required.has(name),
      description: schema.description as string | undefined,
    }));
  }

  /**
   * Load relationship type specifications from relationshipSchemas in each layer file
   *
   * The bundled format stores flat data directly (not wrapped in JSON Schema),
   * so we read the fields directly rather than extracting from .const values.
   */
  private async loadRelationshipTypes(): Promise<RelationshipTypeSpec[]> {
    const manifest = await this.readManifest();
    const relationshipTypes: RelationshipTypeSpec[] = [];

    for (const entry of manifest.layers) {
      const layerFile = path.join(this.bundledDir, `${entry.id}.json`);
      const content = await fs.readFile(layerFile, "utf-8");
      const layerData = JSON.parse(content) as CompiledLayer;

      for (const rel of Object.values(layerData.relationshipSchemas)) {
        if (!rel.id || !rel.source_spec_node_id || !rel.source_layer) {
          throw new Error(
            `Relationship schema in ${entry.id}.json missing required fields: id=${rel.id}`
          );
        }

        relationshipTypes.push({
          id: rel.id,
          source_spec_node_id: rel.source_spec_node_id,
          source_layer: rel.source_layer,
          destination_spec_node_id: rel.destination_spec_node_id || "",
          destination_layer: rel.destination_layer || "",
          predicate: rel.predicate || "",
          cardinality: rel.cardinality || "many-to-many",
          strength: rel.strength || "medium",
          required: rel.required,
        });
      }
    }

    return relationshipTypes;
  }

  /**
   * Load predicate definitions from base.json
   */
  private async loadPredicates(): Promise<Map<string, PredicateSpec>> {
    const basePath = path.join(this.bundledDir, "base.json");

    try {
      const content = await fs.readFile(basePath, "utf-8");
      let data: CompiledBase;
      try {
        data = JSON.parse(content) as CompiledBase;
      } catch (parseError) {
        throw new Error(`Failed to parse base.json at ${basePath}: ${getErrorMessage(parseError)}`);
      }

      const predicates = new Map<string, PredicateSpec>();
      for (const [, pred] of Object.entries(data.predicates)) {
        const predSpec = pred as unknown as PredicateSpec;
        predicates.set(predSpec.predicate, {
          predicate: predSpec.predicate,
          inverse: predSpec.inverse,
          category: predSpec.category,
          description: predSpec.description,
          archimate_alignment: predSpec.archimate_alignment,
          semantics: predSpec.semantics,
        });
      }

      return predicates;
    } catch (error) {
      throw new Error(
        `Failed to load predicates from ${basePath}: ${getErrorMessage(error)}`
      );
    }
  }

  /**
   * Read and parse the bundled manifest.json
   */
  private async readManifest(): Promise<CompiledManifest> {
    const manifestPath = path.join(this.bundledDir, "manifest.json");
    const content = await fs.readFile(manifestPath, "utf-8");
    return JSON.parse(content) as CompiledManifest;
  }

  /**
   * Get loaded specification data
   * Throws if data hasn't been loaded yet
   */
  getSpecData(): SpecData {
    if (!this.cachedData) {
      throw new Error("Specification data not loaded. Call load() first.");
    }
    return this.cachedData;
  }

  isLoaded(): boolean {
    return this.cachedData !== null;
  }

  getStatistics(): SpecStatistics {
    const data = this.getSpecData();
    return {
      layerCount: data.layers.length,
      nodeTypeCount: data.nodeTypes.length,
      relationshipTypeCount: data.relationshipTypes.length,
      predicateCount: data.predicates.size,
      totalAttributes: data.nodeTypes.reduce((sum, nt) => sum + nt.attributes.length, 0),
      loadedAt: this.loadedAt || new Date(),
    };
  }

  clear(): void {
    this.cachedData = null;
    this.loadedAt = null;
  }

  findNodeTypes(filter: NodeTypeQueryFilter = {}): NodeTypeSpec[] {
    const data = this.getSpecData();

    return data.nodeTypes.filter((nt) => {
      if (filter.layer && nt.layer_id !== filter.layer) return false;
      if (filter.type && nt.type !== filter.type) return false;
      if (filter.specNodeId && nt.spec_node_id !== filter.specNodeId) return false;
      if (filter.title && !nt.title.toLowerCase().includes(filter.title.toLowerCase()))
        return false;
      return true;
    });
  }

  findRelationshipTypes(filter: RelationshipTypeQueryFilter = {}): RelationshipTypeSpec[] {
    const data = this.getSpecData();

    return data.relationshipTypes.filter((rt) => {
      if (filter.sourceLayer && rt.source_layer !== filter.sourceLayer) return false;
      if (filter.sourceSpecNodeId && rt.source_spec_node_id !== filter.sourceSpecNodeId)
        return false;
      if (filter.destinationLayer && rt.destination_layer !== filter.destinationLayer)
        return false;
      if (filter.destinationSpecNodeId && rt.destination_spec_node_id !== filter.destinationSpecNodeId)
        return false;
      if (filter.predicate && rt.predicate !== filter.predicate) return false;
      return true;
    });
  }

  getNodeTypesForLayer(layerId: string): NodeTypeSpec[] {
    return this.findNodeTypes({ layer: layerId });
  }

  getRelationshipTypesForLayerPair(sourceLayer: string, destLayer?: string): RelationshipTypeSpec[] {
    const filter: RelationshipTypeQueryFilter = { sourceLayer };
    if (destLayer) {
      filter.destinationLayer = destLayer;
    }
    return this.findRelationshipTypes(filter);
  }

  getPredicate(predicateName: string): PredicateSpec | undefined {
    return this.getSpecData().predicates.get(predicateName);
  }

  getAllPredicates(): PredicateSpec[] {
    const data = this.getSpecData();
    return Array.from(data.predicates.values());
  }

  getLayer(layerId: string): LayerSpec | undefined {
    const data = this.getSpecData();
    return data.layers.find((l) => l.id === layerId);
  }

  getAllLayers(): LayerSpec[] {
    return this.getSpecData().layers;
  }

  getNodeType(specNodeId: string): NodeTypeSpec | undefined {
    const data = this.getSpecData();
    return data.nodeTypes.find((nt) => nt.spec_node_id === specNodeId);
  }

  getNodeTypesReferencingType(specNodeId: string): RelationshipTypeSpec[] {
    return this.findRelationshipTypes({ destinationSpecNodeId: specNodeId });
  }

  getNodeTypesReferencedByType(specNodeId: string): RelationshipTypeSpec[] {
    return this.findRelationshipTypes({ sourceSpecNodeId: specNodeId });
  }
}
