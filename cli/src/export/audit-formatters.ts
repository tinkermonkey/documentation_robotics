/**
 * Audit report formatters
 * Supports JSON and Markdown output formats for relationship audit reports
 */

import ansis from "ansis";
import { AuditReport, CoverageMetrics, DuplicateCandidate, GapCandidate, BalanceAssessment } from "../audit/types.js";
import { escapeMarkdown } from "./markdown-utils.js";

/**
 * Format date consistently (ISO 8601 without timezone, space separator)
 */
function formatDate(timestamp: string): string {
  return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19);
}

export type AuditReportFormat = "text" | "json" | "markdown";

export interface AuditFormatterOptions {
  format: AuditReportFormat;
  verbose?: boolean;
}

/**
 * Format audit report for output
 */
export function formatAuditReport(report: AuditReport, options: AuditFormatterOptions): string {
  switch (options.format) {
    case "json":
      return formatAuditJSON(report);
    case "markdown":
      return formatAuditMarkdown(report, options);
    case "text":
    default:
      return formatAuditText(report, options);
  }
}

/**
 * Format as JSON
 */
function formatAuditJSON(report: AuditReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

/**
 * Format as plain text (default)
 */
function formatAuditText(report: AuditReport, options: AuditFormatterOptions): string {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(ansis.bold(`🔍 Relationship Audit Report: ${ansis.cyan(report.model.name)}`));
  lines.push(ansis.dim("=".repeat(80)));
  lines.push("");
  lines.push(`Generated: ${formatDate(report.timestamp)}`);
  lines.push(`Version: ${report.model.version}`);
  lines.push("");

  // Coverage Summary
  formatCoverageTextSummary(lines, report.coverage);
  lines.push("");

  // Duplicates Summary
  formatDuplicatesTextSummary(lines, report.duplicates);
  lines.push("");

  // Gaps Summary
  formatGapsTextSummary(lines, report.gaps);
  lines.push("");

  // Balance Summary
  formatBalanceTextSummary(lines, report.balance);
  lines.push("");

  // Connectivity Summary
  formatConnectivityTextSummary(lines, report.connectivity);
  lines.push("");

  // Detailed sections (verbose mode)
  if (options.verbose) {
    formatCoverageTextDetailed(lines, report.coverage);
    lines.push("");
    formatDuplicatesTextDetailed(lines, report.duplicates);
    lines.push("");
    formatGapsTextDetailed(lines, report.gaps);
    lines.push("");
    formatBalanceTextDetailed(lines, report.balance);
    lines.push("");
    formatConnectivityTextDetailed(lines, report.connectivity);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format as Markdown
 */
function formatAuditMarkdown(report: AuditReport, _options: AuditFormatterOptions): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Relationship Audit Report: ${escapeMarkdown(report.model.name)}`);
  lines.push("");
  lines.push(`**Generated:** ${formatDate(report.timestamp)}`);
  lines.push(`**Version:** ${escapeMarkdown(report.model.version)}`);
  lines.push("");

  // Table of Contents
  lines.push("## Contents");
  lines.push("- [Executive Summary](#executive-summary)");
  lines.push("- [Coverage Analysis](#coverage-analysis)");
  lines.push("- [Duplicate Detection](#duplicate-detection)");
  lines.push("- [Gap Analysis](#gap-analysis)");
  lines.push("- [Balance Assessment](#balance-assessment)");
  lines.push("- [Connectivity Analysis](#connectivity-analysis)");
  lines.push("");

  // Executive Summary
  formatExecutiveSummaryMarkdown(lines, report);
  lines.push("");

  // Coverage Analysis
  formatCoverageMarkdown(lines, report.coverage);
  lines.push("");

  // Duplicate Detection
  formatDuplicatesMarkdown(lines, report.duplicates);
  lines.push("");

  // Gap Analysis
  formatGapsMarkdown(lines, report.gaps);
  lines.push("");

  // Balance Assessment
  formatBalanceMarkdown(lines, report.balance);
  lines.push("");

  // Connectivity Analysis
  formatConnectivityMarkdown(lines, report.connectivity);
  lines.push("");

  return lines.join("\n");
}

/**
 * Format executive summary for markdown
 */
function formatExecutiveSummaryMarkdown(lines: string[], report: AuditReport): void {
  lines.push("## Executive Summary");
  lines.push("");

  const totalNodeTypes = report.coverage.reduce((sum, c) => sum + c.nodeTypeCount, 0);
  const totalRelationships = report.coverage.reduce((sum, c) => sum + c.relationshipCount, 0);
  const totalIsolated = report.coverage.reduce((sum, c) => sum + c.isolatedNodeTypes.length, 0);
  const avgUtilization = report.coverage.length > 0
    ? report.coverage.reduce((sum, c) => sum + c.utilizationPercentage, 0) / report.coverage.length
    : 0;

  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Total Node Types | ${totalNodeTypes} |`);
  lines.push(`| Total Relationships | ${totalRelationships} |`);
  lines.push(`| Isolated Node Types | ${totalIsolated} (${totalNodeTypes > 0 ? ((totalIsolated / totalNodeTypes) * 100).toFixed(1) : "0.0"}%) |`);
  lines.push(`| Average Predicate Utilization | ${avgUtilization.toFixed(1)}% |`);
  lines.push(`| Duplicate Candidates | ${report.duplicates.length} |`);
  lines.push(`| Gap Candidates | ${report.gaps.length} |`);
  lines.push(`| Balance Issues | ${report.balance.filter(b => b.status !== "balanced").length} |`);
  lines.push(`| Connected Components | ${report.connectivity.stats.connectedComponents} |`);
  lines.push("");
}

/**
 * Format coverage summary for text output
 */
function formatCoverageTextSummary(lines: string[], coverage: CoverageMetrics[]): void {
  lines.push(ansis.bold("Coverage Analysis Summary:"));

  const totalNodeTypes = coverage.reduce((sum, c) => sum + c.nodeTypeCount, 0);
  const totalRelationships = coverage.reduce((sum, c) => sum + c.relationshipCount, 0);
  const totalIsolated = coverage.reduce((sum, c) => sum + c.isolatedNodeTypes.length, 0);
  const avgUtilization = coverage.length > 0
    ? coverage.reduce((sum, c) => sum + c.utilizationPercentage, 0) / coverage.length
    : 0;

  lines.push(`  Total Node Types:          ${totalNodeTypes}`);
  lines.push(`  Total Relationships:       ${totalRelationships}`);
  lines.push(`  Isolated Node Types:       ${totalIsolated} (${totalNodeTypes > 0 ? ((totalIsolated / totalNodeTypes) * 100).toFixed(1) : "0.0"}%)`);
  lines.push(`  Avg Predicate Utilization: ${avgUtilization.toFixed(1)}%`);

  // Highlight layers with zero relationships
  const zeroLayers = coverage.filter(c => c.relationshipCount === 0);
  if (zeroLayers.length > 0) {
    lines.push("");
    lines.push(ansis.yellow(`  ⚠️  Layers with zero relationships: ${zeroLayers.map(l => l.layer).join(", ")}`));
  }
}

/**
 * Format coverage detailed for text output
 */
function formatCoverageTextDetailed(lines: string[], coverage: CoverageMetrics[]): void {
  lines.push(ansis.bold("Coverage Analysis (Detailed):"));
  lines.push("");

  for (const layer of coverage) {
    lines.push(ansis.bold(`  ${layer.layer}:`));
    lines.push(`    Node Types:          ${layer.nodeTypeCount}`);
    lines.push(`    Relationships:       ${layer.relationshipCount}`);
    lines.push(`    Isolated Types:      ${layer.isolatedNodeTypes.length} (${layer.isolationPercentage.toFixed(1)}%)`);
    lines.push(`    Predicate Usage:     ${layer.usedPredicates.length}/${layer.availablePredicates.length} (${layer.utilizationPercentage.toFixed(1)}%)`);
    lines.push(`    Density:             ${layer.relationshipsPerNodeType.toFixed(2)} rel/type`);

    if (layer.standardAlignment) {
      lines.push(`    Standard Alignment:  ${layer.standardAlignment.standard}`);
      lines.push(`      Expected:          ${layer.standardAlignment.expectedRelationships}`);
      lines.push(`      Missing:           ${layer.standardAlignment.missingFromStandard.length}`);
    }

    if (layer.isolatedNodeTypes.length > 0 && layer.isolatedNodeTypes.length <= 10) {
      lines.push(`    Isolated:            ${layer.isolatedNodeTypes.join(", ")}`);
    }
    lines.push("");
  }
}

/**
 * Format coverage for markdown
 */
function formatCoverageMarkdown(lines: string[], coverage: CoverageMetrics[]): void {
  lines.push("## Coverage Analysis");
  lines.push("");
  lines.push("### By Layer");
  lines.push("");
  lines.push("| Layer | Node Types | Relationships | Isolated | Predicate Usage | Density |");
  lines.push("|-------|------------|---------------|----------|-----------------|---------|");

  for (const layer of coverage) {
    const isolated = `${layer.isolatedNodeTypes.length} (${layer.isolationPercentage.toFixed(0)}%)`;
    const predicates = `${layer.usedPredicates.length}/${layer.availablePredicates.length} (${layer.utilizationPercentage.toFixed(0)}%)`;
    const density = layer.relationshipsPerNodeType.toFixed(2);

    lines.push(`| ${escapeMarkdown(layer.layer)} | ${layer.nodeTypeCount} | ${layer.relationshipCount} | ${isolated} | ${predicates} | ${density} |`);
  }
  lines.push("");

  // Standard alignment details
  const alignedLayers = coverage.filter(c => c.standardAlignment);
  if (alignedLayers.length > 0) {
    lines.push("### Standard Alignment");
    lines.push("");
    lines.push("| Layer | Standard | Expected | Missing |");
    lines.push("|-------|----------|----------|---------|");
    for (const layer of alignedLayers) {
      if (layer.standardAlignment) {
        lines.push(`| ${escapeMarkdown(layer.layer)} | ${escapeMarkdown(layer.standardAlignment.standard)} | ${layer.standardAlignment.expectedRelationships} | ${layer.standardAlignment.missingFromStandard.length} |`);
      }
    }
    lines.push("");
  }
}

/**
 * Format duplicates summary for text output
 */
function formatDuplicatesTextSummary(lines: string[], duplicates: DuplicateCandidate[]): void {
  lines.push(ansis.bold("Duplicate Detection Summary:"));

  const byConfidence = {
    high: duplicates.filter(d => d.confidence === "high").length,
    medium: duplicates.filter(d => d.confidence === "medium").length,
    low: duplicates.filter(d => d.confidence === "low").length,
  };

  lines.push(`  Total Candidates:    ${duplicates.length}`);
  lines.push(`  High Confidence:     ${byConfidence.high}`);
  lines.push(`  Medium Confidence:   ${byConfidence.medium}`);
  lines.push(`  Low Confidence:      ${byConfidence.low}`);

  if (byConfidence.high > 0) {
    lines.push("");
    lines.push(ansis.yellow(`  ⚠️  ${byConfidence.high} high-confidence duplicates require review`));
  }
}

/**
 * Format duplicates detailed for text output
 */
function formatDuplicatesTextDetailed(lines: string[], duplicates: DuplicateCandidate[]): void {
  if (duplicates.length === 0) {
    return;
  }

  lines.push(ansis.bold("Duplicate Detection (Detailed):"));
  lines.push("");

  // Show high confidence first
  const sorted = [...duplicates].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.confidence] - order[b.confidence];
  });

  for (const dup of sorted.slice(0, 20)) {
    const confidenceColor = dup.confidence === "high" ? ansis.red : dup.confidence === "medium" ? ansis.yellow : ansis.gray;
    lines.push(confidenceColor(`  [${dup.confidence.toUpperCase()}] ${dup.sourceNodeType} → ${dup.destinationNodeType}`));
    lines.push(`    Predicates: ${dup.predicates[0]} / ${dup.predicates[1]}`);
    lines.push(`    Reason: ${dup.reason}`);
    lines.push("");
  }

  if (duplicates.length > 20) {
    lines.push(ansis.dim(`  ... and ${duplicates.length - 20} more`));
    lines.push("");
  }
}

