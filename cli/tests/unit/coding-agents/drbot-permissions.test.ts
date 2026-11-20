/**
 * DrBot's permissions in words (#1240, #1241): what the agent is told at the start of a launch,
 * and what the viewer shows when a call is refused.
 */

import { describe, it, expect } from "bun:test";
import {
  CHANGESET_WRITE_COMMANDS,
  READ_SAFE_DR_COMMANDS,
  USER_ONLY_DR_COMMANDS,
  formatForClaudeCode,
  formatForClaudeCodeWithChangesets,
} from "../../../src/coding-agents/default-permissions.js";
import {
  drBotSessionPrompt,
  explainDeniedToolCall,
  isPermissionDenial,
} from "../../../src/coding-agents/drbot-permissions.js";

const bash = (command: string) => ({
  toolName: "Bash",
  toolInput: { command },
});
const mcp = { mcpConnected: true };
const noMcp = { mcpConnected: false };

describe("the read-only dr commands every mode allows (#1238)", () => {
  it("allows trace, the changeset reads, schema, catalog and help alongside show", () => {
    const rules = formatForClaudeCode().split(",");
    for (const command of [
      "dr show",
      "dr trace",
      "dr changeset list",
      "dr changeset status",
      "dr changeset show",
      "dr changeset diff",
      "dr schema",
      "dr relationship list",
      "dr catalog info",
      "dr help",
      "dr --help",
    ]) {
      expect(rules).toContain(`Bash(${command}:*)`);
    }
  });

  it("allows no command that writes the model, a changeset or generated files", () => {
    const writers = [
      "dr add",
      "dr update",
      "dr delete",
      "dr init",
      "dr upgrade",
      "dr import",
      "dr element add",
      "dr element update",
      "dr element delete",
      "dr relationship add",
      "dr relationship delete",
      "dr relationship prune",
      "dr changeset create",
      "dr changeset activate",
      "dr changeset stage",
      "dr changeset commit",
      "dr changeset apply",
      "dr changeset discard",
      "dr changeset delete",
      "dr changeset import",
      "dr catalog docs",
      "dr docs generate",
      "dr reports regenerate",
      "dr claude install",
      "dr visualize",
      "dr mcp",
    ];
    for (const writer of writers) {
      // No read rule is the command itself or a prefix of it (a group rule such as `dr changeset`).
      const covering = READ_SAFE_DR_COMMANDS.filter((read) => writer === read || writer.startsWith(`${read} `));
      expect(covering).toEqual([]);
    }
  });

  it("keeps the staging list to writes: every read is already in the read-only list", () => {
    for (const command of CHANGESET_WRITE_COMMANDS) {
      expect(READ_SAFE_DR_COMMANDS).not.toContain(command);
    }
    const rules = formatForClaudeCodeWithChangesets().split(",");
    expect(new Set(rules).size).toBe(rules.length);
  });

  it("never allows a command that is the person's step, in either mode", () => {
    const allowed = [...READ_SAFE_DR_COMMANDS, ...CHANGESET_WRITE_COMMANDS];
    for (const command of Object.keys(USER_ONLY_DR_COMMANDS)) {
      expect(allowed.filter((rule) => command === rule || command.startsWith(`${rule} `))).toEqual([]);
    }
  });
});

