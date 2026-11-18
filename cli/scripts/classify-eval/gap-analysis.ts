/**
 * Where the held-out gap comes from (TIER1_CALIBRATION.md section 8): the accept and not-element
 * bands of a run at the default thresholds, broken down by symbol kind, predicted layer and corpus
 * part, beside (1) a mix-adjusted in-sample precision, (2) the fit's optimism measured in-sample
 * (leave one corpus out, out-of-bag bootstrap), (3) the held-out precision over the in-sample fit's
 * bootstrap distribution, and (4) the labelling-process confound on the relabelled in-sample cards.
 * Analysis only: no model calls, and nothing it prints is used to choose a rule, criterion or
 * threshold (the held-out corpus stays held out).
 *
 *   bun gap-analysis.ts --run clef@<tag> [--held-out viewer] [--gold <tag>] [--samples 1000] [--out <file>]
 *
 * --gold <tag> scores the in-sample corpora against gold@<tag>.jsonl (relabel-full: today's prompt);
 * the held-out corpus always uses its gold.jsonl.
 */
import path from "node:path";
import { withoutFileCards } from "./lib/bands.js";
import { writeFileSync } from "node:fs";
import { DEFAULT_THRESHOLDS, wilson, type Thresholds } from "../../src/analyzers/classifier/bands.js";
import { fit, type FitOptions } from "./fit-thresholds.js";
import { askedCards, bandFor, CORPORA, loadRun, type AskedCard } from "./lib/bands.js";
import { corpusDir, flagStr, parseFlags, readJsonl, seededRandom } from "./lib/io.js";
import type { Card, Gold } from "./lib/types.js";

const flags = parseFlags(process.argv.slice(2));
const run = flagStr(flags, "run") ?? "clef@cbm012-kind-tier0-qset2-spec012-layercrit";
const heldOut = flagStr(flags, "held-out") ?? "viewer";
const samples = Number(flags.samples ?? 1000);
const goldTag = flagStr(flags, "gold");
const options: FitOptions = { typePrecision: 0.88, nonePrecision: 0.9, scope: "each-corpus", bound: "point" };
const d = DEFAULT_THRESHOLDS["dr-qset-2"]?.clef;
if (!d) throw new Error("no dr-qset-2 x clef defaults");
const defaults: Thresholds = { layer: d.layer, type: d.type, none: d.none };

interface Row extends AskedCard {
  kind: string;
  name: string;
  file: string;
  goldLayer: string;
  goldType: string | null;
  part: string;
  /** Client-side UI code (a React client): fastapi's frontend/ and every --ui-corpora corpus. */
  ui: boolean;
}

const uiCorpora = new Set((flagStr(flags, "ui-corpora") ?? "viewer").split(","));

function rowsOf(corpus: string, goldFile = "gold.jsonl"): Row[] {
  const preds = loadRun(corpus, run);
  if (!preds) throw new Error(`no pred-${run}.jsonl in ${corpus}`);
  const gold = new Map(withoutFileCards(corpus, readJsonl<Gold>(path.join(corpusDir(corpus), goldFile))).map((g) => [g.card_id, g]));
  const cards = new Map(readJsonl<Card>(path.join(corpusDir(corpus), "cards.jsonl")).map((c) => [c.id, c]));
  return askedCards(corpus, preds, gold).map((a) => {
    const c = cards.get(a.cardId)!;
    const g = gold.get(a.cardId)!;
    const file = c.file_path ?? "";
    const part = corpus === "fastapi" ? (file.startsWith("frontend/") ? "fastapi frontend (TS/React)" : "fastapi backend (Python)") : corpus;
    const ui = uiCorpora.has(corpus) || (corpus === "fastapi" && file.startsWith("frontend/"));
    return { ...a, kind: c.label, name: c.name, file, goldLayer: g.layer, goldType: g.element_type ?? null, part, ui };
  });
}

