import { promises as fs } from "fs";
import type {
  CoverageMetrics,
  DuplicateCandidate,
  GapCandidate,
  BalanceAssessment,
  ConnectivityStats,
} from "../types.js";

/**
 * Markdown formatter for audit reports
 */
export class MarkdownFormatter {
  /**
   * Format coverage metrics as Markdown
   */
  async formatCoverage(
    coverage: CoverageMetrics[],
    outputPath: string
  ): Promise<void> {
    const lines: string[] = [];

    // Title and timestamp
    lines.push("# Relationship Coverage Report");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");

    // Executive summary
    lines.push("## Executive Summary");
    lines.push("");
    const totalLayers = coverage.length;
    const totalRelationships = coverage.reduce(
      (sum, c) => sum + c.totalRelationships,
      0
    );
    const isolatedNodes = coverage.reduce(
      (sum, c) => sum + c.isolatedNodes,
      0
    );
    const totalNodes = coverage.reduce((sum, c) => sum + c.totalNodes, 0);
    const isolationPct =
      totalNodes > 0 ? ((isolatedNodes / totalNodes) * 100).toFixed(2) : "0.00";

    lines.push(`- **Total Layers Analyzed**: ${totalLayers}`);
    lines.push(`- **Total Relationships**: ${totalRelationships}`);
    lines.push(`- **Total Nodes**: ${totalNodes}`);
    lines.push(`- **Isolated Nodes**: ${isolatedNodes}`);
    lines.push(`- **Overall Isolation**: ${isolationPct}%`);
    lines.push("");

    // Coverage table
    lines.push("## Coverage by Layer");
    lines.push("");
    lines.push("| Layer | Node Types | Relationships | Density | Isolation % |");
    lines.push("|:------|:----------:|:-------------:|:-------:|:-----------:|");

    for (const c of coverage) {
      const density = c.density.toFixed(2);
      const isolation =
        c.totalNodes > 0
          ? ((c.isolatedNodes / c.totalNodes) * 100).toFixed(2)
          : "0.00";
      lines.push(
        `| ${c.layer} | ${c.nodeTypeCounts.length} | ${c.totalRelationships} | ${density} | ${isolation}% |`
      );
    }
    lines.push("");

    // Predicate utilization heatmap
    lines.push("## Predicate Utilization");
    lines.push("");
    this.addPredicateHeatmap(lines, coverage);
    lines.push("");

    // Zero-relationship callouts
    const zeroRelLayers = coverage.filter((c) => c.totalRelationships === 0);
    if (zeroRelLayers.length > 0) {
      lines.push("## ⚠️ Layers with Zero Relationships");
      lines.push("");
      for (const layer of zeroRelLayers) {
        lines.push(`- **${layer.layer}**: No relationships found`);
      }
      lines.push("");
    }

    await fs.writeFile(outputPath, lines.join("\n"), "utf-8");
  }

  /**
   * Format duplicate candidates as Markdown
   */
  async formatDuplicates(
    duplicates: DuplicateCandidate[],
    outputPath: string
  ): Promise<void> {
    const lines: string[] = [];

    lines.push("# Duplicate Candidates Report");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");

    if (duplicates.length === 0) {
      lines.push("No duplicate candidates found.");
      lines.push("");
    } else {
      lines.push(`**Total Candidates**: ${duplicates.length}`);
      lines.push("");

      // Group by confidence
      const high = duplicates.filter((d) => d.confidence >= 0.8);
      const medium = duplicates.filter(
        (d) => d.confidence >= 0.5 && d.confidence < 0.8
      );
      const low = duplicates.filter((d) => d.confidence < 0.5);

      if (high.length > 0) {
        lines.push("## High Confidence (≥80%)");
        lines.push("");
        this.addDuplicateTable(lines, high);
        lines.push("");
      }

      if (medium.length > 0) {
        lines.push("## Medium Confidence (50-79%)");
        lines.push("");
        this.addDuplicateTable(lines, medium);
        lines.push("");
      }

      if (low.length > 0) {
        lines.push("## Low Confidence (<50%)");
        lines.push("");
        this.addDuplicateTable(lines, low);
        lines.push("");
      }
    }

    await fs.writeFile(outputPath, lines.join("\n"), "utf-8");
  }

