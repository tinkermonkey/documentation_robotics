/**
 * Changeset-only mode on the MCP server (DR_CHANGESET_ONLY=true, as DrBot runs under
 * `dr visualize --with-changesets`): base-model writes are refused with a message pointing at
 * changeset_create, staging into an active changeset still works, and a refused write leaves
 * neither the files nor the cached model changed.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { CHANGESET_ONLY_ENV } from "../../../src/core/changeset-only-guard.js";
import { McpToolRegistry } from "../../../src/mcp/tool-registry.js";
import { BASE_MODEL_WRITE_TOOLS, changesetOnlyRefusal } from "../../../src/mcp/changeset-only.js";
import { clearModelCache, loadModel } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";

type ToolCallback = (args: Record<string, unknown>) => Promise<any>;

/** Registers the real tool surface on a stand-in server and returns a way to call tools through it. */
function registeredTools(): (name: string, args: Record<string, unknown>) => Promise<any> {
  const callbacks = new Map<string, ToolCallback>();
  const fakeServer = {
    registerTool(name: string, _config: unknown, callback: ToolCallback) {
      callbacks.set(name, callback);
    },
  };
  new McpToolRegistry().registerAll(fakeServer as any);
  return async (name, args) => {
    const callback = callbacks.get(name);
    if (!callback) throw new Error(`tool ${name} not registered`);
    return callback(args);
  };
}

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

const GOAL = "motivation.goal.faster-checkout";
const OTHER_GOAL = "motivation.goal.lower-costs";

let rootPath: string;
let savedEnv: string | undefined;
let call: ReturnType<typeof registeredTools>;

beforeEach(async () => {
  savedEnv = process.env[CHANGESET_ONLY_ENV];
  delete process.env[CHANGESET_ONLY_ENV];
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-changeset-only-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Changeset Only Test Model", version: "0.1.0" });
  const goal = await modelAddHandler({
    layer: "motivation",
    type: "goal",
    name: "faster-checkout",
    attributes: { priority: "high" },
    rootPath,
  });
  expect(goal.isError).toBeFalsy();
  const other = await modelAddHandler({ layer: "motivation", type: "goal", name: "lower-costs", attributes: { priority: "low" }, rootPath });
  expect(other.isError).toBeFalsy();
  call = registeredTools();
  process.env[CHANGESET_ONLY_ENV] = "true";
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env[CHANGESET_ONLY_ENV];
  else process.env[CHANGESET_ONLY_ENV] = savedEnv;
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

function layerFile(): string {
  return join(rootPath, "documentation-robotics", "model", "01_motivation", "goals.yaml");
}

describe("changeset-only mode through the tool registry", () => {
  it("refuses every base-model write tool when no changeset is active, pointing at changeset_create", async () => {
    const calls: Record<string, Record<string, unknown>> = {
      model_add: { layer: "motivation", type: "goal", name: "direct", attributes: { priority: "low" }, rootPath },
      model_update: { id: GOAL, description: "changed", rootPath },
      model_delete: { id: GOAL, rootPath },
      relationship_add: { source: GOAL, predicate: "aggregates", target: OTHER_GOAL, rootPath },
      relationship_delete: { source: GOAL, target: OTHER_GOAL, rootPath },
    };
    expect(new Set(Object.keys(calls))).toEqual(new Set(BASE_MODEL_WRITE_TOOLS));

    const modelDir = join(rootPath, "documentation-robotics", "model");
    const manifestBefore = await readFile(join(modelDir, "manifest.yaml"), "utf8");

    for (const [tool, args] of Object.entries(calls)) {
      const result = await call(tool, args);
      expect(result.isError).toBe(true);
      const body = parse(result);
      expect(body.error).toContain("only change the model through a changeset");
      expect(body.suggestions.join(" ")).toContain("changeset_create");
      expect(body.suggestions.join(" ")).toContain(tool);
      expect(body.operation).toBe(tool);
    }

    expect(await readFile(join(modelDir, "manifest.yaml"), "utf8")).toBe(manifestBefore);
    const shown = parse(await call("model_show", { id: GOAL, rootPath }));
    expect(shown.element.description ?? "").not.toBe("changed");
  });

  it("stages writes once the agent has created a changeset, leaving the base model alone", async () => {
    const before = await readFile(layerFile(), "utf8").catch(() => "");

    const created = parse(await call("changeset_create", { name: "plan", rootPath }));
    expect(created.active).toBe(true);

    const added = parse(
      await call("model_add", { layer: "motivation", type: "goal", name: "staged-goal", attributes: { priority: "low" }, rootPath })
    );
    expect(added.status).toBe("staged");
    const updated = await call("model_update", { id: GOAL, description: "staged change", rootPath });
    expect(updated.isError).toBeFalsy();

    expect(await readFile(layerFile(), "utf8").catch(() => "")).toBe(before);
  });

  it("refuses again after the changeset is deactivated", async () => {
    await call("changeset_create", { name: "plan", rootPath });
    await call("changeset_deactivate", { rootPath });
    const result = await call("model_add", {
      layer: "motivation",
      type: "goal",
      name: "after-deactivate",
      attributes: { priority: "low" },
      rootPath,
    });
    expect(result.isError).toBe(true);
    expect(parse(result).suggestions.join(" ")).toContain("changeset_create");
  });

  it("leaves read tools and changeset tools alone", async () => {
    expect((await call("model_list", { layer: "motivation", rootPath })).isError).toBeFalsy();
    expect((await call("changeset_list", { rootPath })).isError).toBeFalsy();
    expect((await call("spec_type", { layer: "motivation", type: "goal" })).isError).toBeFalsy();
  });
});

describe("changesetOnlyRefusal", () => {
  it("never refuses outside changeset-only mode", async () => {
    expect(await changesetOnlyRefusal("model_add", rootPath, loadModel, {})).toBeNull();
  });

  it("never refuses tools that don't write the base model", async () => {
    expect(await changesetOnlyRefusal("model_show", rootPath, loadModel)).toBeNull();
    expect(await changesetOnlyRefusal("changeset_create", rootPath, loadModel)).toBeNull();
  });

  it("steps aside (the tool reports the problem) when the model can't be loaded", async () => {
    const failingLoad = async () => {
      throw new Error("no model here");
    };
    expect(await changesetOnlyRefusal("model_add", rootPath, failingLoad)).toBeNull();
  });
});

describe("core guard behind the MCP tools", () => {
  it("turns a refused save into the MCP refusal and drops the cached model, so nothing phantom lingers", async () => {
    // Call the handler directly, skipping the registry's up-front check, so the core guard
    // (Model.saveLayer) is what refuses, after the handler edited the cached model in memory.
    const result = await modelAddHandler({
      layer: "motivation",
      type: "goal",
      name: "phantom",
      attributes: { priority: "low" },
      rootPath,
    });
    expect(result.isError).toBe(true);
    const body = parse(result);
    expect(body.error).toContain("only change the model through a changeset");
    expect(body.suggestions.join(" ")).toContain("changeset_create");

    const shown = await call("model_show", { id: "motivation.goal.phantom", rootPath });
    expect(shown.isError).toBe(true);
  });

  it("covers relationship writes too", async () => {
    const relationshipsFile = join(rootPath, "documentation-robotics", "model", "relationships.yaml");
    const before = await readFile(relationshipsFile, "utf8").catch(() => "");
    const result = await relationshipAddHandler({ source: GOAL, predicate: "aggregates", target: OTHER_GOAL, rootPath });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("only change the model through a changeset");
    expect(await readFile(relationshipsFile, "utf8").catch(() => "")).toBe(before);
  });
});
