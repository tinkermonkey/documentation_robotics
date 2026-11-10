/**
 * Unit tests for changeset and model CRUD over MCP: revising a staged changeset
 * (changeset_update, changeset_unstage, changeset_discard) and reading the model as the active
 * changeset leaves it (model_show relationships, model_search change status, model_trace over the
 * projected graph). See docs/CHANGE_MODELING.md.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache, loadModel } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { modelSearchHandler } from "../../../src/mcp/tools/model-search.js";
import { modelTraceHandler } from "../../../src/mcp/tools/model-trace.js";
import { modelDeleteHandler } from "../../../src/mcp/tools/model-delete.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { changesetShowHandler } from "../../../src/mcp/tools/changeset-show.js";
import { changesetCreateHandler, changesetDeactivateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import {
  changesetDiscardHandler,
  changesetUnstageHandler,
  changesetUpdateHandler,
} from "../../../src/mcp/tools/changeset-editing.js";
import { relationshipAddHandler, relationshipDeleteHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetBriefHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

const GOAL = "motivation.goal.faster-checkout";
const SERVICE = "application.applicationservice.checkout";
const FUNCTION = "application.applicationfunction.export-orders";
const OPERATION = "api.operation.export-orders";

let rootPath: string;

/** A goal and a service that realizes it, in the base model. */
async function setUpBaseModel(): Promise<void> {
  await Model.init(rootPath, { name: "Changeset CRUD Test Model", version: "0.1.0" });
  await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" }, rootPath });
  await modelAddHandler({
    layer: "application",
    type: "applicationservice",
    name: "checkout",
    attributes: { serviceType: "synchronous" },
    rootPath,
  });
  expect(parse(await relationshipAddHandler({ source: SERVICE, predicate: "realizes", target: GOAL, rootPath })).status).toBe(
    "added"
  );
}

/** Stages a function realizing the service and an operation realizing the function. */
async function planExportOrders(): Promise<void> {
  await changesetCreateHandler({ name: "export-orders", description: "Export orders as CSV", rootPath });
  await modelAddHandler({ layer: "application", type: "applicationfunction", name: "export-orders", rootPath });
  await modelAddHandler({
    layer: "api",
    type: "operation",
    name: "export-orders",
    attributes: { operationId: "exportOrders", summary: "Export orders", tags: "orders" },
    rootPath,
  });
  expect(parse(await relationshipAddHandler({ source: FUNCTION, predicate: "realizes", target: SERVICE, rootPath })).status).toBe(
    "staged"
  );
  expect(parse(await relationshipAddHandler({ source: OPERATION, predicate: "realizes", target: FUNCTION, rootPath })).status).toBe(
    "staged"
  );
}

