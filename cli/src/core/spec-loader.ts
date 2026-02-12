/**
 * SpecDataLoader - Loads specification metadata from spec directory
 *
 * Loads layer definitions, node type schemas, relationship schemas, and predicates
 * from the spec/ directory for use by CLI commands and analysis tools.
 */

import path from "node:path";
import { fileURLToPath } from "url";
import fs from "node:fs/promises";
import { glob } from "glob";
import { getErrorMessage } from "../utils/errors.js";
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

/**
 * SpecDataLoader loads specification metadata from the spec/ directory
 */
export class SpecDataLoader {
  private specDir: string;
  private options: SpecLoaderOptions;
  private cachedData: SpecData | null = null;
  private loadedAt: Date | null = null;

  constructor(options: SpecLoaderOptions = {}) {
    this.options = {
      cache: true,
      includeSchemas: false,
      ...options,
    };

    // Resolve spec directory path
    this.specDir = this.options.specDir || this.getDefaultSpecDir();
  }

  /**
   * Get default path to spec directory
   */
  private getDefaultSpecDir(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    // Navigate from cli/src/core to repository root/spec
    return path.join(currentDir, "../../../spec");
  }

  /**
   * Load all specification data
   */
  async load(): Promise<SpecData> {
    // Return cached data if available and caching is enabled
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

      const data: SpecData = {
        layers,
        nodeTypes,
        relationshipTypes,
        predicates,
      };

      // Cache the data if caching is enabled
      if (this.options.cache) {
        this.cachedData = data;
        this.loadedAt = new Date();
      }

      return data;
    } catch (error) {
      throw new Error(
        `Failed to load specification data from ${this.specDir}: ${getErrorMessage(error)}`
      );
    }
  }

  /**
   * Load layer specifications
   */
  private async loadLayers(): Promise<LayerSpec[]> {
    const pattern = path.join(this.specDir, "layers", "*.layer.json");
    const files = await glob(pattern);

    if (files.length === 0) {
      throw new Error(`No layer files found at ${pattern}`);
    }

    const layers = await Promise.all(
      files.map(async (f) => {
        const content = await fs.readFile(f, "utf-8");
        try {
          return JSON.parse(content) as LayerSpec;
        } catch (error) {
          throw new Error(`Failed to parse layer file ${f}: ${getErrorMessage(error)}`);
        }
      })
    );

    // Sort by layer number
    return layers.sort((a, b) => a.number - b.number);
  }

  /**
   * Load node type specifications
   */
  private async loadNodeTypes(): Promise<NodeTypeSpec[]> {
    const pattern = path.join(this.specDir, "schemas", "nodes", "**", "*.node.schema.json");
    const files = await glob(pattern);

    if (files.length === 0) {
      throw new Error(`No node schema files found at ${pattern}`);
    }

    const nodeTypes = await Promise.all(
      files.map(async (f) => {
        const content = await fs.readFile(f, "utf-8");
        let schema;
        try {
          schema = JSON.parse(content);
        } catch (error) {
          throw new Error(`Failed to parse node schema file ${f}: ${getErrorMessage(error)}`);
        }

        // Extract const values from schema properties
        const spec_node_id = schema.properties?.spec_node_id?.const;
        const layer_id = schema.properties?.layer_id?.const;
        const type = schema.properties?.type?.const;

        if (!spec_node_id || !layer_id || !type) {
          throw new Error(
            `Schema ${f} missing required const values: spec_node_id=${spec_node_id}, layer_id=${layer_id}, type=${type}`
          );
        }

        return {
          spec_node_id,
          layer_id,
          type,
          title: schema.title || "",
          description: schema.description || "",
          attributes: this.extractAttributes(schema.properties?.attributes),
          ...(this.options.includeSchemas && { schema }),
        };
      })
    );

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
    const required = new Set(attributesSchema.required as string[] || []);

    return Object.entries(props).map(([name, schema]: [string, Record<string, unknown>]) => ({
      name,
      type: (schema.type as string) || "unknown",
      format: schema.format as string | undefined,
      required: required.has(name),
      description: schema.description as string | undefined,
    }));
  }

  /**
   * Load relationship type specifications
   */
  private async loadRelationshipTypes(): Promise<RelationshipTypeSpec[]> {
    const pattern = path.join(
      this.specDir,
      "schemas",
      "relationships",
      "**",
      "*.relationship.schema.json"
    );
    const files = await glob(pattern);

    if (files.length === 0) {
      throw new Error(`No relationship schema files found at ${pattern}`);
    }

    const relationshipTypes = await Promise.all(
      files.map(async (f) => {
        const content = await fs.readFile(f, "utf-8");
        let schema;
        try {
          schema = JSON.parse(content);
        } catch (error) {
          throw new Error(`Failed to parse relationship schema file ${f}: ${getErrorMessage(error)}`);
        }

        const id = schema.properties?.id?.const;
        const source_spec_node_id = schema.properties?.source_spec_node_id?.const;
        const source_layer = schema.properties?.source_layer?.const;
        const destination_spec_node_id = schema.properties?.destination_spec_node_id?.const;
        const destination_layer = schema.properties?.destination_layer?.const;
        const predicate = schema.properties?.predicate?.const;

        if (!id || !source_spec_node_id || !source_layer) {
          throw new Error(
            `Relationship schema ${f} missing required const values: id=${id}, source_spec_node_id=${source_spec_node_id}, source_layer=${source_layer}`
          );
        }

        return {
          id,
          source_spec_node_id,
          source_layer,
          destination_spec_node_id: destination_spec_node_id || "",
          destination_layer: destination_layer || "",
          predicate: predicate || "",
          cardinality: schema.properties?.cardinality?.const || "many-to-many",
          strength: schema.properties?.strength?.const || "medium",
          required: schema.properties?.required?.const,
        };
      })
    );

    return relationshipTypes;
  }

  /**
   * Load predicate definitions
   */
  private async loadPredicates(): Promise<Map<string, PredicateSpec>> {
    const predicatesPath = path.join(this.specDir, "schemas", "base", "predicates.json");

    try {
      const content = await fs.readFile(predicatesPath, "utf-8");
      let data;
      try {
        data = JSON.parse(content) as { predicates: Record<string, Record<string, unknown>> };
      } catch (parseError) {
        throw new Error(`Failed to parse predicates file ${predicatesPath}: ${getErrorMessage(parseError)}`);
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
        `Failed to load predicates from ${predicatesPath}: ${getErrorMessage(error)}`
      );
    }
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

  /**
   * Check if data has been loaded
   */
  isLoaded(): boolean {
    return this.cachedData !== null;
  }

  /**
   * Get statistics about loaded specification
   */
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

  /**
   * Clear cached data
   */
  clear(): void {
    this.cachedData = null;
    this.loadedAt = null;
  }

  /**
   * Find node types by query filter
   */
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

  /**
   * Find relationship types by query filter
   */
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

  /**
   * Get node types for a specific layer
   */
  getNodeTypesForLayer(layerId: string): NodeTypeSpec[] {
    return this.findNodeTypes({ layer: layerId });
  }

  /**
   * Get relationship types for a specific layer pair
   */
  getRelationshipTypesForLayerPair(sourceLayer: string, destLayer?: string): RelationshipTypeSpec[] {
    const filter: RelationshipTypeQueryFilter = { sourceLayer };
    if (destLayer) {
      filter.destinationLayer = destLayer;
    }
    return this.findRelationshipTypes(filter);
  }

  /**
   * Get predicate by name
   */
  getPredicate(predicateName: string): PredicateSpec | undefined {
    return this.getSpecData().predicates.get(predicateName);
  }

  /**
   * Get all predicates
   */
  getAllPredicates(): PredicateSpec[] {
    const data = this.getSpecData();
    return Array.from(data.predicates.values());
  }

  /**
   * Get layer by ID
   */
  getLayer(layerId: string): LayerSpec | undefined {
    const data = this.getSpecData();
    return data.layers.find((l) => l.id === layerId);
  }

  /**
   * Get all layers
   */
  getAllLayers(): LayerSpec[] {
    return this.getSpecData().layers;
  }

  /**
   * Get node type by spec_node_id
   */
  getNodeType(specNodeId: string): NodeTypeSpec | undefined {
    const data = this.getSpecData();
    return data.nodeTypes.find((nt) => nt.spec_node_id === specNodeId);
  }

  /**
   * Get node types that reference another node type (incoming relationships)
   */
  getNodeTypesReferencingType(specNodeId: string): RelationshipTypeSpec[] {
    return this.findRelationshipTypes({ destinationSpecNodeId: specNodeId });
  }

  /**
   * Get node types referenced by another node type (outgoing relationships)
   */
  getNodeTypesReferencedByType(specNodeId: string): RelationshipTypeSpec[] {
    return this.findRelationshipTypes({ sourceSpecNodeId: specNodeId });
  }
}
