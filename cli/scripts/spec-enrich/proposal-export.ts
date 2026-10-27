/**
 * Export a layer's reflection-plan rows as a Context Studio change proposal.
 *
 *   bun proposal-export.ts --layer api [--out data/triage/reflect/clef/proposals/api.json]
 *
 * Context Studio imports the DR spec as one property definition per relationship schema
 * (`local-server/scripts/dr_ontology_loader.py`), keyed back to DR by the full relationship id
 * `{source}.{predicate}.{destination}` as an external reference. Its ChangeProposal
 * (`local-server/domain/versioning/proposals.py`) holds operations of create | update | move |
 * delete on one entity each, with rationale, evidence, probability and a scope the system
 * computes. This writes one operation per plan row in that shape, with the row's claims and
 * Clef's sorting answers as evidence and the plan's p as probability, so Context Studio's
 * importer (tinkermonkey/context-studio#1366) has a real fixture and the review queue can
 * replace the spreadsheet. `proposal-import.ts` reads the decided proposal back into
 * walk-<layer>.jsonl for apply-walk.ts.
 *
 * Field vocabulary (the importer maps it onto its own): `predicate`, `source_spec_node_id`,
 * `destination_spec_node_id`, `title`, `description`. `target_id` is the DR relationship id.
 */
import path from "node:path";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { flagStr, parseFlags, readJsonl } from "../classify-eval/lib/io.js";
import { loadRelationshipSchemas, type RelationshipSchema } from "./lib/schemas.js";
import { harnessDir } from "./lib/paths.js";
import type { PlannedChange } from "./reflect-plan.js";
import type { Reflection } from "./triage-reflect.js";
import type { Claim } from "./lib/triage-types.js";

export interface Operation {
  seq: number;
  op: "create" | "update" | "move" | "delete";
  kind: "property";
  target_id: string | null; // DR relationship id, resolved by its external reference
  ref: string | null; // for creates: the new relationship id
  fields: Record<string, unknown>;
  base: Record<string, unknown>;
  rationale: string;
  evidence: Array<{ quote: string; entity_id?: string; url?: string }>;
  probability: number | null;
  scope: "editorial" | "additive" | "breaking";
  status: "pending" | "applied" | "rejected" | "failed";
  reason: string | null;
  /** DR bookkeeping the importer hands back untouched */
  dr: { plan_row: number; plan_kind: string; triple: string; replacement: string[]; claims: string[]; walk_decision?: string };
}

export interface Proposal {
  format: "dr-reflection-plan/1";
  taxonomy_id: string;
  title: string;
  rationale: string;
  source: "pipeline";
  source_detail: string;
  created_at: string;
  layer: string;
  operations: Operation[];
}

const triple = (id: string) => {
  const p = id.split(".");
  return { source: `${p[0]}.${p[1]}`, predicate: p[2], destination: `${p[3]}.${p[4]}` };
};

function currentFields(id: string, catalog: Map<string, RelationshipSchema>): Record<string, unknown> {
  const r = catalog.get(id);
  const t = triple(id);
  return {
    predicate: t.predicate,
    source_spec_node_id: t.source,
    destination_spec_node_id: t.destination,
    title: r ? (r.raw.title as string) : `${t.source} ${t.predicate} ${t.destination}`,
    description: r?.description ?? "",
  };
}

