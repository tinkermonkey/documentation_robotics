/**
 * Model Layer Report Generator
 *
 * Generates markdown documentation for a single architecture layer with:
 * - Mermaid intra-layer and inter-layer diagrams
 * - Relationship tables
 * - Element reference documentation
 * - Navigation and metadata
 *
 * Mirrors LayerReportGenerator from spec script but renders element instances
 * instead of type schemas.
 */

import type { ModelLayerReportData } from './model-report-data.js';
import type { Relationship } from '../core/relationships.js';
import { formatLayerName } from '../utils/layer-name-formatter.js';
import { formatMarkdownTable } from '../utils/markdown-table.js';
import { sanitizeMermaidId } from '../utils/mermaid-utils.js';
import { createAnchor } from '../utils/markdown-anchor.js';
import { escapeMarkdown, getLayerDescription, valueToMarkdown } from '../export/markdown-utils.js';
import { getLayerOrder, CANONICAL_LAYER_NAMES } from '../core/layers.js';
import { getValidRelationships } from '../generated/relationship-index.js';

export class ModelLayerReportGenerator {
  constructor(private modelVersion: string, private generatedAt: string) {}

  /**
   * Generate complete layer report markdown
   */
  generate(data: ModelLayerReportData): string {
    const lines: string[] = [];

    // Document header
    lines.push(this.generateHeader(data));

    // Report Index (table of contents)
    lines.push(this.generateTableOfContents(data));

    // Layer Introduction + Statistics
    lines.push(this.generateLayerIntroduction(data));

    // Intra-Layer Relationships diagram
    lines.push(this.generateIntraLayerDiagram(data));

    // Inter-Layer Dependencies diagram
    lines.push(this.generateInterLayerDiagram(data));

    // Inter-Layer Relationships Table
    lines.push(this.generateInterLayerTable(data));

    // Element Reference section
    lines.push(this.generateElementReference(data));

    // Footer
    lines.push(this.generateFooter());

    return lines.join('');
  }

  private generateHeader(data: ModelLayerReportData): string {
    const lines: string[] = [];
    lines.push(`# ${formatLayerName(data.layerName)}\n`);
    lines.push('\n');
    lines.push(`${getLayerDescription(data.layerName)}\n`);
    lines.push('\n');
    return lines.join('');
  }

  private generateTableOfContents(data: ModelLayerReportData): string {
    const lines: string[] = [];
    lines.push('## Report Index\n');
    lines.push('\n');

    lines.push('- [Layer Introduction](#layer-introduction)\n');
    lines.push('- [Intra-Layer Relationships](#intra-layer-relationships)\n');
    lines.push('- [Inter-Layer Dependencies](#inter-layer-dependencies)\n');

    if (data.interRelationships.length > 0) {
      lines.push('- [Inter-Layer Relationships Table](#inter-layer-relationships-table)\n');
    }

    if (data.elements.length > 0) {
      lines.push('- [Element Reference](#element-reference)\n');
    }

    lines.push('\n');
    return lines.join('');
  }

  private generateLayerIntroduction(data: ModelLayerReportData): string {
    const lines: string[] = [];
    lines.push('## Layer Introduction\n');
    lines.push('\n');

    // Statistics table
    const headers = ['Metric', 'Count'];
    const rows = [
      ['Elements', String(data.statistics.elementCount)],
      ['Intra-Layer Relationships', String(data.statistics.intraRelationshipCount)],
      ['Inter-Layer Relationships', String(data.statistics.interRelationshipCount)],
      ['Inbound Relationships', String(data.statistics.inboundRelationshipCount)],
      ['Outbound Relationships', String(data.statistics.outboundRelationshipCount)],
    ];

    const table = formatMarkdownTable(headers, rows);
    lines.push(table);
    lines.push('\n');

    // Upstream and downstream layers
    if (data.upstreamLayers.length > 0 || data.downstreamLayers.length > 0) {
      lines.push('**Cross-Layer References**:\n');
      lines.push('\n');

      if (data.upstreamLayers.length > 0) {
        const upstreamLinks = data.upstreamLayers
          .map((layerName) => this.createLayerLink(layerName))
          .join(', ');
        lines.push(`- **Upstream layers**: ${upstreamLinks}\n`);
      }

      if (data.downstreamLayers.length > 0) {
        const downstreamLinks = data.downstreamLayers
          .map((layerName) => this.createLayerLink(layerName))
          .join(', ');
        lines.push(`- **Downstream layers**: ${downstreamLinks}\n`);
      }

      lines.push('\n');
    }

    return lines.join('');
  }

