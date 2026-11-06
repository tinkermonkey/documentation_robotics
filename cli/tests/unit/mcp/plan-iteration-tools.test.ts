/**
 * Unit tests for the tools that make each pass over a plan cheap (docs/CHANGE_MODELING.md,
 * "Iterating on a plan"): changeset_show's summary detail, model_update's attributePatch (and
 * dr update --attribute-patch), and changeset_unstage by one relationship end.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { modelDeleteHandler } from "../../../src/mcp/tools/model-delete.js";
import { changesetShowHandler, changesetShowTool } from "../../../src/mcp/tools/changeset-show.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetUnstageHandler } from "../../../src/mcp/tools/changeset-editing.js";
import { relationshipAddHandler, relationshipDeleteHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { updateCommand } from "../../../src/commands/update.js";
import { changedFields, summarizeChangeset } from "../../../src/core/changeset-summary.js";
import { applyAttributePatch, resolveAttributeUpdate } from "../../../src/utils/attribute-patch.js";

function parse(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

function errorText(result: any): string {
  expect(result.isError).toBe(true);
  return result.content[0].text;
}

const GOAL = "motivation.goal.faster-checkout";
const GOAL2 = "motivation.goal.fewer-abandoned-carts";
const SERVICE = "application.applicationservice.checkout";
const FUNCTION = "application.applicationfunction.export-orders";
const OPERATION = "api.operation.list-orders";
const OPERATION_ATTRS = { operationId: "listOrders", summary: "List orders", tags: "orders", deprecated: false };
const EXPORT = "api.operation.export-orders";
const EXPORT_ATTRS = { operationId: "exportOrders", summary: "Export orders", tags: "orders" };

let rootPath: string;

/** A goal, a service that realizes it, and an operation, in the base model. */
async function setUpBaseModel(): Promise<void> {
  await Model.init(rootPath, { name: "Plan Iteration Test Model", version: "0.1.0" });
  parse(await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" }, rootPath }));
  parse(
    await modelAddHandler({
      layer: "application",
      type: "applicationservice",
      name: "checkout",
      attributes: { serviceType: "synchronous" },
      rootPath,
    })
  );
  parse(await modelAddHandler({ layer: "api", type: "operation", name: "list-orders", attributes: OPERATION_ATTRS, rootPath }));
  expect(parse(await relationshipAddHandler({ source: SERVICE, predicate: "realizes", target: GOAL, rootPath })).status).toBe(
    "added"
  );
}

async function attributesOf(id: string): Promise<Record<string, unknown>> {
  return parse(await modelShowHandler({ id, rootPath })).element.attributes ?? {};
}

async function stagedKeys(): Promise<string[]> {
  const shown = parse(await changesetShowHandler({ changesetId: "plan", rootPath }));
  return shown.changes.map((c: any) => `${c.type} ${c.elementId}`);
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-plan-iteration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await setUpBaseModel();
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// changeset_show detail: "summary"
// ---------------------------------------------------------------------------

describe("changeset_show detail", () => {
  async function stageMixedPlan(): Promise<void> {
    parse(await changesetCreateHandler({ name: "plan", description: "Export orders", rootPath }));
    parse(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "export-orders", rootPath }));
    parse(
      await modelUpdateHandler({
        id: OPERATION,
        description: "Lists orders",
        attributePatch: { summary: "List every order" },
        rootPath,
      })
    );
    parse(await relationshipAddHandler({ source: FUNCTION, predicate: "realizes", target: SERVICE, rootPath }));
    parse(await relationshipDeleteHandler({ source: SERVICE, target: GOAL, rootPath }));
  }

  it("defaults to the full output with before/after snapshots", async () => {
    await stageMixedPlan();
    const full = parse(await changesetShowHandler({ changesetId: "plan", rootPath }));
    expect(full.detail).toBeUndefined();
    expect(full.stats).toBeDefined();
    expect(full.changes[1].after.attributes.summary).toBe("List every order");
    expect(full.changes[1].before.attributes.summary).toBe("List orders");
  });

  it("summary gives one entry per change with totals, changed fields and no snapshots", async () => {
    await stageMixedPlan();
    const summary = parse(await changesetShowHandler({ changesetId: "plan", detail: "summary", rootPath }));
    expect(summary).toMatchObject({ name: "plan", description: "Export orders", status: "staged", detail: "summary" });
    expect(summary.totals).toEqual({
      add: 1,
      update: 1,
      delete: 0,
      "relationship-add": 1,
      "relationship-delete": 1,
      total: 4,
    });
    expect(summary.changes).toEqual([
      { sequence: 0, operation: "add", layer: "application", elementId: FUNCTION, elementType: "applicationfunction" },
      {
        sequence: 1,
        operation: "update",
        layer: "api",
        elementId: OPERATION,
        elementType: "operation",
        changedFields: ["attributes.summary", "description"],
      },
      { sequence: 2, operation: "relationship-add", layer: "application", source: FUNCTION, predicate: "realizes", target: SERVICE },
      { sequence: 3, operation: "relationship-delete", layer: "application", source: SERVICE, predicate: "realizes", target: GOAL },
    ]);
    const text = JSON.stringify(summary);
    expect(text).not.toContain('"before"');
    expect(text).not.toContain('"after"');
    // Smaller than the full view.
    const full = (await changesetShowHandler({ changesetId: "plan", rootPath })).content[0] as { text: string };
    expect(text.length).toBeLessThan(full.text.length);
  });

  it("summary lists element deletes and source reference changes", async () => {
    parse(await changesetCreateHandler({ name: "plan", rootPath }));
    parse(await modelUpdateHandler({ id: SERVICE, sourceFile: "src/checkout.ts", sourceProvenance: "manual", rootPath }));
    parse(await modelDeleteHandler({ id: GOAL, force: true, rootPath } as any));
    const summary = parse(await changesetShowHandler({ changesetId: "plan", detail: "summary", rootPath }));
    expect(summary.changes[0]).toMatchObject({ operation: "update", elementId: SERVICE, changedFields: ["source_reference"] });
    expect(summary.changes.map((c: any) => c.operation).sort()).toEqual(["delete", "relationship-delete", "update"]);
    expect(summary.changes.find((c: any) => c.operation === "delete")).toMatchObject({ elementId: GOAL, elementType: "goal" });
    expect(summary.totals.total).toBe(3);
  });

  it("summary of an empty changeset has zero totals", async () => {
    parse(await changesetCreateHandler({ name: "plan", rootPath }));
    const summary = parse(await changesetShowHandler({ changesetId: "plan", detail: "summary", rootPath }));
    expect(summary.totals.total).toBe(0);
    expect(summary.changes).toEqual([]);
  });

  it("accepts only full or summary as detail", () => {
    expect(changesetShowTool.inputSchema.detail.safeParse("brief").success).toBe(false);
    expect(changesetShowTool.inputSchema.detail.safeParse("summary").success).toBe(true);
    expect(changesetShowTool.inputSchema.detail.safeParse(undefined).success).toBe(true);
  });
});