const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)}%` : "n/a");
const ci = (k: number, n: number) => {
  const w = wilson(k, n);
  return w ? `${(100 * w.lo).toFixed(1)}-${(100 * w.hi).toFixed(1)}` : "n/a";
};
const accepted = (rs: Row[], t = defaults) => rs.filter((r) => bandFor(r, t) === "accept");
const hidden = (rs: Row[], t = defaults) => rs.filter((r) => bandFor(r, t) === "not-element");
const out: string[] = [];
const say = (s = "") => out.push(s);

const inSample = Object.fromEntries(CORPORA.map((c) => [c, rowsOf(c, goldTag ? `gold@${goldTag}.jsonl` : "gold.jsonl")])) as Record<string, Row[]>;
const held = rowsOf(heldOut);
const pool = Object.values(inSample).flat();

say(`# Gap analysis: ${run}, ${heldOut} against the in-sample corpora`);
say();
say(`Thresholds (${defaults.layer}, ${defaults.type}, ${defaults.none}); model-asked cards; Wilson 95%; in-sample gold ${goldTag ? `gold@${goldTag}.jsonl` : "gold.jsonl"}. Analysis only.`);

// 1. Bands by symbol kind and by corpus part
function breakdown(title: string, key: (r: Row) => string, scopes: Array<[string, Row[]]>) {
  say();
  say(`## ${title}`);
  say();
  say("| scope | group | asked | accept (correct) | accept precision | not-element (correct) | not-element precision |");
  say("|---|---|---|---|---|---|---|");
  for (const [scope, rs] of scopes) {
    const groups = [...new Set(rs.map(key))].sort();
    for (const g of groups) {
      const sub = rs.filter((r) => key(r) === g);
      const a = accepted(sub);
      const h = hidden(sub);
      const aOk = a.filter((r) => r.typeOk).length;
      const hOk = h.filter((r) => r.goldNone).length;
      say(`| ${scope} | ${g} | ${sub.length} | ${a.length} (${aOk}) | ${pct(aOk, a.length)} | ${h.length} (${hOk}) | ${pct(hOk, h.length)} |`);
    }
  }
}
const scopes: Array<[string, Row[]]> = [[heldOut, held], ["in-sample", pool]];
breakdown("Bands by symbol kind", (r) => r.kind, scopes);
breakdown("Bands by predicted layer (accept) / all (not-element)", (r) => (r.layer === "none" ? "none" : r.layer), scopes);
breakdown("Bands by corpus part", (r) => r.part, [["all", [...pool, ...held]]]);
breakdown("Bands by code part and symbol kind", (r) => `${r.ui ? "UI client" : "other"} ${r.kind}`, [["all", [...pool, ...held]]]);

// 2. Every wrong card in the held-out bands
say();
say(`## Wrong cards in ${heldOut}'s bands`);
say();
say("| band | kind | symbol | file | predicted (layer p / type p) | gold |");
say("|---|---|---|---|---|---|");
for (const r of accepted(held).filter((r) => !r.typeOk))
  say(`| accept | ${r.kind} | ${r.name} | ${r.file} | ${r.layer}.${r.type} (${r.layerP.toFixed(2)} / ${r.typeP?.toFixed(2)}) | ${r.goldLayer}${r.goldType ? `.${r.goldType}` : ""} |`);
for (const r of hidden(held).filter((r) => !r.goldNone))
  say(`| not-element | ${r.kind} | ${r.name} | ${r.file} | none (${r.layerP.toFixed(2)}) | ${r.goldLayer}${r.goldType ? `.${r.goldType}` : ""} |`);
say();
say("In-sample wrong accepts, for comparison:");
say();
say("| corpus | kind | symbol | predicted | gold |");
say("|---|---|---|---|---|");
for (const r of accepted(pool).filter((r) => !r.typeOk)) say(`| ${r.corpus} | ${r.kind} | ${r.name} | ${r.layer}.${r.type} | ${r.goldLayer}${r.goldType ? `.${r.goldType}` : ""} |`);

