/**
 * The chat agent's three rules, as dr itself enforces them (chat-guard.ts): it writes only into a
 * changeset, it never lands one, and it runs no shell but one plain `dr` command and reaches
 * nothing outside the served project. Each "forbidden stays forbidden" block below is one rule.
 */

import { describe, it, expect } from "bun:test";
import { Command } from "commander";
import { CLIError } from "../../../src/utils/errors.js";
import {
  CHANGESET_WRITE_COMMANDS,
  READ_SAFE_DR_COMMANDS,
  USER_ONLY_DR_COMMANDS,
} from "../../../src/coding-agents/default-permissions.js";
import { DR_MCP_CHANGESET_TOOLS, DR_MCP_READ_TOOLS } from "../../../src/coding-agents/drbot-mcp.js";
import {
  CHAT_MODE_ENV,
  REFUSAL_MARKER,
  assertChatCommandAllowed,
  chatBashRefusal,
  chatCommandRefusal,
  chatMode,
  chatPermissionHookDecision,
  chatPermissionHookOutput,
  chatToolRefusal,
  isInsideProject,
  splitShellLine,
  type ChatMode,
} from "../../../src/coding-agents/chat-guard.js";

const ROOT = "/work/project";
const MODES: ChatMode[] = ["read-safe", "changesets"];
const lists = { read: DR_MCP_READ_TOOLS, staging: DR_MCP_CHANGESET_TOOLS };
const bash = (mode: ChatMode, line: string) => chatBashRefusal(mode, line, ROOT);
const command = (mode: ChatMode, path: string, options: Record<string, unknown> = {}) =>
  chatCommandRefusal(mode, path, options, ROOT);

describe("chatMode", () => {
  it("is off outside a chat, and fails safe to read-only on a value it doesn't know", () => {
    expect(chatMode({})).toBeNull();
    expect(chatMode({ [CHAT_MODE_ENV]: "" })).toBeNull();
    expect(chatMode({ [CHAT_MODE_ENV]: "changesets" })).toBe("changesets");
    expect(chatMode({ [CHAT_MODE_ENV]: "read-safe" })).toBe("read-safe");
    expect(chatMode({ [CHAT_MODE_ENV]: "danger" })).toBe("read-safe");
    expect(chatMode({ [CHAT_MODE_ENV]: "CHANGESETS " })).toBe("read-safe");
  });
});

describe("rule 1, forbidden stays forbidden: DrBot writes only into a changeset", () => {
  it("refuses every staging command in a read-only viewer, as a command and through Bash", () => {
    for (const staging of CHANGESET_WRITE_COMMANDS) {
      expect(command("read-safe", staging)?.reason).toContain("--read-only");
      expect(bash("read-safe", `${staging} x`)?.reason).toContain("--read-only");
      expect(command("changesets", staging)).toBeNull();
    }
  });

  it("refuses commands that write the model or files outside a changeset, in both modes", () => {
    const writers = [
      "dr delete",
      "dr import",
      "dr element add",
      "dr element delete",
      "dr relationship delete",
      "dr relationship prune",
      "dr changeset import",
      "dr changeset export",
      "dr catalog docs",
      "dr docs generate",
      "dr reports regenerate",
      "dr claude install",
      "dr copilot install",
      "dr visualize",
      "dr farm add",
      "dr analyzer index",
    ];
    for (const mode of MODES) {
      for (const writer of writers) {
        expect(command(mode, writer)?.reason).toContain("not on DrBot's allowlist");
        expect(bash(mode, `${writer} x`)?.reason).toContain("not on DrBot's allowlist");
      }
    }
  });

  it("refuses the flags that make a read command write a file anywhere", () => {
    for (const mode of MODES) {
      for (const path of ["dr export", "dr validate", "dr stats", "dr report", "dr audit"]) {
        expect(command(mode, path, { output: "documentation-robotics/model/manifest.yaml" })?.reason).toContain("`--output` writes a file");
        expect(command(mode, path, { output: "/etc/anything" })?.reason).toContain("`--output` writes a file");
        expect(command(mode, path, {})).toBeNull();
      }
      expect(command(mode, "dr audit", { saveSnapshot: true })?.reason).toContain("`--save-snapshot` writes a file");
      for (const line of [
        "dr export markdown --output documentation-robotics/model/manifest.yaml",
        "dr export markdown --output=/tmp/x.md",
        "dr stats --output x",
        "dr audit --save-snapshot",
        'dr validate --output "my file.json"',
      ]) {
        expect(bash(mode, line)?.reason).toContain("writes a file");
      }
    }
    // A flag name inside a quoted value is not the flag.
    expect(bash("changesets", 'dr add motivation goal g --description "use --output later"')).toBeNull();
  });

  it("refuses adopting source references from a read-only viewer", () => {
    expect(command("changesets", "dr changeset stage", { adoptSourceReferences: true })).toBeNull();
    expect(command("read-safe", "dr changeset diff", { adoptSourceReferences: true })?.reason).toContain(
      "`--adopt-source-references` writes the plan"
    );
    // The command that takes the flag is not on any list: it is refused whatever its flags.
    for (const mode of MODES) {
      expect(command(mode, "dr changeset verify")).not.toBeNull();
      expect(bash(mode, "dr changeset verify plan --adopt-source-references")).not.toBeNull();
    }
  });

  it("allows what each mode is for", () => {
    for (const mode of MODES) {
      for (const read of READ_SAFE_DR_COMMANDS.filter((entry) => entry !== "dr --help")) {
        expect(command(mode, read)).toBeNull();
        expect(bash(mode, `${read} x`)).toBeNull();
      }
    }
    expect(bash("changesets", 'dr changeset create plan --description "A & B; C | D > E"')).toBeNull();
    expect(bash("changesets", "dr add motivation requirement 'Tasks persist' --attributes '{\"priority\":\"high\"}'")).toBeNull();
  });
});

