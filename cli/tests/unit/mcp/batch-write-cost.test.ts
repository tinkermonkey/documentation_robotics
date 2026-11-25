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
import { DEFAULT_ATTENTION_LIMIT, batchReport, reasonParts, reasonPattern } from "../../../src/mcp/tools/batch-result.js";
import { modelAddHandler, modelAddTool } from "../../../src/mcp/tools/model-add.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { modelUpdateHandler, modelUpdateTool } from "../../../src/mcp/tools/model-update.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { relationshipAddHandler, relationshipAddTool } from "../../../src/mcp/tools/relationship-tools.js";
import { generateUUID, ID_NOTE_SUMMARY } from "../../../src/utils/id-generator.js";
import { listed } from "../../helpers/batch-causes.js";

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
        { source: "exportOrders", predicate: "depends-on", target: "importOrders" }, // by name: staged, in readByName
        { source: "application.applicationfunction.export-orders", predicate: "depends-on", target: "application.applicationfunction.nope" },
      ],
    });
    expect(result.elements.total).toBe(5);
    expect(result.elements.counts).toEqual({ staged: 4, invalid: 1 });
    expect(result.elements.results).toBeUndefined();
    // Not written first, then written with a warning; an id note is said once, apart (#1415).
    expect(result.elements.causes.map((c: any) => [c.status, c.count])).toEqual([
      ["invalid", 1],
      ["staged", 1],
    ]);
    expect(listed(result.elements).map((r) => [r.index, r.status])).toEqual([
      [1, "invalid"],
      [2, "staged"],
    ]);
    expect(listed(result.elements)[1].reason).toContain("'extracted' was ignored");
    expect(result.elements.attentionTotal).toBe(2);
    expect(result.elements.idNotes).toEqual([
      { note: ID_NOTE_SUMMARY["digit-prefix"], count: 1, sample: ["application.applicationfunction.n-3d-preview"] },
    ]);

    expect(result.relationships.counts).toEqual({ staged: 2, duplicate: 1, invalid: 1 });
    // Only what was not staged needs attention. The relationship given by names was staged: how
    // its ends were read is reported once, as a map, not as an item to look at.
    expect(listed(result.relationships).map((r) => [r.index, r.status])).toEqual([
      [1, "duplicate"],
      [3, "invalid"],
    ]);
    expect(result.relationships.attentionTotal).toBe(2);
    expect(result.relationships.notListed).toBeUndefined();
    expect(result.relationships.readByName).toEqual({
      exportOrders: "application.applicationfunction.export-orders",
      importOrders: "application.applicationfunction.import-orders",
    });
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
    expect(result.elements.causes).toBeUndefined();
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
    expect(again.counts).toEqual({ unchanged: 1 });
    expect(again.results).toHaveLength(1);
  });

  it("accounts for every failure in one response, by cause, when there are more than the limit lists", async () => {
    await createChangeset();
    await add({ elements: [fn("exportOrders"), fn("archiveOrders")] });
    const EXPORT = "application.applicationfunction.export-orders";
    const extra = 20;
    // Two causes, interleaved: an end that does not exist (each its own), and a triple the catalog does not have.
    const relationships = Array.from({ length: DEFAULT_ATTENTION_LIMIT + extra }, (_, i) =>
      i % 2 === 0
        ? { source: EXPORT, predicate: "depends-on", target: `application.applicationfunction.missing-${i}` }
        : { source: EXPORT, predicate: "tests", target: "application.applicationfunction.archive-orders" }
    );
    relationships.push({ source: EXPORT, predicate: "depends-on", target: "application.applicationfunction.archive-orders" });
    const sent = relationships.length;
    const failures = DEFAULT_ATTENTION_LIMIT + extra;
    const body = parse(await relationshipAddHandler({ relationships, rootPath } as any));

    // Summary first: counts are over the whole batch, not the part listed.
    expect(Object.keys(body).slice(0, 4)).toEqual(["changeset", "total", "counts", "attentionTotal"]);
    expect(body.total).toBe(sent);
    expect(body.counts).toEqual({ invalid: failures, staged: 1 });
    expect(body.attentionTotal).toBe(failures);

    // Two causes, each with its true count; items listed up to the limit across them.
    expect(body.causes.map((c: any) => [c.status, c.count])).toEqual([
      ["invalid", failures / 2],
      ["invalid", failures / 2],
    ]);
    const [missing, catalog] = body.causes;
    expect(missing.reason).toBe("Target element <id> not found");
    expect(missing.suggestions).toEqual(['Use "model_search" to find elements, or "changeset_brief" to see what this changeset adds']);
    expect(missing.items[0].values).toEqual([`application.applicationfunction.missing-${missing.items[0].index}`]);
    // One catalog refusal shared word for word by every item: written out once, items by position.
    expect(catalog.reason).toContain("The catalog has no application.applicationfunction --[tests]--> application.applicationfunction");
    expect(catalog.items.every((item: any) => item.values === undefined)).toBe(true);
    expect(missing.items.length + catalog.items.length).toBe(DEFAULT_ATTENTION_LIMIT);
    expect((missing.notListed ?? 0) + (catalog.notListed ?? 0)).toBe(extra);
    expect(body.notListed).toBe(extra);
    // Not written, so sending the list again lists them; nothing written comes back but unchanged.
    expect(body.more).toContain(`limit: ${failures}`);
    expect(body.more).toContain("comes back unchanged");

    // Every listed item's text, rebuilt from its cause, is the message it has in full.
    const whole = parse(await relationshipAddHandler({ relationships: relationships.slice(0, -1), verbose: true, rootPath } as any));
    for (const item of listed(body)) {
      expect(item.reason).toBe(whole.results[item.index].reason);
      expect(item.suggestions).toEqual(whole.results[item.index].suggestions);
    }

    // Sending the batch again writes nothing twice (what was staged is unchanged), and limit lists every failure.
    const again = parse(await relationshipAddHandler({ relationships, limit: sent, rootPath } as any));
    expect(again.counts).toEqual({ invalid: failures, unchanged: 1 });
    expect(listed(again)).toHaveLength(failures);
    expect(again.notListed).toBeUndefined();
  });

  it("reports one missing target named by many relationships as one cause with its count (#1295)", async () => {
    await createChangeset();
    const tags = ["a", "b", "c", "d"].map((t) => fn(`tag ${t}`));
    await add({ elements: tags });
    const relationships = Array.from({ length: 123 }, (_, i) => ({
      source: `application.applicationfunction.tag-${"abcd"[i % 4]}`,
      predicate: "depends-on",
      target: "application.applicationfunction.no-such-function",
    }));
    const result = await relationshipAddHandler({ relationships, limit: 5, rootPath } as any);
    const body = parse(result);
    expect(body.counts).toEqual({ invalid: 123 });
    expect(body.causes).toEqual([
      {
        status: "invalid",
        reason: "Target element application.applicationfunction.no-such-function not found",
        suggestions: ['Use "model_search" to find elements, or "changeset_brief" to see what this changeset adds'],
        count: 123,
        items: [0, 1, 2, 3, 4].map((index) => ({ index })),
        notListed: 118,
      },
    ]);
    expect(text(result).length).toBeLessThan(1024);
  });

  it("lists failures before warnings, one of every cause first, and says id notes once", async () => {
    await createChangeset();
    // Six elements staged with a note about their id, two with a warning, then two that are refused.
    const elements = [
      ...Array.from({ length: 6 }, (_, i) => fn(`${i + 1}D Preview`)),
      fn("importOrders", { sourceProvenance: "extracted" }),
      fn("exportOrders", { sourceProvenance: "extracted" }),
      schema("OrderExport", { attributes: { type: 7 } }),
      schema("OrderImport", { attributes: { type: 7 } }),
    ];
    const result = await add({ elements, limit: 2 });
    expect(result.elements.counts).toEqual({ staged: 8, invalid: 2 });
    // The id notes are not attention items (#1415): said once, with a count and sample ids (#1302).
    expect(result.elements.attentionTotal).toBe(4);
    expect(result.elements.idNotes).toEqual([
      {
        note: ID_NOTE_SUMMARY["digit-prefix"],
        count: 6,
        sample: [1, 2, 3, 4, 5].map((n) => `application.applicationfunction.n-${n}d-preview`),
      },
    ]);
    // The refusals come first; the limit lists one of each cause before a second of any.
    const [refused, warned] = result.elements.causes;
    expect(refused).toMatchObject({ status: "invalid", count: 2, notListed: 1 });
    expect(refused.reason).toContain("Element <id> has invalid attributes");
    // The reason names the element twice; the item's values say it each time.
    expect(refused.items).toEqual([{ index: 8, values: ["data-model.objectschema.order-export", "data-model.objectschema.order-export"] }]);
    expect(warned).toMatchObject({ status: "staged", count: 2, notListed: 1 });
    expect(warned.items).toEqual([{ index: 6, id: "application.applicationfunction.import-orders" }]);
    expect(result.elements.notListed).toBe(2);

    // limit: 0 lists none and still accounts for both.
    const none = await update({
      updates: [{ id: "application.applicationfunction.nope-a", description: "x" }, { id: "application.applicationfunction.nope-b", description: "x" }],
      limit: 0,
    });
    expect(none.attentionTotal).toBe(2);
    expect(none.causes).toEqual([
      {
        status: "invalid",
        reason: "Element <id> not found",
        suggestions: ['Use "model_search" to find similar elements'],
        count: 2,
        items: [],
        notListed: 2,
      },
    ]);
  });

  it("batchReport by cause: listed and counted items together are every item that needs attention", () => {
    const results = Array.from({ length: 500 }, (_, index) => ({
      index,
      id: `api.operation.op-${index}`,
      status: index % 5 === 0 ? "invalid" : index % 11 === 0 ? "unchanged" : "staged",
      ...(index % 5 === 0 ? { reason: `Element api.operation.op-${index} has invalid attributes` } : {}),
      ...(index % 7 === 0 && index % 5 !== 0 ? { warnings: ["sourceProvenance 'extracted' was ignored"] } : {}),
    }));
    // An unchanged item is settled: never listed, even with a warning.
    const flagged = results.filter((r) => r.status === "invalid" || (r.status === "staged" && "warnings" in r)).length;
    for (const limit of [0, 1, 2, 50, flagged - 1, flagged, 10_000]) {
      const report = batchReport(results, { limit, written: ["staged"], settled: ["unchanged"], byCause: true });
      expect(report.total).toBe(500);
      expect(report.attentionTotal).toBe(flagged);
      // limit caps the causes listed too, at least one: the not written first.
      expect(report.causes!.map((c) => c.status)).toEqual(limit >= 2 ? ["invalid", "staged"] : ["invalid"]);
      expect(report.causesTotal).toBe(limit >= 2 ? undefined : 2);
      const shown = report.causes!.flatMap((c) => c.items.map((item) => item.index));
      expect(shown).toHaveLength(Math.min(limit, report.causes!.reduce((n, c) => n + c.count, 0)));
      expect(new Set(shown).size).toBe(shown.length);
      expect(report.notListed ?? 0).toBe(flagged - shown.length);
      // One of every cause before a second of any.
      if (limit >= 2) expect(report.causes!.every((c) => c.items.length > 0)).toBe(true);
    }
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
      const grouped = (report.attentionNotListed?.groups ?? []).flatMap((g) => g.items.map((item) => item.index));
      expect(listed).toHaveLength(Math.min(limit, flagged));
      expect(new Set([...listed, ...grouped]).size).toBe(flagged);
      expect(report.attentionNotListed?.count ?? 0).toBe(flagged - listed.length);
    }
    expect(batchReport(results, { verbose: true, written: ["staged"] }).results).toHaveLength(500);
  });

  it("batchReport: every grouped item's text comes back exactly, placeholder spellings and leading zeros included", () => {
    const reasons = [
      "Source element <id> not found",
      "Source element api.operation.x not found",
      'Target "a [n] b" is at x[07]',
      'Target "c" is at x[7]',
      "Element api.operation.y has invalid attributes:\n  At /attributes: missing required property 'tags'",
    ];
    const results = reasons.map((reason, index) => ({
      index,
      status: "invalid",
      reason,
      suggestions: [index === 0 ? 'Use "model_search" to find <id>' : 'Use "model_search" to find elements'],
    }));
    const report = batchReport(results, { limit: 0, written: ["staged"] });
    const fill = (text: string, values: Array<string | number>, at: { i: number }) =>
      text.replace(/<id>|"<name>"|\[n\]/g, (token) => {
        const v = values[at.i++];
        return token === "<id>" ? String(v) : token === "[n]" ? `[${v}]` : `"${v}"`;
      });
    const rebuilt = new Map<number, { reason: string; suggestions: string[] }>();
    for (const group of report.attentionNotListed!.groups) {
      for (const item of group.items) {
        if (group.literal) {
          rebuilt.set(item.index, { reason: group.reason, suggestions: group.suggestions ?? [] });
          continue;
        }
        const at = { i: 0 };
        const values = item.values ?? [];
        rebuilt.set(item.index, { reason: fill(group.reason, values, at), suggestions: (group.suggestions ?? []).map((t) => fill(t, values, at)) });
      }
    }
    for (const r of results) expect(rebuilt.get(r.index)).toEqual({ reason: r.reason, suggestions: r.suggestions });
    // Only the texts that held a placeholder's spelling outside quotes are kept whole.
    expect(report.attentionNotListed!.groups.filter((g) => g.literal).flatMap((g) => g.items.map((i) => i.index))).toEqual([0, 2]);
  });

  it("reasonPattern takes out what differs between items and keeps the cause, and reasonParts keeps what it took", () => {
    expect(reasonParts('Element api.operation.get already exists, named "GET /": "GET /x" gives the same id as elements[4]')).toEqual({
      pattern: 'Element <id> already exists, named "<name>": "<name>" gives the same id as elements[n]',
      values: ["api.operation.get", "GET /", "GET /x", 4],
    });
    expect(reasonPattern("Source element application.applicationfunction.missing-3 not found")).toBe("Source element <id> not found");
    expect(reasonPattern('"GET *" gives the same id as elements[1] "GET /*" (api.operation.get)')).toBe(
      '"<name>" gives the same id as elements[n] "<name>" (<id>)'
    );
    // The text is kept exactly, line breaks and all.
    expect(reasonPattern("Element api.operation.x has invalid attributes:\n  At /attributes: missing required property 'tags'")).toBe(
      "Element <id> has invalid attributes:\n  At /attributes: missing required property 'tags'"
    );
    // A position keeps its spelling, and a text that already holds a placeholder's spelling is kept whole.
    expect(reasonParts("x[07] and x[7]")).toEqual({ pattern: "x[n] and x[n]", values: ["07", 7] });
    expect(reasonParts("Source element <id> not found")).toEqual({ pattern: "Source element <id> not found", values: [], literal: true });
  });

  it("documents the result shape and verbose in the tool descriptions", () => {
    for (const tool of [modelAddTool, relationshipAddTool, modelUpdateTool]) {
      expect(tool.description).toContain("summary first");
      expect(tool.description).toContain("causes");
      expect(tool.description).toContain("unchanged");
      expect(tool.description).toContain("verbose: true");
      // The default is a named argument, stated in the description, and nothing is left out past it.
      expect(tool.description).toContain("up to limit items across the causes (default 50; limit caps the causes too");
      expect(tool.description).toContain("notListed");
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
    expect(listed(result.elements)[0].reason).toContain("missing required property 'type'");
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
    expect(listed(result).map((r) => [r.index, r.status])).toEqual([
      [2, "invalid"],
      [3, "invalid"],
      [4, "no-op"],
    ]);
    expect(listed(result)[0].reason).toContain("fail schema validation");
    expect(listed(result)[1].reason).toBe("Element application.applicationfunction.nope not found");
    expect(listed(result)[2].reason).toBe("No fields specified for update");

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
    expect(listed(result.elements)[0].reason).toContain("sourceProvenance 'extracted' was ignored");
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
    // Staged, and nothing to look at: the readings come as one map.
    expect(viaAdd.relationships).toEqual({
      total: 2,
      counts: { staged: 2 },
      readByName: {
        "Offline Render Experience": "application.applicationfunction.offline-render-experience",
        "Render Idle": "application.applicationfunction.render-idle",
        "application.applicationfunction.offlinerenderexperience": "application.applicationfunction.offline-render-experience",
        "Render Busy": "application.applicationfunction.render-busy",
      },
    });
    // verbose says where each element was found.
    const again = await relate({ relationships: [{ source: "Offline Render Experience", predicate: "depends-on", target: "Render Idle" }], verbose: true });
    expect(again.results[0]).toMatchObject({
      status: "unchanged",
      source: "application.applicationfunction.offline-render-experience",
      notes: [
        "Source Offline Render Experience read as application.applicationfunction.offline-render-experience, which this changeset adds",
        "Target Render Idle read as application.applicationfunction.render-idle, which this changeset adds",
      ],
    });

    const viaRelate = await relate({ relationships: [{ source: "Render Busy", predicate: "depends-on", target: "Render Idle" }] });
    expect(viaRelate.counts).toEqual({ staged: 1 });
    const outgoing = (await show("application.applicationfunction.render-busy")).relationships.outgoing;
    expect(outgoing.map((r: any) => r.target)).toEqual(["application.applicationfunction.render-idle"]);
  });

  it("answers 181 relationships given by name with a map of the names, not an item for each", async () => {
    await createChangeset();
    const names = Array.from({ length: 40 }, (_, i) => `Render State ${i}`);
    await add({ elements: names.map((name) => fn(name)) });
    const relationships = [];
    for (let i = 0; relationships.length < 181; i++) {
      relationships.push({ source: names[i % 40], predicate: "depends-on", target: names[(i * 7 + 1 + Math.floor(i / 40)) % 40] });
    }
    const result = await relationshipAddHandler({ relationships, rootPath } as any);
    const body = parse(result);
    expect(body.total).toBe(181);
    expect((body.counts.staged ?? 0) + (body.counts.duplicate ?? 0) + (body.counts.unchanged ?? 0) + (body.counts.invalid ?? 0)).toBe(181);
    expect(body.counts.staged).toBeGreaterThan(150);
    // One entry per distinct name, each with the id it was read as.
    expect(Object.keys(body.readByName)).toHaveLength(40);
    expect(body.readByName["Render State 7"]).toBe("application.applicationfunction.render-state-7");
    // Only the items that were not staged (or already there) are attention items.
    expect(body.attentionTotal ?? 0).toBe(181 - body.counts.staged - (body.counts.unchanged ?? 0));
    expect(text(result).length).toBeLessThan(12 * 1024);
  });

  it("relationship_add's single form reads a name too, and refuses one that several elements have", async () => {
    await createChangeset();
    await add({ elements: [fn("Render Idle"), fn("Render Busy"), fn("Order Export"), schema("Order Export")] });
    const single = await relate({ source: "Render Busy", predicate: "depends-on", target: "application.applicationfunction.renderidle" });
    expect(single).toMatchObject({
      status: "staged",
      source: "application.applicationfunction.render-busy",
      target: "application.applicationfunction.render-idle",
      notes: [
        "Source Render Busy read as application.applicationfunction.render-busy",
        "Target application.applicationfunction.renderidle read as application.applicationfunction.render-idle",
      ],
    });
    const ambiguous = errorOf(await relationshipAddHandler({ source: "Order Export", predicate: "depends-on", target: "Render Idle", rootPath } as any));
    expect(ambiguous.error).toBe(
      "Source Order Export is not an exact id and matches more than one element: " +
        "application.applicationfunction.order-export, data-model.objectschema.order-export"
    );
  });

  it("resolves against the base model too", async () => {
    await add({ elements: [fn("Render Idle")] });
    await createChangeset();
    const result = await add({
      elements: [fn("Render Busy")],
      relationships: [{ source: "Render Busy", predicate: "depends-on", target: "Render Idle" }],
      verbose: true,
    });
    expect(result.relationships.readByName).toEqual({
      "Render Busy": "application.applicationfunction.render-busy",
      "Render Idle": "application.applicationfunction.render-idle",
    });
    expect(result.relationships.results[0].notes[1]).toBe(
      "Target Render Idle read as application.applicationfunction.render-idle, which the model has"
    );
  });

  it("refuses a name that this call's element shares with an element of the model, and says which is which", async () => {
    // An entity, its table and its schema often share a name. The name alone could mean either,
    // so it is not guessed at, even though one of the two is this call's own.
    await add({ elements: [{ layer: "data-store", type: "collection", name: "Order" }] });
    await createChangeset();
    const result = await add({
      elements: [schema("Order")],
      relationships: [
        { source: "Order", predicate: "maps-to", target: "data-store.collection.order" },
        { source: "data-model.objectschema.order", predicate: "maps-to", target: "data-store.collection.order" },
      ],
    });
    expect(result.relationships.counts).toEqual({ invalid: 1, staged: 1 });
    expect(listed(result.relationships)[0]).toMatchObject({
      index: 0,
      reason:
        "Source Order is not an exact id and matches more than one element: " +
        "data-model.objectschema.order (this call adds it), data-store.collection.order",
      suggestions: ["Name the element by its exact id"],
    });
  });

  it("refuses a name that more than one element has, naming them", async () => {
    await createChangeset();
    await add({ elements: [fn("Order Export"), schema("Order Export"), fn("Render Idle")] });
    const result = await relate({ relationships: [{ source: "Order Export", predicate: "depends-on", target: "Render Idle" }] });
    expect(result.counts).toEqual({ invalid: 1 });
    expect(listed(result)[0].reason).toBe(
      "Source Order Export is not an exact id and matches more than one element: " +
        "application.applicationfunction.order-export, data-model.objectschema.order-export"
    );
    expect(listed(result)[0].suggestions).toEqual(["Name the element by its exact id"]);
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
    expect(listed(result)[0].reason).toBe(`Source element ${uncut} not found`);
    expect(listed(result)[0].suggestions![0]).toContain(`Did you mean: ${id}`);
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
    expect(listed(result.elements)[0].reason).toContain("has invalid attributes");
    // Each refused type once, in requiredAttributes: never repeated on every refused item.
    for (const item of listed(result.elements)) {
      expect((item.suggestions ?? []).some((s: string) => s.includes(" requires: "))).toBe(false);
    }
  });

  it("names what the type requires, with allowed values, when a single add is refused", async () => {
    const refused = errorOf(await modelAddHandler({ layer: "motivation", type: "goal", name: "Faster checkout", rootPath } as any));
    expect(refused.error).toContain("has invalid attributes");
    expect(refused.suggestions[0]).toBe("motivation.goal requires: priority (one of [critical, high, medium, low, informational])");
    expect(refused.suggestions[1]).toContain('Call "spec_type"');
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

  it("names an element whose id is not its name's plain kebab case, so the agent has the id", async () => {
    await createChangeset();
    const result = await add({ elements: [fn("Node.js"), fn("exportOrders"), fn("PetTypeRepository.findPetTypes")] });
    expect(result.elements.counts).toEqual({ staged: 3 });
    // camelCase, and a dot between code-symbol parts, split as the description says: not named.
    // Nothing needs attention: the note is said once, with the id (#1415).
    expect(result.elements.causes).toBeUndefined();
    expect(result.elements.idNotes).toEqual([
      { note: ID_NOTE_SUMMARY["word-breaks"], count: 1, sample: ["application.applicationfunction.node-js"] },
    ]);
    // verbose keeps the note on the item.
    const verbose = await add({ elements: [fn("Deno.js")], verbose: true });
    expect(verbose.elements.results[0].notes).toEqual(["Dots, slashes and braces in the name are word breaks in the id."]);
  });

  it("says each id rule once with a count and sample, however many names and lengths (#1302, #1415)", async () => {
    await createChangeset();
    const long = (n: number) => `checks that ${"the order total ".repeat(5)}holds for case number ${n} ${"x".repeat(n)}`;
    const elements = [
      ...Array.from({ length: 40 }, (_, n) => fn(long(n))),
      ...Array.from({ length: 30 }, (_, n) => fn(`GET /api/projects/${n}/parts`)),
    ];
    const result = await add({ elements });
    expect(result.elements.counts).toEqual({ staged: 70 });
    expect(result.elements.attentionTotal).toBeUndefined();
    expect(result.elements.idNotes.map((n: any) => [n.note, n.count, n.sample.length])).toEqual([
      [ID_NOTE_SUMMARY["shortened"], 40, 5],
      [ID_NOTE_SUMMARY["word-breaks"], 30, 5],
    ]);
  });

  it("says which name a second name's id collided with", async () => {
    await createChangeset();
    const op = (name: string) => ({ layer: "api", type: "operation", name, attributes: { operationId: "x", summary: "x", tags: "x" } });
    const result = await add({ elements: [op("GET /"), op("GET /*"), op("GET *"), op("GET /")] });
    // "GET /" is the root route (get-root); "GET /*" and "GET *" both come down to "get".
    expect(result.elements.counts).toEqual({ staged: 2, invalid: 1, duplicate: 1 });
    const [star, repeat] = [listed(result.elements)[0], listed(result.elements)[1]];
    // The root route was staged; its id note is said once, with its id.
    expect(result.elements.idNotes).toEqual([{ note: ID_NOTE_SUMMARY["root-route"], count: 1, sample: ["api.operation.get-root"] }]);
    expect(star).toMatchObject({
      index: 2,
      reason: '"GET *" gives the same id as elements[1] "GET /*" (api.operation.get): an id comes from the name alone',
      suggestions: ["Give one of the two a name that differs in its letters or digits"],
    });
    // The same element sent twice in one list is a duplicate, not a refusal (#1296).
    expect(repeat).toMatchObject({ index: 3, status: "duplicate", reason: "Repeated earlier in this batch (elements[0])" });
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
    expect(result.elements.causes[0].reason).toBe(
      `Element <id> already exists with this name (the name gives <id> today; the element keeps its id)`
    );
    expect(listed(result.elements)[0]).toMatchObject({
      reason: `Element ${OLD_STATUS} already exists with this name (the name gives data-model.objectschema.tier1-status today; the element keeps its id)`,
    });
    expect(listed(result.elements)[1].reason).toContain(OLD_NODE);

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
    expect(result.relationships.readByName).toEqual({
      readTier1: "application.applicationfunction.read-tier1",
      "data-model.objectschema.tier1-status": OLD_STATUS,
    });
    expect((await show("application.applicationfunction.read-tier1")).relationships.outgoing[0].target).toBe(OLD_STATUS);
  });

  it("refuses a name whose element sits at an id that differs by more than hyphens", async () => {
    // What CLI 0.6.0 made: the root route at `get`, a long name left whole by model_add, and a long
    // extracted name whose hash was of the slug before the digit rule.
    const long = `reads Tier1Status ${"and keeps going ".repeat(8)}to the end`;
    const uncut = `application.applicationfunction.${long.toLowerCase().replace(/ /g, "-")}`;
    const cutBefore = (await import("../../../src/utils/id-generator.js")).earlierElementIds("application", "applicationfunction", `${long} twice`)[1];
    await seed("api", "operation", "api.operation.get", "GET /", { operationId: "get", summary: "GET /", tags: "x" });
    await seed("application", "applicationfunction", uncut, long);
    await seed("application", "applicationfunction", cutBefore, `${long} twice`);
    expect(cutBefore).toMatch(/-[0-9a-f]{8}$/);

    await createChangeset();
    const result = await add({
      elements: [
        { layer: "api", type: "operation", name: "GET /", attributes: { operationId: "get", summary: "GET /", tags: "x" } },
        fn(long),
        fn(`${long} twice`),
        // "GET /*" gives `get` today, the id the "GET /" element holds: refused as taken by another name.
        { layer: "api", type: "operation", name: "GET /*", attributes: { operationId: "get-all", summary: "GET /*", tags: "x" } },
      ],
    });
    expect(result.elements.counts).toEqual({ invalid: 4 });
    const refused = listed(result.elements);
    for (const [i, id] of ["api.operation.get", uncut, cutBefore, "api.operation.get"].entries()) {
      expect(refused[i].reason).toContain(`Element ${id} already exists`);
    }
    expect(refused[0].reason).toBe(
      "Element api.operation.get already exists with this name (the name gives api.operation.get-root today; the element keeps its id)"
    );
    // The fourth is refused for another reason, and says so: its id is taken by an element of another name.
    expect(refused[3].reason).toBe(
      'Element api.operation.get already exists, named "GET /": "GET /*" gives the same id, so give the new element a name that differs in its letters or digits'
    );

    const single = errorOf(
      await modelAddHandler({ layer: "api", type: "operation", name: "GET /", attributes: { operationId: "get", summary: "GET /", tags: "x" }, rootPath } as any)
    );
    expect(single.error).toContain("Element api.operation.get already exists with this name");
  });

  it("adds a name an earlier rule merged with an existing element's, when today's rule tells them apart", async () => {
    // The catch-all route at `get` (what 0.5/0.6 extraction gave "GET /*"), and "Version 12".
    await seed("api", "operation", "api.operation.get", "GET /*", { operationId: "get-all", summary: "GET /*", tags: "x" });
    await seed("api", "operation", "api.operation.version-12", "Version 12", { operationId: "v12", summary: "v12", tags: "x" });
    await createChangeset();
    const op = (name: string, operationId: string) => ({ layer: "api", type: "operation", name, attributes: { operationId, summary: name, tags: "x" } });
    const list = await add({ elements: [op("GET /", "get-root"), op("Version 1.2", "v1-2")], verbose: true });
    expect(list.elements.counts).toEqual({ staged: 2 });
    expect(list.elements.results.map((r: any) => r.id)).toEqual(["api.operation.get-root", "api.operation.version-1-2"]);
    // "Version 1.2" and "Version 12" differ only by hyphens: staged, with a warning to check.
    expect(list.elements.results[1].warnings[0]).toContain("differs only by hyphens from api.operation.version-12");
    // The single form agrees, and the catch-all element is untouched.
    await (await import("../../../src/mcp/tools/changeset-editing.js")).changesetUnstageHandler({ elementId: "api.operation.get-root", rootPath } as any);
    expect((await add(op("GET /", "get-root"))).id).toBe("api.operation.get-root");
    expect((await show("api.operation.get")).element.name).toBe("GET /*");
  });

  it("refuses names whose elements releases before 0.6.0 made, single and in a list", async () => {
    const { EARLIER_ID_RULES } = await import("../../../src/utils/id-generator.js");
    const old = (rule: string, name: string) => EARLIER_ID_RULES.find((r) => r.rule === rule)!.slug(name);
    const suite = `Suite/${"Case".repeat(25)}.spec.ts`;
    const words = `${"word ".repeat(20)}.then slash/part`;
    const steps = `Order.processPayment ${"Step ".repeat(20).trim()}`;
    const seeded = [
      { id: `application.applicationfunction.${old("extract-0.4", suite)}`, name: suite },
      { id: `application.applicationfunction.${old("extract-0.4", words)}`, name: words },
      { id: `application.applicationfunction.${old("add-0.1", steps)}`, name: steps },
    ];
    for (const e of seeded) await seed("application", "applicationfunction", e.id, e.name);
    await createChangeset();
    const list = await add({ elements: seeded.map((e) => fn(e.name)) });
    expect(list.elements.counts).toEqual({ invalid: 3 });
    expect(listed(list.elements).map((r) => r.reason.split(" ")[1])).toEqual(seeded.map((e) => e.id));
    for (const e of seeded) {
      const single = errorOf(await modelAddHandler({ ...fn(e.name), rootPath } as any));
      expect(single.error).toContain(`Element ${e.id} already exists with this name`);
    }
  });

  it("says when an id is taken by an element of another name, from an earlier call", async () => {
    await createChangeset();
    await add({ elements: [fn("3D Object Effect")] });
    const result = await add({ elements: [fn("N 3D Object Effect")] });
    expect(listed(result.elements)[0].reason).toBe(
      'Element application.applicationfunction.n-3d-object-effect already exists, named "3D Object Effect": ' +
        '"N 3D Object Effect" gives the same id, so give the new element a name that differs in its letters or digits'
    );
  });

  it("refuses a name that gave the existing element's id under an earlier rule, in case, spacing or punctuation", async () => {
    await createChangeset();
    const result = await add({ elements: [schema("TIER1Status"), schema("Tier1 Status")] });
    // "TIER1Status" and "Tier1 Status" both gave tier1status's id under some rule: one element.
    expect(result.elements.counts).toEqual({ invalid: 2 });
    expect(listed(result.elements)[0].reason).toBe(
      `Element ${OLD_STATUS} already exists, named "Tier1Status": that name and this one gave one id when it was made ` +
        "(this one gives data-model.objectschema.tier1-status today; the element keeps its id)"
    );
  });

  it("warns when a different name gives an id that differs from an existing one only by hyphens", async () => {
    await createChangeset();
    // "Tier 1 Status" (tier-1-status) never gave Tier1Status's id: another element, worth a warning.
    const result = await add({ elements: [schema("Tier 1 Status")] });
    expect(result.elements.counts).toEqual({ staged: 1 });
    expect(listed(result.elements)[0].reason).toBe(
      `data-model.objectschema.tier-1-status differs only by hyphens from ${OLD_STATUS}: check that they are not the same element.`
    );
  });
});
