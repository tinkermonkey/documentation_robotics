/**
 * Does codebase-memory-mcp's architecture-cluster evidence help component assignment? (#1086)
 *
 *   bun clusters.ts --fetch --corpus fastapi [--root <indexed checkout>]   # needs CBM
 *   bun clusters.ts [--out data/clusters-report.md]                        # from committed data
 *
 * --fetch asks get_architecture for system_structure (polled through `pending`) and the Louvain
 * clusters on the corpus's index, with the production code extraction uses
 * (src/analyzers/cards/clusters.ts), and writes:
 *   data/<corpus>/clusters.jsonl      {card_id, cluster, louvain_top}: the cross-file cluster each
 *                                     gold card would carry (null when none), and whether its name
 *                                     is among a Louvain community's top symbols.
 *   data/<corpus>/clusters-meta.json  project, CBM version, wait, component and community counts.
 * dr-cli's cards come from a checkout of cli/ at the commit in its meta.json; index that checkout
 * and pass it as --root (the other corpora's roots are in their meta.json).
 *
 * The report has no membership gold: the gold labels a card's type, not the component it belongs
 * to. It measures what the gold can say:
 *   1. coverage: gold cards that would carry a cluster;
 *   2. typing: whether "a class, module or interface in a cross-file cluster is an
 *      application.applicationcomponent" would beat the current predictions
 *      (pred-clef@cbm012-kind-tier0), paired, exact McNemar;
 *   3. grouping (a proxy): how often two gold-labelled cards in one cluster share their gold type,
 *      against two cards in one directory.
 */
import path from "node:path";
import { writeFileSync } from "node:fs";
import { corpusDir, flagNum, flagStr, parseFlags, readJson, readJsonl, writeJson, writeJsonl } from "./lib/io.js";
import { harnessDir } from "./lib/env.js";
import { CbmSession, findCbmBinary } from "./lib/cbm.js";
import { mcnemarP } from "./compare.js";
import type { Card, Gold, Prediction } from "./lib/types.js";
import { binaryVersion } from "../../src/analyzers/version.js";
import {
  ArchitectureRequest,
  LOUVAIN_ASPECT,
  SYSTEM_STRUCTURE_ASPECT,
  clusterEvidence,
  louvainCommunities,
  parseSystemStructure,
  type ClusterEvidence,
} from "../../src/analyzers/cards/clusters.js";

const CORPORA = ["dr-cli", "fastapi", "petclinic"];
const PRED = "clef@cbm012-kind-tier0";
const COMPONENT = "application.applicationcomponent";
const STRUCTURAL = new Set(["Class", "Module", "Interface"]);

interface ClusterRow {
  card_id: string;
  cluster: ClusterEvidence | null;
  louvain_top: boolean;
}

