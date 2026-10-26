/**
 * Apply selected rows of a reflection change plan to the relationship schemas.
 *
 *   bun apply-reflect-plan.ts [--backend clef] --select remove-duplicate:0.6,reverse:0.7,rename-predicate:0.7 [--record tier1] [--dry-run]
 *
 * --select lists kind:min-probability pairs; rows of other kinds (retarget, compound,
 * conflict) are never applied by this script. Order of application:
 *   1. rename-predicate   write the replacement schema (same pair, new predicate), delete the old one
 *   2. reverse            if the reversed schema does not exist, write it (source and destination
 *                         swapped, the reversed predicate), then delete the old one
 *   3. remove-duplicate   delete the old schema once its replacement is confirmed to exist
 * Every action is recorded in reflect/<backend>/applied-<record>.json (old id -> new id or
 * deleted), which is the input for the model migration.
 */
import path from "node:path";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { flagStr, parseFlags } from "../classify-eval/lib/io.js";
import { loadRelationshipSchemas, specDir, type RelationshipSchema } from "./lib/schemas.js";
import { harnessDir } from "./lib/paths.js";
import type { PlannedChange } from "./reflect-plan.js";

interface Action {
  action: "rename" | "create" | "delete";
  kind: PlannedChange["kind"];
  from: string; // old triple id (for create: the triple it replaces)
  to: string | null; // new triple id, or null when deleted
  file_removed?: string;
  file_written?: string;
  p: number;
  claims: string[];
  note?: string;
}