  private generateIntraLayerDiagram(data: ModelLayerReportData): string {
    const lines: string[] = [];
    lines.push('## Intra-Layer Relationships\n');
    lines.push('\n');

    // Empty layer handling
    if (data.elements.length === 0) {
      lines.push('No elements in this layer.\n');
      lines.push('\n');
      return lines.join('');
    }

    // Generate mermaid diagram for all layers (including large ones)
    lines.push('```mermaid\n');
    lines.push('flowchart LR\n');
    lines.push(`  subgraph ${sanitizeMermaidId(data.layerName)}\n`);

    // Add all elements as nodes
    for (const element of data.elements) {
      const nodeId = sanitizeMermaidId(element.path);
      const label = escapeMarkdown(element.name);
      lines.push(`    ${nodeId}["${label}"]\n`);
    }

    // Add intra-layer relationships (sorted for deterministic output)
    const sortedRelationships = [...data.intraRelationships].sort((a, b) => {
      const aKey = `${a.source}-${a.predicate}-${a.target}`;
      const bKey = `${b.source}-${b.predicate}-${b.target}`;
      return aKey.localeCompare(bKey);
    });

    for (const rel of sortedRelationships) {
      const sourceId = sanitizeMermaidId(rel.source);
      const targetId = sanitizeMermaidId(rel.target);
      const predicate = escapeMarkdown(rel.predicate);
      lines.push(`    ${sourceId} -->|${predicate}| ${targetId}\n`);
    }

    lines.push('  end\n');
    lines.push('```\n');
    lines.push('\n');

    return lines.join('');
  }

  private generateInterLayerDiagram(data: ModelLayerReportData): string {
    const lines: string[] = [];
    lines.push('## Inter-Layer Dependencies\n');
    lines.push('\n');

    // Empty layer handling
    if (data.elements.length === 0) {
      lines.push('No elements in this layer.\n');
      lines.push('\n');
      return lines.join('');
    }

    lines.push('```mermaid\n');
    lines.push('flowchart TB\n');
    lines.push('  classDef current fill:#f9f,stroke:#333,stroke-width:2px\n');

    // Add all layers as nodes
    for (const layerName of CANONICAL_LAYER_NAMES) {
      const layerId = sanitizeMermaidId(layerName);
      const label = formatLayerName(layerName);
      lines.push(`  ${layerId}["${label}"]\n`);
    }

    // Add layer-to-layer relationships for inter-layer dependencies
    const addedRelationships = new Set<string>();
    const layerRelationships: Array<{ sourceId: string; destId: string }> = [];

    for (const rel of data.interRelationships) {
      // Only include inter-layer relationships
      if (rel.layer !== rel.targetLayer && rel.targetLayer) {
        const key = `${rel.layer}-${rel.targetLayer}`;
        if (!addedRelationships.has(key)) {
          const sourceId = sanitizeMermaidId(rel.layer);
          const destId = sanitizeMermaidId(rel.targetLayer);
          layerRelationships.push({ sourceId, destId });
          addedRelationships.add(key);
        }
      }
    }

    // Sort and output relationships for deterministic ordering
    const sortedLayerRels = layerRelationships.sort((a, b) => {
      const aKey = `${a.sourceId}-${a.destId}`;
      const bKey = `${b.sourceId}-${b.destId}`;
      return aKey.localeCompare(bKey);
    });

    for (const { sourceId, destId } of sortedLayerRels) {
      lines.push(`  ${sourceId} --> ${destId}\n`);
    }

    // Highlight current layer
    const currentLayerId = sanitizeMermaidId(data.layerName);
    lines.push(`  class ${currentLayerId} current\n`);

    lines.push('```\n');
    lines.push('\n');

    return lines.join('');
  }

  private generateInterLayerTable(data: ModelLayerReportData): string {
    const lines: string[] = [];

    if (data.interRelationships.length === 0) {
      return '';
    }

    lines.push('## Inter-Layer Relationships Table\n');
    lines.push('\n');

    // Sort relationships for deterministic output
    const sortedRels = [...data.interRelationships].sort((a, b) => {
      const aKey = `${a.source}-${a.predicate}-${a.target}`;
      const bKey = `${b.source}-${b.predicate}-${b.target}`;
      return aKey.localeCompare(bKey);
    });

    const headers = ['Relationship ID', 'Source Node', 'Dest Node', 'Dest Layer', 'Predicate', 'Cardinality', 'Strength'];
    const rows: string[][] = [];

    for (const rel of sortedRels) {
      // Extract element types from paths (e.g., "motivation.goal.customer-satisfaction" -> "motivation.goal")
      const sourceType = this.extractElementType(rel.source);
      const targetType = this.extractElementType(rel.target);

      // Look up spec-level relationship properties
      const specs = getValidRelationships(sourceType, rel.predicate, targetType);
      const cardinality = specs.length > 0 ? specs[0].cardinality : 'unknown';
      const strength = specs.length > 0 ? specs[0].strength : 'unknown';

      // Use spec relationship ID when available, fall back to concatenated form
      const relationshipId = specs.length > 0 ? specs[0].id : `${rel.source}-${rel.predicate}-${rel.target}`;

      rows.push([
        `\`${escapeMarkdown(relationshipId)}\``,
        `\`${escapeMarkdown(rel.source)}\``,
        `\`${escapeMarkdown(rel.target)}\``,
        rel.targetLayer ? `\`${escapeMarkdown(rel.targetLayer)}\`` : '—',
        `\`${escapeMarkdown(rel.predicate)}\``,
        cardinality,
        strength,
      ]);
    }

    const table = formatMarkdownTable(headers, rows);
    lines.push(table);
    lines.push('\n');

    return lines.join('');
  }

