/**
 * Context Studio's predicate operations (`predicate_changes` in cs-dr-spec-changes/1,
 * tinkermonkey/context-studio#1481), planned onto a SpecState's predicates.json. A retirement is
 * not here: it is a `retire-predicate` record, which cs-decisions-to-spec.ts lands after every
 * other change. Values are checked against spec/schemas/base/predicate-catalog.schema.json.
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { predicateMap, SpecState, type Json } from "./spec-state.js";

export interface PredicateSemantics {
  directionality: string;
  transitivity: boolean;
  symmetry: boolean;
  reflexivity: boolean;
}

export interface PredicateValues {
  description?: string;
  /** a label for the reverse reading ("supported-by"), not a predicate id */
  inverse?: string;
  category?: string;
  archimate_alignment?: string | null;
  /** an update may give only the flags it changes */
  semantics?: Partial<PredicateSemantics>;
}

export interface PredicateChange {
  seq: number;
  op_id?: string;
  op: "create" | "update";
  predicate: string;
  set?: PredicateValues;
  decided_at?: string | null;
  decided_by?: string | null;
}

const PREDICATE_NAME = /^[a-z]+(-[a-z]+)*$/;
const SEMANTIC_FLAGS = ["transitivity", "symmetry", "reflexivity"] as const;

/** The enums the predicate catalog's schema allows, or null where it has none. */
export function catalogEnums(spec: string): { category: string[] | null; alignment: Array<string | null> | null; directionality: string[] | null } {
  const file = path.join(spec, "schemas", "base", "predicate-catalog.schema.json");
  if (!existsSync(file)) return { category: null, alignment: null, directionality: null };
  const props = JSON.parse(readFileSync(file, "utf8"))?.definitions?.PredicateDefinition?.properties ?? {};
  return {
    category: props.category?.enum ?? null,
    alignment: props.archimate_alignment?.enum ?? null,
    directionality: props.semantics?.properties?.directionality?.enum ?? null,
  };
}

function valueProblems(v: PredicateValues, creating: boolean, enums: ReturnType<typeof catalogEnums>): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(v)) if (!["description", "inverse", "category", "archimate_alignment", "semantics"].includes(key)) problems.push(`sets '${key}', which the predicate catalog has no slot for`);
  for (const key of ["description", "inverse", "category"] as const) {
    if (v[key] !== undefined && (typeof v[key] !== "string" || !v[key]!.trim())) problems.push(`its ${key} is empty or not a string`);
    else if (creating && v[key] === undefined) problems.push(`a create needs a ${key}`);
  }
  if (v.category && enums.category && !enums.category.includes(v.category)) problems.push(`category '${v.category}' is not one of ${enums.category.join(", ")}`);
  if (v.archimate_alignment !== undefined && enums.alignment && !enums.alignment.includes(v.archimate_alignment)) {
    problems.push(`archimate_alignment '${v.archimate_alignment}' is not one of ${enums.alignment.map(String).join(", ")}`);
  }
  const s = v.semantics;
  if (s !== undefined) {
    if (!s || typeof s !== "object") problems.push("semantics is not an object");
    else {
      for (const key of Object.keys(s)) if (key !== "directionality" && !(SEMANTIC_FLAGS as readonly string[]).includes(key)) problems.push(`semantics sets '${key}', which the catalog has no slot for`);
      if (s.directionality !== undefined && enums.directionality && !enums.directionality.includes(s.directionality)) problems.push(`directionality '${s.directionality}' is not one of ${enums.directionality.join(", ")}`);
      for (const flag of SEMANTIC_FLAGS) if (s[flag] !== undefined && typeof s[flag] !== "boolean") problems.push(`semantics.${flag} is not true or false`);
      if (creating) for (const key of ["directionality", ...SEMANTIC_FLAGS]) if ((s as Json)[key] === undefined) problems.push(`a create needs semantics.${key}`);
    }
  } else if (creating) problems.push("a create needs semantics");
  return problems;
}

/** Plan one predicate operation; problems are returned and nothing is planned for it. */
export function planPredicateChange(state: SpecState, c: PredicateChange, summary: string[], enums = catalogEnums(state.spec)): string[] {
  if (c.op !== "create" && c.op !== "update") return [`'${c.op}' is not create or update (a retirement is a retire-predicate record)`];
  const problems: string[] = [];
  if (typeof c.predicate !== "string" || !PREDICATE_NAME.test(c.predicate)) problems.push(`'${c.predicate}' is not a predicate name (lowercase words joined by hyphens)`);
  const v = c.set ?? {};
  problems.push(...valueProblems(v, c.op === "create", enums));
  if (c.op === "create" && state.predicates.has(c.predicate)) problems.push(`'${c.predicate}' is already in the predicate catalog`);
  if (c.op === "update" && !state.predicates.has(c.predicate)) problems.push(`'${c.predicate}' is not in the predicate catalog`);
  if (problems.length) return problems;

  const catalog = state.read(state.predicatesFile);
  const map = predicateMap(catalog);
  if (c.op === "create") {
    // The sibling entries' key order.
    map[c.predicate] = {
      predicate: c.predicate,
      inverse: v.inverse,
      category: v.category,
      description: v.description,
      archimate_alignment: v.archimate_alignment ?? null,
      semantics: { directionality: v.semantics!.directionality, transitivity: v.semantics!.transitivity, symmetry: v.semantics!.symmetry, reflexivity: v.semantics!.reflexivity },
    };
    state.predicates.add(c.predicate);
    summary.push(`create predicate ${c.predicate}`);
  } else {
    const entry: Json = map[c.predicate];
    for (const key of ["description", "inverse", "category", "archimate_alignment"] as const) if (v[key] !== undefined) entry[key] = v[key];
    if (v.semantics) entry.semantics = { ...(entry.semantics ?? {}), ...v.semantics };
    summary.push(`update predicate ${c.predicate}: ${Object.keys(v).join(", ") || "no catalog values changed"}`);
  }
  state.write(state.predicatesFile, catalog);
  return [];
}
