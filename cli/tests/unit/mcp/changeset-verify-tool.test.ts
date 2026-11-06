/**
 * Unit tests for the changeset_verify MCP tool and `dr changeset verify`, over a real model on disk.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { clearModelCache, loadModel } from "../../../src/mcp/tools/shared.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCreateHandler, changesetDeactivateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetVerifyHandler } from "../../../src/mcp/tools/changeset-verify.js";
import { changesetVerifyCommand, formatVerifyReport } from "../../../src/commands/changeset-verify.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

async function ok(result: any): Promise<any> {
  if (result.isError) throw new Error(result.content[0].text);
  return parse(result);
}

const GOAL = "motivation.goal.faster-checkout";
const SERVICE = "application.applicationservice.checkout";
const FUNCTION = "application.applicationfunction.export-orders";
const OPERATION = "api.operation.export-orders";
const OP_ATTRS = { operationId: "exportOrders", summary: "Export orders as CSV", tags: "orders" };

let rootPath: string;

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Verify Test Model", version: "0.1.0" });
  await ok(await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" }, rootPath }));
  await ok(
    await modelAddHandler({
      layer: "application",
      type: "applicationservice",
      name: "checkout",
      attributes: { serviceType: "synchronous" },
      rootPath,
    })
  );
  await ok(await relationshipAddHandler({ source: SERVICE, predicate: "realizes", target: GOAL, rootPath }));
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

/** Stages `name`: a function realizing the checkout service and an operation realizing the function. */
async function stagePlan(name: string, functionName = "export-orders"): Promise<void> {
  await ok(await changesetCreateHandler({ name, rootPath }));
  await ok(await modelAddHandler({ layer: "application", type: "applicationfunction", name: functionName, rootPath }));
  await ok(await modelAddHandler({ layer: "api", type: "operation", name: "export-orders", attributes: OP_ATTRS, rootPath }));
  const fn = `application.applicationfunction.${functionName}`;
  await ok(await relationshipAddHandler({ source: fn, predicate: "realizes", target: SERVICE, rootPath }));
  await ok(await relationshipAddHandler({ source: OPERATION, predicate: "realizes", target: fn, rootPath }));
  await ok(await changesetDeactivateHandler({ rootPath }));
}

