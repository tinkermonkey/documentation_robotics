/**
 * The held-out test of TIER1_DESIGN.md section 6: a run's predictions on the held-out corpora
 * (`viewer` by default; `jaeger-ui`, `miniflux`, `eshop`: never read while writing rules, question
 * sets, criteria or thresholds), scored at the model's default thresholds from `bands.ts` and set
 * beside the same run on the in-sample corpora. No model calls.
 *
 *   bun held-out.ts --run clef@cbm012-kind-tier0-qset2-spec012-layercrit --corpus viewer,jaeger-ui,miniflux,eshop \
 *     [--gold relabel-full]          # in-sample rows against relabelled gold
 *     [--thresholds 0.6,0.4,0.6]     # score other thresholds instead of the defaults
 *
 * Reports, with Wilson 95% intervals: layer and end-to-end type accuracy on every gold card (rule
 * decided or asked), and on model-asked cards the accept band (coverage, type precision) and the
 * not-element band (coverage, precision), per held-out corpus and pooled. Then the verdict of
 * `verdictOf` (the CLI's `bands.ts`), band by band, under `TIER1_TARGETS`, `HELD_OUT_RULE` and
 * `HELD_OUT_POOLING`, and under alternative targets, rules and poolings, so they can be chosen in
 * review. Prints the `heldOut` record for `DEFAULT_THRESHOLDS` and writes
 * data/held-out@<run>[@<corpora>].md. It never edits bands.ts.
 */
