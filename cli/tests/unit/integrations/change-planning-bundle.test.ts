/**
 * The change-planning integration (/dr-plan and the dr_change_planning skill) walks the loop in
 * docs/CHANGE_MODELING.md through the dr MCP server. These tests keep it honest: every MCP tool it
 * names must be one the server registers, it never tells the agent to apply, and it commits only
 * when the human asks and confirms.
 */
import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { McpToolRegistry } from "../../../src/mcp/tool-registry.js";

const integrations = join(import.meta.dir, "../../../../integrations");
const FILES = {
  command: join(integrations, "claude_code/commands/dr-plan.md"),
  claudeSkill: join(
    integrations,
    "claude_code/skills/dr_change_planning/SKILL.md"
  ),
  copilotSkill: join(
    integrations,
    "github_copilot/skills/dr_change_planning/SKILL.md"
  )
};

function registeredToolNames(): Set<string> {
  const names: string[] = [];
  new McpToolRegistry().registerAll({
    registerTool: (name: string) => names.push(name)
  } as any);
  return new Set(names);
}

/** Backticked names that look like dr MCP tools, e.g. `changeset_brief`. */
function namedTools(text: string): string[] {
  const pattern =
    /`((?:changeset|model|relationship|annotation|spec|chat|review)_[a-z_]+)`/g;
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
          "review_open"
        ]) {
          expect(text, `${label} should mention ${tool}`).toContain(
            `\`${tool}\``
          );
        }
        expect(text).toContain("dr visualize");
      });

      it("commits only the plan's own changeset directory", () => {
        expect(text).toContain("`documentation-robotics/changesets/<id>/`");
        expect(text).not.toContain("(`documentation-robotics/changesets/`)");
        expect(text).toContain("`.active`");
      });

      it("lands only when the human asks and confirms", () => {
        expect(text).not.toMatch(/`changeset_apply`/);
        expect(text).toMatch(/human commits/i);
        expect(text).toContain("`changeset_commit`");
        expect(text).toMatch(/confirm it in a dialog/);
      });
    });
  }

  it("the skills give a fallback where DrBot lacks a tool they name", async () => {
    const { DR_MCP_READ_TOOLS, DR_MCP_CHANGESET_TOOLS } =
      await import("../../../src/coding-agents/drbot-mcp.js");
    const drbot = new Set([...DR_MCP_READ_TOOLS, ...DR_MCP_CHANGESET_TOOLS]);
    for (const path of [FILES.claudeSkill, FILES.copilotSkill]) {
      const text = readFileSync(path, "utf-8");
      const missing = namedTools(text).filter(
        (t) => !drbot.has(t) && t !== "changeset_discard"
      );
      expect(missing.length).toBeGreaterThan(0);
      const tolerance = text.slice(text.indexOf("## Tolerance"));
      for (const tool of missing) {
        expect(
          tolerance,
          `${path} Tolerance should cover ${tool} in DrBot`
        ).toContain(`\`${tool}\``);
      }
    }
  });

  it("the skills carry name and description frontmatter", () => {
    for (const path of [FILES.claudeSkill, FILES.copilotSkill]) {
      const text = readFileSync(path, "utf-8");
      expect(text).toMatch(/^---\nname: dr_change_planning\ndescription: .+/);
    }
  });
});
