import { spawnSync } from "node:child_process";
import { StdioClient } from "../../../src/analyzers/stdio-client.js";

/**
 * Thin session over codebase-memory-mcp (CBM) for the eval harness.
 * Uses the CLI's StdioClient but talks to the 0.10.x tool surface directly:
 * search_graph / query_graph / get_code_snippet with format="json".
 */

export interface GraphNode {
  label: string;
  name: string;
  qualified_name: string;
  file_path: string;
  in: number;
  out: number;
  [field: string]: unknown;
}

export interface EdgeIndex {
  callers: Map<string, string[]>;
  callees: Map<string, string[]>;
  importsByFile: Map<string, string[]>;
  envVars: Map<string, string[]>;
  handles: Map<string, string[]>;
  httpCalls: Map<string, string[]>;
  inherits: Map<string, string[]>;
  implements: Map<string, string[]>;
  /** Route name -> handler qualified names */
  routeHandlers: Map<string, string[]>;
  /** Route name -> qualified names of symbols/modules that reference it (CALLS/HTTP_CALLS/HANDLES) */
  routeCallers: Map<string, string[]>;
  /** qualified name -> file path, for every edge endpoint we saw with a file */
  qnFile: Map<string, string>;
}

export function findCbmBinary(): string {
  const which = spawnSync("which", ["codebase-memory-mcp"], { encoding: "utf8" });
  const p = which.stdout.trim();
  if (!p) throw new Error("codebase-memory-mcp not found on PATH");
  return p;
}

export class CbmSession {
  private client = new StdioClient();
  private opened = false;
  project: string | null = null;

  async open(): Promise<void> {
    if (this.opened) return;
    this.client.spawn(findCbmBinary());
    await this.client.initialize({ name: "dr-classify-eval", version: "0.0.1" });
    this.opened = true;
  }

  close(): void {
    if (this.opened) this.client.close();
    this.opened = false;
  }

  async listProjects(): Promise<Array<{ name: string; root_path: string; nodes?: number; edges?: number }>> {
    const r = (await this.client.invokeTool("list_projects", {})) as { projects?: Array<{ name: string; root_path: string; nodes?: number; edges?: number }> };
    return r.projects ?? [];
  }

  /** Resolve (and optionally build) the index for a repository root. */
  async ensureIndexed(root: string, opts: { reindex?: boolean; mode?: "full" | "moderate" | "fast" } = {}): Promise<string> {
    const existing = (await this.listProjects()).find((p) => p.root_path === root);
    if (existing && !opts.reindex) {
      this.project = existing.name;
      return existing.name;
    }
    process.stderr.write(`Indexing ${root} with codebase-memory-mcp (${opts.mode ?? "full"})...\n`);
    const r = (await this.client.invokeTool("index_repository", { repo_path: root, mode: opts.mode ?? "full" }, { timeout: 20 * 60 * 1000 })) as Record<string, unknown>;
    process.stderr.write(`Indexed: nodes=${String(r.nodes)} edges=${String(r.edges)}\n`);
    const after = (await this.listProjects()).find((p) => p.root_path === root);
    if (!after) throw new Error(`Project not listed after indexing: ${root}`);
    this.project = after.name;
    return after.name;
  }

  private requireProject(): string {
    if (!this.project) throw new Error("No project selected; call ensureIndexed first");
    return this.project;
  }

  /** Strip the project prefix from a qualified name. */
  shortQn(qn: string): string {
    const p = this.requireProject();
    return qn.startsWith(p + ".") ? qn.slice(p.length + 1) : qn;
  }

  /** Paginated search_graph → flat node list with requested fields. */
  async searchAll(label: string, filePattern: string | undefined, fields: string[], pageSize = 500): Promise<GraphNode[]> {
    const project = this.requireProject();
    const out: GraphNode[] = [];
    let offset = 0;
    for (;;) {
      const r = (await this.client.invokeTool(
        "search_graph",
        { project, label, file_pattern: filePattern, fields, limit: pageSize, offset, format: "json" },
        { timeout: 120000 },
      )) as { cols: string[]; groups: Array<{ qn_prefix: string; file: string; rows: unknown[][] }>; has_more?: boolean; total?: number; count?: number };
      const cols = r.cols ?? [];
      let got = 0;
      for (const g of r.groups ?? []) {
        for (const row of g.rows) {
          got++;
          const node: Record<string, unknown> = {};
          cols.forEach((c, i) => (node[c] = row[i]));
          const name = String(node.name ?? "");
          out.push({
            ...node,
            label: String(node.label ?? label),
            name,
            qualified_name: g.qn_prefix ? `${g.qn_prefix}.${name}` : name,
            file_path: g.file ?? "",
            in: Number(node.in ?? 0),
            out: Number(node.out ?? 0),
          } as GraphNode);
        }
      }
      if (!r.has_more || got === 0) break;
      offset += got;
    }
    return out;
  }

