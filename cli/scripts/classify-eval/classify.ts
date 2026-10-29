/**
 * Run a classifier backend over a corpus's cards and record predictions.
 *
 *   bun classify.ts --corpus dr-cli --backend clef-flash
 *   bun classify.ts --corpus dr-cli --backend claude-haiku --effort low
 *
 * Backends: clef, clef-flash, claude-haiku, claude-sonnet, claude-opus
 * Flags: --limit n, --concurrency n (default 4), --source-lines n (default 40),
 *        --only-gold (default true: only cards with a gold label), --all, --force,
 *        --tag <name> (write pred-<backend>@<name>.jsonl, e.g. to compare spec revisions),
 *        --kind-narrow (Clef only: restrict the element-type choice set by CBM symbol kind, Tier-0 rule),
 *        --charter full|short (prepend spec/DESIGN_CHARTER.md, or its one-paragraph summary, to the state),
 *        --tier0 (apply the cbm analyzer's Tier-0 rules: a deciding rule answers without a model call,
 *                 a narrowing rule restricts the layer and type choices; needs facts.jsonl),
 *        --facts (add the facts.jsonl structural facts to the state),
 *        --criteria full|core (core: drop the "Use X instead when" sentences from type criteria)
 */
import path from "node:path";
import { classifyWithClaude } from "./backends/claude.js";
import { classifyWithClef, CLEF_MODELS, stage1Questions, stage2Questions } from "./backends/clef.js";
import { mapConcurrent, MODEL_IDS } from "./lib/claude.js";
import { appendJsonl, corpusDir, flagNum, flagStr, parseFlags, readJsonl, writeJsonl } from "./lib/io.js";
import { renderState } from "./lib/state.js";
import { existsSync, readFileSync } from "node:fs";
import { repoRoot } from "./lib/env.js";
import { NONE_OPTION, setCriteriaMode, type CriteriaMode } from "./lib/spec.js";
import { loadFacts, loadTier0Rules, tier0For, type Tier0Outcome } from "./lib/tier0.js";
import type { Card, Facts, Gold, Prediction } from "./lib/types.js";

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const corpus = flagStr(flags, "corpus");
  const backend = flagStr(flags, "backend");
  if (!corpus || !backend) {
    console.error("Usage: bun classify.ts --corpus <name> --backend <clef|clef-flash|claude-haiku|claude-sonnet|claude-opus>");
    process.exit(2);
  }
  const dir = corpusDir(corpus);
  const limit = flagNum(flags, "limit", Infinity);
  const concurrency = flagNum(flags, "concurrency", 4);
  const sourceLines = flagNum(flags, "source-lines", 40);
  const effort = (flagStr(flags, "effort", "low") ?? "low") as "low" | "medium" | "high";
  const tag = flagStr(flags, "tag");
  const predFile = path.join(dir, `pred-${backend}${tag ? `@${tag}` : ""}.jsonl`);

  if (flags["dry-run"]) {
    const first = readJsonl<Card>(path.join(dir, "cards.jsonl"))[0];
    if (!first) throw new Error("no cards");
    const state = renderState(first, sourceLines);
    if (backend in CLEF_MODELS) {
      console.log(JSON.stringify({ model: CLEF_MODELS[backend].model, state, questions: stage1Questions() }, null, 2));
      console.log("\n--- stage 2 (example for layer 'application') ---");
      console.log(JSON.stringify({ model: CLEF_MODELS[backend].model, state: "<same state>", questions: stage2Questions("application") }, null, 2));
    } else {
      console.log(state);
    }
    return;
  }

  const cards = readJsonl<Card>(path.join(dir, "cards.jsonl"));
  const goldIds = new Set(readJsonl<Gold>(path.join(dir, "gold.jsonl")).map((g) => g.card_id));
  let pool = flags.all ? cards : cards.filter((c) => goldIds.has(c.id));
  if (flags.force) writeJsonl(predFile, []);
  const done = new Set(readJsonl<Prediction>(predFile).filter((p) => !p.error).map((p) => p.card_id));
  pool = pool.filter((c) => !done.has(c.id)).slice(0, limit);
  console.error(`Classifying ${pool.length} cards with ${backend} (source-lines ${sourceLines}); ${done.size} already done`);

  const kindNarrow = !!flags["kind-narrow"];
  const criteria = (flagStr(flags, "criteria", "full") ?? "full") as CriteriaMode;
  if (criteria !== "full" && criteria !== "core") throw new Error(`--criteria must be full or core, got ${criteria}`);
  setCriteriaMode(criteria);
  const useTier0 = !!flags.tier0;
  const useFacts = !!flags.facts;
  const facts: Map<string, Facts> = useTier0 || useFacts ? loadFacts(corpus) : new Map();
  const rules = useTier0 ? loadTier0Rules() : [];
  const tier0Of = new Map<string, Tier0Outcome | null>(useTier0 ? cards.map((c) => [c.id, tier0For(c, facts.get(c.id), rules)]) : []);
  let charter = "";
  if (flags.charter) {
    const f = path.join(repoRoot(), "spec", "DESIGN_CHARTER.md");
    if (!existsSync(f)) throw new Error(`--charter given but ${f} does not exist`);
    const raw = readFileSync(f, "utf8");
    const mode = flagStr(flags, "charter", "full");
    if (mode === "short") {
      const m = /## In one paragraph\n\n([\s\S]*?)\n\n## /.exec(raw);
      charter = m ? m[1].replace(/\n/g, " ").trim() : "";
    } else charter = raw.replace(/^\*\*Status:\*\*[^\n]*\n(?:[^\n]*\n)*?\n/m, "").trim();
  }
  const withCharter = (state: string) => (charter ? `Context: ${charter}\n\n${state}` : state);
  const kindOf = new Map(cards.map((c) => [c.id, c.label]));
  let classify: (cardId: string, state: string) => Promise<Prediction>;
  if (backend in CLEF_MODELS) {
    classify = async (id, state) => {
      const t = tier0Of.get(id);
      const pred = await classifyWithClef(backend, id, state, { kind: kindOf.get(id), kindNarrow, narrow: t?.kind === "narrow" ? t.candidates : undefined });
      return t?.kind === "narrow" ? { ...pred, tier0: { rule: t.rule, kind: "narrow" } } : pred;
    };
  } else if (backend.startsWith("claude-")) {
    const model = MODEL_IDS[backend.slice("claude-".length)];
    if (!model) throw new Error(`Unknown Claude backend ${backend}`);
    classify = (id, state) => classifyWithClaude(backend, model, effort, id, state);
  } else {
    throw new Error(`Unknown backend ${backend}`);
  }

  let cost = 0;
  let errors = 0;
  await mapConcurrent(pool, concurrency, async (card, i) => {
    const t = tier0Of.get(card.id);
    if (t?.kind === "decide") {
      appendJsonl(predFile, {
        card_id: card.id,
        backend,
        layer: { choice: t.layer, probabilities: { [t.layer]: 1 }, confidence: null },
        element_type: { choice: t.type, probabilities: t.type ? { [t.type]: 1 } : {}, confidence: null },
        significance: { score: NaN, probabilities: null },
        concerns: {},
        latency_ms: 0,
        usage: null,
        cost_usd: 0,
        error: null,
        tier0: { rule: t.rule, kind: "decide" },
      } satisfies Prediction);
      console.error(`[${i + 1}/${pool.length}] ${card.label} ${card.name} -> ${t.layer}/${t.type ?? "-"} (tier0 ${t.rule})`);
      return;
    }
    const state = withCharter(renderState(card, sourceLines, useFacts ? facts.get(card.id) : undefined));
    try {
      const pred = await classify(card.id, state);
      cost += pred.cost_usd ?? 0;
      appendJsonl(predFile, pred);
      console.error(`[${i + 1}/${pool.length}] ${card.label} ${card.name} -> ${pred.layer.choice}/${pred.element_type.choice ?? "-"} p=${(pred.layer.probabilities[pred.layer.choice] ?? pred.layer.confidence ?? NaN).toFixed(2)} sig=${pred.significance.score} ${pred.latency_ms}ms`);
    } catch (e) {
      errors++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${i + 1}/${pool.length}] ${card.name} FAILED: ${msg}`);
      appendJsonl(predFile, {
        card_id: card.id,
        backend,
        layer: { choice: NONE_OPTION, probabilities: {}, confidence: null },
        element_type: { choice: null, probabilities: {}, confidence: null },
        significance: { score: NaN, probabilities: null },
        concerns: {},
        latency_ms: 0,
        usage: null,
        cost_usd: null,
        error: msg,
      } satisfies Prediction);
    }
  });
  console.error(`Done: ${pool.length - errors} ok, ${errors} failed, approx cost $${cost.toFixed(4)} -> ${predFile}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
