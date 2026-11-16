/**
 * Agreement between two runs as an accept gate, beside the decision model's own bands. No model calls.
 *
 *   bun agreement-report.ts --a clef@cbm012-kind-tier0-qset2-spec012-layercrit \
 *     --b claude-haiku@cbm012-kind-tier0-spec012-t1 [--b2 claude-haiku@cbm012-kind-tier0-spec012-t2] \
 *     [--held-out viewer] [--thresholds 0.6,0.4,0.6] [--confidence 0.8]
 *
 * A is the decision-model run whose bands are the incumbent gate; B (and B2, a second take of B) is
 * the second opinion. Per scope (the held-out corpus, the in-sample corpora pooled and each alone):
 *
 * - layer and end-to-end type accuracy of each run on every gold card, with B and B2 paired against
 *   A (exact McNemar, as compare.ts); a card whose call failed counts as wrong;
 * - on A's model-asked cards, the gates: A's bands at its thresholds, "A and B give the same layer
 *   and type" (an agreed element, or an agreed `none`), the same with B2, B and B2 agreeing with
 *   each other, all three, A's bands kept only where B agrees, B's every answer, and B's
 *   self-reported confidence. Each gate's coverage and precision, Wilson 95%;
 * - who is right where A and B disagree, how each run uses `none`, and how many of B's answers
 *   change between its takes;
 * - the held-out cards where A's bands disagree with gold, with every run's answer: the cards to
 *   adjudicate by hand.
 *
 * Writes data/agreement@<b>.md.
 */
import path from "node:path";
import { writeFileSync } from "node:fs";
import { thresholdsFor, wilson, type Thresholds } from "../../src/analyzers/classifier/bands.js";
import { mcnemarP } from "./compare.js";
import { bandFor, CORPORA, loadRun, resolveRun, type AskedCard } from "./lib/bands.js";
import { harnessDir } from "./lib/env.js";
import { corpusDir, flagNum, flagStr, parseFlags, readJsonl } from "./lib/io.js";
import { NONE_OPTION } from "./lib/spec.js";
import type { Card, Gold, Prediction } from "./lib/types.js";

/** A run's answer for a card: its layer and, unless the layer is `none`, its type. Null: no answer (no row, or the call failed). */
export interface Answer {
  layer: string;
  type: string | null;
  layerConfidence: number | null;
  typeConfidence: number | null;
}

export function answerOf(p: Prediction | undefined): Answer | null {
  if (!p || p.error) return null;
  const layer = p.layer.choice;
  return { layer, type: layer === NONE_OPTION ? null : (p.element_type.choice ?? null), layerConfidence: p.layer.confidence, typeConfidence: p.element_type.confidence };
}

/** Two runs agree on a card when both answered and gave the same layer and type. */
export function sameAnswer(x: Answer | null, y: Answer | null): boolean {
  return !!x && !!y && x.layer === y.layer && x.type === y.type;
}

/** Whether an answer matches gold, as `askedCards` scores a prediction: layer, and type end to end. */
export function rightOf(x: Answer | null, g: Gold): { layer: boolean; type: boolean } {
  if (!x) return { layer: false, type: false };
  const layer = x.layer === g.layer;
  return { layer, type: layer && (g.layer === NONE_OPTION ? null : (g.element_type ?? null)) === x.type };
}

/** One of A's model-asked cards with every run's answer. `answers[0]` is A's. */
export interface Row {
  card: AskedCard;
  gold: Gold;
  answers: Array<Answer | null>;
}

export interface GateCount {
  asked: number;
  element: { cards: number; correct: number };
  none: { cards: number; correct: number };
}

/**
 * A gate over the asked cards. `pick` names the run whose answer the gate passes for a card, or
 * null when the card doesn't pass; an element answer is right when its layer and type match gold,
 * a `none` answer when gold says `none`.
 */
export function gate(rows: Row[], pick: (r: Row) => number | null): GateCount {
  const out: GateCount = { asked: rows.length, element: { cards: 0, correct: 0 }, none: { cards: 0, correct: 0 } };
  for (const r of rows) {
    const i = pick(r);
    const x = i === null ? null : r.answers[i];
    if (!x) continue;
    if (x.layer === NONE_OPTION) {
      out.none.cards++;
      if (r.gold.layer === NONE_OPTION) out.none.correct++;
    } else {
      out.element.cards++;
      if (rightOf(x, r.gold).type) out.element.correct++;
    }
  }
  return out;
}

