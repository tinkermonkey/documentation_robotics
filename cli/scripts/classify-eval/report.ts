/**
 * Score predictions against gold labels: accuracy, calibration, thresholds, cost.
 *
 *   bun report.ts --corpus dr-cli [--backends clef-flash,claude-haiku] [--gold <tag>]
 *
 * Writes data/<corpus>/report[@<gold tag>].md and prints it. --gold scores against gold@<tag>.jsonl.
 *
 * The band report (TIER1_DESIGN.md section 6, steps 1-2), pooled over the corpora and per corpus:
 *
 *   bun report.ts --bands --backend cloudflare:clef --tag cbm012-kind-tier0 [--qset dr-qset-1]
 *                 [--corpora dr-cli,fastapi,petclinic]
 *
 * For each band, precision and coverage over its threshold (accept: T_layer 0.5-0.8 by T_type
 * 0-0.6; not-element: T_none) with Wilson 95% intervals, and per 1,000 model-asked cards the cards
 * removed from the agent's list, the wrong elements staged (accept) and the real elements hidden
 * (not-element). Bands come from the CLI's `bandOf`; the default thresholds of `bands.ts` for the
 * run's question set and canonical model are marked. `--qset` names the question set for runs made
 * before predictions recorded it. Writes data/bands@<run>.md and prints it.
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { corpusDir, flagStr, parseFlags, readJsonl } from "./lib/io.js";
import { NONE_OPTION } from "./lib/spec.js";
import { CONCERNS, type Card, type Gold, type Prediction } from "./lib/types.js";
import { harnessDir } from "./lib/env.js";
import { thresholdsFor } from "../../src/analyzers/classifier/bands.js";
import {
  acceptCurve,
  acceptPoint,
  acceptTable,
  askedCards,
  CORPORA,
  notElementCurve,
  notElementPoint,
  notElementTable,
  resolveRun,
  wilson,
  type AskedCard,
} from "./lib/bands.js";

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

/** The band report: section 6 steps 1-2, pooled and per corpus. */
function bandsMain(flags: Record<string, string | boolean>): void {
  const r = resolveRun(flags);
  const thresholds = r.qset && r.canonicalModel ? thresholdsFor(r.qset, r.canonicalModel) : null;
  const pooled: AskedCard[] = r.corpora.flatMap((c) => c.cards);
  const scopes: Array<{ name: string; cards: AskedCard[] }> = [{ name: "Pooled", cards: pooled }, ...r.corpora.map((c) => ({ name: c.corpus, cards: c.cards }))];
  const pctOf = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)}%` : "n/a");
  const ci = (k: number, n: number) => {
    const w = wilson(k, n);
    return w ? ` (${(100 * w.lo).toFixed(1)}-${(100 * w.hi).toFixed(1)})` : "";
  };

  const md: string[] = [];
  md.push(`# Band report: ${r.run}`, "");
  md.push(
    `Generated ${new Date().toISOString()} by \`report.ts --bands\`. Question set: ${r.qset ?? "unknown (pass --qset)"}${r.qsetVariants.length ? ` (predictions record ${r.qsetVariants.join(", ")})` : " (not recorded in the predictions)"}. Canonical model: ${r.canonicalModel ?? "unknown"}. Spec: ${r.specVersions.length ? r.specVersions.join(", ") : "not recorded in the predictions"}.`,
    "",
    `Model-asked cards only (no Tier-0 rule, or a narrowing one): ${r.corpora.map((c) => `${c.corpus} ${c.cards.length}`).join(", ")}; ${pooled.length} pooled. Bands from the CLI's \`bandOf\`. Type precision is end to end (layer and type both match gold); a not-element card is correct when gold says \`none\`. Intervals are Wilson 95%. Per 1,000 asked cards: "removed" is cards taken off the agent's list, "wrong elements staged" accepted cards whose layer or type is wrong, "real elements hidden" not-element cards gold calls an element.`,
    ""
  );
  if (thresholds) {
    md.push(`## At the default thresholds`, "", `T_layer ${thresholds.layer}, T_type ${thresholds.type}, T_none ${thresholds.none} (\`bands.ts\`, ${r.qset} x ${r.canonicalModel}).`, "");
    md.push("| scope | asked | accept: cards (coverage) | type precision (95%) | layer precision | not-element: cards (coverage) | precision (95%) | escalate |", "|---|---|---|---|---|---|---|---|");
    for (const s of scopes) {
      const a = acceptPoint(s.cards, thresholds.layer, thresholds.type);
      const n = notElementPoint(s.cards, thresholds.none);
      md.push(
        `| ${s.name} | ${s.cards.length} | ${a.accepted} (${pctOf(a.accepted, s.cards.length)}) | ${pctOf(a.typeOk, a.accepted)}${ci(a.typeOk, a.accepted)} | ${pctOf(a.layerOk, a.accepted)} | ${n.hidden} (${pctOf(n.hidden, s.cards.length)}) | ${pctOf(n.correct, n.hidden)}${ci(n.correct, n.hidden)} | ${s.cards.length - a.accepted - n.hidden} |`
      );
    }
    md.push("");
  } else {
    md.push(`No default thresholds in \`bands.ts\` for ${r.qset ?? "this question set"} x ${r.canonicalModel ?? "this model"}: the curves are unmarked.`, "");
  }
  for (const s of scopes) {
    md.push(`## ${s.name}: accept band (${s.cards.length} asked)`, "", ...acceptTable(acceptCurve(s.cards), thresholds), "");
    md.push(`## ${s.name}: not-element band`, "", ...notElementTable(notElementCurve(s.cards), thresholds), "");
  }
  const out = md.join("\n").replace(/\n+$/, "");
  writeFileSync(path.join(harnessDir(), "data", `bands@${r.run}.md`), out + "\n");
  console.log(out);
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.bands) return bandsMain(flags);
  const corpus = flagStr(flags, "corpus");
  if (!corpus) {
    console.error("Usage: bun report.ts --corpus <name> [--backends a,b]");
    process.exit(2);
  }
  const dir = corpusDir(corpus);
  const cards = new Map(readJsonl<Card>(path.join(dir, "cards.jsonl")).map((c) => [c.id, c]));
  const goldTag = flagStr(flags, "gold");
  const golds = new Map(readJsonl<Gold>(path.join(dir, `gold${goldTag ? `@${goldTag}` : ""}.jsonl`)).map((g) => [g.card_id, g]));
  const backends = flagStr(flags, "backends")?.split(",").map((s) => s.trim()) ?? readdirSync(dir).filter((f) => f.startsWith("pred-") && f.endsWith(".jsonl")).map((f) => f.slice(5, -6));

  const md: string[] = [];
  md.push(`# Classification eval report: ${corpus}${goldTag ? ` (gold@${goldTag})` : ""}`, "", `Generated ${new Date().toISOString()}. Cards: ${cards.size}. Gold labels: ${golds.size}${goldTag ? ` from gold@${goldTag}.jsonl` : ""}.`, "");

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
    // rule-decided cards (tier0 decide/reject) were not asked significance, concerns or confidence:
    // score those on the model-asked cards only, and report how many a rule decided
    const asked = scored.filter((s) => !s.pred.tier0 || s.pred.tier0.kind === "narrow");
    const ruled = n - asked.length;
    const sigPairs = asked.filter((s) => typeof s.pred.significance.score === "number" && !Number.isNaN(s.pred.significance.score));
    const mae = sigPairs.reduce((a, s) => a + Math.abs(s.pred.significance.score - s.gold.significance), 0) / Math.max(1, sigPairs.length);
    const within1 = sigPairs.filter((s) => Math.abs(s.pred.significance.score - s.gold.significance) <= 1).length;
    const calib = ece(asked.map((s) => ({ p: s.layerProb, ok: s.layerOk })));
    const lat = asked.map((s) => s.pred.latency_ms).sort((a, b) => a - b);
    const median = lat[Math.floor(lat.length / 2)] ?? 0;
    const cost = scored.reduce((a, s) => a + (s.pred.cost_usd ?? 0), 0);
    const errors = preds.filter((p) => p.error).length;
    summaries.push(`| ${b} | ${n}${errors ? ` (+${errors} errors)` : ""}${ruled ? ` (${ruled} by rule)` : ""} | ${pct(layerAcc, n)} | ${pct(typeAcc, n)} | ${pct(typeGiven, withLayer.length)} | ${mae.toFixed(2)} | ${pct(within1, sigPairs.length)} | ${calib.ece.toFixed(3)} | ${median} ms | $${cost.toFixed(3)} | $${(cost / n).toFixed(4)} |`);

    sections.push(`## ${b}`, "", "### Per-layer recall", "", ...perLayer(scored), "", "### Top confusions (layer)", "", ...confusion(scored), "", "### Calibration of layer confidence", "", ...calib.table, "", "### Threshold sweep (auto-accept layer when confidence ≥ t)", "", ...thresholdSweep(asked.map((s) => ({ p: s.layerProb, ok: s.layerOk }))), "", "### Cross-cutting concerns", "", ...concernMetrics(asked), "");
    // the note follows the concerns table: a blank line first, or Markdown reads it as a table row
    if (ruled) sections.splice(sections.length - 1, 0, "", `Calibration, threshold sweep, concerns, significance and latency are over the ${asked.length} model-asked cards; ${ruled} cards were decided by a Tier-0 rule.`, "");

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
  writeFileSync(path.join(dir, `report${goldTag ? `@${goldTag}` : ""}.md`), out + "\n");
  console.log(out);
}

main();
