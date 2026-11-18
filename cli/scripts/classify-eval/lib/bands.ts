/**
 * The band measurement of TIER1_DESIGN.md section 6: precision and coverage curves over each band's
 * threshold, with Wilson intervals and what each point means for the agent, per 1,000 model-asked
 * cards. Every band decision goes through the CLI's `bandOf` (src/analyzers/classifier/bands.ts), so
 * the curves measure the rule Tier 1 applies.
 *
 * Model-asked cards only: a card a Tier-0 rule decided (or rejected) never reaches Tier 1.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { FILE_LABELS } from "../../../src/analyzers/cards/build.js";
import { bandOf, wilson, type Thresholds } from "../../../src/analyzers/classifier/bands.js";
import { NONE_OPTION } from "../../../src/analyzers/classifier/criteria.js";
import { resolveModel } from "../../../src/analyzers/classifier/decision-model/registry.js";
import { baseQsetOf } from "../../../src/analyzers/classifier/qset/index.js";
import { decisionBackendOf } from "../backends/clef.js";
import { corpusDir, readJsonl } from "./io.js";
import { servingLabel, servingOf, type Serving } from "./serving.js";
import type { Card, Gold, Prediction } from "./types.js";

/**
 * File cards are out of the scored set. A file is where an element was found, never a candidate
 * element (maintainer ruling, 2026-11-18), so extraction builds no card for one and Tier 1 is never
 * asked about one. The corpora's cards.jsonl, gold and predictions were made before that and still
 * hold their file cards (CBM Module nodes); every script here leaves them out when it reads gold.
 * `DR_EVAL_FILE_CARDS=1` keeps them, to reproduce TIER1_CALIBRATION.md sections 1 to 14.
 */
export const INCLUDE_FILE_CARDS = process.env.DR_EVAL_FILE_CARDS === "1";

const fileCardCache = new Map<string, Set<string>>();

/** The ids of a corpus's file cards. */
export function fileCardIds(corpus: string): Set<string> {
  let ids = fileCardCache.get(corpus);
  if (!ids) {
    const file = path.join(corpusDir(corpus), "cards.jsonl");
    ids = new Set(existsSync(file) ? readJsonl<Card>(file).filter((c) => FILE_LABELS.has(c.label)).map((c) => c.id) : []);
    fileCardCache.set(corpus, ids);
  }
  return ids;
}

/** Rows keyed by `card_id` (gold labels, predictions) without the corpus's file cards. */
export function withoutFileCards<T extends { card_id: string }>(corpus: string, rows: T[]): T[] {
  if (INCLUDE_FILE_CARDS) return rows;
  const ids = fileCardIds(corpus);
  return ids.size ? rows.filter((r) => !ids.has(r.card_id)) : rows;
}

/** The three labelled corpora, in report order. */
export const CORPORA = ["dr-cli", "fastapi", "petclinic"] as const;

/** Grids of section 6: accept over T_layer 0.5-0.8 by T_type 0-0.6, not-element over T_none. */
export const T_LAYER_GRID = [0.5, 0.6, 0.7, 0.8];
export const T_TYPE_GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
export const T_NONE_GRID = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

/** One model-asked card, scored against gold. */
export interface AskedCard {
  corpus: string;
  cardId: string;
  layer: string;
  layerP: number;
  type: string | null;
  typeP: number | null;
  /** The predicted layer matches gold. */
  layerOk: boolean;
  /** End to end: layer and type both match gold (gold `none` matches no type). */
  typeOk: boolean;
  /** Gold says this symbol is not an element. */
  goldNone: boolean;
  /** The model call failed: the card is asked and escalates (Tier 1 couldn't answer it). */
  error: boolean;
}

/** A run's prediction file in a corpus: `pred-<run>.jsonl`, `run` being `clef@cbm012-kind-tier0`. */
export function predFileOf(corpus: string, run: string): string {
  return path.join(corpusDir(corpus), `pred-${run}.jsonl`);
}

/** The predictions of a run in a corpus, or null when the corpus has no such file. */
export function loadRun(corpus: string, run: string): Prediction[] | null {
  const file = predFileOf(corpus, run);
  return existsSync(file) ? readJsonl<Prediction>(file) : null;
}