/** The gates of the report, in order. Runs: 0 = A, 1 = B, 2 = B2 (when given). */
export function gatesOf(rows: Row[], t: Thresholds | null, hasB2: boolean, confidence: number): Array<{ name: string; count: GateCount }> {
  const inBand = (r: Row) => !!t && bandFor(r.card, t) !== "escalate";
  const agree = (r: Row, i: number, j: number) => sameAnswer(r.answers[i], r.answers[j]);
  const out: Array<{ name: string; count: GateCount }> = [];
  if (t) out.push({ name: `A's bands (${t.layer} / ${t.type} / ${t.none})`, count: gate(rows, (r) => (inBand(r) ? 0 : null)) });
  out.push({ name: "A and B agree", count: gate(rows, (r) => (agree(r, 0, 1) ? 0 : null)) });
  if (hasB2) {
    out.push({ name: "A and B2 agree", count: gate(rows, (r) => (agree(r, 0, 2) ? 0 : null)) });
    out.push({ name: "B and B2 agree", count: gate(rows, (r) => (agree(r, 1, 2) ? 1 : null)) });
    out.push({ name: "A, B and B2 agree", count: gate(rows, (r) => (agree(r, 0, 1) && agree(r, 1, 2) ? 0 : null)) });
  }
  if (t) out.push({ name: "A's bands, where B agrees", count: gate(rows, (r) => (inBand(r) && agree(r, 0, 1) ? 0 : null)) });
  out.push({ name: "B, every answer", count: gate(rows, () => 1) });
  const sure = (x: Answer | null) => !!x && (x.layerConfidence ?? 0) >= confidence && (x.layer === NONE_OPTION || (x.typeConfidence ?? 0) >= confidence);
  if (rows.some((r) => r.answers[1]?.layerConfidence != null)) out.push({ name: `B, self-reported confidence >= ${confidence}`, count: gate(rows, (r) => (sure(r.answers[1]) ? 1 : null)) });
  return out;
}

