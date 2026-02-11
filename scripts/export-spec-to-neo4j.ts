#!/usr/bin/env node
/**
 * Export Spec Metadata to Neo4j
 *
 * Exports the Documentation Robotics specification metadata to Neo4j format.
 * This exports the SPEC STRUCTURE (schema definitions), not model instances.
 *
 * Outputs:
 * - spec/neo4j/import.cypher - Cypher script for interactive import
 * - spec/neo4j/csv/ - CSV files for bulk import
 *
 * Usage:
 *   node scripts/export-spec-to-neo4j.ts
 */

import * as fs from "fs/promises";
import * as path from "path";
import { globSync } from "fs";

// ============================================================================
// Type Definitions
// ============================================================================

interface Layer {
  id: string;
  number: number;
  name: string;
  description: string;
  inspired_by?: {
    standard: string;
    version: string;
    url?: string;
  };
  node_types: string[];
}

interface NodeSchema {
  spec_node_id: string;
  layer_id: string;
  type: string;
  title: string;
  description: string;
  attributes: AttributeSpec[];
  schema?: any;
}

interface AttributeSpec {
  name: string;
  type: string;
  format?: string;
  required: boolean;
  description?: string;
}

interface RelationshipSchema {
  id: string;
  source_spec_node_id: string;
  source_layer: string;
  destination_spec_node_id: string;
  destination_layer: string;
  predicate: string;
  cardinality: string;
  strength: string;
  required?: boolean;
}

interface Predicate {
  predicate: string;
  inverse: string;
  category: string;
  description: string;
  archimate_alignment: string | null;
  semantics: {
    directionality: string;
    transitivity: boolean;
    symmetry: boolean;
    reflexivity?: boolean;
  };
}

interface SpecData {
  layers: Layer[];
  nodeSchemas: NodeSchema[];
  relationshipSchemas: RelationshipSchema[];
  predicates: Map<string, Predicate>;
}

interface MigrationGraphNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}

interface MigrationGraphEdge {
  id: string;
  source: string;
  target: string;
  relationship: string;
  properties?: Record<string, unknown>;
}

// ============================================================================
// Data Loader
// ============================================================================

class SpecDataLoader {
  constructor(private specDir: string) {}

  async loadAll(): Promise<SpecData> {
    const [layers, nodeSchemas, relationshipSchemas, predicates] = await Promise.all([
      this.loadLayers(),
      this.loadNodeSchemas(),
      this.loadRelationshipSchemas(),
      this.loadPredicates(),
    ]);

    return {
      layers,
      nodeSchemas,
      relationshipSchemas,
      predicates,
    };
  }

  private async loadLayers(): Promise<Layer[]> {
    const files = globSync(`${this.specDir}/layers/*.layer.json`);
    const layers = await Promise.all(
      files.map(async (f) => {
        const content = await fs.readFile(f, "utf-8");
        return JSON.parse(content) as Layer;
      })
    );
    return layers.sort((a, b) => a.number - b.number);
  }

  private async loadNodeSchemas(): Promise<NodeSchema[]> {
    const files = globSync(`${this.specDir}/schemas/nodes/**/*.node.schema.json`);
    const schemas = await Promise.all(
      files.map(async (f) => {
        const content = await fs.readFile(f, "utf-8");
        const schema = JSON.parse(content);

        // Extract const values from schema properties
        const spec_node_id = schema.properties?.spec_node_id?.const;
        const layer_id = schema.properties?.layer_id?.const;
        const type = schema.properties?.type?.const;

        if (!spec_node_id || !layer_id || !type) {
          console.warn(`Warning: Schema ${f} missing required const values`);
        }

        return {
          spec_node_id: spec_node_id || "unknown",
          layer_id: layer_id || "unknown",
          type: type || "unknown",
          title: schema.title || "",
          description: schema.description || "",
          attributes: this.extractAttributes(schema.properties?.attributes),
          schema: schema, // Keep full schema for optional export
        };
      })
    );
    return schemas;
  }

