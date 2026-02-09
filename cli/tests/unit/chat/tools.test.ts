/**
 * Tests for Model Tools
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Model } from "../../../src/core/model";
import { Manifest } from "../../../src/core/manifest";
import { Layer } from "../../../src/core/layer";
import { Element } from "../../../src/core/element";
import { getModelTools, executeModelTool } from "../../../src/coding-agents/tools";

describe("Model Tools", () => {
  let model: Model;

  beforeEach(() => {
    // Create a test model with multiple layers
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      description: "A test model",
    });
    model = new Model("/tmp/test", manifest);

    // Create motivation layer
    const motivationLayer = new Layer("motivation");
    motivationLayer.addElement(
      new Element({
        id: "motivation-goal-increase-sales",
        type: "goal",
        name: "Increase Sales",
        description: "Increase revenue",
      })
    );
    motivationLayer.addElement(
      new Element({
        id: "motivation-requirement-api-spec",
        type: "requirement",
        name: "API Specification",
        description: "Define API",
      })
    );
    model.addLayer(motivationLayer);

    // Create API layer
    const apiLayer = new Layer("api");
    apiLayer.addElement(
      new Element({
        id: "api-endpoint-create-order",
        type: "endpoint",
        name: "Create Order",
        description: "POST endpoint for creating orders",
      })
    );
    apiLayer.addElement(
      new Element({
        id: "api-endpoint-get-order",
        type: "endpoint",
        name: "Get Order",
        description: "GET endpoint for retrieving orders",
      })
    );
    model.addLayer(apiLayer);
  });

  describe("getModelTools", () => {
    it("should return array of tool definitions", () => {
      const tools = getModelTools();

      expect(tools).toBeArray();
      expect(tools.length).toBe(4);
    });

    it("should include dr_list tool", () => {
      const tools = getModelTools();
      const drListTool = tools.find((t) => t.name === "dr_list");

      expect(drListTool).toBeDefined();
      expect(drListTool.description).toContain("List elements");
    });

    it("should include dr_find tool", () => {
      const tools = getModelTools();
      const drFindTool = tools.find((t) => t.name === "dr_find");

      expect(drFindTool).toBeDefined();
      expect(drFindTool.description).toContain("Find");
    });

    it("should include dr_search tool", () => {
      const tools = getModelTools();
      const drSearchTool = tools.find((t) => t.name === "dr_search");

      expect(drSearchTool).toBeDefined();
      expect(drSearchTool.description).toContain("Search");
    });

    it("should include dr_trace tool", () => {
      const tools = getModelTools();
      const drTraceTool = tools.find((t) => t.name === "dr_trace");

      expect(drTraceTool).toBeDefined();
      expect(drTraceTool.description).toContain("Trace dependencies");
    });

    it("tools should have proper input schemas", () => {
      const tools = getModelTools();

      for (const tool of tools) {
        expect(tool.input_schema).toBeDefined();
        expect(tool.input_schema.type).toBe("object");
        expect(tool.input_schema.properties).toBeDefined();
        expect(tool.input_schema.required).toBeArray();
      }
    });
  });

  describe("executeModelTool", () => {
    it("should execute dr_list tool", async () => {
      const result = await executeModelTool("dr_list", { layer: "motivation" }, model);

      expect(result).toBeDefined();
      expect(result.layer).toBe("motivation");
      expect(result.elementCount).toBe(2);
      expect(result.elements).toBeArray();
      expect(result.elements.length).toBe(2);
    });

    it("should filter elements by type in dr_list", async () => {
      const result = await executeModelTool(
        "dr_list",
        { layer: "motivation", type: "goal" },
        model
      );

      expect(result.elements).toBeArray();
      expect(result.elements.length).toBe(1);
      expect(result.elements[0].id).toBe("motivation-goal-increase-sales");
    });

    it("should return error for non-existent layer", async () => {
      const result = await executeModelTool("dr_list", { layer: "nonexistent" }, model);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("not found");
    });

    it("should execute dr_find tool", async () => {
      const result = await executeModelTool(
        "dr_find",
        { id: "motivation-goal-increase-sales" },
        model
      );

      expect(result.found).toBe(true);
      expect(result.element).toBeDefined();
      expect(result.element.id).toBe("motivation-goal-increase-sales");
      expect(result.element.name).toBe("Increase Sales");
      expect(result.element.layer).toBe("motivation");
    });

    it("should return not found for non-existent element", async () => {
      const result = await executeModelTool("dr_find", { id: "nonexistent-element" }, model);

      expect(result.found).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should execute dr_search tool", async () => {
      const result = await executeModelTool("dr_search", { query: "order" }, model);

      expect(result.query).toBe("order");
      expect(result.resultCount).toBeGreaterThanOrEqual(2);
      expect(result.results).toBeArray();
    });

    it("should search in specific layers", async () => {
      const result = await executeModelTool(
        "dr_search",
        { query: "order", layers: ["api"] },
        model
      );

      expect(result.resultCount).toBe(2);
      for (const item of result.results) {
        expect(item.layer).toBe("api");
      }
    });

    it("should execute dr_trace tool", async () => {
      const result = await executeModelTool(
        "dr_trace",
        { id: "motivation-goal-increase-sales" },
        model
      );

      expect(result.id).toBe("motivation-goal-increase-sales");
      expect(result.direction).toBe("both");
    });

    it("should return error for unknown tool", async () => {
      const result = await executeModelTool("unknown_tool", {}, model);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Unknown tool");
    });
  });
});
