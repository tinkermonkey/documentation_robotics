/**
 * Score predictions against gold labels: accuracy, calibration, thresholds, cost.
 *
 *   bun report.ts --corpus dr-cli [--backends clef-flash,claude-haiku]
 *
 * Writes data/<corpus>/report.md and prints it.
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { corpusDir, flagStr, parseFlags, readJsonl } from "./lib/io.js";
import { NONE_OPTION } from "./lib/spec.js";
import { CONCERNS, type Card, type Gold, type Prediction } from "./lib/types.js";

interface Scored {
  card: Card;
  gold: Gold;
  pred: Prediction;
  layerOk: boolean;
  typeOk: boolean; // end-to-end: layer and type both correct
  typeGivenLayerOk: boolean | null; // type correct, among cards where layer was correct
  layerProb: number; // confidence of predicted layer (max prob or self-report)
}

function topProb(p: Prediction): number {
  const v = p.layer.probabilities[p.layer.choice];
  if (typeof v === "number") return v;
  if (typeof p.layer.confidence === "number") return p.layer.confidence;
  return NaN;
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

function ece(items: Array<{ p: number; ok: boolean }>, bins = 10): { ece: number; table: string[] } {
  const valid = items.filter((x) => !Number.isNaN(x.p));
  const rows: string[] = ["| confidence bin | n | mean conf | accuracy | gap |", "|---|---|---|---|---|"];
  let e = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const inBin = valid.filter((x) => (b === bins - 1 ? x.p >= lo && x.p <= hi : x.p >= lo && x.p < hi));
    if (!inBin.length) continue;
    const conf = inBin.reduce((a, x) => a + x.p, 0) / inBin.length;
    const acc = inBin.filter((x) => x.ok).length / inBin.length;
    e += (inBin.length / valid.length) * Math.abs(acc - conf);
    rows.push(`| ${lo.toFixed(1)}-${hi.toFixed(1)} | ${inBin.length} | ${conf.toFixed(2)} | ${acc.toFixed(2)} | ${(acc - conf).toFixed(2)} |`);
  }
  return { ece: e, table: rows };
}

function thresholdSweep(items: Array<{ p: number; ok: boolean }>): string[] {
  const rows = ["| threshold | coverage | precision (layer) |", "|---|---|---|"];
  for (const t of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
    const kept = items.filter((x) => !Number.isNaN(x.p) && x.p >= t);
    rows.push(`| ≥${t.toFixed(2)} | ${pct(kept.length, items.length)} | ${pct(kept.filter((x) => x.ok).length, kept.length)} |`);
  }
  return rows;
}

function confusion(scored: Scored[], topN = 8): string[] {
  const counts = new Map<string, number>();
  for (const s of scored) if (!s.layerOk) counts.set(`${s.gold.layer} → ${s.pred.layer.choice}`, (counts.get(`${s.gold.layer} → ${s.pred.layer.choice}`) ?? 0) + 1);
  const rows = ["| gold → predicted | count |", "|---|---|"];
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)) rows.push(`| ${k} | ${v} |`);
  return rows;
}

function perLayer(scored: Scored[]): string[] {
  const layers = new Map<string, { n: number; ok: number; predicted: number }>();
  for (const s of scored) {
    const g = layers.get(s.gold.layer) ?? { n: 0, ok: 0, predicted: 0 };
    g.n++;
    if (s.layerOk) g.ok++;
    layers.set(s.gold.layer, g);
    const p = layers.get(s.pred.layer.choice) ?? { n: 0, ok: 0, predicted: 0 };
    p.predicted++;
    layers.set(s.pred.layer.choice, p);
  }
  const rows = ["| layer | gold n | recall | predicted n |", "|---|---|---|---|"];
  for (const [k, v] of [...layers.entries()].sort((a, b) => b[1].n - a[1].n)) rows.push(`| ${k} | ${v.n} | ${pct(v.ok, v.n)} | ${v.predicted} |`);
  return rows;
}

function concernMetrics(scored: Scored[]): string[] {
  const rows = ["| concern | gold positives | precision | recall | F1 (p≥0.5) |", "|---|---|---|---|---|"];
  for (const c of CONCERNS) {
    let tp = 0,
      fp = 0,
      fn = 0,
      pos = 0;
    for (const s of scored) {
      const g = s.gold.concerns[c];
      const p = (s.pred.concerns[c] ?? NaN) >= 0.5;
      if (g) pos++;
      if (g && p) tp++;
      else if (!g && p) fp++;
      else if (g && !p) fn++;
    }
    const prec = tp + fp ? tp / (tp + fp) : NaN;
    const rec = tp + fn ? tp / (tp + fn) : NaN;
    const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : NaN;
    rows.push(`| ${c} | ${pos} | ${Number.isNaN(prec) ? "n/a" : prec.toFixed(2)} | ${Number.isNaN(rec) ? "n/a" : rec.toFixed(2)} | ${Number.isNaN(f1) ? "n/a" : f1.toFixed(2)} |`);
  }
  return rows;
}

function scoreBackend(cards: Map<string, Card>, golds: Map<string, Gold>, preds: Prediction[]): Scored[] {
  const out: Scored[] = [];
  for (const p of preds) {
    if (p.error) continue;
    const gold = golds.get(p.card_id);
    const card = cards.get(p.card_id);
    if (!gold || !card) continue;
    const layerOk = gold.layer === p.layer.choice;
    const goldType = gold.layer === NONE_OPTION ? null : gold.element_type;
    const typeOk = layerOk && (goldType ?? null) === (p.element_type.choice ?? null);
    out.push({ card, gold, pred: p, layerOk, typeOk, typeGivenLayerOk: layerOk ? typeOk : null, layerProb: topProb(p) });
  }
  return out;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const corpus = flagStr(flags, "corpus");
  if (!corpus) {
    console.error("Usage: bun report.ts --corpus <name> [--backends a,b]");
    process.exit(2);
  }
  const dir = corpusDir(corpus);
  const cards = new Map(readJsonl<Card>(path.join(dir, "cards.jsonl")).map((c) => [c.id, c]));
  const golds = new Map(readJsonl<Gold>(path.join(dir, "gold.jsonl")).map((g) => [g.card_id, g]));
  const backends = flagStr(flags, "backends")?.split(",").map((s) => s.trim()) ?? readdirSync(dir).filter((f) => f.startsWith("pred-") && f.endsWith(".jsonl")).map((f) => f.slice(5, -6));

  const md: string[] = [];
  md.push(`# Classification eval report: ${corpus}`, "", `Generated ${new Date().toISOString()}. Cards: ${cards.size}. Gold labels: ${golds.size}.`, "");

  // Gold distribution
  const goldLayers = new Map<string, number>();
  const goldSig = [0, 0, 0, 0, 0];
  let invalidTypes = 0;
  for (const g of golds.values()) {
    goldLayers.set(g.layer, (goldLayers.get(g.layer) ?? 0) + 1);
    goldSig[g.significance]++;
    if (g.layer !== NONE_OPTION && !g.element_type_valid) invalidTypes++;
  }
  md.push("## Gold label distribution", "", "| layer | n |", "|---|---|");
  for (const [k, v] of [...goldLayers.entries()].sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |`);
  md.push("", `Significance histogram (0..4): ${goldSig.join(" / ")}. Gold labels with a type id not in the spec: ${invalidTypes}.`, "");

  // Summary table across backends
  const summaries: string[] = ["| backend | n | layer acc | type acc (end-to-end) | type acc given layer | sig MAE | sig within 1 | layer ECE | median latency | total cost | cost / card |", "|---|---|---|---|---|---|---|---|---|---|---|"];
  const sections: string[] = [];
  for (const b of backends) {
    const file = path.join(dir, `pred-${b}.jsonl`);
    if (!existsSync(file)) continue;
    const preds = readJsonl<Prediction>(file);
    const scored = scoreBackend(cards, golds, preds);
    if (!scored.length) continue;
    const n = scored.length;
    const layerAcc = scored.filter((s) => s.layerOk).length;
    const typeAcc = scored.filter((s) => s.typeOk).length;
    const withLayer = scored.filter((s) => s.layerOk);
    const typeGiven = withLayer.filter((s) => s.typeOk).length;
    const sigPairs = scored.filter((s) => !Number.isNaN(s.pred.significance.score));
    const mae = sigPairs.reduce((a, s) => a + Math.abs(s.pred.significance.score - s.gold.significance), 0) / Math.max(1, sigPairs.length);
    const within1 = sigPairs.filter((s) => Math.abs(s.pred.significance.score - s.gold.significance) <= 1).length;
    const calib = ece(scored.map((s) => ({ p: s.layerProb, ok: s.layerOk })));
    const lat = scored.map((s) => s.pred.latency_ms).sort((a, b) => a - b);
    const median = lat[Math.floor(lat.length / 2)] ?? 0;
    const cost = scored.reduce((a, s) => a + (s.pred.cost_usd ?? 0), 0);
    const errors = preds.filter((p) => p.error).length;
    summaries.push(`| ${b} | ${n}${errors ? ` (+${errors} errors)` : ""} | ${pct(layerAcc, n)} | ${pct(typeAcc, n)} | ${pct(typeGiven, withLayer.length)} | ${mae.toFixed(2)} | ${pct(within1, sigPairs.length)} | ${calib.ece.toFixed(3)} | ${median} ms | $${cost.toFixed(3)} | $${(cost / n).toFixed(4)} |`);

    sections.push(`## ${b}`, "", "### Per-layer recall", "", ...perLayer(scored), "", "### Top confusions (layer)", "", ...confusion(scored), "", "### Calibration of layer confidence", "", ...calib.table, "", "### Threshold sweep (auto-accept layer when confidence ≥ t)", "", ...thresholdSweep(scored.map((s) => ({ p: s.layerProb, ok: s.layerOk }))), "", "### Cross-cutting concerns", "", ...concernMetrics(scored), "");

    // A few disagreements for eyeballing
    const wrong = scored.filter((s) => !s.layerOk).slice(0, 10);
    if (wrong.length) {
      sections.push("### Sample layer disagreements", "", "| symbol | gold | predicted (conf) | gold rationale |", "|---|---|---|---|");
      for (const s of wrong) sections.push(`| ${s.card.label} ${s.card.qualified_name} | ${s.gold.layer}/${s.gold.element_type ?? "-"} | ${s.pred.layer.choice}/${s.pred.element_type.choice ?? "-"} (${Number.isNaN(s.layerProb) ? "?" : s.layerProb.toFixed(2)}) | ${s.gold.rationale.replace(/\|/g, "/").slice(0, 160)} |`);
      sections.push("");
    }
  }
  md.push("## Summary", "", ...summaries, "", "Type accuracy is exact match on the element type id. ECE = expected calibration error of the predicted layer's confidence (lower is better). Costs use list prices; Claude costs include cache reads at 0.1x.", "", ...sections);

  const out = md.join("\n").replace(/\n+$/, "");
  writeFileSync(path.join(dir, "report.md"), out + "\n");
  console.log(out);
}

main();
