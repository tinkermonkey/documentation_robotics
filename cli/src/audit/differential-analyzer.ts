/**
 * Differential analysis for before/after audit comparison
 *
 * Analyzes changes between two audit snapshots to identify
 * improvements, regressions, and trends in relationship quality.
 */

import {
  AuditReport,
  SummaryReport,
  CoverageMetrics,
  GapCandidate,
  DuplicateCandidate,
  BalanceAssessment,
} from "./types.js";

/**
 * Detailed differential analysis result
 */
export interface DifferentialAnalysis {
  summary: SummaryReport;
  detailed: {
    coverageByLayer: Map<string, CoverageComparison>;
    gapChanges: GapChanges;
    duplicateChanges: DuplicateChanges;
    balanceChanges: BalanceChanges;
    connectivityChanges: ConnectivityComparison;
  };
}

/**
 * Coverage comparison for a single layer
 */
export interface CoverageComparison {
  layer: string;
  before: CoverageMetrics;
  after: CoverageMetrics;
  deltas: {
    isolationChange: number; // Negative = improvement
    densityChange: number; // Positive = improvement
    utilizationChange: number; // Positive = improvement
    nodeTypeCountChange: number;
    relationshipCountChange: number;
  };
  improvements: string[];
  regressions: string[];
}

/**
 * Gap analysis changes
 */
export interface GapChanges {
  before: GapCandidate[];
  after: GapCandidate[];
  resolved: GapCandidate[]; // Gaps that disappeared
  newGaps: GapCandidate[]; // New gaps introduced
  persistent: GapCandidate[]; // Gaps still present
  resolutionRate: number; // Percentage of gaps resolved
}

/**
 * Duplicate analysis changes
 */
export interface DuplicateChanges {
  before: DuplicateCandidate[];
  after: DuplicateCandidate[];
  resolved: DuplicateCandidate[]; // Duplicates eliminated
  newDuplicates: DuplicateCandidate[]; // New duplicates introduced
  persistent: DuplicateCandidate[]; // Still duplicated
  eliminationRate: number; // Percentage eliminated
}

/**
 * Balance assessment changes
 */
export interface BalanceChanges {
  before: BalanceAssessment[];
  after: BalanceAssessment[];
  improvements: BalanceAssessment[]; // Moved toward balanced
  regressions: BalanceAssessment[]; // Moved away from balanced
  newlyBalanced: BalanceAssessment[]; // Achieved balanced status
}

/**
 * Connectivity comparison
 */
export interface ConnectivityComparison {
  before: {
    componentCount: number;
    isolatedNodes: number;
    averageDegree: number;
  };
  after: {
    componentCount: number;
    isolatedNodes: number;
    averageDegree: number;
  };
  deltas: {
    componentChange: number; // Negative = more connected
    isolationChange: number; // Negative = improvement
    degreeChange: number; // Positive = more connected
  };
}

/**
 * Analyzer for comparing audit snapshots
 */
export class DifferentialAnalyzer {
  /**
   * Compare two audit reports
   */
  analyze(before: AuditReport, after: AuditReport): DifferentialAnalysis {
    const coverageComparison = this.analyzeCoverage(
      before.coverage,
      after.coverage,
    );
    const gapChanges = this.analyzeGaps(before.gaps, after.gaps);
    const duplicateChanges = this.analyzeDuplicates(
      before.duplicates,
      after.duplicates,
    );
    const balanceChanges = this.analyzeBalance(before.balance, after.balance);
    const connectivityChanges = this.analyzeConnectivity(
      before.connectivity,
      after.connectivity,
    );

    const summary = this.generateSummary(
      after.timestamp,
      coverageComparison,
      gapChanges,
      duplicateChanges,
      balanceChanges,
    );

    return {
      summary,
      detailed: {
        coverageByLayer: coverageComparison,
        gapChanges,
        duplicateChanges,
        balanceChanges,
        connectivityChanges,
      },
    };
  }