async function stagedChanges(): Promise<string[]> {
  const shown = parse(await changesetShowHandler({ changesetId: "export-orders", rootPath }));
  return shown.changes.map((c: any) => `${c.type} ${c.elementId}`);
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-changeset-crud-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await setUpBaseModel();
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("changeset_update", () => {
  it("renames the active changeset and changes its description, keeping its changes", async () => {
    await planExportOrders();
    const updated = parse(
      await changesetUpdateHandler({ name: "export-orders-csv", description: "Admins export orders as CSV", rootPath })
    );
    expect(updated).toMatchObject({
      name: "export-orders-csv",
      previousName: "export-orders",
      description: "Admins export orders as CSV",
      status: "staged",
      changes: 4,
    });
    const brief = parse(await changesetBriefHandler({ changesetId: "export-orders-csv", rootPath, detail: "full" }));
    expect(brief.changeset.description).toBe("Admins export orders as CSV");
    expect(brief.summary.elementsAdded).toBe(2);
  });

  it("clears the description with an empty string", async () => {
    await planExportOrders();
    expect(parse(await changesetUpdateHandler({ description: "", rootPath })).description).toBeNull();
  });

  it("refuses a name another changeset has, and an update with nothing to change", async () => {
    await changesetCreateHandler({ name: "other", activate: false, rootPath });
    await planExportOrders();
    const clash = await changesetUpdateHandler({ name: "other", rootPath });
    expect(clash.isError).toBe(true);
    expect(clash.content[0].type === "text" && clash.content[0].text).toContain("already named");
    expect((await changesetUpdateHandler({ rootPath })).isError).toBe(true);
  });

  it("updates a changeset by name when none is active", async () => {
    await changesetCreateHandler({ name: "later", activate: false, rootPath });
    const updated = parse(await changesetUpdateHandler({ changesetId: "later", description: "Next quarter", rootPath }));
    expect(updated.description).toBe("Next quarter");
  });
});

describe("changeset_unstage", () => {
  it("drops one staged relationship by source, predicate and target", async () => {
    await planExportOrders();
    const result = parse(
      await changesetUnstageHandler({ source: OPERATION, predicate: "realizes", target: FUNCTION, rootPath })
    );
    expect(result.status).toBe("unstaged");
    expect(result.unstaged).toEqual([
      expect.objectContaining({
        type: "relationship-add",
        relationship: { source: OPERATION, predicate: "realizes", target: FUNCTION },
      }),
    ]);
    expect(result.remainingChanges).toBe(3);
    expect(parse(await changesetBriefHandler({ rootPath, detail: "full" })).summary.relationshipsAdded).toBe(1);
  });

  it("drops an element's add together with the staged relationships that need it, and reloads the model", async () => {
    await planExportOrders();
    const result = parse(await changesetUnstageHandler({ elementId: OPERATION, rootPath }));
    expect(result.unstaged.map((c: any) => c.type).sort()).toEqual(["add", "relationship-add"]);
    // The cached model no longer projects the element.
    expect((await modelShowHandler({ id: OPERATION, rootPath })).isError).toBe(true);
    expect(await stagedChanges()).toEqual([
      `add ${FUNCTION}`,
      `relationship-add ${FUNCTION}::realizes::${SERVICE}`,
    ]);
  });

  it("keeps dependent relationships when asked, and says they will dangle", async () => {
    await planExportOrders();
    const result = parse(await changesetUnstageHandler({ elementId: OPERATION, keepRelationships: true, rootPath }));
    expect(result.unstaged.map((c: any) => c.type)).toEqual(["add"]);
    expect(result.notes[0]).toContain("dangle");
  });

  it("drops an element's delete together with the relationship removals it staged", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    await modelDeleteHandler({ id: GOAL, force: true, rootPath } as any);
    expect((await stagedChanges()).map((c) => c.split(" ")[0]).sort()).toEqual(["delete", "relationship-delete"]);

    const result = parse(await changesetUnstageHandler({ elementId: GOAL, rootPath }));
    expect(result.remainingChanges).toBe(0);
    expect(await stagedChanges()).toEqual([]);
    expect((await modelShowHandler({ id: GOAL, rootPath })).isError).toBeFalsy();
  });

  it("keeps a relationship removal staged before the element's delete, and says so", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    await relationshipDeleteHandler({ source: SERVICE, target: GOAL, rootPath });
    await modelDeleteHandler({ id: GOAL, force: true, rootPath } as any);
    // The cascade does not stage the removal a second time.
    expect((await stagedChanges()).map((c) => c.split(" ")[0])).toEqual(["relationship-delete", "delete"]);

    const result = parse(await changesetUnstageHandler({ elementId: GOAL, rootPath }));
    expect(result.unstaged.map((c: any) => c.type)).toEqual(["delete"]);
    expect(result.notes[0]).toContain("staged before its delete were kept");
    expect(await stagedChanges()).toEqual([`relationship-delete ${SERVICE}::realizes::${GOAL}`]);
  });

  it("drops an element's update", async () => {
    await changesetCreateHandler({ name: "export-orders", rootPath });
    await modelUpdateHandler({ id: SERVICE, description: "Checkout, rewritten", rootPath });
    expect(await stagedChanges()).toEqual([`update ${SERVICE}`]);
    expect(parse(await changesetUnstageHandler({ elementId: SERVICE, rootPath })).status).toBe("unstaged");
    expect(parse(await modelShowHandler({ id: SERVICE, rootPath })).element.description).toBeUndefined();
  });

  it("reports, without failing, when nothing matching is staged", async () => {
    await planExportOrders();
    const result = await changesetUnstageHandler({ elementId: GOAL, rootPath });
    expect(result.isError).toBeFalsy();
    expect(parse(result).status).toBe("not-staged");
    expect(await stagedChanges()).toHaveLength(4);
  });

  it("needs exactly one of an element or a relationship", async () => {
    await planExportOrders();
    expect((await changesetUnstageHandler({ rootPath })).isError).toBe(true);
    expect((await changesetUnstageHandler({ elementId: OPERATION, source: OPERATION, target: FUNCTION, rootPath })).isError).toBe(
      true
    );
    expect((await changesetUnstageHandler({ source: "", rootPath })).isError).toBe(true);
  });
});

