import { describe, it, expect, beforeEach } from "bun:test";
import { Model } from "@/core/model";
import { Manifest } from "@/core/manifest";
import { MarkdownGenerator } from "@/export/markdown-generator";
import type { GraphNode } from "@/core/graph-model";

describe("MarkdownGenerator", () => {
  let model: Model;
  let generator: MarkdownGenerator;

  beforeEach(() => {
    const manifest = new Manifest({
      name: "Test Architecture Model",
      version: "1.0.0",
      description: "A test model for markdown generation",
      author: "Test Suite",
    });

    model = new Model("/tmp/test", manifest);

    // Add test nodes
    const nodes: GraphNode[] = [
      {
        id: "motivation.goal.improve-quality",
        layer: "motivation",
        type: "goal",
        name: "Improve Quality",
        description: "Improve overall product quality",
        properties: { priority: "high" },
      },
      {
        id: "business.capability.quality-management",
        layer: "business",
        type: "capability",
        name: "Quality Management",
        description: "Manage quality processes",
        properties: { owner: "QA Team" },
      },
      {
        id: "application.service.quality-service",
        layer: "application",
        type: "service",
        name: "Quality Service",
        description: "Service for quality management",
        properties: { technology: "Node.js" },
      },
      {
        id: "api.endpoint.quality-report",
        layer: "api",
        type: "endpoint",
        name: "Quality Report",
        description: "Generate quality reports",
        properties: { method: "GET", path: "/reports/quality" },
      },
      {
        id: "data-model.schema.quality-data",
        layer: "data-model",
        type: "schema",
        name: "Quality Data",
        description: "Quality metrics schema",
        properties: { format: "JSON" },
      },
    ];

    for (const node of nodes) {
      model.graph.addNode(node);
    }

    // Add edges (relationships)
    model.graph.addEdge({
      id: "edge1",
      source: "motivation.goal.improve-quality",
      destination: "business.capability.quality-management",
      predicate: "satisfied-by",
    });

    model.graph.addEdge({
      id: "edge2",
      source: "business.capability.quality-management",
      destination: "application.service.quality-service",
      predicate: "realized-by",
    });

    model.graph.addEdge({
      id: "edge3",
      source: "application.service.quality-service",
      destination: "api.endpoint.quality-report",
      predicate: "exposes",
    });

    model.graph.addEdge({
      id: "edge4",
      source: "api.endpoint.quality-report",
      destination: "data-model.schema.quality-data",
      predicate: "uses",
    });

    generator = new MarkdownGenerator(model, {
      includeMermaid: true,
      includeTables: true,
      tableFormat: "markdown",
      maxTableRows: 50,
    });
  });

  describe("generate()", () => {
    it("should generate markdown with header and model information", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("# Test Architecture Model");
      expect(markdown).toContain("A test model for markdown generation");
      expect(markdown).toContain("## Table of Contents");
      expect(markdown).toContain("## Architecture Overview");
    });

    it("should include model metadata table", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("| Property | Value |");
      expect(markdown).toContain("| Name | Test Architecture Model |");
      expect(markdown).toContain("| Version | 1.0.0 |");
      expect(markdown).toContain("| Author | Test Suite |");
    });

    it("should generate layer summary table", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("## Layer Summary");
      expect(markdown).toContain("| Layer | Elements | Relationships | Description |");
      expect(markdown).toContain("Motivation");
      expect(markdown).toContain("Business");
      expect(markdown).toContain("Application");
    });

    it("should include detailed layer documentation", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("## Detailed Layer Documentation");
      expect(markdown).toContain("### Motivation");
      expect(markdown).toContain("### Business");
      expect(markdown).toContain("### Application");
    });

    it("should generate statistics table", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("## Architecture Statistics");
      expect(markdown).toContain("| Metric | Value |");
      expect(markdown).toContain("Total Elements");
      expect(markdown).toContain("Total Relationships");
    });

    it("should generate relationships summary", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("## Relationships Summary");
      expect(markdown).toContain("| Relationship Type | Count |");
      expect(markdown).toContain("satisfied-by");
      expect(markdown).toContain("realized-by");
    });

    it("should escape markdown special characters in content", async () => {
      const testModel = new Model("/tmp/test", new Manifest({
        name: "Model | With & Special * [Chars]",
      }));
      testModel.graph.addNode({
        id: "test.element.special",
        layer: "motivation",
        type: "goal",
        name: "Goal | With * Special",
        description: "Description [with] {special} chars",
        properties: {},
      });

      const gen = new MarkdownGenerator(testModel);
      const markdown = await gen.generate();

      expect(markdown).toContain("\\|");
      expect(markdown).toContain("\\*");
      expect(markdown).toContain("\\[");
      expect(markdown).toContain("\\]");
    });
  });

  describe("Mermaid diagram generation", () => {
    it("should include mermaid code blocks when includeMermaid is true", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("```mermaid");
      expect(markdown).toContain("```");
    });

    it("should not include mermaid when includeMermaid is false", async () => {
      const noMermaidGen = new MarkdownGenerator(model, {
        includeMermaid: false,
      });
      const markdown = await noMermaidGen.generate();

      // Should have less mermaid blocks (none for layers)
      const mermaidCount = (markdown.match(/```mermaid/g) || []).length;
      expect(mermaidCount).toBe(0);
    });

    it("should generate architecture overview diagram", async () => {
      const markdown = await generator.generate();

      // Check for graph structure
      expect(markdown).toContain("graph TD");
      expect(markdown).toContain("Motivation");
      expect(markdown).toContain("Business");
    });

    it("should sanitize node IDs for mermaid compatibility", async () => {
      const markdown = await generator.generate();

      // IDs should be sanitized (no dots, special chars)
      expect(markdown).toMatch(/\w+\[".*"\]/);
    });

    it("should generate layer-specific diagrams", async () => {
      const markdown = await generator.generate();

      // Should contain graph diagrams for layers with elements
      expect(markdown).toContain("graph LR");
      const graphCount = (markdown.match(/graph LR/g) || []).length;
      expect(graphCount).toBeGreaterThan(0);
    });

    it("should include relationship labels in diagrams", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("satisfied-by");
      expect(markdown).toContain("realized-by");
      expect(markdown).toContain("exposes");
    });
  });

  describe("Table generation", () => {
    it("should include tables when includeTables is true", async () => {
      const markdown = await generator.generate();

      const tableHeaders = (markdown.match(/\| [^|]+ \|/g) || []).length;
      expect(tableHeaders).toBeGreaterThan(0);
    });

    it("should not include layer element tables when includeTables is false", async () => {
      const noTablesGen = new MarkdownGenerator(model, {
        includeTables: false,
      });
      const markdown = await noTablesGen.generate();

      // Should have metadata tables but not element tables
      expect(markdown).toContain("| Property | Value |");
    });

    it("should respect maxTableRows limit", async () => {
      // Add many nodes to test pagination
      for (let i = 0; i < 100; i++) {
        model.graph.addNode({
          id: `motivation.goal.goal-${i}`,
          layer: "motivation",
          type: "goal",
          name: `Goal ${i}`,
          properties: {},
        });
      }

      const limitedGen = new MarkdownGenerator(model, {
        maxTableRows: 10,
      });
      const markdown = await limitedGen.generate();

      // Should indicate there are more rows
      expect(markdown).toContain("more elements");
    });

    it("should include element properties tables", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("**Properties:**");
      expect(markdown).toContain("| Property | Value |");
    });

    it("should include relationship information in element details", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("**Outgoing Relationships:**");
      expect(markdown).toContain("**Incoming Relationships:**");
    });
  });

  describe("Element details", () => {
    it("should include element names and IDs", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("Improve Quality");
      expect(markdown).toContain("motivation.goal.improve-quality");
      expect(markdown).toContain("Quality Management");
    });

    it("should include element types", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("**Type:** `goal`");
      expect(markdown).toContain("**Type:** `capability`");
      expect(markdown).toContain("**Type:** `service`");
    });

    it("should include element descriptions", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("Improve overall product quality");
      expect(markdown).toContain("Manage quality processes");
    });
  });

  describe("Layer descriptions", () => {
    it("should include standard layer descriptions", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("Goals, requirements, drivers");
      expect(markdown).toContain("Business processes, functions");
      expect(markdown).toContain("Application components");
    });

    it("should format layer names properly", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("Motivation");
      expect(markdown).toContain("Business");
      expect(markdown).toContain("Application");
      expect(markdown).toContain("Data Model");
    });
  });

  describe("Statistics and summaries", () => {
    it("should calculate correct element count", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("Total Elements | 5");
    });

    it("should calculate correct relationship count", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("Total Relationships | 4");
    });

    it("should show relationship type breakdown", async () => {
      const markdown = await generator.generate();

      expect(markdown).toContain("| `satisfied-by` | 1 |");
      expect(markdown).toContain("| `realized-by` | 1 |");
      expect(markdown).toContain("| `exposes` | 1 |");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty model", async () => {
      const emptyModel = new Model("/tmp/test", new Manifest({
        name: "Empty Model",
      }));

      const emptyGen = new MarkdownGenerator(emptyModel);
      const markdown = await emptyGen.generate();

      expect(markdown).toContain("# Empty Model");
      expect(markdown).toContain("## Architecture Overview");
      expect(markdown).toContain("## Architecture Statistics");
    });

    it("should handle nodes without descriptions", async () => {
      const testModel = new Model("/tmp/test", new Manifest({
        name: "Test Model",
      }));

      testModel.graph.addNode({
        id: "test.element.nodesc",
        layer: "motivation",
        type: "goal",
        name: "Goal without description",
        properties: {},
      });

      const gen = new MarkdownGenerator(testModel);
      const markdown = await gen.generate();

      expect(markdown).toContain("Goal without description");
      expect(markdown).not.toContain("undefined");
    });

    it("should handle nodes without properties", async () => {
      const testModel = new Model("/tmp/test", new Manifest({
        name: "Test Model",
      }));

      testModel.graph.addNode({
        id: "test.element.noprops",
        layer: "motivation",
        type: "goal",
        name: "Goal without properties",
        properties: {},
      });

      const gen = new MarkdownGenerator(testModel);
      const markdown = await gen.generate();

      expect(markdown).not.toContain("**Properties:**");
    });

    it("should handle complex property values", async () => {
      const testModel = new Model("/tmp/test", new Manifest({
        name: "Test Model",
      }));

      testModel.graph.addNode({
        id: "test.element.complex",
        layer: "api",
        type: "endpoint",
        name: "Complex Endpoint",
        properties: {
          methods: ["GET", "POST"],
          config: { timeout: 5000, retries: 3 },
          active: true,
          count: 42,
        },
      });

      const gen = new MarkdownGenerator(testModel);
      const markdown = await gen.generate();

      expect(markdown).toContain("GET");
      expect(markdown).toContain("POST");
    });
  });

  describe("Options handling", () => {
    it("should use default options when not provided", async () => {
      const defaultGen = new MarkdownGenerator(model);
      const markdown = await defaultGen.generate();

      expect(markdown).toContain("```mermaid");
      expect(markdown).toContain("| Layer | Elements");
    });

    it("should respect custom maxTableRows option", async () => {
      const customGen = new MarkdownGenerator(model, {
        maxTableRows: 2,
      });

      // Add some test nodes
      for (let i = 0; i < 5; i++) {
        model.graph.addNode({
          id: `test.element.${i}`,
          layer: "motivation",
          type: "goal",
          name: `Test ${i}`,
          properties: {},
        });
      }

      const markdown = await customGen.generate();
      expect(markdown).toContain("more elements");
    });

    it("should support different diagram types", async () => {
      const flowchartGen = new MarkdownGenerator(model, {
        diagramType: "flowchart",
      });

      const markdown = await flowchartGen.generate();
      expect(markdown).toContain("flowchart");
    });
  });
});