  private extractAttributes(attributesSchema: any): AttributeSpec[] {
    if (!attributesSchema || !attributesSchema.properties) {
      return [];
    }

    const props = attributesSchema.properties;
    const required = new Set(attributesSchema.required || []);

    return Object.entries(props).map(([name, schema]: [string, any]) => ({
      name,
      type: schema.type || "unknown",
      format: schema.format,
      required: required.has(name),
      description: schema.description,
    }));
  }

  private async loadRelationshipSchemas(): Promise<RelationshipSchema[]> {
    const files = globSync(`${this.specDir}/schemas/relationships/**/*.relationship.schema.json`);
    const schemas = await Promise.all(
      files.map(async (f) => {
        const content = await fs.readFile(f, "utf-8");
        const schema = JSON.parse(content);

        return {
          id: schema.properties?.id?.const || "unknown",
          source_spec_node_id: schema.properties?.source_spec_node_id?.const || "unknown",
          source_layer: schema.properties?.source_layer?.const || "unknown",
          destination_spec_node_id: schema.properties?.destination_spec_node_id?.const || "unknown",
          destination_layer: schema.properties?.destination_layer?.const || "unknown",
          predicate: schema.properties?.predicate?.const || "unknown",
          cardinality: schema.properties?.cardinality?.const || "many-to-many",
          strength: schema.properties?.strength?.const || "medium",
          required: schema.properties?.required?.const,
        };
      })
    );
    return schemas;
  }

  private async loadPredicates(): Promise<Map<string, Predicate>> {
    const content = await fs.readFile(
      `${this.specDir}/schemas/base/predicates.json`,
      "utf-8"
    );
    const data = JSON.parse(content);

    const predicates = new Map<string, Predicate>();
    for (const [, pred] of Object.entries(data.predicates) as [string, any][]) {
      predicates.set(pred.predicate, {
        predicate: pred.predicate,
        inverse: pred.inverse,
        category: pred.category,
        description: pred.description,
        archimate_alignment: pred.archimate_alignment,
        semantics: pred.semantics,
      });
    }

    return predicates;
  }
}

// ============================================================================
// Graph Builder
// ============================================================================

class SpecGraphBuilder {
  constructor(
    private data: SpecData,
    private options: { includeSchemas?: boolean } = {}
  ) {}

  buildNodes(): MigrationGraphNode[] {
    const nodes: MigrationGraphNode[] = [];

    // SpecNode nodes (354)
    for (const schema of this.data.nodeSchemas) {
      nodes.push({
        id: schema.spec_node_id,
        labels: ["SpecNode", `SpecNode_${schema.layer_id.replace(/-/g, '_')}`],
        properties: {
          spec_node_id: schema.spec_node_id,
          layer_id: schema.layer_id,
          type: schema.type,
          title: schema.title,
          description: schema.description,
          required_attribute_count: schema.attributes.filter((a) => a.required).length,
          total_attribute_count: schema.attributes.length,
          schema_json: this.options.includeSchemas
            ? JSON.stringify(schema.schema)
            : undefined,
        },
      });
    }

    // SpecRelationship nodes (252)
    for (const rel of this.data.relationshipSchemas) {
      nodes.push({
        id: rel.id,
        labels: ["SpecRelationship"],
        properties: {
          id: rel.id,
          source_spec_node_id: rel.source_spec_node_id,
          source_layer: rel.source_layer,
          destination_spec_node_id: rel.destination_spec_node_id,
          destination_layer: rel.destination_layer,
          predicate: rel.predicate,
          cardinality: rel.cardinality,
          strength: rel.strength,
          required: rel.required || false,
        },
      });
    }

    // Predicate nodes (47)
    for (const [, pred] of this.data.predicates) {
      nodes.push({
        id: `predicate:${pred.predicate}`,
        labels: ["Predicate"],
        properties: {
          predicate: pred.predicate,
          inverse: pred.inverse,
          category: pred.category,
          description: pred.description,
          archimate_alignment: pred.archimate_alignment,
          directionality: pred.semantics.directionality,
          transitivity: pred.semantics.transitivity,
          symmetry: pred.semantics.symmetry,
          reflexivity: pred.semantics.reflexivity,
        },
      });
    }

    // PredicateCategory nodes (synthetic)
    const categories = new Set(Array.from(this.data.predicates.values()).map((p) => p.category));
    for (const category of categories) {
      nodes.push({
        id: `category:${category}`,
        labels: ["PredicateCategory"],
        properties: {
          name: category,
        },
      });
    }

    // Layer nodes (12)
    for (const layer of this.data.layers) {
      nodes.push({
        id: `layer:${layer.id}`,
        labels: ["Layer"],
        properties: {
          id: layer.id,
          number: layer.number,
          name: layer.name,
          description: layer.description,
          standard: layer.inspired_by?.standard,
          standard_version: layer.inspired_by?.version,
          node_type_count: layer.node_types.length,
        },
      });
    }

    // AttributeSpec nodes
    for (const schema of this.data.nodeSchemas) {
      for (const attr of schema.attributes) {
        nodes.push({
          id: `${schema.spec_node_id}.${attr.name}`,
          labels: ["AttributeSpec"],
          properties: {
            id: `${schema.spec_node_id}.${attr.name}`,
            spec_node_id: schema.spec_node_id,
            name: attr.name,
            type: attr.type,
            format: attr.format,
            required: attr.required,
            description: attr.description,
          },
        });
      }
    }

    return nodes;
  }

