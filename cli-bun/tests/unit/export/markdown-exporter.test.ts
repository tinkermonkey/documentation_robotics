import { describe, it, expect, beforeEach } from "bun:test";
import { MarkdownExporter } from "@/export/markdown-exporter";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Manifest } from "@/core/manifest";

describe("MarkdownExporter", () => {
  let exporter: MarkdownExporter;
  let model: Model;

  beforeEach(() => {
    exporter = new MarkdownExporter();

    const manifest = new Manifest({
      name: "Test Architecture",
      version: "2.0.0",
      description: "A comprehensive test model",
      author: "Test Team",
      created: "2024-01-01",
      modified: "2024-12-20",
    });

    model = new Model("/test", manifest);

    const motivationLayer = new Layer("motivation");
    const goal = new Element({
      id: "motivation-goal-test",
      type: "goal",
      name: "Test Goal",
      description: "A strategic goal for the organization",
      properties: { priority: "high", owner: "leadership" },
      references: [
        {
          source: "motivation-goal-test",
          target: "business-process-sales",
          type: "realizes",
          description: "This goal is realized through the sales process",
        },
      ],
    });

    motivationLayer.addElement(goal);
    model.addLayer(motivationLayer);
  });

  it("should start with H1 heading", async () => {
    const output = await exporter.export(model, {});
    expect(output.startsWith("# Test Architecture")).toBe(true);
  });

  it("should include model description", async () => {
    const output = await exporter.export(model, {});
    expect(output.includes("A comprehensive test model")).toBe(true);
  });

  it("should include model information section", async () => {
    const output = await exporter.export(model, {});
    expect(output.includes("## Model Information")).toBe(true);
  });

  it("should include model metadata in table", async () => {
    const output = await exporter.export(model, {});
    expect(output.includes("| Version |")).toBe(true);
    expect(output.includes("| 2.0.0 |")).toBe(true);
    expect(output.includes("| Author |")).toBe(true);
    expect(output.includes("| Test Team |")).toBe(true);
  });

  it("should include layer sections", async () => {
    const output = await exporter.export(model, {});
    expect(output.includes("## Layer: Motivation")).toBe(true);
  });

  it("should include layer description", async () => {
    const output = await exporter.export(model, {});
    expect(
      output.includes(
        "Goals, requirements, drivers, and strategic outcomes"
      )
    ).toBe(true);
  });

  it("should include element table", async () => {
    const output = await exporter.export(model, {});
    expect(output.includes("| ID |")).toBe(true);
    expect(output.includes("| Name |")).toBe(true);
    expect(output.includes("| Type |")).toBe(true);
    expect(output.includes("| Description |")).toBe(true);
  });

  it("should list elements with their details", async () => {
    const output = await exporter.export(model, {});
    expect(output.includes("`motivation-goal-test`")).toBe(true);
    expect(output.includes("Test Goal")).toBe(true);
    expect(output.includes("goal")).toBe(true);
  });

  it("should include element details section", async () => {
    const output = await exporter.export(model, {});
    expect(output.includes("### Element Details")).toBe(true);
    expect(output.includes("#### Test Goal (`motivation-goal-test`)")).toBe(true);
  });

  it("should include element properties in table", async () => {
    const output = await exporter.export(model, {});
    expect(output.includes("**Properties:**")).toBe(true);
    expect(output.includes("| `priority`")).toBe(true);
    expect(output.includes("| `owner`")).toBe(true);
  });

  it("should include cross-layer references", async () => {
    const output = await exporter.export(model, {});
    expect(output.includes("**Cross-Layer References:**")).toBe(true);
    expect(output.includes("realizes")).toBe(true);
    expect(output.includes("`business-process-sales`")).toBe(true);
  });

  it("should include layer summary", async () => {
    const output = await exporter.export(model, {});
    expect(output.includes("### Layer Summary")).toBe(true);
    expect(output.includes("**Total Elements:**")).toBe(true);
  });

  it("should include architecture summary section", async () => {
    const output = await exporter.export(model, {});
    expect(output.includes("## Architecture Summary")).toBe(true);
    expect(output.includes("| Metric |")).toBe(true);
    expect(output.includes("| Count |")).toBe(true);
  });

  it("should escape markdown special characters", async () => {
    const layer = new Layer("business");
    const element = new Element({
      id: "business-process-test",
      type: "business-process",
      name: "Process with [brackets] and *asterisks*",
      description: "Description with `code` and _emphasis_",
    });

    layer.addElement(element);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, {});

    expect(output.includes("\\[brackets\\]")).toBe(true);
    expect(output.includes("\\*asterisks\\*")).toBe(true);
  });

  it("should filter layers", async () => {
    const businessLayer = new Layer("business");
    const actor = new Element({
      id: "business-actor-test",
      type: "business-actor",
      name: "Test Actor",
    });
    businessLayer.addElement(actor);
    model.addLayer(businessLayer);

    const output = await exporter.export(model, { layers: ["motivation"] });

    expect(output.includes("## Layer: Motivation")).toBe(true);
    expect(output.includes("## Layer: Business")).toBe(false);
  });

  it("should support multiple layers", async () => {
    const layers = ["motivation", "business", "application"];

    for (const layerName of layers) {
      const layer = new Layer(layerName);
      const element = new Element({
        id: `${layerName}-type-test`,
        type: "test-type",
        name: `${layerName} Element`,
      });
      layer.addElement(element);
      model.addLayer(layer);
    }

    const output = await exporter.export(model, {
      layers,
    });

    expect(output.includes("## Layer: Motivation")).toBe(true);
    expect(output.includes("## Layer: Business")).toBe(true);
    expect(output.includes("## Layer: Application")).toBe(true);
  });

  it("should count relationships correctly", async () => {
    const layer = new Layer("motivation");
    const goal1 = new Element({
      id: "motivation-goal-test1",
      type: "goal",
      name: "Goal 1",
      relationships: [
        {
          source: "motivation-goal-test1",
          target: "motivation-goal-test2",
          predicate: "depends-on",
        },
      ],
    });
    const goal2 = new Element({
      id: "motivation-goal-test2",
      type: "goal",
      name: "Goal 2",
    });

    layer.addElement(goal1);
    layer.addElement(goal2);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, {});

    expect(output.includes("**Relationships:** 1")).toBe(true);
  });

  it("should handle empty properties gracefully", async () => {
    const layer = new Layer("business");
    const element = new Element({
      id: "business-process-test",
      type: "business-process",
      name: "Simple Process",
    });

    layer.addElement(element);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, {});

    expect(output.includes("Business Process")).toBe(true);
    expect(output.includes("Simple Process")).toBe(true);
  });

  it("should include timestamps in metadata", async () => {
    const output = await exporter.export(model, {});

    expect(output.includes("| Created |")).toBe(true);
    expect(output.includes("| Modified |")).toBe(true);
    expect(output.includes("| 2024-01-01 |")).toBe(true);
    expect(output.includes("| 2024-12-20 |")).toBe(true);
  });
});
