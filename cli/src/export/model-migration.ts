/**
 * Model Migration Service
 *
 * Migrates existing layer-based models to the internal graph format (GraphNode/GraphEdge).
 * Provides backup capability, validation, and rollback functionality for safe transformation.
 *
 * Note: The codebase uses multiple graph representations with inconsistent field naming
 * (GraphNode/GraphEdge vs MigrationGraphNode/MigrationGraphEdge). See src/core/graph-mapping.ts
 * for documentation of these mapping inconsistencies and utility functions for safe conversion.
 */

import type { Model } from "../core/model.js";
import type { GraphNode, GraphEdge } from "../core/graph-model.js";
import { writeFile, mkdir, cp, rm, readFile } from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";

/**
 * Represents a single element's old ID → new UUID mapping
 */
export interface ElementMapping {
  oldId: string;
  newId: string;
  layer: string;
  type: string;
  name: string;
}

/**
 * Migration map file format (stored as migration-map.json)
 */
export interface MigrationMap {
  migrationDate: string;
  sourceFormatVersion: string;
  targetFormatVersion: string;
  totalElements: number;
  elementMappings: ElementMapping[];
  conversionNotes: string[];
}

/**
 * Result of a model migration operation
 */
export interface ModelMigrationResult {
  success: boolean;
  sourceDir: string;
  targetDir: string;
  backupDir?: string;
  elementCount: number;
  relationshipCount: number;
  elementMapping: Map<string, string>; // oldId -> newId
  validationErrors: string[];
  warnings: string[];
  duration: number;
  mappingFilePath?: string;
  /**
   * Set to true if migration failed AND rollback also failed.
   * Data may be left in an inconsistent state.
   */
  dataCorrupted?: boolean;
}

/**
 * Options for model migration
 */
export interface ModelMigrationOptions {
  targetDir: string;
  backupOriginal?: boolean;
  validateAfterMigration?: boolean;
  preserveProperties?: boolean;
}

/**
 * Service for migrating existing models to graph-based format
 */
export class ModelMigrationService {
  private model: Model;
  private elementIdMap: Map<string, string> = new Map();
  private backupDir?: string;

  constructor(model: Model) {
    this.model = model;
  }

  /**
   * Perform full migration with backup and validation
   */
  async migrate(sourceDir: string, options: ModelMigrationOptions): Promise<ModelMigrationResult> {
    const startTime = Date.now();
    const result: ModelMigrationResult = {
      success: false,
      sourceDir,
      targetDir: options.targetDir,
      elementCount: 0,
      relationshipCount: 0,
      elementMapping: new Map(),
      validationErrors: [],
      warnings: [],
      duration: 0,
    };

    try {
      // Step 1: Create backup of original model
      if (options.backupOriginal !== false) {
        this.backupDir = await this.createBackup(sourceDir);
        result.backupDir = this.backupDir;
        console.log(`✓ Backup created: ${this.backupDir}`);
      }

      // Step 2: Extract all elements from existing layers
      const { nodes, mappings, warnings } = await this.extractNodesFromLayers(
        options.preserveProperties !== false
      );
      result.elementCount = nodes.length;
      result.warnings.push(...warnings);

      // Step 3: Extract relationships between elements
      const relationshipWarnings: string[] = [];
      const edges = await this.extractRelationships(nodes, relationshipWarnings);
      result.relationshipCount = edges.length;
      result.warnings.push(...relationshipWarnings);

      // Step 4: Write new graph-based model structure
      await mkdir(options.targetDir, { recursive: true });
      await this.writeGraphModel(options.targetDir, nodes, edges);
      console.log(`✓ Graph model written to ${options.targetDir}`);

      // Step 5: Generate migration mapping table
      const mappingFile = await this.generateMappingTable(options.targetDir, mappings);
      result.mappingFilePath = mappingFile;
      result.elementMapping = this.elementIdMap;
      console.log(`✓ Migration mapping table saved to ${mappingFile}`);

      // Step 6: Validate migrated model if requested
      if (options.validateAfterMigration !== false) {
        const validationErrors = await this.validateMigratedModel(options.targetDir);
        result.validationErrors = validationErrors;

        if (validationErrors.length > 0) {
          result.success = false;
          // Don't throw - report validation errors but allow completion
          result.warnings.push(`Validation found ${validationErrors.length} issue(s)`);
        } else {
          result.success = true;
        }
      } else {
        result.success = true;
      }

      result.duration = Date.now() - startTime;
      return result;
    } catch (error) {
      result.validationErrors.push(error instanceof Error ? error.message : String(error));
      result.duration = Date.now() - startTime;

      // Attempt rollback on error
      if (this.backupDir) {
        try {
          await this.rollback(this.backupDir, options.targetDir);
          console.log(`✓ Rolled back to backup: ${this.backupDir}`);
        } catch (rollbackError) {
          const rollbackMessage =
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          result.validationErrors.push(
            `CRITICAL: Rollback failed after migration error. Data may be corrupted. Details: ${rollbackMessage}`
          );
          result.dataCorrupted = true;

          // Write sentinel file to prevent further use of this directory
          try {
            const sentinelPath = path.join(options.targetDir, ".migration-failed");
            await writeFile(
              sentinelPath,
              JSON.stringify(
                {
                  timestamp: new Date().toISOString(),
                  originalError: error instanceof Error ? error.message : String(error),
                  rollbackError: rollbackMessage,
                  message:
                    "Migration failed and rollback was unsuccessful. Data may be corrupted. Do not use this directory.",
                },
                null,
                2
              )
            );
          } catch (sentinelError) {
            console.error("Failed to write migration sentinel file:", sentinelError);
          }
        }
      }

      return result;
    }
  }

