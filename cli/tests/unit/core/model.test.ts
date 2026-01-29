import { describe, it, expect, beforeEach } from "bun:test";
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
