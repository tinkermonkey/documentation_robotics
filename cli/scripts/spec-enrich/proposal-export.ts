/**
 * Export a layer's reflection-plan rows as a Context Studio change proposal.
 *
 *   bun proposal-export.ts --layer api [--out data/triage/reflect/clef/proposals/api.json]
 *
 * Context Studio imports the DR spec as one property definition per relationship schema
 * (`local-server/scripts/dr_ontology_loader.py`), keyed back to DR by the full relationship id
 * `{source}.{predicate}.{destination}` as an external reference. Its ChangeProposal
 * (`local-server/domain/versioning/proposals.py`) holds operations of create | update | delete on
 * one entity each, with rationale, evidence and probability; scope is computed by Context
 * Studio. This writes one operation per plan row in that shape so Context Studio's importer
 * (tinkermonkey/context-studio#1366) has a real fixture and its review queue can replace the
 * spreadsheet. `proposal-import.ts` reads the decisions back into walk-<layer>.jsonl.
 *
 * Contract (format dr-reflection-plan/1, agreed with the Context Studio side 2026-10-27):
 * - operation.seq is unique and is the join key for decisions coming back
 * - op is update or delete (create for added counterparts); never move
 * - kind is "property"; target_id is the full DR relationship id, resolved by the importer
 * - fields use DR vocabulary (predicate, source_spec_node_id, destination_spec_node_id, title,
 *   description), changed fields only, at least one for an update; the importer maps them onto
 *   canonical_predicate, domain_class_id, range_class_id and the identifier
 * - a row whose replacement already exists as a schema, or is produced by an earlier operation in
 *   the same file, is a delete naming the twin (no merge in Context Studio); checked against the
 *   live catalog at export time, not the plan's stale replacement_exists
 * - one operation per target: a target deleted by two rows keeps one delete (the one carrying the
 *   walk decision), with the other row's evidence merged and its number in dr.merged_plan_rows
 * - an update whose predicate, source or destination changes also carries the new description
 *   (boilerplate regenerated for the new triple; an enriched description carried as it stands,
 *   except on a reversal, where it is reset to boilerplate)
 * - a reversal flips the type's domain and range only; model relationships are re-pointed by
 *   DR's migration (dr upgrade) and a re-import of the model, never by Context Studio
 * - status is always pending; probability is 0..1 or null; scope is null (Context Studio decides)
 * - base is DR's view and is ignored by the importer (kept for DR's own staleness check)
 * - evidence entries carry claim_id, not entity_id; `dr` is DR bookkeeping the importer ignores
 * - a create's ref is short ("c<seq>"); the new relationship id is in fields.relationship_id
 * - rows already decided in walk-<layer>.jsonl are exported pending like the rest, with the
 *   decision in dr.walk_decision only, so `proposal-import.ts --simulate-walk` can check a round trip
 */
import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { flagStr, parseFlags, readJsonl } from "../classify-eval/lib/io.js";
import { loadRelationshipSchemas, type RelationshipSchema } from "./lib/schemas.js";
import { harnessDir } from "./lib/paths.js";
import type { PlannedChange } from "./reflect-plan.js";
import type { Reflection } from "./triage-reflect.js";
import type { Claim } from "./lib/triage-types.js";

export interface Operation {
  seq: number;
  op: "create" | "update" | "delete";
  kind: "property";
  target_id: string | null; // DR relationship id, resolved by its external reference
  ref: string | null; // creates only: a short handle; the new id is fields.relationship_id
  fields: Record<string, unknown>;
  base: Record<string, unknown>;
  rationale: string;
  evidence: Array<{ quote: string; claim_id?: string; url?: string }>;
  probability: number | null;
  scope: null;
  status: "pending";
  /** DR bookkeeping; Context Studio ignores it, proposal-import.ts uses it */
  dr: { plan_row: number; plan_kind: string; triple: string; replacement: string[]; claims: string[]; walk_decision?: WalkRow["decision"]; walk_rationale?: string; extra?: "also_delete" | "add"; merged_plan_rows?: number[] };
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

export const triple = (id: string) => {
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
    title: `${t.source} ${t.predicate} ${t.destination}`,
    description: r?.description ?? "",
  };
}

const BOILERPLATE = /^Defines relationship: /;

/**
 * Changed fields only, plus the title and description the new triple implies. The description
 * follows apply-reflect-plan.ts: boilerplate is regenerated for the new triple, and so is any text
 * when the direction flips; an enriched description is carried as it stands.
 */
function changedFields(base: Record<string, unknown>, to: string): Record<string, unknown> {
  const t = triple(to);
  const fields: Record<string, unknown> = {};
  if (t.predicate !== base.predicate) fields.predicate = t.predicate;
  if (t.source !== base.source_spec_node_id) fields.source_spec_node_id = t.source;
  if (t.destination !== base.destination_spec_node_id) fields.destination_spec_node_id = t.destination;
  if (Object.keys(fields).length) {
    fields.title = `${t.source} ${t.predicate} ${t.destination}`;
    const swapped = t.source === base.destination_spec_node_id && t.destination === base.source_spec_node_id;
    const current = typeof base.description === "string" ? base.description : "";
    fields.description = !current || BOILERPLATE.test(current) || swapped ? `Defines relationship: ${t.source} ${t.predicate} ${t.destination}` : current;
  }
  return fields;
}

