/**
 * Formatters for differential audit analysis
 *
 * Provides text, JSON, and markdown output for before/after comparisons
 */

import ansis from "ansis";
import { DifferentialAnalysis } from "../audit/differential-analyzer.js";

export interface DiffFormatterOptions {
  format: "text" | "json" | "markdown";
  verbose: boolean;
  beforeTimestamp: string;
  afterTimestamp: string;
}

/**
 * Format differential analysis with specified format
 */
export function formatDifferentialAnalysis(
  analysis: DifferentialAnalysis,
  options: DiffFormatterOptions,
): string {
  switch (options.format) {
    case "json":
      return formatJson(analysis);
    case "markdown":
      return formatMarkdown(analysis, options);
    case "text":
    default:
      return formatText(analysis, options);
  }
}

/**
 * Format as JSON
 */
function formatJson(analysis: DifferentialAnalysis): string {
  // Convert Map to object for JSON serialization
  const coverageByLayer: Record<string, unknown> = {};
  analysis.detailed.coverageByLayer.forEach((value, key) => {
    coverageByLayer[key] = value;
  });

  const jsonOutput = {
    summary: analysis.summary,
    detailed: {
      coverageByLayer,
      gapChanges: analysis.detailed.gapChanges,
      duplicateChanges: analysis.detailed.duplicateChanges,
      balanceChanges: analysis.detailed.balanceChanges,
      connectivityChanges: analysis.detailed.connectivityChanges,
    },
  };

  return JSON.stringify(jsonOutput, null, 2);
}

/**
 * Format as text with ANSI colors
 */
