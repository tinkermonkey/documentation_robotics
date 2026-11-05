/**
 * Write Context Studio's decided relationship-type changes into the spec sources.
 *
 *   bun cs-decisions-to-spec.ts --changes <file> [--spec-dir <dir>] [--dry-run]
 *
 * `--changes` is Context Studio's `cs-dr-spec-changes/1` export of one decided change proposal
 * (`local-server/scripts/export_dr_spec_changes.py PROPOSAL_ID OUT.json`): every applied create,
 * update and delete of a relationship type, any proposal (MCP, the review UI, a reflection plan):
 *
 *   {format: "cs-dr-spec-changes/1", proposal_id, title, changes: [{
 *     seq, op_id, op: create | update | delete,
 *     relationship_id,               the triple after the change (a delete: the one removed)
 *     previous_relationship_id?,     an update whose triple changed
 *     identifier, predicate, source_spec_node_id, destination_spec_node_id,
 *     set: {description?, cardinality?, strength?, evidence?},   only what the decision changed
 *     replacement_relationship_id?   a delete whose model relationships moved to another type
 *   }], skipped: [...]}
 *
 * and applies it to spec/schemas/relationships (never spec/dist or cli/src/schemas/bundled; the
 * build regenerates those):
 *
 *   create   write a schema in the sibling files' shape: title "Source predicate Destination",
 *            `set` values, cardinality many-to-many and strength medium unless set, x-dr-evidence
 *            last when there is any
 *   update   same triple: change the `set` values in place (an empty evidence list removes
 *            x-dr-evidence). New triple: write the new schema derived from the old one, as
 *            apply-walk.ts does (a boilerplate description follows the triple; a reversal drops
 *            the old evidence), then the `set` values, and remove the old schema
 *   delete   remove the schema
 *
 * Every rename, create and delete is recorded in data/cs-decisions/applied-cs-<proposal>.json, in
 * apply-walk.ts's record shape, which generate-relationship-migration.ts reads for `dr upgrade`:
 * an update that keeps the source and destination pair (or reverses it) is a rename; one that
 * changes a type is a retarget, recorded as a delete with `to: null` plus a create; a delete
 * whose replacement links the same pair carries it as `to`, otherwise `to: null` (dropped).
 * Value-only updates need no migration and are not recorded as actions.
 *
 * Every change is checked (node types, predicate, files, attribute values) before anything is
 * written, so it never stops half-way; later changes build on earlier ones in the same export
 * (create then update, rename then update, two updates of one schema). The written JSON is
 * formatted with the repo's prettier, and the layer-skill lines citing a removed or renamed
 * triple are listed (not edited). Afterwards: npm run build:spec (repo root), cd cli && npm run
 * build, bun scripts/generate-relationship-migration.ts (and --check), npm run
 * check:skill-relationships.
 *
 * Same, reversed or different pair is lib/triples.ts's pairOf, the rule apply-walk.ts and
 * Context Studio's delete replacements (tinkermonkey/context-studio#1398) use.
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { flagStr, parseFlags } from "../classify-eval/lib/io.js";
import { harnessDir } from "./lib/paths.js";
import { specDir as defaultSpecDir } from "./lib/schemas.js";
import { pairOf, parts as tripleParts } from "./lib/triples.js";

export const FORMAT = "cs-dr-spec-changes/1";
const CARDINALITIES = ["one-to-one", "one-to-many", "many-to-one", "many-to-many"];
const STRENGTHS = ["critical", "high", "medium", "low"];

export interface SpecValues {
  description?: string;
  cardinality?: string | null;
  strength?: string | null;
  evidence?: string[];
}

export interface SpecChange {
  seq: number;
  op_id?: string;
  op: "create" | "update" | "delete";
  relationship_id: string;
  previous_relationship_id?: string;
  identifier?: string | null;
  predicate: string;
  source_spec_node_id: string;
  destination_spec_node_id: string;
  set: SpecValues;
  replacement_relationship_id?: string;
}

export interface SpecChanges {
  format: string;
  proposal_id: string;
  title?: string;
  changes: SpecChange[];
}

export interface Action {
  action: "rename" | "create" | "delete";
  kind: string;
  from: string;
  to: string | null;
  p: number;
  claims: string[];
  note: string;
  file_removed?: string;
  file_written?: string;
}

export interface Plan {
  writes: Array<{ file: string; schema: Record<string, unknown> }>;
  removes: string[];
  actions: Action[];
  /** one line per change, for the console */
  summary: string[];
}

