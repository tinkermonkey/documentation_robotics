/**
 * A dr MCP server the viewer's chat started (DR_CHAT_MODE, coding-agents/chat-guard.ts) refuses,
 * itself, a tool outside the chat's mode and any rootPath but the served project, whatever the
 * launching client's own allow rules say. A refused call changes nothing on disk.
 *
 * Every call that is meant to run names the scratch project with rootPath: a handler called
 * without one loads the model of the test runner's own working directory, which is this
 * repository's model.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { CHAT_MODE_ENV } from "../../../src/coding-agents/chat-guard.js";
import { CHANGESET_ONLY_ENV } from "../../../src/core/changeset-only-guard.js";
import { McpToolRegistry } from "../../../src/mcp/tool-registry.js";
import { markEnvProjectRoot, resetProjectRoot } from "../../../src/mcp/project-root.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";

type ToolCallback = (args: Record<string, unknown>) => Promise<any>;

function registeredTools(): (name: string, args: Record<string, unknown>) => Promise<any> {
  const callbacks = new Map<string, ToolCallback>();
  new McpToolRegistry().registerAll({
    registerTool(name: string, _config: unknown, callback: ToolCallback) {
      callbacks.set(name, callback);
    },
  } as any);
  return async (name, args) => callbacks.get(name)!(args);
}

const text = (result: any): string => result.content[0].text;

let served: string;
let other: string;
let call: ReturnType<typeof registeredTools>;
const saved: Record<string, string | undefined> = {};

async function project(name: string): Promise<string> {
  const root = join(tmpdir(), `dr-mcp-chat-mode-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
  await Model.init(root, { name: `Chat Mode ${name}`, version: "0.1.0" });
  return root;
}

const manifest = (root: string) => readFile(join(root, "documentation-robotics", "model", "manifest.yaml"), "utf8");
const changesets = (root: string) => {
  const dir = join(root, "documentation-robotics", "changesets");
  return existsSync(dir) ? readdirSync(dir).filter((entry) => entry.startsWith("changeset-")) : [];
};

beforeEach(async () => {
  for (const name of [CHAT_MODE_ENV, CHANGESET_ONLY_ENV]) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  clearModelCache();
  served = await project("served");
  other = await project("other");
  // As `dr mcp` does when the launch names the model with DR_MCP_ROOT_PATH.
  markEnvProjectRoot(served);
  call = registeredTools();
});

afterEach(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetProjectRoot();
  clearModelCache();
  await rm(served, { recursive: true, force: true });
  await rm(other, { recursive: true, force: true });
});

describe("dr mcp in a chat process", () => {
  it("refuses a rootPath other than the served project, for reads and for writes", async () => {
    for (const mode of ["read-safe", "changesets"]) {
      process.env[CHAT_MODE_ENV] = mode;
      for (const [tool, args] of [
        ["model_list", {}],
        ["model_stats", {}],
        ["changeset_list", {}],
        ["changeset_create", { name: "elsewhere" }],
        ["model_add", { layer: "motivation", type: "goal", name: "elsewhere", attributes: { priority: "high" } }],
      ] as const) {
        const result = await call(tool, { ...args, rootPath: other });
        expect(result.isError).toBe(true);
        expect(text(result)).toContain("is not the project this viewer serves");
      }
    }
    expect(changesets(other)).toEqual([]);
    expect(await manifest(other)).not.toContain("elsewhere");
  });

  it("serves the project it was started for, with or without its rootPath", async () => {
    process.env[CHAT_MODE_ENV] = "read-safe";
    expect((await call("model_stats", { rootPath: served })).isError).toBeFalsy();
    expect((await call("model_stats", { rootPath: `${served}/` })).isError).toBeFalsy();
  });

  it("refuses every write in a read-only viewer, and leaves the model as it was", async () => {
    process.env[CHAT_MODE_ENV] = "read-safe";
    const before = await manifest(served);
    for (const [tool, args] of [
      ["model_add", { layer: "motivation", type: "goal", name: "sneaky", attributes: { priority: "high" } }],
      ["changeset_create", { name: "sneaky" }],
      ["relationship_add", { source: "motivation.goal.a", predicate: "realizes", target: "motivation.goal.b" }],
      ["gap_accept", { element: "motivation.goal.a", reason: "x" }],
    ] as const) {
      const result = await call(tool, { ...args, rootPath: served });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Blocked by DrBot's permissions (read-only mode)");
      expect(text(result)).toContain("--read-only");
    }
    expect(await manifest(served)).toBe(before);
    expect(changesets(served)).toEqual([]);
  });

  it("never lands, discards, creates or migrates, in either mode", async () => {
    for (const mode of ["read-safe", "changesets"]) {
      process.env[CHAT_MODE_ENV] = mode;
      for (const tool of ["changeset_commit", "changeset_commit_preview", "changeset_discard", "project_init", "project_upgrade"]) {
        const result = await call(tool, { changeset: "x", confirm: true, force: true, apply: true, rootPath: served });
        expect(result.isError).toBe(true);
        expect(text(result)).toContain("person's step");
      }
    }
  });

  it("refuses the tools DrBot was never given: code extraction, agents, annotation writes", async () => {
    process.env[CHAT_MODE_ENV] = "changesets";
    for (const tool of ["codebase_extract", "codebase_index", "chat_launch", "review_open", "annotation_create"]) {
      const result = await call(tool, { rootPath: served });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("not on DrBot's allowlist in changeset staging mode");
    }
  });

  it("stages into a changeset in staging mode, and still refuses a base-model write without one", async () => {
    process.env[CHAT_MODE_ENV] = "changesets";
    process.env[CHANGESET_ONLY_ENV] = "true";
    const goal = {
      layer: "motivation",
      type: "goal",
      name: "faster-checkout",
      attributes: { priority: "high" },
      rootPath: served,
    };
    const refused = await call("model_add", goal);
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("no changeset is active");

    expect((await call("changeset_create", { name: "plan", rootPath: served })).isError).toBeFalsy();
    const staged = await call("model_add", goal);
    expect(staged.isError).toBeFalsy();
    expect(JSON.parse(text(staged)).status).toBe("staged");
    expect(changesets(served)).toHaveLength(1);
  });

  it("decides nothing outside a chat", async () => {
    expect((await call("model_stats", { rootPath: other })).isError).toBeFalsy();
  });
});
