/**
 * Paired comparison of two prediction runs on the same cards, against gold. No model calls.
 *
 *   bun compare.ts --corpus dr-cli --a clef@v2-kind-base --b clef@v2-kind-tier0 [--layer ux]
 *   bun compare.ts --corpus dr-cli,fastapi,petclinic --a ... --b ...   (pooled: one paired test over all)
 *
 * Accuracy differences between configurations are small next to sampling error (a binomial
 * standard error of about 2.3 points at 300 cards and 80%), and Clef is deterministic, so
 * run-to-run variance is no yardstick. What decides whether B is better than A is how many cards
 * B gets right that A gets wrong, and the reverse: an exact two-sided McNemar (sign) test on those
 * discordant cards. Reported for layer correctness, end-to-end type correctness, and, on cards
 * where both runs got the layer right, type correctness. --layer restricts to cards whose gold is
 * that layer; --exclude-revised leaves out cards whose gold label was changed by a policy revision
 * (gold-revise.ts), since rules that select those cards agree with the revised gold by construction.
 *
 * Each run's serving (provider, and behind OpenRouter the pinned upstream) is printed with it, and a
 * file that mixes adapters or upstreams is refused: compare runs from different adapters as two
 * files, e.g. `--a clef@cbm012-kind-tier0-qset2 --b openrouter-cloudflare_clef-deepinfra_fp8@cbm012-kind-tier0-qset2`.
 */
import path from "node:path";
import { withoutFileCards } from "./lib/bands.js";
import { corpusDir, flagStr, parseFlags, readJsonl } from "./lib/io.js";
import { servingLabel, servingOf } from "./lib/serving.js";
import type { Gold, Prediction } from "./lib/types.js";

/** Exact two-sided sign-test p-value for `lost` vs `gained` discordant pairs. */
export function mcnemarP(lost: number, gained: number): number {
  const n = lost + gained;
  if (n === 0) return 1;
  const k = Math.min(lost, gained);
  let tail = 0;
  let c = 1; // C(n, 0)
  for (let i = 0; i <= k; i++) {
    tail += c;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const corpus = flagStr(flags, "corpus");
  const a = flagStr(flags, "a");
  const b = flagStr(flags, "b");
  const layer = flagStr(flags, "layer");
  if (!corpus || !a || !b) {
    console.error("Usage: bun compare.ts --corpus <name> --a <backend@tag> --b <backend@tag> [--layer <id>]");
    process.exit(2);
  }
  // --corpus a,b,c pools the corpora: cards keyed by corpus and id, one paired test over all of them.
  const corpora = corpus.split(",").map((c) => c.trim()).filter(Boolean);
  const key = (c: string, id: string) => (corpora.length > 1 ? `${c}:${id}` : id);
  const gold = new Map(
    corpora.flatMap((c) => withoutFileCards(c, readJsonl<Gold>(path.join(corpusDir(c), "gold.jsonl"))).map((g) => [key(c, g.card_id), { ...g, card_id: key(c, g.card_id) }] as const))
  );
  const read = (t: string) =>
    corpora.flatMap((c) => readJsonl<Prediction>(path.join(corpusDir(c), `pred-${t}.jsonl`)).map((p) => ({ ...p, card_id: key(c, p.card_id) })));
  const ra = read(a);
  const rb = read(b);
  const sa = servingOf(ra, `pred-${a}.jsonl`);
  const sb = servingOf(rb, `pred-${b}.jsonl`);
  const byCard = (preds: Prediction[]) => new Map(preds.filter((p) => !p.error).map((p) => [p.card_id, p]));
  const pa = byCard(ra);
  const pb = byCard(rb);
  const revised = new Set([...gold.values()].filter((g) => g.rationale.includes("[Revised ")).map((g) => g.card_id));
  const excludeRevised = !!flags["exclude-revised"];
  const ids = [...gold.keys()].filter((id) => pa.has(id) && pb.has(id) && (!layer || gold.get(id)!.layer === layer) && !(excludeRevised && revised.has(id)));
  const layerOk = (p: Prediction, g: Gold) => p.layer.choice === g.layer;
  const typeOk = (p: Prediction, g: Gold) => layerOk(p, g) && (g.layer === "none" ? null : g.element_type) === (p.element_type.choice ?? null);
  const row = (name: string, okA: (id: string) => boolean, okB: (id: string) => boolean, pool: string[]) => {
    let accA = 0, accB = 0, lost = 0, gained = 0;
    for (const id of pool) {
      const x = okA(id), y = okB(id);
      if (x) accA++;
      if (y) accB++;
      if (x && !y) lost++;
      if (!x && y) gained++;
    }
    const pct = (k: number) => (pool.length ? `${((100 * k) / pool.length).toFixed(1)}%` : "n/a");
    return `| ${name} | ${pool.length} | ${pct(accA)} | ${pct(accB)} | ${lost} | ${gained} | ${mcnemarP(lost, gained).toFixed(3)} |`;
  };
  const g = (id: string) => gold.get(id)!;
  const bothLayer = ids.filter((id) => layerOk(pa.get(id)!, g(id)) && layerOk(pb.get(id)!, g(id)));
  console.log(`${corpus}${layer ? ` (gold layer ${layer})` : ""}${excludeRevised ? ` (excluding ${revised.size} revised cards)` : ""}: A = ${a}, B = ${b}`);
  console.log(`Served: A ${servingLabel(sa)}; B ${servingLabel(sb)}`);
  console.log("| measure | cards | A | B | B lost | B gained | p (exact McNemar) |");
  console.log("|---|---|---|---|---|---|---|");
  console.log(row("layer", (id) => layerOk(pa.get(id)!, g(id)), (id) => layerOk(pb.get(id)!, g(id)), ids));
  console.log(row("type, end to end", (id) => typeOk(pa.get(id)!, g(id)), (id) => typeOk(pb.get(id)!, g(id)), ids));
  console.log(row("type, where both got the layer", (id) => typeOk(pa.get(id)!, g(id)), (id) => typeOk(pb.get(id)!, g(id)), bothLayer));
}

if (import.meta.main) main();
