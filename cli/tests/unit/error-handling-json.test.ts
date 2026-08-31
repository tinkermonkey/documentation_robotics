/**
 * Unit tests for error handling utilities in JSON mode
 * Tests handleError and handleWarning respect JSON mode
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CLIError, ValidationError, ErrorCategory, handleError, handleWarning } from "../../src/utils/errors.js";

// Mock console methods to capture output
let capturedLogs: string[] = [];
let capturedWarnings: string[] = [];
let capturedErrors: string[] = [];

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

beforeEach(() => {
  capturedLogs = [];
  capturedWarnings = [];
  capturedErrors = [];

  console.log = (...args: unknown[]) => {
    capturedLogs.push(args.map(a => String(a)).join(" "));
  };

  console.warn = (...args: unknown[]) => {
    capturedWarnings.push(args.map(a => String(a)).join(" "));
  };

  console.error = (...args: unknown[]) => {
    capturedErrors.push(args.map(a => String(a)).join(" "));
  };
});

afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
});

describe("Error Handling in JSON Mode", () => {
  describe("handleWarning in JSON mode", () => {
    it("should suppress warnings when isJson() returns true", async () => {
      // Temporarily set JSON mode
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(true);

      handleWarning("This is a test warning");

      // In JSON mode, warning should be suppressed (no output)
      expect(capturedWarnings.length).toBe(0);
      expect(capturedErrors.length).toBe(0);

      setJsonMode(false);
    });

    it("should output warnings when not in JSON mode", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(false);

      handleWarning("This is a test warning");

      // In text mode, warning should be output
      expect(capturedWarnings.length).toBeGreaterThan(0);
      expect(capturedWarnings[0]).toContain("This is a test warning");

      setJsonMode(false);
    });

    it("should include suggestions in text mode output", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(false);

      handleWarning("Test warning", ["Suggestion 1", "Suggestion 2"]);

      const output = capturedWarnings.join("\n");
      expect(output).toContain("Test warning");
      expect(output).toContain("Suggestion 1");
      expect(output).toContain("Suggestion 2");

      setJsonMode(false);
    });
  });

  describe("handleError with CLIError in JSON mode", () => {
    it("should output structured JSON with CLIError in JSON mode", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(true);

      const error = new CLIError(
        "Test error message",
        ErrorCategory.USER,
        ["Suggestion 1", "Suggestion 2"],
        { operation: "test-op" }
      );

      try {
        handleError(error);
      } catch {
        // handleError throws after logging
      }

      expect(capturedLogs.length).toBe(1);
      const json = JSON.parse(capturedLogs[0]);
      expect(json.status).toBe("error");
      expect(json.code).toBe(ErrorCategory.USER);
      expect(json.message).toBe("Test error message");
      expect(json.suggestions).toContain("Suggestion 1");
      expect(json.operation).toBe("test-op");
      // Should not contain ANSI codes
      expect(capturedLogs[0]).not.toContain("\x1b");

      setJsonMode(false);
    });

    it("should output formatted text with CLIError in text mode", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(false);

      const error = new CLIError(
        "Test error message",
        ErrorCategory.VALIDATION,
        ["Suggestion 1"],
        { operation: "test-op" }
      );

      try {
        handleError(error);
      } catch {
        // handleError throws after logging
      }

      expect(capturedErrors.length).toBeGreaterThan(0);
      const output = capturedErrors.join("\n");
      expect(output).toContain("Error: Test error message");
      expect(output).toContain("During: test-op");
      expect(output).toContain("Suggestion 1");

      setJsonMode(false);
    });

    it("should include partialProgress in JSON output when available", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(true);

      const error = new CLIError(
        "Cascade delete failed",
        ErrorCategory.SYSTEM,
        [],
        {
          operation: "delete",
          partialProgress: { completed: 5, total: 10 }
        }
      );

      try {
        handleError(error);
      } catch {
        // handleError throws after logging
      }

      const json = JSON.parse(capturedLogs[0]);
      expect(json.partialProgress.completed).toBe(5);
      expect(json.partialProgress.total).toBe(10);

      setJsonMode(false);
    });

    it("should include relatedElements in JSON output when available", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(true);

      const error = new CLIError(
        "Element has dependencies",
        ErrorCategory.USER,
        [],
        {
          relatedElements: ["elem1", "elem2", "elem3"]
        }
      );

      try {
        handleError(error);
      } catch {
        // handleError throws after logging
      }

      const json = JSON.parse(capturedLogs[0]);
      expect(json.relatedElements).toEqual(["elem1", "elem2", "elem3"]);

      setJsonMode(false);
    });
  });

  describe("handleError with generic Error in JSON mode", () => {
    it("should output structured JSON with generic Error in JSON mode", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(true);

      const error = new Error("Generic error message");

      try {
        handleError(error);
      } catch {
        // handleError throws after logging
      }

      expect(capturedLogs.length).toBe(1);
      const json = JSON.parse(capturedLogs[0]);
      expect(json.status).toBe("error");
      expect(json.code).toBe(ErrorCategory.USER);
      expect(json.message).toBe("Generic error message");

      setJsonMode(false);
    });
  });

  describe("handleError with unknown error in JSON mode", () => {
    it("should output structured JSON with unknown error", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(true);

      try {
        handleError("Unknown error string");
      } catch {
        // handleError throws after logging
      }

      expect(capturedLogs.length).toBe(1);
      const json = JSON.parse(capturedLogs[0]);
      expect(json.status).toBe("error");
      expect(json.message).toBe("An unexpected error occurred");

      setJsonMode(false);
    });
  });

  describe("ValidationError in JSON mode", () => {
    it("should output structured JSON with ValidationError", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(true);

      const error = new ValidationError(
        "Validation failed",
        [
          { layer: "motivation", elementId: "mot.goal.test", message: "Invalid type" },
          { layer: "business", elementId: "bus.process.test", message: "Missing name" }
        ],
        ["Fix the validation errors and retry"]
      );

      try {
        handleError(error);
      } catch {
        // handleError throws after logging
      }

      const json = JSON.parse(capturedLogs[0]);
      expect(json.status).toBe("error");
      expect(json.message).toBe("Validation failed");
      expect(json.suggestions).toContain("Fix the validation errors and retry");

      setJsonMode(false);
    });
  });

  describe("No redundant output in text mode", () => {
    it("should output only single success message when handleSuccess is called", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      const { handleSuccess } = await import("../../src/utils/errors.js");

      setJsonMode(false);

      handleSuccess("Operation completed", { status: "done" });

      // Should have exactly one log (the success message)
      expect(capturedLogs.length).toBe(1);
      expect(capturedLogs[0]).toContain("Operation completed");

      setJsonMode(false);
    });
  });
});
