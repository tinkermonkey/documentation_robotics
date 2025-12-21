import { describe, it, expect, beforeEach } from "bun:test";
import { PlantUMLExporter } from "@/export/plantuml-exporter";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Manifest } from "@/core/manifest";

describe("PlantUMLExporter", () => {
  let exporter: PlantUMLExporter;
  let model: Model;

  beforeEach(() => {
    exporter = new PlantUMLExporter();

    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      description: "Test architecture",
    });

    model = new Model("/test", manifest);

    const motivationLayer = new Layer("motivation");
    const goal = new Element({
      id: "motivation-goal-increase-revenue",
      type: "goal",
      name: "Increase Revenue",
    });
    motivationLayer.addElement(goal);
    model.addLayer(motivationLayer);

    const businessLayer = new Layer("business");
    const process = new Element({
      id: "business-process-sales",
      type: "business-process",
      name: "Sales Process",
      references: [
        {
          source: "business-process-sales",
          target: "motivation-goal-increase-revenue",
          type: "realizes",
        },
      ],
    });
    businessLayer.addElement(process);
    model.addLayer(businessLayer);
  });

  it("should start with @startuml", async () => {
    const output = await exporter.export(model, {});
    expect(output.startsWith("@startuml")).toBe(true);
  });

  it("should end with @enduml", async () => {
    const output = await exporter.export(model, {});
    expect(output.endsWith("@enduml\n")).toBe(true);
  });

  it("should include model title", async () => {
    const output = await exporter.export(model, {});
    expect(output.includes('title "Test Model"')).toBe(true);
  });

  it("should include model description in note", async () => {
    const output = await exporter.export(model, {});
    expect(output.includes('note top :')).toBe(true);
  });

  it("should create packages for each layer", async () => {
    const output = await exporter.export(model, {});

    expect(output.includes('package "motivation"')).toBe(true);
    expect(output.includes('package "business"')).toBe(true);
  });

  it("should use layer colors for packages", async () => {
    const output = await exporter.export(model, {});

    // Motivation layer has color #FFE4E1
    expect(output.includes('package "motivation" #FFE4E1')).toBe(true);
  });

  it("should create components for elements", async () => {
    const output = await exporter.export(model, {});

    expect(output.includes('component "Increase Revenue"')).toBe(true);
    expect(output.includes('component "Sales Process"')).toBe(true);
  });

  it("should add relationships with arrows", async () => {
    const output = await exporter.export(model, {});

    // Should have references with --> (solid arrow)
    expect(output.includes("-->")).toBe(true);
  });

  it("should filter layers", async () => {
    const output = await exporter.export(model, { layers: ["motivation"] });

    expect(output.includes('package "motivation"')).toBe(true);
    expect(output.includes('package "business"')).toBe(false);
  });

  it("should handle quotes in element names", async () => {
    const layer = new Layer("motivation");
    const element = new Element({
      id: "motivation-goal-test",
      type: "goal",
      name: 'Test "Goal" with quotes',
    });
    layer.addElement(element);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, {});

    // Quotes should be escaped in PlantUML
    expect(output.includes('Test \\"Goal\\" with quotes')).toBe(true);
  });

  it("should support all 12 layers", async () => {
    const allLayers = [
      "motivation",
      "business",
      "security",
      "application",
      "technology",
      "api",
      "data-model",
      "data-store",
      "ux",
      "navigation",
      "apm",
      "testing",
    ];

    for (const layerName of allLayers) {
      const layer = new Layer(layerName);
      const element = new Element({
        id: `${layerName}-type-test`,
        type: "test-type",
        name: "Test Element",
      });
      layer.addElement(element);
      model.addLayer(layer);
    }

    const output = await exporter.export(model, {
      layers: allLayers.slice(0, 3),
    });

    expect(output.includes('package "motivation"')).toBe(true);
    expect(output.includes('package "business"')).toBe(true);
    expect(output.includes('package "security"')).toBe(true);
  });

  it("should handle elements with relationships", async () => {
    const layer = new Layer("motivation");
    const goal1 = new Element({
      id: "motivation-goal-revenue",
      type: "goal",
      name: "Increase Revenue",
      relationships: [
        {
          source: "motivation-goal-revenue",
          target: "motivation-goal-growth",
          predicate: "depends-on",
        },
      ],
    });
    const goal2 = new Element({
      id: "motivation-goal-growth",
      type: "goal",
      name: "Achieve Growth",
    });

    layer.addElement(goal1);
    layer.addElement(goal2);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, {});

    // Should have dotted arrow for relationships
    expect(output.includes("..>")).toBe(true);
  });

  it("should escape special characters in relationship names", async () => {
    const layer = new Layer("business");
    const process = new Element({
      id: "business-process-test",
      type: "business-process",
      name: "Test Process",
      relationships: [
        {
          source: "business-process-test",
          target: "business-process-other",
          predicate: "depends & requires",
        },
      ],
    });

    layer.addElement(process);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, {});

    expect(output.includes('depends & requires')).toBe(true);
  });
});