const parts = (id: string) => {
  const p = id.split(".");
  return { source: `${p[0]}.${p[1]}`, predicate: p[2], destination: `${p[3]}.${p[4]}`, sourceLayer: p[0], destLayer: p[3], sourceType: p[1], destType: p[4] };
};
/** Existing schemas by id -> file (a few files are not named after their id, e.g. audit-config). */
const catalogFiles = new Map<string, string>(loadRelationshipSchemas().map((r: RelationshipSchema) => [r.id, r.file]));
const fileFor = (id: string) => {
  const known = catalogFiles.get(id);
  if (known) return known;
  const t = parts(id);
  return path.join(specDir(), "schemas", "relationships", t.sourceLayer, `${t.sourceType}.${t.predicate}.${t.destType}.relationship.schema.json`);
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Write a schema for `newId` derived from the schema at `fromFile` (same pair, new predicate, or swapped pair). */
function writeDerived(fromFile: string, newId: string, swapped: boolean): string {
  const s = JSON.parse(readFileSync(fromFile, "utf8")) as Record<string, any>;
  const t = parts(newId);
  s.title = `${cap(t.sourceType)} ${t.predicate} ${cap(t.destType)}`;
  const boiler = typeof s.description !== "string" || /^Defines relationship: /.test(s.description);
  if (boiler || swapped) s.description = `Defines relationship: ${t.source} ${t.predicate} ${t.destination}`;
  if (swapped) {
    delete s["x-dr-evidence"];
  }
  s.properties.id.const = newId;
  s.properties.source_spec_node_id.const = t.source;
  s.properties.source_layer.const = t.sourceLayer;
  s.properties.destination_spec_node_id.const = t.destination;
  s.properties.destination_layer.const = t.destLayer;
  s.properties.predicate.const = t.predicate;
  const out = fileFor(newId);
  writeFileSync(out, JSON.stringify(s, null, 2) + "\n");
  return out;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const backend = flagStr(flags, "backend", "clef") ?? "clef";
  const record = flagStr(flags, "record", "tier1") ?? "tier1";
  const dry = !!flags["dry-run"];
  const select = new Map<string, number>();
  for (const s of (flagStr(flags, "select", "") ?? "").split(",").filter(Boolean)) {
    const [k, p] = s.split(":");
    select.set(k.trim(), Number(p ?? 0));
  }
  if (!select.size) {
    console.error("Usage: bun apply-reflect-plan.ts --select remove-duplicate:0.6,reverse:0.7,rename-predicate:0.7 [--record tier1] [--dry-run]");
    process.exit(2);
  }
  for (const k of select.keys()) if (!["remove-duplicate", "reverse", "rename-predicate"].includes(k)) throw new Error(`kind ${k} is not applied automatically`);
  const reflDir = path.join(harnessDir(), "data", "triage", "reflect", backend);
  const plan = JSON.parse(readFileSync(path.join(reflDir, `plan-${backend}.json`), "utf8")) as PlannedChange[];
  const rows = plan.filter((x) => x.current_exists && select.has(x.kind) && x.p >= (select.get(x.kind) ?? 1));
  const existing = new Set(loadRelationshipSchemas().map((r: RelationshipSchema) => r.id));
  const renamedTo = new Map<string, string>(); // old id -> new id, for replacement lookups
  const actions: Action[] = [];
  const order: PlannedChange["kind"][] = ["rename-predicate", "reverse", "remove-duplicate"];
  for (const kind of order) {
    for (const x of rows.filter((r) => r.kind === kind)) {
      const from = x.triple;
      const to = x.replacement[0];
      const fromFile = fileFor(from);
      if (!existsSync(fromFile)) {
        actions.push({ action: "delete", kind, from, to: null, p: x.p, claims: x.claims, note: "skipped: schema file already gone" });
        continue;
      }
      if (kind === "rename-predicate") {
        if (existing.has(to)) {
          actions.push({ action: "delete", kind, from, to, p: x.p, claims: x.claims, file_removed: fromFile, note: "replacement already existed; old schema deleted as a duplicate" });
          if (!dry) unlinkSync(fromFile);
        } else {
          const written = dry ? fileFor(to) : writeDerived(fromFile, to, false);
          if (!dry) unlinkSync(fromFile);
          actions.push({ action: "rename", kind, from, to, p: x.p, claims: x.claims, file_removed: fromFile, file_written: written });
          existing.add(to);
        }
        existing.delete(from);
        renamedTo.set(from, to);
      } else if (kind === "reverse") {
        // the reversed triple may have been renamed by step 1; then it exists under its new id
        const renamed = renamedTo.get(to);
        if (existing.has(to) || (renamed && existing.has(renamed))) {
          const target = existing.has(to) ? to : renamed!;
          actions.push({ action: "delete", kind, from, to: target, p: x.p, claims: x.claims, file_removed: fromFile, note: "reversed schema already existed; old direction deleted" });
          if (!dry) unlinkSync(fromFile);
        } else {
          const written = dry ? fileFor(to) : writeDerived(fromFile, to, true);
          if (!dry) unlinkSync(fromFile);
          actions.push({ action: "create", kind, from, to, p: x.p, claims: x.claims, file_removed: fromFile, file_written: written, note: "reversed schema created; description reset to boilerplate for enrichment" });
          existing.add(to);
        }
        existing.delete(from);
      } else {
        // remove-duplicate: the replacement must exist now (possibly under a renamed id)
        const target = existing.has(to) ? to : renamedTo.get(to) && existing.has(renamedTo.get(to)!) ? renamedTo.get(to)! : null;
        if (!target) {
          actions.push({ action: "delete", kind, from, to, p: x.p, claims: x.claims, note: "skipped: replacement no longer exists" });
          continue;
        }
        actions.push({ action: "delete", kind, from, to: target, p: x.p, claims: x.claims, file_removed: fromFile });
        if (!dry) unlinkSync(fromFile);
        existing.delete(from);
      }
    }
  }
  const applied = actions.filter((a) => !a.note?.startsWith("skipped"));
  const counts = { rename: applied.filter((a) => a.action === "rename").length, create: applied.filter((a) => a.action === "create").length, delete: applied.filter((a) => a.action === "delete").length, skipped: actions.length - applied.length };
  if (!dry) writeFileSync(path.join(reflDir, `applied-${record}.json`), JSON.stringify({ backend, record, select: Object.fromEntries(select), applied_at: new Date().toISOString(), counts, actions }, null, 2) + "\n");
  console.log(`${dry ? "[dry run] " : ""}${rows.length} plan rows -> ${counts.rename} renamed, ${counts.create} created (reversed), ${counts.delete} deleted, ${counts.skipped} skipped`);
  for (const a of actions) console.log(`  ${a.action.padEnd(6)} ${a.kind.padEnd(16)} p=${a.p.toFixed(2)} ${a.from}${a.to ? ` -> ${a.to}` : ""}${a.note ? `  (${a.note})` : ""}`);
}

main();
