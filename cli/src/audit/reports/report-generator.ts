import fs from "fs/promises";
import path from "path";
import type { AuditReport, GapCandidate, DuplicateCandidate, BalanceAssessment } from "../types.js";

export interface ReportOptions {
  /**
   * Phase of the audit pipeline - before or after AI evaluation
   */
  phase: "before" | "after";

  /**
   * Output directory for the report
   */
  outputDir: string;

  /**
   * Report format
   */
  format: "text" | "json" | "markdown";

  /**
   * Layer name (if audit is layer-specific)
   */
  layer?: string;

  /**
   * Whether to include verbose details
   */
  verbose?: boolean;
}

export interface ReportMetadata {
  timestamp: string;
  phase: "before" | "after";
  layer?: string;
  totalNodeTypes: number;
  totalRelationships: number;
}

/**
 * Generates audit reports with support for before/after phases
 */
export class ReportGenerator {
  /**
   * Generate a complete audit report
   */
  async generateReport(
    result: AuditReport,
    options: ReportOptions
  ): Promise<string> {
    // Ensure output directory exists
    await fs.mkdir(options.outputDir, { recursive: true });

    // Calculate totals from all layers
    const totalNodeTypes = result.coverage.reduce((sum, c) => sum + c.nodeTypeCount, 0);
    const totalRelationships = result.coverage.reduce((sum, c) => sum + c.relationshipCount, 0);

    const metadata: ReportMetadata = {
      timestamp: new Date().toISOString(),
      phase: options.phase,
      layer: options.layer,
      totalNodeTypes,
      totalRelationships,
    };

    // Generate report based on format
    let reportContent: string;
    let filename: string;

    switch (options.format) {
      case "json":
        reportContent = this.generateJsonReport(result, metadata);
        filename = `audit-${options.phase}.json`;
        break;
      case "markdown":
        reportContent = this.generateMarkdownReport(result, metadata, options.verbose);
        filename = `audit-${options.phase}.md`;
        break;
      case "text":
      default:
        reportContent = this.generateTextReport(result, metadata, options.verbose);
        filename = `audit-${options.phase}.txt`;
        break;
    }

    const outputPath = path.join(options.outputDir, filename);
    try {
      await fs.writeFile(outputPath, reportContent, "utf-8");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to write ${options.format} report to ${outputPath}: ${errorMsg}`
      );
    }

    return outputPath;
  }

  /**
   * Generate JSON format report
   */
  private generateJsonReport(
    result: AuditReport,
    metadata: ReportMetadata
  ): string {
    return JSON.stringify(
      {
        metadata,
        ...result,
      },
      null,
      2
    );
  }

  /**
   * Generate Markdown format report
   */
  private generateMarkdownReport(
    result: AuditReport,
    metadata: ReportMetadata,
    verbose = false
  ): string {
    const lines: string[] = [];

    // Header
    lines.push(`# Relationship Audit Report - ${metadata.phase.toUpperCase()}`);
    lines.push("");
    lines.push(`**Timestamp**: ${metadata.timestamp}`);
    if (metadata.layer) {
      lines.push(`**Layer**: ${metadata.layer}`);
    }
    lines.push(`**Total Node Types**: ${metadata.totalNodeTypes}`);
    lines.push(`**Total Relationships**: ${metadata.totalRelationships}`);
    lines.push("");

    // Coverage Section
    if (result.coverage && result.coverage.length > 0) {
      lines.push("## Coverage Metrics");
      lines.push("");

      result.coverage.forEach((coverage) => {
        lines.push(`### Layer: ${coverage.layer}`);
        lines.push(`- **Isolation Rate**: ${coverage.isolationPercentage.toFixed(1)}%`);
        lines.push(`- **Density**: ${coverage.relationshipsPerNodeType.toFixed(2)} relationships/node type`);
        lines.push(`- **Predicate Utilization**: ${coverage.utilizationPercentage.toFixed(1)}%`);
        lines.push("");

        if (verbose && coverage.isolatedNodeTypes.length > 0) {
          lines.push("#### Isolated Node Types");
          coverage.isolatedNodeTypes.forEach((nodeType: string) => {
            lines.push(`- ${nodeType}`);
          });
          lines.push("");
        }
      });
    }

    // Gap Analysis Section
    if (result.gaps && result.gaps.length > 0) {
      lines.push("## Gap Analysis");
      lines.push("");
      lines.push(`Total Gaps Found: ${result.gaps.length}`);
      lines.push("");

      const highPriorityGaps = result.gaps.filter((g: GapCandidate) => g.priority === "high");
      if (highPriorityGaps.length > 0) {
        lines.push("### High Priority Gaps");
        highPriorityGaps.forEach((gap: GapCandidate) => {
          lines.push(`- **${gap.sourceNodeType}** → **${gap.destinationNodeType}**: ${gap.suggestedPredicate} - ${gap.reason}`);
        });
        lines.push("");
      }

      if (verbose) {
        const mediumPriorityGaps = result.gaps.filter((g: GapCandidate) => g.priority === "medium");
        if (mediumPriorityGaps.length > 0) {
          lines.push("### Medium Priority Gaps");
          mediumPriorityGaps.forEach((gap: GapCandidate) => {
            lines.push(`- **${gap.sourceNodeType}** → **${gap.destinationNodeType}**: ${gap.suggestedPredicate} - ${gap.reason}`);
          });
          lines.push("");
        }
      }
    }

    // Duplicates Section
    if (result.duplicates && result.duplicates.length > 0) {
      lines.push("## Duplicate Candidates");
      lines.push("");
      lines.push(`Total Duplicates Found: ${result.duplicates.length}`);
      lines.push("");

      result.duplicates.slice(0, verbose ? undefined : 10).forEach((dup: DuplicateCandidate) => {
        lines.push(`- ${dup.relationships[0]} ↔ ${dup.relationships[1]}`);
        lines.push(`  - Predicates: ${dup.predicates[0]} / ${dup.predicates[1]}`);
        lines.push(`  - Reason: ${dup.reason}`);
        lines.push(`  - Confidence: ${dup.confidence}`);
      });
      lines.push("");
    }

    // Balance Section
    if (result.balance && result.balance.length > 0) {
      lines.push("## Balance Analysis");
      lines.push("");

      const summary = this.summarizeBalance(result.balance);
      lines.push(`- **Structural Node Types**: ${summary.structural}`);
      lines.push(`- **Behavioral Node Types**: ${summary.behavioral}`);
      lines.push(`- **Under-connected**: ${summary.under}`);
      lines.push(`- **Well-balanced**: ${summary.balanced}`);
      lines.push(`- **Over-connected**: ${summary.over}`);
      lines.push("");
    }

    // Connectivity Section
    if (result.connectivity) {
      lines.push("## Connectivity");
      lines.push("");
      lines.push(`- **Connected Components**: ${result.connectivity.stats.connectedComponents}`);
      lines.push(`- **Largest Component**: ${result.connectivity.stats.largestComponentSize} nodes`);
      lines.push(`- **Isolated Nodes**: ${result.connectivity.stats.isolatedNodes}`);
      lines.push(`- **Average Degree**: ${result.connectivity.stats.averageDegree.toFixed(2)}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Summarize balance assessments
   */
  private summarizeBalance(balance: BalanceAssessment[]): {
    structural: number;
    behavioral: number;
    under: number;
    balanced: number;
    over: number;
  } {
    return {
      structural: balance.filter((b) => b.category === "structural").length,
      behavioral: balance.filter((b) => b.category === "behavioral").length,
      under: balance.filter((b) => b.status === "under").length,
      balanced: balance.filter((b) => b.status === "balanced").length,
      over: balance.filter((b) => b.status === "over").length,
    };
  }

  /**
   * Generate Text format report
   */
  private generateTextReport(
    result: AuditReport,
    metadata: ReportMetadata,
    verbose = false
  ): string {
    const lines: string[] = [];

    // Header
    lines.push("=".repeat(80));
    lines.push(`RELATIONSHIP AUDIT REPORT - ${metadata.phase.toUpperCase()}`);
    lines.push("=".repeat(80));
    lines.push("");
    lines.push(`Timestamp: ${metadata.timestamp}`);
    if (metadata.layer) {
      lines.push(`Layer: ${metadata.layer}`);
    }
    lines.push(`Total Node Types: ${metadata.totalNodeTypes}`);
    lines.push(`Total Relationships: ${metadata.totalRelationships}`);
    lines.push("");

    // Coverage Section
    if (result.coverage && result.coverage.length > 0) {
      lines.push("-".repeat(80));
      lines.push("COVERAGE METRICS");
      lines.push("-".repeat(80));

      result.coverage.forEach((coverage) => {
        lines.push(`Layer: ${coverage.layer}`);
        lines.push(`  Isolation Rate: ${coverage.isolationPercentage.toFixed(1)}%`);
        lines.push(`  Density: ${coverage.relationshipsPerNodeType.toFixed(2)} relationships/node type`);
        lines.push(`  Predicate Utilization: ${coverage.utilizationPercentage.toFixed(1)}%`);
        lines.push("");
      });
    }

    // Gap Analysis Section
    if (result.gaps && result.gaps.length > 0) {
      lines.push("-".repeat(80));
      lines.push("GAP ANALYSIS");
      lines.push("-".repeat(80));
      lines.push(`Total Gaps: ${result.gaps.length}`);
      lines.push("");

      const highPriorityGaps = result.gaps.filter((g: GapCandidate) => g.priority === "high");
      if (highPriorityGaps.length > 0) {
        lines.push("High Priority Gaps:");
        highPriorityGaps.forEach((gap: GapCandidate, i: number) => {
          lines.push(`  ${i + 1}. ${gap.sourceNodeType} → ${gap.destinationNodeType}`);
          lines.push(`     ${gap.suggestedPredicate}: ${gap.reason}`);
        });
        lines.push("");
      }
    }

    // Duplicates Section
    if (result.duplicates && result.duplicates.length > 0) {
      lines.push("-".repeat(80));
      lines.push("DUPLICATE CANDIDATES");
      lines.push("-".repeat(80));
      lines.push(`Total Duplicates: ${result.duplicates.length}`);
      lines.push("");

      result.duplicates.slice(0, verbose ? undefined : 10).forEach((dup: DuplicateCandidate, i: number) => {
        lines.push(`  ${i + 1}. ${dup.relationships[0]} ↔ ${dup.relationships[1]}`);
        lines.push(`     Predicates: ${dup.predicates[0]} / ${dup.predicates[1]}`);
        lines.push(`     ${dup.reason} (${dup.confidence})`);
      });
      lines.push("");
    }

    // Connectivity Section
    if (result.connectivity) {
      lines.push("-".repeat(80));
      lines.push("CONNECTIVITY");
      lines.push("-".repeat(80));
      lines.push(`Connected Components: ${result.connectivity.stats.connectedComponents}`);
      lines.push(`Largest Component: ${result.connectivity.stats.largestComponentSize} nodes`);
      lines.push(`Isolated Nodes: ${result.connectivity.stats.isolatedNodes}`);
      lines.push(`Average Degree: ${result.connectivity.stats.averageDegree.toFixed(2)}`);
      lines.push("");
    }

    lines.push("=".repeat(80));

    return lines.join("\n");
  }
}
