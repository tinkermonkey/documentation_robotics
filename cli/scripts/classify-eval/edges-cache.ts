/**
 * Extract the codebase-memory-mcp edges between a corpus's cards, so edges-report.ts can run from
 * committed data instead of a live index.
 *
 *   bun edges-cache.ts [--corpus fastapi]
 *
 * Reads the corpus's CBM index database read-only (~/.cache/codebase-memory-mcp/<project>.db,
 * project from data/<corpus>/meta.json; the CBM daemon is not needed) and writes:
 *   data/<corpus>/edges.jsonl       {edge, a, b}: one row per CBM edge whose two ends are cards
 *                                   (a = source card id, b = target card id, CBM direction).
 *                                   IMPORTS and TESTS_FILE ends that are files are joined to the
 *                                   Module card of that file.
 *   data/<corpus>/edges-meta.json   edge counts per type in the whole graph, and the source.
 * Every CBM edge type is extracted, mapped or not, so a mapping change needs no re-extraction.
 */
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { corpusDir, flagStr, parseFlags, readJson, readJsonl, writeJson, writeJsonl } from "./lib/io.js";
import type { Card } from "./lib/types.js";

const CORPORA = ["dr-cli", "fastapi", "petclinic"];
const FILE_JOINED = new Set(["IMPORTS", "TESTS_FILE"]);

export interface EdgeRow {
  edge: string;
  a: string;
  b: string;
}

function extract(corpus: string): void {
  const dir = corpusDir(corpus);
  const meta = readJson<{ project?: string }>(path.join(dir, "meta.json"), {});
  if (!meta.project) throw new Error(`${dir}/meta.json has no project`);
  const db = path.join(os.homedir(), ".cache", "codebase-memory-mcp", `${meta.project}.db`);
  if (!existsSync(db)) throw new Error(`${db} not found; index the corpus with codebase-memory-mcp first`);
  const cards = readJsonl<Card>(path.join(dir, "cards.jsonl"));
  const byQn = new Map(cards.map((c) => [`${meta.project}.${c.qualified_name}`, c.id]));
  const moduleByFile = new Map(cards.filter((c) => c.label === "Module" && c.file_path).map((c) => [c.file_path!, c.id]));

  const conn = new Database(db, { readonly: true });
  try {
    const graph: Record<string, number> = {};
    for (const r of conn.query("SELECT type, count(*) AS n FROM edges WHERE project = ? GROUP BY type ORDER BY type").all(meta.project) as Array<{ type: string; n: number }>) {
      graph[r.type] = r.n;
    }
    const rows = conn
      .query(
        `SELECT e.type AS edge, a.qualified_name AS aq, a.file_path AS af, b.qualified_name AS bq, b.file_path AS bf
           FROM edges e JOIN nodes a ON a.id = e.source_id JOIN nodes b ON b.id = e.target_id
          WHERE e.project = ? ORDER BY e.id`
      )
      .all(meta.project) as Array<{ edge: string; aq: string; af: string; bq: string; bf: string }>;
    const out: EdgeRow[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const a = byQn.get(r.aq) ?? (FILE_JOINED.has(r.edge) && r.af ? moduleByFile.get(r.af) : undefined);
      const b = byQn.get(r.bq) ?? (FILE_JOINED.has(r.edge) && r.bf ? moduleByFile.get(r.bf) : undefined);
      if (!a || !b || a === b) continue;
      const key = `${r.edge}|${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ edge: r.edge, a, b });
    }
    writeJsonl(path.join(dir, "edges.jsonl"), out);
    writeJson(path.join(dir, "edges-meta.json"), { corpus, project: meta.project, source: "codebase-memory-mcp index database, read-only", extracted_at: new Date().toISOString(), graph_edges_by_type: graph });
    console.log(`${corpus}: ${out.length} card-to-card edges of ${rows.length} in the graph`);
  } finally {
    conn.close();
  }
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const only = flagStr(flags, "corpus");
  for (const c of only ? [only] : CORPORA) extract(c);
}

main();
