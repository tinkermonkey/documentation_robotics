import fs from "fs/promises";
import path from "path";
import type { AuditReport, CoverageMetrics, GapCandidate } from "../types.js";
import { AuditOrchestrator, type AuditOptions } from "../relationships/spec/orchestrator.js";
import { ReportGenerator } from "../reports/report-generator.js";
import { DifferentialAnalyzer, type DifferentialAnalysis } from "../differential-analyzer.js";
import { SnapshotStorage } from "../snapshot-storage.js";
import { AIEvaluator } from "../relationships/ai/evaluator.js";
import { AIEvaluationAbortError } from "../ai/runner.js";
import { CANONICAL_LAYER_NAMES } from "../../core/layers.js";

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
   * Requires Claude Code CLI to be installed and authenticated on the system
   */
  enableAI?: boolean;

  /**
   * Verbose output
   */
  verbose?: boolean;
}

/**
 * Pipeline result when AI is disabled
 * Contains only before snapshot and report
 */
export interface PipelineResultWithoutAI {
  beforeResult: AuditReport;
  afterResult?: never;
  reports: {
    before: string;
    after?: never;
    summary?: never;
  };
  summary?: never;
}

/**
 * Pipeline result when AI is enabled
 * Contains before and after snapshots, all reports, and summary metrics
 */
export interface PipelineResultWithAI {
  beforeResult: AuditReport;
  afterResult: AuditReport;
  reports: {
    before: string;
    after: string;
    summary: string;
  };
  summary: {
    relationshipsAdded: number;
    gapsResolved: number;
    coverageImprovement: number;
  };
}

/**
 * Discriminated union of pipeline results based on AI enablement
 * Enforces type safety: afterResult, reports.after, reports.summary, and summary
 * must be present together or absent together
 */
export type PipelineResult = PipelineResultWithoutAI | PipelineResultWithAI;

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
    console.log("   (Claude CLI must be installed and authenticated)");

    // Run AI-assisted evaluation using the AIEvaluator
    const aiEvaluator = new AIEvaluator({
      outputDir: beforeDir,
    });

    // Provide predicate retrieval function for AI evaluation
    // Predicates are used in AI prompts to suggest available relationship types
    const getPredicatesForLayer = async (layer: string): Promise<string[]> => {
      return this.auditOrchestrator.getPredicatesForLayer(layer);
    };

    // Step 2a: Evaluate low-coverage elements
    console.log("   Step 2a/3: Evaluating low-coverage elements...");
    let aiAborted = false;
    try {
      await aiEvaluator.evaluateLowCoverageElements(beforeResult.coverage as CoverageMetrics[], getPredicatesForLayer);
    } catch (error) {
      if (error instanceof AIEvaluationAbortError) {
        console.error("   ❌ AI evaluation aborted — Claude CLI unavailable. Skipping remaining AI steps.");
        aiAborted = true;
      } else {
        console.error("   ⚠️  Error evaluating low-coverage elements:", error instanceof Error ? error.message : String(error));
      }
    }

    // Step 2b: Review layer coherence
    if (!aiAborted) {
      console.log("   Step 2b/3: Reviewing layer coherence...");
      try {
        const layerNames = (beforeResult.coverage as CoverageMetrics[]).map((c) => c.layer);
        await aiEvaluator.reviewLayerCoherence(layerNames, beforeResult.coverage as CoverageMetrics[]);
      } catch (error) {
        if (error instanceof AIEvaluationAbortError) {
          console.error("   ❌ AI evaluation aborted — Claude CLI unavailable. Skipping remaining AI steps.");
          aiAborted = true;
        } else {
          console.error("   ⚠️  Error reviewing layer coherence:", error instanceof Error ? error.message : String(error));
        }
      }
    }

    // Step 2c: Validate inter-layer references
    if (!aiAborted) {
      console.log("   Step 2c/3: Validating inter-layer relationships...");
      try {
        // Build layer pairs for validation (higher layers → lower layers following the architecture)
        const layerPairs: Array<{ source: string; target: string }> = [];
        for (let i = 0; i < CANONICAL_LAYER_NAMES.length; i++) {
          for (let j = i + 1; j < CANONICAL_LAYER_NAMES.length; j++) {
            layerPairs.push({ source: CANONICAL_LAYER_NAMES[i], target: CANONICAL_LAYER_NAMES[j] });
          }
        }
        await aiEvaluator.validateInterLayerReferences(layerPairs);
      } catch (error) {
        if (error instanceof AIEvaluationAbortError) {
          console.error("   ❌ AI evaluation aborted — Claude CLI unavailable.");
        } else {
          console.error("   ⚠️  Error validating inter-layer relationships:", error instanceof Error ? error.message : String(error));
        }
      }
    }

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

    // Step 4: Generate differential summary and finalize
    console.log("\n⏳ Step 4/4: Generating differential summary and finalizing...");

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
        content = JSON.stringify(this.serializeDifferential(differential), null, 2);
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
      differential.detailed.gapChanges.resolved.forEach((gap: GapCandidate) => {
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
    lines.push(this.generateCoverageHeatmap(beforeResult.coverage as CoverageMetrics[]));
    lines.push("");
    lines.push("### After");
    lines.push(this.generateCoverageHeatmap(afterResult.coverage as CoverageMetrics[]));
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
      differential.detailed.gapChanges.resolved.forEach((gap: GapCandidate, i: number) => {
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
   * Convert DifferentialAnalysis to JSON-serializable format
   * Maps need to be converted to plain objects
   */
  private serializeDifferential(differential: DifferentialAnalysis): Record<string, unknown> {
    return {
      ...differential,
      detailed: {
        ...differential.detailed,
        coverageByLayer: Object.fromEntries(differential.detailed.coverageByLayer),
      },
    };
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

    // Helper to safely generate bar with clamped fill
    const generateBar = (fillRatio: number): string => {
      const filledLength = Math.max(0, Math.min(barLength, Math.floor(fillRatio * barLength)));
      const emptyLength = barLength - filledLength;
      return `${"█".repeat(filledLength)}${" ".repeat(emptyLength)}`;
    };

    lines.push("```");
    lines.push(
      `Isolation:  ${generateBar(avgIsolation / 100)} ${avgIsolation.toFixed(1)}%`
    );
    lines.push(
      `Density:    ${generateBar(avgDensity / 5)} ${avgDensity.toFixed(2)}`
    );
    lines.push(
      `Predicates: ${generateBar(avgPredicateUtil / 100)} ${avgPredicateUtil.toFixed(1)}%`
    );
    lines.push("```");

    return lines.join("\n");
  }
}
