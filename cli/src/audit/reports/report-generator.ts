/**
 * DEPRECATED: This module is superseded by cli/src/export/audit-formatters.ts
 *
 * This code was an earlier implementation of audit report formatting.
 * It is currently unused in production code but retained for potential
 * future refactoring or specialized reporting needs.
 *
 * Active report formatting is handled by:
 * - cli/src/export/audit-formatters.ts (standard audit reports)
 * - cli/src/export/diff-formatters.ts (differential analysis)
 */

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

    try {
      // Ensure phase directory exists
      await fs.mkdir(phaseDir, { recursive: true });

      // Generate main reports in JSON and Markdown
      try {
        await this.jsonFormatter.formatCoverage(
          metrics.coverage,
          path.join(phaseDir, "coverage-report.json")
        );
      } catch (error) {
        throw new Error(
          `Failed to write coverage JSON report: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      try {
        await this.markdownFormatter.formatCoverage(
          metrics.coverage,
          path.join(phaseDir, "coverage-report.md")
        );
      } catch (error) {
        throw new Error(
          `Failed to write coverage Markdown report: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Generate specialized reports (JSON only)
      try {
        await this.jsonFormatter.formatDuplicates(
          metrics.duplicates,
          path.join(phaseDir, "duplicates.json")
        );
      } catch (error) {
        throw new Error(
          `Failed to write duplicates report: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      try {
        await this.jsonFormatter.formatGaps(
          metrics.gaps,
          path.join(phaseDir, "gaps.json")
        );
      } catch (error) {
        throw new Error(
          `Failed to write gaps report: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      try {
        await this.jsonFormatter.formatBalance(
          metrics.balance,
          path.join(phaseDir, "balance.json")
        );
      } catch (error) {
        throw new Error(
          `Failed to write balance report: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Generate connectivity report if data available
      if (metrics.connectivity) {
        try {
          await this.jsonFormatter.formatConnectivity(
            metrics.connectivity,
            path.join(phaseDir, "connectivity.json")
          );
        } catch (error) {
          throw new Error(
            `Failed to write connectivity JSON report: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        try {
          await this.markdownFormatter.formatConnectivity(
            metrics.connectivity,
            path.join(phaseDir, "connectivity.md")
          );
        } catch (error) {
          throw new Error(
            `Failed to write connectivity Markdown report: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Generate layer-specific reports if requested
      if (layerReports) {
        const layerDir = path.join(phaseDir, "layer-reports");
        try {
          await fs.mkdir(layerDir, { recursive: true });
        } catch (error) {
          throw new Error(
            `Failed to create layer-reports directory: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        for (const layerMetrics of metrics.coverage) {
          try {
            const layerData = this.aggregateLayerData(layerMetrics, metrics);
            await this.jsonFormatter.formatLayer(
              layerData,
              path.join(layerDir, `${layerMetrics.layer}.json`)
            );
          } catch (error) {
            throw new Error(
              `Failed to write layer report for '${layerMetrics.layer}': ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
    } catch (error) {
      // If any write fails, attempt cleanup (best effort)
      try {
        await fs.rm(phaseDir, { recursive: true, force: true });
      } catch (cleanupError) {
        // Ignore cleanup errors, throw original error
      }
      throw error;
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
          d.relationships[0].startsWith(coverage.layer) ||
          d.relationships[1].startsWith(coverage.layer)
      ),
      gaps: metrics.gaps.filter(
        (g) =>
          g.sourceNodeType.startsWith(coverage.layer) ||
          g.destinationNodeType.startsWith(coverage.layer)
      ),
      balance: metrics.balance.filter((b) => b.layer === coverage.layer),
    };
  }
}
