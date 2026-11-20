/**
 * DrBot's permissions in words and as launch arguments (#1238, #1240, #1241): the read list,
 * the deny rules, what the agent is told at the start of a launch, and what the viewer shows
 * when a call is refused. The rules themselves are tested in chat-guard.test.ts.
 */

import { describe, it, expect } from "bun:test";
import {
  CHANGESET_WRITE_COMMANDS,
  READ_SAFE_DR_COMMANDS,
  USER_ONLY_DR_COMMANDS,
  formatForClaudeCode,
  formatForClaudeCodeWithChangesets,
} from "../../../src/coding-agents/default-permissions.js";
import { DR_MCP_CHANGESET_TOOLS, drMcpAllowedTools } from "../../../src/coding-agents/drbot-mcp.js";
import {
  DRBOT_BUILT_IN_TOOLS,
  drBotDisallowedTools,
  drBotLaunchSettings,
  drBotSessionPrompt,
  explainDeniedToolCall,
  isExplainedRefusal,
  isPermissionDenial,
} from "../../../src/coding-agents/drbot-permissions.js";

const ROOT = "/work/project";
const bash = (command: string) => ({ toolName: "Bash", toolInput: { command } });
const explain = (mode: "read-safe" | "changesets" | "danger", call: { toolName: unknown; toolInput: unknown }) =>
  explainDeniedToolCall(mode, call, ROOT);
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
      "dr changeset staged",
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

  it("allows no command that writes the model, a changeset or generated files, or starts an agent", () => {
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
      // Its --adopt-source-references writes the plan.
      "dr changeset verify",
      "dr catalog docs",
      "dr docs generate",
      "dr reports regenerate",
      "dr claude install",
      "dr visualize",
      "dr mcp",
      // `dr chat <client> with-danger` starts an unrestricted agent.
      "dr chat",
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

describe("drBotDisallowedTools: what DrBot must never do, denied outright", () => {
  it("denies editing, the network, the person's steps and file-writing flags in both modes", () => {
    for (const mode of ["read-safe", "changesets"] as const) {
      const denied = drBotDisallowedTools(mode);
      for (const rule of [
        "Edit",
        "Write",
        "NotebookEdit",
        "WebFetch",
        "WebSearch",
        "Bash(dr changeset commit:*)",
        "Bash(dr changeset apply:*)",
        "Bash(dr changeset revert:*)",
        "Bash(dr changeset discard:*)",
        "Bash(dr changeset delete:*)",
        "Bash(dr init:*)",
        "Bash(dr upgrade:*)",
        "Bash(dr chat:*)",
        "Bash(*--output*)",
        "Bash(*--save-snapshot*)",
        "mcp__dr__changeset_commit",
        "mcp__dr__changeset_commit_preview",
        "mcp__dr__changeset_discard",
        "mcp__dr__project_init",
        "mcp__dr__project_upgrade",
      ]) {
        expect(denied).toContain(rule);
      }
    }
  });

  it("also denies every staging command and tool in a read-only viewer, and none of them in staging mode", () => {
    const readOnly = drBotDisallowedTools("read-safe");
    const staging = drBotDisallowedTools("changesets");
    for (const command of CHANGESET_WRITE_COMMANDS) {
      expect(readOnly).toContain(`Bash(${command}:*)`);
      expect(staging).not.toContain(`Bash(${command}:*)`);
    }
    for (const tool of DR_MCP_CHANGESET_TOOLS) {
      expect(readOnly).toContain(`mcp__dr__${tool}`);
      expect(staging).not.toContain(`mcp__dr__${tool}`);
    }
  });

  it("never denies something the same mode allows", () => {
    const allowedIn = {
      "read-safe": [...formatForClaudeCode().split(","), ...drMcpAllowedTools("read-safe")],
      changesets: [...formatForClaudeCodeWithChangesets().split(","), ...drMcpAllowedTools("changesets")],
    };
    for (const mode of ["read-safe", "changesets"] as const) {
      const denied = new Set(drBotDisallowedTools(mode));
      expect(allowedIn[mode].filter((rule) => denied.has(rule))).toEqual([]);
    }
  });

  it("gives a chat under an allowlist no editing or network tool at all, and danger mode no rules", () => {
    expect([...DRBOT_BUILT_IN_TOOLS]).toEqual(["Bash", "Read", "Glob", "Grep"]);
    expect(drBotDisallowedTools("danger")).toEqual([]);
  });
});

describe("drBotLaunchSettings: the one settings source a launch under an allowlist reads", () => {
  const dr = { command: "/usr/bin/node", args: ["/opt/dr tools/dist/cli.js"] };

  it("registers the permission hook on Bash, quoting a path with a space", () => {
    const settings = JSON.parse(drBotLaunchSettings("changesets", dr)!);
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: "/usr/bin/node '/opt/dr tools/dist/cli.js' chat-permission-hook" }],
      },
    ]);
    expect(Object.keys(settings)).toEqual(["hooks"]);
  });

  it("carries over the user's sign-in settings and nothing that grants permissions", () => {
    const settings = JSON.parse(
      drBotLaunchSettings("read-safe", dr, {
        apiKeyHelper: "/usr/local/bin/key",
        model: "opus",
        env: { CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "us-east-1", DR_CHAT_MODE: "", dr_changeset_only: "false" },
        permissions: { allow: ["Bash(*)", "Write"], defaultMode: "bypassPermissions" },
        hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "true" }] }] },
        enabledPlugins: { x: true },
      })!
    );
    expect(settings.apiKeyHelper).toBe("/usr/local/bin/key");
    expect(settings.model).toBe("opus");
    // No DR_* variable: a settings file can't switch the chat's own guards off.
    expect(settings.env).toEqual({ CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "us-east-1" });
    expect(settings.permissions).toBeUndefined();
    expect(settings.enabledPlugins).toBeUndefined();
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].matcher).toBe("Bash");
  });

  it("passes nothing in danger mode", () => {
    expect(drBotLaunchSettings("danger", dr, { model: "opus" })).toBeNull();
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
      expect(prompt).toContain("Permission to use … has been denied");
      expect(prompt).toContain("Blocked by DrBot's permissions");
      expect(prompt).toContain("The person saw no prompt and none is coming");
      expect(prompt).toContain("fixed when the viewer starts, by the flags given to `dr visualize`");
      expect(prompt).toContain("This chat reads none of the person's or the project's Claude settings files");
      expect(prompt).toContain("any policy their organisation manages");
      expect(prompt).toContain("--with-danger");
      expect(prompt).toContain("can't be approved from inside the viewer");
    }
  });

  it("says Bash is for one plain dr command, with no file-writing flags and nothing outside the project", () => {
    for (const mode of ["read-safe", "changesets"] as const) {
      const prompt = drBotSessionPrompt(mode, mcp);
      expect(prompt).toContain("one plain `dr` command per call");
      expect(prompt).toContain("`--output`, `--save-snapshot`");
      expect(prompt).toContain("anything outside this project");
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
  it("recognises Claude Code's refusals and this project's own", () => {
    for (const text of [
      "This command requires approval",
      "Claude requested permissions to use Bash, but you haven't granted it yet.",
      "Claude requested permissions to use mcp__dr__changeset_commit, but you haven't granted it yet.",
      "This Bash command contains multiple operations. The following part requires approval: head -5",
      "Permission to use Bash with command dr changeset commit x has been denied.",
      "Permission to use Bash has been denied because Claude Code is running in don't ask mode. IMPORTANT: …",
      "/etc/hosts is outside /work/project; --restricted confines the file tools to the working directory.",
      "cat in '/private/etc/hosts' was blocked. For security, Claude Code may only concatenate files from the allowed working directories",
      "PreToolUse:Bash hook error: Blocked by DrBot's permissions (changeset staging mode): `echo` is not a dr command",
      "Exit code 1\nError: Blocked by DrBot's permissions (read-only mode): `--output` writes a file",
      "Permission denied: Bash",
    ]) {
      expect(isPermissionDenial(text)).toBe(true);
    }
  });

  it("leaves a command's own failure alone, even when it mentions approval, permission or obfuscation", () => {
    for (const text of [
      "Error: Element motivation.goal.x not found",
      "Error: Element security.control.code-obfuscation not found",
      "Error: Element business.process.order-requires-approval not found: This command requires approval of nothing",
      "cat: /etc/shadow: Permission denied",
      "Validation failed: 3 errors. Permission to use this layer has been denied by the schema",
      "Exit code 1\nError: This command requires approval",
      "",
    ]) {
      expect(isPermissionDenial(text)).toBe(false);
    }
  });

  it("knows when a refusal already says why", () => {
    expect(isExplainedRefusal("PreToolUse:Bash hook error: Blocked by DrBot's permissions (read-only mode): x")).toBe(true);
    expect(isExplainedRefusal("This command requires approval")).toBe(false);
  });
});

describe("explainDeniedToolCall (#1241)", () => {
  it("always says the rule, that nobody was asked, and where the rule lives", () => {
    const text = explain("read-safe", bash("dr delete api.operation.x"));
    expect(text).toStartWith("Blocked by DrBot's permissions (read-only mode): `dr delete` is not on DrBot's allowlist");
    expect(text).toContain("Nobody was asked to approve it and no prompt is coming.");
    expect(text).toContain("dr visualize --with-danger");
    expect(text).toContain("set by the flags `dr visualize` was started with, not by a settings file");
    expect(text).toContain("can't be changed from inside the viewer");
  });

  it("points a write in a read-only viewer at restarting without --read-only (#1240)", () => {
    const text = explain("read-safe", bash('dr changeset create "model-refinement-01" --description "x"'));
    expect(text).toContain("`dr changeset create` changes the model, and this viewer was started with --read-only");
    expect(text).toContain("restart the viewer without --read-only");
    expect(text).toContain("stage the change in a changeset");
    expect(explain("read-safe", { toolName: "mcp__dr__model_add", toolInput: {} })).toContain(
      "`model_add` changes the model, and this viewer was started with --read-only"
    );
  });

  it("says landing or discarding a changeset is the person's step, in every mode", () => {
    for (const mode of ["read-safe", "changesets"] as const) {
      const commit = explain(mode, bash("dr changeset commit my-plan"));
      expect(commit).toContain("`dr changeset commit`: landing a changeset is the person's step: Apply in the viewer.");
      expect(commit).toContain("do it yourself");
      expect(explain(mode, { toolName: "mcp__dr__changeset_commit", toolInput: {} })).toContain(
        "`changeset_commit`: landing a changeset is the person's step"
      );
      expect(explain(mode, bash("dr changeset discard"))).toContain("Discard in the viewer");
    }
  });

  it("explains a chained or redirected call of an allowed command, which needs no change of mode", () => {
    for (const command of ["dr list api | head -5", "dr show a && dr show b", "dr list > out.txt", "dr show $(cat id)"]) {
      const text = explain("changesets", bash(command));
      expect(text).toContain("only one plain `dr` command per call");
      expect(text).toContain("Nothing needs changing");
      expect(text).not.toContain("--with-danger");
    }
  });

  it("names the forbidden command, not the shell syntax around it (review finding 6)", () => {
    // A denied write under --read-only whose description holds an `&` is not "nothing needs changing".
    const add = explain("read-safe", bash('dr add motivation goal g --description "A & B"'));
    expect(add).toContain("`dr add` changes the model, and this viewer was started with --read-only");
    expect(add).not.toContain("Nothing needs changing");
    const commit = explain("changesets", bash("dr changeset commit x 2>&1"));
    expect(commit).toContain("landing a changeset is the person's step");
    expect(commit).not.toContain("Nothing needs changing");
  });

  it("explains a file-writing flag and a path outside the project", () => {
    expect(explain("changesets", bash("dr export markdown --output documentation-robotics/model/manifest.yaml"))).toContain(
      "`--output` writes a file"
    );
    expect(explain("read-safe", bash("dr list --model /other/project"))).toContain(
      "`--model /other/project` points outside the project this viewer serves (/work/project)"
    );
  });

  it("explains a shell command that isn't dr", () => {
    expect(explain("changesets", bash('grep -rn "foo" src'))).toContain("`grep` is not a dr command");
  });

  it("names a group command by its subcommand", () => {
    expect(explain("changesets", bash("dr relationship delete a b --predicate uses"))).toContain(
      "`dr relationship delete` is not on DrBot's allowlist in changeset staging mode"
    );
    expect(explain("changesets", bash("dr delete a.b.c"))).toContain("`dr delete` is not on");
  });

  it("says when an allowed command was refused for its form, not its name", () => {
    expect(explain("read-safe", bash("dr search foo"))).toContain(
      "`dr search` is allowed, but Claude Code could not check this form of it"
    );
  });

  it("says a refused Read reached outside the project, not that Read is off the allowlist (review finding 6)", () => {
    const text = explain("changesets", { toolName: "Read", toolInput: { file_path: "/etc/hosts" } });
    expect(text).toContain("DrBot may read only inside the project this viewer serves, and this Read call reaches outside it.");
    expect(text).not.toContain("is not on DrBot's allowlist");
  });

  it("explains file edits, the network and other servers' tools", () => {
    expect(explain("changesets", { toolName: "Edit", toolInput: {} })).toContain(
      "DrBot may not edit files: it changes the model only by staging into a changeset."
    );
    expect(explain("read-safe", { toolName: "Write", toolInput: {} })).toContain("--read-only");
    expect(explain("changesets", { toolName: "WebFetch", toolInput: {} })).toContain("DrBot may not use the network.");
    expect(explain("changesets", { toolName: "mcp__pencil__batch_design", toolInput: {} })).toContain(
      "belongs to another MCP server"
    );
    expect(explain("changesets", { toolName: "mcp__dr__chat_launch", toolInput: {} })).toContain(
      "`chat_launch` is not on DrBot's allowlist"
    );
  });

  it("copes with a call it knows nothing about", () => {
    expect(explain("changesets", { toolName: undefined, toolInput: undefined })).toContain(
      "this tool is not on DrBot's allowlist"
    );
    expect(explain("changesets", { toolName: "Bash", toolInput: null })).toContain(
      "this shell command is not on DrBot's allowlist"
    );
  });

  it("doesn't blame the allowlist in danger mode, which has none", () => {
    expect(explain("danger", bash("dr delete x"))).toContain("DrBot's allowlist is not the cause");
  });
});
