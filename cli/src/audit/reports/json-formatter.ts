import { promises as fs } from "fs";
import type {
  CoverageMetrics,
  DuplicateCandidate,
  GapCandidate,
  BalanceAssessment,
  ConnectivityStats,
  LayerData,
} from "../types.js";

/**
 * JSON formatter for audit reports
 */
export class JsonFormatter {
  /**
   * Format coverage metrics as JSON
   */
  async formatCoverage(
    coverage: CoverageMetrics[],
    outputPath: string
  ): Promise<void> {
    const data = {
      timestamp: new Date().toISOString(),
      coverage,
      summary: this.summarizeCoverage(coverage),
    };

    await this.writeJson(data, outputPath);
  }

  /**
   * Format duplicate candidates as JSON
   */
  async formatDuplicates(
    duplicates: DuplicateCandidate[],
    outputPath: string
  ): Promise<void> {
    const data = {
      timestamp: new Date().toISOString(),
      duplicates,
      summary: {
        total: duplicates.length,
        byConfidence: this.groupByConfidence(duplicates),
      },
    };

    await this.writeJson(data, outputPath);
  }

  /**
   * Format gap candidates as JSON
   */
  async formatGaps(gaps: GapCandidate[], outputPath: string): Promise<void> {
    const data = {
      timestamp: new Date().toISOString(),
      gaps,
      summary: {
        total: gaps.length,
        byLayer: this.groupGapsByLayer(gaps),
      },
    };

    await this.writeJson(data, outputPath);
  }

  /**
   * Format balance assessment as JSON
   */
  async formatBalance(
    balance: BalanceAssessment[],
    outputPath: string
  ): Promise<void> {
    const data = {
      timestamp: new Date().toISOString(),
      balance,
      summary: {
        total: balance.length,
        byStatus: this.groupByStatus(balance),
      },
    };

    await this.writeJson(data, outputPath);
  }

  /**
   * Format connectivity stats as JSON
   */
  async formatConnectivity(
    stats: ConnectivityStats,
    outputPath: string
  ): Promise<void> {
    const data = {
      timestamp: new Date().toISOString(),
      connectivity: stats,
    };

    await this.writeJson(data, outputPath);
  }

  /**
   * Format layer-specific aggregated data as JSON
   */
  async formatLayer(layerData: LayerData, outputPath: string): Promise<void> {
    const data = {
      timestamp: new Date().toISOString(),
      layer: layerData.layer,
      coverage: layerData.coverage,
      duplicates: layerData.duplicates,
      gaps: layerData.gaps,
      balance: layerData.balance,
    };

    await this.writeJson(data, outputPath);
  }

  /**
   * Write JSON data to file
   */
  private async writeJson(data: unknown, outputPath: string): Promise<void> {
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(outputPath, json, "utf-8");
  }

  /**
   * Summarize coverage metrics
   */
  private summarizeCoverage(coverage: CoverageMetrics[]) {
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

    return {
      totalLayers,
      totalRelationships,
      isolatedNodeTypes: totalIsolated,
      totalNodeTypes,
      isolationPercentage:
        totalNodeTypes > 0 ? (totalIsolated / totalNodeTypes) * 100 : 0,
    };
  }

  /**
   * Group duplicates by confidence level
   */
  private groupByConfidence(duplicates: DuplicateCandidate[]) {
    const high = duplicates.filter((d) => d.confidence === "high").length;
    const medium = duplicates.filter((d) => d.confidence === "medium").length;
    const low = duplicates.filter((d) => d.confidence === "low").length;

    return { high, medium, low };
  }

  /**
   * Group gaps by priority
   */
  private groupGapsByLayer(gaps: GapCandidate[]) {
    const byPriority: Record<string, number> = {};
    for (const gap of gaps) {
      byPriority[gap.priority] = (byPriority[gap.priority] || 0) + 1;
    }
    return byPriority;
  }

  /**
   * Group balance assessments by status
   */
  private groupByStatus(balance: BalanceAssessment[]) {
    const under = balance.filter((b) => b.status === "under").length;
    const balanced = balance.filter((b) => b.status === "balanced").length;
    const over = balance.filter((b) => b.status === "over").length;

    return { under, balanced, over };
  }
}