/**
 * Format duplicates for markdown
 */
function formatDuplicatesMarkdown(lines: string[], duplicates: DuplicateCandidate[]): void {
  lines.push("## Duplicate Detection");
  lines.push("");

  if (duplicates.length === 0) {
    lines.push("No duplicate candidates detected.");
    lines.push("");
    return;
  }

  const byConfidence = {
    high: duplicates.filter(d => d.confidence === "high"),
    medium: duplicates.filter(d => d.confidence === "medium"),
    low: duplicates.filter(d => d.confidence === "low"),
  };

  lines.push("### Summary");
  lines.push("");
  lines.push("| Confidence | Count |");
  lines.push("|------------|-------|");
  lines.push(`| High | ${byConfidence.high.length} |`);
  lines.push(`| Medium | ${byConfidence.medium.length} |`);
  lines.push(`| Low | ${byConfidence.low.length} |`);
  lines.push("");

  // High confidence duplicates
  if (byConfidence.high.length > 0) {
    lines.push("### High Confidence Duplicates");
    lines.push("");
    lines.push("| Source → Destination | Predicates | Reason |");
    lines.push("|----------------------|------------|--------|");
    for (const dup of byConfidence.high) {
      const route = `${escapeMarkdown(dup.sourceNodeType)} → ${escapeMarkdown(dup.destinationNodeType)}`;
      const predicates = `${escapeMarkdown(dup.predicates[0])} / ${escapeMarkdown(dup.predicates[1])}`;
      lines.push(`| ${route} | ${predicates} | ${escapeMarkdown(dup.reason)} |`);
    }
    lines.push("");
  }

  // Medium confidence duplicates
  if (byConfidence.medium.length > 0) {
    lines.push("### Medium Confidence Duplicates");
    lines.push("");
    lines.push("| Source → Destination | Predicates | Reason |");
    lines.push("|----------------------|------------|--------|");
    for (const dup of byConfidence.medium) {
      const route = `${escapeMarkdown(dup.sourceNodeType)} → ${escapeMarkdown(dup.destinationNodeType)}`;
      const predicates = `${escapeMarkdown(dup.predicates[0])} / ${escapeMarkdown(dup.predicates[1])}`;
      lines.push(`| ${route} | ${predicates} | ${escapeMarkdown(dup.reason)} |`);
    }
    lines.push("");
  }
}

