/**
 * Import Context Studio's decisions on a proposal back into walk-<layer>.jsonl.
 *
 *   bun proposal-import.ts --layer api --decisions decisions.json [--file proposals/api.json] [--out walk file] [--by who] [--dry-run]
 *   bun proposal-import.ts --layer api --simulate-walk        # round-trip check from dr.walk_decision
 *
 * `--decisions` is Context Studio's decision export: an array (or {operations: [...]}) of
 * {seq, op_id?, status: applied | rejected | failed, fields?, reason?, result_entity_id?}, joined
 * to the exported proposal by seq. An applied operation becomes the walk decision its op implies:
 * delete -> delete; update -> rename when only the predicate changed, reverse when source and
 * destination swapped, retarget otherwise; create -> an `add` on the row it belongs to. A
 * rejected operation becomes keep. Rows merge by triple into the walk file, as sheet-import.py
 * does, and apply-walk.ts applies them.
 *
 * Accept-with-edit (agreed with the Context Studio side 2026-10-28): when a decision carries
 * `fields` {predicate?, source_spec_node_id?, destination_spec_node_id?} the reviewer changed the
 * operation before applying it, and the walk decision is derived from those fields (the full
 * replacement triple; a part left out falls back to the proposal), not from the proposal: an
 * edited update is the rename / reverse / retarget the reviewer chose, an edited delete becomes an
 * update. Edited triples are validated against the catalog vocabulary (node types and predicate)
 * before anything is written. Failed operations (e.g. a delete refused because the property is in
 * use) are listed with their reason as needing a DR-side decision; undecided ones are skipped.
 */
import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { flagStr, parseFlags, readJsonl } from "../classify-eval/lib/io.js";
import { harnessDir } from "./lib/paths.js";
import { loadNodeSchemas, loadPredicates } from "./lib/schemas.js";
import { triple, type Operation, type Proposal, type WalkRow } from "./proposal-export.js";

export interface DecisionFields {
  predicate?: string;
  source_spec_node_id?: string;
  destination_spec_node_id?: string;
}

export interface Decision {
  seq: number;
  op_id?: string;
  status: "applied" | "rejected" | "failed" | "pending";
  /** present when the reviewer edited the operation before applying it (accept-with-edit) */
  fields?: DecisionFields | null;
  reason?: string | null;
  result_entity_id?: string | null;
}

/** The triple an applied operation leaves behind: the reviewer's edit when there is one, else the proposal's. */
export function appliedTriple(o: Operation, d?: Decision): string {
  const b = o.base as Record<string, string>;
  const f = o.fields as Record<string, string>;
  const e = d?.fields ?? {};
  const src = e.source_spec_node_id ?? f.source_spec_node_id ?? b.source_spec_node_id;
  const pred = e.predicate ?? f.predicate ?? b.predicate;
  const dst = e.destination_spec_node_id ?? f.destination_spec_node_id ?? b.destination_spec_node_id;
  return `${src}.${pred}.${dst}`;
}

export function decisionFor(o: Operation, d: Decision): WalkRow["decision"] {
  if (d.status === "rejected") return "keep";
  if (o.op === "delete" && !d.fields) return "delete";
  const b = o.base as Record<string, string>;
  const r = triple(appliedTriple(o, d));
  if (r.source === b.source_spec_node_id && r.predicate === b.predicate && r.destination === b.destination_spec_node_id) return "keep";
  if (r.source === b.destination_spec_node_id && r.destination === b.source_spec_node_id) return "reverse";
  if (r.source === b.source_spec_node_id && r.destination === b.destination_spec_node_id) return "rename";
  return "retarget";
}

/** Why an edited triple is not one the catalog could hold, or null when it is. */
export function invalidEdit(t: string, nodeIds: Set<string>, predicates: Set<string>): string | null {
  const p = t.split(".");
  if (p.length !== 5) return `'${t}' is not a 5-part triple`;
  const { source, predicate, destination } = triple(t);
  if (!nodeIds.has(source)) return `source type '${source}' is not a DR node type`;
  if (!predicates.has(predicate)) return `predicate '${predicate}' is not in predicates.json`;
  if (!nodeIds.has(destination)) return `destination type '${destination}' is not a DR node type`;
  return null;
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

  // validate every edit before writing anything
  const nodeIds = new Set(loadNodeSchemas().map((n) => n.specNodeId));
  const predicates = new Set(Object.keys(loadPredicates()));
  const bySeq = new Map(proposal.operations.map((o) => [o.seq, o]));
  const errors: string[] = [];
  const failed: string[] = [];
  for (const d of decisions.values()) {
    const o = bySeq.get(d.seq);
    if (!o) {
      errors.push(`seq ${d.seq}: no such operation in ${path.basename(file)}`);
      continue;
    }
    if (d.status === "failed") failed.push(`seq ${d.seq} ${o.op} ${o.target_id ?? o.fields.relationship_id}: ${d.reason ?? "no reason given"}`);
    if (d.status === "applied" && d.fields) {
      const why = invalidEdit(appliedTriple(o, d), nodeIds, predicates);
      if (why) errors.push(`seq ${d.seq} (edited): ${why}`);
    }
  }
  if (errors.length) {
    console.error("not written; these decisions cannot be applied to the DR catalog:");
    for (const e of errors) console.error("  " + e);
    process.exit(1);
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
    const decision = decisionFor(primary.o, primary.d);
    const edited = !!primary.d.fields;
    const row: WalkRow = {
      row: existing.get(planTriple)?.row ?? nextRow++,
      triple: planTriple,
      kind: primary.o.dr.plan_kind,
      decision,
      replacement: decision === "keep" ? null : decision === "delete" ? (primary.o.dr.replacement[0] ?? null) : appliedTriple(primary.o, primary.d),
      rationale: (primary.d.reason || primary.o.rationale) + (edited ? " (edited by the reviewer before applying)" : ""),
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
  const nEdited = [...rows.values()].filter((r) => r.rationale.endsWith("(edited by the reviewer before applying)")).length;
  console.log(`${dry ? "[dry run] " : ""}${layer}: ${rows.size} decided rows imported (${[...rows.values()].filter((r) => !existing.has(r.triple)).length} new, ${nEdited} edited), ${skipped} undecided operations skipped -> ${lines.length} rows in ${path.relative(process.cwd(), out)}`);
  if (failed.length) {
    console.log(`${failed.length} failed in Context Studio; these rows still need a DR-side decision (sheet or walk file):`);
    for (const f of failed) console.log("  " + f);
  }
}

if (import.meta.main) main();