/** The triple an update or create produces. */
export function producedTriple(o: Operation): string | null {
  if (o.op === "create") return String(o.fields.relationship_id);
  if (o.op !== "update") return null;
  const f = o.fields as Record<string, string>;
  const b = o.base as Record<string, string>;
  return `${f.source_spec_node_id ?? b.source_spec_node_id}.${f.predicate ?? b.predicate}.${f.destination_spec_node_id ?? b.destination_spec_node_id}`;
}

/**
 * Make the file importable by Context Studio: one operation per target (a target deleted twice,
 * by a plan row and by another row's also_delete, keeps the operation that carries the walk
 * decision, with the other row's evidence merged and its number in dr.merged_plan_rows), and no
 * update onto a triple that already exists in the catalog or that an earlier operation in the
 * file produces (that is a delete naming the twin, since Context Studio has no merge). Then
 * renumber seq and the create refs.
 */
export function normalize(operations: Operation[], catalog: Map<string, RelationshipSchema>): Operation[] {
  const byTarget = new Map<string, Operation>();
  const out: Operation[] = [];
  for (const o of operations) {
    if (o.op !== "delete") {
      out.push(o);
      continue;
    }
    const prior = byTarget.get(o.target_id!);
    if (!prior) {
      byTarget.set(o.target_id!, o);
      out.push(o);
      continue;
    }
    // keep the operation that carries a walk decision; merge the other into it
    const [keep, drop] = o.dr.walk_decision && !prior.dr.walk_decision ? [o, prior] : [prior, o];
    const seen = new Set(keep.evidence.map((e) => e.quote));
    keep.evidence.push(...drop.evidence.filter((e) => !seen.has(e.quote)));
    keep.rationale = `${keep.rationale} Also plan row ${drop.dr.plan_row} (${drop.dr.plan_kind}): ${drop.rationale}`;
    keep.dr = { ...keep.dr, merged_plan_rows: [...(keep.dr.merged_plan_rows ?? []), drop.dr.plan_row], claims: [...new Set([...keep.dr.claims, ...drop.dr.claims])] };
    if (keep === o) out[out.indexOf(prior)] = o;
    byTarget.set(o.target_id!, keep);
  }
  const produced = new Set<string>();
  const result = out.map((o) => {
    const t = producedTriple(o);
    if (!t) return o;
    if (o.op === "update" && (catalog.has(t) || produced.has(t))) {
      const twin = catalog.has(t) ? `${t} already exists` : `${t} is produced by an earlier operation in this proposal`;
      return { ...o, op: "delete" as const, fields: {}, rationale: `Remove ${o.target_id}: ${twin} and expresses it. ${o.rationale}`, dr: { ...o.dr, replacement: [t, ...o.dr.replacement.filter((r) => r !== t)] } };
    }
    produced.add(t);
    return o;
  });
  result.forEach((o, i) => {
    o.seq = i + 1;
    if (o.op === "create") o.ref = `c${o.seq}`;
  });
  return result;
}

/** The operation a plan row implies, before anyone decides on it. */
export function operationFor(row: PlannedChange, seq: number, catalog: Map<string, RelationshipSchema>, refl: Reflection[], claims: Map<string, Claim>): Operation {
  const base = currentFields(row.triple, catalog);
  const evidence: Operation["evidence"] = [];
  for (const cid of row.claims) {
    const c = claims.get(cid);
    if (c) evidence.push({ quote: `${c.text} Proposed: ${c.proposed_change}`, claim_id: cid });
  }
  for (const r of refl) {
    const a = r.answers;
    evidence.push({ quote: `Sorting answers (${r.claim_id}): best source of '${base.predicate} ${base.destination_spec_node_id}': ${a.source_for.top3}; best destination of '${base.source_spec_node_id} ${base.predicate}': ${a.target_for.top3}; best predicate: ${a.predicate_for.top3}. Outcome: ${r.outcome}${r.alternatives.length ? ` (${r.alternatives.join("; ")})` : ""}.`, claim_id: r.claim_id });
  }
  const dr = { plan_row: seq, plan_kind: row.kind, triple: row.triple, replacement: row.replacement, claims: row.claims };
  const common = { kind: "property" as const, base, evidence, probability: Math.round(row.p * 1000) / 1000, scope: null, status: "pending" as const, dr };
  const rep = row.replacement[0];
  const why = (what: string) => `${what} Plan kind ${row.kind}, p ${row.p.toFixed(2)}; claims ${row.claims.join(", ")}.`;
  // row.replacement_exists was computed when the plan was written; the catalog has changed since,
  // so check it live (normalize() also catches a twin that an earlier operation produces)
  if (row.kind === "remove-duplicate" || catalog.has(rep)) {
    return { seq, op: "delete", target_id: row.triple, ref: null, fields: {}, rationale: why(`Remove ${row.triple}: ${rep} already exists and expresses it.`), ...common };
  }
  const fields = changedFields(base, rep);
  if (!Object.keys(fields).length) {
    return { seq, op: "delete", target_id: row.triple, ref: null, fields: {}, rationale: why(`Remove ${row.triple}: the replacement is the same triple.`), ...common };
  }
  const label = { "rename-predicate": "Rename the predicate", reverse: "Reverse the direction", retarget: "Retarget", compound: "Change", conflict: "Change" }[row.kind] ?? "Change";
  const conflict = row.kind === "conflict" ? ` Claims disagree on the replacement (${row.replacement.join(" | ")}); the first is proposed, the others are in dr.replacement for a re-proposal if this one is rejected.` : "";
  return { seq, op: "update", target_id: row.triple, ref: null, fields, rationale: why(`${label} of ${row.triple} to ${rep}.${conflict}`), ...common };
}