// Round-2 friction: removing one demo took 7 single unstage calls. The list form takes them in one.
describe("changeset_unstage list form", () => {
  it("unstages every item in one write and reports per item", async () => {
    await planExportOrders();
    const result = parse(
      await changesetUnstageHandler({
        changes: [
          { elementId: OPERATION },
          { target: FUNCTION },
          { source: FUNCTION, predicate: "realizes", target: SERVICE },
          { elementId: GOAL },
          { elementId: FUNCTION, source: FUNCTION },
        ],
        rootPath,
      })
    );
    expect(result.results.map((r: any) => r.status)).toEqual([
      "unstaged",
      "already-unstaged",
      "unstaged",
      "not-staged",
      "invalid",
    ]);
    expect(result.counts).toEqual({ unstaged: 2, "already-unstaged": 1, "not-staged": 1, invalid: 1 });
    expect(result.results[0].unstaged.map((c: any) => c.type).sort()).toEqual(["add", "relationship-add"]);
    expect(result.results[1].notes[0]).toContain("already unstaged by an earlier item");
    expect(result.results[4].reason).toContain("Name either an element or a relationship");
    expect(result.unstagedChanges).toBe(3);
    expect(result.remainingChanges).toBe(1);
    expect(await stagedChanges()).toEqual([`add ${FUNCTION}`]);

    // One write: the three removals share one revision.
    const model = await loadModel(rootPath);
    const changeset = await new StagingAreaManager(rootPath, model).load("export-orders");
    const removedAt = new Set((changeset as any).unstaged.map((t: any) => t.removedAt));
    expect(removedAt.size).toBe(1);
    // The cached model no longer projects the unstaged element.
    expect((await modelShowHandler({ id: OPERATION, rootPath })).isError).toBe(true);
  });

  it("writes nothing when no item matches, and refuses single-form fields beside the list", async () => {
    await planExportOrders();
    const none = parse(await changesetUnstageHandler({ changes: [{ elementId: GOAL }], rootPath }));
    expect(none.counts).toEqual({ "not-staged": 1 });
    expect(none.results[0].message).toContain("No staged change to");
    expect(await stagedChanges()).toHaveLength(4);

    const mixed = await changesetUnstageHandler({ elementId: OPERATION, changes: [{ elementId: FUNCTION }], rootPath });
    expect(mixed.isError).toBe(true);
    expect(await stagedChanges()).toHaveLength(4);
  });
});

