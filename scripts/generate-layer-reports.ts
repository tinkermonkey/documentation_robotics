#!/usr/bin/env node
/**
 * Generate Layer Reports
 *
 * Generates markdown documentation for all 12 architecture layers with:
 * - Mermaid intra-layer and inter-layer diagrams
 * - Relationship tables
 * - Navigation and metadata
 *
 * Outputs:
 * - spec/browser/README.md - Overview with matrix and glossary
 * - spec/browser/{NN}-{layer}-layer-report.md - 12 layer reports
 *
 * Usage:
 *   node scripts/generate-layer-reports.ts
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

interface LayerReportData {
  layer: Layer;
  nodeSchemas: NodeSchema[];
  intraRelationships: RelationshipSchema[];
  interRelationships: RelationshipSchema[];
  upstreamLayers: Layer[];
  downstreamLayers: Layer[];
  statistics: LayerStatistics;
}

interface LayerStatistics {
  nodeCount: number;
  intraRelationshipCount: number;
  interRelationshipCount: number;
  inboundRelationshipCount: number;
  outboundRelationshipCount: number;
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

        const spec_node_id = schema.properties?.spec_node_id?.const;
        const layer_id = schema.properties?.layer_id?.const;
        const type = schema.properties?.type?.const;

        if (!spec_node_id || !layer_id || !type) {
          console.warn(`Warning: Node schema ${f} missing required const values`);
        }

        return {
          spec_node_id: spec_node_id || "unknown",
          layer_id: layer_id || "unknown",
          type: type || "unknown",
          title: schema.title || "",
          description: schema.description || "",
        };
      })
    );
    return schemas;
  }

  private async loadRelationshipSchemas(): Promise<RelationshipSchema[]> {
    const files = globSync(`${this.specDir}/schemas/relationships/**/*.relationship.schema.json`);
    const schemas = await Promise.all(
      files.map(async (f) => {
        const content = await fs.readFile(f, "utf-8");
        const schema = JSON.parse(content);

        const id = schema.properties?.id?.const;
        const source_spec_node_id = schema.properties?.source_spec_node_id?.const;
        const source_layer = schema.properties?.source_layer?.const;
        const destination_spec_node_id = schema.properties?.destination_spec_node_id?.const;
        const destination_layer = schema.properties?.destination_layer?.const;
        const predicate = schema.properties?.predicate?.const;

        if (!id || !source_spec_node_id || !source_layer || !destination_spec_node_id || !destination_layer || !predicate) {
          console.warn(`Warning: Relationship schema ${f} missing required const values`);
        }

        return {
          id: id || "unknown",
          source_spec_node_id: source_spec_node_id || "unknown",
          source_layer: source_layer || "unknown",
          destination_spec_node_id: destination_spec_node_id || "unknown",
          destination_layer: destination_layer || "unknown",
          predicate: predicate || "unknown",
          cardinality: schema.properties?.cardinality?.const || "many-to-many",
          strength: schema.properties?.strength?.const || "medium",
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
// Report Data Model
// ============================================================================

class ReportDataModel {
  private data: SpecData;
  private layerMap: Map<string, Layer>;
  private nodeSchemasByLayer: Map<string, NodeSchema[]>;
  private relationshipsBySourceLayer: Map<string, RelationshipSchema[]>;
  private relationshipsByDestinationLayer: Map<string, RelationshipSchema[]>;

  constructor(data: SpecData) {
    this.data = data;
    this.layerMap = new Map(data.layers.map((l) => [l.id, l]));
    this.nodeSchemasByLayer = this.buildNodeSchemasByLayer();
    this.relationshipsBySourceLayer = this.buildRelationshipsBySourceLayer();
    this.relationshipsByDestinationLayer = this.buildRelationshipsByDestinationLayer();
  }

  private buildNodeSchemasByLayer(): Map<string, NodeSchema[]> {
    const map = new Map<string, NodeSchema[]>();
    for (const layer of this.data.layers) {
      const schemas = this.data.nodeSchemas.filter((s) => s.layer_id === layer.id);
      map.set(layer.id, schemas);
    }
    return map;
  }

  private buildRelationshipsBySourceLayer(): Map<string, RelationshipSchema[]> {
    const map = new Map<string, RelationshipSchema[]>();
    for (const rel of this.data.relationshipSchemas) {
      if (!map.has(rel.source_layer)) {
        map.set(rel.source_layer, []);
      }
      map.get(rel.source_layer)!.push(rel);
    }
    return map;
  }

  private buildRelationshipsByDestinationLayer(): Map<string, RelationshipSchema[]> {
    const map = new Map<string, RelationshipSchema[]>();
    for (const rel of this.data.relationshipSchemas) {
      if (!map.has(rel.destination_layer)) {
        map.set(rel.destination_layer, []);
      }
      map.get(rel.destination_layer)!.push(rel);
    }
    return map;
  }

  getLayerReportData(layerId: string): LayerReportData {
    const layer = this.layerMap.get(layerId);
    if (!layer) {
      throw new Error(`Layer not found: ${layerId}`);
    }

    const nodeSchemas = this.nodeSchemasByLayer.get(layerId) || [];
    const allRelationships = this.data.relationshipSchemas.filter(
      (r) => r.source_layer === layerId || r.destination_layer === layerId
    );

    const intraRelationships = allRelationships.filter(
      (r) => r.source_layer === layerId && r.destination_layer === layerId
    );

    const interRelationships = allRelationships.filter(
      (r) => r.source_layer !== layerId || r.destination_layer !== layerId
    );

    const upstreamLayerIds = new Set<string>();
    const downstreamLayerIds = new Set<string>();

    for (const rel of interRelationships) {
      if (rel.destination_layer === layerId && rel.source_layer !== layerId) {
        upstreamLayerIds.add(rel.source_layer);
      }
      if (rel.source_layer === layerId && rel.destination_layer !== layerId) {
        downstreamLayerIds.add(rel.destination_layer);
      }
    }

    const upstreamLayers = Array.from(upstreamLayerIds)
      .map((id) => this.layerMap.get(id))
      .filter((layer): layer is Layer => layer !== undefined)
      .sort((a, b) => a.number - b.number);

    const downstreamLayers = Array.from(downstreamLayerIds)
      .map((id) => this.layerMap.get(id))
      .filter((layer): layer is Layer => layer !== undefined)
      .sort((a, b) => a.number - b.number);

    const inboundRelationshipCount = this.data.relationshipSchemas.filter(
      (r) => r.destination_layer === layerId && r.source_layer !== layerId
    ).length;

    const outboundRelationshipCount = this.data.relationshipSchemas.filter(
      (r) => r.source_layer === layerId && r.destination_layer !== layerId
    ).length;

    return {
      layer,
      nodeSchemas,
      intraRelationships,
      interRelationships,
      upstreamLayers,
      downstreamLayers,
      statistics: {
        nodeCount: nodeSchemas.length,
        intraRelationshipCount: intraRelationships.length,
        interRelationshipCount: interRelationships.length,
        inboundRelationshipCount,
        outboundRelationshipCount,
      },
    };
  }

  getAllLayers(): Layer[] {
    return this.data.layers;
  }

  getAllNodeSchemas(): NodeSchema[] {
    return this.data.nodeSchemas;
  }

  getAllRelationships(): RelationshipSchema[] {
    return this.data.relationshipSchemas;
  }

  getPredicates(): Map<string, Predicate> {
    return this.data.predicates;
  }
}

// ============================================================================
// Markdown Generator Utilities
// ============================================================================

function formatLayerName(layerId: string): string {
  return layerId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatNodeTypeName(type: string): string {
  return type
    .split(/(?=[A-Z])/)
    .join(" ")
    .replace(/^./, (c) => c.toUpperCase());
}

function createAnchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ============================================================================
// Layer Report Generator
// ============================================================================

class LayerReportGenerator {
  constructor(private data: ReportDataModel) {}

  generate(reportData: LayerReportData): string {
    const lines: string[] = [];

    lines.push(`# ${reportData.layer.name}\n`);
    lines.push(this.generateTableOfContents(reportData));
    lines.push("\n");
    lines.push(this.generateLayerIntroduction(reportData));
    lines.push("\n");
    lines.push(this.generateIntraLayerDiagram(reportData));
    lines.push("\n");
    lines.push(this.generateInterLayerDiagram(reportData));
    lines.push("\n");
    lines.push(this.generateInterLayerTable(reportData));
    lines.push("\n");
    lines.push(this.generateNodeReference(reportData));
    lines.push("\n");
    lines.push(this.generateFooter(reportData));

    return lines.join("");
  }

  private generateTableOfContents(reportData: LayerReportData): string {
    const lines: string[] = [];
    lines.push("## Report Index\n");
    lines.push("- [Layer Introduction](#layer-introduction)\n");
    lines.push("- [Intra-Layer Relationships Diagram](#intra-layer-relationships)\n");
    lines.push("- [Inter-Layer Dependencies Diagram](#inter-layer-dependencies)\n");
    lines.push("- [Inter-Layer Relationships Table](#inter-layer-relationships-table)\n");

    if (reportData.nodeSchemas.length > 0) {
      lines.push("- [Node Reference](#node-reference)\n");
      for (const schema of reportData.nodeSchemas) {
        const anchor = createAnchor(schema.type);
        lines.push(`  - [${formatNodeTypeName(schema.type)}](#${anchor})\n`);
      }
    }

    return lines.join("");
  }

  private generateLayerIntroduction(reportData: LayerReportData): string {
    const lines: string[] = [];
    lines.push("## Layer Introduction\n");
    lines.push(`**Layer ${reportData.layer.number}**: ${formatLayerName(reportData.layer.id)}\n`);

    if (reportData.layer.inspired_by) {
      lines.push(
        `**Standard**: [${reportData.layer.inspired_by.standard}](${reportData.layer.inspired_by.url || "#"})\n`
      );
    }

    lines.push(`\n${reportData.layer.description}\n`);

    lines.push("\n### Statistics\n");
    lines.push("| Metric | Count |\n");
    lines.push("|--------|-------|\n");
    lines.push(`| Node Types | ${reportData.statistics.nodeCount} |\n`);
    lines.push(`| Intra-Layer Relationships | ${reportData.statistics.intraRelationshipCount} |\n`);
    lines.push(`| Inter-Layer Relationships | ${reportData.statistics.interRelationshipCount} |\n`);
    lines.push(`| Inbound Relationships | ${reportData.statistics.inboundRelationshipCount} |\n`);
    lines.push(`| Outbound Relationships | ${reportData.statistics.outboundRelationshipCount} |\n`);

    lines.push("\n### Layer Dependencies\n");

    if (reportData.upstreamLayers.length > 0) {
      const deps = reportData.upstreamLayers
        .map((l) => `[${formatLayerName(l.id)}](./${String(l.number).padStart(2, "0")}-${l.id}-layer-report.md)`)
        .join(", ");
      lines.push(`**Depends On**: ${deps}\n`);
    } else {
      lines.push("**Depends On**: None\n");
    }

    if (reportData.downstreamLayers.length > 0) {
      const deps = reportData.downstreamLayers
        .map((l) => `[${formatLayerName(l.id)}](./${String(l.number).padStart(2, "0")}-${l.id}-layer-report.md)`)
        .join(", ");
      lines.push(`**Depended On By**: ${deps}\n`);
    } else {
      lines.push("**Depended On By**: None\n");
    }

    return lines.join("");
  }

  private generateIntraLayerDiagram(reportData: LayerReportData): string {
    const lines: string[] = [];
    lines.push("## Intra-Layer Relationships\n");

    if (reportData.nodeSchemas.length === 0) {
      lines.push("No node types defined for this layer.\n");
      return lines.join("");
    }

    if (reportData.statistics.intraRelationshipCount === 0) {
      lines.push("No intra-layer relationships defined.\n");
      return lines.join("");
    }

    lines.push("```mermaid\n");
    lines.push(`flowchart LR\n`);
    lines.push(`  subgraph ${reportData.layer.id}\n`);

    // Add all nodes
    for (const schema of reportData.nodeSchemas) {
      const nodeId = schema.type.replace(/[^a-zA-Z0-9]/g, "_");
      lines.push(`    ${nodeId}["${schema.type}"]\n`);
    }

    // Add relationships
    for (const rel of reportData.intraRelationships) {
      const sourceId = rel.source_spec_node_id.split(".")[1]?.replace(/[^a-zA-Z0-9]/g, "_") || "unknown";
      const destId = rel.destination_spec_node_id.split(".")[1]?.replace(/[^a-zA-Z0-9]/g, "_") || "unknown";
      lines.push(`    ${sourceId} -->|${rel.predicate}| ${destId}\n`);
    }

    lines.push("  end\n");
    lines.push("```\n");

    return lines.join("");
  }

  private generateInterLayerDiagram(reportData: LayerReportData): string {
    const lines: string[] = [];
    lines.push("## Inter-Layer Dependencies\n");

    lines.push("```mermaid\n");
    lines.push("flowchart TB\n");
    lines.push('  classDef current fill:#f9f,stroke:#333,stroke-width:2px\n');

    const allLayers = this.data.getAllLayers();
    for (const layer of allLayers) {
      const layerId = layer.id.replace(/[^a-zA-Z0-9]/g, "_");
      lines.push(`  ${layerId}["${formatLayerName(layer.id)}"]\n`);
    }

    // Add layer-to-layer relationships (only across layers, no duplicates)
    const addedRelationships = new Set<string>();
    for (const rel of this.data.getAllRelationships()) {
      if (rel.source_layer !== rel.destination_layer) {
        const key = `${rel.source_layer}-${rel.destination_layer}`;
        if (!addedRelationships.has(key)) {
          const sourceId = rel.source_layer.replace(/[^a-zA-Z0-9]/g, "_");
          const destId = rel.destination_layer.replace(/[^a-zA-Z0-9]/g, "_");
          lines.push(`  ${sourceId} --> ${destId}\n`);
          addedRelationships.add(key);
        }
      }
    }

    const currentLayerId = reportData.layer.id.replace(/[^a-zA-Z0-9]/g, "_");
    lines.push(`  class ${currentLayerId} current\n`);

    lines.push("```\n");

    return lines.join("");
  }

  private generateInterLayerTable(reportData: LayerReportData): string {
    const lines: string[] = [];
    lines.push("## Inter-Layer Relationships Table\n");

    const interLayerRels = reportData.interRelationships
      .filter((r) => r.source_layer === reportData.layer.id || r.destination_layer === reportData.layer.id)
      .sort((a, b) => {
        const layerCompare = a.destination_layer.localeCompare(b.destination_layer);
        if (layerCompare !== 0) return layerCompare;
        return a.predicate.localeCompare(b.predicate);
      });

    if (interLayerRels.length === 0) {
      lines.push("No inter-layer relationships defined.\n");
      return lines.join("");
    }

    lines.push("| Relationship ID | Source Node | Dest Node | Dest Layer | Predicate | Cardinality | Strength |\n");
    lines.push("|-----------------|-------------|-----------|------------|-----------|-------------|----------|\n");

    for (const rel of interLayerRels) {
      const sourceType = rel.source_spec_node_id.split(".")[1] || "unknown";
      const destType = rel.destination_spec_node_id.split(".")[1] || "unknown";
      const destLayer = rel.destination_layer;
      const destLayerNum = this.data
        .getAllLayers()
        .find((l) => l.id === destLayer);
      const destLayerLink = destLayerNum
        ? `[${formatLayerName(destLayer)}](./${String(destLayerNum.number).padStart(2, "0")}-${destLayer}-layer-report.md)`
        : destLayer;

      const sourceAnchor = createAnchor(sourceType);
      const destAnchor = createAnchor(destType);

      lines.push(
        `| ${rel.id} | [${sourceType}](#${sourceAnchor}) | [${destType}](${destLayerLink}#${destAnchor}) | ${destLayerLink} | ${rel.predicate} | ${rel.cardinality} | ${rel.strength} |\n`
      );
    }

    return lines.join("");
  }

  private generateNodeReference(reportData: LayerReportData): string {
    const lines: string[] = [];

    if (reportData.nodeSchemas.length === 0) {
      return "";
    }

    lines.push("## Node Reference\n");

    for (const schema of reportData.nodeSchemas) {
      const anchor = createAnchor(schema.type);
      lines.push(`### ${formatNodeTypeName(schema.type)}\n`);
      lines.push(`**Spec Node ID**: \`${schema.spec_node_id}\`\n\n`);
      lines.push(`${schema.description}\n\n`);

      // Intra-layer relationships
      const intraRels = reportData.intraRelationships.filter(
        (r) =>
          r.source_spec_node_id === schema.spec_node_id ||
          r.destination_spec_node_id === schema.spec_node_id
      );

      if (intraRels.length > 0) {
        lines.push("#### Intra-Layer Relationships\n");
        lines.push("| Related Node | Predicate | Direction | Cardinality |\n");
        lines.push("|--------------|-----------|-----------|-------------|\n");

        for (const rel of intraRels) {
          const direction =
            rel.source_spec_node_id === schema.spec_node_id ? "outbound" : "inbound";
          const relatedType =
            direction === "outbound"
              ? rel.destination_spec_node_id.split(".")[1]
              : rel.source_spec_node_id.split(".")[1];
          const relatedAnchor = createAnchor(relatedType || "unknown");
          lines.push(
            `| [${relatedType}](#${relatedAnchor}) | ${rel.predicate} | ${direction} | ${rel.cardinality} |\n`
          );
        }

        lines.push("\n");
      }

      // Inter-layer relationships
      const interRels = reportData.interRelationships.filter(
        (r) =>
          r.source_spec_node_id === schema.spec_node_id ||
          r.destination_spec_node_id === schema.spec_node_id
      );

      if (interRels.length > 0) {
        lines.push("#### Inter-Layer Relationships\n");
        lines.push("| Related Node | Layer | Predicate | Direction | Cardinality |\n");
        lines.push("|--------------|-------|-----------|-----------|-------------|\n");

        for (const rel of interRels) {
          const direction =
            rel.source_spec_node_id === schema.spec_node_id ? "outbound" : "inbound";
          const relatedType =
            direction === "outbound"
              ? rel.destination_spec_node_id.split(".")[1]
              : rel.source_spec_node_id.split(".")[1];
          const relatedLayer =
            direction === "outbound" ? rel.destination_layer : rel.source_layer;
          const layerNum = this.data.getAllLayers().find((l) => l.id === relatedLayer);
          const layerLink = layerNum
            ? `[${formatLayerName(relatedLayer)}](./${String(layerNum.number).padStart(2, "0")}-${relatedLayer}-layer-report.md)`
            : relatedLayer;
          const relatedAnchor = createAnchor(relatedType || "unknown");

          lines.push(
            `| [${relatedType}](${layerLink}#${relatedAnchor}) | ${layerLink} | ${rel.predicate} | ${direction} | ${rel.cardinality} |\n`
          );
        }

        lines.push("\n");
      }

      lines.push(`[Back to Index](#report-index)\n\n`);
    }

    return lines.join("");
  }

  private generateFooter(reportData: LayerReportData): string {
    const timestamp = new Date().toISOString();
    return `---\n*Generated: ${timestamp} | Generator: generate-layer-reports.ts*\n`;
  }
}

