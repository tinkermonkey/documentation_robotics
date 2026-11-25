/**
 * A list sent again writes nothing twice (#1296): every write tool's list answers what is already
 * as sent with `unchanged`, counted and never listed, and stages nothing for it. Review of PR 1455,
 * finding 4: model_update, relationship_delete after it unstaged an add, model_delete of an element
 * the changeset added, and model_add with source fields (the extraction case).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { modelDeleteHandler } from "../../../src/mcp/tools/model-delete.js";
import { relationshipDeleteHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";

let rootPath: string;

const parse = (result: any): any => {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
};
const F = (name: string) => `application.applicationfunction.${name}`;
const fn = (name: string, extra: Record<string, unknown> = {}) => ({ layer: "application", type: "applicationfunction", name, ...extra });

async function stagedChanges(): Promise<number> {
  return (await new StagingAreaManager(rootPath).load("plan"))!.changes.length;
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-batch-resend-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Batch Resend", version: "0.1.0" });
  await changesetCreateHandler({ name: "plan", rootPath });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("a list sent again writes nothing twice (#1296)", () => {
  it("model_add: elements with source fields, as extraction sends them", async () => {
    const elements = [
      fn("loadOrders", { sourceFile: "src/orders.ts", sourceSymbol: "loadOrders", sourceProvenance: "extracted" }),
      fn("saveOrders", { sourceFile: "src/orders.ts", sourceSymbol: "saveOrders", sourceProvenance: "extracted" }),
    ];
    const relationships = [{ source: F("save-orders"), predicate: "depends-on", target: F("load-orders") }];
    expect(parse(await modelAddHandler({ elements, relationships, rootPath })).elements.counts).toEqual({ staged: 2 });
    const before = await stagedChanges();

    const again = parse(await modelAddHandler({ elements, relationships, rootPath }));
    expect(again.elements.counts).toEqual({ unchanged: 2 });
    expect(again.elements.causes).toBeUndefined();
    expect(again.relationships.counts).toEqual({ unchanged: 1 });
    expect(await stagedChanges()).toBe(before);

    // With another source file, it is refused, naming what differs.
    const moved = parse(await modelAddHandler({ elements: [fn("loadOrders", { sourceFile: "src/other.ts", sourceProvenance: "extracted" })], rootPath }));
    expect(moved.elements.counts).toEqual({ invalid: 1 });
    expect(moved.elements.causes[0].reason).toContain("with another source reference");
  });

  it("model_update: updates already as sent are unchanged and stage nothing", async () => {
    parse(await modelAddHandler({ elements: [fn("loadOrders"), fn("saveOrders")], rootPath }));
    const updates = [
      { id: F("load-orders"), description: "Loads orders" },
      { id: F("save-orders"), attributePatch: { documentation: "Saves orders" }, sourceFile: "src/orders.ts" },
    ];
    expect(parse(await modelUpdateHandler({ updates, rootPath })).counts).toEqual({ staged: 2 });
    const before = await stagedChanges();
    const changesetBefore = JSON.stringify((await new StagingAreaManager(rootPath).load("plan"))!.changes);

    const again = parse(await modelUpdateHandler({ updates, rootPath }));
    expect(again.counts).toEqual({ unchanged: 2 });
    expect(again.causes).toBeUndefined();
    expect(await stagedChanges()).toBe(before);
    expect(JSON.stringify((await new StagingAreaManager(rootPath).load("plan"))!.changes)).toBe(changesetBefore);
    // The single form says the same.
    expect(parse(await modelUpdateHandler({ id: F("load-orders"), description: "Loads orders", rootPath })).status).toBe("unchanged");
  });

  it("relationship_delete: a link whose add this changeset already unstaged is unchanged", async () => {
    parse(
      await modelAddHandler({
        elements: [fn("a"), fn("b")],
        relationships: [{ source: F("a"), predicate: "depends-on", target: F("b") }],
        rootPath,
      })
    );
    const list = { relationships: [{ source: F("a"), target: F("b") }], rootPath };
    expect(parse(await relationshipDeleteHandler({ ...list, verbose: true })).results[0].status).toBe("unstaged");
    const again = parse(await relationshipDeleteHandler(list));
    expect(again.counts).toEqual({ unchanged: 1 });
    // A link that never was is still refused.
    expect(parse(await relationshipDeleteHandler({ relationships: [{ source: F("b"), target: F("a") }], rootPath })).counts).toEqual({
      invalid: 1,
    });
  });

  it("model_delete: an element this changeset added and then deleted is unchanged", async () => {
    parse(await modelAddHandler({ elements: [fn("scratch")], rootPath }));
    expect(parse(await modelDeleteHandler({ ids: [F("scratch")], rootPath })).counts).toEqual({ staged: 1 });
    expect(parse(await modelDeleteHandler({ ids: [F("scratch")], rootPath })).counts).toEqual({ unchanged: 1 });
    expect(parse(await modelDeleteHandler({ ids: [F("never-was")], rootPath })).counts).toEqual({ invalid: 1 });
  });
});
