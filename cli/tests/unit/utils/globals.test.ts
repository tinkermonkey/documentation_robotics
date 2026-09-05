/**
 * Tests for global options utilities
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { setGlobalOptions, getGlobalOptions, getCodebasePath, resetGlobalOptions } from "../../../src/utils/globals.js";

describe("Global Options Utilities", () => {
  beforeEach(() => {
    // Reset global options before each test
    resetGlobalOptions();
  });

  describe("getCodebasePath", () => {
    it("should return undefined when codebasePath is not set", () => {
      const result = getCodebasePath();
      expect(result).toBeUndefined();
    });

    it("should return the codebasePath when set via setGlobalOptions", () => {
      const testPath = "/some/codebase/path";
      setGlobalOptions({ codebasePath: testPath });

      const result = getCodebasePath();
      expect(result).toBe(testPath);
    });

    it("should return different paths when changed", () => {
      const firstPath = "/first/path";
      const secondPath = "/second/path";

      setGlobalOptions({ codebasePath: firstPath });
      expect(getCodebasePath()).toBe(firstPath);

      setGlobalOptions({ codebasePath: secondPath });
      expect(getCodebasePath()).toBe(secondPath);
    });

    it("should work with relative paths", () => {
      const relativePath = "../my-codebase";
      setGlobalOptions({ codebasePath: relativePath });

      const result = getCodebasePath();
      expect(result).toBe(relativePath);
    });

    it("should preserve codebasePath when other options are set", () => {
      const codebasePath = "/my/codebase";
      setGlobalOptions({ codebasePath, verbose: true });

      const result = getCodebasePath();
      expect(result).toBe(codebasePath);

      // Verify other options are also preserved
      const allOptions = getGlobalOptions();
      expect(allOptions.verbose).toBe(true);
    });
  });

  describe("setGlobalOptions and getGlobalOptions", () => {
    it("should set and retrieve multiple options", () => {
      const options = {
        verbose: true,
        debug: true,
        json: false,
        codebasePath: "/test/path",
      };

      setGlobalOptions(options);
      const retrieved = getGlobalOptions();

      expect(retrieved.verbose).toBe(true);
      expect(retrieved.debug).toBe(true);
      expect(retrieved.json).toBe(false);
      expect(retrieved.codebasePath).toBe("/test/path");
    });

    it("should merge options instead of replacing them", () => {
      setGlobalOptions({ verbose: true });
      setGlobalOptions({ codebasePath: "/path" });

      const options = getGlobalOptions();
      expect(options.verbose).toBe(true);
      expect(options.codebasePath).toBe("/path");
    });

    it("should return a copy of global options", () => {
      setGlobalOptions({ codebasePath: "/original" });

      const retrieved1 = getGlobalOptions();
      const retrieved2 = getGlobalOptions();

      expect(retrieved1).not.toBe(retrieved2);
      expect(retrieved1).toEqual(retrieved2);
    });
  });
});
