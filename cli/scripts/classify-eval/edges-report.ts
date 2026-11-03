/**
 * What the cbm edge mapping would produce on the eval corpora. No model calls.
 *
 *   bun edges-report.ts [--pred clef@v2-kind-tier0] [--out data/edges-report.md]
 *
 * There are no gold relationships, so the gold node labels stand in. For every CBM edge of a
 * mapped type whose two ends are both labelled cards, the relationship it becomes is looked up
 * with the CLI's own rule (src/analyzers/edge-relationships.ts: the first preferred predicate with
 * a catalog triple between the two element types). Per edge type and corpus:
 *
 *   graph     edges of this type in the whole CBM graph (volume if every end were accepted)
 *   pairs     edges between two labelled cards whose ends are both gold elements (not none)
 *   gold      pairs that become a relationship when the ends have their gold types
 *   produced  edges between two labelled cards that become a relationship with the predicted
 *             types (--pred), including edges where gold says an end is not an element
 *   on-none   produced relationships where gold says at least one end is not an element
 *   agree     produced relationships identical to the gold-typed one (precision = agree/produced)
 *
 * Totals are also given with duplicates removed across edge types (CALLS, CALL_REFERENCE and USAGE
 * can link the same two elements with the same relationship). The edges come from the committed
 * data/<corpus>/edges.jsonl (bun edges-cache.ts extracts them from the CBM index), so the report
 * reruns from the repository alone.
 *
 * plus the gold type pairs with no preferred catalog triple: evidence for catalog additions.
 * Edges with a file at one end (IMPORTS, TESTS_FILE) are joined to the Module card of that file.
 */
import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { corpusDir, flagStr, parseFlags, readJson, readJsonl } from "./lib/io.js";
import { harnessDir, repoRoot } from "./lib/env.js";
import type { Card, Gold, Prediction } from "./lib/types.js";
import { relationshipFor } from "../../src/analyzers/edge-relationships.js";
import type { AnalyzerEdgeMapping } from "../../src/analyzers/types.js";
import type { EdgeRow } from "./edges-cache.js";

const CORPORA = ["dr-cli", "fastapi", "petclinic"];

type EdgeMapping = AnalyzerEdgeMapping;

function loadTriples(): Set<string> {
  const dist = path.join(repoRoot(), "spec", "dist");
  const out = new Set<string>();
  for (const f of ["motivation", "business", "product", "security", "application", "technology", "api", "data-model", "data-store", "ux", "navigation", "apm", "testing"]) {
    const layer = JSON.parse(readFileSync(path.join(dist, `${f}.json`), "utf8")) as { relationshipSchemas?: Record<string, unknown> };
    for (const id of Object.keys(layer.relationshipSchemas ?? {})) out.add(id);
  }
  return out;
}

