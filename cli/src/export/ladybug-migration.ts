/**
 * LadybugDB Migration Helper
 *
 * Provides tools for migrating architecture models to LadybugDB graph database.
 * LadybugDB is a lightweight graph database optimized for analysis and visualization.
 */

import type { MigrationGraphNode, MigrationGraphEdge } from "./graph-migration.js";

// Aliases for convenience
export type GraphNode = MigrationGraphNode;
export type GraphEdge = MigrationGraphEdge;

/**
 * LadybugDB migration options
 */
export interface LadybugMigrationOptions {
  outputPath?: string;
  includeMetadata?: boolean;
  formatVersion?: string;
  compress?: boolean;
  validateGraph?: boolean;
}

/**
 * LadybugDB database schema
 */
export interface LadybugSchema {
  version: string;
  nodeTypes: Record<string, NodeTypeDefinition>;
  relationshipTypes: Record<string, RelationshipTypeDefinition>;
  indexes: IndexDefinition[];
}

/**
 * Node type definition for LadybugDB
 */
export interface NodeTypeDefinition {
  name: string;
  properties: Record<string, PropertyType>;
  description?: string;
}

/**
 * Relationship type definition for LadybugDB
 */
export interface RelationshipTypeDefinition {
  name: string;
  sourceType: string;
  targetType: string;
  properties?: Record<string, PropertyType>;
  isDirected: boolean;
  description?: string;
}

/**
 * Property type definition
 */
export enum PropertyType {
  STRING = "string",
  INTEGER = "integer",
  FLOAT = "float",
  BOOLEAN = "boolean",
  TIMESTAMP = "timestamp",
  JSON = "json",
}

/**
 * Index definition for LadybugDB
 */
export interface IndexDefinition {
  name: string;
  type: "unique" | "normal";
  properties: string[];
  nodeType?: string;
}

/**
 * LadybugDB formatted document
 */
export interface LadybugDocument {
  version: string;
  metadata: {
    name: string;
    description?: string;
    created: string;
    updated: string;
    nodeCount: number;
    edgeCount: number;
  };
  schema: LadybugSchema;
  data: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
}

/**
 * LadybugDB Migration Service
 */
export class LadybugMigrationService {
  private options: LadybugMigrationOptions;
  private static readonly FORMAT_VERSION = "1.0.0";

  constructor(options: LadybugMigrationOptions = {}) {
    this.options = {
      includeMetadata: true,
      formatVersion: LadybugMigrationService.FORMAT_VERSION,
      compress: false,
      validateGraph: true,
      ...options,
    };
  }

  /**
   * Generate LadybugDB document from nodes and edges
   */
  async generateLadybugDocument(
    nodes: GraphNode[],
    edges: GraphEdge[],
    modelName: string,
    description?: string
  ): Promise<LadybugDocument> {
    // Infer schema from data
    const schema = this.inferSchema(nodes, edges);

    const document: LadybugDocument = {
      version: this.options.formatVersion || LadybugMigrationService.FORMAT_VERSION,
      metadata: {
        name: modelName,
        description,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
      schema,
      data: {
        nodes,
        edges,
      },
    };

    return document;
  }

  /**
   * Infer schema from graph data
   */
  private inferSchema(nodes: GraphNode[], edges: GraphEdge[]): LadybugSchema {
    const nodeTypes: Record<string, NodeTypeDefinition> = {};
    const relationshipTypes: Record<string, RelationshipTypeDefinition> = {};
    const indexes: IndexDefinition[] = [];

    // Infer node types from labels
    for (const node of nodes) {
      for (const label of node.labels || ["Element"]) {
        if (!(label in nodeTypes)) {
          const properties: Record<string, PropertyType> = {
            id: PropertyType.STRING,
            name: PropertyType.STRING,
          };

          // Infer property types from sample properties
          for (const [key, value] of Object.entries(
            node.properties || {}
          )) {
            if (!properties[key]) {
              properties[key] = this.inferPropertyType(value);
            }
          }

          nodeTypes[label] = {
            name: label,
            properties,
            description: `${label} node type in architecture model`,
          };
        }
      }
    }

    // Add unique index for node IDs
    indexes.push({
      name: "node_id_unique",
      type: "unique",
      properties: ["id"],
    });

    // Infer relationship types from edges
    for (const edge of edges) {
      const key = edge.relationship;
      if (!(key in relationshipTypes)) {
        relationshipTypes[key] = {
          name: edge.relationship,
          sourceType: "Element",
          targetType: "Element",
          isDirected: true,
          properties: edge.properties ? {
            ...Object.entries(edge.properties).reduce((acc, [k, v]) => {
              acc[k] = this.inferPropertyType(v);
              return acc;
            }, {} as Record<string, PropertyType>),
          } : undefined,
        };
      }
    }

    // Add normal indexes for common queries
    indexes.push({
      name: "node_layer_idx",
      type: "normal",
      properties: ["layer"],
      nodeType: "Element",
    });

    indexes.push({
      name: "node_type_idx",
      type: "normal",
      properties: ["type"],
      nodeType: "Element",
    });

    return {
      version: this.options.formatVersion || LadybugMigrationService.FORMAT_VERSION,
      nodeTypes,
      relationshipTypes,
      indexes,
    };
  }

  /**
   * Infer property type from value
   */
  private inferPropertyType(value: unknown): PropertyType {
    if (value === null || value === undefined) {
      return PropertyType.STRING;
    }

    if (typeof value === "boolean") {
      return PropertyType.BOOLEAN;
    }

    if (typeof value === "number") {
      return Number.isInteger(value) ? PropertyType.INTEGER : PropertyType.FLOAT;
    }

    if (value instanceof Date || typeof value === "string" && this.isTimestamp(value as string)) {
      return PropertyType.TIMESTAMP;
    }

    if (typeof value === "object") {
      return PropertyType.JSON;
    }

    return PropertyType.STRING;
  }

  /**
   * Check if string looks like a timestamp
   */
  private isTimestamp(str: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str);
  }

