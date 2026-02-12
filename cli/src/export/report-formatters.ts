/**
 * Report formatters for comprehensive architecture reports
 * Supports text, JSON, and markdown output formats
 */

import ansis from "ansis";
import { ReportData, QualityMetrics } from "../core/report-data-model.js";

export type ReportFormat = "text" | "json" | "markdown" | "compact";

export interface ReportFormatterOptions {
  format: ReportFormat;
  compact?: boolean;
  verbose?: boolean;
  includeDataModel?: boolean;
  includeQuality?: boolean;
}

/**
 * Format report for output
 */
export function formatReport(report: ReportData, options: ReportFormatterOptions): string {
  switch (options.format) {
    case "json":
      return formatJSON(report);
    case "markdown":
      return formatMarkdown(report, options);
    case "compact":
      return formatCompact(report);
    case "text":
    default:
      return formatText(report, options);
  }
}

/**
 * Format as plain text (default)
 */
function formatText(report: ReportData, options: ReportFormatterOptions): string {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(ansis.bold(`📊 Architecture Report: ${ansis.cyan(report.statistics.project.name)}`));
  lines.push(ansis.dim("=".repeat(80)));
  lines.push("");
  lines.push(`Generated: ${new Date(report.timestamp).toLocaleString()}`);
  lines.push(`Version: ${report.statistics.project.version}`);
  lines.push("");

  // Quality Overview
  if (options.includeQuality) {
    formatQualitySection(lines, report.quality);
    lines.push("");
  }

  // Statistics
  formatStatisticsSection(lines, report);
  lines.push("");

  // Relationships
  formatRelationshipsSection(lines, report);
  lines.push("");

  // Data Model
  if (options.includeDataModel) {
    formatDataModelSection(lines, report);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format as JSON
 */
function formatJSON(report: ReportData): string {
  return JSON.stringify(report, null, 2) + "\n";
}

/**
 * Format as Markdown
 */
function formatMarkdown(report: ReportData, options: ReportFormatterOptions): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Architecture Report: ${report.statistics.project.name}`);
  lines.push("");
  lines.push(`**Generated:** ${new Date(report.timestamp).toLocaleString()}`);
  lines.push(`**Version:** ${report.statistics.project.version}`);
  lines.push("");

  // Table of Contents
  lines.push("## Contents");
  lines.push("- [Quality Metrics](#quality-metrics)");
  lines.push("- [Statistics](#statistics)");
  lines.push("- [Relationships](#relationships)");
  if (options.includeDataModel) {
    lines.push("- [Data Model](#data-model)");
  }
  lines.push("");

  // Quality Metrics
  if (options.includeQuality) {
    formatQualityMarkdown(lines, report.quality);
    lines.push("");
  }

  // Statistics
  formatStatisticsMarkdown(lines, report);
  lines.push("");

  // Relationships
  formatRelationshipsMarkdown(lines, report);
  lines.push("");

  // Data Model
  if (options.includeDataModel) {
    formatDataModelMarkdown(lines, report);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format as compact single line
 */
function formatCompact(report: ReportData): string {
  const stats = report.statistics.statistics;
  const quality = report.quality;

  return (
    `${report.statistics.project.name} v${report.statistics.project.version}: ` +
    `${stats.totalElements} elements, ` +
    `${stats.totalRelationships} relationships, ` +
    `${report.relationships.circularDependencies.length} circular deps, ` +
    `${Math.round(quality.elementCoverage)}% coverage`
  );
}

/**
 * Format quality section for text output
 */
function formatQualitySection(lines: string[], quality: QualityMetrics): void {
  lines.push(ansis.bold("Quality Metrics:"));
  lines.push(
    `  ${ansis.gray("Element Coverage:")}        ${qualityBar(quality.elementCoverage)} ${quality.elementCoverage.toFixed(0)}%`
  );
  lines.push(
    `  ${ansis.gray("Relationship Coverage:")}   ${qualityBar(quality.relationshipCoverage)} ${quality.relationshipCoverage.toFixed(0)}%`
  );
  lines.push(
    `  ${ansis.gray("Documentation Coverage:")}  ${qualityBar(quality.documentationCoverage)} ${quality.documentationCoverage.toFixed(0)}%`
  );
  lines.push(
    `  ${ansis.gray("Layer Coverage:")}          ${qualityBar(quality.layerCoverage)} ${quality.layerCoverage.toFixed(0)}%`
  );
  lines.push("");
  lines.push(
    `  ${ansis.gray("ArchiMate Compliance:")}    ${quality.archimateCompliance.toFixed(0)}%`
  );
  lines.push(
    `  ${ansis.gray("Spec Compliance:")}        ${quality.specCompliance.toFixed(0)}%`
  );
  lines.push(
    `  ${ansis.gray("Semantic Consistency:")}   ${quality.semanticConsistency.toFixed(0)}%`
  );
  lines.push("");
  lines.push(
    `  ${ansis.gray("Orphaned Elements:")}      ${quality.orphanedElements > 0 ? ansis.yellow(quality.orphanedElements) : ansis.green("0")}`
  );
  lines.push(
    `  ${ansis.gray("Circular Dependencies:")}  ${quality.circularDependencies > 0 ? ansis.red(quality.circularDependencies) : ansis.green("0")}`
  );
}

/**
 * Format statistics section for text output
 */
function formatStatisticsSection(lines: string[], report: ReportData): void {
  const stats = report.statistics;

  lines.push(ansis.bold("Statistics:"));
  lines.push(
    `  ${ansis.gray("Total Elements:")}  ${stats.statistics.totalElements}`
  );
  lines.push(
    `  ${ansis.gray("Total Relationships:")}  ${stats.statistics.totalRelationships}`
  );
  lines.push(
    `  ${ansis.gray("Populated Layers:")}  ${stats.statistics.populatedLayers}/${stats.statistics.totalLayers}`
  );
  lines.push("");

  lines.push(ansis.bold("Top Element Types:"));
  for (const layer of stats.layers.slice(0, 5)) {
    if (layer.totalElements > 0) {
      const types = Object.entries(layer.elementsByType)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([type, count]) => `${count} ${type}`)
        .join(", ");
      lines.push(`  ${layer.name}: ${types}`);
    }
  }
}

/**
 * Format relationships section for text output
 */
function formatRelationshipsSection(lines: string[], report: ReportData): void {
  const relationships = report.relationships;

  lines.push(ansis.bold("Relationships:"));
  lines.push(
    `  ${ansis.gray("Cross-Layer:")}  ${relationships.crossLayerCount}`
  );
  lines.push(
    `  ${ansis.gray("Intra-Layer:")}  ${relationships.intraLayerCount}`
  );
  lines.push("");

  lines.push(ansis.bold("By Category:"));
  const categoryEntries = Object.entries(relationships.byCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  for (const [category, count] of categoryEntries) {
    const percentage = (count / relationships.totalRelationships) * 100;
    lines.push(`  ${category.padEnd(20)} ${String(count).padEnd(3)} (${percentage.toFixed(0)}%)`);
  }

  if (relationships.circularDependencies.length > 0) {
    lines.push("");
    lines.push(ansis.bold(ansis.red("⚠️  Circular Dependencies:")));
    for (const circular of relationships.circularDependencies.slice(0, 5)) {
      lines.push(`  ${circular.elements.join(" → ")} → ${circular.elements[0]}`);
    }
  }
}

/**
 * Format data model section for text output
 */
function formatDataModelSection(lines: string[], report: ReportData): void {
  const dataModel = report.dataModel;

  lines.push(ansis.bold("Data Model (Layer 7):"));
  lines.push(
    `  ${ansis.gray("Total Entities:")}  ${dataModel.entityCount}`
  );
  lines.push(
    `  ${ansis.gray("Total Attributes:")}  ${dataModel.attributeCount}`
  );
  lines.push(
    `  ${ansis.gray("Entity Relationships:")}  ${dataModel.relationshipCount}`
  );
  lines.push(
    `  ${ansis.gray("Referenced Entities:")}  ${dataModel.referencedEntities}`
  );
  lines.push("");

  if (dataModel.orphanedEntities.length > 0) {
    lines.push(ansis.bold(ansis.yellow("⚠️  Orphaned Entities:")));
    for (const entity of dataModel.orphanedEntities.slice(0, 5)) {
      lines.push(`  - ${entity}`);
    }
  }
}

/**
 * Format quality section for markdown
 */
function formatQualityMarkdown(lines: string[], quality: QualityMetrics): void {
  lines.push("## Quality Metrics");
  lines.push("");
  lines.push("### Coverage");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Element Coverage | ${quality.elementCoverage.toFixed(0)}% |`);
  lines.push(`| Relationship Coverage | ${quality.relationshipCoverage.toFixed(0)}% |`);
  lines.push(`| Documentation Coverage | ${quality.documentationCoverage.toFixed(0)}% |`);
  lines.push(`| Layer Coverage | ${quality.layerCoverage.toFixed(0)}% |`);
  lines.push("");

  lines.push("### Compliance");
  lines.push("| Metric | Score |");
  lines.push("|--------|-------|");
  lines.push(`| ArchiMate Compliance | ${quality.archimateCompliance.toFixed(0)}% |`);
  lines.push(`| Spec Compliance | ${quality.specCompliance.toFixed(0)}% |`);
  lines.push(`| Semantic Consistency | ${quality.semanticConsistency.toFixed(0)}% |`);
  lines.push("");

  lines.push("### Issues");
  lines.push(`- Orphaned Elements: ${quality.orphanedElements}`);
  lines.push(`- Circular Dependencies: ${quality.circularDependencies}`);
  lines.push("");
}

