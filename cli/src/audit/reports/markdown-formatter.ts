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
      (sum, c) => sum + c.relationshipCount,
      0
    );
    const totalIsolated = coverage.reduce(
      (sum, c) => sum + c.isolatedNodeTypes.length,
      0
    );
    const totalNodeTypes = coverage.reduce(
      (sum, c) => sum + c.nodeTypeCount,
      0
    );
    const isolationPct =
      totalNodeTypes > 0
        ? ((totalIsolated / totalNodeTypes) * 100).toFixed(2)
        : "0.00";

    lines.push(`- **Total Layers Analyzed**: ${totalLayers}`);
    lines.push(`- **Total Relationships**: ${totalRelationships}`);
    lines.push(`- **Total Node Types**: ${totalNodeTypes}`);
    lines.push(`- **Isolated Node Types**: ${totalIsolated}`);
    lines.push(`- **Overall Isolation**: ${isolationPct}%`);
    lines.push("");

    // Coverage table
    lines.push("## Coverage by Layer");
    lines.push("");
    lines.push("| Layer | Node Types | Relationships | Density | Isolation % |");
    lines.push("|:------|:----------:|:-------------:|:-------:|:-----------:|");

    for (const c of coverage) {
      const density = c.relationshipsPerNodeType.toFixed(2);
      const isolation = c.isolationPercentage.toFixed(2);
      lines.push(
        `| ${c.layer} | ${c.nodeTypeCount} | ${c.relationshipCount} | ${density} | ${isolation}% |`
      );
    }
    lines.push("");

    // Predicate utilization heatmap
    lines.push("## Predicate Utilization");
    lines.push("");
    this.addPredicateHeatmap(lines, coverage);
    lines.push("");

    // Zero-relationship callouts
    const zeroRelLayers = coverage.filter((c) => c.relationshipCount === 0);
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
      const high = duplicates.filter((d) => d.confidence === "high");
      const medium = duplicates.filter((d) => d.confidence === "medium");
      const low = duplicates.filter((d) => d.confidence === "low");

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

      // Group by priority
      const high = gaps.filter((g) => g.priority === "high");
      const medium = gaps.filter((g) => g.priority === "medium");
      const low = gaps.filter((g) => g.priority === "low");

      if (high.length > 0) {
        lines.push("## High Priority Gaps");
        lines.push("");
        this.addGapTable(lines, high);
        lines.push("");
      }

      if (medium.length > 0) {
        lines.push("## Medium Priority Gaps");
        lines.push("");
        this.addGapTable(lines, medium);
        lines.push("");
      }

      if (low.length > 0) {
        lines.push("## Low Priority Gaps");
        lines.push("");
        this.addGapTable(lines, low);
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
      const underRep = balance.filter((b) => b.status === "under");
      const balanced = balance.filter((b) => b.status === "balanced");
      const overRep = balance.filter((b) => b.status === "over");

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
    lines.push(`- **Total Nodes**: ${stats.totalNodes}`);
    lines.push(`- **Total Edges**: ${stats.totalEdges}`);
    lines.push(`- **Connected Components**: ${stats.connectedComponents}`);
    lines.push(`- **Largest Component Size**: ${stats.largestComponentSize}`);
    lines.push(`- **Isolated Nodes**: ${stats.isolatedNodes}`);
    lines.push(`- **Average Degree**: ${stats.averageDegree.toFixed(2)}`);
    lines.push(
      `- **Transitive Chain Count**: ${stats.transitiveChainCount}`
    );
    lines.push("");

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
      const used = c.usedPredicates.length;
      const total = c.availablePredicates.length;
      const utilization = c.utilizationPercentage.toFixed(2);
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
    lines.push("| Relationship 1 | Relationship 2 | Confidence | Reason |");
    lines.push("|:----------|:----------|:----------:|:-------|");

    for (const dup of duplicates) {
      const confidence = dup.confidence;
      const reason = dup.reason || "N/A";
      const rel1 = dup.relationships[0];
      const rel2 = dup.relationships[1];
      lines.push(
        `| ${rel1} | ${rel2} | ${confidence} | ${reason} |`
      );
    }
  }

  /**
   * Add gap candidate table
   */
  private addGapTable(lines: string[], gaps: GapCandidate[]): void {
    lines.push(
      "| Source Type | Destination Type | Suggested Predicate | Reason | Standard Reference |"
    );
    lines.push(
      "|:------------|:-----------------|:--------------------|:-------|:-------------------|"
    );

    for (const gap of gaps) {
      const predicate = gap.suggestedPredicate || "N/A";
      const reason = gap.reason || "No reason provided";
      const stdRef = gap.standardReference || "N/A";
      lines.push(
        `| ${gap.sourceNodeType} | ${gap.destinationNodeType} | ${predicate} | ${reason} | ${stdRef} |`
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
      const targetRange = `${b.targetRange[0]}-${b.targetRange[1]}`;
      lines.push(
        `| ${b.layer} | ${b.nodeType} | ${b.category} | ${targetRange} | ${b.currentCount} | ${b.status} |`
      );
    }
  }
}