  buildEdges(): MigrationGraphEdge[] {
    const edges: MigrationGraphEdge[] = [];

    // BELONGS_TO_LAYER: SpecNode → Layer
    for (const schema of this.data.nodeSchemas) {
      edges.push({
        id: `${schema.spec_node_id}:belongs_to:${schema.layer_id}`,
        source: schema.spec_node_id,
        target: `layer:${schema.layer_id}`,
        relationship: "BELONGS_TO_LAYER",
        properties: {},
      });
    }

    // HAS_SOURCE: SpecRelationship → SpecNode
    for (const rel of this.data.relationshipSchemas) {
      edges.push({
        id: `${rel.id}:has_source`,
        source: rel.id,
        target: rel.source_spec_node_id,
        relationship: "HAS_SOURCE",
        properties: {},
      });
    }

    // HAS_TARGET: SpecRelationship → SpecNode
    for (const rel of this.data.relationshipSchemas) {
      edges.push({
        id: `${rel.id}:has_target`,
        source: rel.id,
        target: rel.destination_spec_node_id,
        relationship: "HAS_TARGET",
        properties: {},
      });
    }

    // USES_PREDICATE: SpecRelationship → Predicate
    for (const rel of this.data.relationshipSchemas) {
      edges.push({
        id: `${rel.id}:uses:${rel.predicate}`,
        source: rel.id,
        target: `predicate:${rel.predicate}`,
        relationship: "USES_PREDICATE",
        properties: {},
      });
    }

    // HAS_ATTRIBUTE: SpecNode → AttributeSpec
    for (const schema of this.data.nodeSchemas) {
      for (let i = 0; i < schema.attributes.length; i++) {
        const attr = schema.attributes[i];
        edges.push({
          id: `${schema.spec_node_id}:has_attr:${attr.name}`,
          source: schema.spec_node_id,
          target: `${schema.spec_node_id}.${attr.name}`,
          relationship: "HAS_ATTRIBUTE",
          properties: { order: i },
        });
      }
    }

    // IN_CATEGORY: Predicate → PredicateCategory
    for (const [, pred] of this.data.predicates) {
      edges.push({
        id: `${pred.predicate}:in_category:${pred.category}`,
        source: `predicate:${pred.predicate}`,
        target: `category:${pred.category}`,
        relationship: "IN_CATEGORY",
        properties: {},
      });
    }

    return edges;
  }
}

// ============================================================================
// Export Functions
// ============================================================================

