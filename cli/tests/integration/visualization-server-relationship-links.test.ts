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

    // Manifest data for model initialization
    const manifestData = {
      name: "Relationship Links Test Model",
      version: "0.1.0",
      description: "Model for relationship link testing",
      specVersion: "0.6.0",
      created: new Date().toISOString(),
    };

    // Initialize model with eager loading (required for server to render all layers)
    model = await Model.init(workdir.path, manifestData, { lazyLoad: false });

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

  it("should return consistent relationship data across multiple requests", async () => {
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

/**
 * Regression guard test for lazyLoad + relationships behavior
 *
 * CRITICAL: This test guards the behavior that Model.load() calls
 * loadRelationships() unconditionally, regardless of the lazyLoad option.
 * This is essential because dr visualize (server entry point) loads with
 * lazyLoad: true. If loadRelationships() were ever moved inside the lazy
 * guard block, the visualization would silently lose all relationship links.
 *
 * This test ensures that regression is caught immediately.
 */
describe.serial("Model.load() relationships behavior with lazyLoad: true", () => {
  let workdir: { path: string; cleanup: () => Promise<void> };

  beforeAll(async () => {
    // Create isolated test directory from golden copy
    workdir = await createTestWorkdir();

    // Manifest data for model initialization
    const manifestData = {
      name: "LazyLoad Relationships Guard Test",
      version: "0.1.0",
      description: "Guard against regression where loadRelationships is moved inside lazy block",
      specVersion: "0.6.0",
      created: new Date().toISOString(),
    };

    // Initialize model with eager loading to set up the baseline
    const model = await Model.init(workdir.path, manifestData, { lazyLoad: false });

    // Create motivation layer
    const motivationLayer = new Layer("motivation");
    model.addLayer(motivationLayer);

    // Create two goals for relationship testing
    const goalAlpha = new Element({
      id: "motivation.goal.alpha",
      type: "goal",
      name: "Goal Alpha",
      description: "First goal",
    });

    const goalBeta = new Element({
      id: "motivation.goal.beta",
      type: "goal",
      name: "Goal Beta",
      description: "Second goal",
    });

    motivationLayer.addElement(goalAlpha);
    motivationLayer.addElement(goalBeta);

    // Save elements to disk
    await model.save();

    // Add relationship between the goals
    model.relationships.add({
      source: "motivation.goal.alpha",
      target: "motivation.goal.beta",
      predicate: "depends-on",
      layer: "motivation",
    });

    // Persist relationships to relationships.yaml
    await model.saveRelationships();
  });

  afterAll(async () => {
    // Clean up working directory
    if (workdir) {
      await workdir.cleanup();
    }
  });

  it("loads relationships even when lazyLoad: true", async () => {
    // Load model with lazyLoad: true (simulates dr visualize behavior)
    const lazyModel = await Model.load(workdir.path, { lazyLoad: true });

    // Assert relationships are loaded despite lazyLoad: true
    const rels = lazyModel.relationships.toArray();
    expect(rels.length).toBeGreaterThan(0);

    // Assert the specific relationship we created is present
    const depRelationship = rels.find(
      (r: any) =>
        r.source === "motivation.goal.alpha" &&
        r.target === "motivation.goal.beta"
    );

    expect(depRelationship).toBeDefined();
    expect(depRelationship.predicate).toBe("depends-on");
    expect(depRelationship.layer).toBe("motivation");
  });

  it("provides relationships to VisualizationServer when loaded with lazyLoad: true", async () => {
    // Load model with lazyLoad: true
    const lazyModel = await Model.load(workdir.path, { lazyLoad: true });

    // Allocate port for this test
    const port = await portAllocator.allocatePort();
    let server: VisualizationServer | undefined;

    try {
      // Start server with lazy-loaded model
      server = new VisualizationServer(lazyModel, { authEnabled: false });
      await server.start(port);

      // Call /api/model endpoint
      const response = await fetch(`http://localhost:${port}/api/model`);
      expect(response.status).toBe(200);

      const data = await response.json();

      // Assert relationships are present in the response
      expect(Array.isArray(data.links)).toBe(true);
      expect(data.links.length).toBeGreaterThan(0);

      // Find the specific relationship
      const link = data.links.find(
        (l: any) =>
          l.source === "motivation.goal.alpha" &&
          l.target === "motivation.goal.beta"
      );

      expect(link).toBeDefined();
      expect(link.type).toBe("depends-on");
    } finally {
      // Stop server in finally block to ensure cleanup even if assertions fail
      if (server) {
        server.stop();
      }
      // Release port
      portAllocator.releasePort(port);
    }
  });
});