/**
 * Format gaps summary for text output
 */
function formatGapsTextSummary(lines: string[], gaps: GapCandidate[]): void {
  lines.push(ansis.bold("Gap Analysis Summary:"));

  const byPriority = {
    high: gaps.filter(g => g.priority === "high").length,
    medium: gaps.filter(g => g.priority === "medium").length,
    low: gaps.filter(g => g.priority === "low").length,
  };

  lines.push(`  Total Gaps:        ${gaps.length}`);
  lines.push(`  High Priority:     ${byPriority.high}`);
  lines.push(`  Medium Priority:   ${byPriority.medium}`);
  lines.push(`  Low Priority:      ${byPriority.low}`);

  if (byPriority.high > 0) {
    lines.push("");
    lines.push(ansis.red(`  🚨 ${byPriority.high} high-priority gaps detected`));
  }
}

/**
 * Format gaps detailed for text output
 */
function formatGapsTextDetailed(lines: string[], gaps: GapCandidate[]): void {
  if (gaps.length === 0) {
    return;
  }

  lines.push(ansis.bold("Gap Analysis (Detailed):"));
  lines.push("");

  // Show high priority first
  const sorted = [...gaps].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });

  for (const gap of sorted.slice(0, 20)) {
    const priorityColor = gap.priority === "high" ? ansis.red : gap.priority === "medium" ? ansis.yellow : ansis.gray;
    lines.push(priorityColor(`  [${gap.priority.toUpperCase()}] ${gap.sourceNodeType} → ${gap.destinationNodeType}`));
    lines.push(`    Suggested: ${gap.suggestedPredicate}`);
    lines.push(`    Reason: ${gap.reason}`);
    if (gap.standardReference) {
      lines.push(`    Reference: ${gap.standardReference}`);
    }
    lines.push("");
  }

  if (gaps.length > 20) {
    lines.push(ansis.dim(`  ... and ${gaps.length - 20} more`));
    lines.push("");
  }
}

