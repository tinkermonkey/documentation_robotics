/**
 * Unit tests for the MCP model tool handlers — success and error paths for
 * each of the model_* tools registered by McpToolRegistry.
 *
 * Each test creates its own project directory via withProject() rather than
 * beforeEach/afterEach, since the `test`/`test:unit` scripts run this file
 * under `bun test --concurrent` (every `it` runs concurrently) — a shared
 * describe-scoped `let rootPath` would race across tests.
 */

import { describe, it, expect, spyOn } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { loadModel } from "../../../src/mcp/tools/shared.js";
import { LIST_COMPACT_LIMIT, LIST_DESCRIPTION_LIMIT, modelListHandler, shortDescription } from "../../../src/mcp/tools/model-list.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { modelSearchHandler } from "../../../src/mcp/tools/model-search.js";
import { modelStatsHandler } from "../../../src/mcp/tools/model-stats.js";
import { modelInfoHandler } from "../../../src/mcp/tools/model-info.js";
import { modelTraceHandler } from "../../../src/mcp/tools/model-trace.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { modelDeleteHandler } from "../../../src/mcp/tools/model-delete.js";
import { modelValidateHandler } from "../../../src/mcp/tools/model-validate.js";
import { modelExportHandler } from "../../../src/mcp/tools/model-export.js";
import { modelReloadHandler } from "../../../src/mcp/tools/model-reload.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

/**
 * Creates an isolated project directory with two fixture businessservice
 * elements ("payments" and "orders"), runs `fn` against it, then cleans up.
 * Fully self-contained per call so concurrently-running tests never share state.
 */