// ============================================================================
// README Generator
// ============================================================================

class ReadmeGenerator {
  constructor(private data: ReportDataModel) {}

  generate(): string {
    const lines: string[] = [];

    lines.push("# Documentation Robotics - 12-Layer Architecture\n");
    lines.push("## Overview\n");
    lines.push(
      "The Documentation Robotics specification defines a federated 12-layer architecture model spanning from business motivation through testing strategies. Each layer represents a distinct concern and provides specific abstractions and relationships.\n"
    );

    lines.push("\n## Layer Reports\n");
    for (const layer of this.data.getAllLayers()) {
      const filename = `${String(layer.number).padStart(2, "0")}-${layer.id}-layer-report.md`;
      lines.push(`- **[${formatLayerName(layer.id)}](./${filename})** (Layer ${layer.number})\n`);
      lines.push(`  ${layer.description}\n`);
    }

    lines.push("\n## Layer Dependency Matrix\n");
    lines.push(this.generateDependencyMatrix());

    lines.push("\n## Predicate Glossary\n");
    lines.push(this.generatePredicateGlossary());

    lines.push("\n---\n");
    const timestamp = new Date().toISOString();
    lines.push(
      `*Generated: ${timestamp} | Generator: generate-layer-reports.ts*\n`
    );

    return lines.join("");
  }

