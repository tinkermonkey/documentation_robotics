/**
 * Turn a layer rules pass into a Context Studio proposal, instead of applying it in DR.
 *
 *   bun rules-proposal.ts --actions <dry-run.json> --layer ux --title "..." --rationale "..." [--out file]
 *
 * A rules pass is planned as change-record actions, in the shape of the applied-*-principles.json
 * records (`{basis?, actions: [{action: rename | delete | create | retire-predicate, kind, from,
 * to, note}]}`), and since 2026-11-06 it goes to Context Studio for review rather than being
 * applied here. This writes those actions as a `dr-reflection-plan/1` proposal (the contract in
 * proposal-export.ts), which Context Studio imports; once decided, its `cs-dr-spec-changes/1`
 * export lands with cs-decisions-to-spec.ts.
 *
 * - every operation's `kind` is "property", the entity kind Context Studio reads. The action's own
 *   kind (principles, reverse, ...) is the plan kind: it goes in dr.plan_kind and the rationale,
 *   never in `kind` (context-studio#1440: the ux pass put it there and the import refused it)
 * - rename -> update with the changed fields (or a delete naming the twin, when the new triple
 *   already exists; see normalize in proposal-export.ts); delete -> delete with its `to` as the
 *   structured replacement; create -> create
 * - retire-predicate actions go in the top-level `predicate_retirements` ({from, to, note}),
 *   which Context Studio keeps on the proposal and sends back as `retire-predicate` records once
 *   every relationship type using the predicate is gone
 */
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { flagStr, parseFlags } from "../classify-eval/lib/io.js";
import { loadRelationshipSchemas, type RelationshipSchema } from "./lib/schemas.js";
import { changedFields, currentFields, draftedOn, normalize, triple, type Operation, type Proposal } from "./proposal-export.js";
import { harnessDir } from "./lib/paths.js";
import type { SpecRevision } from "./lib/revision.js";

export interface RulesAction {
  action: "rename" | "delete" | "create" | "retire-predicate";
  /** the plan kind: principles, reverse, ... */
  kind?: string;
  from: string;
  to: string | null;
  note: string;
}

export interface RulesProposalMeta {
  layer: string;
  title: string;
  rationale: string;
  source_detail: string;
  created_at?: string;
  source_revision?: SpecRevision;
}

/** The proposal a rules pass's actions make; actions are checked against the live catalog. */
export function rulesProposal(actions: RulesAction[], catalog: Map<string, RelationshipSchema>, meta: RulesProposalMeta): Proposal {
  const problems: string[] = [];
  const retirements: NonNullable<Proposal["predicate_retirements"]> = [];
  const raw: Operation[] = [];
  actions.forEach((a, i) => {
    const row = i + 1;
    if (a.action === "retire-predicate") {
      if (!a.to) problems.push(`action ${row}: retiring '${a.from}' needs the predicate it retires into`);
      else retirements.push({ from: a.from, to: a.to, note: a.note });
      return;
    }
    const planKind = a.kind ?? "principles";
    const dr = { plan_row: row, plan_kind: planKind, triple: a.from, replacement: a.to && a.to !== a.from ? [a.to] : [], claims: [] as string[] };
    const rationale = `${a.note} (DR ${meta.layer} rules pass, plan kind ${planKind})`;
    const common = { kind: "property" as const, evidence: [], probability: 1, scope: null, status: "pending" as const, dr };
    if (a.action === "create") {
      if (catalog.has(a.from)) problems.push(`action ${row}: create ${a.from}, which is already in the spec`);
      const t = triple(a.from);
      raw.push({ seq: row, op: "create", target_id: null, ref: "c", fields: { relationship_id: a.from, predicate: t.predicate, source_spec_node_id: t.source, destination_spec_node_id: t.destination, title: `${t.source} ${t.predicate} ${t.destination}` }, replacement: null, base: {}, rationale, ...common });
      return;
    }
    if (!catalog.has(a.from)) problems.push(`action ${row}: ${a.action} ${a.from}, which is not in the spec`);
    const base = currentFields(a.from, catalog);
    if (a.action === "delete") {
      raw.push({ seq: row, op: "delete", target_id: a.from, ref: null, fields: {}, replacement: a.to && a.to !== a.from ? a.to : null, base, rationale, ...common });
    } else if (a.action === "rename") {
      if (!a.to) problems.push(`action ${row}: rename ${a.from} needs a to`);
      else raw.push({ seq: row, op: "update", target_id: a.from, ref: null, fields: changedFields(base, a.to), replacement: null, base, rationale, ...common });
    } else {
      problems.push(`action ${row}: '${(a as RulesAction).action}' is not rename, delete, create or retire-predicate`);
    }
  });
  if (problems.length) throw new Error(`no proposal written:\n  ${problems.join("\n  ")}`);
  const operations = normalize(raw, catalog);
  const proposal: Proposal = {
    format: "dr-reflection-plan/1",
    taxonomy_id: "dr_spec",
    title: meta.title,
    rationale: meta.rationale,
    source: "pipeline",
    source_detail: meta.source_detail,
    created_at: meta.created_at ?? new Date().toISOString(),
    layer: meta.layer,
    ...(meta.source_revision ? { source_revision: meta.source_revision } : {}),
    operations,
  };
  if (retirements.length) proposal.predicate_retirements = retirements;
  return proposal;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const actionsFile = flagStr(flags, "actions");
  const layer = flagStr(flags, "layer");
  const title = flagStr(flags, "title");
  if (!actionsFile || !layer || !title) {
    console.error('Usage: bun rules-proposal.ts --actions <dry-run.json> --layer <id> --title "..." [--rationale "..."] [--out file]');
    process.exit(2);
  }
  const input = JSON.parse(readFileSync(actionsFile, "utf8")) as { basis?: string; actions: RulesAction[] };
  const catalog = new Map(loadRelationshipSchemas().map((r) => [r.id, r]));
  const proposal = rulesProposal(input.actions, catalog, {
    layer,
    title,
    rationale: flagStr(flags, "rationale") ?? input.basis ?? `The ${layer} layer's modelling rules, as relationship changes.`,
    source_revision: draftedOn(path.resolve(harnessDir(), "..", "..", "..")),
    source_detail: `documentation_robotics ${layer} rules pass (cli/scripts/spec-enrich/rules-proposal.ts from ${path.basename(actionsFile)})`,
  });
  const out = flagStr(flags, "out") ?? actionsFile.replace(/\.json$/, "") + ".proposal.json";
  writeFileSync(out, JSON.stringify(proposal, null, 2) + "\n");
  const counts = proposal.operations.reduce((m, o) => ({ ...m, [o.op]: (m[o.op] ?? 0) + 1 }), {} as Record<string, number>);
  console.log(`wrote ${out}: ${proposal.operations.length} operations (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")})${proposal.predicate_retirements ? `, retiring ${proposal.predicate_retirements.map((r) => `${r.from} -> ${r.to}`).join(", ")}` : ""}`);
}

if (import.meta.main) main();