/**
 * Format gaps for markdown
 */
function formatGapsMarkdown(lines: string[], gaps: GapCandidate[]): void {
  lines.push("## Gap Analysis");
  lines.push("");

  if (gaps.length === 0) {
    lines.push("No relationship gaps detected.");
    lines.push("");
    return;
  }

  const byPriority = {
    high: gaps.filter(g => g.priority === "high"),
    medium: gaps.filter(g => g.priority === "medium"),
    low: gaps.filter(g => g.priority === "low"),
  };

  lines.push("### Summary");
  lines.push("");
  lines.push("| Priority | Count |");
  lines.push("|----------|-------|");
  lines.push(`| High | ${byPriority.high.length} |`);
  lines.push(`| Medium | ${byPriority.medium.length} |`);
  lines.push(`| Low | ${byPriority.low.length} |`);
  lines.push("");

  // High priority gaps
  if (byPriority.high.length > 0) {
    lines.push("### High Priority Gaps");
    lines.push("");
    lines.push("| Source → Destination | Suggested Predicate | Reason | Reference |");
    lines.push("|----------------------|---------------------|--------|-----------|");
    for (const gap of byPriority.high) {
      const route = `${escapeMarkdown(gap.sourceNodeType)} → ${escapeMarkdown(gap.destinationNodeType)}`;
      const predicate = escapeMarkdown(gap.suggestedPredicate);
      const reason = escapeMarkdown(gap.reason);
      const ref = gap.standardReference ? escapeMarkdown(gap.standardReference) : "-";
      lines.push(`| ${route} | ${predicate} | ${reason} | ${ref} |`);
    }
    lines.push("");
  }

  // Medium priority gaps
  if (byPriority.medium.length > 0) {
    lines.push("### Medium Priority Gaps");
    lines.push("");
    lines.push("| Source → Destination | Suggested Predicate | Reason | Reference |");
    lines.push("|----------------------|---------------------|--------|-----------|");
    for (const gap of byPriority.medium) {
      const route = `${escapeMarkdown(gap.sourceNodeType)} → ${escapeMarkdown(gap.destinationNodeType)}`;
      const predicate = escapeMarkdown(gap.suggestedPredicate);
      const reason = escapeMarkdown(gap.reason);
      const ref = gap.standardReference ? escapeMarkdown(gap.standardReference) : "-";
      lines.push(`| ${route} | ${predicate} | ${reason} | ${ref} |`);
    }
    lines.push("");
  }
}

