/**
 * Compare two gold label sets for a corpus (e.g. labelled without and with the charter).
 *
 *   bun gold-diff.ts --corpus dr-cli --a "" --b charter
 *
 * Prints layer and type agreement, the layer transition table, and how each Clef
 * prediction file scores against both, so the effect of a labelling change is visible.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { corpusDir, flagStr, parseFlags, readJsonl } from "./lib/io.js";
import type { Card, Gold, Prediction } from "./lib/types.js";

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const corpus = flagStr(flags, "corpus");
  if (!corpus) {
    console.error("Usage: bun gold-diff.ts --corpus <name> [--a <tag>] [--b <tag>]");
    process.exit(2);
  }
  const dir = corpusDir(corpus);
  const tagA = flagStr(flags, "a", "") ?? "";
  const tagB = flagStr(flags, "b", "charter") ?? "charter";
  const file = (t: string) => path.join(dir, `gold${t ? `@${t}` : ""}.jsonl`);
  const a = new Map(readJsonl<Gold>(file(tagA)).map((g) => [g.card_id, g]));
  const b = new Map(readJsonl<Gold>(file(tagB)).map((g) => [g.card_id, g]));
  const cards = new Map(readJsonl<Card>(path.join(dir, "cards.jsonl")).map((c) => [c.id, c]));
  const both = [...a.keys()].filter((id) => b.has(id));
  const nameA = tagA || "baseline";
  console.log(`# Gold diff: ${corpus}, ${nameA} vs ${tagB}\n`);
  console.log(`Cards labelled in both: ${both.length} (A ${a.size}, B ${b.size})`);
  const layerSame = both.filter((id) => a.get(id)!.layer === b.get(id)!.layer).length;
  const typeSame = both.filter((id) => a.get(id)!.layer === b.get(id)!.layer && (a.get(id)!.element_type ?? null) === (b.get(id)!.element_type ?? null)).length;
  console.log(`Layer agreement: ${layerSame}/${both.length} (${((100 * layerSame) / both.length).toFixed(1)}%). Layer+type agreement: ${typeSame}/${both.length} (${((100 * typeSame) / both.length).toFixed(1)}%)`);
  const sigA = both.reduce((s, id) => s + a.get(id)!.significance, 0) / both.length;
  const sigB = both.reduce((s, id) => s + b.get(id)!.significance, 0) / both.length;
  console.log(`Mean significance: ${nameA} ${sigA.toFixed(2)}, ${tagB} ${sigB.toFixed(2)}\n`);

  const trans = new Map<string, number>();
  for (const id of both) {
    const k = `${a.get(id)!.layer} -> ${b.get(id)!.layer}`;
    if (a.get(id)!.layer !== b.get(id)!.layer) trans.set(k, (trans.get(k) ?? 0) + 1);
  }
  console.log(`## Layer changes (${nameA} -> ${tagB})\n`);
  console.log("| transition | n |", "\n|---|---|");
  for (const [k, v] of [...trans.entries()].sort((x, y) => y[1] - x[1])) console.log(`| ${k} | ${v} |`);
  const byKind = new Map<string, [number, number]>();
  for (const id of both) {
    const kind = cards.get(id)?.label ?? "?";
    const e = byKind.get(kind) ?? [0, 0];
    e[1]++;
    if (a.get(id)!.layer !== b.get(id)!.layer) e[0]++;
    byKind.set(kind, e);
  }
  console.log(`\n## Layer changes by symbol kind\n\n| kind | changed | of |\n|---|---|---|`);
  for (const [k, [c, n]] of byKind) console.log(`| ${k} | ${c} | ${n} |`);

  // Score every prediction file against both golds (layer accuracy, type end-to-end)
  console.log(`\n## Prediction files scored against each gold (layer acc / type acc)\n\n| backend | vs ${nameA} | vs ${tagB} |\n|---|---|---|`);
  for (const f of readdirSync(dir).filter((f) => f.startsWith("pred-") && f.endsWith(".jsonl")).sort()) {
    const preds = readJsonl<Prediction>(path.join(dir, f)).filter((p) => !p.error);
    const score = (g: Map<string, Gold>) => {
      const rows = preds.filter((p) => g.has(p.card_id));
      const lay = rows.filter((p) => p.layer.choice === g.get(p.card_id)!.layer).length;
      const typ = rows.filter((p) => p.layer.choice === g.get(p.card_id)!.layer && (g.get(p.card_id)!.layer === "none" ? p.element_type.choice == null : (p.element_type.choice ?? null) === (g.get(p.card_id)!.element_type ?? null))).length;
      return rows.length ? `${((100 * lay) / rows.length).toFixed(1)}% / ${((100 * typ) / rows.length).toFixed(1)}%` : "n/a";
    };
    console.log(`| ${f.slice(5, -6)} | ${score(a)} | ${score(b)} |`);
  }

  // Sample of changed labels for eyeballing
  const changed = both.filter((id) => a.get(id)!.layer !== b.get(id)!.layer).slice(0, 12);
  if (changed.length) {
    console.log(`\n## Sample of relabelled symbols\n\n| symbol | ${nameA} | ${tagB} | ${tagB} rationale |\n|---|---|---|---|`);
    for (const id of changed) {
      const c = cards.get(id);
      console.log(`| ${c?.label} ${c?.qualified_name} | ${a.get(id)!.layer}/${a.get(id)!.element_type ?? "-"} | ${b.get(id)!.layer}/${b.get(id)!.element_type ?? "-"} | ${b.get(id)!.rationale.replace(/\|/g, "/").slice(0, 150)} |`);
    }
  }
}

main();
