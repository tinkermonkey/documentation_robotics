import { describe, it, expect } from "bun:test";
import { escapeMarkdown, valueToMarkdown, getLayerDescription, LAYER_DESCRIPTIONS } from "@/export/markdown-utils";

describe("markdown-utils", () => {
  describe("escapeMarkdown", () => {
    it("should escape backslashes", () => {
      expect(escapeMarkdown("test\\path")).toBe("test\\\\path");
    });

    it("should escape pipe characters", () => {
      expect(escapeMarkdown("a|b")).toBe("a\\|b");
    });

    it("should escape asterisks", () => {
      expect(escapeMarkdown("*bold*")).toBe("\\*bold\\*");
    });

    it("should escape square brackets", () => {
      expect(escapeMarkdown("[link]")).toBe("\\[link\\]");
    });

    it("should escape curly braces", () => {
      expect(escapeMarkdown("{object}")).toBe("\\{object\\}");
    });

    it("should escape HTML entities", () => {
      expect(escapeMarkdown("<tag>")).toBe("&lt;tag&gt;");
    });

    it("should handle multiple special characters", () => {
      expect(escapeMarkdown("*[test]*")).toBe("\\*\\[test\\]\\*");
    });

    it("should handle empty string", () => {
      expect(escapeMarkdown("")).toBe("");
    });

    it("should not modify regular text", () => {
      expect(escapeMarkdown("Hello World")).toBe("Hello World");
    });
  });

  describe("valueToMarkdown", () => {
    it("should convert strings with proper escaping", () => {
      expect(valueToMarkdown("*test*")).toBe("\\*test\\*");
    });

    it("should convert numbers to strings", () => {
      expect(valueToMarkdown(42)).toBe("42");
      expect(valueToMarkdown(3.14)).toBe("3.14");
    });

    it("should convert booleans to strings", () => {
      expect(valueToMarkdown(true)).toBe("true");
      expect(valueToMarkdown(false)).toBe("false");
    });

    it("should convert arrays to bracket notation", () => {
      expect(valueToMarkdown([1, 2, 3])).toBe("[1, 2, 3]");
    });

    it("should convert array of strings with escaping", () => {
      expect(valueToMarkdown(["a", "b*c"])).toBe("[a, b\\*c]");
    });

    it("should convert objects to code-quoted JSON", () => {
      const result = valueToMarkdown({ key: "value" });
      expect(result).toContain("`");
      expect(result).toContain("key");
      expect(result).toContain("value");
    });

    it("should handle null values", () => {
      expect(valueToMarkdown(null)).toBe("null");
    });

    it("should handle undefined values", () => {
      expect(valueToMarkdown(undefined)).toBe("undefined");
    });

    it("should handle nested arrays", () => {
      expect(valueToMarkdown([[1, 2], [3, 4]])).toBe("[[1, 2], [3, 4]]");
    });
  });

  describe("getLayerDescription", () => {
    it("should return description for motivation layer", () => {
      const desc = getLayerDescription("motivation");
      expect(desc).toBe("Goals, requirements, drivers, and strategic outcomes of the architecture.");
    });

    it("should return description for business layer", () => {
      const desc = getLayerDescription("business");
      expect(desc).toBe("Business processes, functions, roles, and services.");
    });

    it("should return description for api layer", () => {
      const desc = getLayerDescription("api");
      expect(desc).toBe("REST APIs, operations, endpoints, and API integrations.");
    });

    it("should return description for data-model layer", () => {
      const desc = getLayerDescription("data-model");
      expect(desc).toBe("Data entities, relationships, and data structure definitions.");
    });

    it("should return default description for unknown layer", () => {
      const desc = getLayerDescription("unknown-layer");
      expect(desc).toBe("Architecture layer");
    });

    it("should return description for all standard layers", () => {
      const standardLayers = [
        "motivation",
        "business",
        "security",
        "application",
        "technology",
        "api",
        "data-model",
        "data-store",
        "ux",
        "navigation",
        "apm",
        "testing",
      ];

      for (const layer of standardLayers) {
        const desc = getLayerDescription(layer);
        expect(desc).not.toBe("");
        expect(desc).not.toBe("Architecture layer");
      }
    });
  });

  describe("LAYER_DESCRIPTIONS", () => {
    it("should have descriptions for all 12 layers", () => {
      const layers = [
        "motivation",
        "business",
        "security",
        "application",
        "technology",
        "api",
        "data-model",
        "data-store",
        "ux",
        "navigation",
        "apm",
        "testing",
      ];

      for (const layer of layers) {
        expect(LAYER_DESCRIPTIONS[layer]).toBeDefined();
        expect(typeof LAYER_DESCRIPTIONS[layer]).toBe("string");
        expect(LAYER_DESCRIPTIONS[layer].length).toBeGreaterThan(0);
      }
    });

    it("should have exactly 12 layer descriptions", () => {
      expect(Object.keys(LAYER_DESCRIPTIONS).length).toBe(12);
    });
  });

  describe("Edge cases and integration", () => {
    it("should handle complex escaped strings in arrays", () => {
      const complex = ["[test]", "<html>", "*bold*"];
      const result = valueToMarkdown(complex);
      expect(result).toContain("\\[test\\]");
      expect(result).toContain("&lt;html&gt;");
      expect(result).toContain("\\*bold\\*");
    });

    it("should preserve numeric precision in arrays", () => {
      expect(valueToMarkdown([1.5, 2.7, 3.14159])).toBe("[1.5, 2.7, 3.14159]");
    });

    it("should handle empty arrays", () => {
      expect(valueToMarkdown([])).toBe("[]");
    });

    it("should handle empty objects", () => {
      const result = valueToMarkdown({});
      expect(result).toContain("`");
      expect(result).toContain("{}");
    });
  });
});
