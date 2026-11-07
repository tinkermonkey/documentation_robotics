/**
 * Regression tests for staging into a layer the base model does not have, within one MCP session
 * (one cached model), and for updating an element the changeset itself adds.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { modelDeleteHandler } from "../../../src/mcp/tools/model-delete.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { changesetCreateHandler, changesetDeactivateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { findElementLayer } from "../../../src/utils/element-utils.js";
import { updateCommand } from "../../../src/commands/update.js";
import { setJsonMode } from "../../../src/utils/globals.js";
import { changesetUnstageHandler } from "../../../src/mcp/tools/changeset-editing.js";
import { relationshipAddHandler, relationshipDeleteHandler } from "../../../src/mcp/tools/relationship-tools.js";

function parse(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

const SCHEMA = "data-model.objectschema.order-export-row";
const COLLECTION = "data-store.collection.order-exports";
const COLLECTION_TWO = "data-store.collection.order-export-rows";

let rootPath: string;
let changesetId: string;

async function add(args: Record<string, unknown>): Promise<any> {
  return parse(await modelAddHandler({ ...(args as any), rootPath }));
}

async function relate(source: string, predicate: string, target: string): Promise<any> {
  return parse(await relationshipAddHandler({ source, predicate, target, rootPath }));
}

async function stagedChanges(): Promise<any[]> {
  const storage = new StagedChangesetStorage(rootPath);
  const changeset = await storage.load(changesetId);
  return changeset!.changes as any[];
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-new-layer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  // A base model with a data-model layer and no data-store layer.
  await Model.init(rootPath, { name: "New Layer Test Model", version: "0.1.0" });
  await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
  // Model.init creates every layer's directory; a project like heimdall simply has none for data-store.
  await rm(join(rootPath, "documentation-robotics", "model", "09_data-store"), { recursive: true, force: true });
  clearModelCache();
  changesetId = parse(await changesetCreateHandler({ name: "export-orders", rootPath })).id;
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("staging into a layer the base model does not have (one session)", () => {
  it("relationship_add finds an element model_add just staged in a new layer, as target and source", async () => {
    expect((await add({ layer: "data-store", type: "collection", name: "order-exports" })).status).toBe("staged");
    expect((await relate(SCHEMA, "maps-to", COLLECTION)).status).toBe("staged");

    expect((await add({ layer: "data-store", type: "collection", name: "order-export-rows" })).status).toBe("staged");
    expect((await relate(COLLECTION, "composes", COLLECTION_TWO)).status).toBe("staged");
  });

  it("model_show, model_update, relationship_delete, model_delete and changeset_unstage see it too", async () => {
    await add({ layer: "data-store", type: "collection", name: "order-exports" });
    await add({ layer: "data-store", type: "collection", name: "order-export-rows" });
    await relate(SCHEMA, "maps-to", COLLECTION);
    await relate(COLLECTION, "composes", COLLECTION_TWO);

    const shown = parse(await modelShowHandler({ id: COLLECTION, rootPath }));
    expect(shown.layer).toBe("data-store");
    expect(shown.changeset.elementStatus).toBe("added");

    const updated = parse(await modelUpdateHandler({ id: COLLECTION, description: "Exported orders", rootPath }));
    expect(updated.status).toBe("staged");

    const deleted = parse(await relationshipDeleteHandler({ source: COLLECTION, target: COLLECTION_TWO, rootPath }));
    expect(deleted.relationships).toHaveLength(1);

    const removed = parse(await modelDeleteHandler({ id: COLLECTION_TWO, force: true, rootPath }));
    expect(removed.id).toBe(COLLECTION_TWO);

    parse(await changesetUnstageHandler({ elementId: COLLECTION, rootPath } as any));
    const remaining = await stagedChanges();
    expect(remaining.some((c) => c.elementId === COLLECTION)).toBe(false);
  });
});

describe("model_update on an element the changeset adds", () => {
  it("folds the update into the staged add, keeps its sequence number, and returns the changed fields", async () => {
    await add({ layer: "data-store", type: "collection", name: "order-exports" });
    await add({ layer: "data-model", type: "objectschema", name: "order-export-summary", attributes: { type: "object" } });
    const before = await stagedChanges();
    const addChange = before.find((c) => c.elementId === COLLECTION);
    expect(addChange.type).toBe("add");

    const result = parse(
      await modelUpdateHandler({ id: COLLECTION, description: "Exported orders", rootPath })
    );
    expect(result.status).toBe("staged");
    expect(result.changedFields).toEqual(["description"]);

    const after = await stagedChanges();
    expect(after).toHaveLength(before.length);
    const folded = after.filter((c) => c.elementId === COLLECTION);
    expect(folded).toHaveLength(1);
    expect(folded[0].type).toBe("add");
    expect(folded[0].sequenceNumber).toBe(addChange.sequenceNumber);
    expect(folded[0].after.description).toBe("Exported orders");

    // The projection and model_show read the folded add.
    const shown = parse(await modelShowHandler({ id: COLLECTION, rootPath }));
    expect(shown.element.description).toBe("Exported orders");
  });

  it("folds an attributePatch into the add's attributes and names the attribute keys", async () => {
    await add({ layer: "data-model", type: "objectschema", name: "order-export-summary", attributes: { type: "object" } });
    const result = parse(
      await modelUpdateHandler({
        id: "data-model.objectschema.order-export-summary",
        attributePatch: { minProperties: 1 },
        rootPath,
      })
    );
    expect(result.changedFields).toEqual(["attributes.minProperties"]);
    expect(result.foldedIntoAdd).toBe(true);

    const changes = await stagedChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("add");
    expect(changes[0].sequenceNumber).toBe(0);
    expect(changes[0].after.attributes).toEqual({ type: "object", minProperties: 1 });
  });

  it("clearing the description removes it from the add's snapshot", async () => {
    await add({ layer: "data-store", type: "collection", name: "order-exports", description: "Draft" });
    const result = parse(await modelUpdateHandler({ id: COLLECTION, description: "", rootPath }));
    expect(result.changedFields).toEqual(["description"]);
    const [change] = await stagedChanges();
    expect(change.type).toBe("add");
    expect(change.after.description).toBeUndefined();
  });

  it("still appends an update to an element of the base model, with its changed fields", async () => {
    const result = parse(await modelUpdateHandler({ id: SCHEMA, description: "One exported row", rootPath }));
    expect(result.status).toBe("staged");
    expect(result.changedFields).toEqual(["description"]);
    expect(result.foldedIntoAdd).toBeUndefined();
    const changes = await stagedChanges();
    expect(changes.map((c) => c.type)).toEqual(["update"]);
  });

  it("keeps appending when an earlier build already stacked an update on the add, so that update is not overridden", async () => {
    await add({ layer: "data-store", type: "collection", name: "order-exports" });
    // As an earlier build left it: the add, then an update of the same element.
    const storage = new StagedChangesetStorage(rootPath);
    const [addChange] = await stagedChanges();
    await storage.addChange(changesetId, {
      type: "update",
      elementId: COLLECTION,
      layerName: "data-store",
      before: addChange.after,
      after: { ...addChange.after, description: "First" },
      timestamp: new Date().toISOString(),
    });
    clearModelCache();

    const result = parse(await modelUpdateHandler({ id: COLLECTION, description: "Second", rootPath }));
    expect(result.changedFields).toEqual(["description"]);
    const changes = await stagedChanges();
    expect(changes.map((c) => [c.type, c.sequenceNumber])).toEqual([
      ["add", 0],
      ["update", 1],
      ["update", 2],
    ]);
    const shown = parse(await modelShowHandler({ id: COLLECTION, rootPath }));
    expect(shown.element.description).toBe("Second");
  });

  it("returns changed fields outside a changeset too", async () => {
    parse(await changesetDeactivateHandler({ rootPath } as any));
    const result = parse(await modelUpdateHandler({ id: SCHEMA, name: "Order export row", rootPath }));
    expect(result.status).toBe("updated");
    expect(result.changedFields).toEqual(["name"]);
  });

  it("dr update folds too and reports the changed fields", async () => {
    await add({ layer: "data-store", type: "collection", name: "order-exports" });
    const logs: string[] = [];
    const original = console.log;
    console.log = (...parts: unknown[]) => logs.push(parts.join(" "));
    setJsonMode(true);
    try {
      await updateCommand(COLLECTION, { model: rootPath, description: "Exported orders" });
    } finally {
      setJsonMode(false);
      console.log = original;
    }
    const output = JSON.parse(logs[logs.length - 1]);
    expect(output.changedFields).toEqual(["description"]);
    expect(output.foldedIntoAdd).toBe(true);
    const changes = await stagedChanges();
    expect(changes.map((c) => c.type)).toEqual(["add"]);
    expect(changes[0].after.description).toBe("Exported orders");
  });
});

describe("a model held across calls learns of a layer the changeset stages into", () => {
  it("lists the layer once an element change is staged there through a manager that holds it", async () => {
    const model = await Model.load(rootPath, { lazyLoad: false });
    expect(model.getLayerNames()).not.toContain("data-store");

    const manager = new StagingAreaManager(rootPath, model);
    await manager.stage(changesetId, {
      type: "add",
      elementId: COLLECTION,
      layerName: "data-store",
      after: {
        id: COLLECTION,
        path: COLLECTION,
        spec_node_id: "data-store.collection",
        layer_id: "data-store",
        type: "collection",
        name: "order-exports",
        attributes: {},
      },
      timestamp: new Date().toISOString(),
    });

    expect(model.getLayerNames()).toContain("data-store");
    expect(await findElementLayer(model, COLLECTION)).toBe("data-store");
  });
});