const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)}%` : "n/a");
const ci = (k: number, n: number) => {
  const w = wilson(k, n);
  return w ? `${k} of ${n}, ${pct(k, n)} (${(100 * w.lo).toFixed(1)}-${(100 * w.hi).toFixed(1)})` : "n/a";
};
const show = (x: Answer | null) => (!x ? "(no answer)" : x.layer === NONE_OPTION ? "none" : x.type ? `${x.layer}.${x.type}` : `${x.layer} (no type)`);

/** One row per card, a resumed run's later answer replacing its error (as `askedCards` reads a file). */
function byCard(preds: Prediction[]): Map<string, Prediction> {
  const out = new Map<string, Prediction>();
  for (const p of preds) {
    const seen = out.get(p.card_id);
    if (!seen || seen.error || !p.error) out.set(p.card_id, p);
  }
  return out;
}

interface Scope {
  name: string;
  corpora: string[];
}

function parseThresholds(v: string): Thresholds {
  const [layer, type, none] = v.split(",").map(Number);
  if (![layer, type, none].every((x) => Number.isFinite(x) && x >= 0 && x <= 1)) throw new Error(`--thresholds <layer,type,none>, e.g. 0.6,0.4,0.6; got ${v}`);
  return { layer, type, none };
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const a = flagStr(flags, "a");
  const b = flagStr(flags, "b");
  const b2 = flagStr(flags, "b2");
  if (!a || !b) throw new Error("Usage: bun agreement-report.ts --a <decision-model run> --b <run> [--b2 <second take of b>] [--held-out viewer] [--thresholds l,t,n] [--confidence 0.8]");
  const heldOut = flagStr(flags, "held-out", "viewer")!;
  const confidence = flagNum(flags, "confidence", 0.8);
  const runs = [a, b, ...(b2 ? [b2] : [])];
  const names = ["A", "B", ...(b2 ? ["B2"] : [])];
  const corpora = [heldOut, ...CORPORA].filter((c) => runs.every((r) => loadRun(c, r)));
  if (!corpora.length) throw new Error(`no corpus has all of ${runs.map((r) => `pred-${r}.jsonl`).join(", ")}`);
  const resolved = resolveRun({ run: a, corpora: corpora.join(",") });
  const given = flagStr(flags, "thresholds");
  const t = given ? parseThresholds(given) : resolved.qset && resolved.canonicalModel ? thresholdsFor(resolved.qset, resolved.canonicalModel) : null;

  const gold = new Map(corpora.map((c) => [c, new Map(readJsonl<Gold>(path.join(corpusDir(c), "gold.jsonl")).map((g) => [g.card_id, g]))]));
  const preds = new Map(corpora.map((c) => [c, runs.map((r) => byCard(loadRun(c, r)!))]));
  const rowsOf = (c: string): Row[] =>
    resolved.corpora
      .find((x) => x.corpus === c)!
      .cards.map((card) => ({ card, gold: gold.get(c)!.get(card.cardId)!, answers: preds.get(c)!.map((m) => answerOf(m.get(card.cardId))) }));
  const inSample = corpora.filter((c) => c !== heldOut);
  const scopes: Scope[] = [
    ...(corpora.includes(heldOut) ? [{ name: `${heldOut} (held out)`, corpora: [heldOut] }] : []),
    ...(inSample.length > 1 ? [{ name: `in-sample, pooled (${inSample.join(", ")})`, corpora: inSample }] : []),
    ...inSample.map((c) => ({ name: c, corpora: [c] })),
  ];

  const md: string[] = [];
  md.push(`# Agreement as a gate: ${b} beside ${a}`, "");
  md.push(
    `Generated ${new Date().toISOString()} by \`agreement-report.ts\`. A = \`${a}\` (${resolved.qset ?? "no question set recorded"}, served by ${resolved.servingLabel}), B = \`${b}\`${b2 ? `, B2 = \`${b2}\` (a second take of B)` : ""}. ` +
      (t ? `A's bands at T_layer ${t.layer}, T_type ${t.type}, T_none ${t.none} (${given ? "--thresholds" : "the defaults in `bands.ts`"}). ` : "A has no thresholds, so no bands. ") +
      "Intervals are Wilson 95%. A card whose call failed has no answer: it counts as wrong, and agrees with nothing.",
    ""
  );

  md.push("## Accuracy on every gold card", "");
  md.push("| scope | run | cards | layer | type, end to end | layer against A: lost / gained (p) | type against A: lost / gained (p) |", "|---|---|---|---|---|---|---|");
  for (const s of scopes) {
    const cards = s.corpora.flatMap((c) => [...gold.get(c)!.values()].filter((g) => preds.get(c)![0].has(g.card_id)).map((g) => ({ g, answers: preds.get(c)!.map((m) => answerOf(m.get(g.card_id))) })));
    const right = cards.map(({ g, answers }) => answers.map((x) => rightOf(x, g)));
    runs.forEach((_, i) => {
      const layer = right.filter((r) => r[i].layer).length;
      const type = right.filter((r) => r[i].type).length;
      const paired = (k: "layer" | "type") => {
        if (i === 0) return "";
        const lost = right.filter((r) => r[0][k] && !r[i][k]).length;
        const gained = right.filter((r) => !r[0][k] && r[i][k]).length;
        const p = mcnemarP(lost, gained);
        return `${lost} / ${gained} (${p < 0.001 ? "< 0.001" : p.toFixed(3)})`;
      };
      md.push(`| ${i === 0 ? s.name : ""} | ${names[i]} | ${cards.length} | ${ci(layer, cards.length)} | ${ci(type, cards.length)} | ${paired("layer")} | ${paired("type")} |`);
    });
  }

  md.push("", "## Gates on A's model-asked cards", "");
  md.push(
    "An element answer is right when its layer and type match gold; a `none` answer when gold says `none`. Coverage is of the scope's model-asked cards.",
    ""
  );
  for (const s of scopes) {
    const rows = s.corpora.flatMap(rowsOf);
    md.push(`### ${s.name}: ${rows.length} asked cards`, "");
    md.push("| gate | passed as an element (coverage) | right | passed as none (coverage) | right |", "|---|---|---|---|---|");
    for (const { name, count } of gatesOf(rows, t, !!b2, confidence)) {
      md.push(
        `| ${name} | ${count.element.cards} (${pct(count.element.cards, count.asked)}) | ${ci(count.element.correct, count.element.cards)} | ${count.none.cards} (${pct(count.none.cards, count.asked)}) | ${ci(count.none.correct, count.none.cards)} |`
      );
    }
    const dis = rows.filter((r) => r.answers[1] && !sameAnswer(r.answers[0], r.answers[1]));
    const aRight = dis.filter((r) => rightOf(r.answers[0], r.gold).type).length;
    const bRight = dis.filter((r) => rightOf(r.answers[1], r.gold).type).length;
    const neither = dis.filter((r) => !rightOf(r.answers[0], r.gold).type && !rightOf(r.answers[1], r.gold).type).length;
    const goldNone = rows.filter((r) => r.gold.layer === NONE_OPTION);
    const goldElement = rows.filter((r) => r.gold.layer !== NONE_OPTION);
    const noneUse = (i: number) =>
      `${names[i]} answers none for ${goldElement.filter((r) => r.answers[i]?.layer === NONE_OPTION).length} of ${goldElement.length} gold elements and gives an element for ${goldNone.filter((r) => r.answers[i] && r.answers[i]!.layer !== NONE_OPTION).length} of ${goldNone.length} gold none`;
    md.push("", `- Where A and B disagree (${dis.length} cards): A is right on ${aRight}, B on ${bRight}, neither on ${neither}.`, `- ${noneUse(0)}; ${noneUse(1)}.`);
    if (b2) {
      const both = rows.filter((r) => r.answers[1] && r.answers[2]);
      const flips = both.filter((r) => !sameAnswer(r.answers[1], r.answers[2]));
      const noneFlips = flips.filter((r) => (r.answers[1]!.layer === NONE_OPTION) !== (r.answers[2]!.layer === NONE_OPTION)).length;
      md.push(`- Between B and B2, ${flips.length} of ${both.length} asked cards (${pct(flips.length, both.length)}) change layer or type; ${noneFlips} of them flip between an element and none.`);
    }
    md.push("");
  }

  if (t && corpora.includes(heldOut)) {
    const cardsOf = new Map(readJsonl<Card>(path.join(corpusDir(heldOut), "cards.jsonl")).map((c) => [c.id, c]));
    const rows = rowsOf(heldOut);
    const list = (title: string, band: "accept" | "not-element") => {
      const missed = rows.filter((r) => bandFor(r.card, t) === band && !(band === "accept" ? r.card.typeOk : r.card.goldNone));
      md.push(`### ${title}: ${missed.length}`, "");
      if (!missed.length) return;
      md.push(`| card | ${names.join(" | ")} | gold |`, `|---|${names.map(() => "---").join("|")}|---|`);
      for (const r of missed) {
        const c = cardsOf.get(r.card.cardId);
        const p = `${r.card.layerP.toFixed(2)}${r.card.typeP === null ? "" : ` / ${r.card.typeP.toFixed(2)}`}`;
        const answers = r.answers.map((x, i) => (i === 0 ? `${show(x)} (${p})` : show(x)));
        md.push(`| ${c?.label ?? "?"} \`${c?.name ?? r.card.cardId}\`, ${c?.file_path ?? "?"} | ${answers.join(" | ")} | ${r.gold.layer === NONE_OPTION ? "none" : `${r.gold.layer}.${r.gold.element_type ?? "?"}`} |`);
      }
      md.push("");
    };
    md.push(`## ${heldOut}: the cards where A's bands disagree with gold`, "", "The cards a maintainer's ruling would settle, with every run's answer (A's with its layer and type probability).", "");
    list("Accept band, layer or type not gold's", "accept");
    list("Not-element band, gold an element", "not-element");
  }

  const out = md.join("\n").replace(/\n+$/, "");
  const file = path.join(harnessDir(), "data", `agreement@${b}.md`);
  writeFileSync(file, out + "\n");
  console.log(out);
}

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
