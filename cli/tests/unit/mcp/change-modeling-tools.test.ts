/**
 * Unit tests for the change-modeling MCP tools: planning a change as a changeset, staging
 * elements and relationships into it, and pressure-testing it with changeset_brief and
 * changeset_impact. See docs/CHANGE_MODELING.md.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { modelDeleteHandler } from "../../../src/mcp/tools/model-delete.js";
import { annotationCreateHandler } from "../../../src/mcp/tools/annotation-create.js";
import {
  changesetActivateHandler,
  changesetCreateHandler,
  changesetDeactivateHandler,
} from "../../../src/mcp/tools/changeset-lifecycle.js";
import { relationshipAddHandler, relationshipDeleteHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetBriefHandler, changesetImpactHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";
import { specTypeHandler } from "../../../src/mcp/tools/spec-type.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

const GOAL = "motivation.goal.faster-checkout";
const SERVICE = "application.applicationservice.checkout";
const FUNCTION = "application.applicationfunction.export-orders";
const OPERATION = "api.operation.export-orders";

let rootPath: string;

/** A base model with a goal, a service that realizes it, and the service's source file. */
async function setUpBaseModel(): Promise<void> {
  await Model.init(rootPath, { name: "Change Modeling Test Model", version: "0.1.0" });
  for (const args of [
    { layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" } },
    {
      layer: "application",
      type: "applicationservice",
      name: "checkout",
      attributes: { serviceType: "synchronous" },
      sourceFile: "src/checkout/service.ts",
      sourceProvenance: "manual" as const,
    },
  ]) {
    const result = await modelAddHandler({ ...args, rootPath });
    if (result.isError) throw new Error(result.content[0].type === "text" ? result.content[0].text : "add failed");
  }
  const rel = await relationshipAddHandler({ source: SERVICE, predicate: "realizes", target: GOAL, rootPath });
  expect(parse(rel).status).toBe("added");
}

/** Plans "export orders": a new function realizing the checkout service and an operation realizing it. */
async function planExportOrders(): Promise<void> {
  const created = parse(
    await changesetCreateHandler({ name: "export-orders", description: "Let admins export orders as CSV", rootPath })
  );
  expect(created.active).toBe(true);

  for (const args of [
    { layer: "application", type: "applicationfunction", name: "export-orders" },
    {
      layer: "api",
      type: "operation",
      name: "export-orders",
      attributes: { operationId: "exportOrders", summary: "Export orders as CSV", tags: "orders" },
    },
  ]) {
    const added = parse(await modelAddHandler({ ...args, rootPath }));
    expect(added.status).toBe("staged");
  }

  expect(parse(await relationshipAddHandler({ source: FUNCTION, predicate: "realizes", target: SERVICE, rootPath })).status).toBe(
    "staged"
  );
  expect(
    parse(await relationshipAddHandler({ source: OPERATION, predicate: "realizes", target: FUNCTION, rootPath })).status
  ).toBe("staged");
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-change-modeling-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await setUpBaseModel();
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("changeset lifecycle tools", () => {
  it("creates and activates, refuses a duplicate name, and deactivates", async () => {
    const created = parse(await changesetCreateHandler({ name: "plan-a", rootPath }));
    expect(created.active).toBe(true);

    const duplicate = await changesetCreateHandler({ name: "plan-a", rootPath });
    expect(duplicate.isError).toBe(true);

    expect(parse(await changesetDeactivateHandler({ rootPath })).deactivated).toBe(created.id);
    expect(parse(await changesetDeactivateHandler({ rootPath })).deactivated).toBeNull();

    const activated = parse(await changesetActivateHandler({ changesetId: "plan-a", rootPath }));
    expect(activated.active).toBe(true);
  });

  it("can create without activating", async () => {
    const created = parse(await changesetCreateHandler({ name: "later", activate: false, rootPath }));
    expect(created.active).toBe(false);
    const added = parse(await modelAddHandler({ layer: "motivation", type: "goal", name: "direct", attributes: { priority: "low" }, rootPath }));
    expect(added.status).toBe("added");
  });
});

describe("relationship tools inside a changeset", () => {
  it("relates elements that exist only in the changeset, and leaves the base model alone", async () => {
    const relationshipsFile = join(rootPath, "documentation-robotics", "model", "relationships.yaml");
    const before = await readFile(relationshipsFile, "utf8");

    await planExportOrders();

    expect(await readFile(relationshipsFile, "utf8")).toBe(before);
  });

  it("shows a staged element straight after staging it (no stale projection)", async () => {
    await changesetCreateHandler({ name: "plan", rootPath });
    // Read the layer once so its projection is cached, then stage into it.
    expect((await modelShowHandler({ id: SERVICE, rootPath })).isError).toBeFalsy();
    await modelAddHandler({ layer: "application", type: "applicationfunction", name: "export-orders", rootPath });

    const shown = await modelShowHandler({ id: FUNCTION, rootPath });
    expect(shown.isError).toBeFalsy();
    expect(parse(shown).element.path).toBe(FUNCTION);
  });

  it("reports a repeated add as a duplicate instead of staging it twice", async () => {
    await planExportOrders();
    const again = parse(await relationshipAddHandler({ source: OPERATION, predicate: "realizes", target: FUNCTION, rootPath }));
    expect(again.status).toBe("duplicate");
    const brief = parse(await changesetBriefHandler({ rootPath }));
    expect(brief.summary.relationshipsAdded).toBe(2);
  });

  it("rejects a triple the catalog does not allow", async () => {
    await planExportOrders();
    const invalid = await relationshipAddHandler({ source: OPERATION, predicate: "serves", target: GOAL, rootPath });
    expect(invalid.isError).toBe(true);
  });

  it("unstages an added relationship on delete, and restores a deleted one on re-add", async () => {
    await planExportOrders();

    const removed = parse(await relationshipDeleteHandler({ source: OPERATION, target: FUNCTION, rootPath }));
    expect(removed.relationships).toEqual([{ status: "unstaged", predicate: "realizes" }]);

    const deleted = parse(await relationshipDeleteHandler({ source: SERVICE, target: GOAL, predicate: "realizes", rootPath }));
    expect(deleted.relationships).toEqual([{ status: "staged", predicate: "realizes" }]);
    let brief = parse(await changesetBriefHandler({ rootPath }));
    expect(brief.summary.relationshipsAdded).toBe(1);
    expect(brief.summary.relationshipsDeleted).toBe(1);

    const restored = parse(await relationshipAddHandler({ source: SERVICE, predicate: "realizes", target: GOAL, rootPath }));
    expect(restored.status).toBe("restored");
    brief = parse(await changesetBriefHandler({ rootPath }));
    expect(brief.summary.relationshipsDeleted).toBe(0);
  });

  it("refuses to relate an element the changeset deletes", async () => {
    await changesetCreateHandler({ name: "remove-goal", rootPath });
    await modelDeleteHandler({ id: GOAL, force: true, rootPath } as any);
    const result = await relationshipAddHandler({ source: SERVICE, predicate: "realizes", target: GOAL, rootPath });
    expect(result.isError).toBe(true);
  });
});

describe("changeset_brief", () => {
  it("lays out the change by layer, its reach, intent trace and touched code", async () => {
    await planExportOrders();
    const brief = parse(await changesetBriefHandler({ rootPath }));

    expect(brief.changeset.name).toBe("export-orders");
    expect(brief.changeset.description).toBe("Let admins export orders as CSV");
    expect(brief.changeset.drift.isDrifted).toBe(false);
    expect(brief.summary).toEqual({
      elementsAdded: 2,
      elementsUpdated: 0,
      elementsDeleted: 0,
      relationshipsAdded: 2,
      relationshipsDeleted: 0,
    });

    expect(brief.layers.map((l: any) => l.layer)).toEqual(["application", "api"]);
    const fn = brief.layers[0].changes[0];
    expect(fn.id).toBe(FUNCTION);
    expect(fn.connections).toContainEqual(
      expect.objectContaining({ direction: "out", predicate: "realizes", other: SERVICE, status: "added" })
    );

    expect(brief.reach.touched).toEqual(["application", "api"]);
    expect(brief.reach.untouched).toContain("data-model");
    expect(brief.gaps.filter((g: any) => g.kind !== "missing-expected")).toEqual([]);
    expect(brief.intent.untraced).toEqual([]);
    expect(brief.intent.traced).toContainEqual({ element: OPERATION, tracesTo: GOAL, distance: 3 });

    expect(brief.codeTouched).toEqual([
      { file: "src/checkout/service.ts", elements: [{ id: SERVICE, role: "neighbor" }] },
    ]);
  });

  it("flags an unconnected addition that traces to no intent", async () => {
    await planExportOrders();
    await modelAddHandler({
      layer: "data-model",
      type: "objectschema",
      name: "order-export-row",
      attributes: { type: "object" },
      rootPath,
    });
    const brief = parse(await changesetBriefHandler({ rootPath }));
    expect(brief.gaps).toContainEqual(
      expect.objectContaining({ kind: "unconnected", element: "data-model.objectschema.order-export-row" })
    );
    expect(brief.intent.untraced).toEqual(["data-model.objectschema.order-export-row"]);
  });

  it("flags connections an addition's peers usually have and it lacks", async () => {
    // Two existing functions realize the checkout service, and an API operation realizes each.
    for (const name of ["price-cart", "apply-coupon"]) {
      await modelAddHandler({ layer: "application", type: "applicationfunction", name, rootPath });
      await modelAddHandler({
        layer: "api",
        type: "operation",
        name,
        attributes: { operationId: name, summary: name, tags: "checkout" },
        rootPath,
      });
      await relationshipAddHandler({
        source: `application.applicationfunction.${name}`,
        predicate: "realizes",
        target: SERVICE,
        rootPath,
      });
      await relationshipAddHandler({
        source: `api.operation.${name}`,
        predicate: "realizes",
        target: `application.applicationfunction.${name}`,
        rootPath,
      });
    }

    // A third function, planned without its operation.
    await changesetCreateHandler({ name: "gift-cards", rootPath });
    await modelAddHandler({ layer: "application", type: "applicationfunction", name: "redeem-gift-card", rootPath });
    await relationshipAddHandler({
      source: "application.applicationfunction.redeem-gift-card",
      predicate: "realizes",
      target: SERVICE,
      rootPath,
    });

    let brief = parse(await changesetBriefHandler({ rootPath }));
    const gap = brief.gaps.find((g: any) => g.kind === "peer-pattern");
    expect(gap).toBeDefined();
    expect(gap.element).toBe("application.applicationfunction.redeem-gift-card");
    expect(gap.detail).toContain("2 of 2");
    expect(gap.detail).toContain("api.operation --realizes--> them");
    expect(gap.examples).toContain("api.operation.price-cart --realizes--> application.applicationfunction.price-cart");

    // Planning the operation closes the gap.
    await modelAddHandler({
      layer: "api",
      type: "operation",
      name: "redeem-gift-card",
      attributes: { operationId: "redeemGiftCard", summary: "Redeem", tags: "checkout" },
      rootPath,
    });
    await relationshipAddHandler({
      source: "api.operation.redeem-gift-card",
      predicate: "realizes",
      target: "application.applicationfunction.redeem-gift-card",
      rootPath,
    });
    brief = parse(await changesetBriefHandler({ rootPath }));
    expect(
      brief.gaps.filter((g: any) => g.kind === "peer-pattern" && g.element === "application.applicationfunction.redeem-gift-card")
    ).toEqual([]);
  });

  it("includes open annotations on what the change touches", async () => {
    await planExportOrders();
    await annotationCreateHandler({ elementId: SERVICE, content: "Checkout is being split next quarter", rootPath });
    const brief = parse(await changesetBriefHandler({ rootPath }));
    expect(brief.feedback).toHaveLength(1);
    expect(brief.feedback[0]).toEqual(
      expect.objectContaining({ elementId: SERVICE, content: "Checkout is being split next quarter" })
    );
  });

  it("reads a changeset by name after it is deactivated", async () => {
    await planExportOrders();
    await changesetDeactivateHandler({ rootPath });
    expect((await modelShowHandler({ id: FUNCTION, rootPath })).isError).toBe(true);
    const brief = parse(await changesetBriefHandler({ changesetId: "export-orders", rootPath }));
    expect(brief.summary.elementsAdded).toBe(2);
  });

  it("errors when no changeset is named or active", async () => {
    const result = await changesetBriefHandler({ rootPath });
    expect(result.isError).toBe(true);
  });
});

describe("changeset_impact", () => {
  it("reaches existing elements through staged relationships, with their files", async () => {
    await planExportOrders();
    const impact = parse(await changesetImpactHandler({ depth: 2, rootPath }));

    expect(impact.truncated).toBe(false);
    expect(impact.byLayer.application).toEqual([
      expect.objectContaining({
        id: SERVICE,
        distance: 1,
        via: `${FUNCTION} --realizes--> ${SERVICE} (added by this changeset)`,
        files: ["src/checkout/service.ts"],
      }),
    ]);
    expect(impact.byLayer.motivation).toEqual([expect.objectContaining({ id: GOAL, distance: 2 })]);
  });

  it("treats both ends of a relationship removed between existing elements as impacted", async () => {
    await changesetCreateHandler({ name: "unlink", rootPath });
    await relationshipDeleteHandler({ source: SERVICE, target: GOAL, rootPath });
    const impact = parse(await changesetImpactHandler({ depth: 1, rootPath }));
    expect(impact.changed).toBe(0);
    expect(impact.reached).toBe(2);
    expect(impact.byLayer.motivation[0].via).toBe(`${SERVICE} --realizes--> ${GOAL} (deleted by this changeset)`);
  });

  it("respects depth", async () => {
    await planExportOrders();
    const impact = parse(await changesetImpactHandler({ depth: 1, rootPath }));
    expect(impact.byLayer.motivation).toBeUndefined();
  });
});

describe("model_add in a long-running server", () => {
  it("still enforces a type's required attributes after the type was validated once", async () => {
    // The MCP server validates every add in one process. The first add of a type compiles its
    // schema; later adds must reuse it, not fall back to the base schema.
    const valid = await modelAddHandler({
      layer: "api",
      type: "operation",
      name: "first",
      attributes: { operationId: "first", summary: "First", tags: "t" },
      rootPath,
    });
    expect(valid.isError).toBeFalsy();
    const invalid = await modelAddHandler({ layer: "api", type: "operation", name: "second", attributes: {}, rootPath });
    expect(invalid.isError).toBe(true);
  });
});

describe("spec_type", () => {
  it("returns a type's attributes and allowed relationships", async () => {
    const result = parse(await specTypeHandler({ layer: "api", type: "operation" }));
    expect(result.specNodeId).toBe("api.operation");
    expect(result.definition).toBeTruthy();
    expect(result.attributes.filter((a: any) => a.required).map((a: any) => a.name).sort()).toEqual([
      "operationId",
      "summary",
      "tags",
    ]);
    expect(result.outgoing).toContainEqual({ predicate: "realizes", target: "application.applicationfunction" });
  });

  it("filters by predicate and other layer", async () => {
    const result = parse(
      await specTypeHandler({ layer: "application", type: "applicationservice", predicate: "realizes", otherLayer: "motivation" })
    );
    expect(result.outgoing).toEqual([{ predicate: "realizes", target: "motivation.goal" }]);
    expect(result.incoming).toEqual([]);
  });

  it("lists a layer's types when no type is given", async () => {
    const result = parse(await specTypeHandler({ layer: "motivation" }));
    expect(result.types.map((t: any) => t.type)).toContain("goal");
  });

  it("suggests close matches for a bad type", async () => {
    const result = await specTypeHandler({ layer: "api", type: "operaton" });
    expect(result.isError).toBe(true);
    expect(result.content[0].type === "text" && result.content[0].text).toContain("operation");
  });
});
