/**
 * Integration tests for qualified reference validation
 * Tests end-to-end validation of cross-model references in isolation
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { validateCommand } from "@/commands/validate";
import { createTestWorkdir } from "../helpers/golden-copy.js";

async function captureConsole(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: any[]) => logs.push(args.join(" "));
  console.error = (...args: any[]) => logs.push(args.join(" "));

  try {
    await fn();
  } catch {
    // validateCommand throws when validation fails; output was already captured
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return logs.join("\n");
}

describe("qualified references validation (integration)", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    await workdir.cleanup();
  });

  it("validates qualified references to declared external models", async () => {
    // Initialize a model with external model declarations
    const model = await Model.init(
      workdir.path,
      {
        name: "Leaf Model with External References",
        version: "1.0.0",
        description: "Test model for qualified reference validation in isolation",
        specVersion: "0.9.0",
        created: new Date().toISOString(),
        models: {
          "auth-service": {
            url: "https://github.com/example/auth-service",
            role: "shared",
          },
          "payment-service": {},
        },
      },
      { lazyLoad: false }
    );

    // Create motivation layer with element referencing external model
    const motivationLayer = new Layer("motivation");
    motivationLayer.addElement(
      new Element({
        id: "motivation.goal.secure-authentication",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Secure Authentication",
        description: "Ensure secure user authentication",
      })
    );

    // Add qualified reference to external auth service API layer
    const element1 = motivationLayer.elements.get("motivation.goal.secure-authentication");
    if (element1) {
      element1.references = [
        { target: "@auth-service/api.operation.authenticate", type: "implements" },
      ];
    }

    model.addLayer(motivationLayer);

    await model.saveManifest();
    await model.saveLayer("motivation");

    // Validate the model - should pass without errors
    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path })
    );

    expect(output).not.toContain("Unknown external model reference");
    expect(output).not.toContain("Malformed qualified reference path");
  });

  it("reports error for qualified reference to undeclared external model", async () => {
    // Initialize model WITHOUT external model declarations
    const model = await Model.init(
      workdir.path,
      {
        name: "Model without External Declarations",
        version: "1.0.0",
        description: "Test model missing external model declarations",
        specVersion: "0.9.0",
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );

    const motivationLayer = new Layer("motivation");
    motivationLayer.addElement(
      new Element({
        id: "motivation.goal.secure-authentication",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Secure Authentication",
      })
    );

    // Add qualified reference to undeclared external model
    const element2 = motivationLayer.elements.get("motivation.goal.secure-authentication");
    if (element2) {
      element2.references = [
        { target: "@undeclared-service/api.operation.test", type: "implements" },
      ];
    }

    model.addLayer(motivationLayer);

    await model.saveManifest();
    await model.saveLayer("motivation");

    // Validate the model - should report error for undeclared model
    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path })
    );

    expect(output).toContain("Unknown external model reference");
    expect(output).toContain("undeclared-service");
  });

  it("enforces directional constraint on qualified references", async () => {
    // Initialize model with external declarations
    const model = await Model.init(
      workdir.path,
      {
        name: "Direction Constraint Test",
        version: "1.0.0",
        description: "Test directional constraint for qualified references",
        specVersion: "0.9.0",
        created: new Date().toISOString(),
        models: {
          "core-service": {},
        },
      },
      { lazyLoad: false }
    );

    // Data Store layer (layer 9) should not reference API layer (layer 7) in external model
    const dataStoreLayer = new Layer("data-store");
    dataStoreLayer.addElement(
      new Element({
        id: "data-store.table.users",
        spec_node_id: "data-store.table",
        layer_id: "data-store",
        type: "table",
        name: "Users Table",
      })
    );

    // Add invalid reference: lower layer referencing higher layer
    const element3 = dataStoreLayer.elements.get("data-store.table.users");
    if (element3) {
      element3.references = [
        { target: "@core-service/api.operation.get-users", type: "uses" },
      ];
    }

    model.addLayer(dataStoreLayer);

    await model.saveManifest();
    await model.saveLayer("data-store");

    // Validate the model - should report directional constraint error
    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path })
    );

    expect(output).toContain("Invalid reference direction");
  });

  it("validates qualified references with hyphenated layer names in path", async () => {
    const model = await Model.init(
      workdir.path,
      {
        name: "Hyphenated Layer Names Test",
        version: "1.0.0",
        description: "Test qualified references with hyphenated layer names",
        specVersion: "0.9.0",
        created: new Date().toISOString(),
        models: {
          "data-service": {},
        },
      },
      { lazyLoad: false }
    );

    const applicationLayer = new Layer("application");
    applicationLayer.addElement(
      new Element({
        id: "application.service.order-processor",
        spec_node_id: "application.service",
        layer_id: "application",
        type: "service",
        name: "Order Processor",
      })
    );

    // Reference to data-model (hyphenated layer) in external model
    const element4 = applicationLayer.elements.get("application.service.order-processor");
    if (element4) {
      element4.references = [
        { target: "@data-service/data-model.entity.order", type: "uses" },
      ];
    }

    model.addLayer(applicationLayer);

    await model.saveManifest();
    await model.saveLayer("application");

    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path })
    );

    expect(output).not.toContain("Malformed qualified reference path");
  });

  it("reports error for malformed qualified reference path", async () => {
    const model = await Model.init(
      workdir.path,
      {
        name: "Malformed Path Test",
        version: "1.0.0",
        description: "Test malformed qualified reference paths",
        specVersion: "0.9.0",
        created: new Date().toISOString(),
        models: {
          "external": {},
        },
      },
      { lazyLoad: false }
    );

    const motivationLayer = new Layer("motivation");
    motivationLayer.addElement(
      new Element({
        id: "motivation.goal.test",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Test Goal",
      })
    );

    // Malformed path - missing required segments
    const element5 = motivationLayer.elements.get("motivation.goal.test");
    if (element5) {
      element5.references = [
        { target: "@external/invalid", type: "implements" },
      ];
    }

    model.addLayer(motivationLayer);

    await model.saveManifest();
    await model.saveLayer("motivation");

    const output = await captureConsole(() =>
      validateCommand({ model: workdir.path })
    );

    expect(output).toContain("Malformed qualified reference path");
  });
});