describe("rule 2, forbidden stays forbidden: DrBot never lands or discards a changeset", () => {
  it("refuses every person-only command in both modes, and says whose step it is", () => {
    for (const mode of MODES) {
      for (const [userOnly, why] of Object.entries(USER_ONLY_DR_COMMANDS)) {
        expect(command(mode, userOnly)?.reason).toBe(`\`${userOnly}\`: ${why}.`);
        expect(bash(mode, `${userOnly} my-plan`)?.reason).toBe(`\`${userOnly}\`: ${why}.`);
      }
    }
    expect(Object.keys(USER_ONLY_DR_COMMANDS)).toEqual(
      expect.arrayContaining([
        "dr changeset commit",
        "dr changeset apply",
        "dr changeset revert",
        "dr changeset discard",
        "dr changeset delete",
      ])
    );
  });

  it("names the forbidden command before the shell syntax around it", () => {
    expect(bash("changesets", "dr changeset commit x 2>&1")?.reason).toContain("landing a changeset is the person's step");
    expect(bash("changesets", "dr changeset discard && dr list")?.reason).toContain("Discard in the viewer");
    expect(bash("read-safe", 'dr add motivation goal g --description "A & B"')?.reason).toContain("--read-only");
  });

  it("refuses the MCP tools that land, discard, create or migrate, in both modes", () => {
    for (const mode of MODES) {
      const env = { [CHAT_MODE_ENV]: mode };
      for (const tool of ["changeset_commit", "changeset_commit_preview", "changeset_discard", "project_init", "project_upgrade"]) {
        const refusal = chatToolRefusal(tool, undefined, ROOT, lists, env);
        expect(refusal).toBeInstanceOf(CLIError);
        expect(refusal!.message).toContain(REFUSAL_MARKER);
        expect(refusal!.message).toContain("person's step");
      }
    }
  });

  it("refuses staging tools in a read-only viewer and tools on no list in both modes", () => {
    for (const tool of DR_MCP_CHANGESET_TOOLS) {
      expect(chatToolRefusal(tool, undefined, ROOT, lists, { [CHAT_MODE_ENV]: "read-safe" })!.message).toContain("--read-only");
      expect(chatToolRefusal(tool, undefined, ROOT, lists, { [CHAT_MODE_ENV]: "changesets" })).toBeNull();
    }
    for (const mode of MODES) {
      for (const tool of DR_MCP_READ_TOOLS) {
        expect(chatToolRefusal(tool, undefined, ROOT, lists, { [CHAT_MODE_ENV]: mode })).toBeNull();
      }
      for (const tool of ["codebase_extract", "codebase_index", "chat_launch", "review_open", "annotation_create", "tier1_status"]) {
        expect(chatToolRefusal(tool, undefined, ROOT, lists, { [CHAT_MODE_ENV]: mode })!.message).toContain(
          "not on DrBot's allowlist"
        );
      }
    }
  });

  it("decides nothing outside a chat", () => {
    expect(chatToolRefusal("changeset_commit", "/elsewhere", ROOT, lists, {})).toBeNull();
  });
});

