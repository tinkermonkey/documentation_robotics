/**
 * Generate the spec catalog history: which released spec versions had each node type and each
 * relationship type. The CLI bundles only its own spec, so without it a model that declares an
 * older spec is checked against a catalog newer than its own, and a type or relationship that only
 * a later spec has can land in it (#1411). src/core/declared-spec.ts reads the table to refuse it.
 *
 *   bun scripts/generate-spec-catalog-history.ts           (from cli/) write the table
 *   bun scripts/generate-spec-catalog-history.ts --check   exit 1 if the committed table is stale
 *
 * Inputs: git history. For every spec version before the one in spec/VERSION whose compiled
 * catalog (spec/dist) is in git (0.8.1 on), its released state: the tag spec-v<version> when there
 * is one, else the main-line commit just before spec/VERSION moved past it. The current version is
 * not in the table: its catalog is the one the CLI bundles.
 *
 * Output: cli/src/core/spec-catalog-history.ts. `versions` lists the versions oldest first, and
 * each type (`layer.type`) and relationship (`source.predicate.destination`) any of them had maps
 * to a mask with one character per version, "1" where that version has it. An id the table does not
 * name was in none of them.
 *
 * Run it after a spec release: the unit test for declared-spec.ts fails while the table lacks the
 * version before the bundled one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cliDir, "..");
const outputPath = path.join(cliDir, "src", "core", "spec-catalog-history.ts");

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitOrNull(...args: string[]): string | null {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The commit holding each released version's catalog, oldest version first. */
function releasedStates(current: string): Array<{ version: string; rev: string }> {
  // Main-line commits that moved spec/VERSION, newest first
  const bumps = git("log", "--first-parent", "--format=%H", "HEAD", "--", "spec/VERSION")
    .split("\n")
    .filter(Boolean)
    .map((sha) => ({ sha, version: (gitOrNull("show", `${sha}:spec/VERSION`) ?? "").trim() }))
    .filter((bump) => bump.version);

  const states = new Map<string, string>();
  bumps.forEach((bump, index) => {
    const { version } = bump;
    if (states.has(version) || compareVersions(version, current) >= 0) return;
    const tag = `spec-v${version}`;
    let rev: string | null = gitOrNull("rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`)?.trim() || null;
    if (!rev) {
      // The state just before the next version's bump on the main line
      const next = bumps[index - 1];
      const before = next ? `${next.sha}^1` : null;
      rev = before && (gitOrNull("show", `${before}:spec/VERSION`) ?? "").trim() === version ? before : bump.sha;
    }
    if (gitOrNull("cat-file", "-e", `${rev}:spec/dist/manifest.json`) === null) return;
    states.set(version, git("rev-parse", rev).trim());
  });
  return [...states]
    .map(([version, rev]) => ({ version, rev }))
    .sort((a, b) => compareVersions(a.version, b.version));
}

interface Catalog {
  types: Set<string>;
  relationships: Set<string>;
}

function catalogAt(rev: string): Catalog {
  const manifest = JSON.parse(git("show", `${rev}:spec/dist/manifest.json`)) as { layers: Array<{ id: string }> };
  const types = new Set<string>();
  const relationships = new Set<string>();
  for (const { id: layer } of manifest.layers) {
    const data = JSON.parse(git("show", `${rev}:spec/dist/${layer}.json`)) as {
      nodeSchemas?: Record<string, unknown>;
      relationshipSchemas?: Record<
        string,
        { source_spec_node_id?: string; predicate?: string; destination_spec_node_id?: string }
      >;
    };
    for (const type of Object.keys(data.nodeSchemas ?? {})) types.add(`${layer}.${type}`);
    for (const [key, schema] of Object.entries(data.relationshipSchemas ?? {})) {
      const { source_spec_node_id: source, predicate, destination_spec_node_id: destination } = schema;
      relationships.add(source && predicate && destination ? `${source}.${predicate}.${destination}` : key);
    }
  }
  return { types, relationships };
}

function masks(versions: Catalog[], pick: (catalog: Catalog) => Set<string>): Record<string, string> {
  const all = new Set<string>();
  for (const catalog of versions) for (const id of pick(catalog)) all.add(id);
  const out: Record<string, string> = {};
  for (const id of [...all].sort()) out[id] = versions.map((catalog) => (pick(catalog).has(id) ? "1" : "0")).join("");
  return out;
}

const current = readFileSync(path.join(repoRoot, "spec", "VERSION"), "utf-8").trim();
const states = releasedStates(current);
const catalogs = states.map((state) => catalogAt(state.rev));

const table = {
  versions: states.map((state) => state.version),
  types: masks(catalogs, (catalog) => catalog.types),
  relationships: masks(catalogs, (catalog) => catalog.relationships),
};

const text =
  `/**
 * GENERATED by cli/scripts/generate-spec-catalog-history.ts. Do not edit by hand.
 *
 * Which released spec versions before ${current} had each node type and relationship type: one
 * mask character per entry of versions, "1" where that version has it. Read by declared-spec.ts.
 * Built from ${states.map((state) => `${state.version} (${state.rev.slice(0, 8)})`).join(", ")}.
 */
import type { SpecCatalogHistory } from "./declared-spec.js";

export const SPEC_CATALOG_HISTORY: SpecCatalogHistory = ${JSON.stringify(table, null, 2)};
`;

if (process.argv.includes("--check")) {
  const committed = readFileSync(outputPath, "utf-8");
  if (committed !== text) {
    console.error(`${path.relative(repoRoot, outputPath)} is stale: run bun scripts/generate-spec-catalog-history.ts`);
    process.exit(1);
  }
  console.log(`${path.relative(repoRoot, outputPath)} is current`);
} else {
  writeFileSync(outputPath, text);
  console.log(
    `Wrote ${path.relative(repoRoot, outputPath)}: ${table.versions.length} versions (${table.versions.join(", ")}), ` +
      `${Object.keys(table.types).length} types, ${Object.keys(table.relationships).length} relationship types`
  );
}