function generateVerificationQueries(): string {
  return `
// ============================================================================
// Verification Queries
// ============================================================================

// 1. Count validation
MATCH (n:SpecNode) RETURN COUNT(n) AS specNodes; // Expected: ~212
MATCH (n:SpecRelationship) RETURN COUNT(n) AS specRelationships; // Expected: ~252
MATCH (n:Predicate) RETURN COUNT(n) AS predicates; // Expected: 47
MATCH (n:Layer) RETURN COUNT(n) AS layers; // Expected: 12

// 2. Relationship integrity - source validation
MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(sn:SpecNode)
WHERE sr.source_spec_node_id = sn.spec_node_id
RETURN COUNT(*) AS validSources; // Expected: ~252

// 3. Relationship integrity - target validation
MATCH (sr:SpecRelationship)-[:HAS_TARGET]->(sn:SpecNode)
WHERE sr.destination_spec_node_id = sn.spec_node_id
RETURN COUNT(*) AS validTargets; // Expected: ~252

// 4. Orphan detection
MATCH (sr:SpecRelationship)
WHERE NOT EXISTS((sr)-[:HAS_SOURCE]->()) OR NOT EXISTS((sr)-[:HAS_TARGET]->())
RETURN COUNT(*) AS orphans; // Expected: 0

// 5. Layer distribution
MATCH (sn:SpecNode)-[:BELONGS_TO_LAYER]->(l:Layer)
RETURN l.number, l.name, COUNT(sn) AS nodeCount
ORDER BY l.number;

// 6. Predicate usage
MATCH (sr:SpecRelationship)-[:USES_PREDICATE]->(p:Predicate)
RETURN p.predicate, p.category, COUNT(sr) AS usage
ORDER BY usage DESC;

// ============================================================================
// Example Analysis Queries
// ============================================================================

// Find cross-layer relationships
MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(source:SpecNode)-[:BELONGS_TO_LAYER]->(l1:Layer)
MATCH (sr)-[:HAS_TARGET]->(target:SpecNode)-[:BELONGS_TO_LAYER]->(l2:Layer)
WHERE l1.id <> l2.id
RETURN l1.name AS sourceLayer, l2.name AS targetLayer, COUNT(sr) AS relationships
ORDER BY relationships DESC;

// Find most connected node types
MATCH (sn:SpecNode)
WITH sn, size((sn)<-[:HAS_SOURCE]-()) + size((sn)<-[:HAS_TARGET]-()) AS connections
RETURN sn.spec_node_id, sn.type, connections
ORDER BY connections DESC
LIMIT 10;

// Analyze predicate categories
MATCH (p:Predicate)-[:IN_CATEGORY]->(c:PredicateCategory)
RETURN c.name, COUNT(p) AS predicateCount
ORDER BY predicateCount DESC;

// Find node types with most required attributes
MATCH (sn:SpecNode)
RETURN sn.spec_node_id, sn.required_attribute_count
ORDER BY sn.required_attribute_count DESC
LIMIT 10;
`;
}

