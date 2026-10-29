/**
 * Catalog additions as Context Studio create proposals, and back.
 *
 *   bun catalog-additions.ts                                   # check data/catalog-additions-cbm.json, write the proposals
 *   bun catalog-additions.ts --apply --layer application --decisions decisions.json [--dry-run]
 *
 * The additions file lists new relationship types with a description and evidence lines. The
 * export checks each against the live catalog (types and predicate exist, the triple is new, and
 * no relationship between the pair already uses the same predicate in either direction) and writes
 * one dr-reflection-plan/1 proposal per source layer to
 * data/triage/reflect/clef/proposals/cbm-additions-<layer>.json: one create operation each, with the
 * description, the evidence lines and the CBM edges it serves as evidence.
 *
 * --apply reads Context Studio's decision export for one of those files (the same shape
 * proposal-import.ts reads) and writes a relationship schema for every applied create, using the
 * reviewer's edited triple when the decision carries fields (accept-with-edit; an edited triple
 * gets a boilerplate description, since the proposed text described the original one). Rejected
 * and undecided operations write nothing. Additions are additive, so no model migration follows;
 * rebuild the spec afterwards (npm run build:spec, then cd cli && npm run build).
 */
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { flagStr, parseFlags } from "../classify-eval/lib/io.js";
import { harnessDir } from "./lib/paths.js";
import { loadNodeSchemas, loadPredicates, loadRelationshipSchemas, specDir } from "./lib/schemas.js";
import { triple, type Operation, type Proposal } from "./proposal-export.js";
import { appliedTriple, invalidEdit, type Decision } from "./proposal-import.js";

interface Addition {
  id: string;
  inventory_addition: number;
  cbm_edges: string[];
  observed: string;
  description: string;
  evidence: string[];
  /** set when the reverse triple with the same predicate exists: why the two are different meanings */
  reverse_differs?: string;
}

interface AdditionsFile {
  title: string;
  rationale: string;
  additions: Addition[];
}

const ADDITIONS = () => path.join(harnessDir(), "data", "catalog-additions-cbm.json");
const PROPOSALS = () => path.join(harnessDir(), "data", "triage", "reflect", "clef", "proposals");

/** Why an addition cannot go into the catalog, or null when it can. */
export function additionProblem(id: string, catalog: Set<string>, nodeIds: Set<string>, predicates: Set<string>, reverseDiffers?: string): string | null {
  const bad = invalidEdit(id, nodeIds, predicates);
  if (bad) return bad;
  if (catalog.has(id)) return "already in the catalog";
  const t = triple(id);
  if (!reverseDiffers && catalog.has(`${t.destination}.${t.predicate}.${t.source}`)) {
    return `the reverse ${t.destination} ${t.predicate} ${t.source} already exists (give reverse_differs if the two are different meanings)`;
  }
  return null;
}

export function schemaFor(id: string, description: string, evidence: string[]): Record<string, unknown> {
  const t = triple(id);
  const local = (s: string) => s.split(".")[1];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: `${cap(local(t.source))} ${t.predicate} ${cap(local(t.destination))}`,
    description,
    ...(evidence.length ? { "x-dr-evidence": evidence } : {}),
    allOf: [{ $ref: "../../base/spec-node-relationship.schema.json" }],
    properties: {
      id: { const: id },
      source_spec_node_id: { const: t.source },
      source_layer: { const: t.source.split(".")[0] },
      destination_spec_node_id: { const: t.destination },
      destination_layer: { const: t.destination.split(".")[0] },
      predicate: { const: t.predicate },
      cardinality: { const: "many-to-many" },
      strength: { const: "medium" },
    },
  };
}

export function schemaFile(id: string): string {
  const t = triple(id);
  const local = (s: string) => s.split(".")[1];
  return path.join(specDir(), "schemas", "relationships", t.source.split(".")[0], `${local(t.source)}.${t.predicate}.${local(t.destination)}.relationship.schema.json`);
}