describe("changedFields / summarizeChangeset", () => {
  it("breaks attributes and metadata down by key and ignores key order and unset values", () => {
    expect(
      changedFields(
        { id: "x", name: "a", attributes: { a: 1, b: { y: 1, x: 2 } }, description: undefined },
        { id: "x", name: "a", attributes: { b: { x: 2, y: 1 }, c: 3 }, description: undefined }
      )
    ).toEqual(["attributes.a", "attributes.c"]);
    expect(changedFields({ metadata: { createdBy: "a" } }, { metadata: { createdBy: "b" } })).toEqual(["metadata.createdBy"]);
    expect(changedFields({ name: "a" }, { name: "a", source_reference: null })).toEqual([]);
    expect(changedFields({ attributes: { a: 1 } }, {})).toEqual(["attributes.a"]);
  });

  it("reports the legacy camelCase source reference key as source_reference", () => {
    expect(
      changedFields({ source_reference: { provenance: "manual" } }, { source_reference: { provenance: "manual" }, sourceReference: { provenance: "extracted" } })
    ).toEqual(["source_reference"]);
  });

  it("keeps a relationship change whose key it cannot read, named by its key", () => {
    const summary = summarizeChangeset([{ type: "relationship-add", elementId: "broken", layerName: "api" }]);
    expect(summary.changes).toEqual([{ sequence: 0, operation: "relationship-add", layer: "api", elementId: "broken" }]);
  });
});

