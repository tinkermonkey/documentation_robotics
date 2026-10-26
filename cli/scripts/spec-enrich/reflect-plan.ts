/**
 * Turn a reflection run into a change plan over relationship schemas.
 *
 * Every reflection with outcome 'alternative' names a different source, destination or
 * predicate for one catalog triple. This script groups them per triple, classifies the
 * implied schema change, notes conflicts between claims about the same triple, and reports
 * how many changes clear a probability threshold.
 *
 *   bun reflect-plan.ts [--backend clef] [--layer application] [--min-p 0.5]
 *
 * Writes data/triage/reflect/plan-<backend>.json and plan-<backend>.md.
 *
 * Change kinds (per triple, after merging the sorting answers):
 *   remove-duplicate  the preferred predicate already exists between the same pair; delete this schema
 *   rename-predicate  change the predicate (new schema, old removed; models need a migration)
 *   reverse           swap source and destination (and possibly the predicate)
 *   retarget          change the source and/or destination type
 *   compound          more than one of the above at once; review by hand
 *   conflict          different claims about the same triple prefer different alternatives
 */
import path from "node:path";
import { readdirSync, writeFileSync } from "node:fs";
import { flagNum, flagStr, parseFlags, readJsonl } from "../classify-eval/lib/io.js";
import { loadRelationshipSchemas } from "./lib/schemas.js";
import { decisionsDir, harnessDir } from "./lib/paths.js";
import { readAllDecisions } from "./triage.js";
import type { Reflection } from "./triage-reflect.js";
import type { Claim } from "./lib/triage-types.js";

export interface PlannedChange {
  triple: string;
  source: string;
  predicate: string;
  destination: string;
  layer: string;
  kind: "remove-duplicate" | "rename-predicate" | "reverse" | "retarget" | "compound" | "conflict";
  /** false when the claim names a triple the catalog does not have (the proposer misnamed it); such rows are not changes */
  current_exists: boolean;
  /** the replacement triple(s) implied, e.g. "application.applicationfunction.realizes.application.applicationservice" */
  replacement: string[];
  replacement_exists: boolean;
  p: number; // min probability over the alternatives that make up this change
  claims: string[];
  claim_texts: string[];
  reflect_validity: string[]; // validity decided with the reflection, per claim
  alternatives: string[]; // raw alternatives per claim, "q=value|p"
}