// 3. Mix-adjusted in-sample precision: in-sample precision per stratum, weighted by the held-out band's mix
function mixAdjusted(key: (r: Row) => string, label: string) {
  const a = accepted(held);
  const ins = accepted(pool);
  let num = 0;
  let w = 0;
  const missing: string[] = [];
  for (const g of new Set(a.map(key))) {
    const n = a.filter((r) => key(r) === g).length;
    const s = ins.filter((r) => key(r) === g);
    if (!s.length) {
      missing.push(`${g} (${n})`);
      continue;
    }
    num += (n * s.filter((r) => r.typeOk).length) / s.length;
    w += n;
  }
  say(`| ${label} | ${pct(num, w)} | ${w} of ${a.length} | ${missing.join(", ") || "-"} |`);
}
say();
say(`## In-sample accept precision re-weighted to ${heldOut}'s accept-band mix`);
say();
say(`| stratum | in-sample precision at ${heldOut}'s mix | ${heldOut} accepted cards covered | strata with no in-sample accepts |`);
say("|---|---|---|---|");
say(`| none (raw pool) | ${pct(accepted(pool).filter((r) => r.typeOk).length, accepted(pool).length)} | - | - |`);
mixAdjusted((r) => (r.ui ? "UI client" : "other"), "code part (UI client or not)");
mixAdjusted((r) => r.kind, "symbol kind");
mixAdjusted((r) => r.layer, "predicted layer");
mixAdjusted((r) => `${r.layer}.${r.type}`, "predicted type");

// 4. The fit's optimism, in-sample
const prec = (rs: Row[], t: Thresholds) => {
  const a = accepted(rs, t);
  const h = hidden(rs, t);
  return { a: a.length, aOk: a.filter((r) => r.typeOk).length, h: h.length, hOk: h.filter((r) => r.goldNone).length };
};
const tOf = (f: ReturnType<typeof fit>): Thresholds | null =>
  f.accept && f.notElement ? { layer: f.accept.tLayer, type: f.accept.tType, none: f.notElement.tNone } : null;
say();
say("## The fit's optimism, measured in-sample");
say();
say("Leave one corpus out: fit on the other two, score the left-out corpus at that fit.");
say();
say("| left out | fit on the others | in-fit accept precision | left-out accept (correct) | left-out precision | in-fit not-element precision | left-out not-element (correct) | left-out precision |");
say("|---|---|---|---|---|---|---|---|");
for (const c of CORPORA) {
  const others = CORPORA.filter((o) => o !== c).map((o) => ({ corpus: o, cards: inSample[o] }));
  const t = tOf(fit(others, options));
  if (!t) {
    say(`| ${c} | no fit | | | | | | |`);
    continue;
  }
  const i = prec(others.flatMap((o) => o.cards) as Row[], t);
  const o = prec(inSample[c], t);
  say(`| ${c} | (${t.layer}, ${t.type}, ${t.none}) | ${pct(i.aOk, i.a)} | ${o.a} (${o.aOk}) | ${pct(o.aOk, o.a)} | ${pct(i.hOk, i.h)} | ${o.h} (${o.hOk}) | ${pct(o.hOk, o.h)} |`);
}

const rnd = seededRandom(1);
let inA = 0, inAOk = 0, inH = 0, inHOk = 0, oobA = 0, oobAOk = 0, oobH = 0, oobHOk = 0, fits = 0;
const fitCounts = new Map<string, { n: number; t: Thresholds }>();
for (let i = 0; i < samples; i++) {
  const picked = new Set<string>();
  const resampled = CORPORA.map((c) => ({
    corpus: c,
    cards: inSample[c].map(() => {
      const r = inSample[c][Math.floor(rnd() * inSample[c].length)];
      picked.add(`${c}/${r.cardId}`);
      return r;
    }),
  }));
  const t = tOf(fit(resampled, options));
  if (!t) continue;
  fits++;
  const k = `(${t.layer}, ${t.type}, ${t.none})`;
  fitCounts.set(k, { n: (fitCounts.get(k)?.n ?? 0) + 1, t });
  const ib = prec(resampled.flatMap((r) => r.cards) as Row[], t);
  const oob = prec(pool.filter((r) => !picked.has(`${r.corpus}/${r.cardId}`)), t);
  inA += ib.a; inAOk += ib.aOk; inH += ib.h; inHOk += ib.hOk;
  oobA += oob.a; oobAOk += oob.aOk; oobH += oob.h; oobHOk += oob.hOk;
}
say();
say(`Bootstrap (${samples} resamples within each corpus, ${fits} with a fit): precision at each resample's own fit, in the resample (in-bag) and on the cards it left out (out-of-bag), card-weighted over resamples.`);
say();
say("| band | in-bag precision | out-of-bag precision | optimism (points) |");
say("|---|---|---|---|");
say(`| accept | ${pct(inAOk, inA)} | ${pct(oobAOk, oobA)} | ${((100 * inAOk) / inA - (100 * oobAOk) / oobA).toFixed(1)} |`);
say(`| not-element | ${pct(inHOk, inH)} | ${pct(oobHOk, oobH)} | ${((100 * inHOk) / inH - (100 * oobHOk) / oobH).toFixed(1)} |`);

