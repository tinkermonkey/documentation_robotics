/**
 * `changeset` is the name every MCP tool uses for the changeset a call acts on (#1158).
 * `changesetId`, the older name, is accepted until the next release; a call giving both with
 * different values is refused. The existing tests that pass `changesetId` are the alias guarantee;
 * these cover the helper and show `changeset` working on each tool family.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { CLIError, ErrorCategory } from "../../../src/utils/errors.js";
import { registeredInputSchema } from "../../../src/mcp/tool-registry.js";
import { changesetArg, CHANGESET_ALIAS_DESCRIPTION } from "../../../src/mcp/tools/changeset-shared.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelTraceHandler } from "../../../src/mcp/tools/model-trace.js";
import {
  changesetActivateHandler,
  changesetActivateTool,
  changesetCreateHandler,
} from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetShowHandler, changesetShowTool } from "../../../src/mcp/tools/changeset-show.js";
import {
  changesetDiscardHandler,
  changesetDiscardTool,
  changesetUnstageHandler,
  changesetUpdateHandler,
} from "../../../src/mcp/tools/changeset-editing.js";
import { changesetBriefHandler, changesetImpactHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

function errorText(result: any): string {
  expect(result.isError).toBe(true);
  return parse(result).error;
}

function refusal(fn: () => unknown): CLIError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CLIError);
    return error as CLIError;
  }
  throw new Error("expected a refusal");
}

describe("changesetArg", () => {
  it("reads changeset, the canonical name", () => {
    expect(changesetArg({ changeset: "plan-a" })).toBe("plan-a");
    expect(changesetArg({ changeset: "plan-a" }, { required: true })).toBe("plan-a");
  });

  it("reads changesetId, the older name", () => {
    expect(changesetArg({ changesetId: "plan-a" })).toBe("plan-a");
    expect(changesetArg({ changesetId: "plan-a" }, { required: true })).toBe("plan-a");
  });

  it("accepts both names when they give the same value", () => {
    expect(changesetArg({ changeset: "plan-a", changesetId: "plan-a" })).toBe("plan-a");
  });

  it("refuses both names with different values, naming both values", () => {
    const error = refusal(() => changesetArg({ changeset: "plan-a", changesetId: "plan-b" }));
    expect(error.exitCode).toBe(ErrorCategory.USER);
    expect(error.message).toContain("'plan-a'");
    expect(error.message).toContain("'plan-b'");
    expect(error.message).toContain('"changeset"');
    expect(error.message).toContain('"changesetId"');
  });

  it("refuses a missing required changeset, naming changeset", () => {
    const error = refusal(() => changesetArg({}, { required: true, why: "discard is never implied" }));
    expect(error.exitCode).toBe(ErrorCategory.USER);
    expect(error.message).toBe('"changeset" is required: discard is never implied');
    expect(error.suggestions?.join(" ")).not.toContain("changesetId");
  });

  it("returns undefined when neither is given and none is required (the active changeset)", () => {
    expect(changesetArg({})).toBeUndefined();
  });

  it("takes another older name through alias", () => {
    expect(changesetArg({ planned: "plan-a" }, { alias: "planned", required: true })).toBe("plan-a");
    expect(refusal(() => changesetArg({ changeset: "a", planned: "b" }, { alias: "planned" })).message).toContain(
      '"planned"'
    );
  });
});

describe("tool schemas", () => {
  it("document changeset, take changesetId as its older name, and require neither in the schema", () => {
    const tools: Array<[{ name: string; inputSchema: any }, Record<string, unknown>]> = [
      [changesetActivateTool, {}],
      [changesetShowTool, {}],
      [changesetDiscardTool, { confirm: true }],
    ];
    for (const [tool, rest] of tools) {
      const schema = registeredInputSchema(tool.name, tool.inputSchema);
      expect(schema.safeParse({ changeset: "plan-a", ...rest }).success).toBe(true);
      expect(schema.safeParse({ changesetId: "plan-a", ...rest }).success).toBe(true);
      expect(schema.safeParse({ ...rest }).success).toBe(true);
      expect(tool.inputSchema.changesetId.description).toBe(CHANGESET_ALIAS_DESCRIPTION);
    }
  });
});

const GOAL = "motivation.goal.faster-checkout";
const SERVICE = "application.applicationservice.checkout";
const BILLING = "application.applicationservice.billing";

let rootPath: string;

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-changeset-arg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Changeset Arg Test Model", version: "0.1.0" });
  await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" }, rootPath });
  await changesetCreateHandler({ name: "plan-a", activate: false, rootPath });
  await changesetCreateHandler({ name: "plan-b", rootPath });
  for (const name of ["checkout", "billing"]) {
    const attributes = { serviceType: "synchronous" };
    await modelAddHandler({ layer: "application", type: "applicationservice", name, attributes, rootPath });
  }
  // plan-a is the active changeset, so a call that reaches plan-b does it by name.
  await changesetActivateHandler({ changesetId: "plan-a", rootPath });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("tools take changeset", () => {
  it("changeset_activate", async () => {
    expect(parse(await changesetActivateHandler({ changeset: "plan-b", rootPath }))).toMatchObject({
      name: "plan-b",
      active: true,
      deactivated: expect.any(String),
    });
    expect(errorText(await changesetActivateHandler({ rootPath }))).toContain('"changeset" is required');
    expect(errorText(await changesetActivateHandler({ changeset: "plan-a", changesetId: "plan-b", rootPath }))).toContain(
      "name different changesets"
    );
  });

  it("changeset_show", async () => {
    const shown = parse(await changesetShowHandler({ changeset: "plan-b", rootPath, detail: "summary" }));
    expect(shown.name).toBe("plan-b");
    expect(shown.changes.map((c: any) => c.elementId)).toEqual([SERVICE, BILLING]);
    expect(errorText(await changesetShowHandler({ rootPath }))).toContain('"changeset" is required');
  });

  it("changeset_update, changeset_unstage and changeset_discard", async () => {
    expect(parse(await changesetUpdateHandler({ changeset: "plan-a", description: "Later", rootPath }))).toMatchObject({
      name: "plan-a",
      description: "Later",
    });
    expect(parse(await changesetUnstageHandler({ changeset: "plan-b", elementId: SERVICE, rootPath }))).toMatchObject({
      changeset: "plan-b",
      remainingChanges: 1,
    });
    expect(
      parse(await changesetUnstageHandler({ changeset: "plan-b", changes: [{ elementId: BILLING }], rootPath }))
    ).toMatchObject({ changeset: "plan-b", remainingChanges: 0 });
    expect(errorText(await changesetDiscardHandler({ confirm: true, rootPath }))).toContain(
      '"changeset" is required: discard is never implied'
    );
    expect(parse(await changesetDiscardHandler({ changeset: "plan-a", confirm: true, rootPath })).status).toBe("discarded");
  });

  it("changeset_brief and changeset_impact", async () => {
    expect(parse(await changesetBriefHandler({ changeset: "plan-a", rootPath })).changeset.name).toBe("plan-a");
    expect(parse(await changesetImpactHandler({ changeset: "plan-b", rootPath })).changeset.name).toBe("plan-b");
    expect(errorText(await changesetBriefHandler({ changeset: "plan-a", changesetId: "plan-b", rootPath }))).toContain(
      "'plan-b'"
    );
  });

  it("model_trace", async () => {
    const traced = parse(await modelTraceHandler({ id: GOAL, changeset: "plan-b", rootPath }));
    expect(traced.changeset.name).toBe("plan-b");
    expect(errorText(await modelTraceHandler({ id: GOAL, changeset: "plan-b", base: true, rootPath }))).toContain(
      'Pass either "base" or "changeset"'
    );
  });
});
