/**
 * Writes or checks the Claude Code plugin's copies of the DR agents (see plugin-agents.ts).
 *
 * Usage: npm run build:plugin-agents   (write the copies)
 *        npm run check:plugin-agents   (exit 1 when a copy or plugin.json has drifted)
 *        npx tsx scripts/build-plugin-agents.ts [--check] [--root <repo>]
 *
 * This file is only an entry point: it always runs, whatever path (a symlink, say) started it.
 */
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_AGENTS, checkPluginAgents, writePluginAgents } from "./plugin-agents.ts";

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const root =
  rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), "..") : resolve(args[rootIndex + 1] ?? ".");
const check = args.includes("--check");

if (!check) {
  for (const path of writePluginAgents(root)) console.log(`wrote ${relative(root, path)}`);
}
const problems = checkPluginAgents(root);
if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  console.error("Run npm run build:plugin-agents and commit the result.");
  process.exit(1);
}
if (check) console.log(`✓ plugin agents match their sources (${PLUGIN_AGENTS.join(", ")})`);