  /**
   * Prepare schema for JSON serialization (already in Record format)
   */
  private convertSchemaToSerializable(schema: LadybugSchema): {
    version: string;
    nodeTypes: Record<string, NodeTypeDefinition>;
    relationshipTypes: Record<string, RelationshipTypeDefinition>;
    indexes: IndexDefinition[];
  } {
    // Schema is already in Record format, no conversion needed
    return {
      version: schema.version,
      nodeTypes: schema.nodeTypes,
      relationshipTypes: schema.relationshipTypes,
      indexes: schema.indexes,
    };
  }

  /**
   * Serialize document to JSON
   */
  serializeToJson(document: LadybugDocument): string {
    // Convert schema Maps to serializable objects
    const serializableDoc = {
      ...document,
      schema: this.convertSchemaToSerializable(document.schema),
    };
    return JSON.stringify(serializableDoc, null, 2);
  }

  /**
   * Serialize document to compact JSON (for storage)
   */
  serializeToCompactJson(document: LadybugDocument): string {
    // Convert schema Maps to serializable objects
    const serializableDoc = {
      ...document,
      schema: this.convertSchemaToSerializable(document.schema),
    };
    return JSON.stringify(serializableDoc);
  }

  /**
   * Generate LadybugDB SQL-like schema definition
   */
  generateSchemaDefinition(schema: LadybugSchema): string {
    const lines: string[] = [];

    lines.push("-- LadybugDB Schema Definition");
    lines.push("-- Generated from Documentation Robotics Model");
    lines.push("");

    // Node type definitions
    lines.push("-- Node Types");
    for (const [name, nodeDef] of Object.entries(schema.nodeTypes)) {
      lines.push(`CREATE NODE TYPE ${name} {`);
      for (const [propName, propType] of Object.entries(nodeDef.properties)) {
        lines.push(`  ${propName}: ${propType},`);
      }
      lines.push("};");
      lines.push("");
    }

    // Relationship type definitions
    lines.push("-- Relationship Types");
    for (const [name, relDef] of Object.entries(schema.relationshipTypes)) {
      const direction = relDef.isDirected ? "->" : "--";
      lines.push(
        `CREATE RELATIONSHIP TYPE ${name} (${relDef.sourceType} ${direction} ${relDef.targetType}) {`
      );
      if (relDef.properties) {
        for (const [propName, propType] of Object.entries(relDef.properties)) {
          lines.push(`  ${propName}: ${propType},`);
        }
      }
      lines.push("};");
      lines.push("");
    }

    // Indexes
    lines.push("-- Indexes");
    for (const index of schema.indexes) {
      const indexType = index.type === "unique" ? "UNIQUE" : "INDEX";
      const onClause = index.nodeType
        ? `ON ${index.nodeType}(${index.properties.join(", ")})`
        : `(${index.properties.join(", ")})`;
      lines.push(`CREATE ${indexType} ${index.name} ${onClause};`);
    }

    return lines.join("\n");
  }

  /**
   * Validate graph before migration
   */
  validateGraph(nodes: GraphNode[], edges: GraphEdge[]): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!Array.isArray(nodes)) {
      errors.push("Nodes must be an array");
    }

    if (!Array.isArray(edges)) {
      errors.push("Edges must be an array");
    }

    if (nodes.length === 0) {
      errors.push("Graph must contain at least one node");
    }

    const nodeIds = new Set(nodes.map((n) => n.id));

    for (const edge of edges) {
      if (!nodeIds.has(edge.source)) {
        errors.push(`Edge references non-existent source node: ${edge.source}`);
      }
      if (!nodeIds.has(edge.target)) {
        errors.push(`Edge references non-existent target node: ${edge.target}`);
      }
    }

    // Check for isolated nodes
    const connectedNodes = new Set<string>();
    for (const edge of edges) {
      connectedNodes.add(edge.source);
      connectedNodes.add(edge.target);
    }

    const isolatedCount = nodes.length - connectedNodes.size;
    if (isolatedCount > 0) {
      warnings.push(
        `Found ${isolatedCount} isolated node(s) with no relationships`
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