/**
 * Format balance summary for text output
 */
function formatBalanceTextSummary(lines: string[], balance: BalanceAssessment[]): void {
  lines.push(ansis.bold("Balance Assessment Summary:"));

  const byStatus = {
    under: balance.filter(b => b.status === "under").length,
    balanced: balance.filter(b => b.status === "balanced").length,
    over: balance.filter(b => b.status === "over").length,
  };

  lines.push(`  Total Assessed:    ${balance.length}`);
  lines.push(`  Under-connected:   ${byStatus.under}`);
  lines.push(`  Balanced:          ${byStatus.balanced}`);
  lines.push(`  Over-connected:    ${byStatus.over}`);

  const issueCount = byStatus.under + byStatus.over;
  if (issueCount > 0) {
    lines.push("");
    lines.push(ansis.yellow(`  ⚠️  ${issueCount} node types have relationship density issues`));
  }
}

/**
 * Format balance detailed for text output
 */
function formatBalanceTextDetailed(lines: string[], balance: BalanceAssessment[]): void {
  if (balance.length === 0) {
    return;
  }

  lines.push(ansis.bold("Balance Assessment (Detailed):"));
  lines.push("");

  // Show issues first
  const issues = balance.filter(b => b.status !== "balanced");
  const sorted = [...issues].sort((a, b) => {
    if (a.status === "under" && b.status !== "under") return -1;
    if (a.status !== "under" && b.status === "under") return 1;
    return 0;
  });

  for (const item of sorted.slice(0, 20)) {
    const statusColor = item.status === "under" ? ansis.red : item.status === "over" ? ansis.yellow : ansis.green;
    const statusLabel = item.status.toUpperCase();
    lines.push(statusColor(`  [${statusLabel}] ${item.nodeType} (${item.layer})`));
    lines.push(`    Category: ${item.category}`);
    lines.push(`    Current:  ${item.currentCount} relationships`);
    lines.push(`    Target:   ${item.targetRange[0]}-${item.targetRange[1]} relationships`);
    if (item.recommendation) {
      lines.push(`    Advice:   ${item.recommendation}`);
    }
    lines.push("");
  }

  if (issues.length > 20) {
    lines.push(ansis.dim(`  ... and ${issues.length - 20} more`));
    lines.push("");
  }
}

