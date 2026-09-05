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

  it("should support all 13 layers", async () => {
    const allLayers = [
      "motivation",
      "business",
      "product",
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
      layers: allLayers,
    });

    // Verify all 13 layers are included in the output
    expect(output.includes('package "motivation"')).toBe(true);
    expect(output.includes('package "business"')).toBe(true);
    expect(output.includes('package "product"')).toBe(true);
    expect(output.includes('package "security"')).toBe(true);
    expect(output.includes('package "application"')).toBe(true);
    expect(output.includes('package "technology"')).toBe(true);
    expect(output.includes('package "api"')).toBe(true);
    expect(output.includes('package "data-model"')).toBe(true);
    expect(output.includes('package "data-store"')).toBe(true);
    expect(output.includes('package "ux"')).toBe(true);
    expect(output.includes('package "navigation"')).toBe(true);
    expect(output.includes('package "apm"')).toBe(true);
    expect(output.includes('package "testing"')).toBe(true);
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
      source_reference: {
        provenance: "extracted",
        locations: [
          {
            file: "src/components/test.ts",
            symbol: "TestComponent",
          },
        ],
      },
    });

    layer.addElement(element);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, { includeSources: true });

    expect(output.includes("note right of application_component_test")).toBe(true);
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
      source_reference: {
        provenance: "extracted",
        locations: [
          {
            file: "src/components/test.ts",
            symbol: "TestComponent",
          },
        ],
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
      source_reference: {
        provenance: "manual",
        locations: [
          {
            file: "src/api/test.ts",
          },
        ],
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
      source_reference: {
        provenance: "extracted",
        locations: [
          {
            file: 'src/components/"special"/test.ts',
            symbol: "TestComponent",
          },
        ],
      },
    });

    layer.addElement(element);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, { includeSources: true });

    expect(output.includes('src/components/\\"special\\"/test.ts')).toBe(true);
  });

  // Regression coverage for a bug found alongside the source/x-source-reference persistence
  // collision: extractSourceReference() read properties["x-source-reference"]/
  // properties.source.reference as a schema-blind legacy fallback for elements with no
  // structural source_reference. security.accesscondition declares "source" as a real,
  // required domain attribute — that value must never be misread as code provenance.
  it("does not mistake a schema-declared 'source' domain attribute for legacy provenance", async () => {
    const layer = new Layer("security");
    const element = new Element({
      id: "security-accesscondition-test",
      spec_node_id: "security.accesscondition",
      type: "accesscondition",
      layer_id: "security",
      name: "Test Condition",
      attributes: {
        field: "request.user.role",
        operator: "eq",
        value: "admin",
        message: "Role must be admin",
        // Deliberately shaped like what extractSourceReference's legacy fallback expects
        // (an object with repository.url), to prove the schema-aware guard skips it even
        // when it would otherwise "match". Real accesscondition.source is documented as a
        // plain string; this shape is intentionally adversarial for this test.
        source: { repository: { url: "https://internal-vcs.example/not-provenance" } },
      },
    });

    layer.addElement(element);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, { includeSources: true });

    expect(output.includes("not-provenance")).toBe(false);
    expect(output.includes("Repo:")).toBe(false);
  });

  it("still uses the legacy properties fallback for a node type with no schema declaring that attribute", async () => {
    const layer = new Layer("motivation");
    const element = new Element({
      id: "motivation-goal-legacy-source",
      type: "goal",
      name: "Legacy Source Goal",
      attributes: {
        // motivation.goal does not declare "x-source-reference" — the legacy fallback should
        // still apply for genuinely unmigrated data of this shape.
        "x-source-reference": {
          locations: [{ file: "src/legacy/goal.ts", symbol: "LegacyGoal" }],
        },
      },
    });

    layer.addElement(element);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(layer);

    const output = await exporter.export(testModel, { includeSources: true });

    expect(output.includes("Source: src/legacy/goal.ts")).toBe(true);
    expect(output.includes("Symbol: LegacyGoal")).toBe(true);
  });
});
