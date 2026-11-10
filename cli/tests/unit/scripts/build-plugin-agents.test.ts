/**
 * The Claude Code plugin's agent copies (scripts/build-plugin-agents.ts): tool names rewritten to
 * the plugin's server, frontmatter plugin agents can't use dropped, explicit tool lists kept, and
 * the committed copies in step with their sources.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PLUGIN_AGENTS,
  manifestAgentPaths,
  toPluginAgent,
} from "../../../../scripts/build-plugin-agents.ts";
import { parseAgentFrontmatterTools } from "../../../src/coding-agents/drbot-mcp.js";

const PLUGIN_DIR = resolve(import.meta.dir, "../../../../integrations/claude_code");

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
});

describe("the committed plugin agents", () => {
  it("match what the build writes from their sources", () => {
    for (const name of PLUGIN_AGENTS) {
      const source = readFileSync(join(PLUGIN_DIR, "agents", `${name}.md`), "utf8");
      const copy = readFileSync(join(PLUGIN_DIR, "plugin-agents", `${name}.md`), "utf8");
      expect(copy).toBe(toPluginAgent(source, `integrations/claude_code/agents/${name}.md`));
    }
  });

  it("are the agents plugin.json lists, and dr-extractor is not one of them", () => {
    const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), "utf8"));
    expect(manifest.agents).toEqual(manifestAgentPaths());
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