describe("changeset_discard", () => {
  it("requires confirm, and leaves the changeset untouched without it", async () => {
    await planExportOrders();
    const refused = await changesetDiscardHandler({ changesetId: "export-orders", confirm: false, rootPath });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].type === "text" && refused.content[0].text).toContain("permanently");
    expect(await stagedChanges()).toHaveLength(4);
  });

  it("discards with confirm: clears the changes, marks it discarded, deactivates it, keeps the base model", async () => {
    await planExportOrders();
    const result = parse(await changesetDiscardHandler({ changesetId: "export-orders", confirm: true, rootPath }));
    expect(result).toMatchObject({ status: "discarded", discardedChanges: 4, deactivated: true });

    const shown = parse(await changesetShowHandler({ changesetId: "export-orders", rootPath }));
    expect(shown.status).toBe("discarded");
    expect(shown.changes).toEqual([]);
    expect((await modelShowHandler({ id: FUNCTION, rootPath })).isError).toBe(true);
    expect((await modelShowHandler({ id: SERVICE, rootPath })).isError).toBeFalsy();

    // A discarded changeset accepts no further edits.
    expect((await changesetUnstageHandler({ changesetId: "export-orders", elementId: FUNCTION, rootPath })).isError).toBe(true);
    expect((await changesetDiscardHandler({ changesetId: "export-orders", confirm: true, rootPath })).isError).toBe(true);
  });
});

describe("reading the model through the active changeset", () => {
  it("model_show lists staged relationships with their status", async () => {
    await planExportOrders();
    await relationshipDeleteHandler({ source: SERVICE, target: GOAL, rootPath });

    const shown = parse(await modelShowHandler({ id: SERVICE, rootPath }));
    expect(shown.changeset).toMatchObject({ name: "export-orders", elementStatus: "unchanged" });
    expect(shown.relationships.outgoing).toEqual([
      expect.objectContaining({ source: SERVICE, predicate: "realizes", target: GOAL, status: "deleted" }),
    ]);
    expect(shown.relationships.incoming).toEqual([
      expect.objectContaining({ source: FUNCTION, predicate: "realizes", target: SERVICE, status: "added" }),
    ]);

    // Outside the changeset, the base relationships only.
    await changesetDeactivateHandler({ rootPath });
    const base = parse(await modelShowHandler({ id: SERVICE, rootPath }));
    expect(base.changeset).toBeUndefined();
    expect(base.relationships.incoming).toEqual([]);
    expect(base.relationships.outgoing).toHaveLength(1);
  });

  it("model_search marks what the changeset adds", async () => {
    await planExportOrders();
    const found = parse(await modelSearchHandler({ query: "export-orders", rootPath }));
    expect(found.changeset.name).toBe("export-orders");
    expect(found.results.map((r: any) => [r.id, r.changeStatus]).sort()).toEqual([
      [OPERATION, "added"],
      [FUNCTION, "added"],
    ].sort());
  });

  it("reloads the cached model after staging a relationship add or delete", async () => {
    await planExportOrders();
    const keys = async () =>
      (await loadModel(rootPath)).relationships.getAll().map((r) => `${r.source}::${r.predicate}::${r.target}`);
    expect(await keys()).toContain(`${OPERATION}::realizes::${FUNCTION}`);

    await relationshipDeleteHandler({ source: SERVICE, target: GOAL, rootPath });
    expect(await keys()).not.toContain(`${SERVICE}::realizes::${GOAL}`);

    // The delete cascade reads the cached model, so it now stages removal of the staged edge too.
    await modelDeleteHandler({ id: FUNCTION, force: true, rootPath } as any);
    const brief = parse(await changesetBriefHandler({ rootPath, detail: "full" }));
    expect(brief.summary.relationshipsAdded).toBe(0);
  });

  it("keeps staged relationships labelled after the model is reloaded with the changeset active", async () => {
    await planExportOrders();
    await relationshipDeleteHandler({ source: SERVICE, target: GOAL, rootPath });
    // A fresh load merges the active changeset's relationships into model.relationships;
    // the projected graph must still see them as staged, not as base.
    clearModelCache();
    const brief = parse(await changesetBriefHandler({ rootPath, detail: "full" }));
    expect(brief.summary.relationshipsAdded).toBe(2);
    expect(brief.summary.relationshipsDeleted).toBe(1);
    expect(parse(await relationshipAddHandler({ source: OPERATION, predicate: "realizes", target: FUNCTION, rootPath })).status).toBe(
      "duplicate"
    );
  });
});