describe("drBotSessionPrompt", () => {
  it("tells a changeset-mode launch on MCP its mode, its tools and that it never lands a changeset", () => {
    const prompt = drBotSessionPrompt("changesets", mcp);
    expect(prompt).toContain("changeset_create");
    expect(prompt).toContain("mode: changeset staging");
    expect(prompt).toContain("mcp__dr__* tools");
    expect(prompt).toContain("Never commit");
    expect(prompt).toContain("Apply or Discard in the viewer");
  });

  it("tells a read-only launch at the start that it can't change the model, and how the person changes that (#1240)", () => {
    for (const options of [mcp, noMcp]) {
      const prompt = drBotSessionPrompt("read-safe", options);
      expect(prompt).toContain("mode: read-only");
      expect(prompt).toContain("read-only: answer from the model");
      expect(prompt).toContain("every change to the model");
      expect(prompt).toContain("don't plan steps this mode can't carry out");
      expect(prompt).toContain("restart the viewer without --read-only");
    }
  });

  it("says what a refused call means, where the rule lives and that no prompt is coming (#1241)", () => {
    for (const mode of ["read-safe", "changesets"] as const) {
      const prompt = drBotSessionPrompt(mode, mcp);
      expect(prompt).toContain("This command requires approval");
      expect(prompt).toContain("The person saw no prompt and none is coming");
      expect(prompt).toContain("fixed when the viewer starts, by the flags given to `dr visualize`");
      expect(prompt).toContain("no settings file");
      expect(prompt).toContain("--with-danger");
      expect(prompt).toContain("can't be approved from inside the viewer");
    }
  });

  it("lists the Bash commands of the mode, so the agent knows the list it was checked against", () => {
    const readOnly = drBotSessionPrompt("read-safe", noMcp);
    expect(readOnly).toContain("dr trace");
    expect(readOnly).toContain("dr changeset status");
    expect(readOnly).not.toContain("dr changeset create,");
    const staging = drBotSessionPrompt("changesets", noMcp);
    expect(staging).toContain("dr changeset create");
    expect(staging).toContain("dr relationship add");
  });

  it("works through Bash when the MCP server isn't connected, and names no MCP tools then", () => {
    const prompt = drBotSessionPrompt("changesets", noMcp);
    expect(prompt).toContain("dr MCP server is not connected");
    expect(prompt).toContain("dr changeset create <name>");
    expect(prompt).not.toContain("mcp__dr__");
  });

  it("has no allowlist to explain in danger mode", () => {
    expect(drBotSessionPrompt("danger", noMcp)).toBe("");
    const withMcp = drBotSessionPrompt("danger", mcp);
    expect(withMcp).toContain("mcp__dr__");
    expect(withMcp).not.toContain("Permissions in this chat");
  });
});

describe("isPermissionDenial", () => {
  it("recognises Claude Code's refusals", () => {
    for (const text of [
      "This command requires approval",
      "Claude requested permissions to use Bash, but you haven't granted it yet.",
      "Claude requested permissions to use mcp__dr__changeset_commit, but you haven't granted it yet.",
      "This Bash command contains multiple operations. The following part requires approval: head -5",
      "Permission denied: Bash",
    ]) {
      expect(isPermissionDenial(text)).toBe(true);
    }
  });

  it("leaves a command's own failure alone", () => {
    for (const text of [
      "Error: Element motivation.goal.x not found",
      "cat: /etc/shadow: Permission denied",
      "Validation failed: 3 errors",
      "",
    ]) {
      expect(isPermissionDenial(text)).toBe(false);
    }
  });
});