function oneChange(r: Reflection, existing: Set<string>): { kind: PlannedChange["kind"]; replacement: string[]; p: number; alts: string[] } {
  const [sl, st, pred, dl, dt] = r.triple.split(".");
  const src = `${sl}.${st}`,
    dst = `${dl}.${dt}`;
  const a = r.answers;
  const pOf = (q: string, v: string) => a[q]?.probabilities[v] ?? 0;
  const parts: string[] = [];
  const alts: string[] = [];
  let newSrc = src,
    newDst = dst,
    newPred = pred,
    reversed = false,
    p = 1;
  const S = a.source_for?.choice,
    T = a.target_for?.choice,
    P = a.predicate_for?.choice;
  if (S && S !== src && S !== "none") {
    newSrc = S;
    parts.push("retarget");
    p = Math.min(p, pOf("source_for", S));
    alts.push(`source=${S}|${pOf("source_for", S).toFixed(2)}`);
  }
  if (T && T !== dst && T !== "none") {
    newDst = T;
    parts.push("retarget");
    p = Math.min(p, pOf("target_for", T));
    alts.push(`target=${T}|${pOf("target_for", T).toFixed(2)}`);
  }
  if (P && P !== pred && P !== "none") {
    if (P.startsWith("reverse:")) {
      reversed = true;
      newPred = P.slice("reverse:".length);
      parts.push("reverse");
    } else {
      newPred = P;
      parts.push("predicate");
    }
    p = Math.min(p, pOf("predicate_for", P));
    alts.push(`predicate=${P}|${pOf("predicate_for", P).toFixed(2)}`);
  }
  const replacement = reversed ? `${newDst}.${newPred}.${newSrc}` : `${newSrc}.${newPred}.${newDst}`;
  const kinds = [...new Set(parts)];
  let kind: PlannedChange["kind"];
  if (kinds.length > 1) kind = "compound";
  else if (kinds[0] === "reverse") kind = "reverse";
  else if (kinds[0] === "retarget") kind = "retarget";
  else kind = existing.has(replacement) ? "remove-duplicate" : "rename-predicate";
  return { kind, replacement: [replacement], p, alts };
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const backend = flagStr(flags, "backend", "clef") ?? "clef";
  const layerFilter = flagStr(flags, "layer");
  const minP = flagNum(flags, "min-p", 0.5);
  const dir = path.join(harnessDir(), "data", "triage");
  const claims = new Map(readJsonl<Claim>(path.join(dir, "claims.jsonl")).map((c) => [c.id, c]));
  // second-pass decisions (, every triple of a claim considered) override first-pass ones
  const dec = new Map([...readAllDecisions(decisionsDir(`${backend}@reflect`)), ...readAllDecisions(decisionsDir(`${backend}@reflect2`))].filter((d) => !d.error).map((d) => [d.claim_id, d]));
  const reflDir = path.join(dir, "reflect", backend);
  let refl: Reflection[] = [];
  for (const f of readdirSync(reflDir).filter((f) => f.endsWith(".jsonl")).sort()) refl = refl.concat(readJsonl<Reflection>(path.join(reflDir, f)));
  refl = refl.filter((r) => r.outcome === "alternative").filter((r) => !layerFilter || r.triple.startsWith(`${layerFilter}.`));
  const existing = new Set(loadRelationshipSchemas().map((r) => r.id));

  const byTriple = new Map<string, Array<{ r: Reflection; c: ReturnType<typeof oneChange> }>>();
  for (const r of refl) byTriple.set(r.triple, [...(byTriple.get(r.triple) ?? []), { r, c: oneChange(r, existing) }]);

  let plan: PlannedChange[] = [];
  for (const [triple, rows] of byTriple) {
    const [sl, st, pred, dl, dt] = triple.split(".");
    const replacements = [...new Set(rows.map((x) => x.c.replacement[0]))];
    const kinds = [...new Set(rows.map((x) => x.c.kind))];
    const conflict = replacements.length > 1;
    plan.push({
      triple,
      source: `${sl}.${st}`,
      predicate: pred,
      destination: `${dl}.${dt}`,
      layer: sl,
      kind: conflict ? "conflict" : kinds[0],
      current_exists: existing.has(triple),
      replacement: replacements,
      replacement_exists: replacements.every((x) => existing.has(x)),
      p: conflict ? Math.max(...rows.map((x) => x.c.p)) : Math.min(...rows.map((x) => x.c.p)),
      claims: rows.map((x) => x.r.claim_id),
      claim_texts: rows.map((x) => claims.get(x.r.claim_id)?.text ?? ""),
      reflect_validity: rows.map((x) => dec.get(x.r.claim_id)?.validity.choice ?? "?"),
      alternatives: rows.flatMap((x) => x.c.alts),
    });
  }
  plan.sort((a, b) => a.layer.localeCompare(b.layer) || b.p - a.p);
  const kinds: PlannedChange["kind"][] = ["remove-duplicate", "rename-predicate", "reverse", "retarget", "compound", "conflict"];
  const missing = plan.filter((x) => !x.current_exists);
  const md: string[] = [`# Reflection change plan (${backend})`, "", `${refl.length} reflections with a concrete alternative name ${plan.length} distinct triples${layerFilter ? ` in ${layerFilter}` : ""}; ${missing.length} of them are not in the catalog (the claim misnamed the relationship) and are listed last, not counted below.`, ""];
  const all = plan;
  plan = plan.filter((x) => x.current_exists);
  md.push("## Change kinds by probability threshold", "", "| kind | triples | p >= 0.5 | p >= 0.6 | p >= 0.7 | p >= 0.8 | real_defect (reflect) on all claims |", "|---|---|---|---|---|---|---|");
  for (const k of kinds) {
    const rows = plan.filter((x) => x.kind === k);
    const at = (t: number) => rows.filter((x) => x.p >= t).length;
    const rd = rows.filter((x) => x.reflect_validity.every((v) => v === "real_defect")).length;
    md.push(`| ${k} | ${rows.length} | ${at(0.5)} | ${at(0.6)} | ${at(0.7)} | ${at(0.8)} | ${rd} |`);
  }
  md.push(`| all | ${plan.length} | ${plan.filter((x) => x.p >= 0.5).length} | ${plan.filter((x) => x.p >= 0.6).length} | ${plan.filter((x) => x.p >= 0.7).length} | ${plan.filter((x) => x.p >= 0.8).length} | ${plan.filter((x) => x.reflect_validity.every((v) => v === "real_defect")).length} |`, "");

  md.push("## Per layer", "", "| layer | triples | " + kinds.join(" | ") + " |", "|---|---|" + kinds.map(() => "---").join("|") + "|");
  for (const l of [...new Set(plan.map((x) => x.layer))].sort()) {
    const rows = plan.filter((x) => x.layer === l);
    md.push(`| ${l} | ${rows.length} | ${kinds.map((k) => rows.filter((x) => x.kind === k).length).join(" | ")} |`);
  }
  md.push("");
  md.push("## Predicate replacements (rename-predicate and remove-duplicate), by old -> new", "", "| old -> new | triples | exists already | mean p |", "|---|---|---|---|");
  const pairs = new Map<string, PlannedChange[]>();
  for (const x of plan.filter((x) => x.kind === "rename-predicate" || x.kind === "remove-duplicate")) {
    const np = x.replacement[0].split(".")[2];
    const k = `${x.predicate} -> ${np}`;
    pairs.set(k, [...(pairs.get(k) ?? []), x]);
  }
  for (const [k, rows] of [...pairs.entries()].sort((a, b) => b[1].length - a[1].length)) md.push(`| ${k} | ${rows.length} | ${rows.filter((x) => x.replacement_exists).length} | ${(rows.reduce((s, x) => s + x.p, 0) / rows.length).toFixed(2)} |`);
  md.push("");
  md.push(`## Changes at p >= ${minP}`, "");
  for (const l of [...new Set(plan.map((x) => x.layer))].sort()) {
    const rows = plan.filter((x) => x.layer === l && x.p >= minP);
    if (!rows.length) continue;
    md.push(`### ${l} (${rows.length})`, "", "| kind | current | replacement | p | reflect validity | claim |", "|---|---|---|---|---|---|");
    for (const x of rows) md.push(`| ${x.kind} | ${x.triple} | ${x.replacement.join(" / ")}${x.replacement_exists ? " (exists)" : ""} | ${x.p.toFixed(2)} | ${[...new Set(x.reflect_validity)].join("/")} | ${x.claim_texts[0].replace(/\|/g, "/").slice(0, 120)} |`);
    md.push("");
  }
  if (missing.length) {
    md.push(`## Claims naming triples the catalog does not have (${missing.length})`, "", "| named triple | alternative | claim |", "|---|---|---|");
    for (const x of missing) md.push(`| ${x.triple} | ${x.replacement.join(" / ")} | ${x.claim_texts[0].replace(/\|/g, "/").slice(0, 120)} |`);
    md.push("");
  }
  writeFileSync(path.join(reflDir, `plan-${backend}.json`), JSON.stringify(all, null, 2) + "\n");
  const out = md.join("\n").replace(/\n+$/, "") + "\n";
  writeFileSync(path.join(reflDir, `plan-${backend}.md`), out);
  console.log(out.slice(0, out.indexOf(`## Changes at p >=`)));
}

main();
