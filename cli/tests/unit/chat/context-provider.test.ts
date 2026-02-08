/**
 * Tests for ModelContextProvider
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Model } from "../../../src/core/model";
import { Manifest } from "../../../src/core/manifest";
import { ModelContextProvider } from "../../../src/coding-agents/context-provider";
import { Layer } from "../../../src/core/layer";
import { Element } from "../../../src/core/element";

describe("ModelContextProvider", () => {
  let model: Model;
  let provider: ModelContextProvider;

  beforeEach(() => {
    // Create a test model with some layers and elements
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      description: "A test model",
      author: "Test Author",
    });
    model = new Model("/tmp/test", manifest);

    // Add a test layer with elements
    const layer = new Layer("motivation");
    layer.addElement(
      new Element({
        id: "motivation-goal-test-goal",
        type: "goal",
        name: "Test Goal",
        description: "A test goal",
      })
    );
    layer.addElement(
      new Element({
        id: "motivation-requirement-test-req",
        type: "requirement",
        name: "Test Requirement",
        description: "A test requirement",
      })
    );
    model.addLayer(layer);

    // Create context provider
    provider = new ModelContextProvider(model);
  });

  describe("generateContext", () => {
    it("should generate context with model information", async () => {
      const context = await provider.generateContext();

      expect(context).toContain("Current Architecture Model");
      expect(context).toContain("Test Model");
      expect(context).toContain("1.0.0");
      expect(context).toContain("A test model");
    });

    it("should include layer information", async () => {
      const context = await provider.generateContext();

      expect(context).toContain("Layers Overview");
      expect(context).toContain("motivation");
    });

    it("should include element summaries", async () => {
      const context = await provider.generateContext();

      expect(context).toContain("Element Summary");
      expect(context).toContain("Test Goal");
      expect(context).toContain("Test Requirement");
    });
  });

  describe("getAvailableLayers", () => {
    it("should return list of available layers", () => {
      const layers = provider.getAvailableLayers();

      expect(layers).toContain("motivation");
      expect(layers).toContain("business");
      expect(layers).toContain("api");
      expect(layers.length).toBe(12);
    });
  });

  describe("getLayerElementCount", () => {
    it("should return element count for a layer", async () => {
      const count = await provider.getLayerElementCount("motivation");
      expect(count).toBe(2);
    });

    it("should return 0 for unloaded layer", async () => {
      const count = await provider.getLayerElementCount("business");
      expect(count).toBe(0);
    });
  });

  describe("getTotalElementCount", () => {
    it("should return total element count", async () => {
      const count = await provider.getTotalElementCount();
      expect(count).toBe(2);
    });
  });
});
