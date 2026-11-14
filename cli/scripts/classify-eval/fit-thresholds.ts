/**
 * Propose default thresholds for a (question set, model) from a harness run (TIER1_DESIGN.md
 * section 6, step 3). No model calls.
 *
 *   bun fit-thresholds.ts --backend cloudflare:clef --tag cbm012-kind-tier0 [--qset dr-qset-1] \
 *     --type-precision 0.88 --none-precision 0.9 [--scope each-corpus|pooled] [--bound point|wilson-lower] \
 *     [--corpora dr-cli,fastapi,petclinic] [--spec-version 0.10.0]
 *
 * Given precision targets, picks the thresholds that meet them with the most coverage, on the band
 * report's grids (accept: T_layer 0.5-0.8 by T_type 0-0.6; not-element: T_none 0.3-0.9; ties go to
 * the higher precision, then the higher thresholds), over model-asked cards and through the CLI's
 * `bandOf`. `--scope each-corpus` (the default) requires the target pooled and in every corpus that
 * has cards in the band; `pooled` only pooled. `--bound wilson-lower` compares the Wilson 95% lower
 * bound instead of the point estimate.
 *
 * Prints the proposed defaults with their fit record (run, corpora and card counts, spec version,
 * date, targets, `fit: "in-sample"`), ready for `DEFAULT_THRESHOLDS` in
 * src/analyzers/classifier/bands.ts. It never edits that file: the maintainer commits defaults.
 * The spec version comes from the predictions (`spec_version`), else `--spec-version`. A run of a
 * harness variant (`dr-qset-2+core`, `+no-kind`, `+facts`, `+charter-*`) is refused unless `--force`:
 * production never sends a variant, so its thresholds are no default for the question set.
 */
import type { FitRecord, ThresholdRecord } from "../../src/analyzers/classifier/bands.js";
import {
  acceptCurve,
  acceptPoint,
  notElementCurve,
  notElementPoint,
  resolveRun,
  wilson,
  type AcceptPoint,
  type AskedCard,
  type NotElementPoint,
} from "./lib/bands.js";
import { parseFlags } from "./lib/io.js";

type Bound = FitRecord["targets"]["bound"];
type Scope = FitRecord["targets"]["scope"];

function measure(k: number, n: number, bound: Bound): number {
  if (n === 0) return NaN;
  return bound === "point" ? k / n : wilson(k, n)!.lo;
}

/** Whether a band's (k correct of n) meets the target; a corpus with no cards in the band can't miss it. */
function meets(k: number, n: number, target: number, bound: Bound, vacuous: boolean): boolean {
  if (n === 0) return vacuous;
  return measure(k, n, bound) >= target - 1e-12;
}

export interface FitOptions {
  typePrecision: number;
  nonePrecision: number;
  scope: Scope;
  bound: Bound;
}

export interface Fit {
  accept: AcceptPoint | null;
  notElement: NotElementPoint | null;
}

/** The grid points meeting the targets with the most coverage. Exported for tests. */
export function fit(corpora: Array<{ corpus: string; cards: AskedCard[] }>, options: FitOptions): Fit {
  const pooled = corpora.flatMap((c) => c.cards);
  const better = <P>(a: P, b: P | null, cov: (p: P) => number, prec: (p: P) => number, thr: (p: P) => number[]) => {
    if (!b) return true;
    if (cov(a) !== cov(b)) return cov(a) > cov(b);
    if (prec(a) !== prec(b)) return prec(a) > prec(b);
    const ta = thr(a);
    const tb = thr(b);
    for (let i = 0; i < ta.length; i++) if (ta[i] !== tb[i]) return ta[i] > tb[i];
    return false;
  };

  let accept: AcceptPoint | null = null;
  for (const p of acceptCurve(pooled)) {
    if (!p.accepted || !meets(p.typeOk, p.accepted, options.typePrecision, options.bound, false)) continue;
    if (options.scope === "each-corpus") {
      const each = corpora.map((c) => acceptPoint(c.cards, p.tLayer, p.tType));
      if (!each.every((e) => meets(e.typeOk, e.accepted, options.typePrecision, options.bound, true))) continue;
    }
    if (better(p, accept, (x) => x.accepted, (x) => x.typeOk / x.accepted, (x) => [x.tLayer, x.tType])) accept = p;
  }

  let notElement: NotElementPoint | null = null;
  for (const p of notElementCurve(pooled)) {
    if (!p.hidden || !meets(p.correct, p.hidden, options.nonePrecision, options.bound, false)) continue;
    if (options.scope === "each-corpus") {
      const each = corpora.map((c) => notElementPoint(c.cards, p.tNone));
      if (!each.every((e) => meets(e.correct, e.hidden, options.nonePrecision, options.bound, true))) continue;
    }
    if (better(p, notElement, (x) => x.hidden, (x) => x.correct / x.hidden, (x) => [x.tNone])) notElement = p;
  }
  return { accept, notElement };
}

