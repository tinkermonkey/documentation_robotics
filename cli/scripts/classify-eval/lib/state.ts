import type { Card } from "./types.js";

/**
 * Render a card as the "state" text a classifier sees. Shared by every
 * backend so the comparison is fair. `sourceLines` caps the code excerpt;
 * the gold labeler uses the full card source instead.
 */
export function renderState(card: Card, sourceLines: number): string {
  const lines: string[] = [];
  lines.push(`Symbol kind: ${card.label}`);
  lines.push(`Name: ${card.name}`);
  lines.push(`Qualified name: ${card.qualified_name}`);
  if (card.file_path) lines.push(`File: ${card.file_path}${card.start_line ? ` (lines ${card.start_line}-${card.end_line ?? "?"})` : ""}`);
  if (card.route_method) lines.push(`HTTP method: ${card.route_method}`);
  if (card.signature) lines.push(`Signature: ${compact(card.signature)}${card.return_type ? ` -> ${compact(card.return_type)}` : ""}`);
  if (card.parent_class) lines.push(`Parent class: ${card.parent_class}`);
  if (card.base_classes.length) lines.push(`Base classes: ${card.base_classes.join(", ")}`);
  if (card.inherits.length) lines.push(`Inherits: ${card.inherits.join(", ")}`);
  if (card.implements.length) lines.push(`Implements: ${card.implements.join(", ")}`);
  const flags: string[] = [];
  if (card.is_exported) flags.push("exported");
  if (card.is_entry_point) flags.push("entry point");
  if (card.complexity != null) flags.push(`cyclomatic complexity ${card.complexity}`);
  if (flags.length) lines.push(`Flags: ${flags.join(", ")}`);
  if (card.docstring) lines.push(`Docstring: ${compact(card.docstring, 400)}`);
  lines.push(`Callers (${card.callers_total}): ${card.callers.length ? card.callers.join(", ") : "none"}`);
  lines.push(`Callees (${card.callees_total}): ${card.callees.length ? card.callees.join(", ") : "none"}`);
  if (card.imports.length) lines.push(`File imports: ${card.imports.join(", ")}`);
  if (card.env_vars.length) lines.push(`Environment variables read: ${card.env_vars.join(", ")}`);
  if (card.routes_handled.length) lines.push(`Handles routes: ${card.routes_handled.join(", ")}`);
  if (card.http_calls.length) lines.push(`Makes HTTP calls to: ${card.http_calls.join(", ")}`);
  if (card.source) {
    const src = card.source.split("\n");
    const shown = src.slice(0, sourceLines);
    const truncated = card.source_truncated || src.length > sourceLines;
    lines.push("");
    lines.push(`Source${truncated ? ` (first ${shown.length} of ${card.source_lines_total ?? src.length} lines)` : ""}:`);
    lines.push("```");
    lines.push(...shown);
    lines.push("```");
  }
  return lines.join("\n");
}

function compact(s: string, max = 300): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max) + "…" : one;
}