type Stat = { graph: number; pairs: number; goldFit: number; produced: number; onNone: number; agree: number; misfit: Map<string, number> };

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const predTag = flagStr(flags, "pred", "clef@v2-kind-tier0")!;
  const out = flagStr(flags, "out") ?? path.join(harnessDir(), "data", "edges-report.md");
  const cbmMap = JSON.parse(readFileSync(path.join(repoRoot(), "spec", "dist", "analyzers", "cbm.json"), "utf8")) as { edges_by_type: Record<string, EdgeMapping> };
  const mapped = Object.values(cbmMap.edges_by_type).filter((m) => m.usage === "verification_and_mapping");
  const triples = loadTriples();
  const has = (id: string) => triples.has(id);

  const stats = new Map<string, Map<string, Stat>>();
  const unique = new Map<string, { gold: Set<string>; produced: Set<string>; agree: Set<string> }>();
  for (const corpus of CORPORA) {
    const dir = corpusDir(corpus);
    const cards = readJsonl<Card>(path.join(dir, "cards.jsonl"));
    const gold = new Map(readJsonl<Gold>(path.join(dir, "gold.jsonl")).map((g) => [g.card_id, g]));
    const pred = new Map(readJsonl<Prediction>(path.join(dir, `pred-${predTag}.jsonl`)).map((p) => [p.card_id, p]));
    const typeOf = (layer: string, t: string | null | undefined) => (layer === "none" || !t ? null : `${layer}.${t}`);
    const u = { gold: new Set<string>(), produced: new Set<string>(), agree: new Set<string>() };
    unique.set(corpus, u);
    const relKey = (aId: string, bId: string, r: { id: string; inverted: boolean }) => (r.inverted ? `${bId}|${r.id}|${aId}` : `${aId}|${r.id}|${bId}`);

    const edgesFile = path.join(dir, "edges.jsonl");
    if (!existsSync(edgesFile)) throw new Error(`${edgesFile} not found; run \`bun edges-cache.ts --corpus ${corpus}\` first`);
    const edgeRows = readJsonl<EdgeRow>(edgesFile);
    const graphCounts = readJson<{ graph_edges_by_type?: Record<string, number> }>(path.join(dir, "edges-meta.json"), {}).graph_edges_by_type ?? {};
    const cardById = new Map(cards.map((c) => [c.id, c]));
    for (const m of mapped) {
      const s: Stat = { graph: graphCounts[m.cbm_edge] ?? 0, pairs: 0, goldFit: 0, produced: 0, onNone: 0, agree: 0, misfit: new Map() };
      for (const row of edgeRows) {
        if (row.edge !== m.cbm_edge) continue;
        const a = cardById.get(row.a);
        const b = cardById.get(row.b);
        if (!a || !b) continue;
        const ga = gold.get(a.id);
        const gb = gold.get(b.id);
        if (!ga || !gb) continue; // both ends must be labelled cards
        const gx = typeOf(ga.layer, ga.element_type);
        const gy = typeOf(gb.layer, gb.element_type);
        let goldRel = null as ReturnType<typeof relationshipFor>;
        if (gx && gy) {
          s.pairs++;
          goldRel = relationshipFor(m, gx, gy, has);
          if (goldRel) {
            s.goldFit++;
            u.gold.add(relKey(a.id, b.id, goldRel));
          } else s.misfit.set(`${gx} → ${gy}`, (s.misfit.get(`${gx} → ${gy}`) ?? 0) + 1);
        }
        const pa = pred.get(a.id);
        const pb = pred.get(b.id);
        const px = pa ? typeOf(pa.layer.choice, pa.element_type.choice) : null;
        const py = pb ? typeOf(pb.layer.choice, pb.element_type.choice) : null;
        const predRel = px && py ? relationshipFor(m, px, py, has) : null;
        if (predRel) {
          s.produced++;
          u.produced.add(relKey(a.id, b.id, predRel));
          if (!gx || !gy) s.onNone++;
          if (goldRel && predRel.id === goldRel.id) {
            s.agree++;
            u.agree.add(relKey(a.id, b.id, predRel));
          }
        }
      }
      if (!stats.has(m.cbm_edge)) stats.set(m.cbm_edge, new Map());
      stats.get(m.cbm_edge)!.set(corpus, s);
    }
  }

  const lines = [
    "# cbm edge mapping on the eval corpora",
    "",
    `Mapped edges from spec/dist/analyzers/cbm.json; predictions from pred-${predTag}.jsonl. Generated by edges-report.ts.`,
    "Cells: graph edges / pairs between two gold elements / relationships on gold types / produced on predicted types / of which an end is gold none / produced and identical to gold (see the script header).",
    "",
    "| edge | relationship | " + CORPORA.join(" | ") + " |",
    "|---|---|" + CORPORA.map(() => "---").join("|") + "|",
  ];
  for (const m of mapped) {
    const cells = CORPORA.map((c) => {
      const s = stats.get(m.cbm_edge)?.get(c);
      return s ? `${s.graph} / ${s.pairs} / ${s.goldFit} / ${s.produced} / ${s.onNone} / ${s.agree}` : "-";
    });
    lines.push(`| ${m.cbm_edge} | ${m.dr_relationship} | ${cells.join(" | ")} |`);
  }
  const tot = { pairs: 0, gold: 0, produced: 0, onNone: 0, agree: 0 };
  for (const byCorpus of stats.values()) for (const s of byCorpus.values()) { tot.pairs += s.pairs; tot.gold += s.goldFit; tot.produced += s.produced; tot.onNone += s.onNone; tot.agree += s.agree; }
  let ug = 0, up = 0, ua = 0;
  for (const u of unique.values()) { ug += u.gold.size; up += u.produced.size; ua += u.agree.size; }
  const p = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "n/a");
  lines.push("", `All corpora, summed over edge types: ${tot.pairs} edges between two gold elements, ${tot.gold} of them a relationship on gold types; ${tot.produced} relationships produced on predicted types (${tot.onNone} with an end gold calls none), ${tot.agree} identical to gold (precision ${p(tot.agree, tot.produced)}).`);
  lines.push("", `Distinct relationships (duplicates across edge types removed): ${ug} on gold types; ${up} produced, ${ua} identical to gold (precision ${p(ua, up)}, recall ${p(ua, ug)}).`);
  lines.push("", "## Gold type pairs with no preferred catalog triple", "", "Top 5 per edge and corpus: candidates for catalog additions, or pairs DR models through an intermediate element.", "");
  for (const [edge, byCorpus] of stats) {
    for (const [c, s] of byCorpus) {
      const top = [...s.misfit.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
      if (top.length) lines.push(`- **${edge}** (${c}): ${top.map(([k, v]) => `${k} ×${v}`).join("; ")}`);
    }
  }
  const text = lines.join("\n") + "\n";
  writeFileSync(out, text);
  console.log(text);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
