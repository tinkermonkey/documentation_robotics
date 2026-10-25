/**
 * Triage atomic claims with a decision model or Claude: validity, category,
 * severity, fix scope, and two yes/no questions.
 *
 *   bun triage.ts --backend clef [--layer <id>] [--ids a,b] [--limit n] [--tag v2] [--force] [--evidence]
 *   spec/DESIGN_CHARTER.md is prepended by default (--no-charter to disable);
 *   --evidence appends a deterministic fact pack (attribute declarations across the layer,
 *   exact relationship lists between the named types) to the state.
 *
 * Backends: clef, clef-flash, claude-haiku, claude-sonnet, claude-opus.
 * Output: data/triage/decisions/<backend>[@tag]/<layer>.jsonl (resumable).
 */
import path from "node:path";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { callClef, choiceOf, CLEF_MODELS, noulOf, scoreOf, type Question } from "../classify-eval/backends/clef.js";
import { anthropic, claudeCost, mapConcurrent, MODEL_IDS } from "../classify-eval/lib/claude.js";
import { appendJsonl, flagNum, flagStr, parseFlags, readJsonl, writeJsonl } from "../classify-eval/lib/io.js";
import { readdirSync, rmSync } from "node:fs";
import { charterText, claimEvidence, layerIntent, typeContext } from "./lib/intent.js";
import { decisionsDir, harnessDir } from "./lib/paths.js";
import { CATEGORIES, CATEGORY_IDS, FIX_SCOPE_LEVELS, SEVERITY_LEVELS, VALIDITY, VALIDITY_IDS, type Claim, type Decision } from "./lib/triage-types.js";

/** The state every backend sees for a claim. */
export function claimState(c: Claim, withEvidence = false, withCharter = false): string {
  return [
    ...(withCharter ? ["# What the Documentation Robotics specification is for (design charter)", charterText(), ""] : []),
    `# Claim about the Documentation Robotics spec (layer ${c.layer})`,
    `Subject: ${c.subject} (${c.kind === "node" ? "element type" : "its relationships"})`,
    `Claim: ${c.text}`,
    `Affected ids: ${c.affected_ids.join(", ") || "(none given)"}`,
    `Proposed change: ${c.proposed_change}`,
    "",
    "# Design intent of the layer",
    layerIntent(c.layer),
    "",
    "# The subject as it stands (current schema, proposed definition, siblings, relationships)",
    typeContext(c.subject, c.kind === "relationships"),
    ...(withEvidence ? ["", "# Verified facts from the schema sources (authoritative; check the claim against these)", claimEvidence(c.affected_ids, c.subject)] : []),
  ].join("\n");
}

export const QUESTIONS: Record<string, Question> = {
  validity: { type: "choice", instructions: "Is this claim a genuine problem with the spec, the spec working as designed, a judgment call, or out of scope? Judge against the design intent and the current schema shown.", criteria: VALIDITY },
  category: { type: "choice", instructions: "Which category best describes the claim?", criteria: CATEGORIES },
  severity: { type: "score", instructions: "If the claim is valid, how severe is the problem for people building models with this spec?", criteria: SEVERITY_LEVELS },
  fix_scope: { type: "score", instructions: "What scope of spec change would resolve the claim?", criteria: FIX_SCOPE_LEVELS },
  addressed_by_proposal: { type: "noul", instructions: "The proposed definition shown in the context already resolves this claim (e.g. the claim is a misreading that the new wording prevents)." },
  classifier_relevant: { type: "noul", instructions: "This claim is about a confusion between two element types that a classifier reading source code would also make." },
};

