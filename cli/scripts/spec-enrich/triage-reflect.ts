/**
 * Reflection triage for relationship claims: before judging a claim about a
 * relationship `src pred dst`, ask the decision model the "sorting questions"
 * a maintainer would ask ("if src does not pred dst, then what does?"):
 *
 *   source_for    - which element type is the best source of `pred dst`?
 *   target_for    - what does `src pred` best point to?
 *   predicate_for - which predicate best relates src to dst?
 *
 * each offered the current answer, the catalog's other answers and the
 * sibling types of the current answer, plus 'none'. The answers (top 3 with
 * probabilities) are appended to the state and the normal triage questions are
 * asked again. Decisions go to data/triage/decisions/<backend>@reflect/<layer>.jsonl
 * so triage-bench.ts and triage-report.ts can score them; the sorting answers
 * go to data/triage/reflect/<backend>/<layer>.jsonl.
 *
 *   bun triage-reflect.ts --backend clef [--layer application] [--ids a,b] [--limit n] [--top 8] [--tag reflect] [--force]
 */
import path from "node:path";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { callClef, choiceOf, CLEF_MODELS, noulOf, scoreOf, type Question } from "../classify-eval/backends/clef.js";
import { mapConcurrent } from "../classify-eval/lib/claude.js";
import { appendJsonl, flagNum, flagStr, parseFlags, readJsonl } from "../classify-eval/lib/io.js";
import { loadNodeSchemas, loadPredicates, loadRelationshipSchemas, type NodeSchema, type RelationshipSchema } from "./lib/schemas.js";
import { decisionsDir, harnessDir } from "./lib/paths.js";
import { claimState, compactDecision, QUESTIONS, readAllDecisions } from "./triage.js";
import { FIX_SCOPE_LEVELS, SEVERITY_LEVELS, type Claim, type Decision } from "./lib/triage-types.js";

interface Triple {
  id: string;
  source: string;
  predicate: string;
  destination: string;
}

/** `api.operation.realizes.application.applicationfunction` -> triple; null for non-relationship ids. */
export function parseTriple(id: string): Triple | null {
  const p = id.split(".");
  if (p.length !== 5) return null;
  return { id, source: `${p[0]}.${p[1]}`, predicate: p[2], destination: `${p[3]}.${p[4]}` };
}

function firstSentence(s: string, max = 170): string {
  const t = s.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  const out = (m ? m[1] : t).slice(0, max);
  return out.length < (m ? m[1] : t).length ? out.replace(/\s\S*$/, "") + "..." : out;
}

export interface SortingQuestions {
  questions: Record<string, Question>;
  candidates: Record<string, string[]>;
}

/**
 * Build the three sorting questions for one triple. Candidate order: the current answer, then the
 * catalog's other answers, then siblings of the current answer in its layer, capped at `top`, plus
 * 'none'.
 */
export function sortingQuestions(t: Triple, nodes: NodeSchema[], rels: RelationshipSchema[], preds: Record<string, { description?: string; inverse?: string }>, top = 8): SortingQuestions {
  const byId = new Map(nodes.map((n) => [n.specNodeId, n]));
  const desc = (id: string) => firstSentence(byId.get(id)?.description ?? id);
  const layerOf = (id: string) => id.split(".")[0];
  const pick = (first: string, catalog: string[], pool: string[]): string[] => {
    const out: string[] = [];
    for (const x of [first, ...catalog, ...pool]) if (byId.has(x) && !out.includes(x) && out.length < top) out.push(x);
    return out;
  };
  const siblings = (id: string) => nodes.filter((n) => n.layer === layerOf(id) && n.specNodeId !== id).map((n) => n.specNodeId).sort();
  const predText = preds[t.predicate]?.description ?? t.predicate;

  const sources = pick(
    t.source,
    rels.filter((r) => r.predicate === t.predicate && r.destination === t.destination).map((r) => r.source).sort(),
    siblings(t.source)
  );
  const targets = pick(
    t.destination,
    rels.filter((r) => r.predicate === t.predicate && r.source === t.source).map((r) => r.destination).sort(),
    siblings(t.destination)
  );
  // Predicates: those the catalog declares src -> dst, then those it declares dst -> src (labelled
  // as reverse), then a few general ones.
  const forward = [...new Set(rels.filter((r) => r.source === t.source && r.destination === t.destination).map((r) => r.predicate))];
  const reverse = [...new Set(rels.filter((r) => r.source === t.destination && r.destination === t.source).map((r) => r.predicate))];
  const general = ["realizes", "serves", "uses", "depends-on", "composes", "references", "triggers", "accesses"];
  const predCriteria: Record<string, string> = {};
  for (const p of [t.predicate, ...forward, ...general]) {
    if (Object.keys(predCriteria).length >= top) break;
    if (preds[p] && !predCriteria[p]) predCriteria[p] = `${t.source} ${p} ${t.destination}: ${preds[p].description ?? p}`;
  }
  for (const p of reverse) {
    if (Object.keys(predCriteria).length >= top + 2) break;
    const k = `reverse:${p}`;
    if (preds[p] && !predCriteria[k]) predCriteria[k] = `the other way round, ${t.destination} ${p} ${t.source}: ${preds[p].description ?? p}`;
  }
  predCriteria.none = `no predicate fits; ${t.source} and ${t.destination} should not be directly related`;

  const choiceCriteria = (ids: string[], noneText: string) => Object.fromEntries([...ids.map((id) => [id, desc(id)] as const), ["none", noneText]]);
  return {
    candidates: { source_for: sources, target_for: targets, predicate_for: Object.keys(predCriteria) },
    questions: {
      source_for: {
        type: "choice",
        instructions: `Sorting question. The catalog says '${t.source} ${t.predicate} ${t.destination}' (${t.predicate}: ${predText}). If ${t.source} is not the right source, what is? Which listed element type is the best SOURCE of '${t.predicate} ${t.destination}', judged by the predicate's meaning and the design intent? Choose 'none' if no listed type should ${t.predicate} ${t.destination}.`,
        criteria: choiceCriteria(sources, `no listed type should ${t.predicate} ${t.destination}`),
      },
      target_for: {
        type: "choice",
        instructions: `Sorting question. If ${t.destination} is not the right destination, what is? Which listed element type is the best DESTINATION of '${t.source} ${t.predicate}'? Choose 'none' if ${t.source} should not ${t.predicate} any listed type.`,
        criteria: choiceCriteria(targets, `${t.source} should not ${t.predicate} any listed type`),
      },
      predicate_for: {
        type: "choice",
        instructions: `Sorting question. Which predicate best describes how ${t.source} relates to ${t.destination}? Options prefixed 'reverse:' mean the relationship should run from ${t.destination} to ${t.source} instead.`,
        criteria: predCriteria,
      },
    },
  };
}

