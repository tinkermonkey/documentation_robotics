/**
 * The held-out test of TIER1_DESIGN.md section 6 (B5): a run's predictions on the held-out corpus
 * (`viewer`, the viewer codebase, never read while writing rules, question sets, criteria or
 * thresholds), scored at the model's default thresholds from `bands.ts` and set beside the same
 * run on the in-sample corpora. No model calls.
 *
 *   bun held-out.ts --run clef@cbm012-kind-tier0-qset2-spec012 [--corpus viewer] \
 *     [--thresholds 0.6,0.4,0.6]   # score other thresholds instead of the defaults
 *
 * Reports, with Wilson 95% intervals: layer and end-to-end type accuracy on every gold card (rule
 * decided or asked), and on model-asked cards the accept band (coverage, type precision) and the
 * not-element band (coverage, precision). Then the verdict of `heldOutVerdict` (the CLI's
 * `bands.ts`) under `TIER1_TARGETS` and the section 6 rule, and under alternative targets and the
 * stricter reading, so the targets can be chosen in review. Prints the `heldOut` record for
 * `DEFAULT_THRESHOLDS` and writes data/held-out@<run>.md. It never edits bands.ts.
 */
import path from "node:path";
import { writeFileSync } from "node:fs";
import {
  heldOutVerdict,
  HELD_OUT_MIN_CARDS,
  HELD_OUT_RULE,
  thresholdsFor,
  TIER1_TARGETS,
  wilson,
  type HeldOutRecord,
  type HeldOutRule,
  type Thresholds,
  type Tier1Targets,
} from "../../src/analyzers/classifier/bands.js";
import { acceptPoint, goldOf, CORPORA, loadRun, notElementPoint, resolveRun, type AskedCard } from "./lib/bands.js";
import { currentSpec, initSpec } from "./lib/spec.js";
import { criteriaDigest } from "../../src/analyzers/classifier/criteria.js";
import { harnessDir } from "./lib/env.js";
import { corpusDir, flagStr, parseFlags, readJson, readJsonl } from "./lib/io.js";
import type { Gold, Prediction } from "./lib/types.js";

/** The targets shown beside the provisional ones (TIER1_CALIBRATION.md section 6). */
export const ALTERNATIVE_TARGETS: Tier1Targets[] = [
  { typePrecision: 0.85, nonePrecision: 0.9 },
  { typePrecision: 0.88, nonePrecision: 0.9 },
  { typePrecision: 0.9, nonePrecision: 0.9 },
  { typePrecision: 0.9, nonePrecision: 0.95 },
];

