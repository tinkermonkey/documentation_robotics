/**
 * Writes the Claude Code plugin's copies of the DR agents.
 *
 * The sources live in integrations/claude_code/agents/. `dr claude install` copies them into a
 * project's .claude/agents, where DrBot runs dr-architect against an MCP server named `dr`, so the
 * sources name the dr tools `mcp__dr__<tool>`. Inside the plugin the same server's tools are named
 * `mcp__plugin_dr_dr__<tool>`, and plugin agents ignore some frontmatter keys. This script writes
 * integrations/claude_code/plugin-agents/<agent>.md from each source:
 *
 * - every `mcp__dr__<tool>` (and a server-wide `mcp__dr`) becomes `mcp__plugin_dr_dr__<tool>`;
 * - frontmatter keys plugin agents can't use (hooks, mcpServers, permissionMode, initialPrompt)
 *   are dropped;
 * - the explicit `tools:` list is kept, so a read-only agent stays read-only. A source without
 *   one is an error: a plugin agent with no `tools:` gets every tool.
 *
 * It also checks that plugin.json's `agents` lists exactly these copies.
 *
 * Usage: npm run build:plugin-agents   (write the copies)
 *        npm run check:plugin-agents   (exit 1 when a copy or plugin.json has drifted)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = join(root, "integrations/claude_code");
const SOURCE_DIR = join(PLUGIN_DIR, "agents");
const OUT_DIR = join(PLUGIN_DIR, "plugin-agents");
const MANIFEST = join(PLUGIN_DIR, ".claude-plugin/plugin.json");

/** Agents the plugin ships. dr-extractor stays out: codebase_extract replaces it. */
export const PLUGIN_AGENTS = ["dr-architect", "dr-advisor"] as const;

/** Frontmatter keys Claude Code ignores in plugin agents. */
export const UNSUPPORTED_PLUGIN_AGENT_KEYS = ["hooks", "mcpServers", "permissionMode", "initialPrompt"];

/** The dr server's tool prefix in a project (`dr` server) and in the plugin. */
const PROJECT_PREFIX = "mcp__dr";
const PLUGIN_PREFIX = "mcp__plugin_dr_dr";

/** Builds the plugin copy of one agent from its source markdown. Throws on a source it can't use. */
export function toPluginAgent(source: string, sourcePath: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (!match) throw new Error(`${sourcePath}: no frontmatter`);

  const kept: string[] = [];
  let skipping = false;
  for (const line of match[1].split(/\r?\n/)) {
    const key = /^([A-Za-z][\w-]*)\s*:/.exec(line);
    if (key) skipping = UNSUPPORTED_PLUGIN_AGENT_KEYS.includes(key[1]);
    else if (!/^\s/.test(line) && line.trim() !== "") skipping = false;
    if (!skipping) kept.push(line);
  }
  if (!kept.some((line) => /^tools\s*:/.test(line))) {
    throw new Error(`${sourcePath}: no tools: list; a plugin agent without one gets every tool`);
  }

  const header = `# Generated from agents/${sourcePath.split("/").pop()} by scripts/build-plugin-agents.ts. Edit the source, then run npm run build:plugin-agents.`;
  const body = source.slice(match[0].length);
  const out = `---\n${header}\n${kept.join("\n")}\n---\n${body}`;
  // `mcp__dr` followed by `__<tool>` or by the end of a word; never `mcp__drx`.
  return out.replace(new RegExp(`${PROJECT_PREFIX}(?=__|[^\\w-]|$)`, "gm"), PLUGIN_PREFIX);
}

/** plugin.json's expected `agents` entry. */
export function manifestAgentPaths(): string[] {
  return PLUGIN_AGENTS.map((name) => `./${relative(PLUGIN_DIR, join(OUT_DIR, `${name}.md`))}`);
}

function main(): void {
  const check = process.argv.includes("--check");
  const problems: string[] = [];

  if (!check) mkdirSync(OUT_DIR, { recursive: true });
  for (const name of PLUGIN_AGENTS) {
    const sourcePath = join(SOURCE_DIR, `${name}.md`);
    const outPath = join(OUT_DIR, `${name}.md`);
    const expected = toPluginAgent(readFileSync(sourcePath, "utf8"), relative(root, sourcePath));
    if (check) {
      const actual = existsSync(outPath) ? readFileSync(outPath, "utf8") : null;
      if (actual === null) problems.push(`${relative(root, outPath)} is missing`);
      else if (actual !== expected) problems.push(`${relative(root, outPath)} differs from ${relative(root, sourcePath)}`);
    } else {
      writeFileSync(outPath, expected);
      console.log(`wrote ${relative(root, outPath)}`);
    }
  }

  if (existsSync(OUT_DIR)) {
    const wanted = new Set(PLUGIN_AGENTS.map((name) => `${name}.md`));
    for (const file of readdirSync(OUT_DIR)) {
      if (!wanted.has(file)) problems.push(`${relative(root, join(OUT_DIR, file))} is not a plugin agent; remove it`);
    }
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { agents?: unknown };
  const expectedAgents = manifestAgentPaths();
  if (JSON.stringify(manifest.agents) !== JSON.stringify(expectedAgents)) {
    problems.push(`${relative(root, MANIFEST)} "agents" should be ${JSON.stringify(expectedAgents)}`);
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    console.error("Run npm run build:plugin-agents and commit the result.");
    process.exit(1);
  }
  if (check) console.log(`✓ plugin agents match their sources (${PLUGIN_AGENTS.join(", ")})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