// ---------------------------------------------------------------------------
// model_update attributePatch
// ---------------------------------------------------------------------------

describe("model_update attributePatch", () => {
  it("changes one attribute in the base model without repeating the required ones", async () => {
    // attributes (replace) without the required ones fails, as before.
    expect(errorText(await modelUpdateHandler({ id: OPERATION, attributes: { summary: "Orders" }, rootPath }))).toContain(
      "fail schema validation"
    );
    const result = parse(await modelUpdateHandler({ id: OPERATION, attributePatch: { summary: "Orders" }, rootPath }));
    expect(result.status).toBe("updated");
    expect(await attributesOf(OPERATION)).toEqual({ ...OPERATION_ATTRS, summary: "Orders" });
    // Written to disk, not only to the cached model.
    clearModelCache();
    expect(await attributesOf(OPERATION)).toEqual({ ...OPERATION_ATTRS, summary: "Orders" });
  });

  it("merges over values the active changeset already staged", async () => {
    parse(await changesetCreateHandler({ name: "plan", rootPath }));
    expect(parse(await modelUpdateHandler({ id: OPERATION, attributePatch: { summary: "Orders" }, rootPath })).status).toBe(
      "staged"
    );
    parse(await modelUpdateHandler({ id: OPERATION, attributePatch: { tags: "orders,export" }, rootPath }));
    expect(await attributesOf(OPERATION)).toEqual({ ...OPERATION_ATTRS, summary: "Orders", tags: "orders,export" });

    const summary = parse(await changesetShowHandler({ changesetId: "plan", detail: "summary", rootPath }));
    expect(summary.changes.map((c: any) => c.changedFields)).toEqual([["attributes.summary"], ["attributes.tags"]]);
  });

  it("merges into an element the changeset adds", async () => {
    parse(await changesetCreateHandler({ name: "plan", rootPath }));
    parse(await modelAddHandler({ layer: "api", type: "operation", name: "export-orders", attributes: EXPORT_ATTRS, rootPath }));
    parse(await modelUpdateHandler({ id: EXPORT, attributePatch: { summary: "Export" }, rootPath }));
    expect(await attributesOf(EXPORT)).toEqual({ ...EXPORT_ATTRS, summary: "Export" });
  });

  it("removes a key with null, and validates the merged result", async () => {
    const { deprecated: _deprecated, ...withoutDeprecated } = OPERATION_ATTRS;
    parse(await modelUpdateHandler({ id: OPERATION, attributePatch: { deprecated: null }, rootPath }));
    expect(await attributesOf(OPERATION)).toEqual(withoutDeprecated);

    // summary is required, so removing it fails and changes nothing.
    const result = await modelUpdateHandler({ id: OPERATION, attributePatch: { summary: null }, rootPath });
    expect(errorText(result)).toContain("fail schema validation");
    expect(await attributesOf(OPERATION)).toEqual(withoutDeprecated);
  });

  it("refuses attributes and attributePatch together", async () => {
    const text = errorText(
      await modelUpdateHandler({ id: OPERATION, attributes: OPERATION_ATTRS, attributePatch: { summary: "x" }, rootPath })
    );
    expect(text).toContain("Cannot use attributes and attributePatch together");
    expect(await attributesOf(OPERATION)).toEqual(OPERATION_ATTRS);
  });

  it("keeps replace semantics for attributes", async () => {
    parse(await modelUpdateHandler({ id: OPERATION, attributes: EXPORT_ATTRS, rootPath }));
    expect(await attributesOf(OPERATION)).toEqual(EXPORT_ATTRS);
  });
});

