/**
 * Verify report formatters
 * Supports text (default) and JSON output formats for verification reports
 */

import ansis from "ansis";
import type { VerifyReport, MatchedEntry, GraphOnlyEntry, ModelOnlyEntry, IgnoredEntry } from "../analyzers/types.js";
import { formatDate } from "../utils/date-utils.js";

export type VerifyReportFormat = "text" | "json";

export interface VerifyFormatterOptions {
  format: VerifyReportFormat;
}

/**
 * Format verify report for output
 */
export function formatVerifyReport(report: VerifyReport, options: VerifyFormatterOptions): string {
  switch (options.format) {
    case "json":
      return formatVerifyJSON(report);
    case "text":
    default:
      return formatVerifyText(report);
  }
}

/**
 * Format as JSON
 */
export function formatVerifyJSON(report: VerifyReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

/**
 * Format as plain text (default)
 */
export function formatVerifyText(report: VerifyReport): string {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(ansis.bold(`✓ API Verification Report: ${ansis.cyan(report.project_root)}`));
  lines.push(ansis.dim("=".repeat(80)));
  lines.push("");
  lines.push(`Generated: ${formatDate(report.generated_at)}`);
  lines.push(`Analyzer: ${report.analyzer} (indexed: ${formatDate(report.analyzer_indexed_at)})`);
  lines.push("");

  // Changeset context
  formatChangesetContextText(lines, report);
  lines.push("");

  // Summary section
  formatSummaryText(lines, report);
  lines.push("");

  // Matched section
  formatMatchedText(lines, report.buckets.matched);
  lines.push("");

  // Graph-only section (gaps)
  formatGraphOnlyText(lines, report.buckets.in_graph_only);
  lines.push("");

  // Model-only section (drift)
  formatModelOnlyText(lines, report.buckets.in_model_only);
  lines.push("");

  // Ignored section
  formatIgnoredText(lines, report.buckets.ignored);
  lines.push("");

  return lines.join("\n");
}

/**
 * Format changeset context for text output
 */
function formatChangesetContextText(lines: string[], report: VerifyReport): void {
  const context = report.changeset_context;

  lines.push(ansis.bold.blue("Changeset Context"));
  lines.push(ansis.dim("─".repeat(60)));

  if (context.active_changeset) {
    lines.push(`Active Changeset: ${ansis.cyan(context.active_changeset)}`);
    lines.push(`Verified Against: ${ansis.cyan("changeset view")}`);
  } else {
    lines.push("Active Changeset: none");
    lines.push(`Verified Against: ${ansis.cyan("base model")}`);
  }
}

/**
 * Format summary statistics for text output
 */
function formatSummaryText(lines: string[], report: VerifyReport): void {
  const summary = report.summary;

  lines.push(ansis.bold.yellow("SUMMARY"));
  lines.push(ansis.dim("─".repeat(60)));
  lines.push("");

  lines.push(ansis.bold("Verification Results:"));
  lines.push(`  Matched:        ${ansis.green(String(summary.matched_count).padStart(4))} operations found in both graph and model`);
  lines.push(`  Graph-only:     ${ansis.yellow(String(summary.gap_count).padStart(4))} routes discovered but not in model (gaps)`);
  lines.push(`  Model-only:     ${ansis.red(String(summary.drift_count).padStart(4))} operations defined but not discovered (drift)`);
  lines.push(`  Ignored:        ${ansis.dim(String(summary.ignored_count).padStart(4))} entries excluded by rules`);
  lines.push("");
  lines.push(`Total Graph Entries Analyzed:   ${summary.total_graph_entries}`);
  lines.push(`Total Model Entries Analyzed:   ${summary.total_model_entries}`);
}

/**
 * Format matched entries for text output
 */
function formatMatchedText(lines: string[], matched: MatchedEntry[]): void {
  lines.push(ansis.bold.green(`✓ Matched (${matched.length})`));
  lines.push(ansis.dim("─".repeat(60)));

  if (matched.length === 0) {
    lines.push(ansis.dim("  No matched entries."));
    return;
  }

  for (const entry of matched.slice(0, 20)) {
    lines.push(`  ${ansis.green("✓")} ${entry.id}`);
    lines.push(`    Type: ${entry.type}`);
    lines.push(`    Source: ${entry.source_file}:${entry.source_symbol}`);
    lines.push("");
  }

  if (matched.length > 20) {
    lines.push(ansis.dim(`  ... and ${matched.length - 20} more`));
  }
}

/**
 * Format graph-only entries for text output (gaps)
 */
function formatGraphOnlyText(lines: string[], graphOnly: GraphOnlyEntry[]): void {
  lines.push(ansis.bold.yellow(`⚠ Graph-only / Gaps (${graphOnly.length})`));
  lines.push(ansis.dim("─".repeat(60)));

  if (graphOnly.length === 0) {
    lines.push(ansis.dim("  No gaps detected — all discovered routes are in the model."));
    return;
  }

  lines.push(ansis.dim("Routes discovered in the codebase but missing from the model:"));
  lines.push("");

  for (const entry of graphOnly.slice(0, 20)) {
    lines.push(`  ${ansis.yellow("!")} ${entry.id}`);
    if (entry.http_method && entry.http_path) {
      lines.push(`    Endpoint: ${entry.http_method} ${entry.http_path}`);
    }
    lines.push(`    Source: ${entry.source_file}:${entry.source_symbol}`);
    lines.push("");
  }

  if (graphOnly.length > 20) {
    lines.push(ansis.dim(`  ... and ${graphOnly.length - 20} more`));
  }
}

/**
 * Format model-only entries for text output (drift)
 */
function formatModelOnlyText(lines: string[], modelOnly: ModelOnlyEntry[]): void {
  lines.push(ansis.bold.red(`✗ Model-only / Drift (${modelOnly.length})`));
  lines.push(ansis.dim("─".repeat(60)));

  if (modelOnly.length === 0) {
    lines.push(ansis.dim("  No drift detected — all model operations were discovered."));
    return;
  }

  lines.push(ansis.dim("Operations defined in the model but not found in the codebase:"));
  lines.push("");

  for (const entry of modelOnly.slice(0, 20)) {
    lines.push(`  ${ansis.red("✗")} ${entry.id}`);
    lines.push(`    Type: ${entry.type}`);
    lines.push(`    Source: ${entry.source_file}:${entry.source_symbol}`);
    lines.push("");
  }

  if (modelOnly.length > 20) {
    lines.push(ansis.dim(`  ... and ${modelOnly.length - 20} more`));
  }
}

/**
 * Format ignored entries for text output
 */
function formatIgnoredText(lines: string[], ignored: IgnoredEntry[]): void {
  lines.push(ansis.bold.dim(`⊘ Ignored (${ignored.length})`));
  lines.push(ansis.dim("─".repeat(60)));

  if (ignored.length === 0) {
    lines.push(ansis.dim("  No ignored entries."));
    return;
  }

  // Group by entry type
  const byType = new Map<string, IgnoredEntry[]>();
  for (const entry of ignored) {
    const group = byType.get(entry.entry_type) ?? [];
    group.push(entry);
    byType.set(entry.entry_type, group);
  }

  for (const [type, entries] of byType) {
    lines.push(`  ${type}: ${entries.length} entries`);
    for (const entry of entries.slice(0, 5)) {
      lines.push(ansis.dim(`    • ${entry.id}`));
      lines.push(ansis.dim(`      Reason: ${entry.reason}`));
    }
    if (entries.length > 5) {
      lines.push(ansis.dim(`    ... and ${entries.length - 5} more`));
    }
    lines.push("");
  }
}