/**
 * Format statistics section for markdown
 */
function formatStatisticsMarkdown(lines: string[], report: ReportData): void {
  const stats = report.statistics;

  lines.push("## Statistics");
  lines.push("");
  lines.push("### Overview");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Total Elements | ${stats.statistics.totalElements} |`);
  lines.push(`| Total Relationships | ${stats.statistics.totalRelationships} |`);
  lines.push(`| Populated Layers | ${stats.statistics.populatedLayers}/${stats.statistics.totalLayers} |`);
  lines.push("");

  lines.push("### Elements by Layer");
  lines.push("| Layer | Count | Types |");
  lines.push("|-------|-------|-------|");
  for (const layer of stats.layers) {
    if (layer.totalElements > 0) {
      const types = Object.keys(layer.elementsByType).join(", ");
      lines.push(`| ${layer.name} | ${layer.totalElements} | ${types} |`);
    }
  }
  lines.push("");
}

/**
 * Format relationships section for markdown
 */
function formatRelationshipsMarkdown(lines: string[], report: ReportData): void {
  const relationships = report.relationships;

  lines.push("## Relationships");
  lines.push("");
  lines.push("### Overview");
  lines.push("| Type | Count |");
  lines.push("|------|-------|");
  lines.push(`| Total | ${relationships.totalRelationships} |`);
  lines.push(`| Cross-Layer | ${relationships.crossLayerCount} |`);
  lines.push(`| Intra-Layer | ${relationships.intraLayerCount} |`);
  lines.push("");

  lines.push("### By Category");
  lines.push("| Category | Count | Percentage |");
  lines.push("|----------|-------|-----------|");
  for (const [category, count] of Object.entries(relationships.byCategory)
    .sort(([, a], [, b]) => b - a)) {
    const percentage = ((count / relationships.totalRelationships) * 100).toFixed(1);
    lines.push(`| ${category} | ${count} | ${percentage}% |`);
  }
  lines.push("");

  if (relationships.circularDependencies.length > 0) {
    lines.push("### Circular Dependencies");
    for (const circular of relationships.circularDependencies) {
      lines.push(`- ${circular.elements.join(" → ")} → ${circular.elements[0]}`);
    }
    lines.push("");
  }
}

/**
 * Format data model section for markdown
 */
function formatDataModelMarkdown(lines: string[], report: ReportData): void {
  const dataModel = report.dataModel;

  lines.push("## Data Model (Layer 7)");
  lines.push("");
  lines.push("### Overview");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Total Entities | ${dataModel.entityCount} |`);
  lines.push(`| Total Attributes | ${dataModel.attributeCount} |`);
  lines.push(`| Entity Relationships | ${dataModel.relationshipCount} |`);
  lines.push(`| Referenced Entities | ${dataModel.referencedEntities} |`);
  lines.push("");

  if (dataModel.orphanedEntities.length > 0) {
    lines.push("### Orphaned Entities");
    for (const entity of dataModel.orphanedEntities) {
      lines.push(`- ${entity}`);
    }
    lines.push("");
  }
}

/**
 * Create quality progress bar
 */
function qualityBar(percentage: number): string {
  const width = 20;
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;

  const bar = "█".repeat(filled) + "░".repeat(empty);

  if (percentage >= 80) return ansis.green(bar);
  if (percentage >= 60) return ansis.yellow(bar);
  return ansis.red(bar);
}
