/**
 * Build symbol cards from a CBM project.
 *
 * The classify-eval harness (cli/scripts/classify-eval/) builds its labelled card sets with this
 * module, so its accuracy numbers measure the code `dr analyzer classify` runs.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EdgeIndex } from "./edge-index.js";
import type { CardGraph, GraphNode, SymbolCard } from "./types.js";

/**
 * Version of the card's fields and how they are derived. Bump it when a change would make a card
 * built now differ from one built before for the same graph, so stored cards and their
 * classifications can be told apart.
 */
export const CARD_VERSION = 1;

/** CBM labels that become cards in the harness's card sets (classify adds the rules' labels). */
export const CARD_LABELS: readonly string[] = Object.freeze(["Class", "Interface", "Function", "Method", "Module", "Route"]);

/** Extra search_graph fields each label's card reads. */
export const CARD_FIELDS: Readonly<Record<string, string[]>> = Object.freeze({
  Class: ["docstring", "base_classes", "is_exported", "is_entry_point", "complexity", "start_line", "end_line"],
  Interface: ["docstring", "base_classes", "is_exported", "start_line", "end_line"],
  Function: ["signature", "docstring", "is_exported", "is_entry_point", "complexity", "return_type", "start_line", "end_line"],
  Method: ["signature", "docstring", "parent_class", "is_exported", "is_entry_point", "complexity", "return_type", "start_line", "end_line"],
  Module: ["is_entry_point", "is_exported", "lines", "start_line", "end_line"],
  Route: ["method", "source"],
  Type: ["docstring", "is_exported", "start_line", "end_line"],
  Enum: ["docstring", "is_exported", "start_line", "end_line"],
  Trait: ["docstring", "is_exported", "start_line", "end_line"],
  Struct: ["docstring", "is_exported", "start_line", "end_line"],
});

export const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rs|cs|php|rb|swift|scala|vue|svelte)$/i;

/** Build output and vendored dependencies: never cards. The default for `dr analyzer classify`. */
export const VENDOR_EXCLUDE = /(^|\/)(dist|build|node_modules|vendor|\.venv|venv|__pycache__)(\/|$)/;

/**
 * The harness's sampling exclusion: vendor paths plus tests, fixtures, examples and scripts, so
 * labelled card sets are about application code. Tests are not excluded in production, where the
 * Tier-0 test rules file them in the testing layer.
 */
export const SAMPLE_EXCLUDE =
  /(^|\/)(tests?|__tests__|fixtures?|__fixtures__|test-[^/]*|examples?|scripts|dist|node_modules|\.venv|venv)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|(^|\/)conftest\.py$/;

/** Stable card id for a symbol (full, project-prefixed qualified name) within a scope. */
export function cardId(scope: string, qualifiedName: string): string {
  return createHash("sha1").update(`${scope}:${qualifiedName}`).digest("hex").slice(0, 12);
}

/**
 * Whether a node of this label becomes a card: a route with a path, or a symbol in a source file
 * outside `exclude`, leaving out constructors, dunder methods and anonymous functions.
 */
