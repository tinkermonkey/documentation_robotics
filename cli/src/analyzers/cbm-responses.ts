/**
 * codebase-memory-mcp (CBM) response contract
 *
 * Every CBM tool call made by the analyzer goes through {@link CbmTools}. It asks for JSON
 * (`format: "json"`; CBM 0.11+ answers in text otherwise), follows the result pages, turns
 * error payloads into errors, and normalises each tool's JSON into the shapes the analyzer
 * works with. Two response generations are accepted:
 *
 * - CBM 0.11 / 0.12 (grouped, paged):
 *   - search_graph: `{ cols, groups: [{ qn_prefix, file, rows }], has_more, next_offset }`
 *   - query_graph:  `{ columns, rows, has_more, next_cursor, next_offset }`
 *   - trace_path:   `{ callers|callees: { cols: [name, hop], groups: [{ qn_prefix, rows }] }, next_cursor }`
 *   - list_projects: `{ projects: [{ name, root_path }], has_more }`
 * - CBM 0.10 and earlier (flat): search_graph `{ results | nodes: [...] }`, trace_path
 *   `{ nodes, edges }`, query_graph `{ columns, rows }` (or `{ records }`), list_projects
 *   `{ projects }`. These pass through unchanged and are never paged.
 *
 * A grouped row's qualified name is `qn_prefix ? qn_prefix + "." + name : name` (the
 * response's own `qn_rule`); the row's `name` is that qualified-name suffix, which is the
 * symbol name for code nodes but only a fragment for Route nodes, whose path lives in the
 * qualified name (`__route__GET__/vets.html`).
 */

import * as path from "path";
import { CLIError, ErrorCategory } from "../utils/errors.js";

/**
 * A CBM file path relative to the codebase root. CBM stores repository-relative paths
 * (0.10 and 0.12 alike); absolute ones are relativised, relative ones kept as they are.
 * `path.relative` alone would resolve a relative path against the process cwd.
 */
export function relativeToRoot(codebaseRoot: string | undefined, filePath: string): string {
  if (!filePath || !codebaseRoot || !path.isAbsolute(filePath)) return filePath;
  return path.relative(codebaseRoot, filePath);
}