async function exportCypher(
  nodes: MigrationGraphNode[],
  edges: MigrationGraphEdge[],
  outputPath: string
): Promise<void> {
  const lines: string[] = [];

  // Header
  lines.push("// ============================================================================");
  lines.push("// Spec Metadata Export to Neo4j");
  lines.push("// ============================================================================");
  lines.push("// Generated: " + new Date().toISOString());
  lines.push("// Source: Documentation Robotics Specification v0.8.0");
  lines.push("//");
  lines.push("// Stats:");
  lines.push(`//   - ${nodes.filter((n) => n.labels.includes("SpecNode")).length} SpecNode types`);
  lines.push(
    `//   - ${nodes.filter((n) => n.labels.includes("SpecRelationship")).length} SpecRelationship types`
  );
  lines.push(`//   - ${nodes.filter((n) => n.labels.includes("Predicate")).length} Predicates`);
  lines.push(`//   - ${nodes.filter((n) => n.labels.includes("Layer")).length} Layers`);
  lines.push(
    `//   - ${nodes.filter((n) => n.labels.includes("AttributeSpec")).length} AttributeSpecs`
  );
  lines.push(`//   - ${edges.length} Relationships`);
  lines.push("//");
  lines.push("// ============================================================================");
  lines.push("");

  // Constraints
  lines.push("// Create constraints for unique identifiers");
  lines.push(
    "CREATE CONSTRAINT spec_node_id IF NOT EXISTS FOR (n:SpecNode) REQUIRE n.spec_node_id IS UNIQUE;"
  );
  lines.push(
    "CREATE CONSTRAINT spec_relationship_id IF NOT EXISTS FOR (n:SpecRelationship) REQUIRE n.id IS UNIQUE;"
  );
  lines.push(
    "CREATE CONSTRAINT predicate_name IF NOT EXISTS FOR (n:Predicate) REQUIRE n.predicate IS UNIQUE;"
  );
  lines.push("CREATE CONSTRAINT layer_id IF NOT EXISTS FOR (n:Layer) REQUIRE n.id IS UNIQUE;");
  lines.push(
    "CREATE CONSTRAINT attribute_id IF NOT EXISTS FOR (n:AttributeSpec) REQUIRE n.id IS UNIQUE;"
  );
  lines.push("");

  // Indexes
  lines.push("// Create indexes for common queries");
  lines.push("CREATE INDEX spec_node_layer IF NOT EXISTS FOR (n:SpecNode) ON (n.layer_id);");
  lines.push("CREATE INDEX spec_node_type IF NOT EXISTS FOR (n:SpecNode) ON (n.type);");
  lines.push(
    "CREATE INDEX spec_relationship_predicate IF NOT EXISTS FOR (n:SpecRelationship) ON (n.predicate);"
  );
  lines.push("CREATE INDEX predicate_category IF NOT EXISTS FOR (n:Predicate) ON (n.category);");
  lines.push("");

  // Create nodes
  lines.push("// ============================================================================");
  lines.push("// Create Nodes");
  lines.push("// ============================================================================");
  lines.push("");

  for (const node of nodes) {
    const labels = node.labels.join(":");
    const propsEntries = Object.entries(node.properties)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => {
        if (typeof v === "string") {
          return `${k}: ${JSON.stringify(v)}`;
        } else if (typeof v === "boolean" || typeof v === "number") {
          return `${k}: ${v}`;
        } else {
          return `${k}: ${JSON.stringify(v)}`;
        }
      });

    lines.push(`CREATE (n:${labels} {${propsEntries.join(", ")}});`);
  }
  lines.push("");

  // Build lookup maps for node labels
  const nodeLabelMap = new Map<string, string>();
  for (const node of nodes) {
    // Store the primary label (first one that's not generic)
    const primaryLabel = node.labels.find(l =>
      l !== "Element" && l !== "SpecNode" && !l.startsWith("SpecNode_")
    ) || node.labels[0];
    nodeLabelMap.set(node.id, primaryLabel);
  }

  // Create edges
  lines.push("// ============================================================================");
  lines.push("// Create Relationships");
  lines.push("// ============================================================================");
  lines.push("");

  for (const edge of edges) {
    const props =
      edge.properties && Object.keys(edge.properties).length > 0
        ? ` {${Object.entries(edge.properties)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join(", ")}}`
        : "";

    // Get labels from node lookup
    const sourceLabel = nodeLabelMap.get(edge.source) || "SpecNode";
    const targetLabel = nodeLabelMap.get(edge.target) || "SpecNode";

    // Determine property key and value for matching
    let sourceProp = "id";
    let sourceValue = edge.source;
    if (sourceLabel === "SpecNode") {
      sourceProp = "spec_node_id";
    } else if (sourceLabel === "Predicate") {
      sourceProp = "predicate";
      // Strip "predicate:" prefix for matching
      sourceValue = edge.source.replace(/^predicate:/, "");
    } else if (sourceLabel === "Layer") {
      sourceProp = "id";
      // Strip "layer:" prefix for matching
      sourceValue = edge.source.replace(/^layer:/, "");
    } else if (sourceLabel === "PredicateCategory") {
      sourceProp = "name";
      sourceValue = edge.source.replace(/^category:/, "");
    }

    let targetProp = "id";
    let targetValue = edge.target;
    if (targetLabel === "SpecNode") {
      targetProp = "spec_node_id";
    } else if (targetLabel === "Predicate") {
      targetProp = "predicate";
      // Strip "predicate:" prefix for matching
      targetValue = edge.target.replace(/^predicate:/, "");
    } else if (targetLabel === "Layer") {
      targetProp = "id";
      // Strip "layer:" prefix for matching
      targetValue = edge.target.replace(/^layer:/, "");
    } else if (targetLabel === "PredicateCategory") {
      targetProp = "name";
      targetValue = edge.target.replace(/^category:/, "");
    }

    const sourceId = JSON.stringify(sourceValue);
    const targetId = JSON.stringify(targetValue);

    lines.push(
      `MATCH (s:${sourceLabel}), (t:${targetLabel}) WHERE s.${sourceProp} = ${sourceId} AND t.${targetProp} = ${targetId} CREATE (s)-[r:${edge.relationship}${props}]->(t);`
    );
  }
  lines.push("");

  // Verification queries
  lines.push(generateVerificationQueries());

  const script = lines.join("\n");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, script, "utf-8");

  console.log(`✓ Wrote Cypher script to ${outputPath}`);
}