export function isCandidate(node: GraphNode, label: string, exclude: RegExp = VENDOR_EXCLUDE): boolean {
  if (label === "Route") {
    if (!/^__route__[A-Z]+__\//.test(node.name) || /\.(ts|js|py|json)$/.test(node.name)) return false;
    return !(node.file_path && exclude.test(node.file_path));
  }
  if (!node.file_path) return false;
  if (!SOURCE_EXT.test(node.file_path) || node.file_path.startsWith("<")) return false;
  if (exclude.test(node.file_path)) return false;
  if (label === "Method" && /^(constructor|__init__|__str__|__repr__)$/.test(node.name)) return false;
  if (label === "Function" && /^(anonymous|arrow|lambda|<anonymous>)$/i.test(node.name)) return false;
  return true;
}

function lineRange(node: GraphNode): { start: number | null; end: number | null } {
  const s = node.start_line != null ? Number(node.start_line) : null;
  const e = node.end_line != null ? Number(node.end_line) : null;
  if (s != null && !Number.isNaN(s)) return { start: s, end: e != null && !Number.isNaN(e) ? e : null };
  const m = /^(\d+)-(\d+)$/.exec(String(node.lines ?? ""));
  return m ? { start: Number(m[1]), end: Number(m[2]) } : { start: null, end: null };
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim()) return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export interface CardBuilderOptions {
  /** Scope for card ids: a corpus name in the harness, the CBM project in production. */
  scope: string;
  /** Source lines kept per card (default 120). */
  sourceLines?: number;
  /**
   * Absolute path of the indexed codebase. When set, a symbol's source is read from its file by
   * the node's line range, one read per file; CBM's `get_code_snippet` (full source, at most 500
   * lines) is the fallback. Without it every card costs a snippet call, about 15 ms each.
   */
  sourceRoot?: string;
}

/**
 * Builds cards for one project. Holds the per-file handler cache that route-handler resolution
 * fills, so build every card of a run with the same builder.
 */
export class CardBuilder {
  private readonly sourceLines: number;
  private readonly handlerCache = new Map<string, Array<{ qn: string; source: string }>>();
  private readonly fileLines = new Map<string, Promise<string[] | null>>();
  private readonly root: string | null;

  constructor(
    private readonly graph: CardGraph,
    private readonly edges: EdgeIndex,
    private readonly options: CardBuilderOptions
  ) {
    this.sourceLines = options.sourceLines ?? 120;
    this.root = options.sourceRoot ? path.resolve(options.sourceRoot) : null;
  }

  /** A file's lines, read once; null when it is outside the root or unreadable. */
  private lines(file: string): Promise<string[] | null> {
    let cached = this.fileLines.get(file);
    if (!cached) {
      const abs = path.resolve(this.root!, file);
      cached =
        abs === this.root || !abs.startsWith(this.root! + path.sep)
          ? Promise.resolve(null)
          : readFile(abs, "utf-8").then((text) => text.split("\n"), () => null);
      this.fileLines.set(file, cached);
    }
    return cached;
  }

  /**
   * A symbol's source: its line range read from disk when the builder has a root and the node
   * has lines in a readable file, else CBM's snippet.
   */
  private async sourceOf(qn: string, node: { file_path?: unknown; start_line?: unknown; end_line?: unknown; lines?: unknown } | null): Promise<string | null> {
    if (this.root && node && typeof node.file_path === "string" && node.file_path) {
      const { start, end } = lineRange(node as GraphNode);
      if (start !== null && end !== null && start >= 1 && end >= start) {
        const lines = await this.lines(node.file_path);
        if (lines && end <= lines.length) return lines.slice(start - 1, end).join("\n");
      }
    }
    return (await this.graph.snippet(qn))?.source ?? null;
  }

  /** Strip the project prefix from a qualified name. */
  shortQn(qn: string): string {
    const p = this.graph.project;
    return qn.startsWith(p + ".") ? qn.slice(p.length + 1) : qn;
  }

  /**
   * A route's handler when no HANDLES edge names one: the function, in a file with an edge into
   * the route, whose source quotes the route's path (or calls the route's method with it).
   */
  private async resolveRouteHandler(routeName: string): Promise<string | null> {
    const pathPart = routeName.replace(/^__route__[A-Z]+__/, "").replace(/\{\}.*$/, "");
    const method = (/^__route__([A-Z]+)__/.exec(routeName)?.[1] ?? "").toLowerCase();
    const files = new Set<string>();
    for (const qn of this.edges.routeCallers.get(routeName) ?? []) {
      const f = this.edges.qnFile.get(qn);
      if (f) files.add(f);
    }
    for (const file of files) {
      let fns = this.handlerCache.get(file);
      if (!fns) {
        fns = [];
        for (const n of await this.graph.search("Function", file, ["start_line"])) {
          const source = await this.sourceOf(n.qualified_name, n);
          if (source) fns.push({ qn: n.qualified_name, source });
        }
        this.handlerCache.set(file, fns);
      }
      const hit =
        fns.find((f) => f.source.includes(`"${pathPart}`) || f.source.includes(`'${pathPart}`)) ??
        fns.find((f) => method && f.source.includes(`.${method}(`) && f.source.includes(pathPart));
      if (hit) return hit.qn;
    }
    return null;
  }

  private cut(source: string): { source: string; total: number; truncated: boolean } {
    const all = source.split("\n");
    return all.length > this.sourceLines
      ? { source: all.slice(0, this.sourceLines).join("\n"), total: all.length, truncated: true }
      : { source, total: all.length, truncated: false };
  }

  async build(node: GraphNode): Promise<SymbolCard> {
    const { edges } = this;
    const qn = node.qualified_name;
    const short = (s: string) => this.shortQn(s);
    const { start, end } = lineRange(node);
    let source: string | null = null;
    let totalLines: number | null = null;
    let truncated = false;
    let routeHandlerQn: string | null = null;
    if (node.label !== "Route") {
      const text = await this.sourceOf(qn, node);
      if (text) ({ source, total: totalLines, truncated } = this.cut(text));
    } else {
      // A Route borrows its handler's source: by HANDLES edge, else by resolveRouteHandler.
      const direct = (edges.routeHandlers.get(qn) ?? []).filter((h) => edges.qnFile.has(h));
      routeHandlerQn = direct[0] ?? (await this.resolveRouteHandler(qn));
      if (routeHandlerQn) {
        const text = await this.sourceOf(routeHandlerQn, null);
        if (text) ({ source, total: totalLines, truncated } = this.cut(text));
      }
    }
    const callers = (edges.callers.get(qn) ?? []).map(short);
    const callees = (edges.callees.get(qn) ?? []).map(short);
    return {
      // Hashed on the full qualified name, as the labelled card sets were.
      id: cardId(this.options.scope, qn),
      label: node.label,
      name: node.name,
      qualified_name: short(qn),
      file_path: node.file_path || (routeHandlerQn ? edges.qnFile.get(routeHandlerQn) ?? null : null),
      start_line: start,
      end_line: end,
      signature: strOrNull(node.signature),
      docstring: strOrNull(node.docstring),
      is_exported: boolOrNull(node.is_exported),
      is_entry_point: boolOrNull(node.is_entry_point),
      complexity: numOrNull(node.complexity),
      parent_class: node.parent_class ? short(String(node.parent_class)) : null,
      base_classes: strArray(node.base_classes),
      return_type: strOrNull(node.return_type),
      callers: (node.label === "Route" && routeHandlerQn ? [short(routeHandlerQn), ...callers] : callers).slice(0, 12),
      callees: callees.slice(0, 12),
      callers_total: callers.length,
      callees_total: callees.length,
      imports: (node.file_path ? edges.importsByFile.get(node.file_path) ?? [] : []).slice(0, 15),
      env_vars: edges.envVars.get(qn) ?? [],
      routes_handled: node.label === "Route" ? [node.name.replace(/^__route__[A-Z]+__/, "")] : edges.handles.get(qn) ?? [],
      http_calls: (edges.httpCalls.get(qn) ?? []).slice(0, 8),
      inherits: (edges.inherits.get(qn) ?? []).map(short),
      implements: (edges.implements.get(qn) ?? []).map(short),
      route_method: node.label === "Route" ? strOrNull(node.method) : null,
      source,
      source_lines_total: totalLines,
      source_truncated: truncated,
    };
  }
}