/** Graph node in the shape the analyzer consumes (same as CBM 0.10's flat search results). */
export interface CbmGraphNode {
  id?: string;
  name?: string;
  qualified_name?: string;
  label: string;
  file_path?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CbmProject {
  name: string;
  root_path: string;
  [key: string]: unknown;
}

export interface QueryGraphResult {
  columns: string[];
  rows: unknown[][];
}

/** Call-graph node from trace_path; `depth` is the hop count from the traced symbol. */
export interface TraceNode {
  id?: string;
  qualified_name?: string;
  name?: string;
  file_path?: string;
  source_symbol?: string;
  depth?: number;
  [key: string]: unknown;
}

export interface TraceEdge {
  from_node: string;
  to_node: string;
  type?: string;
  [key: string]: unknown;
}

export interface TraceResult {
  nodes: TraceNode[];
  edges: TraceEdge[];
  /** "grouped" for CBM 0.11+ (no per-edge types, no file paths), "flat" for 0.10. */
  shape: "grouped" | "flat";
}

/** Handler of a Route, from a `(f)-[:HANDLES]->(r:Route)` query. */
export interface RouteHandler {
  route_qualified_name: string;
  qualified_name: string;
  name: string;
  file_path?: string;
  start_line?: number;
  end_line?: number;
}

/** Minimal client surface; StdioClient satisfies it. */
export interface CbmToolInvoker {
  invokeTool(name: string, args?: unknown, options?: { timeout?: number }): Promise<unknown>;
}

/** CBM answered a tool call with an error (bad Cypher, unknown symbol, failed index, ...). */
export class CbmToolError extends CLIError {
  constructor(
    public readonly tool: string,
    public readonly detail: string,
    public readonly hint?: string
  ) {
    super(
      `codebase-memory-mcp ${tool} failed: ${detail}`,
      ErrorCategory.SYSTEM,
      hint ? [hint] : undefined
    );
    this.name = "CbmToolError";
  }
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Page sizes: the largest each tool accepts, so most results arrive in one page. */
const SEARCH_PAGE = 500;
const QUERY_PAGE = 5000;
const TRACE_PAGE = 5000;
const PROJECTS_PAGE = 500;
/** Lifts CBM's default 3,200-token output budget, which otherwise truncates a page early. */
const MAX_OUTPUT_TOKENS = 1_000_000;
/** Guard against a server that keeps reporting has_more without advancing. */
const MAX_PAGES = 1000;

/**
 * Throw if a tool result is an error payload. Since we always ask for JSON, a bare string is
 * an error message (CBM 0.12 sends Cypher errors as text); objects carry `error` or
 * `status: "error"` with an optional `hint`.
 */
export function assertToolResult(tool: string, raw: unknown): void {
  if (typeof raw === "string") {
    throw new CbmToolError(tool, raw.trim() || "empty response");
  }
  if (!isObj(raw)) return;
  const hint = typeof raw.hint === "string" ? raw.hint : undefined;
  if (typeof raw.error === "string") {
    throw new CbmToolError(tool, raw.error, hint);
  }
  if (raw.status === "error") {
    throw new CbmToolError(tool, typeof raw.message === "string" ? raw.message : "status: error", hint);
  }
}

/** Qualified name from a grouped row (the response's qn_rule). */
export function groupedQualifiedName(prefix: unknown, name: string): string {
  return typeof prefix === "string" && prefix !== "" ? `${prefix}.${name}` : name;
}

const ROUTE_QN_RE = /^__route__([A-Z]+)__(.*)$/;

/** Parse "12-30" into start/end lines. */
function parseLines(lines: unknown): { start_line?: number; end_line?: number } {
  if (typeof lines !== "string") return {};
  const m = lines.match(/^(\d+)-(\d+)$/);
  return m ? { start_line: Number(m[1]), end_line: Number(m[2]) } : {};
}

/** Paging cursor fields shared by the grouped tools. */
interface PageInfo {
  hasMore: boolean;
  nextOffset?: number;
  nextCursor?: string;
}

function pageInfo(raw: Obj): PageInfo {
  return {
    hasMore: raw.has_more === true,
    nextOffset: typeof raw.next_offset === "number" ? raw.next_offset : undefined,
    nextCursor:
      typeof raw.next_cursor === "string"
        ? raw.next_cursor
        : typeof raw.next === "string"
          ? raw.next
          : undefined,
  };
}

/**
 * Normalise one search_graph page into analyzer nodes.
 *
 * Grouped rows become `{ name, qualified_name, label, file_path, properties }` where
 * properties carry `name`, `start_line`/`end_line` (from `lines`), `fan_in`/`fan_out`
 * (from `in`/`out`) and any extra `fields` columns. Route nodes get the path from their
 * qualified name as `name` and the method as `properties.method` when absent, matching
 * how CBM stores them (name `/vets`, qualified name `__route__GET__/vets`).
 */
export function normalizeSearchGraph(raw: unknown): { nodes: CbmGraphNode[] } & PageInfo {
  if (!isObj(raw)) {
    throw new CLIError("Invalid response from search_graph", ErrorCategory.SYSTEM, [
      "Ensure codebase-memory-mcp is properly installed and functional",
    ]);
  }

  // CBM 0.10 and earlier: flat node arrays.
  const flat = raw.results ?? raw.nodes;
  if (Array.isArray(flat)) {
    return { nodes: flat as CbmGraphNode[], hasMore: false };
  }

  if (!Array.isArray(raw.groups) || !Array.isArray(raw.cols)) {
    throw new CLIError("Invalid response from search_graph: no results", ErrorCategory.SYSTEM, [
      `Expected 'groups' (CBM 0.11+) or 'results'/'nodes' (CBM 0.10), got keys: ${Object.keys(raw).join(", ") || "(none)"}`,
      "Ensure codebase-memory-mcp is properly installed and returning valid results",
    ]);
  }

  const cols = raw.cols as string[];
  const nodes: CbmGraphNode[] = [];
  for (const group of raw.groups as Obj[]) {
    const file = typeof group.file === "string" && group.file !== "" ? group.file : undefined;
    for (const row of (group.rows ?? []) as unknown[][]) {
      const cell: Obj = {};
      cols.forEach((c, i) => (cell[c] = row[i]));
      const rowName = String(cell.name ?? "");
      const qualifiedName = groupedQualifiedName(group.qn_prefix, rowName);
      const label = String(cell.label ?? "");

      const properties: Obj = {};
      for (const [k, v] of Object.entries(cell)) {
        if (k === "name" || k === "label" || k === "lines" || k === "in" || k === "out") continue;
        if (v !== null && v !== undefined) properties[k] = v;
      }
      Object.assign(properties, parseLines(cell.lines));
      if (typeof cell.in === "number") properties.fan_in = cell.in;
      if (typeof cell.out === "number") properties.fan_out = cell.out;

      let name = rowName;
      const route = label === "Route" ? qualifiedName.match(ROUTE_QN_RE) : null;
      // The method stays in the qualified name, where the analyzer reads it
      if (route) name = route[2];
      properties.name = name;

      nodes.push({ name, qualified_name: qualifiedName, label, file_path: file, properties });
    }
  }
  return { nodes, ...pageInfo(raw) };
}

/** Normalise one query_graph page. Accepts `{ columns, rows }` and the legacy `{ records }`. */
export function normalizeQueryGraph(raw: unknown): QueryGraphResult & PageInfo {
  if (!isObj(raw)) {
    throw new CLIError("Invalid response from query_graph", ErrorCategory.SYSTEM, [
      "Ensure codebase-memory-mcp is properly installed and functional",
    ]);
  }
  if (Array.isArray(raw.columns) && Array.isArray(raw.rows)) {
    return { columns: raw.columns as string[], rows: raw.rows as unknown[][], ...pageInfo(raw) };
  }
  if (Array.isArray(raw.records)) {
    const records = raw.records as Obj[];
    const columns = Array.from(new Set(records.flatMap((r) => Object.keys(r))));
    return { columns, rows: records.map((r) => columns.map((c) => r[c])), hasMore: false };
  }
  throw new CLIError("Invalid response from query_graph: no columns/rows", ErrorCategory.SYSTEM, [
    `Got keys: ${Object.keys(raw).join(", ") || "(none)"}`,
  ]);
}

/** query_graph rows as objects keyed by column name (use `AS` aliases for clean keys). */
export function queryRecords(result: QueryGraphResult): Array<Record<string, unknown>> {
  return result.rows.map((row) => {
    const rec: Record<string, unknown> = {};
    result.columns.forEach((c, i) => (rec[c] = row[i]));
    return rec;
  });
}

/** Number from a query_graph cell (CBM 0.12 returns integers as strings). */
export function cellNumber(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** String from a query_graph cell; empty strings and nulls become undefined. */
export function cellString(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** First label from a `labels(n)` cell (CBM 0.12 returns it as a JSON string `["Route"]`). */
export function cellLabel(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  if (typeof v !== "string" || v === "") return undefined;
  if (v.startsWith("[")) {
    try {
      const parsed = JSON.parse(v) as unknown;
      return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : undefined;
    } catch {
      return undefined;
    }
  }
  return v;
}

/**
 * RETURN clause yielding the columns {@link nodesFromQuery} reads, for node variable `v`.
 * CBM 0.12 returns only the name for a bare `RETURN n`, so node queries spell the columns out.
 */
export function nodeColumns(v: string): string {
  return (
    `${v}.name AS name, ${v}.qualified_name AS qualified_name, ${v}.file_path AS file_path, ` +
    `${v}.start_line AS start_line, ${v}.end_line AS end_line, labels(${v}) AS label`
  );
}

/**
 * Graph nodes from a query_graph result whose columns come from {@link nodeColumns}.
 * A legacy `{ records: [{ n: {...node} }] }` result (one node object per record) is
 * passed through.
 */
export function nodesFromQuery(result: QueryGraphResult): CbmGraphNode[] {
  return queryRecords(result).flatMap((r) => {
    if (result.columns.length === 1 && isObj(r[result.columns[0]])) {
      return [r[result.columns[0]] as CbmGraphNode];
    }
    const name = cellString(r.name);
    if (!name) return [];
    const properties: Obj = { name };
    const start = cellNumber(r.start_line);
    const end = cellNumber(r.end_line);
    if (start !== undefined) properties.start_line = start;
    if (end !== undefined) properties.end_line = end;
    return [
      {
        name,
        qualified_name: cellString(r.qualified_name),
        label: cellLabel(r.label) ?? "",
        file_path: cellString(r.file_path),
        properties,
      },
    ];
  });
}

/**
 * Normalise one trace_path page into call-graph nodes.
 *
 * Returns null when the response holds no call graph in either shape, which is how a
 * backend without trace_path support answers; callers fall back to a Cypher CALLS query.
 */
export function normalizeTracePath(
  raw: unknown,
  direction: "inbound" | "outbound"
): (TraceResult & PageInfo) | null {
  if (!isObj(raw)) {
    throw new CLIError("Invalid response from trace_path", ErrorCategory.SYSTEM, [
      "Ensure codebase-memory-mcp is properly installed and functional",
    ]);
  }
  if (Array.isArray(raw.nodes)) {
    return {
      nodes: raw.nodes as TraceNode[],
      edges: Array.isArray(raw.edges) ? (raw.edges as TraceEdge[]) : [],
      shape: "flat",
      hasMore: false,
    };
  }

  const section = raw[direction === "inbound" ? "callers" : "callees"];
  if (!isObj(section) || !Array.isArray(section.groups)) return null;
  const cols = Array.isArray(section.cols) ? (section.cols as string[]) : ["name", "hop"];
  const nameIdx = cols.indexOf("name");
  const hopIdx = cols.indexOf("hop");
  const nodes: TraceNode[] = [];
  for (const group of section.groups as Obj[]) {
    for (const row of (group.rows ?? []) as unknown[][]) {
      const name = String(row[nameIdx >= 0 ? nameIdx : 0] ?? "");
      const hop = hopIdx >= 0 ? cellNumber(row[hopIdx]) : undefined;
      const qualifiedName = groupedQualifiedName(group.qn_prefix, name);
      nodes.push({
        id: qualifiedName,
        qualified_name: qualifiedName,
        name,
        source_symbol: name,
        depth: hop ?? 1,
      });
    }
  }
  const sectionPage = pageInfo(section);
  const topPage = pageInfo(raw);
  return {
    nodes,
    edges: [],
    shape: "grouped",
    hasMore: topPage.hasMore || sectionPage.hasMore,
    nextCursor: topPage.nextCursor ?? sectionPage.nextCursor,
  };
}

/** Normalise one list_projects page. */
export function normalizeListProjects(raw: unknown): { projects: CbmProject[] } & PageInfo {
  if (!isObj(raw)) {
    throw new CLIError("Invalid response from list_projects", ErrorCategory.SYSTEM, [
      "Ensure codebase-memory-mcp is properly installed and functional",
    ]);
  }
  // No projects array means nothing is indexed yet.
  const projects = Array.isArray(raw.projects) ? (raw.projects as CbmProject[]) : [];
  return { projects, ...pageInfo(raw) };
}

/**
 * Attach HANDLES-edge handlers to Route nodes.
 *
 * CBM Route nodes carry only `{ method, source }`; the handler, its symbol, its lines and
 * often the file come from the function that HANDLES the route. CBM keys a Route by method
 * and path, so routers mounted under different prefixes can share one Route node with
 * several handlers (fastapi's `GET /{}` is handled by both `users.read_user_by_id` and
 * `items.read_item`): such a route becomes one node per handler, each with the handler's
 * file. A route with a single handler keeps its own values where it has them.
 */
export function attachRouteHandlers(nodes: CbmGraphNode[], handlers: RouteHandler[]): CbmGraphNode[] {
  const byRoute = new Map<string, RouteHandler[]>();
  for (const h of handlers) {
    const list = byRoute.get(h.route_qualified_name) ?? [];
    if (!list.some((x) => x.qualified_name === h.qualified_name)) list.push(h);
    byRoute.set(h.route_qualified_name, list);
  }
  return nodes.flatMap((node) => {
    const list = byRoute.get(String(node.qualified_name ?? "")) ?? [];
    if (list.length === 0) return [node];
    const shared = list.length > 1;
    return list.map((h) => {
      const properties: Obj = { ...(node.properties ?? {}) };
      properties.handler_name ??= h.qualified_name;
      properties.symbol ??= h.name;
      if (h.start_line !== undefined) properties.start_line ??= h.start_line;
      if (h.end_line !== undefined) properties.end_line ??= h.end_line;
      const file = shared ? h.file_path || node.file_path : node.file_path || h.file_path;
      return { ...node, file_path: file, properties };
    });
  });
}

/** Cypher returning every Route handler as {@link RouteHandler} columns. */
export const ROUTE_HANDLERS_QUERY =
  "MATCH (f)-[:HANDLES]->(r:Route) RETURN r.qualified_name AS route_qualified_name, " +
  "f.qualified_name AS qualified_name, f.name AS name, f.file_path AS file_path, " +
  "f.start_line AS start_line, f.end_line AS end_line";

export function routeHandlersFromQuery(result: QueryGraphResult): RouteHandler[] {
  return queryRecords(result).flatMap((r) => {
    const route = cellString(r.route_qualified_name);
    const qn = cellString(r.qualified_name);
    if (!route || !qn) return [];
    return [
      {
        route_qualified_name: route,
        qualified_name: qn,
        name: cellString(r.name) ?? qn.slice(qn.lastIndexOf(".") + 1),
        file_path: cellString(r.file_path),
        start_line: cellNumber(r.start_line),
        end_line: cellNumber(r.end_line),
      },
    ];
  });
}

/**
 * Paged, normalised access to the CBM tools.
 *
 * All calls add `format: "json"`; CBM 0.10 ignores the argument.
 */
export class CbmTools {
  constructor(private readonly client: CbmToolInvoker) {}

  /** One JSON tool call, with error payloads raised as {@link CbmToolError}. */
  async call(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const raw = await this.client.invokeTool(tool, { ...args, format: "json" });
    assertToolResult(tool, raw);
    return raw;
  }

  async listProjects(): Promise<CbmProject[]> {
    const projects: CbmProject[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = normalizeListProjects(
        await this.call("list_projects", { limit: PROJECTS_PAGE, offset })
      );
      projects.push(...res.projects);
      const next = res.nextOffset ?? offset + res.projects.length;
      if (!res.hasMore || next <= offset) break;
      offset = next;
    }
    return projects;
  }

  /** search_graph across every page. */
  async searchGraph(args: Record<string, unknown>): Promise<CbmGraphNode[]> {
    const nodes: CbmGraphNode[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = normalizeSearchGraph(
        await this.call("search_graph", {
          ...args,
          limit: SEARCH_PAGE,
          offset,
          max_output_tokens: MAX_OUTPUT_TOKENS,
        })
      );
      nodes.push(...res.nodes);
      if (!res.hasMore || res.nextOffset === undefined || res.nextOffset <= offset) break;
      offset = res.nextOffset;
    }
    return nodes;
  }

  /** query_graph across every page (cursor continuation, offset as fallback). */
  async queryGraph(query: string, project: string): Promise<QueryGraphResult> {
    const base = { query, project, max_rows: QUERY_PAGE, max_output_tokens: MAX_OUTPUT_TOKENS };
    let res = normalizeQueryGraph(await this.call("query_graph", base));
    const columns = res.columns;
    const rows = [...res.rows];
    let offset = 0;
    for (let page = 1; page < MAX_PAGES && res.hasMore; page++) {
      if (res.nextCursor) {
        res = normalizeQueryGraph(await this.call("query_graph", { ...base, cursor: res.nextCursor }));
      } else if (res.nextOffset !== undefined && res.nextOffset > offset) {
        offset = res.nextOffset;
        res = normalizeQueryGraph(await this.call("query_graph", { ...base, offset }));
      } else {
        break;
      }
      rows.push(...res.rows);
    }
    return { columns, rows };
  }

  /**
   * trace_path across every page. Depth is raised to CBM's minimum of 1. Returns null when
   * the backend's response holds no call graph (see {@link normalizeTracePath}).
   */
  async tracePath(args: {
    function_name: string;
    direction: "inbound" | "outbound";
    depth: number;
    project: string;
  }): Promise<TraceResult | null> {
    const base = {
      ...args,
      depth: Math.max(1, args.depth),
      limit: TRACE_PAGE,
      max_output_tokens: MAX_OUTPUT_TOKENS,
    };
    let res = normalizeTracePath(await this.call("trace_path", base), args.direction);
    if (!res) return null;
    const { shape } = res;
    const nodes = [...res.nodes];
    const edges = [...res.edges];
    for (let page = 1; page < MAX_PAGES && res.hasMore && res.nextCursor; page++) {
      res = normalizeTracePath(
        await this.call("trace_path", { ...base, cursor: res.nextCursor }),
        args.direction
      );
      if (!res) break;
      nodes.push(...res.nodes);
      edges.push(...res.edges);
    }
    return { nodes, edges, shape };
  }

  /**
   * File path of each qualified name, for trace_path results (which carry none since 0.11).
   * Names containing quotes or backslashes are skipped rather than escaped.
   */
  async filePathsOf(qualifiedNames: string[], project: string): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const safe = Array.from(new Set(qualifiedNames)).filter((q) => q && !/["'\\]/.test(q));
    for (let i = 0; i < safe.length; i += 200) {
      const list = safe.slice(i, i + 200).map((q) => `"${q}"`).join(", ");
      const result = await this.queryGraph(
        `MATCH (n) WHERE n.qualified_name IN [${list}] RETURN n.qualified_name AS qualified_name, n.file_path AS file_path`,
        project
      );
      for (const r of queryRecords(result)) {
        const qn = cellString(r.qualified_name);
        const file = cellString(r.file_path);
        if (qn && file && !files.has(qn)) files.set(qn, file);
      }
    }
    return files;
  }

  /** index_repository; returns the node/edge counts when CBM reports them. */
  async indexRepository(repoPath: string): Promise<{ nodes?: number; edges?: number; [k: string]: unknown }> {
    const raw = await this.call("index_repository", { repo_path: repoPath });
    if (!isObj(raw)) {
      throw new CLIError("Invalid response from index_repository", ErrorCategory.SYSTEM, [
        "Ensure codebase-memory-mcp is properly installed and functional",
      ]);
    }
    return raw;
  }
}