describe("model_trace over a changeset", () => {
  it("follows staged relationships and marks the changed edges and elements", async () => {
    await planExportOrders();
    const trace = parse(await modelTraceHandler({ id: OPERATION, direction: "down", rootPath }));
    expect(trace.changeset).toMatchObject({ name: "export-orders", elementStatus: "added" });
    expect(trace.dependencies.direct).toEqual([FUNCTION]);
    expect(trace.dependencies.transitive.sort()).toEqual([GOAL, SERVICE].sort());
    expect(trace.changedElements).toEqual({ [OPERATION]: "added", [FUNCTION]: "added" });
    expect(trace.changedEdges).toContainEqual({ source: OPERATION, predicate: "realizes", target: FUNCTION, status: "added" });
  });

  it("does not follow a relationship the changeset deletes, and lists it as deleted", async () => {
    await changesetCreateHandler({ name: "unlink", rootPath });
    await relationshipDeleteHandler({ source: SERVICE, target: GOAL, rootPath });
    const trace = parse(await modelTraceHandler({ id: SERVICE, rootPath }));
    expect(trace.dependencies.direct).toEqual([]);
    expect(trace.changedEdges).toEqual([{ source: SERVICE, predicate: "realizes", target: GOAL, status: "deleted" }]);

    const base = parse(await modelTraceHandler({ id: SERVICE, base: true, rootPath }));
    expect(base.changeset).toBeUndefined();
    expect(base.dependencies.direct).toEqual([GOAL]);
  });

  it("tracing a deleted element follows its own edges only, not removals elsewhere in the changeset", async () => {
    // FUNCTION realizes SERVICE in the base model; the changeset deletes FUNCTION and, separately,
    // the unrelated SERVICE -> GOAL relationship.
    await modelAddHandler({ layer: "application", type: "applicationfunction", name: "export-orders", rootPath });
    await relationshipAddHandler({ source: FUNCTION, predicate: "realizes", target: SERVICE, rootPath });
    await changesetCreateHandler({ name: "retire-export", rootPath });
    await relationshipDeleteHandler({ source: SERVICE, target: GOAL, rootPath });
    await modelDeleteHandler({ id: FUNCTION, force: true, rootPath } as any);

    const trace = parse(await modelTraceHandler({ id: FUNCTION, direction: "down", rootPath }));
    expect(trace.changeset.elementStatus).toBe("deleted");
    expect(trace.dependencies.direct).toEqual([SERVICE]);
    expect(trace.dependencies.transitive).toEqual([]);
  });

  it("traces a named changeset that is not active", async () => {
    await planExportOrders();
    await changesetDeactivateHandler({ rootPath });
    expect(parse(await modelTraceHandler({ id: SERVICE, direction: "up", rootPath })).dependents.direct).toEqual([]);
    const trace = parse(await modelTraceHandler({ id: SERVICE, direction: "up", changesetId: "export-orders", rootPath }));
    expect(trace.dependents.direct).toEqual([FUNCTION]);
    expect(trace.dependents.transitive).toEqual([OPERATION]);
  });

  it("errors for an element that exists nowhere", async () => {
    await planExportOrders();
    expect((await modelTraceHandler({ id: "api.operation.nope", rootPath })).isError).toBe(true);
  });
});

describe("StagingAreaManager.update", () => {
  it("keeps staged changes and the active marker", async () => {
    await planExportOrders();
    const model = await Model.load(rootPath, { lazyLoad: false });
    const manager = new StagingAreaManager(rootPath, model);
    const before = await manager.getActive();
    const updated = await manager.update("export-orders", { name: "renamed" });
    expect(updated.changes).toHaveLength(before!.changes.length);
    expect(await manager.getActiveId()).toBe(before!.id);
    expect((await manager.load("renamed"))?.id).toBe(before!.id);
  });
});
