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

    // Add layers to model first so they share the graph
    const motivationLayer = new Layer("motivation");
    model.addLayer(motivationLayer);

    const businessLayer = new Layer("business");
    model.addLayer(businessLayer);

    // Now add elements (layers use shared graph)
    const goal = new Element({
      id: "motivation-goal-increase-revenue",
      type: "goal",
      name: "Increase Revenue",
    });
    motivationLayer.addElement(goal);

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
    expect(output.includes("note top :")).toBe(true);
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

    // Should have references with arrows (realizes uses ..|>)
    expect(output.includes("..|>")).toBe(true);
    expect(output.includes("realizes")).toBe(true);
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

    layer.addElement(goal2);
    layer.addElement(goal1);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, {});

    // Should have arrow for relationships (depends-on uses default -->)
    expect(output.includes("-->")).toBe(true);
    expect(output.includes("depends-on")).toBe(true);
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
    const otherProcess = new Element({
      id: "business-process-other",
      type: "business-process",
      name: "Other Process",
    });

    layer.addElement(otherProcess);
    layer.addElement(process);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, {});

    expect(output.includes("depends & requires")).toBe(true);
  });

  it("should include source reference notes when includeSources is true", async () => {
    const layer = new Layer("application");
    const element = new Element({
      id: "application-component-test",
      type: "application-component",
      name: "Test Component",
      properties: {
        source: {
          reference: {
            provenance: "extracted",
            locations: [
              {
                file: "src/components/test.ts",
                symbol: "TestComponent",
              },
            ],
          },
        },
      },
    });

    layer.addElement(element);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, { includeSources: true });

    expect(output.includes("note right of application-component-test")).toBe(true);
    expect(output.includes("Source: src/components/test.ts")).toBe(true);
    expect(output.includes("Symbol: TestComponent")).toBe(true);
    expect(output.includes("end note")).toBe(true);
  });

  it("should not include source reference notes when includeSources is false", async () => {
    const layer = new Layer("application");
    const element = new Element({
      id: "application-component-test",
      type: "application-component",
      name: "Test Component",
      properties: {
        source: {
          reference: {
            provenance: "extracted",
            locations: [
              {
                file: "src/components/test.ts",
                symbol: "TestComponent",
              },
            ],
          },
        },
      },
    });

    layer.addElement(element);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, { includeSources: false });

    expect(output.includes("note right of")).toBe(false);
    expect(output.includes("Source:")).toBe(false);
  });

  it("should handle source reference without symbol", async () => {
    const layer = new Layer("api");
    const element = new Element({
      id: "api-endpoint-test",
      type: "endpoint",
      name: "Test Endpoint",
      properties: {
        "x-source-reference": {
          provenance: "manual",
          locations: [
            {
              file: "src/api/test.ts",
            },
          ],
        },
      },
    });

    layer.addElement(element);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, { includeSources: true });

    expect(output.includes("Source: src/api/test.ts")).toBe(true);
    expect(output.includes("Symbol:")).toBe(false);
  });

  it("should escape quotes in source file paths", async () => {
    const layer = new Layer("application");
    const element = new Element({
      id: "application-component-quotes",
      type: "application-component",
      name: "Component with quotes",
      properties: {
        source: {
          reference: {
            provenance: "extracted",
            locations: [
              {
                file: 'src/components/"special"/test.ts',
                symbol: "TestComponent",
              },
            ],
          },
        },
      },
    });

    layer.addElement(element);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, { includeSources: true });

    expect(output.includes('src/components/\\"special\\"/test.ts')).toBe(true);
  });
});
