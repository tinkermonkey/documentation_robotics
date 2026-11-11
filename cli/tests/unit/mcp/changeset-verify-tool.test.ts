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
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
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

describe("changeset_verify dogfood regressions", () => {
  it("bug 7: with nothing active, the hint names the 'planned' parameter", async () => {
    const result = await changesetVerifyHandler({ against: { base: true }, rootPath });
    expect(result.isError).toBe(true);
    const suggestions: string[] = parse(result).suggestions;
    expect(suggestions.join(" ")).toContain('"planned"');
    expect(suggestions.join(" ")).not.toContain('"changesetId"');
  });

  it("bug 5: against the base, elements that predate the plan are not candidates for its add", async () => {
    // Three operations already in a barrel file before the plan.
    for (const name of ["radial-tree-layout", "force-layout", "grid-layout"]) {
      await ok(
        await modelAddHandler({
          layer: "api",
          type: "operation",
          name,
          attributes: { ...OP_ATTRS, operationId: name },
          sourceFile: "src/index.ts",
          sourceProvenance: "manual",
          rootPath,
        })
      );
    }
    await ok(await changesetCreateHandler({ name: "plan", rootPath }));
    await ok(
      await modelAddHandler({
        layer: "api",
        type: "operation",
        name: "layered-dag-layout",
        attributes: { ...OP_ATTRS, operationId: "layeredDagLayout" },
        sourceFile: "src/index.ts",
        sourceProvenance: "manual",
        rootPath,
      })
    );
    await ok(await changesetDeactivateHandler({ rootPath }));

    const manager = new StagingAreaManager(rootPath, await Model.load(rootPath, { lazyLoad: false }));
    const plan = (await manager.list()).find((c) => c.name === "plan")!;
    expect(await Bun.file(join(rootPath, "documentation-robotics", "changesets", plan.id, "base-index.json")).exists()).toBe(true);

    const report = await ok(await changesetVerifyHandler({ planned: "plan", against: { base: true }, rootPath }));
    const missing = report.elements.missing.find((m: any) => m.planned === "api.operation.layered-dag-layout");
    expect(missing.candidates).toBeUndefined();
    expect(missing.reason).toBe("not found in the build by id, name or source file");
  });

  it("bug 4: a planned update the as-built made differently is divergent, with both values", async () => {
    await ok(await changesetCreateHandler({ name: "plan", rootPath }));
    await ok(
      await modelUpdateHandler({ id: SERVICE, description: "Checkout, with CSV export", rootPath } as any)
    );
    await ok(await changesetDeactivateHandler({ rootPath }));
    await ok(await changesetCreateHandler({ name: "as-built", rootPath }));
    await ok(await modelUpdateHandler({ id: SERVICE, description: "Checkout and order export", rootPath } as any));
    await ok(await changesetDeactivateHandler({ rootPath }));

    const report = await ok(await changesetVerifyHandler({ planned: "plan", against: { changesetId: "as-built" }, rootPath }));
    expect(report.elements.missing).toEqual([]);
    expect(report.elements.divergent).toHaveLength(1);
    expect(report.elements.divergent[0].fields).toEqual([
      { field: "description", planned: "Checkout, with CSV export", built: "Checkout and order export" },
    ]);
    expect(report.summary.elements.matched).toBe(1);
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

    // CI terminals get colour (GitHub Actions), which puts escape codes between ✓ and the id.
    const text = formatVerifyReport(report).replace(/\u001b\[[0-9;]*m/g, "");
    expect(text).toContain("match: The build matches the plan.");
    expect(text).toContain(`✓ ${OPERATION}`);
  });
});