/** A triple's parts, refusing an id that is not a well-formed triple. */
const parts = (id: string) => {
  const p = id.split(".");
  if (p.length !== 5 || p.some((s) => !s)) throw new Error(`'${id}' is not a {source}.{predicate}.{destination} triple`);
  return tripleParts(id);
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const boilerplate = (id: string) => {
  const t = parts(id);
  return `Defines relationship: ${t.source} ${t.predicate} ${t.destination}`;
};

/** The spec's relationship schemas by id -> file, its node type ids and its predicates. */
export function readCatalog(spec: string): { files: Map<string, string>; nodes: Set<string>; predicates: Set<string> } {
  const files = new Map<string, string>();
  const relRoot = path.join(spec, "schemas", "relationships");
  for (const layer of readdirSync(relRoot, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const fn of readdirSync(path.join(relRoot, layer.name)).filter((f) => f.endsWith(".relationship.schema.json"))) {
      const file = path.join(relRoot, layer.name, fn);
      const raw = JSON.parse(readFileSync(file, "utf8")) as { properties?: { id?: { const?: string } } };
      if (raw.properties?.id?.const) files.set(raw.properties.id.const, file);
    }
  }
  const nodes = new Set<string>();
  const nodeRoot = path.join(spec, "schemas", "nodes");
  for (const layer of readdirSync(nodeRoot, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const fn of readdirSync(path.join(nodeRoot, layer.name)).filter((f) => f.endsWith(".node.schema.json"))) {
      const raw = JSON.parse(readFileSync(path.join(nodeRoot, layer.name, fn), "utf8")) as { properties?: { spec_node_id?: { const?: string } } };
      if (raw.properties?.spec_node_id?.const) nodes.add(raw.properties.spec_node_id.const);
    }
  }
  const catalog = JSON.parse(readFileSync(path.join(spec, "schemas", "base", "predicates.json"), "utf8")) as Record<string, unknown>;
  const predicates = new Set(Object.keys((catalog.predicates ?? catalog) as Record<string, unknown>));
  return { files, nodes, predicates };
}

/** Where a new schema for `id` goes: <source layer>/<source type>.<predicate>.<destination type>. */
export function schemaPath(spec: string, id: string): string {
  const t = parts(id);
  return path.join(spec, "schemas", "relationships", t.sourceLayer, `${t.sourceType}.${t.predicate}.${t.destType}.relationship.schema.json`);
}

/** A new schema, keys in the sibling files' order. */
export function newSchema(id: string, values: SpecValues): Record<string, unknown> {
  const t = parts(id);
  const schema: Record<string, unknown> = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: `${cap(t.sourceType)} ${t.predicate} ${cap(t.destType)}`,
    description: values.description ?? boilerplate(id),
    allOf: [{ $ref: "../../base/spec-node-relationship.schema.json" }],
    properties: {
      id: { const: id },
      source_spec_node_id: { const: t.source },
      source_layer: { const: t.sourceLayer },
      destination_spec_node_id: { const: t.destination },
      destination_layer: { const: t.destLayer },
      predicate: { const: t.predicate },
      cardinality: { const: values.cardinality ?? "many-to-many" },
      strength: { const: values.strength ?? "medium" },
    },
  };
  if (values.evidence?.length) schema["x-dr-evidence"] = values.evidence;
  return schema;
}

/** A schema for `newId` derived from `old`, as apply-reflect-plan.ts's writeDerived derives one. */
function derived(old: Record<string, any>, newId: string, swapped: boolean): Record<string, any> {
  const s = structuredClone(old);
  const t = parts(newId);
  s.title = `${cap(t.sourceType)} ${t.predicate} ${cap(t.destType)}`;
  if (typeof s.description !== "string" || /^Defines relationship: /.test(s.description) || swapped) s.description = boilerplate(newId);
  if (swapped) delete s["x-dr-evidence"];
  s.properties.id.const = newId;
  s.properties.source_spec_node_id.const = t.source;
  s.properties.source_layer.const = t.sourceLayer;
  s.properties.destination_spec_node_id.const = t.destination;
  s.properties.destination_layer.const = t.destLayer;
  s.properties.predicate.const = t.predicate;
  return s;
}

