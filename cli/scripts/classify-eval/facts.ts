/**
 * Add Tier-0 structural facts to an existing corpus's cards, without resampling them.
 *
 *   bun facts.ts --corpus fastapi
 *
 * Reads data/<corpus>/meta.json (root, project) and cards.jsonl, queries the codebase-memory
 * graph once per fact, and writes data/<corpus>/facts.jsonl, one row per card:
 *
 *   decorators       decorator texts on the symbol, as written ("@GetMapping(\"/owners\")")
 *   decorator_names  the same, reduced to the decorator's name ("GetMapping", "router.get")
 *   file_importers   distinct other files that import the card's file (reuse)
 *   methods          methods the symbol defines (DEFINES_METHOD), for classes
 *   usage_files      distinct other files that use the symbol (USAGE edges into it)
 *
 * Cards stay as they were so the gold labels remain valid; the facts are a separate file the
 * Tier-0 rules (lib/tier0.ts) and the state renderer read when asked to.
 */
import path from "node:path";
import { CbmSession } from "./lib/cbm.js";
import { corpusDir, flagStr, parseFlags, readJson, readJsonl, writeJsonl } from "./lib/io.js";
import type { Card, Facts } from "./lib/types.js";

/** "@field_validator(\"X\", mode=\"before\")" -> "field_validator"; "@router.get('/')" -> "router.get". */
export function decoratorName(text: string): string {
  return text.trim().replace(/^@/, "").replace(/\s*#.*$/, "").replace(/\(.*$/s, "").trim();
}

function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== "string" || !v.trim()) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const corpus = flagStr(flags, "corpus");
  if (!corpus) {
    console.error("Usage: bun facts.ts --corpus <name>");
    process.exit(2);
  }
  const dir = corpusDir(corpus);
  const meta = readJson<{ root?: string; project?: string }>(path.join(dir, "meta.json"), {});
  if (!meta.root) throw new Error(`${dir}/meta.json has no root`);
  const cards = readJsonl<Card>(path.join(dir, "cards.jsonl"));

  const cbm = new CbmSession();
  await cbm.open();
  try {
    const project = await cbm.ensureIndexed(meta.root);
    const full = (qn: string) => `${project}.${qn}`;

    const decorators = new Map<string, string[]>();
    for (const [qn, decs] of await cbm.query("MATCH (b) WHERE b.decorators IS NOT NULL RETURN b.qualified_name, b.decorators")) {
      if (typeof qn === "string") decorators.set(qn, parseList(decs));
    }
    const importers = new Map<string, Set<string>>();
    for (const [afile, bfile] of await cbm.query("MATCH (a)-[r:IMPORTS]->(b) RETURN a.file_path, b.file_path")) {
      if (typeof afile !== "string" || typeof bfile !== "string" || !bfile || afile === bfile) continue;
      if (!importers.has(bfile)) importers.set(bfile, new Set());
      importers.get(bfile)!.add(afile);
    }
    const methods = new Map<string, number>();
    for (const [a] of await cbm.query("MATCH (a)-[r:DEFINES_METHOD]->(m) RETURN a.qualified_name, m.qualified_name")) {
      if (typeof a === "string") methods.set(a, (methods.get(a) ?? 0) + 1);
    }
    const usage = new Map<string, Set<string>>();
    for (const [afile, b, bfile] of await cbm.query("MATCH (a)-[r:USAGE]->(b) RETURN a.file_path, b.qualified_name, b.file_path")) {
      if (typeof afile !== "string" || typeof b !== "string" || afile === bfile) continue;
      if (!usage.has(b)) usage.set(b, new Set());
      usage.get(b)!.add(afile);
    }

    const rows: Facts[] = cards.map((c) => {
      const decs = decorators.get(full(c.qualified_name)) ?? [];
      return {
        card_id: c.id,
        decorators: decs,
        decorator_names: decs.map(decoratorName),
        file_importers: c.file_path ? (importers.get(c.file_path)?.size ?? 0) : 0,
        methods: methods.get(full(c.qualified_name)) ?? 0,
        usage_files: usage.get(full(c.qualified_name))?.size ?? 0,
      };
    });
    writeJsonl(path.join(dir, "facts.jsonl"), rows);
    const decorated = rows.filter((r) => r.decorators.length).length;
    console.log(`${corpus}: facts for ${rows.length} cards (${decorated} decorated, ${rows.filter((r) => r.file_importers > 0).length} in imported files) -> ${path.relative(process.cwd(), path.join(dir, "facts.jsonl"))}`);
  } finally {
    await cbm.close();
  }
}

if (import.meta.main) main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