/** The operation a plan row implies, before anyone decides on it. */
export function operationFor(row: PlannedChange, seq: number, catalog: Map<string, RelationshipSchema>, refl: Reflection[], claims: Map<string, Claim>): Operation[] {
  const base = currentFields(row.triple, catalog);
  const evidence: Operation["evidence"] = [];
  for (const cid of row.claims) {
    const c = claims.get(cid);
    if (c) evidence.push({ quote: `${c.text} Proposed: ${c.proposed_change}`, entity_id: cid });
  }
  for (const r of refl) {
    const a = r.answers;
    evidence.push({ quote: `Sorting answers (${r.claim_id}): best source of '${base.predicate} ${base.destination_spec_node_id}': ${a.source_for.top3}; best destination of '${base.source_spec_node_id} ${base.predicate}': ${a.target_for.top3}; best predicate: ${a.predicate_for.top3}. Outcome: ${r.outcome}${r.alternatives.length ? ` (${r.alternatives.join("; ")})` : ""}.`, entity_id: r.claim_id });
  }
  const dr = { plan_row: seq, plan_kind: row.kind, triple: row.triple, replacement: row.replacement, claims: row.claims };
  const common = { kind: "property" as const, base, evidence, probability: Math.round(row.p * 1000) / 1000, status: "pending" as const, reason: null, dr };
  const rep = row.replacement[0];
  const why = (what: string) => `${what} Plan kind ${row.kind}, p ${row.p.toFixed(2)}; claims ${row.claims.join(", ")}.`;
  if (row.kind === "remove-duplicate" || (row.kind === "reverse" && row.replacement_exists)) {
    return [{ seq, op: "delete", target_id: row.triple, ref: null, fields: {}, rationale: why(`Remove ${row.triple}: ${rep} already expresses it.`), scope: "breaking", ...common }];
  }
  if (row.kind === "conflict") {
    return [{ seq, op: "update", target_id: row.triple, ref: null, fields: { predicate: triple(rep).predicate, source_spec_node_id: triple(rep).source, destination_spec_node_id: triple(rep).destination }, rationale: why(`Claims disagree on the replacement (${row.replacement.join(" | ")}); the first is proposed, the others are in dr.replacement.`), scope: "breaking", ...common }];
  }
  // rename, reverse (no existing twin), retarget, compound: one update with the changed fields
  const t = triple(rep);
  const fields: Record<string, unknown> = {};
  if (t.predicate !== base.predicate) fields.predicate = t.predicate;
  if (t.source !== base.source_spec_node_id) fields.source_spec_node_id = t.source;
  if (t.destination !== base.destination_spec_node_id) fields.destination_spec_node_id = t.destination;
  fields.title = `${t.source} ${t.predicate} ${t.destination}`;
  const label = { "rename-predicate": "Rename the predicate", reverse: "Reverse the direction", retarget: "Retarget", compound: "Change" }[row.kind] ?? "Change";
  return [{ seq, op: "update", target_id: row.triple, ref: null, fields, rationale: why(`${label} of ${row.triple} to ${rep}.`), scope: "breaking", ...common }];
}

export interface WalkRow {
  row: number;
  triple: string;
  kind: string;
  decision: "keep" | "delete" | "rename" | "retarget" | "reverse";
  replacement: string | null;
  add?: string[];
  also_delete?: string[];
  rationale: string;
  adjudicated_by: string;
}

/**
 * The operations a decided walk row implies, so a decided row round-trips: a delete (plus its
 * also_delete twins), an update for rename / reverse / retarget, a create for each added
 * counterpart, and the plan's own operation marked rejected for a keep.
 */
export function operationsFromDecision(w: WalkRow, planOp: Operation, seq: number, catalog: Map<string, RelationshipSchema>): Operation[] {
  const stamp = (o: Operation, status: Operation["status"]) => ({ ...o, status, reason: w.rationale, dr: { ...o.dr, walk_decision: w.decision } });
  if (w.decision === "keep") return [stamp(planOp, "rejected")];
  const out: Operation[] = [];
  const common = { kind: "property" as const, evidence: planOp.evidence, probability: planOp.probability, dr: planOp.dr };
  if (w.decision === "delete") {
    // the edge that already covers the deleted one travels in dr.replacement so the import keeps it
    const dr = { ...planOp.dr, replacement: w.replacement ? [w.replacement] : planOp.dr.replacement };
    out.push(stamp({ seq, op: "delete", target_id: w.triple, ref: null, fields: {}, base: planOp.base, rationale: w.rationale, scope: "breaking", status: "pending", reason: null, ...common, dr }, "applied"));
  } else {
    const t = triple(w.replacement!);
    const fields: Record<string, unknown> = {};
    if (t.predicate !== planOp.base.predicate) fields.predicate = t.predicate;
    if (t.source !== planOp.base.source_spec_node_id) fields.source_spec_node_id = t.source;
    if (t.destination !== planOp.base.destination_spec_node_id) fields.destination_spec_node_id = t.destination;
    fields.title = `${t.source} ${t.predicate} ${t.destination}`;
    out.push(stamp({ seq, op: "update", target_id: w.triple, ref: null, fields, base: planOp.base, rationale: w.rationale, scope: "breaking", status: "pending", reason: null, ...common }, "applied"));
  }
  for (const extra of w.also_delete ?? []) {
    out.push(stamp({ seq, op: "delete", target_id: extra, ref: null, fields: {}, base: currentFields(extra, catalog), rationale: `Also removed with ${w.triple}: ${w.rationale}`, scope: "breaking", status: "pending", reason: null, ...common, dr: { ...planOp.dr, triple: extra } }, "applied"));
  }
  for (const extra of w.add ?? []) {
    const t = triple(extra);
    out.push(stamp({ seq, op: "create", target_id: null, ref: extra, fields: { predicate: t.predicate, source_spec_node_id: t.source, destination_spec_node_id: t.destination, title: `${t.source} ${t.predicate} ${t.destination}` }, base: {}, rationale: `Added as counterpart of ${w.replacement}: ${w.rationale}`, scope: "additive", status: "pending", reason: null, ...common, dr: { ...planOp.dr, triple: extra } }, "applied"));
  }
  return out;
}