describe("dr update --attribute-patch", () => {
  it("merges into the base element", async () => {
    await updateCommand(OPERATION, { model: rootPath, attributePatch: '{"summary":"Orders","tags":null}' }).catch(() => {});
    // tags is required, so removing it fails validation and nothing changes.
    clearModelCache();
    expect(await attributesOf(OPERATION)).toEqual(OPERATION_ATTRS);

    await updateCommand(OPERATION, { model: rootPath, attributePatch: '{"summary":"Orders"}' });
    clearModelCache();
    expect(await attributesOf(OPERATION)).toEqual({ ...OPERATION_ATTRS, summary: "Orders" });
  });

  it("merges over staged values and into a staged add", async () => {
    parse(await changesetCreateHandler({ name: "plan", rootPath }));
    await updateCommand(OPERATION, { model: rootPath, attributePatch: '{"summary":"Orders"}' });
    await updateCommand(OPERATION, { model: rootPath, attributePatch: '{"tags":"orders,export"}' });
    clearModelCache();
    expect(await attributesOf(OPERATION)).toEqual({ ...OPERATION_ATTRS, summary: "Orders", tags: "orders,export" });

    parse(await modelAddHandler({ layer: "api", type: "operation", name: "export-orders", attributes: EXPORT_ATTRS, rootPath }));
    await updateCommand(EXPORT, { model: rootPath, attributePatch: '{"summary":"Export","deprecated":true}' });
    clearModelCache();
    expect(await attributesOf(EXPORT)).toEqual({ ...EXPORT_ATTRS, summary: "Export", deprecated: true });
  });

  it("refuses invalid JSON, a non-object, and --attributes with --attribute-patch", async () => {
    await expect(updateCommand(OPERATION, { model: rootPath, attributePatch: "{nope" })).rejects.toThrow(
      "Invalid JSON in --attribute-patch"
    );
    await expect(updateCommand(OPERATION, { model: rootPath, attributePatch: "[1]" })).rejects.toThrow(
      "--attribute-patch must be a JSON object"
    );
    await expect(
      updateCommand(OPERATION, { model: rootPath, attributes: "{}", attributePatch: '{"summary":"x"}' })
    ).rejects.toThrow("Cannot use --attributes and --attribute-patch together");
  });
});

describe("applyAttributePatch / resolveAttributeUpdate", () => {
  it("returns a new object and leaves the current attributes alone", () => {
    const current = { a: 1, b: 2 };
    expect(applyAttributePatch(current, { b: null, c: 3 })).toEqual({ a: 1, c: 3 });
    expect(current).toEqual({ a: 1, b: 2 });
    expect(applyAttributePatch(undefined, { a: 1, b: null })).toEqual({ a: 1 });
  });

  it("returns undefined when neither option is given", () => {
    expect(resolveAttributeUpdate({ a: 1 }, {})).toBeUndefined();
    expect(resolveAttributeUpdate({ a: 1 }, { attributes: { b: 2 } })).toEqual({ b: 2 });
  });
});

// ---------------------------------------------------------------------------
// changeset_unstage by one end
// ---------------------------------------------------------------------------

