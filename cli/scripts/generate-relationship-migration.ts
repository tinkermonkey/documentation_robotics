/**
 * Generate the relationship rewrite table used by the `dr upgrade` model migration.
 *
 *   bun scripts/generate-relationship-migration.ts           (from cli/) write the table
 *   bun scripts/generate-relationship-migration.ts --check   exit 1 if the committed table is stale
 *
 * Inputs: every applied-*.json change record under cli/scripts/spec-enrich/data (the reflection
 * tiers written by spec-enrich/apply-reflect-plan.ts, and applied-implements.json), oldest
 * applied_at first, plus the current catalog in spec/dist. Each record lists actions:
 *
 *   rename | create | delete   {from: <old triple>, to: <new triple> | null, kind}
 *       A model relationship with the old triple becomes the new one. When the new triple runs
 *       the other way (kind "reverse", or source and destination types swapped) the relationship's
 *       source and target swap. A "to" with a different source or destination type is a retarget,
 *       which cannot be migrated mechanically, and stops the generator.
 *   retire-predicate           {from: <predicate>, to: <predicate>}
 *       Every model relationship with the old predicate takes the new one, on the same pair.
 *
 * Rules are composed across records (a triple renamed in one tier and removed in a later one maps
 * straight to the final triple), rows whose note starts with "skipped" are ignored, and every
 * final triple must exist in the current catalog.
 *
 * Output: cli/src/core/relationship-migration-table.ts, read by src/core/relationship-migration.ts.
 */
import path from "node:path";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  RelationshipRewriteRule,
  RelationshipRewriteTable,
} from "../src/core/relationship-migration.js";

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cliDir, "..");
export const RECORDS_DIR = path.join(cliDir, "scripts", "spec-enrich", "data");
export const CATALOG_DIR = path.join(repoRoot, "spec", "dist");
export const OUTPUT_FILE = path.join(cliDir, "src", "core", "relationship-migration-table.ts");

export interface ChangeAction {
  action: "rename" | "create" | "delete" | "retire-predicate";
  kind?: string;
  from: string;
  to: string | null;
  note?: string;
}

export interface ChangeRecord {
  /** Path relative to the repository root */
  file: string;
  record: string;
  applied_at: string;
  actions: ChangeAction[];
}

interface Triple {
  source: string;
  predicate: string;
  destination: string;
}

function parseTriple(id: string): Triple {
  const parts = id.split(".");
  if (parts.length !== 5 || parts.some((p) => p.length === 0)) {
    throw new Error(
      `'${id}' is not a {layer}.{type}.{predicate}.{layer}.{type} relationship triple`
    );
  }
  return {
    source: `${parts[0]}.${parts[1]}`,
    predicate: parts[2],
    destination: `${parts[3]}.${parts[4]}`,
  };
}

function isSwap(action: ChangeAction, from: Triple, to: Triple): boolean {
  const samePair = from.source === to.source && from.destination === to.destination;
  const reversedPair = from.source === to.destination && from.destination === to.source;
  if (action.kind === "reverse" && reversedPair) {
    return true;
  }
  if (action.kind !== "reverse" && samePair) {
    return false;
  }
  if (reversedPair) {
    return true;
  }
  throw new Error(
    `${action.from} -> ${action.to}: the replacement has a different source or destination type ` +
      `(a retarget), which a model migration cannot apply mechanically`
  );
}

function withPredicate(triple: string, predicate: string): string {
  const t = parseTriple(triple);
  return `${t.source}.${predicate}.${t.destination}`;
}

/** Load every applied-*.json under dir, oldest applied_at first */
export function loadChangeRecords(dir: string = RECORDS_DIR): ChangeRecord[] {
  const files = (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /(^|\/)applied-[^/]+\.json$/.test(f) && !f.includes("node_modules"))
    .sort();
  return files
    .map((f) => {
      const full = path.join(dir, f);
      const data = JSON.parse(readFileSync(full, "utf-8"));
      if (!Array.isArray(data.actions)) {
        throw new Error(`${full}: no actions list`);
      }
      return {
        file: path.relative(repoRoot, full),
        record: data.record ?? path.basename(f, ".json"),
        applied_at: data.applied_at ?? "",
        actions: data.actions as ChangeAction[],
      };
    })
    .sort((a, b) => a.applied_at.localeCompare(b.applied_at) || a.file.localeCompare(b.file));
}

/** Every source.predicate.destination triple in the compiled spec */
export function loadCatalogTriples(dir: string = CATALOG_DIR): Set<string> {
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf-8"));
  const triples = new Set<string>();
  for (const { id } of manifest.layers as Array<{ id: string }>) {
    const layerFile = path.join(dir, `${id}.json`);
    if (!existsSync(layerFile)) {
      continue;
    }
    const layer = JSON.parse(readFileSync(layerFile, "utf-8"));
    for (const schema of Object.values(layer.relationshipSchemas ?? {}) as Array<{
      source_spec_node_id: string;
      predicate: string;
      destination_spec_node_id: string;
    }>) {
      triples.add(
        `${schema.source_spec_node_id}.${schema.predicate}.${schema.destination_spec_node_id}`
      );
    }
  }
  return triples;
}

