import { describe, it, expect, beforeEach } from "bun:test";
import { ArchiMateExporter } from "@/export/archimate-exporter";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Manifest } from "@/core/manifest";

describe("ArchiMateExporter", () => {
  let exporter: ArchiMateExporter;
  let model: Model;
  let motivationLayer: Layer;

  beforeEach(() => {
    exporter = new ArchiMateExporter();

    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      description: "Test description",
    });

    model = new Model("/test", manifest);

    motivationLayer = new Layer("motivation");

    // Add test elements
    const goal = new Element({
      id: "motivation-goal-test-goal",
      type: "goal",
      name: "Test Goal",
      description: "A test goal",
      properties: { priority: "high" },
    });

    const requirement = new Element({
      id: "motivation-requirement-test-req",
      type: "requirement",
      name: "Test Requirement",
      references: [
        {
          source: "motivation-requirement-test-req",
          target: "business-process-test",
          type: "implements",
        },
      ],
    });

    motivationLayer.addElement(goal);
    motivationLayer.addElement(requirement);
    model.addLayer(motivationLayer);
  });

  it("should export ArchiMate XML with valid declaration", async () => {
    const output = await exporter.export(model, {});

    expect(output.startsWith('<?xml version="1.0"')).toBe(true);
    expect(output.includes('<model xmlns=')).toBe(true);
  });

  it("should include model name in export", async () => {
    const output = await exporter.export(model, {});

    expect(output.includes("<name>Test Model</name>")).toBe(true);
  });

  it("should include model description in export", async () => {
    const output = await exporter.export(model, {});

    expect(
      output.includes("<documentation>Test description</documentation>")
    ).toBe(true);
  });

  it("should export elements with correct ArchiMate types", async () => {
    const output = await exporter.export(model, {});

    // Check that goal is mapped correctly
    expect(output.includes('xsi:type="Goal"')).toBe(true);
    // Check that requirement is mapped correctly
    expect(output.includes('xsi:type="Requirement"')).toBe(true);
  });

  it("should export element names correctly", async () => {
    const output = await exporter.export(model, {});

    expect(output.includes("<name>Test Goal</name>")).toBe(true);
    expect(output.includes("<name>Test Requirement</name>")).toBe(true);
  });

  it("should escape XML special characters in names", async () => {
    const specialLayer = new Layer("motivation");
    const element = new Element({
      id: "motivation-goal-test",
      type: "goal",
      name: 'Test & <Goal> "quoted"',
      description: "Test < > & \"'",
    });
    specialLayer.addElement(element);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(specialLayer);

    const output = await exporter.export(testModel, {});

    expect(output.includes("Test &amp; &lt;Goal&gt; &quot;quoted&quot;")).toBe(
      true
    );
  });

  it("should support layers filter", async () => {
    const businessLayer = new Layer("business");
    const actor = new Element({
      id: "business-actor-test",
      type: "business-actor",
      name: "Test Actor",
    });
    businessLayer.addElement(actor);
    model.addLayer(businessLayer);

    // Export only motivation layer
    const output = await exporter.export(model, { layers: ["motivation"] });

    expect(output.includes("motivation-goal-test-goal")).toBe(true);
    expect(output.includes("business-actor-test")).toBe(false);
  });

  it("should export cross-layer references as relationships", async () => {
    const output = await exporter.export(model, {});

    expect(output.includes("<relationships>")).toBe(true);
    expect(output.includes('xsi:type="Association"')).toBe(true);
  });

  it("should close all XML tags properly", async () => {
    const output = await exporter.export(model, {});

    const openElements = (output.match(/<[a-zA-Z]/g) || []).length;
    const closeElements = (output.match(/<\/[a-zA-Z]/g) || []).length;

    expect(openElements).toBe(closeElements);
  });

  it("should have correct namespaces", async () => {
    const output = await exporter.export(model, {});

    expect(
      output.includes('xmlns="http://www.opengroup.org/xsd/archimate/3.0/"')
    ).toBe(true);
    expect(
      output.includes(
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
      )
    ).toBe(true);
  });

  it("should support multiple layers in export", async () => {
    const appLayer = new Layer("application");
    const component = new Element({
      id: "application-component-test",
      type: "application-component",
      name: "Test Component",
    });
    appLayer.addElement(component);
    model.addLayer(appLayer);

    const output = await exporter.export(model, {
      layers: ["motivation", "application"],
    });

    expect(output.includes("motivation-goal-test-goal")).toBe(true);
    expect(output.includes("application-component-test")).toBe(true);
  });

  it("should map all supported element types correctly", async () => {
    // Test all supported types for motivation layer
    const typeMapping = {
      stakeholder: "Stakeholder",
      driver: "Driver",
      goal: "Goal",
      requirement: "Requirement",
    };

    for (const [type, archiType] of Object.entries(typeMapping)) {
      const testLayer = new Layer("motivation");
      const element = new Element({
        id: `motivation-${type}-test`,
        type,
        name: `Test ${archiType}`,
      });
      testLayer.addElement(element);

      const testModel = new Model("/test", model.manifest);
      testModel.addLayer(testLayer);

      const output = await exporter.export(testModel, {});
      expect(output.includes(`xsi:type="${archiType}"`)).toBe(true);
    }
  });
});