/** Whether a prediction reached the model: no Tier-0 rule, or a rule that only narrowed. */
export function isModelAsked(p: Prediction): boolean {
  return !p.tier0 || p.tier0.kind === "narrow";
}

/**
 * A run's model-asked predictions in a corpus that have a gold label, scored, one per card. A card
 * whose model call failed counts as asked and escalates, as Tier 1 treats it (TIER1_DESIGN.md 1.3);
 * a resumed run's later answer for the card replaces its error.
 */
export function askedCards(corpus: string, preds: Prediction[], gold?: Map<string, Gold>): AskedCard[] {
  gold ??= goldOf(corpus);
  const byCard = new Map<string, Prediction>();
  for (const p of preds) {
    const seen = byCard.get(p.card_id);
    if (!seen || seen.error || !p.error) byCard.set(p.card_id, p);
  }
  const out: AskedCard[] = [];
  for (const p of byCard.values()) {
    if (!isModelAsked(p)) continue;
    const g = gold.get(p.card_id);
    if (!g) continue;
    if (p.error) {
      out.push({ corpus, cardId: p.card_id, layer: "", layerP: NaN, type: null, typeP: null, layerOk: false, typeOk: false, goldNone: g.layer === NONE_OPTION, error: true });
      continue;
    }
    const layer = p.layer.choice;
    const type = p.element_type.choice ?? null;
    const typeP = type ? p.element_type.probabilities[type] : undefined;
    const layerOk = g.layer === layer;
    const goldType = g.layer === NONE_OPTION ? null : g.element_type;
    out.push({
      corpus,
      cardId: p.card_id,
      layer,
      layerP: p.layer.probabilities[layer] ?? NaN,
      type,
      typeP: typeof typeP === "number" ? typeP : null,
      layerOk,
      typeOk: layerOk && (goldType ?? null) === type,
      goldNone: g.layer === NONE_OPTION,
      error: false,
    });
  }
  return out;
}

/**
 * A corpus's gold labels: `gold.jsonl`, or with a tag `gold@<tag>.jsonl` (`--gold october`: the
 * in-sample corpora's October labels, the gold of TIER1_CALIBRATION.md sections 1-8, replaced on
 * 2026-11-16 by the relabel of section 9). A tag a corpus
 * has no file for is an error, so a fit never mixes two labelling processes silently. File cards are
 * left out ({@link withoutFileCards}).
 */
export function goldOf(corpus: string, tag?: string): Map<string, Gold> {
  const file = path.join(corpusDir(corpus), tag ? `gold@${tag}.jsonl` : "gold.jsonl");
  if (tag && !existsSync(file)) throw new Error(`--gold ${tag}: ${corpus} has no ${path.basename(file)}`);
  return new Map(withoutFileCards(corpus, readJsonl<Gold>(file)).map((g) => [g.card_id, g]));
}

/** The card's band under `t`, by the CLI's rule; a card Tier 1 couldn't answer escalates. */
export function bandFor(c: AskedCard, t: Thresholds): ReturnType<typeof bandOf> {
  return bandOf(c.error ? null : { layer: c.layer, layerP: c.layerP, type: c.type, typeP: c.typeP }, t);
}

/** Wilson score interval: the CLI's, which the held-out test (`heldOutVerdict`) uses too. */
export { wilson };

/** A point on the accept curve. */
export interface AcceptPoint {
  tLayer: number;
  tType: number;
  asked: number;
  accepted: number;
  /** Accepted cards whose layer is right. */
  layerOk: number;
  /** Accepted cards whose layer and type are right: the elements staged correctly. */
  typeOk: number;
}

/** A point on the not-element curve. */
export interface NotElementPoint {
  tNone: number;
  asked: number;
  hidden: number;
  /** Hidden cards gold calls `none` too. */
  correct: number;
}

/** The accept band at (tLayer, tType). T_none does not change the accept band. */
export function acceptPoint(cards: AskedCard[], tLayer: number, tType: number): AcceptPoint {
  const t: Thresholds = { layer: tLayer, type: tType, none: Infinity };
  let accepted = 0;
  let layerOk = 0;
  let typeOk = 0;
  for (const c of cards) {
    if (bandFor(c, t) !== "accept") continue;
    accepted++;
    if (c.layerOk) layerOk++;
    if (c.typeOk) typeOk++;
  }
  return { tLayer, tType, asked: cards.length, accepted, layerOk, typeOk };
}