function num(flags: Record<string, string | boolean>, key: string): number {
  const v = flags[key];
  const n = typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1) throw new Error(`--${key} <precision in (0, 1]> is required, e.g. --${key} 0.9`);
  return n;
}

const round = (x: number) => Math.round(x * 1000) / 1000;
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const options: FitOptions = {
    typePrecision: num(flags, "type-precision"),
    nonePrecision: num(flags, "none-precision"),
    scope: ((typeof flags.scope === "string" ? flags.scope : "each-corpus") as Scope),
    bound: ((typeof flags.bound === "string" ? flags.bound : "point") as Bound),
  };
  if (options.scope !== "each-corpus" && options.scope !== "pooled") throw new Error("--scope must be each-corpus or pooled");
  if (options.bound !== "point" && options.bound !== "wilson-lower") throw new Error("--bound must be point or wilson-lower");
  const r = resolveRun(flags);
  if (!r.qset) throw new Error(`pred-${r.run}.jsonl doesn't record its question set: pass --qset`);
  if (!r.canonicalModel) throw new Error(`no registered model for ${r.run}`);
  if (r.variant) {
    const msg = `pred-${r.run}.jsonl is a harness variant (${r.qsetVariants.join(", ")}): production never sends it, so its thresholds are no default for ${r.qset}`;
    if (!flags.force) throw new Error(`${msg}. Pass --force to fit it anyway.`);
    console.warn(`Warning: ${msg}.`);
  }
  const specVersion = r.specVersions.length === 1 ? r.specVersions[0] : typeof flags["spec-version"] === "string" ? flags["spec-version"] : null;
  if (!specVersion) {
    throw new Error(
      r.specVersions.length > 1
        ? `the predictions mix spec versions (${r.specVersions.join(", ")}): fit one spec at a time`
        : `pred-${r.run}.jsonl doesn't record its spec version: pass --spec-version`
    );
  }
  if (r.specVersions.length === 1 && typeof flags["spec-version"] === "string" && flags["spec-version"] !== specVersion) {
    throw new Error(`--spec-version ${flags["spec-version"]}, but the predictions record ${specVersion}`);
  }

  const result = fit(r.corpora, options);
  const pooled = r.corpora.flatMap((c) => c.cards);
  const scopeText = options.scope === "each-corpus" ? "pooled and in every corpus" : "pooled";
  const boundText = options.bound === "point" ? "point estimate" : "Wilson 95% lower bound";
  console.log(`Fit for ${r.qset} x ${r.canonicalModel} on ${r.run}: ${r.corpora.map((c) => `${c.corpus} ${c.cards.length}`).join(", ")} model-asked cards (${pooled.length}), spec ${specVersion}.`);
  console.log(`Targets (${boundText}, ${scopeText}): accept-band type precision >= ${options.typePrecision}, not-element precision >= ${options.nonePrecision}.`);
  if (!result.accept || !result.notElement) {
    if (!result.accept) console.log("No accept-band thresholds on the grid meet the type-precision target.");
    if (!result.notElement) console.log("No not-element threshold on the grid meets the precision target.");
    process.exit(1);
  }
  const a = result.accept;
  const n = result.notElement;
  console.log("");
  console.log("| scope | accept: cards (coverage) | type precision (95%) | not-element: cards (coverage) | precision (95%) |");
  console.log("|---|---|---|---|---|");
  const ci = (k: number, m: number) => {
    const w = wilson(k, m);
    return w ? `${pct(k / m)} (${pct(w.lo)}-${pct(w.hi)})` : "n/a";
  };
  for (const s of [{ corpus: "pooled", cards: pooled }, ...r.corpora]) {
    const ap = acceptPoint(s.cards, a.tLayer, a.tType);
    const np = notElementPoint(s.cards, n.tNone);
    console.log(`| ${s.corpus} | ${ap.accepted} (${pct(ap.accepted / s.cards.length)}) | ${ci(ap.typeOk, ap.accepted)} | ${np.hidden} (${pct(np.hidden / s.cards.length)}) | ${ci(np.correct, np.hidden)} |`);
  }

  const record: FitRecord = {
    run: r.run,
    corpora: Object.fromEntries(r.corpora.map((c) => [c.corpus, c.cards.length])),
    cards: pooled.length,
    specVersion,
    date: new Date().toISOString().slice(0, 10),
    targets: { typePrecision: options.typePrecision, nonePrecision: options.nonePrecision, scope: options.scope, bound: options.bound },
    accept: { cards: a.accepted, typePrecision: round(a.typeOk / a.accepted) },
    notElement: { cards: n.hidden, precision: round(n.correct / n.hidden) },
  };
  const proposed: ThresholdRecord = { layer: a.tLayer, type: a.tType, none: n.tNone, fit: "in-sample", record };
  console.log("");
  console.log(`Proposed default for DEFAULT_THRESHOLDS["${r.qset}"]["${r.canonicalModel}"] (src/analyzers/classifier/bands.ts):`);
  console.log(JSON.stringify(proposed, null, 2));
}

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
