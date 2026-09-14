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

describe("Model.loadLayer — Error Handling", () => {
  it("should silently handle ENOENT when layer directory not found", async () => {
    const testDir = `${tmpdir()}/dr-layer-test-${randomUUID()}`;
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const model = new Model(testDir, manifest);

    // Should not throw when layer directory doesn't exist
    await model.loadLayer("motivation");
    expect(model.layers.get("motivation")).toBeUndefined();
  });

  it("should propagate EACCES errors instead of silently failing", async () => {
    const fs = await import("fs/promises");

    const testDir = `${tmpdir()}/dr-layer-permission-test-${randomUUID()}`;
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const model = new Model(testDir, manifest);

    const eacces = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
    eacces.code = "EACCES";

    const readdirSpy = vi.spyOn(fs, "readdir").mockImplementation(() => {
      return Promise.reject(eacces);
    });

    try {
      await model.loadLayer("motivation");
      expect.unreachable("Should have thrown permission error");
    } catch (err) {
      expect((err as Error).message).toContain("permission denied");
    } finally {
      readdirSpy.mockRestore();
    }
  });

  it("should propagate EIO errors on I/O failure", async () => {
    const fs = await import("fs/promises");

    const testDir = `${tmpdir()}/dr-layer-io-test-${randomUUID()}`;
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const model = new Model(testDir, manifest);

    const eio = new Error("EIO: input/output error") as NodeJS.ErrnoException;
    eio.code = "EIO";

    const readdirSpy = vi.spyOn(fs, "readdir").mockImplementation(() => {
      return Promise.reject(eio);
    });

    try {
      await model.loadLayer("motivation");
      expect.unreachable("Should have thrown I/O error");
    } catch (err) {
      expect((err as Error).message).toContain("input/output error");
    } finally {
      readdirSpy.mockRestore();
    }
  });
});

describe("Model.saveLayer — Error Handling", () => {
  it("should propagate EACCES errors when accessing layer directory", async () => {
    const { mkdir } = await import("fs/promises");
    const fs = await import("fs/promises");
    const path = await import("path");

    const testDir = `${tmpdir()}/dr-save-layer-test-${randomUUID()}`;
    await mkdir(testDir, { recursive: true });

    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const model = new Model(testDir, manifest);
    const layer = new Layer("motivation");
    model.addLayer(layer);

    const eacces = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
    eacces.code = "EACCES";

    const readdirSpy = vi.spyOn(fs, "readdir").mockImplementation(() => {
      return Promise.reject(eacces);
    });

    try {
      await model.saveLayer("motivation");
      expect.unreachable("Should have thrown permission error");
    } catch (err) {
      expect((err as Error).message).toContain("permission denied");
    } finally {
      readdirSpy.mockRestore();
    }
  });

  it("should propagate EIO errors on I/O failure when cleaning files", async () => {
    const { mkdir, writeFile } = await import("fs/promises");
    const fs = await import("fs/promises");
    const path = await import("path");

    const testDir = `${tmpdir()}/dr-save-layer-io-test-${randomUUID()}`;
    const modelDir = path.join(testDir, "documentation-robotics", "model", "01_motivation");
    await mkdir(modelDir, { recursive: true });

    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const model = new Model(testDir, manifest);
    const layer = new Layer("motivation");
    model.addLayer(layer);

    const eio = new Error("EIO: input/output error") as NodeJS.ErrnoException;
    eio.code = "EIO";

    const readdirSpy = vi.spyOn(fs, "readdir").mockImplementation(() => {
      return Promise.reject(eio);
    });

    try {
      await model.saveLayer("motivation");
      expect.unreachable("Should have thrown I/O error");
    } catch (err) {
      // The I/O error should be re-thrown, not wrapped
      expect((err as Error).message).toContain("input/output error");
    } finally {
      readdirSpy.mockRestore();
    }
  });
});

describe("Model.load — Detached Manifest Path Validation", () => {
  it("should successfully load model from detached manifest path", async () => {
    const { mkdir, writeFile } = await import("fs/promises");
    const path = await import("path");

    // Create a detached manifest path (simulating /farm/svc-model/manifest.yaml)
    // This is now supported for farm sync scenarios where models live in temporary directories
    const detachedDir = `${tmpdir()}/dr-detached-${randomUUID()}`;
    const modelDir = path.join(detachedDir, "model");
    await mkdir(modelDir, { recursive: true });

    const manifestPath = path.join(modelDir, "manifest.yaml");
    const now = new Date().toISOString();
    await writeFile(
      manifestPath,
      `version: "1.0.0"
project:
  name: Test Model
  version: "1.0.0"
created: ${now}
modified: ${now}
`
    );

    // Loading model from detached manifest should now succeed
    const model = await Model.load(manifestPath);
    expect(model).toBeDefined();
    expect(model.manifest.name).toBe("Test Model");
  });
});

