/**
 * The graph neighbourhood every card reads, pulled once per project into adjacency maps keyed by
 * full qualified name.
 */
import type { CardGraph } from "./types.js";

export interface EdgeIndex {
  callers: Map<string, string[]>;
  callees: Map<string, string[]>;
  /** file path -> files (or symbols, when the target has no file) it imports */
  importsByFile: Map<string, string[]>;
  envVars: Map<string, string[]>;
  /** handler -> routes it handles */
  handles: Map<string, string[]>;
  httpCalls: Map<string, string[]>;
  inherits: Map<string, string[]>;
  implements: Map<string, string[]>;
  /** route qualified name -> handler qualified names */
  routeHandlers: Map<string, string[]>;
  /** route qualified name -> symbols or modules with any edge into it */
  routeCallers: Map<string, string[]>;
  /** qualified name -> file path, for every Function and route caller seen with a file */
  qnFile: Map<string, string>;
}

function push(m: Map<string, string[]>, k: string, v: string): void {
  const arr = m.get(k);
  if (arr) {
    if (!arr.includes(v)) arr.push(v);
  } else m.set(k, [v]);
}

export async function buildEdgeIndex(graph: CardGraph): Promise<EdgeIndex> {
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
  for (const [a, b] of await graph.rows("MATCH (a)-[r:CALLS]->(b) RETURN a.qualified_name, b.qualified_name")) {
    if (typeof a !== "string" || typeof b !== "string") continue;
    push(idx.callees, a, b);
    push(idx.callers, b, a);
  }
  for (const [file, b, bfile] of await graph.rows("MATCH (a)-[r:IMPORTS]->(b) RETURN a.file_path, b.qualified_name, b.file_path")) {
    if (typeof file !== "string") continue;
    const target = typeof bfile === "string" && bfile ? bfile : typeof b === "string" ? b : null;
    if (target) push(idx.importsByFile, file, target);
  }
  for (const [a, key] of await graph.rows("MATCH (a)-[r:CONFIGURES]->(e:EnvVar) RETURN a.qualified_name, e.env_key")) {
    if (typeof a === "string" && typeof key === "string") push(idx.envVars, a, key);
  }
  for (const [a, route] of await graph.rows("MATCH (a)-[r:HANDLES]->(x:Route) RETURN a.qualified_name, x.qualified_name")) {
    if (typeof a === "string" && typeof route === "string") {
      push(idx.handles, a, route);
      push(idx.routeHandlers, route, a);
      push(idx.routeCallers, route, a);
    }
  }
  for (const [a, file, route] of await graph.rows("MATCH (a)-[r]->(x:Route) RETURN a.qualified_name, a.file_path, x.qualified_name")) {
    if (typeof a !== "string" || typeof route !== "string") continue;
    push(idx.routeCallers, route, a);
    if (typeof file === "string" && file) idx.qnFile.set(a, file);
  }
  for (const [a, file] of await graph.rows("MATCH (a:Function) RETURN a.qualified_name, a.file_path")) {
    if (typeof a === "string" && typeof file === "string" && file) idx.qnFile.set(a, file);
  }
  for (const [a, route, url] of await graph.rows("MATCH (a)-[r:HTTP_CALLS]->(x:Route) RETURN a.qualified_name, x.name, r.url_path")) {
    if (typeof a === "string") push(idx.httpCalls, a, String(url ?? route ?? ""));
  }
  for (const [a, t, b] of await graph.rows("MATCH (a)-[r:INHERITS|IMPLEMENTS]->(b) RETURN a.qualified_name, type(r), b.qualified_name")) {
    if (typeof a !== "string" || typeof b !== "string") continue;
    push(t === "IMPLEMENTS" ? idx.implements : idx.inherits, a, b);
  }
  return idx;
}
