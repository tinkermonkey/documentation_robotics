/**
 * Summarise a reflection run: how often the sorting questions reproduced the current
 * relationship, found no better answer, or preferred a concrete alternative; how the
 * validity decision moved against a baseline backend; and the alternatives found, per layer.
 *
 *   bun reflect-summary.ts [--backend clef] [--baseline clef@evidence-charter-short] [--layer application]
 */
import path from "node:path";
import { readdirSync } from "node:fs";
import { flagStr, parseFlags, readJsonl } from "../classify-eval/lib/io.js";
import { decisionsDir, harnessDir } from "./lib/paths.js";
import { readAllDecisions } from "./triage.js";
import type { Reflection } from "./triage-reflect.js";
import type { Claim, Decision } from "./lib/triage-types.js";

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const backend = flagStr(flags, "backend", "clef") ?? "clef";
  const baseline = flagStr(flags, "baseline", "clef@evidence-charter-short") ?? "clef@evidence-charter-short";
  const layerFilter = flagStr(flags, "layer");
  const dir = path.join(harnessDir(), "data", "triage");
  const claims = new Map(readJsonl<Claim>(path.join(dir, "claims.jsonl")).map((c) => [c.id, c]));
  const reflDir = path.join(dir, "reflect", backend);
  let refl: Reflection[] = [];
  for (const f of readdirSync(reflDir).filter((f) => f.endsWith(".jsonl")).sort()) refl = refl.concat(readJsonl<Reflection>(path.join(reflDir, f)));
  refl = refl.filter((r) => !layerFilter || claims.get(r.claim_id)?.layer === layerFilter);
  const dec = new Map(readAllDecisions(decisionsDir(`${backend}@reflect`)).filter((d) => !d.error).map((d) => [d.claim_id, d]));
  const base = new Map(readAllDecisions(decisionsDir(baseline)).filter((d) => !d.error).map((d) => [d.claim_id, d]));
  const validities = ["real_defect", "judgment_call", "works_as_designed", "out_of_scope"];
  const outcomes: Reflection["outcome"][] = ["reproduced", "no_better", "alternative"];

  console.log(`# Reflection summary (${backend}@reflect vs ${baseline})\n`);
  console.log(`${refl.length} relationship claims${layerFilter ? ` in ${layerFilter}` : ""}.\n`);
  console.log(`## Sorting outcome x validity (reflect)\n`);
  console.log(`| outcome | n | ${validities.join(" | ")} | baseline real_defect on same claims |`);
  console.log(`|---|---|${validities.map(() => "---").join("|")}|---|`);
  for (const o of outcomes) {
    const rows = refl.filter((r) => r.outcome === o);
    const count = (v: string) => rows.filter((r) => dec.get(r.claim_id)?.validity.choice === v).length;
    const baseRd = rows.filter((r) => base.get(r.claim_id)?.validity.choice === "real_defect").length;
    console.log(`| ${o} | ${rows.length} | ${validities.map(count).join(" | ")} | ${baseRd} |`);
  }
  const both = refl.filter((r) => dec.has(r.claim_id) && base.has(r.claim_id));
  const same = both.filter((r) => dec.get(r.claim_id)!.validity.choice === base.get(r.claim_id)!.validity.choice).length;
  console.log(`\nValidity agreement with ${baseline}: ${same}/${both.length} (${((100 * same) / Math.max(1, both.length)).toFixed(1)}%).\n`);
  console.log(`## Transitions (${baseline} -> reflect)\n\n| from | to | n |\n|---|---|---|`);
  const trans = new Map<string, number>();
  for (const r of both) {
    const a = base.get(r.claim_id)!.validity.choice,
      b = dec.get(r.claim_id)!.validity.choice;
    if (a !== b) trans.set(`${a} -> ${b}`, (trans.get(`${a} -> ${b}`) ?? 0) + 1);
  }
  for (const [k, v] of [...trans.entries()].sort((x, y) => y[1] - x[1])) console.log(`| ${k.split(" -> ")[0]} | ${k.split(" -> ")[1]} | ${v} |`);

  console.log(`\n## Concrete alternatives found (by layer)\n`);
  const byLayer = new Map<string, Reflection[]>();
  for (const r of refl.filter((r) => r.outcome === "alternative")) {
    const l = claims.get(r.claim_id)?.layer ?? "?";
    byLayer.set(l, [...(byLayer.get(l) ?? []), r]);
  }
  for (const [l, rows] of [...byLayer.entries()].sort()) {
    console.log(`### ${l} (${rows.length})\n\n| claim | current | alternative | p | reflect validity | claim text |\n|---|---|---|---|---|---|`);
    for (const r of rows.sort((a, b) => (dec.get(b.claim_id)?.validity.probabilities.real_defect ?? 0) - (dec.get(a.claim_id)?.validity.probabilities.real_defect ?? 0))) {
      const d = dec.get(r.claim_id);
      const pAlt = r.alternatives
        .map((a) => {
          const [q, v] = a.split("=");
          return (r.answers[`${q}_for`]?.probabilities[v] ?? NaN).toFixed(2);
        })
        .join("; ");
      console.log(`| ${r.claim_id} | ${r.triple} | ${r.alternatives.join("; ")} | ${pAlt} | ${d?.validity.choice ?? "?"} (${(d?.validity.probabilities[d.validity.choice] ?? NaN).toFixed(2)}) | ${(claims.get(r.claim_id)?.text ?? "").replace(/\|/g, "/").slice(0, 140)} |`);
    }
    console.log("");
  }
}

main();