function formatText(
  analysis: DifferentialAnalysis,
  options: DiffFormatterOptions,
): string {
  const lines: string[] = [];

  // Header
  lines.push(ansis.bold.cyan("\n═══════════════════════════════════════════════════════════════"));
  lines.push(ansis.bold.cyan("  AUDIT DIFFERENTIAL ANALYSIS"));
  lines.push(ansis.bold.cyan("═══════════════════════════════════════════════════════════════"));

  // Comparison period
  lines.push("");
  lines.push(ansis.bold("Comparison Period:"));
  lines.push(
    `  Before: ${ansis.dim(new Date(options.beforeTimestamp).toLocaleString())}`,
  );
  lines.push(
    `  After:  ${ansis.dim(new Date(options.afterTimestamp).toLocaleString())}`,
  );

  // Executive Summary
  lines.push("");
  lines.push(ansis.bold.yellow("EXECUTIVE SUMMARY"));
  lines.push(ansis.dim("─".repeat(60)));

  const { summary } = analysis;

  // Overall metrics
  lines.push("");
  lines.push(ansis.bold("Overall Changes:"));

  if (summary.relationshipsAdded > 0) {
    lines.push(
      `  ${ansis.green("+")} ${ansis.bold(summary.relationshipsAdded)} relationships added`,
    );
  }

  if (summary.gapsResolved > 0) {
    lines.push(
      `  ${ansis.green("✓")} ${ansis.bold(summary.gapsResolved)} gaps resolved`,
    );
  }

  if (summary.duplicatesResolved > 0) {
    lines.push(
      `  ${ansis.green("✓")} ${ansis.bold(summary.duplicatesResolved)} duplicates eliminated`,
    );
  }

  if (summary.remainingGaps > 0) {
    lines.push(
      `  ${ansis.yellow("!")} ${ansis.bold(summary.remainingGaps)} gaps remaining`,
    );
  }

  // Balance improvements
  if (summary.balanceImprovements.length > 0) {
    lines.push("");
    lines.push(ansis.bold("Balance Improvements:"));
    for (const improvement of summary.balanceImprovements) {
      lines.push(`  ${ansis.green("✓")} ${improvement}`);
    }
  }

  // Coverage changes by layer
  lines.push("");
  lines.push(ansis.bold.yellow("COVERAGE CHANGES BY LAYER"));
  lines.push(ansis.dim("─".repeat(60)));

  for (const change of summary.coverageChanges) {
    lines.push("");
    lines.push(ansis.bold(`Layer: ${change.layer}`));

    // Isolation
    const isolationDelta = change.delta.isolation;
    const isolationSymbol = isolationDelta < 0 ? ansis.green("↓") : ansis.red("↑");
    const isolationColor = isolationDelta < 0 ? ansis.green : ansis.red;
    lines.push(
      `  Isolation: ${change.before.isolation.toFixed(1)}% → ${change.after.isolation.toFixed(1)}% ` +
        `${isolationSymbol} ${isolationColor(Math.abs(isolationDelta).toFixed(1) + "%")}`,
    );

    // Density
    const densityDelta = change.delta.density;
    const densitySymbol = densityDelta > 0 ? ansis.green("↑") : ansis.red("↓");
    const densityColor = densityDelta > 0 ? ansis.green : ansis.red;
    lines.push(
      `  Density:   ${change.before.density.toFixed(2)} → ${change.after.density.toFixed(2)} ` +
        `${densitySymbol} ${densityColor(Math.abs(densityDelta).toFixed(2))}`,
    );
  }

  // Detailed analysis (verbose mode)
  if (options.verbose) {
    lines.push("");
    lines.push(ansis.bold.yellow("DETAILED ANALYSIS"));
    lines.push(ansis.dim("─".repeat(60)));

    // Gap changes
    const { gapChanges } = analysis.detailed;
    lines.push("");
    lines.push(ansis.bold("Gap Analysis:"));
    lines.push(`  Total before: ${gapChanges.before.length}`);
    lines.push(`  Total after:  ${gapChanges.after.length}`);
    lines.push(
      `  ${ansis.green("Resolved:")}    ${gapChanges.resolved.length} (${gapChanges.resolutionRate.toFixed(1)}%)`,
    );
    lines.push(`  ${ansis.yellow("New gaps:")}    ${gapChanges.newGaps.length}`);
    lines.push(`  ${ansis.dim("Persistent:")}  ${gapChanges.persistent.length}`);

    if (gapChanges.resolved.length > 0) {
      lines.push("");
      lines.push(ansis.dim("  Resolved gaps (sample):"));
      for (const gap of gapChanges.resolved.slice(0, 5)) {
        lines.push(
          ansis.dim(
            `    • ${gap.sourceNodeType} → ${gap.destinationNodeType} [${gap.suggestedPredicate}]`,
          ),
        );
      }
      if (gapChanges.resolved.length > 5) {
        lines.push(
          ansis.dim(`    ... and ${gapChanges.resolved.length - 5} more`),
        );
      }
    }

    // Duplicate changes
    const { duplicateChanges } = analysis.detailed;
    lines.push("");
    lines.push(ansis.bold("Duplicate Analysis:"));
    lines.push(`  Total before: ${duplicateChanges.before.length}`);
    lines.push(`  Total after:  ${duplicateChanges.after.length}`);
    lines.push(
      `  ${ansis.green("Resolved:")}    ${duplicateChanges.resolved.length} (${duplicateChanges.eliminationRate.toFixed(1)}%)`,
    );
    lines.push(`  ${ansis.yellow("New:")}         ${duplicateChanges.newDuplicates.length}`);
    lines.push(
      `  ${ansis.dim("Persistent:")}  ${duplicateChanges.persistent.length}`,
    );

    // Balance changes
    const { balanceChanges } = analysis.detailed;
    lines.push("");
    lines.push(ansis.bold("Balance Analysis:"));
    lines.push(`  Improvements:    ${balanceChanges.improvements.length}`);
    lines.push(`  Regressions:     ${balanceChanges.regressions.length}`);
    lines.push(`  Newly balanced:  ${balanceChanges.newlyBalanced.length}`);

    // Connectivity changes
    const { connectivityChanges } = analysis.detailed;
    lines.push("");
    lines.push(ansis.bold("Connectivity Analysis:"));
    lines.push(
      `  Components: ${connectivityChanges.before.componentCount} → ${connectivityChanges.after.componentCount} ` +
        `(${connectivityChanges.deltas.componentChange >= 0 ? "+" : ""}${connectivityChanges.deltas.componentChange})`,
    );
    lines.push(
      `  Isolated nodes: ${connectivityChanges.before.isolatedNodes} → ${connectivityChanges.after.isolatedNodes} ` +
        `(${connectivityChanges.deltas.isolationChange >= 0 ? "+" : ""}${connectivityChanges.deltas.isolationChange})`,
    );
    lines.push(
      `  Avg degree: ${connectivityChanges.before.averageDegree.toFixed(2)} → ${connectivityChanges.after.averageDegree.toFixed(2)} ` +
        `(${connectivityChanges.deltas.degreeChange >= 0 ? "+" : ""}${connectivityChanges.deltas.degreeChange.toFixed(2)})`,
    );
  }

  lines.push("");
  lines.push(ansis.dim("─".repeat(60)));

  return lines.join("\n");
}

/**
 * Format as markdown
 */
