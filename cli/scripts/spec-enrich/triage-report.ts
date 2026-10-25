/**
 * Per-layer triage tables from one backend's decisions.
 *
 *   bun triage-report.ts --backend clef [--layer application] [--min-validity 0.0]
 *
 * Writes data/triage/report-<backend>.md and prints the requested layer.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { flagStr, parseFlags, readJsonl } from "../classify-eval/lib/io.js";
import { decisionsDir, harnessDir, listDecisionBackends } from "./lib/paths.js";
import { readAllDecisions } from "./triage.js";
import { type Claim, type Decision } from "./lib/triage-types.js";

function p(d: Decision, field: "validity" | "category"): string {
  const v = d[field].probabilities[d[field].choice] ?? d[field].confidence;
  return typeof v === "number" && !Number.isNaN(v) ? v.toFixed(2) : "?";
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const backend = flagStr(flags, "backend", "clef") ?? "clef";
  const layerFilter = flagStr(flags, "layer");
  const dir = path.join(harnessDir(), "data", "triage");
  const claims = new Map(readJsonl<Claim>(path.join(dir, "claims.jsonl")).map((c) => [c.id, c]));
  const decisions = readAllDecisions(decisionsDir(backend)).filter((d) => !d.error);
  const byLayer = new Map<string, Array<{ c: Claim; d: Decision }>>();
  for (const d of decisions) {
    const c = claims.get(d.claim_id);
    if (!c) continue;
    const arr = byLayer.get(c.layer) ?? [];
    arr.push({ c, d });
    byLayer.set(c.layer, arr);
  }
  // crude dedupe key: category + sorted affected ids
  const dupKey = (c: Claim, d: Decision) => `${d.category.choice}|${[...c.affected_ids].sort().join(",")}`;

  const md: string[] = [`# Triage report (${backend})`, "", `Generated ${new Date().toISOString()}. ${decisions.length} claims.`, ""];
  const order = ["real_defect", "judgment_call", "works_as_designed", "out_of_scope"];
  const summary: string[] = ["| layer | claims | real_defect | judgment_call | works_as_designed | out_of_scope | sev≥2 among real |", "|---|---|---|---|---|---|---|"];
  for (const [layer, rows] of [...byLayer.entries()].sort()) {
    const count = (v: string) => rows.filter((r) => r.d.validity.choice === v).length;
    const sev2 = rows.filter((r) => r.d.validity.choice === "real_defect" && r.d.severity.score >= 1.5).length;
    summary.push(`| ${layer} | ${rows.length} | ${count("real_defect")} | ${count("judgment_call")} | ${count("works_as_designed")} | ${count("out_of_scope")} | ${sev2} |`);
  }
  md.push("## Summary", "", ...summary, "");
  for (const [layer, rows] of [...byLayer.entries()].sort()) {
    md.push(`## ${layer}`, "");
    const groups = new Map<string, number>();
    for (const r of rows) groups.set(dupKey(r.c, r.d), (groups.get(dupKey(r.c, r.d)) ?? 0) + 1);
    rows.sort((a, b) => order.indexOf(a.d.validity.choice) - order.indexOf(b.d.validity.choice) || b.d.severity.score - a.d.severity.score);
    md.push("| id | validity (p) | category (p) | sev | fix | addr. | clf. | claim | proposed change |", "|---|---|---|---|---|---|---|---|---|");
    for (const { c, d } of rows) {
      const dup = (groups.get(dupKey(c, d)) ?? 1) > 1 ? " ×" + groups.get(dupKey(c, d)) : "";
      md.push(`| ${c.id} | ${d.validity.choice} (${p(d, "validity")}) | ${d.category.choice} (${p(d, "category")})${dup} | ${d.severity.score.toFixed(1)} | ${d.fix_scope.score.toFixed(1)} | ${Number.isNaN(d.addressed_by_proposal) ? "?" : d.addressed_by_proposal.toFixed(2)} | ${Number.isNaN(d.classifier_relevant) ? "?" : d.classifier_relevant.toFixed(2)} | ${c.text.replace(/\|/g, "/")} | ${c.proposed_change.replace(/\|/g, "/")} |`);
    }
    md.push("");
  }
  const out = md.join("\n").replace(/\n+$/, "") + "\n";
  writeFileSync(path.join(dir, `report-${backend}.md`), out);
  if (layerFilter) {
    const start = out.indexOf(`## ${layerFilter}\n`);
    const end = out.indexOf("\n## ", start + 1);
    console.log(out.slice(0, out.indexOf("## Summary")) + out.slice(start, end === -1 ? undefined : end));
  } else console.log(out.slice(0, out.indexOf("\n## ", out.indexOf("## Summary") + 1)));
}

main();
