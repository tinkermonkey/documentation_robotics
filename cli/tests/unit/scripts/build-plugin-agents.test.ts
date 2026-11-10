/**
 * The Claude Code plugin's agent copies (scripts/build-plugin-agents.ts, scripts/lib/plugin-agents.ts):
 * tool names rewritten to the plugin's server, frontmatter plugin agents can't use dropped,
 * explicit tool lists kept, LF output whatever the source's line endings, the committed copies in
 * step with their sources, and the script working when started through a symlink.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  PLUGIN_AGENTS,
  checkPluginAgents,
  manifestAgentPaths,
  toPluginAgent,
  writePluginAgents,
} from "../../../../scripts/lib/plugin-agents.ts";
import { parseAgentFrontmatterTools } from "../../../src/coding-agents/drbot-mcp.js";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const PLUGIN_DIR = join(REPO_ROOT, "integrations/claude_code");
const SCRIPT = "scripts/build-plugin-agents.ts";

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "dr-plugin-agents-"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A repo-shaped fixture with the real agent sources, plugin.json and freshly built copies. */
function fixture(name: string): string {
  const root = join(scratch, name);
  const pluginDir = join(root, "integrations/claude_code");
  mkdirSync(pluginDir, { recursive: true });
  cpSync(join(PLUGIN_DIR, "agents"), join(pluginDir, "agents"), { recursive: true });
  cpSync(join(PLUGIN_DIR, ".claude-plugin"), join(pluginDir, ".claude-plugin"), { recursive: true });
  writePluginAgents(root);
  return root;
}

/** Runs the script under this runtime from `scriptRoot` (a symlink, say) and returns its result. */
function runScript(scriptRoot: string, ...args: string[]) {
  return spawnSync(process.execPath, [join(scriptRoot, SCRIPT), ...args], { encoding: "utf8" });
}

describe("toPluginAgent", () => {
  it("renames the dr tools to the plugin server's and keeps the tool list explicit", () => {
    const out = toPluginAgent(
      "---\nname: a\ndescription: d\ntools: Bash, mcp__dr__model_show, mcp__dr\n---\nUse `mcp__dr__*` tools.\n",
      "agents/a.md"
    );
    expect(parseAgentFrontmatterTools(out)).toEqual(["Bash", "mcp__plugin_dr_dr__model_show", "mcp__plugin_dr_dr"]);
    expect(out).toContain("Use `mcp__plugin_dr_dr__*` tools.");
    expect(out).not.toMatch(/mcp__dr(__|\b)/);
  });

  it("leaves other servers' tools alone", () => {
    const out = toPluginAgent("---\nname: a\ndescription: d\ntools: mcp__drx__y, mcp__dr-other__z\n---\n", "agents/a.md");
    expect(parseAgentFrontmatterTools(out)).toEqual(["mcp__drx__y", "mcp__dr-other__z"]);
  });

  it("drops the frontmatter keys plugin agents ignore, nested values included", () => {
    const source = [
      "---",
      "name: a",
      "description: d",
      "tools: Read",
      "permissionMode: acceptEdits",
      "mcpServers:",
      "  dr:",
      "    command: dr",
      "hooks:",
      "  PreToolUse: []",
      "initialPrompt: hi",
      "model: sonnet",
      "---",
      "body",
      "",
    ].join("\n");
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(toPluginAgent(source, "agents/a.md"))![1];
    expect(frontmatter).not.toMatch(/permissionMode|mcpServers|hooks|initialPrompt|command: dr|PreToolUse/);
    expect(frontmatter).toContain("model: sonnet");
    expect(frontmatter).toContain("tools: Read");
  });

  it("refuses a source without a tools list (the plugin agent would get every tool)", () => {
    expect(() => toPluginAgent("---\nname: a\ndescription: d\n---\nbody\n", "agents/a.md")).toThrow(/no tools/);
  });

  it("writes LF from a CRLF source, the same as from an LF one", () => {
    const lf = "---\nname: a\ndescription: d\ntools: mcp__dr__x\n---\nline one\nline two\n";
    const fromCrlf = toPluginAgent(lf.replace(/\n/g, "\r\n"), "agents/a.md");
    expect(fromCrlf).not.toContain("\r");
    expect(fromCrlf).toBe(toPluginAgent(lf, "agents/a.md"));
  });
});

