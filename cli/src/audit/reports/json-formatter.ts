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
      (sum, c) => sum + c.totalRelationships,
      0
    );
    const isolatedNodes = coverage.reduce(
      (sum, c) => sum + c.isolatedNodes,
      0
    );
    const totalNodes = coverage.reduce((sum, c) => sum + c.totalNodes, 0);

    return {
      totalLayers,
      totalRelationships,
      isolatedNodes,
      totalNodes,
      isolationPercentage:
        totalNodes > 0 ? (isolatedNodes / totalNodes) * 100 : 0,
    };
  }

  /**
   * Group duplicates by confidence level
   */
  private groupByConfidence(duplicates: DuplicateCandidate[]) {
    const high = duplicates.filter((d) => d.confidence >= 0.8).length;
    const medium = duplicates.filter(
      (d) => d.confidence >= 0.5 && d.confidence < 0.8
    ).length;
    const low = duplicates.filter((d) => d.confidence < 0.5).length;

    return { high, medium, low };
  }

  /**
   * Group gaps by layer
   */
  private groupGapsByLayer(gaps: GapCandidate[]) {
    const byLayer: Record<string, number> = {};
    for (const gap of gaps) {
      byLayer[gap.layer] = (byLayer[gap.layer] || 0) + 1;
    }
    return byLayer;
  }

  /**
   * Group balance assessments by status
   */
  private groupByStatus(balance: BalanceAssessment[]) {
    const underRepresented = balance.filter(
      (b) => b.status === "Under-represented"
    ).length;
    const balanced = balance.filter((b) => b.status === "Balanced").length;
    const overRepresented = balance.filter(
      (b) => b.status === "Over-represented"
    ).length;

    return { underRepresented, balanced, overRepresented };
  }
}