let EVIDENCE = false;
let CHARTER = false;
async function withClef(backend: string, c: Claim): Promise<Decision> {
  const t0 = Date.now();
  const r = await callClef(backend, claimState(c, EVIDENCE, CHARTER), QUESTIONS);
  const v = choiceOf(r.answers.validity);
  const cat = choiceOf(r.answers.category);
  return {
    claim_id: c.id,
    backend,
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
}

const ClaudeOut = z.object({
  validity: z.enum(VALIDITY_IDS as unknown as [string, ...string[]]),
  validity_confidence: z.number(),
  category: z.enum(CATEGORY_IDS as unknown as [string, ...string[]]),
  category_confidence: z.number(),
  severity: z.enum(["0", "1", "2", "3"]),
  fix_scope: z.enum(["0", "1", "2", "3"]),
  addressed_by_proposal: z.number(),
  classifier_relevant: z.number(),
  rationale: z.string(),
});

function claudeSystem(): string {
  return [
    "You triage claims a model made about the Documentation Robotics architecture specification. Decide each field; report calibrated probabilities (0.5 is a coin flip).",
    "validity: " + Object.entries(VALIDITY).map(([k, v]) => `${k} = ${v}`).join("; "),
    "category: " + Object.entries(CATEGORIES).map(([k, v]) => `${k} = ${v}`).join("; "),
    "severity (if valid): " + SEVERITY_LEVELS.join("; "),
    "fix_scope: " + FIX_SCOPE_LEVELS.join("; "),
    "addressed_by_proposal: probability that the proposed definition shown already resolves the claim.",
    "classifier_relevant: probability that the claim is about a confusion between two element types that a classifier reading code would also make.",
    "rationale: at most 40 words.",
  ].join("\n");
}

async function withClaude(backend: string, model: string, c: Claim): Promise<Decision> {
  const t0 = Date.now();
  const res = await anthropic().messages.parse({
    model,
    max_tokens: 3000,
    system: [{ type: "text", text: claudeSystem(), cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: zodOutputFormat(ClaudeOut) },
    messages: [{ role: "user", content: claimState(c, EVIDENCE, CHARTER) }],
  });
  const o = res.parsed_output;
  if (!o) throw new Error(`no parsed output (${res.stop_reason})`);
  return {
    claim_id: c.id,
    backend,
    validity: { choice: o.validity, probabilities: { [o.validity]: o.validity_confidence }, confidence: o.validity_confidence },
    category: { choice: o.category, probabilities: { [o.category]: o.category_confidence }, confidence: o.category_confidence },
    severity: { score: Number(o.severity), probabilities: null },
    fix_scope: { score: Number(o.fix_scope), probabilities: null },
    addressed_by_proposal: o.addressed_by_proposal,
    classifier_relevant: o.classifier_relevant,
    latency_ms: Date.now() - t0,
    cost_usd: claudeCost(model, res.usage),
    error: null,
  };
}

export function readAllDecisions(dir: string): Decision[] {
  let out: Decision[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) out = out.concat(readJsonl<Decision>(path.join(dir, f)));
  return out;
}

/** Round probabilities and drop near-zero entries so decision files stay small. */
function compactDecision(d: Decision): Decision {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  for (const k of ["validity", "category"] as const) {
    d[k].probabilities = Object.fromEntries(Object.entries(d[k].probabilities).filter(([a, v]) => v >= 0.01 || a === d[k].choice).map(([a, v]) => [a, r3(v)]));
    if (d[k].confidence != null) d[k].confidence = r3(d[k].confidence);
  }
  d.severity.score = r3(d.severity.score);
  d.fix_scope.score = r3(d.fix_scope.score);
  d.addressed_by_proposal = r3(d.addressed_by_proposal);
  d.classifier_relevant = r3(d.classifier_relevant);
  if (d.cost_usd != null) d.cost_usd = Math.round(d.cost_usd * 1e6) / 1e6;
  return d;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const backend = flagStr(flags, "backend");
  if (!backend) {
    console.error("Usage: bun triage.ts --backend <clef|clef-flash|claude-haiku|claude-sonnet|claude-opus> [--layer id] [--ids a,b]");
    process.exit(2);
  }
  const dir = path.join(harnessDir(), "data", "triage");
  const tag = flagStr(flags, "tag");
  const backendKey = `${backend}${tag ? `@${tag}` : ""}`;
  const outDir = decisionsDir(backendKey);
  const layerFilter = flagStr(flags, "layer");
  const ids = flagStr(flags, "ids")?.split(",").map((s) => s.trim()).filter(Boolean);
  const limit = flagNum(flags, "limit", Infinity);
  EVIDENCE = !!flags.evidence;
  CHARTER = !flags["no-charter"];
  if (flags.force) {
    for (const f of readdirSync(outDir)) if (!layerFilter || f === `${layerFilter}.jsonl`) rmSync(path.join(outDir, f));
  }
  const done = new Set(readAllDecisions(outDir).filter((d) => !d.error).map((d) => d.claim_id));
  const outFor = (c: Claim) => path.join(outDir, `${c.layer}.jsonl`);
  const claims = readJsonl<Claim>(path.join(dir, "claims.jsonl"))
    .filter((c) => !layerFilter || c.layer === layerFilter)
    .filter((c) => !ids || ids.includes(c.id))
    .filter((c) => !done.has(c.id))
    .slice(0, limit);
  console.error(`Triaging ${claims.length} claims with ${backend} (${done.size} already done)`);
  const run = backend in CLEF_MODELS ? (c: Claim) => withClef(backend, c) : (c: Claim) => withClaude(backend, MODEL_IDS[backend.replace("claude-", "")] ?? "claude-sonnet-5-5", c);
  let cost = 0,
    errors = 0;
  await mapConcurrent(claims, flagNum(flags, "concurrency", 4), async (c, i) => {
    try {
      const d = await run(c);
      cost += d.cost_usd ?? 0;
      appendJsonl(outFor(c), compactDecision(d));
      console.error(`[${i + 1}/${claims.length}] ${c.id} -> ${d.validity.choice} (${(d.validity.probabilities[d.validity.choice] ?? d.validity.confidence ?? NaN).toFixed(2)}) ${d.category.choice} sev=${d.severity.score.toFixed(1)} ${d.latency_ms}ms`);
    } catch (e) {
      errors++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${i + 1}/${claims.length}] ${c.id} FAILED: ${msg}`);
      appendJsonl(outFor(c), { claim_id: c.id, backend, validity: { choice: "", probabilities: {}, confidence: null }, category: { choice: "", probabilities: {}, confidence: null }, severity: { score: NaN, probabilities: null }, fix_scope: { score: NaN, probabilities: null }, addressed_by_proposal: NaN, classifier_relevant: NaN, latency_ms: 0, cost_usd: null, error: msg } satisfies Decision);
    }
  });
  console.error(`Done: ${claims.length - errors} ok, ${errors} failed, approx cost $${cost.toFixed(4)} -> ${outDir}/`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack ?? e.message : String(e));
    process.exit(1);
  });
}
