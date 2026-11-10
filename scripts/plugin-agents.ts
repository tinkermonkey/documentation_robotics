/**
 * The Claude Code plugin's copies of the DR agents (run by scripts/build-plugin-agents.ts).
 *
 * The sources live in integrations/claude_code/agents/. `dr claude install` copies them into a
 * project's .claude/agents, where DrBot runs dr-architect against an MCP server named `dr`, so the
 * sources name the dr tools `mcp__dr__<tool>`. Inside the plugin the same server's tools are named
 * `mcp__plugin_dr_dr__<tool>`, and plugin agents ignore some frontmatter keys. The plugin copy of
 * each source goes to integrations/claude_code/plugin-agents/<agent>.md:
 *
 * - every `mcp__dr__<tool>` (and a server-wide `mcp__dr`) becomes `mcp__plugin_dr_dr__<tool>`;
 * - frontmatter keys plugin agents can't use (hooks, mcpServers, permissionMode, initialPrompt)
 *   are dropped;
 * - the explicit `tools:` list is kept, so a read-only agent stays read-only. A source without
 *   one is an error: a plugin agent with no `tools:` gets every tool.
 *
 * Copies are written with LF line endings and compared after converting to LF, so a CRLF
 * checkout neither breaks the build nor fails the check.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Agents the plugin ships. dr-extractor stays out: codebase_extract replaces it. */
export const PLUGIN_AGENTS = ["dr-architect", "dr-advisor"] as const;

/** Frontmatter keys Claude Code ignores in plugin agents. */
export const UNSUPPORTED_PLUGIN_AGENT_KEYS = ["hooks", "mcpServers", "permissionMode", "initialPrompt"];

/** The dr server's tool prefix in a project (`dr` server) and in the plugin. */
const PROJECT_PREFIX = "mcp__dr";
const PLUGIN_PREFIX = "mcp__plugin_dr_dr";

/** Paths under a repo root. */
export function pluginPaths(root: string) {
  const pluginDir = join(root, "integrations/claude_code");
  return {
    pluginDir,
    sourceDir: join(pluginDir, "agents"),
    outDir: join(pluginDir, "plugin-agents"),
    manifest: join(pluginDir, ".claude-plugin/plugin.json"),
  };
}

const toLf = (text: string) => text.replace(/\r\n?/g, "\n");

/** Builds the plugin copy of one agent from its source markdown. Throws on a source it can't use. */
export function toPluginAgent(source: string, sourcePath: string): string {
  const text = toLf(source);
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error(`${sourcePath}: no frontmatter`);

  const kept: string[] = [];
  let skipping = false;
  for (const line of match[1].split("\n")) {
    const key = /^([A-Za-z][\w-]*)\s*:/.exec(line);
    if (key) skipping = UNSUPPORTED_PLUGIN_AGENT_KEYS.includes(key[1]);
    else if (!/^\s/.test(line) && line.trim() !== "") skipping = false;
    if (!skipping) kept.push(line);
  }
  if (!kept.some((line) => /^tools\s*:/.test(line))) {
    throw new Error(`${sourcePath}: no tools: list; a plugin agent without one gets every tool`);
  }

  const header = `# Generated from agents/${sourcePath.split("/").pop()} by scripts/build-plugin-agents.ts. Edit the source, then run npm run build:plugin-agents.`;
  const body = text.slice(match[0].length);
  const out = `---\n${header}\n${kept.join("\n")}\n---\n${body}`;
  // `mcp__dr` followed by `__<tool>` or by the end of a word; never `mcp__drx`.
  return out.replace(new RegExp(`${PROJECT_PREFIX}(?=__|[^\\w-]|$)`, "gm"), PLUGIN_PREFIX);
}

/** plugin.json's expected `agents` entry. */
export function manifestAgentPaths(root: string): string[] {
  const { pluginDir, outDir } = pluginPaths(root);
  return PLUGIN_AGENTS.map((name) => `./${relative(pluginDir, join(outDir, `${name}.md`))}`);
}

/** Writes every plugin copy (LF line endings). Returns the paths written. */
export function writePluginAgents(root: string): string[] {
  const { sourceDir, outDir } = pluginPaths(root);
  mkdirSync(outDir, { recursive: true });
  return PLUGIN_AGENTS.map((name) => {
    const sourcePath = join(sourceDir, `${name}.md`);
    const outPath = join(outDir, `${name}.md`);
    writeFileSync(outPath, toPluginAgent(readFileSync(sourcePath, "utf8"), relative(root, sourcePath)));
    return outPath;
  });
}

/** What has drifted: copies that differ from their sources, stray files, plugin.json's list. */
export function checkPluginAgents(root: string): string[] {
  const { sourceDir, outDir, manifest } = pluginPaths(root);
  const problems: string[] = [];

  for (const name of PLUGIN_AGENTS) {
    const sourcePath = join(sourceDir, `${name}.md`);
    const outPath = join(outDir, `${name}.md`);
    const expected = toPluginAgent(readFileSync(sourcePath, "utf8"), relative(root, sourcePath));
    if (!existsSync(outPath)) problems.push(`${relative(root, outPath)} is missing`);
    else if (toLf(readFileSync(outPath, "utf8")) !== expected) {
      problems.push(`${relative(root, outPath)} differs from ${relative(root, sourcePath)}`);
    }
  }

  if (existsSync(outDir)) {
    const wanted = new Set(PLUGIN_AGENTS.map((name) => `${name}.md`));
    for (const file of readdirSync(outDir)) {
      if (!wanted.has(file)) problems.push(`${relative(root, join(outDir, file))} is not a plugin agent; remove it`);
    }
  }

  const agents = (JSON.parse(readFileSync(manifest, "utf8")) as { agents?: unknown }).agents;
  const expectedAgents = manifestAgentPaths(root);
  if (JSON.stringify(agents) !== JSON.stringify(expectedAgents)) {
    problems.push(`${relative(root, manifest)} "agents" should be ${JSON.stringify(expectedAgents)}`);
  }
  return problems;
}
