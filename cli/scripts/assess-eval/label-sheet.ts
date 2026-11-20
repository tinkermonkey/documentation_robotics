/**
 * Experiment 2: the sheet the maintainer fills in. One row per empty layer pair of each model
 * (both layers populated, the catalog links them, no relationships), with what a reviewer needs
 * to answer "is that expected?".
 *
 *   bun label-sheet.ts --models viewer=~/workspace/documentation_robotics_viewer,context-studio=~/workspace/context-studio --no-code
 *
 * Writes data/pair-labels.csv. `verdict` is `gap`, `expected` or `unsure`; `note` is free text.
 * Running it again keeps the verdicts and notes already filled in.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { layerOf } from "./catalog.js";
import { dataDir, parseFlags, setup } from "./run.js";

const flags = parseFlags(process.argv.slice(2));
const { models } = await setup({ ...flags, "no-code": true });
const file = path.join(dataDir(), "pair-labels.csv");

const cell = (v: string | number) =>
  /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') field += text[++i];
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") (row.push(field), (field = ""));
    else if (c === "\n")
      (row.push(field), rows.push(row), (row = []), (field = ""));
    else if (c !== "\r") field += c;
  }
  if (field || row.length) (row.push(field), rows.push(row));
  return rows;
}

const kept = new Map<string, { verdict: string; note: string }>();
if (existsSync(file)) {
  const [header, ...rows] = parseCsv(readFileSync(file, "utf8"));
  const at = (name: string) => header.indexOf(name);
  for (const r of rows)
    kept.set(`${r[at("model")]}|${r[at("pair")]}`, {
      verdict: r[at("verdict")] ?? "",
      note: r[at("note")] ?? ""
    });
}

const header = [
  "model",
  "pair",
  "elements",
  "types the model could use",
  "with a code edge route",
  "other models that link the pair",
  "verdict",
  "note"
];
const lines = [header.join(",")];
let count = 0;
for (const m of models) {
  for (const p of m.ledger.pairs.filter((p) => p.state === "empty")) {
    const types = m.ledger.types.filter(
      (t) =>
        t.crossLayer &&
        [layerOf(t.triple.source), layerOf(t.triple.destination)]
          .sort()
          .join(" ~ ") === p.key
    );
    const others = models
      .filter(
        (o) =>
          o !== m &&
          o.ledger.pairs.some((q) => q.key === p.key && q.relationships > 0)
      )
      .map((o) => o.model.name);
    const old = kept.get(`${m.model.name}|${p.pair}`);
    lines.push(
      [
        m.model.name,
        p.pair,
        `${p.elements[0]} ${p.layers[0]}, ${p.elements[1]} ${p.layers[1]}`,
        types
          .map(
            (t) =>
              `${t.triple.source.split(".")[1]} ${t.triple.predicate} ${t.triple.destination.split(".")[1]} (${t.sources}x${t.destinations})`
          )
          .join("; "),
        `${p.reachable} of ${p.instantiable}`,
        others.join(" ") || "none",
        old?.verdict ?? "",
        old?.note ?? ""
      ]
        .map(cell)
        .join(",")
    );
    count++;
  }
}
writeFileSync(file, `${lines.join("\n")}\n`);
console.log(
  `${count} empty pairs, ${[...kept.values()].filter((k) => k.verdict).length} already labelled -> ${file}`
);
