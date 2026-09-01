/**
 * Manual validation test for composed scope
 * Tests that can be run manually to verify the feature works end-to-end
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { validateCommand } from "@/commands/validate";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { promises as fs } from "fs";
import path from "path";

async function captureOutput(fn: () => Promise<void>): Promise<{ stdout: string; stderr: string; error?: Error }> {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: any[]) => logs.push(args.join(" "));
  console.error = (...args: any[]) => errors.push(args.join(" "));

  let error: Error | undefined;
  try {
    await fn();
  } catch (e) {
    error = e as Error;
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return {
    stdout: logs.join("\n"),
    stderr: errors.join("\n"),
    error,
  };
}

describe("composed scope validation - manual verification", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    await workdir.cleanup();
  });

  it("case 1: unreferenced and unresolvable model produces warning only", async () => {
    // Initialize model with declared but unreferenced external model
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "unused-service": {
            url: "https://github.com/example/unused",
          },
        },
      },
      { lazyLoad: false }
    );

    // Create a simple motivation layer (no references to unused-service)
    const motivationLayer = new Layer("motivation");
    motivationLayer.addElement(
      new Element({
        id: "motivation.goal.serve-users",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Serve Users",
      })
    );

    model.addLayer(motivationLayer);
    await model.saveManifest();
    await model.saveLayer("motivation");

    // Validate in composed scope without providing path
    const output = await captureOutput(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPaths: {},
      })
    );

    // Should NOT throw error (contains "warning" not "error")
    expect(output.error).toBeUndefined();
    // Should warn about unreferenced model
    expect(output.stdout + output.stderr).toContain("unused-service");
  });

  it("case 2: referenced and unresolvable model produces error", async () => {
    // Initialize model with declared external model
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "auth-service": {
            url: "https://github.com/example/auth",
          },
        },
      },
      { lazyLoad: false }
    );

    // Create API layer WITH reference to auth-service
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

    // Validate in composed scope without providing path
    const output = await captureOutput(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPaths: {},
      })
    );

    // Should throw error
    expect(output.error).toBeDefined();
    // Should mention the referenced model
    expect(output.stdout + output.stderr).toContain("auth-service");
  });

  it("case 3: referenced and resolvable model validates references", async () => {
    // Initialize model with declared external model
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "auth-service": {
            url: "https://github.com/example/auth",
          },
        },
      },
      { lazyLoad: false }
    );

    // Create API layer with reference to auth-service
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

    // Create external auth-service model directory
    const authServicePath = path.join(workdir.path, "..", "auth-service");
    const apiLayerDir = path.join(authServicePath, "model", "07_api");
    await fs.mkdir(apiLayerDir, { recursive: true });

    // Create API layer with the referenced operation
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

    // Validate in composed scope WITH model path
    const output = await captureOutput(() =>
      validateCommand({
        model: workdir.path,
        scope: "composed",
        modelPaths: { "auth-service": authServicePath },
      })
    );

    // Should NOT throw error (element exists)
    expect(output.error).toBeUndefined();
    // Should NOT report broken reference
    expect(output.stdout + output.stderr).not.toContain("Broken qualified reference");
  });

  it("local validation unaffected by composed options", async () => {
    // Initialize model with external declaration but invalid unqualified ref
    const model = await Model.init(
      workdir.path,
      {
        name: "Main Service",
        version: "1.0.0",
        created: new Date().toISOString(),
        models: {
          "external": {},
        },
      },
      { lazyLoad: false }
    );

    // Create motivation layer with broken UNQUALIFIED reference
    const motivationLayer = new Layer("motivation");
    motivationLayer.addElement(
      new Element({
        id: "motivation.goal.test",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Test",
      })
    );

    const element = motivationLayer.elements.get("motivation.goal.test");
    if (element) {
      // Unqualified broken reference (not qualified reference)
      element.references = [
        { target: "api.operation.non-existent", type: "implements" },
      ];
    }

    // Add API layer
    const apiLayer = new Layer("api");
    apiLayer.addElement(
      new Element({
        id: "api.operation.real",
        spec_node_id: "api.operation",
        layer_id: "api",
        type: "operation",
        name: "Real Op",
      })
    );

    model.addLayer(motivationLayer);
    model.addLayer(apiLayer);
    await model.saveManifest();
    await model.saveLayer("motivation");
    await model.saveLayer("api");

    // Validate in local scope (should report broken unqualified ref)
    const localOutput = await captureOutput(() =>
      validateCommand({
        model: workdir.path,
        scope: "local",
      })
    );

    expect(localOutput.error).toBeDefined();
    expect(localOutput.stdout + localOutput.stderr).toContain("Broken reference");
  });
});