async function fetchCorpus(corpus: string, root: string | undefined, waitMs: number): Promise<void> {
  const dir = corpusDir(corpus);
  const meta = readJson<{ root?: string | null; project?: string | null; source_commit?: string }>(path.join(dir, "meta.json"), {});
  const repo = root ?? meta.root;
  if (!repo) throw new Error(`${corpus}: pass --root (the indexed checkout its cards were built from)`);
  const session = new CbmSession();
  await session.open();
  try {
    const project = await session.ensureIndexed(repo);
    const graph = session.graph();
    const call = (args: Record<string, unknown>) => graph.architecture!(args);
    const structure = await new ArchitectureRequest(call, SYSTEM_STRUCTURE_ASPECT, { maxWaitMs: waitMs }).result();
    if (structure.status !== "ready") throw new Error(`${corpus}: ${structure.reason}`);
    const louvain = await new ArchitectureRequest(call, LOUVAIN_ASPECT, { maxWaitMs: waitMs }).result();
    const communities = louvain.status === "ready" ? louvainCommunities(louvain.result, Infinity) : [];
    const top = new Set(communities.flatMap((c) => c.top));
    const index = parseSystemStructure(structure.result);
    const cards = readJsonl<Card>(path.join(dir, "cards.jsonl"));
    const rows: ClusterRow[] = cards.map((c) => ({
      card_id: c.id,
      cluster: clusterEvidence(index, c.label === "Route" ? c.qualified_name : `${project}.${c.qualified_name}`, c.file_path),
      louvain_top: top.has(c.name),
    }));
    writeJsonl(path.join(dir, "clusters.jsonl"), rows);
    writeJson(path.join(dir, "clusters-meta.json"), {
      corpus,
      // A --root checkout's project name is a local path: recorded as the commit it was cut from.
      project: meta.project ?? null,
      ...(meta.source_commit ? { source_commit: meta.source_commit } : {}),
      analyzer_version: binaryVersion(findCbmBinary()),
      fetched_at: new Date().toISOString(),
      waited_ms: structure.waitedMs,
      polls: structure.polls,
      components: index.totalComponents,
      components_shown: index.components.size,
      nodes_placed: index.nodeComponent.size,
      louvain_communities: communities.length,
      louvain_members: communities.reduce((n, c) => n + c.members, 0),
    });
    console.log(`${corpus}: ${rows.filter((r) => r.cluster).length} of ${rows.length} cards in a cross-file cluster (${structure.polls} polls, ${structure.waitedMs} ms)`);
  } finally {
    session.close();
  }
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");
const goldType = (g: Gold) => (g.layer === "none" ? "none" : `${g.layer}.${g.element_type ?? "-"}`);
const predType = (p: Prediction) => (p.layer.choice === "none" ? "none" : `${p.layer.choice}.${p.element_type.choice ?? "-"}`);

/** Pairs within groups that share their value, out of all pairs. */
function samePairs(groups: Map<string, string[]>): { same: number; pairs: number } {
  let same = 0;
  let pairs = 0;
  for (const values of groups.values()) {
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        pairs++;
        if (values[i] === values[j]) same++;
      }
    }
  }
  return { same, pairs };
}

