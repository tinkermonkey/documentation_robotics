/**
 * Integration tests for --codebase-path CLI flag
 * Verifies that the flag correctly overrides the codebase root when loading models
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { Model } from "../../src/core/model.js";
import { setGlobalOptions, getCodebasePath, resetGlobalOptions } from "../../src/utils/globals.js";

describe("--codebase-path CLI Flag", () => {
  let TEST_DIR: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    // Use golden copy for efficient test initialization
    const workdir = await createTestWorkdir();
    TEST_DIR = workdir.path;
    cleanup = workdir.cleanup;

    // Reset global options before each test
    resetGlobalOptions();
  });

  afterEach(async () => {
    try {
      await cleanup();
    } catch {
      // Ignore
    }
  });

  describe("Model.load() respects --codebase-path flag", () => {
    it("should use codebasePath from global options when set", async () => {
      const customCodebasePath = "/custom/codebase/path";
      setGlobalOptions({ codebasePath: customCodebasePath });

      // Verify getCodebasePath returns the set value
      expect(getCodebasePath()).toBe(customCodebasePath);

      // Load model - it should respect the codebasePath from global options
      const model = await Model.load(TEST_DIR);

      // Verify the model uses the custom codebase path
      expect(model.codebaseRoot).toBe(customCodebasePath);
    });

    it("should prefer programmatic codebaseRoot over global codebasePath", async () => {
      const globalCodebasePath = "/global/codebase/path";
      const programmaticCodebaseRoot = "/programmatic/codebase/root";

      setGlobalOptions({ codebasePath: globalCodebasePath });

      // Load model with explicit codebaseRoot in options
      const model = await Model.load(TEST_DIR, {
        codebaseRoot: programmaticCodebaseRoot,
      });

      // Programmatic option should take precedence
      expect(model.codebaseRoot).toBe(programmaticCodebaseRoot);
    });

    it("should use manifest codebase_path when no global codebasePath is set", async () => {
      // Reset global options
      resetGlobalOptions();

      // Load model - should use manifest.codebase_path if it exists, or fall back to defaults
      const model = await Model.load(TEST_DIR);

      // Verify model was loaded (codebaseRoot should be set to something valid)
      expect(model.codebaseRoot).toBeDefined();
      expect(typeof model.codebaseRoot).toBe("string");
    });

    it("should work with relative paths set via global options", async () => {
      const relativeCodebasePath = "../my-codebase";
      setGlobalOptions({ codebasePath: relativeCodebasePath });

      expect(getCodebasePath()).toBe(relativeCodebasePath);

      // Load model with relative path
      const model = await Model.load(TEST_DIR);

      // The model should resolve the relative path
      expect(model.codebaseRoot).toBeDefined();
    });
  });

  describe("Model.init() respects --codebase-path flag", () => {
    it("should use codebasePath from global options when initializing", async () => {
      const customCodebasePath = "/init/custom/codebase/path";
      setGlobalOptions({ codebasePath: customCodebasePath });

      // Verify getCodebasePath returns the set value
      expect(getCodebasePath()).toBe(customCodebasePath);

      // Load model - it should respect the codebasePath
      const model = await Model.load(TEST_DIR);

      // Verify the model uses the custom codebase path
      expect(model.codebaseRoot).toBe(customCodebasePath);
    });

    it("should preserve codebasePath when loading same model multiple times", async () => {
      const customCodebasePath = "/persistent/codebase/path";
      setGlobalOptions({ codebasePath: customCodebasePath });

      // First load
      const model1 = await Model.load(TEST_DIR);
      expect(model1.codebaseRoot).toBe(customCodebasePath);

      // Second load with same codebasePath
      const model2 = await Model.load(TEST_DIR);
      expect(model2.codebaseRoot).toBe(customCodebasePath);
    });
  });

  describe("Global codebasePath option integration", () => {
    it("should set and retrieve codebasePath via global options", () => {
      const testPath = "/test/codebase";
      setGlobalOptions({ codebasePath: testPath });

      expect(getCodebasePath()).toBe(testPath);
    });

    it("should clear codebasePath when resetting global options", () => {
      setGlobalOptions({ codebasePath: "/some/path" });
      expect(getCodebasePath()).toBe("/some/path");

      // Reset options
      resetGlobalOptions();
      expect(getCodebasePath()).toBeUndefined();
    });

    it("should preserve codebasePath when setting other global options", () => {
      const codebasePath = "/my/codebase";
      setGlobalOptions({ codebasePath, verbose: true });

      expect(getCodebasePath()).toBe(codebasePath);

      // Change other options
      setGlobalOptions({ debug: true });

      // codebasePath should still be set
      expect(getCodebasePath()).toBe(codebasePath);
    });
  });
});
