import fs from "fs/promises";
import path from "path";
import type { AuditReport, CoverageMetrics } from "../types.js";
import { AuditOrchestrator, type AuditOptions } from "../audit-orchestrator.js";
import { ReportGenerator } from "../reports/report-generator.js";
import { DifferentialAnalyzer, type DifferentialAnalysis } from "../differential-analyzer.js";
import { SnapshotStorage } from "../snapshot-storage.js";

export interface PipelineOptions {
  /**
   * Base output directory for all pipeline artifacts
   * Default: "audit-results"
   */
  outputDir?: string;

  /**
   * Layer to audit (or undefined for all layers)
   */
  layer?: string;

  /**
   * Report format
   */
  format?: "text" | "json" | "markdown";

  /**
   * Whether to run AI-assisted evaluation
   */
  enableAI?: boolean;

  /**
   * Verbose output
   */
  verbose?: boolean;

  /**
   * Claude API key for AI evaluation
   */
  claudeApiKey?: string;
}

export interface PipelineResult {
  /**
   * Result from before AI evaluation
   */
  beforeResult: AuditReport;

  /**
   * Result from after AI evaluation (if AI enabled)
   */
  afterResult?: AuditReport;

  /**
   * Paths to generated reports
   */
  reports: {
    before: string;
    after?: string;
    summary?: string;
  };

  /**
   * Summary of changes (if AI enabled)
   */
  summary?: {
    relationshipsAdded: number;
    gapsResolved: number;
    coverageImprovement: number;
  };
}

/**
 * Orchestrates the complete audit pipeline:
 * 1. Before audit → output to audit-results/before/
 * 2. AI-assisted evaluation (if enabled)
 * 3. After audit → output to audit-results/after/
 * 4. Differential summary → output to audit-results/summary/
 */
export class PipelineOrchestrator {
  private readonly auditOrchestrator: AuditOrchestrator;
  private readonly reportGenerator: ReportGenerator;
  private readonly differentialAnalyzer: DifferentialAnalyzer;
  private readonly snapshotStorage: SnapshotStorage;

  constructor() {
    this.auditOrchestrator = new AuditOrchestrator();
    this.reportGenerator = new ReportGenerator();
    this.differentialAnalyzer = new DifferentialAnalyzer();
    this.snapshotStorage = new SnapshotStorage();
  }

