/**
 * The "state" text a decision model sees for a symbol card. Ported as is from the classify-eval
 * harness's `lib/state.ts` (which now re-exports it). With the default options it is dr-qset-1's
 * state, line range included; dr-qset-2 renders it line-free with sorted neighbour lists
 * ({@link StateOptions}, TIER1_DESIGN.md section 3.3). Any change here changes the question set id
 * (`qset/`).
 */
import type { CardFacts, SymbolCard } from "../cards/types.js";

/** The card fields the state reads (a harness card, with its corpus field, also fits). */
export type StateCard = Omit<SymbolCard, "id">;

/** The facts the state can carry (harness `--facts` only; dr-qset-1 sends none). */
export type StateFacts = Pick<CardFacts, "decorators" | "file_importers" | "usage_files" | "methods">;

/** How many callers and callees, and how many file imports, the state names. */
export const STATE_NEIGHBOURS = 12;
export const STATE_IMPORTS = 15;

/** What a question set changes in the state. The defaults are dr-qset-1's state. */
export interface StateOptions {
  /** The `File:` line carries the symbol's line range (dr-qset-1). Off in dr-qset-2: a symbol that moves down its file keeps its state. */
  lineRange?: boolean;
  /**
   * Callers, callees and imports sorted before the first 12 (15) are taken (dr-qset-2), so the
   * order CBM returned its rows in doesn't change the state. dr-qset-1 keeps the card's order.
   */
  sortNeighbours?: boolean;
}

/**
 * A neighbour list as the state shows it. Sorted: by code unit (locale-free), then the first `max`.
 * Unsorted (dr-qset-1): the card's list as is, already capped by the card builder.
 */
function neighbours(list: readonly string[], max: number, sort: boolean): readonly string[] {
  return sort ? [...list].sort().slice(0, max) : list;
}

/**
 * Render a card as the state text. `sourceLines` caps the code excerpt (40 for classifiers; the
 * harness's gold labeler passes the full card source instead).
 */
export function renderState(card: StateCard, sourceLines: number, facts?: StateFacts, options: StateOptions = {}): string {
  const lineRange = options.lineRange ?? true;
  const sort = options.sortNeighbours ?? false;
  const callers = neighbours(card.callers, STATE_NEIGHBOURS, sort);
  const callees = neighbours(card.callees, STATE_NEIGHBOURS, sort);
  const imports = neighbours(card.imports, STATE_IMPORTS, sort);
  const lines: string[] = [];
  lines.push(`Symbol kind: ${card.label}`);
  lines.push(`Name: ${card.name}`);
  lines.push(`Qualified name: ${card.qualified_name}`);
  if (card.file_path) lines.push(`File: ${card.file_path}${lineRange && card.start_line ? ` (lines ${card.start_line}-${card.end_line ?? "?"})` : ""}`);
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
  lines.push(`Callers (${card.callers_total}): ${callers.length ? callers.join(", ") : "none"}`);
  lines.push(`Callees (${card.callees_total}): ${callees.length ? callees.join(", ") : "none"}`);
  if (imports.length) lines.push(`File imports: ${imports.join(", ")}`);
  if (card.env_vars.length) lines.push(`Environment variables read: ${card.env_vars.join(", ")}`);
  if (card.routes_handled.length) lines.push(`Handles routes: ${card.routes_handled.join(", ")}`);
  if (card.http_calls.length) lines.push(`Makes HTTP calls to: ${card.http_calls.join(", ")}`);
  if (facts) {
    // Tier-0 structural facts: stated outright so the classifier need not infer them
    if (facts.decorators.length) lines.push(`Decorators: ${facts.decorators.map((d) => compact(d, 80)).join(", ")}`);
    lines.push(`Imported by: ${facts.file_importers} other file${facts.file_importers === 1 ? "" : "s"}`);
    if (facts.usage_files) lines.push(`Used from: ${facts.usage_files} other file${facts.usage_files === 1 ? "" : "s"}`);
    if (facts.methods) lines.push(`Defines ${facts.methods} method${facts.methods === 1 ? "" : "s"}`);
    const placement = placementOf(card.file_path);
    if (placement) lines.push(`Placement: ${placement}`);
  }
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

/** Where a file sits by framework convention, when that says something about its role. */
export function placementOf(file: string | null): string | null {
  if (!file) return null;
  if (/(^|\/)(components\/ui|packages\/[^/]+\/ui|design-system|ui-kit)\//.test(file)) return "shared UI library directory (reusable components)";
  if (/(^|\/)(src\/)?(routes|pages|app)\/.+\.(tsx|jsx|vue|svelte)$/.test(file)) return "file-based routing directory (reached by navigation)";
  if (/\.gen\.[cm]?[jt]sx?$/.test(file)) return "generated code";
  if (/(^|\/)(tests?|__tests__|spec)\//.test(file)) return "test code";
  return null;
}
