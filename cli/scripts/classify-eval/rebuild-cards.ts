/**
 * Rebuild a corpus's committed cards from the current CBM index, for the same symbols.
 *
 *   bun rebuild-cards.ts --corpus fastapi [--out cards@next.jsonl]
 *
 * cards.ts samples symbols and builds their cards; this keeps the sample (and so the gold labels,
 * which are keyed by card id) and rebuilds each card with the CLI's card builder against the index
 * as it is now, e.g. after a codebase-memory-mcp upgrade. A card's id is a hash of the corpus and
 * the symbol's full qualified name, so a rebuilt card keeps its id when CBM still names the symbol
 * the same way. Symbols the index no longer has (renamed, removed, or named differently by CBM)
 * are reported and their old card is kept, so the dataset stays the same size and the gold stays
 * valid; the report says how many.
 *
 * Writes data/<corpus>/<out> (default cards@rebuilt.jsonl) and prints counts. Replace
 * cards.jsonl with it deliberately; keep the old file beside it for comparison.
 */
import path from "node:path";
import { CbmSession, type EdgeIndex, type GraphNode } from "./lib/cbm.js";
import { CARD_FIELDS, CardBuilder } from "../../src/analyzers/cards/index.js";
import { corpusDir, flagStr, parseFlags, readJson, readJsonl, writeJsonl } from "./lib/io.js";
import type { Card } from "./lib/types.js";

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const corpus = flagStr(flags, "corpus");
  if (!corpus) {
    console.error("Usage: bun rebuild-cards.ts --corpus <name> [--out cards@rebuilt.jsonl]");
    process.exit(2);
  }
  const outName = flagStr(flags, "out", "cards@rebuilt.jsonl")!;
  const dir = corpusDir(corpus);
  const meta = readJson<{ root?: string; source_lines?: number }>(path.join(dir, "meta.json"), {});
  if (!meta.root) throw new Error(`${dir}/meta.json has no root`);
  const old = readJsonl<Card>(path.join(dir, "cards.jsonl"));

  const cbm = new CbmSession();
  await cbm.open();
  try {
    const project = await cbm.ensureIndexed(meta.root);
    const graph = cbm.graph();
    const edges: EdgeIndex = await cbm.buildEdgeIndex();
    const builder = new CardBuilder(graph, edges, { scope: corpus, sourceLines: meta.source_lines ?? 120, sourceRoot: meta.root });

    // Harness cards store the qualified name without the project prefix (routes have none).
    const short = (qn: string) => (qn.startsWith(`${project}.`) ? qn.slice(project.length + 1) : qn);
    const nodes = new Map<string, GraphNode>();
    for (const label of [...new Set(old.map((c) => c.label))]) {
      for (const n of await graph.search(label, undefined, CARD_FIELDS[label] ?? [])) {
        const key = `${label}|${short(n.qualified_name)}`;
        if (!nodes.has(key)) nodes.set(key, n);
      }
    }

    const out: Card[] = [];
    const missing: Card[] = [];
    let idChanged = 0;
    for (const c of old) {
      const node = nodes.get(`${c.label}|${c.qualified_name}`);
      if (!node) {
        missing.push(c);
        out.push(c);
        continue;
      }
      const { id, ...rest } = await builder.build(node);
      if (id !== c.id) idChanged++;
      // Keep the committed id: the gold is keyed by it.
      out.push({ ...(rest as Omit<Card, "id" | "corpus">), id: c.id, corpus } as Card);
    }
    writeJsonl(path.join(dir, outName), out);
    console.log(
      `${corpus}: ${out.length - missing.length} of ${old.length} cards rebuilt from ${project}` +
        `${missing.length ? `; ${missing.length} not in the index, old card kept (${missing.map((m) => `${m.label} ${m.qualified_name}`).slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""})` : ""}` +
        `${idChanged ? `; ${idChanged} would have a different id` : ""} -> ${path.relative(process.cwd(), path.join(dir, outName))}`
    );
  } finally {
    await cbm.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
