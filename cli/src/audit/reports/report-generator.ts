import { promises as fs } from "fs";
import * as path from "path";
import type {
  CoverageMetrics,
  DuplicateCandidate,
  GapCandidate,
  BalanceAssessment,
  ConnectivityStats,
  LayerData,
} from "../types.js";
import { JsonFormatter } from "./json-formatter.js";
import { MarkdownFormatter } from "./markdown-formatter.js";

/**
 * Options for report generation
 */
export interface ReportOptions {
  /** Output directory for reports */
  outputDir: string;
  /** Phase identifier (before/after) */
  phase: "before" | "after";
  /** Metrics to include in report */
  metrics: {
    coverage: CoverageMetrics[];
    duplicates: DuplicateCandidate[];
    gaps: GapCandidate[];
    balance: BalanceAssessment[];
    connectivity?: ConnectivityStats;
  };
  /** Generate layer-specific reports */
  layerReports?: boolean;
  /** Model metadata */
  model?: {
    name: string;
    version: string;
  };
}

/**
 * Report generator that orchestrates JSON and Markdown report creation
 */
export class ReportGenerator {
  constructor(
    private jsonFormatter: JsonFormatter,
    private markdownFormatter: MarkdownFormatter
  ) {}

  /**
   * Generate all reports based on options
   */
  async generate(options: ReportOptions): Promise<void> {
    const { outputDir, phase, metrics, layerReports } = options;
    const phaseDir = path.join(outputDir, phase);

    // Ensure phase directory exists
    await fs.mkdir(phaseDir, { recursive: true });

    // Generate main reports in JSON and Markdown
    await this.jsonFormatter.formatCoverage(
      metrics.coverage,
      path.join(phaseDir, "coverage-report.json")
    );
    await this.markdownFormatter.formatCoverage(
      metrics.coverage,
      path.join(phaseDir, "coverage-report.md")
    );

    // Generate specialized reports (JSON only)
    await this.jsonFormatter.formatDuplicates(
      metrics.duplicates,
      path.join(phaseDir, "duplicates.json")
    );
    await this.jsonFormatter.formatGaps(
      metrics.gaps,
      path.join(phaseDir, "gaps.json")
    );
    await this.jsonFormatter.formatBalance(
      metrics.balance,
      path.join(phaseDir, "balance.json")
    );

    // Generate connectivity report if data available
    if (metrics.connectivity) {
      await this.jsonFormatter.formatConnectivity(
        metrics.connectivity,
        path.join(phaseDir, "connectivity.json")
      );
      await this.markdownFormatter.formatConnectivity(
        metrics.connectivity,
        path.join(phaseDir, "connectivity.md")
      );
    }

    // Generate layer-specific reports if requested
    if (layerReports) {
      const layerDir = path.join(phaseDir, "layer-reports");
      await fs.mkdir(layerDir, { recursive: true });

      for (const layerMetrics of metrics.coverage) {
        const layerData = this.aggregateLayerData(layerMetrics, metrics);
        await this.jsonFormatter.formatLayer(
          layerData,
          path.join(layerDir, `${layerMetrics.layer}.json`)
        );
      }
    }
  }

  /**
   * Aggregate all metrics for a specific layer
   */
  private aggregateLayerData(
    coverage: CoverageMetrics,
    metrics: ReportOptions["metrics"]
  ): LayerData {
    return {
      layer: coverage.layer,
      coverage,
      duplicates: metrics.duplicates.filter(
        (d) =>
          d.element1.startsWith(coverage.layer) ||
          d.element2.startsWith(coverage.layer)
      ),
      gaps: metrics.gaps.filter((g) => g.layer === coverage.layer),
      balance: metrics.balance.filter((b) => b.layer === coverage.layer),
    };
  }
}