import path from "node:path";
import { writeFileSync } from "node:fs";
import {
  HELD_OUT_MIN_CARDS,
  HELD_OUT_POOLING,
  HELD_OUT_RULE,
  thresholdsFor,
  TIER1_TARGETS,
  wilson,
  verdictOf,
  type HeldOutPooling,
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

/** The targets shown beside `TIER1_TARGETS` (TIER1_CALIBRATION.md sections 6 and 10). */
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
  if (!run) throw new Error("Usage: bun held-out.ts --run <backend@tag> [--corpus viewer[,jaeger-ui,...]] [--gold <tag>] [--thresholds l,t,n]");
  const corpora = (flagStr(flags, "corpus", "viewer") ?? "viewer").split(",").map((c) => c.trim()).filter(Boolean);
  // --gold <tag>: the in-sample rows score against gold@<tag>.jsonl; the held-out corpora keep gold.jsonl.
  const goldTag = flagStr(flags, "gold");
  const held = resolveRun({ run, corpora: corpora.join(",") });
  const missing = corpora.filter((c) => !held.corpora.some((h) => h.corpus === c));
  if (missing.length) throw new Error(`no pred-${run}.jsonl in ${missing.join(", ")}`);
  const inSample = resolveRun({ run, corpora: CORPORA.join(","), ...(goldTag ? { gold: goldTag } : {}) });
  if (!held.qset || !held.canonicalModel) throw new Error(`pred-${run}.jsonl doesn't record its question set or model`);
  if (held.variant) throw new Error(`pred-${run}.jsonl is a harness variant (${held.qsetVariants.join(", ")}): production never sends it`);
  const given = flagStr(flags, "thresholds");
  const t = given ? parseThresholds(given) : thresholdsFor(held.qset, held.canonicalModel);
  if (!t) throw new Error(`no default thresholds for ${held.qset} x ${held.canonicalModel}: pass --thresholds`);
  const commitOf = (c: string) => readJson<{ source_commit?: string }>(path.join(corpusDir(c), "meta.json"), {}).source_commit ?? "";
  const specVersion = [...new Set([...held.specVersions, ...inSample.specVersions])];
  if (specVersion.length !== 1) throw new Error(`the runs record spec versions ${specVersion.join(", ") || "none"}: score one spec at a time`);

  const heldBands = held.corpora.map((c) => ({ corpus: c.corpus, b: bands(c.cards, t) }));
  const heldCards = held.corpora.flatMap((c) => c.cards);
  const pooledCards = inSample.corpora.flatMap((c) => c.cards);
  const heldName = corpora.length > 1 ? `held out, pooled (${corpora.join(", ")})` : `${corpora[0]} (held out)`;
  const scopes = [
    ...(corpora.length > 1 ? held.corpora.map((c) => ({ name: `${c.corpus} (held out)`, acc: accuracy(c.corpus, run), b: bands(c.cards, t) })) : []),
    { name: heldName, acc: sumAcc(corpora.map((c) => accuracy(c, run))), b: bands(heldCards, t) },
    { name: `in-sample, pooled (${inSample.corpora.map((c) => c.corpus).join(", ")})`, acc: sumAcc(inSample.corpora.map((c) => accuracy(c.corpus, run, goldTag))), b: bands(pooledCards, t) },
    ...inSample.corpora.map((c) => ({ name: c.corpus, acc: accuracy(c.corpus, run, goldTag), b: bands(c.cards, t) })),
  ];

  const md: string[] = [];
  md.push(`# Held-out test: ${run} on ${corpora.join(", ")}`, "");
  md.push(
    `Generated ${new Date().toISOString()} by \`held-out.ts\`. Question set ${held.qset}, model ${held.canonicalModel}, served by ${held.servingLabel}, spec ${specVersion[0]}. ` +
      `Held-out ${corpora.length > 1 ? "corpora" : "corpus"} ${corpora.map((c) => `\`${c}\` at ${commitOf(c) || "(no source_commit in meta.json)"}`).join(", ")}. ` +
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

  // The serving and criteria the run had: stage and hide mode apply to the same serving and criteria only.
  const digests = [...new Set(corpora.flatMap((c) => loadRun(c, run) ?? []).map((p) => p.criteria_digest).filter((d): d is string => !!d))];
  if (digests.length > 1) throw new Error(`pred-${run}.jsonl mixes criteria digests across ${corpora.join(", ")}: score one criteria at a time`);
  await initSpec();
  const criteria = digests[0] ?? criteriaDigest(currentSpec());
  const h = bands(heldCards, t);
  const record: HeldOutRecord = {
    corpora: heldBands.map(({ corpus, b }) => ({ corpus, sourceCommit: commitOf(corpus), cards: b.asked, accept: b.accept, notElement: b.notElement })),
    run,
    cards: h.asked,
    specVersion: specVersion[0],
    date: new Date().toISOString().slice(0, 10),
    serving: { provider: held.serving.provider ?? "unknown", upstream: held.serving.upstream },
    criteriaDigest: criteria,
    accept: h.accept,
    notElement: h.notElement,
  };

  md.push("", "## Verdict", "");
  md.push(
    `Each band is verified on its own (\`verdictOf\`). Rule \`lower-bound\` (\`HELD_OUT_RULE\`): the band's Wilson interval clears the target (lower bound >= target); \`within-interval\` (shown for comparison): the interval reaches it. ` +
      `Pooling \`${HELD_OUT_POOLING}\` (\`HELD_OUT_POOLING\`): the band pooled over the held-out corpora meets the rule and no corpus's point estimate is under the target; \`pooled\` drops the floor; \`each-corpus\` asks every corpus to meet the rule alone. ` +
      `A band of fewer than ${HELD_OUT_MIN_CARDS} cards (\`HELD_OUT_MIN_CARDS\`) fails: here accept ${h.accept.cards}, not-element ${h.notElement.cards} pooled. ` +
      "Both bands verified is stage mode; the not-element band alone is hide mode.",
    ""
  );
  md.push("| targets (type / none) | rule | pooling | accept | not-element | mode |", "|---|---|---|---|---|---|");
  const rules: HeldOutRule[] = ["lower-bound", "within-interval"];
  const poolings: HeldOutPooling[] = corpora.length > 1 ? ["pooled-with-floor", "pooled", "each-corpus"] : [HELD_OUT_POOLING];
  const targets = [...ALTERNATIVE_TARGETS];
  if (!targets.some((x) => x.typePrecision === TIER1_TARGETS.typePrecision && x.nonePrecision === TIER1_TARGETS.nonePrecision)) targets.unshift({ ...TIER1_TARGETS });
  const modeName = (v: { accept: boolean; notElement: boolean }) => (v.accept && v.notElement ? "**stage**" : v.notElement ? "**hide**" : "suggest");
  for (const tg of targets) {
    for (const rule of rules) {
      for (const pooling of poolings) {
        const v = verdictOf(record, tg, rule, HELD_OUT_MIN_CARDS, pooling);
        const current = tg.typePrecision === TIER1_TARGETS.typePrecision && tg.nonePrecision === TIER1_TARGETS.nonePrecision && rule === HELD_OUT_RULE && pooling === HELD_OUT_POOLING;
        md.push(
          `| ${tg.typePrecision.toFixed(2)} / ${tg.nonePrecision.toFixed(2)}${current ? " **(the targets and rule)**" : ""} | ${rule} | ${pooling} | ${v.accept ? "meets" : "misses"} | ${v.notElement ? "meets" : "misses"} | ${modeName(v)} |`
        );
      }
    }
  }
  if (!digests.length) {
    md.push("", `The predictions don't record their criteria digest (runs before 2026-11-16): the record takes the digest of the criteria this CLI builds from its bundled spec, ${criteria.slice(0, 12)}…, which is right only if the run used them.`);
  }
  const verdict = verdictOf(record);
  const bandsVerified = [...(verdict.accept ? ["accept"] : []), ...(verdict.notElement ? ["not-element"] : [])];
  md.push(
    "",
    `Under the targets (${TIER1_TARGETS.typePrecision} / ${TIER1_TARGETS.nonePrecision}, ${HELD_OUT_RULE}, ${HELD_OUT_POOLING}): ` +
      (verdict.pass
        ? "**both bands verified**: `fit: \"held-out\"` (stage mode)."
        : bandsVerified.length
          ? `**${bandsVerified.join(" and ")} verified**: \`heldOutBands: ${JSON.stringify(bandsVerified)}\`${verdict.notElement ? " (hide mode)" : ""}.`
          : "**neither band verified**: `in-sample` (suggest mode)."),
    "",
    `The \`heldOut\` record for \`DEFAULT_THRESHOLDS["${held.qset}"]["${held.canonicalModel}"]\`:`,
    "",
    "```json",
    JSON.stringify(record, null, 2),
    "```"
  );
  const out = md.join("\n");
  // The viewer alone keeps the original name; other held-out corpora, or relabelled in-sample gold, get their own file.
  const only = corpora.length === 1 && corpora[0] === "viewer" ? "" : `@${corpora.join("+")}`;
  const suffix = `${only}${given ? `@${t.layer}-${t.type}-${t.none}` : ""}${goldTag ? `@gold-${goldTag}` : ""}`;
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
