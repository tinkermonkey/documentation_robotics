/**
 * Unit tests for the MCP model tool handlers — success and error paths for
 * each of the model_* tools registered by McpToolRegistry.
 *
 * Each test creates its own project directory via withProject() rather than
 * beforeEach/afterEach, since the `test`/`test:unit` scripts run this file
 * under `bun test --concurrent` (every `it` runs concurrently) — a shared
 * describe-scoped `let rootPath` would race across tests.
 */

import { describe, it, expect } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { loadModel } from "../../../src/mcp/tools/shared.js";
import { modelListHandler } from "../../../src/mcp/tools/model-list.js";
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
        expect(data.elements.map((e: any) => e.path).sort()).toEqual([
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

    it("returns a structured not-found error for an unknown layer", async () => {
      await withProject(async (rootPath) => {
        const result = await modelListHandler({ layer: "not-a-real-layer", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("not_found");
      });
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

    it("reports orphaned elements in orphans mode", async () => {
      await withProject(async (rootPath) => {
        const result = await modelValidateHandler({ orphans: true, rootPath });
        const data = parse(result);
        expect(data.orphanCount).toBe(2);
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
