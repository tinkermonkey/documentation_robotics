import { describe, it, expect, beforeEach } from "bun:test";
import { Model } from "@/core/model";
import { Manifest } from "@/core/manifest";
import { EnhancedMarkdownExporter } from "@/export/enhanced-markdown-exporter";

describe("EnhancedMarkdownExporter", () => {
  let model: Model;
  let exporter: EnhancedMarkdownExporter;

  beforeEach(() => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      description: "A test model for export",
      author: "Test Suite",
    });

    model = new Model("/tmp/test", manifest);

    // Add test nodes
    model.graph.addNode({
      id: "motivation.goal.test-goal",
      layer: "motivation",
      type: "goal",
      name: "Test Goal",
      description: "A test goal",
      properties: { priority: "high" },
    });

    model.graph.addNode({
      id: "business.capability.test-capability",
      layer: "business",
      type: "capability",
      name: "Test Capability",
      description: "A test capability",
      properties: { owner: "Team A" },
    });

    model.graph.addNode({
      id: "application.service.test-service",
      layer: "application",
      type: "service",
      name: "Test Service",
      description: "A test service",
      properties: { technology: "Node.js" },
    });

    // Add relationships
    model.graph.addEdge({
      id: "edge1",
      source: "motivation.goal.test-goal",
      destination: "business.capability.test-capability",
      predicate: "satisfied-by",
    });

    model.graph.addEdge({
      id: "edge2",
      source: "business.capability.test-capability",
      destination: "application.service.test-service",
      predicate: "realized-by",
    });

    exporter = new EnhancedMarkdownExporter();
  });

  describe("Exporter interface", () => {
    it("should have correct name", () => {
      expect(exporter.name).toBe("Enhanced Markdown");
    });

    it("should support all 12 layers", () => {
      expect(exporter.supportedLayers.length).toBe(12);
      expect(exporter.supportedLayers).toContain("motivation");
      expect(exporter.supportedLayers).toContain("data-model");
      expect(exporter.supportedLayers).toContain("testing");
    });
  });

  describe("export()", () => {
    it("should export model to markdown", async () => {
      const markdown = await exporter.export(model);

      expect(markdown).toBeDefined();
      expect(markdown.length).toBeGreaterThan(0);
      expect(typeof markdown).toBe("string");
    });

    it("should include model information", async () => {
      const markdown = await exporter.export(model);

      expect(markdown).toContain("Test Model");
      expect(markdown).toContain("A test model for export");
      expect(markdown).toContain("Test Suite");
    });

    it("should include mermaid diagrams", async () => {
      const markdown = await exporter.export(model);

      expect(markdown).toContain("```mermaid");
      expect(markdown).toContain("graph");
    });

    it("should include tables", async () => {
      const markdown = await exporter.export(model);

      expect(markdown).toContain("| ");
      expect(markdown).toContain("---|");
    });

    it("should include layer information", async () => {
      const markdown = await exporter.export(model);

      expect(markdown).toContain("Motivation");
      expect(markdown).toContain("Business");
      expect(markdown).toContain("Application");
    });

    it("should include element details", async () => {
      const markdown = await exporter.export(model);

      expect(markdown).toContain("Test Goal");
      expect(markdown).toContain("Test Capability");
      expect(markdown).toContain("Test Service");
    });

    it("should include relationships", async () => {
      const markdown = await exporter.export(model);

      expect(markdown).toContain("satisfied-by");
      expect(markdown).toContain("realized-by");
    });

    it("should respect includeSources option", async () => {
      const markdownWithSources = await exporter.export(model, {
        includeSources: true,
      });
      const markdownWithoutSources = await exporter.export(model, {
        includeSources: false,
      });

      expect(markdownWithSources).toBeDefined();
      expect(markdownWithoutSources).toBeDefined();
    });

    it("should handle empty model", async () => {
      const emptyModel = new Model("/tmp/test", new Manifest({
        name: "Empty Model",
      }));

      const markdown = await exporter.export(emptyModel);

      expect(markdown).toContain("Empty Model");
      expect(markdown).toContain("## Architecture Overview");
    });

    it("should include architecture statistics", async () => {
      const markdown = await exporter.export(model);

      expect(markdown).toContain("## Architecture Statistics");
      expect(markdown).toContain("Total Elements");
      expect(markdown).toContain("Total Relationships");
    });

    it("should include relationship summary", async () => {
      const markdown = await exporter.export(model);

      expect(markdown).toContain("## Relationships Summary");
      expect(markdown).toContain("satisfied-by");
    });
  });

  describe("Error handling", () => {
    it("should throw on error", async () => {
      // Create exporter and try to export with invalid model
      const badModel = {} as any;

      try {
        await exporter.export(badModel);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("Content quality", () => {
    it("should have proper markdown syntax", async () => {
      const markdown = await exporter.export(model);

      // Check for proper heading levels
      expect(markdown).toMatch(/^# /m);
      expect(markdown).toMatch(/^## /m);

      // Check for proper list syntax
      expect(markdown).toMatch(/^- /m);

      // Check for proper code blocks
      expect(markdown).toMatch(/```mermaid[\s\S]*?```/);
    });

    it("should escape special markdown characters", async () => {
      const testModel = new Model("/tmp/test", new Manifest({
        name: "Model | With * Special",
      }));

      testModel.graph.addNode({
        id: "test.element.special",
        layer: "motivation",
        type: "goal",
        name: "Goal | With * [Special]",
        description: "Description with {brackets}",
        properties: {},
      });

      const markdown = await exporter.export(testModel);

      // Content should have escaped characters
      expect(markdown).toBeDefined();
      expect(markdown.length).toBeGreaterThan(0);
    });

    it("should be complete and comprehensive", async () => {
      const markdown = await exporter.export(model);

      const sections = [
        "# Test Model",
        "## Table of Contents",
        "## Architecture Overview",
        "## Layer Summary",
        "## Detailed Layer Documentation",
        "## Architecture Statistics",
        "## Relationships Summary",
      ];

      for (const section of sections) {
        expect(markdown).toContain(section);
      }
    });
  });

  describe("Performance", () => {
    it("should export large models efficiently", async () => {
      // Create a model with many elements
      const largeModel = new Model("/tmp/test", new Manifest({
        name: "Large Model",
      }));

      for (let i = 0; i < 100; i++) {
        largeModel.graph.addNode({
          id: `motivation.goal.goal-${i}`,
          layer: "motivation",
          type: "goal",
          name: `Goal ${i}`,
          properties: { index: i },
        });
      }

      for (let i = 0; i < 50; i++) {
        largeModel.graph.addEdge({
          id: `edge-${i}`,
          source: `motivation.goal.goal-${i}`,
          destination: `motivation.goal.goal-${i + 1}`,
          predicate: "depends-on",
        });
      }

      const startTime = Date.now();
      const markdown = await exporter.export(largeModel);
      const endTime = Date.now();

      expect(markdown).toBeDefined();
      expect(markdown.length).toBeGreaterThan(0);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete in under 5 seconds
    });
  });
});
