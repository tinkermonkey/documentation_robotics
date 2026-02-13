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
import { execSync } from "child_process";
import { formatLayerName as formatLayerNameUtil } from "../cli/src/utils/layer-name-formatter.js";
import { SpecDataLoader } from "../cli/src/core/spec-loader.js";
import type { LayerSpec, NodeTypeSpec, RelationshipTypeSpec, PredicateSpec } from "../cli/src/core/spec-loader-types.js";

// ============================================================================
// Type Definitions (aligned with spec loader types)
// ============================================================================

interface Layer extends LayerSpec {}

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

interface Predicate extends PredicateSpec {}

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
// Utility Functions
// ============================================================================

/**
 * Extract type segment from spec_node_id (format: layer.type.name)
 * @param specNodeId The spec node ID to parse
 * @param context Optional context for error messages
 * @returns The type segment
 * @throws Error if format is invalid
 */
function extractTypeFromSpecNodeId(specNodeId: string, context: string = ""): string {
  const parts = specNodeId.split(".");
  if (parts.length < 2) {
    throw new Error(
      `Invalid spec_node_id format: "${specNodeId}". Expected format: "layer.type.name"${
        context ? ` in ${context}` : ""
      }`
    );
  }
  return parts[1];
}

// ============================================================================
// Data Loader (uses centralized SpecDataLoader)
// ============================================================================

class ReportSpecDataLoader {
  private coreLoader: SpecDataLoader;

  constructor(specDir: string) {
    // Pass specDir to the core loader via options
    this.coreLoader = new SpecDataLoader({ specDir });
  }

