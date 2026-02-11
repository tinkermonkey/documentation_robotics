/**
 * Report Exporter - Export comprehensive architecture reports
 */

import { Model } from "../core/model.js";
import { ReportDataModel } from "../core/report-data-model.js";
import { formatReport, ReportFormatterOptions } from "./report-formatters.js";
import { Exporter, ExportOptions } from "./types.js";

/**
 * Comprehensive report exporter
 */
export class ReportExporter implements Exporter {
  name = "Comprehensive Report";
  supportedLayers = [
    "motivation",
    "business",
    "security",
    "application",
    "technology",
    "api",
    "data-model",
    "data-store",
    "ux",
    "navigation",
    "apm",
    "testing",
  ];

  /**
   * Export model as comprehensive report
   */
  async export(model: Model, _options?: ExportOptions): Promise<string> {
    const reportModel = new ReportDataModel(model);
    const report = await reportModel.collect();

    const formatterOptions: ReportFormatterOptions = {
      format: "text",
      compact: false,
      verbose: true,
      includeDataModel: true,
      includeQuality: true,
    };

    return formatReport(report, formatterOptions);
  }
}

/**
 * Statistics-focused report exporter
 */
export class StatsReportExporter implements Exporter {
  name = "Statistics Report";
  supportedLayers = [
    "motivation",
    "business",
    "security",
    "application",
    "technology",
    "api",
    "data-model",
    "data-store",
    "ux",
    "navigation",
    "apm",
    "testing",
  ];

  /**
   * Export model statistics as report
   */
  async export(model: Model, _options?: ExportOptions): Promise<string> {
    const reportModel = new ReportDataModel(model);
    const report = await reportModel.collect();

    const formatterOptions: ReportFormatterOptions = {
      format: "text",
      compact: false,
      verbose: false,
      includeDataModel: false,
      includeQuality: true,
    };

    return formatReport(report, formatterOptions);
  }
}

/**
 * Relationship-focused report exporter
 */
export class RelationshipReportExporter implements Exporter {
  name = "Relationship Report";
  supportedLayers = [
    "motivation",
    "business",
    "security",
    "application",
    "technology",
    "api",
    "data-model",
    "data-store",
    "ux",
    "navigation",
    "apm",
    "testing",
  ];

  /**
   * Export relationship analysis as report
   */
  async export(model: Model, _options?: ExportOptions): Promise<string> {
    const reportModel = new ReportDataModel(model);
    const report = await reportModel.collect();

    const lines: string[] = [];

    // Header
    lines.push("");
    lines.push(`Relationship Analysis Report: ${report.statistics.project.name}`);
    lines.push("=".repeat(80));
    lines.push("");

    // Summary
    lines.push(`Total Relationships: ${report.relationships.totalRelationships}`);
    lines.push(`Cross-Layer: ${report.relationships.crossLayerCount}`);
    lines.push(`Intra-Layer: ${report.relationships.intraLayerCount}`);
    lines.push("");

    // By Category
    lines.push("By Category:");
    for (const [category, count] of Object.entries(report.relationships.byCategory)
      .sort(([, a], [, b]) => b - a)) {
      const percentage = ((count / report.relationships.totalRelationships) * 100).toFixed(1);
      lines.push(`  ${category}: ${count} (${percentage}%)`);
    }
    lines.push("");

    // By Predicate
    lines.push("Top Predicates:");
    const topPredicates = Object.entries(report.relationships.byPredicate)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    for (const [predicate, count] of topPredicates) {
      const percentage = ((count / report.relationships.totalRelationships) * 100).toFixed(1);
      lines.push(`  ${predicate}: ${count} (${percentage}%)`);
    }
    lines.push("");

    // Circular Dependencies
    if (report.relationships.circularDependencies.length > 0) {
      lines.push(`Circular Dependencies (${report.relationships.circularDependencies.length}):`);
      for (const circular of report.relationships.circularDependencies.slice(0, 10)) {
        lines.push(`  ${circular.elements.join(" → ")} → ${circular.elements[0]}`);
      }
    }

    return lines.join("\n");
  }
}

/**
 * Data Model-focused report exporter
 */
export class DataModelReportExporter implements Exporter {
  name = "Data Model Report";
  supportedLayers = ["data-model"];

