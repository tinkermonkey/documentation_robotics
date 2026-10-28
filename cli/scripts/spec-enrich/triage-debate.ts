/**
 * Debate stage for low-confidence triage decisions:
 *   1. a first-pass decision (default: clef@evidence) with its probability vector
 *   2. Opus writes arguments for and against each validity option, no verdict
 *   3. Clef re-scores the same questions with the arguments appended to the state
 *
 *   bun triage-debate.ts --ids a,b            # specific claims (e.g. the benchmark)
 *   bun triage-debate.ts --layer application --threshold 0.5   # all first-pass decisions below p
 *
 * Output: decisions/clef@debate/<layer>.jsonl (scored by triage-bench like any backend)
 *         data/triage/debate/<claim id>.json (the arguments, for reading)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { callClef, choiceOf, CLEF_MODELS, noulOf, scoreOf } from "../classify-eval/backends/clef.js";
import { anthropic, claudeCost, mapConcurrent } from "../classify-eval/lib/claude.js";
import { appendJsonl, flagNum, flagStr, parseFlags, readJsonl } from "../classify-eval/lib/io.js";
import { decisionsDir, harnessDir } from "./lib/paths.js";
import { FIX_SCOPE_LEVELS, SEVERITY_LEVELS, VALIDITY, VALIDITY_IDS, type Claim, type Decision } from "./lib/triage-types.js";
import { claimState, QUESTIONS, readAllDecisions } from "./triage.js";

const Arguments = z.object({
  fact_checks: z.array(z.string()),
  options: z.array(
    z.object({
      validity: z.enum(VALIDITY_IDS as unknown as [string, ...string[]]),
      arguments_for: z.array(z.string()),
      arguments_against: z.array(z.string()),
    }),
  ),
});

function argueSystem(): string {
  return [
    "You are a reviewer helping a decision model triage a claim about an architecture specification. You will see the claim, the layer's design intent, the subject's schema, verified facts, and the decision model's first-pass probabilities.",
    "Produce arguments, not a verdict:",
    "- fact_checks: two to four one-sentence statements of what the verified facts establish or refute about the claim (cite the fact, e.g. 'the evidence lists exactly one such relationship').",
    "- options: for each of the four validity options, up to three arguments for and up to three against, each at most 30 words, grounded in the facts, the layer intent, or how the spec is used by modellers and the CLI. Give weak options genuinely weak arguments rather than inventing strong ones.",
    "Do not state which option you favour and do not rank them.",
    "Validity options: " + Object.entries(VALIDITY).map(([k, v]) => `${k} = ${v}`).join("; "),
  ].join("\n");
}

function fmtDist(p: Record<string, number>): string {
  return Object.entries(p).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ");
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const firstPass = flagStr(flags, "first-pass", "clef@evidence") ?? "clef@evidence";
  const backend = flagStr(flags, "backend", "clef") ?? "clef";
  const outKey = flagStr(flags, "tag", "debate") ?? "debate";
  const threshold = flagNum(flags, "threshold", 1.01);
  const layerFilter = flagStr(flags, "layer");
  const ids = flagStr(flags, "ids")?.split(",").map((s) => s.trim()).filter(Boolean);
  const dir = path.join(harnessDir(), "data", "triage");
  const claims = new Map(readJsonl<Claim>(path.join(dir, "claims.jsonl")).map((c) => [c.id, c]));
  const first = new Map(readAllDecisions(decisionsDir(firstPass)).filter((d) => !d.error).map((d) => [d.claim_id, d]));
  const outDir = decisionsDir(`${backend}@${outKey}`);
  const argDir = path.join(dir, "debate");
  mkdirSync(argDir, { recursive: true });
  const done = new Set(readAllDecisions(outDir).filter((d) => !d.error).map((d) => d.claim_id));
  const todo = [...first.values()]
    .filter((d) => (ids ? ids.includes(d.claim_id) : (d.validity.probabilities[d.validity.choice] ?? 1) < threshold))
    .filter((d) => !layerFilter || claims.get(d.claim_id)?.layer === layerFilter)
    .filter((d) => flags.force || !done.has(d.claim_id));
  console.error(`Debating ${todo.length} claims (first pass ${firstPass}, re-score with ${backend})`);
  const client = anthropic();
  const format = zodOutputFormat(Arguments);
  let cost = 0;
  await mapConcurrent(todo, flagNum(flags, "concurrency", 3), async (d0, i) => {
    const c = claims.get(d0.claim_id);
    if (!c) return;
    const t0 = Date.now();
    try {
      const state = claimState(c, true, !flags["no-charter"]);
      const res = await client.messages.parse({
        model: "claude-opus-5-5",
        max_tokens: 6000,
        system: [{ type: "text", text: argueSystem(), cache_control: { type: "ephemeral" } }],
        output_config: { effort: "high", format },
        messages: [{ role: "user", content: `${state}\n\n# Decision model's first-pass validity probabilities\n${fmtDist(d0.validity.probabilities)} (chosen: ${d0.validity.choice})` }],
      });
      const args = res.parsed_output;
      if (!args) throw new Error(`no arguments (${res.stop_reason})`);
      const opusCost = claudeCost("claude-opus-5-5", res.usage);
      const argText = [
        "# Reviewer's fact checks",
        ...args.fact_checks.map((f) => `- ${f}`),
        "",
        "# Reviewer's arguments (no verdict given)",
        ...args.options.flatMap((o) => [`## ${o.validity}`, ...o.arguments_for.map((a) => `- for: ${a}`), ...o.arguments_against.map((a) => `- against: ${a}`)]),
      ].join("\n");
      writeFileSync(path.join(argDir, `${c.id.replace(/[:#]/g, "_")}.json`), JSON.stringify({ claim_id: c.id, first_pass: d0.validity, arguments: args }, null, 2) + "\n");
      const r = await callClef(backend, `${state}\n\n${argText}`, QUESTIONS);
      const v = choiceOf(r.answers.validity);
      const cat = choiceOf(r.answers.category);
      const d: Decision = {
        claim_id: c.id,
        backend: `${backend}@${outKey}`,
        validity: { choice: v.choice ?? "judgment_call", probabilities: v.probabilities, confidence: v.confidence },
        category: { choice: cat.choice ?? "other", probabilities: cat.probabilities, confidence: cat.confidence },
        severity: scoreOf(r.answers.severity, SEVERITY_LEVELS.length),
        fix_scope: scoreOf(r.answers.fix_scope, FIX_SCOPE_LEVELS.length),
        addressed_by_proposal: noulOf(r.answers.addressed_by_proposal),
        classifier_relevant: noulOf(r.answers.classifier_relevant),
        latency_ms: Date.now() - t0,
        cost_usd: opusCost + (r.usage.input_tokens * CLEF_MODELS[backend].inputPerM) / 1e6,
        error: null,
      };
      cost += d.cost_usd ?? 0;
      appendJsonl(path.join(outDir, `${c.layer}.jsonl`), d);
      console.error(`[${i + 1}/${todo.length}] ${c.id}\n     before: ${fmtDist(d0.validity.probabilities)}\n     after:  ${fmtDist(d.validity.probabilities)}`);
    } catch (e) {
      console.error(`[${i + 1}/${todo.length}] ${c.id} FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  console.error(`Done; approx cost $${cost.toFixed(3)} -> ${outDir}/`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