  /**
   * Format gap candidates as Markdown
   */
  async formatGaps(gaps: GapCandidate[], outputPath: string): Promise<void> {
    const lines: string[] = [];

    lines.push("# Relationship Gaps Report");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");

    if (gaps.length === 0) {
      lines.push("No relationship gaps identified.");
      lines.push("");
    } else {
      lines.push(`**Total Gaps**: ${gaps.length}`);
      lines.push("");

      // Group by layer
      const byLayer: Record<string, GapCandidate[]> = {};
      for (const gap of gaps) {
        if (!byLayer[gap.layer]) {
          byLayer[gap.layer] = [];
        }
        byLayer[gap.layer].push(gap);
      }

      for (const [layer, layerGaps] of Object.entries(byLayer)) {
        lines.push(`## ${layer}`);
        lines.push("");
        lines.push("| Source Type | Target Type | Suggested Predicate | Rationale |");
        lines.push("|:------------|:------------|:--------------------|:----------|");

        for (const gap of layerGaps) {
          const predicate = gap.suggestedPredicate || "N/A";
          const rationale = gap.rationale || "No rationale provided";
          lines.push(
            `| ${gap.sourceType} | ${gap.targetType} | ${predicate} | ${rationale} |`
          );
        }
        lines.push("");
      }
    }

    await fs.writeFile(outputPath, lines.join("\n"), "utf-8");
  }

  /**
   * Format balance assessment as Markdown
   */
  async formatBalance(
    balance: BalanceAssessment[],
    outputPath: string
  ): Promise<void> {
    const lines: string[] = [];

    lines.push("# Node Type Balance Report");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");

    if (balance.length === 0) {
      lines.push("No node types to assess.");
      lines.push("");
    } else {
      // Group by status
      const underRep = balance.filter((b) => b.status === "Under-represented");
      const balanced = balance.filter((b) => b.status === "Balanced");
      const overRep = balance.filter((b) => b.status === "Over-represented");

      if (underRep.length > 0) {
        lines.push("## Under-represented Node Types");
        lines.push("");
        this.addBalanceTable(lines, underRep);
        lines.push("");
      }

      if (balanced.length > 0) {
        lines.push("## Balanced Node Types");
        lines.push("");
        this.addBalanceTable(lines, balanced);
        lines.push("");
      }

      if (overRep.length > 0) {
        lines.push("## Over-represented Node Types");
        lines.push("");
        this.addBalanceTable(lines, overRep);
        lines.push("");
      }
    }

    await fs.writeFile(outputPath, lines.join("\n"), "utf-8");
  }

  /**
   * Format connectivity stats as Markdown
   */
  async formatConnectivity(
    stats: ConnectivityStats,
    outputPath: string
  ): Promise<void> {
    const lines: string[] = [];

    lines.push("# Connectivity Analysis Report");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");

    lines.push("## Summary");
    lines.push("");
    lines.push(`- **Total Components**: ${stats.totalComponents}`);
    lines.push(`- **Isolated Components**: ${stats.isolatedComponents}`);
    lines.push(`- **Largest Component Size**: ${stats.largestComponentSize}`);
    lines.push(
      `- **Average Component Size**: ${stats.averageComponentSize.toFixed(2)}`
    );
    lines.push("");

    if (stats.stronglyConnectedComponents) {
      lines.push("## Strongly Connected Components");
      lines.push("");
      lines.push(`- **Total SCCs**: ${stats.stronglyConnectedComponents}`);
      lines.push("");
    }

    await fs.writeFile(outputPath, lines.join("\n"), "utf-8");
  }

  /**
   * Add predicate utilization heatmap
   */
  private addPredicateHeatmap(
    lines: string[],
    coverage: CoverageMetrics[]
  ): void {
    lines.push("| Layer | Predicates Used | Total Available | Utilization % |");
    lines.push("|:------|:---------------:|:---------------:|:-------------:|");

    for (const c of coverage) {
      const used = c.predicatesUsed;
      const total = c.availablePredicates;
      const utilization =
        total > 0 ? ((used / total) * 100).toFixed(2) : "0.00";
      lines.push(`| ${c.layer} | ${used} | ${total} | ${utilization}% |`);
    }
  }

  /**
   * Add duplicate candidate table
   */
  private addDuplicateTable(
    lines: string[],
    duplicates: DuplicateCandidate[]
  ): void {
    lines.push("| Element 1 | Element 2 | Confidence | Reason |");
    lines.push("|:----------|:----------|:----------:|:-------|");

    for (const dup of duplicates) {
      const confidence = (dup.confidence * 100).toFixed(0);
      const reason = dup.reason || "N/A";
      lines.push(
        `| ${dup.element1} | ${dup.element2} | ${confidence}% | ${reason} |`
      );
    }
  }

  /**
   * Add balance assessment table
   */
  private addBalanceTable(
    lines: string[],
    balance: BalanceAssessment[]
  ): void {
    lines.push(
      "| Layer | Node Type | Classification | Target Range | Current Count | Status |"
    );
    lines.push(
      "|:------|:----------|:---------------|:-------------|:-------------:|:-------|"
    );

    for (const b of balance) {
      const targetRange = b.targetRange
        ? `${b.targetRange.min}-${b.targetRange.max}`
        : "N/A";
      lines.push(
        `| ${b.layer} | ${b.nodeType} | ${b.classification} | ${targetRange} | ${b.currentCount} | ${b.status} |`
      );
    }
  }
}
