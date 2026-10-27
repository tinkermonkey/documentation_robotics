/**
 * Import Context Studio's decisions on a proposal back into walk-<layer>.jsonl.
 *
 *   bun proposal-import.ts --layer api --decisions decisions.json [--file proposals/api.json] [--out walk file] [--by who] [--dry-run]
 *   bun proposal-import.ts --layer api --simulate-walk        # round-trip check from dr.walk_decision
 *
 * `--decisions` is Context Studio's decision export: an array (or {operations: [...]}) of
 * {seq, op_id?, status: applied | rejected | failed, reason?, result_entity_id?}, joined to the
 * exported proposal by seq. An applied operation becomes the walk decision its op implies:
 * delete -> delete; update -> rename when only the predicate changed, reverse when source and
 * destination swapped, retarget otherwise; create -> an `add` on the row it belongs to. A
 * rejected operation becomes keep; failed and undecided operations are skipped. Rows merge by
 * triple into the walk file, as sheet-import.py does, and apply-walk.ts applies them.
 */
import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { flagStr, parseFlags, readJsonl } from "../classify-eval/lib/io.js";
import { harnessDir } from "./lib/paths.js";
import { triple, type Operation, type Proposal, type WalkRow } from "./proposal-export.js";

interface Decision {
  seq: number;
  op_id?: string;
  status: "applied" | "rejected" | "failed" | "pending";
  reason?: string | null;
  result_entity_id?: string | null;
}

function replacementOf(o: Operation): string {
  const b = o.base as Record<string, string>;
  const f = o.fields as Record<string, string>;
  return `${f.source_spec_node_id ?? b.source_spec_node_id}.${f.predicate ?? b.predicate}.${f.destination_spec_node_id ?? b.destination_spec_node_id}`;
}

export function decisionFor(o: Operation, status: Decision["status"]): WalkRow["decision"] {
  if (status === "rejected") return "keep";
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
    console.error("Usage: bun proposal-import.ts --layer <id> (--decisions file | --simulate-walk) [--file proposal.json] [--out walk file] [--by who] [--dry-run]");
    process.exit(2);
  }
  const reflDir = path.join(harnessDir(), "data", "triage", "reflect", "clef");
  const file = flagStr(flags, "file") ?? path.join(reflDir, "proposals", `${layer}.json`);
  const out = flagStr(flags, "out") ?? path.join(reflDir, `walk-${layer}.jsonl`);
  const by = flagStr(flags, "by", "user") ?? "user";
  const dry = !!flags["dry-run"];
  const proposal = JSON.parse(readFileSync(file, "utf8")) as Proposal;
  if (proposal.format !== "dr-reflection-plan/1") throw new Error(`${file}: unknown format ${proposal.format}`);

  // decisions by seq: from Context Studio's export, or simulated from the walk decisions the export carried
  const decisions = new Map<number, Decision>();
  const decFile = flagStr(flags, "decisions");
  if (decFile) {
    const raw = JSON.parse(readFileSync(decFile, "utf8")) as Decision[] | { operations: Decision[] };
    for (const d of Array.isArray(raw) ? raw : raw.operations) decisions.set(d.seq, d);
  } else if (flags["simulate-walk"]) {
    for (const o of proposal.operations) if (o.dr.walk_decision) decisions.set(o.seq, { seq: o.seq, status: o.dr.walk_decision === "keep" ? "rejected" : "applied", reason: o.dr.walk_rationale ?? null });
  } else {
    console.error("give --decisions <file> (Context Studio's export) or --simulate-walk");
    process.exit(2);
  }

  const existing = new Map<string, WalkRow>(existsSync(out) ? readJsonl<WalkRow>(out).map((w) => [w.triple, w]) : []);
  let nextRow = Math.max(0, ...[...existing.values()].map((w) => w.row)) + 1;
  const rows = new Map<string, WalkRow>();
  let skipped = 0;
  const today = new Date().toISOString().slice(0, 10);
  const byPlanRow = new Map<number, Operation[]>();
  for (const o of proposal.operations) byPlanRow.set(o.dr.plan_row, [...(byPlanRow.get(o.dr.plan_row) ?? []), o]);
  for (const ops of byPlanRow.values()) {
    const planTriple = ops[0].dr.triple;
    const decided = ops.map((o) => ({ o, d: decisions.get(o.seq) })).filter((x): x is { o: Operation; d: Decision } => !!x.d && (x.d.status === "applied" || x.d.status === "rejected"));
    if (!decided.length) {
      skipped += ops.length;
      continue;
    }
    const primary = decided.find((x) => x.o.target_id === planTriple) ?? decided[0];
    const decision = decisionFor(primary.o, primary.d.status);
    const row: WalkRow = {
      row: existing.get(planTriple)?.row ?? nextRow++,
      triple: planTriple,
      kind: primary.o.dr.plan_kind,
      decision,
      replacement: decision === "keep" ? null : primary.o.op === "delete" ? (primary.o.dr.replacement[0] ?? null) : replacementOf(primary.o),
      rationale: primary.d.reason || primary.o.rationale,
      adjudicated_by: `${by} (${today}) via Context Studio proposal: ${proposal.title}`,
    };
    const alsoDelete = decided.filter((x) => x !== primary && x.o.op === "delete" && x.d.status === "applied").map((x) => x.o.target_id!);
    const add = decided.filter((x) => x.o.op === "create" && x.d.status === "applied").map((x) => String(x.o.fields.relationship_id));
    if (alsoDelete.length) row.also_delete = alsoDelete;
    if (add.length) row.add = add;
    rows.set(planTriple, row);
  }
  const merged = new Map(existing);
  for (const [t, r] of rows) merged.set(t, r);
  const lines = [...merged.values()].sort((a, b) => a.row - b.row);
  if (!dry) writeFileSync(out, lines.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`${dry ? "[dry run] " : ""}${layer}: ${rows.size} decided rows imported (${[...rows.values()].filter((r) => !existing.has(r.triple)).length} new), ${skipped} undecided operations skipped -> ${lines.length} rows in ${path.relative(process.cwd(), out)}`);
}

if (import.meta.main) main();