/** Set the decision's values on a schema, in place; existing keys keep their position. */
function withValues(s: Record<string, any>, values: SpecValues): Record<string, any> {
  if (values.description !== undefined) s.description = values.description;
  if (values.cardinality) s.properties.cardinality = { const: values.cardinality };
  if (values.strength) s.properties.strength = { const: values.strength };
  if (values.evidence !== undefined) {
    if (values.evidence.length) s["x-dr-evidence"] = values.evidence;
    else delete s["x-dr-evidence"];
  }
  return s;
}

function valueProblems(c: SpecChange): string[] {
  const problems: string[] = [];
  const v = c.set ?? {};
  if (v.cardinality === null || v.strength === null) problems.push("removes cardinality or strength, which every schema carries");
  if (v.cardinality && !CARDINALITIES.includes(v.cardinality)) problems.push(`cardinality '${v.cardinality}' is not one of ${CARDINALITIES.join(", ")}`);
  if (v.strength && !STRENGTHS.includes(v.strength)) problems.push(`strength '${v.strength}' is not one of ${STRENGTHS.join(", ")}`);
  if (v.evidence !== undefined && (!Array.isArray(v.evidence) || v.evidence.some((e) => typeof e !== "string"))) problems.push("evidence is not a list of strings");
  if (v.description !== undefined && typeof v.description !== "string") problems.push("description is not a string");
  return problems;
}

/**
 * Work out every file write, removal and migration action for the changes, checking each first.
 *
 * @throws Error listing every problem, when any change cannot be applied (nothing is planned)
 */