/** The not-element band at tNone. T_layer and T_type do not change it. */
export function notElementPoint(cards: AskedCard[], tNone: number): NotElementPoint {
  const t: Thresholds = { layer: Infinity, type: Infinity, none: tNone };
  let hidden = 0;
  let correct = 0;
  for (const c of cards) {
    if (bandFor(c, t) !== "not-element") continue;
    hidden++;
    if (c.goldNone) correct++;
  }
  return { tNone, asked: cards.length, hidden, correct };
}

/**
 * The layer threshold alone (section 6's "Layer >= 0.6" column): cards whose top layer is not `none`
 * at or above tLayer, whatever their type. Not a band: unlike the accept band at T_type 0, it keeps
 * cards with no chosen type (stage 2 not asked, or answered `none`), which `bandOf` escalates.
 */
export function layerOnlyPoint(cards: AskedCard[], tLayer: number): { tLayer: number; asked: number; cards: number; layerOk: number; typeOk: number } {
  let n = 0;
  let layerOk = 0;
  let typeOk = 0;
  for (const c of cards) {
    if (c.error || c.layer === NONE_OPTION || !(c.layerP >= tLayer)) continue;
    n++;
    if (c.layerOk) layerOk++;
    if (c.typeOk) typeOk++;
  }
  return { tLayer, asked: cards.length, cards: n, layerOk, typeOk };
}

export function acceptCurve(cards: AskedCard[], layers = T_LAYER_GRID, types = T_TYPE_GRID): AcceptPoint[] {
  return layers.flatMap((l) => types.map((t) => acceptPoint(cards, l, t)));
}

export function notElementCurve(cards: AskedCard[], nones = T_NONE_GRID): NotElementPoint[] {
  return nones.map((t) => notElementPoint(cards, t));
}

/** A run resolved for the band report and the fit: its cards per corpus, question set and model. */
export interface ResolvedRun {
  /** Prediction file stem: `clef@cbm012-kind-tier0`. */
  run: string;
  /** Question set (base id, no variant): from the predictions' `qset`, else `--qset`. */
  qset: string | null;
  /** The variant ids the predictions recorded (`dr-qset-1`, `dr-qset-2+core`). */
  qsetVariants: string[];
  /**
   * The predictions record a harness variant (`+no-kind`, `+core`, `+facts`, `+charter-*`): a
   * configuration production never sends, so its thresholds are no default for the question set.
   */
  variant: boolean;
  canonicalModel: string | null;
  /** Who served the run: provider and pinned upstream (a run mixing them is refused). */
  serving: Serving;
  /** {@link serving} for a report: `openrouter via deepinfra/fp8 (served by DeepInfra 521)`. */
  servingLabel: string;
  /** Spec versions the predictions recorded (`spec_version`); empty for runs made before it was. */
  specVersions: string[];
  corpora: Array<{ corpus: string; cards: AskedCard[] }>;
}

/**
 * A run from the harness flags: `--backend cloudflare:clef --tag <tag>` (as `classify.ts` names its
 * output) or `--run clef@<tag>` (a prediction file stem, as `compare.ts` takes), over `--corpora`
 * (default all three). Corpora without the file are left out. `--gold <tag>` scores against
 * `gold@<tag>.jsonl` instead of `gold.jsonl`.
 */
