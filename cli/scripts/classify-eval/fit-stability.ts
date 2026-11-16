/**
 * How fragile a fit is (TIER1_CALIBRATION.md section 6): the thresholds `fit-thresholds.ts` picks,
 * then (1) the margin of each corpus at them (how many more wrong cards would make it miss the
 * target), (2) the range of thresholds that accept exactly the same cards (so a grid tie-break
 * is visible), (3) the fit with each corpus left out, and (4) a bootstrap: the fit on cards
 * resampled with replacement within each corpus, how often each threshold triple comes out.
 * No model calls.
 *
 *   bun fit-stability.ts --run clef@<tag> --type-precision 0.88 --none-precision 0.9 [--samples 1000]
 */
import { fit, type FitOptions } from "./fit-thresholds.js";
import { acceptPoint, bandFor, notElementPoint, resolveRun, type AskedCard } from "./lib/bands.js";
import { parseFlags, seededRandom } from "./lib/io.js";

const flags = parseFlags(process.argv.slice(2));
const options: FitOptions = {
  typePrecision: Number(flags["type-precision"] ?? 0.88),
  nonePrecision: Number(flags["none-precision"] ?? 0.9),
  scope: (flags.scope as FitOptions["scope"]) ?? "each-corpus",
  bound: (flags.bound as FitOptions["bound"]) ?? "point",
};
const samples = Number(flags.samples ?? 1000);
const r = resolveRun(flags);
const corpora = r.corpora;
const base = fit(corpora, options);
if (!base.accept || !base.notElement) throw new Error("no fit");
const tl = base.accept.tLayer;
const tt = base.accept.tType;
const tn = base.notElement.tNone;
console.log(`Fit on ${r.run}: T_layer ${tl}, T_type ${tt}, T_none ${tn} (targets ${options.typePrecision} / ${options.nonePrecision}, ${options.scope}, ${options.bound}).`);

// (1) margins: wrong cards a corpus can still take at the fit before missing its target
console.log("\nMargins at the fit (more wrong cards each band can take before missing its target):");
for (const c of [{ corpus: "pooled", cards: corpora.flatMap((x) => x.cards) }, ...corpora]) {
  const a = acceptPoint(c.cards, tl, tt);
  const n = notElementPoint(c.cards, tn);
  const margin = (ok: number, total: number, target: number) => (total ? Math.floor(ok - target * total + 1e-9) : NaN);
  console.log(`  ${c.corpus}: accept ${a.typeOk}/${a.accepted} (margin ${margin(a.typeOk, a.accepted, options.typePrecision)}), not-element ${n.correct}/${n.hidden} (margin ${margin(n.correct, n.hidden, options.nonePrecision)})`);
}

// (2) the range of thresholds that give exactly the same accept band
const all: AskedCard[] = corpora.flatMap((c) => c.cards);
const answered = all.filter((c) => !c.error && c.layer !== "none" && c.type && c.type !== "none" && c.typeP != null);
const inBand = answered.filter((c) => c.layerP >= tl && c.typeP! >= tt);
const minTypeIn = Math.min(...inBand.map((c) => c.typeP!));
const maxTypeOutSameLayer = Math.max(0, ...answered.filter((c) => c.layerP >= tl && c.typeP! < tt).map((c) => c.typeP!));
const minLayerIn = Math.min(...inBand.map((c) => c.layerP));
const maxLayerOut = Math.max(0, ...answered.filter((c) => c.typeP! >= tt && c.layerP < tl).map((c) => c.layerP));
console.log(`\nSame accept band (${inBand.length} cards) for T_type in (${maxTypeOutSameLayer.toFixed(3)}, ${minTypeIn.toFixed(3)}] and T_layer in (${maxLayerOut.toFixed(3)}, ${minLayerIn.toFixed(3)}].`);
const none = all.filter((c) => !c.error && c.layer === "none");
const hidden = none.filter((c) => c.layerP >= tn);
console.log(`Same not-element band (${hidden.length} cards) for T_none in (${Math.max(0, ...none.filter((c) => c.layerP < tn).map((c) => c.layerP)).toFixed(3)}, ${Math.min(...hidden.map((c) => c.layerP)).toFixed(3)}].`);

// (3) leave one corpus out
console.log("\nLeave one corpus out:");
for (const out of corpora) {
  const f = fit(corpora.filter((c) => c !== out), options);
  console.log(`  without ${out.corpus}: ${f.accept ? `(${f.accept.tLayer}, ${f.accept.tType})` : "no accept fit"}, T_none ${f.notElement?.tNone ?? "none"}`);
}

// (4) bootstrap within each corpus
const rnd = seededRandom(1);
const counts = new Map<string, number>();
for (let i = 0; i < samples; i++) {
  const resampled = corpora.map((c) => ({ corpus: c.corpus, cards: c.cards.map(() => c.cards[Math.floor(rnd() * c.cards.length)]) }));
  const f = fit(resampled, options);
  const k = `${f.accept ? `(${f.accept.tLayer}, ${f.accept.tType})` : "no accept fit"} / ${f.notElement ? f.notElement.tNone : "no not-element fit"}`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
console.log(`\nBootstrap (${samples} resamples within each corpus): accept (T_layer, T_type) / T_none`);
for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${k}: ${((100 * n) / samples).toFixed(1)}%`);
void bandFor;
