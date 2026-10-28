/**
 * Score triage backends against human-adjudicated gold decisions.
 *
 *   bun triage-bench.ts [--backends clef,clef-flash,claude-sonnet]
 *
 * Gold: data/triage/bench-gold.jsonl (one line per claim: claim_id, validity,
 * category, severity, fix_scope?, rationale). Decisions: data/triage/decisions-*.jsonl.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { flagStr, parseFlags, readJsonl } from "../classify-eval/lib/io.js";
import { decisionsDir, harnessDir, listDecisionBackends } from "./lib/paths.js";
import { readAllDecisions } from "./triage.js";
import { GoldSchema, type Claim, type Decision, type Gold } from "./lib/triage-types.js";

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const dir = path.join(harnessDir(), "data", "triage");
  const gold = readJsonl<Gold>(path.join(dir, "bench-gold.jsonl")).map((g) => GoldSchema.parse(g));
  const claims = new Map(readJsonl<Claim>(path.join(dir, "claims.jsonl")).map((c) => [c.id, c]));
  const backends = flagStr(flags, "backends")?.split(",").map((s) => s.trim()) ?? listDecisionBackends();
  if (!gold.length) {
    console.error("No gold decisions in bench-gold.jsonl");
    process.exit(2);
  }
  console.log(`Benchmark: ${gold.length} adjudicated claims\n`);
  console.log("| backend | n | validity acc | mean p(gold validity) | category acc | severity MAE | severity within 1 | fix-scope MAE | median latency | cost / claim |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  const detail: string[] = [];
  for (const b of backends) {
    const decisions = new Map(readAllDecisions(decisionsDir(b)).filter((d) => !d.error).map((d) => [d.claim_id, d]));
    const rows = gold.map((g) => ({ g, d: decisions.get(g.claim_id) })).filter((r): r is { g: Gold; d: Decision } => !!r.d);
    if (!rows.length) continue;
    const n = rows.length;
    const vAcc = rows.filter((r) => r.d.validity.choice === r.g.validity).length / n;
    const pGold = rows.map((r) => r.d.validity.probabilities[r.g.validity] ?? (r.d.validity.choice === r.g.validity ? (r.d.validity.confidence ?? 1) : 1 - (r.d.validity.confidence ?? 0))).reduce((a, x) => a + x, 0) / n;
    const cAcc = rows.filter((r) => r.d.category.choice === r.g.category).length / n;
    const sErr = rows.map((r) => Math.abs(r.d.severity.score - r.g.severity));
    const fRows = rows.filter((r) => r.g.fix_scope !== undefined);
    const fMae = fRows.length ? fRows.map((r) => Math.abs(r.d.fix_scope.score - (r.g.fix_scope as number))).reduce((a, x) => a + x, 0) / fRows.length : NaN;
    const lat = rows.map((r) => r.d.latency_ms).sort((a, b) => a - b)[Math.floor(n / 2)];
    const cost = rows.reduce((a, r) => a + (r.d.cost_usd ?? 0), 0) / n;
    console.log(`| ${b} | ${n} | ${(100 * vAcc).toFixed(0)}% | ${pGold.toFixed(2)} | ${(100 * cAcc).toFixed(0)}% | ${(sErr.reduce((a, x) => a + x, 0) / n).toFixed(2)} | ${(100 * sErr.filter((e) => e <= 1).length / n).toFixed(0)}% | ${Number.isNaN(fMae) ? "n/a" : fMae.toFixed(2)} | ${lat} ms | $${cost.toFixed(4)} |`);
    for (const r of rows) {
      const ok = r.d.validity.choice === r.g.validity ? "ok " : "MISS";
      detail.push(`${ok} ${b.padEnd(14)} ${r.g.claim_id.padEnd(44)} gold=${r.g.validity}/${r.g.category}/sev${r.g.severity}  got=${r.d.validity.choice}(${(r.d.validity.probabilities[r.d.validity.choice] ?? r.d.validity.confidence ?? NaN).toFixed(2)})/${r.d.category.choice}/sev${r.d.severity.score.toFixed(1)}`);
    }
  }
  console.log("\nPer-claim detail:");
  for (const line of detail) console.log("  " + line);
  console.log("\nClaims:");
  for (const g of gold) console.log(`  ${g.claim_id}: ${claims.get(g.claim_id)?.text ?? "?"}\n      gold rationale: ${g.rationale}`);
}

main();
