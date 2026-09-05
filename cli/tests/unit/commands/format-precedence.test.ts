import { describe, it, expect } from "bun:test";
import path from "node:path";

/**
 * Tests for format precedence logic in audit commands
 *
 * This tests the logic pattern used in both audit.ts and audit-diff.ts
 * to ensure explicit --format flags take precedence over file extension auto-detection.
 */
describe("format precedence logic", () => {
  /**
   * Simulates the format detection logic from audit.ts and audit-diff.ts
   */
  function determineFormat(
    explicitFormat: string | undefined,
    outputPath: string | undefined
  ): "text" | "json" | "markdown" {
    let format: "text" | "json" | "markdown" = "text";

    if (explicitFormat) {
      // User explicitly specified format - use it
      format = explicitFormat as "text" | "json" | "markdown";
    } else if (outputPath) {
      // No explicit format - auto-detect from file extension
      const ext = path.extname(outputPath).toLowerCase();
      if (ext === ".json") {
        format = "json";
      } else if (ext === ".md") {
        format = "markdown";
      }
    }

    return format;
  }

  describe("explicit format takes precedence", () => {
    it("should use explicit 'json' format even with .md extension", () => {
      const format = determineFormat("json", "report.md");
      expect(format).toBe("json");
    });

    it("should use explicit 'markdown' format even with .json extension", () => {
      const format = determineFormat("markdown", "report.json");
      expect(format).toBe("markdown");
    });

    it("should use explicit 'text' format even with .json extension", () => {
      const format = determineFormat("text", "report.json");
      expect(format).toBe("text");
    });

    it("should use explicit 'text' format even with .md extension", () => {
      const format = determineFormat("text", "report.md");
      expect(format).toBe("text");
    });

    it("should use explicit 'json' format even with .txt extension", () => {
      const format = determineFormat("json", "report.txt");
      expect(format).toBe("json");
    });

    it("should use explicit 'markdown' format even with .txt extension", () => {
      const format = determineFormat("markdown", "report.txt");
      expect(format).toBe("markdown");
    });
  });

  describe("auto-detection from file extension", () => {
    it("should auto-detect 'json' from .json extension when no explicit format", () => {
      const format = determineFormat(undefined, "report.json");
      expect(format).toBe("json");
    });

    it("should auto-detect 'markdown' from .md extension when no explicit format", () => {
      const format = determineFormat(undefined, "report.md");
      expect(format).toBe("markdown");
    });

    it("should default to 'text' with .txt extension when no explicit format", () => {
      const format = determineFormat(undefined, "report.txt");
      expect(format).toBe("text");
    });

    it("should default to 'text' with no extension when no explicit format", () => {
      const format = determineFormat(undefined, "report");
      expect(format).toBe("text");
    });

    it("should default to 'text' with unknown extension when no explicit format", () => {
      const format = determineFormat(undefined, "report.pdf");
      expect(format).toBe("text");
    });
  });

  describe("no output file", () => {
    it("should default to 'text' when no format and no output file", () => {
      const format = determineFormat(undefined, undefined);
      expect(format).toBe("text");
    });

    it("should use explicit format when no output file", () => {
      expect(determineFormat("json", undefined)).toBe("json");
      expect(determineFormat("markdown", undefined)).toBe("markdown");
      expect(determineFormat("text", undefined)).toBe("text");
    });
  });
});
