/**
 * Unit tests for error handling utilities in JSON mode
 * Tests handleError and handleWarning respect JSON mode
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CLIError, ValidationError, ErrorCategory, handleError, handleWarning, handleSuccess, handleInfo } from "../../src/utils/errors.js";

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
    it("should emit structured JSON to stderr when isJson() returns true", async () => {
      // Temporarily set JSON mode
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(true);

      handleWarning("This is a test warning");

      // In JSON mode, warning should be emitted to stderr as JSON
      expect(capturedWarnings.length).toBe(0);
      expect(capturedErrors.length).toBe(1);
      const json = JSON.parse(capturedErrors[0]);
      expect(json.level).toBe("warning");
      expect(json.message).toBe("This is a test warning");

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

  describe("handleInfo in JSON mode (regression test)", () => {
    it("should emit structured JSON to stderr with level, message, and details", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(true);

      handleInfo("Auto-commit failed", { commit_id: "abc123", error_code: "EACCES" });

      // In JSON mode, info should be emitted to stderr (not stdout)
      expect(capturedErrors.length).toBe(1);
      expect(capturedLogs.length).toBe(0);

      const json = JSON.parse(capturedErrors[0]);
      expect(json.level).toBe("info");
      expect(json.message).toBe("Auto-commit failed");
      expect(json.details.commit_id).toBe("abc123");
      expect(json.details.error_code).toBe("EACCES");

      setJsonMode(false);
    });

    it("should emit structured JSON to stderr without details if not provided", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(true);

      handleInfo("Progress update");

      expect(capturedErrors.length).toBe(1);
      const json = JSON.parse(capturedErrors[0]);
      expect(json.level).toBe("info");
      expect(json.message).toBe("Progress update");
      expect(json.details).toBeUndefined();

      setJsonMode(false);
    });

    it("should output text info messages to stdout in text mode", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(false);

      handleInfo("Progress update", { step: "1", total: "5" });

      expect(capturedLogs.length).toBeGreaterThan(0);
      expect(capturedLogs[0]).toContain("Progress update");

      setJsonMode(false);
    });
  });

  describe("handleSuccess status override protection (regression test)", () => {
    it("should ensure status is always 'ok' in JSON mode even if details contains status", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(true);

      handleSuccess("Operation completed", { status: "overridden", data: "value" });

      expect(capturedLogs.length).toBe(1);
      const json = JSON.parse(capturedLogs[0]);
      expect(json.status).toBe("ok");
      expect(json.data).toBe("value");

      setJsonMode(false);
    });

    it("should preserve other details while ensuring status is 'ok'", async () => {
      const { setJsonMode } = await import("../../src/utils/globals.js");
      setJsonMode(true);

      handleSuccess("Element created", { elementId: "motivation.goal.test", created_at: "2024-01-01" });

      expect(capturedLogs.length).toBe(1);
      const json = JSON.parse(capturedLogs[0]);
      expect(json.status).toBe("ok");
      expect(json.elementId).toBe("motivation.goal.test");
      expect(json.created_at).toBe("2024-01-01");

      setJsonMode(false);
    });
  });

  describe("ANSI suppressor independent TTY checks (regression test)", () => {
    it("should suppress ANSI codes from stdout when stdout is not a TTY", async () => {
      const { installAnsiSuppressor } = await import("../../src/utils/ansi-suppressor.js");

      // Save original TTY state
      const origStdoutIsTTY = process.stdout.isTTY;
      const origStderrIsTTY = process.stderr.isTTY;

      try {
        // Mock stdout as non-TTY, stderr as TTY
        Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true, configurable: true });
        Object.defineProperty(process.stderr, "isTTY", { value: true, writable: true, configurable: true });

        installAnsiSuppressor();

        // ANSI color code
        const coloredText = "\x1b[32mGreen text\x1b[0m";

        console.log(coloredText);
        expect(capturedLogs[0]).toBe("Green text");

        // stderr should retain ANSI codes
        capturedErrors = [];
        console.error(coloredText);
        expect(capturedErrors[0]).toBe(coloredText);
      } finally {
        // Restore original TTY state
        Object.defineProperty(process.stdout, "isTTY", { value: origStdoutIsTTY, writable: true, configurable: true });
        Object.defineProperty(process.stderr, "isTTY", { value: origStderrIsTTY, writable: true, configurable: true });
      }
    });

    it("should suppress ANSI codes from stderr when stderr is not a TTY", async () => {
      const { installAnsiSuppressor } = await import("../../src/utils/ansi-suppressor.js");

      // Save original TTY state
      const origStdoutIsTTY = process.stdout.isTTY;
      const origStderrIsTTY = process.stderr.isTTY;

      try {
        // Mock stdout as TTY, stderr as non-TTY
        Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true, configurable: true });
        Object.defineProperty(process.stderr, "isTTY", { value: false, writable: true, configurable: true });

        installAnsiSuppressor();

        // ANSI color code
        const coloredText = "\x1b[31mRed text\x1b[0m";

        // stdout should retain ANSI codes
        console.log(coloredText);
        expect(capturedLogs[0]).toBe(coloredText);

        // stderr should strip ANSI codes
        capturedErrors = [];
        console.error(coloredText);
        expect(capturedErrors[0]).toBe("Red text");
      } finally {
        // Restore original TTY state
        Object.defineProperty(process.stdout, "isTTY", { value: origStdoutIsTTY, writable: true, configurable: true });
        Object.defineProperty(process.stderr, "isTTY", { value: origStderrIsTTY, writable: true, configurable: true });
      }
    });
  });
});
