import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SHIPPED_ENTRIES, shippedEntries, shippedVersions } from "@/integrations/shipped-entries";
import { shippedSkill } from "../../fixtures/shipped-integration";

const INTEGRATIONS = join(import.meta.dir, "..", "..", "..", "..", "integrations");

describe("shipped integration entries", () => {
  it("names the leftovers of older layouts that started this (PR 1266)", () => {
    expect(shippedEntries("github_copilot", "skills")).toContain("dr_layer_02_business");
    expect(shippedEntries("github_copilot", "skills")).toContain("dr_layer_04_app");
    // An older layer numbering
    expect(shippedEntries("claude_code", "skills")).toContain("dr_03_security_layer");
    expect(shippedEntries("claude_code", "commands")).toContain("dr-links.md");
  });

  it("knows no name dr never installed", () => {
    for (const folder of ["skills", "agents", "commands", "knowledge"]) {
      for (const integration of ["claude_code", "github_copilot"]) {
        const names = shippedEntries(integration, folder);
        expect(names).not.toContain("dr_house_style");
        expect(names).not.toContain("dr-who.md");
        expect(names.every((name) => /^dr[-_]/.test(name))).toBe(true);
      }
    }
    expect(shippedEntries("claude_code", "templates")).toEqual([]);
    expect(shippedEntries("some_other_integration", "skills")).toEqual([]);
  });

  it("holds every DR-named entry the current integrations ship, so a later removal is already covered", () => {
    const components: Array<[string, string, string]> = [
      ["claude_code", "agents", "agents"],
      ["claude_code", "commands", "commands"],
      ["claude_code", "skills", "skills"],
      ["claude_code", "reference_sheets", "knowledge"],
      ["github_copilot", "agents", "agents"],
      ["github_copilot", "skills", "skills"],
    ];
    for (const [integration, source, target] of components) {
      let current: string[] = [];
      try {
        current = readdirSync(join(INTEGRATIONS, integration, source)).filter((name) => /^dr[-_]/.test(name));
      } catch {
        // a component without a source folder ships nothing
      }
      const table = Object.keys(SHIPPED_ENTRIES[integration]?.[target] ?? {});
      expect(current.filter((name) => !table.includes(name))).toEqual([]);
    }
  });

  it("holds the content of every version, including what the current integration ships", () => {
    const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    // The two leftovers that started this, as an older dr shipped them
    for (const name of ["dr_layer_02_business", "dr_layer_04_app"]) {
      expect(shippedVersions("github_copilot", "skills", name)!["SKILL.md"]).toContain(hash(shippedSkill(name)));
    }
    // A file this dr ships today
    const current = readFileSync(join(INTEGRATIONS, "github_copilot", "agents", "dr-advisor.md"));
    expect(shippedVersions("github_copilot", "agents", "dr-advisor.md")![""]).toContain(hash(current));
    expect(shippedVersions("github_copilot", "agents", "dr-who.md")).toBeUndefined();
  });
});