export interface BuildResult {
  table: RelationshipRewriteTable;
  warnings: string[];
}

export function buildRewriteTable(records: ChangeRecord[], catalog: Set<string>): BuildResult {
  const triples = new Map<string, RelationshipRewriteRule>();
  const predicateRenames = new Map<string, string>();
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const record of records) {
    for (const action of record.actions) {
      if (action.note?.startsWith("skipped")) {
        warnings.push(`${record.record}: ${action.from} ignored (${action.note})`);
        continue;
      }

      if (action.action === "retire-predicate") {
        if (!action.to) {
          errors.push(`${record.record}: retiring predicate '${action.from}' needs a replacement`);
          continue;
        }
        const replacement = action.to;
        for (const [old, current] of predicateRenames) {
          if (current === action.from) {
            predicateRenames.set(old, replacement);
          }
        }
        predicateRenames.set(action.from, replacement);
        for (const [key, rule] of triples) {
          if (rule.to && parseTriple(rule.to).predicate === action.from) {
            triples.set(key, {
              ...rule,
              to: withPredicate(rule.to, replacement),
              records: [...rule.records, record.record],
            });
          }
        }
        continue;
      }

      const from = parseTriple(action.from);
      const rule: RelationshipRewriteRule = action.to
        ? { to: action.to, swap: isSwap(action, from, parseTriple(action.to)), records: [record.record] }
        : { to: null, swap: false, records: [record.record] };

      // Earlier rules that ended at this triple now continue to its replacement
      for (const [key, earlier] of triples) {
        if (earlier.to === action.from) {
          triples.set(key, {
            to: rule.to,
            swap: earlier.swap !== rule.swap,
            records: [...earlier.records, record.record],
          });
        }
      }
      if (triples.has(action.from)) {
        warnings.push(`${record.record}: ${action.from} already had a rule; the later record wins`);
      }
      triples.set(action.from, rule);
    }
  }

  for (const [key, rule] of triples) {
    if (catalog.has(key)) {
      warnings.push(`${key} is still in the catalog; no rewrite generated`);
      triples.delete(key);
    } else if (rule.to !== null && !catalog.has(rule.to)) {
      errors.push(`${key} -> ${rule.to}: the replacement is not in the current catalog`);
    }
  }
  for (const [old, replacement] of predicateRenames) {
    const stillUsed = [...catalog].filter((t) => parseTriple(t).predicate === old);
    if (stillUsed.length > 0) {
      errors.push(`predicate '${old}' is retired but still used by ${stillUsed.length} catalog triples`);
    }
    if (![...catalog].some((t) => parseTriple(t).predicate === replacement)) {
      warnings.push(`replacement predicate '${replacement}' is not used by any catalog triple`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Cannot build the relationship rewrite table:\n  ${errors.join("\n  ")}`);
  }

  const sortedEntries = <T>(map: Map<string, T>) =>
    Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));

  return {
    table: {
      sources: records.map((r) => r.file),
      predicateRenames: sortedEntries(predicateRenames),
      triples: sortedEntries(triples),
    },
    warnings,
  };
}

export function renderTable(table: RelationshipRewriteTable): string {
  return `/**
 * GENERATED by cli/scripts/generate-relationship-migration.ts. Do not edit by hand.
 *
 * Built from the applied-*.json change records under cli/scripts/spec-enrich/data and the
 * catalog in spec/dist. To extend the migration with a later change set, add its record there
 * and run, from cli/:
 *
 *   bun scripts/generate-relationship-migration.ts
 */
import type { RelationshipRewriteTable } from "./relationship-migration.js";

export const RELATIONSHIP_REWRITE_TABLE: RelationshipRewriteTable = ${JSON.stringify(table, null, 2)};
`;
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const { table, warnings } = buildRewriteTable(loadChangeRecords(), loadCatalogTriples());
  for (const warning of warnings) {
    console.warn(`warning: ${warning}`);
  }
  const rendered = renderTable(table);
  const current = existsSync(OUTPUT_FILE) ? readFileSync(OUTPUT_FILE, "utf-8") : "";
  const summary =
    `${Object.keys(table.triples).length} triple rules, ` +
    `${Object.keys(table.predicateRenames).length} predicate renames from ${table.sources.length} records`;

  if (check) {
    if (rendered !== current) {
      console.error(`${path.relative(repoRoot, OUTPUT_FILE)} is stale; run without --check to regenerate`);
      process.exit(1);
    }
    console.log(`up to date (${summary})`);
  } else if (rendered === current) {
    console.log(`unchanged (${summary})`);
  } else {
    writeFileSync(OUTPUT_FILE, rendered);
    console.log(`wrote ${path.relative(repoRoot, OUTPUT_FILE)} (${summary})`);
  }
}