export function planSpecChanges(doc: SpecChanges, spec: string): Plan {
  if (doc.format !== FORMAT) throw new Error(`not a ${FORMAT} file (format ${JSON.stringify(doc.format)})`);
  const { files, nodes, predicates } = readCatalog(spec);
  const repo = path.dirname(spec);
  const rel = (f: string) => path.relative(repo, f);
  const plan: Plan = { writes: [], removes: [], actions: [], summary: [] };
  const errors: string[] = [];
  // The spec as the changes so far leave it: `files` follows earlier creates, renames and
  // deletes; `pending` holds each file's planned content, so later changes build on it.
  const pending = new Map<string, Record<string, any>>();
  const toRemove = new Set<string>();
  const occupied = (file: string) => pending.has(file) || (existsSync(file) && !toRemove.has(file));
  const schemaOf = (file: string): Record<string, any> => pending.get(file) ?? JSON.parse(readFileSync(file, "utf8"));
  const drop = (id: string, file: string) => {
    files.delete(id);
    pending.delete(file);
    if (existsSync(file)) toRemove.add(file);
  };
  const put = (id: string, file: string, schema: Record<string, any>) => {
    files.set(id, file);
    pending.set(file, schema);
    toRemove.delete(file);
  };
  /** Why the file for `id` can't be written: a schema with that name holds another triple. */
  const taken = (id: string, file: string): string => {
    const holder = [...files].find(([, f]) => f === file)?.[0];
    if (!holder || holder === id) return `${rel(file)} already exists`;
    const a = parts(holder),
      b = parts(id);
    return (
      `${rel(file)} already holds ${holder}: the file name leaves out the destination layer, ` +
      `and ${a.destType} is in both ${a.destLayer} and ${b.destLayer}`
    );
  };
  const note = (c: SpecChange, what: string) => `Context Studio proposal ${doc.proposal_id} seq ${c.seq} (${what})`;

  for (const c of doc.changes) {
    const label = `seq ${c.seq} ${c.op} ${c.relationship_id}`;
    const problems = valueProblems(c);
    let t;
    try {
      t = parts(c.relationship_id);
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
      continue;
    }
    if (t.source !== c.source_spec_node_id || t.predicate !== c.predicate || t.destination !== c.destination_spec_node_id) {
      problems.push("its predicate, source and destination don't match its relationship id");
    }
    if (c.op !== "delete") {
      for (const node of [t.source, t.destination]) if (!nodes.has(node)) problems.push(`node type ${node} is not in the spec`);
      if (!predicates.has(t.predicate)) problems.push(`predicate '${t.predicate}' is not in the predicate catalog`);
    }
    const id = c.relationship_id;
    const old = c.op === "update" ? (c.previous_relationship_id ?? id) : id;
    const oldFile = files.get(old);
    if (c.op === "create") {
      if (oldFile) problems.push(`already in the spec (${rel(oldFile)})`);
    } else if (!oldFile) {
      problems.push(`${old} is not in the spec`);
    }
    const renamed = c.op === "update" && old !== id;
    const newFile = c.op === "create" || renamed ? schemaPath(spec, id) : undefined;
    if (renamed && files.has(id)) problems.push(`${id} is already in the spec`);
    else if (newFile && occupied(newFile)) problems.push(taken(id, newFile));
    if (c.op === "delete" && c.replacement_relationship_id && !files.has(c.replacement_relationship_id)) {
      problems.push(`its replacement ${c.replacement_relationship_id} is not in the spec`);
    }
    if (problems.length) {
      errors.push(...problems.map((p) => `${label}: ${p}`));
      continue;
    }

    if (c.op === "create") {
      put(id, newFile!, newSchema(id, c.set ?? {}));
      plan.actions.push({ action: "create", kind: "cs:create", from: id, to: id, p: 1, claims: [], note: note(c, "create"), file_written: rel(newFile!) });
      plan.summary.push(`create ${id}`);
    } else if (c.op === "delete") {
      drop(id, oldFile!);
      const to = c.replacement_relationship_id && pairOf(id, c.replacement_relationship_id) !== "different" ? c.replacement_relationship_id : null;
      const why = c.replacement_relationship_id && !to ? `; replaced by ${c.replacement_relationship_id}, a different element pair, which a migration cannot apply mechanically, so model relationships of this triple are dropped` : "";
      plan.actions.push({ action: "delete", kind: "cs:delete", from: id, to, p: 1, claims: [], note: note(c, "delete") + why, file_removed: rel(oldFile!) });
      plan.summary.push(`delete ${id}${to ? ` (relationships move to ${to})` : ""}`);
    } else if (!renamed) {
      put(id, oldFile!, withValues(schemaOf(oldFile!), c.set ?? {}));
      plan.summary.push(`update ${id}: ${Object.keys(c.set ?? {}).join(", ") || "no spec values changed"}`);
    } else {
      const pair = pairOf(old, id);
      const swapped = pair === "reversed";
      const schema = withValues(derived(schemaOf(oldFile!), id, swapped), c.set ?? {});
      drop(old, oldFile!);
      put(id, newFile!, schema);
      const files_ = { file_removed: rel(oldFile!), file_written: rel(newFile!) };
      if (pair !== "different") {
        plan.actions.push({ action: "rename", kind: swapped ? "cs:reverse" : "cs:rename", from: old, to: id, p: 1, claims: [], note: note(c, swapped ? "reverse" : "rename"), ...files_ });
      } else {
        plan.actions.push({ action: "delete", kind: "cs:retarget", from: old, to: null, p: 1, claims: [], note: `${note(c, "retarget")}; retargeted to ${id}, which a migration cannot apply mechanically, so model relationships of this triple are dropped`, file_removed: files_.file_removed });
        plan.actions.push({ action: "create", kind: "cs:retarget", from: id, to: id, p: 1, claims: [], note: `retarget of ${old} (${note(c, "retarget")})`, file_written: files_.file_written });
      }
      plan.summary.push(`${swapped ? "reverse" : pair === "same" ? "rename" : "retarget"} ${old} -> ${id}`);
    }
  }
  if (errors.length) throw new Error(`nothing written; these changes cannot be applied:\n  ${errors.join("\n  ")}`);
  plan.writes = [...pending].map(([file, schema]) => ({ file, schema }));
  plan.removes = [...toRemove];
  return plan;
}

/** Write a schema with 2-space indentation and a trailing newline, like the sibling files. */
export function schemaText(schema: Record<string, unknown>): string {
  return JSON.stringify(schema, null, 2) + "\n";
}

/** The change record generate-relationship-migration.ts reads (apply-walk.ts's shape). */
export function changeRecord(doc: SpecChanges, plan: Plan, appliedAt: string): Record<string, unknown> {
  const counts = { rename: 0, create: 0, delete: 0 };
  for (const a of plan.actions) counts[a.action]++;
  return { backend: "context-studio", record: `cs-${doc.proposal_id}`, select: { proposal_id: doc.proposal_id, title: doc.title ?? null }, applied_at: appliedAt, counts, actions: plan.actions };
}