function exportProposals(file: AdditionsFile): void {
  const catalog = new Set(loadRelationshipSchemas().map((r) => r.id));
  const nodeIds = new Set(loadNodeSchemas().map((n) => n.specNodeId));
  const predicates = new Set(Object.keys(loadPredicates()));
  const problems = file.additions.map((a) => [a.id, additionProblem(a.id, catalog, nodeIds, predicates, a.reverse_differs)] as const).filter(([, p]) => p);
  if (problems.length) {
    console.error("not written; these additions cannot go into the catalog:");
    for (const [id, p] of problems) console.error(`  ${id}: ${p}`);
    process.exit(1);
  }
  const byLayer = new Map<string, Addition[]>();
  for (const a of file.additions) {
    const layer = a.id.split(".")[0];
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), a]);
  }
  mkdirSync(PROPOSALS(), { recursive: true });
  for (const [layer, additions] of byLayer) {
    const operations: Operation[] = additions.map((a, i) => {
      const t = triple(a.id);
      return {
        seq: i + 1,
        op: "create",
        kind: "property",
        target_id: null,
        ref: `c${i + 1}`,
        fields: {
          relationship_id: a.id,
          predicate: t.predicate,
          source_spec_node_id: t.source,
          destination_spec_node_id: t.destination,
          title: `${t.source} ${t.predicate} ${t.destination}`,
          description: a.description,
        },
        base: {},
        rationale: `${a.description} Needed to map the CBM edge${a.cbm_edges.length > 1 ? "s" : ""} ${a.cbm_edges.join(", ")} (inventory addition ${a.inventory_addition}).`,
        evidence: [
          ...a.evidence.map((quote) => ({ quote })),
          { quote: `Observed in the eval corpora: ${a.observed}.` },
          ...(a.reverse_differs ? [{ quote: `The reverse triple exists with a different meaning: ${a.reverse_differs}` }] : []),
        ],
        probability: null,
        scope: null,
        status: "pending",
        dr: { plan_row: i + 1, plan_kind: "catalog-addition", triple: a.id, replacement: [], claims: [], extra: "add" },
      };
    });
    const proposal: Proposal = {
      format: "dr-reflection-plan/1",
      taxonomy_id: "dr_spec",
      title: `DR catalog additions for codebase-memory-mcp edges: ${layer} layer (${operations.length} new relationship types)`,
      rationale: file.rationale,
      source: "pipeline",
      source_detail: "documentation_robotics cli/scripts/spec-enrich/catalog-additions.ts, data/catalog-additions-cbm.json",
      created_at: new Date().toISOString(),
      layer,
      operations,
    };
    const out = path.join(PROPOSALS(), `cbm-additions-${layer}.json`);
    writeFileSync(out, JSON.stringify(proposal, null, 2) + "\n");
    console.log(`wrote ${path.relative(process.cwd(), out)}: ${operations.length} create operations`);
  }
}

function apply(file: AdditionsFile, layer: string, decisionsFile: string, dry: boolean): void {
  const proposal = JSON.parse(readFileSync(path.join(PROPOSALS(), `cbm-additions-${layer}.json`), "utf8")) as Proposal;
  const raw = JSON.parse(readFileSync(decisionsFile, "utf8")) as Decision[] | { operations: Decision[] };
  const decisions = new Map((Array.isArray(raw) ? raw : raw.operations).map((d) => [d.seq, d]));
  const byId = new Map(file.additions.map((a) => [a.id, a]));
  const catalog = new Set(loadRelationshipSchemas().map((r) => r.id));
  const nodeIds = new Set(loadNodeSchemas().map((n) => n.specNodeId));
  const predicates = new Set(Object.keys(loadPredicates()));
  const writes: Array<{ id: string; file: string; schema: Record<string, unknown> }> = [];
  const errors: string[] = [];
  let rejected = 0;
  let undecided = 0;
  for (const o of proposal.operations) {
    const d = decisions.get(o.seq);
    if (!d || d.status === "pending" || d.status === "failed") {
      undecided++;
      continue;
    }
    if (d.status === "rejected") {
      rejected++;
      continue;
    }
    const proposed = String(o.fields.relationship_id);
    const id = d.fields ? appliedTriple(o, d) : proposed;
    const problem = additionProblem(id, catalog, nodeIds, predicates, id === proposed ? byId.get(proposed)?.reverse_differs : undefined);
    if (problem) {
      errors.push(`seq ${o.seq} ${id}: ${problem}`);
      continue;
    }
    const a = byId.get(proposed);
    const edited = id !== proposed;
    const description = edited || !a ? `Defines relationship: ${triple(id).source} ${triple(id).predicate} ${triple(id).destination}` : a.description;
    writes.push({ id, file: schemaFile(id), schema: schemaFor(id, description, edited || !a ? [] : a.evidence) });
  }
  if (errors.length) {
    console.error("nothing written; these accepted additions cannot go into the catalog:");
    for (const e of errors) console.error("  " + e);
    process.exit(1);
  }
  for (const w of writes) {
    if (existsSync(w.file)) throw new Error(`${w.file} exists`);
    if (!dry) writeFileSync(w.file, JSON.stringify(w.schema, null, 2) + "\n");
    console.log(`${dry ? "[dry run] would write" : "wrote"} ${path.relative(process.cwd(), w.file)}`);
  }
  console.log(`${layer}: ${writes.length} added, ${rejected} rejected, ${undecided} undecided or failed. Rebuild the spec next.`);
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const file = JSON.parse(readFileSync(ADDITIONS(), "utf8")) as AdditionsFile;
  if (flags.apply) {
    const layer = flagStr(flags, "layer");
    const decisions = flagStr(flags, "decisions");
    if (!layer || !decisions) {
      console.error("Usage: bun catalog-additions.ts --apply --layer <source layer> --decisions <file> [--dry-run]");
      process.exit(2);
    }
    apply(file, layer, decisions, !!flags["dry-run"]);
  } else exportProposals(file);
}

if (import.meta.main) main();