async function exportCsv(
  nodes: MigrationGraphNode[],
  edges: MigrationGraphEdge[],
  outputDir: string
): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });

  // Generate nodes CSV
  const nodeLines: string[] = [];
  nodeLines.push("id:ID,labels:LABEL,properties:JSON");

  for (const node of nodes) {
    const id = escapeCsv(node.id);
    const labels = node.labels.join(";");
    const properties = JSON.stringify(node.properties).replace(/"/g, '""');
    nodeLines.push(`${id},${labels},"${properties}"`);
  }

  await fs.writeFile(path.join(outputDir, "nodes.csv"), nodeLines.join("\n"));

  // Generate edges CSV
  const edgeLines: string[] = [];
  edgeLines.push(":START_ID,:TYPE,:END_ID,properties:JSON");

  for (const edge of edges) {
    const source = escapeCsv(edge.source);
    const target = escapeCsv(edge.target);
    const type = edge.relationship;
    const properties = edge.properties ? JSON.stringify(edge.properties).replace(/"/g, '""') : "{}";
    edgeLines.push(`${source},${type},${target},"${properties}"`);
  }

  await fs.writeFile(path.join(outputDir, "edges.csv"), edgeLines.join("\n"));

  // Generate import script
  const importScript = `#!/bin/bash
# Neo4j Import Script
# Load spec metadata CSV files into Neo4j

neo4j-admin database import full \\
  --nodes=${outputDir}/nodes.csv \\
  --relationships=${outputDir}/edges.csv \\
  --overwrite-destination \\
  neo4j

echo "Import complete. Start Neo4j and visit http://localhost:7474"
`;

  await fs.writeFile(path.join(outputDir, "import.sh"), importScript);
  await fs.chmod(path.join(outputDir, "import.sh"), 0o755);

  console.log(`✓ Wrote CSV files to ${outputDir}/`);
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("Loading spec metadata...");
  const loader = new SpecDataLoader("./spec");
  const data = await loader.loadAll();

  console.log(`Loaded:
  - ${data.layers.length} layers
  - ${data.nodeSchemas.length} node schemas
  - ${data.relationshipSchemas.length} relationship schemas
  - ${data.predicates.size} predicates
`);

  console.log("Building graph...");
  const builder = new SpecGraphBuilder(data);
  const nodes = builder.buildNodes();
  const edges = builder.buildEdges();

  console.log(`Built graph:
  - ${nodes.length} nodes
  - ${edges.length} edges
`);

  // Export to Cypher
  console.log("Exporting to Cypher...");
  await exportCypher(nodes, edges, "spec/neo4j/import.cypher");

  // Export to CSV
  console.log("Exporting to CSV...");
  await exportCsv(nodes, edges, "spec/neo4j/csv");

  console.log("\n✅ Export complete!");
  console.log("\nNext steps:");
  console.log("1. Start Neo4j: docker run -p 7474:7474 -p 7687:7687 neo4j:latest");
  console.log("2. Load data: cat spec/neo4j/import.cypher | cypher-shell -u neo4j -p password");
  console.log("3. Or use CSV: cd spec/neo4j/csv && ./import.sh");
  console.log("4. Browse: http://localhost:7474");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
