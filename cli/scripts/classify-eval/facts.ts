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
 * Tier-0 rules (lib/tier0.ts) and the state renderer read when asked to. The facts are computed
 * by the CLI's card module (src/analyzers/cards/facts.ts), as `dr analyzer classify` does.
 */
import path from "node:path";
import { CbmSession } from "./lib/cbm.js";
import { buildFactsIndex, factsFor } from "../../src/analyzers/cards/index.js";
import { corpusDir, flagStr, parseFlags, readJson, readJsonl, writeJsonl } from "./lib/io.js";
import type { Card, Facts } from "./lib/types.js";

export { decoratorName } from "../../src/analyzers/cards/index.js";

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
    const idx = await buildFactsIndex(cbm.graph());
    // Harness cards keep the project prefix stripped; facts are keyed by the full name, which for a
    // route has no prefix.
    const full = (qn: string) => (qn.startsWith("__route__") ? qn : `${project}.${qn}`);
    const rows: Facts[] = cards.map((c) => ({ card_id: c.id, ...factsFor(idx, full(c.qualified_name), c.file_path) }));
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
