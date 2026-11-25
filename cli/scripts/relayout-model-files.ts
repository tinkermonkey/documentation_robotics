/**
 * Lay a model's element files out as dr writes them, data unchanged.
 *
 * The same step project_upgrade and `dr upgrade` run (src/core/model-relayout.ts, #1439); kept for
 * running it on a project by path. A file written by an earlier dr (long strings folded at 80
 * columns) or by prettier settles into dr's layout the first time dr writes a real change to it,
 * and that one commit mixes the change with a re-layout of the whole file. Running this once, in a
 * commit of its own, takes that noise out of every later diff.
 *
 * Usage (from cli/):
 *   bun run scripts/relayout-model-files.ts [project-root] [--check]
 *
 * --check writes nothing and exits 1 when a file is not in dr's layout.
 */

import { resolve } from "node:path";
import { relayoutModelFiles } from "../src/core/model-relayout.js";

const args = process.argv.slice(2);
const check = args.includes("--check");
const root = resolve(args.find((arg) => !arg.startsWith("--")) ?? "..");

const result = await relayoutModelFiles(root, { dryRun: check });
for (const file of result.files) console.log(`${check ? "not in dr's layout" : "re-laid out"}: ${file}`);
for (const { file, reason } of result.skipped) console.log(`left alone: ${file}: ${reason}`);
console.log(`${result.files.length} of ${result.total} element file(s) ${check ? "are not in" : "rewritten in"} dr's layout`);
if (check && result.files.length > 0) process.exit(1);
