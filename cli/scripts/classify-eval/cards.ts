/**
 * Build symbol "state cards" for a corpus from the codebase-memory graph.
 *
 *   bun cards.ts --corpus dr-cli --root /abs/path/to/cli --include "src/**" --limit 300
 *
 * Flags:
 *   --corpus <name>         dataset name (data/<name>/cards.jsonl)
 *   --root <abs path>       repository root to index / already indexed
 *   --include <glob>        search_graph file_pattern (default: all files)
 *   --exclude <regex>       drop files matching (default: test/fixture paths)
 *   --labels a,b,c          CBM labels to sample (default Class,Interface,Function,Method,Module,Route)
 *   --limit <n>             max cards (default 300), balanced round-robin across labels
 *   --seed <n>              sampling seed (default 42)
 *   --source-lines <n>      max source lines stored per card (default 120)
 *   --reindex               force re-indexing with CBM
 *   --mode full|moderate|fast  CBM index mode when indexing (default full)
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { CbmSession, type EdgeIndex, type GraphNode } from "./lib/cbm.js";
import { corpusDir, flagNum, flagStr, parseFlags, seededRandom, shuffle, writeJson, writeJsonl } from "./lib/io.js";
import type { Card } from "./lib/types.js";

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rs|cs|php|rb|swift|scala|vue|svelte)$/i;
const DEFAULT_EXCLUDE = /(^|\/)(tests?|__tests__|fixtures?|__fixtures__|test-[^/]*|examples?|scripts|dist|node_modules|\.venv|venv)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|(^|\/)conftest\.py$/;
const FIELDS: Record<string, string[]> = {
  Class: ["docstring", "base_classes", "is_exported", "is_entry_point", "complexity", "start_line", "end_line"],
  Interface: ["docstring", "base_classes", "is_exported", "start_line", "end_line"],
  Function: ["signature", "docstring", "is_exported", "is_entry_point", "complexity", "return_type", "start_line", "end_line"],
  Method: ["signature", "docstring", "parent_class", "is_exported", "is_entry_point", "complexity", "return_type", "start_line", "end_line"],
  Module: ["is_entry_point", "is_exported", "lines", "start_line", "end_line"],
  Route: ["method", "source"],
};

function cardId(corpus: string, qn: string): string {
  return createHash("sha1").update(`${corpus}:${qn}`).digest("hex").slice(0, 12);
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

const handlerCache = new Map<string, Array<{ qn: string; source: string }>>();

/** Find the function whose source declares the route path, among functions in files that reference the route. */
async function resolveRouteHandler(cbm: CbmSession, routeName: string, edges: EdgeIndex): Promise<string | null> {
  const pathPart = routeName.replace(/^__route__[A-Z]+__/, "").replace(/\{\}.*$/, "");
  const method = (/^__route__([A-Z]+)__/.exec(routeName)?.[1] ?? "").toLowerCase();
  const files = new Set<string>();
  for (const qn of edges.routeCallers.get(routeName) ?? []) {
    const f = edges.qnFile.get(qn);
    if (f) files.add(f);
  }
  for (const file of files) {
    let fns = handlerCache.get(file);
    if (!fns) {
      fns = [];
      for (const n of await cbm.searchAll("Function", file, ["start_line"])) {
        const snip = await cbm.snippet(n.qualified_name).catch(() => null);
        if (snip?.source) fns.push({ qn: n.qualified_name, source: snip.source });
      }
      handlerCache.set(file, fns);
    }
    const hit = fns.find((f) => f.source.includes(`"${pathPart}`) || f.source.includes(`'${pathPart}`)) ?? fns.find((f) => method && f.source.includes(`.${method}(`) && f.source.includes(pathPart));
    if (hit) return hit.qn;
  }
  return null;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const corpus = flagStr(flags, "corpus");
  const root = flagStr(flags, "root");
  if (!corpus || !root) {
    console.error("Usage: bun cards.ts --corpus <name> --root <abs path> [--include glob] [--limit n]");
    process.exit(2);
  }
  const include = flagStr(flags, "include");
  const excludeRe = flags.exclude ? new RegExp(String(flags.exclude)) : DEFAULT_EXCLUDE;
  const labels = (flagStr(flags, "labels", "Class,Interface,Function,Method,Module,Route") ?? "").split(",").map((s) => s.trim());
  const limit = flagNum(flags, "limit", 300);
  const seed = flagNum(flags, "seed", 42);
  const sourceLines = flagNum(flags, "source-lines", 120);
  const maxPerFile = flagNum(flags, "max-per-file", 6);
  const rnd = seededRandom(seed);

  const absRoot = path.resolve(root);
  const cbm = new CbmSession();
  await cbm.open();
  try {
    const project = await cbm.ensureIndexed(absRoot, { reindex: !!flags.reindex, mode: (flagStr(flags, "mode") as "full" | "moderate" | "fast" | undefined) ?? "full" });
    process.stderr.write(`Project: ${project}\n`);
    const edges: EdgeIndex = await cbm.buildEdgeIndex();
    process.stderr.write(`Edges: calls=${edges.callees.size} imports(files)=${edges.importsByFile.size} env=${edges.envVars.size} handles=${edges.handles.size} http=${edges.httpCalls.size}\n`);

    // Collect candidates per label
    const perLabel = new Map<string, GraphNode[]>();
    for (const label of labels) {
      const nodes = await cbm.searchAll(label, include, FIELDS[label] ?? []);
      const kept = nodes.filter((n) => {
        if (label === "Route") return /^__route__[A-Z]+__\//.test(n.name) && !/\.(ts|js|py|json)$/.test(n.name);
        if (!n.file_path) return false;
        if (!SOURCE_EXT.test(n.file_path) || n.file_path.startsWith("<")) return false;
        if (excludeRe.test(n.file_path)) return false;
        if (label === "Method" && /^(constructor|__init__|__str__|__repr__)$/.test(n.name)) return false;
        if (label === "Function" && /^(anonymous|arrow|lambda|<anonymous>)$/i.test(n.name)) return false;
        return true;
      });
      perLabel.set(label, shuffle(kept, rnd));
      process.stderr.write(`${label}: ${nodes.length} nodes, ${kept.length} after filters\n`);
    }

    // Balanced round-robin sampling up to limit, capped per file for diversity
    const selected: GraphNode[] = [];
    const perFile = new Map<string, number>();
    const queues = labels.map((l) => perLabel.get(l) ?? []);
    const cursors = labels.map(() => 0);
    while (selected.length < limit) {
      let progressed = false;
      for (let i = 0; i < queues.length && selected.length < limit; i++) {
        const q = queues[i];
        while (cursors[i] < q.length) {
          const cand = q[cursors[i]++];
          const key = cand.file_path || "(none)";
          const used = perFile.get(key) ?? 0;
          if (cand.label !== "Route" && used >= maxPerFile) continue;
          perFile.set(key, used + 1);
          selected.push(cand);
          progressed = true;
          break;
        }
      }
      if (!progressed) break;
    }
    process.stderr.write(`Selected ${selected.length} cards\n`);

    const cards: Card[] = [];
    let i = 0;
    for (const node of selected) {
      i++;
      if (i % 25 === 0) process.stderr.write(`  snippets ${i}/${selected.length}\n`);
      const qn = node.qualified_name;
      const short = (s: string) => cbm.shortQn(s);
      const { start, end } = lineRange(node);
      let source: string | null = null;
      let totalLines: number | null = null;
      let truncated = false;
      let routeHandlerQn: string | null = null;
      if (node.label !== "Route") {
        const snip = await cbm.snippet(qn).catch(() => null);
        if (snip?.source) {
          const all = snip.source.split("\n");
          totalLines = all.length;
          if (all.length > sourceLines) {
            source = all.slice(0, sourceLines).join("\n");
            truncated = true;
          } else source = snip.source;
        }
      } else {
        // Route: borrow the handler's source. Prefer HANDLES edges; otherwise find a
        // function in a file that references the route whose source mentions the path.
        const direct = (edges.routeHandlers.get(node.qualified_name) ?? []).filter((h) => edges.qnFile.has(h));
        let handlerQn: string | null = direct[0] ?? null;
        if (!handlerQn) handlerQn = await resolveRouteHandler(cbm, node.qualified_name, edges);
        if (handlerQn) {
          routeHandlerQn = handlerQn;
          const snip = await cbm.snippet(handlerQn).catch(() => null);
          if (snip?.source) {
            const all = snip.source.split("\n");
            totalLines = all.length;
            source = all.slice(0, sourceLines).join("\n");
            truncated = all.length > sourceLines;
          }
        }
      }
      const callers = (edges.callers.get(qn) ?? []).map(short);
      const callees = (edges.callees.get(qn) ?? []).map(short);
      const card: Card = {
        id: cardId(corpus, qn),
        corpus,
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
      cards.push(card);
    }

    const dir = corpusDir(corpus);
    writeJsonl(path.join(dir, "cards.jsonl"), cards);
    const byLabel: Record<string, number> = {};
    for (const c of cards) byLabel[c.label] = (byLabel[c.label] ?? 0) + 1;
    writeJson(path.join(dir, "meta.json"), {
      corpus,
      root: absRoot,
      project,
      include: include ?? null,
      exclude: excludeRe.source,
      seed,
      limit,
      source_lines: sourceLines,
      cards: cards.length,
      by_label: byLabel,
      generated_at: new Date().toISOString(),
    });
    console.log(`Wrote ${cards.length} cards to ${path.join(dir, "cards.jsonl")}`);
    console.log(JSON.stringify(byLabel));
  } finally {
    cbm.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