  private generateElementReference(data: ModelLayerReportData): string {
    const lines: string[] = [];

    if (data.elements.length === 0) {
      return '';
    }

    lines.push('## Element Reference\n');
    lines.push('\n');

    for (const element of data.elements) {
      const anchor = createAnchor(element.name);
      lines.push(`### ${escapeMarkdown(element.name)} {#${anchor}}\n`);
      lines.push('\n');

      // ID and type
      lines.push(`**ID**: \`${escapeMarkdown(element.path)}\`\n\n`);
      lines.push(`**Type**: \`${escapeMarkdown(element.type)}\`\n\n`);

      // Description if available
      if (element.description) {
        lines.push(`${escapeMarkdown(element.description)}\n\n`);
      }

      // Attributes if available
      if (Object.keys(element.attributes).length > 0) {
        lines.push('#### Attributes\n\n');
        const attrHeaders = ['Name', 'Value'];
        const attrRows: string[][] = [];

        // Sort attributes for deterministic output
        const sortedAttrs = Object.entries(element.attributes).sort((a, b) =>
          a[0].localeCompare(b[0])
        );

        for (const [name, value] of sortedAttrs) {
          const valueStr = valueToMarkdown(value);
          attrRows.push([name, valueStr]);
        }

        const attrTable = formatMarkdownTable(attrHeaders, attrRows);
        lines.push(attrTable);
        lines.push('\n');
      }

      // Relationships involving this element
      const elementRels = this.getElementRelationships(data, element.path);
      if (elementRels.length > 0) {
        lines.push('#### Relationships\n\n');
        const relHeaders = ['Type', 'Related Element', 'Predicate', 'Direction'];
        const relRows: string[][] = [];

        // Sort for deterministic output
        const sortedElementRels = [...elementRels].sort((a, b) => {
          const aKey = `${a.relType}-${a.rel.source}-${a.rel.predicate}-${a.rel.target}`;
          const bKey = `${b.relType}-${b.rel.source}-${b.rel.predicate}-${b.rel.target}`;
          return aKey.localeCompare(bKey);
        });

        for (const { rel, relType } of sortedElementRels) {
          const relatedElement = rel.source === element.path ? rel.target : rel.source;
          const direction = rel.source === element.path ? 'outbound' : 'inbound';

          relRows.push([
            relType,
            `\`${escapeMarkdown(relatedElement)}\``,
            `\`${escapeMarkdown(rel.predicate)}\``,
            direction,
          ]);
        }

        const relTable = formatMarkdownTable(relHeaders, relRows);
        lines.push(relTable);
        lines.push('\n');
      }
    }

    return lines.join('');
  }

  private generateFooter(): string {
    const lines: string[] = [];
    lines.push('---\n');
    lines.push('\n');
    lines.push(`Generated: ${this.generatedAt} | Model Version: ${this.modelVersion}\n`);
    return lines.join('');
  }

  /**
   * Create a markdown link to a layer report
   */
  private createLayerLink(layerName: string): string {
    const layerNumber = getLayerOrder(layerName);
    if (layerNumber === -1) {
      return layerName;
    }
    const filename = `./${String(layerNumber).padStart(2, '0')}-${layerName}-layer-report.md`;
    return `[${formatLayerName(layerName)}](${filename})`;
  }

  /**
   * Get relationships involving a specific element
   */
  private getElementRelationships(
    data: ModelLayerReportData,
    elementPath: string
  ): Array<{ rel: Relationship; relType: 'intra-layer' | 'inter-layer' }> {
    const rels: Array<{ rel: Relationship; relType: 'intra-layer' | 'inter-layer' }> = [];

    // Intra-layer relationships
    for (const rel of data.intraRelationships) {
      if (rel.source === elementPath || rel.target === elementPath) {
        rels.push({ rel, relType: 'intra-layer' });
      }
    }

    // Inter-layer relationships
    for (const rel of data.interRelationships) {
      if (rel.source === elementPath || rel.target === elementPath) {
        rels.push({ rel, relType: 'inter-layer' });
      }
    }

    return rels;
  }

  /**
   * Extract element type from element path in layer.type format
   * Example: "motivation.goal.customer-satisfaction" -> "motivation.goal"
   * This format matches the keys in RELATIONSHIPS_BY_SOURCE map.
   */
  private extractElementType(elementPath: string): string {
    const parts = elementPath.split('.');
    if (parts.length >= 2) {
      return parts.slice(0, 2).join('.');
    }
    return elementPath;
  }
}