export function recordPath(doc: SpecChanges, recordsDir: string = path.join(harnessDir(), "data", "cs-decisions")): string {
  return path.join(recordsDir, `applied-cs-${doc.proposal_id}.json`);
}

/**
 * Apply a plan: writes, then removals, then the change record. The plan was checked whole, but
 * the file I/O is not atomic: a failing write leaves the earlier ones in place, and git is the
 * way back (`git checkout -- spec && git clean -fd spec`).
 */
export function applyPlan(doc: SpecChanges, plan: Plan, recordFile: string, appliedAt = new Date().toISOString()): void {
  for (const w of plan.writes) {
    mkdirSync(path.dirname(w.file), { recursive: true });
    writeFileSync(w.file, schemaText(w.schema));
  }
  for (const f of plan.removes) unlinkSync(f);
  mkdirSync(path.dirname(recordFile), { recursive: true });
  writeFileSync(recordFile, JSON.stringify(changeRecord(doc, plan, appliedAt), null, 2) + "\n");
}

/** Format written JSON with the repo's own prettier, as pre-commit does; a problem, or null. */
export function formatWritten(repo: string, files: string[]): string | null {
  const bin = path.join(repo, "node_modules", ".bin", "prettier");
  if (!existsSync(bin)) return `prettier not found at ${bin}: run it on the written files before committing`;
  const run = spawnSync(bin, ["--write", "--log-level", "warn", ...files], { cwd: repo, encoding: "utf8" });
  return run.status === 0 ? null : `prettier failed: ${run.stderr || run.stdout}`;
}

/**
 * Lines of the layer skills (integrations/claude_code/skills/<skill>/SKILL.md) that cite one of
 * these triples: a line naming its predicate and both its types (a table row or a
 * `dr relationship add` command). For the person to edit; nothing is changed.
 */
export function skillCitations(repo: string, triples: string[]): string[] {
  const root = path.join(repo, "integrations", "claude_code", "skills");
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const dir of readdirSync(root).sort()) {
    const file = path.join(root, dir, "SKILL.md");
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    for (const id of triples) {
      const t = parts(id);
      const predicate = new RegExp(`(^|[^a-z-])${t.predicate}([^a-z-]|$)`);
      lines.forEach((line, i) => {
        const lower = line.toLowerCase();
        if (predicate.test(lower) && lower.includes(t.sourceType) && lower.includes(t.destType)) {
          found.push(`${path.relative(repo, file)}:${i + 1} cites ${id}`);
        }
      });
    }
  }
  return found;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const changesFile = flagStr(flags, "changes");
  if (!changesFile) {
    console.error("Usage: bun cs-decisions-to-spec.ts --changes <cs-dr-spec-changes file> [--spec-dir <dir>] [--dry-run]");
    process.exit(2);
  }
  const spec = path.resolve(flagStr(flags, "spec-dir") ?? defaultSpecDir());
  const dry = !!flags["dry-run"];
  const doc = JSON.parse(readFileSync(changesFile, "utf8")) as SpecChanges;
  let plan: Plan;
  try {
    plan = planSpecChanges(doc, spec);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const record = recordPath(doc, path.join(path.dirname(spec), "cli", "scripts", "spec-enrich", "data", "cs-decisions"));
  if (existsSync(record) && !dry) {
    console.error(`not written: ${path.relative(process.cwd(), record)} exists, so proposal ${doc.proposal_id} was already applied`);
    process.exit(1);
  }
  const repo = path.dirname(spec);
  if (!dry) {
    applyPlan(doc, plan, record);
    const problem = formatWritten(repo, [...plan.writes.map((w) => w.file), record]);
    if (problem) console.error(problem);
  }
  console.log(`${dry ? "[dry run] " : ""}${doc.changes.length} changes from Context Studio proposal ${doc.proposal_id}:`);
  for (const line of plan.summary) console.log(`  ${line}`);
  const gone = plan.actions.filter((a) => a.action === "rename" || (a.action === "delete" && a.from !== a.to)).map((a) => a.from);
  const citations = skillCitations(repo, gone);
  if (citations.length) {
    console.log("layer skill lines citing a removed or renamed triple (edit them; npm run check:skill-relationships checks after the build):");
    for (const line of citations) console.log(`  ${line}`);
  }
  if (!dry) console.log(`recorded ${plan.actions.length} migration actions in ${path.relative(process.cwd(), record)}. Rebuild the spec next.`);
}

if (import.meta.main) main();