function formatMarkdown(
  analysis: DifferentialAnalysis,
  options: DiffFormatterOptions,
): string {
  const lines: string[] = [];

  // Header
  lines.push("# Audit Differential Analysis");
  lines.push("");
  lines.push("## Comparison Period");
  lines.push("");
  lines.push(
    `- **Before:** ${new Date(options.beforeTimestamp).toLocaleString()}`,
  );
  lines.push(
    `- **After:** ${new Date(options.afterTimestamp).toLocaleString()}`,
  );

  // Executive Summary
  lines.push("");
  lines.push("## Executive Summary");
  lines.push("");

  const { summary } = analysis;

  lines.push("### Overall Changes");
  lines.push("");
  lines.push(`- ✅ **${summary.relationshipsAdded}** relationships added`);
  lines.push(`- ✅ **${summary.gapsResolved}** gaps resolved`);
  lines.push(`- ✅ **${summary.duplicatesResolved}** duplicates eliminated`);
  lines.push(`- ⚠️  **${summary.remainingGaps}** gaps remaining`);

  // Balance improvements
  if (summary.balanceImprovements.length > 0) {
    lines.push("");
    lines.push("### Balance Improvements");
    lines.push("");
    for (const improvement of summary.balanceImprovements) {
      lines.push(`- ${improvement}`);
    }
  }

  // Coverage changes
  lines.push("");
  lines.push("## Coverage Changes by Layer");
  lines.push("");
  lines.push(
    "| Layer | Isolation Before | Isolation After | Δ | Density Before | Density After | Δ |",
  );
  lines.push("|-------|------------------|-----------------|---|----------------|---------------|---|");

  for (const change of summary.coverageChanges) {
    const isolationDelta =
      change.delta.isolation >= 0
        ? `+${change.delta.isolation.toFixed(1)}%`
        : `${change.delta.isolation.toFixed(1)}%`;
    const densityDelta =
      change.delta.density >= 0
        ? `+${change.delta.density.toFixed(2)}`
        : `${change.delta.density.toFixed(2)}`;

    lines.push(
      `| ${change.layer} | ${change.before.isolation.toFixed(1)}% | ${change.after.isolation.toFixed(1)}% | ${isolationDelta} | ` +
        `${change.before.density.toFixed(2)} | ${change.after.density.toFixed(2)} | ${densityDelta} |`,
    );
  }

  // Detailed analysis
  if (options.verbose) {
    lines.push("");
    lines.push("## Detailed Analysis");

    // Gap changes
    const { gapChanges } = analysis.detailed;
    lines.push("");
    lines.push("### Gap Analysis");
    lines.push("");
    lines.push(`- **Total before:** ${gapChanges.before.length}`);
    lines.push(`- **Total after:** ${gapChanges.after.length}`);
    lines.push(
      `- **Resolved:** ${gapChanges.resolved.length} (${gapChanges.resolutionRate.toFixed(1)}%)`,
    );
    lines.push(`- **New gaps:** ${gapChanges.newGaps.length}`);
    lines.push(`- **Persistent:** ${gapChanges.persistent.length}`);

    // Duplicate changes
    const { duplicateChanges } = analysis.detailed;
    lines.push("");
    lines.push("### Duplicate Analysis");
    lines.push("");
    lines.push(`- **Total before:** ${duplicateChanges.before.length}`);
    lines.push(`- **Total after:** ${duplicateChanges.after.length}`);
    lines.push(
      `- **Resolved:** ${duplicateChanges.resolved.length} (${duplicateChanges.eliminationRate.toFixed(1)}%)`,
    );
    lines.push(`- **New duplicates:** ${duplicateChanges.newDuplicates.length}`);
    lines.push(`- **Persistent:** ${duplicateChanges.persistent.length}`);

    // Balance changes
    const { balanceChanges } = analysis.detailed;
    lines.push("");
    lines.push("### Balance Analysis");
    lines.push("");
    lines.push(`- **Improvements:** ${balanceChanges.improvements.length}`);
    lines.push(`- **Regressions:** ${balanceChanges.regressions.length}`);
    lines.push(`- **Newly balanced:** ${balanceChanges.newlyBalanced.length}`);

    // Connectivity changes
    const { connectivityChanges } = analysis.detailed;
    lines.push("");
    lines.push("### Connectivity Analysis");
    lines.push("");
    lines.push(
      `- **Components:** ${connectivityChanges.before.componentCount} → ${connectivityChanges.after.componentCount} ` +
        `(${connectivityChanges.deltas.componentChange >= 0 ? "+" : ""}${connectivityChanges.deltas.componentChange})`,
    );
    lines.push(
      `- **Isolated nodes:** ${connectivityChanges.before.isolatedNodes} → ${connectivityChanges.after.isolatedNodes} ` +
        `(${connectivityChanges.deltas.isolationChange >= 0 ? "+" : ""}${connectivityChanges.deltas.isolationChange})`,
    );
    lines.push(
      `- **Average degree:** ${connectivityChanges.before.averageDegree.toFixed(2)} → ${connectivityChanges.after.averageDegree.toFixed(2)} ` +
        `(${connectivityChanges.deltas.degreeChange >= 0 ? "+" : ""}${connectivityChanges.deltas.degreeChange.toFixed(2)})`,
    );
  }

  lines.push("");
  return lines.join("\n");
}