describe("rule 3, forbidden stays forbidden: one plain dr command, nothing outside the project", () => {
  it("refuses any shell command that is not dr", () => {
    for (const mode of MODES) {
      for (const line of ["echo hi", "cat dr.config.yaml", "ls", "git status", "bun run build", "/bin/sh -c 'dr list'", "env dr list"]) {
        expect(bash(mode, line)?.reason).toContain("is not a dr command");
      }
      expect(bash(mode, "")?.reason).toContain("not a `dr` command");
      expect(bash(mode, "   ")?.reason).toContain("not a `dr` command");
    }
  });

  it("refuses an environment prefix, which could switch a guard off", () => {
    for (const line of ["DR_CHANGESET_ONLY=false dr add motivation goal g", "DR_CHAT_MODE= dr changeset commit x", "FOO=1 dr list"]) {
      expect(bash("changesets", line)?.reason).toContain("is not a dr command");
    }
  });

  it("refuses shell escapes past a prefix rule: chains, pipes, redirects, substitutions, expansions", () => {
    for (const line of [
      "dr list; rm -rf documentation-robotics",
      "dr list && echo x",
      "dr list || true",
      "dr list | head -3",
      "dr list > out.txt",
      "dr list >> out.txt",
      "dr list 2>&1",
      "dr list < in.txt",
      "dr list &",
      "dr show $(cat id.txt)",
      "dr show `cat id.txt`",
      'dr show "$(cat id.txt)"',
      'dr show "`cat id.txt`"',
      "dr show $ID",
      'dr show "${ID}"',
      "dr list\nrm -rf x",
      "dr show 'unclosed",
      "dr list --model ~/elsewhere",
      "dr list (sub)",
    ]) {
      const refusal = bash("changesets", line);
      expect(refusal).not.toBeNull();
    }
    expect(bash("changesets", "dr list | head -3")?.reason).toContain("only one plain `dr` command per call");
    expect(bash("changesets", "dr list | head -3")?.remedy).toContain("Nothing needs changing");
  });

  it("reads a quoted operator as text, the way the shell does", () => {
    expect(splitShellLine('dr add a b "x | y && z; w > v"')).toEqual({ tokens: ["dr", "add", "a", "b", "x | y && z; w > v"], complex: false });
    expect(splitShellLine("dr show 'a $b `c`'")).toEqual({ tokens: ["dr", "show", "a $b `c`"], complex: false });
    expect(splitShellLine("dr   show\tx")).toEqual({ tokens: ["dr", "show", "x"], complex: false });
    expect(splitShellLine("dr show a\\ b")).toEqual({ tokens: ["dr", "show", "a b"], complex: false });
    expect(splitShellLine("dr list | head").tokens).toEqual(["dr", "list"]);
    expect(splitShellLine("dr list | head").complex).toBe(true);
    expect(splitShellLine('dr show "$X"').complex).toBe(true);
  });

  it("refuses a model, codebase or other-model path outside the served project", () => {
    for (const mode of MODES) {
      expect(command(mode, "dr list", { model: "/other/project" })?.reason).toContain("points outside the project");
      expect(command(mode, "dr list", { model: "../sibling" })?.reason).toContain("points outside the project");
      expect(command(mode, "dr list", { codebasePath: "/other" })?.reason).toContain("`--codebase-path /other`");
      expect(command(mode, "dr validate", { modelPath: ["a=/other"] })?.reason).toContain("`--model-path`");
      expect(command(mode, "dr list", { model: "." })).toBeNull();
      expect(command(mode, "dr list", { model: `${ROOT}/sub` })).toBeNull();
      expect(bash(mode, "dr trace x --model /other/project")?.reason).toContain("points outside the project");
      expect(bash(mode, "dr trace x --model=../sibling")?.reason).toContain("points outside the project");
      expect(bash(mode, "dr validate --model-path a=/other")?.reason).toContain("`--model-path`");
      expect(bash(mode, "dr trace x --model .")).toBeNull();
    }
  });

  it("refuses an MCP rootPath other than the served project, for every tool", () => {
    for (const mode of MODES) {
      const env = { [CHAT_MODE_ENV]: mode };
      for (const tool of [...DR_MCP_READ_TOOLS, ...DR_MCP_CHANGESET_TOOLS]) {
        expect(chatToolRefusal(tool, "/other/project", ROOT, lists, env)!.message).toContain(
          "is not the project this viewer serves"
        );
      }
      expect(chatToolRefusal("model_show", ROOT, ROOT, lists, env)).toBeNull();
      expect(chatToolRefusal("model_show", `${ROOT}/`, ROOT, lists, env)).toBeNull();
      expect(chatToolRefusal("model_show", "", ROOT, lists, env)).toBeNull();
      expect(chatToolRefusal("model_show", `${ROOT}/../project-two`, ROOT, lists, env)).not.toBeNull();
    }
  });

  it("tells inside from outside by resolved path, not by prefix", () => {
    expect(isInsideProject(".", ROOT)).toBe(true);
    expect(isInsideProject("documentation-robotics/model", ROOT)).toBe(true);
    expect(isInsideProject(ROOT, ROOT)).toBe(true);
    expect(isInsideProject("..", ROOT)).toBe(false);
    expect(isInsideProject("a/../../x", ROOT)).toBe(false);
    expect(isInsideProject("/work/project-two", ROOT)).toBe(false);
    expect(isInsideProject("/etc/hosts", ROOT)).toBe(false);
  });
});