  /**
   * Execute the complete audit pipeline
   */
  async executePipeline(options: PipelineOptions = {}): Promise<PipelineResult> {
    const baseOutputDir = options.outputDir ?? "audit-results";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sessionDir = path.join(baseOutputDir, timestamp);

    // Create output directories
    const beforeDir = path.join(sessionDir, "before");
    const afterDir = path.join(sessionDir, "after");
    const summaryDir = path.join(sessionDir, "summary");

    await fs.mkdir(beforeDir, { recursive: true });
    await fs.mkdir(afterDir, { recursive: true });
    await fs.mkdir(summaryDir, { recursive: true });

    console.log(`\n📊 Starting Audit Pipeline`);
    console.log(`   Output: ${sessionDir}\n`);

    // Step 1: Run BEFORE audit
    console.log("⏳ Step 1/4: Running initial audit (BEFORE AI evaluation)...");
    const beforeResult = await this.runAudit(options);

    // Save BEFORE snapshot
    await this.snapshotStorage.save(beforeResult);

    // Generate BEFORE report
    const beforeReportPath = await this.reportGenerator.generateReport(beforeResult, {
      phase: "before",
      outputDir: beforeDir,
      format: options.format ?? "markdown",
      layer: options.layer,
      verbose: options.verbose,
    });

    console.log(`✅ Before audit complete: ${beforeReportPath}`);

    const reports = {
      before: beforeReportPath,
    };

    // If AI evaluation is disabled, stop here
    if (!options.enableAI) {
      console.log("\n📋 Pipeline complete (AI evaluation disabled)");
      return {
        beforeResult,
        reports,
      };
    }

    // Step 2: Run AI-assisted evaluation
    console.log("\n⏳ Step 2/4: Running AI-assisted evaluation...");

    if (!options.claudeApiKey) {
      console.warn("⚠️  Warning: No Claude API key provided, skipping AI evaluation");
      console.log("\n📋 Pipeline complete (AI evaluation skipped)");
      return {
        beforeResult,
        reports,
      };
    }

    // Note: AI evaluation is not fully integrated yet - this is a placeholder
    // The AIEvaluator exists but needs additional integration work
    console.log("⚠️  AI evaluation integration is in progress");
    console.log("    (Continuing with before/after reports only)");

    // Step 3: Run AFTER audit
    console.log("\n⏳ Step 3/4: Running post-evaluation audit (AFTER AI evaluation)...");
    const afterResult = await this.runAudit(options);

    // Save AFTER snapshot
    await this.snapshotStorage.save(afterResult);

    // Generate AFTER report
    const afterReportPath = await this.reportGenerator.generateReport(afterResult, {
      phase: "after",
      outputDir: afterDir,
      format: options.format ?? "markdown",
      layer: options.layer,
      verbose: options.verbose,
    });

    console.log(`✅ After audit complete: ${afterReportPath}`);

    // Step 4: Generate differential summary
    console.log("\n⏳ Step 4/4: Generating differential summary...");

    const differential = this.differentialAnalyzer.analyze(
      beforeResult,
      afterResult
    );

    // Generate summary report
    const summaryReportPath = await this.generateSummaryReport(
      differential,
      beforeResult,
      afterResult,
      summaryDir,
      options.format ?? "markdown"
    );

    console.log(`✅ Summary report complete: ${summaryReportPath}`);

    // Calculate summary metrics
    const avgDensityBefore =
      beforeResult.coverage.reduce((sum, c) => sum + c.relationshipsPerNodeType, 0) /
      (beforeResult.coverage.length || 1);
    const avgDensityAfter =
      afterResult.coverage.reduce((sum, c) => sum + c.relationshipsPerNodeType, 0) /
      (afterResult.coverage.length || 1);

    const summary = {
      relationshipsAdded: differential.summary.relationshipsAdded,
      gapsResolved: differential.detailed.gapChanges.resolved.length,
      coverageImprovement: avgDensityAfter - avgDensityBefore,
    };

    console.log("\n📊 Pipeline Results:");
    console.log(`   Relationships Added: ${summary.relationshipsAdded}`);
    console.log(`   Gaps Resolved: ${summary.gapsResolved}`);
    console.log(`   Coverage Improvement: ${summary.coverageImprovement.toFixed(2)} relationships/node type`);
    console.log(`\n✅ Pipeline complete: ${sessionDir}\n`);

    return {
      beforeResult,
      afterResult,
      reports: {
        before: beforeReportPath,
        after: afterReportPath,
        summary: summaryReportPath,
      },
      summary,
    };
  }

  /**
   * Run audit with current options
   */
  private async runAudit(options: PipelineOptions): Promise<AuditReport> {
    const auditOptions: AuditOptions = {
      layer: options.layer,
      verbose: options.verbose ?? false,
    };

    return this.auditOrchestrator.runAudit(auditOptions);
  }

  /**
   * Generate differential summary report with side-by-side metrics
   */
  private async generateSummaryReport(
    differential: DifferentialAnalysis,
    beforeResult: AuditReport,
    afterResult: AuditReport,
    outputDir: string,
    format: "text" | "json" | "markdown"
  ): Promise<string> {
    let content: string;
    let filename: string;

    switch (format) {
      case "json":
        content = JSON.stringify(differential, null, 2);
        filename = "summary.json";
        break;

      case "markdown":
        content = this.generateMarkdownSummary(differential, beforeResult, afterResult);
        filename = "summary.md";
        break;

      case "text":
      default:
        content = this.generateTextSummary(differential, beforeResult, afterResult);
        filename = "summary.txt";
        break;
    }

    const outputPath = path.join(outputDir, filename);
    await fs.writeFile(outputPath, content, "utf-8");
    return outputPath;
  }

