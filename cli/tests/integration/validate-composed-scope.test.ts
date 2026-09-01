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

    // Should report broken unqualified reference
    expect(localOutput).toContain("Broken reference");
    expect(localOutput).toContain("non-existent");

    // Validate in composed scope with same configuration
    const composedOutput = await captureConsole(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPaths: {}, // No external models to resolve
      })
    );

    // Should still report the same broken unqualified reference
    expect(composedOutput).toContain("Broken reference");
    expect(composedOutput).toContain("non-existent");

    // Both should have the same fundamental error
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
});