function top3(a: ReturnType<typeof choiceOf>): string {
  return Object.entries(a.probabilities)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} (${v.toFixed(2)})`)
    .join(", ");
}

export interface Reflection {
  claim_id: string;
  triple: string;
  answers: Record<string, { choice: string | null; top3: string; probabilities: Record<string, number> }>;
  candidates: Record<string, string[]>;
  reproduced: boolean; // all three sorting answers reproduce the current triple
  /** reproduced: all three answers are the current triple; no_better: no concrete alternative won (answers are the current value or 'none'); alternative: a different type or predicate won at least one question */
  outcome: "reproduced" | "no_better" | "alternative";
  alternatives: string[]; // the concrete alternatives that won, e.g. "source=security.policyrule", "predicate=reverse:uses"
}

export function reflectionOutcome(t: Triple, a: Reflection["answers"]): { outcome: Reflection["outcome"]; alternatives: string[] } {
  const alternatives: string[] = [];
  const current: Record<string, string> = { source_for: t.source, target_for: t.destination, predicate_for: t.predicate };
  for (const [q, cur] of Object.entries(current)) {
    const c = a[q].choice;
    if (c && c !== cur && c !== "none") alternatives.push(`${q.replace("_for", "")}=${c}`);
  }
  if (alternatives.length) return { outcome: "alternative", alternatives };
  const allCurrent = Object.entries(current).every(([q, cur]) => a[q].choice === cur);
  return { outcome: allCurrent ? "reproduced" : "no_better", alternatives };
}

function reflectionText(t: Triple, refl: Reflection): string {
  const a = refl.answers;
  const verdict = {
    reproduced: `All three answers reproduce the current relationship, which argues for works_as_designed or judgment_call unless the claim is about something other than source, destination or predicate.`,
    no_better: `No better source, destination or predicate was found (the alternatives were 'none' or the current value). If nothing else fills the role, the current relationship is probably a judgment call or working as designed rather than a defect, unless the claim is that the relationship should not exist at all.`,
    alternative: `A concrete alternative won at least one sorting question (${refl.alternatives.join("; ")}). If it matches the claim's proposed change, that supports a real defect; if it contradicts it, the claim may still be wrong about the fix.`,
  }[refl.outcome];
  return [
    `# Reflection: sorting questions answered by the same model about ${t.id}`,
    `Asked which type is the best source of '${t.predicate} ${t.destination}' (candidates: ${refl.candidates.source_for.join(", ")}, none): ${a.source_for.top3}.`,
    `Asked what '${t.source} ${t.predicate}' best points to (candidates: ${refl.candidates.target_for.join(", ")}, none): ${a.target_for.top3}.`,
    `Asked which predicate best relates ${t.source} to ${t.destination} (candidates: ${refl.candidates.predicate_for.join(", ")}): ${a.predicate_for.top3}.`,
    verdict,
  ].join("\n");
}