function report(corpora: string[]): string {
  const out: string[] = [
    "# Architecture clusters against gold",
    "",
    "Generated by `bun clusters.ts` from `data/<corpus>/clusters.jsonl` (fetched with `--fetch`). A card's cluster is the",
    "cross-file component candidate codebase-memory-mcp's `get_architecture` `system_structure` puts it in, as",
    "`codebase_extract` with `clusters: true` attaches it. The gold labels types, not membership, so these are the",
    "measures the gold supports.",
    "",
    "## Coverage",
    "",
    "| corpus | CBM | components (shown) | gold cards | in a cross-file cluster | by symbol | by file | name in a Louvain top-5 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const typing: string[] = [];
  const grouping: string[] = [];
  for (const corpus of corpora) {
    const dir = corpusDir(corpus);
    const meta = readJson<Record<string, unknown>>(path.join(dir, "clusters-meta.json"), {});
    const rows = new Map(readJsonl<ClusterRow>(path.join(dir, "clusters.jsonl")).map((r) => [r.card_id, r]));
    const cards = new Map(readJsonl<Card>(path.join(dir, "cards.jsonl")).map((c) => [c.id, c]));
    const gold = readJsonl<Gold>(path.join(dir, "gold.jsonl")).filter((g) => cards.has(g.card_id) && rows.has(g.card_id));
    const pred = new Map(readJsonl<Prediction>(path.join(dir, `pred-${PRED}.jsonl`)).filter((p) => !p.error).map((p) => [p.card_id, p]));

    const withCluster = gold.filter((g) => rows.get(g.card_id)!.cluster);
    const bySymbol = withCluster.filter((g) => rows.get(g.card_id)!.cluster!.via === "symbol").length;
    out.push(
      `| ${corpus} | ${String(meta.analyzer_version ?? "?")} | ${String(meta.components ?? "?")} (${String(meta.components_shown ?? "?")}) | ${gold.length} | ` +
        `${withCluster.length} (${pct(withCluster.length, gold.length)}) | ${bySymbol} | ${withCluster.length - bySymbol} | ` +
        `${gold.filter((g) => rows.get(g.card_id)!.louvain_top).length} |`
    );

    // 2. Typing: structural cards in a cross-file cluster called components.
    const structural = gold.filter((g) => STRUCTURAL.has(cards.get(g.card_id)!.label) && pred.has(g.card_id));
    const inCluster = structural.filter((g) => rows.get(g.card_id)!.cluster);
    const goldComp = (gs: Gold[]) => gs.filter((g) => goldType(g) === COMPONENT).length;
    let lost = 0;
    let gained = 0;
    let before = 0;
    let after = 0;
    for (const g of inCluster) {
      const was = predType(pred.get(g.card_id)!) === goldType(g);
      const now = goldType(g) === COMPONENT;
      if (was) before++;
      if (now) after++;
      if (was && !now) lost++;
      if (!was && now) gained++;
    }
    typing.push(
      `| ${corpus} | ${structural.length} | ${pct(goldComp(structural), structural.length)} | ${inCluster.length} | ` +
        `${pct(goldComp(inCluster), inCluster.length)} | ${pct(before, inCluster.length)} | ${pct(after, inCluster.length)} | ${lost} / ${gained} | ${mcnemarP(lost, gained).toFixed(3)} |`
    );

    // 3. Grouping proxy: same gold type within a cluster vs within a directory, over the same cards.
    const labelled = withCluster.filter((g) => g.layer !== "none");
    const byCluster = new Map<string, string[]>();
    const byDir = new Map<string, string[]>();
    for (const g of labelled) {
      const c = rows.get(g.card_id)!.cluster!;
      (byCluster.get(c.id) ?? byCluster.set(c.id, []).get(c.id)!).push(goldType(g));
      const d = path.posix.dirname(cards.get(g.card_id)!.file_path ?? "");
      (byDir.get(d) ?? byDir.set(d, []).get(d)!).push(goldType(g));
    }
    const pairLayer = (m: Map<string, string[]>) => samePairs(new Map([...m].map(([k, v]) => [k, v.map((t) => t.split(".")[0])])));
    const cT = samePairs(byCluster);
    const dT = samePairs(byDir);
    const cL = pairLayer(byCluster);
    const dL = pairLayer(byDir);
    grouping.push(
      `| ${corpus} | ${labelled.length} | ${byCluster.size} | ${cT.pairs} | ${pct(cL.same, cL.pairs)} | ${pct(cT.same, cT.pairs)} | ${dT.pairs} | ${pct(dL.same, dL.pairs)} | ${pct(dT.same, dT.pairs)} |`
    );
  }
  out.push(
    "",
    "## Typing: would cluster membership pick out components?",
    "",
    `Class, Module and Interface gold cards with a \`${PRED}\` prediction. "Rule" calls every one in a cross-file cluster an`,
    "`application.applicationcomponent`; accuracy is end-to-end type accuracy on the cards in a cluster; lost / gained and p",
    "(exact McNemar) compare the rule with the current prediction on those cards.",
    "",
    "| corpus | cards | gold component (all) | in a cluster | gold component (in a cluster) | current | rule | lost / gained | p |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...typing,
    "",
    "## Grouping proxy: do clusters group like with like?",
    "",
    "Gold-labelled cards (layer not `none`) that carry a cluster. For every pair of them in the same cluster, and every pair in",
    "the same directory, whether the two share their gold layer and their gold type. A cluster that drew component",
    "boundaries better than directories would share types more often than directories do.",
    "",
    "| corpus | cards | clusters | pairs in a cluster | same layer | same type | pairs in a directory | same layer | same type |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...grouping,
    ""
  );
  return out.join("\n");
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const only = flagStr(flags, "corpus");
  const corpora = only ? [only] : CORPORA;
  if (flags.fetch) {
    for (const c of corpora) await fetchCorpus(c, flagStr(flags, "root"), flagNum(flags, "wait", 120_000));
    return;
  }
  const out = flagStr(flags, "out") ?? path.join(harnessDir(), "data", "clusters-report.md");
  writeFileSync(out, report(corpora));
  console.log(`Wrote ${out}`);
}

await main();
