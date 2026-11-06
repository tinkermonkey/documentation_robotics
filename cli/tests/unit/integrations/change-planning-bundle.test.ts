/**
 * The change-planning integration (/dr-plan and the dr_change_planning skill) walks the loop in
 * docs/CHANGE_MODELING.md through the dr MCP server. These tests keep it honest: every MCP tool it
 * names must be one the server registers, and it must never tell the agent to commit or apply.
 */
import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { McpToolRegistry } from "../../../src/mcp/tool-registry.js";

const integrations = join(import.meta.dir, "../../../../integrations");
const FILES = {
  command: join(integrations, "claude_code/commands/dr-plan.md"),
  claudeSkill: join(integrations, "claude_code/skills/dr_change_planning/SKILL.md"),
  copilotSkill: join(integrations, "github_copilot/skills/dr_change_planning/SKILL.md"),
};

function registeredToolNames(): Set<string> {
  const names: string[] = [];
  new McpToolRegistry().registerAll({
    registerTool: (name: string) => names.push(name),
  } as any);
  return new Set(names);
}

/** Backticked names that look like dr MCP tools, e.g. `changeset_brief`. */
function namedTools(text: string): string[] {
  const pattern = /`((?:changeset|model|relationship|annotation|spec|chat)_[a-z_]+)`/g;
  return [...new Set([...text.matchAll(pattern)].map((m) => m[1]))];
}

describe("change-planning integration", () => {
  const registered = registeredToolNames();

  for (const [label, path] of Object.entries(FILES)) {
    describe(label, () => {
      it("exists", () => {
        expect(existsSync(path)).toBe(true);
      });

      const text = existsSync(path) ? readFileSync(path, "utf-8") : "";

      it("names only tools the dr MCP server registers", () => {
        const tools = namedTools(text);
        expect(tools.length).toBeGreaterThan(5);
        const unknown = tools.filter((t) => !registered.has(t));
        expect(unknown).toEqual([]);
      });

      it("walks the whole loop", () => {
        for (const tool of [
          "changeset_create",
          "spec_type",
          "changeset_brief",
          "changeset_impact",
          "changeset_verify",
          "annotation_list",
        ]) {
          expect(text, `${label} should mention ${tool}`).toContain(`\`${tool}\``);
        }
        expect(text).toContain("missing-expected");
        expect(text).toContain("dr visualize");
      });

      it("leaves commit to the human", () => {
        expect(text).not.toMatch(/`changeset_(commit|apply)`/);
        expect(text).toMatch(/human commits/i);
      });
    });
  }

  it("the skills carry name and description frontmatter", () => {
    for (const path of [FILES.claudeSkill, FILES.copilotSkill]) {
      const text = readFileSync(path, "utf-8");
      expect(text).toMatch(/^---\nname: dr_change_planning\ndescription: .+/);
    }
  });
});