describe("changeset_verify", () => {
  it("compares a plan with an as-built changeset, matching a renamed function as probable", async () => {
    await stagePlan("plan");
    await stagePlan("as-built", "export-order-csv");

    const report = await ok(await changesetVerifyHandler({ planned: "plan", against: { changesetId: "as-built" }, rootPath }));
    expect(report.plannedChangeset.name).toBe("plan");
    expect(report.against.kind).toBe("changeset");
    // "export-orders" vs "export-order-csv" do not normalize to the same name: no fuzzy match by name.
    expect(report.elements.missing.map((m: any) => m.planned)).toEqual([FUNCTION]);
    expect(report.elements.unplanned.map((u: any) => u.id)).toEqual(["application.applicationfunction.export-order-csv"]);
    expect(report.elements.matched.map((m: any) => m.planned)).toEqual([OPERATION]);
    expect(report.verdict).toBe("incomplete");
  });

  it("matches through a rename that only changes case and separators", async () => {
    await stagePlan("plan");
    await stagePlan("as-built", "exportorders");

    const report = await ok(await changesetVerifyHandler({ planned: "plan", against: { changesetId: "as-built" }, rootPath }));
    expect(report.verdict).toBe("probable-match");
    expect(report.relationships.matched).toHaveLength(2);
    expect(report.relationships.matched.every((m: any) => m.match === "probable")).toBe(true);
  });

  it("compares a plan with the base model after the build landed there", async () => {
    await stagePlan("plan");
    // The build lands directly in the base model, with a different summary and an extra dependency.
    await ok(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "export-orders", rootPath }));
    await ok(
      await modelAddHandler({
        layer: "api",
        type: "operation",
        name: "export-orders",
        attributes: { ...OP_ATTRS, summary: "Export orders" },
        rootPath,
      })
    );
    await ok(await relationshipAddHandler({ source: FUNCTION, predicate: "realizes", target: SERVICE, rootPath }));
    await ok(await relationshipAddHandler({ source: OPERATION, predicate: "realizes", target: FUNCTION, rootPath }));
    const VALIDATE = "application.applicationfunction.validate-orders";
    await ok(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "validate-orders", rootPath }));
    await ok(await relationshipAddHandler({ source: FUNCTION, predicate: "depends-on", target: VALIDATE, rootPath }));

    const report = await ok(await changesetVerifyHandler({ planned: "plan", against: { base: true }, rootPath }));
    expect(report.against.kind).toBe("base");
    expect(report.elements.divergent).toHaveLength(1);
    expect(report.elements.divergent[0].fields).toEqual([
      { field: "attributes.summary", planned: "Export orders as CSV", built: "Export orders" },
    ]);
    expect(report.relationships.matched).toHaveLength(2);
    expect(report.relationships.unplanned).toEqual([
      { source: FUNCTION, predicate: "depends-on", target: VALIDATE, change: "present" },
    ]);
    expect(report.verdict).toBe("diverges");
    expect(report.notes.join(" ")).toContain("base model");
  });

  it("sees a build committed outside MCP after the server cached the model", async () => {
    await stagePlan("plan");
    await stagePlan("as-built");
    const before = await ok(await changesetVerifyHandler({ planned: "plan", against: { base: true }, rootPath }));
    expect(before.verdict).toBe("incomplete");
    await loadModel(rootPath); // the server holds a cached model from here on

    // The human commits the as-built changeset with the CLI, in another process.
    const external = await Model.load(rootPath, { lazyLoad: false });
    const manager = new StagingAreaManager(rootPath, external);
    const asBuiltId = (await manager.list()).find((c) => c.name === "as-built")!.id;
    await manager.commit(external, asBuiltId);

    const after = await ok(await changesetVerifyHandler({ planned: "plan", against: { base: true }, rootPath }));
    expect(after.elements.missing).toHaveLength(0);
    expect(after.relationships.missing).toHaveLength(0);
    expect(after.verdict).toBe("match");
  });

  it("defaults the plan to the active changeset", async () => {
    await stagePlan("plan");
    await ok(await changesetCreateHandler({ name: "other", activate: false, rootPath }));
    const { changesetActivateHandler } = await import("../../../src/mcp/tools/changeset-lifecycle.js");
    await ok(await changesetActivateHandler({ changesetId: "plan", rootPath }));
    const report = await ok(await changesetVerifyHandler({ against: { changesetId: "other" }, rootPath }));
    expect(report.plannedChangeset.name).toBe("plan");
    expect(report.elements.missing).toHaveLength(2);
  });

  it("errors with suggestions when there is nothing to compare with, or both are given", async () => {
    await stagePlan("plan");
    const none = await changesetVerifyHandler({ planned: "plan", against: {}, rootPath });
    expect(none.isError).toBe(true);
    expect(parse(none).suggestions.length).toBeGreaterThan(0);

    const both = await changesetVerifyHandler({ planned: "plan", against: { changesetId: "plan", base: true }, rootPath });
    expect(both.isError).toBe(true);

    const unknown = await changesetVerifyHandler({ planned: "plan", against: { changesetId: "nope" }, rootPath });
    expect(unknown.isError).toBe(true);
    expect(parse(unknown).error).toContain("nope");
  });
});

describe("dr changeset verify", () => {
  it("prints the report as JSON and as text", async () => {
    await stagePlan("plan");
    await stagePlan("as-built");

    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));
    try {
      await changesetVerifyCommand("plan", { model: rootPath, against: "as-built", json: true });
    } finally {
      console.log = original;
    }
    const report = JSON.parse(lines.join("\n"));
    expect(report.verdict).toBe("match");

    const text = formatVerifyReport(report);
    expect(text).toContain("match: The build matches the plan.");
    expect(text).toContain(`✓ ${OPERATION}`);
  });
});