/**
 * Format balance for markdown
 */
function formatBalanceMarkdown(lines: string[], balance: BalanceAssessment[]): void {
  lines.push("## Balance Assessment");
  lines.push("");

  if (balance.length === 0) {
    lines.push("No balance assessments available.");
    lines.push("");
    return;
  }

  const byStatus = {
    under: balance.filter(b => b.status === "under"),
    balanced: balance.filter(b => b.status === "balanced"),
    over: balance.filter(b => b.status === "over"),
  };

  lines.push("### Summary");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("|--------|-------|");
  lines.push(`| Under-connected | ${byStatus.under.length} |`);
  lines.push(`| Balanced | ${byStatus.balanced.length} |`);
  lines.push(`| Over-connected | ${byStatus.over.length} |`);
  lines.push("");

  // Under-connected types
  if (byStatus.under.length > 0) {
    lines.push("### Under-connected Node Types");
    lines.push("");
    lines.push("| Node Type | Layer | Category | Current | Target | Recommendation |");
    lines.push("|-----------|-------|----------|---------|--------|----------------|");
    for (const item of byStatus.under) {
      const target = `${item.targetRange[0]}-${item.targetRange[1]}`;
      const rec = item.recommendation ? escapeMarkdown(item.recommendation) : "-";
      lines.push(`| ${escapeMarkdown(item.nodeType)} | ${escapeMarkdown(item.layer)} | ${item.category} | ${item.currentCount} | ${target} | ${rec} |`);
    }
    lines.push("");
  }

  // Over-connected types
  if (byStatus.over.length > 0) {
    lines.push("### Over-connected Node Types");
    lines.push("");
    lines.push("| Node Type | Layer | Category | Current | Target | Recommendation |");
    lines.push("|-----------|-------|----------|---------|--------|----------------|");
    for (const item of byStatus.over) {
      const target = `${item.targetRange[0]}-${item.targetRange[1]}`;
      const rec = item.recommendation ? escapeMarkdown(item.recommendation) : "-";
      lines.push(`| ${escapeMarkdown(item.nodeType)} | ${escapeMarkdown(item.layer)} | ${item.category} | ${item.currentCount} | ${target} | ${rec} |`);
    }
    lines.push("");
  }
}

/**
 * Format connectivity summary for text output
 */
function formatConnectivityTextSummary(lines: string[], connectivity: AuditReport["connectivity"]): void {
  lines.push(ansis.bold("Connectivity Analysis Summary:"));

  const stats = connectivity.stats;

  lines.push(`  Total Nodes:            ${stats.totalNodes}`);
  lines.push(`  Total Edges:            ${stats.totalEdges}`);
  lines.push(`  Connected Components:   ${stats.connectedComponents}`);
  lines.push(`  Largest Component:      ${stats.largestComponentSize} nodes`);
  lines.push(`  Isolated Nodes:         ${stats.isolatedNodes}`);
  lines.push(`  Average Degree:         ${stats.averageDegree.toFixed(2)}`);
  lines.push(`  Transitive Chains:      ${stats.transitiveChainCount}`);

  if (stats.connectedComponents > 1) {
    lines.push("");
    lines.push(ansis.yellow(`  ⚠️  Graph is fragmented into ${stats.connectedComponents} components`));
  }
}

/**
 * Format connectivity detailed for text output
 */
