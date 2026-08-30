/**
 * Model README Generator
 *
 * Generates the main README.md for the model documentation with:
 * - Model statistics (elements, relationships, versions)
 * - Project summary
 * - Introduction to documentation robotics
 * - Per-layer report index table
 */

import type { ModelReadmeData } from './model-report-data.js';
import { formatLayerName } from '../utils/layer-name-formatter.js';
import { formatMarkdownTable } from '../utils/markdown-table.js';
import { escapeMarkdown } from '../export/markdown-utils.js';

export class ModelReadmeGenerator {
  constructor(private generatedAt: string) {}

  /**
   * Generate complete model README markdown
   */
  generate(data: ModelReadmeData): string {
    const lines: string[] = [];

    // Header with project name
    lines.push(this.generateHeader(data));

    // Statistics section
    lines.push(this.generateStatistics(data));

    // Project summary
    lines.push(this.generateProjectSummary(data));

    // Documentation robotics introduction
    lines.push(this.generateIntroduction());

    // Layer index table
    lines.push(this.generateLayerIndex(data));

    // Footer
    lines.push(this.generateFooter(data));

    return lines.join('');
  }

  private generateHeader(data: ModelReadmeData): string {
    const lines: string[] = [];
    lines.push(`# ${escapeMarkdown(data.projectName)}\n`);
    lines.push('\n');
    return lines.join('');
  }

  private generateStatistics(data: ModelReadmeData): string {
    const lines: string[] = [];
    lines.push('## Model Statistics\n');
    lines.push('\n');

    const headers = ['Metric', 'Value'];
    const rows = [
      ['Total Elements', String(data.totalElements)],
      ['Total Relationships', String(data.totalRelationships)],
      ['Populated Layers', String(data.populatedLayerCount)],
      ['Last Updated', data.lastUpdated],
      ['CLI Version', data.cliVersion],
    ];

    // Add spec version if available
    if (data.specVersion) {
      rows.push(['Spec Version', data.specVersion]);
    }

    const table = formatMarkdownTable(headers, rows);
    lines.push(table);
    lines.push('\n');

    return lines.join('');
  }

  private generateProjectSummary(data: ModelReadmeData): string {
    const lines: string[] = [];
    lines.push('## Project Summary\n');
    lines.push('\n');

    // Project description if available
    if (data.projectDescription) {
      lines.push(`${escapeMarkdown(data.projectDescription)}\n\n`);
    }

    // Layer population summary
    const populatedLayers = data.layers.filter(l => l.elementCount > 0);
    if (populatedLayers.length > 0) {
      lines.push('**Populated Layers**:\n\n');
      const layerNames = populatedLayers
        .map(l => `- ${formatLayerName(l.layerName)}`)
        .join('\n');
      lines.push(`${layerNames}\n\n`);
    }

    return lines.join('');
  }

  private generateIntroduction(): string {
    const lines: string[] = [];
    lines.push('## About Documentation Robotics\n');
    lines.push('\n');
    lines.push(
      'Documentation Robotics is a toolkit for managing federated architecture data models across 13 interconnected layers. ' +
      'It provides a structured approach to documenting systems architecture by organizing elements and relationships across ' +
      'distinct layers that represent different concerns: from business motivation and strategy through to technology infrastructure and testing.\n\n'
    );

    lines.push('### The 13-Layer Architecture Model\n\n');

    const layerDescriptions = [
      '1. **Motivation** - Goals, requirements, drivers, and strategic outcomes',
      '2. **Business** - Business processes, functions, roles, and services',
      '3. **Product** - Product features, capabilities, personas, and milestones',
      '4. **Security** - Authentication, authorization, threats, and controls',
      '5. **Application** - Application components, services, and interactions',
      '6. **Technology** - Infrastructure, platforms, and technology components',
      '7. **API** - REST APIs, operations, and endpoints',
      '8. **Data Model** - Data entities, relationships, and structure definitions',
      '9. **Data Store** - Databases and persistence mechanisms',
      '10. **UX** - User interface components and user experience elements',
      '11. **Navigation** - Application routing and navigation flows',
      '12. **APM** - Observability, monitoring, metrics, and tracing',
      '13. **Testing** - Test strategies, test cases, and test coverage',
    ];

    lines.push(layerDescriptions.join('\n'));
    lines.push('\n\n');

    lines.push(
      'Each layer is independently managed but interconnected, allowing elements in higher layers to reference elements in lower layers, ' +
      'creating a comprehensive dependency graph that ensures architectural coherence and traceability across all concerns.\n\n'
    );

    return lines.join('');
  }

  private generateLayerIndex(data: ModelReadmeData): string {
    const lines: string[] = [];
    lines.push('## Layer Reports\n');
    lines.push('\n');

    const headers = ['Layer', 'Elements', 'Report'];
    const rows: string[][] = [];

    // Sort layers by layer number for consistent ordering
    const sortedLayers = [...data.layers].sort((a, b) => a.layerNumber - b.layerNumber);

    for (const layer of sortedLayers) {
      const layerName = formatLayerName(layer.layerName);
      const elementCount = String(layer.elementCount);

      let report: string;
      if (layer.elementCount > 0) {
        // Create link to layer report (in reports/ subdirectory)
        report = `[${layer.reportFileName}](./reports/${layer.reportFileName})`;
      } else {
        // No link for empty layers
        report = '—';
      }

      rows.push([layerName, elementCount, report]);
    }

    const table = formatMarkdownTable(headers, rows);
    lines.push(table);
    lines.push('\n');

    return lines.join('');
  }

  private generateFooter(data: ModelReadmeData): string {
    const lines: string[] = [];
    lines.push('---\n');
    lines.push('\n');
    lines.push(`Generated: ${this.generatedAt} | Model Version: ${data.modelVersion}\n`);
    return lines.join('');
  }
}
