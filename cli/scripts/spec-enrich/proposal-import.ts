/**
 * Import a decided Context Studio proposal back into walk-<layer>.jsonl.
 *
 *   bun proposal-import.ts --layer api [--file data/triage/reflect/clef/proposals/api.json] [--out walk file] [--by "user"] [--dry-run]
 *
 * Reads a proposal in the shape proposal-export.ts writes (format dr-reflection-plan/1) after
 * review: every operation carries status applied | rejected | pending and a reason. An accepted
 * (applied) operation becomes the walk decision its op implies: delete -> delete; update ->
 * rename when only the predicate changed, reverse when source and destination swapped, retarget
 * otherwise; create -> an `add` on the row it belongs to. A rejected operation becomes keep.
 * Pending operations are skipped. Rows are merged by triple into the walk file, as sheet-import.py
 * does, and apply-walk.ts applies them.
 */
import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { flagStr, parseFlags, readJsonl } from "../classify-eval/lib/io.js";
import { harnessDir } from "./lib/paths.js";
import type { Operation, Proposal, WalkRow } from "./proposal-export.js";

const triple = (id: string) => {
  const p = id.split(".");
  return { source: `${p[0]}.${p[1]}`, predicate: p[2], destination: `${p[3]}.${p[4]}` };
};

function replacementOf(o: Operation): string {
  const b = o.base as Record<string, string>;
  const f = o.fields as Record<string, string>;
  const src = f.source_spec_node_id ?? b.source_spec_node_id;
  const pred = f.predicate ?? b.predicate;
  const dst = f.destination_spec_node_id ?? b.destination_spec_node_id;
  return `${src}.${pred}.${dst}`;
}

export function decisionFor(o: Operation): WalkRow["decision"] {
  if (o.status === "rejected") return "keep";
  if (o.op === "delete") return "delete";
  const b = o.base as Record<string, string>;
  const r = triple(replacementOf(o));
  if (r.source === b.destination_spec_node_id && r.destination === b.source_spec_node_id) return "reverse";
  if (r.source === b.source_spec_node_id && r.destination === b.destination_spec_node_id) return "rename";
  return "retarget";
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const layer = flagStr(flags, "layer");
  if (!layer) {
    console.error("Usage: bun proposal-import.ts --layer <id> [--file proposal.json] [--out walk file] [--by who] [--dry-run]");
    process.exit(2);
  }
  const reflDir = path.join(harnessDir(), "data", "triage", "reflect", "clef");
  const file = flagStr(flags, "file") ?? path.join(reflDir, "proposals", `${layer}.json`);
  const out = flagStr(flags, "out") ?? path.join(reflDir, `walk-${layer}.jsonl`);
  const by = flagStr(flags, "by", "user") ?? "user";
  const dry = !!flags["dry-run"];
  const proposal = JSON.parse(readFileSync(file, "utf8")) as Proposal;
  if (proposal.format !== "dr-reflection-plan/1") throw new Error(`${file}: unknown format ${proposal.format}`);
  const existing = new Map<string, WalkRow>(existsSync(out) ? readJsonl<WalkRow>(out).map((w) => [w.triple, w]) : []);
  let nextRow = Math.max(0, ...[...existing.values()].map((w) => w.row)) + 1;
  const rows = new Map<string, WalkRow>();
  let skipped = 0;
  const today = new Date().toISOString().slice(0, 10);
  // group by the plan row (dr.plan_row): one walk row per plan row, extra deletes/creates fold in
  const byPlanRow = new Map<number, Operation[]>();
  for (const o of proposal.operations) byPlanRow.set(o.dr.plan_row, [...(byPlanRow.get(o.dr.plan_row) ?? []), o]);
  for (const ops of byPlanRow.values()) {
    const decided = ops.filter((o) => o.status === "applied" || o.status === "rejected");
    if (!decided.length) {
      skipped += ops.length;
      continue;
    }
    // the primary operation is the one on the plan row's own triple
    const primary = decided.find((o) => o.target_id === o.dr.triple && o.dr.triple === ops[0].dr.triple) ?? decided[0];
    const planTriple = ops[0].dr.triple;
    const decision = decisionFor(primary);
    const row: WalkRow = {
      row: existing.get(planTriple)?.row ?? nextRow++,
      triple: planTriple,
      kind: primary.dr.plan_kind,
      decision,
      replacement: decision === "keep" ? null : primary.op === "delete" ? (primary.dr.replacement[0] ?? null) : replacementOf(primary),
      rationale: primary.reason ?? primary.rationale,
      adjudicated_by: `${by} (${today}) via Context Studio proposal ${proposal.title}`,
    };
    const alsoDelete = decided.filter((o) => o !== primary && o.op === "delete" && o.status === "applied").map((o) => o.target_id!);
    const add = decided.filter((o) => o.op === "create" && o.status === "applied").map((o) => o.ref!);
    if (alsoDelete.length) row.also_delete = alsoDelete;
    if (add.length) row.add = add;
    rows.set(planTriple, row);
  }
  const merged = new Map(existing);
  for (const [t, r] of rows) merged.set(t, r);
  const lines = [...merged.values()].sort((a, b) => a.row - b.row);
  if (!dry) writeFileSync(out, lines.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`${dry ? "[dry run] " : ""}${layer}: ${rows.size} decided rows imported (${[...rows.values()].filter((r) => !existing.has(r.triple)).length} new), ${skipped} pending operations skipped -> ${lines.length} rows in ${path.relative(process.cwd(), out)}`);
}

if (import.meta.main) main();
