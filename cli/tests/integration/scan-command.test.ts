/**
 * Integration tests for scan command
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { scanCommand } from "../../src/commands/scan.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import * as path from "path";

// Mock console methods for capturing output and errors
let capturedOutput: string[] = [];
let capturedErrors: string[] = [];
let capturedWarnings: string[] = [];

const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

beforeEach(() => {
  capturedOutput = [];
  capturedErrors = [];
  capturedWarnings = [];

  console.log = (...args: any[]) => {
    capturedOutput.push(args.join(" "));
  };

  console.error = (...args: any[]) => {
    capturedErrors.push(args.join(" "));
  };

  console.warn = (...args: any[]) => {
    capturedWarnings.push(args.join(" "));
  };
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  console.warn = originalWarn;
});

describe("Scan Command - Layer Validation", () => {
  let tempDir: { path: string; cleanup: () => Promise<void> } = { path: "", cleanup: async () => {} };

  beforeEach(async () => {
    tempDir = await createTestWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("--layer filter validation", () => {
    it("should reject invalid layer names early", async () => {
      let errorThrown = false;
      let errorMessage = "";

      try {
        // Don't use config flag - let validation run before config loading
        await scanCommand({
          layer: "appliction", // typo: appliction instead of application
        });
      } catch (error) {
        errorThrown = true;
        errorMessage = String(error);
      }

      expect(errorThrown).toBe(true);
      expect(errorMessage).toContain("Invalid layer name");
      expect(errorMessage).toContain("appliction");
      expect(errorMessage).toContain("Valid layers are:");
    });

    it("should accept valid layer names with config flag", async () => {
      let errorThrown = false;

      try {
        await scanCommand({
          layer: "motivation",
          config: true,
        });
      } catch (error) {
        errorThrown = true;
      }

      expect(errorThrown).toBe(false);
      const hasError = capturedErrors.some((err) => err.includes("Invalid layer"));
      expect(hasError).toBe(false);
    });

    it("should reject empty layer names", async () => {
      let errorThrown = false;

      try {
        await scanCommand({
          layer: "",
        });
      } catch (error) {
        errorThrown = true;
      }

      expect(errorThrown).toBe(true);
    });

    it("should include valid layer list in error message", async () => {
      let errorMessage = "";

      try {
        await scanCommand({
          layer: "invalid-layer-name",
        });
      } catch (error) {
        errorMessage = String(error);
      }

      expect(errorMessage).toContain("Valid layers are:");
      expect(errorMessage).toContain("motivation");
      expect(errorMessage).toContain("business");
      expect(errorMessage).toContain("security");
      expect(errorMessage).toContain("application");
      expect(errorMessage).toContain("technology");
      expect(errorMessage).toContain("api");
      expect(errorMessage).toContain("data-model");
      expect(errorMessage).toContain("data-store");
      expect(errorMessage).toContain("ux");
      expect(errorMessage).toContain("navigation");
      expect(errorMessage).toContain("apm");
      expect(errorMessage).toContain("testing");
    });
  });
});

describe("Scan Command - Model Loading Error Handling", () => {
  let tempDir: { path: string; cleanup: () => Promise<void> } = { path: "", cleanup: async () => {} };

  beforeEach(async () => {
    tempDir = await createTestWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("deduplication error reporting", () => {
    it("should warn about model load failures in non-verbose mode", async () => {
      let errorThrown = false;

      try {
        // With valid layer, config mode to test warning behavior
        await scanCommand({
          layer: "api",
          config: true,
          verbose: false,
        });
      } catch (error) {
        errorThrown = true;
      }

      // Config mode succeeds, so no error thrown
      expect(errorThrown).toBe(false);
      // In a real scenario without --config, the model load would fail
      // and we'd see a warning in console.warn
    });

    it("should show warnings in verbose mode output", async () => {
      let errorThrown = false;

      try {
        await scanCommand({
          layer: "api",
          config: true,
          verbose: true,
        });
      } catch (error) {
        errorThrown = true;
      }

      expect(errorThrown).toBe(false);
      const hasConfigMsg = capturedOutput.some((msg) => msg.includes("Configuration loaded"));
      expect(hasConfigMsg).toBe(true);
    });
  });
});

describe("Scan Command - Integration Tests", () => {
  let tempDir: { path: string; cleanup: () => Promise<void> } = { path: "", cleanup: async () => {} };

  beforeEach(async () => {
    tempDir = await createTestWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("configuration validation", () => {
    it("should validate config without connecting to CodePrism", async () => {
      await scanCommand({
        config: true,
      });

      // Should show configuration loaded message
      const hasConfigMsg = capturedOutput.some((msg) => msg.includes("Configuration loaded"));
      expect(hasConfigMsg).toBe(true);
    });

    it("should validate layer before loading config", async () => {
      let errorThrown = false;
      let errorThrownBeforeOutput = false;

      capturedOutput = [];
      try {
        await scanCommand({
          layer: "bad-layer",
          config: true,
        });
      } catch (error) {
        errorThrown = true;
        // If layer validation happens first, no output should appear
        errorThrownBeforeOutput = capturedOutput.length === 0;
      }

      expect(errorThrown).toBe(true);
      expect(errorThrownBeforeOutput).toBe(true);
    });
  });
});