describe("checkPluginAgents", () => {
  it("passes a fresh build, and still passes when the checkout has CRLF line endings", () => {
    const root = fixture("crlf");
    expect(checkPluginAgents(root)).toEqual([]);
    for (const name of PLUGIN_AGENTS) {
      for (const dir of ["agents", "plugin-agents"]) {
        const path = join(root, "integrations/claude_code", dir, `${name}.md`);
        writeFileSync(path, readFileSync(path, "utf8").replace(/\n/g, "\r\n"));
      }
    }
    expect(checkPluginAgents(root)).toEqual([]);
  });

  it("reports a drifted copy, a stray file and a wrong plugin.json list", () => {
    const root = fixture("drift");
    const outDir = join(root, "integrations/claude_code/plugin-agents");
    writeFileSync(join(outDir, "dr-advisor.md"), "edited by hand\n");
    writeFileSync(join(outDir, "dr-extractor.md"), "stray\n");
    const manifest = join(root, "integrations/claude_code/.claude-plugin/plugin.json");
    writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf8")), agents: [] }));
    const problems = checkPluginAgents(root);
    expect(problems).toHaveLength(3);
    expect(problems.join("\n")).toMatch(/dr-advisor\.md differs/);
    expect(problems.join("\n")).toMatch(/dr-extractor\.md is not a plugin agent/);
    expect(problems.join("\n")).toMatch(/plugin\.json "agents"/);
  });
});

describe("build-plugin-agents.ts started through a symlink", () => {
  it("checks the repo it was started from", () => {
    const link = join(scratch, "repo-link");
    symlinkSync(REPO_ROOT, link);
    const result = runScript(link, "--check");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("plugin agents match their sources");
  });

  it("fails on drift and rebuilds", () => {
    const root = fixture("via-symlink");
    const link = join(scratch, "script-link");
    symlinkSync(REPO_ROOT, link);
    const copy = join(root, "integrations/claude_code/plugin-agents/dr-architect.md");
    writeFileSync(copy, "drifted\n");

    const check = runScript(link, "--check", "--root", root);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("dr-architect.md differs");

    const build = runScript(link, "--root", root);
    expect(build.status).toBe(0);
    expect(build.stdout).toContain("wrote integrations/claude_code/plugin-agents/dr-architect.md");
    expect(runScript(link, "--check", "--root", root).status).toBe(0);
  });
});

describe("the committed plugin agents", () => {
  it("match what the build writes from their sources", () => {
    expect(checkPluginAgents(REPO_ROOT)).toEqual([]);
  });

  it("are the agents plugin.json lists, and dr-extractor is not one of them", () => {
    const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), "utf8"));
    expect(manifest.agents).toEqual(manifestAgentPaths(REPO_ROOT));
    expect(JSON.stringify(manifest.agents)).not.toContain("dr-extractor");
  });

  it("give dr-architect the plugin server's names for every dr tool its source lists", () => {
    const sourceTools = parseAgentFrontmatterTools(readFileSync(join(PLUGIN_DIR, "agents", "dr-architect.md"), "utf8"))!;
    const pluginTools = parseAgentFrontmatterTools(
      readFileSync(join(PLUGIN_DIR, "plugin-agents", "dr-architect.md"), "utf8")
    )!;
    expect(pluginTools).toEqual(sourceTools.map((tool) => tool.replace(/^mcp__dr__/, "mcp__plugin_dr_dr__")));
    expect(pluginTools.filter((tool) => tool.startsWith("mcp__plugin_dr_dr__")).length).toBeGreaterThan(0);
  });

  it("keep dr-advisor read-only", () => {
    const tools = parseAgentFrontmatterTools(readFileSync(join(PLUGIN_DIR, "plugin-agents", "dr-advisor.md"), "utf8"));
    expect(tools).not.toBeNull();
    expect(tools).not.toContain("Bash");
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Write");
  });
});