  /**
   * Analyze coverage changes across layers
   */
  private analyzeCoverage(
    before: CoverageMetrics[],
    after: CoverageMetrics[],
  ): Map<string, CoverageComparison> {
    const comparison = new Map<string, CoverageComparison>();

    // Create lookup map for before state
    const beforeMap = new Map(before.map((c) => [c.layer, c]));

    for (const afterCoverage of after) {
      const beforeCoverage = beforeMap.get(afterCoverage.layer);
      if (!beforeCoverage) {
        // New layer in after state - track for visibility
        console.log(
          `Note: Layer "${afterCoverage.layer}" appears only in after state, skipping comparison`,
        );
        continue;
      }

      const deltas = {
        isolationChange:
          afterCoverage.isolationPercentage -
          beforeCoverage.isolationPercentage,
        densityChange:
          afterCoverage.relationshipsPerNodeType -
          beforeCoverage.relationshipsPerNodeType,
        utilizationChange:
          afterCoverage.utilizationPercentage -
          beforeCoverage.utilizationPercentage,
        nodeTypeCountChange:
          afterCoverage.nodeTypeCount - beforeCoverage.nodeTypeCount,
        relationshipCountChange:
          afterCoverage.relationshipCount - beforeCoverage.relationshipCount,
      };

      const improvements: string[] = [];
      const regressions: string[] = [];

      // Analyze changes
      if (deltas.isolationChange < -5) {
        improvements.push(
          `Isolation reduced by ${Math.abs(deltas.isolationChange).toFixed(1)}%`,
        );
      } else if (deltas.isolationChange > 5) {
        regressions.push(
          `Isolation increased by ${deltas.isolationChange.toFixed(1)}%`,
        );
      }

      if (deltas.densityChange > 0.5) {
        improvements.push(
          `Density increased by ${deltas.densityChange.toFixed(2)}`,
        );
      } else if (deltas.densityChange < -0.5) {
        regressions.push(
          `Density decreased by ${Math.abs(deltas.densityChange).toFixed(2)}`,
        );
      }

      if (deltas.utilizationChange > 5) {
        improvements.push(
          `Predicate utilization increased by ${deltas.utilizationChange.toFixed(1)}%`,
        );
      } else if (deltas.utilizationChange < -5) {
        regressions.push(
          `Predicate utilization decreased by ${Math.abs(deltas.utilizationChange).toFixed(1)}%`,
        );
      }

      comparison.set(afterCoverage.layer, {
        layer: afterCoverage.layer,
        before: beforeCoverage,
        after: afterCoverage,
        deltas,
        improvements,
        regressions,
      });
    }

    return comparison;
  }

  /**
   * Analyze gap changes
   */
  private analyzeGaps(
    before: GapCandidate[],
    after: GapCandidate[],
  ): GapChanges {
    // Create gap signatures for comparison
    const beforeSigs = new Set(
      before.map((g) => this.gapSignature(g)),
    );
    const afterSigs = new Set(after.map((g) => this.gapSignature(g)));

    const resolved = before.filter(
      (g) => !afterSigs.has(this.gapSignature(g)),
    );
    const newGaps = after.filter(
      (g) => !beforeSigs.has(this.gapSignature(g)),
    );
    const persistent = after.filter((g) =>
      beforeSigs.has(this.gapSignature(g)),
    );

    const resolutionRate =
      before.length > 0 ? (resolved.length / before.length) * 100 : 0;

    return {
      before,
      after,
      resolved,
      newGaps,
      persistent,
      resolutionRate,
    };
  }

  /**
   * Generate gap signature for comparison
   */
  private gapSignature(gap: GapCandidate): string {
    return `${gap.sourceNodeType}:${gap.destinationNodeType}:${gap.suggestedPredicate}`;
  }

  /**
   * Analyze duplicate changes
   */
  private analyzeDuplicates(
    before: DuplicateCandidate[],
    after: DuplicateCandidate[],
  ): DuplicateChanges {
    const beforeSigs = new Set(
      before.map((d) => this.duplicateSignature(d)),
    );
    const afterSigs = new Set(
      after.map((d) => this.duplicateSignature(d)),
    );

    const resolved = before.filter(
      (d) => !afterSigs.has(this.duplicateSignature(d)),
    );
    const newDuplicates = after.filter(
      (d) => !beforeSigs.has(this.duplicateSignature(d)),
    );
    const persistent = after.filter((d) =>
      beforeSigs.has(this.duplicateSignature(d)),
    );

    const eliminationRate =
      before.length > 0 ? (resolved.length / before.length) * 100 : 0;

    return {
      before,
      after,
      resolved,
      newDuplicates,
      persistent,
      eliminationRate,
    };
  }