/**
 * The operations a decided walk row implies, all pending with the decision in dr.walk_decision:
 * a delete (plus its also_delete twins), an update for rename / reverse / retarget, a create for
 * each added counterpart, and the plan's own operation for a keep (which a reviewer rejects).
 */
export function operationsFromDecision(w: WalkRow, planOp: Operation, catalog: Map<string, RelationshipSchema>): Operation[] {
  // dr.triple stays the plan row's own triple on every operation of the row (the importer groups
  // by plan_row and finds the row's primary operation by it); an extra names its role in dr.extra
  const mark = (o: Operation, extra?: "also_delete" | "add"): Operation => ({ ...o, dr: { ...o.dr, ...(extra ? { extra } : {}), walk_decision: w.decision, walk_rationale: w.rationale } });
  if (w.decision === "keep") return [mark(planOp)];
  const out: Operation[] = [];
  const common = { kind: "property" as const, evidence: planOp.evidence, probability: planOp.probability, scope: null, status: "pending" as const, dr: planOp.dr };
  if (w.decision === "delete") {
    const dr = { ...planOp.dr, replacement: w.replacement ? [w.replacement] : planOp.dr.replacement };
    out.push(mark({ seq: 0, op: "delete", target_id: w.triple, ref: null, fields: {}, base: planOp.base, rationale: w.rationale, ...common, dr }));
  } else {
    const dr = { ...planOp.dr, replacement: [w.replacement!, ...planOp.dr.replacement.filter((r) => r !== w.replacement)] };
    out.push(mark({ seq: 0, op: "update", target_id: w.triple, ref: null, fields: changedFields(planOp.base, w.replacement!), base: planOp.base, rationale: w.rationale, ...common, dr }));
  }
  for (const extra of w.also_delete ?? []) {
    out.push(mark({ seq: 0, op: "delete", target_id: extra, ref: null, fields: {}, base: currentFields(extra, catalog), rationale: `Also removed with ${w.triple}: ${w.rationale}`, ...common }, "also_delete"));
  }
  for (const extra of w.add ?? []) {
    const t = triple(extra);
    out.push(mark({ seq: 0, op: "create", target_id: null, ref: "c", fields: { relationship_id: extra, predicate: t.predicate, source_spec_node_id: t.source, destination_spec_node_id: t.destination, title: `${t.source} ${t.predicate} ${t.destination}` }, base: {}, rationale: `Added as counterpart of ${w.replacement}: ${w.rationale}`, ...common }, "add"));
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
  const raw: Operation[] = [];
  plan.forEach((row, i) => {
    const planOp = operationFor(row, i + 1, catalog, refl.get(row.triple) ?? [], claims);
    const w = walk.get(row.triple);
    raw.push(...(w ? operationsFromDecision(w, planOp, catalog) : [planOp]));
  });
  const operations = normalize(raw, catalog);
  const proposal: Proposal = {
    format: "dr-reflection-plan/1",
    taxonomy_id: "dr_spec",
    title: `DR reflection plan: ${layer} layer (${operations.length} relationship changes)`,
    rationale: `Relationship schemas in the ${layer} layer that the maintainer-note triage and the sorting-question reflection (cli/scripts/spec-enrich) want removed, renamed, reversed or retargeted. Each operation carries the claims and Clef's sorting answers as evidence and the plan's probability. Accepting an operation means DR applies it with apply-walk.ts; rejecting means the schema stays.`,
    source: "pipeline",
    source_detail: `documentation_robotics cli/scripts/spec-enrich/proposal-export.ts, plan-clef.json`,
    created_at: new Date().toISOString(),
    layer,
    operations,
  };
  const outDir = path.join(reflDir, "proposals");
  mkdirSync(outDir, { recursive: true });
  const out = flagStr(flags, "out") ?? path.join(outDir, `${layer}.json`);
  writeFileSync(out, JSON.stringify(proposal, null, 2) + "\n");
  const counts = operations.reduce((m, o) => ({ ...m, [o.op]: (m[o.op] ?? 0) + 1 }), {} as Record<string, number>);
  console.log(`wrote ${path.relative(process.cwd(), out)}: ${operations.length} operations (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}), ${operations.filter((o) => o.dr.walk_decision).length} carrying a walk decision`);
}

if (import.meta.main) main();