export function resolveRun(flags: Record<string, string | boolean>): ResolvedRun {
  const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
  let run = str("run");
  let provider: string | undefined;
  let model: string | undefined;
  if (!run) {
    const backendId = str("backend");
    if (!backendId) throw new Error("name the run: --backend <id> [--tag <tag>], or --run <backend@tag>");
    const backend = decisionBackendOf(backendId);
    if (!backend) throw new Error(`${backendId} is not a decision-model backend (bands need per-option probabilities)`);
    const tag = str("tag");
    run = `${backend.name}${tag ? `@${tag}` : ""}`;
    provider = backend.provider;
    model = backend.model;
  }
  const corpora = (str("corpora")?.split(",").map((s) => s.trim()) ?? [...CORPORA]).flatMap((corpus) => {
    const preds = loadRun(corpus, run);
    return preds ? [{ corpus, preds }] : [];
  });
  if (!corpora.length) throw new Error(`no corpus has pred-${run}.jsonl`);
  const all = corpora.flatMap((c) => c.preds);
  const serving = servingOf(all, `pred-${run}.jsonl`);
  const asked = all.filter((p) => !p.error && isModelAsked(p));
  const qsetVariants = [...new Set(asked.map((p) => p.qset).filter((q): q is string => !!q))].sort();
  const bases = [...new Set(qsetVariants.map(baseQsetOf))];
  const flagged = str("qset");
  if (bases.length > 1) throw new Error(`pred-${run}.jsonl mixes question sets: ${qsetVariants.join(", ")}`);
  if (flagged && bases.length && bases[0] !== flagged) throw new Error(`--qset ${flagged}, but the predictions record ${bases[0]}`);
  if (!provider) {
    provider = asked.find((p) => p.provider)?.provider ?? "cloudflare-workers-ai";
    // Predictions record the provider's model id since OpenRouter runs; older runs' file stem is the model name.
    model = asked.find((p) => p.model)?.model ?? run.split("@")[0];
  }
  const registered = model ? resolveModel(provider, model) : undefined;
  return {
    run,
    qset: bases[0] ?? flagged ?? null,
    qsetVariants,
    variant: qsetVariants.some((v) => v !== baseQsetOf(v)),
    canonicalModel: registered?.canonicalModel ?? null,
    serving,
    servingLabel: servingLabel(serving),
    specVersions: [...new Set(all.map((p) => p.spec_version).filter((v): v is string => !!v))].sort(),
    corpora: corpora.map(({ corpus, preds }) => ({ corpus, cards: askedCards(corpus, preds, goldOf(corpus, str("gold"))) })),
  };
}

/** Per 1,000 asked cards. */
export function per1000(k: number, asked: number): number {
  return asked ? (1000 * k) / asked : NaN;
}

const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)}%` : "n/a");
const interval = (k: number, n: number) => {
  const w = wilson(k, n);
  return w ? `${(100 * w.lo).toFixed(1)}-${(100 * w.hi).toFixed(1)}` : "n/a";
};
const thr = (x: number) => x.toFixed(1);

/** The accept curve as a Markdown table; `mark` flags the default point. */
export function acceptTable(points: AcceptPoint[], mark?: Thresholds | null): string[] {
  const rows = [
    "| T_layer | T_type | accepted (coverage) | type precision | 95% interval | layer precision | per 1,000 asked: removed | wrong elements staged |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const p of points) {
    const isDefault = mark && Math.abs(mark.layer - p.tLayer) < 1e-9 && Math.abs(mark.type - p.tType) < 1e-9;
    const name = `${thr(p.tLayer)}${isDefault ? " **(default)**" : ""}`;
    rows.push(
      `| ${name} | ${thr(p.tType)} | ${p.accepted} (${pct(p.accepted, p.asked)}) | ${pct(p.typeOk, p.accepted)} | ${interval(p.typeOk, p.accepted)} | ${pct(p.layerOk, p.accepted)} | ${per1000(p.accepted, p.asked).toFixed(0)} | ${per1000(p.accepted - p.typeOk, p.asked).toFixed(0)} |`
    );
  }
  return rows;
}

/** The not-element curve as a Markdown table; `mark` flags the default point. */
export function notElementTable(points: NotElementPoint[], mark?: Thresholds | null): string[] {
  const rows = [
    "| T_none | hidden (coverage) | precision | 95% interval | per 1,000 asked: removed | real elements hidden |",
    "|---|---|---|---|---|---|",
  ];
  for (const p of points) {
    const isDefault = mark && Math.abs(mark.none - p.tNone) < 1e-9;
    rows.push(
      `| ${thr(p.tNone)}${isDefault ? " **(default)**" : ""} | ${p.hidden} (${pct(p.hidden, p.asked)}) | ${pct(p.correct, p.hidden)} | ${interval(p.correct, p.hidden)} | ${per1000(p.hidden, p.asked).toFixed(0)} | ${per1000(p.hidden - p.correct, p.asked).toFixed(0)} |`
    );
  }
  return rows;
}
