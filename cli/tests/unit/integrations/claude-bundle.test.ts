import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const commandsDir = join(
  import.meta.dir,
  "../../../../integrations/claude_code/commands"
);

const commandFiles = readdirSync(commandsDir)
  .filter((f) => f.startsWith("dr-") && f.endsWith(".md"))
  .sort();

describe("Claude Code integration bundle — commands", () => {
  it("ships exactly the expected set of dr-* commands", () => {
    expect(commandFiles.map((f) => f.replace(".md", ""))).toEqual([
      "dr-changeset",
      "dr-design",
      "dr-info",
      "dr-init",
      "dr-map",
      "dr-model",
      "dr-relate",
      "dr-sync",
      "dr-validate",
      "dr-verify",
    ]);
  });

  it("every command file has a non-empty description: frontmatter entry", () => {
    for (const file of commandFiles) {
      const content = readFileSync(join(commandsDir, file), "utf-8");
      const match = content.match(/^description:\s*(.+)/m);
      expect(match?.[1]?.trim(), `${file} is missing description: frontmatter`).toBeTruthy();
    }
  });
});
