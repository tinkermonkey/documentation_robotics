/**
 * Integration test for VisualizationServer relationship links in /api/model
 *
 * This test verifies the critical bug fix for issue #487:
 * Write a relationship via the model API, start VisualizationServer against
 * the same directory, call GET /api/model over HTTP, and assert the specific
 * relationship appears in data.links.
 *
 * REQUIRES SERIAL EXECUTION: Uses describe.serial because:
 * - Tests start/stop the visualization server requiring exclusive port access
 * - Concurrent execution would cause port conflicts and server state issues
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Model } from "../../src/core/model.js";
import { VisualizationServer } from "../../src/server/server.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { portAllocator } from "../helpers/port-allocator.js";
import { Layer } from "../../src/core/layer.js";
import { Element } from "../../src/core/element.js";

describe.serial("VisualizationServer relationship links in /api/model", () => {
  let workdir: { path: string; cleanup: () => Promise<void> };
  let model: Model;
  let server: VisualizationServer;
  let port: number;

  beforeAll(async () => {
    // Create isolated test directory from golden copy
    workdir = await createTestWorkdir();

    // Initialize model with eager loading (required for server to render all layers)
    model = await Model.init(workdir.path, { lazyLoad: false });

    // Create motivation layer if it doesn't exist
    let motivationLayer = await model.getLayer("motivation");
    if (!motivationLayer) {
      motivationLayer = new Layer("motivation");
      model.addLayer(motivationLayer);
    }

    // Create two elements in the motivation layer
    const goalAlpha = new Element({
      id: "motivation.goal.alpha",
      type: "goal",
      name: "Goal Alpha",
      description: "First goal for relationship testing",
    });

    const goalBeta = new Element({
      id: "motivation.goal.beta",
      type: "goal",
      name: "Goal Beta",
      description: "Second goal for relationship testing",
    });

    motivationLayer.addElement(goalAlpha);
    motivationLayer.addElement(goalBeta);

    // Save initial model
    await model.save();

    // Add relationship between the two goals
    model.relationships.add({
      source: "motivation.goal.alpha",
      target: "motivation.goal.beta",
      predicate: "depends-on",
      layer: "motivation",
    });

    // Persist relationships to relationships.yaml
    await model.saveRelationships();

    // Reload model to simulate server startup
    // This ensures relationships.yaml is loaded during Model.load()
    const loadedModel = await Model.load(workdir.path);

    // Allocate port for this test
    port = await portAllocator.allocatePort();

    // Start server with the reloaded model
    server = new VisualizationServer(loadedModel, { authEnabled: false });
    await server.start(port);

    // Give server time to fully initialize
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    // Stop server
    if (server) {
      server.stop();
    }

    // Release port back to allocator
    portAllocator.releasePort(port);

    // Clean up working directory
    if (workdir) {
      await workdir.cleanup();
    }
  });

  it("should include relationships in /api/model response data.links", async () => {
    // Call GET /api/model endpoint
    const response = await fetch(`http://localhost:${port}/api/model`);
    expect(response.status).toBe(200);

    const data = await response.json();

    // Verify links array exists
    expect(Array.isArray(data.links)).toBe(true);

    // Find the specific relationship we created
    const link = data.links.find(
      (l: any) =>
        l.source === "motivation.goal.alpha" &&
        l.target === "motivation.goal.beta"
    );

    // Verify the relationship exists in the response
    expect(link).toBeDefined();

    // Verify relationship has correct type
    expect(link.type).toBe("depends-on");

    // Verify relationship has proper ID format (should start with rel:)
    expect(link.id).toMatch(/^rel:/);

    // Verify layer_id is set correctly
    expect(link.layer_id).toBe("motivation");
  });

  it("should have correct structure for all links in /api/model", async () => {
    const response = await fetch(`http://localhost:${port}/api/model`);
    const data = await response.json();

    // Verify all links have required fields
    for (const link of data.links) {
      expect(link.id).toBeDefined();
      expect(link.source).toBeDefined();
      expect(link.target).toBeDefined();
      expect(link.type).toBeDefined();
    }
  });

  it("should preserve relationship data through server reload", async () => {
    // First call to /api/model
    const response1 = await fetch(`http://localhost:${port}/api/model`);
    const data1 = await response1.json();

    const link1 = data1.links.find(
      (l: any) =>
        l.source === "motivation.goal.alpha" &&
        l.target === "motivation.goal.beta"
    );

    // Second call to /api/model (should return same data)
    const response2 = await fetch(`http://localhost:${port}/api/model`);
    const data2 = await response2.json();

    const link2 = data2.links.find(
      (l: any) =>
        l.source === "motivation.goal.alpha" &&
        l.target === "motivation.goal.beta"
    );

    // Both calls should return the same relationship
    expect(link1).toBeDefined();
    expect(link2).toBeDefined();
    expect(link1.type).toBe(link2.type);
    expect(link1.id).toBe(link2.id);
  });
});