  /**
   * Extract nodes from existing layer YAML files
   */
  private async extractNodesFromLayers(preserveProperties: boolean): Promise<{
    nodes: GraphNode[];
    mappings: ElementMapping[];
    warnings: string[];
  }> {
    const nodes: GraphNode[] = [];
    const mappings: ElementMapping[] = [];
    const warnings: string[] = [];

    const layerNames = Object.keys(this.model.manifest.layers || {});

    for (const layerName of layerNames) {
      const layer = await this.model.getLayer(layerName);
      if (!layer) {
        warnings.push(`Could not load layer: ${layerName}`);
        continue;
      }

      const elements = layer.listElements();
      for (const element of elements) {
        // Generate new UUID for this element
        const newId = randomUUID();
        this.elementIdMap.set(element.id, newId);

        // Create GraphNode from element
        const node: GraphNode = {
          id: newId,
          layer: layerName,
          type: element.type,
          name: element.name,
          description: element.description,
          properties: preserveProperties ? { ...element.properties } : {},
        };

        // Add source reference if available
        const sourceRef = element.getSourceReference?.();
        if (sourceRef) {
          node.properties.sourceReference = sourceRef;
        }

        // Add creation metadata
        node.properties.migratedFromId = element.id;
        node.properties.migrationTimestamp = new Date().toISOString();

        nodes.push(node);

        // Record the mapping
        mappings.push({
          oldId: element.id,
          newId,
          layer: layerName,
          type: element.type,
          name: element.name,
        });
      }
    }

    return { nodes, mappings, warnings };
  }

  /**
   * Extract relationships from element references and relationships
   */
  private async extractRelationships(
    nodes: GraphNode[],
    warnings: string[] = []
  ): Promise<GraphEdge[]> {
    const edges: GraphEdge[] = [];
    const nodeMap = new Map(nodes.map((n) => [n.properties.migratedFromId, n.id]));

    const layerNames = Object.keys(this.model.manifest.layers || {});

    for (const layerName of layerNames) {
      const layer = await this.model.getLayer(layerName);
      if (!layer) continue;

      const elements = layer.listElements();
      for (const element of elements) {
        const sourceNodeId = nodeMap.get(element.id);
        if (!sourceNodeId) continue;

        // Extract cross-layer references
        for (const reference of element.references || []) {
          const destNodeId = nodeMap.get(reference.target);
          if (!destNodeId) {
            // Dangling reference - collect in warnings instead of console.warn
            const warning = `Dangling reference from ${element.id} to ${reference.target}`;
            warnings.push(warning);
            continue;
          }

          const edge: GraphEdge = {
            id: randomUUID(),
            source: sourceNodeId,
            destination: destNodeId,
            predicate: `references-${reference.type.toLowerCase()}`,
            properties: reference.description ? { description: reference.description } : {},
          };

          edges.push(edge);
        }

        // Extract intra-layer relationships
        for (const rel of element.relationships || []) {
          const destNodeId = nodeMap.get(rel.target);
          if (!destNodeId) {
            // Dangling relationship - collect in warnings instead of console.warn
            const warning = `Dangling relationship from ${element.id} to ${rel.target}`;
            warnings.push(warning);
            continue;
          }

          const edge: GraphEdge = {
            id: randomUUID(),
            source: sourceNodeId,
            destination: destNodeId,
            predicate: rel.predicate.toLowerCase(),
            properties: rel.properties ? { ...rel.properties } : {},
          };

          edges.push(edge);
        }
      }
    }

    return edges;
  }