describe("explainDeniedToolCall (#1241)", () => {
  it("always says the rule, that nobody was asked, and where the rule lives", () => {
    const text = explainDeniedToolCall("read-safe", bash("dr delete api.operation.x"), mcp);
    expect(text).toStartWith(
      "Blocked by DrBot's permissions (read-only mode): `dr delete` is not on DrBot's allowlist"
    );
    expect(text).toContain("Nobody was asked to approve it and no prompt is coming.");
    expect(text).toContain("dr visualize --with-danger");
    expect(text).toContain("set by the flags `dr visualize` was started with, not by a settings file");
    expect(text).toContain("can't be changed from inside the viewer");
  });

  it("points a write in a read-only viewer at restarting without --read-only (#1240)", () => {
    const text = explainDeniedToolCall(
      "read-safe",
      bash('dr changeset create "model-refinement-01" --description "x"'),
      noMcp
    );
    expect(text).toContain("`dr changeset create` changes the model, and this viewer was started with --read-only");
    expect(text).toContain("restart the viewer without --read-only");
    expect(text).toContain("stage the change in a changeset");
    expect(explainDeniedToolCall("read-safe", { toolName: "mcp__dr__model_add", toolInput: {} }, mcp)).toContain(
      "`model_add` changes the model, and this viewer was started with --read-only"
    );
  });

  it("says landing or discarding a changeset is the person's step, in every mode", () => {
    for (const mode of ["read-safe", "changesets"] as const) {
      const commit = explainDeniedToolCall(mode, bash("dr changeset commit my-plan"), mcp);
      expect(commit).toContain("`dr changeset commit`: landing a changeset is the person's step: Apply in the viewer.");
      expect(commit).toContain("do it yourself");
      expect(explainDeniedToolCall(mode, { toolName: "mcp__dr__changeset_commit", toolInput: {} }, mcp)).toContain(
        "`changeset_commit`: landing a changeset is the person's step"
      );
      expect(explainDeniedToolCall(mode, bash("dr changeset discard"), mcp)).toContain("Discard in the viewer");
    }
  });

  it("explains a chained or redirected call, which needs no change of mode", () => {
    for (const command of [
      "dr list api | head -5",
      "dr show a && dr show b",
      "dr list > out.txt",
      "dr show $(cat id)",
    ]) {
      const text = explainDeniedToolCall("changesets", bash(command), mcp);
      expect(text).toContain("only one plain `dr` command per call");
      expect(text).toContain("Nothing needs changing");
      expect(text).not.toContain("--with-danger");
    }
  });

  it("explains a shell command that isn't dr", () => {
    const text = explainDeniedToolCall("changesets", bash('grep -rn "foo" src'), mcp);
    expect(text).toContain("`grep` is not a dr command");
  });

  it("names a group command by its subcommand", () => {
    expect(explainDeniedToolCall("changesets", bash("dr relationship delete a b --predicate uses"), mcp)).toContain(
      "`dr relationship delete` is not on DrBot's allowlist in changeset staging mode"
    );
    expect(explainDeniedToolCall("changesets", bash("dr delete a.b.c"), mcp)).toContain("`dr delete` is not on");
  });

  it("says when an allowed command was refused for its form, not its name", () => {
    const text = explainDeniedToolCall("read-safe", bash("dr search 'a\\'b'"), mcp);
    expect(text).toContain("`dr search` is allowed, but Claude Code could not check this form of it");
  });

  it("explains file edits and other servers' tools", () => {
    expect(explainDeniedToolCall("changesets", { toolName: "Edit", toolInput: {} }, mcp)).toContain(
      "DrBot may not edit files: it changes the model only by staging into a changeset."
    );
    expect(explainDeniedToolCall("read-safe", { toolName: "Write", toolInput: {} }, mcp)).toContain("--read-only");
    expect(
      explainDeniedToolCall("changesets", { toolName: "mcp__pencil__batch_design", toolInput: {} }, mcp)
    ).toContain("belongs to another MCP server");
    expect(explainDeniedToolCall("changesets", { toolName: "mcp__dr__chat_launch", toolInput: {} }, mcp)).toContain(
      "`chat_launch` is not on DrBot's allowlist"
    );
  });

  it("copes with a call it knows nothing about", () => {
    expect(explainDeniedToolCall("changesets", { toolName: undefined, toolInput: undefined }, mcp)).toContain(
      "this tool is not on DrBot's allowlist"
    );
    expect(explainDeniedToolCall("changesets", { toolName: "Bash", toolInput: null }, mcp)).toContain(
      "this shell command is not on DrBot's allowlist"
    );
  });

  it("doesn't blame the allowlist in danger mode, which has none", () => {
    expect(explainDeniedToolCall("danger", bash("dr delete x"), mcp)).toContain("DrBot's allowlist is not the cause");
  });
});