async function reflectOne(backend: string, c: Claim, t: Triple, sq: SortingQuestions, state: string): Promise<{ refl: Reflection; cost: number }> {
  const r = await callClef(backend, state, sq.questions);
  const answers: Reflection["answers"] = {};
  for (const k of Object.keys(sq.questions)) {
    const a = choiceOf(r.answers[k]);
    answers[k] = { choice: a.choice, top3: top3(a), probabilities: Object.fromEntries(Object.entries(a.probabilities).filter(([, v]) => v >= 0.01).map(([x, v]) => [x, Math.round(v * 1000) / 1000])) };
  }
  const { outcome, alternatives } = reflectionOutcome(t, answers);
  return { refl: { claim_id: c.id, triple: t.id, answers, candidates: sq.candidates, reproduced: outcome === "reproduced", outcome, alternatives }, cost: (r.usage.input_tokens * CLEF_MODELS[backend].inputPerM) / 1e6 };
}

async function decideWithReflection(backend: string, c: Claim, state: string): Promise<{ d: Decision; cost: number }> {
  const t0 = Date.now();
  const r = await callClef(backend, state, QUESTIONS);
  const v = choiceOf(r.answers.validity);
  const cat = choiceOf(r.answers.category);
  const d: Decision = {
    claim_id: c.id,
    backend: `${backend}@reflect`,
    validity: { choice: v.choice ?? "judgment_call", probabilities: v.probabilities, confidence: v.confidence },
    category: { choice: cat.choice ?? "other", probabilities: cat.probabilities, confidence: cat.confidence },
    severity: scoreOf(r.answers.severity, SEVERITY_LEVELS.length),
    fix_scope: scoreOf(r.answers.fix_scope, FIX_SCOPE_LEVELS.length),
    addressed_by_proposal: noulOf(r.answers.addressed_by_proposal),
    classifier_relevant: noulOf(r.answers.classifier_relevant),
    latency_ms: Date.now() - t0,
    cost_usd: (r.usage.input_tokens * CLEF_MODELS[backend].inputPerM) / 1e6,
    error: null,
  };
  return { d, cost: d.cost_usd ?? 0 };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const backend = flagStr(flags, "backend", "clef") ?? "clef";
  if (!(backend in CLEF_MODELS)) {
    console.error("Usage: bun triage-reflect.ts --backend <clef|clef-flash> [--layer id] [--ids a,b] [--limit n] [--top 8] [--tag reflect]");
    process.exit(2);
  }
  const dir = path.join(harnessDir(), "data", "triage");
  const tag = flagStr(flags, "tag", "reflect") ?? "reflect";
  const outDir = decisionsDir(`${backend}@${tag}`);
  const reflDir = path.join(dir, "reflect", backend);
  mkdirSync(reflDir, { recursive: true });
  const layerFilter = flagStr(flags, "layer");
  const ids = flagStr(flags, "ids")?.split(",").map((s) => s.trim()).filter(Boolean);
  const limit = flagNum(flags, "limit", Infinity);
  const top = flagNum(flags, "top", 8);
  if (flags.force) {
    for (const d of [outDir, reflDir]) for (const f of readdirSync(d)) if (!layerFilter || f === `${layerFilter}.jsonl`) rmSync(path.join(d, f));
  }
  const done = new Set(readAllDecisions(outDir).filter((d) => !d.error).map((d) => d.claim_id));
  const claims = readJsonl<Claim>(path.join(dir, "claims.jsonl"))
    .filter((c) => !layerFilter || c.layer === layerFilter)
    .filter((c) => !ids || ids.includes(c.id))
    .filter((c) => !done.has(c.id))
    .map((c) => ({ c, t: c.affected_ids.map(parseTriple).find((x): x is Triple => !!x) }))
    .filter((x): x is { c: Claim; t: Triple } => !!x.t)
    .slice(0, limit);
  console.error(`Reflecting on ${claims.length} relationship claims with ${backend} (${done.size} already done)`);
  const nodes = loadNodeSchemas();
  const rels = loadRelationshipSchemas();
  const preds = loadPredicates();
  let cost = 0,
    errors = 0,
    reproduced = 0;
  await mapConcurrent(claims, flagNum(flags, "concurrency", 4), async ({ c, t }, i) => {
    try {
      const base = claimState(c, true, "short");
      const sq = sortingQuestions(t, nodes, rels, preds, top);
      const { refl, cost: c1 } = await reflectOne(backend, c, t, sq, base);
      const { d, cost: c2 } = await decideWithReflection(backend, c, `${base}\n\n${reflectionText(t, refl)}`);
      cost += c1 + c2;
      if (refl.reproduced) reproduced++;
      appendJsonl(path.join(reflDir, `${c.layer}.jsonl`), refl);
      appendJsonl(path.join(outDir, `${c.layer}.jsonl`), compactDecision(d));
      console.error(`[${i + 1}/${claims.length}] ${c.id} ${refl.outcome}${refl.alternatives.length ? ` (${refl.alternatives.join("; ")})` : ""} -> ${d.validity.choice} (${(d.validity.probabilities[d.validity.choice] ?? NaN).toFixed(2)})`);
    } catch (e) {
      errors++;
      console.error(`[${i + 1}/${claims.length}] ${c.id} FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  console.error(`Done: ${claims.length - errors} ok, ${errors} failed, ${reproduced} reproduced the current triple, approx cost $${cost.toFixed(4)} -> ${outDir}/`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack ?? e.message : String(e));
    process.exit(1);
  });
}
