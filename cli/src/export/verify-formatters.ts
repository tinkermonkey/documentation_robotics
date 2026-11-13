/**
 * Verify report formatters
 * Supports text (default), JSON, and markdown output formats for verification reports
 */

import ansis from "ansis";
import type { VerifyReport, MatchedEntry, GraphOnlyEntry, ModelOnlyEntry, IgnoredEntry, LayerVerifyEntry } from "../analyzers/types.js";
import { formatDate } from "../utils/date-utils.js";
import { escapeMarkdown } from "./markdown-utils.js";

export type VerifyReportFormat = "text" | "json" | "markdown";

export interface VerifyFormatterOptions {
  format: VerifyReportFormat;
}

/**
 * Format verify report for output
 */
export function formatVerifyReport(report: VerifyReport, options: VerifyFormatterOptions): string {
  const format: VerifyReportFormat = options.format;
  switch (format) {
    case "json":
      return formatVerifyJSON(report);
    case "markdown":
      return formatVerifyMarkdown(report);
    case "text":
      return formatVerifyText(report);
    default:
      // Exhaustive check: if this line is reached, options.format is not a valid VerifyReportFormat
      const _exhaustive: never = format;
      return _exhaustive;
  }
}

/**
 * Format as JSON
 */
export function formatVerifyJSON(report: VerifyReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

/**
 * Whether the report checked the API layer. A report with per-layer results lists the API layer
 * among them when it was asked for; one without them (older reports) is the API check alone.
 */
function apiChecked(report: VerifyReport): boolean {
  return !report.layers || report.layers.some((l) => l.layer === "api");
}

/** The per-layer results other than the API layer's top-level buckets. */
function otherLayers(report: VerifyReport) {
  return (report.layers ?? []).filter((l) => l.layer !== "api");
}

/**
 * Format as Markdown
 */
export function formatVerifyMarkdown(report: VerifyReport): string {
  const lines: string[] = [];
  const api = apiChecked(report);
  const others = otherLayers(report);

  // Header
  lines.push(api ? `# API Verification Report` : `# Verification Report`);
  lines.push("");
  lines.push(`**Project:** ${escapeMarkdown(report.project_root)}`);
  lines.push(`**Generated:** ${formatDate(report.generated_at)}`);
  lines.push(`**Analyzer:** ${escapeMarkdown(report.analyzer)} (indexed: ${formatDate(report.analyzer_indexed_at)})`);
  lines.push("");

  // Table of Contents
  lines.push("## Contents");
  lines.push("- [Changeset Context](#changeset-context)");
  if (api) {
    lines.push("- [Summary](#summary)");
    lines.push("- [Matched Entries](#matched-entries)");
    lines.push("- [Graph-only Entries (Gaps)](#graph-only-entries-gaps)");
    lines.push("- [Model-only Entries (Drift)](#model-only-entries-drift)");
    lines.push("- [Ignored Entries](#ignored-entries)");
  }
  for (const layer of others) lines.push(`- [Layer: ${layer.layer}](#layer-${layer.layer})`);
  lines.push("");

  // Changeset context
  formatChangesetContextMarkdown(lines, report);
  lines.push("");

  if (api) {
    // Summary section
    formatSummaryMarkdown(lines, report);
    lines.push("");

    // Matched section
    formatMatchedMarkdown(lines, report.buckets.matched);
    lines.push("");

    // Graph-only section (gaps)
    formatGraphOnlyMarkdown(lines, report.buckets.in_graph_only);
    lines.push("");

    // Model-only section (drift)
    formatModelOnlyMarkdown(lines, report.buckets.in_model_only);
    lines.push("");

    // Ignored section
    formatIgnoredMarkdown(lines, report.buckets.ignored);
    lines.push("");
  }

  // The other layers (data-store, technology, testing), and layers whose check failed
  formatLayersMarkdown(lines, report);

  return lines.join("\n");
}

/**
 * Format the per-layer checks beyond the API layer, the API layer's parse gaps, and the layers
 * whose check failed, for markdown output
 */
function formatLayersMarkdown(lines: string[], report: VerifyReport): void {
  const table = (title: string, entries: LayerVerifyEntry[] | undefined) => {
    if (!entries?.length) return;
    lines.push(`### ${title} (${entries.length})`);
    lines.push("");
    lines.push("| ID | Type | Files | Reason |");
    lines.push("|----|------|-------|--------|");
    for (const e of entries.slice(0, 50)) {
      lines.push(`| ${escapeMarkdown(e.id)} | ${escapeMarkdown(e.type)} | ${escapeMarkdown(e.files.join(", "))} | ${escapeMarkdown(e.reason ?? "")} |`);
    }
    if (entries.length > 50) lines.push(`| _... and ${entries.length - 50} more_ | | | |`);
    lines.push("");
  };
  for (const layer of report.layers ?? []) {
    const { summary, buckets } = layer;
    if (layer.layer === "api") {
      table("API operations not indexed (parse gaps, not drift)", buckets.not_indexed);
      continue;
    }
    lines.push(`## Layer: ${escapeMarkdown(layer.layer)}`);
    lines.push("");
    lines.push(`_${escapeMarkdown(layer.checks)}_`);
    lines.push("");
    lines.push("| Metric | Count |");
    lines.push("|--------|-------|");
    lines.push(`| Matched | ${summary.matched_count} |`);
    lines.push(`| In code only (gaps) | ${summary.gap_count} |`);
    lines.push(`| In model only (drift) | ${summary.drift_count} |`);
    lines.push(`| Not indexed (parse gaps) | ${summary.not_indexed_count} |`);
    if (summary.ignored_count) lines.push(`| Ignored | ${summary.ignored_count} |`);
    lines.push(`| Not checked | ${summary.elements_not_checked} |`);
    lines.push(`| Without a source | ${summary.elements_without_source_ref} |`);
    lines.push("");
    table("In code only", buckets.in_graph_only);
    table("In model only (drift)", buckets.in_model_only);
    table("Not indexed (parse gaps, not drift)", buckets.not_indexed);
    table("Ignored", buckets.ignored);
    if (layer.relationships) {
      const r = layer.relationships;
      lines.push(`**tests relationships:** matched ${r.matched.length}, in code only ${r.in_graph_only.length}, in model only ${r.in_model_only.length}`);
      lines.push("");
      for (const rel of r.in_model_only) lines.push(`- ${escapeMarkdown(`${rel.source} ${rel.predicate} ${rel.target}`)} (in model only)`);
      if (r.in_model_only.length) lines.push("");
    }
  }
  if (report.layers_not_verified?.length) {
    lines.push("## Layers Not Verified");
    lines.push("");
    for (const { layer, reason } of report.layers_not_verified) lines.push(`- **${escapeMarkdown(layer)}**: ${escapeMarkdown(reason)}`);
    lines.push("");
  }
}

/**
 * Format changeset context for markdown output
 */
function formatChangesetContextMarkdown(lines: string[], report: VerifyReport): void {
  const context = report.changeset_context;

  lines.push("## Changeset Context");

  if (context.active_changeset) {
    lines.push(`- **Active Changeset:** ${escapeMarkdown(context.active_changeset)}`);
    lines.push(`- **Verified Against:** changeset view`);
  } else {
    lines.push(`- **Active Changeset:** none`);
    lines.push(`- **Verified Against:** base model`);
  }
}

/**
 * Format summary statistics for markdown output
 */
function formatSummaryMarkdown(lines: string[], report: VerifyReport): void {
  const summary = report.summary;

  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count | Description |");
  lines.push("|--------|-------|-------------|");
  lines.push(`| Matched | ${summary.matched_count} | Operations found in both graph and model |`);
  lines.push(`| Graph-only | ${summary.gap_count} | Routes discovered but not in model (gaps) |`);
  lines.push(`| Model-only | ${summary.drift_count} | Operations defined but not discovered (drift) |`);
  lines.push(`| Ignored | ${summary.ignored_count} | Entries excluded by rules |`);
  lines.push("");
  lines.push(`**Total Graph Entries Analyzed:** ${summary.total_graph_entries}`);
  lines.push("");
  lines.push(`**Total Model Entries (API Layer):** ${summary.total_model_entries}`);
  if (summary.elements_without_source_ref > 0) {
    lines.push(`_(${summary.elements_without_source_ref} element(s) excluded from drift detection — no source attribution)_`);
  }
}

/**
 * Format matched entries for markdown output
 */
function formatMatchedMarkdown(lines: string[], matched: MatchedEntry[]): void {
  lines.push(`## Matched Entries`);
  lines.push("");

  if (matched.length === 0) {
    lines.push("_No matched entries._");
    return;
  }

  lines.push(`**Count:** ${matched.length}`);
  lines.push("");
  lines.push("| ID | Type | Source |");
  lines.push("|----|----|--------|");

  for (const entry of matched.slice(0, 50)) {
    const source = `${escapeMarkdown(entry.source_file)}:${escapeMarkdown(entry.source_symbol)}`;
    lines.push(`| ${escapeMarkdown(entry.id)} | ${escapeMarkdown(entry.type)} | ${source} |`);
  }

  if (matched.length > 50) {
    lines.push("");
    lines.push(`_... and ${matched.length - 50} more entries._`);
  }
}

/**
 * Format graph-only entries for markdown output (gaps)
 */
function formatGraphOnlyMarkdown(lines: string[], graphOnly: GraphOnlyEntry[]): void {
  lines.push(`## Graph-only Entries (Gaps)`);
  lines.push("");

  if (graphOnly.length === 0) {
    lines.push("_No gaps detected — all discovered routes are in the model._");
    return;
  }

  lines.push(`**Count:** ${graphOnly.length}`);
  lines.push("");
  lines.push("Routes discovered in the codebase but missing from the model:");
  lines.push("");
  lines.push('> **Tip:** Use `/dr-map` or `dr analyzer endpoints` ingestion to close these gaps — manual `dr add` operations cannot be matched by the verifier.');
  lines.push("");
  lines.push("| ID | Endpoint | Source |");
  lines.push("|----|----|--------|");

  for (const entry of graphOnly.slice(0, 50)) {
    const endpoint = entry.http_method && entry.http_path ? `${entry.http_method} ${entry.http_path}` : "—";
    const source = `${escapeMarkdown(entry.source_file)}:${escapeMarkdown(entry.source_symbol)}`;
    lines.push(`| ${escapeMarkdown(entry.id)} | ${escapeMarkdown(endpoint)} | ${source} |`);
  }

  if (graphOnly.length > 50) {
    lines.push("");
    lines.push(`_... and ${graphOnly.length - 50} more entries._`);
  }
}

/**
 * Format model-only entries for markdown output (drift)
 */
function formatModelOnlyMarkdown(lines: string[], modelOnly: ModelOnlyEntry[]): void {
  lines.push(`## Model-only Entries (Drift)`);
  lines.push("");

  if (modelOnly.length === 0) {
    lines.push("_No drift detected — all model operations were discovered._");
    return;
  }

  lines.push(`**Count:** ${modelOnly.length}`);
  lines.push("");
  lines.push("Operations defined in the model but not found in the codebase:");
  lines.push("");
  lines.push("| ID | Type | Source |");
  lines.push("|----|----|--------|");

  for (const entry of modelOnly.slice(0, 50)) {
    const source = `${escapeMarkdown(entry.source_file)}:${escapeMarkdown(entry.source_symbol)}`;
    lines.push(`| ${escapeMarkdown(entry.id)} | ${escapeMarkdown(entry.type)} | ${source} |`);
  }

  if (modelOnly.length > 50) {
    lines.push("");
    lines.push(`_... and ${modelOnly.length - 50} more entries._`);
  }
}

/**
 * Format ignored entries for markdown output
 */
function formatIgnoredMarkdown(lines: string[], ignored: IgnoredEntry[]): void {
  lines.push(`## Ignored Entries`);
  lines.push("");

  if (ignored.length === 0) {
    lines.push("_No ignored entries._");
    return;
  }

  lines.push(`**Count:** ${ignored.length}`);
  lines.push("");

  // Group by entry type
  const byType = new Map<string, IgnoredEntry[]>();
  for (const entry of ignored) {
    const group = byType.get(entry.entry_type) ?? [];
    group.push(entry);
    byType.set(entry.entry_type, group);
  }

  for (const [type, entries] of byType) {
    lines.push(`### ${escapeMarkdown(type)} (${entries.length})`);
    lines.push("");
    lines.push("| ID | Reason |");
    lines.push("|----|----|");

    for (const entry of entries.slice(0, 20)) {
      lines.push(`| ${escapeMarkdown(entry.id)} | ${escapeMarkdown(entry.reason)} |`);
    }

    if (entries.length > 20) {
      lines.push(`| _... and ${entries.length - 20} more_ | |`);
    }
    lines.push("");
  }
}

/**
 * Format as plain text (default)
 */
export function formatVerifyText(report: VerifyReport): string {
  const lines: string[] = [];

  const api = apiChecked(report);

  // Header
  lines.push("");
  lines.push(ansis.bold(`✓ ${api ? "API " : ""}Verification Report: ${ansis.cyan(report.project_root)}`));
  lines.push(ansis.dim("=".repeat(80)));
  lines.push("");
  lines.push(`Generated: ${formatDate(report.generated_at)}`);
  lines.push(`Analyzer: ${report.analyzer} (indexed: ${formatDate(report.analyzer_indexed_at)})`);
  lines.push("");

  // Changeset context
  formatChangesetContextText(lines, report);
  lines.push("");

  // The API layer's sections, when it was asked for: an all-zero API summary would read as a result.
  if (api) {
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
  }

  // The other layers (data-store, technology, testing), parse gaps, and layers whose check failed
  formatLayersText(lines, report);

  return lines.join("\n");
}

/**
 * Format the per-layer checks beyond the API layer's buckets, and every layer's not-indexed
 * elements, for text output
 */
function formatLayersText(lines: string[], report: VerifyReport): void {
  for (const layer of report.layers ?? []) {
    const { summary, buckets } = layer;
    if (layer.layer === "api" && buckets.not_indexed.length === 0) continue;
    lines.push(ansis.bold.blue(`Layer: ${layer.layer}`));
    lines.push(ansis.dim("─".repeat(60)));
    lines.push(ansis.dim(layer.checks));
    lines.push(
      `Matched: ${summary.matched_count}   In code only: ${summary.gap_count}   In model only (drift): ${summary.drift_count}   ` +
        `Not indexed: ${summary.not_indexed_count}${summary.ignored_count ? `   Ignored: ${summary.ignored_count}` : ""}`
    );
    const list = (title: string, entries: typeof buckets.matched) => {
      if (entries.length === 0 || (layer.layer === "api" && title !== "Not indexed (parse gaps, not drift)")) return;
      lines.push(ansis.bold(title));
      for (const e of entries) {
        lines.push(`  ${e.id} (${e.type})${e.files.length ? ` ${ansis.dim(e.files.join(", "))}` : ""}${e.reason ? ` - ${e.reason}` : ""}`);
      }
    };
    list("In code only", buckets.in_graph_only);
    list("In model only (drift)", buckets.in_model_only);
    list("Not indexed (parse gaps, not drift)", buckets.not_indexed);
    list("Ignored", buckets.ignored ?? []);
    if (layer.relationships) {
      const r = layer.relationships;
      lines.push(`tests relationships: matched ${r.matched.length}, in code only ${r.in_graph_only.length}, in model only ${r.in_model_only.length}`);
      for (const rel of r.in_model_only) lines.push(`  ${rel.source} ${rel.predicate} ${rel.target} (in model only)`);
    }
    lines.push("");
  }
  for (const { layer, reason } of report.layers_not_verified ?? []) {
    lines.push(ansis.bold.red(`Layer: ${layer} not verified`) + ` - ${reason}`);
    lines.push("");
  }
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
  lines.push(`Total Model Entries (API Layer): ${summary.total_model_entries}`);
  if (summary.elements_without_source_ref > 0) {
    lines.push(ansis.dim(`  (${summary.elements_without_source_ref} element(s) excluded from drift detection — no source attribution)`));
  }
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
  lines.push(ansis.dim("  Tip: Use /dr-map or `dr analyzer endpoints` ingestion to close these gaps —"));
  lines.push(ansis.dim("  manual `dr add` operations cannot be matched by the verifier."));
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
