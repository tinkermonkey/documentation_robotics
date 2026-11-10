/**
 * Batch staging (gateway validation D3), source fields for planned elements (bug 14), and
 * changeset_discard's leftover folder (bug 13).
 *
 * D3: agents staged one relationship per call, 32–137 calls a turn. relationship_add and model_add
 * now take lists, staged in one write with a result per item; invalid items are skipped.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { Model } from "../../../src/core/model.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { modelDeleteHandler } from "../../../src/mcp/tools/model-delete.js";
import { changesetCreateTool } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetDiscardHandler } from "../../../src/mcp/tools/changeset-editing.js";
import { changesetBriefHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";
import { relationshipAddHandler, relationshipDeleteHandler } from "../../../src/mcp/tools/relationship-tools.js";

function parse(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

function errorOf(result: any): any {
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0].text);
}

const GOAL = "motivation.goal.faster-checkout";
const SERVICE = "application.applicationservice.checkout";
const FUNCTION = "application.applicationfunction.export-orders";
const OPERATION = "api.operation.export-orders";
const OPERATION_ATTRS = { operationId: "exportOrders", summary: "Export orders", tags: "orders" };

let rootPath: string;

async function add(args: Record<string, unknown>): Promise<any> {
  return parse(await modelAddHandler({ ...(args as any), rootPath }));
}

async function createChangeset(name = "plan"): Promise<void> {
  parse(await changesetCreateHandler({ name, rootPath }));
}

async function activeChangeset() {
  const model = await Model.load(rootPath, { lazyLoad: true });
  const manager = new StagingAreaManager(rootPath, model);
  return (await manager.getActive())!;
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-batch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Batch Staging Test Model", version: "0.1.0" });
  await add({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" } });
  await add({ layer: "application", type: "applicationservice", name: "checkout", attributes: { serviceType: "synchronous" } });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("relationship_add with a list (D3)", () => {
  it("stages the valid items in one write, one sequence number each, and reports every item", async () => {
    await createChangeset();
    await add({ layer: "application", type: "applicationfunction", name: "export-orders" });
    await add({ layer: "api", type: "operation", name: "export-orders", attributes: OPERATION_ATTRS });
    const before = await activeChangeset();
    const firstSequence = (before.lastSequence ?? before.changes.length - 1) + 1;

    const single = spyOn(StagedChangesetStorage.prototype, "addChange");
    const batch = spyOn(StagedChangesetStorage.prototype, "addChanges");
    let result: any;
    try {
      result = parse(
        await relationshipAddHandler({
          relationships: [
            { source: FUNCTION, predicate: "realizes", target: SERVICE },
            { source: OPERATION, predicate: "realizes", target: FUNCTION },
            { source: OPERATION, predicate: "realizes", target: FUNCTION }, // repeated
            { source: "application.applicationfunction.export-order", predicate: "realizes", target: SERVICE }, // typo
            { source: GOAL, predicate: "realizes", target: OPERATION }, // not in the catalog
            { source: SERVICE, predicate: "realizes", target: GOAL },
          ],
          rootPath,
        })
      );
      expect(single).not.toHaveBeenCalled();
      expect(batch).toHaveBeenCalledTimes(1);
    } finally {
      single.mockRestore();
      batch.mockRestore();
    }

    expect(result.changeset).toBe("plan");
    expect(result.counts).toEqual({ staged: 3, duplicate: 1, invalid: 2 });
    expect(result.results.map((r: any) => r.status)).toEqual(["staged", "staged", "duplicate", "invalid", "invalid", "staged"]);
    expect(result.results[2].reason).toContain("earlier in this batch");
    expect(result.results[3].reason).toContain("not found");
    expect(result.results[3].suggestions.join(" ")).toContain(FUNCTION);
    expect(result.results[4].reason).toContain("motivation.goal --[realizes]--> api.operation");
    expect(result.results[4].suggestions.length).toBeGreaterThan(0);

    const after = await activeChangeset();
    const relationshipAdds = after.changes.filter((c) => c.type === "relationship-add");
    expect(relationshipAdds.map((c) => c.elementId)).toEqual([
      `${FUNCTION}::realizes::${SERVICE}`,
      `${OPERATION}::realizes::${FUNCTION}`,
      `${SERVICE}::realizes::${GOAL}`,
    ]);
    expect(relationshipAdds.map((c) => c.sequenceNumber)).toEqual([firstSequence, firstSequence + 1, firstSequence + 2]);
    // The cross-layer one records its target layer, as the single form does.
    expect((relationshipAdds[1].after as any).targetLayer).toBe("application");

    // A second identical batch stages nothing: all duplicates.
    const again = parse(
      await relationshipAddHandler({ relationships: [{ source: FUNCTION, predicate: "realizes", target: SERVICE }], rootPath })
    );
    expect(again.counts).toEqual({ duplicate: 1 });
  });

  it("re-adding what the changeset deletes restores it", async () => {
    parse(await relationshipAddHandler({ source: SERVICE, predicate: "realizes", target: GOAL, rootPath }));
    await createChangeset();
    parse(await relationshipDeleteHandler({ source: SERVICE, predicate: "realizes", target: GOAL, rootPath }));
    expect((await activeChangeset()).changes.some((c) => c.type === "relationship-delete")).toBe(true);

    const result = parse(
      await relationshipAddHandler({ relationships: [{ source: SERVICE, predicate: "realizes", target: GOAL }], rootPath })
    );
    expect(result.results[0].status).toBe("restored");
    expect((await activeChangeset()).changes.some((c) => c.type === "relationship-delete")).toBe(false);
  });

  it("writes the model in one save when no changeset is active", async () => {
    await add({ layer: "application", type: "applicationfunction", name: "export-orders" });
    const result = parse(
      await relationshipAddHandler({
        relationships: [
          { source: FUNCTION, predicate: "realizes", target: SERVICE },
          { source: SERVICE, predicate: "realizes", target: GOAL },
          { source: SERVICE, predicate: "realizes", target: "motivation.goal.missing" },
        ],
        rootPath,
      })
    );
    expect(result.changeset).toBeUndefined();
    // Written to the model, not staged: reported as "added", as the single form does.
    expect(result.counts).toEqual({ added: 2, invalid: 1 });
    expect(result.results.map((r: any) => r.status)).toEqual(["added", "added", "invalid"]);
    clearModelCache();
    const model = await Model.load(rootPath, { lazyLoad: false });
    expect(model.relationships.find(FUNCTION, SERVICE, "realizes")).toHaveLength(1);
    expect(model.relationships.find(SERVICE, GOAL, "realizes")).toHaveLength(1);
  });

  it("keeps the single form, and refuses both forms at once or neither", async () => {
    await createChangeset();
    expect(parse(await relationshipAddHandler({ source: SERVICE, predicate: "realizes", target: GOAL, rootPath })).status).toBe(
      "staged"
    );
    const both = errorOf(
      await relationshipAddHandler({
        source: SERVICE,
        predicate: "realizes",
        target: GOAL,
        relationships: [{ source: SERVICE, predicate: "realizes", target: GOAL }],
        rootPath,
      })
    );
    expect(both.error).toContain("not both");
    const neither = errorOf(await relationshipAddHandler({ rootPath }));
    expect(neither.error).toContain("relationships list");
  });

  it("leaves the brief's revisionToken and delta working after a batch", async () => {
    await createChangeset();
    await add({ layer: "application", type: "applicationfunction", name: "export-orders" });
    const first = parse(await changesetBriefHandler({ rootPath } as any));
    expect(first.revisionToken).toMatch(/^\d+:[0-9a-f]+$/);

    parse(
      await modelAddHandler({
        elements: [{ layer: "api", type: "operation", name: "export-orders", attributes: OPERATION_ATTRS }],
        relationships: [
          { source: OPERATION, predicate: "realizes", target: FUNCTION },
          { source: FUNCTION, predicate: "realizes", target: SERVICE },
        ],
        rootPath,
      })
    );
    const second = parse(await changesetBriefHandler({ since: first.revisionToken, rootPath } as any));
    // Three changes in one write: three revisions.
    expect(second.revision).toBe(first.revision + 3);
    expect(second.revisionToken).toMatch(new RegExp(`^${first.revision + 3}:`));
    expect(second.delta.since).toBe(first.revision);
    expect(second.delta.elements.added).toEqual([OPERATION]);

    const third = parse(await changesetBriefHandler({ since: second.revisionToken, rootPath } as any));
    expect(third.delta.elements).toEqual({ added: [], removed: [], updated: [] });
  });
});

describe("model_add with a list (D3)", () => {
  it("stages elements and the relationships between them in one write, skipping invalid items", async () => {
    await createChangeset();
    const batch = spyOn(StagedChangesetStorage.prototype, "addChanges");
    const single = spyOn(StagedChangesetStorage.prototype, "addChange");
    let result: any;
    try {
      result = parse(
        await modelAddHandler({
          elements: [
            { layer: "application", type: "applicationfunction", name: "export-orders" },
            { layer: "api", type: "operation", name: "export-orders", attributes: OPERATION_ATTRS },
            { layer: "api", type: "operation", name: "broken", attributes: {} }, // missing required attributes
            { layer: "api", type: "nonsense", name: "x" },
            { layer: "application", type: "applicationservice", name: "checkout", attributes: { serviceType: "synchronous" } }, // exists
          ],
          relationships: [
            { source: OPERATION, predicate: "realizes", target: FUNCTION },
            { source: FUNCTION, predicate: "realizes", target: SERVICE },
            { source: "api.operation.broken", predicate: "realizes", target: FUNCTION },
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

    expect(result.changeset).toBe("plan");
    expect(result.elements.counts).toEqual({ staged: 2, invalid: 3 });
    expect(result.elements.results.map((r: any) => r.status)).toEqual(["staged", "staged", "invalid", "invalid", "invalid"]);
    expect(result.elements.results[2].reason).toContain("invalid attributes");
    expect(result.elements.results[2].suggestions.join(" ")).toContain("spec_type");
    expect(result.elements.results[3].reason).toContain('Invalid element type "nonsense"');
    expect(result.elements.results[4].reason).toContain("already exists");
    expect(result.relationships.counts).toEqual({ staged: 2, invalid: 1 });
    expect(result.relationships.results[2].reason).toContain("api.operation.broken was not added");

    const changes = (await activeChangeset()).changes;
    expect(changes.map((c) => `${c.type} ${c.elementId}`)).toEqual([
      `add ${FUNCTION}`,
      `add ${OPERATION}`,
      `relationship-add ${OPERATION}::realizes::${FUNCTION}`,
      `relationship-add ${FUNCTION}::realizes::${SERVICE}`,
    ]);

    // Later calls see the new elements.
    expect(parse(await modelShowHandler({ id: OPERATION, rootPath })).element.id).toBeDefined();
  });

  it("writes the model when no changeset is active", async () => {
    const result = parse(
      await modelAddHandler({
        elements: [{ layer: "application", type: "applicationfunction", name: "export-orders" }],
        relationships: [{ source: FUNCTION, predicate: "realizes", target: SERVICE }],
        rootPath,
      })
    );
    expect(result.elements.counts).toEqual({ added: 1 });
    expect(result.relationships.counts).toEqual({ added: 1 });
    clearModelCache();
    const model = await Model.load(rootPath, { lazyLoad: false });
    expect(model.getElementById(FUNCTION)).toBeDefined();
    expect(model.relationships.find(FUNCTION, SERVICE, "realizes")).toHaveLength(1);
  });

  it("restores a staged relationship delete when the list re-adds an element the changeset deleted", async () => {
    await add({ layer: "application", type: "applicationfunction", name: "export-orders" });
    parse(await relationshipAddHandler({ source: FUNCTION, predicate: "realizes", target: SERVICE, rootPath }));
    await createChangeset();
    parse(await relationshipDeleteHandler({ source: FUNCTION, predicate: "realizes", target: SERVICE, rootPath }));
    parse(await modelDeleteHandler({ id: FUNCTION, force: true, rootPath }));

    const result = parse(
      await modelAddHandler({
        elements: [{ layer: "application", type: "applicationfunction", name: "export-orders" }],
        relationships: [{ source: FUNCTION, predicate: "realizes", target: SERVICE }],
        rootPath,
      })
    );
    expect(result.relationships.results[0].status).toBe("restored");
    const key = `${FUNCTION}::realizes::${SERVICE}`;
    const forKey = (await activeChangeset()).changes.filter((c) => c.elementId === key);
    expect(forKey).toEqual([]);
  });

  it("refuses single-form fields beside elements instead of dropping them", async () => {
    const error = errorOf(
      await modelAddHandler({
        description: "lost",
        sourceFile: "src/a.ts",
        elements: [{ layer: "motivation", type: "goal", name: "y", attributes: { priority: "low" } }],
        rootPath,
      })
    );
    expect(error.error).toContain("not both");
    expect(error.error).toContain("description, sourceFile");
  });

  it("refuses relationships without elements, and both forms at once", async () => {
    expect(
      errorOf(await modelAddHandler({ relationships: [{ source: SERVICE, predicate: "realizes", target: GOAL }], rootPath }))
        .error
    ).toContain("goes with the elements list");
    expect(
      errorOf(
        await modelAddHandler({
          layer: "motivation",
          type: "goal",
          name: "x",
          elements: [{ layer: "motivation", type: "goal", name: "y" }],
          rootPath,
        })
      ).error
    ).toContain("not both");
  });
});

describe("source fields for planned elements (bug 14)", () => {
  it("model_add stages a planned element with sourceProvenance 'manual' and no file, ignoring it with a warning", async () => {
    await createChangeset();
    const result = parse(
      await modelAddHandler({
        layer: "motivation",
        type: "requirement",
        name: "expose node degree",
        attributes: { requirementType: "functional", priority: "high" },
        sourceProvenance: "manual",
        rootPath,
      })
    );
    expect(result.status).toBe("staged");
    expect(result.warnings.join(" ")).toContain("sourceProvenance 'manual' was ignored");
    const shown = parse(await modelShowHandler({ id: "motivation.requirement.expose-node-degree", rootPath }));
    expect(shown.element.source_reference ?? shown.element.sourceReference).toBeUndefined();
  });

  it("model_add accepts 'inferred' without a file, as the schema allows", async () => {
    const result = parse(
      await modelAddHandler({ layer: "motivation", type: "goal", name: "planned goal", attributes: { priority: "low" }, sourceProvenance: "inferred", rootPath })
    );
    expect(result.warnings).toBeUndefined();
  });

  it("model_add in a list reports the warnings per element", async () => {
    await createChangeset();
    const result = parse(
      await modelAddHandler({
        elements: [
          { layer: "application", type: "applicationfunction", name: "export-orders", sourceFile: "src/export.ts" },
          { layer: "application", type: "applicationfunction", name: "import-orders", sourceProvenance: "extracted" },
        ],
        rootPath,
      })
    );
    expect(result.elements.results[0].warnings[0]).toContain("used 'manual'");
    expect(result.elements.results[1].warnings[0]).toContain("'extracted' was ignored");
  });

  it("model_update: a file alone keeps the provenance (or gets 'manual'); a provenance alone keeps the file", async () => {
    await createChangeset();
    const updated = parse(await modelUpdateHandler({ id: SERVICE, sourceFile: "src/checkout.ts", rootPath }));
    expect(updated.status).toBe("staged");
    expect(updated.warnings.join(" ")).toContain("used 'manual'");
    let ref = parse(await modelShowHandler({ id: SERVICE, rootPath })).element.source_reference;
    expect(ref).toEqual({ provenance: "manual", locations: [{ file: "src/checkout.ts" }] });

    const retagged = parse(await modelUpdateHandler({ id: SERVICE, sourceProvenance: "extracted", rootPath }));
    expect(retagged.warnings).toBeUndefined();
    ref = parse(await modelShowHandler({ id: SERVICE, rootPath })).element.source_reference;
    expect(ref).toEqual({ provenance: "extracted", locations: [{ file: "src/checkout.ts" }] });

    const moved = parse(await modelUpdateHandler({ id: SERVICE, sourceFile: "src/checkout/index.ts", rootPath }));
    expect(moved.warnings.join(" ")).toContain("used 'extracted' (the element's current provenance)");
  });

  it("model_update: 'manual' alone on an element with no file is ignored with a warning, and stages nothing", async () => {
    await createChangeset();
    const result = parse(await modelUpdateHandler({ id: GOAL, sourceProvenance: "manual", rootPath }));
    expect(result.status).toBe("no-op");
    expect(result.warnings.join(" ")).toContain("sourceProvenance 'manual' was ignored");
    expect((await activeChangeset()).changes).toEqual([]);
  });
});

describe("changeset_discard (bug 13)", () => {
  it("keeps only the changeset's record, not its base index", async () => {
    await createChangeset("scratch");
    await add({ layer: "application", type: "applicationfunction", name: "export-orders" });
    const { id } = await activeChangeset();
    const dir = join(rootPath, "documentation-robotics", "changesets", id!);
    expect(existsSync(join(dir, "base-index.json"))).toBe(true);

    const result = parse(await changesetDiscardHandler({ changesetId: "scratch", confirm: true, rootPath }));
    expect(result.status).toBe("discarded");

    expect((await readdir(dir)).filter((f) => !f.startsWith(".")).sort()).toEqual(["changes.yaml", "metadata.yaml"]);
    const metadata = yaml.parse(await readFile(join(dir, "metadata.yaml"), "utf-8"));
    expect(metadata).toMatchObject({ name: "scratch", status: "discarded" });
    expect(yaml.parse(await readFile(join(dir, "changes.yaml"), "utf-8"))).toEqual([]);
  });
});

describe("changeset_create description", () => {
  it("asks the agent to confirm the name and intent, and no longer says changesets are never committed over MCP", () => {
    expect(changesetCreateTool.description).toContain("confirm both with them");
    expect(changesetCreateTool.description).not.toContain("never committed over MCP");
    expect(changesetCreateTool.description).toContain("changeset_commit");
  });
});