export function readReflectionsFor(layer: string): Map<string, Reflection[]> {
  const out = new Map<string, Reflection[]>();
  const f = path.join(harnessDir(), "data", "triage", "reflect", "clef", `${layer}.jsonl`);
  for (const r of readJsonl<Reflection>(f)) out.set(r.triple, [...(out.get(r.triple) ?? []), r]);
  return out;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const layer = flagStr(flags, "layer");
  if (!layer) {
    console.error("Usage: bun proposal-export.ts --layer <id> [--out file]");
    process.exit(2);
  }
  const reflDir = path.join(harnessDir(), "data", "triage", "reflect", "clef");
  const plan = (JSON.parse(readFileSync(path.join(reflDir, "plan-clef.json"), "utf8")) as PlannedChange[]).filter((r) => r.layer === layer && r.current_exists);
  const order: Record<string, number> = { "remove-duplicate": 0, "rename-predicate": 1, reverse: 2, retarget: 3, compound: 4, conflict: 5 };
  plan.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || b.p - a.p);
  const catalog = new Map(loadRelationshipSchemas().map((r) => [r.id, r]));
  const claims = new Map(readJsonl<Claim>(path.join(harnessDir(), "data", "triage", "claims.jsonl")).map((c) => [c.id, c]));
  const refl = readReflectionsFor(layer);
  const walk = new Map(readJsonl<WalkRow>(path.join(reflDir, `walk-${layer}.jsonl`)).map((w) => [w.triple, w]));
  const operations: Operation[] = [];
  plan.forEach((row, i) => {
    const [planOp] = operationFor(row, i + 1, catalog, refl.get(row.triple) ?? [], claims);
    const w = walk.get(row.triple);
    // already decided in DR: emit the operations the decision implies, so a round trip reproduces it
    operations.push(...(w ? operationsFromDecision(w, planOp, i + 1, catalog) : [planOp]));
  });
  operations.forEach((o, i) => (o.seq = i + 1));
  const proposal: Proposal = {
    format: "dr-reflection-plan/1",
    taxonomy_id: "dr_spec",
    title: `DR reflection plan: ${layer} layer (${operations.length} relationship changes)`,
    rationale: `Relationship schemas in the ${layer} layer that the maintainer-note triage and the sorting-question reflection (cli/scripts/spec-enrich) want removed, renamed, reversed or retargeted. Each operation carries the claims and Clef's sorting answers as evidence and the plan's probability. Accepting an operation means DR applies it with apply-walk.ts; rejecting means the schema stays.`,
    source: "pipeline",
    source_detail: `documentation_robotics cli/scripts/spec-enrich/proposal-export.ts, plan-clef.json, branch feature/extraction-eval-harness`,
    created_at: new Date().toISOString(),
    layer,
    operations,
  };
  const outDir = path.join(reflDir, "proposals");
  mkdirSync(outDir, { recursive: true });
  const out = flagStr(flags, "out") ?? path.join(outDir, `${layer}.json`);
  writeFileSync(out, JSON.stringify(proposal, null, 2) + "\n");
  const counts = operations.reduce((m, o) => ({ ...m, [o.op]: (m[o.op] ?? 0) + 1 }), {} as Record<string, number>);
  console.log(`wrote ${path.relative(process.cwd(), out)}: ${operations.length} operations (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}), ${operations.filter((o) => o.status !== "pending").length} already decided`);
  void readdirSync;
}

if (import.meta.main) main();
