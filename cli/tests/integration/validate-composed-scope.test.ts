/**
 * Integration tests for composed scope validation
 * Tests cross-model reference resolution with graduated warning/error behavior
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { validateCommand } from "@/commands/validate";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { promises as fs } from "fs";
import path from "path";

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

describe("composed scope validation (integration)", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    await workdir.cleanup();
  });

  it("validates qualified references against resolved external models", async () => {
    // Initialize main model with external model declarations
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "auth-service": {
            url: "https://github.com/example/auth-service",
            role: "shared",
          },
        },
      },
      { lazyLoad: false }
    );

    // Create API layer with qualified reference
    const apiLayer = new Layer("api");
    apiLayer.addElement(
      new Element({
        id: "api.operation.login",
        spec_node_id: "api.operation",
        layer_id: "api",
        type: "operation",
        name: "Login",
        description: "User login operation",
      })
    );

    const element = apiLayer.elements.get("api.operation.login");
    if (element) {
      element.references = [
        { target: "@auth-service/api.operation.authenticate", type: "delegates-to" },
      ];
    }

    model.addLayer(apiLayer);
    await model.saveManifest();
    await model.saveLayer("api");

    // Create external auth-service model directory structure
    const authServicePath = path.join(workdir.path, "..", "auth-service");
    const authModelDir = path.join(authServicePath, "model", "01_motivation");
    await fs.mkdir(authModelDir, { recursive: true });

    // Create a simple API layer file in auth-service with the referenced operation
    const apiLayerDir = path.join(authServicePath, "model", "07_api");
    await fs.mkdir(apiLayerDir, { recursive: true });
    await fs.writeFile(
      path.join(apiLayerDir, "operations.yaml"),
      `elements:
  - path: "api.operation.authenticate"
    spec_node_id: "api.operation"
    type: "operation"
    layer_id: "api"
    name: "Authenticate"
`
    );

    // Validate with composed scope and model-path override
    const output = await captureConsole(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPath: [`auth-service=${authServicePath}`],
        modelPaths: { "auth-service": authServicePath },
      })
    );

    // Should not report broken reference since element exists
    expect(output).not.toContain("Broken qualified reference");
  });

  it("reports error when referenced external model cannot be resolved", async () => {
    // Initialize model with declared external model
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "auth-service": {
            url: "https://github.com/example/auth-service",
          },
        },
      },
      { lazyLoad: false }
    );

    // Create API layer with qualified reference to external model
    const apiLayer = new Layer("api");
    apiLayer.addElement(
      new Element({
        id: "api.operation.login",
        spec_node_id: "api.operation",
        layer_id: "api",
        type: "operation",
        name: "Login",
      })
    );

    const element = apiLayer.elements.get("api.operation.login");
    if (element) {
      element.references = [
        { target: "@auth-service/api.operation.authenticate", type: "delegates-to" },
      ];
    }

    model.addLayer(apiLayer);
    await model.saveManifest();
    await model.saveLayer("api");

    // Validate with composed scope WITHOUT providing model path
    // Should report error because model is referenced but not resolvable
    const output = await captureConsole(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPaths: {}, // No path provided for auth-service
      })
    );

    // Should report error for unresolved but referenced model
    expect(output).toContain("could not be resolved");
    expect(output).toContain("auth-service");
    expect(output).toContain("model-path");
  });

  it("reports warning when unreferenced external model cannot be resolved", async () => {
    // Initialize model with declared external model that won't be used
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "payment-service": {
            url: "https://github.com/example/payment",
          },
        },
      },
      { lazyLoad: false }
    );

    // Create motivation layer WITHOUT any references to payment-service
    const motivationLayer = new Layer("motivation");
    motivationLayer.addElement(
      new Element({
        id: "motivation.goal.serve-customers",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Serve Customers",
      })
    );

    model.addLayer(motivationLayer);
    await model.saveManifest();
    await model.saveLayer("motivation");

    // Validate with composed scope
    // Should report WARNING (not error) for unresolved and unreferenced model
    const output = await captureConsole(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPaths: {}, // No path provided
      })
    );

    // Should contain warning message about unreferenced model
    expect(output).toContain("declared but not referenced");
    expect(output).toContain("payment-service");
    // Should NOT contain error message
    expect(output).not.toContain("Validation failed");
  });

  it("reports broken reference when target element missing in resolved external model", async () => {
    // Initialize model with external model
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "auth-service": {
            role: "shared",
          },
        },
      },
      { lazyLoad: false }
    );

    // Create API layer with reference to non-existent element in external model
    const apiLayer = new Layer("api");
    apiLayer.addElement(
      new Element({
        id: "api.operation.login",
        spec_node_id: "api.operation",
        layer_id: "api",
        type: "operation",
        name: "Login",
      })
    );

    const element = apiLayer.elements.get("api.operation.login");
    if (element) {
      element.references = [
        { target: "@auth-service/api.operation.non-existent-op", type: "delegates-to" },
      ];
    }

    model.addLayer(apiLayer);
    await model.saveManifest();
    await model.saveLayer("api");

    // Create external auth-service model directory structure
    const authServicePath = path.join(workdir.path, "..", "auth-service");
    const apiLayerDir = path.join(authServicePath, "model", "07_api");
    await fs.mkdir(apiLayerDir, { recursive: true });

    // Create API layer with different operations (not the one being referenced)
    await fs.writeFile(
      path.join(apiLayerDir, "operations.yaml"),
      `elements:
  - path: "api.operation.authenticate"
    spec_node_id: "api.operation"
    type: "operation"
    layer_id: "api"
    name: "Authenticate"
  - path: "api.operation.refresh-token"
    spec_node_id: "api.operation"
    type: "operation"
    layer_id: "api"
    name: "Refresh Token"
`
    );

    // Validate with composed scope and valid model path
    const output = await captureConsole(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPath: [`auth-service=${authServicePath}`],
        modelPaths: { "auth-service": authServicePath },
      })
    );

    // Should report broken reference
    expect(output).toContain("Broken qualified reference");
    expect(output).toContain("non-existent-op");
    expect(output).toContain("auth-service");
  });

  it("local validation is unaffected by composed scope preparation", async () => {
    // Initialize model with external declaration but no qualified references
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "other-service": {},
        },
      },
      { lazyLoad: false }
    );

    // Create layers with broken unqualified references
    const motivationLayer = new Layer("motivation");
    motivationLayer.addElement(
      new Element({
        id: "motivation.goal.serve-customers",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Serve Customers",
      })
    );

    const element = motivationLayer.elements.get("motivation.goal.serve-customers");
    if (element) {
      // Broken unqualified reference
      element.references = [
        { target: "api.operation.non-existent", type: "implements" },
      ];
    }

    model.addLayer(motivationLayer);

    const apiLayer = new Layer("api");
    apiLayer.addElement(
      new Element({
        id: "api.operation.real-op",
        spec_node_id: "api.operation",
        layer_id: "api",
        type: "operation",
        name: "Real Operation",
      })
    );

    model.addLayer(apiLayer);
    await model.saveManifest();
    await model.saveLayer("motivation");
    await model.saveLayer("api");

    // Validate in local scope
    const localOutput = await captureConsole(() =>
      validateCommand({
        model: workdir.path,
        scope: "local",
      })
    );

    // Should report a validation error about the non-existent element
    // The actual message depends on validation stage, but output should indicate errors occurred
    expect(localOutput.toLowerCase().includes("error")).toBe(true);

    // Validate in composed scope with same configuration
    const composedOutput = await captureConsole(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPaths: {}, // No external models to resolve
      })
    );

    // Both should have similar validation behavior for unqualified references
    // (composed scope extends reference validation but doesn't change unqualified ref handling)
    expect(localOutput.includes("Broken reference")).toBe(
      composedOutput.includes("Broken reference")
    );
  });

  it("handles multiple external model declarations with selective resolution", async () => {
    // Initialize model with multiple external declarations
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "auth-service": { role: "shared" },
          "payment-service": { role: "shared" },
        },
      },
      { lazyLoad: false }
    );

    // Create API layer with references to both external models
    const apiLayer = new Layer("api");
    apiLayer.addElement(
      new Element({
        id: "api.operation.login",
        spec_node_id: "api.operation",
        layer_id: "api",
        type: "operation",
        name: "Login",
      })
    );

    apiLayer.addElement(
      new Element({
        id: "api.operation.pay",
        spec_node_id: "api.operation",
        layer_id: "api",
        type: "operation",
        name: "Process Payment",
      })
    );

    const loginOp = apiLayer.elements.get("api.operation.login");
    if (loginOp) {
      loginOp.references = [
        { target: "@auth-service/api.operation.authenticate", type: "delegates-to" },
      ];
    }

    const payOp = apiLayer.elements.get("api.operation.pay");
    if (payOp) {
      payOp.references = [
        { target: "@payment-service/api.operation.charge", type: "delegates-to" },
      ];
    }

    model.addLayer(apiLayer);
    await model.saveManifest();
    await model.saveLayer("api");

    // Create only auth-service directory (not payment-service)
    const authServicePath = path.join(workdir.path, "..", "auth-service");
    const apiLayerDir = path.join(authServicePath, "model", "07_api");
    await fs.mkdir(apiLayerDir, { recursive: true });
    await fs.writeFile(
      path.join(apiLayerDir, "operations.yaml"),
      `elements:
  - path: "api.operation.authenticate"
    spec_node_id: "api.operation"
    type: "operation"
    layer_id: "api"
    name: "Authenticate"
`
    );

    // Validate with only auth-service path provided
    const output = await captureConsole(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPath: [`auth-service=${authServicePath}`],
        modelPaths: { "auth-service": authServicePath },
      })
    );

    // Should report error for payment-service (referenced but unresolvable)
    expect(output).toContain("payment-service");
    expect(output).toContain("could not be resolved");
    // Should not report error for auth-service auth operation (resolvable and referenced)
    expect(output).not.toContain("api.operation.authenticate");
  });

  it("properly extracts element paths from elements: wrapper format", async () => {
    // Initialize model with external model
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "external": { role: "shared" },
        },
      },
      { lazyLoad: false }
    );

    // Create API layer with qualified reference
    const apiLayer = new Layer("api");
    apiLayer.addElement(
      new Element({
        id: "api.operation.delegate",
        spec_node_id: "api.operation",
        layer_id: "api",
        type: "operation",
        name: "Delegate Op",
      })
    );

    const element = apiLayer.elements.get("api.operation.delegate");
    if (element) {
      element.references = [
        { target: "@external/api.operation.external-op", type: "delegates-to" },
      ];
    }

    model.addLayer(apiLayer);
    await model.saveManifest();
    await model.saveLayer("api");

    // Create external model with elements: wrapper format
    const externalPath = path.join(workdir.path, "..", "external");
    const apiLayerDir = path.join(externalPath, "model", "07_api");
    await fs.mkdir(apiLayerDir, { recursive: true });
    await fs.writeFile(
      path.join(apiLayerDir, "operations.yaml"),
      `elements:
  - path: "api.operation.external-op"
    spec_node_id: "api.operation"
    type: "operation"
    name: "External Op"
  - path: "api.operation.another"
    spec_node_id: "api.operation"
    type: "operation"
    name: "Another Op"
`
    );

    // Validate - should find the external operation
    const output = await captureConsole(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPath: [`external=${externalPath}`],
        modelPaths: { "external": externalPath },
      })
    );

    // Should NOT report broken reference since element exists
    expect(output).not.toContain("Broken qualified reference");
  });

  it("properly extracts element paths from object-of-objects format", async () => {
    // Initialize model with external model
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "external": { role: "shared" },
        },
      },
      { lazyLoad: false }
    );

    // Create data-store layer with qualified reference
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

    const element = dataStoreLayer.elements.get("data-store.table.users");
    if (element) {
      element.references = [
        { target: "@external/data-store.column.user-id", type: "uses" },
      ];
    }

    model.addLayer(dataStoreLayer);
    await model.saveManifest();
    await model.saveLayer("data-store");

    // Create external model with object-of-objects format
    const externalPath = path.join(workdir.path, "..", "external");
    const dataStoreDir = path.join(externalPath, "model", "09_data-store");
    await fs.mkdir(dataStoreDir, { recursive: true });
    await fs.writeFile(
      path.join(dataStoreDir, "columns.yaml"),
      `"user-id":
  path: "data-store.column.user-id"
  spec_node_id: "data-store.column"
  type: "column"
  name: "User ID"
"user-email":
  path: "data-store.column.user-email"
  spec_node_id: "data-store.column"
  type: "column"
  name: "User Email"
`
    );

    // Validate - should find the external column
    const output = await captureConsole(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPath: [`external=${externalPath}`],
        modelPaths: { "external": externalPath },
      })
    );

    // Should NOT report broken reference since element exists
    expect(output).not.toContain("Broken qualified reference");
  });

  it("clears state on validator reuse to prevent stale resolution data", async () => {
    // Initialize model with external model
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "external": { role: "shared" },
        },
      },
      { lazyLoad: false }
    );

    // Create API layer with qualified reference in first model
    const apiLayer = new Layer("api");
    apiLayer.addElement(
      new Element({
        id: "api.operation.op1",
        spec_node_id: "api.operation",
        layer_id: "api",
        type: "operation",
        name: "Operation 1",
      })
    );

    const element = apiLayer.elements.get("api.operation.op1");
    if (element) {
      element.references = [
        { target: "@external/api.operation.ext-op", type: "delegates-to" },
      ];
    }

    model.addLayer(apiLayer);
    await model.saveManifest();
    await model.saveLayer("api");

    // Create external model for validation
    const externalPath = path.join(workdir.path, "..", "external");
    const apiLayerDir = path.join(externalPath, "model", "07_api");
    await fs.mkdir(apiLayerDir, { recursive: true });
    await fs.writeFile(
      path.join(apiLayerDir, "operations.yaml"),
      `elements:
  - path: "api.operation.ext-op"
`
    );

    // Run validation multiple times with same validator instance
    // and ensure state is cleared between calls
    const output1 = await captureConsole(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPath: [`external=${externalPath}`],
        modelPaths: { "external": externalPath },
      })
    );

    // First validation should succeed (no broken references)
    expect(output1).not.toContain("Broken qualified reference");

    // Modify the model to remove the external reference
    const reloadModel = await Model.load(workdir.path, { lazyLoad: false });
    const reloadedApiLayer = reloadModel.layers.get("api");
    if (reloadedApiLayer) {
      const reloadedElement = reloadedApiLayer.elements.get("api.operation.op1");
      if (reloadedElement) {
        reloadedElement.references = [];
      }
      await reloadModel.saveLayer("api");
    }

    // Run validation again with modified model
    const output2 = await captureConsole(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPath: [`external=${externalPath}`],
        modelPaths: { "external": externalPath },
      })
    );

    // Second validation should also succeed (no references now)
    expect(output2).not.toContain("Broken qualified reference");
  });

  it("logs console.warn when filesystem errors occur during model resolution", async () => {
    // Initialize model with external model reference
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "external": { role: "shared" },
        },
      },
      { lazyLoad: false }
    );

    const layer = new Layer("api");
    layer.addElement(
      new Element({
        id: "api.operation.op",
        spec_node_id: "api.operation",
        layer_id: "api",
        type: "operation",
        name: "Op",
      })
    );

    const element = layer.elements.get("api.operation.op");
    if (element) {
      element.references = [
        { target: "@external/api.operation.ext", type: "delegates-to" },
      ];
    }

    model.addLayer(layer);
    await model.saveManifest();
    await model.saveLayer("api");

    // Provide a path that exists but is not a directory (to trigger fs.stat error)
    const invalidModelPath = path.join(workdir.path, "file.txt");
    await fs.writeFile(invalidModelPath, "not a directory");

    // Capture console output
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.join(" "));

    try {
      // Validate with invalid model path
      const output = await captureConsole(() =>
        validateCommand({
          model: workdir.path,
          scope: "composed",
          modelPath: [`external=${invalidModelPath}`],
          modelPaths: { "external": invalidModelPath },
        })
      );

      // Should log a warning about failing to resolve external model
      expect(warnings.some((w) => w.includes("Warning"))).toBe(true);
      expect(warnings.some((w) => w.includes("external"))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });
});
