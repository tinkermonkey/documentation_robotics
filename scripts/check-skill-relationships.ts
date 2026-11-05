/**
 * Checks that the relationships named in the layer skills exist in the spec's
 * relationship catalog (spec/dist/{layer}.json relationshipSchemas).
 *
 * Two places are checked in each integrations/claude_code/skills/dr_NN_*_layer/SKILL.md:
 *
 * 1. Markdown tables with a "Predicate" column. The source cell (column whose header
 *    starts with "Source") and target cell (header starts with "Target") name a node type:
 *    - a bare name such as `BusinessProcess` resolves in the skill's own layer;
 *    - a dotted id such as `motivation.goal` names a type in another layer.
 *    The predicate cell holds one predicate.
 * 2. `dr relationship add <source-id> <target-id> --predicate <p>` commands whose ids
 *    are concrete element ids (`{layer}.{type}.{name}`); placeholders are skipped.
 *
 * It also checks that the github_copilot and test-project baseline copies of each
 * layer skill are byte-identical to the claude_code copy.
 *
 * Usage: npm run check:skill-relationships              (or: npx tsx scripts/check-skill-relationships.ts [--verbose])
 *        npx tsx scripts/check-skill-relationships.ts --list <layer>   (catalog types a layer's skill can use)
 * Exit code 1 when any row or command is not in the catalog, or the copies differ.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const verbose = process.argv.includes("--verbose");

const SKILL_ROOT = join(root, "integrations/claude_code/skills");
const COPIES = [
  join(root, "integrations/github_copilot/skills"),
  join(root, "cli-validation/test-project/baseline/.claude/skills")
];

const SKILL_LAYER: Record<string, string> = {
  dr_01_motivation_layer: "motivation",
  dr_02_business_layer: "business",
  dr_03_product_layer: "product",
  dr_04_security_layer: "security",
  dr_05_application_layer: "application",
  dr_06_technology_layer: "technology",
  dr_07_api_layer: "api",
  dr_08_data_model_layer: "data-model",
  dr_09_dataset_layer: "data-store",
  dr_10_ux_layer: "ux",
  dr_11_navigation_layer: "navigation",
  dr_12_apm_layer: "apm",
  dr_13_testing_layer: "testing"
};

interface RelSchema {
  source_spec_node_id: string;
  predicate: string;
  destination_spec_node_id: string;
}

// Load the catalog and the node types of every layer.
const triples = new Set<string>();
const nodeTypes = new Set<string>();
for (const layer of Object.values(SKILL_LAYER)) {
  const file = join(root, "spec/dist", `${layer}.json`);
  const data = JSON.parse(readFileSync(file, "utf8"));
  for (const id of Object.keys(data.nodeSchemas))
    nodeTypes.add(id.includes(".") ? id : `${layer}.${id}`);
  for (const r of Object.values(data.relationshipSchemas) as RelSchema[]) {
    triples.add(
      `${r.source_spec_node_id}|${r.predicate}|${r.destination_spec_node_id}`
    );
  }
}
if (verbose)
  console.log(
    `catalog: ${triples.size} relationship types, ${nodeTypes.size} node types`
  );

// --list <layer>: print the catalog types a layer's skill can draw on, then exit.
const listAt = process.argv.indexOf("--list");
if (listAt >= 0) {
  const layer = process.argv[listAt + 1];
  const groups: Record<string, string[]> = {
    intra: [],
    outgoing: [],
    incoming: []
  };
  for (const t of [...triples].sort()) {
    const [s, p, d] = t.split("|");
    const sl = s.split(".")[0];
    const dl = d.split(".")[0];
    if (sl === layer && dl === layer) groups.intra.push(`${s} --${p}--> ${d}`);
    else if (sl === layer) groups.outgoing.push(`${s} --${p}--> ${d}`);
    else if (dl === layer) groups.incoming.push(`${s} --${p}--> ${d}`);
  }
  for (const [name, rows] of Object.entries(groups)) {
    console.log(`## ${name} (${rows.length})`);
    for (const r of rows) console.log(r);
  }
  process.exit(0);
}

const errors: string[] = [];
let checkedRows = 0;
let checkedCommands = 0;

function cleanCell(cell: string): string {
  return cell.replace(/\*\*/g, "").replace(/`/g, "").trim();
}

/** Resolve a type cell to a spec node id, or return an error message. */
function resolveType(cell: string, layer: string): string | { error: string } {
  const name = cleanCell(cell);
  const id = name.includes(".")
    ? name.toLowerCase()
    : `${layer}.${name.toLowerCase()}`;
  if (!nodeTypes.has(id))
    return { error: `unknown node type "${name}" (resolved to ${id})` };
  return id;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function checkTables(file: string, layer: string, lines: string[]): void {
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i];
    if (
      !header.trim().startsWith("|") ||
      !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])
    )
      continue;
    const cols = splitRow(header).map((c) => cleanCell(c).toLowerCase());
    const p = cols.findIndex((c) => c === "predicate");
    if (p < 0) continue;
    const s = cols.findIndex((c) => c.startsWith("source"));
    const t = cols.findIndex((c) => c.startsWith("target"));
    if (s < 0 || t < 0) {
      errors.push(
        `${file}:${i + 1}: table has a Predicate column but no Source/Target column`
      );
      continue;
    }
    for (
      let j = i + 2;
      j < lines.length && lines[j].trim().startsWith("|");
      j++
    ) {
      const cells = splitRow(lines[j]);
      const where = `${file}:${j + 1}`;
      checkedRows++;
      const src = resolveType(cells[s] ?? "", layer);
      const dst = resolveType(cells[t] ?? "", layer);
      const pred = cleanCell(cells[p] ?? "");
      if (typeof src !== "string") errors.push(`${where}: source ${src.error}`);
      if (typeof dst !== "string") errors.push(`${where}: target ${dst.error}`);
      if (
        typeof src === "string" &&
        typeof dst === "string" &&
        !triples.has(`${src}|${pred}|${dst}`)
      ) {
        errors.push(`${where}: not in catalog: ${src} --${pred}--> ${dst}`);
      }
    }
  }
}

const ELEMENT_ID = /^[a-z][a-z-]*\.[a-z]+\.[a-z0-9][a-z0-9-]*$/;

function checkCommands(file: string, lines: string[]): void {
  for (let i = 0; i < lines.length; i++) {
    if (!/\bdr relationship add\b/.test(lines[i])) continue;
    let cmd = lines[i];
    let k = i;
    while (/\\\s*$/.test(cmd) && k + 1 < lines.length)
      cmd = cmd.replace(/\\\s*$/, " ") + lines[++k];
    const m = cmd.match(
      /dr relationship add\s+(\S+)\s+(\S+)\s+.*?--predicate[ =](\S+)/
    );
    if (!m) continue;
    const [, a, b, pred] = m;
    if (!ELEMENT_ID.test(a) || !ELEMENT_ID.test(b)) continue; // placeholders such as <source>
    checkedCommands++;
    const src = a.split(".").slice(0, 2).join(".");
    const dst = b.split(".").slice(0, 2).join(".");
    if (!triples.has(`${src}|${pred}|${dst}`)) {
      errors.push(
        `${file}:${i + 1}: command not in catalog: ${src} --${pred}--> ${dst}`
      );
    }
  }
}

for (const dir of readdirSync(SKILL_ROOT).sort()) {
  const layer = SKILL_LAYER[dir];
  if (!layer) continue;
  const rel = `integrations/claude_code/skills/${dir}/SKILL.md`;
  const text = readFileSync(join(SKILL_ROOT, dir, "SKILL.md"), "utf8");
  const lines = text.split("\n");
  const before = errors.length;
  checkTables(rel, layer, lines);
  checkCommands(rel, lines);
  for (const copyRoot of COPIES) {
    const copy = join(copyRoot, dir, "SKILL.md");
    if (!existsSync(copy) || readFileSync(copy, "utf8") !== text) {
      errors.push(`${copy.slice(root.length + 1)}: differs from ${rel}`);
    }
  }
  if (verbose) console.log(`${dir}: ${errors.length - before} problem(s)`);
}

for (const e of errors) console.error(e);
console.log(
  `checked ${checkedRows} table rows and ${checkedCommands} commands: ${errors.length} problem(s)`
);
process.exit(errors.length ? 1 : 0);