function formatConnectivityTextDetailed(lines: string[], connectivity: AuditReport["connectivity"]): void {
  lines.push(ansis.bold("Connectivity Analysis (Detailed):"));
  lines.push("");

  // Connected components
  if (connectivity.components.length > 1) {
    lines.push(ansis.bold("  Connected Components:"));
    const sorted = [...connectivity.components].sort((a, b) => b.nodes.length - a.nodes.length);
    for (let i = 0; i < Math.min(5, sorted.length); i++) {
      const comp = sorted[i];
      lines.push(`    Component ${i + 1}: ${comp.nodes.length} nodes`);
      if (comp.nodes.length <= 5) {
        lines.push(`      ${comp.nodes.join(", ")}`);
      }
    }
    lines.push("");
  }

  // Top connected nodes
  if (connectivity.degrees.length > 0) {
    lines.push(ansis.bold("  Top Connected Nodes:"));
    const sorted = [...connectivity.degrees].sort((a, b) => b.totalDegree - a.totalDegree);
    for (const node of sorted.slice(0, 10)) {
      lines.push(`    ${node.nodeType.padEnd(40)} Total: ${String(node.totalDegree).padStart(3)} (In: ${node.inDegree}, Out: ${node.outDegree})`);
    }
    lines.push("");
  }

  // Transitive chains
  if (connectivity.transitiveChains.length > 0) {
    lines.push(ansis.bold("  Transitive Chains:"));
    const sorted = [...connectivity.transitiveChains].sort((a, b) => b.chain.length - a.chain.length);
    for (const chain of sorted.slice(0, 5)) {
      lines.push(`    [${chain.predicate}] ${chain.chain.join(" → ")} (${chain.chain.length} hops)`);
    }
    lines.push("");
  }
}

/**
 * Format connectivity for markdown
 */
function formatConnectivityMarkdown(lines: string[], connectivity: AuditReport["connectivity"]): void {
  lines.push("## Connectivity Analysis");
  lines.push("");

  const stats = connectivity.stats;

  lines.push("### Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Total Nodes | ${stats.totalNodes} |`);
  lines.push(`| Total Edges | ${stats.totalEdges} |`);
  lines.push(`| Connected Components | ${stats.connectedComponents} |`);
  lines.push(`| Largest Component | ${stats.largestComponentSize} nodes |`);
  lines.push(`| Isolated Nodes | ${stats.isolatedNodes} |`);
  lines.push(`| Average Degree | ${stats.averageDegree.toFixed(2)} |`);
  lines.push(`| Transitive Chains | ${stats.transitiveChainCount} |`);
  lines.push("");

  // Connected components
  if (connectivity.components.length > 1) {
    lines.push("### Connected Components");
    lines.push("");
    lines.push("| Component | Size | Sample Nodes |");
    lines.push("|-----------|------|--------------|");
    const sorted = [...connectivity.components].sort((a, b) => b.nodes.length - a.nodes.length);
    for (let i = 0; i < Math.min(10, sorted.length); i++) {
      const comp = sorted[i];
      const sample = comp.nodes.slice(0, 3).map(escapeMarkdown).join(", ");
      const sampleText = comp.nodes.length > 3 ? `${sample}...` : sample;
      lines.push(`| ${i + 1} | ${comp.nodes.length} | ${sampleText} |`);
    }
    lines.push("");
  }

  // Top connected nodes
  if (connectivity.degrees.length > 0) {
    lines.push("### Top Connected Nodes");
    lines.push("");
    lines.push("| Node Type | In-Degree | Out-Degree | Total |");
    lines.push("|-----------|-----------|------------|-------|");
    const sorted = [...connectivity.degrees].sort((a, b) => b.totalDegree - a.totalDegree);
    for (const node of sorted.slice(0, 20)) {
      lines.push(`| ${escapeMarkdown(node.nodeType)} | ${node.inDegree} | ${node.outDegree} | ${node.totalDegree} |`);
    }
    lines.push("");
  }

  // Transitive chains
  if (connectivity.transitiveChains.length > 0) {
    lines.push("### Transitive Chains");
    lines.push("");
    lines.push("| Predicate | Chain | Length |");
    lines.push("|-----------|-------|--------|");
    const sorted = [...connectivity.transitiveChains].sort((a, b) => b.chain.length - a.chain.length);
    for (const chain of sorted.slice(0, 20)) {
      const chainStr = chain.chain.map(escapeMarkdown).join(" → ");
      lines.push(`| ${escapeMarkdown(chain.predicate)} | ${chainStr} | ${chain.chain.length} |`);
    }
    lines.push("");
  }
}