describe("Model.loadRelationships — Graph Sync Logging", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = `${tmpdir()}/dr-unit-test-${randomUUID()}`;
  });

  it("should silently skip graph.addEdge failures during relationship sync", async () => {
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

    // Mock graph.addEdge to throw (simulates cross-layer ref to an unloaded node)
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalAddEdge = model.graph.addEdge.bind(model.graph);

    model.graph.addEdge = vi.fn(() => {
      throw new Error("Node not found in graph");
    });

    try {
      // Call the actual loadRelationships method
      await model.loadRelationships();

      // Verify no warning is emitted at all — failed edges are silently skipped.
      // The primary relationship data lives in model.relationships, not the graph.
      expect(warnSpy).not.toHaveBeenCalled();

      // Verify the relationship is still available via the primary store
      expect(model.relationships.getAll()).toHaveLength(1);
      expect(model.relationships.getAll()[0].source).toBe("motivation.goal.test-goal");
    } finally {
      model.graph.addEdge = originalAddEdge;
      warnSpy.mockRestore();
    }
  });
});

describe("Model.load — Error Handling for Filesystem Errors", () => {
  describe("startPath branch", () => {
    it("should silently handle ENOENT from non-standard structure check and use manifest parent", async () => {
      const { mkdir, writeFile } = await import("fs/promises");
      const path = await import("path");

      const testDir = `${tmpdir()}/dr-resolve-test-${randomUUID()}`;
      // Create non-standard structure: model/ at root with manifest inside
      const modelDir = path.join(testDir, "model");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = path.join(modelDir, "manifest.yaml");
      const now = new Date().toISOString();
      await writeFile(
        manifestPath,
        `version: "1.0.0"
project:
  name: Test Model
  version: "1.0.0"
created: ${now}
modified: ${now}
`
      );

      // Load from the model directory (non-standard structure)
      const model = await Model.load(modelDir);
      expect(model).toBeDefined();
      expect(model.manifest.name).toBe("Test Model");
    });

    it("should throw error when manifest file cannot be found at startPath", async () => {
      // Attempt to load from a path that doesn't contain a manifest
      // This should result in "Model not found" error, not a permission error
      try {
        await Model.load("/nonexistent/path/that/does/not/exist");
        expect.unreachable("Should have thrown error");
      } catch (err) {
        // Should get model not found error since path doesn't exist
        expect((err as Error).message).toContain("Model not found");
      }
    });
  });

  describe("DR_MODEL_PATH branch", () => {
    it("should silently handle ENOENT errors with DR_MODEL_PATH env var", async () => {
      const { mkdir, writeFile } = await import("fs/promises");
      const path = await import("path");

      const testDir = `${tmpdir()}/dr-env-test-${randomUUID()}`;
      // Create non-standard structure: model/ at root with manifest inside
      const modelDir = path.join(testDir, "model");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = path.join(modelDir, "manifest.yaml");
      const now = new Date().toISOString();
      await writeFile(
        manifestPath,
        `version: "1.0.0"
project:
  name: Test Model
  version: "1.0.0"
created: ${now}
modified: ${now}
`
      );

      const oldEnv = process.env.DR_MODEL_PATH;
      try {
        // Point DR_MODEL_PATH to the model directory (non-standard structure)
        process.env.DR_MODEL_PATH = modelDir;
        // Should succeed with non-standard structure (ENOENT for standard structure ignored)
        const model = await Model.load();
        expect(model).toBeDefined();
        expect(model.manifest.name).toBe("Test Model");
      } finally {
        process.env.DR_MODEL_PATH = oldEnv;
      }
    });

    it("should throw error when manifest file cannot be found at DR_MODEL_PATH", async () => {
      const oldEnv = process.env.DR_MODEL_PATH;
      try {
        process.env.DR_MODEL_PATH = "/nonexistent/path/that/does/not/exist";
        await Model.load();
        expect.unreachable("Should have thrown error");
      } catch (err) {
        // Should get model not found error
        expect((err as Error).message).toContain("Model not found");
      } finally {
        process.env.DR_MODEL_PATH = oldEnv;
      }
    });
  });
});
