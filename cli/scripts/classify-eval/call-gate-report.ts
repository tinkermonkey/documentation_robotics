/**
 * How the CLI's call-edge evidence gate (src/analyzers/call-evidence.ts) does on hand-checked
 * CBM CALLS edges. No model calls, no index needed.
 *
 *   bun call-gate-report.ts [--truth data/call-edges-truth.jsonl] [--min-confidence 0.5]
 *
 * data/call-edges-truth.jsonl holds CALLS edges sampled from the dr-cli (cli/ at 450e650f),
 * fastapi, petclinic and heimdall indexes on CBM 0.12.1, stratified by resolution strategy and
 * confidence (up to 8 per band per corpus, so the bands are not in their graph proportions), each
 * with the evidence extraction reads and `real`: whether the call site really calls that
 * definition, judged from the call line and the caller file's imports (agent-labelled on
 * 2026-11-12, not reviewed by the maintainer). `set` is `design` for the sample the gate's rules
 * were written from, `held-out` for a second low-confidence sample drawn and labelled before the
 * gate was run on it (the own-member rule was added after seeing it: 2 of its edges).
 *
 * Per set and confidence band: real and wrong edges kept and dropped, and the precision of the
 * kept edges against the precision of all of them.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { harnessDir, repoRoot } from "./lib/env.js";
import { flagStr, parseFlags, readJsonl } from "./lib/io.js";
import { callEdgeVerdict, callGateFrom, type CallEvidence } from "../../src/analyzers/call-evidence.js";
import type { AnalyzerHeuristic } from "../../src/analyzers/types.js";

interface TruthRow {
  corpus: string;
  set: "design" | "held-out";
  site: string;
  target: string;
  real: boolean;
  evidence: CallEvidence;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const file = flagStr(flags, "truth") ?? path.join(harnessDir(), "data", "call-edges-truth.jsonl");
  const cbm = JSON.parse(readFileSync(path.join(repoRoot(), "spec", "dist", "analyzers", "cbm.json"), "utf8")) as { heuristics: { heuristics?: AnalyzerHeuristic[] } };
  const gate = callGateFrom(cbm.heuristics.heuristics ?? []);
  if (!gate) throw new Error("the cbm mapping has no call_edge_evidence heuristic");
  const min = flagStr(flags, "min-confidence");
  if (min !== undefined) gate.minConfidence = Number(min);
  const rows = readJsonl<TruthRow>(file);

  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "n/a");
  const lines = [
    "| set | band | edges | real | kept real | kept wrong | dropped real | dropped wrong | precision before | precision kept |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  const reasons = new Map<string, { real: number; wrong: number }>();
  for (const set of ["design", "held-out"] as const) {
    for (const band of ["low", "high"] as const) {
      const sel = rows.filter((r) => r.set === set && (r.evidence.confidence! < gate.minConfidence) === (band === "low"));
      if (!sel.length) continue;
      const c = { keptReal: 0, keptWrong: 0, droppedReal: 0, droppedWrong: 0 };
      for (const r of sel) {
        const v = callEdgeVerdict(r.evidence, gate);
        if (v.keep) r.real ? c.keptReal++ : c.keptWrong++;
        else r.real ? c.droppedReal++ : c.droppedWrong++;
        const tally = reasons.get(v.reason) ?? { real: 0, wrong: 0 };
        r.real ? tally.real++ : tally.wrong++;
        reasons.set(v.reason, tally);
      }
      const real = c.keptReal + c.droppedReal;
      lines.push(
        `| ${set} | ${band === "low" ? `< ${gate.minConfidence}` : `>= ${gate.minConfidence}`} | ${sel.length} | ${real} | ${c.keptReal} | ${c.keptWrong} | ${c.droppedReal} | ${c.droppedWrong} | ${pct(real, sel.length)} | ${pct(c.keptReal, c.keptReal + c.keptWrong)} |`
      );
    }
  }
  lines.push("", "By verdict (both sets): " + [...reasons].map(([k, v]) => `${k} ${v.real} real / ${v.wrong} wrong`).join("; "));
  console.log(lines.join("\n"));
}

main();