  /**
   * Generate Markdown summary with side-by-side metrics
   */
  private generateMarkdownSummary(differential: DifferentialAnalysis, beforeResult: AuditReport, afterResult: AuditReport): string {
    const lines: string[] = [];

    lines.push("# Differential Audit Summary");
    lines.push("");
    lines.push(`**Analysis Date**: ${new Date().toISOString()}`);
    lines.push("");

    // Calculate average metrics across all layers
    const beforeCoverage = beforeResult.coverage;
    const afterCoverage = afterResult.coverage;

    const avgIsolationBefore =
      beforeCoverage.reduce((sum, c) => sum + c.isolationPercentage, 0) /
      (beforeCoverage.length || 1);
    const avgIsolationAfter =
      afterCoverage.reduce((sum, c) => sum + c.isolationPercentage, 0) /
      (afterCoverage.length || 1);

    const avgDensityBefore =
      beforeCoverage.reduce((sum, c) => sum + c.relationshipsPerNodeType, 0) /
      (beforeCoverage.length || 1);
    const avgDensityAfter =
      afterCoverage.reduce((sum, c) => sum + c.relationshipsPerNodeType, 0) /
      (afterCoverage.length || 1);

    const avgUtilizationBefore =
      beforeCoverage.reduce((sum, c) => sum + c.utilizationPercentage, 0) /
      (beforeCoverage.length || 1);
    const avgUtilizationAfter =
      afterCoverage.reduce((sum, c) => sum + c.utilizationPercentage, 0) /
      (afterCoverage.length || 1);

    // Side-by-side metrics table
    lines.push("## Coverage Metrics Comparison");
    lines.push("");
    lines.push("| Metric | Before | After | Change |");
    lines.push("|--------|--------|-------|--------|");

    const metrics = [
      {
        name: "Isolation Rate",
        before: avgIsolationBefore,
        after: avgIsolationAfter,
        unit: "%",
      },
      {
        name: "Density",
        before: avgDensityBefore,
        after: avgDensityAfter,
        unit: " rel/type",
      },
      {
        name: "Predicate Utilization",
        before: avgUtilizationBefore,
        after: avgUtilizationAfter,
        unit: "%",
      },
    ];

    metrics.forEach((metric) => {
      const change = metric.after - metric.before;
      const changeStr =
        change > 0
          ? `+${change.toFixed(2)}${metric.unit}`
          : `${change.toFixed(2)}${metric.unit}`;
      lines.push(
        `| ${metric.name} | ${metric.before.toFixed(2)}${metric.unit} | ${metric.after.toFixed(2)}${metric.unit} | ${changeStr} |`
      );
    });

    lines.push("");

    // Resolved gaps
    if (differential.detailed.gapChanges.resolved.length > 0) {
      lines.push("## Resolved Gaps");
      lines.push("");
      differential.detailed.gapChanges.resolved.forEach((gap: any) => {
        lines.push(`- ✅ **${gap.sourceNodeType}** → **${gap.destinationNodeType}**: ${gap.suggestedPredicate}`);
      });
      lines.push("");
    }

    // Added relationships (from summary)
    if (differential.summary.relationshipsAdded > 0) {
      lines.push("## Added Relationships");
      lines.push("");
      lines.push(`Total: ${differential.summary.relationshipsAdded}`);
      lines.push("");
    }

    // Visual diff of coverage heatmap (simplified)
    lines.push("## Coverage Heatmap");
    lines.push("");
    lines.push("### Before");
    lines.push(this.generateCoverageHeatmap(beforeResult.coverage));
    lines.push("");
    lines.push("### After");
    lines.push(this.generateCoverageHeatmap(afterResult.coverage));
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Generate text summary
   */
  private generateTextSummary(differential: DifferentialAnalysis, beforeResult: AuditReport, afterResult: AuditReport): string {
    const lines: string[] = [];

    lines.push("=".repeat(80));
    lines.push("DIFFERENTIAL AUDIT SUMMARY");
    lines.push("=".repeat(80));
    lines.push("");
    lines.push(`Analysis Date: ${new Date().toISOString()}`);
    lines.push("");

    // Calculate average metrics
    const beforeCoverage = beforeResult.coverage;
    const afterCoverage = afterResult.coverage;

    const isolationBefore =
      beforeCoverage.reduce((sum, c) => sum + c.isolationPercentage, 0) /
      (beforeCoverage.length || 1);
    const isolationAfter =
      afterCoverage.reduce((sum, c) => sum + c.isolationPercentage, 0) /
      (afterCoverage.length || 1);

    const densityBefore =
      beforeCoverage.reduce((sum, c) => sum + c.relationshipsPerNodeType, 0) /
      (beforeCoverage.length || 1);
    const densityAfter =
      afterCoverage.reduce((sum, c) => sum + c.relationshipsPerNodeType, 0) /
      (afterCoverage.length || 1);

    const predicateBefore =
      beforeCoverage.reduce((sum, c) => sum + c.utilizationPercentage, 0) /
      (beforeCoverage.length || 1);
    const predicateAfter =
      afterCoverage.reduce((sum, c) => sum + c.utilizationPercentage, 0) /
      (afterCoverage.length || 1);

    // Metrics comparison
    lines.push("-".repeat(80));
    lines.push("COVERAGE METRICS COMPARISON");
    lines.push("-".repeat(80));
    lines.push("");

    lines.push(
      `Isolation Rate:    ${isolationBefore.toFixed(1)}% → ${isolationAfter.toFixed(1)}% (${(isolationAfter - isolationBefore).toFixed(1)}%)`
    );
    lines.push(
      `Density:           ${densityBefore.toFixed(2)} → ${densityAfter.toFixed(2)} (${(densityAfter - densityBefore).toFixed(2)})`
    );
    lines.push(
      `Predicate Usage:   ${predicateBefore.toFixed(1)}% → ${predicateAfter.toFixed(1)}% (${(predicateAfter - predicateBefore).toFixed(1)}%)`
    );

    lines.push("");

    // Resolved gaps
    if (differential.detailed.gapChanges.resolved.length > 0) {
      lines.push("-".repeat(80));
      lines.push("RESOLVED GAPS");
      lines.push("-".repeat(80));
      lines.push("");
      differential.detailed.gapChanges.resolved.forEach((gap: any, i: number) => {
        lines.push(`  ${i + 1}. ${gap.sourceNodeType} → ${gap.destinationNodeType}: ${gap.suggestedPredicate}`);
      });
      lines.push("");
    }

    // Added relationships
    if (differential.summary.relationshipsAdded > 0) {
      lines.push("-".repeat(80));
      lines.push("ADDED RELATIONSHIPS");
      lines.push("-".repeat(80));
      lines.push("");
      lines.push(`Total: ${differential.summary.relationshipsAdded}`);
      lines.push("");
    }

    lines.push("=".repeat(80));

    return lines.join("\n");
  }

  /**
   * Generate a simple coverage heatmap visualization
   */
  private generateCoverageHeatmap(coverage: CoverageMetrics[]): string {
    if (!coverage || coverage.length === 0) {
      return "No coverage data available";
    }

    const lines: string[] = [];

    // Calculate averages across all layers
    const avgIsolation =
      coverage.reduce((sum, c) => sum + c.isolationPercentage, 0) / coverage.length;
    const avgDensity =
      coverage.reduce((sum, c) => sum + c.relationshipsPerNodeType, 0) / coverage.length;
    const avgPredicateUtil =
      coverage.reduce((sum, c) => sum + c.utilizationPercentage, 0) / coverage.length;

    // Simple bar chart visualization
    const barLength = 50;

    lines.push("```");
    lines.push(
      `Isolation:  ${"█".repeat(Math.floor((avgIsolation / 100) * barLength))}${" ".repeat(barLength - Math.floor((avgIsolation / 100) * barLength))} ${avgIsolation.toFixed(1)}%`
    );
    lines.push(
      `Density:    ${"█".repeat(Math.floor((avgDensity / 5) * barLength))}${" ".repeat(barLength - Math.floor((avgDensity / 5) * barLength))} ${avgDensity.toFixed(2)}`
    );
    lines.push(
      `Predicates: ${"█".repeat(Math.floor((avgPredicateUtil / 100) * barLength))}${" ".repeat(barLength - Math.floor((avgPredicateUtil / 100) * barLength))} ${avgPredicateUtil.toFixed(1)}%`
    );
    lines.push("```");

    return lines.join("\n");
  }
}