async function withProject(fn: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = join(
    tmpdir(),
    `dr-mcp-tools-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "MCP Tools Unit Test Model", version: "0.1.0" });

  await modelAddHandler({
    layer: "business",
    type: "businessservice",
    name: "payments",
    description: "Payments service",
    rootPath,
  });
  await modelAddHandler({
    layer: "business",
    type: "businessservice",
    name: "orders",
    rootPath,
  });

  try {
    await fn(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}

describe("MCP model tools", () => {
  describe("model_list", () => {
    it("lists elements scoped to a layer", async () => {
      await withProject(async (rootPath) => {
        const result = await modelListHandler({ layer: "business", rootPath });
        const data = parse(result);
        expect(data.count).toBe(2);
        expect(data.elements.map((e: any) => e.id).sort()).toEqual([
          "business.businessservice.orders",
          "business.businessservice.payments",
        ]);
      });
    });

    it("lists across all layers when no layer is given", async () => {
      await withProject(async (rootPath) => {
        const result = await modelListHandler({ rootPath });
        const data = parse(result);
        expect(data.totalElements).toBe(2);
        expect(data.layers.map((l: any) => l.layer)).toEqual(["business"]);
      });
    });

    // #1187: the unfiltered listing of a 115-element model was 104 KB, more than a client shows.
    it("is compact by default: id, name and a short description per element, and says so", async () => {
      await withProject(async (rootPath) => {
        const data = parse(await modelListHandler({ rootPath }));
        expect(data.detail).toBe("compact");
        const elements = data.layers[0].elements;
        expect(elements).toEqual([
          {
            id: "business.businessservice.payments",
            name: "payments",
            description: "Payments service",
          },
          // No description: the field is left out. Layer and type are in the id.
          { id: "business.businessservice.orders", name: "orders" },
        ]);
        // One line that says what this is, how to get the full form and what narrows it.
        expect(data.more).toContain('detail: "full"');
        expect(data.more).toContain("layer");
        expect(data.more).toContain("type");
        expect(data.more).not.toContain("\n");

        // The same default when scoped to a layer.
        const scoped = parse(await modelListHandler({ layer: "business", rootPath }));
        expect(scoped.detail).toBe("compact");
        expect(scoped.layer).toBe("business");
        expect(scoped.elements).toEqual(elements);
        expect(scoped.more).toBe(data.more);
      });
    });

    it('returns every element whole with detail: "full", as before', async () => {
      await withProject(async (rootPath) => {
        const data = parse(await modelListHandler({ detail: "full", rootPath }));
        // The shape the tool had before the compact default (no detail or more field), plus the page.
        expect(Object.keys(data).sort()).toEqual(["layers", "page", "totalElements"]);
        expect(data.page).toEqual({ total: 2, returned: 2, offset: 0 });
        expect(data.totalElements).toBe(2);
        expect(Object.keys(data.layers[0]).sort()).toEqual(["count", "elements", "layer"]);
        const payments = data.layers[0].elements.find((e: any) => e.path === "business.businessservice.payments");
        expect(payments).toMatchObject({
          path: "business.businessservice.payments",
          spec_node_id: "business.businessservice",
          type: "businessservice",
          layer_id: "business",
          name: "payments",
          description: "Payments service",
        });
        expect(payments.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(payments.metadata.created_at).toBeDefined();

        const scoped = parse(await modelListHandler({ layer: "business", detail: "full", rootPath }));
        expect(Object.keys(scoped).sort()).toEqual(["count", "elements", "layer", "page"]);
        expect(scoped.count).toBe(2);
        expect(scoped.elements).toEqual(data.layers[0].elements);
      });
    });

    it("filters by type and by layer in both forms", async () => {
      await withProject(async (rootPath) => {
        const added = await modelAddHandler({
          elements: [
            { layer: "business", type: "businessprocess", name: "checkout", description: "Takes an order to payment." },
            { layer: "motivation", type: "goal", name: "fewer abandoned carts", attributes: { priority: "high" } },
          ],
          rootPath,
        });
        expect(added.isError).toBeFalsy();
        expect(parse(added).elements.counts.invalid ?? 0).toBe(0);
        const ids = (data: any): string[] =>
          (data.layers ?? [data]).flatMap((l: any) => l.elements.map((e: any) => e.path ?? e.id)).sort();
        const services = ["business.businessservice.orders", "business.businessservice.payments"];

        for (const detail of [undefined, "compact", "full"] as const) {
          // type alone, across layers
          const byType = parse(await modelListHandler({ type: "businessservice", detail, rootPath }));
          expect(byType.totalElements).toBe(2);
          expect(byType.layers.map((l: any) => l.layer)).toEqual(["business"]);
          expect(ids(byType)).toEqual(services);

          // layer alone
          const byLayer = parse(await modelListHandler({ layer: "business", detail, rootPath }));
          expect(byLayer.count).toBe(3);
          expect(ids(byLayer)).toEqual(["business.businessprocess.checkout", ...services]);

          // layer and type
          const both = parse(await modelListHandler({ layer: "business", type: "businessprocess", detail, rootPath }));
          expect(both.count).toBe(1);
          expect(ids(both)).toEqual(["business.businessprocess.checkout"]);

          // a type the layer has none of
          const none = parse(await modelListHandler({ layer: "motivation", type: "businessservice", detail, rootPath }));
          expect(none.count).toBe(0);
          expect(none.elements).toEqual([]);

          // no filter: every layer that has elements, in layer order
          const all = parse(await modelListHandler({ detail, rootPath }));
          expect(all.totalElements).toBe(4);
          expect(all.layers.map((l: any) => [l.layer, l.count])).toEqual([
            ["motivation", 1],
            ["business", 3],
          ]);
        }
      });
    });

    it("cuts a long description in the compact form and keeps it whole in the full form", async () => {
      await withProject(async (rootPath) => {
        const long =
          "Settles card payments with the acquirer, e.g. nightly batches. It also reconciles refunds, " +
          "chargebacks and partial captures against the ledger, and reports what it could not match.";
        const updated = await modelUpdateHandler({ id: "business.businessservice.payments", description: long, rootPath });
        expect(updated.isError).toBeFalsy();

        const compact = parse(await modelListHandler({ layer: "business", rootPath }));
        const entry = compact.elements.find((e: any) => e.id === "business.businessservice.payments");
        expect(entry.description).toBe("Settles card payments with the acquirer, e.g. nightly batches. …");

        const full = parse(await modelListHandler({ layer: "business", detail: "full", rootPath }));
        expect(full.elements.find((e: any) => e.path === "business.businessservice.payments").description).toBe(long);
      });
    });

    it("lists a model of 100 elements in a fraction of the full form, one line per element", async () => {
      await withProject(async (rootPath) => {
        // Long names, three-sentence descriptions and a source reference each: about what a real model holds.
        const description = (i: number) =>
          `Capability ${i} takes a staged change through review, verification and landing without leaving the changeset it ` +
          `was planned in, so the record of what was decided stays with the change. It reports every refusal with its reason. ` +
          `It never writes to the base model on its own.`;
        const added = await modelAddHandler({
          elements: Array.from({ length: 98 }, (_, i) => ({
            layer: "business",
            type: i % 2 ? "businessservice" : "businessprocess",
            name: `Change review and landing capability number ${i}`,
            description: description(i),
            sourceFile: `cli/src/core/capabilities/capability-${i}.ts`,
            sourceSymbol: `capability${i}`,
          })),
          rootPath,
        });
        expect(added.isError).toBeFalsy();
        expect(parse(added).elements.counts.invalid ?? 0).toBe(0);

        const compact = await modelListHandler({ rootPath });
        const compactText = (compact.content[0] as { text: string }).text;
        const data = parse(compact);
        expect(data.totalElements).toBe(100);

        // The full form is paged LIST_FULL_LIMIT (30) at a time; ask for all 100 on one page to compare sizes.
        const fullText = ((await modelListHandler({ detail: "full", limit: 100, rootPath })).content[0] as { text: string }).text;
        expect(parse({ content: [{ text: fullText }] }).totalElements).toBe(100);
        expect(parse({ content: [{ text: fullText }] }).page).toEqual({ total: 100, returned: 100, offset: 0 });

        // The full form is the size that did not fit. The compact one is under a third of it, and
        // under 350 characters an element with every description at the limit (a real model's are
        // shorter: DR's own 119 elements list in 28 KB, 110 KB in full).
        expect(fullText.length).toBeGreaterThan(90_000);
        expect(compactText.length).toBeLessThan(35_000);
        expect(compactText.length).toBeLessThan(fullText.length / 3);

        // One line per element, whatever its length.
        const elementLines = compactText.split("\n").filter((line) => line.trimStart().startsWith('{"id":'));
        expect(elementLines.length).toBe(100);
        for (const e of data.layers[0].elements) {
          expect(Object.keys(e).filter((k) => !["id", "name", "description"].includes(k))).toEqual([]);
          if (e.description) expect(e.description.length).toBeLessThanOrEqual(LIST_DESCRIPTION_LIMIT);
        }
        // The first sentence is longer than the limit here, so it is cut at a word and marked.
        const cut = data.layers[0].elements.find((e: any) => e.name.endsWith("number 7")).description;
        expect(cut.endsWith("…")).toBe(true);
        expect(description(7).startsWith(cut.slice(0, -1))).toBe(true);
        expect(description(7)[cut.length - 1]).toBe(" ");
      });
    });

    // The compact listing grows with the model, so past LIST_COMPACT_LIMIT the default is counts.
    it("summarizes by layer and type when more elements match than the default lists", async () => {
      await withProject(async (rootPath) => {
        const added = await modelAddHandler({
          elements: Array.from({ length: LIST_COMPACT_LIMIT }, (_, i) => ({
            layer: "business",
            type: i % 3 ? "businessprocess" : "businessfunction",
            name: `Step ${i}`,
            description: `Step ${i} of the order flow. It hands over to the next step.`,
          })),
          rootPath,
        });
        expect(added.isError).toBeFalsy();
        const total = LIST_COMPACT_LIMIT + 2;

        // Unfiltered: two more than the limit, so counts and no elements.
        const result = await modelListHandler({ rootPath });
        const text = (result.content[0] as { text: string }).text;
        const data = parse(result);
        expect(data.detail).toBe("summary");
        expect(data.totalElements).toBe(total);
        expect(data.layers).toEqual([
          { layer: "business", count: total, types: { businessprocess: 100, businessfunction: 50, businessservice: 2 } },
        ]);
        expect(text.length).toBeLessThan(1_000);
        // It says why it is a summary and how to list elements.
        expect(data.more).toContain(`${total} elements match`);
        expect(data.more).toContain("layer or type");
        expect(data.more).toContain('detail: "compact"');

        // The same default when scoped to a layer.
        const scoped = parse(await modelListHandler({ layer: "business", rootPath }));
        expect(scoped).toEqual({ detail: "summary", ...data.layers[0], more: data.more });

        // A filter that brings the listing under the limit lists the elements.
        const narrowed = parse(await modelListHandler({ type: "businessfunction", rootPath }));
        expect(narrowed.detail).toBe("compact");
        expect(narrowed.layers[0].elements.length).toBe(50);

        // Asking for the compact or full form lists the elements whatever the count, a page at a
        // time: the counts are of everything, and the next page is one call away.
        const compact = parse(await modelListHandler({ detail: "compact", rootPath }));
        expect(compact.detail).toBe("compact");
        expect(compact.totalElements).toBe(total);
        expect(compact.layers[0].count).toBe(total);
        expect(compact.layers[0].elements.length).toBe(LIST_COMPACT_LIMIT);
        expect(compact.page).toEqual({ total, returned: LIST_COMPACT_LIMIT, offset: 0, nextOffset: LIST_COMPACT_LIMIT });
        expect(compact.more).toContain(`offset: ${LIST_COMPACT_LIMIT}`);
        const rest = parse(await modelListHandler({ detail: "compact", offset: compact.page.nextOffset, rootPath }));
        expect(rest.layers[0].elements.length).toBe(2);
        expect(rest.page).toEqual({ total, returned: 2, offset: LIST_COMPACT_LIMIT });
        expect(parse(await modelListHandler({ detail: "full", rootPath })).totalElements).toBe(total);
      });
    });

    it('gives counts for a small model with detail: "summary"', async () => {
      await withProject(async (rootPath) => {
        const data = parse(await modelListHandler({ detail: "summary", rootPath }));
        expect(data.detail).toBe("summary");
        expect(data.layers).toEqual([{ layer: "business", count: 2, types: { businessservice: 2 } }]);
        expect(data.more.startsWith("Summary:")).toBe(true);
      });
    });

    it("returns a structured not-found error for an unknown layer", async () => {
      await withProject(async (rootPath) => {
        const result = await modelListHandler({ layer: "not-a-real-layer", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("not_found");
      });
    });
  });

  describe("model_list's short description", () => {
    it("keeps a description of one sentence whole", () => {
      expect(shortDescription("Payments service")).toBe("Payments service");
      expect(shortDescription("Settles card payments.")).toBe("Settles card payments.");
      expect(shortDescription("Is it settled?")).toBe("Is it settled?");
    });

    it("is undefined for a missing or blank description", () => {
      expect(shortDescription(undefined)).toBeUndefined();
      expect(shortDescription("")).toBeUndefined();
      expect(shortDescription("  \n ")).toBeUndefined();
    });

    it("keeps the first sentence and marks what it left out", () => {
      expect(shortDescription("Settles card payments. Reconciles refunds. Reports the rest.")).toBe("Settles card payments. …");
      expect(shortDescription("Done! Then more.")).toBe("Done! …");
    });

    it("does not end the sentence at an abbreviation, a list number, a version or a file name", () => {
      expect(shortDescription("1. Stage the change. 2. Review it.")).toBe("1. Stage the change. …");
      expect(shortDescription("Caches reads, e.g. the catalog. Evicts hourly.")).toBe("Caches reads, e.g. the catalog. …");
      expect(shortDescription("Wraps the store, i.e. Redis 7.2 behind store.ts today. Nothing else.")).toBe(
        "Wraps the store, i.e. Redis 7.2 behind store.ts today. …"
      );
      expect(shortDescription("MCP: changeset_create, changeset_show. CLI: dr changeset create.")).toBe(
        "MCP: changeset_create, changeset_show. …"
      );
    });

    it("stops at the first paragraph and puts it on one line", () => {
      expect(shortDescription("Routes\n  orders to\tfulfilment\n\nSecond paragraph.")).toBe("Routes orders to fulfilment …");
      expect(shortDescription("  One line,\n  folded.  ")).toBe("One line, folded.");
    });

    it("cuts a first sentence longer than the limit at a word boundary, within the limit", () => {
      const sentence = `${"word ".repeat(60).trim()}.`;
      const cut = shortDescription(sentence)!;
      expect(cut.length).toBeLessThanOrEqual(LIST_DESCRIPTION_LIMIT);
      expect(cut.length).toBeGreaterThan(LIST_DESCRIPTION_LIMIT - 6);
      expect(cut).toMatch(/word…$/);

      // A sentence that fits only without the mark for what follows it is cut at a word too.
      const exact = `${"a".repeat(85)} ${"b".repeat(73)}.`;
      expect(exact.length).toBe(LIST_DESCRIPTION_LIMIT);
      expect(shortDescription(exact)).toBe(exact);
      expect(shortDescription(`${exact} More.`)).toBe(`${"a".repeat(85)}…`);

      // Trailing punctuation at the cut goes.
      expect(shortDescription("alpha beta, gamma delta", 12)).toBe("alpha beta…");
    });

    it("cuts text with no word boundary to cut at, at the limit", () => {
      const cut = shortDescription("x".repeat(500))!;
      expect(cut).toBe(`${"x".repeat(LIST_DESCRIPTION_LIMIT - 1)}…`);
      // An early space alone is not worth cutting at.
      expect(shortDescription(`ab ${"x".repeat(500)}`)!.length).toBe(LIST_DESCRIPTION_LIMIT);
    });
  });

  describe("model_show", () => {
    it("returns an element with its relationships", async () => {
      await withProject(async (rootPath) => {
        const result = await modelShowHandler({ id: "business.businessservice.payments", rootPath });
        const data = parse(result);
        expect(data.element.name).toBe("payments");
        expect(data.relationships).toEqual({ outgoing: [], incoming: [] });
      });
    });

    it("returns a structured not-found error for a missing element", async () => {
      await withProject(async (rootPath) => {
        const result = await modelShowHandler({ id: "business.businessservice.missing", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.error).toContain("not found");
        expect(data.category).toBe("not_found");
      });
    });
  });

  describe("model_search", () => {
    it("matches elements by name substring", async () => {
      await withProject(async (rootPath) => {
        const result = await modelSearchHandler({ query: "pay", rootPath });
        const data = parse(result);
        expect(data.results.map((r: any) => r.id)).toEqual(["business.businessservice.payments"]);
      });
    });

    it("returns an empty result set for a non-matching query", async () => {
      await withProject(async (rootPath) => {
        const result = await modelSearchHandler({ query: "does-not-exist", rootPath });
        const data = parse(result);
        expect(data.count).toBe(0);
      });
    });

    it("returns a structured error for an unknown layer filter", async () => {
      await withProject(async (rootPath) => {
        const result = await modelSearchHandler({ layer: "not-a-real-layer", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("user");
      });
    });

    it("returns a structured error for an unknown type filter", async () => {
      await withProject(async (rootPath) => {
        const result = await modelSearchHandler({ type: "not-a-real-type", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("user");
      });
    });
  });

  describe("model_stats", () => {
    it("reports element counts", async () => {
      await withProject(async (rootPath) => {
        const result = await modelStatsHandler({ rootPath });
        const data = parse(result);
        expect(data.statistics.totalElements).toBe(2);
      });
    });
  });

  describe("model_info", () => {
    it("summarizes a single layer's element types", async () => {
      await withProject(async (rootPath) => {
        const result = await modelInfoHandler({ layer: "business", rootPath });
        const data = parse(result);
        expect(data.layer.elementCount).toBe(2);
        expect(data.layer.elementsByType.businessservice).toBe(2);
      });
    });

    it("returns a structured not-found error for an unknown layer", async () => {
      await withProject(async (rootPath) => {
        const result = await modelInfoHandler({ layer: "not-a-real-layer", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("not_found");
      });
    });
  });

  describe("model_trace", () => {
    it("reports empty dependents/dependencies for an isolated element", async () => {
      await withProject(async (rootPath) => {
        const result = await modelTraceHandler({ id: "business.businessservice.payments", rootPath });
        const data = parse(result);
        expect(data.dependents).toEqual({ direct: [], transitive: [] });
        expect(data.dependencies).toEqual({ direct: [], transitive: [] });
      });
    });

    it("returns a structured not-found error for a missing element", async () => {
      await withProject(async (rootPath) => {
        const result = await modelTraceHandler({ id: "business.businessservice.missing", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("not_found");
      });
    });
  });

  describe("model_validate", () => {
    it("passes with no errors for well-formed elements", async () => {
      await withProject(async (rootPath) => {
        const result = await modelValidateHandler({ rootPath });
        const data = parse(result);
        expect(data.summary.errorCount).toBe(0);
        expect(data.valid).toBe(true);
      });
    });

    it("says in one line when the model's spec version is behind the one it validates against (#1168)", async () => {
      await withProject(async (rootPath) => {
        const model = await loadModel(rootPath);
        model.manifest.specVersion = getCliBundledSpecVersion();
        expect(parse(await modelValidateHandler({ rootPath })).specVersion).toBeUndefined();

        model.manifest.specVersion = "0.12.0";
        const data = parse(await modelValidateHandler({ rootPath }));
        expect(data.specVersion).toContain("spec v0.12.0");
        expect(data.specVersion).toContain("project_upgrade");
        expect(data.specVersion).not.toMatch(/\bdr (upgrade|validate)\b/);
      });
    });

    it("reports orphaned elements in orphans mode", async () => {
      await withProject(async (rootPath) => {
        const result = await modelValidateHandler({ orphans: true, rootPath });
        const data = parse(result);
        expect(data.orphanCount).toBe(2);
      });
    });

    it("doesn't report a relationship to another layer as a missing element when scoped by layers (round 2, bug 1)", async () => {
      await withProject(async (rootPath) => {
        const added = await modelAddHandler({
          layer: "application",
          type: "applicationservice",
          name: "payment-api",
          attributes: { serviceType: "synchronous" },
          rootPath,
        });
        expect(added.isError).toBeFalsy();
        const linked = await relationshipAddHandler({
          source: "application.applicationservice.payment-api",
          predicate: "realizes",
          target: "business.businessservice.payments",
          rootPath,
        });
        expect(linked.isError).toBeFalsy();

        // Both ends in scope, one end in scope, the other end in scope: none is an error,
        // as with `dr validate --layers`.
        for (const layers of [["application", "business"], ["application"], ["business"]]) {
          const data = parse(await modelValidateHandler({ layers, rootPath }));
          const notFound = data.errors.filter((e: any) => /not found/.test(e.message));
          expect({ layers, notFound }).toEqual({ layers, notFound: [] });
          expect(data.summary.errorCount).toBe(0);
          expect(data.summary.layersValidated).toBe(layers.length);
        }
      });
    });

    it("still reports a relationship whose in-scope end is missing when scoped by layers", async () => {
      await withProject(async (rootPath) => {
        const model = await loadModel(rootPath);
        model.relationships.add({
          source: "business.businessservice.ghost",
          predicate: "serves",
          target: "business.businessservice.payments",
          layer: "business",
        } as any);
        const data = parse(await modelValidateHandler({ layers: ["business"], rootPath }));
        expect(data.errors.some((e: any) => e.message.includes("'business.businessservice.ghost' not found"))).toBe(true);
      });
    });

    it("still reports an end outside the layers that exists nowhere in the model (review)", async () => {
      await withProject(async (rootPath) => {
        const model = await loadModel(rootPath);
        model.relationships.add({
          source: "application.applicationservice.ghost",
          predicate: "realizes",
          target: "business.businessservice.payments",
          layer: "application",
        } as any);
        const payments = model.getElementById("business.businessservice.payments")!;
        payments.references = [...(payments.references ?? []), { target: "motivation.goal.ghost-goal", type: "realizes" } as any];
        model.layers.get("business")!.updateElement(payments);

        const data = parse(await modelValidateHandler({ layers: ["business"], rootPath }));
        const messages = data.errors.map((e: any) => e.message);
        expect(messages.some((m: string) => m.includes("source element 'application.applicationservice.ghost' not found"))).toBe(true);
        expect(messages.some((m: string) => m.includes("target 'motivation.goal.ghost-goal' does not exist"))).toBe(true);
        expect(data.valid).toBe(false);
      });
    });

    it("reports an end with an unknown layer prefix once, not again from the scope check (review)", async () => {
      await withProject(async (rootPath) => {
        const model = await loadModel(rootPath);
        model.relationships.add({
          source: "business.businessservice.payments",
          predicate: "serves",
          target: "foo",
          layer: "business",
        } as any);
        model.relationships.add({
          source: "foo.x.z",
          predicate: "serves",
          target: "business.businessservice.orders",
          layer: "business",
        } as any);
        const payments = model.getElementById("business.businessservice.payments")!;
        payments.references = [
          ...(payments.references ?? []),
          { target: "foo.x.w", type: "realizes" } as any,
          { target: "business-foo", type: "realizes" } as any,
        ];
        model.layers.get("business")!.updateElement(payments);

        const data = parse(await modelValidateHandler({ layers: ["business"], rootPath }));
        for (const id of ["foo", "foo.x.z", "foo.x.w", "business-foo"]) {
          const mentions = data.errors.filter((e: any) => e.message.includes(`'${id}'`));
          expect({ id, count: mentions.length, messages: mentions.map((e: any) => e.message) }).toMatchObject({ id, count: 1 });
        }
      });
    });

    it("returns a structured error instead of a false valid:true for an unknown layer", async () => {
      await withProject(async (rootPath) => {
        const result = await modelValidateHandler({ layers: ["aplication"], rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("user");
      });
    });
  });

  describe("model_export", () => {
    it("exports markdown content via the shared export handlers", async () => {
      await withProject(async (rootPath) => {
        const result = await modelExportHandler({ format: "markdown", rootPath });
        const data = parse(result);
        expect(typeof data.content).toBe("string");
        expect(data.content.length).toBeGreaterThan(0);
      });
    });

    it("returns a structured error for an unknown format", async () => {
      await withProject(async (rootPath) => {
        const result = await modelExportHandler({ format: "not-a-format", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("user");
      });
    });
  });

  describe("model_add", () => {
    it("adds a new element through MutationHandler", async () => {
      await withProject(async (rootPath) => {
        const result = await modelAddHandler({
          layer: "business",
          type: "businessservice",
          name: "invoicing",
          rootPath,
        });
        const data = parse(result);
        expect(data.status).toBe("added");
        expect(data.id).toBe("business.businessservice.invoicing");

        const model = await loadModel(rootPath);
        const layer = await model.getLayer("business");
        expect(layer?.getElement("business.businessservice.invoicing")).toBeDefined();
      });
    });

    it("returns a structured error for an unknown layer", async () => {
      await withProject(async (rootPath) => {
        const result = await modelAddHandler({ layer: "not-a-real-layer", type: "x", name: "x", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("user");
      });
    });

    it("returns a structured error for an unknown element type", async () => {
      await withProject(async (rootPath) => {
        const result = await modelAddHandler({ layer: "business", type: "not-a-real-type", name: "x", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.error).toContain("Invalid element type");
      });
    });

    it("returns a structured schema-validation error for invalid attributes", async () => {
      await withProject(async (rootPath) => {
        const result = await modelAddHandler({
          layer: "api",
          type: "operation",
          name: "broken-operation",
          attributes: {},
          rootPath,
        });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.error).toContain("invalid attributes");
      });
    });

    it("does not leave a phantom empty layer in the cached model after a validation failure", async () => {
      // Standalone (not withProject) so the "motivation" layer directory is
      // removed before the model for this rootPath is ever loaded/cached —
      // this makes `model.getLayer("motivation")` return undefined, forcing
      // model-add down the new-Layer path whose validation-failure cleanup
      // this test covers. Uses a layer/type pair ("motivation.assessment")
      // not exercised by any other test in this file, since `SchemaValidator`
      // shares a static compiled-schema registry across instances that isn't
      // safe under concurrent validation of the same type.
      const rootPath = join(
        tmpdir(),
        `dr-mcp-tools-unit-phantom-layer-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      await mkdir(rootPath, { recursive: true });
      await Model.init(rootPath, { name: "Phantom Layer Test Model", version: "0.1.0" });
      await rm(join(rootPath, "documentation-robotics", "model", "01_motivation"), {
        recursive: true,
        force: true,
      });

      try {
        const result = await modelAddHandler({
          layer: "motivation",
          type: "assessment",
          name: "broken-assessment",
          attributes: {},
          rootPath,
        });
        expect(result.isError).toBe(true);

        const model = await loadModel(rootPath);
        expect(model.getLayerNames()).not.toContain("motivation");
      } finally {
        await rm(rootPath, { recursive: true, force: true });
      }
    });

    it("returns a structured error when the element already exists", async () => {
      await withProject(async (rootPath) => {
        const result = await modelAddHandler({
          layer: "business",
          type: "businessservice",
          name: "payments",
          rootPath,
        });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.error).toContain("already exists");
      });
    });
  });

  describe("model_update", () => {
    it("updates an element's description through MutationHandler", async () => {
      await withProject(async (rootPath) => {
        const result = await modelUpdateHandler({
          id: "business.businessservice.payments",
          description: "Updated description",
          rootPath,
        });
        const data = parse(result);
        expect(data.status).toBe("updated");

        const model = await loadModel(rootPath);
        const layer = await model.getLayer("business");
        expect(layer?.getElement("business.businessservice.payments")?.description).toBe(
          "Updated description"
        );
      });
    });

    it("is a no-op when no fields are given", async () => {
      await withProject(async (rootPath) => {
        const result = await modelUpdateHandler({ id: "business.businessservice.payments", rootPath });
        const data = parse(result);
        expect(data.status).toBe("no-op");
      });
    });

    it("returns a structured not-found error for a missing element", async () => {
      await withProject(async (rootPath) => {
        const result = await modelUpdateHandler({
          id: "business.businessservice.missing",
          description: "x",
          rootPath,
        });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("not_found");
      });
    });

    it("returns a structured error for an invalid new type", async () => {
      await withProject(async (rootPath) => {
        const result = await modelUpdateHandler({
          id: "business.businessservice.payments",
          type: "not-a-real-type",
          rootPath,
        });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.error).toContain("Invalid element type");
      });
    });

    it("writes a source reference for file-optional provenance without a sourceFile", async () => {
      await withProject(async (rootPath) => {
        const result = await modelUpdateHandler({
          id: "business.businessservice.payments",
          sourceProvenance: "generated",
          rootPath,
        });
        const data = parse(result);
        expect(data.status).toBe("updated");

        const model = await loadModel(rootPath);
        const layer = await model.getLayer("business");
        expect(layer?.getElement("business.businessservice.payments")?.source_reference?.provenance).toBe(
          "generated"
        );
      });
    });
  });

  describe("model_delete", () => {
    it("deletes an element through MutationHandler", async () => {
      await withProject(async (rootPath) => {
        const result = await modelDeleteHandler({ id: "business.businessservice.orders", rootPath });
        const data = parse(result);
        expect(data.status).toBe("deleted");

        const model = await loadModel(rootPath);
        const layer = await model.getLayer("business");
        expect(layer?.getElement("business.businessservice.orders")).toBeUndefined();
      });
    });

    it("returns a structured not-found error for a missing element", async () => {
      await withProject(async (rootPath) => {
        const result = await modelDeleteHandler({ id: "business.businessservice.missing", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("not_found");
      });
    });

    // model_delete's dependency guard walks cross-layer `references` (matching
    // `dr delete`'s existing DependencyTracker usage), not relationships.yaml.
    async function addCrossLayerReference(rootPath: string): Promise<void> {
      const model = await loadModel(rootPath);
      const layer = await model.getLayer("business");
      const orders = layer!.getElement("business.businessservice.orders")!;
      orders.references = [
        { source: orders.path || orders.id, target: "business.businessservice.payments", type: "uses" },
      ];
      layer!.updateElement(orders);
      await model.saveLayer("business");
    }

    it("refuses to delete an element with dependents unless cascade or force is set", async () => {
      await withProject(async (rootPath) => {
        await addCrossLayerReference(rootPath);

        const result = await modelDeleteHandler({ id: "business.businessservice.payments", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.error).toContain("dependencies");
      });
    });

    it("cascades to dependents when cascade is set", async () => {
      await withProject(async (rootPath) => {
        await addCrossLayerReference(rootPath);

        const result = await modelDeleteHandler({
          id: "business.businessservice.payments",
          cascade: true,
          rootPath,
        });
        const data = parse(result);
        expect(data.status).toBe("deleted");
        expect(data.cascadedDeletes).toBe(1);
      });
    });

    it("reports partial progress without deleting the target when a mid-cascade delete fails", async () => {
      await withProject(async (rootPath) => {
        await modelAddHandler({
          layer: "business",
          type: "businessprocess",
          name: "invoice-processing",
          description: "Invoice processing",
          rootPath,
        });
        await modelAddHandler({
          layer: "application",
          type: "applicationfunction",
          name: "billing-app",
          description: "Billing application function",
          rootPath,
        });

        let model = await loadModel(rootPath);
        const bizLayer = (await model.getLayer("business"))!;
        const invoiceProcessing = bizLayer.getElement("business.businessprocess.invoice-processing")!;
        invoiceProcessing.references = [
          {
            source: invoiceProcessing.path || invoiceProcessing.id,
            target: "business.businessservice.payments",
            type: "uses",
          },
        ];
        bizLayer.updateElement(invoiceProcessing);
        await model.saveLayer("business");

        const appLayer = (await model.getLayer("application"))!;
        const billingApp = appLayer.getElement("application.applicationfunction.billing-app")!;
        billingApp.references = [
          {
            source: billingApp.path || billingApp.id,
            target: "business.businessservice.payments",
            type: "uses",
          },
        ];
        appLayer.updateElement(billingApp);
        await model.saveLayer("application");

        // Cascade processes dependents in reverse of `dependents` order (application-layer
        // before business-layer here), so failing the business layer's save makes the
        // *second* dependent's delete fail with an I/O error, after the first has already
        // been removed — simulating a mid-cascade failure. (The save fails rather than the
        // file being broken on disk: the cache rereads a model whose files changed.)
        const saveLayer = Model.prototype.saveLayer;
        const saveSpy = spyOn(Model.prototype, "saveLayer").mockImplementation(async function (this: Model, name: string) {
          if (name === "business") throw new Error("EIO: i/o error, write business_process.yaml");
          return saveLayer.call(this, name);
        });
        let result: Awaited<ReturnType<typeof modelDeleteHandler>>;
        try {
          result = await modelDeleteHandler({
            id: "business.businessservice.payments",
            cascade: true,
            rootPath,
          });
        } finally {
          saveSpy.mockRestore();
        }

        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("system");
        expect(data.error).toContain("invoice-processing");
        expect(data.partialProgress).toEqual({ completed: 1, total: 2 });
        expect(data.relatedElements).toEqual(["application.applicationfunction.billing-app"]);

        // The target must not have been deleted, and the failure must be recoverable:
        // the successfully-cascaded dependent is gone, but the target survives for a retry.
        model = await loadModel(rootPath);
        const bizLayerAfter = (await model.getLayer("business"))!;
        expect(bizLayerAfter.getElement("business.businessservice.payments")).toBeDefined();

        const appLayerAfter = (await model.getLayer("application"))!;
        expect(
          appLayerAfter.getElement("application.applicationfunction.billing-app")
        ).toBeUndefined();
      });
    });

    it("previews deletions without mutating the model when dryRun is set", async () => {
      await withProject(async (rootPath) => {
        const result = await modelDeleteHandler({
          id: "business.businessservice.payments",
          dryRun: true,
          rootPath,
        });
        const data = parse(result);
        expect(data.status).toBe("dry-run");

        const model = await loadModel(rootPath);
        const layer = await model.getLayer("business");
        expect(layer?.getElement("business.businessservice.payments")).toBeDefined();
      });
    });
  });

  describe("model_reload", () => {
    it("reports a summary reflecting the current on-disk state", async () => {
      await withProject(async (rootPath) => {
        const result = await modelReloadHandler({ rootPath });
        const data = parse(result);
        expect(data.status).toBe("reloaded");
        expect(data.totalElements).toBe(2);
        expect(data.layers.find((l: any) => l.name === "business")?.elementCount).toBe(2);
      });
    });

    it("reflects changes made on disk since the last tool call", async () => {
      await withProject(async (rootPath) => {
        await modelAddHandler({
          layer: "business",
          type: "businessservice",
          name: "invoicing",
          rootPath,
        });

        const result = await modelReloadHandler({ rootPath });
        const data = parse(result);
        expect(data.totalElements).toBe(3);
      });
    });

    it("returns a structured error when no model exists at rootPath", async () => {
      const rootPath = join(
        tmpdir(),
        `dr-mcp-tools-unit-no-model-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      await mkdir(rootPath, { recursive: true });
      try {
        const result = await modelReloadHandler({ rootPath });
        expect(result.isError).toBe(true);
      } finally {
        await rm(rootPath, { recursive: true, force: true });
      }
    });
  });
});
