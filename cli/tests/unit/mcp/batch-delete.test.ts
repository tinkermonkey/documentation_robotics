/**
 * The list forms of relationship_delete (#1372) and model_delete (#1426): one call removes many,
 * in one write where it can, and answers like model_add's list: counts, failures grouped by cause,
 * and what is already removed as unchanged, so the list can be sent again.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { clearModelCache, loadModel } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelDeleteHandler, modelDeleteTool } from "../../../src/mcp/tools/model-delete.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { relationshipDeleteHandler, relationshipDeleteTool } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { listed } from "../../helpers/batch-causes.js";

let rootPath: string;

const text = (result: any): string => result.content[0].text;
const parse = (result: any): any => {
  if (result.isError) throw new Error(text(result));
  return JSON.parse(text(result));
};
const fn = (name: string) => ({ layer: "application", type: "applicationfunction", name });
const F = (name: string) => `application.applicationfunction.${name}`;

/** Five functions: a depends on b, c and d; e depends on a. */
async function seed(): Promise<void> {
  parse(
    await modelAddHandler({
      elements: ["a", "b", "c", "d", "e"].map(fn),
      relationships: [
        { source: F("a"), predicate: "depends-on", target: F("b") },
        { source: F("a"), predicate: "depends-on", target: F("c") },
        { source: F("a"), predicate: "depends-on", target: F("d") },
        { source: F("e"), predicate: "depends-on", target: F("a") },
      ],
      rootPath,
    })
  );
  clearModelCache();
}

/**
 * Makes `from` depend on `to` the way model_delete's dependency check reads it: an element reference
 * (as `dr delete` reads it), not a relationship.
 */
async function dependOn(from: string, to: string): Promise<void> {
  clearModelCache();
  const model = await loadModel(rootPath);
  const layer = (await model.getLayer("application"))!;
  const element = layer.getElement(from)!;
  element.references = [{ source: element.path || element.id, target: to, type: "uses" }];
  layer.updateElement(element);
  await model.saveLayer("application");
  clearModelCache();
}

async function outgoing(id: string): Promise<string[]> {
  clearModelCache();
  // In a changeset, model_show lists a removed relationship with status "deleted".
  return parse(await modelShowHandler({ id, rootPath }))
    .relationships.outgoing.filter((r: any) => r.status !== "deleted")
    .map((r: any) => r.target)
    .sort();
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-batch-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Batch Delete", version: "0.1.0" });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("relationship_delete with a list (#1372)", () => {
  it("stages every removal in one write, and groups what matched nothing by cause", async () => {
    await seed();
    await changesetCreateHandler({ name: "move-links", rootPath });
    const batch = spyOn(StagedChangesetStorage.prototype, "addChanges");
    const single = spyOn(StagedChangesetStorage.prototype, "addChange");
    let result: any;
    try {
      result = parse(
        await relationshipDeleteHandler({
          relationships: [
            { source: F("a"), target: F("b"), predicate: "depends-on" },
            { source: F("a"), target: F("c") },
            { source: F("a"), target: F("b") }, // removed by the first item
            { source: F("a"), target: F("e") }, // no such relationship
            { source: F("b"), target: F("e") }, // no such relationship
          ],
          rootPath,
        })
      );
      expect(batch).toHaveBeenCalledTimes(1);
      expect(single).not.toHaveBeenCalled();
    } finally {
      batch.mockRestore();
      single.mockRestore();
    }
    expect(result.changeset).toBe("move-links");
    expect(result.counts).toEqual({ staged: 2, duplicate: 1, invalid: 2 });
    expect(result.causes.map((c: any) => [c.status, c.count])).toEqual([
      ["invalid", 2],
      ["duplicate", 1],
    ]);
    // Both name e as the target: it is written out, and each item keeps its own source.
    expect(result.causes[0].reason).toBe(`No relationship from <id> to ${F("e")}`);
    expect(listed(result).find((r) => r.index === 3)!.reason).toBe(`No relationship from ${F("a")} to ${F("e")}`);
    expect(await outgoing(F("a"))).toEqual([F("d")]);

    // Sent again: what this changeset already removes is unchanged, and nothing is staged twice.
    const again = parse(
      await relationshipDeleteHandler({ relationships: [{ source: F("a"), target: F("b") }, { source: F("a"), target: F("c") }], rootPath })
    );
    expect(again.counts).toEqual({ unchanged: 2 });
    expect(again.causes).toBeUndefined();
  });

  it("unstages a link this changeset added instead of staging its removal", async () => {
    await seed();
    await changesetCreateHandler({ name: "plan", rootPath });
    parse(await modelAddHandler({ elements: [fn("f")], relationships: [{ source: F("f"), predicate: "depends-on", target: F("a") }], rootPath }));
    const result = parse(
      await relationshipDeleteHandler({
        relationships: [
          { source: F("f"), target: F("a") },
          { source: F("e"), target: F("a") },
        ],
        verbose: true,
        rootPath,
      })
    );
    expect(result.results.map((r: any) => [r.status, r.removed])).toEqual([
      ["unstaged", 1],
      ["staged", 1],
    ]);
    expect(await outgoing(F("f"))).toEqual([]);
    expect(await outgoing(F("e"))).toEqual([]);
  });

  it("removes from the model in one save when no changeset is active, and takes a file", async () => {
    await seed();
    await writeFile(
      join(rootPath, "unlink.json"),
      JSON.stringify({ relationships: [{ source: F("a"), target: F("b") }, { source: F("a"), target: F("d") }, { source: F("a"), target: F("zz") }] })
    );
    const result = parse(await relationshipDeleteHandler({ file: "unlink.json", rootPath }));
    expect(result.counts).toEqual({ deleted: 2, invalid: 1 });
    expect(await outgoing(F("a"))).toEqual([F("c")]);
  });

  it("keeps the single form, and refuses both forms at once or neither", async () => {
    await seed();
    expect(parse(await relationshipDeleteHandler({ source: F("a"), target: F("b"), rootPath }))).toMatchObject({
      status: "deleted",
      deletedCount: 1,
    });
    const both = await relationshipDeleteHandler({ source: F("a"), relationships: [], rootPath });
    expect(both.isError).toBe(true);
    expect(text(both)).toContain("not both");
    const neither = await relationshipDeleteHandler({ rootPath });
    expect(neither.isError).toBe(true);
    expect(text(neither)).toContain("needs source and target, or a relationships list");
    expect(relationshipDeleteTool.description).toContain("relationships: [{source, target, predicate?}, ...]");
  });
});

