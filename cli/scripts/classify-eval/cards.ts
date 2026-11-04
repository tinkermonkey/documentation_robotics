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
import path from "node:path";
import { CbmSession, type EdgeIndex, type GraphNode } from "./lib/cbm.js";
import { CARD_FIELDS, CardBuilder, SAMPLE_EXCLUDE, isCandidate } from "../../src/analyzers/cards/index.js";
import { corpusDir, flagNum, flagStr, parseFlags, seededRandom, shuffle, writeJson, writeJsonl } from "./lib/io.js";
import type { Card } from "./lib/types.js";

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const corpus = flagStr(flags, "corpus");
  const root = flagStr(flags, "root");
  if (!corpus || !root) {
    console.error("Usage: bun cards.ts --corpus <name> --root <abs path> [--include glob] [--limit n]");
    process.exit(2);
  }
  const include = flagStr(flags, "include");
  const excludeRe = flags.exclude ? new RegExp(String(flags.exclude)) : SAMPLE_EXCLUDE;
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
    const graph = cbm.graph();
    const edges: EdgeIndex = await cbm.buildEdgeIndex();
    process.stderr.write(`Edges: calls=${edges.callees.size} imports(files)=${edges.importsByFile.size} env=${edges.envVars.size} handles=${edges.handles.size} http=${edges.httpCalls.size}\n`);

    // Collect candidates per label
    const perLabel = new Map<string, GraphNode[]>();
    for (const label of labels) {
      const nodes = await graph.search(label, include, CARD_FIELDS[label] ?? []);
      const kept = nodes.filter((n) => isCandidate(n, label, excludeRe));
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

    // Cards are built by the CLI's card builder (src/analyzers/cards), the code
    // `dr analyzer classify` runs; the harness only samples which symbols get one.
    const builder = new CardBuilder(graph, edges, { scope: corpus, sourceLines });
    const cards: Card[] = [];
    let i = 0;
    for (const node of selected) {
      i++;
      if (i % 25 === 0) process.stderr.write(`  snippets ${i}/${selected.length}\n`);
      const { id, ...rest } = await builder.build(node);
      cards.push({ id, corpus, ...rest });
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