  /** Cypher via query_graph with format=json → rows. */
  async query(cypher: string): Promise<unknown[][]> {
    const project = this.requireProject();
    const r = (await this.client.invokeTool("query_graph", { project, query: cypher, format: "json" }, { timeout: 180000 })) as { rows?: unknown[][] };
    return r.rows ?? [];
  }

  async snippet(qualifiedName: string): Promise<{ source: string; start_line?: number; end_line?: number } | null> {
    const project = this.requireProject();
    const r = (await this.client.invokeTool("get_code_snippet", { project, qualified_name: qualifiedName }, { timeout: 60000 })) as {
      source?: string;
      start_line?: number;
      end_line?: number;
      error?: string;
      suggestions?: unknown;
    };
    if (!r || typeof r !== "object" || typeof r.source !== "string") return null;
    return { source: r.source, start_line: r.start_line, end_line: r.end_line };
  }

  /** Pull the edge types the cards need, once, into adjacency maps keyed by qualified name. */
  async buildEdgeIndex(): Promise<EdgeIndex> {
    const idx: EdgeIndex = {
      callers: new Map(),
      callees: new Map(),
      importsByFile: new Map(),
      envVars: new Map(),
      handles: new Map(),
      httpCalls: new Map(),
      inherits: new Map(),
      implements: new Map(),
      routeHandlers: new Map(),
      routeCallers: new Map(),
      qnFile: new Map(),
    };
    const push = (m: Map<string, string[]>, k: string, v: string) => {
      const arr = m.get(k);
      if (arr) {
        if (!arr.includes(v)) arr.push(v);
      } else m.set(k, [v]);
    };
    for (const [a, b] of await this.query("MATCH (a)-[r:CALLS]->(b) RETURN a.qualified_name, b.qualified_name")) {
      if (typeof a !== "string" || typeof b !== "string") continue;
      push(idx.callees, a, b);
      push(idx.callers, b, a);
    }
    for (const [file, b, bfile] of await this.query("MATCH (a)-[r:IMPORTS]->(b) RETURN a.file_path, b.qualified_name, b.file_path")) {
      if (typeof file !== "string") continue;
      const target = typeof bfile === "string" && bfile ? bfile : typeof b === "string" ? b : null;
      if (target) push(idx.importsByFile, file, target);
    }
    for (const [a, key] of await this.query("MATCH (a)-[r:CONFIGURES]->(e:EnvVar) RETURN a.qualified_name, e.env_key")) {
      if (typeof a === "string" && typeof key === "string") push(idx.envVars, a, key);
    }
    for (const [a, route] of await this.query("MATCH (a)-[r:HANDLES]->(x:Route) RETURN a.qualified_name, x.qualified_name")) {
      if (typeof a === "string" && typeof route === "string") {
        push(idx.handles, a, route);
        push(idx.routeHandlers, route, a);
        push(idx.routeCallers, route, a);
      }
    }
    for (const [a, file, route] of await this.query("MATCH (a)-[r]->(x:Route) RETURN a.qualified_name, a.file_path, x.qualified_name")) {
      if (typeof a !== "string" || typeof route !== "string") continue;
      push(idx.routeCallers, route, a);
      if (typeof file === "string" && file) idx.qnFile.set(a, file);
    }
    for (const [a, file] of await this.query("MATCH (a:Function) RETURN a.qualified_name, a.file_path")) {
      if (typeof a === "string" && typeof file === "string" && file) idx.qnFile.set(a, file);
    }
    for (const [a, route, url] of await this.query("MATCH (a)-[r:HTTP_CALLS]->(x:Route) RETURN a.qualified_name, x.name, r.url_path")) {
      if (typeof a === "string") push(idx.httpCalls, a, String(url ?? route ?? ""));
    }
    for (const [a, t, b] of await this.query("MATCH (a)-[r:INHERITS|IMPLEMENTS]->(b) RETURN a.qualified_name, type(r), b.qualified_name")) {
      if (typeof a !== "string" || typeof b !== "string") continue;
      push(t === "IMPLEMENTS" ? idx.implements : idx.inherits, a, b);
    }
    return idx;
  }
}
