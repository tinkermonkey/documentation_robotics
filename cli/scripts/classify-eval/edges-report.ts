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
 *   produced  pairs that become a relationship with the predicted types (--pred)
 *   agree     produced relationships identical to the gold-typed one (precision against gold)
 *
 * plus the gold type pairs with no preferred catalog triple: evidence for catalog additions.
 * Edges with a file at one end (IMPORTS, TESTS_FILE) are joined to the Module card of that file.
 */
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { CbmSession } from "./lib/cbm.js";
import { corpusDir, flagStr, parseFlags, readJson, readJsonl } from "./lib/io.js";
import { harnessDir, repoRoot } from "./lib/env.js";
import type { Card, Gold, Prediction } from "./lib/types.js";
import { relationshipFor } from "../../src/analyzers/edge-relationships.js";
import type { AnalyzerEdgeMapping } from "../../src/analyzers/types.js";

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

type Stat = { graph: number; pairs: number; goldFit: number; produced: number; agree: number; misfit: Map<string, number> };

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const predTag = flagStr(flags, "pred", "clef@v2-kind-tier0")!;
  const out = flagStr(flags, "out") ?? path.join(harnessDir(), "data", "edges-report.md");
  const cbmMap = JSON.parse(readFileSync(path.join(repoRoot(), "spec", "dist", "analyzers", "cbm.json"), "utf8")) as { edges_by_type: Record<string, EdgeMapping> };
  const mapped = Object.values(cbmMap.edges_by_type).filter((m) => m.usage === "verification_and_mapping");
  const triples = loadTriples();
  const has = (id: string) => triples.has(id);

  const stats = new Map<string, Map<string, Stat>>();
  for (const corpus of CORPORA) {
    const dir = corpusDir(corpus);
    const meta = readJson<{ root?: string }>(path.join(dir, "meta.json"), {});
    const cards = readJsonl<Card>(path.join(dir, "cards.jsonl"));
    const gold = new Map(readJsonl<Gold>(path.join(dir, "gold.jsonl")).map((g) => [g.card_id, g]));
    const pred = new Map(readJsonl<Prediction>(path.join(dir, `pred-${predTag}.jsonl`)).map((p) => [p.card_id, p]));
    const typeOf = (layer: string, t: string | null | undefined) => (layer === "none" || !t ? null : `${layer}.${t}`);

    const cbm = new CbmSession();
    await cbm.open();
    try {
      const project = await cbm.ensureIndexed(meta.root!);
      const byQn = new Map(cards.map((c) => [`${project}.${c.qualified_name}`, c]));
      const moduleByFile = new Map(cards.filter((c) => c.label === "Module" && c.file_path).map((c) => [c.file_path!, c]));
      for (const m of mapped) {
        const s: Stat = { graph: 0, pairs: 0, goldFit: 0, produced: 0, agree: 0, misfit: new Map() };
        const rows = await cbm.query(`MATCH (a)-[r:${m.cbm_edge}]->(b) RETURN a.qualified_name, b.qualified_name, a.file_path, b.file_path`);
        s.graph = rows.length;
        const seen = new Set<string>();
        for (const [aq, bq, af, bf] of rows) {
          const a0 = byQn.get(String(aq)) ?? (typeof af === "string" && m.cbm_edge === "IMPORTS" ? moduleByFile.get(af) : undefined);
          const b0 = byQn.get(String(bq)) ?? (typeof bf === "string" && (m.cbm_edge === "IMPORTS" || m.cbm_edge === "TESTS_FILE") ? moduleByFile.get(bf) : undefined);
          const a = a0;
          const b = b0;
          if (!a || !b || a.id === b.id) continue;
          const key = `${a.id}>${b.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const ga = gold.get(a.id);
          const gb = gold.get(b.id);
          const gx = ga ? typeOf(ga.layer, ga.element_type) : null;
          const gy = gb ? typeOf(gb.layer, gb.element_type) : null;
          if (!gx || !gy) continue;
          s.pairs++;
          const goldRel = relationshipFor(m, gx, gy, has);
          if (goldRel) s.goldFit++;
          else s.misfit.set(`${gx} → ${gy}`, (s.misfit.get(`${gx} → ${gy}`) ?? 0) + 1);
          const pa = pred.get(a.id);
          const pb = pred.get(b.id);
          const px = pa ? typeOf(pa.layer.choice, pa.element_type.choice) : null;
          const py = pb ? typeOf(pb.layer.choice, pb.element_type.choice) : null;
          const predRel = px && py ? relationshipFor(m, px, py, has) : null;
          if (predRel) {
            s.produced++;
            if (goldRel && predRel.id === goldRel.id) s.agree++;
          }
        }
        if (!stats.has(m.cbm_edge)) stats.set(m.cbm_edge, new Map());
        stats.get(m.cbm_edge)!.set(corpus, s);
      }
    } finally {
      await cbm.close();
    }
  }

  const lines = [
    "# cbm edge mapping on the eval corpora",
    "",
    `Mapped edges from spec/dist/analyzers/cbm.json; predictions from pred-${predTag}.jsonl. Generated by edges-report.ts.`,
    "Cells: graph edges / pairs between two gold elements / relationships on gold types / produced on predicted types / produced and identical to gold (see the script header).",
    "",
    "| edge | relationship | " + CORPORA.join(" | ") + " |",
    "|---|---|" + CORPORA.map(() => "---").join("|") + "|",
  ];
  for (const m of mapped) {
    const cells = CORPORA.map((c) => {
      const s = stats.get(m.cbm_edge)?.get(c);
      return s ? `${s.graph} / ${s.pairs} / ${s.goldFit} / ${s.produced} / ${s.agree}` : "-";
    });
    lines.push(`| ${m.cbm_edge} | ${m.dr_relationship} | ${cells.join(" | ")} |`);
  }
  const tot = { pairs: 0, gold: 0, produced: 0, agree: 0 };
  for (const byCorpus of stats.values()) for (const s of byCorpus.values()) { tot.pairs += s.pairs; tot.gold += s.goldFit; tot.produced += s.produced; tot.agree += s.agree; }
  lines.push("", `All corpora: ${tot.pairs} pairs between gold elements; ${tot.gold} become a relationship on gold types; ${tot.produced} produced on predicted types, ${tot.agree} of them identical to gold.`);
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