describe("changeset_unstage by one relationship end", () => {
  /** Stages a second goal, a realization of it, removes the base realization, and adds a function realizing the service. */
  async function stageRealizations(): Promise<void> {
    parse(await changesetCreateHandler({ name: "plan", rootPath }));
    parse(await modelAddHandler({ layer: "motivation", type: "goal", name: "fewer-abandoned-carts", attributes: { priority: "medium" }, rootPath }));
    parse(await relationshipAddHandler({ source: SERVICE, predicate: "realizes", target: GOAL2, rootPath }));
    parse(await relationshipDeleteHandler({ source: SERVICE, target: GOAL, rootPath }));
    parse(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "export-orders", rootPath }));
    parse(await relationshipAddHandler({ source: FUNCTION, predicate: "realizes", target: SERVICE, rootPath }));
  }

  it("source alone drops every staged add and delete from that element, and nothing else", async () => {
    await stageRealizations();
    const result = parse(await changesetUnstageHandler({ source: SERVICE, rootPath }));
    expect(result.status).toBe("unstaged");
    expect(result.unstaged.map((c: any) => [c.type, c.relationship])).toEqual([
      ["relationship-add", { source: SERVICE, predicate: "realizes", target: GOAL2 }],
      ["relationship-delete", { source: SERVICE, predicate: "realizes", target: GOAL }],
    ]);
    expect(result.remainingChanges).toBe(3);
    expect(await stagedKeys()).toEqual([
      `add ${GOAL2}`,
      `add ${FUNCTION}`,
      `relationship-add ${FUNCTION}::realizes::${SERVICE}`,
    ]);
    // The cached model is reloaded: the base realization is live again.
    const shown = parse(await modelShowHandler({ id: SERVICE, rootPath }));
    expect(JSON.stringify(shown)).not.toContain(GOAL2);
  });

  it("target alone drops every staged change to that element", async () => {
    await stageRealizations();
    const result = parse(await changesetUnstageHandler({ target: SERVICE, rootPath }));
    expect(result.unstaged).toEqual([
      expect.objectContaining({
        type: "relationship-add",
        relationship: { source: FUNCTION, predicate: "realizes", target: SERVICE },
      }),
    ]);
    expect(await stagedKeys()).toHaveLength(4);
  });

  it("filters by predicate, and reports when nothing at that end is staged", async () => {
    await stageRealizations();
    const none = parse(await changesetUnstageHandler({ source: SERVICE, predicate: "serves", rootPath }));
    expect(none.status).toBe("not-staged");
    expect(none.message).toContain(`from ${SERVICE} (serves)`);
    const nothingTo = parse(await changesetUnstageHandler({ target: OPERATION, rootPath }));
    expect(nothingTo.status).toBe("not-staged");
    expect(nothingTo.message).toContain(`to ${OPERATION}`);
    expect(await stagedKeys()).toHaveLength(5);

    const realizes = parse(await changesetUnstageHandler({ source: SERVICE, predicate: "realizes", rootPath }));
    expect(realizes.unstaged).toHaveLength(2);
  });

  it("keeps source-and-target mode and elementId mode as they were", async () => {
    await stageRealizations();
    const pair = parse(await changesetUnstageHandler({ source: SERVICE, target: GOAL2, rootPath }));
    expect(pair.unstaged.map((c: any) => c.type)).toEqual(["relationship-add"]);
    const element = parse(await changesetUnstageHandler({ elementId: FUNCTION, rootPath }));
    expect(element.unstaged.map((c: any) => c.type).sort()).toEqual(["add", "relationship-add"]);
    expect(await stagedKeys()).toEqual([`add ${GOAL2}`, `relationship-delete ${SERVICE}::realizes::${GOAL}`]);
  });

  it("still needs one mode, and refuses an empty end", async () => {
    await stageRealizations();
    expect((await changesetUnstageHandler({ rootPath })).isError).toBe(true);
    expect((await changesetUnstageHandler({ elementId: FUNCTION, source: SERVICE, rootPath })).isError).toBe(true);
    expect((await changesetUnstageHandler({ source: "", rootPath })).isError).toBe(true);
    expect(await stagedKeys()).toHaveLength(5);
  });
});
