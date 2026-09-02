/**
 * Dual-Root Foundation Tests
 *
 * Tests for Phase 1: Model with optional codebaseRoot for detached model layout.
 * Validates that both co-located (existing) and detached (new) modes work correctly.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Model } from "../../src/core/model.js";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import yaml from "yaml";

const TEST_DIR = "/tmp/dr-dual-root-test";

describe("Dual-Root Foundation", () => {
  beforeAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("Co-located Mode (Existing Behavior)", () => {
    it("should load model with codebaseRoot defaulting to rootPath", async () => {
      const modelRoot = join(TEST_DIR, "co-located-model");
      const model = await Model.init(modelRoot, {
        name: "Co-located Test Model",
        version: "0.1.0",
        specVersion: "0.6.0",
      });

      expect(model.rootPath).toBe(modelRoot);
      expect(model.codebaseRoot).toBe(modelRoot);
    });

    it("should persist and reload model with codebaseRoot == rootPath", async () => {
      const modelRoot = join(TEST_DIR, "co-located-reload");
      const initialModel = await Model.init(modelRoot, {
        name: "Co-located Reload Test",
        version: "0.1.0",
        specVersion: "0.6.0",
      });

      // Save and reload
      await initialModel.saveManifest();
      const reloadedModel = await Model.load(modelRoot);

      expect(reloadedModel.rootPath).toBe(modelRoot);
      expect(reloadedModel.codebaseRoot).toBe(modelRoot);
      expect(reloadedModel.manifest.name).toBe("Co-located Reload Test");
    });
  });

  describe("Detached Mode with Manifest codebase_path", () => {
    it("should resolve codebaseRoot from manifest.codebase_path", async () => {
      const farmRoot = join(TEST_DIR, "detached-farm");
      const modelRoot = join(farmRoot, "service-a-model");
      const codebaseRoot = join(farmRoot, "service-a");

      // Create directory structure
      await mkdir(modelRoot, { recursive: true });
      await mkdir(codebaseRoot, { recursive: true });

      // Initialize model with relative codebase_path
      const model = await Model.init(
        modelRoot,
        {
          name: "Detached Service Model",
          version: "0.1.0",
          specVersion: "0.6.0",
          codebase_path: "../service-a",
        }
      );

      // Verify codebaseRoot is resolved correctly
      expect(model.rootPath).toBe(modelRoot);
      expect(model.codebaseRoot).toBe(codebaseRoot);
    });

    it("should persist and reload detached model with codebase_path", async () => {
      const farmRoot = join(TEST_DIR, "detached-reload-farm");
      const modelRoot = join(farmRoot, "service-b-model");
      const codebaseRoot = join(farmRoot, "service-b");

      // Create directory structure
      await mkdir(modelRoot, { recursive: true });
      await mkdir(codebaseRoot, { recursive: true });

      // Initialize model
      const initialModel = await Model.init(
        modelRoot,
        {
          name: "Detached Reload Test",
          version: "0.1.0",
          specVersion: "0.6.0",
          codebase_path: "../service-b",
        }
      );

      // Verify initialization
      expect(initialModel.codebaseRoot).toBe(codebaseRoot);
      expect(initialModel.manifest.codebase_path).toBe("../service-b");

      // Save and reload
      await initialModel.saveManifest();
      const reloadedModel = await Model.load(modelRoot);

      // Verify reload preserves codebaseRoot
      expect(reloadedModel.rootPath).toBe(modelRoot);
      expect(reloadedModel.codebaseRoot).toBe(codebaseRoot);
      expect(reloadedModel.manifest.codebase_path).toBe("../service-b");
      expect(reloadedModel.manifest.name).toBe("Detached Reload Test");
    });

    it("should include codebase_path in manifest serialization", async () => {
      const farmRoot = join(TEST_DIR, "detached-serialize");
      const modelRoot = join(farmRoot, "service-c-model");
      const codebaseRoot = join(farmRoot, "service-c");

      await mkdir(modelRoot, { recursive: true });
      await mkdir(codebaseRoot, { recursive: true });

      const model = await Model.init(
        modelRoot,
        {
          name: "Serialize Test",
          version: "0.1.0",
          specVersion: "0.6.0",
          codebase_path: "../service-c",
        }
      );

      const manifestJson = model.manifest.toJSON();
      expect(manifestJson.codebase_path).toBe("../service-c");
    });

    it("should support nested relative paths in codebase_path", async () => {
      const farmRoot = join(TEST_DIR, "detached-nested");
      const modelRoot = join(farmRoot, "models", "service-d-model");
      const codebaseRoot = join(farmRoot, "codebases", "service-d");

      await mkdir(modelRoot, { recursive: true });
      await mkdir(codebaseRoot, { recursive: true });

      const model = await Model.init(
        modelRoot,
        {
          name: "Nested Path Test",
          version: "0.1.0",
          specVersion: "0.6.0",
          codebase_path: "../../codebases/service-d",
        }
      );

      expect(model.codebaseRoot).toBe(codebaseRoot);
    });
  });

  describe("Detached Mode with Options Override", () => {
    it("should use codebaseRoot from options when provided", async () => {
      const modelRoot = join(TEST_DIR, "options-override-model");
      const explicitCodebaseRoot = join(TEST_DIR, "custom-codebase");

      await mkdir(modelRoot, { recursive: true });
      await mkdir(explicitCodebaseRoot, { recursive: true });

      const model = await Model.init(
        modelRoot,
        {
          name: "Options Override Test",
          version: "0.1.0",
          specVersion: "0.6.0",
        },
        { codebaseRoot: explicitCodebaseRoot }
      );

      expect(model.rootPath).toBe(modelRoot);
      expect(model.codebaseRoot).toBe(explicitCodebaseRoot);
    });

    it("should prioritize options.codebaseRoot over manifest.codebase_path", async () => {
      const modelRoot = join(TEST_DIR, "priority-test-model");
      const manifestCodebase = join(TEST_DIR, "manifest-codebase");
      const optionsCodebase = join(TEST_DIR, "options-codebase");

      await mkdir(modelRoot, { recursive: true });
      await mkdir(manifestCodebase, { recursive: true });
      await mkdir(optionsCodebase, { recursive: true });

      const model = await Model.init(
        modelRoot,
        {
          name: "Priority Test",
          version: "0.1.0",
          specVersion: "0.6.0",
          codebase_path: "../manifest-codebase",
        },
        { codebaseRoot: optionsCodebase }
      );

      expect(model.codebaseRoot).toBe(optionsCodebase);
    });
  });

  describe("Manifest YAML Serialization", () => {
    it("should write codebase_path to manifest YAML", async () => {
      const farmRoot = join(TEST_DIR, "yaml-write");
      const modelRoot = join(farmRoot, "model");
      const codebaseRoot = join(farmRoot, "code");

      await mkdir(modelRoot, { recursive: true });
      await mkdir(codebaseRoot, { recursive: true });

      const model = await Model.init(
        modelRoot,
        {
          name: "YAML Write Test",
          version: "0.1.0",
          specVersion: "0.6.0",
          codebase_path: "../code",
        }
      );

      await model.saveManifest();

      // Read the manifest YAML file directly
      const manifestPath = join(modelRoot, "documentation-robotics", "model", "manifest.yaml");
      const manifestContent = await Bun.file(manifestPath).text();
      const manifestYaml = yaml.parse(manifestContent);

      expect(manifestYaml.codebase_path).toBe("../code");
    });

    it("should not write codebase_path to manifest if not set", async () => {
      const modelRoot = join(TEST_DIR, "yaml-no-write");

      await mkdir(modelRoot, { recursive: true });

      const model = await Model.init(
        modelRoot,
        {
          name: "YAML No Write Test",
          version: "0.1.0",
          specVersion: "0.6.0",
        }
      );

      await model.saveManifest();

      const manifestPath = join(modelRoot, "documentation-robotics", "model", "manifest.yaml");
      const manifestContent = await Bun.file(manifestPath).text();
      const manifestYaml = yaml.parse(manifestContent);

      expect(manifestYaml.codebase_path).toBeUndefined();
    });
  });

  describe("Load with Manifest codebase_path", () => {
    it("should load model and resolve codebaseRoot from manifest", async () => {
      const farmRoot = join(TEST_DIR, "load-manifest");
      const modelRoot = join(farmRoot, "app-model");
      const codebaseRoot = join(farmRoot, "app");

      await mkdir(modelRoot, { recursive: true });
      await mkdir(codebaseRoot, { recursive: true });

      // Create initial model
      const model = await Model.init(
        modelRoot,
        {
          name: "Load Manifest Test",
          version: "0.1.0",
          specVersion: "0.6.0",
          codebase_path: "../app",
        }
      );
      await model.saveManifest();

      // Load from disk
      const loadedModel = await Model.load(modelRoot);

      expect(loadedModel.codebaseRoot).toBe(codebaseRoot);
      expect(loadedModel.manifest.codebase_path).toBe("../app");
    });

    it("should load model from sibling directory with detached layout", async () => {
      const farmRoot = join(TEST_DIR, "sibling-layout");
      const modelRoot = join(farmRoot, "project-model");
      const codebaseRoot = join(farmRoot, "project-source");

      await mkdir(modelRoot, { recursive: true });
      await mkdir(codebaseRoot, { recursive: true });

      const model = await Model.init(
        modelRoot,
        {
          name: "Sibling Layout Test",
          version: "0.1.0",
          specVersion: "0.6.0",
          codebase_path: "../project-source",
        }
      );
      await model.saveManifest();

      const loadedModel = await Model.load(modelRoot);

      expect(loadedModel.rootPath).toBe(modelRoot);
      expect(loadedModel.codebaseRoot).toBe(codebaseRoot);
    });
  });
});
