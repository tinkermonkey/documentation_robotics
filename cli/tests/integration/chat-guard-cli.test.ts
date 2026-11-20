/**
 * The real `dr` CLI in a process the viewer's chat started (DR_CHAT_MODE): it refuses, itself,
 * what the chat's mode does not allow, before the command touches the model or the disk. This is
 * what holds when a launching client's allow rules let a command through (review of PR 1267).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";

let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;
let manifestBefore: string;

const manifestPath = () => join(workdir.path, "documentation-robotics", "model", "manifest.yaml");
const chat = (mode: string, args: string[]) => runDr(args, { cwd: workdir.path, env: { DR_CHAT_MODE: mode } });
const output = (result: { stdout: string; stderr: string }) => result.stdout + result.stderr;
const changesetDirs = () => {
  const dir = join(workdir.path, "documentation-robotics", "changesets");
  return existsSync(dir) ? readdirSync(dir).filter((entry) => entry.startsWith("changeset-")) : [];
};

beforeAll(async () => {
  workdir = await createTestWorkdir();
  manifestBefore = await readFile(manifestPath(), "utf8");
});

afterAll(async () => {
  await workdir.cleanup();
});

describe("dr in a chat process", () => {
  it("runs read commands in both modes", async () => {
    for (const mode of ["read-safe", "changesets"]) {
      const result = await chat(mode, ["list", "motivation"]);
      expect(result.exitCode).toBe(0);
      expect(output(result)).not.toContain("Blocked by DrBot's permissions");
    }
  });

  it("refuses --output on a read command, wherever it points, and writes nothing", async () => {
    const targets = ["documentation-robotics/model/manifest.yaml", "exported.md", join(workdir.path, "..", "outside.md")];
    for (const mode of ["read-safe", "changesets"]) {
      for (const target of targets) {
        const result = await chat(mode, ["export", "markdown", "--output", target]);
        expect(result.exitCode).not.toBe(0);
        expect(output(result)).toContain("`--output` writes a file");
      }
      const stats = await chat(mode, ["stats", "--output", "stats.txt"]);
      expect(stats.exitCode).not.toBe(0);
      const snapshot = await chat(mode, ["audit", "--save-snapshot"]);
      expect(snapshot.exitCode).not.toBe(0);
      expect(output(snapshot)).toContain("`--save-snapshot` writes a file");
    }
    expect(await readFile(manifestPath(), "utf8")).toBe(manifestBefore);
    expect(existsSync(join(workdir.path, "exported.md"))).toBe(false);
    expect(existsSync(join(workdir.path, "stats.txt"))).toBe(false);
    expect(existsSync(join(workdir.path, "..", "outside.md"))).toBe(false);
  });

  it("never lands, discards or deletes a changeset, and says whose step it is", async () => {
    for (const mode of ["read-safe", "changesets"]) {
      for (const args of [
        ["changeset", "commit", "anything"],
        ["changeset", "apply", "anything"],
        ["changeset", "discard"],
        ["changeset", "delete", "anything"],
        ["changeset", "revert", "anything"],
      ]) {
        const result = await chat(mode, args);
        expect(result.exitCode).not.toBe(0);
        expect(output(result)).toContain(`\`dr ${args.slice(0, 2).join(" ")}\``);
        expect(output(result)).toContain("person's step");
      }
    }
  });

  it("refuses every model write in a read-only viewer", async () => {
    for (const args of [
      ["add", "motivation", "goal", "Sneaky", "--attributes", '{"priority":"high"}'],
      ["update", "motivation.goal.manage-tasks", "--description", "changed"],
      ["delete", "motivation.goal.manage-tasks"],
      ["changeset", "create", "sneaky"],
      ["init", "other"],
    ]) {
      const result = await chat("read-safe", args);
      expect(result.exitCode).not.toBe(0);
      expect(output(result)).toContain("Blocked by DrBot's permissions (read-only mode)");
    }
    expect(await readFile(manifestPath(), "utf8")).toBe(manifestBefore);
    expect(changesetDirs()).toEqual([]);
  });

  it("refuses a model path outside the served project, and another agent", async () => {
    const outside = await chat("read-safe", ["list", "motivation", "--model", join(workdir.path, "..")]);
    expect(outside.exitCode).not.toBe(0);
    expect(output(outside)).toContain("points outside the project this viewer serves");
    const agent = await chat("changesets", ["chat", "claude-code", "with-danger"]);
    expect(agent.exitCode).not.toBe(0);
    expect(output(agent)).toContain("starting another chat agent is the person's step");
  });

  it("stages in staging mode (a changeset can be opened), and is unaffected outside a chat", async () => {
    const created = await chat("changesets", ["changeset", "create", "chat-guard-plan"]);
    expect(created.exitCode).toBe(0);
    expect(changesetDirs()).toHaveLength(1);
    const plain = await runDr(["stats", "--output", "stats-plain.txt"], { cwd: workdir.path });
    expect(plain.exitCode).toBe(0);
    expect(existsSync(join(workdir.path, "stats-plain.txt"))).toBe(true);
  });

  it("answers the permission hook: a deny decision with the reason, or nothing", async () => {
    const hook = async (command: string) => {
      const proc = Bun.spawn(["node", new URL("../../dist/cli.js", import.meta.url).pathname, "chat-permission-hook"], {
        cwd: workdir.path,
        env: { ...process.env, DR_CHAT_MODE: "changesets" },
        stdin: new Blob([JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: workdir.path })]),
        stdout: "pipe",
      });
      const out = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);
      return out;
    };
    expect(await hook("dr trace motivation.goal.manage-tasks")).toBe("");
    const denied = JSON.parse(await hook("dr list motivation | head -3"));
    expect(denied.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(denied.hookSpecificOutput.permissionDecisionReason).toContain("only one plain `dr` command per call");
    expect(JSON.parse(await hook("dr changeset commit x")).hookSpecificOutput.permissionDecisionReason).toContain(
      "landing a changeset is the person's step"
    );
  });
});