  /**
   * Export data model analysis as report
   */
  async export(model: Model, _options?: ExportOptions): Promise<string> {
    const reportModel = new ReportDataModel(model);
    const report = await reportModel.collect();
    const dataModel = report.dataModel;

    const lines: string[] = [];

    // Header
    lines.push("");
    lines.push(`Data Model Analysis Report: ${report.statistics.project.name}`);
    lines.push("=".repeat(80));
    lines.push("");

    // Summary
    lines.push(`Total Entities: ${dataModel.entityCount}`);
    lines.push(`Total Attributes: ${dataModel.attributeCount}`);
    lines.push(`Entity Relationships: ${dataModel.relationshipCount}`);
    lines.push(`Referenced Entities: ${dataModel.referencedEntities}`);
    lines.push("");

    // Complexity
    lines.push("Complexity Metrics:");
    lines.push(`  Avg Attributes per Entity: ${dataModel.avgAttributesPerEntity}`);
    lines.push(`  Max Attributes per Entity: ${dataModel.maxAttributesPerEntity}`);
    lines.push(`  Avg Relationships per Entity: ${dataModel.avgRelationshipsPerEntity}`);
    lines.push("");

    // Coverage
    lines.push("Coverage Metrics:");
    lines.push(`  Entity Coverage: ${dataModel.entityCoverage.toFixed(0)}%`);
    lines.push(`  Attribute Coverage: ${dataModel.attributeCoverage.toFixed(0)}%`);
    lines.push("");

    // Entities
    lines.push(`Entities (${dataModel.entities.length}):`);
    for (const entity of dataModel.entities.slice(0, 20)) {
      const refMarker = entity.isReferenced ? " [referenced]" : "";
      const relCount = entity.relatedEntities.length;
      lines.push(`  - ${entity.name}: ${entity.attributes.length} attrs, ${relCount} rels${refMarker}`);
    }

    if (dataModel.entities.length > 20) {
      lines.push(`  ... and ${dataModel.entities.length - 20} more`);
    }
    lines.push("");

    // Orphaned Entities
    if (dataModel.orphanedEntities.length > 0) {
      lines.push(`Orphaned Entities (${dataModel.orphanedEntities.length}):`);
      for (const entity of dataModel.orphanedEntities) {
        lines.push(`  - ${entity}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}

/**
 * Quality metrics focused report exporter
 */
export class QualityReportExporter implements Exporter {
  name = "Quality Metrics Report";
  supportedLayers = [
    "motivation",
    "business",
    "security",
    "application",
    "technology",
    "api",
    "data-model",
    "data-store",
    "ux",
    "navigation",
    "apm",
    "testing",
  ];

  /**
   * Export quality metrics as report
   */
  async export(model: Model, _options?: ExportOptions): Promise<string> {
    const reportModel = new ReportDataModel(model);
    const report = await reportModel.collect();
    const quality = report.quality;

    const lines: string[] = [];

    // Header
    lines.push("");
    lines.push(`Quality Metrics Report: ${report.statistics.project.name}`);
    lines.push("=".repeat(80));
    lines.push("");

    // Coverage Metrics
    lines.push("Coverage Metrics:");
    lines.push(`  Element Coverage: ${quality.elementCoverage.toFixed(0)}%`);
    lines.push(`  Relationship Coverage: ${quality.relationshipCoverage.toFixed(0)}%`);
    lines.push(`  Documentation Coverage: ${quality.documentationCoverage.toFixed(0)}%`);
    lines.push(`  Layer Coverage: ${quality.layerCoverage.toFixed(0)}%`);
    lines.push("");

    // Compliance Metrics
    lines.push("Compliance Metrics:");
    lines.push(`  ArchiMate Compliance: ${quality.archimateCompliance.toFixed(0)}%`);
    lines.push(`  Spec Compliance: ${quality.specCompliance.toFixed(0)}%`);
    lines.push(`  Semantic Consistency: ${quality.semanticConsistency.toFixed(0)}%`);
    lines.push(`  Cross-Layer Reference Health: ${quality.crossLayerReferenceHealth.toFixed(0)}%`);
    lines.push(`  Layer Compliance Score: ${quality.layerComplianceScore.toFixed(0)}%`);
    lines.push("");

    // Structural Issues
    lines.push("Structural Issues:");
    lines.push(`  Orphaned Elements: ${quality.orphanedElements}`);
    lines.push(`  Circular Dependencies: ${quality.circularDependencies}`);
    lines.push("");

    // Recommendations
    lines.push("Recommendations:");
    if (quality.elementCoverage < 70) {
      lines.push("  - Consider adding more elements to improve coverage");
    }
    if (quality.documentationCoverage < 70) {
      lines.push("  - Add documentation to improve knowledge transfer");
    }
    if (quality.archimateCompliance < 80) {
      lines.push("  - Review relationships for ArchiMate alignment");
    }
    if (quality.circularDependencies > 0) {
      lines.push("  - Resolve circular dependencies to improve architectural clarity");
    }
    if (quality.orphanedElements > 0) {
      lines.push("  - Review and remove or connect orphaned elements");
    }

    return lines.join("\n");
  }
}