describe("dr's own preAction guard (assertChatCommandAllowed)", () => {
  /** Parses a command line with commander and returns the command it would run. */
  function parse(argv: string[]): Command {
    let ran: Command | undefined;
    const program = new Command().name("dr").option("--codebase-path <path>").exitOverride();
    const record = (_: unknown, __: unknown, cmd: Command) => void (ran = cmd);
    program.command("list [layer]").option("--model <path>").action((layer, options, cmd) => record(layer, options, cmd));
    program.command("stats").option("--output <path>").action((options, cmd) => record(null, options, cmd));
    program.command("add <layer> <type> <name>").action((a, b, c, options, cmd) => record(a, options, cmd));
    program.command("mcp").action((options, cmd) => record(null, options, cmd));
    const changeset = program.command("changeset");
    changeset.command("commit [name]").action((name, options, cmd) => record(name, options, cmd));
    changeset.command("create <name>").action((name, options, cmd) => record(name, options, cmd));
    program.parse(["node", "dr", ...argv]);
    return ran!;
  }
  const guard = (argv: string[], mode?: string) => () =>
    assertChatCommandAllowed(parse(argv), mode ? { [CHAT_MODE_ENV]: mode } : {}, ROOT);

  it("does nothing outside a chat", () => {
    expect(guard(["changeset", "commit", "x"])).not.toThrow();
    expect(guard(["stats", "--output", "/etc/x"])).not.toThrow();
  });

  it("throws the refusal, with the marker the server recognises, before the command runs", () => {
    expect(guard(["changeset", "commit", "x"], "changesets")).toThrow(/Blocked by DrBot's permissions \(changeset staging mode\): `dr changeset commit`/);
    expect(guard(["add", "motivation", "goal", "g"], "read-safe")).toThrow(/started with --read-only/);
    expect(guard(["stats", "--output", "x.json"], "changesets")).toThrow(/`--output` writes a file/);
    expect(guard(["list", "--model", "/other"], "read-safe")).toThrow(/points outside the project/);
    expect(guard(["--codebase-path", "/other", "list"], "read-safe")).toThrow(/`--codebase-path \/other`/);
  });

  it("lets a mode's own commands through, and the server the launch itself starts", () => {
    expect(guard(["list", "motivation"], "read-safe")).not.toThrow();
    expect(guard(["list", "--model", "."], "read-safe")).not.toThrow();
    expect(guard(["changeset", "create", "plan"], "changesets")).not.toThrow();
    expect(guard(["add", "motivation", "goal", "g"], "changesets")).not.toThrow();
    expect(guard(["mcp"], "read-safe")).not.toThrow();
  });
});

describe("the PreToolUse hook (chatPermissionHookDecision)", () => {
  const call = (commandLine: string) => ({ tool_name: "Bash", tool_input: { command: commandLine }, cwd: ROOT });

  it("denies a Bash call the mode refuses, with the reason the agent then reads", () => {
    const reason = chatPermissionHookDecision(call("dr changeset commit x"), { [CHAT_MODE_ENV]: "changesets" })!;
    expect(reason).toStartWith(`${REFUSAL_MARKER} (changeset staging mode): \`dr changeset commit\`: landing a changeset`);
    expect(reason).toContain("Nobody was asked to approve it and no prompt is coming.");
    expect(reason).toContain("not by a settings file");
    expect(JSON.parse(chatPermissionHookOutput(reason))).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    });
  });

  it("leaves an allowed call, another tool, and anything outside a chat to Claude Code", () => {
    expect(chatPermissionHookDecision(call("dr trace a.b.c --direction up"), { [CHAT_MODE_ENV]: "read-safe" })).toBeNull();
    expect(chatPermissionHookDecision({ tool_name: "Read", tool_input: { file_path: "/etc/hosts" } }, { [CHAT_MODE_ENV]: "read-safe" })).toBeNull();
    expect(chatPermissionHookDecision(call("rm -rf /"), {})).toBeNull();
  });

  it("denies a call it can't read as a dr command rather than letting it through", () => {
    for (const input of [{ tool_name: "Bash" }, { tool_name: "Bash", tool_input: null }, { tool_name: "Bash", tool_input: { command: 7 } }]) {
      expect(chatPermissionHookDecision(input, { [CHAT_MODE_ENV]: "changesets" })).toContain("not a `dr` command");
    }
    expect(chatPermissionHookDecision(null, { [CHAT_MODE_ENV]: "changesets" })).toBeNull();
    expect(chatPermissionHookDecision("not json", { [CHAT_MODE_ENV]: "changesets" })).toBeNull();
  });
});
