/**
 * Neo4j Migration Helper
 *
 * Provides tools for migrating architecture models to Neo4j graph database.
 * Supports Cypher script generation and direct database operations.
 */

import type { MigrationGraphNode, MigrationGraphEdge } from "./graph-migration.js";

// Aliases for convenience
export type GraphNode = MigrationGraphNode;
export type GraphEdge = MigrationGraphEdge;

/**
 * Neo4j migration options
 */
export interface Neo4jMigrationOptions {
  uri?: string;
  username?: string;
  password?: string;
  database?: string;
  boltPort?: number;
  generateCypher?: boolean;
  createConstraints?: boolean;
  createIndexes?: boolean;
  dropExisting?: boolean;
  batchSize?: number;
}

/**
 * Result from Neo4j migration
 */
export interface Neo4jMigrationResult {
  success: boolean;
  nodesCreated?: number;
  edgesCreated?: number;
  constraintsCreated?: number;
  indexesCreated?: number;
  scriptContent?: string;
  warnings: string[];
  errors: string[];
}

/**
 * Neo4j Cypher Script Generator
 */
export class Neo4jCypherGenerator {
  /**
   * Generate Cypher script for creating nodes from GraphNodes
   */
  static generateNodeCreationScript(_nodes: GraphNode[]): string {
    const lines: string[] = [];

    // Add constraints
    lines.push("// Create constraints for unique node IDs");
    lines.push(
      "CREATE CONSTRAINT element_id IF NOT EXISTS FOR (n:Element) REQUIRE n.id IS UNIQUE;"
    );
    lines.push("");

    // Add indexes
    lines.push("// Create indexes for common queries");
    lines.push("CREATE INDEX node_layer IF NOT EXISTS FOR (n:Element) ON (n.layer);");
    lines.push("CREATE INDEX node_type IF NOT EXISTS FOR (n:Element) ON (n.type);");
    lines.push("");

    // Create nodes
    lines.push("// Create architecture model nodes");
    lines.push("UNWIND $nodes AS nodeData");
    lines.push("CREATE (n:Element)");
    lines.push("SET n = nodeData.properties");
    lines.push("SET n.id = nodeData.id");
    lines.push(
      "FOREACH (label IN nodeData.labels | CALL apoc.create.addLabels(n, [label]) YIELD node RETURN node)"
    );
    lines.push(";");
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Generate Cypher script for creating edges from GraphEdges
   */
  static generateEdgeCreationScript(_edges: GraphEdge[]): string {
    const lines: string[] = [];

    lines.push("// Create relationships between nodes");
    lines.push("UNWIND $edges AS edgeData");
    lines.push("MATCH (source:Element {id: edgeData.source})");
    lines.push("MATCH (target:Element {id: edgeData.target})");
    lines.push(
      "CALL apoc.create.relationship(source, edgeData.relationship, edgeData.properties, target) YIELD rel"
    );
    lines.push("RETURN COUNT(*) as edgesCreated");
    lines.push(";");
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Generate a complete migration Cypher script
   */
  static generateCompleteMigrationScript(
    nodes: GraphNode[],
    edges: GraphEdge[],
    dropExisting: boolean = false
  ): string {
    const lines: string[] = [];

    // Header
    lines.push("// Neo4j Migration Script");
    lines.push("// Generated from Documentation Robotics Model");
    lines.push("// Execute this script in your Neo4j instance");
    lines.push("");

    // Drop existing data if requested
    if (dropExisting) {
      lines.push("// WARNING: Dropping all existing data");
      lines.push("MATCH (n) DETACH DELETE n;");
      lines.push("DROP INDEX IF EXISTS element_id;");
      lines.push("DROP INDEX IF EXISTS node_layer;");
      lines.push("DROP INDEX IF EXISTS node_type;");
      lines.push("");
      lines.push("// Creating new nodes and relationships:");
      lines.push("");
    }

    // Add node creation
    lines.push(this.generateNodeCreationScript(nodes));

    // Add edge creation
    lines.push(this.generateEdgeCreationScript(edges));

    // Add query examples
    lines.push("// Example queries to validate migration");
    lines.push("");
    lines.push("// 1. Count total nodes and edges");
    lines.push("MATCH (n) RETURN COUNT(n) AS totalNodes;");
    lines.push("MATCH ()-[r]->() RETURN COUNT(r) AS totalEdges;");
    lines.push("");

    lines.push("// 2. Find all nodes in a specific layer");
    lines.push("MATCH (n:Element {layer: 'api'}) RETURN n;");
    lines.push("");

    lines.push("// 3. Find relationships of a specific type");
    lines.push("MATCH (n)-[r:REFERENCES_API]->() RETURN n, r;");
    lines.push("");

    lines.push("// 4. Find connected components");
    lines.push("MATCH (n:Element)-[r*0..2]-(m:Element) RETURN DISTINCT n, m, COUNT(r) as hops;");
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Generate connection parameters in Cypher
   */
  static generateConnectionConfig(options: Neo4jMigrationOptions): Record<string, string> {
    // Throw error if critical credentials are missing
    if (!options.username || !options.password) {
      throw new Error(
        "Neo4j credentials are required for migration. " +
        "Provide username and password in options or set NEO4J_USER and NEO4J_PASSWORD environment variables. " +
        "Optionally set NEO4J_URI (defaults to bolt://localhost:7687)."
      );
    }

    return {
      uri: options.uri || "bolt://localhost:7687",
      username: options.username,
      password: options.password,
      database: options.database || "neo4j",
    };
  }
}

/**
 * Neo4j Migration Service
 */
export class Neo4jMigrationService {
  private options: Neo4jMigrationOptions;

  constructor(options: Neo4jMigrationOptions = {}) {
    this.options = {
      boltPort: 7687,
      database: "neo4j",
      createConstraints: true,
      createIndexes: true,
      dropExisting: false,
      batchSize: 1000,
      generateCypher: true,
      ...options,
    };
  }

  /**
   * Generate migration script for nodes and edges
   */
  async generateMigrationScript(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): Promise<Neo4jMigrationResult> {
    const result: Neo4jMigrationResult = {
      success: false,
      warnings: [],
      errors: [],
    };

    try {
      // Validate input
      if (!Array.isArray(nodes) || !Array.isArray(edges)) {
        result.errors.push("Nodes and edges must be arrays");
        return result;
      }

      if (nodes.length === 0) {
        result.errors.push("Cannot migrate empty graph (no nodes)");
        return result;
      }

      // Generate Cypher script
      const script = Neo4jCypherGenerator.generateCompleteMigrationScript(
        nodes,
        edges,
        this.options.dropExisting
      );

      result.scriptContent = script;
      result.success = true;

      return result;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      return result;
    }
  }

  /**
   * Generate parameterized Cypher for batch creation
   */
  async generateBatchCreationScripts(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): Promise<{ nodeScripts: string[]; edgeScripts: string[] }> {
    const nodeScripts: string[] = [];
    const edgeScripts: string[] = [];
    const batchSize = this.options.batchSize || 1000;

    // Batch node creation
    for (let i = 0; i < nodes.length; i += batchSize) {
      const batch = nodes.slice(i, Math.min(i + batchSize, nodes.length));
      const script = this.generateNodeBatch(batch);
      nodeScripts.push(script);
    }

    // Batch edge creation
    for (let i = 0; i < edges.length; i += batchSize) {
      const batch = edges.slice(i, Math.min(i + batchSize, edges.length));
      const script = this.generateEdgeBatch(batch);
      edgeScripts.push(script);
    }

    return { nodeScripts, edgeScripts };
  }

  /**
   * Generate Cypher for a batch of nodes
   */
  private generateNodeBatch(nodes: GraphNode[]): string {
    const lines: string[] = [];

    lines.push(`// Batch: Create ${nodes.length} nodes (${nodes.map((n) => n.id).join(", ")})`);
    lines.push("UNWIND $nodes AS nodeData");
    lines.push("CREATE (n:Element)");
    lines.push("SET n = nodeData.properties");
    lines.push("SET n.id = nodeData.id");
    lines.push(";");

    return lines.join("\n");
  }

  /**
   * Generate Cypher for a batch of edges
   */
  private generateEdgeBatch(edges: GraphEdge[]): string {
    const lines: string[] = [];

    lines.push(`// Batch: Create ${edges.length} relationships`);
    lines.push("UNWIND $edges AS edgeData");
    lines.push("MATCH (source:Element {id: edgeData.source})");
    lines.push("MATCH (target:Element {id: edgeData.target})");
    lines.push("CREATE (source)-[r:RELATIONSHIP]->(target)");
    lines.push("SET r = edgeData.properties");
    lines.push("SET r.type = edgeData.relationship");
    lines.push("RETURN COUNT(r) as created");
    lines.push(";");

    return lines.join("\n");
  }

  /**
   * Generate Neo4j import tool CSV files
   */
  generateImportCsvFiles(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): { nodesCsv: string; edgesCsv: string } {
    const nodesCsv = this.generateNodesCsv(nodes);
    const edgesCsv = this.generateEdgesCsv(edges);
    return { nodesCsv, edgesCsv };
  }

  /**
   * Generate CSV for nodes
   */
  private generateNodesCsv(nodes: GraphNode[]): string {
    const lines: string[] = [];

    // Header
    lines.push("id:ID,name,layer,type,:LABEL");

    // Rows
    for (const node of nodes) {
      const labels = (node.labels || ["Element"]).join(";");
      const name = this.escapeCsv((node.properties.name as string) || "");
      const layer = this.escapeCsv((node.properties.layer as string) || "");
      const type = this.escapeCsv((node.properties.type as string) || "");
      const id = this.escapeCsv(node.id);

      // Use escaped values directly - escapeCsv handles quoting when needed
      lines.push(`${id},${name},${layer},${type},${labels}`);
    }

    return lines.join("\n");
  }

  /**
   * Generate CSV for edges
   */
  private generateEdgesCsv(edges: GraphEdge[]): string {
    const lines: string[] = [];

    // Header
    lines.push(":START_ID,:TYPE,:END_ID,relationship");

    // Rows
    for (const edge of edges) {
      const source = this.escapeCsv(edge.source);
      const relationship = this.escapeCsv(edge.relationship);
      const target = this.escapeCsv(edge.target);

      lines.push(`${source},${relationship},${target},${relationship}`);
    }

    return lines.join("\n");
  }

  /**
   * Escape CSV values - wraps in quotes and escapes internal quotes
   */
  private escapeCsv(value: string): string {
    // Always wrap in quotes for consistency, escape internal quotes
    return `"${value.replace(/"/g, '""')}"`;
  }
}
