/**
 * The cost of a batch write, and the ids it makes (CLI 0.7.0, dogfood friction).
 *
 * - #1182: model_add and relationship_add echoed every item. They return counts and the items
 *   that need attention; `verbose: true` returns every item.
 * - #1217: both take a JSON `file`, so a large batch is not copied into the call. So does
 *   model_update, which also gets a list form (`updates`).
 * - #1233: no "sourceProvenance was not given" warning when the documented default applies.
 * - #1230: a relationship may name, by name or unhyphenated id, an element an earlier call staged.
 * - #1153: a refused batch lists what each refused type requires.
 * - #1212, #1184, #1225: id derivation (a leading digit, digits inside a name, one id function),
 *   and what happens to ids that already exist.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { Element } from "../../../src/core/element.js";
import { extractedElementId } from "../../../src/analyzers/extraction-plan.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { DEFAULT_ATTENTION_LIMIT, batchReport, reasonPattern } from "../../../src/mcp/tools/batch-result.js";
import { modelAddHandler, modelAddTool } from "../../../src/mcp/tools/model-add.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { modelUpdateHandler, modelUpdateTool } from "../../../src/mcp/tools/model-update.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { relationshipAddHandler, relationshipAddTool } from "../../../src/mcp/tools/relationship-tools.js";
import { generateUUID } from "../../../src/utils/id-generator.js";

function text(result: any): string {
  return result.content[0].text as string;
}

function parse(result: any): any {
  if (result.isError) throw new Error(text(result));
  return JSON.parse(text(result));
}

function errorOf(result: any): any {
  expect(result.isError).toBe(true);
  return JSON.parse(text(result));
}

let rootPath: string;

const add = async (args: Record<string, unknown>) => parse(await modelAddHandler({ ...(args as any), rootPath }));
const relate = async (args: Record<string, unknown>) => parse(await relationshipAddHandler({ ...(args as any), rootPath }));
const update = async (args: Record<string, unknown>) => parse(await modelUpdateHandler({ ...(args as any), rootPath }));
const show = async (id: string) => parse(await modelShowHandler({ id, rootPath }));
const createChangeset = async (name = "plan") => parse(await changesetCreateHandler({ name, rootPath }));

const fn = (name: string, extra: Record<string, unknown> = {}) => ({ layer: "application", type: "applicationfunction", name, ...extra });
const schema = (name: string, extra: Record<string, unknown> = {}) => ({
  layer: "data-model",
  type: "objectschema",
  name,
  attributes: { type: "object" },
  ...extra,
});

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-batch-cost-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Batch Cost Test Model", version: "0.1.0" });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("batch results: counts and the items that need attention (#1182)", () => {
  it("answers a 300-element model_add and a 500-relationship relationship_add in under 1 KB each", async () => {
    await createChangeset();
    const elements = [];
    for (let i = 0; i < 150; i++) {
      elements.push(fn(`resolveOrderTotal${i}`, { sourceFile: `src/orders/total-${i}.ts`, sourceSymbol: `resolveOrderTotal${i}` }));
      elements.push(schema(`OrderTotalResult${i}`, { sourceFile: `src/orders/total-${i}.ts`, sourceSymbol: `OrderTotalResult${i}` }));
    }
    const added = await modelAddHandler({ elements, rootPath } as any);
    expect(parse(added)).toEqual({ changeset: "plan", elements: { total: 300, counts: { staged: 300 } } });
    expect(text(added).length).toBeLessThan(1024);

    const fnId = (i: number) => `application.applicationfunction.resolve-order-total${i % 150}`;
    const schemaId = (i: number) => `data-model.objectschema.order-total-result${i % 150}`;
    const relationships = [];
    for (let i = 0; i < 150; i++) {
      for (let k = 0; k < 3; k++) relationships.push({ source: fnId(i), predicate: "accesses", target: schemaId(i + k) });
    }
    for (let i = 0; i < 50; i++) relationships.push({ source: fnId(i), predicate: "depends-on", target: fnId(i + 1) });
    const related = await relationshipAddHandler({ relationships, rootPath } as any);
    expect(parse(related)).toEqual({ changeset: "plan", total: 500, counts: { staged: 500 } });
    expect(text(related).length).toBeLessThan(1024);
  });

  it("lists only what was not staged as sent, or was staged with a warning or a note", async () => {
    await createChangeset();
    const result = await add({
      elements: [
        fn("exportOrders"),
        schema("OrderExport", { attributes: { type: 7 } }), // invalid
        fn("importOrders", { sourceProvenance: "extracted" }), // staged, with a warning
        fn("3D Preview"), // staged, with a note about its id
        fn("archiveOrders"),
      ],
      relationships: [
        { source: "application.applicationfunction.export-orders", predicate: "depends-on", target: "application.applicationfunction.archive-orders" },
        { source: "application.applicationfunction.export-orders", predicate: "depends-on", target: "application.applicationfunction.archive-orders" },
        { source: "exportOrders", predicate: "depends-on", target: "importOrders" }, // by name: a note
        { source: "application.applicationfunction.export-orders", predicate: "depends-on", target: "application.applicationfunction.nope" },
      ],
    });
    expect(result.elements.total).toBe(5);
    expect(result.elements.counts).toEqual({ staged: 4, invalid: 1 });
    expect(result.elements.results).toBeUndefined();
    expect(result.elements.attention.map((r: any) => [r.index, r.status])).toEqual([
      [1, "invalid"],
      [2, "staged"],
      [3, "staged"],
    ]);
    expect(result.elements.attention[1].warnings[0]).toContain("'extracted' was ignored");
    expect(result.elements.attention[2]).toMatchObject({
      id: "application.applicationfunction.n-3d-preview",
      notes: ["The name starts with a digit and an id must start with a letter, so the id is prefixed with 'n-'."],
    });

    expect(result.relationships.counts).toEqual({ staged: 2, duplicate: 1, invalid: 1 });
    // What was not staged comes first, then what was staged with a note.
    expect(result.relationships.attention.map((r: any) => [r.index, r.status])).toEqual([
      [1, "duplicate"],
      [3, "invalid"],
      [2, "staged"],
    ]);
    expect(result.relationships.attentionTotal).toBe(3);
    expect(result.relationships.attentionNotListed).toBeUndefined();
    expect(result.relationships.attention[2].notes).toEqual([
      "Source exportOrders read as application.applicationfunction.export-orders, which this call adds",
      "Target importOrders read as application.applicationfunction.import-orders, which this call adds",
    ]);
  });

  it("returns every item with verbose: true, as before", async () => {
    await createChangeset();
    const result = await add({
      elements: [fn("exportOrders"), fn("archiveOrders")],
      relationships: [
        { source: "application.applicationfunction.export-orders", predicate: "depends-on", target: "application.applicationfunction.archive-orders" },
      ],
      verbose: true,
    });
    expect(result.elements.attention).toBeUndefined();
    expect(result.elements.results).toEqual([
      { index: 0, name: "exportOrders", id: "application.applicationfunction.export-orders", status: "staged" },
      { index: 1, name: "archiveOrders", id: "application.applicationfunction.archive-orders", status: "staged" },
    ]);
    expect(result.relationships.results.map((r: any) => r.status)).toEqual(["staged"]);

    const again = await relate({
      relationships: [
        { source: "application.applicationfunction.export-orders", predicate: "depends-on", target: "application.applicationfunction.archive-orders" },
      ],
      verbose: true,
    });
    expect(again.counts).toEqual({ duplicate: 1 });
    expect(again.results).toHaveLength(1);
  });

  it("accounts for every failure in one response when there are more than the default lists in full", async () => {
    await createChangeset();
    await add({ elements: [fn("exportOrders"), fn("archiveOrders")] });
    const EXPORT = "application.applicationfunction.export-orders";
    const extra = 20;
    // Two causes, interleaved: an end that does not exist, and a triple the catalog does not have.
    const relationships = Array.from({ length: DEFAULT_ATTENTION_LIMIT + extra }, (_, i) =>
      i % 2 === 0
        ? { source: EXPORT, predicate: "depends-on", target: `application.applicationfunction.missing-${i}` }
        : { source: EXPORT, predicate: "tests", target: "application.applicationfunction.archive-orders" }
    );
    relationships.push({ source: EXPORT, predicate: "depends-on", target: "application.applicationfunction.archive-orders" });
    const sent = relationships.length;
    const body = parse(await relationshipAddHandler({ relationships, rootPath } as any));

    // Counts are over the whole batch, not the part listed.
    expect(body.total).toBe(sent);
    expect(body.counts).toEqual({ invalid: DEFAULT_ATTENTION_LIMIT + extra, staged: 1 });
    expect(body.attentionTotal).toBe(DEFAULT_ATTENTION_LIMIT + extra);
    expect(body.attention).toHaveLength(DEFAULT_ATTENTION_LIMIT);
    expect(body.attentionNotListed.count).toBe(extra);

    // Every failure past the default is under its reason, by position: none is dropped.
    const groups = body.attentionNotListed.groups;
    expect(groups.map((g: any) => [g.status, g.count])).toEqual([
      ["invalid", extra / 2],
      ["invalid", extra / 2],
    ]);
    expect(groups[0].reason).toBe("Target element <id> not found");
    expect(groups[1].reason).toContain("The catalog has no application.applicationfunction --[tests]--> application.applicationfunction");
    const listed = body.attention.map((r: any) => r.index);
    const grouped = groups.flatMap((g: any) => g.indexes);
    expect([...listed, ...grouped].sort((a: number, b: number) => a - b)).toEqual(Array.from({ length: sent - 1 }, (_, i) => i));
    expect(groups.every((g: any) => g.count === g.indexes.length)).toBe(true);
    expect(body.attentionNotListed.more).toContain(`limit: ${DEFAULT_ATTENTION_LIMIT + extra}`);
    expect(body.attentionNotListed.more).toContain("verbose: true");

    // Suggestions repeated across items are listed once and pointed at.
    expect(body.attention[1].suggestions.length).toBeGreaterThan(0);
    expect(body.attention[3].suggestions).toBeUndefined();
    expect(body.attention[3].suggestionsAsFor).toBe(1);

    // Sending the failures again writes nothing twice, and limit returns each one in full.
    const again = parse(await relationshipAddHandler({ relationships, limit: sent, rootPath } as any));
    expect(again.counts).toEqual({ invalid: DEFAULT_ATTENTION_LIMIT + extra, duplicate: 1 });
    expect(again.attention).toHaveLength(sent);
    expect(again.attentionTotal).toBe(sent);
    expect(again.attentionNotListed).toBeUndefined();
    expect(again.attention.every((r: any) => typeof r.reason === "string")).toBe(true);
  });

  it("lists failures before notes, and gives a written item past the limit by position and id", async () => {
    await createChangeset();
    // Six elements staged with a note about their id, then two that are refused.
    const elements = [
      ...Array.from({ length: 6 }, (_, i) => fn(`${i + 1}D Preview`)),
      schema("OrderExport", { attributes: { type: 7 } }),
      schema("OrderImport", { attributes: { type: 7 } }),
    ];
    const result = await add({ elements, limit: 3 });
    expect(result.elements.counts).toEqual({ staged: 6, invalid: 2 });
    expect(result.elements.attentionTotal).toBe(8);
    // The limit is spent on the failures first.
    expect(result.elements.attention.map((r: any) => [r.index, r.status])).toEqual([
      [6, "invalid"],
      [7, "invalid"],
      [0, "staged"],
    ]);
    expect(result.elements.attentionNotListed).toMatchObject({
      count: 5,
      groups: [
        {
          status: "staged",
          reason: "The name starts with a digit and an id must start with a letter, so the id is prefixed with 'n-'.",
          count: 5,
          indexes: [1, 2, 3, 4, 5],
          ids: [2, 3, 4, 5, 6].map((n) => `application.applicationfunction.n-${n}d-preview`),
        },
      ],
    });

    // limit: 0 lists none in full and still accounts for all eight.
    await add({ elements: [fn("exportOrders")] });
    const none = await update({
      updates: [{ id: "application.applicationfunction.nope-a", description: "x" }, { id: "application.applicationfunction.nope-b", description: "x" }],
      limit: 0,
    });
    expect(none.attention).toEqual([]);
    expect(none.attentionTotal).toBe(2);
    expect(none.attentionNotListed.groups).toEqual([{ status: "invalid", reason: "Element <id> not found", count: 2, indexes: [0, 1] }]);
  });

  it("batchReport: listed and grouped items together are every item that needs attention", () => {
    const results = Array.from({ length: 500 }, (_, index) => ({
      index,
      id: `api.operation.op-${index}`,
      status: index % 5 === 0 ? "invalid" : "staged",
      ...(index % 5 === 0 ? { reason: `Element api.operation.op-${index} has invalid attributes` } : {}),
      ...(index % 7 === 0 && index % 5 !== 0 ? { warnings: ["sourceProvenance 'extracted' was ignored"] } : {}),
    }));
    const flagged = results.filter((r) => r.status === "invalid" || "warnings" in r).length;
    for (const limit of [0, 1, 50, flagged - 1, flagged, 10_000]) {
      const report = batchReport(results, { limit, written: ["staged"] });
      expect(report.total).toBe(500);
      expect(report.counts).toEqual({ invalid: 100, staged: 400 });
      expect(report.attentionTotal).toBe(flagged);
      const listed = report.attention!.map((r) => r.index);
      const grouped = (report.attentionNotListed?.groups ?? []).flatMap((g) => g.indexes);
      expect(listed).toHaveLength(Math.min(limit, flagged));
      expect(new Set([...listed, ...grouped]).size).toBe(flagged);
      expect(report.attentionNotListed?.count ?? 0).toBe(flagged - listed.length);
    }
    expect(batchReport(results, { verbose: true, written: ["staged"] }).results).toHaveLength(500);
  });

  it("reasonPattern takes out what differs between items and keeps the cause", () => {
    expect(reasonPattern("Source element application.applicationfunction.missing-3 not found")).toBe("Source element <id> not found");
    expect(reasonPattern('"GET *" gives the same id as elements[1] "GET /*" (api.operation.get)')).toBe(
      '"<name>" gives the same id as elements[n] "<name>" (<id>)'
    );
    expect(reasonPattern("Element api.operation.x has invalid attributes:\n  At /attributes: missing required property 'tags'")).toBe(
      "Element <id> has invalid attributes: At /attributes: missing required property 'tags'"
    );
  });

  it("documents the result shape and verbose in the tool descriptions", () => {
    for (const tool of [modelAddTool, relationshipAddTool, modelUpdateTool]) {
      expect(tool.description).toContain("attention");
      expect(tool.description).toContain("verbose: true");
      // The default is a named argument, stated in the description, and nothing is left out past it.
      expect(tool.description).toContain("up to limit items in full (default 50)");
      expect(tool.description).toContain("attentionNotListed");
      expect(Object.keys(tool.inputSchema)).toContain("limit");
      expect(Object.keys(tool.inputSchema)).toContain("verbose");
      expect(Object.keys(tool.inputSchema)).toContain("file");
    }
  });
});

describe("a JSON file for a large batch (#1217)", () => {
  it("model_add stages a file's elements and relationships, as it would inline", async () => {
    await createChangeset();
    const file = join(rootPath, "batch.json");
    await writeFile(
      file,
      JSON.stringify({
        elements: [fn("exportOrders"), fn("archiveOrders"), schema("OrderExport", { attributes: {} })],
        relationships: [{ source: "exportOrders", predicate: "depends-on", target: "archiveOrders" }],
      })
    );
    const result = await add({ file });
    expect(result.elements.counts).toEqual({ staged: 2, invalid: 1 });
    expect(result.elements.attention[0].reason).toContain("missing required property 'type'");
    expect(result.relationships.counts).toEqual({ staged: 1 });
    expect((await show("application.applicationfunction.export-orders")).relationships.outgoing).toHaveLength(1);
  });

  it("reads a relative path from rootPath's project, not the server's working directory", async () => {
    await createChangeset();
    await mkdir(join(rootPath, "tmp"), { recursive: true });
    await writeFile(join(rootPath, "tmp", "batch.json"), JSON.stringify({ elements: [fn("exportOrders")] }));
    expect((await add({ file: "tmp/batch.json" })).elements.counts).toEqual({ staged: 1 });

    const missing = errorOf(await modelAddHandler({ file: "tmp/other.json", rootPath } as any));
    expect(missing.error).toBe(`model_add: no file at ${join(rootPath, "tmp", "other.json")}`);
    expect(missing.suggestions[0]).toContain(`read from the project root (${rootPath})`);
  });

  it("relationship_add and model_update take a file too", async () => {
    await createChangeset();
    await add({ elements: [fn("exportOrders"), fn("archiveOrders")] });
    await writeFile(
      join(rootPath, "rels.json"),
      JSON.stringify({
        relationships: [
          { source: "application.applicationfunction.export-orders", predicate: "depends-on", target: "application.applicationfunction.archive-orders" },
        ],
      })
    );
    expect(await relate({ file: "rels.json" })).toEqual({ changeset: "plan", total: 1, counts: { staged: 1 } });

    await writeFile(
      join(rootPath, "updates.json"),
      JSON.stringify({ updates: [{ id: "application.applicationfunction.export-orders", description: "Exports orders as CSV" }] })
    );
    expect(await update({ file: "updates.json" })).toEqual({ changeset: "plan", total: 1, counts: { staged: 1 } });
    expect((await show("application.applicationfunction.export-orders")).element.description).toBe("Exports orders as CSV");
  });

  it("refuses file beside an inline list or single-form fields, and a file with another tool's keys", async () => {
    await writeFile(join(rootPath, "batch.json"), JSON.stringify({ elements: [fn("exportOrders")] }));
    expect(errorOf(await modelAddHandler({ file: "batch.json", elements: [fn("x")], rootPath } as any)).error).toBe(
      "Send either file or elements, not both"
    );
    expect(errorOf(await modelAddHandler({ file: "batch.json", name: "x", rootPath } as any)).error).toContain(
      "Send either a single element or file, not both (got name beside file)"
    );
    expect(errorOf(await relationshipAddHandler({ file: "batch.json", relationships: [], rootPath } as any)).error).toBe(
      "Send either file or relationships, not both"
    );
    expect(errorOf(await modelUpdateHandler({ file: "batch.json", updates: [], rootPath } as any)).error).toBe(
      "Send either file or updates, not both"
    );
    // The model_add file is not a relationship_add file.
    const wrongTool = errorOf(await relationshipAddHandler({ file: "batch.json", rootPath } as any));
    expect(wrongTool.error).toContain("relationship_add's file doesn't take 'elements'");
    expect(wrongTool.error).toContain("It takes: relationships.");
  });

  it("says where a file is not JSON, and stages nothing from a file with a malformed item", async () => {
    await createChangeset();
    await writeFile(join(rootPath, "bad.json"), '{"elements": [\n  {"layer": "application" "type": "applicationfunction"}\n]}');
    expect(errorOf(await modelAddHandler({ file: "bad.json", rootPath } as any)).error).toContain(
      "is not valid JSON: at line 2, column 27, found '\"' where JSON needs ',' or '}'"
    );

    await writeFile(join(rootPath, "items.json"), JSON.stringify({ elements: [fn("exportOrders"), { layer: "application", type: "applicationfunction" }] }));
    const refused = errorOf(await modelAddHandler({ file: "items.json", rootPath } as any));
    expect(refused.error).toContain("has 1 item the tool can't read; nothing was staged");
    expect(refused.suggestions[0]).toStartWith("elements[1].name:");
    expect(errorOf(await modelShowHandler({ id: "application.applicationfunction.export-orders", rootPath })).error).toContain("not found");
  });
});

describe("model_update with a list", () => {
  it("applies each update in order, skips the invalid ones, and reports only those", async () => {
    await createChangeset();
    await add({ elements: [fn("exportOrders"), fn("archiveOrders"), schema("OrderExport")] });
    const result = await update({
      updates: [
        { id: "application.applicationfunction.export-orders", description: "Exports orders" },
        { id: "application.applicationfunction.archive-orders", sourceFile: "src/archive.ts", sourceSymbol: "archiveOrders" },
        { id: "data-model.objectschema.order-export", attributePatch: { type: 7 } }, // invalid
        { id: "application.applicationfunction.nope", description: "x" }, // not found
        { id: "application.applicationfunction.export-orders" }, // nothing to change
        { id: "application.applicationfunction.export-orders", name: "Export Orders" }, // same element again
      ],
    });
    expect(result.changeset).toBe("plan");
    expect(result.total).toBe(6);
    expect(result.counts).toEqual({ staged: 3, invalid: 2, "no-op": 1 });
    expect(result.attention.map((r: any) => [r.index, r.status])).toEqual([
      [2, "invalid"],
      [3, "invalid"],
      [4, "no-op"],
    ]);
    expect(result.attention[0].reason).toContain("fail schema validation");
    expect(result.attention[1].reason).toBe("Element application.applicationfunction.nope not found");
    expect(result.attention[2].reason).toBe("No fields specified for update");

    const exported = (await show("application.applicationfunction.export-orders")).element;
    expect(exported.description).toBe("Exports orders");
    expect(exported.name).toBe("Export Orders");
    expect((await show("application.applicationfunction.archive-orders")).element.source_reference).toEqual({
      provenance: "manual",
      locations: [{ file: "src/archive.ts", symbol: "archiveOrders" }],
    });
    expect((await show("data-model.objectschema.order-export")).element.attributes).toEqual({ type: "object" });
  });

  it("returns every item's changed fields with verbose: true", async () => {
    await createChangeset();
    await add({ elements: [fn("exportOrders")] });
    const result = await update({
      updates: [{ id: "application.applicationfunction.export-orders", description: "Exports orders" }],
      verbose: true,
    });
    expect(result.results).toEqual([
      { index: 0, id: "application.applicationfunction.export-orders", status: "staged", changedFields: ["description"], foldedIntoAdd: true },
    ]);
  });

  it("writes the model when no changeset is active", async () => {
    await add({ elements: [fn("exportOrders"), fn("archiveOrders")] });
    const result = await update({
      updates: [
        { id: "application.applicationfunction.export-orders", description: "Exports orders" },
        { id: "application.applicationfunction.archive-orders", description: "Archives orders" },
      ],
    });
    expect(result).toEqual({ total: 2, counts: { updated: 2 } });
    clearModelCache();
    expect((await show("application.applicationfunction.archive-orders")).element.description).toBe("Archives orders");
  });

  it("keeps the single form, and refuses both forms at once or neither", async () => {
    await add({ elements: [fn("exportOrders")] });
    const single = await update({ id: "application.applicationfunction.export-orders", description: "Exports orders" });
    expect(single).toMatchObject({ status: "updated", id: "application.applicationfunction.export-orders", changedFields: ["description"] });

    expect(errorOf(await modelUpdateHandler({ id: "a.b.c", updates: [], rootPath } as any)).error).toBe(
      "Send either a single update or updates, not both (got id beside updates)"
    );
    expect(errorOf(await modelUpdateHandler({ rootPath } as any)).error).toBe("model_update needs id, or an updates list");
  });
});

describe("sourceProvenance default (#1233)", () => {
  it("does not warn when sourceFile is sent alone, single or in a list", async () => {
    await createChangeset();
    const single = await add({ ...fn("exportOrders"), sourceFile: "src/export.ts" });
    expect(single.warnings).toBeUndefined();
    expect((await show(single.id)).element.source_reference).toEqual({ provenance: "manual", locations: [{ file: "src/export.ts" }] });

    const list = await add({ elements: [fn("importOrders", { sourceFile: "src/import.ts" }), fn("archiveOrders", { sourceFile: "src/archive.ts" })] });
    expect(list.elements).toEqual({ total: 2, counts: { staged: 2 } });

    const moved = await update({ id: single.id, sourceFile: "src/export/index.ts" });
    expect(moved.warnings).toBeUndefined();
  });

  it("still warns when a provenance is ignored", async () => {
    await createChangeset();
    const result = await add({ elements: [fn("importOrders", { sourceProvenance: "extracted" })] });
    expect(result.elements.attention[0].warnings[0]).toContain("sourceProvenance 'extracted' was ignored");
  });
});

describe("relationships naming elements an earlier call staged (#1230)", () => {
  it("resolves a name or an unhyphenated id against the model as the changeset leaves it", async () => {
    await createChangeset();
    await add({ elements: [fn("Offline Render Experience"), fn("Render Idle")] });
    // A later call: neither element is added by it.
    const viaAdd = await add({
      elements: [fn("Render Busy")],
      relationships: [
        { source: "Offline Render Experience", predicate: "depends-on", target: "Render Idle" },
        { source: "application.applicationfunction.offlinerenderexperience", predicate: "depends-on", target: "Render Busy" },
      ],
    });
    expect(viaAdd.relationships.counts).toEqual({ staged: 2 });
    expect(viaAdd.relationships.attention[0].notes).toEqual([
      "Source Offline Render Experience read as application.applicationfunction.offline-render-experience, which this changeset adds",
      "Target Render Idle read as application.applicationfunction.render-idle, which this changeset adds",
    ]);
    expect(viaAdd.relationships.attention[0]).toMatchObject({
      source: "application.applicationfunction.offline-render-experience",
      target: "application.applicationfunction.render-idle",
    });

    const viaRelate = await relate({ relationships: [{ source: "Render Busy", predicate: "depends-on", target: "Render Idle" }] });
    expect(viaRelate.counts).toEqual({ staged: 1 });
    const outgoing = (await show("application.applicationfunction.render-busy")).relationships.outgoing;
    expect(outgoing.map((r: any) => r.target)).toEqual(["application.applicationfunction.render-idle"]);
  });

  it("resolves against the base model too, and says so", async () => {
    await add({ elements: [fn("Render Idle")] });
    await createChangeset();
    const result = await add({
      elements: [fn("Render Busy")],
      relationships: [{ source: "Render Busy", predicate: "depends-on", target: "Render Idle" }],
    });
    expect(result.relationships.attention[0].notes[1]).toBe(
      "Target Render Idle read as application.applicationfunction.render-idle, which the model has"
    );
  });

  it("reads a name as the element this call adds, though the model has the name in another layer", async () => {
    // The usual shape of a sync: an entity, its table and its schema share a name.
    await add({ elements: [{ layer: "data-store", type: "collection", name: "Order" }] });
    await createChangeset();
    const result = await add({
      elements: [schema("Order")],
      relationships: [{ source: "Order", predicate: "maps-to", target: "data-store.collection.order" }],
    });
    expect(result.relationships.counts).toEqual({ staged: 1 });
    expect(result.relationships.attention[0]).toMatchObject({
      source: "data-model.objectschema.order",
      notes: ["Source Order read as data-model.objectschema.order, which this call adds"],
    });
  });

  it("refuses a name that more than one element has, naming them", async () => {
    await createChangeset();
    await add({ elements: [fn("Order Export"), schema("Order Export"), fn("Render Idle")] });
    const result = await relate({ relationships: [{ source: "Order Export", predicate: "depends-on", target: "Render Idle" }] });
    expect(result.counts).toEqual({ invalid: 1 });
    expect(result.attention[0].reason).toBe(
      "Source Order Export is not an exact id and matches more than one element: " +
        "application.applicationfunction.order-export, data-model.objectschema.order-export"
    );
    expect(result.attention[0].suggestions).toEqual(["Name the element by its exact id"]);
  });

  it("offers the id that starts the same when two tools cut one long name differently (#1225)", async () => {
    await createChangeset();
    const long = "refuses to land a verification record even when the caller passes force and the plan it verifies has already landed";
    const added = await add({ elements: [fn(long), fn("Render Idle")], verbose: true });
    const id = added.elements.results[0].id as string;
    expect(id).toBe(extractedElementId("application", "applicationfunction", long));
    // The id an older build made for the same name: not cut.
    const uncut = `application.applicationfunction.${long.replace(/ /g, "-")}`;
    const result = await relate({ relationships: [{ source: uncut, predicate: "depends-on", target: "Render Idle" }] });
    expect(result.attention[0].reason).toBe(`Source element ${uncut} not found`);
    expect(result.attention[0].suggestions[0]).toContain(`Did you mean: ${id}`);
  });
});

describe("required attributes of a refused type (#1153)", () => {
  it("lists what each refused type requires once, with allowed values", async () => {
    await createChangeset();
    const result = await add({
      elements: [
        { layer: "motivation", type: "goal", name: "Faster checkout" },
        { layer: "motivation", type: "goal", name: "Fewer errors" },
        { layer: "api", type: "operation", name: "Export Orders" },
        fn("exportOrders"),
      ],
    });
    expect(result.elements.counts).toEqual({ invalid: 3, staged: 1 });
    expect(result.elements.requiredAttributes).toEqual({
      "motivation.goal": { priority: "one of [critical, high, medium, low, informational]" },
      "api.operation": { operationId: "string", summary: "string", tags: "string" },
    });
    expect(result.elements.attention[0].reason).toContain("has invalid attributes");
  });

  it("tells the agent where required attributes are, before it sends anything", () => {
    expect(modelAddTool.description).toContain("Most types have required attributes: spec_type lists them");
    expect(modelAddTool.description).toContain("requiredAttributes");
  });
});

describe("ids a name derives (#1212, #1184)", () => {
  it("stages a name that starts with a digit under a valid id, and says what it did", async () => {
    await createChangeset();
    const single = await add({ layer: "application", type: "applicationcomponent", name: "3D Object Effect", attributes: { type: "internal" } });
    expect(single.status).toBe("staged");
    expect(single.id).toBe("application.applicationcomponent.n-3d-object-effect");
    expect(single.notes[0]).toContain("prefixed with 'n-'");
    expect((await show(single.id)).element.name).toBe("3D Object Effect");
  });

  it("does not call an id the schema refuses 'invalid attributes'", async () => {
    // A name with no letter or digit has no id at all.
    const refused = errorOf(await modelAddHandler({ ...fn("!!!"), rootPath } as any));
    expect(refused.error).toBe('Cannot generate a valid element ID from name "!!!"');
    expect(refused.error).not.toContain("attributes");
  });

  it("splits digits the same way with and without a space", async () => {
    await createChangeset();
    const result = await add({ elements: [schema("Tier1Status"), fn("Tier1 Panel"), fn("useTier1")], verbose: true });
    expect(result.elements.results.map((r: any) => r.id)).toEqual([
      "data-model.objectschema.tier1-status",
      "application.applicationfunction.tier1-panel",
      "application.applicationfunction.use-tier1",
    ]);
    for (const tool of [modelAddTool]) expect(tool.description).toContain("'Tier1Status' → tier1-status");
  });

  it("lists an element whose id is not its name's plain kebab case, so the agent has the id", async () => {
    await createChangeset();
    const result = await add({ elements: [fn("Node.js"), fn("exportOrders"), fn("PetTypeRepository.findPetTypes")] });
    expect(result.elements.counts).toEqual({ staged: 3 });
    // camelCase, and a dot between code-symbol parts, split as the description says: not listed.
    expect(result.elements.attention).toEqual([
      {
        index: 0,
        name: "Node.js",
        id: "application.applicationfunction.node-js",
        status: "staged",
        notes: ["Dots, slashes and braces in the name are word breaks in the id."],
      },
    ]);
  });

  it("says which name a second name's id collided with", async () => {
    await createChangeset();
    const op = (name: string) => ({ layer: "api", type: "operation", name, attributes: { operationId: "x", summary: "x", tags: "x" } });
    const result = await add({ elements: [op("GET /"), op("GET /*"), op("GET *"), op("GET /")] });
    // "GET /" is the root route (get-root); "GET /*" and "GET *" both come down to "get".
    expect(result.elements.counts).toEqual({ staged: 2, invalid: 2 });
    const [star, repeat, root] = result.elements.attention;
    // The root route was staged, and is listed (after the refusals) for its id: not the name's plain kebab case.
    expect(root).toMatchObject({ index: 0, id: "api.operation.get-root", notes: ["A route on the root path gets an id that ends in -root."] });
    expect(star).toMatchObject({
      index: 2,
      reason: '"GET *" gives the same id as elements[1] "GET /*" (api.operation.get): an id comes from the name alone',
      suggestions: ["Give one of the two a name that differs in its letters or digits"],
    });
    expect(repeat).toMatchObject({ index: 3, reason: "Repeated earlier in this batch (elements[0])" });
  });
});

describe("existing ids are never renamed", () => {
  /** Writes an element straight into the model under an id an earlier CLI derived. */
  async function seed(layer: string, type: string, id: string, name: string, attributes: Record<string, unknown> = {}) {
    const model = await Model.load(rootPath);
    const { Layer } = await import("../../../src/core/layer.js");
    let layerObj = await model.getLayer(layer);
    if (!layerObj) {
      layerObj = new Layer(layer);
      model.addLayer(layerObj);
    }
    layerObj.addElement(
      new Element({ id: generateUUID(), path: id, spec_node_id: `${layer}.${type}`, layer_id: layer, type, name, attributes, layer })
    );
    await model.saveLayer(layer);
    await model.saveManifest();
    clearModelCache();
  }

  const OLD_STATUS = "data-model.objectschema.tier1status"; // "Tier1Status" before 0.7.0
  const OLD_NODE = "application.applicationfunction.nodejs"; // "Node.js" before 0.7.0

  beforeEach(async () => {
    await seed("data-model", "objectschema", OLD_STATUS, "Tier1Status", { type: "object" });
    await seed("application", "applicationfunction", OLD_NODE, "Node.js");
  });

  it("keeps an element's id through model_update, a rename included", async () => {
    const result = await update({
      updates: [
        { id: OLD_STATUS, description: "Tier 1 state" },
        { id: OLD_NODE, name: "Node.js runtime" },
      ],
    });
    expect(result.counts).toEqual({ updated: 2 });
    clearModelCache();
    expect((await show(OLD_STATUS)).element).toMatchObject({ path: OLD_STATUS, description: "Tier 1 state" });
    expect((await show(OLD_NODE)).element).toMatchObject({ path: OLD_NODE, name: "Node.js runtime" });
    expect(errorOf(await modelShowHandler({ id: "data-model.objectschema.tier1-status", rootPath })).error).toContain("not found");
  });

  it("refuses to add the same name again under the id it gives today, naming the element it has", async () => {
    await createChangeset();
    const result = await add({ elements: [schema("Tier1Status"), fn("Node.js"), fn("exportOrders")] });
    expect(result.elements.counts).toEqual({ invalid: 2, staged: 1 });
    expect(result.elements.attention[0]).toMatchObject({
      id: OLD_STATUS,
      reason: `Element ${OLD_STATUS} already exists with this name (the name gives data-model.objectschema.tier1-status today; the element keeps its id)`,
    });
    expect(result.elements.attention[1].id).toBe(OLD_NODE);

    const single = errorOf(await modelAddHandler({ ...schema("Tier1Status"), rootPath } as any));
    expect(single.error).toContain(`Element ${OLD_STATUS} already exists with this name`);
  });

  it("reads a relationship that names the id of today's rule as the element that exists", async () => {
    await createChangeset();
    const result = await add({
      elements: [fn("readTier1")],
      relationships: [{ source: "readTier1", predicate: "accesses", target: "data-model.objectschema.tier1-status" }],
    });
    expect(result.relationships.counts).toEqual({ staged: 1 });
    expect(result.relationships.attention[0].target).toBe(OLD_STATUS);
    expect(result.relationships.attention[0].notes[1]).toBe(
      `Target data-model.objectschema.tier1-status read as ${OLD_STATUS}, which the model has`
    );
  });

  it("warns when a different name gives an id that differs from an existing one only by hyphens", async () => {
    await createChangeset();
    const result = await add({ elements: [schema("Tier1 Status")] });
    expect(result.elements.counts).toEqual({ staged: 1 });
    expect(result.elements.attention[0].warnings).toEqual([
      `data-model.objectschema.tier1-status differs only by hyphens from ${OLD_STATUS}: check that they are not the same element.`,
    ]);
  });
});