  /**
   * Generate duplicate signature for comparison
   */
  private duplicateSignature(dup: DuplicateCandidate): string {
    // Sort relationship IDs for consistent comparison
    const sorted = [...dup.relationships].sort();
    return `${sorted[0]}:${sorted[1]}`;
  }

  /**
   * Analyze balance changes
   */
  private analyzeBalance(
    before: BalanceAssessment[],
    after: BalanceAssessment[],
  ): BalanceChanges {
    const beforeMap = new Map(before.map((b) => [b.nodeType, b]));

    const improvements: BalanceAssessment[] = [];
    const regressions: BalanceAssessment[] = [];
    const newlyBalanced: BalanceAssessment[] = [];

    for (const afterAssessment of after) {
      const beforeAssessment = beforeMap.get(afterAssessment.nodeType);
      if (!beforeAssessment) {
        continue;
      }

      // Check if moved toward balanced
      const beforeDistance = this.distanceFromBalance(beforeAssessment);
      const afterDistance = this.distanceFromBalance(afterAssessment);

      if (afterDistance < beforeDistance) {
        improvements.push(afterAssessment);
      } else if (afterDistance > beforeDistance) {
        regressions.push(afterAssessment);
      }

      // Check if newly balanced
      if (
        beforeAssessment.status !== "balanced" &&
        afterAssessment.status === "balanced"
      ) {
        newlyBalanced.push(afterAssessment);
      }
    }

    return {
      before,
      after,
      improvements,
      regressions,
      newlyBalanced,
    };
  }

  /**
   * Calculate distance from balanced state
   */
  private distanceFromBalance(assessment: BalanceAssessment): number {
    const [min, max] = assessment.targetRange;
    const target = (min + max) / 2;
    return Math.abs(assessment.currentCount - target);
  }

  /**
   * Analyze connectivity changes
   */
  private analyzeConnectivity(
    before: AuditReport["connectivity"],
    after: AuditReport["connectivity"],
  ): ConnectivityComparison {
    const beforeStats = {
      componentCount: before.components.length,
      isolatedNodes: before.stats.isolatedNodes,
      averageDegree: before.stats.averageDegree,
    };

    const afterStats = {
      componentCount: after.components.length,
      isolatedNodes: after.stats.isolatedNodes,
      averageDegree: after.stats.averageDegree,
    };

    return {
      before: beforeStats,
      after: afterStats,
      deltas: {
        componentChange: afterStats.componentCount - beforeStats.componentCount,
        isolationChange: afterStats.isolatedNodes - beforeStats.isolatedNodes,
        degreeChange: afterStats.averageDegree - beforeStats.averageDegree,
      },
    };
  }

  /**
   * Generate summary report
   */
  private generateSummary(
    timestamp: string,
    coverageComparison: Map<string, CoverageComparison>,
    gapChanges: GapChanges,
    duplicateChanges: DuplicateChanges,
    balanceChanges: BalanceChanges,
  ): SummaryReport {
    const coverageChanges = Array.from(coverageComparison.values()).map(
      (comp) => ({
        layer: comp.layer,
        before: {
          isolation: comp.before.isolationPercentage,
          density: comp.before.relationshipsPerNodeType,
        },
        after: {
          isolation: comp.after.isolationPercentage,
          density: comp.after.relationshipsPerNodeType,
        },
        delta: {
          isolation: comp.deltas.isolationChange,
          density: comp.deltas.densityChange,
        },
      }),
    );

    // Calculate total relationships added
    const relationshipsAdded = Array.from(coverageComparison.values()).reduce(
      (sum, comp) => sum + comp.deltas.relationshipCountChange,
      0,
    );

    // Generate balance improvement descriptions
    const balanceImprovements = balanceChanges.newlyBalanced.map(
      (b) => `${b.nodeType} achieved balanced density (${b.currentCount} relationships)`,
    );

    return {
      timestamp,
      coverageChanges,
      relationshipsAdded: Math.max(0, relationshipsAdded), // Only count additions
      gapsResolved: gapChanges.resolved.length,
      remainingGaps: gapChanges.after.length,
      duplicatesResolved: duplicateChanges.resolved.length,
      balanceImprovements,
    };
  }
}