describe("model_delete with a list (#1426)", () => {
  it("deletes each id, letting ids in the list depend on one another, and groups refusals by cause", async () => {
    await seed();
    await dependOn(F("e"), F("a"));
    await changesetCreateHandler({ name: "reconcile", rootPath });
    const result = parse(
      await modelDeleteHandler({
        ids: [F("e"), F("a"), F("nope-1"), F("nope-2"), F("b")],
        rootPath,
      })
    );
    // e depends on a, and both are in the list: e does not block a.
    expect(result.changeset).toBe("reconcile");
    expect(result.counts).toEqual({ staged: 3, invalid: 2 });
    expect(result.causes).toEqual([
      {
        status: "invalid",
        reason: "Element <id> not found",
        suggestions: ['Use "model_search" to find similar elements'],
        count: 2,
        items: [
          { index: 2, values: [F("nope-1")] },
          { index: 3, values: [F("nope-2")] },
        ],
      },
    ]);

    // Sent again: what the changeset already deletes is unchanged.
    clearModelCache();
    const again = parse(await modelDeleteHandler({ ids: [F("e"), F("a")], rootPath }));
    expect(again.counts).toEqual({ unchanged: 2 });
  });

  it("refuses an element with dependents outside the list unless cascade or force, and previews with dryRun", async () => {
    await seed();
    await dependOn(F("e"), F("a"));
    const refused = parse(await modelDeleteHandler({ ids: [F("a"), F("c")], rootPath }));
    // a has e as a dependent, and e is not in the list.
    expect(refused.counts).toEqual({ invalid: 1, deleted: 1 });
    expect(listed(refused)[0]).toMatchObject({ index: 0, reason: "Element has dependencies" });

    const preview = parse(await modelDeleteHandler({ ids: [F("a")], cascade: true, dryRun: true, verbose: true, rootPath }));
    expect(preview.dryRun).toBe(true);
    expect(preview.results[0]).toMatchObject({ status: "would-delete", elementsToRemove: [F("a"), F("e")] });
    clearModelCache();
    expect(parse(await modelShowHandler({ id: F("a"), rootPath })).element).toBeDefined();
  });

  it("keeps the single form, and refuses both forms at once or neither", async () => {
    await seed();
    expect(parse(await modelDeleteHandler({ id: F("d"), force: true, rootPath }))).toMatchObject({ status: "deleted", id: F("d") });
    const both = await modelDeleteHandler({ id: F("c"), ids: [F("b")], rootPath });
    expect(both.isError).toBe(true);
    expect(text(both)).toContain("Send either id or ids, not both");
    const neither = await modelDeleteHandler({ rootPath });
    expect(neither.isError).toBe(true);
    expect(text(neither)).toContain("model_delete needs id, or an ids list");
    expect(modelDeleteTool.description).toContain("ids: [...]");
  });
});
