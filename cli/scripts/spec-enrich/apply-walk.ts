/**
 * Apply the decisions recorded by a per-layer walk of the reflection plan.
 *
 *   bun apply-walk.ts --layer application [--dry-run]
 *
 * Reads data/triage/reflect/clef/walk-<layer>.jsonl, one line per adjudicated row:
 *   {row, triple, decision: keep|delete|rename|retarget|reverse, replacement?, add?: [triple], editorial?, rationale}
 * and applies it to spec/schemas/relationships:
 *   delete            remove the schema (its `replacement`, if any, names the schema that already covers it)
 *   rename, retarget  write the replacement schema derived from the old one, remove the old one
 *   reverse           write the replacement (pair swapped) derived from the old one, remove the old one
 *   add               write a boilerplate schema for each listed triple, derived from the replacement
 *   keep              nothing (an `editorial` note is applied by hand)
 * Every action is recorded in data/triage/reflect/clef/applied-walk-<layer>.json in the same shape as
 * the tier records, so the migration table generator picks it up and chains it after them.
 */
import path from "node:path";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { flagStr, parseFlags, readJsonl } from "../classify-eval/lib/io.js";
import { harnessDir } from "./lib/paths.js";
import { fileFor, parts, writeDerived } from "./apply-reflect-plan.js";

interface WalkRow {
  row: number;
  triple: string;
  kind: string;
  decision: "keep" | "delete" | "rename" | "retarget" | "reverse";
  replacement: string | null;
  add?: string[];
  editorial?: string;
  rationale: string;
  adjudicated_by: string;
}

interface Action {
  action: "rename" | "create" | "delete";
  kind: string;
  from: string;
  to: string | null;
  file_removed?: string;
  file_written?: string;
  p: number;
  claims: string[];
  note?: string;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const layer = flagStr(flags, "layer");
  if (!layer) {
    console.error("Usage: bun apply-walk.ts --layer <id> [--dry-run]");
    process.exit(2);
  }
  const dry = !!flags["dry-run"];
  const reflDir = path.join(harnessDir(), "data", "triage", "reflect", "clef");
  const rows = readJsonl<WalkRow>(path.join(reflDir, `walk-${layer}.jsonl`));
  const actions: Action[] = [];
  const note = (r: WalkRow) => `walk row ${r.row} (${r.decision}): ${r.rationale.slice(0, 160)}`;
  for (const r of rows) {
    const fromFile = fileFor(r.triple);
    if (r.decision === "keep") {
      if (r.editorial) console.log(`  keep   row ${r.row} ${r.triple}  editorial: ${r.editorial}`);
      continue;
    }
    if (!existsSync(fromFile)) {
      console.log(`  SKIP   row ${r.row} ${r.triple}: schema file not found`);
      continue;
    }
    if (r.decision === "delete") {
      actions.push({ action: "delete", kind: `walk:${r.kind}`, from: r.triple, to: r.replacement, p: 1, claims: [], file_removed: fromFile, note: note(r) });
      if (!dry) unlinkSync(fromFile);
      continue;
    }
    const to = r.replacement!;
    const swapped = r.decision === "reverse";
    const toFile = fileFor(to);
    if (existsSync(toFile)) {
      actions.push({ action: "delete", kind: `walk:${r.kind}`, from: r.triple, to, p: 1, claims: [], file_removed: fromFile, note: `${note(r)}; replacement already existed` });
      if (!dry) unlinkSync(fromFile);
    } else {
      const written = dry ? toFile : writeDerived(fromFile, to, swapped);
      if (!dry) unlinkSync(fromFile);
      actions.push({ action: swapped ? "create" : "rename", kind: `walk:${r.kind}`, from: r.triple, to, p: 1, claims: [], file_removed: fromFile, file_written: written, note: note(r) });
    }
    for (const extra of r.add ?? []) {
      const extraFile = fileFor(extra);
      if (existsSync(extraFile)) continue;
      // derive from the replacement just written (same predicate and destination, different source)
      const written = dry ? extraFile : writeDerived(existsSync(toFile) ? toFile : fromFile, extra, false);
      actions.push({ action: "create", kind: "walk:add", from: extra, to: extra, p: 1, claims: [], file_written: written, note: `added as counterpart of ${to} (walk row ${r.row})` });
    }
  }
  const counts = { rename: actions.filter((a) => a.action === "rename").length, create: actions.filter((a) => a.action === "create").length, delete: actions.filter((a) => a.action === "delete").length };
  if (!dry) {
    const out = { backend: "clef", record: `walk-${layer}`, select: { walk: layer }, applied_at: new Date().toISOString(), counts, actions };
    writeFileSync(path.join(reflDir, `applied-walk-${layer}.json`), JSON.stringify(out, null, 2) + "\n");
  }
  console.log(`${dry ? "[dry run] " : ""}${rows.length} walk rows -> ${counts.rename} renamed, ${counts.create} created, ${counts.delete} deleted`);
  for (const a of actions) console.log(`  ${a.action.padEnd(6)} ${a.from}${a.to && a.to !== a.from ? ` -> ${a.to}` : ""}`);
}

main();