const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)}%` : "n/a");
const ci = (k: number, n: number) => {
  const w = wilson(k, n);
  return w ? `${pct(k, n)} (${(100 * w.lo).toFixed(1)}-${(100 * w.hi).toFixed(1)})` : "n/a";
};

/** Layer and end-to-end type accuracy over every gold card a run predicted (as compare.ts scores them). */
function accuracy(corpus: string, run: string, goldTag?: string): { cards: number; layerOk: number; typeOk: number } {
  const dir = corpusDir(corpus);
  const gold = goldOf(corpus, goldTag);
  const preds = new Map(readJsonl<Prediction>(path.join(dir, `pred-${run}.jsonl`)).filter((p) => !p.error).map((p) => [p.card_id, p]));
  let cards = 0;
  let layerOk = 0;
  let typeOk = 0;
  for (const [id, g] of gold) {
    const p = preds.get(id);
    if (!p) continue;
    cards++;
    const l = p.layer.choice === g.layer;
    if (l) layerOk++;
    if (l && (g.layer === "none" ? null : g.element_type) === (p.element_type.choice ?? null)) typeOk++;
  }
  return { cards, layerOk, typeOk };
}

function bands(cards: AskedCard[], t: Thresholds) {
  const a = acceptPoint(cards, t.layer, t.type);
  const n = notElementPoint(cards, t.none);
  return { asked: cards.length, accept: { cards: a.accepted, correct: a.typeOk }, notElement: { cards: n.hidden, correct: n.correct } };
}

function parseThresholds(v: string): Thresholds {
  const [layer, type, none] = v.split(",").map(Number);
  if (![layer, type, none].every((x) => Number.isFinite(x) && x >= 0 && x <= 1)) throw new Error(`--thresholds <layer,type,none>, e.g. 0.6,0.4,0.6; got ${v}`);
  return { layer, type, none };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const run = flagStr(flags, "run");
  if (!run) throw new Error("Usage: bun held-out.ts --run <backend@tag> [--corpus viewer] [--gold <tag>] [--thresholds l,t,n]");
  const corpus = flagStr(flags, "corpus", "viewer")!;
  // --gold <tag>: the in-sample rows score against gold@<tag>.jsonl; the held-out corpus keeps gold.jsonl.
  const goldTag = flagStr(flags, "gold");
  const held = resolveRun({ run, corpora: corpus });
  const inSample = resolveRun({ run, corpora: CORPORA.join(","), ...(goldTag ? { gold: goldTag } : {}) });
  if (!held.qset || !held.canonicalModel) throw new Error(`pred-${run}.jsonl doesn't record its question set or model`);
  if (held.variant) throw new Error(`pred-${run}.jsonl is a harness variant (${held.qsetVariants.join(", ")}): production never sends it`);
  const given = flagStr(flags, "thresholds");
  const t = given ? parseThresholds(given) : thresholdsFor(held.qset, held.canonicalModel);
  if (!t) throw new Error(`no default thresholds for ${held.qset} x ${held.canonicalModel}: pass --thresholds`);
  const meta = readJson<{ source_commit?: string }>(path.join(corpusDir(corpus), "meta.json"), {});
  const specVersion = [...new Set([...held.specVersions, ...inSample.specVersions])];
  if (specVersion.length !== 1) throw new Error(`the runs record spec versions ${specVersion.join(", ") || "none"}: score one spec at a time`);

  const heldCards = held.corpora.flatMap((c) => c.cards);
  const pooledCards = inSample.corpora.flatMap((c) => c.cards);
  const scopes = [
    { name: `${corpus} (held out)`, acc: accuracy(corpus, run), b: bands(heldCards, t) },
    { name: `in-sample, pooled (${inSample.corpora.map((c) => c.corpus).join(", ")})`, acc: sumAcc(inSample.corpora.map((c) => accuracy(c.corpus, run, goldTag))), b: bands(pooledCards, t) },
    ...inSample.corpora.map((c) => ({ name: c.corpus, acc: accuracy(c.corpus, run, goldTag), b: bands(c.cards, t) })),
  ];

  const md: string[] = [];
  md.push(`# Held-out test: ${run} on ${corpus}`, "");
  md.push(
    `Generated ${new Date().toISOString()} by \`held-out.ts\`. Question set ${held.qset}, model ${held.canonicalModel}, served by ${held.servingLabel}, spec ${specVersion[0]}. ` +
      `Held-out corpus \`${corpus}\` at ${meta.source_commit ?? "(no source_commit in meta.json)"}. ` +
      `Thresholds T_layer ${t.layer}, T_type ${t.type}, T_none ${t.none} (${given ? "--thresholds" : `the defaults in \`bands.ts\``}). Intervals are Wilson 95%.` +
      (goldTag ? ` In-sample rows score against \`gold@${goldTag}.jsonl\`.` : ""),
    ""
  );
  md.push(
    "| scope | gold cards | layer accuracy | type accuracy, end to end | model-asked | accept: cards (coverage) | type precision | not-element: cards (coverage) | precision |",
    "|---|---|---|---|---|---|---|---|---|"
  );
  for (const s of scopes) {
    md.push(
      `| ${s.name} | ${s.acc.cards} | ${ci(s.acc.layerOk, s.acc.cards)} | ${ci(s.acc.typeOk, s.acc.cards)} | ${s.b.asked} | ${s.b.accept.cards} (${pct(s.b.accept.cards, s.b.asked)}) | ${ci(s.b.accept.correct, s.b.accept.cards)} | ${s.b.notElement.cards} (${pct(s.b.notElement.cards, s.b.asked)}) | ${ci(s.b.notElement.correct, s.b.notElement.cards)} |`
    );
  }
  const h = scopes[0].b;
  md.push("", "## Verdict", "");
  md.push(
    `The defaults count as \`held-out\` when both bands on the held-out corpus meet their targets. Rule \`lower-bound\` (\`HELD_OUT_RULE\`): the band's whole Wilson interval clears the target (lower bound >= target). \`within-interval\` (an alternative, shown for comparison): the interval reaches it (upper bound >= target). Under both, a band of fewer than ${HELD_OUT_MIN_CARDS} cards (\`HELD_OUT_MIN_CARDS\`) fails: here accept ${h.accept.cards}, not-element ${h.notElement.cards}.`,
    ""
  );
  md.push("| targets (type / none) | rule | accept | not-element | verdict |", "|---|---|---|---|---|");
  const rules: HeldOutRule[] = ["lower-bound", "within-interval"];
  const targets = [...ALTERNATIVE_TARGETS];
  if (!targets.some((x) => x.typePrecision === TIER1_TARGETS.typePrecision && x.nonePrecision === TIER1_TARGETS.nonePrecision)) targets.unshift({ ...TIER1_TARGETS });
  for (const tg of targets) {
    for (const rule of rules) {
      const v = heldOutVerdict(h, tg, rule);
      const provisional = tg.typePrecision === TIER1_TARGETS.typePrecision && tg.nonePrecision === TIER1_TARGETS.nonePrecision && rule === HELD_OUT_RULE;
      // Why a band misses: too few cards, or the interval.
      const why = (band: { cards: number; correct: number }, target: number, ok: boolean) =>
        ok ? "meets" : band.cards < HELD_OUT_MIN_CARDS ? `misses (${band.cards} < ${HELD_OUT_MIN_CARDS} cards)` : "misses (interval)";
      md.push(
        `| ${tg.typePrecision.toFixed(2)} / ${tg.nonePrecision.toFixed(2)}${provisional ? " **(provisional)**" : ""} | ${rule} | ${why(h.accept, tg.typePrecision, v.accept)} | ${why(h.notElement, tg.nonePrecision, v.notElement)} | ${v.pass ? "**held-out**" : "in-sample"} |`
      );
    }
  }
  // The serving and criteria the run had: stage mode applies to the same serving and criteria only.
  const heldPreds = loadRun(corpus, run) ?? [];
  const digests = [...new Set(heldPreds.map((p) => p.criteria_digest).filter((d): d is string => !!d))];
  if (digests.length > 1) throw new Error(`pred-${run}.jsonl mixes criteria digests: score one criteria at a time`);
  await initSpec();
  const criteria = digests[0] ?? criteriaDigest(currentSpec());
  const record: HeldOutRecord = {
    corpus,
    sourceCommit: meta.source_commit ?? "",
    run,
    cards: h.asked,
    specVersion: specVersion[0],
    date: new Date().toISOString().slice(0, 10),
    serving: { provider: held.serving.provider ?? "unknown", upstream: held.serving.upstream },
    criteriaDigest: criteria,
    accept: h.accept,
    notElement: h.notElement,
  };
  if (!digests.length) {
    md.push("", `The predictions don't record their criteria digest (runs before 2026-11-16): the record takes the digest of the criteria this CLI builds from its bundled spec, ${criteria.slice(0, 12)}…, which is right only if the run used them.`);
  }
  const verdict = heldOutVerdict(h, TIER1_TARGETS, HELD_OUT_RULE);
  md.push(
    "",
    `Under the provisional targets (${TIER1_TARGETS.typePrecision} / ${TIER1_TARGETS.nonePrecision}, ${HELD_OUT_RULE}): **${verdict.pass ? "held-out" : "in-sample"}**.`,
    "",
    `The \`heldOut\` record for \`DEFAULT_THRESHOLDS["${held.qset}"]["${held.canonicalModel}"]\`:`,
    "",
    "```json",
    JSON.stringify(record, null, 2),
    "```"
  );
  const out = md.join("\n");
  // The viewer keeps the original name; another held-out corpus or relabelled in-sample gold gets its own file.
  const suffix = `${corpus === "viewer" ? "" : `@${corpus}`}${given ? `@${t.layer}-${t.type}-${t.none}` : ""}${goldTag ? `@gold-${goldTag}` : ""}`;
  const file = path.join(harnessDir(), "data", `held-out@${run}${suffix}.md`);
  writeFileSync(file, out + "\n");
  console.log(out);
}

function sumAcc(xs: Array<{ cards: number; layerOk: number; typeOk: number }>) {
  return xs.reduce((a, b) => ({ cards: a.cards + b.cards, layerOk: a.layerOk + b.layerOk, typeOk: a.typeOk + b.typeOk }), { cards: 0, layerOk: 0, typeOk: 0 });
}

if (import.meta.main) {
  try {
    await main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
