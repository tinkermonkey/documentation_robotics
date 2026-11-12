/**
 * Extract the codebase-memory-mcp edges between a corpus's cards, so edges-report.ts can run from
 * committed data instead of a live index.
 *
 *   bun edges-cache.ts [--corpus fastapi] [--project <cbm project>]
 *
 * --project names the index when meta.json has none (dr-cli's cards were rebuilt from a checkout of
 * `cli/` at 450e650f, indexed under a scratch path).
 *
 * Reads the corpus's CBM index database read-only (~/.cache/codebase-memory-mcp/<project>.db,
 * project from data/<corpus>/meta.json; the CBM daemon is not needed) and writes:
 *   data/<corpus>/edges.jsonl       {edge, a, b}: one row per CBM edge whose two ends are cards
 *                                   (a = source card id, b = target card id, CBM direction).
 *                                   IMPORTS and TESTS_FILE ends that are files are joined to the
 *                                   Module card of that file. A call edge CBM resolved with a
 *                                   confidence also carries `evidence`: what the CLI's call gate
 *                                   reads (src/analyzers/call-evidence.ts), built the way
 *                                   extraction builds it.
 *   data/<corpus>/edges-meta.json   edge counts per type in the whole graph, and the source.
 * Every CBM edge type is extracted, mapped or not, so a mapping change needs no re-extraction.
 */
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { corpusDir, flagStr, parseFlags, readJson, readJsonl, writeJson, writeJsonl } from "./lib/io.js";
import type { Card } from "./lib/types.js";
import { bareCallee, cellNumber, type CallEvidence } from "../../src/analyzers/call-evidence.js";

const CORPORA = ["dr-cli", "fastapi", "petclinic"];
const FILE_JOINED = new Set(["IMPORTS", "TESTS_FILE"]);

export interface EdgeRow {
  edge: string;
  a: string;
  b: string;
  /** For a call CBM resolved with a confidence: the evidence the CLI's call gate reads. */
  evidence?: CallEvidence;
}

function props(s: string | null): Record<string, unknown> {
  try {
    return s ? (JSON.parse(s) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The call-gate evidence of one edge, as extraction builds it (src/analyzers/cards/extract.ts), or undefined. */
function evidenceOf(
  r: { ep: string | null; af: string; bf: string; bp: string | null },
  importsOf: Map<string, string[]>
): CallEvidence | undefined {
  const e = props(r.ep);
  const confidence = cellNumber(e.confidence);
  if (confidence === undefined) return undefined;
  const callee = typeof e.callee === "string" && e.callee ? e.callee : undefined;
  const name = bareCallee(callee);
  const importance = cellNumber(props(r.bp).importance);
  return {
    confidence,
    ...(typeof e.strategy === "string" ? { strategy: e.strategy } : {}),
    ...(cellNumber(e.candidates) !== undefined ? { candidates: cellNumber(e.candidates) } : {}),
    ...(callee ? { callee } : {}),
    ...(importance !== undefined ? { calleeImportance: importance } : {}),
    callerFile: r.af || null,
    calleeFile: r.bf || null,
    importedFrom: name && r.af ? importsOf.get(`${r.af}\u0000${name}`) ?? [] : [],
  };
}

function extract(corpus: string, projectFlag?: string): void {
  const dir = corpusDir(corpus);
  const meta = readJson<{ project?: string }>(path.join(dir, "meta.json"), {});
  if (projectFlag) meta.project = projectFlag;
  if (!meta.project) throw new Error(`${dir}/meta.json has no project; pass --project`);
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
        `SELECT e.type AS edge, e.properties AS ep, a.qualified_name AS aq, a.file_path AS af,
                b.qualified_name AS bq, b.file_path AS bf, b.properties AS bp
           FROM edges e JOIN nodes a ON a.id = e.source_id JOIN nodes b ON b.id = e.target_id
          WHERE e.project = ? ORDER BY e.id`
      )
      .all(meta.project) as Array<{ edge: string; ep: string | null; aq: string; af: string; bq: string; bf: string; bp: string | null }>;
    // What each file imports each name from, for the call gate's import corroboration.
    const importsOf = new Map<string, string[]>();
    const imports = conn
      .query(
        `SELECT a.file_path AS af, json_extract(e.properties, '$.local_name') AS name, b.file_path AS bf
           FROM edges e JOIN nodes a ON a.id = e.source_id JOIN nodes b ON b.id = e.target_id
          WHERE e.project = ? AND e.type = 'IMPORTS'`
      )
      .all(meta.project) as Array<{ af: string | null; name: string | null; bf: string | null }>;
    for (const i of imports) {
      if (!i.af || !i.name || !i.bf) continue;
      const key = `${i.af}\u0000${i.name}`;
      const list = importsOf.get(key);
      if (!list) importsOf.set(key, [i.bf]);
      else if (!list.includes(i.bf)) list.push(i.bf);
    }
    const out: EdgeRow[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const a = byQn.get(r.aq) ?? (FILE_JOINED.has(r.edge) && r.af ? moduleByFile.get(r.af) : undefined);
      const b = byQn.get(r.bq) ?? (FILE_JOINED.has(r.edge) && r.bf ? moduleByFile.get(r.bf) : undefined);
      if (!a || !b || a === b) continue;
      const key = `${r.edge}|${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const evidence = evidenceOf(r, importsOf);
      out.push({ edge: r.edge, a, b, ...(evidence ? { evidence } : {}) });
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
  const project = flagStr(flags, "project");
  if (project && !only) throw new Error("--project needs --corpus");
  for (const c of only ? [only] : CORPORA) extract(c, project);
}

main();