  async loadAll(): Promise<SpecData> {
    // Load data using the core loader
    const data = await this.coreLoader.load();

    // Transform core loader types to report types
    const nodeSchemas: NodeSchema[] = data.nodeTypes.map((nt) => ({
      spec_node_id: nt.spec_node_id,
      layer_id: nt.layer_id,
      type: nt.type,
      title: nt.title,
      description: nt.description,
    }));

    const relationshipSchemas: RelationshipSchema[] = data.relationshipTypes.map((rt) => ({
      id: rt.id,
      source_spec_node_id: rt.source_spec_node_id,
      source_layer: rt.source_layer,
      destination_spec_node_id: rt.destination_spec_node_id,
      destination_layer: rt.destination_layer,
      predicate: rt.predicate,
      cardinality: rt.cardinality,
      strength: rt.strength,
    }));

    return {
      layers: data.layers as Layer[],
      nodeSchemas,
      relationshipSchemas,
      predicates: data.predicates as Map<string, Predicate>,
    };
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
      const schemas = this.data.nodeSchemas
        .filter((s) => s.layer_id === layer.id)
        .sort((a, b) => a.type.localeCompare(b.type));
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
    // Sort each array for deterministic ordering
    for (const [layer, rels] of map.entries()) {
      map.set(layer, rels.sort((a, b) => {
        const aKey = `${a.source_spec_node_id}-${a.predicate}-${a.destination_spec_node_id}`;
        const bKey = `${b.source_spec_node_id}-${b.predicate}-${b.destination_spec_node_id}`;
        return aKey.localeCompare(bKey);
      }));
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
    // Sort each array for deterministic ordering
    for (const [layer, rels] of map.entries()) {
      map.set(layer, rels.sort((a, b) => {
        const aKey = `${a.source_spec_node_id}-${a.predicate}-${a.destination_spec_node_id}`;
        const bKey = `${b.source_spec_node_id}-${b.predicate}-${b.destination_spec_node_id}`;
        return aKey.localeCompare(bKey);
      }));
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
    // Return sorted copy for deterministic iteration
    return [...this.data.relationshipSchemas].sort((a, b) => {
      const aKey = `${a.source_spec_node_id}-${a.predicate}-${a.destination_spec_node_id}`;
      const bKey = `${b.source_spec_node_id}-${b.predicate}-${b.destination_spec_node_id}`;
      return aKey.localeCompare(bKey);
    });
  }

  getPredicates(): Map<string, Predicate> {
    return this.data.predicates;
  }
}

// ============================================================================
// Markdown Generator Utilities
// ============================================================================

/**
 * Use the centralized formatLayerName from layer-name-formatter.ts
 * This ensures consistent acronym handling (API, UX, APM) across all scripts
 */
function formatLayerName(layerId: string): string {
  return formatLayerNameUtil(layerId);
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

/**
 * Format a markdown table with proper column alignment
 * @param headers Array of header strings
 * @param rows Array of row arrays (each row is an array of cell strings)
 * @returns Formatted markdown table string
 */
function formatMarkdownTable(headers: string[], rows: string[][]): string {
  // Calculate column widths based on content
  const colWidths = headers.map((h, i) => {
    let width = h.length;
    for (const row of rows) {
      width = Math.max(width, (row[i] || "").length);
    }
    return width;
  });

  // Build header row
  const headerRow = headers
    .map((h, i) => h.padEnd(colWidths[i]))
    .join(" | ");

  // Build separator row
  const sepRow = colWidths.map((w) => "-".repeat(w)).join(" | ");

  // Build data rows
  const dataRows = rows.map((row) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join(" | ")
  );

  return `| ${headerRow} |\n| ${sepRow} |\n${dataRows.map((r) => `| ${r} |`).join("\n")}\n`;
}

// ============================================================================
// Layer Report Generator
// ============================================================================

class LayerReportGenerator {
  constructor(private data: ReportDataModel, private specVersion: string, private commitHash: string) {}

  generate(reportData: LayerReportData): string {
    const lines: string[] = [];

    lines.push(`# ${reportData.layer.name}\n`);
    lines.push("\n");
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
    lines.push("\n");
    lines.push("- [Layer Introduction](#layer-introduction)\n");
    lines.push("- [Intra-Layer Relationships](#intra-layer-relationships)\n");
    lines.push("- [Inter-Layer Dependencies](#inter-layer-dependencies)\n");
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
    lines.push("\n");
    lines.push(`**Layer ${reportData.layer.number}**: ${formatLayerName(reportData.layer.id)}\n`);

    if (reportData.layer.inspired_by) {
      lines.push(
        `**Standard**: [${reportData.layer.inspired_by.standard}](${reportData.layer.inspired_by.url || "#"})\n`
      );
    }

    lines.push(`\n${reportData.layer.description}\n`);

    lines.push("\n### Statistics\n");
    lines.push("\n");
    const statsTable = formatMarkdownTable(["Metric", "Count"], [
      ["Node Types", String(reportData.statistics.nodeCount)],
      ["Intra-Layer Relationships", String(reportData.statistics.intraRelationshipCount)],
      ["Inter-Layer Relationships", String(reportData.statistics.interRelationshipCount)],
      ["Inbound Relationships", String(reportData.statistics.inboundRelationshipCount)],
      ["Outbound Relationships", String(reportData.statistics.outboundRelationshipCount)],
    ]);
    lines.push(statsTable);

    lines.push("\n### Layer Dependencies\n");
    lines.push("\n");

    if (reportData.upstreamLayers.length > 0) {
      const deps = reportData.upstreamLayers
        .map((l) => `[${formatLayerName(l.id)}](./${String(l.number).padStart(2, "0")}-${l.id}-layer-report.md)`)
        .join(", ");
      lines.push(`**Depends On**: ${deps}\n`);
    } else {
      lines.push("**Depends On**: None\n");
    }

    lines.push("\n");

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
    lines.push("\n");

    if (reportData.nodeSchemas.length === 0) {
      lines.push("No node types defined for this layer.\n");
      return lines.join("");
    }

    // Check if hierarchical grouping is needed (>30 nodes)
    if (reportData.nodeSchemas.length > 30) {
      lines.push("### Hierarchical Organization\n");
      lines.push("\n");
      lines.push(`This layer contains ${reportData.nodeSchemas.length} node types. To improve readability, they are organized hierarchically:\n`);
      lines.push("\n");

      // Group by first character of type name
      const groupedNodes = new Map<string, typeof reportData.nodeSchemas>();
      for (const schema of reportData.nodeSchemas) {
        const group = schema.type.charAt(0).toUpperCase();
        if (!groupedNodes.has(group)) {
          groupedNodes.set(group, []);
        }
        groupedNodes.get(group)!.push(schema);
      }

      // Display summary table
      lines.push("| Group | Count | Types |\n");
      lines.push("|-------|-------|-------|\n");
      for (const group of Array.from(groupedNodes.keys()).sort()) {
        const types = groupedNodes.get(group) || [];
        const typeList = types.map((t) => `\`${t.type}\``).join(", ");
        lines.push(`| **${group}** | ${types.length} | ${typeList} |\n`);
      }

      lines.push("\n");
      if (reportData.statistics.intraRelationshipCount === 0) {
        lines.push("No intra-layer relationships are defined for this layer.\n");
      } else {
        lines.push("### Relationship Map\n");
        lines.push("\n");
        lines.push("Key relationships between node types:\n");
        lines.push("\n");
        lines.push("| Source Type | Predicate | Destination Type | Count |\n");
        lines.push("|-------------|-----------|------------------|-------|\n");
        const relationshipMap = new Map<string, { count: number; predicate: string }>();
        for (const rel of reportData.intraRelationships) {
          const sourceType = extractTypeFromSpecNodeId(rel.source_spec_node_id, "intraRelationships");
          const destType = extractTypeFromSpecNodeId(rel.destination_spec_node_id, "intraRelationships");
          const key = `${sourceType}|${rel.predicate}|${destType}`;
          const existing = relationshipMap.get(key) || { count: 0, predicate: rel.predicate };
          existing.count += 1;
          relationshipMap.set(key, existing);
        }
        for (const [key, value] of relationshipMap) {
          const [sourceType, predicate, destType] = key.split("|");
          lines.push(`| \`${sourceType}\` | ${predicate} | \`${destType}\` | ${value.count} |\n`);
        }
      }
    } else {
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

      // Add relationships (sorted for deterministic output)
      const sortedRelationships = [...reportData.intraRelationships].sort((a, b) => {
        const aKey = `${a.source_spec_node_id}-${a.predicate}-${a.destination_spec_node_id}`;
        const bKey = `${b.source_spec_node_id}-${b.predicate}-${b.destination_spec_node_id}`;
        return aKey.localeCompare(bKey);
      });

      for (const rel of sortedRelationships) {
        const sourceType = extractTypeFromSpecNodeId(rel.source_spec_node_id, "intraRelationships");
        const destType = extractTypeFromSpecNodeId(rel.destination_spec_node_id, "intraRelationships");
        const sourceId = sourceType.replace(/[^a-zA-Z0-9]/g, "_");
        const destId = destType.replace(/[^a-zA-Z0-9]/g, "_");
        lines.push(`    ${sourceId} -->|${rel.predicate}| ${destId}\n`);
      }

      lines.push("  end\n");
      lines.push("```\n");
    }

    return lines.join("");
  }

  private generateInterLayerDiagram(reportData: LayerReportData): string {
    const lines: string[] = [];
    lines.push("## Inter-Layer Dependencies\n");
    lines.push("\n");

    lines.push("```mermaid\n");
    lines.push("flowchart TB\n");
    lines.push('  classDef current fill:#f9f,stroke:#333,stroke-width:2px\n');

    const allLayers = this.data.getAllLayers();
    for (const layer of allLayers) {
      const layerId = layer.id.replace(/[^a-zA-Z0-9]/g, "_");
      lines.push(`  ${layerId}["${formatLayerName(layer.id)}"]\n`);
    }

    // Add layer-to-layer relationships (only across layers, no duplicates, sorted for determinism)
    const addedRelationships = new Set<string>();
    const layerRelationships: Array<{ sourceId: string; destId: string }> = [];

    for (const rel of this.data.getAllRelationships()) {
      if (rel.source_layer !== rel.destination_layer) {
        const key = `${rel.source_layer}-${rel.destination_layer}`;
        if (!addedRelationships.has(key)) {
          const sourceId = rel.source_layer.replace(/[^a-zA-Z0-9]/g, "_");
          const destId = rel.destination_layer.replace(/[^a-zA-Z0-9]/g, "_");
          layerRelationships.push({ sourceId, destId });
          addedRelationships.add(key);
        }
      }
    }

    // Sort and output relationships for deterministic ordering
    layerRelationships
      .sort((a, b) => {
        const aKey = `${a.sourceId}-${a.destId}`;
        const bKey = `${b.sourceId}-${b.destId}`;
        return aKey.localeCompare(bKey);
      })
      .forEach(({ sourceId, destId }) => {
        lines.push(`  ${sourceId} --> ${destId}\n`);
      });

    const currentLayerId = reportData.layer.id.replace(/[^a-zA-Z0-9]/g, "_");
    lines.push(`  class ${currentLayerId} current\n`);

    lines.push("```\n");

    return lines.join("");
  }

  private generateInterLayerTable(reportData: LayerReportData): string {
    const lines: string[] = [];
    lines.push("## Inter-Layer Relationships Table\n");
    lines.push("\n");

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

    // Sort relationships for deterministic output
    const sortedInterLayerRels = [...interLayerRels].sort((a, b) => {
      const aKey = `${a.source_spec_node_id}-${a.predicate}-${a.destination_spec_node_id}`;
      const bKey = `${b.source_spec_node_id}-${b.predicate}-${b.destination_spec_node_id}`;
      return aKey.localeCompare(bKey);
    });

    const rows: string[][] = [];
    for (const rel of sortedInterLayerRels) {
      const sourceType = extractTypeFromSpecNodeId(rel.source_spec_node_id, "interLayerRels");
      const destType = extractTypeFromSpecNodeId(rel.destination_spec_node_id, "interLayerRels");
      const sourceLayer = rel.source_layer;
      const destLayer = rel.destination_layer;

      const sourceLayerNum = this.data.getAllLayers().find((l) => l.id === sourceLayer);
      const destLayerNum = this.data.getAllLayers().find((l) => l.id === destLayer);

      const sourceLayerFilename = sourceLayerNum
        ? `./${String(sourceLayerNum.number).padStart(2, "0")}-${sourceLayer}-layer-report.md`
        : "";
      const destLayerFilename = destLayerNum
        ? `./${String(destLayerNum.number).padStart(2, "0")}-${destLayer}-layer-report.md`
        : "";
      const destLayerLink = destLayerNum
        ? `[${formatLayerName(destLayer)}](${destLayerFilename})`
        : destLayer;

      const sourceAnchor = createAnchor(sourceType);
      const destAnchor = createAnchor(destType);

      // Create source link (to source node in source layer)
      const sourceLink = sourceLayerNum
        ? `[${sourceType}](${sourceLayerFilename}#${sourceAnchor})`
        : sourceType;
      // Create dest link (to dest node in dest layer)
      const destLink = destLayerNum
        ? `[${destType}](${destLayerFilename}#${destAnchor})`
        : destType;

      rows.push([rel.id, sourceLink, destLink, destLayerLink, rel.predicate, rel.cardinality, rel.strength]);
    }

    const table = formatMarkdownTable(
      ["Relationship ID", "Source Node", "Dest Node", "Dest Layer", "Predicate", "Cardinality", "Strength"],
      rows
    );
    lines.push(table);

    return lines.join("");
  }

  private generateNodeReference(reportData: LayerReportData): string {
    const lines: string[] = [];

    if (reportData.nodeSchemas.length === 0) {
      return "";
    }

    lines.push("## Node Reference\n");
    lines.push("\n");

    for (let i = 0; i < reportData.nodeSchemas.length; i++) {
      const schema = reportData.nodeSchemas[i]!;
      const anchor = createAnchor(schema.type);
      // Use formatted name for readability, with anchor for linking
      const heading = formatNodeTypeName(schema.type);
      lines.push(`### ${heading} {#${anchor}}\n`);
      lines.push("\n");
      lines.push(`**Spec Node ID**: \`${schema.spec_node_id}\`\n\n`);
      lines.push(`${schema.description}\n\n`);

      // Calculate per-node relationship metrics
      const intraRels = reportData.intraRelationships.filter(
        (r) =>
          r.source_spec_node_id === schema.spec_node_id ||
          r.destination_spec_node_id === schema.spec_node_id
      );

      const interRels = reportData.interRelationships.filter(
        (r) =>
          r.source_spec_node_id === schema.spec_node_id ||
          r.destination_spec_node_id === schema.spec_node_id
      );

      const intraInbound = reportData.intraRelationships.filter((r) => r.destination_spec_node_id === schema.spec_node_id).length;
      const intraOutbound = reportData.intraRelationships.filter((r) => r.source_spec_node_id === schema.spec_node_id).length;
      const interInbound = interRels.filter((r) => r.destination_spec_node_id === schema.spec_node_id).length;
      const interOutbound = interRels.filter((r) => r.source_spec_node_id === schema.spec_node_id).length;

      // Display metrics
      lines.push("#### Relationship Metrics\n");
      lines.push("\n");
      lines.push(`- **Intra-Layer**: Inbound: ${intraInbound} | Outbound: ${intraOutbound}\n`);
      lines.push(`- **Inter-Layer**: Inbound: ${interInbound} | Outbound: ${interOutbound}\n`);
      lines.push("\n");

      // Intra-layer relationships

      if (intraRels.length > 0) {
        lines.push("#### Intra-Layer Relationships\n");
        lines.push("\n");

        // Sort relationships for deterministic output
        const sortedIntraRels = [...intraRels].sort((a, b) => {
          const aKey = `${a.source_spec_node_id}-${a.predicate}-${a.destination_spec_node_id}`;
          const bKey = `${b.source_spec_node_id}-${b.predicate}-${b.destination_spec_node_id}`;
          return aKey.localeCompare(bKey);
        });

        const intraRows: string[][] = [];
        for (const rel of sortedIntraRels) {
          const direction =
            rel.source_spec_node_id === schema.spec_node_id ? "outbound" : "inbound";
          const relatedType =
            direction === "outbound"
              ? extractTypeFromSpecNodeId(rel.destination_spec_node_id, "intraRels")
              : extractTypeFromSpecNodeId(rel.source_spec_node_id, "intraRels");
          const relatedAnchor = createAnchor(relatedType);
          intraRows.push([`[${relatedType}](#${relatedAnchor})`, rel.predicate, direction, rel.cardinality]);
        }

        const intraTable = formatMarkdownTable(["Related Node", "Predicate", "Direction", "Cardinality"], intraRows);
        lines.push(intraTable);
        lines.push("\n");
      }

      // Inter-layer relationships
      if (interRels.length > 0) {
        lines.push("#### Inter-Layer Relationships\n");
        lines.push("\n");

        // Sort relationships for deterministic output
        const sortedInterRels = [...interRels].sort((a, b) => {
          const aKey = `${a.source_spec_node_id}-${a.predicate}-${a.destination_spec_node_id}`;
          const bKey = `${b.source_spec_node_id}-${b.predicate}-${b.destination_spec_node_id}`;
          return aKey.localeCompare(bKey);
        });

        const interRows: string[][] = [];
        for (const rel of sortedInterRels) {
          const direction =
            rel.source_spec_node_id === schema.spec_node_id ? "outbound" : "inbound";
          const relatedType =
            direction === "outbound"
              ? extractTypeFromSpecNodeId(rel.destination_spec_node_id, "interRels")
              : extractTypeFromSpecNodeId(rel.source_spec_node_id, "interRels");
          const relatedLayer =
            direction === "outbound" ? rel.destination_layer : rel.source_layer;
          const layerNum = this.data.getAllLayers().find((l) => l.id === relatedLayer);
          const layerFilename = layerNum
            ? `./${String(layerNum.number).padStart(2, "0")}-${relatedLayer}-layer-report.md`
            : "";
          const layerLink = layerNum
            ? `[${formatLayerName(relatedLayer)}](${layerFilename})`
            : relatedLayer;
          const relatedAnchor = createAnchor(relatedType || "unknown");

          interRows.push([`[${relatedType}](${layerFilename}#${relatedAnchor})`, layerLink, rel.predicate, direction, rel.cardinality]);
        }

        const interTable = formatMarkdownTable(["Related Node", "Layer", "Predicate", "Direction", "Cardinality"], interRows);
        lines.push(interTable);
        lines.push("\n");
      }

      lines.push(`[Back to Index](#report-index)\n`);

      // Add blank line between nodes, but not after the last one
      if (i < reportData.nodeSchemas.length - 1) {
        lines.push("\n");
      }
    }

    return lines.join("");
  }

  private generateFooter(reportData: LayerReportData): string {
    const timestamp = new Date().toISOString();
    const specVersion = this.specVersion;
    return `---\n\n_Generated: ${timestamp} | Spec Version: ${specVersion} | Generator: generate-layer-reports.ts_\n`;
  }
}

// ============================================================================
// README Generator
// ============================================================================

class ReadmeGenerator {
  constructor(private data: ReportDataModel, private specVersion: string, private commitHash: string) {}

  generate(): string {
    const lines: string[] = [];

    lines.push("# Documentation Robotics - 12-Layer Architecture\n");
    lines.push("\n");
    lines.push("## Overview\n");
    lines.push("\n");
    lines.push(
      "The Documentation Robotics specification defines a federated 12-layer architecture model spanning from business motivation through testing strategies. Each layer represents a distinct concern and provides specific abstractions and relationships.\n"
    );

    lines.push("\n## Layer Reports\n");
    lines.push("\n");
    for (const layer of this.data.getAllLayers()) {
      const filename = `${String(layer.number).padStart(2, "0")}-${layer.id}-layer-report.md`;
      lines.push(`- **[${formatLayerName(layer.id)}](./${filename})** (Layer ${layer.number})\n`);
      lines.push(`  ${layer.description}\n`);
    }

    lines.push("\n## Layer Dependency Matrix\n");
    lines.push("\n");
    lines.push(this.generateDependencyMatrix());

    lines.push("\n## Predicate Glossary\n");
    lines.push("\n");
    lines.push(this.generatePredicateGlossary());

    lines.push("---\n");
    lines.push("\n");
    const timestamp = new Date().toISOString();
    lines.push(
      `_Generated: ${timestamp} | Spec Version: ${this.specVersion} | Generator: generate-layer-reports.ts_\n`
    );

    return lines.join("");
  }

  private generateDependencyMatrix(): string {
    const layers = this.data.getAllLayers();
    const rels = this.data.getAllRelationships();

    // Build header row
    const header = `| From \\ To | ${layers.map((l) => String(l.number).padStart(2, "0")).join("  | ")}  |`;

    // Build separator row
    const sep = `| --------- | ${layers.map(() => "---").join(" | ")} |`;

    // Build data rows - right-align row numbers, left-align values
    const dataRows = layers.map((sourceLayer) => {
      const rowLabel = `| **${sourceLayer.number}**`.padEnd(11);
      const cells = layers
        .map((destLayer) => {
          const hasRel = rels.some(
            (r) => r.source_layer === sourceLayer.id && r.destination_layer === destLayer.id
          );
          return hasRel ? "✓" : " ";
        })
        .map((v) => v.padEnd(3))
        .join(" | ");
      return `${rowLabel} | ${cells} |`;
    });

    return `${header}\n${sep}\n${dataRows.join("\n")}\n`;
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
      lines.push("\n");

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

  // Load spec version and commit hash
  const specVersionPath = path.join(specDir, "VERSION");
  const specVersion = (await fs.readFile(specVersionPath, "utf-8")).trim();
  let commitHash = "unknown";
  try {
    commitHash = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    console.warn("Could not determine git commit hash");
  }

  // Load spec data
  const loader = new ReportSpecDataLoader(specDir);
  const specData = await loader.loadAll();
  console.log(`Loaded ${specData.layers.length} layers`);
  console.log(`Loaded ${specData.nodeSchemas.length} node schemas`);
  console.log(`Loaded ${specData.relationshipSchemas.length} relationship schemas`);
  console.log(`Loaded ${specData.predicates.size} predicates`);

  // Create report data model
  const model = new ReportDataModel(specData);

  // Generate README
  console.log("Generating README.md...");
  const readmeGen = new ReadmeGenerator(model, specVersion, commitHash);
  const readmeContent = readmeGen.generate();
  await fs.writeFile(path.join(outputDir, "README.md"), readmeContent, "utf-8");

  // Generate layer reports
  const reportGen = new LayerReportGenerator(model, specVersion, commitHash);
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
  const errorMessage = err instanceof Error ? err.message : String(err);
  console.error("Error generating layer reports:", errorMessage);
  if (err instanceof Error && err.stack) {
    console.error("Stack trace:", err.stack);
  }
  process.exit(1);
});