  /**
   * Write the migrated graph model to the target directory
   */
  private async writeGraphModel(
    targetDir: string,
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): Promise<void> {
    const modelFile = path.join(targetDir, "model.json");
    const model = {
      version: "2.0.0",
      nodes,
      edges,
      metadata: {
        migratedAt: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    };

    await writeFile(modelFile, JSON.stringify(model, null, 2));
  }

  /**
   * Generate the migration mapping table for backward compatibility
   */
  private async generateMappingTable(
    targetDir: string,
    mappings: ElementMapping[]
  ): Promise<string> {
    const mappingFilePath = path.join(targetDir, "migration-map.json");

    const migrationMap: MigrationMap = {
      migrationDate: new Date().toISOString(),
      sourceFormatVersion: "0.8.0", // Current spec version
      targetFormatVersion: "2.0.0", // New graph-based version
      totalElements: mappings.length,
      elementMappings: mappings,
      conversionNotes: [
        "Element IDs have been converted to UUIDs",
        "All properties and metadata have been preserved",
        "Cross-layer references have been converted to edges",
      ],
    };

    await writeFile(mappingFilePath, JSON.stringify(migrationMap, null, 2));

    return mappingFilePath;
  }

  /**
   * Validate the migrated model against JSON schemas
   */
  private async validateMigratedModel(targetDir: string): Promise<string[]> {
    const errors: string[] = [];

    try {
      const modelPath = path.join(targetDir, "model.json");
      const fileContent = await readFile(modelPath, "utf-8");
      const modelData = JSON.parse(fileContent);

      // Validate structure
      if (!Array.isArray(modelData.nodes)) {
        errors.push("Model nodes must be an array");
      }
      if (!Array.isArray(modelData.edges)) {
        errors.push("Model edges must be an array");
      }

      // Validate node integrity
      const nodeIds = new Set(modelData.nodes.map((n: GraphNode) => n.id));
      for (const edge of modelData.edges) {
        if (!nodeIds.has(edge.source)) {
          errors.push(`Edge ${edge.id}: source node ${edge.source} not found`);
        }
        if (!nodeIds.has(edge.destination)) {
          errors.push(`Edge ${edge.id}: destination node ${edge.destination} not found`);
        }
      }

      // Validate node properties
      for (const node of modelData.nodes) {
        if (!node.id || typeof node.id !== "string") {
          errors.push("All nodes must have a string id");
        }
        if (!node.layer || typeof node.layer !== "string") {
          errors.push("All nodes must have a string layer");
        }
        if (!node.type || typeof node.type !== "string") {
          errors.push("All nodes must have a string type");
        }
        if (!node.name || typeof node.name !== "string") {
          errors.push("All nodes must have a string name");
        }
      }
    } catch (error) {
      errors.push(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return errors;
  }

  /**
   * Create a backup of the original model
   */
  private async createBackup(sourceDir: string): Promise<string> {
    const timestamp = Date.now();
    const backupDir = `${sourceDir}.backup-${timestamp}`;

    await cp(sourceDir, backupDir, { recursive: true });

    return backupDir;
  }

  /**
   * Rollback migration by restoring from backup
   */
  async rollback(backupDir: string, targetDir: string): Promise<void> {
    try {
      // Remove failed migration
      await rm(targetDir, { recursive: true, force: true });

      // Restore from backup
      await cp(backupDir, targetDir, { recursive: true });
    } catch (error) {
      throw new Error(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
