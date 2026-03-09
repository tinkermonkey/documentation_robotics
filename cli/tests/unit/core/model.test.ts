import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Manifest } from "@/core/manifest";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

describe("Model", () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique test directory path (not actually created, just used for unit tests)
    testDir = `${tmpdir()}/dr-unit-test-${randomUUID()}`;
  });

  it("should create a model with manifest", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const model = new Model(testDir, manifest);

    expect(model.rootPath).toBe(testDir);
    expect(model.manifest.name).toBe("Test Model");
    expect(model.layers.size).toBe(0);
    expect(model.lazyLoad).toBe(false);
  });

  it("should create a model with lazy loading enabled", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const model = new Model(testDir, manifest, { lazyLoad: true });

    expect(model.lazyLoad).toBe(true);
  });

  it("should add layers to model", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const model = new Model(testDir, manifest);
    const layer = new Layer("motivation");

    model.addLayer(layer);

    expect(model.layers.size).toBe(1);
    expect(model.getLayerNames()).toContain("motivation");
  });

  it("should get layer by name", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const model = new Model(testDir, manifest);
    const layer = new Layer("motivation");

    model.addLayer(layer);

    const retrieved = model.layers.get("motivation");
    expect(retrieved).toEqual(layer);
  });

  it("should return undefined for nonexistent layer", async () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const model = new Model(testDir, manifest);

    const retrieved = await model.getLayer("nonexistent");
    expect(retrieved).toBeUndefined();
  });

  it("should throw error when saving nonexistent layer", async () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const model = new Model(testDir, manifest);

    try {
      await model.saveLayer("nonexistent");
      expect.unreachable("Should have thrown error");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).toContain("not found");
      }
    }
  });

  it("should get layer names", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const model = new Model(testDir, manifest);

    model.addLayer(new Layer("motivation"));
    model.addLayer(new Layer("business"));
    model.addLayer(new Layer("application"));

    const names = model.getLayerNames();

    expect(names).toContain("motivation");
    expect(names).toContain("business");
    expect(names).toContain("application");
    expect(names).toHaveLength(3);
  });
});

describe("Model.loadRelationships — Graph Sync Logging", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = `${tmpdir()}/dr-unit-test-${randomUUID()}`;
  });

  it("should warn when graph.addEdge fails during relationship sync", async () => {
    const { mkdir, writeFile } = await import("fs/promises");
    const path = await import("path");

    // Set up test directory with proper model structure
    const modelDir = path.join(testDir, "documentation-robotics", "model");
    await mkdir(modelDir, { recursive: true });

    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const model = new Model(testDir, manifest);

    // Create a relationships.yaml file with test data in the correct location
    const relationshipsYaml = `- source: motivation.goal.test-goal
  target: business.service.test-service
  predicate: aggregates
  category: structural
  properties: {}
`;
    await writeFile(path.join(modelDir, "relationships.yaml"), relationshipsYaml);

    // Mock graph.addEdge to throw an error
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalAddEdge = model.graph.addEdge.bind(model.graph);

    model.graph.addEdge = vi.fn(() => {
      throw new Error("Node not found in graph");
    });

    try {
      // Call the actual loadRelationships method
      await model.loadRelationships();

      // Verify warning was logged from the production code (not just in DEBUG mode)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to sync relationship to graph")
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("source: motivation.goal.test-goal")
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("target: business.service.test-service")
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Node not found in graph")
      );
    } finally {
      model.graph.addEdge = originalAddEdge;
      warnSpy.mockRestore();
    }
  });
});