  private generateDependencyMatrix(): string {
    const layers = this.data.getAllLayers();
    const rels = this.data.getAllRelationships();

    const lines: string[] = [];
    lines.push("| From \\ To |");
    for (const layer of layers) {
      lines.push(` ${layer.number} |`);
    }
    lines.push("\n|");
    for (let i = 0; i <= layers.length; i++) {
      lines.push("---|");
    }
    lines.push("\n");

    for (const sourceLayer of layers) {
      lines.push(`| **${sourceLayer.number}** |`);
      for (const destLayer of layers) {
        const hasRel = rels.some(
          (r) => r.source_layer === sourceLayer.id && r.destination_layer === destLayer.id
        );
        lines.push(` ${hasRel ? "✓" : ""} |`);
      }
      lines.push("\n");
    }

    return lines.join("");
  }

  private generatePredicateGlossary(): string {
    const predicates = this.data.getPredicates();
    const byCategory = new Map<string, Predicate[]>();

    for (const [, pred] of predicates) {
      if (!byCategory.has(pred.category)) {
        byCategory.set(pred.category, []);
      }
      byCategory.get(pred.category)!.push(pred);
    }

    const lines: string[] = [];

    for (const category of Array.from(byCategory.keys()).sort()) {
      lines.push(`### ${formatLayerName(category)}\n`);

      const preds = byCategory.get(category) || [];
      for (const pred of preds.sort((a, b) => a.predicate.localeCompare(b.predicate))) {
        lines.push(`- **${pred.predicate}** (inverse: ${pred.inverse})\n`);
        lines.push(`  ${pred.description}\n`);
      }

      lines.push("\n");
    }

    return lines.join("");
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log("Generating layer reports...");

  const specDir = path.join(process.cwd(), "spec");
  const outputDir = path.join(specDir, "browser");

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Load spec data
  const loader = new SpecDataLoader(specDir);
  const specData = await loader.loadAll();
  console.log(`Loaded ${specData.layers.length} layers`);
  console.log(`Loaded ${specData.nodeSchemas.length} node schemas`);
  console.log(`Loaded ${specData.relationshipSchemas.length} relationship schemas`);
  console.log(`Loaded ${specData.predicates.size} predicates`);

  // Create report data model
  const model = new ReportDataModel(specData);

  // Generate README
  console.log("Generating README.md...");
  const readmeGen = new ReadmeGenerator(model);
  const readmeContent = readmeGen.generate();
  await fs.writeFile(path.join(outputDir, "README.md"), readmeContent, "utf-8");

  // Generate layer reports
  const reportGen = new LayerReportGenerator(model);
  for (const layer of specData.layers) {
    console.log(`Generating ${formatLayerName(layer.id)} layer report...`);
    const reportData = model.getLayerReportData(layer.id);
    const reportContent = reportGen.generate(reportData);
    const filename = `${String(layer.number).padStart(2, "0")}-${layer.id}-layer-report.md`;
    await fs.writeFile(path.join(outputDir, filename), reportContent, "utf-8");
  }

  console.log(`✓ Generated ${specData.layers.length} layer reports in ${outputDir}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