// 5. Held-out precision over the in-sample fit's bootstrap distribution (not a search over thresholds)
say();
say(`## ${heldOut} over the in-sample fit's bootstrap distribution`);
say();
say(`The thresholds the in-sample bootstrap picks (most common first), and ${heldOut}'s bands at each: how much the held-out result depends on which fastapi cards the fit happened to see. Not used to choose thresholds.`);
say();
say(`| in-sample fit | share of resamples | ${heldOut} accept (correct) | precision (95%) | ${heldOut} not-element (correct) | precision (95%) |`);
say("|---|---|---|---|---|---|");
let wA = 0, wAOk = 0, wH = 0, wHOk = 0;
for (const [k, { n, t }] of [...fitCounts].sort((a, b) => b[1].n - a[1].n)) {
  const p = prec(held, t);
  wA += n * p.a; wAOk += n * p.aOk; wH += n * p.h; wHOk += n * p.hOk;
  if (n / fits >= 0.02) say(`| ${k} | ${pct(n, fits)} | ${p.a} (${p.aOk}) | ${pct(p.aOk, p.a)} (${ci(p.aOk, p.a)}) | ${p.h} (${p.hOk}) | ${pct(p.hOk, p.h)} (${ci(p.hOk, p.h)}) |`);
}
say(`| **all resamples, weighted** | 100% | ${(wA / fits).toFixed(1)} per run | ${pct(wAOk, wA)} | ${(wH / fits).toFixed(1)} per run | ${pct(wHOk, wH)} |`);

// 6. The labelling confound on the relabelled in-sample cards
say();
say("## The labelling-process confound on the relabelled in-sample cards (`gold@relabel-1116.jsonl`)");
say();
say("| corpus | relabelled, model-asked | in accept band | correct vs October gold | vs today's gold | in not-element band | correct vs October | vs today's |");
say("|---|---|---|---|---|---|---|---|");
let t1 = [0, 0, 0, 0, 0, 0, 0];
for (const c of CORPORA) {
  const neu = rowsOf(c, "gold@relabel-1116.jsonl");
  const ids = new Set(neu.map((r) => r.cardId));
  const old = inSample[c].filter((r) => ids.has(r.cardId));
  const aOld = accepted(old), aNew = accepted(neu), hOld = hidden(old), hNew = hidden(neu);
  const row = [old.length, aOld.length, aOld.filter((r) => r.typeOk).length, aNew.filter((r) => r.typeOk).length, hOld.length, hOld.filter((r) => r.goldNone).length, hNew.filter((r) => r.goldNone).length];
  t1 = t1.map((v, i) => v + row[i]);
  say(`| ${c} | ${row.join(" | ")} |`);
}
say(`| pooled | ${t1.join(" | ")} |`);

const file = flagStr(flags, "out") ?? path.join(path.dirname(corpusDir(heldOut)), `gap-analysis@${run}@${heldOut}${goldTag ? `@gold-${goldTag}` : ""}.md`);
writeFileSync(file, out.join("\n") + "\n");
console.log(out.join("\n"));
console.error(`\nWrote ${file}`);
